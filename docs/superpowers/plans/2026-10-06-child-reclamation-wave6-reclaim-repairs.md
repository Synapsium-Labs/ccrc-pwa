# Child-reclamation wave 6: what `ws-reclaim` deletes, repaired (the temp root's wait and witness, contained git, the gone-branch pin, the gone-directory recovery, failures journaled, the vanish re-read) Implementation Plan

> **For agentic workers:** this plan is dispatched as a wave to a `ccrc-worker` session; follow the `ccrc-worker` skill for the protocol (ack, claims, asks, wave-done). To execute the tasks, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development inside every task (red first, then green, then the mutation table). Steps use checkbox (`- [ ]`) syntax for tracking.

**Programme:** child-reclamation (CCR-15), **wave 6 of 8**, run 291. **Deploy class: AGENT-FIRST** — the `ccd/ccd` half moves the fleet box first, and the server + pwa half (Task 12, and the server's reading of Task 11's two tokens) is live when the server box converges. **One child, one PR.**

**Goal:** Make the existing destructive verb delete only what it should, and say what it kept. After this wave:
- a reclaim's temp root never comes back after `reclaim done` because a straggler still held it;
- a child whose branch is already gone is reclaimed rather than failing `pin-failed` forever;
- a registry row whose directory is gone stops holding other children once positive evidence places it;
- git's inherited config can no longer defeat the containment's pins, and the tail's own deleting git calls run contained;
- the failures the lifecycle mirror never saw leave a journal line;
- the Runs board corrects a chip that its vanish re-read raced.

It also lays the collector's non-destructive groundwork, the positive witness. The collector verb itself is wave 7's.

**Architecture:** seven areas. Each is one or more tasks over the RECLAIM region of `ccd/ccd` (and the server and PWA for the last two).
1. **Containment (Tasks 1–3).** The outermost `_ws_reclaim_contained` unsets `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG` and `GIT_CONFIG_COUNT` ABOVE its count computation, so its three pins are the only entries (F6). The test harness gets one strip, `inheritedEnv()` in the new `server/test/gitEnvStrip.ts`. The tail's six destructive git calls run under `_ws_reclaim_contained`.
2. **The temp root (Tasks 4–7).**
   - `_ws_path_users <path>` is the in-use probe. It reads `/proc` and checks `TMPDIR` in environ, cwd, and open fds. It answers nobody, in use or unmeasured, and on Darwin it answers unmeasured.
   - `_ws_leaf_remove <root> <id> [dev:ino]` is the ONE removal helper. It answers removed-or-absent (proven), refused, or unmeasured.
   - The tail waits, bounded by `WS_RECLAIM_TMPROOT_WAIT_S=15`, after the kill. It then removes through the helper, or keeps the leaf and records `meas.tmpRootKept` / `meas.clipsKept`.
   - The positive witness `$REG/tmproots/<id>` is written on `_child_tmpdir`'s rc 0, and removed only after the leaf is proven absent.
3. **The branch (Task 8).** `_ws_reclaim_branch_state` reads three ways (`git show-ref --exists`: present / absent / unmeasured) and has the old-git positive fallback.
   - Every arm reads it in one act.
   - The token gains `branchState=present|absent`, and an unmeasured read mints no token.
   - A proven-absent branch pins HEAD, the WIP commit and the reflogs, and deletes no branch.
   - The tail's step-5 read failure is `failed` `branch-unmeasured`.
4. **The gone directory (Task 9).** `_ws_reclaim_workdir_shared` gains a second placement basis, `recorded`, with two arms: the git record, and the breadcrumb plus tombstone. A moved-tree check runs after the nested scan, and again in `_ws_reclaim_owned`.
5. **The journal (Tasks 10–11).**
   - `probe-unmeasured` is journaled `failed` in the lock and in `ws-audit --reclaim`.
   - `token-malformed` and `run-id-malformed` are journaled `refused`, after the session id is validated, and are classified as pre-lock failures (R43).
6. **The board (Task 12).**
   - The mirror keeps the newest reclaim-`done` `at`, which only ever rises.
   - `CoordStatus.childReclaimDoneAt?` is optional, and omitted while unmeasured.
   - The PWA has ONE reader. The board re-reads the archive once per change while a finished chip is unsettled.
   - A child-marked id leaving the listing resets the mirror clock, and nothing awaits it.
7. **Docs (Task 13) and the whole-branch pass (Task 14).**

**Tech Stack:**
- bash 5 (`ccd/ccd`, `set -uo pipefail`, re-stamped by `ccd/ccrc restamp`);
- git ≥ 2.43 (`show-ref --exists`; the porcelain `prunable` line needs ≥ 2.31);
- python3 ≥ 3.7 (the journal encoder, the `/proc` walk);
- Linux `/proc`;
- TypeScript (server and shared, and the pwa's own), vitest 4, Fastify 5, React 19;
- Node ≥ 22.13.0.

`node:sqlite` is untouched, and there is no migration.

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`: §5.2 (the temp root, two collectors), §5.5 (the ladder, step 3's pins, the hold), §5.6 (the tail), §5.9 (what the operator sees), §7 (what this does not claim), §8 (the waves). Task 13 writes this wave's text into each of them.

**Contract:** `docs/superpowers/programs/child-reclamation-contract.md`. **§12 (the rulings of 2026-10-06, R48–R59) BINDS this plan and amends §1–§11.** The coordinator's rulings on the task drafts (2026-10-06 09:20) are folded in below under "Rulings that amend the task text", and the ruling wins over any task text it names. Every "contract §N" or "R4x/R5x" in this plan means that file.

**Programme ledger:** `docs/superpowers/programs/child-reclamation.md`.

**HARD BOUNDARY.** This wave edits only these files:
- `ccd/ccd`;
- `ccd/ccrc`'s platform block (one length-neutral edit, Task 7);
- `server/src`, `server/test`, `shared/api.ts`, `pwa/src` and `pwa/test`;
- `README.md`, only for the S6-R11 re-pointing a task's `shared/api.ts` insertion owes, and for the one sentence Task 13 names;
- the spec and the contract named above (Task 13).

It adds:
- **no new ccd verb.** `cmd_*`, the dispatcher and the direct-entry boundary are unchanged;
- **no capability token.** `cmd_caps` is unchanged, and the fleet box's `ccd caps` is neither read nor needed;
- **no agent grant.** Nothing under `agent/` changes, and nothing in `ccd/ccd-entry.py`;
- **no coord.db migration.** `server/src/coord/schema.ts` is untouched;
- **no `deploy/` change.**

Nothing in this wave reads `$REG/tmproots/` in order to delete. Only the tail removes a witness, and only its own leaf's, after proving the leaf absent. The collector verb is **wave 7's** (R57), and its server lane is **wave 8's** (R58). A step that seems to need any of the above STOPS: name it by slug in the wave-done and build nothing.

---

## Global Constraints

Each line binds every task.

- **Fixture HOMEs only.** Every ccd case runs under `makeCcdHarness` / `makePrHarness` homes (`server/test/ccdWsHelpers.ts`, `ccdPrHelpers.ts`), cleaned by `tmpHelpers.ts`. No new test file spreads `process.env`: it builds its environment or takes `inheritedEnv()` (Task 2).
- **Never run `ccd` against the live `$HOME`**, from a shell or a test. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service`. Never print a secret file's contents.
- **No destructive verb against the live host:** `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`, `ws-reclaim` (forbidden to every session), and `ws-expire`. The live residue in `~/.cc-tmp` and `expoAI-assistant-calm-mesa` stay the operator's (R59).
- **Re-stamp after EVERY `ccd/ccd` edit:** `bash ccd/ccrc restamp ccd/ccd`, then `node shared/mark.mjs --check ccd/ccd` (exit 0) and `server/test/ownership.test.ts`. Never commit an unstamped `ccd/ccd`.
- **S6-R11 citation tax and the 19109 boundary.**
  - An edit at or above `ccd/ccd:19109` stays LENGTH-NEUTRAL, or re-measures the census with the instrument, never by hand. That covers the platform block, `cmd_ws_audit`, the LC region (`_lc_fail`), `_ws_slug_free`, `cmd_caps` and the entry guard.
  - `ccd/ccrc` is a cited file too.
  - Each insertion into `shared/api.ts` re-points README's `shared/api.ts:` anchors BY CONTENT in the same task's commit.
  - README holds no `ccd/ccd` anchor, so the S6-R11 re-pointer in the continuity plan is stale and is never copied.
- **R56's overlap rule.** It is shared with workspace-lifecycle (`ccrc-pwa-quiet-river`) and run 274.
  - It covers `ccd/ccd`'s RECLAIM and EXPIRE regions, the spawn gate, `_child_tmpdir`, `ccdWsHelpers.ts` and `README.md`. Edits there are additive, in their own regions.
  - `_ws_expire_cwd_users`' body is never edited (Task 6 edits its header comment only).
  - The second lander merges `main` (`git merge`, never a rebase), re-stamps, and re-runs `ownership.test.ts`, `mark.mjs --check`, the citation cases and `deviation-refs`.
- **New tests go in NEW files**, because of the 600 s foreground ceiling. An existing test file changes only at the line a task names.
- **Run vitest in the foreground, from inside the package:** `./node_modules/.bin/vitest run test/<file>`, with a timeout of at least 600000 ms. Never bare `npx vitest`, never backgrounded. Re-run a known load flake in isolation before calling it a break.
- **git ≥ 2.43** on the fleet and on the worker's box (`show-ref --exists`). A git older than 2.43 is served by the positive fallback: a branch that resolves reads present, and anything else reads unmeasured. An old-git SHIM in the test pins that, never the worker's own git.
- **No `D-` token in a commit message, and no number range anywhere.** No file gains a `D-` token for a number `origin/main` does not define, and this wave prescribes none.
- **Branch discipline:** one commit per task, on this workspace's own branch, never a feature branch. Absorb `main` only on a worker clause-16 licence, with `git merge`.
- **Contract §8 R23: committed code comments and test titles cite the SPEC, never the contract.** Where a task's text prescribes "contract R4x/R5x" inside a committed comment or an `it`/`describe` title, write the spec section that Task 13 fills:
  - R49 and R51 → spec §5.6;
  - R50 → spec §5.2;
  - R52 and R55 → spec §5.9;
  - R53 and R54 → spec §5.5.

  This is a spelling rule, not a departure.
- **Locate code by CONTENT.** Line numbers are hints at `77c11245a` (main) or `e79b1da7` (wave 5's tip). Two other programmes are live in these files.
- **Topology-clean:** no hostname, IP, tailnet name or docserver URL in any committed file, this plan included.
- **Mutation-table discipline:** every guard ships with a case that goes red when the guard is deleted or mutated, measured before and after. Revert each mutation before the next.
- **Rings:**
  - `shared/*.ts` imports nothing;
  - `mirrorplan.ts` and `childReclaim.ts` decide;
  - `watch.ts` only wires (L4 delivery never decides);
  - the PWA maps no token.
- **Wire:** additive only, absence permits, ONE reader per field, no `FLEET_PROTO` bump.
- **Naming:** TypeScript identifiers say `childReclaim` / `ChildReclaim`, never a bare `reclaim*`.

## Rulings that amend the task text (binding; the coordinator, 2026-10-06 09:20)

These rulings are ALREADY APPLIED in the task text below. This section is the record of them. Wherever any task text still disagrees with a ruling here, the ruling wins, and the worker names the disagreement by slug in the wave-done.

- **X1, and so no merge step.** Wave 6 is dispatched only after #290 has merged.
  - Every "AFTER #290", "merge main once #290 has merged" and "read from `origin/ws/quiet-meadow`" instruction in Tasks 5, 10, 11 and 12 is void.
  - Anchors are read on this tree. Task 0 proves the merge and the fix-round shapes once.
- **X3, names.**
  - The harness strip is `inheritedEnv()`.
  - The tail's wait knob is Task 6's (`WS_RECLAIM_TMPROOT_WAIT_S`, lowered only by `CCD_RECLAIM_TMPROOT_WAIT_S`). Task 7's keep cases set that knob, never a stubbed `sleep`.
  - The meas-key census continues from the 34 that Task 5 leaves.
  - Task 3's count of 6 destructive git calls in the tail is re-pinned by any later task that adds or moves one.
- **Task 7 (witness.OPEN1).** `run` joins the staleness test. The witness is rewritten when it is absent or unparseable, or when its `dev`, `ino`, `btime` or `run` differs.
  - Add the same-inode recycled-slug case, red first.
  - Its mutation row drops `run` from the comparison, and the case reds.
- **Task 8 (gone-branch.OPEN4): the positive fallback.**
  - When `show-ref --exists` answers anything but 0 or 2 (an older git answers 129), a successful `git rev-parse --verify --quiet refs/heads/<b>^{commit}` reads `present <sha>`, and anything else reads `unmeasured`. Only rc 2 ever proves `absent`.
  - The draft case "a git that rejects --exists answers unmeasured, even for a branch that stands" becomes, under the old-git shim: a present branch reads present (and reclaims as today), and a gone one reads unmeasured (an unmeasured audit; `probe-unmeasured` at the verb).
  - Mutation row: the fallback answers `absent` on a failed rev-parse, and the gone-branch shim case reds.
- **Task 8 (gone-branch.OPEN5): a NEW token, `branch-unmeasured`, instead of `branch-elsewhere`.**
  - Step 5's read failure is `_ws_reclaim_fail … branch-unmeasured …` (journaled `failed`), with the row and the breadcrumb kept.
  - Its `LC_REFUSAL_WORD` sentence, verbatim: "ccrc could not read whether the branch still exists, so it stopped before removing anything further; it tries again". The detail fits the tail's real state at that step: the worktree is already removed, and the branch, clips, temp root and row are kept.
  - It costs R43's set:
    - the `LcRefusalToken` member;
    - the `ALL_TOKENS` entry and its count in `lifecycle-refusal-word.test.ts`;
    - disjointness from `SENTENCES`;
    - one literal call site;
    - the failure-word list in `child-reclaim-status.test.ts`;
    - the README re-pointing for the `shared/api.ts` insertion.
  - It takes NO `CHILD_RECLAIM_PRE_LOCK_TOKEN` entry, because a `failed` line is already a failure line.
  - Task 8's Files therefore add `shared/api.ts`, `README.md` (the tax), `server/test/lifecycle-refusal-word.test.ts` and `server/test/child-reclaim-status.test.ts`.
- **Counts move because Task 8 precedes Tasks 10 and 11.** `TOKENS.length` in `lifecycle-refusal-word.test.ts` reads 14 on main, 15 after Task 8, 16 after Task 10 and 18 after Task 11. Each task's entry condition reads the count the previous task left, never a draft's literal.
- **Task 10 (journal.OPEN7).** `CHILD_RECLAIM_PROBE_UNMEASURED` in `server/src/coord/childReclaim.ts` is typed `satisfies LcRefusalToken` (one line).
- **Task 13 (journal.OPEN6).** `_lc_fail`'s header gains one line-neutral sentence.
- **Accepted as drafted:**
  - f6.OPEN1 (the 23 option-less git spawns) and OPEN3 (`ccdWsHelpers.ts`'s in-place strip);
  - probe-helper-tail.OPEN2/DEP2 (`clips-kept-recorded`), OPEN8 (non-dumpable and other-uid processes are skipped, and the header says so) and DEP3 (header comment only);
  - witness.DEP1–3;
  - gone-branch.DEP1 (`branchState=`) and DEP2 (old git fails closed as unmeasured);
  - gone-dir.DEP1 (`create-row-never-read`), DEP2 (`expire-breadcrumb-not-recovered`) and OPEN3 (placement by literal spelling);
  - journal.OPEN1 (`token-malformed`, `run-id-malformed`);
  - vanish.OPEN3 (omitted, never null) and OPEN4 (only a `child` mark resets the clock).

## Review Focus (the five failure modes most likely to bite)

1. **A straggler recreates a removed leaf.** The pane's processes outlive `tmux kill-session`, and one with `TMPDIR=<leaf>` remakes the temp root after `reclaim done`: the measured swift-hollow incident.
   - Pinned by Task 6's `THE SWIFT-HOLLOW RACE` and `a straggler that outlives the BOUND` (`ccd-child-reclaim-tmproot-wait.test.ts`).
   - Pinned by Task 4's `a TMPDIR naming a leaf that does NOT exist still uses it` and `a status that does not parse is UNMEASURED — never "nobody"` (`ccd-path-users.test.ts`).
   - Pinned by Task 7's `the tail removes the witness only with the leaf, and keeps both when it keeps the leaf` (`ccd-child-tmproot-witness.test.ts`).
2. **A token minted over an unreadable ref is spent as absent.** Today `tip=""` folds absent and unreadable together. Pinned by Task 8's `a CORRUPT loose ref is unmeasured, never absent`, `step 5: a branch the tail cannot read stops it, the row kept`, `a token minted over absence is refused once the branch reappears: state-changed`, and the old-git shim pair (`ccd-child-reclaim-gone-branch.test.ts`).
3. **A gone alternate row is placed wrongly.** A row that should still hold is released, or a moved tree escapes. Pinned by Task 9's (`ccd-child-reclaim-recovery.test.ts`):
   - `two admin entries naming one gone tree keep the hold`;
   - `a locked record is never prunable, and keeps the hold`;
   - `a parent spelled through a link keeps the hold`;
   - `an unreadable worktrees/ directory or gitdir file keeps the hold`;
   - `a lifecycle create row alone keeps the hold`;
   - the breadcrumb `VARIANTS`;
   - the moved-tree cases;
   - `git worktree prune never runs`.
4. **An inherited git config variable defeats a pin.** `GIT_CONFIG_PARAMETERS` overrides `core.hooksPath`, `GIT_CONFIG` redirects a containment read, or a harness leaks `GIT_DIR`.
   - Pinned by Task 1's `F6: the outermost containment starts from no inherited config entry` (`ccd-child-reclaim-config-env.test.ts`).
   - Pinned by Task 2's `the harness drops an inherited GIT_DIR` and its scan (`git-env-strip.test.ts`).
   - Pinned by Task 3's `the tail runs none of the repository's programs while it deletes` and its six-call scan (`ccd-child-reclaim-tail-contained.test.ts`).
   - Pinned by Task 8's `reads the repository it is NAMED — an inherited GIT_DIR cannot answer for another`.
5. **The vanish trigger fires as a cadence.** A re-read that repeats per tick, fires on null, or fires with nothing unsettled.
   - Pinned by Task 12's `childReclaimDoneRefreshDue — once per change, never a poll`, `a null is never a reason to read`, `does not re-read when every finished row is settled, or on the first frame it sees` and `an older server: frames that never carry the field never read` (`pwa/test/child-reclaim-done-reread.test.tsx`).
   - Pinned by Task 12's `sweeps on the tick that sees a child vanish, and not on one that sees a plain row vanish` and `resets nothing across an unlistable tick` (`server/test/child-reclaim-done-at.test.ts`).

## File Structure

| File | Task(s) | Responsibility |
|---|---|---|
| `ccd/ccd` | 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13 | 1: F6 in `_ws_reclaim_contained`. 3: the tail's six git deletes contained. 4: `_ws_path_users`. 5: `_ws_leaf_uid`, `_ws_leaf_remove`, the tail's step 6 and its purge texts. 6: the wait constant, `_ws_reclaim_tmproot_wait_s`, `_ws_reclaim_tmproot_quiet`, the tail's wait, `_ws_expire_cwd_users`' header comment. 7: `_plat_btime` (length-neutral), `_child_tmpdir`'s rc-0 witness write, the witness block, `_ws_tmproot_remove`. 8: `_ws_reclaim_branch_state`, `_ws_reclaim_tip_read`, `RECLAIM_BRANCHSTATE`, the ladder arms, both pins, the settle, step 5. 9: `RECLAIM_REC_PRUNABLE`, `_ws_reclaim_recorded*`, `_ws_reclaim_moved_check`, `_ws_reclaim_owned`. 10: journal in `_ws_reclaim_locked` and `cmd_ws_audit` (one-for-one). 11: `cmd_ws_reclaim`'s validation order and journal. 13: `_lc_fail` header (line-neutral). Re-stamped after each. |
| `ccd/ccrc` | 7 | The platform block's `_plat_btime`, byte-identical to `ccd/ccd`'s, length-neutral |
| `shared/api.ts` | 5, 8, 10, 11, 12 | 5: `LifecycleMeas.tmpRootKept` / `clipsKept` (32→34 keys). 8: `branch-unmeasured`. 10: `probe-unmeasured`. 11: `token-malformed`, `run-id-malformed`, and `ChildReclaimAttention`'s docstring. 12: `CoordStatus.childReclaimDoneAt?` |
| `server/src/coord/journalparse.ts` | 5 | `reviveMeas` carries the two keys |
| `server/src/childReclaimSweep.ts` | 10, 11 | 10: the failure docstring. 11: `CHILD_RECLAIM_PRE_LOCK_TOKEN` gains `token` and `runId`, and `childReclaimFailureLine`'s docstring |
| `server/src/coord/childReclaim.ts` | 10, 11, 12 | 10: `CHILD_RECLAIM_PROBE_UNMEASURED satisfies LcRefusalToken`. 11: two die patterns and two comments. 12: `childMarkLeftListing` |
| `server/src/coord/mirrorplan.ts` | 12 | `childReclaimDoneHighWater` (pure) |
| `server/src/coord/mirror.ts` | 12 | `childReclaimDoneAt()`, raised in `commit` after the ingest returns |
| `server/src/watch.ts` | 12 | `currentChildReclaimDoneAt()`, `emitCoord`'s field, and the clock reset on a child vanish (no await) |
| `pwa/src/fleet/childReclaimWords.ts` | 12 | `childReclaimDoneAtOf`, the ONE reader |
| `pwa/src/fleet/runWords.ts` | 12 | `childRunsSeen`, `childReclaimDoneRefreshDue` |
| `pwa/src/screens/RunsScreen.tsx` | 12 | Two selectors, and two effects after wave 5's vanish effect |
| `README.md` | 5, 8, 10, 11, 12, 13 | 5–12: `shared/api.ts:` anchors re-pointed by content, only where the census reds. 13: one sentence, line-neutral |
| `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` | 13 | §1, §5.2, §5.5, §5.6, §5.9, §7 and §8, as built |
| `docs/superpowers/programs/child-reclamation-contract.md` | 13 | "§12 as built", appended to §12 |
| `server/test/gitEnvStrip.ts` (new) | 2 | `GIT_LOCAL_ENV_FLOOR`, `gitLocalEnvVars()`, `inheritedEnv()` |
| `server/test/pathUsersFixture.ts` (new) | 4 | `holdProc`, `holdsOpen`: real processes with a TMPDIR, a cwd or an fd |
| `server/test/ccd-child-reclaim-config-env.test.ts` (new) | 1 | F6 |
| `server/test/git-env-strip.test.ts` (new) | 2 | The strip, the `GIT_DIR` pin, the spread scan |
| `server/test/ccd-child-reclaim-tail-contained.test.ts` (new) | 3 | Hook-free deletes, the six-call scan, `ws-expire` too |
| `server/test/ccd-path-users.test.ts` (new) | 4 | The probe, real and fake process tables |
| `server/test/ccd-leaf-remove.test.ts` (new) | 5 | The helper's three answers |
| `server/test/ccd-child-reclaim-tmproot-wait.test.ts` (new) | 6 | The bound, the wait, the swift-hollow race, keep |
| `server/test/ccd-child-tmproot-witness.test.ts` (new) | 7 | Write, read, remove, the walker census |
| `server/test/ccd-child-reclaim-gone-branch.test.ts` (new) | 8 | The three-way read at every arm, old git, the live shape |
| `server/test/ccd-child-reclaim-recovery.test.ts` (new) | 9 | Both arms, the moved tree, the never-list |
| `server/test/ccd-child-reclaim-unmeasured-journal.test.ts` (new) | 10 | `probe-unmeasured` journaled `failed` |
| `server/test/ccd-child-reclaim-prelock-journal.test.ts` (new) | 11 | The id-tied dies journaled, and the seven other pre-lock dies not journaled |
| `server/test/child-reclaim-done-at.test.ts` (new) | 12 | High water, coord field, clock reset |
| `pwa/test/child-reclaim-done-reread.test.tsx` (new) | 12 | One reader, once per change |
| `server/test/ccdWsHelpers.ts` | 2 | `inheritedEnv()` at four sites (R56 overlap file) |
| `server/test/childReclaimFixture.ts`, `ccd-child-reclaim-audit`, `-pause`, `-entry`, `-verb-reflogs`, `ccd-ws-expire-reach` (`.test.ts`) | 2 | The strip at each spread or option-less git spawn |
| `server/test/ccd-child-reclaim-hardening.test.ts` | 1, 2 | 1: one comment line. 2: two spreads |
| `server/test/ccd-child-reclaim-ladder.test.ts` | 2, 9 | 2: the strip. 9: one fixture line and one comment sentence in the hold case, plus its block comment |
| `server/test/ccd-child-reclaim-pin.test.ts` | 2, 8 | 2: the strip. 8: the case R53 reverses |
| `server/test/ccd-lifecycle-contain.test.ts`, `server/test/lifecycle-wire.test.ts` | 5 | The `meas.` census 32→34 |
| `server/test/ccd-child-reclaim-verb.test.ts`, `-verb-tail.test.ts` | 6 | A temp root's absence becomes a Linux-only assertion |
| `server/test/macos-platform.test.ts` | 7 | One GNU-arm row for `_plat_btime` |
| `server/test/lifecycle-refusal-word.test.ts` | 8, 10, 11 | `ALL_TOKENS` and the count (14→15→16→18) |
| `server/test/child-reclaim-status.test.ts` | 8, 10, 11 | The failure-word rows and list |
| `server/test/child-reclaim.test.ts` | 10, 11 | The vacuous parity pin retargeted to RECLAIM, and `PRE_LOCK_TOKEN` |
| `server/test/ccd-child-reclaim-audit.test.ts` | 10 | The three "journaled nowhere" assertions, a title and a comment |
| `server/test/ccd-refusal-scan.test.ts` | 11 | `SANCTIONED` narrows by one (15→14) |
| `server/test/child-reclaim-sweep-policy.test.ts` | 11 | The pre-lock set is four |
| `server/test/session-hook.test.ts` | 5, 7, 8, 10, 11, 12, 13 | Only if a census re-measures red (S6-R11) |

## Execution order and dependencies

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14. Each task is one commit on the workspace branch.

| Task | Needs | Model routing | Why this place |
|---|---|---|---|
| 0 Entry conditions | — | `sonnet`, medium | Proves #290 and its fix round are in the tree, the tools, and every anchor's starting state |
| 1 F6 | 0 | `opus`, high | The environment Tasks 3, 8 and 9 rely on |
| 2 Harness strip | 1 | `sonnet`, high | Its scan binds the reclaim and expire suites and every new ccd suite and fixture Tasks 3–11 create |
| 3 Contained tail | 1, 2 | `opus`, high | Pins the destructive-call count (6) that later tail edits keep |
| 4 In-use probe | 2 | `opus`, high | A new function, never `_ws_expire_cwd_users` |
| 5 Removal helper | 4 | `opus`, high | The first `shared/api.ts` insertion (meas keys), with README's tax |
| 6 The wait and keep | 4, 5 | `opus`, high | Consumes the probe and the helper. Defines the knob Task 7 uses |
| 7 Witness | 5, 6 | `opus`, high | Swaps the tail's one temp-root call. Edits `ccd/ccrc` |
| 8 Gone-branch pin | 1, 3 | `opus`, high | Adds `branch-unmeasured`, before Tasks 10 and 11 count tokens |
| 9 Gone-directory recovery | 1, 3, 8 | `opus`, high | Its ladder edit sits beside Task 8's tip read, so it comes after, anchored by content |
| 10 `probe-unmeasured` journaled | 8 | `sonnet`, high | Its token count continues from Task 8's |
| 11 Pre-lock dies journaled | 10 | `opus`, high | Reorders argv validation at the destructive verb's entry |
| 12 Vanish re-read trigger | 0 | `sonnet`, high | Server and pwa only. Last code task, so the `shared/api.ts` tax is paid one task at a time |
| 13 Docs | 1–12 | `sonnet`, high | Writes the spec sections the code comments cite (R23) |
| 14 Whole-branch verification and the PR | 0–13 | `sonnet`, high | The wave-done's `suite:` line |

Tasks 1–11 each end with a re-stamp. Tasks 5, 8, 10, 11 and 12 each insert into `shared/api.ts` and pay README's re-pointing in their own commit.
---

### Task 0: Entry conditions

**Model routing:** `sonnet`, effort `medium`.

**Files:** none. Nothing is written by this task.

This task is measured on this workspace's own checkout, before Task 1, from the workspace root.

- Each command prints what its comment states.
- If any does not, **STOP.** Report the command and its exact output to the coordinator, and build nothing. A wave that fills in another wave's surface is a worker with a stale plan.
- This wave adds no capability token. **Do not read the fleet box's `ccd caps`**: nothing here needs it.

- [ ] **Step 1: #290 has merged into this tree (X1)**

```bash
gh pr view 290 --json state,mergeCommit -q '.state + " " + .mergeCommit.oid'          # (a1) MERGED <40-hex>
git merge-base --is-ancestor "$(gh pr view 290 --json mergeCommit -q .mergeCommit.oid)" HEAD; echo "a2 rc=$?"  # (a2) rc=0
git merge-base --is-ancestor 77c11245a HEAD; echo "a3 rc=$?"                             # (a3) rc=0
grep -c '^## 12\. Rulings, 2026-10-06' docs/superpowers/programs/child-reclamation-contract.md  # (a4) 1: contract §12 is committed
```

- [ ] **Step 2: Wave 5's symbols are present**

```bash
grep -cF 'export const CHILD_RECLAIM_PRE_LOCK_TOKEN = {' server/src/childReclaimSweep.ts                      # (b1) 1
grep -cF 're: /^bad token$/, token: null' server/src/coord/childReclaim.ts                                   # (b2) 1
grep -cF 'the pre-lock tokens are exactly the two lock dies' server/test/child-reclaim-sweep-policy.test.ts  # (b3) 1
grep -cF 'currentChildMarks(): ReadonlyMap<string, ChildMark> | null' server/src/watch.ts                    # (b4) 1
grep -cF 'this.childMarks = new Map(records.map' server/src/watch.ts                                         # (b5) 1
grep -c  'export function childReclaimRefreshDue' pwa/src/fleet/runWords.ts                                  # (b6) 1
grep -c  'export function childReclaimAttentionOf' pwa/src/fleet/childReclaimWords.ts                        # (b7) 1
grep -cF 'private commit(gen: string, lines: readonly string[]' server/src/coord/mirror.ts                    # (b8) 1
grep -n  'export const childReclaimSameGeneration' server/src/childReclaimSweep.ts                           # (b9) one line
```

- [ ] **Step 3: #290's fix round 1 shapes are in the tree**

The fix round landed after this plan was written, so these checks read SHAPES, not literal text. Each one prints a body: read it and confirm the stated shape. If the function has moved or been renamed, locate it by content and confirm the same shape. If the shape is absent, STOP.

```bash
awk '/^export function childReclaimStatus\(/,/^}/' server/src/coord/childReclaim.ts | grep -cw marked   # (c1)
awk '/^export function childReclaimKeptItems\(/,/^}/' server/src/childReclaimSweep.ts | grep -n 'runId'   # (c2)
grep -cF "'child-birth-unplaced': { class: 'doubt'" server/src/childReclaimSweep.ts                        # (c3) 1
awk '/^export const childReclaimSameGeneration/,/;$/' server/src/childReclaimSweep.ts                     # (c4)
```

- **(c1) Step 4 is gated on `marked`.** Expect at least 4. At `e79b1da7`, before the round, it was 3. Reading the body: the failure-line arm, the `paused`-token arm and the retry arm each answer only under `marked`.
- **(c2) Kept verdicts are keyed by run.** The body compares the verdict's OWN run id with the marker's run (or with the run being composed). At `e79b1da7` the only `runId` read was `i.live.get(sessionId)`.
- **(c3) `child-birth-unplaced` is in the doubt class.** At `e79b1da7` it read `class: 'kept'`.
- **(c4) The generation reset keys the marker's run.** The predicate compares the marker's run id as well as `bornAt`. At `e79b1da7` it compared `bornAt` alone. If the reset moved, find it with `grep -n 'childReclaimFirstSighting(' server/src/watch.ts`, and confirm the guard there keys the marker's run id.

- [ ] **Step 4: Tools**

```bash
git --version                                                                                     # (d1) git version 2.43.0 or newer
git show-ref --exists "refs/heads/$(git rev-parse --abbrev-ref HEAD)"; echo "d2 rc=$?"           # (d2) rc=0
git show-ref --exists refs/heads/w6-entry-probe-never-a-branch; echo "d3 rc=$?"                   # (d3) rc=2: only rc 2 proves absence
python3 -c 'import sys; print(sys.version_info >= (3, 7))'                                        # (d4) True
uname -s                                                                                          # (d5) Linux
```

- On (d5) not Linux: Tasks 4, 6 and 7's real-process describes skip. Report it, and continue only if the coordinator says so.
- On git older than 2.43: STOP. The old-git behaviour is pinned by a shim in Task 8, never by this box's git.

- [ ] **Step 5: The stamp, the regions and the citation boundary**

```bash
node shared/mark.mjs --check ccd/ccd; echo "e1 rc=$?"                                               # (e1) rc=0
grep -n 'RECLAIM-BEGIN\|RECLAIM-END\|EXPIRE-BEGIN\|EXPIRE-END' ccd/ccd                             # (e2) four lines, every number > 19109
grep -n '^_child_tmpdir()' ccd/ccd                                                                  # (e3) one line > 19109
grep -ohE 'ccd/ccd:[0-9]+(-[0-9]+)?' docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md README.md \
  | sed -E 's/.*://; s/.*-//' | sort -n | tail -1                                                   # (e4) 19109: the frozen boundary
grep -n '^_lc_fail() {' ccd/ccd                                                                     # (e5) one line < 19109 (Task 13: line-neutral)
grep -n 'ws-audit --reclaim measured nothing' ccd/ccd                                               # (e6) one line < 19109 (Task 10: one-for-one)
grep -n '^_plat_size() {    # <file> -> size in bytes$' ccd/ccd ccd/ccrc                            # (e7) one hit in each file (Task 7: length-neutral)
grep -n '^# ── END PLATFORM LAYER' ccd/ccd ccd/ccrc                                                  # (e8) two line numbers: RECORD them for Task 7
```

If (e4) prints a number other than 19109, every "19109" in this plan reads as that number. Report it.

- [ ] **Step 6: The starting state of every task's anchors (nothing of this wave exists yet)**

```bash
# Tasks 1-3
grep -c 'that decision is carried to the next wave' ccd/ccd                                         # (f1) 1: F6 not yet landed
grep -cE '_ws_reclaim_contained git -C "\$main" (worktree remove|update-ref -d)' ccd/ccd             # (f2) 0
awk '/^_ws_reclaim_tail\(\) \{/,/^cmd_ws_reclaim\(\) \{/' ccd/ccd | grep -E 'git -C "\$main" (worktree remove|update-ref -d)' | grep -v '^ *#' | wc -l   # (f3) 6
test -e server/test/gitEnvStrip.ts; echo "f4 rc=$?"                                                  # (f4) rc=1
(cd server/test && ls | grep -E '^(ccd-child-reclaim-.*\.test\.ts|ccd-ws-expire-.*\.test\.ts|childReclaim[A-Za-z]*\.ts|wsExpireFixture\.ts|ccdWsHelpers\.ts)$' \
  | xargs grep -nE "\.\.\.process\.env\b|entries\(process\.env\)|execFileSync\('git', \[[^]]*\]\)" \
  | grep -vE '^[^:]+:[0-9]+:\s*(//|\*)' | wc -l)                                                     # (f5) a number: 33 at 77c11245a. RECORD it; Task 2 uses it; never retype the plan's
# Tasks 4-7
grep -c '^_ws_path_users()\|^_ws_leaf_remove()\|^_ws_reclaim_tmproot_quiet()' ccd/ccd               # (g1) 0
grep -n '^_ws_reclaim_tail() {' ccd/ccd                                                              # (g2) exactly one line
grep -c 'rm -rf "\$tdir"' ccd/ccd                                                                     # (g3) 1: today's unchecked temp-root rm
grep -c 'a reclaim never meets it' ccd/ccd                                                           # (g4) 1: the false header Task 6 corrects
grep -c 'clips and temp root are gone' ccd/ccd                                                       # (g5) 3
grep -n 'toBe(32)' server/test/ccd-lifecycle-contain.test.ts                                         # (g6) one hit
grep -c 'tmproots' ccd/ccd                                                                           # (g7) 0
grep -c '^_plat_btime()' ccd/ccd ccd/ccrc                                                            # (g8) 0 in each file
# Task 8
grep -c 'show-ref --exists' ccd/ccd                                                                  # (h1) 0
grep -c '^_ws_reclaim_branch_state()' ccd/ccd                                                        # (h2) 0
grep -cF 'rev-parse --verify --quiet "refs/heads/$branch^{commit}"' ccd/ccd                          # (h3) 4
grep -c 'there is no branch tip to pin' ccd/ccd                                                      # (h4) 1
grep -cF 'show-ref --verify --quiet "refs/heads/$branch"' ccd/ccd                                    # (h5) 4: cmd_ws_rm (:8001), _ws_reap_tail (:14827), _ws_gc_prune_row (:15673), and the reclaim tail's step 5 (:28348), at 77c11245a. Task 8 edits only the last
grep -c 'FAILS when the branch no longer resolves' server/test/ccd-child-reclaim-pin.test.ts         # (h6) 1
grep -n '^_ws_reclaim_reset()' ccd/ccd                                                               # (h7) one line > 19109
# Task 9
grep -c '_ws_reclaim_recorded\|_WS_RECORDED_GDIRS\|RECLAIM_REC_PRUNABLE\|_ws_reclaim_moved_check' ccd/ccd   # (i1) 0
grep -cF '(( lit )) || (( rok )) || { unres+="${unres:+, }$o"; continue; }' ccd/ccd                  # (i2) 1
grep -c "^_WS_RESOLVED=''" ccd/ccd                                                                   # (i3) 1
grep -c 'two vanished children hold each other' server/test/ccd-child-reclaim-ladder.test.ts         # (i4) 1
test -e server/test/ccd-child-reclaim-recovery.test.ts; echo "i5 rc=$?"                              # (i5) rc=1
# Tasks 10-11
grep -cF '_ws_reclaim_failed_json probe-unmeasured "$REAP_DETAIL"' ccd/ccd                           # (j1) 2: reclaim's site and ws-expire's twin
grep -c 'expect(TOKENS.length).toBe(14)' server/test/lifecycle-refusal-word.test.ts                  # (j2) 1
grep -n 'toBe(15)' server/test/ccd-refusal-scan.test.ts                                              # (j3) one line: SANCTIONED.length
grep -c "'probe-unmeasured'\|'branch-unmeasured'\|'token-malformed'\|'run-id-malformed'" shared/api.ts   # (j4) 0
# Task 12
grep -c 'childReclaimDoneAt' shared/api.ts server/src/watch.ts pwa/src/fleet/childReclaimWords.ts     # (k1) 0 for each file
```

On (f3) other than 6, or (j1) other than 2: STOP. Those counts are pinned by later tasks.

- [ ] **Step 7: Install, and the baseline suites are green before any edit**

Run each line from the workspace root, in the FOREGROUND, with a timeout of 600000 ms:

```bash
cd server && npm ci
cd pwa && npm ci
cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts test/ccd-child-tmpdir.test.ts          # (l1) PASS
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts -t 'ambiguous row hold'     # (l2) 3 passed
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|THE RANGE BOUND'                # (l3) PASS: README's shared/api.ts anchors stand repaired after #290
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts                                             # (l4) PASS
```

A red in (l3) or (l4) on an untouched tree is `main-red`. Measure it on a clean checkout of `origin/main` in scratch, report it once, and STOP for a ruling. Never repair it inside Task 1.

- [ ] **Step 8: Record, then report nothing yet**

Keep every output above for the wave-done (Task 14 Step 9): (a1)–(l4), the recorded (e8) and (f5) numbers, and the `git --version` line.

Read the open claims on this wave's files as the `ccrc-worker` skill says, and take the claims it prescribes. A 409 on a path that R56 names (`ccdWsHelpers.ts`, `README.md`, `ccd/ccd`'s regions) is not a stop: edits there stay additive. Record each 409 and how it ended.

**Tests:** none. This task's checks are the commands above.

**Deploy class:** none.

### Task 1: F6 — the outermost containment drops an inherited `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG` and `GIT_CONFIG_COUNT`

**Model routing:** **`opus`, effort `high`**. This is SAFETY-critical. `_ws_reclaim_contained` is the environment that every hook-free git call of both destructive verbs runs under: the reclaim's pin, ladder and audit, and `ws-expire`'s fork and audit.

**Why:** Contract §12 R51. Today the containment only appends its three config pins to an inherited `GIT_CONFIG_COUNT` (`n=${GIT_CONFIG_COUNT:-0}`). It also keeps an inherited `GIT_CONFIG_PARAMETERS` on purpose; its comment carries that decision "to the next wave". `GIT_CONFIG` it never handles. I measured three failures on git 2.43.0, and re-measured them for this plan:
- An inherited `GIT_CONFIG_PARAMETERS` overrides the `core.hooksPath=/dev/null` pin. `rev-parse --git-path hooks` answers the inherited path.
- `GIT_CONFIG` sends both `git config` reads the containment makes to another file: `extensions.refStorage` in `_ws_reclaim_keep_reflogs` and `core.fileMode` in the WIP commit.
- A caller's `GIT_CONFIG_COUNT` entries reach those same reads.

Once the count is unset, stale `GIT_CONFIG_KEY_<n>`/`VALUE_<n>` entries do nothing (measured). So the fix is to unset the three variables in the OUTERMOST block, ABOVE the count computation, and the count then starts at 0. One trap: an unset placed after the `local -x GIT_CONFIG_COUNT=…` line removes that local, and all three pins are silently lost. Mutation row 4 below pins this ordering. `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` stay a stated residual, as the ruling says. They name this uid's own files.

F6 reaches `ws-expire` through the shared containment. The coordinator tells workspace-lifecycle's coordinator (`ccrc-pwa-quiet-river`) before dispatch (R51's last line, ruling X2), and the worker names F6 in the wave-done as a change in shared code that `ws-expire` also runs. Nothing in the EXPIRE region is edited.

**Anchors** (`ccd/ccd` at `77c11245a`; the line numbers are hints, so find them by content with the greps given. Wave 5 (#290) is already in the worker's tree and touches no file this task names):
- `_ws_reclaim_contained() {`: `ccd/ccd:26543`, `grep -n '^_ws_reclaim_contained() {' ccd/ccd`
- the carried-forward paragraph: `ccd/ccd:26580-26588`, `grep -n 'that decision is carried to the next wave' ccd/ccd`
- the count computation: `ccd/ccd:26589`, `grep -n 'local n="${GIT_CONFIG_COUNT:-0}"' ccd/ccd`
- the repository paragraph, which opens `# AND NO REPOSITORY BUT THE ONE EACH CALL NAMES`: `ccd/ccd:26599-26620`
- the outermost block: `ccd/ccd:26621-26627`, `grep -n 'if \[\[ -z "${_WS_RECLAIM_CONTAINED:-}" \]\]' ccd/ccd`
- the two config reads: `ccd/ccd:27449`, `grep -n 'config --get extensions.refStorage' ccd/ccd`; and `ccd/ccd:27021`, `grep -n 'config --bool --get core.fileMode' ccd/ccd`
- the existing containment suite's stale comment: `server/test/ccd-child-reclaim-hardening.test.ts:638`, `grep -n 'less the GIT_CONFIG_\* entries' server/test/ccd-child-reclaim-hardening.test.ts`

All of these lie below `ccd/ccd:19109`, so R56's length-neutral rule does not apply. The citation census (`session-hook.test.ts`) is re-run in Step 6 to confirm that.

**Files:**
- Modify: `ccd/ccd`. In `_ws_reclaim_contained`: the header lines, the paragraph that carried `GIT_CONFIG_PARAMETERS` forward, and the repository paragraph together with its `if` block, which moves ABOVE `local n=` and gains three names. Then re-stamp.
- Modify: `server/test/ccd-child-reclaim-hardening.test.ts`. Its one comment line (`:638`) that says the `GIT_CONFIG_*` entries are not pinned.
- Test: `server/test/ccd-child-reclaim-config-env.test.ts` (new, per R56)

**Interfaces:**
- Consumes: `_ws_reclaim_contained`, `_ws_reclaim_keep_reflogs <main> <id> [logfile…]` (rc 0 / rc 1 with `_WS_KEEP_WHY`), `makeCcdHarness(prefix)` (`sh(snippet, env)`, `makeRepo(name)`, `cleanup()`).
- Produces: `_ws_reclaim_contained cmd args…` keeps its signature and its status. What changes: the OUTERMOST call now unsets `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG` and `GIT_CONFIG_COUNT` (×4, as it already does for the repository-selecting list) before `local n="${GIT_CONFIG_COUNT:-0}"`. Beneath an outermost containment, `GIT_CONFIG_COUNT` is exactly 3, with `KEY_0=core.hooksPath`, `KEY_1=core.fsmonitor` and `KEY_2=status.showUntrackedFiles`. A nested containment still appends its three, making the count 6. Tasks 3, 8 and 9 rely on this environment.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-child-reclaim-config-env.test.ts`:

```ts
// Child reclamation wave 6, Task 1 (spec §5.6, F6): the OUTERMOST
// `_ws_reclaim_contained` unsets an inherited GIT_CONFIG_PARAMETERS,
// GIT_CONFIG and GIT_CONFIG_COUNT BEFORE it computes its own count, so its
// three pins are the only entries. Measured on git 2.43.0:
// GIT_CONFIG_PARAMETERS overrides the hooksPath pin; GIT_CONFIG redirects the
// containment's two `git config` reads (extensions.refStorage in
// `_ws_reclaim_keep_reflogs`, core.fileMode in the WIP commit); a caller's
// count carries entries to those same reads; and once the count is unset a
// stale KEY_<n>/VALUE_<n> does nothing. The variables reach ccd through the
// harness's explicit `env`, which the harness strip (Task 2) never touches.
// Every case runs in a fixture HOME; nothing here deletes anything.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let repo: string;
beforeEach(() => { h = makeCcdHarness('ccrc-child-reclaim-config-env-'); repo = h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

/** A config file that disagrees with the repository on every key the reads below ask. */
const altConfig = (): string => {
  const f = path.join(h.home, 'alt.gitconfig');
  fs.writeFileSync(f, '[extensions]\n\trefStorage = reftable\n[core]\n\tfileMode = false\n\thooksPath = /from-git-config\n');
  return f;
};
const PARAMETERS = (): Record<string, string> => ({
  GIT_CONFIG_PARAMETERS: "'core.hookspath'='/from-parameters' 'core.filemode'='false' 'extensions.refstorage'='reftable'",
});
const CONFIG_FILE = (): Record<string, string> => ({ GIT_CONFIG: altConfig() });
const COUNT = (): Record<string, string> => ({
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'extensions.refStorage', GIT_CONFIG_VALUE_0: 'reftable',
  GIT_CONFIG_KEY_1: 'core.fileMode', GIT_CONFIG_VALUE_1: 'false',
});
const INHERITED: Record<string, () => Record<string, string>> = {
  GIT_CONFIG_PARAMETERS: PARAMETERS,
  GIT_CONFIG: CONFIG_FILE,
  'GIT_CONFIG_COUNT and its entries': COUNT,
  'all three at once': () => ({ ...PARAMETERS(), ...CONFIG_FILE(), ...COUNT() }),
};

/** What a git beneath the containment inherits of the three, and the first entry. */
const SHOW = `bash -c 'printf "%s|%s|%s|%s=%s" "\${GIT_CONFIG_PARAMETERS-unset}" "\${GIT_CONFIG-unset}"`
  + ` "\${GIT_CONFIG_COUNT-unset}" "\${GIT_CONFIG_KEY_0-unset}" "\${GIT_CONFIG_VALUE_0-unset}"'`;

describe('F6: the outermost containment starts from no inherited config entry (spec §5.6)', () => {
  it.each(Object.keys(INHERITED))('inherited %s: the three pins are the only entries, and both config reads see the repository', (name) => {
    const env = INHERITED[name]!();
    expect(h.sh(`git -C "${repo}" config --bool --get core.fileMode`, env),
      'the CONTROL: uncontained, the inherited variable reaches the read').toBe('false');
    expect(h.sh(`_ws_reclaim_contained ${SHOW}`, env), 'what a git beneath the containment inherits')
      .toBe('unset|unset|3|core.hooksPath=/dev/null');
    expect(h.sh(`_ws_reclaim_contained git -C "${repo}" rev-parse --git-path hooks`, env), 'the hook pin').toBe('/dev/null');
    expect(h.sh(`_ws_reclaim_contained git -C "${repo}" config --bool --get core.fileMode`, env),
      'the WIP commit’s core.fileMode read').toBe('true');
    expect(h.sh(`_ws_reclaim_contained _ws_reclaim_keep_reflogs "${repo}" demo-f6; printf '%s|%s' "$?" "$_WS_KEEP_WHY"`, env),
      'the keep’s extensions.refStorage read').toBe('0|');
  }, 60_000);

  it('a stale GIT_CONFIG_KEY_<n>/VALUE_<n> past the count is inert — the count starts at 0', () => {
    const env = {
      GIT_CONFIG_COUNT: '4',
      GIT_CONFIG_KEY_0: 'ccrc.f6a', GIT_CONFIG_VALUE_0: '1', GIT_CONFIG_KEY_1: 'ccrc.f6b', GIT_CONFIG_VALUE_1: '1',
      GIT_CONFIG_KEY_2: 'ccrc.f6c', GIT_CONFIG_VALUE_2: '1', GIT_CONFIG_KEY_3: 'ccrc.f6stale', GIT_CONFIG_VALUE_3: 'live',
    };
    expect(h.sh(`git -C "${repo}" config --get ccrc.f6stale`, env), 'the CONTROL: the inherited entry is live').toBe('live');
    expect(h.sh(`_ws_reclaim_contained bash -c 'v=$(git -C "$0" config --get ccrc.f6stale); printf "%s|%s" "\${v:-absent}" "$GIT_CONFIG_COUNT"' "${repo}"`, env))
      .toBe('absent|3');
  }, 60_000);

  it('a NESTED containment appends its three to the outer’s three, and the outer’s pins hold after it returns', () => {
    const env = PARAMETERS();
    expect(h.sh(`inner() { _ws_reclaim_contained bash -c 'printf "%s|%s" "$GIT_CONFIG_COUNT" "\${GIT_CONFIG_PARAMETERS-unset}"'; };`
      + ' _ws_reclaim_contained inner', env)).toBe('6|unset');
    expect(h.sh(`outer() { _ws_reclaim_contained true; git -C "${repo}" rev-parse --git-path hooks; }; _ws_reclaim_contained outer`, env),
      'a nested containment took the outer’s count with it').toBe('/dev/null');
  }, 60_000);

  it('a caller’s LOCAL count is unset, never shadowed — and so is the exported one under it', () => {
    const env = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'ccrc.f6a', GIT_CONFIG_VALUE_0: '1', GIT_CONFIG_KEY_1: 'ccrc.f6b', GIT_CONFIG_VALUE_1: '1' };
    expect(h.sh(`shadow() { local -x GIT_CONFIG_COUNT=1; _ws_reclaim_contained bash -c 'printf "%s" "$GIT_CONFIG_COUNT"'; }; shadow`, env))
      .toBe('3');
  }, 60_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-config-env.test.ts)`

Expected: FAIL, 7 of 7. In every case, each CONTROL passes and the first subject assertion is the one that reds. If a CONTROL reds instead, the box's git does not honour the variable, so the fixture proves nothing: stop and report.
- `inherited GIT_CONFIG_PARAMETERS`: `expected ''core.hookspath'='/from-parameters' 'core.filemode'='false' 'extensions.refstorage'='reftable'|unset|3|core.hooksPath=/dev/null' to be 'unset|unset|3|core.hooksPath=/dev/null'`
- `inherited GIT_CONFIG`: `expected 'unset|<home>/alt.gitconfig|3|core.hooksPath=/dev/null' to be 'unset|unset|3|core.hooksPath=/dev/null'`
- `inherited GIT_CONFIG_COUNT and its entries`: `expected 'unset|unset|5|extensions.refStorage=reftable' to be 'unset|unset|3|core.hooksPath=/dev/null'`
- `inherited all three at once`: the same assertion, with all three fields wrong.
- `a stale GIT_CONFIG_KEY…`: `expected 'live|7' to be 'absent|3'`
- `a NESTED containment…`: `expected '6|'core.hookspath'=… to be '6|unset'`
- `a caller’s LOCAL count…`: `expected '4' to be '3'`

- [ ] **Step 3: Implement — move the outermost block above the count, add the three names, rewrite the comments**

In `ccd/ccd`, inside `_ws_reclaim_contained`, make these edits.

(a) Header. Replace:
```bash
  #                              repository-selecting variable;
  #                              answers cmd's status
  # WHAT THIS DOES TO GIT'S CONFIG — EXACTLY FOUR THINGS (and, outermost, it
  # drops the inherited variables that select a repository: the foot of this function). Three it DISABLES (the plan's Task
```
with:
```bash
  #                              repository-selecting variable, and no inherited config entry
  #                              (GIT_CONFIG_PARAMETERS, GIT_CONFIG, GIT_CONFIG_COUNT);
  #                              answers cmd's status
  # WHAT THIS DOES TO GIT'S CONFIG — EXACTLY FOUR THINGS (and, outermost and
  # FIRST, it drops the inherited variables that select a repository or carry
  # config: the block above the count, below). Three it DISABLES (the plan's Task
```

(b) Make the remainder of the function body, from the line `  # (\`_ws_reclaim_audit_contained\`). \`local -x\` scopes the export to this` down to the closing `}`, read exactly as follows. This is the old "EXCEPT GIT_CONFIG_PARAMETERS … carried to the next wave." paragraph rewritten, followed by the repository paragraph and its `if` block CUT from below `local -x GIT_OPTIONAL_LOCKS=0` and pasted above `local n=`. Inside the block, two sentences change and the `unset -v` gains three names. Every other line is unchanged.

```bash
  # (`_ws_reclaim_audit_contained`). `local -x` scopes the export to this
  # call. THE THREE PINS ARE THE ONLY ENTRIES (spec §5.6): an inherited
  # config variable outranked or redirected them (measured, git 2.43.0).
  # GIT_CONFIG_PARAMETERS, what `git -c` exports to its children, is applied
  # AFTER the GIT_CONFIG_COUNT entries, so it overrode every pin whose key it
  # named, the hook and fsmonitor pins included. GIT_CONFIG sends every `git
  # config` read to its own file, the two made beneath this function among
  # them (`_ws_reclaim_keep_reflogs`' extensions.refStorage, the WIP commit's
  # core.fileMode). And a caller's GIT_CONFIG_COUNT entries reached those same
  # reads. So the OUTERMOST containment unsets all three, in the block below,
  # BEFORE the count is computed: the count starts at 0. Once the count is
  # unset a stale GIT_CONFIG_KEY_<n>/VALUE_<n> is inert (measured), so those are
  # left. A caller's own `git -c` entries go with them; nothing a reclaim runs
  # wants one. A NESTED containment appends its three to the outer's three,
  # which are ccd's own. GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM name this
  # uid's own files, under the single-user trust model, and stay a stated
  # residual.
  # AND NO REPOSITORY BUT THE ONE EACH CALL NAMES (spec §5.5: nothing that is
  # not the child's is read, pinned or deleted). An inherited GIT_DIR,
  # GIT_WORK_TREE or GIT_INDEX_FILE — ccd started from a git hook, or by
  # anything that exported one — outranks every `git -C <dir>` beneath: the
  # ladder would read, and the pin commit, another repository or another
  # index. So do the rest of `git rev-parse --local-env-vars` (git 2.43's own
  # list of what selects a repository, its objects, refs and history): a
  # pre-receive quarantine exports GIT_OBJECT_DIRECTORY, and the WIP's objects
  # would land outside the child's repository. GIT_NAMESPACE, not on that
  # list, scopes every ref read and write, so it goes too. That list's three
  # config variables go with the rest (above). GIT_NO_REPLACE_OBJECTS is not
  # unset but SET (below). So the OUTERMOST containment unsets them all, and does not put
  # them back: nothing a reclaim runs wants its caller's repository, and a
  # restore would re-arm it for everything after. Unset, never shadowed —
  # measured, bash 5.2: a `local` of an exported name, set or unset, still
  # hands the global's value to every child; and unset repeatedly, since each
  # `unset` removes one scope's variable, a caller's local first. A NESTED
  # containment (`_WS_RECLAIM_CONTAINED`, set by the outer one, cleared at
  # load below so no environment can pre-set it) leaves them alone: inside,
  # they are ccd's own — the WIP commit hands the hidden-edit read its scratch
  # index as GIT_INDEX_FILE, and the count is the outer containment's.
  if [[ -z "${_WS_RECLAIM_CONTAINED:-}" ]]; then
    local _ws_u
    for _ws_u in 1 2 3 4; do
      unset -v GIT_CONFIG_PARAMETERS GIT_CONFIG GIT_CONFIG_COUNT \
        GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES \
        GIT_NAMESPACE GIT_IMPLICIT_WORK_TREE GIT_GRAFT_FILE GIT_REPLACE_REF_BASE GIT_PREFIX GIT_SHALLOW_FILE
    done
  fi
  local n="${GIT_CONFIG_COUNT:-0}"
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  local -x GIT_CONFIG_COUNT=$(( n + 3 )) \
    "GIT_CONFIG_KEY_$n=core.hooksPath" "GIT_CONFIG_VALUE_$n=/dev/null" \
    "GIT_CONFIG_KEY_$(( n + 1 ))=core.fsmonitor" "GIT_CONFIG_VALUE_$(( n + 1 ))=false" \
    "GIT_CONFIG_KEY_$(( n + 2 ))=status.showUntrackedFiles" "GIT_CONFIG_VALUE_$(( n + 2 ))=normal"
  # And no READ writes the user's index: `status` refreshes and rewrites it
  # opportunistically, under `index.lock`, and the pin phase, the ladder and
  # the audit all promise that file stays byte-identical.
  local -x GIT_OPTIONAL_LOCKS=0
  # And every read sees the REAL object graph: a replace ref substitutes one
  # commit's history for another's in every reachability read (rung 9's
  # count, `branch --contains`), so replacement is switched OFF, never merely
  # left to an inherited value.
  local -x GIT_NO_REPLACE_OBJECTS=1
  local _WS_RECLAIM_CONTAINED=1
  "$@"
}
```

Check after the edit:
- `grep -c 'carried to the next wave' ccd/ccd` prints `0`.
- `grep -c 'unset -v GIT_CONFIG_PARAMETERS GIT_CONFIG GIT_CONFIG_COUNT' ccd/ccd` prints `1`.
- `awk '/^_ws_reclaim_contained\(\) \{/,/^}/' ccd/ccd | grep -n 'unset -v GIT_CONFIG_PARAMETERS\|local n="\${GIT_CONFIG_COUNT'` shows the `unset` line BEFORE the `local n=` line.
- `unset -v _WS_RECLAIM_CONTAINED`, the line after the function, is unchanged.

(c) In `server/test/ccd-child-reclaim-hardening.test.ts`, replace the comment line
```ts
   *  --local-env-vars` on git 2.43 less the GIT_CONFIG_* entries, plus GIT_NAMESPACE. */
```
with
```ts
   *  --local-env-vars` on git 2.43 less the GIT_CONFIG_* entries (`ccd-child-reclaim-config-env.test.ts`
   *  pins those three, spec §5.6), plus GIT_NAMESPACE. */
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-config-env.test.ts)`

Expected: PASS, 7 of 7.

- [ ] **Step 5: Mutation check**

Apply each mutation alone, run `(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-config-env.test.ts)`, and revert it before the next. All of them come BEFORE the re-stamp in Step 6.

| # | Mutation (exact edit) | Case that reds | Expected red |
|---|---|---|---|
| 1 | Delete `GIT_CONFIG_PARAMETERS ` from the `unset -v` line | `inherited GIT_CONFIG_PARAMETERS`, `all three at once`, `a NESTED containment…` | `expected ''core.hookspath'='/from-parameters' …\|unset\|3\|core.hooksPath=/dev/null' to be 'unset\|unset\|3\|core.hooksPath=/dev/null'` |
| 2 | Delete `GIT_CONFIG ` (the bare name, not its siblings) from the `unset -v` line | `inherited GIT_CONFIG`, `all three at once` | `expected 'unset\|<home>/alt.gitconfig\|3\|core.hooksPath=/dev/null' to be …` |
| 3 | Delete `GIT_CONFIG_COUNT ` from the `unset -v` line | `inherited GIT_CONFIG_COUNT and its entries`, `a stale …`, `a caller’s LOCAL count…` | `expected 'unset\|unset\|5\|extensions.refStorage=reftable' to be …`; `expected 'live\|7' to be 'absent\|3'`; `expected '4' to be '3'` |
| 4 | Move the whole `if [[ -z "${_WS_RECLAIM_CONTAINED:-}" ]]; … fi` block back to just below the `local -x GIT_CONFIG_COUNT=…` statement (its names unchanged) | every case | Measured on bash 5.2.21: the `unset` makes the count's own `local` invisible, and an inherited count, where there is one, shows through. `inherited GIT_CONFIG_PARAMETERS` and `inherited GIT_CONFIG`: `expected 'unset\|unset\|unset\|core.hooksPath=/dev/null' to be 'unset\|unset\|3\|core.hooksPath=/dev/null'`. `inherited GIT_CONFIG_COUNT and its entries` and `all three at once`: `expected 'unset\|unset\|2\|extensions.refStorage=reftable' to be …`. `a stale …`: `expected 'live\|4' to be 'absent\|3'`. `a NESTED containment…`: `expected '3\|unset' to be '6\|unset'`. `a caller’s LOCAL count…`: `expected '1' to be '3'` (the caller's local shows through). In every case all three pins are lost |
| 5 | Take the three config names out of the guarded `unset -v`, and add `local _ws_c; for _ws_c in 1 2 3 4; do unset -v GIT_CONFIG_PARAMETERS GIT_CONFIG GIT_CONFIG_COUNT; done` unguarded, directly above `local n=` | `a NESTED containment…` | `expected '3\|unset' to be '6\|unset'`, and then (with the first assertion commented out) `expected '.git/hooks' to be '/dev/null'` |
| 6 | Change `for _ws_u in 1 2 3 4; do` to `for _ws_u in 1; do` | `a caller’s LOCAL count…` | `expected '5' to be '3'`: the caller's local went and the exported `2` showed through |

- [ ] **Step 6: Re-stamp `ccd/ccd`, then run the stamp gate and the suites the containment serves**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/ccd-child-reclaim-config-env.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-hardening.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pin.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts test/ccd-ws-expire-audit.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts)
```

Run each line in the FOREGROUND with a timeout of at least 600000 ms. Expected: `mark.mjs --check` exits 0, and every suite is green.
- `ccd-child-reclaim-hardening`'s containment describe stays green unchanged: its repository-variable cases ride the same unset loop.
- `ccd-ws-expire-*` stays green: F6 reaches `ws-expire` through this function, and its behaviour on a clean environment does not change.
- `session-hook.test.ts` is the citation census. Every edit here lies below `ccd/ccd:19109`, so it must stay green. A red means a cited anchor sits below that line after all: stop, and apply S6-R11 as R56 directs.

A known load flake in this list (`ccd-session-state`, `ccd-bounded-reads`; see CLAUDE.md) is re-run in isolation before anyone calls it a break.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-child-reclaim-config-env.test.ts server/test/ccd-child-reclaim-hardening.test.ts
git commit -m "$(cat <<'MSG'
fix(ccd): the outermost containment drops inherited git config variables

An inherited GIT_CONFIG_PARAMETERS overrode the containment's hooksPath
pin, GIT_CONFIG redirected its two config reads (extensions.refStorage
and core.fileMode), and a caller's GIT_CONFIG_COUNT entries reached those
same reads. The outermost containment now unsets all three before it
computes its own count, so its three pins are the only entries. A nested
containment still appends to the outer's. This reaches ws-expire too,
through the shared function. GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM stay
a stated residual.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The harness strip: `server/test/gitEnvStrip.ts`, at every `process.env` spread in the reclaim and expire fixtures

**Model routing:** `sonnet`, effort `high`. A mechanical sweep with one new helper, and one pin that sets `GIT_DIR`.

**Why:** Contract §12 R51, the harness strip. A runner started under a git hook, or by anything that exported `GIT_DIR`, hands another repository to every `...process.env` spread in the reclaim and expire suites. So does every git spawn there that names no `env`, because a spawn without options inherits `process.env` whole. Through either path, the fixtures would `init`, `add` and commit into that repository: `makeRepoAt`'s two `git init` calls, `looseCommits`' `fast-import`, the ladder, pin and reflog suites' seed repositories, and every `h.sh` that sources `ccd`.

One exported helper returns `process.env` minus three things: git's `--local-env-vars` list, `GIT_NAMESPACE`, and the `GIT_CONFIG_KEY_`/`VALUE_` entries. Two rules from R51 limit where it goes:
- It is NEVER put inside `ghContainedEnv`. That function's callers pass git variables on purpose: the containment CONTROLs in `ccd-child-reclaim-hardening.test.ts`, and Task 1's file.
- `ccdWsHelpers.ts` is touched only under R56's overlap rule. Its edit is four in-place substitutions (`:547`, `:560`, `:561`, `:586`) plus one import, and nothing else; the in-place edit is accepted (ruling f6.OPEN3). The coordinator tells workspace-lifecycle's coordinator (`ccrc-pwa-quiet-river`) before dispatch, and the worker names this file's in-place strip in the wave-done (ruling X2).

**What the strip does NOT do: a stated harness residual.** It makes the fixtures repository-clean, not HOME-clean. The 23 git spawns keep the runner's HOME, as they do today, so the runner's own global git config still applies to the repositories they create: an `init.templateDir` whose hooks are copied in, a global `core.hooksPath`, `commit.gpgsign`, a `url.<base>.insteadOf`. And because `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` are kept (they are not on git's list), a runner that exports either one outranks the fixture HOME's global config at every `h.sh` and `h.git` too. ccd's containment keeps those two for its own reason (they name this uid's own files, R51); in the harness the same two variables are a hole in "HOME is the single isolation boundary". R51 rules no HOME strip, so this task adds none. The worker names it in the wave-done as a harness residual.

**Sites** (at `77c11245a`; the line numbers are hints, and the scan in Step 1 re-measures them, so a site count that differs is reported, never retyped. Wave 5 (#290), already in the worker's tree, touches none of these files):
- The nine spreads, all spelled `...process.env, HOME:`:
  - `server/test/ccdWsHelpers.ts:547` (`gitEnv`) and `:586` (`sh`)
  - `server/test/childReclaimFixture.ts:239` (`looseCommits`)
  - `server/test/ccd-child-reclaim-hardening.test.ts:43` and `:736`
  - `server/test/ccd-child-reclaim-audit.test.ts:33`
  - `server/test/ccd-child-reclaim-pause.test.ts:44`
  - `server/test/ccd-ws-expire-reach.test.ts:18` and `:46`

  Find them all with `grep -n '\.\.\.process\.env' <file>`.
- The one whole-environment copy: `server/test/ccd-child-reclaim-entry.test.ts:114`, `cleanEnv`'s `Object.entries(process.env)`.
- The 23 env-less git spawns, each `execFileSync('git', [...])` with no options object:
  - `ccdWsHelpers.ts:560`, `:561` (`makeRepoAt`)
  - `ccd-child-reclaim-ladder.test.ts:421`, `:423`, `:428`, `:461`, `:473`, `:475`, `:480`, `:1465`, `:1467`, `:1472`
  - `ccd-child-reclaim-verb-reflogs.test.ts:768`, `:770`, `:775`
  - `ccd-child-reclaim-pin.test.ts:586`, `:588`, `:593`, `:1043`, `:1154`, `:1161`, `:1163`, `:1168`

  Find them with `grep -nE "execFileSync\('git', \[[^]]*\]\)" <file>`.

**Files:**
- Create: `server/test/gitEnvStrip.ts`
- Modify (import plus the sites above): `server/test/ccdWsHelpers.ts`, `server/test/childReclaimFixture.ts`, `server/test/ccd-child-reclaim-hardening.test.ts`, `server/test/ccd-child-reclaim-audit.test.ts`, `server/test/ccd-child-reclaim-pause.test.ts`, `server/test/ccd-ws-expire-reach.test.ts`, `server/test/ccd-child-reclaim-entry.test.ts`, `server/test/ccd-child-reclaim-ladder.test.ts`, `server/test/ccd-child-reclaim-verb-reflogs.test.ts`, `server/test/ccd-child-reclaim-pin.test.ts`
- Test: `server/test/git-env-strip.test.ts` (new)

**Interfaces:**
- Produces, in `server/test/gitEnvStrip.ts`:
  ```ts
  export const GIT_LOCAL_ENV_FLOOR: readonly string[];   // git 2.43's `git rev-parse --local-env-vars`
  export function gitLocalEnvVars(): readonly string[];    // this box's git, asked once with PATH alone
  export function inheritedEnv(): NodeJS.ProcessEnv;       // a COPY of process.env minus FLOOR ∪ live list, GIT_NAMESPACE, GIT_CONFIG_KEY_*/VALUE_*
  ```
  From this task on, every file matching the scan's `SCOPE` takes its inherited environment through `inheritedEnv()`. `SCOPE` is R51's reclaim and expire suites and fixtures (`ccd-child-reclaim-*.test.ts`, `ccd-ws-expire-*.test.ts`, `childReclaim*.ts`, `wsExpireFixture.ts`, `ccdWsHelpers.ts`), plus the four names Tasks 4, 5 and 7 create outside those patterns (`ccd-path-users.test.ts`, `pathUsersFixture.ts`, `ccd-leaf-remove.test.ts`, `ccd-child-tmproot-*.test.ts`). A case in the scan's describe pins that it names every new ccd suite and fixture Tasks 3–11 create. Task 12's two new tests spawn neither git nor ccd and lie outside it: `child-reclaim-done-at.test.ts`, and the pwa test, which is not in `server/test` at all.

  **What the scan proves, and no more.** In a `SCOPE` file, outside comment lines:
  - no line spreads `...process.env` or copies `entries(process.env)`;
  - every call spelled `execFileSync`, `execFile`, `spawnSync` or `spawn` on `'git'`, or `execSync` on a string that starts `git`, names `env:` inside its own parentheses and does not name `env: process.env`. The call is read to its MATCHING paren, so an options object with no `env:` is seen, and so is an argv split over lines.

  It does not see:
  - git reached through a variable command name or through a shell (`h.sh`, `bash -c 'git …'`). Those run under the environment the harness's `sh` and `gitEnv` build, which is stripped;
  - an `env:` that carries `process.env` under another name (`env: base` where `base` is `process.env`, or `Object.assign({}, process.env)`);
  - a parenthesis inside a string literal that unbalances the matcher;
  - any file outside `SCOPE`: `ccdPrHelpers.ts`, `lifecycleHelpers.ts` and the rest of `server/test`.

  The name `inheritedEnv()` is fixed (ruling X3, f6.OPEN2): every later task imports it under that name.
- Consumes: `makeCcdHarness(prefix)` (`sh`, `git`, `makeRepo`, `home`, `cleanup`).

- [ ] **Step 1: Write the failing test**

Create `server/test/git-env-strip.test.ts`:

```ts
// Child reclamation wave 6, Task 2 (spec §5.6): the reclaim and expire
// suites' ONE strip of git's inherited environment. A runner started under a
// git hook, or by anything that exported GIT_DIR, would hand every
// `...process.env` spread — and every spawn that names no env — another
// repository, and the fixtures would init, commit and reclaim THERE.
// `inheritedEnv()` is process.env minus git's `--local-env-vars` list,
// GIT_NAMESPACE and the GIT_CONFIG_KEY_<n>/VALUE_<n> entries. It is never put
// inside `ghContainedEnv`, whose callers pass git variables on purpose.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GIT_LOCAL_ENV_FLOOR, gitLocalEnvVars, inheritedEnv } from './gitEnvStrip.js';
import { makeCcdHarness } from './ccdWsHelpers.js';

/** Runs fn with `extra` laid over process.env, and puts process.env back whatever happens. */
const withEnv = <T>(extra: Record<string, string>, fn: () => T): T => {
  const saved = { ...process.env };
  Object.assign(process.env, extra);
  try { return fn(); } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
};

const PLANTED: Record<string, string> = {
  GIT_DIR: '/elsewhere/.git', GIT_WORK_TREE: '/elsewhere', GIT_INDEX_FILE: '/elsewhere/index',
  GIT_CONFIG: '/elsewhere/config', GIT_CONFIG_PARAMETERS: "'core.hookspath'='/elsewhere'", GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/elsewhere', GIT_CONFIG_KEY_7: 'x.y', GIT_CONFIG_VALUE_7: 'z',
  GIT_NAMESPACE: 'elsewhere', GIT_OBJECT_DIRECTORY: '/elsewhere/objects', GIT_NO_REPLACE_OBJECTS: '1',
};
/** Outside the ruled list — kept, so the strip is no wider than R51 says. */
const KEPT: Record<string, string> = { GIT_AUTHOR_NAME: 'T', GIT_CONFIG_GLOBAL: '/dev/null', CCRC_GIT_ENV_STRIP_KEEP: 'kept' };

describe('inheritedEnv (spec §5.6)', () => {
  it('drops git’s local list, GIT_NAMESPACE and every GIT_CONFIG_KEY_/VALUE_ entry — and nothing else', () => {
    const e = withEnv({ ...PLANTED, ...KEPT }, inheritedEnv);
    expect(Object.keys(e).filter((k) => k in PLANTED).sort(), 'a repository-selecting or config variable survived').toEqual([]);
    expect(Object.fromEntries(Object.keys(KEPT).map((k) => [k, e[k]])), 'a variable outside the list was dropped').toEqual(KEPT);
    expect(e['PATH']).toBe(process.env['PATH']);
  });

  it('drops every name this box’s git prints for `git rev-parse --local-env-vars`, and the 2.43 floor', () => {
    const live = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } })
      .split('\n').filter(Boolean);
    expect(live.length, 'the CONTROL: git answered').toBeGreaterThan(0);
    expect([...gitLocalEnvVars()].sort()).toEqual([...live].sort());
    const names = [...new Set([...live, ...GIT_LOCAL_ENV_FLOOR])];
    const e = withEnv(Object.fromEntries(names.map((n) => [n, 'planted'])), inheritedEnv);
    expect(names.filter((n) => n in e)).toEqual([]);
  });

  it('answers a copy — writing it never writes process.env', () => {
    const e = inheritedEnv();
    e['CCRC_GIT_ENV_STRIP_WRITE'] = '1';
    expect(process.env['CCRC_GIT_ENV_STRIP_WRITE']).toBeUndefined();
  });
});

describe('the harness drops an inherited GIT_DIR (spec §5.6’s pin)', () => {
  it('a GIT_DIR in the runner’s environment reaches neither ccd nor the fixture’s repositories', () => {
    const h = makeCcdHarness('ccrc-git-env-strip-');
    try {
      // The decoy lives inside the fixture HOME: a repository the variables point at, never a real one.
      const decoy = path.join(h.home, 'decoy');
      h.git(h.home, 'init', '-q', '-b', 'main', decoy);
      const decoyGit = path.join(decoy, '.git');
      withEnv({ GIT_DIR: decoyGit, GIT_WORK_TREE: decoy, GIT_CONFIG_PARAMETERS: "'core.hookspath'='/from-parameters'" }, () => {
        expect(h.sh('printf "%s|%s|%s" "${GIT_DIR-unset}" "${GIT_WORK_TREE-unset}" "${GIT_CONFIG_PARAMETERS-unset}"'),
          'what ccd inherits').toBe('unset|unset|unset');
        const main = h.makeRepo('demo');
        expect(h.git(main, 'rev-parse', '--absolute-git-dir'), 'the fixture repository is its own').toBe(path.join(main, '.git'));
        expect(h.git(main, 'log', '--format=%s'), 'its commit landed in it').toBe('init');
      });
      expect(h.git(decoy, 'rev-list', '--all', '--count'), 'the decoy holds no commit').toBe('0');
    } finally { h.cleanup(); }
  }, 60_000);
});

describe('every reclaim and expire suite takes its environment through the strip', () => {
  /** The suites and fixtures R51 names: the reclaim and expire ccd suites, their fixtures, and the base harness. */
  const SCOPE = /^(ccd-child-reclaim-.*\.test\.ts|ccd-child-tmproot-.*\.test\.ts|ccd-path-users\.test\.ts|ccd-leaf-remove\.test\.ts|ccd-ws-expire-.*\.test\.ts|childReclaim[A-Za-z]*\.ts|pathUsersFixture\.ts|wsExpireFixture\.ts|ccdWsHelpers\.ts)$/;
  // ...and the ccd suites and the fixture that Tasks 4, 5 and 7 add under names
  // those patterns miss: `ccd-path-users`, `pathUsersFixture`, `ccd-leaf-remove`
  // and `ccd-child-tmproot-*`.
  /** A spread or a whole-environment copy: one line shows it. */
  const SPREAD = /\.\.\.process\.env\b|entries\(process\.env\)/;
  /** A git spawn, in any of node's spellings. Each call is read to its MATCHING
   *  paren, so an options object with no `env:` is seen, and so is an argv split
   *  over lines; `env: process.env` is no strip either. */
  const GIT_SPAWN = /\b(?:execFileSync|spawnSync|execFile|spawn)\(\s*'git'|\bexecSync\(\s*[`'"]git\b/g;
  const hitsIn = (f: string, src: string): string[] => {
    const hits: string[] = [];
    src.split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      if (SPREAD.test(l)) hits.push(`${f}:${i + 1}: ${l.trim()}`);
    });
    for (const m of src.matchAll(GIT_SPAWN)) {
      const at = m.index!;
      if (/^\s*(\/\/|\*)/.test(src.slice(src.lastIndexOf('\n', at) + 1, at))) continue;
      let i = at + m[0].length, d = 1;
      while (d && i < src.length) { const c = src[i++]; d += c === '(' ? 1 : c === ')' ? -1 : 0; }
      const call = src.slice(at, i);
      if (!/\benv\s*:/.test(call) || /\benv\s*:\s*process\.env\b/.test(call)) {
        hits.push(`${f}:${src.slice(0, at).split('\n').length}: ${call.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    return hits;
  };

  it('SCOPE names every new ccd suite and fixture Tasks 3–11 create — before any of them exists', () => {
    const later = [
      'ccd-child-reclaim-tail-contained.test.ts', 'ccd-path-users.test.ts', 'pathUsersFixture.ts', 'ccd-leaf-remove.test.ts',
      'ccd-child-reclaim-tmproot-wait.test.ts', 'ccd-child-tmproot-witness.test.ts', 'ccd-child-reclaim-gone-branch.test.ts',
      'ccd-child-reclaim-recovery.test.ts', 'ccd-child-reclaim-unmeasured-journal.test.ts', 'ccd-child-reclaim-prelock-journal.test.ts',
    ];
    expect(later.filter((f) => !SCOPE.test(f)), 'a later task’s file the scan would never read').toEqual([]);
  });

  it('CONTROL: the matcher flags each spelling, over lines too, and passes a stripped spawn and a comment', () => {
    const planted = [
      "execFileSync('git', ['init', dir]);",                     // 1: no options
      "execFileSync('git', ['status'], { encoding: 'utf8' });", // 2: options, no env
      "execFileSync('git', [",                                  // 3: an argv over two lines
      "  'init', dir]);",
      "spawnSync('git', ['status'], { env: process.env });",    // 5: the whole environment, by name
      'execSync(`git -C ${dir} status`);',                      // 6: a shell string
      'const e = { ...process.env, HOME: h };',                 // 7: a spread
      "execFileSync('git', ['init', dir], { env: inheritedEnv() });",
      "execFileSync('git', ['init', dir], {\n  encoding: 'utf8',\n  env: { ...inheritedEnv(), HOME: h },\n});",
      "  // execFileSync('git', ['init', dir]);",                // 13: a comment
    ].join('\n');
    expect(hitsIn('planted', planted)).toEqual([
      'planted:7: const e = { ...process.env, HOME: h };',
      "planted:1: execFileSync('git', ['init', dir])",
      "planted:2: execFileSync('git', ['status'], { encoding: 'utf8' })",
      "planted:3: execFileSync('git', [ 'init', dir])",
      "planted:5: spawnSync('git', ['status'], { env: process.env })",
      'planted:6: execSync(`git -C ${dir} status`)',
    ]);
  });

  it('no `...process.env` spread, no `entries(process.env)`, and no git spawn that names no env', () => {
    const files = fs.readdirSync(__dirname).filter((f) => SCOPE.test(f)).sort();
    expect(files, 'the CONTROL: the scope finds the suites')
      .toEqual(expect.arrayContaining(['ccdWsHelpers.ts', 'childReclaimFixture.ts', 'ccd-child-reclaim-hardening.test.ts', 'ccd-ws-expire-reach.test.ts']));
    const hits = files.flatMap((f) => hitsIn(f, fs.readFileSync(path.join(__dirname, f), 'utf8')));
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd server && ./node_modules/.bin/vitest run test/git-env-strip.test.ts)`

Expected: FAIL. The file does not load, because vitest reports `Failed to load url ./gitEnvStrip.js` and no case runs.

- [ ] **Step 3: Create the helper, and watch the harness pin and the scan red**

Create `server/test/gitEnvStrip.ts`:

```ts
// The reclaim and expire suites' ONE strip of git's inherited environment
// (child-reclamation spec §5.6). Spread `inheritedEnv()` wherever a
// fixture would spread `process.env`, and hand it to every git spawn that would
// otherwise name no env: an inherited GIT_DIR, GIT_WORK_TREE or
// GIT_INDEX_FILE (a runner started under a git hook) outranks every
// `git -C <dir>`, so the fixture would init, commit and reclaim in ANOTHER
// repository. NEVER put this inside `ghContainedEnv`: its callers pass git
// variables to ccd on purpose (the containment CONTROLs), and only the
// INHERITED environment is stripped. GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM
// are not on git's list and are kept (R51: a stated residual).
// The strip is repository-clean, not HOME-clean. A git spawn handed
// `inheritedEnv()` keeps the runner's HOME, so the runner's own global git
// config (init.templateDir, core.hooksPath, commit.gpgsign, url.insteadOf)
// still reaches the repository it makes; and a kept GIT_CONFIG_GLOBAL or
// GIT_CONFIG_SYSTEM outranks a fixture HOME's global config at every `h.sh`
// and `h.git` too. A stated harness residual.
import { execFileSync } from 'node:child_process';

/** `git rev-parse --local-env-vars` on git 2.43.0, the fleet box's git: the
 *  floor, so an older git that prints fewer names strips no less. */
export const GIT_LOCAL_ENV_FLOOR: readonly string[] = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
];

let live: readonly string[] | undefined;
/** What THIS box's git calls local — asked once, with PATH alone, so an
 *  inherited GIT_DIR cannot change the answer (it needs no repository). */
export function gitLocalEnvVars(): readonly string[] {
  if (live === undefined) {
    live = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } })
      .split('\n').filter(Boolean);
  }
  return live;
}

/** A COPY of process.env minus git's local list (the floor and this box's),
 *  GIT_NAMESPACE (not on the list; it scopes every ref read and write) and every
 *  GIT_CONFIG_KEY_<n>/GIT_CONFIG_VALUE_<n> entry. */
export function inheritedEnv(): NodeJS.ProcessEnv {
  const drop = new Set([...GIT_LOCAL_ENV_FLOOR, ...gitLocalEnvVars(), 'GIT_NAMESPACE']);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (drop.has(k) || k.startsWith('GIT_CONFIG_KEY_') || k.startsWith('GIT_CONFIG_VALUE_')) continue;
    env[k] = v;
  }
  return env;
}
```

Run: `(cd server && ./node_modules/.bin/vitest run test/git-env-strip.test.ts)`

Expected: 5 pass and 2 fail.
- `inheritedEnv` × 3, `SCOPE names every new ccd suite…` and the matcher's `CONTROL`: PASS.
- `the harness drops an inherited GIT_DIR`: `what ccd inherits: expected '<home>/decoy/.git|<home>/decoy|'core.hookspath'='/from-parameters'' to be 'unset|unset|unset'`.
- The scan: `expected [ …(33) ] to deeply equal []`. The 33 hits are the 9 spreads and the 1 `entries(process.env)` that the line check sees, and the 23 env-less git spawns that the paren-matched check sees, all named under **Sites**. This was measured at `77c11245a` with this file's `hitsIn` over the widened `SCOPE`: the four names Tasks 4, 5 and 7 add match no file yet, and no other git spawn in `SCOPE` lacks an `env:`. If the count differs, a merge since `77c11245a` touched these files (wave 5, #290, touches none of them, so it is not the cause): wire every hit it lists, and name the difference in the wave-done.

- [ ] **Step 4: Wire the strip at every site**

From the repository root:

```bash
cd server/test
# The nine spreads: one spelling everywhere.
sed -i 's/\.\.\.process\.env, HOME:/...inheritedEnv(), HOME:/' \
  ccdWsHelpers.ts childReclaimFixture.ts ccd-child-reclaim-hardening.test.ts ccd-child-reclaim-audit.test.ts \
  ccd-child-reclaim-pause.test.ts ccd-ws-expire-reach.test.ts
# The 23 env-less git spawns: give each the stripped environment and nothing else. HOME stays the runner's, as today, and so does its global git config: a stated harness residual (see Why).
sed -i -E "s/execFileSync\('git', (\[[^]]*\])\)/execFileSync('git', \1, { env: inheritedEnv() })/" \
  ccdWsHelpers.ts ccd-child-reclaim-ladder.test.ts ccd-child-reclaim-verb-reflogs.test.ts ccd-child-reclaim-pin.test.ts
# cleanEnv in the entry suite.
sed -i 's/for (const \[k, v\] of Object.entries(process.env)) {/for (const [k, v] of Object.entries(inheritedEnv())) {/' \
  ccd-child-reclaim-entry.test.ts
cd ../..
```

Then add `import { inheritedEnv } from './gitEnvStrip.js';` to each of these ten files, beside its other `./…js` imports:
- `ccdWsHelpers.ts` (after `import { asManagerCalls } from './platformFixtures.js';`)
- `childReclaimFixture.ts`
- `ccd-child-reclaim-hardening.test.ts`
- `ccd-child-reclaim-audit.test.ts`
- `ccd-child-reclaim-pause.test.ts`
- `ccd-ws-expire-reach.test.ts`
- `ccd-child-reclaim-entry.test.ts`
- `ccd-child-reclaim-ladder.test.ts`
- `ccd-child-reclaim-verb-reflogs.test.ts`
- `ccd-child-reclaim-pin.test.ts`

Check the edits:
- `git diff --stat -- server/test` lists exactly those ten files, plus the two new ones once they are added.
- `grep -c 'inheritedEnv()' server/test/ccdWsHelpers.ts` prints `4`: `gitEnv`, the two `git init` calls and `sh`.
- `grep -n 'ghContainedEnv(' server/test/gitEnvStrip.ts` prints nothing.
- `ghContainedEnv`'s own body is untouched.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
(cd server && ./node_modules/.bin/vitest run test/git-env-strip.test.ts test/typecheck-tests.test.ts test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-hardening.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-entry.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts test/ccd-child-reclaim-pause.test.ts test/ccd-ws-expire-reach.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pin.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-reflogs.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts)
```

Run each line in the FOREGROUND with a timeout of at least 600000 ms. Expected: PASS everywhere.
- `git-env-strip` passes 7 of 7.
- The containment CONTROLs in `ccd-child-reclaim-hardening` stay green, because they pass their git variables through `sh`'s explicit `env`, which is laid over the strip.
- `ccd-workspaces` is a heavy consumer of the base harness's `makeRepo`/`sh`, run once to show the substitution in `ccdWsHelpers.ts` changes nothing on a clean runner.

- [ ] **Step 6: Mutation check**

Apply each alone, run `(cd server && ./node_modules/.bin/vitest run test/git-env-strip.test.ts)`, then revert.

| # | Mutation (exact edit) | Case that reds | Expected red |
|---|---|---|---|
| 1 | In `inheritedEnv`, delete `, 'GIT_NAMESPACE'` from the `drop` set | `drops git’s local list…` | `a repository-selecting or config variable survived: expected [ 'GIT_NAMESPACE' ] to deeply equal []` |
| 2 | Delete ` \|\| k.startsWith('GIT_CONFIG_KEY_') \|\| k.startsWith('GIT_CONFIG_VALUE_')` | `drops git’s local list…` | `expected [ 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_KEY_7', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_VALUE_7' ] to deeply equal []` |
| 3 | Replace `[...GIT_LOCAL_ENV_FLOOR, ...gitLocalEnvVars(), 'GIT_NAMESPACE']` with `['GIT_NAMESPACE']` | `drops git’s local list…`, `drops every name…` | the first lists the nine planted names off git's list (`GIT_CONFIG`, …, `GIT_WORK_TREE`); the second lists all fifteen |
| 4 | Add `if (k === 'GIT_CONFIG_GLOBAL') continue;` as the loop's first line | `drops git’s local list…` | `a variable outside the list was dropped`: the diff shows `GIT_CONFIG_GLOBAL: undefined` |
| 5 | In `ccdWsHelpers.ts`'s `sh:`, change `...inheritedEnv(), HOME: home, ...env` back to `...process.env, HOME: home, ...env` | harness pin and scan | `what ccd inherits: expected '<home>/decoy/.git\|<home>/decoy\|'core.hookspath'='/from-parameters'' to be 'unset\|unset\|unset'`; the scan lists `ccdWsHelpers.ts:<n>: env: ghContainedEnv(home, { ...process.env, …` |
| 6 | In `makeRepoAt`, drop `, { env: inheritedEnv() }` from `execFileSync('git', ['init', '-b', 'main', main], …)` | harness pin and scan | `h.makeRepo('demo')` throws `Command failed: git -C <home>/projects/demo add README.md` (the init went to the decoy, so `demo` holds no `.git`; the exact git wording may differ, but the case reds inside `makeRepo`); the scan lists that line |
| 7 | In `ccd-child-reclaim-pin.test.ts`, drop `, { env: inheritedEnv() }` from the `--object-format=sha256` init | scan | `expected [ 'ccd-child-reclaim-pin.test.ts:<n>: execFileSync(\'git\', [\'init\', \'-q\', \'--object-format=sha256\', sha256Repo])' ] to deeply equal []` |
| 8 | Add the line `execFileSync('git', ['status'], { encoding: 'utf8' });` as the last line of `childReclaimFixture.ts` (the scan reads text, so it need not compile) | scan | `expected [ 'childReclaimFixture.ts:<n>: execFileSync(\'git\', [\'status\'], { encoding: \'utf8\' })' ] to deeply equal []`: an options object with no `env:` |
| 9 | In `ccd-child-reclaim-ladder.test.ts`, replace the first `execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin], { env: inheritedEnv() })` with the same argv over three lines and no options: `execFileSync('git', [⏎    'init', '--bare', '-q', '-b', 'main', origin,⏎  ])` (⏎ marks a line break) | scan | `expected [ 'ccd-child-reclaim-ladder.test.ts:<n>: execFileSync(\'git\', [ \'init\', \'--bare\', \'-q\', \'-b\', \'main\', origin, ])' ] to deeply equal []`: an argv split over lines |
| 10 | In `ccd-child-reclaim-pin.test.ts`, replace the `--object-format=sha256` init's `{ env: inheritedEnv() }` with `{ env: process.env }` | scan | `expected [ 'ccd-child-reclaim-pin.test.ts:<n>: execFileSync(\'git\', [\'init\', \'-q\', \'--object-format=sha256\', sha256Repo], { env: process.env })' ] to deeply equal []` |
| 11 | In `hitsIn`, delete ` \|\| /\benv\s*:\s*process\.env\b/.test(call)` | `CONTROL: the matcher flags…` | the received array lacks `planted:5: spawnSync('git', ['status'], { env: process.env })` |
| 12 | In `hitsIn`, delete the line `if (/^\s*(\/\/\|\*)/.test(src.slice(src.lastIndexOf('\n', at) + 1, at))) continue;` | `CONTROL: the matcher flags…` | the received array gains `planted:13: execFileSync('git', ['init', dir])`: a comment was read as a call |
| 13 | In `SCOPE`, delete `\|ccd-path-users\.test\.ts` | `SCOPE names every new ccd suite…` | `a later task’s file the scan would never read: expected [ 'ccd-path-users.test.ts' ] to deeply equal []` |

- [ ] **Step 7: Commit**

```bash
git add server/test/gitEnvStrip.ts server/test/git-env-strip.test.ts server/test/ccdWsHelpers.ts \
  server/test/childReclaimFixture.ts server/test/ccd-child-reclaim-hardening.test.ts server/test/ccd-child-reclaim-audit.test.ts \
  server/test/ccd-child-reclaim-pause.test.ts server/test/ccd-ws-expire-reach.test.ts server/test/ccd-child-reclaim-entry.test.ts \
  server/test/ccd-child-reclaim-ladder.test.ts server/test/ccd-child-reclaim-verb-reflogs.test.ts server/test/ccd-child-reclaim-pin.test.ts
git commit -m "$(cat <<'MSG'
test(harness): one strip of git's inherited environment for the reclaim and expire suites

inheritedEnv() is process.env minus git's --local-env-vars list,
GIT_NAMESPACE and the GIT_CONFIG_KEY_/VALUE_ entries. The reclaim and
expire fixtures and the base harness now take it at every process.env
spread, in the entry suite's cleanEnv, and in every git spawn that named
no env. A runner started under a git hook therefore no longer hands its
GIT_DIR to ccd or to the fixture repositories. It is not put inside
ghContainedEnv, whose callers pass git variables on purpose. A pin sets
GIT_DIR and shows the harness drops it, and a scan keeps every such site
behind the strip: every spread, and every git spawn, read to its matching
paren, that names no env or names process.env. The strip is
repository-clean, not HOME-clean: the fixture git spawns keep the
runner's HOME and so its global git config, a stated harness residual.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The tail's destructive git calls run contained

**Model routing:** **`opus`, effort `high`**. This is SAFETY-critical: every deleting git call `ws-reclaim` makes, and `ws-expire` through the same tail.

**Why:** This is the last bullet of contract §12 R49. The pin phase, the ladder and the audit run under `_ws_reclaim_contained`. The tail's deletions do not: `git -C "$main" worktree remove [--force]` and `git -C "$main" update-ref -d`, for each nested checkout and for the child itself. I re-measured on git 2.43.0 in a scratch repository with a `core.fsmonitor` program and `post-index-change`/`reference-transaction` hooks:
- `update-ref -d` runs `reference-transaction` (aborted, prepared, committed).
- `worktree remove` with no force flag, on a tree that stands, runs the fsmonitor program four times and `post-index-change` once.
- `worktree remove --force` on a standing tree, and `worktree remove` on a missing directory, run nothing.

Behaviourally, then, only the two `update-ref -d` sites fire a hook in ordinary fixtures. The two no-force sites fire one only if a tree reappears inside a race. So the guard is three things together:
- a hook-run case for each tail arm, plus one for `ws-expire`;
- a `git` FUNCTION shim that records, for every destructive call the tail makes, the `core.hooksPath` and `core.fsmonitor` git would use for it, read by the real git under the same environment. This reds for every one of the six sites, whichever of them a hook can see;
- a text scan of the tail's body.

The tail is in the RECLAIM region, and `ws-expire` calls the same `_ws_reclaim_tail` (`ccd/ccd:29301`). So this change reaches `ws-expire` with no edit in the EXPIRE region. The coordinator tells workspace-lifecycle's coordinator (`ccrc-pwa-quiet-river`) before dispatch, and the worker names the contained tail in the wave-done as a change in shared code that `ws-expire` also runs (ruling X2).

**Anchors** (`ccd/ccd` at `77c11245a`; the line numbers are hints, so locate by content. Wave 5 (#290), already in the worker's tree, does not touch `ccd/ccd`):
- `_ws_reclaim_tail() {`: `:27962`, `grep -n '^_ws_reclaim_tail() {' ccd/ccd`
- `# (1) UNSUPERVISE AND KILL THE PANE`: `:27980`
- the six sites, found by `grep -nE 'git -C "\$main" (worktree remove|update-ref -d)' ccd/ccd`, each in `_ws_reclaim_tail`:
  - `:28222`: the nested checkout that stands, `worktree remove --force "$cpath"`
  - `:28232`: the nested line counted gone with git's record standing, `worktree remove "$cpath"`
  - `:28262`: the nested branch CAS, `update-ref -d "refs/heads/$cbr" "$chead"`
  - `:28300`: step (4), the child's tree, `worktree remove --force "$workdir"`
  - `:28344`: step (5), a vanished tree's record, `worktree remove "$workdir"`
  - `:28373`: step (5), the branch CAS, `update-ref -d "refs/heads/$branch" "$tip"`

Every line is below `:19109`, and the comment insertion is too.

**Files:**
- Modify: `ccd/ccd`. Prefix `_ws_reclaim_contained ` to the six calls, give the two branch CASes `--no-deref` (ruling S2-2, defence in depth), and add one comment paragraph above `# (1) UNSUPERVISE AND KILL THE PANE`. Then re-stamp.
- Test: `server/test/ccd-child-reclaim-tail-contained.test.ts` (new, per R56)

**Interfaces:**
- Consumes:
  - Task 1's `_ws_reclaim_contained`: three pins only, and the count starts at 0.
  - From `childReclaimFixture.ts`: `CHILD_BRANCH`, `CHILD_ID`, `CHILD_STUBS`, `childReclaimVerb(h, token, { pre })`, `hookRuns(h)`, `makeChild(h)` and `plantRepoPrograms(h, c)`.
  - From `childReclaimVerbHelpers.ts`: `verbHelpers(() => h)`, for `interrupted(c, phase)` and `resumeToken(phase)`.
  - From `wsExpireFixture.ts`: `EXP_BRANCH`, `EXP_ID`, `expireToken(h)`, `expireVerb(h, token)` and `makeArchived(h)`.
  - From `ccdWsHelpers.ts`: `CCD`.
- Produces: every destructive git call in `_ws_reclaim_tail` is spelled `_ws_reclaim_contained git -C "$main" …`. Task 5's removal helper and Tasks 6, 8 and 9 add code to this tail. Any `git … worktree remove|prune`, `update-ref -d` or `branch -d|-D` they add there must be contained too, or this task's scan reds.
- The scan pins the tail's destructive-call count at exactly 6. Any later task that adds or moves a destructive git call in the tail re-pins that count in its own commit, together with the shim's `SEEN` row for each arm that reaches the call and Step 3's `grep -c` check (ruling X3, f6.OPEN5). As drafted, Tasks 5–9 add none: Tasks 4–7 put their functions ABOVE `_ws_reclaim_tail() {`, outside the scan's slice; Task 5's new step (6) removes through `_ws_leaf_remove`, not git; Task 8 replaces step (5)'s `show-ref` test and leaves the contained `update-ref -d` line unchanged; and Task 9 edits `_ws_reclaim_workdir_shared`, outside the tail, and is ruled never to run `git worktree prune`.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-child-reclaim-tail-contained.test.ts`:

```ts
// Child reclamation wave 6, Task 3 (spec §5.6, last bullet): the TAIL's
// destructive git calls — `git worktree remove` and `update-ref -d`, for each
// nested checkout and for the child — run under `_ws_reclaim_contained`, so no
// program the repository names runs while ccd deletes. Measured uncontained
// (git 2.43): `update-ref -d` runs reference-transaction, and `worktree remove`
// with no force flag on a standing tree runs core.fsmonitor and
// post-index-change. `ws-expire` runs the same tail. Every case builds its
// workspace in a fixture HOME and runs the sourced verb with the unit and pane
// calls RECORDED, never made.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import {
  CHILD_BRANCH, CHILD_ID, CHILD_STUBS, childReclaimVerb, hookRuns, makeChild, plantRepoPrograms, type Child,
} from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { EXP_BRANCH, EXP_ID, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-tail-contained-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken } = verbHelpers(() => h);

const runsFile = (): string => path.join(h.home, 'hook-runs');
/** The ladder's token, minted CONTAINED: `evalOf` runs `_ws_reclaim_eval`
 *  bare, and its uncontained `git status` would run the planted programs
 *  before the subject ever does. */
const containedToken = (): string =>
  h.sh(`${CHILD_STUBS} _ws_reclaim_contained _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null; printf '%s' "$REAP_TOKEN"`);
/** A commit only `ws/parked` holds, on a checkout at `at` that git records —
 *  `ccd-child-reclaim-verb-tail.test.ts`'s own shape for a gone nested line. */
const parkedCommit = (c: Child, at: string): string => {
  h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/parked', at);
  fs.writeFileSync(path.join(at, 'p.txt'), 'parked\n');
  h.git(at, 'add', 'p.txt'); h.git(at, 'commit', '-q', '-m', 'parked unique');
  return h.git(at, 'rev-parse', 'HEAD');
};

interface Built { c: Child; tok: string; gone: string[] }
/** The tail's three arms, each reaching a different set of the six sites. `plant`
 *  plants the repository's programs AFTER every setup git call that would run them. */
const ARMS: Record<string, (plant: boolean) => Built> = {
  // :28222 (nested --force), :28262 (nested CAS), :28300 (tree --force), :28373 (branch CAS)
  'a fresh reclaim with a nested checkout': (plant) => {
    const c = makeChild(h);
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', path.join(c.wt, 'inner'));
    if (plant) plantRepoPrograms(h, c);
    return { c, tok: containedToken(), gone: [CHILD_BRANCH, 'ws/nested'] };
  },
  // :28344 (the vanished tree's record), :28373
  'a vanished tree whose record git still keeps': (plant) => {
    const c = makeChild(h);
    if (plant) plantRepoPrograms(h, c);
    fs.rmSync(c.wt, { recursive: true, force: true });
    return { c, tok: containedToken(), gone: [CHILD_BRANCH] };
  },
  // :28232 (gone nested line, record standing), :28262, :28344, :28373
  'a resume at children whose nested line is gone, its record standing': (plant) => {
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    const sha = parkedCommit(c, ghost);
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tws/parked\t${sha}`] })}'`);
    if (plant) plantRepoPrograms(h, c);
    fs.rmSync(c.wt, { recursive: true, force: true });
    return { c, tok, gone: [CHILD_BRANCH, 'ws/parked'] };
  },
};

describe('the tail runs none of the repository’s programs while it deletes (spec §5.6)', () => {
  it.each(Object.keys(ARMS))('%s', (arm) => {
    const { c, tok, gone } = ARMS[arm]!(true);
    fs.rmSync(runsFile(), { force: true });
    const r = childReclaimVerb(h, tok);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    for (const b of gone) expect(h.git(c.main, 'branch', '--list', b), `${b} was deleted`).toBe('');
    expect(hookRuns(h), 'a program the repository names ran inside the tail').toEqual([]);
    // The CONTROL, after the subject: the planted hook is live for an uncontained ref delete.
    h.git(c.main, 'branch', 'ws/control', 'HEAD');
    fs.rmSync(runsFile(), { force: true });
    h.sh(`git -C "${c.main}" update-ref -d refs/heads/ws/control`);
    expect(hookRuns(h), 'the CONTROL: an uncontained update-ref -d runs reference-transaction').toContain('reference-transaction');
  }, 120_000);

  it('ws-expire’s tail too — it is the same function', () => {
    const a = makeArchived(h);
    plantRepoPrograms(h, a);
    const tok = expireToken(h);
    fs.rmSync(runsFile(), { force: true });
    const r = expireVerb(h, tok);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).expired).toBe(EXP_ID);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the branch was deleted').toBe('');
    expect(hookRuns(h), 'a program the repository names ran inside ws-expire’s tail').toEqual([]);
  }, 120_000);
});

describe('every destructive git call the tail makes carries the pins (spec §5.6)', () => {
  /** A `git` FUNCTION — bash resolves functions before PATH, and
   *  `_ws_reclaim_contained` runs "$@" — that records, for each destructive
   *  call, the hooks path and fsmonitor git would use for it (read by the real
   *  git under the SAME environment), then runs the real git. A site hook-silent
   *  in a fixture (a forced remove, a remove of a missing tree) is measured too. */
  const SHIM = 'git() { if [[ "$1" == -C && ( "$3 $4" == "worktree remove" || "$3 $4" == "update-ref -d" ) ]]; then'
    + ' local l="$3 $4"; [[ " $* " == *" --force "* ]] && l+=" --force";'
    + ' printf "%s\\t%s\\t%s\\n" "$l" "$(command git -C "$2" config --get core.hooksPath || echo unset)"'
    + ' "$(command git -C "$2" config --get core.fsmonitor || echo unset)" >> "$HOME/destructive-git"; fi;'
    + ' command git "$@"; };';
  const SEEN: Record<string, string[]> = {
    'a fresh reclaim with a nested checkout': ['update-ref -d', 'update-ref -d', 'worktree remove --force', 'worktree remove --force'],
    'a vanished tree whose record git still keeps': ['update-ref -d', 'worktree remove'],
    'a resume at children whose nested line is gone, its record standing': ['update-ref -d', 'update-ref -d', 'worktree remove', 'worktree remove'],
  };
  it.each(Object.keys(ARMS))('%s', (arm) => {
    const { tok } = ARMS[arm]!(false);
    const r = childReclaimVerb(h, tok, { pre: SHIM });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const f = path.join(h.home, 'destructive-git');
    const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
    expect(lines.map((l) => l.split('\t')[0]).sort(), 'the arm reached the sites it names').toEqual(SEEN[arm]);
    expect(lines.filter((l) => !l.endsWith('\t/dev/null\tfalse')), 'a destructive git call ran uncontained').toEqual([]);
  }, 120_000);
});

describe('the tail spells every destructive git call contained', () => {
  it('six calls, each `_ws_reclaim_contained git -C "$main" …`, and no uncontained one', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const tail = src.slice(src.indexOf('\n_ws_reclaim_tail() {'), src.indexOf('\ncmd_ws_reclaim() {'));
    expect(tail.length, 'the CONTROL: the tail was found').toBeGreaterThan(1000);
    const code = tail.split('\n').filter((l) => !/^\s*#/.test(l));
    const destructive = code.filter((l) => /\bgit\b.*\b(worktree (remove|prune)|update-ref -d|branch -[dD])\b/.test(l));
    expect(destructive.filter((l) => !/_ws_reclaim_contained git -C "\$main" (worktree remove|update-ref -d) /.test(l)),
      'an uncontained destructive git call').toEqual([]);
    // Pinned at 6 by Task 3. A later task that adds or moves a destructive git call in the tail
    // re-pins this count in its own commit, and keeps the call contained (ruling X3).
    expect(destructive.length, 'nested remove ×2, nested CAS, the tree, its record, the branch CAS').toBe(6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tail-contained.test.ts)`

Expected: FAIL, 8 of 8.
- The hook-run cases, × 3 arms and `ws-expire`: each verb answers success, and the deleted branches are gone. Then `a program the repository names ran inside the tail: expected [ 'reference-transaction', … ] to deeply equal []`, from the uncontained `update-ref -d` sites.
- The shim cases, × 3: the first assertion PASSES, because it pins that each arm reaches its sites. The second reds with every line, for example `a destructive git call ran uncontained: expected [ 'worktree remove --force\tunset\tunset', 'update-ref -d\tunset\tunset', … ] to deeply equal []`.
- The scan: `an uncontained destructive git call: expected [ …(6) ] to deeply equal []`, listing the six lines.

If a hook-run case answers a non-zero `code` or a refusal, the arm's fixture has drifted from its source case in `ccd-child-reclaim-verb-tail.test.ts`. That suite has `pins and removes a nested worktree…`, `pins the branch tip and its stashes…` and `a line counted as gone whose branch IS git’s record there…`. Re-copy the setup from there. Never loosen the assertion.

- [ ] **Step 3: Implement — contain the six calls**

In `ccd/ccd`, `_ws_reclaim_tail`, make six one-line edits. Each line keeps its continuation and its `||` arm. Only the prefix is added, and on the two `update-ref -d` lines `--no-deref` follows `-d`:

```bash
        wtout=$(_ws_reclaim_contained git -C "$main" worktree remove --force "$cpath" 2>&1) \
```
```bash
        wtout=$(_ws_reclaim_contained git -C "$main" worktree remove "$cpath" 2>&1) \
```
```bash
          _ws_reclaim_contained git -C "$main" update-ref -d --no-deref "refs/heads/$cbr" "$chead" 2>/dev/null || {
```
```bash
      wtout=$(_ws_reclaim_contained git -C "$main" worktree remove --force "$workdir" 2>&1) \
```
```bash
        wtout=$(_ws_reclaim_contained git -C "$main" worktree remove "$workdir" 2>&1) \
```
```bash
      _ws_reclaim_contained git -C "$main" update-ref -d --no-deref "refs/heads/$branch" "$tip" 2>/dev/null \
```

These replace, in order, the lines at `:28222`, `:28232`, `:28262`, `:28300`, `:28344` and `:28373`. Each original line is the same text without `_ws_reclaim_contained ` (and, on the two branch CASes, without ` --no-deref`).

Why `--no-deref` (ruling S2-2, defence in depth). Measured on git 2.43.0: after `git symbolic-ref refs/heads/ws/f refs/heads/other`, a plain `git update-ref -d refs/heads/ws/f <other's sha>` answers rc 0, deletes `refs/heads/other`, and leaves `ws/f` standing as a dangling symbolic ref. `update-ref -d --no-deref` deletes `ws/f` itself, and its old-value check still compares the commit the symbolic ref resolves to: a wrong sha answers rc 1, `cannot lock ref … is at <sha> but expected <sha>`. So the CAS keeps its meaning and can delete only the ref it names. The flag is written after `-d`, never before it: git's option parser takes either order (measured, identical results), and `-d --no-deref` keeps `"$3 $4"` at `update-ref -d`. This task's shim, its scan, its `SEEN` rows and the Step 3 checks below therefore read the same call, and the count stays six. Task 8's symbolic-branch guard answers first at every real read of the child's branch, so this flag is a second layer. Task 8 pins it on its own (`never the branch a symbolic one names`, Task 8 Step 5 row 18).

Directly above the line `  # (1) UNSUPERVISE AND KILL THE PANE — FIRST, UNCONDITIONALLY, on the fresh arm`, insert:

```bash
  # EVERY DESTRUCTIVE GIT CALL BELOW RUNS CONTAINED (spec §5.6): each `git
  # worktree remove` and each `update-ref -d`, the nested checkouts' and the
  # child's own, under `_ws_reclaim_contained`, as the pins before them do.
  # Uncontained (measured, git 2.43), `update-ref -d` runs the repository's
  # reference-transaction hook, and a `worktree remove` with no force flag on a
  # tree that stands runs its core.fsmonitor program and its post-index-change
  # hook. `ws-expire` takes this tail too. The two branch deletes spell
  # `--no-deref`: a symbolic ref is deleted itself, never followed to the
  # branch it names (measured, git 2.43: a plain `update-ref -d` deletes the
  # target and leaves the symbolic ref dangling).
```

Check:
- `grep -cE '_ws_reclaim_contained git -C "\$main" (worktree remove|update-ref -d)' ccd/ccd` prints `6`.
- `awk '/^_ws_reclaim_tail\(\) \{/,/^cmd_ws_reclaim\(\) \{/' ccd/ccd | grep -vE '^\s*#' | grep -E 'git -C "\$main" (worktree remove|update-ref -d)' | grep -v '_ws_reclaim_contained git'` prints nothing. It reads the tail's slice alone, the same slice the scan in Step 1 reads (from `_ws_reclaim_tail() {` to `cmd_ws_reclaim() {`), with whole-line comments dropped.
- Uncontained destructive git calls in OTHER verbs (`ws-rm`, `ws-reap`'s `_ws_reap_tail` and others: six of them at `77c11245a`, at about `:7881`, `:10534`, `:14662`, `:14788`, `:14828` and `:15645`) are outside this wave and are never edited here. A whole-file grep prints them; that is not a red.

- [ ] **Step 4: Run the test to verify it passes**

Run: `(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tail-contained.test.ts)`

Expected: PASS, 8 of 8.

- [ ] **Step 5: Mutation check**

Apply each alone, run `(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tail-contained.test.ts)`, and revert. All of them come BEFORE the re-stamp in Step 6. Every row also reds the scan, which lists the reverted line under `an uncontained destructive git call`.

| # | Mutation (exact edit) | Case that reds | Expected red |
|---|---|---|---|
| 1 | Drop `_ws_reclaim_contained ` from the nested `worktree remove --force "$cpath"` | shim: `a fresh reclaim with a nested checkout` | `a destructive git call ran uncontained: expected [ 'worktree remove --force\tunset\tunset' ] to deeply equal []` |
| 2 | Drop it from the nested `worktree remove "$cpath"` (no force) | shim: `a resume at children whose nested line is gone…` | `expected [ 'worktree remove\tunset\tunset' ] to deeply equal []` |
| 3 | Drop it from `update-ref -d --no-deref "refs/heads/$cbr" "$chead"` | hook-run: `a fresh reclaim with a nested checkout`, `a resume at children…`; shim: the same two | `a program the repository names ran inside the tail: expected [ 'reference-transaction', … ] to deeply equal []`; `expected [ 'update-ref -d\tunset\tunset' ] to deeply equal []` |
| 4 | Drop it from step (4)'s `worktree remove --force "$workdir"` | shim: `a fresh reclaim with a nested checkout` | `expected [ 'worktree remove --force\tunset\tunset' ] to deeply equal []` |
| 5 | Drop it from step (5)'s `worktree remove "$workdir"` | shim: `a vanished tree…`, `a resume at children…` | `expected [ 'worktree remove\tunset\tunset' ] to deeply equal []` |
| 6 | Drop it from step (5)'s `update-ref -d --no-deref "refs/heads/$branch" "$tip"` | hook-run: all three arms and `ws-expire’s tail too`; shim: all three arms | `expected [ 'reference-transaction', … ] to deeply equal []` |
| 7 | Add `git -C "$main" branch -D "ws/never-$id" 2>/dev/null \|\| :` as the first line of step (6) | scan | `an uncontained destructive git call: expected [ 'git -C "$main" branch -D "ws/never-$id" 2>/dev/null \|\| :' ] to deeply equal []` |

Dropping `--no-deref` from either CAS reds nothing in this file: no fixture here builds a symbolic branch. Task 8 pins the step-5 one (its Step 5, row 18), because only Task 8's read can be stubbed past its own symbolic-branch guard. The nested one is a disclosed survivor (Task 8, Step 5).

- [ ] **Step 6: Re-stamp `ccd/ccd`, then run the stamp gate and the tail's suites**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/ccd-child-reclaim-tail-contained.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-reflogs.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts)
```

Run each line in the FOREGROUND with a timeout of at least 600000 ms. Expected: `mark.mjs --check` exits 0, and every suite is green.
- `ccd-child-reclaim-verb-tail` must stay green unchanged. Its `git()` function stubs (for example `worktree list` returning 128) still reach these calls, because `_ws_reclaim_contained` runs `"$@"`, which resolves a function first.
- `ccd-ws-expire-verb` is green unchanged: the same tail.
- `session-hook.test.ts` stays green. Every edit is below `ccd/ccd:19109`; if it reds, stop and apply S6-R11 per R56.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-child-reclaim-tail-contained.test.ts
git commit -m "$(cat <<'MSG'
fix(ccd): the reclaim tail's destructive git calls run contained

git worktree remove and update-ref -d, for each nested checkout and for
the child, now run under _ws_reclaim_contained, as the pins before them
do. Uncontained, update-ref -d ran the repository's reference-transaction
hook, and a worktree remove with no force flag on a standing tree runs
core.fsmonitor and post-index-change. ws-expire runs the same tail.
The two branch deletes spell update-ref -d --no-deref, so a symbolic
ref is deleted itself and never followed to the branch it names.
A shim records the hooks path and fsmonitor that git would use for every
destructive call, and a scan keeps the tail's six calls contained.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

### Task 4: `_ws_path_users`, the in-use probe for a path

**Model routing:** **`opus`, effort `high`**. This is SAFETY-critical. The probe's answer decides whether Task 6's tail removes a temp root, and an answer of "nobody" that was never measured is how a straggler's leaf comes back. The probe is new code with the expiry probe's discipline, and it must not edit that probe.

**Why:** Contract R49 measured the cause. Wave 3's tail removed `~/.cc-tmp/ccrc-pwa-swift-hollow` while the killed pane's processes were still running with `TMPDIR=<leaf>`, and one of them re-created the leaf 3.7 s after `reclaim done`. The tail asks tmux whether the session is gone (`_session_probe`), but it never asks whether the pane's processes have exited. R49 defines when a temp root is in use: any process of this uid whose environment carries `TMPDIR` equal to the leaf or under it, whose cwd is at or under the leaf, or that holds an fd at or under the leaf. The probe keeps the expiry probe's rule that unmeasured is never "nobody". On Darwin it answers unmeasured. Wave 6's tail uses it in Task 6, and wave 7's collector will reuse it. R56 makes it a NEW function: `_ws_expire_cwd_users`' body (ccd/ccd:28876 at `77c11245a`; `grep -n '^_ws_expire_cwd_users() {' ccd/ccd`) is never edited, and the two probes are folded together only after workspace-lifecycle 3b's precondition has landed.

**Files:**
- Modify: `ccd/ccd`. Insert one block directly ABOVE the line `_ws_reclaim_tail() {` (ccd/ccd:27962 at `77c11245a`; `grep -n '^_ws_reclaim_tail() {' ccd/ccd`), inside the RECLAIM region. All edits are below ccd/ccd:19109, so R56's length-neutral rule does not apply. The citation census is still checked in Step 5. Every `ccd/ccd:N` and `shared/api.ts:N` number in Tasks 4 to 6 is at `77c11245a` and is a HINT only: your tree already carries wave 5 (#290, merged before dispatch) and Tasks 1 to 3, so locate each site by its grep anchor or quoted line on your own tree.
- Create: `server/test/pathUsersFixture.ts`. It starts real processes with a given TMPDIR, cwd or open fd. Task 6 consumes it too.
- Test: `server/test/ccd-path-users.test.ts` (new)

**Interfaces:**
- Consumes (all at `77c11245a`):
  - `_ws_reclaim_plain_path <path>`: rc 0 when the path has one plain absolute spelling. ccd/ccd:25897; `grep -n '^_ws_reclaim_plain_path()' ccd/ccd`.
  - `_ws_reclaim_absent <path>`: 0 proven absent, 1 something stands there, 2 unmeasured (`_WS_ABSENT_WHY`). ccd/ccd:25914; `grep -n '^_ws_reclaim_absent()' ccd/ccd`.
  - `_plat_timeout <secs> <cmd>…`: 124 on expiry. ccd/ccd:525; `grep -n '^_plat_timeout()' ccd/ccd`.
  - `CCD_OS`: ccd/ccd:80.
- Produces:
  ```bash
  _ws_path_users_proc_root      # -> prints the process-table root; the box answers /proc (a test's seam)
  WS_PATH_USERS_SCAN_S=10       # bound on the one python3 walk
  _ws_path_users <path>         # rc 0 nobody | 1 in use | 2 unmeasured
  _WS_PATH_USERS_PIDS           # rc 1: the users' pids, space-separated, each once
  _WS_PATH_USERS_WHY            # rc 2: why it was not measured. ALSO set on rc 1: what each user uses (additive to the shared interface)
  ```
  The contract:
  - Linux only, and only processes of this uid: one of the four ids on the `Uid:` line of `<root>/<pid>/status` equals `id -u`.
  - **TMPDIR is a string test.** The leaf does not need to exist for a process to count, which is how a leaf gets re-created. TMPDIR is compared against the path as given and against its physical spelling.
  - **cwd and fd are tested against both spellings.** The physical spelling is the parent resolved with `pwd -P` plus the leaf's name, so the leaf itself is not followed.
  - "Under" means the path followed by `/`.
  - **Not users:** ccd's own `$$` and `$BASHPID`, the scan's own process chain (python3 up to ccd), and any child of those.
  - **The walk is a FIXED POINT, never one snapshot:** the table is listed again until a listing names no pid the walk has not read, bounded by `WS_PATH_USERS_SCAN_S` (running out of time is unmeasured, never nobody). A thread-group leader whose own entries read as vanished is asked through `task/<tid>`, and a thread entry unreadable for any reason but vanishing is unmeasured.
  - **Darwin** answers 2.
  - **Never edits or calls `_ws_expire_cwd_users`.**
- Produces (test fixture, `server/test/pathUsersFixture.ts`):
  ```ts
  export interface Held { pid: number; stop: () => void; exited: Promise<void> }
  export function holdsOpen(pid: number, file: string): boolean;
  export function holdProc(o: { cwd: string; tmpdir?: string; holdOpen?: string; script?: string; args?: readonly string[] }): Held;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/test/pathUsersFixture.ts`:

```ts
// Real processes standing for a killed pane's stragglers (child reclamation
// wave 6, spec §5.6): a process of this uid with a given TMPDIR, working
// directory, or a file held open. Spawned by vitest, NEVER by ccd, so ccd's
// "my own children are not users" rule cannot hide them — the pane's real
// stragglers are not ccd's children either.
// The environment is BUILT, never spread from `process.env`: PATH and the
// TMPDIR a case names, nothing else, so no git variable of the runner can
// reach a process a test starts. ALWAYS `stop()` it (an afterEach, or a finally).
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

export interface Held { pid: number; stop: () => void; exited: Promise<void> }

const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** Whether `/proc/<pid>/fd` holds `file` (its resolved path) open. Linux only. */
export function holdsOpen(pid: number, file: string): boolean {
  const want = fs.realpathSync(file);
  let fds: string[];
  try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { return false; }
  return fds.some((n) => { try { return fs.readlinkSync(`/proc/${pid}/fd/${n}`) === want; } catch { return false; } });
}

/** Gone or a zombie: what the probe must read as "nobody". Linux only; elsewhere, true. */
function settled(pid: number): boolean {
  if (process.platform !== 'linux') return true;
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return raw.slice(raw.lastIndexOf(')') + 2).startsWith('Z');
  } catch { return true; }
}

/** `bash -c <script>` (default: `exec sleep 60`, after `exec 3<"$1"` when `holdOpen` names a file) with
 *  its cwd at `cwd` and, when given, `TMPDIR=<tmpdir>`. `spawn` returns once bash has exec'd, so its
 *  environment and cwd are already in /proc; an fd it opens is waited for (at most 10 s). `stop()` sends
 *  SIGKILL and returns once the process is gone or a zombie, so the next probe cannot race its death. */
export function holdProc(o: { cwd: string; tmpdir?: string; holdOpen?: string; script?: string; args?: readonly string[] }): Held {
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'] ?? '/usr/bin:/bin' };
  if (o.tmpdir !== undefined) env['TMPDIR'] = o.tmpdir;
  const body = o.script ?? (o.holdOpen !== undefined ? 'exec 3<"$1"; exec sleep 60' : 'exec sleep 60');
  const argv = o.script !== undefined ? [...(o.args ?? [])] : [o.holdOpen ?? ''];
  const p: ChildProcess = spawn('bash', ['-c', body, 'held', ...argv], { cwd: o.cwd, env, stdio: 'ignore' });
  if (p.pid === undefined) throw new Error(`could not start a process in ${o.cwd}`);
  const pid = p.pid;
  const exited = new Promise<void>((resolve) => { p.once('exit', () => resolve()); });
  if (o.holdOpen !== undefined) {
    const until = Date.now() + 10_000;
    while (!holdsOpen(pid, o.holdOpen)) {
      if (Date.now() > until) { p.kill('SIGKILL'); throw new Error(`process ${pid} never opened ${o.holdOpen}`); }
      pause(20);
    }
  }
  const stop = (): void => {
    p.kill('SIGKILL');
    const until = Date.now() + 5_000;
    while (!settled(pid) && Date.now() < until) pause(20);
  };
  return { pid, stop, exited };
}
```

Create `server/test/ccd-path-users.test.ts`:

```ts
// `_ws_path_users` — who uses a path (child reclamation wave 6, spec §5.6).
// The in-use probe the reclaim tail asks of a temp root before it removes it:
// a process of THIS uid whose TMPDIR names the path or a path under it, whose
// working directory is in it, or that holds a file in it open. Real processes,
// started by this suite with exactly that environment, cwd or fd, stand for a
// killed pane's stragglers; a FAKE process table (the seam
// `_ws_path_users_proc_root`) names the cases a live box cannot be made to
// produce on demand: another uid, an unreadable entry, a pid that vanished, a
// status that does not parse, a pid only a SECOND listing holds (a FIFO
// sequences that race), and a thread-group leader that exited before its threads.
// FIXTURE HOME ONLY: every path asked about is under the harness's HOME, and
// the probe reads — it never writes or deletes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { holdProc, type Held } from './pathUsersFixture.js';

let h: CcdHarness;
let held: Held[] = [];
beforeEach(() => { h = makeCcdHarness('ccrc-path-users-'); held = []; });
afterEach(() => { for (const p of held) p.stop(); h.cleanup(); });

const ID = 'demo-quiet-basin';
const leafOf = (): string => path.join(h.home, '.cc-tmp', ID);
const hold = (o: Parameters<typeof holdProc>[0]): Held => { const p = holdProc(o); held.push(p); return p; };
const LINUX = process.platform === 'linux';
const ROOT_USER = process.getuid?.() === 0;

interface Answer { rc: string; pids: string; why: string }
/** `_ws_path_users`' own answer, read off the globals it sets. `pre` runs first; `env` reaches ccd's own process. */
const ask = (p: string, pre = '', env: NodeJS.ProcessEnv = {}): Answer => {
  const [rc = '', pids = '', why = ''] = h.sh(`${pre} _ws_path_users "${p}"; rc=$?;`
    + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$_WS_PATH_USERS_PIDS" "$_WS_PATH_USERS_WHY"`, env).split('\x1f');
  return { rc, pids, why };
};

describe.skipIf(!LINUX)('real processes of this uid (Linux /proc)', () => {
  it('a process whose TMPDIR IS the leaf uses it — named by pid', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const s = hold({ cwd: h.home, tmpdir: leafOf() });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe(String(s.pid));
    expect(a.why).toContain(`process ${s.pid} carries TMPDIR=${leafOf()}`);
  }, 60_000);

  it('a TMPDIR UNDER the leaf, and a trailing-slash spelling of the leaf, use it too — each pid once', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const a = hold({ cwd: h.home, tmpdir: path.join(leafOf(), 'sub') });
    const b = hold({ cwd: h.home, tmpdir: `${leafOf()}/` });
    const r = ask(leafOf());
    expect(r.rc, r.why).toBe('1');
    expect(r.pids.split(' ').sort()).toEqual([String(a.pid), String(b.pid)].sort());
  }, 60_000);

  it('a TMPDIR naming a leaf that does NOT exist still uses it — that process can re-create it', () => {
    const s = hold({ cwd: h.home, tmpdir: leafOf() });
    expect(fs.existsSync(leafOf()), 'the CONTROL: no leaf stands').toBe(false);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe(String(s.pid));
  }, 60_000);

  it('a process whose working directory is under the leaf uses it', () => {
    const deep = path.join(leafOf(), 'deep');
    fs.mkdirSync(deep, { recursive: true });
    const s = hold({ cwd: deep });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`process ${s.pid} has its working directory at ${fs.realpathSync(deep)}`);
  }, 60_000);

  it('a process holding a file under the leaf OPEN uses it — no TMPDIR, its cwd elsewhere', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const f = path.join(leafOf(), 'held');
    fs.writeFileSync(f, 'x');
    const s = hold({ cwd: h.home, holdOpen: f });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`process ${s.pid} holds ${fs.realpathSync(f)} open`);
  }, 60_000);

  it('THE NEGATIVE CONTROL: a sibling `<leaf>2` in every arm is not under the leaf — nobody', () => {
    const sib = `${leafOf()}2`;
    fs.mkdirSync(leafOf(), { recursive: true });
    fs.mkdirSync(sib, { recursive: true });
    fs.writeFileSync(path.join(sib, 'held'), 'x');
    hold({ cwd: sib, tmpdir: sib, holdOpen: path.join(sib, 'held') });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('0');
    expect(a.pids).toBe('');
  }, 60_000);

  it('the same process once killed: nobody', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const s = hold({ cwd: h.home, tmpdir: leafOf() });
    expect(ask(leafOf()).rc, 'the CONTROL: alive, it uses the leaf').toBe('1');
    s.stop();
    expect(ask(leafOf()).rc).toBe('0');
  }, 60_000);

  it('a root reached through a LINK: the literal spelling and the physical one are both compared', () => {
    const vol = path.join(h.home, 'vol', 'cc-tmp');
    fs.mkdirSync(path.join(vol, ID), { recursive: true });
    fs.symlinkSync(vol, path.join(h.home, '.cc-tmp'));
    const phys = path.join(fs.realpathSync(vol), ID);
    const inCwd = hold({ cwd: phys });
    const viaPhys = hold({ cwd: h.home, tmpdir: phys });
    const a = ask(leafOf());   // asked by the literal spelling `_child_tmpdir` composes
    expect(a.rc, a.why).toBe('1');
    expect(a.pids.split(' ').sort()).toEqual([String(inCwd.pid), String(viaPhys.pid)].sort());
  }, 60_000);

  it('ccd’s own process and the scan’s own chain are not users, even when ccd itself carries TMPDIR=<leaf>', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const a = ask(leafOf(), '', { TMPDIR: leafOf() });
    expect(a.rc, a.why).toBe('0');
    // THE CONTROL: the same environment on a process ccd did not start is a user.
    const s = hold({ cwd: h.home, tmpdir: leafOf() });
    expect(ask(leafOf(), '', { TMPDIR: leafOf() }).pids).toBe(String(s.pid));
  }, 60_000);
});

describe('a FAKE process table — the cases a live box cannot be made to produce', () => {
  /** `$HOME/fp/<pid>/{status,environ,cwd,fd/}`. `_fpp <pid> <ppid> <uid>` plants one process whose
   *  environment is empty, whose cwd is `/` and which holds nothing open; ccd's own `$$` is planted
   *  first, because a listing without it is not trusted. Forced Linux, so a macOS host reads it too. */
  const FAKE = [
    'CCD_OS=linux; rm -rf "$HOME/fp";',
    '_fpp() { mkdir -p "$HOME/fp/$1/fd";',
    ' printf "Name:\\tx\\nPPid:\\t%s\\nUid:\\t%s\\t%s\\t%s\\t%s\\n" "$2" "$3" "$3" "$3" "$3" > "$HOME/fp/$1/status";',
    ' : > "$HOME/fp/$1/environ"; ln -sfn / "$HOME/fp/$1/cwd"; };',
    '_fpp $$ 1 "$(id -u)";',
    '_ws_path_users_proc_root() { printf %s "$HOME/fp"; };',
  ].join(' ');
  const envOf = (pid: number | string, value: string): string =>
    `printf 'LANG=C\\0TMPDIR=%s\\0' "${value}" > "$HOME/fp/${pid}/environ";`;

  it('a stranger of this uid whose environment names the leaf is a user', () => {
    const a = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; ${envOf(4242, leafOf())}`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
  }, 60_000);

  it('the same process under ANOTHER uid is not seen — the stated limit, never a refusal', () => {
    const a = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(( $(id -u) + 1 ))"; ${envOf(4242, leafOf())}`);
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it.skipIf(ROOT_USER)('an environment this uid may not read (a NON-DUMPABLE process) is not seen — the stated limit', () => {
    const a = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; ${envOf(4242, leafOf())} chmod 000 "$HOME/fp/4242/environ";`);
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('a cwd link at the leaf, and an fd link under it (a deleted file included), are users; a socket fd is not', () => {
    const cwd = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; ln -sfn "${leafOf()}" "$HOME/fp/4242/cwd";`);
    expect(cwd.rc, cwd.why).toBe('1');
    const fd = ask(leafOf(), `${FAKE} _fpp 4243 1 "$(id -u)"; ln -sfn "${leafOf()}/x (deleted)" "$HOME/fp/4243/fd/7";`);
    expect(fd.rc, fd.why).toBe('1');
    expect(fd.pids).toBe('4243');
    const sock = ask(leafOf(), `${FAKE} _fpp 4244 1 "$(id -u)"; ln -sfn 'socket:[1]' "$HOME/fp/4244/fd/7";`);
    expect(sock.rc, sock.why).toBe('0');
  }, 60_000);

  it('a child of ccd is not a user; the same process under another parent is', () => {
    const child = ask(leafOf(), `${FAKE} _fpp 4242 $$ "$(id -u)"; ${envOf(4242, leafOf())}`);
    expect(child.rc, child.why).toBe('0');
    const other = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; ${envOf(4242, leafOf())}`);
    expect(other.rc, 'the CONTROL').toBe('1');
  }, 60_000);

  it('a pid that vanished between the listing and the read (no status left) is skipped — PROOF it is gone', () => {
    const a = ask(leafOf(), `${FAKE} mkdir -p "$HOME/fp/4242";`);
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('a pid that only a SECOND listing holds is read — the walk is a fixed point, never one snapshot', () => {
    // A FIFO at 4242's status SEQUENCES what a live box does by chance: the
    // probe's own read of 4242, after its first listing, is what plants 4243 —
    // the successor a process forked before it exited — and 4243 carries the leaf.
    const fifo = '"$HOME/fp/4242/status"';
    const status4242 = `printf 'Name:\\tx\\nPPid:\\t1\\nUid:\\t%s\\t%s\\t%s\\t%s\\n' "$u" "$u" "$u" "$u"`;
    try {
      const a = ask(leafOf(), `${FAKE} u=$(id -u); _fpp 4242 1 "$u"; rm -f ${fifo}; mkfifo ${fifo};`
        + ` { exec 3>${fifo}; _fpp 4243 1 "$u"; ${envOf(4243, leafOf())} ${status4242} >&3; exec 3>&-; } >/dev/null 2>&1 &`);
      expect(a.rc, a.why).toBe('1');
      expect(a.pids).toBe('4243');
    } finally {
      // A probe that never read 4242 (the red phase) leaves the writer blocked
      // opening the FIFO: an O_RDWR open is a reader, and releases it.
      h.sh(`if [ -p ${fifo} ]; then : <> ${fifo}; fi`);
    }
  }, 60_000);

  /** 4242's own entries read as VANISHED (its cwd is gone), and its thread 4243 lives under `task/`. */
  const LEADER_GONE = `${FAKE} _fpp 4242 1 "$(id -u)"; rm -f "$HOME/fp/4242/cwd"; mkdir -p "$HOME/fp/4242/task/4243/fd";`
    + ' ln -sfn / "$HOME/fp/4242/task/4243/cwd";';

  it('a thread-group LEADER that exited before its threads is asked through task/<tid> — its live thread uses the leaf', () => {
    const a = ask(leafOf(), `${LEADER_GONE} printf 'TMPDIR=%s\\0' "${leafOf()}" > "$HOME/fp/4242/task/4243/environ";`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    // THE CONTROL: the same leader with no thread left IS gone — proof, so nobody.
    const gone = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; rm -f "$HOME/fp/4242/cwd";`);
    expect(gone.rc, gone.why).toBe('0');
  }, 60_000);

  it.skipIf(ROOT_USER)('a LIVE thread’s entry this uid may not read is UNMEASURED; a thread already in exit (PF_EXITING) is vanishing', () => {
    const locked = `${LEADER_GONE} : > "$HOME/fp/4242/task/4243/environ"; chmod 000 "$HOME/fp/4242/task/4243/environ";`;
    const stat = (flags: number): string => `printf '4243 (x) R 1 4242 4242 0 -1 ${flags} 0 0\\n' > "$HOME/fp/4242/task/4243/stat";`;
    const live = ask(leafOf(), `${locked} ${stat(0x400100)}`);
    expect(live.rc, live.why).toBe('2');
    expect(live.why).toContain('could not be measured');
    // THE CONTROL: the same entry on a thread in exit (measured on a busy box: State R,
    // PF_EXITING 0x4 set, its memory released, its environ EACCES) is vanishing, so nobody.
    const exiting = ask(leafOf(), `${locked} ${stat(0x40044c)}`);
    expect(exiting.rc, exiting.why).toBe('0');
  }, 60_000);

  it('a status that does not parse is UNMEASURED — never "nobody"', () => {
    for (const bad of ['garbage', 'PPid:\\tx\\nUid:\\t1\\n', '']) {
      const a = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; printf '${bad}' > "$HOME/fp/4242/status";`);
      expect(a.rc, `status ${JSON.stringify(bad)}: ${a.why}`).toBe('2');
      expect(a.why).toContain('could not be measured');
    }
  }, 90_000);

  it('a table that cannot be listed, or one without ccd’s own pid, measured nothing', () => {
    const missing = ask(leafOf(), 'CCD_OS=linux; _ws_path_users_proc_root() { printf %s "$HOME/no-such-proc"; };');
    expect(missing.rc, missing.why).toBe('2');
    fs.mkdirSync(path.join(h.home, 'empty-proc'));
    const empty = ask(leafOf(), 'CCD_OS=linux; _ws_path_users_proc_root() { printf %s "$HOME/empty-proc"; };');
    expect(empty.rc, empty.why).toBe('2');
  }, 60_000);
});

describe('answers that never look', () => {
  it('Darwin answers unmeasured — no process environment is read there', () => {
    const a = ask(leafOf(), 'CCD_OS=darwin;');
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('Darwin');
  }, 60_000);

  it('a path that is not one plain absolute spelling is unmeasured', () => {
    for (const p of ['relative/x', `${leafOf()}/`, `${h.home}//.cc-tmp/${ID}`, `${h.home}/.cc-tmp/../.cc-tmp/${ID}`]) {
      const a = ask(p, 'CCD_OS=linux;');
      expect(a.rc, `${p}: ${a.why}`).toBe('2');
    }
  }, 60_000);

  it('a walk that outruns its bound is unmeasured', () => {
    const a = ask(leafOf(), 'CCD_OS=linux; _plat_timeout() { return 124; };');
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('did not finish within');
  }, 60_000);

  it.skipIf(ROOT_USER)('a parent that cannot be searched is unmeasured', () => {
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(path.join(locked, 'x'), { recursive: true });
    fs.chmodSync(locked, 0o000);
    try {
      const a = ask(path.join(locked, 'x', ID), 'CCD_OS=linux;');
      expect(a.rc, a.why).toBe('2');
    } finally { fs.chmodSync(locked, 0o755); }
  }, 60_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-path-users.test.ts` (FOREGROUND, timeout ≥ 600000 ms)

Expected: FAIL in every case.
- Each `ask` prints `bash: _ws_path_users: command not found` on stderr, and the snippet goes on to print rc `127`.
- The assertions then fail as `expected '127' to be '1'`, `expected '127' to be '0'` or `expected '127' to be '2'`.
- On a non-Linux host, the first describe is skipped.

- [ ] **Step 3: Implement `_ws_path_users`**

In `ccd/ccd`, directly ABOVE `_ws_reclaim_tail() {`, insert:

```bash
# ── who uses a path: the in-use probe (child reclamation wave 6, spec §5.6) ──
# THE SEAM, as `_ws_expire_proc_root` is the expiry probe's: a test names a fake
# process table, and the box answers /proc.
_ws_path_users_proc_root() { printf '%s' /proc; }
WS_PATH_USERS_SCAN_S=10   # bound on the ONE python3 walk of the process table (healthy: well under a second)
_WS_PATH_USERS_PIDS=''
_WS_PATH_USERS_WHY=''
_ws_path_users() {   # path -> 0 when no process of this uid uses it; 1 when one does (_WS_PATH_USERS_PIDS:
  #                     their pids, space-separated, each once; _WS_PATH_USERS_WHY: what each uses);
  #                     2 unmeasured (_WS_PATH_USERS_WHY says why) — never "nobody"
  # WHO USES A PATH, asked of a temp root before ccd removes it. MEASURED
  # 2026-10-04: a reclaim tail removed `~/.cc-tmp/<id>` while the killed pane's
  # processes still ran with `TMPDIR=<leaf>`, and one of them re-created the
  # leaf 3.7 s after `reclaim done`. Asking tmux whether its session is gone
  # never asks whether the pane's processes have exited; this does.
  # A PROCESS USES THE PATH when it is of THIS uid (any of the four ids its
  # `status` names) and: its environment's `TMPDIR` equals the path or lies
  # under it — a STRING test, so the leaf need not exist, which is exactly how
  # one is re-created; or its working directory, or any file it holds open, is
  # at the path or under it. "Under" is the path followed by `/`: a sibling
  # `<path>2` is not under it. TWO SPELLINGS are compared: the path as given
  # (how `_child_tmpdir` composes TMPDIR) and its physical one — the parent
  # resolved, the LEAF NOT FOLLOWED (a cwd or fd link never goes through a link).
  # THE EXPIRY PROBE'S DISCIPLINE (`_ws_expire_cwd_users`, which this neither
  # edits nor calls): unmeasured is never "nobody". A table that cannot be
  # listed, a listing without ccd's own pid, a `status` that does not parse, a
  # walk that outruns `WS_PATH_USERS_SCAN_S`, python3 missing: unmeasured. A
  # process is skipped only on PROOF it vanished (ENOENT/ESRCH) — and proof
  # that ONE process vanished is no proof about the processes it left:
  # - THE WALK IS A FIXED POINT, NEVER ONE SNAPSHOT. A process that forks its
  #   successor and exits between the listing and its own read leaves a child
  #   no listing held (measured: such a chain read "nobody" 40 of 40 on a
  #   single pass). So the table is listed again until a listing names no pid
  #   this walk has not read, and the first user found ends it. A table that
  #   never stops minting new pids inside `WS_PATH_USERS_SCAN_S` is
  #   unmeasured, never "nobody"; a pid reused inside one walk is not read
  #   twice (a stated residual).
  # - A THREAD-GROUP LEADER THAT EXITED BEFORE ITS THREADS (`pthread_exit`
  #   from main: State Z, Threads > 1) shows a vanished cwd while its other
  #   threads still run with its environment, cwd and fds. A leader whose own
  #   entries read as vanished is asked through `task/<tid>`, and a thread
  #   entry unreadable for any reason but vanishing is unmeasured. A thread
  #   already in exit (gone, or PF_EXITING in its `stat` flags) IS vanishing:
  #   its memory is released, so its environ answers EACCES (measured: 10 of
  #   30 walks of a busy box met one), and reading that as unmeasured would
  #   keep temp roots for nothing.
  # THE LIMIT, STATED: an entry this uid may not read — EACCES, a NON-DUMPABLE
  # process of this uid (ssh-agent, a setuid exec, anything that called
  # prctl(PR_SET_DUMPABLE, 0)) — is NOT SEEN, as in the expiry probe, and
  # neither is any process of another uid. Refusing on them would keep every
  # temp root for ever on a box that runs an ssh-agent. Two more are not seen.
  # An environment is the one the process was exec'd with, so a TMPDIR it set
  # after its exec is not read. And a cwd or fd reached through ANOTHER MOUNT
  # of the same directory reads that mount's spelling, which neither compared
  # spelling names: `$HOME/.cc-tmp` is a bind mount on the fleet box, and its
  # device is mounted whole elsewhere. The TMPDIR arm compares ccd's own
  # spelling, the one `_child_tmpdir` composes, so the pane's own processes
  # are seen through it.
  # WHAT IS NOT A USER: ccd's own process (`$$`, `$BASHPID`), the scan's own
  # chain (the python3 and every process between it and ccd) and any child of
  # those. ccd's ANCESTORS are users like any other.
  # DARWIN ANSWERS UNMEASURED: ccd reads no process environment there.
  local p="$1" name parent preal phys rc root out pid what pth n=0 shown='' pids='' me=$$ sub=$BASHPID
  _WS_PATH_USERS_PIDS=''; _WS_PATH_USERS_WHY=''
  _ws_reclaim_plain_path "$p" \
    || { _WS_PATH_USERS_WHY="$p is not one plain absolute path, so who uses it was never asked"; return 2; }
  if [[ "$CCD_OS" == darwin ]]; then
    _WS_PATH_USERS_WHY="this box is Darwin, where ccd reads no process environment, so who uses $p was never asked"
    return 2
  fi
  name="${p##*/}"; parent="${p%/*}"; [[ -n "$parent" ]] || parent=/
  _ws_reclaim_absent "$parent"; rc=$?
  (( rc != 2 )) || { _WS_PATH_USERS_WHY="$_WS_ABSENT_WHY — who uses $p was never asked"; return 2; }
  if (( rc == 0 )); then
    phys="$p"   # nothing stands above the leaf: no cwd or fd can be in it; TMPDIR is a string
  else
    preal=$(cd -- "$parent" >/dev/null 2>&1 && pwd -P) \
      || { _WS_PATH_USERS_WHY="the directory $parent that holds $p cannot be resolved, so who uses $p was never asked"; return 2; }
    phys="${preal%/}/$name"
  fi
  root=$(_ws_path_users_proc_root)
  out=$(_plat_timeout "$WS_PATH_USERS_SCAN_S" env LC_ALL=C.UTF-8 python3 -c '
import os, sys
root, lit, phys, me, sub = sys.argv[1:6]
uid = os.getuid()
VANISHED = (FileNotFoundError, ProcessLookupError)
def under(p):
    return any(p == b or p.startswith(b + "/") for b in (lit, phys))
def status(pid):
    # (ppid, uids), or None ONLY on proof the process is gone; anything else is unmeasured
    try:
        with open("%s/%s/status" % (root, pid), "rb") as fh:
            raw = fh.read().decode("utf-8", "replace")
    except VANISHED:
        return None
    ppid = uids = None
    for line in raw.split("\n"):
        if line.startswith("PPid:"):
            v = line[5:].strip()
            if v.isascii() and v.isdigit():
                ppid = v
        elif line.startswith("Uid:"):
            f = line[4:].split()
            if len(f) == 4 and all(x.isascii() and x.isdigit() for x in f):
                uids = {int(x) for x in f}
    if ppid is None or uids is None:
        sys.exit(3)
    return ppid, uids
def uses(base):
    # what of the path the entries under <base> show (a process, or one of
    # its threads); None ONLY on proof they vanished mid-read
    found = []
    try:
        with open(base + "/environ", "rb") as fh:
            env = fh.read()
        for kv in env.split(b"\0"):
            if kv.startswith(b"TMPDIR=") and under(os.fsdecode(kv[7:])):
                found.append(("tmpdir", os.fsdecode(kv[7:])))
    except VANISHED:
        return None
    except PermissionError:
        pass
    try:
        c = os.readlink(base + "/cwd")
        if under(c):
            found.append(("cwd", c))
    except VANISHED:
        return None
    except PermissionError:
        pass
    try:
        fds = os.listdir(base + "/fd")
    except VANISHED:
        return None
    except PermissionError:
        fds = []
    for n in fds:
        try:
            t = os.readlink(base + "/fd/" + n)
        except (FileNotFoundError, PermissionError):
            continue
        if under(t):
            found.append(("fd", t))
    return found
def uses_of(pid):
    # what of the path process <pid> uses; None ONLY on proof it is gone
    found = uses("%s/%s" % (root, pid))
    if found is not None:
        return found
    # A LEADER THAT EXITED is not a process that exited: its other threads
    # keep the environment, cwd and fds its own entries no longer show
    # (measured: State Z, Threads 2, cwd ENOENT, environ and fd EACCES).
    try:
        tids = [t for t in os.listdir("%s/%s/task" % (root, pid)) if t != pid]
    except VANISHED:
        return None
    except PermissionError:
        sys.exit(3)
    found = []
    for t in tids:
        tb = "%s/%s/task/%s" % (root, pid, t)
        # a thread entry unreadable for any reason but vanishing is UNMEASURED
        try:
            with open(tb + "/environ", "rb"):
                pass
            os.readlink(tb + "/cwd")
            os.listdir(tb + "/fd")
        except VANISHED:
            continue
        except PermissionError:
            if exiting(tb):
                continue
            sys.exit(3)
        found.extend(uses(tb) or [])
    return found
def exiting(base):
    # True ONLY on proof the task is going: gone, or PF_EXITING (0x4) in the
    # flags field of its stat. A thread in exit has released its memory, so
    # its environ answers EACCES (measured: 10 of 30 walks of a busy box met
    # one, State R, PF_EXITING set). Anything else is unmeasured.
    try:
        with open(base + "/stat", "rb") as fh:
            raw = fh.read().decode("ascii", "replace")
    except VANISHED:
        return True
    except PermissionError:
        sys.exit(3)
    f = raw[raw.rfind(")") + 2:].split()
    if len(f) < 7 or not (f[6].isascii() and f[6].isdigit()):
        sys.exit(3)
    return (int(f[6]) & 4) != 0
def scan():
    try:
        names = [n for n in os.listdir(root) if n.isascii() and n.isdigit()]
    except OSError:
        sys.exit(3)
    if me not in names:
        sys.exit(3)
    own = {me, sub}
    cur = str(os.getpid())
    for _ in range(64):
        own.add(cur)
        st = status(cur)
        if st is None or st[0] in (me, sub, "0", "1"):
            break
        cur = st[0]
    # NOT ONE SNAPSHOT: a process made after the listing by one that then
    # exited before it was read is in no listing yet (measured: a chain that
    # forks its successor and exits read "nobody" 40 of 40 on one pass). So
    # the table is listed again until a listing names no pid this walk has
    # not read; the first user ends it. WS_PATH_USERS_SCAN_S bounds the whole
    # walk (124: unmeasured, never nobody).
    seen, todo, hit = set(), names, False
    while todo and not hit:
        for pid in todo:
            seen.add(pid)
            if pid in own:
                continue
            st = status(pid)
            if st is None:
                continue
            ppid, uids = st
            if uid not in uids or ppid in own:
                continue
            for what, p in uses_of(pid) or []:
                hit = True
                clean = p.replace("\t", "?").replace("\n", "?")
                sys.stdout.buffer.write(os.fsencode("%s\t%s\t%s\n" % (pid, what, clean)))
        if not hit:
            try:
                todo = [n for n in os.listdir(root) if n.isascii() and n.isdigit() and n not in seen]
            except OSError:
                sys.exit(3)
try:
    scan()
except Exception:
    sys.exit(3)
' "$root" "$p" "$phys" "$me" "$sub" 2>/dev/null); rc=$?
  if (( rc == 124 )); then
    _WS_PATH_USERS_WHY="the walk of $root did not finish within ${WS_PATH_USERS_SCAN_S}s, so who uses $p was never asked"
    return 2
  fi
  (( rc == 0 )) \
    || { _WS_PATH_USERS_WHY="the processes of this box could not be measured ($root, exit $rc), so who uses $p was never asked"; return 2; }
  [[ -n "$out" ]] || return 0
  while IFS=$'\t' read -r pid what pth; do
    [[ -n "$pid" ]] || continue
    case " $pids " in *" $pid "*) : ;; *) pids+="${pids:+ }$pid" ;; esac
    n=$(( n + 1 ))
    (( n <= 5 )) || continue
    case "$what" in
      tmpdir) shown+="${shown:+, }process $pid carries TMPDIR=$pth" ;;
      cwd)    shown+="${shown:+, }process $pid has its working directory at $pth" ;;
      *)      shown+="${shown:+, }process $pid holds $pth open" ;;
    esac
  done <<< "$out"
  (( n <= 5 )) || shown+=", and $(( n - 5 )) more"
  _WS_PATH_USERS_PIDS="$pids"; _WS_PATH_USERS_WHY="$shown"
  return 1
}

```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-path-users.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts
```

Expected: `ccd-path-users` passes in full on Linux. `ccd-ws-expire-ladder` stays green and unchanged, which proves the expiry probe was not touched.

THE REAL FORK-AND-EXIT CHAIN IS MEASURED IN SCRATCH, NOT PINNED IN THE SUITE. The FIFO case is the deterministic pin of the fixed point. A real chain (each process sleeps 5 ms, forks its successor with `TMPDIR=<leaf>`, and exits) cannot be made deterministic here: one pass misses it most of the time but not every time, and its fork rate is the load this suite is sensitive to. The pre-flight attack measured it on the fleet box's userland (git 2.43, python 3.12, kernel 6.8, about 630 processes): one pass answered "nobody" 40 of 40, and 55 of 60 in a second run; the fixed-point walk found the chain 30 of 30 and 59 of 60 (the sixtieth unmeasured, never nobody), averaging 641 ms against one pass's 116 ms, well inside `WS_PATH_USERS_SCAN_S`. The walk as this step writes it (fixed point, task walk and `exiting`) was re-measured in scratch while the plan was amended: 30 of 30 found against a 5 ms hopper, about 0.7 s per walk on the fleet box, and 40 of 40 walks of the live table answered without an unmeasured (before `exiting` was added, 10 of 30 met a thread in exit and answered unmeasured). Lens 0 re-runs it, with a hopping straggler in every seed.

- [ ] **Step 5: Re-stamp, then the citation and ownership gates**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
```

Expected:
- `mark.mjs --check` exits 0, and `ownership` is green.
- The citation describe is green. This task's whole insertion sits below ccd/ccd:19109, so no frozen-corpus anchor moves.
- If the citation describe reds, STOP and report. Never adjust a census to green it.

- [ ] **Step 6: Mutation check, then commit**

| # | Mutation (exact edit in `_ws_path_users`' python) | Command | Expected red |
|---|---|---|---|
| 1 | In `uses`, delete the whole `try: … environ … except PermissionError: pass` block | `cd server && ./node_modules/.bin/vitest run test/ccd-path-users.test.ts` | "a process whose TMPDIR IS the leaf": `expected '0' to be '1'`; the fake "stranger of this uid" case fails the same way |
| 2 | In `under`, replace `p == b or p.startswith(b + "/")` with `p.startswith(b)` | same | the NEGATIVE CONTROL: `expected '1' to be '0'` |
| 3 | In the bash, replace `phys="${preal%/}/$name"` with `phys="$p"` | same | "a root reached through a LINK": `expected '0' to be '1'` (with one spelling, neither the cwd process nor the `TMPDIR=<physical>` process is seen) |
| 4 | Replace `if uid not in uids or ppid in own:` with `if ppid in own:` | same | "under ANOTHER uid": `expected '1' to be '0'` |
| 5 | In `uses`' environ block, replace `except PermissionError:\n        pass` with `except PermissionError:\n        sys.exit(3)` | same | "an environment this uid may not read": `expected '2' to be '0'` |
| 6 | In `status`, replace `except VANISHED:\n        return None` with `except VANISHED:\n        sys.exit(3)` | same | "a pid that vanished": `expected '2' to be '0'` |
| 7 | In `status`, replace `sys.exit(3)` (after the parse) with `return None` | same | "a status that does not parse": `expected '0' to be '2'` |
| 8 | Delete `if me not in names:\n        sys.exit(3)` | same | "a table … without ccd’s own pid" (`empty-proc`): `expected '0' to be '2'` |
| 9 | Delete the whole `for _ in range(64):` chain loop | same | "ccd’s own process and the scan’s own chain": `expected '1' to be '0'` |
| 10 | In the bash, delete the `if [[ "$CCD_OS" == darwin ]]; then … fi` block | same | "Darwin answers unmeasured": `expected '0' to be '2'` |
| 11 | In the bash, delete the `if (( rc == 124 )); then … fi` block | same | "a walk that outruns its bound": `expected 'the processes of this box could not be measured (…)' to contain 'did not finish within'` |
| 12 | In `uses`, delete the fd loop's `if under(t):\n            found.append(("fd", t))` | same | "holding a file … OPEN": `expected '0' to be '1'`; the fake fd case fails the same way |
| 13 | In `uses`, delete `if under(c):\n            found.append(("cwd", c))` | same | "working directory is under the leaf": `expected '0' to be '1'` |
| 14 | In `scan`, replace `while todo and not hit:` with `if todo:` (ONE listing, never a fixed point) | same | "a pid that only a SECOND listing holds": `expected '0' to be '1'` |
| 15 | Replace `uses_of`'s whole body with `return uses("%s/%s" % (root, pid))` (no task walk) | same | "a thread-group LEADER that exited before its threads": `expected '0' to be '1'` |
| 16 | In `uses_of`'s thread loop, replace `if exiting(tb):\n                continue\n            sys.exit(3)` with `continue` | same | "a LIVE thread’s entry this uid may not read": `expected '0' to be '2'` |
| 17 | In `exiting`, replace `return (int(f[6]) & 4) != 0` with `return False` | same | the same case's CONTROL, the thread in exit: `expected '2' to be '0'` |

Revert each mutation, re-stamp (`bash ccd/ccrc restamp ccd/ccd`), and confirm the suite is green again. Then:

```bash
git add ccd/ccd server/test/pathUsersFixture.ts server/test/ccd-path-users.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): _ws_path_users, who uses a path before ccd removes it

A temp root is in use while a process of this uid carries TMPDIR equal to
it or under it, works inside it, or holds a file in it open. TMPDIR is a
string test, so a leaf that is already gone still counts, which is how a
killed pane's straggler re-created one after its reclaim. The probe keeps
the expiry probe's discipline: unmeasured is never nobody, a process is
skipped only on proof it vanished, and an unreadable entry is the stated
limit. The walk lists the table again until no unread pid remains, so a
straggler that hands itself to a child and exits is still read, and a
leader that exited before its threads is asked through them. Darwin
answers unmeasured. _ws_expire_cwd_users is untouched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

### Task 5: `_ws_leaf_remove`, the ONE removal helper, and the tail's artifacts step rebuilt on it

**Model routing:** **`opus`, effort `high`**. This is SAFETY-critical: it is the destructive half of `ws-reclaim` and `ws-expire`. Wave 6's SAFETY lens reads this diff first.

**Why:** Contract R49 orders ONE removal helper, extracted from the artifacts step of `_ws_reclaim_tail` in the form `_WS_RCL_ACT` leaves it. It serves the clips leaf and the temp-root leaf for both flavours, and later wave 7's collector. Today's step 6 is ccd/ccd:28379 to :28410 at `77c11245a` (`grep -n '# (6) The artifacts (rule 2)' ccd/ccd` to `grep -n '# (7) The residue probe' ccd/ccd`), and it has five defects:
- it throws away rm's exit code and a failed permission pass (`_ws_reclaim_normalise "$tdir" || :` then a bare `rm -rf "$tdir"`);
- it removes without `--one-file-system`, although `~/.cc-tmp` is now a bind mount on the live box (scout, `findmnt`);
- it never checks who owns a directory leaf;
- it never proves the leaf gone;
- its purge-failure texts (ccd/ccd:28421, :28426, :28432; `grep -n 'clips and temp root are gone' ccd/ccd`) claim "clips and temp root are gone" whatever happened.

The helper answers three ways (removed or absent, refused, unmeasured). The tail KEEPS a leaf the helper does not remove, completes the act, and records the kept leaf in the done row's measurements, as R49 rules for the temp root. That is never a refusal. The same keep-and-record for a CLIPS leaf the helper refuses or cannot measure (`meas.clipsKept`) is ruled (probe-helper-tail.OPEN2/DEP2, accepted). Nothing collects a kept clips leaf, so it is carried to wave 7's pre-flight, and the worker lists it among the wave-done's carried residuals. Task 6 then puts the in-use probe in front of the temp root. Task 7 swaps the temp-root call for `_ws_tmproot_remove "$id"`.

**This reaches `ws-expire` (X2).** `ws-expire` runs this same tail, so the helper and the rebuilt step (6) change what `ws-expire` deletes, with no edit in the EXPIRE region. The coordinator tells workspace-lifecycle (`ccrc-pwa-quiet-river`) before dispatch, and the worker names this change in the wave-done.

**Files:**
- Modify: `ccd/ccd`. Make four edits, all below ccd/ccd:19109. The line numbers below are hints at `77c11245a`; locate each edit by its quoted text or grep on your own tree:
  1. Insert `_ws_leaf_uid` and `_ws_leaf_remove` directly ABOVE `_ws_reclaim_tail() {`, after Task 4's block.
  2. Add ONE `local` line in `_ws_reclaim_tail`, directly under `local noun=reclaim donekey=reclaimed bindkey=childOf` (ccd/ccd:27971).
  3. Replace step (6) (ccd/ccd:28379 to :28410).
  4. Rewrite the three purge-failure calls and the `_lc_done` call (ccd/ccd:28419 to :28442).
- Modify: `shared/api.ts`. `LifecycleMeas` gains `tmpRootKept` and `clipsKept` after `residueBytes` (ccd/ccd's journal key needs its L0 member in the SAME commit). Append both to `LIFECYCLE_MEAS_KEY_MAP`'s last line (`grep -n 'unremoved: true, childOf: true, wip: true, residueBytes: true,' shared/api.ts`).
- Modify: `server/src/coord/journalparse.ts`. `reviveMeas` carries the two keys (`grep -n "residueBytes: s(o, 'residueBytes')" server/src/coord/journalparse.ts`, :211).
- Modify: `server/test/ccd-lifecycle-contain.test.ts`. The `meas.` census goes 32→34, with its cause named (`grep -n 'exactly 32\|measured 32\|toBe(32)' server/test/ccd-lifecycle-contain.test.ts`, :188 and :204).
- Modify: `server/test/lifecycle-wire.test.ts`. Update the `MEAS` literal (:39), the sorted key list (:104 to :109) and the `nothing` literal (:120).
- Modify, only if Step 5 reds on it: `README.md`. Its `shared/api.ts:` anchors are repaired BY CONTENT (R56: README's citation tax is `shared/api.ts`).
- Test: `server/test/ccd-leaf-remove.test.ts` (new)

**Interfaces:**
- Consumes (at `77c11245a`):
  - `_ws_reclaim_absent` / `_WS_ABSENT_WHY` (ccd/ccd:25914).
  - `_ws_reclaim_normalise <dir>`: 0 clean, 1 still unreadable, 2 could not run (`_WS_NORMALISE_WHY`). ccd/ccd:25329; `grep -n '^_ws_reclaim_normalise()' ccd/ccd`.
  - `_plat_devino <file>` → `dev:ino` (ccd/ccd:265).
  - `_ws_reclaim_fail id lctx token detail [k v]…` (ccd/ccd:27831).
  - `_lc_done` (ccd/ccd:5020). Its encoder omits an empty value (ccd/ccd:4878).
  - Test side: `makeChild`, `childReclaimVerb`, `evalOf`, `CHILD_ID`, `CHILD_BRANCH` (`server/test/childReclaimFixture.ts`); `makeArchived`, `expireToken`, `expireVerb`, `EXP_ID` (`server/test/wsExpireFixture.ts`); `eventsOf`, `measOf` (`server/test/lifecycleHelpers.ts`).
- Produces:
  ```bash
  _ws_leaf_uid <path>                          # -> the owning uid of the path itself (`ls -dn`: never follows the path's own link, and no `stat` outside the platform block); a test's seam
  _ws_leaf_remove <root> <id> [<expect-devino>] # rc 0 removed-or-absent (proven by _ws_reclaim_absent) | 1 refused | 2 unmeasured
  _WS_LEAF_WHY                                 # rc 1 and rc 2: why, in a sentence
  ```
  - Done row (both flavours, and the three purge-failure rows): `meas.clipsKept` and `meas.tmpRootKept`. Each is `refused` or `unmeasured` (Task 6 adds `in-use` to `tmpRootKept`), and empty, so omitted, when the leaf went. The row's `detail` says why. `unmeasured` does not mean untouched: an rc 2 that follows a removal which failed part-way (or was undone) has removed what it reached, so "kept" means NOT PROVEN GONE, and the tail keeps and records what stands.
  - `shared/api.ts`: `LifecycleMeas.tmpRootKept: string | null`, `LifecycleMeas.clipsKept: string | null`. `LIFECYCLE_MEAS_KEYS` goes 32 → 34, and these two keys go into `shared/api.ts` in this task's commit like any other L0 edit. Tasks 10 and 11, and any later task that adds a `meas.` key, continue the census from the 34 this task leaves, never from 32 (X3; probe-helper-tail.OPEN10).
  - For Task 7: step (6)'s temp-root removal is the ONE line `_ws_leaf_remove "$HOME/.cc-tmp" "$id"; lfrc=$?`. After Task 6 it sits inside the `0)` arm of the probe's `case`. Task 7 replaces exactly that call with `_ws_tmproot_remove "$id"`.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-leaf-remove.test.ts`:

```ts
// `_ws_leaf_remove` — the ONE removal of a per-session leaf under a box-wide
// root (child reclamation wave 6, spec §5.6) — and the reclaim/expire tail,
// which now removes its clips directory and its temp root through it. What is
// asserted is what stands on disk afterwards and the helper's three-way answer
// (0 removed or absent, PROVEN; 1 refused; 2 unmeasured), never its word alone.
// A leaf the helper does not remove is KEPT by the tail, the act completes, and
// the done row says so — never a refusal, never kept in silence.
// FIXTURE HOME ONLY: every root is under the harness's HOME. The `rm`, `pwd`
// and `_ws_leaf_uid` stubs are shell FUNCTIONS defined in the snippet: they
// shadow the binary or the builtin for that one call and touch nothing else.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { EXP_ID, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-leaf-remove-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-basin';
const ROOT_USER = process.getuid?.() === 0;
const rootOf = (): string => path.join(h.home, 'root');
const leafOf = (): string => path.join(rootOf(), ID);
/** What `rm` is handed for a directory leaf: never across a file-system boundary. */
const RM_TREE = process.platform === 'darwin' ? '-rfx --' : '-rf --one-file-system --';

interface Answer { rc: string; why: string }
const remove = (root: string, id: string, opts: { devino?: string; pre?: string } = {}): Answer => {
  const dv = opts.devino !== undefined ? ` "${opts.devino}"` : '';
  const [rc = '', why = ''] = h.sh(`${opts.pre ?? ''} _ws_leaf_remove "${root}" "${id}"${dv}; rc=$?;`
    + ` printf '%s\\x1f%s' "$rc" "$_WS_LEAF_WHY"`).split('\x1f');
  return { rc, why };
};
/** A leaf with files, a nested directory, and a mode-000 subdirectory holding a file. */
const plantTree = (dir: string): void => {
  fs.mkdirSync(path.join(dir, 'cdk.out', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cdk.out', 'manifest.json'), '{}');
  fs.mkdirSync(path.join(dir, 'locked'));
  fs.writeFileSync(path.join(dir, 'locked', 'x'), 'x');
  fs.chmodSync(path.join(dir, 'locked'), 0o000);
};
const unlock = (dir: string): void => { const l = path.join(dir, 'locked'); if (fs.existsSync(l)) fs.chmodSync(l, 0o755); };

describe('_ws_leaf_remove — removed, or absent: rc 0, PROVEN', () => {
  it('an absent root, and an absent leaf under a present root, answer 0', () => {
    expect(remove(rootOf(), ID).rc).toBe('0');
    fs.mkdirSync(rootOf());
    expect(remove(rootOf(), ID).rc).toBe('0');
    expect(fs.existsSync(rootOf()), 'the root itself is never removed').toBe(true);
  }, 60_000);

  it('a directory leaf — files, a nested directory, a mode-000 subdirectory — is normalised, removed and proven gone', () => {
    plantTree(leafOf());
    try {
      const a = remove(rootOf(), ID);
      expect(a.rc, a.why).toBe('0');
      expect(fs.existsSync(leafOf())).toBe(false);
      expect(fs.existsSync(rootOf()), 'the root stays').toBe(true);
    } finally { unlock(leafOf()); }
  }, 60_000);

  it('a LINK leaf is unlinked, never followed — to a directory, to a file, or dangling', () => {
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'not the session’s');
    fs.mkdirSync(rootOf());
    for (const target of [outside, path.join(outside, 'keep'), path.join(h.home, 'nowhere')]) {
      fs.symlinkSync(target, leafOf());
      const a = remove(rootOf(), ID);
      expect(a.rc, `${target}: ${a.why}`).toBe('0');
      expect(() => fs.lstatSync(leafOf()), 'the link itself is gone').toThrow();
      expect(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'its target is untouched').toBe('not the session’s');
    }
  }, 60_000);

  it('a FILE leaf is unlinked; the root stays', () => {
    fs.mkdirSync(rootOf());
    fs.writeFileSync(leafOf(), 'a file where the leaf should be');
    expect(remove(rootOf(), ID).rc).toBe('0');
    expect(() => fs.lstatSync(leafOf())).toThrow();
    expect(fs.existsSync(rootOf())).toBe(true);
  }, 60_000);

  it('a ROOT that is a link is followed (a data volume) — the leaf under its physical root goes, the link stays', () => {
    const vol = path.join(h.home, 'vol');
    fs.mkdirSync(path.join(vol, ID, 'x'), { recursive: true });
    fs.symlinkSync(vol, rootOf());
    expect(remove(rootOf(), ID).rc).toBe('0');
    expect(fs.existsSync(path.join(vol, ID))).toBe(false);
    expect(fs.lstatSync(rootOf()).isSymbolicLink(), 'the root link stays').toBe(true);
  }, 60_000);

  it('a directory leaf is handed to rm NEVER ACROSS A FILE-SYSTEM BOUNDARY, by its physical path', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: 'rm() { printf "rm %s\\n" "$*" >> "$HOME/rm-calls"; command rm "$@"; };' });
    expect(a.rc, a.why).toBe('0');
    const calls = fs.readFileSync(path.join(h.home, 'rm-calls'), 'utf8').split('\n').filter((l) => l.startsWith('rm -rf'));
    expect(calls).toEqual([`rm ${RM_TREE} ${path.join(fs.realpathSync(rootOf()), ID)}`]);
  }, 60_000);

  it('the leaf’s own dev:ino, when the caller names it, lets it go', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const di = h.sh(`_plat_devino "${leafOf()}"`);
    expect(di, 'the CONTROL: an identity was read').toMatch(/^\d+:\d+$/);
    expect(remove(rootOf(), ID, { devino: di }).rc).toBe('0');
    expect(fs.existsSync(leafOf())).toBe(false);
  }, 60_000);
});

describe('_ws_leaf_remove — refused: rc 1, nothing touched', () => {
  it('an id ccd never mints is refused before anything is looked at', () => {
    fs.mkdirSync(rootOf());
    fs.writeFileSync(path.join(rootOf(), 'keep'), 'k');
    fs.writeFileSync(path.join(h.home, 'sentinel'), 's');
    for (const bad of ['..', '.', 'a/b', '', 'x y']) {
      const a = remove(rootOf(), bad);
      expect(a.rc, `'${bad}': ${a.why}`).toBe('1');
      expect(a.why).toContain('not a session id');
    }
    expect(fs.existsSync(path.join(rootOf(), 'keep'))).toBe(true);
    expect(fs.existsSync(path.join(h.home, 'sentinel'))).toBe(true);
  }, 60_000);

  it('a directory another uid owns is refused, and stands', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: '_ws_leaf_uid() { echo 999999; };' });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('belongs to uid 999999');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('a directory whose physical path is not root/<id> is refused, and stands', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const pre = `pwd() { if [[ "$PWD" == */${ID} ]]; then printf '%s\\n' "$HOME/elsewhere"; else builtin pwd "$@"; fi; };`;
    const a = remove(rootOf(), ID, { pre });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('resolves to');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('a dev:ino that is not the leaf’s is refused, and the leaf stands', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { devino: '1:1' });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('not the 1:1');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('an entry still unreadable after the permission pass refuses the WHOLE leaf — no partial rm', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: "_ws_reclaim_normalise() { _WS_NORMALISE_WHY='stub: x is still unreadable'; return 1; };" });
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain('stub: x is still unreadable');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);
});

describe('_ws_leaf_remove — unmeasured: rc 2, every exit code read', () => {
  it('a permission pass that could not RUN removes nothing', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const a = remove(rootOf(), ID, { pre: "_ws_reclaim_normalise() { _WS_NORMALISE_WHY='stub: the pass could not run'; return 2; };" });
    expect(a.rc, a.why).toBe('2');
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('an rm that fails — a nested mount it would not cross — is UNMEASURED, rm’s own words carried', () => {
    fs.mkdirSync(path.join(leafOf(), 'mnt'), { recursive: true });
    const pre = `rm() { if [[ "$1" == -rf* ]]; then echo "rm: skipping '${leafOf()}/mnt', since it's on a different device" >&2; return 1; fi; command rm "$@"; };`;
    const a = remove(rootOf(), ID, { pre });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('rm exit 1');
    expect(a.why).toContain('different device');
    expect(fs.existsSync(path.join(leafOf(), 'mnt'))).toBe(true);
  }, 60_000);

  it('a link leaf whose unlink fails is UNMEASURED', () => {
    fs.mkdirSync(rootOf());
    fs.symlinkSync(path.join(h.home, 'nowhere'), leafOf());
    const pre = 'rm() { if [[ "$1" == -f && "$2" == -- ]]; then echo "rm: cannot remove: Operation not permitted" >&2; return 1; fi; command rm "$@"; };';
    const a = remove(rootOf(), ID, { pre });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not be unlinked');
  }, 60_000);

  it('a leaf that stands AGAIN after a successful rm is unmeasured, never "removed"', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const pre = `rm() { command rm "$@"; local rc=$?; [[ "$1" == -rf* ]] && mkdir -p "${leafOf()}"; return $rc; };`;
    const a = remove(rootOf(), ID, { pre });
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('stands again');
  }, 60_000);

  it.skipIf(ROOT_USER)('a root that cannot be searched is unmeasured', () => {
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(path.join(locked, 'root', ID), { recursive: true });
    fs.chmodSync(locked, 0o000);
    try {
      expect(remove(path.join(locked, 'root'), ID).rc).toBe('2');
    } finally { fs.chmodSync(locked, 0o755); }
    expect(fs.existsSync(path.join(locked, 'root', ID))).toBe(true);
  }, 60_000);
});

/** The clips leaf (only) reads as another uid's. */
const CLIPS_NOT_OURS = '_ws_leaf_uid() { case "$1" in */.cc-clips/*) echo 999999 ;; *)'
  + ' if [[ "$CCD_OS" == darwin ]]; then stat -f %u "$1"; else stat -c %u "$1"; fi ;; esac; };';
/** rm fails on the clips leaf (only), as a nested mount would make it. */
const CLIPS_RM_FAILS = 'rm() { if [[ "$1" == -rf* && "$*" == *"/.cc-clips/"* ]]; then'
  + ' echo "rm: cannot remove: Device or resource busy" >&2; return 1; fi; command rm "$@"; };';

describe('the tail removes both leaves through the helper — and KEEPS, and says, what it did not remove', () => {
  const plantClips = (id: string): string => {
    const d = path.join(h.home, '.cc-clips', id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'shot.png'), 'png');
    return d;
  };

  it('a clips leaf the helper refuses is KEPT; the reclaim completes, and its done row says so', () => {
    const c = makeChild(h);
    const clips = plantClips(CHILD_ID);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: CLIPS_NOT_OURS });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'worktree').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'branch').toBe('');
    expect(h.reg(CHILD_ID, 'uuid'), 'the row').toBeNull();
    expect(fs.existsSync(path.join(clips, 'shot.png')), 'the clips directory is kept').toBe(true);
    const events = eventsOf(h.home, 'reclaim');
    expect(events.map((e) => e['outcome']), 'a completed act, not a refusal').toEqual(['intent', 'done']);
    const done = events.find((e) => e['outcome'] === 'done')!;
    expect(measOf(done)['clipsKept']).toBe('refused');
    expect(String(done['detail'])).toContain('belongs to uid 999999');
  }, 90_000);

  it('an rm that fails on the clips leaf: kept, `unmeasured`, rm’s words in the detail', () => {
    makeChild(h);
    const clips = plantClips(CHILD_ID);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: CLIPS_RM_FAILS });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(path.join(clips, 'shot.png'))).toBe(true);
    const done = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;
    expect(measOf(done)['clipsKept']).toBe('unmeasured');
    expect(String(done['detail'])).toContain('Device or resource busy');
  }, 90_000);

  // Linux only: on Darwin, Task 6's in-use probe answers unmeasured before the helper is asked.
  it.skipIf(process.platform === 'darwin')('a temp root the helper refuses is KEPT and recorded as `refused`', () => {
    makeChild(h);
    const leaf = path.join(h.home, '.cc-tmp', CHILD_ID);
    fs.mkdirSync(path.join(leaf, 'cdk.out'), { recursive: true });
    const pre = '_ws_leaf_uid() { case "$1" in */.cc-tmp/*) echo 999999 ;; *) stat -c %u "$1" ;; esac; };';
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(path.join(leaf, 'cdk.out'))).toBe(true);
    const done = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;
    expect(measOf(done)['tmpRootKept']).toBe('refused');
    expect(String(done['detail'])).toContain(`temp root ${path.join(h.home, '.cc-tmp', CHILD_ID)} kept (refused)`);
  }, 90_000);

  it('ws-expire’s tail is the same tail: a refused clips leaf is kept, recorded on the `expire` done row', () => {
    makeArchived(h);
    const clips = plantClips(EXP_ID);
    const r = expireVerb(h, expireToken(h), { pre: CLIPS_NOT_OURS });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).expired).toBe(EXP_ID);
    expect(fs.existsSync(path.join(clips, 'shot.png'))).toBe(true);
    const done = eventsOf(h.home, 'expire').find((e) => e['outcome'] === 'done')!;
    expect(measOf(done)['clipsKept']).toBe('refused');
  }, 90_000);

  it('a purge failure after a kept leaf says what was kept — never "clips … gone"', () => {
    makeChild(h);
    plantClips(CHILD_ID);
    const purge3 = '_reg_purge() { REG_PURGE_UNREMOVED="$HOME/x"; return 3; };';
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${CLIPS_NOT_OURS} ${purge3}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(doc.failed).toBe('purge-incomplete');
    expect(doc.detail).toContain('clips kept (refused)');
    expect(doc.detail).not.toContain('clips gone');
    const failed = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'failed')!;
    expect(measOf(failed)['clipsKept']).toBe('refused');
  }, 90_000);

  it('the CONTROL: the same purge failure with nothing kept says the clips went', () => {
    makeChild(h);
    plantClips(CHILD_ID);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: '_reg_purge() { REG_PURGE_UNREMOVED="$HOME/x"; return 3; };' });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as { detail: string }).detail).toContain('clips gone');
  }, 90_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-leaf-remove.test.ts` (FOREGROUND, timeout ≥ 600000 ms)

Expected: FAIL.
- **The three `_ws_leaf_remove` describes:** every case prints `bash: _ws_leaf_remove: command not found` and reads rc `127`, so the assertions fail as `expected '127' to be '0'`, `'1'` or `'2'`. The first case reds at its first `remove`.
- **"a clips leaf the helper refuses":** `the clips directory is kept: expected false to be true`. Today's step ignores `_ws_leaf_uid` and removes the clips leaf.
- **"an rm that fails on the clips leaf":** `expected undefined to be 'unmeasured'`. Today's `rm -rf "$cdir"` has its stub failure thrown away.
- **"a temp root the helper refuses":** `expected false to be true` (the leaf is removed).
- **The expire case:** the clips-kept assertion fails like the reclaim case.
- **"a purge failure after a kept leaf":** `expected 'the reclaim completed — worktree, branch, clips and temp root are gone — …' to contain 'clips kept (refused)'`.
- **The CONTROL:** `… to contain 'clips gone'`.

- [ ] **Step 3: Implement the helper**

In `ccd/ccd`, directly ABOVE `_ws_reclaim_tail() {` (below Task 4's `_ws_path_users` block), insert:

```bash
# ── the ONE removal of a per-session leaf (child reclamation wave 6, spec §5.6) ──
_WS_LEAF_WHY=''
_ws_leaf_uid() {   # path -> the uid that owns the path ITSELF (`ls -dn`: numeric on GNU and BSD, never follows the path's own link); a test's seam
  # Not `stat -c %u`/`stat -f %u`: those spellings live in the platform block
  # alone (macos-platform.test.ts's 'GNU/BSD stat' row refuses them here).
  local l u
  l=$(LC_ALL=C ls -dn -- "$1" 2>/dev/null) || return 1
  read -r _ _ u _ <<< "$l"
  [[ "$u" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$u"
}
_ws_leaf_remove() {   # root id [expect-devino] -> 0 removed, or absent — PROVEN by `_ws_reclaim_absent`;
  #                       1 refused (_WS_LEAF_WHY); 2 unmeasured (_WS_LEAF_WHY)
  # THE ONE REMOVAL of `<root>/<id>`, a per-session leaf under a box-wide root:
  # the reclaim and expiry tail's clips directory and temp root, and wave 7's
  # collector. Extracted from the tail's step (6), which threw away rm's exit
  # code and a failed permission pass, crossed mounts, and never proved the
  # leaf gone. Here:
  # - THE ID is re-validated (ccd's id alphabet, and never `.` or `..`) before
  #   anything is looked at.
  # - THE ROOT is resolved physically (`pwd -P`): it MAY be a link or a mount
  #   (`$HOME/.cc-tmp` is a bind mount on the fleet box). A root that is gone,
  #   PROVEN, holds no leaf: 0.
  # - A LINK OR FILE LEAF is unlinked with `rm -f --`, never followed: `-L` is
  #   asked first, so a link's target, wherever it points, is untouched. Such a
  #   leaf is what `_child_tmpdir`'s rc 2 leaves in place; kept, a recycled
  #   slug would meet it on every spawn.
  # - A DIRECTORY LEAF goes only when it is this uid's own (`_ws_leaf_uid`,
  #   `ls -dn`, never follows it), its physical path
  #   is exactly `<root>/<id>`, and — when the caller names one — its dev:ino
  #   is the one the caller recorded. It is normalised first
  #   (`_ws_reclaim_normalise`: an entry that stays unreadable REFUSES the whole
  #   leaf rather than leave a partial tree; a pass that could not run is
  #   unmeasured), then removed NEVER ACROSS A FILE-SYSTEM BOUNDARY
  #   (`--one-file-system`; BSD's `-x` on Darwin). THE LIMIT, STATED: both
  #   compare `st_dev` alone, so a bind mount of the SAME file system inside
  #   the leaf is crossed (GNU rm's own documented limit); only root can make
  #   one.
  # - EVERY EXIT CODE IS READ, and the answer is a MEASUREMENT: after any
  #   removal the leaf's absence is PROVEN, and a leaf that stands again (a
  #   writer re-created it) is unmeasured, never "removed". rc 2 is not
  #   "untouched": an `rm` that failed part-way removed what it reached, and
  #   the caller keeps and records what stands.
  # - THE CHECKS ARE NOT ATOMIC WITH THE REMOVAL: a same-uid rename onto
  #   `<root>/<id>` between them and the `rm` is removed with it (the
  #   single-user trust model). Wave 7's collector closes this with a
  #   quarantine rename (R57).
  local root="$1" id="$2" want="${3-}" rroot leaf me owner lreal have err rc
  _WS_LEAF_WHY=''
  if ! [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$id" == . || "$id" == .. ]]; then
    _WS_LEAF_WHY="'$id' is not a session id ccd mints, so nothing under $root was touched"; return 1
  fi
  _ws_reclaim_absent "$root"; rc=$?
  (( rc != 0 )) || return 0
  (( rc != 2 )) || { _WS_LEAF_WHY="$_WS_ABSENT_WHY — whether $id stands under it was never asked"; return 2; }
  rroot=$(cd -- "$root" >/dev/null 2>&1 && pwd -P) \
    || { _WS_LEAF_WHY="$root cannot be resolved, so whether $id stands under it was never asked"; return 2; }
  leaf="${rroot%/}/$id"
  if [[ -L "$leaf" || ( -e "$leaf" && ! -d "$leaf" ) ]]; then
    err=$(rm -f -- "$leaf" 2>&1) \
      || { _WS_LEAF_WHY="$leaf could not be unlinked: $(printf '%s' "${err:-rm said nothing}" | head -1)"; return 2; }
  elif [[ -d "$leaf" ]]; then
    me=$(id -u) || { _WS_LEAF_WHY="this uid could not be read, so whether $leaf is ours was never asked"; return 2; }
    owner=$(_ws_leaf_uid "$leaf") || { _WS_LEAF_WHY="who owns $leaf could not be read, so nothing under it was removed"; return 2; }
    [[ "$owner" == "$me" ]] \
      || { _WS_LEAF_WHY="$leaf belongs to uid $owner, not this uid $me — ccd never removes a directory it does not own"; return 1; }
    lreal=$(cd -- "$leaf" >/dev/null 2>&1 && pwd -P) \
      || { _WS_LEAF_WHY="$leaf cannot be entered, so where it resolves was never asked"; return 2; }
    [[ "$lreal" == "$leaf" ]] \
      || { _WS_LEAF_WHY="$leaf resolves to $lreal — ccd never removes a tree it would reach through another path"; return 1; }
    if [[ -n "$want" ]]; then
      have=$(_plat_devino "$leaf" 2>/dev/null) \
        || { _WS_LEAF_WHY="the identity of $leaf could not be read, so nothing under it was removed"; return 2; }
      [[ "$have" == "$want" ]] \
        || { _WS_LEAF_WHY="$leaf is $have, not the $want its record names — a leaf that is not the recorded one is never removed"; return 1; }
    fi
    _ws_reclaim_normalise "$leaf"; rc=$?
    (( rc != 2 )) || { _WS_LEAF_WHY="$_WS_NORMALISE_WHY — nothing under $leaf was removed"; return 2; }
    (( rc != 1 )) || { _WS_LEAF_WHY="$_WS_NORMALISE_WHY — nothing under $leaf was removed"; return 1; }
    if [[ "$CCD_OS" == darwin ]]; then err=$(rm -rfx -- "$leaf" 2>&1); rc=$?
    else err=$(rm -rf --one-file-system -- "$leaf" 2>&1); rc=$?; fi
    (( rc == 0 )) \
      || { _WS_LEAF_WHY="removing $leaf failed (rm exit $rc): $(printf '%s' "${err:-rm said nothing}" | head -1)"; return 2; }
  fi
  _ws_reclaim_absent "$leaf"; rc=$?
  (( rc != 1 )) || { _WS_LEAF_WHY="$leaf stands again after its removal — something re-created it"; return 2; }
  (( rc != 2 )) || { _WS_LEAF_WHY="$_WS_ABSENT_WHY — that $leaf is gone was never proven"; return 2; }
  return 0
}

```

- [ ] **Step 4: Rebuild the tail's step (6) on it, and make the texts true**

(a) In `_ws_reclaim_tail`, directly under `  local noun=reclaim donekey=reclaimed bindkey=childOf` (ccd/ccd:27971), add:

```bash
  local clipskept='' clipswhy='' tmpkept='' tmpwhy='' lfrc cword tword gone dparts
```

(b) Replace the whole of step (6). That runs from the line `  # (6) The artifacts (rule 2): the clips directory under its two existing` (ccd/ccd:28379) through the `  fi` directly above `  # (7) The residue probe` (ccd/ccd:28410). Replace it with:

```bash
  # (6) The artifacts (rule 2), each through `_ws_leaf_remove`, the ONE
  # removal helper (spec §5.6): the clips directory, then the per-session
  # temp root. A leaf the helper refuses, or could not measure, is KEPT: the
  # act still completes, and the done row says so (`meas.clipsKept`,
  # `meas.tmpRootKept`, and why in `detail`) — never kept in silence, and never
  # a refusal. The helper's own header says what it proves before it removes.
  _ws_leaf_remove "$HOME/.cc-clips" "$id"; lfrc=$?
  case "$lfrc" in
    0) : ;;
    1) clipskept=refused; clipswhy="$_WS_LEAF_WHY" ;;
    *) clipskept=unmeasured; clipswhy="$_WS_LEAF_WHY" ;;
  esac
  _ws_leaf_remove "$HOME/.cc-tmp" "$id"; lfrc=$?
  case "$lfrc" in
    0) : ;;
    1) tmpkept=refused; tmpwhy="$_WS_LEAF_WHY" ;;
    *) tmpkept=unmeasured; tmpwhy="$_WS_LEAF_WHY" ;;
  esac
  cword=gone; tword=gone
  [[ -z "$clipskept" ]] || cword="kept ($clipskept)"
  [[ -z "$tmpkept" ]] || tword="kept ($tmpkept)"
  gone="worktree and branch are gone, clips $cword, temp root $tword"
```

(c) In step (8), make three edits:
- In each of the three `_ws_reclaim_fail` purge calls, replace the text `worktree, branch, clips and temp root are gone` with `$gone`. There is one occurrence per call; afterwards `grep -c 'clips and temp root are gone' ccd/ccd` must print `0`.
- Append `meas.clipsKept "$clipskept" meas.tmpRootKept "$tmpkept"` to each of those three calls' key/value lines:
  - the `purge-incomplete` call's line becomes `meas.branch "$branch" meas.unremoved "$REG_PURGE_UNREMOVED" meas.clipsKept "$clipskept" meas.tmpRootKept "$tmpkept"`;
  - each of the other two `meas.branch "$branch"` lines becomes `meas.branch "$branch" meas.clipsKept "$clipskept" meas.tmpRootKept "$tmpkept"`.
- Replace the `_lc_done` call (ccd/ccd:28439 to :28442, from `keptall=$(_ws_reclaim_kept_read "$tomb") || keptall=""` through `    detail "${keptall:+kept branch(es): $keptall}"`) with:

```bash
  keptall=$(_ws_reclaim_kept_read "$tomb") || keptall=""
  dparts="${keptall:+kept branch(es): $keptall}"
  [[ -z "$clipskept" ]] || dparts+="${dparts:+; }clips $HOME/.cc-clips/$id kept ($clipskept): $clipswhy"
  [[ -z "$tmpkept" ]] || dparts+="${dparts:+; }temp root $HOME/.cc-tmp/$id kept ($tmpkept): $tmpwhy"
  _lc_done "$_WS_RCL_ACT" "$id" "$lctx" verb "ws-$_WS_RCL_ACT" "meas.$bindkey" "$childof" meas.branch "$branch" \
    meas.tip "$tip" meas.wip "$wip" meas.tombstone "$tomb" meas.attic "${attic:-0}" \
    meas.residueBytes "$residue" meas.resumed "$resumed" \
    meas.clipsKept "$clipskept" meas.tmpRootKept "$tmpkept" \
    detail "$dparts"
```

(d) Declare the two keys in L0 IN THIS COMMIT. Otherwise `ccd-lifecycle-contain.test.ts` reds with `an unlisted meas key`, and `reviveMeas` drops them at ingest. In `shared/api.ts`, directly after `  readonly residueBytes: string | null;` inside `export interface LifecycleMeas`, add these 11 lines:

```ts
  /** The per-session temp root (`$HOME/.cc-tmp/<id>`) a `reclaim` or `expire`
   *  tail did not prove gone (child reclamation wave 6, spec §5.6): `in-use`
   *  (a process of this uid still used it after the tail's bounded wait),
   *  `unmeasured` (whether one did could not be measured, or a removal failed
   *  part-way or was undone: kept means NOT PROVEN GONE, not untouched) or
   *  `refused` (the helper refused it). The act COMPLETED, so this rides the
   *  `done` row and a purge failure's; `detail` says why. Null: it went, or another act. */
  readonly tmpRootKept: string | null;
  /** The same for the session's clips directory (`$HOME/.cc-clips/<id>`):
   *  `refused` or `unmeasured` only — nothing waits on a clips directory's users. */
  readonly clipsKept: string | null;
```

and change `  unremoved: true, childOf: true, wip: true, residueBytes: true,` in `LIFECYCLE_MEAS_KEY_MAP` to `  unremoved: true, childOf: true, wip: true, residueBytes: true, tmpRootKept: true, clipsKept: true,`.

In `server/src/coord/journalparse.ts`'s `reviveMeas`, directly after the line holding `residueBytes: s(o, 'residueBytes'),`, add:

```ts
    tmpRootKept: s(o, 'tmpRootKept'), clipsKept: s(o, 'clipsKept'),
```

In `server/test/lifecycle-wire.test.ts`, make three edits:
- In `const MEAS`, change `  childOf: null, wip: null, residueBytes: null,` to `  childOf: null, wip: null, residueBytes: null, tmpRootKept: null, clipsKept: null,`.
- In the sorted key list, add `'clipsKept'` and `'tmpRootKept'`. The literal is `.sort()`ed, so where they go does not matter.
- In `const nothing`, change `      unremoved: null, childOf: null, wip: null, residueBytes: null,` to `      unremoved: null, childOf: null, wip: null, residueBytes: null, tmpRootKept: null, clipsKept: null,`.

In `server/test/ccd-lifecycle-contain.test.ts`, make three edits:
- Change the case title `'every meas.<key> ccd writes is on the list, and the list is exactly 32'` to `… exactly 34`.
- Change `expect.soft(all.size, 'LIFECYCLE_MEAS_KEYS drifted from the measured 32').toBe(32);` to `expect.soft(all.size, 'LIFECYCLE_MEAS_KEYS drifted from the measured 34').toBe(34);`.
- Directly under the existing `// 29 -> 32 (child reclamation, wave 3): …` comment paragraph, add:

```ts
    // 32 -> 34 (child reclamation, wave 6): `meas.tmpRootKept` and
    // `meas.clipsKept`, carried by the reclaim/expire tail's done row (and its
    // purge failures) when it KEEPS a leaf the removal helper did not remove.
    // Declared in the SAME commit that first emits them, as wave 3's were.
```

- [ ] **Step 5: Run the tests to verify they pass, then the gates**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-leaf-remove.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-reflogs.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-purge.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tail-contained.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-contain.test.ts test/lifecycle-wire.test.ts test/lifecycle-replay.test.ts test/lifecycle-store.test.ts test/single-definition.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
```

Then run the platform sweep, in the FOREGROUND with a timeout of at least 600000 ms, because `_ws_leaf_uid` is new code outside the platform block:

```bash
(cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts)
```

Expected:
- `ccd-leaf-remove` passes in full (Linux; on macOS the temp-root case is skipped).
- `macos-platform` is green: `_ws_leaf_uid` reads the owner with `ls -dn`, so no `stat -c` or `stat -f` stands outside the platform block (its `'GNU/BSD stat'` row, `ccd/ccd carries no un-shimmed GNU call`).
- The existing verb suites stay green unchanged. Their link-leaf, file-leaf and mode-000-clips cases now run through the helper and assert the same disk state.
- `ccd-lifecycle-contain` is green at 34; `tsc` prints nothing; `mark.mjs --check` exits 0; `ownership` is green.
- `ccd-child-reclaim-tail-contained` (Task 3) stays green with its count still at 6 (X3). This task adds no git deletion to `_ws_reclaim_tail`. The helper's `rm` is not a git call, and the helper sits above `_ws_reclaim_tail() {`, outside the scan's slice. If the scan reds, a git deletion was added to the tail or moved within it. Contain it, and re-pin the count in that test with the cause named. Never loosen the scan.

THE CITATION CASE: the 11 lines added to `shared/api.ts` sit above the README's one `shared/api.ts` sentence. Find that sentence with `grep -n 'shared/api.ts:[0-9]' README.md`, which prints one hit. Your tree already carries wave 5 (#290), so its numbers are wave 5's, not those of `77c11245a`. On #290's head `e79b1da7` it was README.md:4704, citing `shared/api.ts:7808-7810`, `:7850`, `:7858` and `:7871`. (On `77c11245a` it was README.md:4710, citing `:7688-7690`, `:7730`, `:7738` and `:7751`.) These numbers are hints, because #290's fix round 1 may have moved them again. Expect the README case to red on those four anchors. REPAIR them BY CONTENT, never by arithmetic:
- Read the new lines with `grep -n "  | 'purge-refused' \|  | 'purge-incomplete' \|  | 'purge-mechanism-absent'\|^  'purge-refused':\|^  'purge-incomplete':\|^  'purge-mechanism-absent':" shared/api.ts`.
- Re-point the README sentence at what that prints.
- Re-run the describe until it is green.

If anything OTHER than README reds, STOP and report, because a frozen-corpus census is never adjusted here.

- [ ] **Step 6: Mutation check, then commit**

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In `_ws_leaf_remove`, replace `rm -rf --one-file-system -- "$leaf"` with `rm -rf -- "$leaf"` | `cd server && ./node_modules/.bin/vitest run test/ccd-leaf-remove.test.ts` | "NEVER ACROSS A FILE-SYSTEM BOUNDARY": `expected [ 'rm -rf -- …/root/demo-quiet-basin' ] to deeply equal [ 'rm -rf --one-file-system -- …' ]` |
| 2 | Delete the `[[ "$owner" == "$me" ]] \|\| { … return 1; }` statement | same | "another uid owns": `expected '0' to be '1'`; the tail case "a clips leaf the helper refuses": `the clips directory is kept: expected false to be true` |
| 3 | Delete the `[[ "$lreal" == "$leaf" ]] \|\| { … return 1; }` statement | same | "physical path is not root/<id>": `expected '0' to be '1'` |
| 4 | Delete the whole `if [[ -n "$want" ]]; then … fi` block | same | "a dev:ino that is not the leaf’s": `expected '0' to be '1'` |
| 5 | Delete `(( rc == 0 )) \|\| { _WS_LEAF_WHY="removing $leaf failed …"; return 2; }` | same | "an rm that fails": `expected '$HOME/…/mnt stands again after its removal — …' to contain 'rm exit 1'` |
| 6 | Replace the final three lines (`_ws_reclaim_absent "$leaf"; rc=$?` and its two checks) with nothing, leaving `return 0` | same | "stands AGAIN": `expected '0' to be '2'` |
| 7 | Swap the two arms: test `elif [[ -d "$leaf" ]]` FIRST and the link/file arm second | same | "a LINK leaf is unlinked": `expected '1' to be '0'` (the link-to-directory reaches the directory arm and is refused by the physical-path check) |
| 8 | Replace `(( rc != 1 )) \|\| { _WS_LEAF_WHY="$_WS_NORMALISE_WHY — nothing under $leaf was removed"; return 1; }` with nothing | same | "an entry still unreadable … refuses the WHOLE leaf": `expected '0' to be '1'` |
| 9 | Replace `if ! [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] \|\| [[ "$id" == . \|\| "$id" == .. ]]; then` with `if ! [[ "$id" =~ ^[A-Za-z0-9._/-]*$ ]]; then` | same | "an id ccd never mints": `'..': expected '<…> resolves to <…>' to contain 'not a session id'` (the physical-path check still refuses: defence in depth, so this mutation reds on the reason) |
| 10 | In the tail's step (6), replace both `case "$lfrc" in … esac` blocks with `:` | same | "a clips leaf the helper refuses": `expected undefined to be 'refused'` |
| 11 | In step (8), drop `meas.clipsKept "$clipskept"` from the `_lc_done` call | same | "a clips leaf the helper refuses": `expected undefined to be 'refused'` |
| 12 | Restore one purge text to `worktree, branch, clips and temp root are gone` (the `purge-incomplete` call) | same | "a purge failure after a kept leaf": `expected '… clips and temp root are gone …' to contain 'clips kept (refused)'` |
| 13 | Remove `tmpRootKept: true, clipsKept: true,` from `LIFECYCLE_MEAS_KEY_MAP` and the two members from `LifecycleMeas` | `cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-contain.test.ts` | `an unlisted meas key: expected [ 'clipsKept', 'tmpRootKept' ] to deeply equal []` |
| 14 | Delete `(( rc != 2 )) \|\| { _WS_LEAF_WHY="$_WS_NORMALISE_WHY — nothing under $leaf was removed"; return 2; }` (the normalise rc-2 arm) | same | "a permission pass that could not RUN": `expected '0' to be '2'` (the stub's 2 falls through to `rm`, and the leaf goes) |
| 15 | Replace the link arm's two lines `err=$(rm -f -- "$leaf" 2>&1) \` and `\|\| { _WS_LEAF_WHY="$leaf could not be unlinked: …"; return 2; }` with the one line `err=$(rm -f -- "$leaf" 2>&1)` | same | "a link leaf whose unlink fails": `expected '<leaf> stands again after its removal — something re-created it' to contain 'could not be unlinked'` |
| 16 | Replace `_ws_leaf_uid`'s body with `stat -c %u "$1"` | `(cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts -t 'ccd/ccd carries no un-shimmed GNU call')` | `ccd/ccd runs a GNU-only command outside the platform block — …: expected [ 'GNU/BSD stat: stat -c %u "$1"' ] to deeply equal []` |

THE ROOT'S rc-2 ARM HAS NO RED OF ITS OWN. Deleting `(( rc != 2 )) || { _WS_LEAF_WHY="$_WS_ABSENT_WHY — whether $id stands under it was never asked"; return 2; }` leaves "a root that cannot be searched" green, because the `cd -- "$root"` resolution directly below it fails on the same root and answers the same 2. That arm is defence in depth, backstopped by the resolution, and no row pins it alone.

Revert each mutation, re-stamp, and re-run the Step 5 commands green. Then:

```bash
git add ccd/ccd shared/api.ts server/src/coord/journalparse.ts server/test/ccd-lifecycle-contain.test.ts \
  server/test/lifecycle-wire.test.ts server/test/ccd-leaf-remove.test.ts
git add README.md   # only if Step 5 repaired its shared/api.ts anchors
git commit -m "$(cat <<'MSG'
feat(ccd): one removal helper for a session's leaves; the tail keeps and says

_ws_leaf_remove removes <root>/<id> only when the id is one ccd mints, the
root resolves, and a directory leaf is this uid's own at exactly root/id
(and the recorded dev:ino when one is given). It never follows a link
leaf, never crosses a file-system boundary, reads every exit code, and
proves the leaf
gone. It answers removed-or-absent, refused or unmeasured. The reclaim and
expiry tail removes its clips directory and temp root through it. A leaf
it did not remove is kept, the act completes, and the done row records it
in meas.clipsKept / meas.tmpRootKept with the reason in detail. The purge
failure texts no longer claim the leaves are gone when they are not.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

### Task 6: The tail waits, bounded, for the pane's processes, and keeps a temp root still in use

**Model routing:** **`opus`, effort `high`**. This is SAFETY-critical: it decides whether `ws-reclaim` and `ws-expire` delete a directory that a live process still writes into. It also reproduces the measured incident.

**Why:** This is contract R49's tail ruling, and it closes the measured `swift-hollow` race. After the kill, the tail waits, bounded, until `_ws_path_users` answers nobody for the temp root. The bound is at most 15 s. Only then does it remove the leaf through the helper. If the probe still answers in use or unmeasured, the tail KEEPS the leaf (and, from Task 7, its witness), completes the reclaim, and records the kept leaf in the done row as `meas.tmpRootKept` (`in-use` or `unmeasured`). That is not a refusal. The wait comes BEFORE everything the tail deletes, so the worktree's removal is unchanged except for the wait. A straggler writing into a removed worktree path after the bound is a stated residual.

On Darwin the probe answers unmeasured (Task 4), so a Darwin reclaim always keeps a DIRECTORY temp root that stands. That is what R49 rules. A link or file leaf is no one's temp root: `_child_tmpdir` composes `TMPDIR` only for a real directory (its rc 2 composes none), and unlinking such a leaf touches nothing it names. So step (6) never asks the probe of one: it is unlinked as wave 3 unlinks it, on every platform (wave 3's recycled-slug rule). Two existing assertions that expect a directory temp root gone become Linux-only. Wave 3's link and file pins (`ccd-child-reclaim-verb-tail.test.ts:143` and `:151`) stay unconditional.

The tail also stays inside its remote budget: `ws-reclaim` and `ws-expire` each have 240 s in `server/src/remote/runner.ts` (`grep -n "'ws-reclaim': 240_000" server/src/remote/runner.ts`). The worst case this adds is the bound plus two walks, about 35 s, not 15 s. The wait reads the clock only after each `_ws_path_users` returns, so a walk begun just before the 15 s bound may run its full `WS_PATH_USERS_SCAN_S` (10 s), and step (6)'s re-ask may run another 10 s, plus the quarter-second sleeps. That is well inside the 240 s.

The header of `_ws_expire_cwd_users` at ccd/ccd:28878 to :28880 (`grep -n 'a reclaim never meets it' ccd/ccd`) says "a reclaim never meets it". R49 found that false, so it is corrected here. The correction is comment lines only, and the function's code is untouched (R56). It sits in workspace-lifecycle's EXPIRE region, and the coordinator has accepted it as comment-only (probe-helper-tail.DEP3).

**This reaches `ws-expire` (X2).** `ws-expire` calls the same tail, so it runs the wait and step (6)'s re-ask too. The coordinator tells workspace-lifecycle (`ccrc-pwa-quiet-river`) before dispatch. The worker names both in the wave-done: the wait, and the comment lines in `_ws_expire_cwd_users`' header.

**Files:**
- Modify: `ccd/ccd`. Make five edits, all below ccd/ccd:19109. The line numbers below are hints at `77c11245a`; locate each edit by its quoted text or grep on your own tree:
  1. Insert the wait constant and two functions directly ABOVE `_ws_reclaim_tail() {`, after Task 5's helper.
  2. Add `tmpq` to Task 5's `local` line in `_ws_reclaim_tail`.
  3. Add ONE call after the pane re-measure's `esac` (ccd/ccd:28067 at `77c11245a`; it is the `esac` directly above `  # THE TOMBSTONE IS THE ONE SOURCE for what this tail deletes`).
  4. Replace Task 5's temp-root lines in step (6).
  5. Rewrite the three header comment lines of `_ws_expire_cwd_users`.
- Modify: `server/test/ccd-child-reclaim-verb.test.ts` (:65), and `server/test/ccd-child-reclaim-verb-tail.test.ts` (:199). Each assertion that a DIRECTORY temp root is gone becomes Linux-only. The link and file pins at `ccd-child-reclaim-verb-tail.test.ts:143` and `:151` are NOT touched: those leaves are never kept for their users, and are unlinked on every platform.
- Test: `server/test/ccd-child-reclaim-tmproot-wait.test.ts` (new)

**Interfaces:**
- Consumes:
  - Task 4's `_ws_path_users`, `_WS_PATH_USERS_WHY`, and `holdProc`/`Held` from `server/test/pathUsersFixture.ts`.
  - Task 5's `_ws_leaf_remove`, `meas.tmpRootKept`, and the tail locals `tmpkept`, `tmpwhy`, `lfrc`.
  - `_plat_epoch_ms` (ccd/ccd:381).
  - `verbHelpers` (`KILL`) from `server/test/childReclaimVerbHelpers.ts`.
- Produces:
  ```bash
  WS_RECLAIM_TMPROOT_WAIT_S=15          # the bound; R49: at most 15 s
  CCD_RECLAIM_TMPROOT_WAIT_S            # env override: a whole number BELOW the bound lowers it; anything else is ignored
  _ws_reclaim_tmproot_wait_s            # -> prints the effective bound, whole seconds
  _ws_reclaim_tmproot_quiet <path>      # -> _ws_path_users' LAST answer (0/1/2), asked every 0.25 s until 0 or the bound; Darwin: asked once
  ```
  - Done row (both flavours): `meas.tmpRootKept` is `in-use` (the probe still answered 1 at the instant of removal), `unmeasured` (the probe answered 2, or the helper did), or `refused` (the helper refused). The row's `detail` carries `temp root <path> kept (<word>): <why>`. A probe's `in-use` or `unmeasured` is recorded only while something stands at the leaf (`_ws_reclaim_absent` answers 1 or 2): over nothing, nothing is kept and nothing is recorded. A link or file leaf is never kept for its users: step (6) hands it to the helper, which unlinks it, on every platform.
  - **The tail's ONE wait knob (X3).** `CCD_RECLAIM_TMPROOT_WAIT_S` is the only way a case shortens the wait. Task 7's keep cases, and any later case that reaches step (6) with a stubbed in-use or unmeasured `_ws_path_users`, set `CCD_RECLAIM_TMPROOT_WAIT_S=0`, never a stubbed `sleep`. At 0, `_ws_reclaim_tmproot_quiet` asks once and returns without sleeping. The bound row `'0' -> '0'` and the case "a bound of 0 asks exactly once" pin that.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-child-reclaim-tmproot-wait.test.ts`:

```ts
// The reclaim tail's bounded wait for the pane's processes (child reclamation
// wave 6, spec §5.6). MEASURED 2026-10-04: the tail removed
// `~/.cc-tmp/ccrc-pwa-swift-hollow` while the killed pane's processes still
// ran with TMPDIR=<leaf>, and one re-created the leaf 3.7 s after `reclaim
// done`. Now the tail asks `_ws_path_users` after the kill, until it answers
// nobody or the bound passes, and asks again at the instant of removal; a leaf
// still in use, or unmeasured, is KEPT and recorded, and the act completes.
// The stragglers are REAL processes (`pathUsersFixture.ts`), spawned by vitest
// — never by ccd — with TMPDIR inside the fixture HOME.
// FIXTURE HOME ONLY: `CHILD_STUBS` records the unit and pane calls; the bound
// is lowered through `CCD_RECLAIM_TMPROOT_WAIT_S`, which can only lower it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { EXP_ID, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';
import { holdProc, type Held } from './pathUsersFixture.js';

let h: PrHarness;
let held: Held[] = [];
beforeEach(() => { h = makePrHarness('ccrc-tmproot-wait-'); held = []; });
afterEach(() => { for (const p of held) p.stop(); h.cleanup(); });
const { KILL } = verbHelpers(() => h);
const hold = (o: Parameters<typeof holdProc>[0]): Held => { const p = holdProc(o); held.push(p); return p; };
const LINUX = process.platform === 'linux';
const leafOf = (id: string): string => path.join(h.home, '.cc-tmp', id);
const doneOf = (act: string): Record<string, unknown> => eventsOf(h.home, act).find((e) => e['outcome'] === 'done')!;
const probes = (): string[] => h.calls().filter((l) => l.startsWith('probe'));

describe('the bound: at most 15 s, and the override can only LOWER it', () => {
  it.each([
    [undefined, '15'], ['3', '3'], ['0', '0'], ['007', '7'], ['15', '15'],
    ['16', '15'], ['99', '15'], ['abc', '15'], ['', '15'], ['-1', '15'],
  ] as const)('CCD_RECLAIM_TMPROOT_WAIT_S=%s -> %s', (v, want) => {
    const set = v === undefined ? 'unset CCD_RECLAIM_TMPROOT_WAIT_S;' : `CCD_RECLAIM_TMPROOT_WAIT_S='${v}';`;
    expect(h.sh(`${set} _ws_reclaim_tmproot_wait_s`)).toBe(want);
  }, 60_000);
});

describe('_ws_reclaim_tmproot_quiet — asked until nobody, or the bound', () => {
  const COUNTING = (nobodyAt: number): string =>
    `_ws_path_users() { echo probe >> "$HOME/ccd-calls"; [[ $(grep -c '^probe' "$HOME/ccd-calls") -ge ${nobodyAt} ]] && return 0; return 1; };`;

  it('asks every quarter second until nobody — three asks, then 0', () => {
    const rc = h.sh(`CCD_OS=linux; CCD_RECLAIM_TMPROOT_WAIT_S=5; ${COUNTING(3)} _ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/x"; printf '%s' "$?"`);
    expect(rc).toBe('0');
    expect(probes()).toHaveLength(3);
  }, 60_000);

  it('a bound of 0 asks exactly once, and answers what it was told', () => {
    const rc = h.sh(`CCD_OS=linux; CCD_RECLAIM_TMPROOT_WAIT_S=0; ${COUNTING(99)} _ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/x"; printf '%s' "$?"`);
    expect(rc).toBe('1');
    expect(probes()).toHaveLength(1);
  }, 60_000);

  it('on Darwin it asks ONCE — waiting cannot change an answer that never looks', () => {
    const t0 = Date.now();
    const rc = h.sh('CCD_OS=darwin; CCD_RECLAIM_TMPROOT_WAIT_S=5;'
      + ' _ws_path_users() { echo probe >> "$HOME/ccd-calls"; return 2; };'
      + ' _ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/x"; printf \'%s\' "$?"');
    expect(rc).toBe('2');
    expect(probes()).toHaveLength(1);
    expect(Date.now() - t0, 'it did not sit out the bound').toBeLessThan(4_000);
  }, 60_000);
});

describe('the tail', () => {
  it('waits AFTER the kill and BEFORE the worktree goes, then asks again at the instant of removal', () => {
    const c = makeChild(h);
    fs.mkdirSync(leafOf(CHILD_ID), { recursive: true });
    const pre = `_ws_path_users() { if [[ -d "${c.wt}" ]]; then echo "probe wt-present $1" >> "$HOME/ccd-calls";`
      + ` else echo "probe wt-gone $1" >> "$HOME/ccd-calls"; fi; _WS_PATH_USERS_WHY=''; return 0; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(probes()).toEqual([`probe wt-present ${leafOf(CHILD_ID)}`, `probe wt-gone ${leafOf(CHILD_ID)}`]);
    expect(h.calls().indexOf(KILL), 'the kill comes first').toBeLessThan(h.calls().indexOf(probes()[0]!));
    expect(fs.existsSync(leafOf(CHILD_ID)), 'nobody: the helper removed it').toBe(false);
  }, 90_000);

  it('a probe that answers UNMEASURED keeps the temp root; the act completes and says why', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(leafOf(CHILD_ID), 'cdk.out'), { recursive: true });
    const pre = "CCD_RECLAIM_TMPROOT_WAIT_S=1; _ws_path_users() { _WS_PATH_USERS_PIDS=''; _WS_PATH_USERS_WHY='stub: not measured'; return 2; };";
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(fs.existsSync(path.join(leafOf(CHILD_ID), 'cdk.out')), 'kept').toBe(true);
    const done = doneOf('reclaim');
    expect(measOf(done)['tmpRootKept']).toBe('unmeasured');
    expect(String(done['detail'])).toContain('stub: not measured');
  }, 90_000);

  it.each(['link', 'file'] as const)('a %s leaf is no one’s temp root: never kept for its users — unlinked on every platform, its target untouched', (shape) => {
    makeChild(h);
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'not the child’s');
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    if (shape === 'link') fs.symlinkSync(outside, leafOf(CHILD_ID));
    else fs.writeFileSync(leafOf(CHILD_ID), 'a file where the root should be');
    // The Darwin answer, forced on any host: the probe cannot measure. A link or file leaf goes anyway.
    const pre = "CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=''; _WS_PATH_USERS_WHY='stub: not measured'; return 2; };";
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(() => fs.lstatSync(leafOf(CHILD_ID)), `the ${shape} leaf itself is unlinked`).toThrow();
    expect(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'its target is untouched').toBe('not the child’s');
    expect(fs.existsSync(path.join(h.home, '.cc-tmp')), 'the root itself stays').toBe(true);
    expect(measOf(doneOf('reclaim'))['tmpRootKept'], 'nothing was kept').toBeUndefined();
  }, 90_000);

  it.each([['in use', 1], ['unmeasured', 2]] as const)('a probe answering %s over a temp root that does NOT stand records nothing — kept means something stands', (_label, rc) => {
    // Every Darwin `ws-expire` of a non-child meets this: the probe answers unmeasured, and no temp root ever stood.
    makeArchived(h);
    expect(fs.existsSync(leafOf(EXP_ID)), 'the CONTROL: no temp root stands').toBe(false);
    const pre = `CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=4242; _WS_PATH_USERS_WHY='stub: answered ${rc}'; return ${rc}; };`;
    const r = expireVerb(h, expireToken(h), { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).expired).toBe(EXP_ID);
    const done = doneOf('expire');
    expect(measOf(done)['tmpRootKept']).toBeUndefined();
    expect(String(done['detail'] ?? ''), 'no detail claims a temp root was kept').not.toContain('temp root');
  }, 90_000);
});

/** A straggler: it waits for the kill (the `_ws_unsupervise` stub below touches `killed` right before
 *  the tail's kill), then for 8 s it re-creates the leaf the moment it disappears — the swift-hollow
 *  write — and otherwise writes into the leaf that stands and exits. `$2` records which it did. */
const STRAGGLER = [
  'k="$1"; out="$2"; i=0',
  'while [ ! -e "$k" ] && [ "$i" -lt 1200 ]; do sleep 0.05; i=$((i+1)); done',
  'i=0',
  'while [ "$i" -lt 160 ]; do',
  '  if [ ! -d "$TMPDIR" ]; then mkdir -p "$TMPDIR"; echo late > "$TMPDIR/late"; echo recreated > "$out"; exit 0; fi',
  '  sleep 0.05; i=$((i+1))',
  'done',
  'echo late > "$TMPDIR/late"; echo wrote-in-place > "$out"',
].join('\n');
const MARK_KILL = '_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; : > "$HOME/killed"; };';

describe.skipIf(!LINUX)('real stragglers (Linux /proc)', () => {
  it('THE SWIFT-HOLLOW RACE: a straggler with TMPDIR=<leaf> that outlives the kill is waited for, and the leaf goes after it', async () => {
    makeChild(h);
    const leaf = leafOf(CHILD_ID);
    fs.mkdirSync(path.join(leaf, 'cdk.out'), { recursive: true });
    const branch = path.join(h.home, 'straggler-branch');
    const s = hold({ cwd: h.home, tmpdir: leaf, script: STRAGGLER, args: [path.join(h.home, 'killed'), branch] });
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${MARK_KILL} CCD_RECLAIM_TMPROOT_WAIT_S=14;` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    await s.exited;
    expect(fs.readFileSync(branch, 'utf8').trim(), 'the straggler outlived the kill and wrote while the leaf stood')
      .toBe('wrote-in-place');
    expect(fs.existsSync(leaf), 'the straggler did not re-create the leaf after the reclaim').toBe(false);
    expect(measOf(doneOf('reclaim'))['tmpRootKept'], 'nothing was kept').toBeUndefined();
  }, 120_000);

  it('a straggler that outlives the BOUND: the reclaim completes, the temp root is KEPT and recorded `in-use`', () => {
    const c = makeChild(h);
    const leaf = leafOf(CHILD_ID);
    fs.mkdirSync(leaf, { recursive: true });
    fs.writeFileSync(path.join(leaf, 'scratch'), 'kept');
    const s = hold({ cwd: h.home, tmpdir: leaf });
    const t0 = Date.now();
    const r = childReclaimVerb(h, evalOf(h).token, { pre: 'CCD_RECLAIM_TMPROOT_WAIT_S=2;' });
    expect(Date.now() - t0, 'the tail sat out its bound').toBeGreaterThanOrEqual(2_000);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'worktree').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'branch').toBe('');
    expect(h.reg(CHILD_ID, 'uuid'), 'the row').toBeNull();
    expect(fs.readFileSync(path.join(leaf, 'scratch'), 'utf8'), 'the temp root is kept').toBe('kept');
    const events = eventsOf(h.home, 'reclaim');
    expect(events.map((e) => e['outcome']), 'a completed act, not a refusal').toEqual(['intent', 'done']);
    const done = doneOf('reclaim');
    expect(measOf(done)['tmpRootKept']).toBe('in-use');
    expect(String(done['detail'])).toContain(`temp root ${leaf} kept (in-use)`);
    expect(String(done['detail'])).toContain(`process ${s.pid} carries TMPDIR=${leaf}`);
  }, 120_000);

  it('ws-expire’s tail waits and keeps the same way — `in-use` on the expire done row', () => {
    makeArchived(h);
    const leaf = leafOf(EXP_ID);
    fs.mkdirSync(leaf, { recursive: true });
    hold({ cwd: h.home, tmpdir: leaf });
    const r = expireVerb(h, expireToken(h), { pre: 'CCD_RECLAIM_TMPROOT_WAIT_S=1;' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).expired).toBe(EXP_ID);
    expect(fs.existsSync(leaf)).toBe(true);
    expect(measOf(doneOf('expire'))['tmpRootKept']).toBe('in-use');
  }, 120_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tmproot-wait.test.ts` (FOREGROUND, timeout ≥ 600000 ms)

Expected: FAIL.
- **The bound rows:** `expected '' to be '15'`, and so on. `_ws_reclaim_tmproot_wait_s: command not found` goes to stderr and stdout is empty.
- **The three `_ws_reclaim_tmproot_quiet` cases:** `expected '127' to be '0'`, `'1'`, `'2'`.
- **"waits AFTER the kill":** `expected [] to deeply equal [ 'probe wt-present …', 'probe wt-gone …' ]`, because the tail never asks.
- **"UNMEASURED keeps":** `kept: expected false to be true`.
- **THE SWIFT-HOLLOW RACE:** `the straggler outlived the kill and wrote while the leaf stood: expected 'recreated' to be 'wrote-in-place'`. Task 5's tail removes the leaf at once, and the straggler re-creates it. This reproduces the measured incident.
- **"outlives the BOUND":** `the tail sat out its bound: expected <n> to be greater than or equal to 2000`, or `the temp root is kept` fails.
- **The expire case:** `expected false to be true`.
- **The `link` and `file` leaf cases, and the two "does NOT stand" cases, PASS.** Task 5's tail never asks the probe: it unlinks a link or file leaf, and records nothing over a leaf that is not there. They pin that Task 6 keeps it so; their reds are mutation rows 10, 11 and 12.

- [ ] **Step 3: Implement the wait**

In `ccd/ccd`, directly ABOVE `_ws_reclaim_tail() {` (below Task 5's `_ws_leaf_remove`), insert:

```bash
# ── the tail's bounded wait for the pane's processes (child reclamation wave 6, spec §5.6) ──
WS_RECLAIM_TMPROOT_WAIT_S=15   # the longest the reclaim/expiry tail waits, after its kill, for the pane's processes
#                                to stop using the temp root. R49: never more than 15.
_ws_reclaim_tmproot_wait_s() {   # -> the bound, whole seconds: WS_RECLAIM_TMPROOT_WAIT_S, or
  #                                 CCD_RECLAIM_TMPROOT_WAIT_S when that is a whole number BELOW it
  # THE OVERRIDE ONLY LOWERS — a test's knob, so a case need not sit out 15 s.
  # A larger value, an empty one, or one that is not a whole number leaves the
  # bound where it is. `10#` because `08` is not octal here.
  local b="$WS_RECLAIM_TMPROOT_WAIT_S" o="${CCD_RECLAIM_TMPROOT_WAIT_S-}"
  if [[ "$o" =~ ^[0-9]{1,6}$ ]] && (( 10#$o < b )); then b=$(( 10#$o )); fi
  printf '%s' "$b"
}
_ws_reclaim_tmproot_quiet() {   # path -> `_ws_path_users`' LAST answer (0/1/2), asked until it says nobody
  #                                or `_ws_reclaim_tmproot_wait_s` seconds have passed
  # Asked every quarter second. ON DARWIN the probe answers unmeasured without
  # looking, so it is asked ONCE: waiting cannot change that answer.
  local p="$1" bound end rc
  bound=$(_ws_reclaim_tmproot_wait_s)
  end=$(( $(_plat_epoch_ms) + bound * 1000 ))
  while :; do
    _ws_path_users "$p"; rc=$?
    (( rc != 0 )) || return 0
    [[ "$CCD_OS" != darwin ]] || return "$rc"
    (( $(_plat_epoch_ms) < end )) || return "$rc"
    sleep 0.25
  done
}

```

In `_ws_reclaim_tail`:

(a) Append ` tmpq` to Task 5's line, so it reads `  local clipskept='' clipswhy='' tmpkept='' tmpwhy='' lfrc cword tword gone dparts tmpq`.

(b) Directly after the pane re-measure's `  esac` (the one above `  # THE TOMBSTONE IS THE ONE SOURCE for what this tail deletes, fresh and`; ccd/ccd:28067 at `77c11245a`), insert:

```bash
  # THE PANE'S PROCESSES ARE WAITED FOR, BOUNDED (spec §5.6). The pane is
  # gone, but its processes need not be: MEASURED 2026-10-04, a straggler with
  # `TMPDIR=<leaf>` re-created a child's temp root 3.7 s after `reclaim done`.
  # So the tail asks `_ws_path_users` of the temp root until it answers
  # nobody, for at most `_ws_reclaim_tmproot_wait_s` seconds, BEFORE anything
  # further is deleted: the worktree's removal below runs after this wait and
  # is otherwise unchanged (a writer into a removed worktree path after the
  # bound is a stated residual). Not a gate: step (6) asks again at the
  # instant of removal, and in use or unmeasured there, the temp root is KEPT
  # and said, and the act still completes.
  _ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/$id" || :   # its answer is re-asked at step (6)
```

(c) In step (6), replace Task 5's temp-root lines, from `  _ws_leaf_remove "$HOME/.cc-tmp" "$id"; lfrc=$?` through the `  esac` that closes its `case "$lfrc" in`, with:

```bash
  # THE TEMP ROOT'S USERS ARE ASKED AGAIN, AT THIS INSTANT (spec §5.6): the
  # wait after the kill delayed everything since, and this is the answer the
  # removal acts on. Nobody: the helper removes it. In use, or unmeasured (on
  # Darwin, always): the leaf is KEPT, and said — but only a leaf that STANDS
  # is kept: over nothing, nothing is recorded.
  # A LINK OR FILE LEAF is no one's temp root (`_child_tmpdir` composes TMPDIR
  # only for a real directory), and unlinking it touches nothing it names: it
  # is never kept for its users, on any platform (spec §5.6; wave 3's
  # recycled-slug rule), so the probe is not asked of it.
  if [[ -L "$HOME/.cc-tmp/$id" || ( -e "$HOME/.cc-tmp/$id" && ! -d "$HOME/.cc-tmp/$id" ) ]]; then
    tmpq=0
  else
    _ws_path_users "$HOME/.cc-tmp/$id"; tmpq=$?
  fi
  case "$tmpq" in
    0) _ws_leaf_remove "$HOME/.cc-tmp" "$id"; lfrc=$?
       case "$lfrc" in
         0) : ;;
         1) tmpkept=refused; tmpwhy="$_WS_LEAF_WHY" ;;
         *) tmpkept=unmeasured; tmpwhy="$_WS_LEAF_WHY" ;;
       esac ;;
    1) if _ws_reclaim_absent "$HOME/.cc-tmp/$id"; then :   # nothing stands there: nothing is kept
       else tmpkept=in-use; tmpwhy="still in use after the bounded wait — $_WS_PATH_USERS_WHY"; fi ;;
    *) if _ws_reclaim_absent "$HOME/.cc-tmp/$id"; then :   # nothing stands there: nothing is kept
       else tmpkept=unmeasured; tmpwhy="$_WS_PATH_USERS_WHY"; fi ;;
  esac
```

(d) Correct the false header. In `_ws_expire_cwd_users`, replace exactly these three comment lines (ccd/ccd:28878 to :28880):

```bash
  # AMENDMENT 3 (3962), ASKED OF AN EXPIRY ONLY — a reclaim never meets it (a
  # finished child's tail kills its pane by design, and a process in its tree is
  # its run's). `_ws_expire_presence` calls it for the fresh ladder's rung 5 and
```

with:

```bash
  # AMENDMENT 3 (3962), ASKED OF AN EXPIRY ONLY. A reclaim DOES meet a finished
  # child's processes — the pane's process tree can outlive the tail's kill
  # (measured 2026-10-04: a straggler re-created a removed temp root 3.7 s after
  # `reclaim done`) — but the tail asks `_ws_path_users` of the temp root, after
  # its kill, instead of this (spec §5.6). `_ws_expire_presence` calls it for the fresh ladder's rung 5 and
```

Only comment lines change, and the function's code is byte-identical. Check with `git diff -U0 ccd/ccd | grep '^[-+][^-+#]' | grep -v '^[-+]  *#'`: it must print nothing from inside `_ws_expire_cwd_users`.

(e) The two existing assertions that expect a DIRECTORY temp root gone become Linux-only. On Darwin the probe answers unmeasured, so the tail keeps a directory leaf that stands (R49). Each line stays where it is:

- `server/test/ccd-child-reclaim-verb.test.ts` (:65). Replace `expect(fs.existsSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'temp root').toBe(false);` with:
  ```ts
    // Darwin: the in-use probe answers unmeasured there, so the tail KEEPS the temp root (contract R49).
    expect(fs.existsSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'temp root').toBe(process.platform === 'darwin');
  ```
- `server/test/ccd-child-reclaim-verb-tail.test.ts` (:199). Prefix `expect(fs.existsSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'temp root').toBe(false);` with `if (process.platform !== 'darwin') `, and add one comment above it: `// Darwin keeps the temp root: the in-use probe answers unmeasured there (contract R49).`
- `ccd-child-reclaim-verb-tail.test.ts:143` (`the leaf symlink is unlinked`) and `:151` (`the leaf file is unlinked`) stay UNCONDITIONAL and unedited. A link or file leaf is never handed to the probe (step (6) above), so it is unlinked on Darwin too. Making them Darwin-aware would drop wave 3's pin of the recycled-slug rule.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tmproot-wait.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-path-users.test.ts test/ccd-leaf-remove.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-reflogs.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts test/ccd-ws-expire-ladder.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tail-contained.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-contain.test.ts
```

Expected: all green.
- **The new suite:** the race case takes about 8 s (the straggler's window), and the bound case about 2 s.
- **The existing verb suites:** each tail now runs two process-table walks. Record each suite's wall time before (on Task 5's commit) and after. If any suite approaches the 600 s foreground ceiling, STOP and report rather than splitting it here.
- **ws-expire-ladder:** proves the expiry probe's code is unchanged.
- **tail-contained (Task 3):** green, with its count still at 6 (X3). The wait line and step (6)'s re-ask add no git deletion to `_ws_reclaim_tail`, and the two new functions sit above `_ws_reclaim_tail() {`, outside the scan's slice. If it reds, contain the call and re-pin the count with the cause named. Never loosen the scan.

- [ ] **Step 5: Re-stamp, then the gates**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
grep -c 'a reclaim never meets it' ccd/ccd
```

Expected:
- `mark.mjs --check` exits 0, `ownership` is green, and the citation describe is green (every edit is below ccd/ccd:19109).
- The last `grep -c` prints `0`.

- [ ] **Step 6: Mutation check, then commit**

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | Delete the tail's line `  _ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/$id" \|\| :   # its answer is re-asked at step (6)` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tmproot-wait.test.ts` | "waits AFTER the kill": `expected [ 'probe wt-gone …' ] to deeply equal [ 'probe wt-present …', 'probe wt-gone …' ]`; THE SWIFT-HOLLOW RACE: `the straggler did not re-create the leaf after the reclaim`, because the leaf is kept `in-use` at step (6): `expected true to be false` |
| 2 | Restore the pre-wave behaviour: delete the wait line AND replace step (6)'s probe block (from `if [[ -L "$HOME/.cc-tmp/$id"` through its `fi`) and its `case "$tmpq"` with Task 5's bare `_ws_leaf_remove "$HOME/.cc-tmp" "$id"; lfrc=$?` and its `case "$lfrc"` | same | THE SWIFT-HOLLOW RACE: `expected 'recreated' to be 'wrote-in-place'`; "outlives the BOUND": `the temp root is kept` fails (ENOENT reading `scratch`) |
| 3 | In `_ws_reclaim_tmproot_wait_s`, replace `(( 10#$o < b ))` with `(( 10#$o != b ))` | same | `CCD_RECLAIM_TMPROOT_WAIT_S=99 -> 15`: `expected '99' to be '15'` |
| 4 | Replace `WS_RECLAIM_TMPROOT_WAIT_S=15` with `WS_RECLAIM_TMPROOT_WAIT_S=30` | same | `CCD_RECLAIM_TMPROOT_WAIT_S=undefined -> 15`: `expected '30' to be '15'` |
| 5 | In `_ws_reclaim_tmproot_quiet`, delete `[[ "$CCD_OS" != darwin ]] \|\| return "$rc"` | same | "on Darwin it asks ONCE": `expected [ 'probe', 'probe', … ] to have a length of 1 but got <n>` |
| 6 | In `_ws_reclaim_tmproot_quiet`, replace `(( $(_plat_epoch_ms) < end )) \|\| return "$rc"` with `return "$rc"` | same | "three asks, then 0": `expected '1' to be '0'`; THE SWIFT-HOLLOW RACE reds as row 1 |
| 7 | In step (8)'s `_lc_done`, drop `meas.tmpRootKept "$tmpkept"` | same | "outlives the BOUND": `expected undefined to be 'in-use'` |
| 8 | In step (6), swap the two kept words: the `1)` arm's `tmpkept=in-use` becomes `tmpkept=unmeasured`, and the `*)` arm's `tmpkept=unmeasured` becomes `tmpkept=in-use` | same | "outlives the BOUND": `expected 'unmeasured' to be 'in-use'`; "UNMEASURED keeps": `expected 'in-use' to be 'unmeasured'` |
| 9 | Replace step (6)'s re-ask `_ws_path_users "$HOME/.cc-tmp/$id"; tmpq=$?` with `tmpq=0`; the wait line stays | same | "outlives the BOUND": `the temp root is kept` fails (ENOENT reading `scratch`): the wait alone, with no re-ask at the instant of removal, removes a leaf still in use |
| 10 | Replace the probe block `if [[ -L "$HOME/.cc-tmp/$id" \|\| … ]]; then tmpq=0; else …; fi` with its `else` arm alone, `_ws_path_users "$HOME/.cc-tmp/$id"; tmpq=$?` | same | "a link leaf is no one’s temp root": `the link leaf itself is unlinked: expected [Function] to throw an error`; the `file` row the same. On Darwin, `ccd-child-reclaim-verb-tail.test.ts`'s `the leaf symlink is unlinked` and `the leaf file is unlinked` red too |
| 11 | In the `1)` arm, replace `if _ws_reclaim_absent "$HOME/.cc-tmp/$id"; then : … else tmpkept=in-use; tmpwhy=…; fi` with `tmpkept=in-use; tmpwhy="still in use after the bounded wait — $_WS_PATH_USERS_WHY"` | same | "a probe answering in use over a temp root that does NOT stand": `expected 'in-use' to be undefined` |
| 12 | In the `*)` arm, replace `if _ws_reclaim_absent "$HOME/.cc-tmp/$id"; then : … else tmpkept=unmeasured; tmpwhy=…; fi` with `tmpkept=unmeasured; tmpwhy="$_WS_PATH_USERS_WHY"` | same | "a probe answering unmeasured over a temp root that does NOT stand": `expected 'unmeasured' to be undefined` |

Revert each mutation, re-stamp (`bash ccd/ccrc restamp ccd/ccd`), and re-run Step 4 green. Then:

```bash
git add ccd/ccd server/test/ccd-child-reclaim-tmproot-wait.test.ts \
  server/test/ccd-child-reclaim-verb.test.ts server/test/ccd-child-reclaim-verb-tail.test.ts
git commit -m "$(cat <<'MSG'
fix(ccd): the reclaim tail waits for the pane's processes before its temp root goes

Measured: a reclaimed child's temp root came back 3.7 s after reclaim done,
re-created by a pane process whose TMPDIR named it. After its kill the
tail now asks _ws_path_users of the temp root until nobody uses it, for at
most 15 s (an env override can only lower it). That wait comes before
anything further is deleted. The tail asks again at the instant of
removal. A temp root still in use, or unmeasured (always on Darwin), is
kept and recorded as meas.tmpRootKept on the done row, and the act
completes. The expiry probe's header no longer says a reclaim never meets
a process.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

### Task 7: The temp root's positive witness: `$REG/tmproots/<id>`, written on rc 0 and removed only after the leaf

**Model routing:** `opus`, effort `high`. This task is SAFETY-critical. It changes what the reclaim tail deletes and in which order, and it writes the file that wave 7's collector will trust as its only proof that a leaf is ccd's.

**Why:**
- **What R50 rules.** `_child_tmpdir`'s rc-0 arm must leave a positive witness: one versioned key=value line, `v=1 id=<id> run=<run> dev=<n> ino=<n> btime=<n|-> uid=<n> at=<ms>`, at `$REG/tmproots/<id>`.
  - The values are taken by stat of the leaf right after the mkdir and chmod.
  - It is written with a temp file and then `mv`, and only when the witness is absent, or its dev, ino or btime no longer match the leaf, or its `run` no longer matches the marker.
  - **`run` joins the staleness test** (the coordinator's ruling on witness.OPEN1). So a slug's new child overwrites the witness on its first rc 0, as R50 says, even when it inherits the old child's KEPT leaf with the SAME inode (a human verb, or the tail's in-use arm, left the leaf and its witness behind, and ws-add handed the slug out again). That same-inode recycled-slug case is pinned.
  - It is never written on rc 1 or rc 2, and a spawn never fails because the write failed.
  - It dies only after the removal helper has proven the leaf absent, so a leaf the tail keeps because it is in use keeps its witness too.
  - Nothing in this wave reads it to decide anything. Wave 7's collector will.
- **Where the leaf comes from today.** `_child_tmpdir` (`ccd/ccd:20384` at `77c11245a`, `grep -n '^_child_tmpdir() {' ccd/ccd`) is the only writer of `~/.cc-tmp/<id>`.
  - Its one caller is `_spawn_start`'s `ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR='$ctmp'"` (`ccd/ccd:20741`). So it runs on every spawn of a marked child, and so does the witness check.
  - It runs inside `$( )`, so the witness write must print nothing on stdout. Warnings go to stderr, as rc 2's do.
- **Why `$REG/tmproots/` is invisible to every registry walker.** R50 sets aside the scout's dot-prefixed proposal and follows the `pools/` precedent: `ccd/ccd:1237`, `grep -n 'THE PROJECT POOL TAG lives in a DOTLESS' ccd/ccd`, and `POOLS_DIR="$REG/pools"` at `ccd/ccd:1252`. I measured every registry walker at `77c11245a`:
  - **Shell globs.** Seventeen globs over the registry in the shipped shell under `ccd/` are all suffix-shaped:
    - `ccd`: `"$REG"/*.project` at `:9379`, `"$REG"/*.workspace` at `:10767` and `:15239`, and `"$REG"/*.uuid` at `:25053` (`cmd_ls`, i.e. `ccd ls`) and `:25193`;
    - `ccd-account-health:224`: `*-authdead.tmp.*`;
    - `ccd-graph-sweep:87`: `*.workdir`;
    - `ccd-telemetry-keepalive:520`: `*.wrapper`;
    - `ccrc:3395`, `:8072` and `:8161`: `*.uuid`;
    - `ccrc-adopt:569`: `*.wrapper`;
    - `ccrc-doctor-checks:3580`, `:5350` and `:6585`: `*.project`, `*.uuid` and `*.wrapper`;
    - `session-hook.sh:518`: `*.uuid`.

    Measure them with `grep -nE '(\$\{?(REG|_SVC_REG|reg)\}?|\.cc-sessions)"?/\*' ccd/*`.
  - **`find` over the registry.** The three registry `find`s are all `-maxdepth 1` and `-name`-filtered: `ccd:25711` (`_ws_reclaim_workdir_shared`), and `session-hook.sh:1433` and `:1449`.
  - **The per-id globs.** These are `"$REG/$id".*` in `_reg_purge` (`ccd/ccd:4034`), `_ws_slug_free` (`:6528`) and `_ws_slug_residue` (`:6564`). They need a literal dot after the id, so they cannot match a dotless directory. The witness files sit one level further down in any case.
  - **Python.** The only Python walker is `os.listdir(registry)` at `ccd/ccd-usage-sweep.py:233`, and it keeps only names ending in `.uuid`.
  - **The server.** Its registry reads filter by suffix or by exact name, for example `names.filter((n) => n.endsWith('.uuid'))` at `server/src/registry.ts:1119`. They already tolerate `pools`, so they need no change.
  - **Consequences.**
    - `_reg_purge` does not take the witness, so it outlives the row (R25's case).
    - `_ws_slug_free` does not count it.
    - `ccd ls` does not list it.

    This task's census test holds every walker to that shape, so a future bare `"$REG"/*` turns the suite red.
- **No census test changes.**
  - **The dot-prefixed inventory.** `ccd-account-auth.test.ts`'s "the dot-prefixed registry inventory is a census, not a memory" (`server/test/ccd-account-auth.test.ts:174`) scans `$REG/.<name>` literals only.
    - The witness directory has no dot.
    - The writer's temp file is dot-leading but sits inside `tmproots/` (`"$dir/.$id.…tmp"`), so no `$REG/.` literal is added.
    - Its cardinal stays at TWELVE, and `_reg_purge`'s R-3 paragraph (`ccd/ccd:6339`, `grep -n '# R-3, wave review.' ccd/ccd`) needs no edit. That paragraph sits above the frozen anchor, so leaving it alone also keeps it length-neutral.
  - **The `_reg_get` census** (`grep -n 'invocations across' ccd/ccd`, `ccd/ccd:3138`) does not move. `_child_runid_valid "$(_reg_get "$id" child)"` becomes `run=$(_reg_get "$id" child)`: one occurrence on one line, before and after. Add no other `_reg_get` call.
  - **The run-id spelling census** (`server/test/ccd-ws-add-child.test.ts:134`, "spells the literal run-id pattern once") refuses a second `[0-9]{0,9}`. So the reader matches `run=([^ ]+)` and judges the run with `_child_runid_valid`. It copies `BASH_REMATCH` first, because that call's own `=~` resets it.
  - **The "one function reads the marker" pin** (`server/test/ccd-child-tmpdir.test.ts:275`) stays green. The new functions never call `_child_tmpdir`, and `type _child_tmpdir` still contains `_reg_get "$id" child`.
- **btime, and why it needs a platform helper.** `macos-platform.test.ts` refuses `stat -c` and `stat -f` outside the platform block (its `'GNU/BSD stat'` row, `server/test/macos-platform.test.ts:156`). The block is byte-identical in `ccd/ccd` (sentinels `:41` and `:1221`) and `ccd/ccrc` (`:70` and `:1250`). So `_plat_btime` joins the block in both files.
  - **How it reads.** It runs GNU `stat -c %W` on Linux and BSD `stat -f %B` on Darwin, both in whole epoch seconds.
  - **When the filesystem keeps no birth time.** Both print 0 (BSD may print -1), and the witness records `-`. It then binds dev and ino only.
  - **When stat fails.** A failed stat writes nothing, because unmeasured is never `-`. Darwin writes a witness like Linux does: only the in-use probe is Linux-first (R49).
  - **Measured on the fleet's userland** (GNU coreutils 9.4, kernel 6.8): `%W` answers a real birth time on ext4 and on tmpfs, equal to node's `birthtimeNs / 1e9`.
  - **Length-neutral edit.** Both edits sit above the frozen citation anchor, and `ccd/ccrc` is a cited file too: `'ccd/ccrc': 5` in `session-hook.test.ts`'s `byFile` map. R56 therefore requires the edit to change no line count, and it achieves that by collapsing the three-line `_plat_size` into the one-line shape `_plat_ctime` already has.
- **uid is the `-O` test.** It asks whether the leaf's owner is this process's effective uid. Only after it passes is `$EUID` recorded, so the recorded value is the stat'd owner and not an assumption.
- **The removal order** lives in `_ws_tmproot_remove`:
  1. `_ws_leaf_remove "$HOME/.cc-tmp" <id> [<devino>]` (Task 5);
  2. on its rc 0, and only then (the leaf removed or proven absent by `_ws_reclaim_absent`), `rm -f` of the witness.

  A crash between the two leaves a witness with no leaf, which is nothing to do and is cleaned next time. The reverse order could leave a leaf with no witness, which no collector may ever take. The tail's temp-root call switches to this helper. Task 6's kept arm calls neither helper, so a kept leaf keeps its witness. `ws-expire` runs the same `_ws_reclaim_tail`, so this switch reaches it with no edit in the EXPIRE region; the worker names it in the wave-done beside Tasks 5 and 6's helper and wait (X2).

**Files:**
- Modify: `ccd/ccd`. Four edits:
  - **The platform block.** Replace `_plat_size` (`ccd/ccd:262`, `grep -n '^_plat_size() {' ccd/ccd`) and add `_plat_btime`, length-neutral.
  - **The `_child_tmpdir` header and body** (`ccd/ccd:20351` and `:20384`).
  - **A new witness block** directly after `_child_tmpdir`'s closing brace, before `# ── \`ws-add --child <runId>\``.
  - **The RECLAIM region.**
    - Add `_ws_tmproot_remove` directly after Task 5's `_ws_leaf_remove`.
    - In `_ws_reclaim_tail`'s artifacts step, change the one temp-root call.
- Modify: `ccd/ccrc`: the same platform-block edit (`ccd/ccrc:291`, `grep -n '^_plat_size() {' ccd/ccrc`), byte for byte. The worker names this edit in the wave-done, for workspace-lifecycle (`ccrc-pwa-quiet-river`), whose wave 3b may touch the same platform block (X2; witness.OPEN3 accepted).
- Create: `server/test/ccd-child-tmproot-witness.test.ts`.
- Modify: `server/test/macos-platform.test.ts`: one row in the "the Linux arms are the original GNU commands" table, after the `_plat_ctime` row (`:329`).
- Test, as regressions only: `server/test/ccd-child-tmpdir.test.ts`, `ccd-child-reclaim-verb-tail.test.ts`, `ccd-ws-expire-verb.test.ts`, `ccd-ws-add-child.test.ts`, `ccd-reg-get-census.test.ts`, `ccd-account-auth.test.ts`, `ccd-authdead.test.ts`, `ccd-project-pool.test.ts`, `ccd-die-containment.test.ts` and `ownership.test.ts`.

**Interfaces:**
- Produces:
  ```bash
  _plat_btime <file>                                  # -> birth time, epoch seconds; 0 (BSD: may be -1) when the filesystem keeps none
  _ws_tmproot_witness_file <id>                       # prints "$REG/tmproots/<id>"
  _ws_tmproot_witness_write <id> <leaf> <run>         # rc 0 written-or-current | 1 not written (the caller warns)
  _ws_tmproot_witness_read <id>                       # rc 0 parsed (sets _WS_WIT_DEV _WS_WIT_INO _WS_WIT_BTIME _WS_WIT_RUN _WS_WIT_UID _WS_WIT_AT) | 1 absent | 2 unreadable or malformed
  _ws_tmproot_remove <id> [<expect-devino>]           # _ws_leaf_remove "$HOME/.cc-tmp" <id> [<devino>]; on its rc 0 rm -f the witness; returns the helper's rc; an id _ws_tmproot_id_ok refuses is rc 1 (_WS_LEAF_WHY) with nothing asked or touched
  ```
  The file format is one line plus LF, keys in this order: `v=1 id=<id> run=<run-id> dev=<decimal> ino=<decimal> btime=<positive decimal or -> uid=<decimal> at=<13-digit epoch ms>`. An internal helper `_ws_tmproot_id_ok <id>` is not part of the interface. It holds the tail's id shape and refuses any dot-leading id, because dot-leading names in `tmproots/` are the writer's own temp files. The reader, the writer and `_ws_tmproot_remove` each ask it first.
- Consumes:
  - from Task 5: `_ws_leaf_remove <root> <id> [<expect-devino>]` with rc 0, 1 or 2 and `_WS_LEAF_WHY`;
  - from Task 6: `_ws_path_users`, which this task's tail cases stub, the tail's kept arm, and its wait knob `CCD_RECLAIM_TMPROOT_WAIT_S` (it can only lower the bound), which this task's keep cases set to `0`;
  - shipped helpers: `_child_runid_valid`, `_plat_devino`, `_plat_epoch_ms`, `_reg_get`, `_reg_purge`, `_ws_slug_free`, `_ws_slug_residue`, `cmd_ls`;
  - test fixtures: `makePrHarness` and `childReclaimFixture.ts`'s `makeChild`, `evalOf`, `childReclaimVerb`, `CHILD_ID`.

**Entry conditions, checked before Step 1 from the repository root:**

Every line number in this task is a hint, measured at `77c11245a`. Locate code by the grep anchor beside it. The worker's tree already contains wave 5 (#290, merged before dispatch); at its measured tip wave 5 edits nothing under `ccd/`, but Tasks 1 to 6 move `ccd/ccd`'s lines before this task runs.
- `grep -c '^_ws_leaf_remove() {' ccd/ccd` prints `1` (Task 5 landed).
- `grep -c '^_ws_path_users() {' ccd/ccd` prints `1` (Task 4 landed).
- `grep -c '_ws_leaf_remove "\$HOME/.cc-tmp"' ccd/ccd` prints `1`: the tail's temp-root call, as Tasks 5 and 6 left it. If Task 5 spelled the root through a variable, `grep -n '_ws_leaf_remove ' ccd/ccd` must show exactly one call whose root is the temp root. Stop and report if it does not.
- `grep -c 'tmproots' ccd/ccd` prints `0`, and `grep -c '^_plat_btime()' ccd/ccd ccd/ccrc` prints `0` for each file.
- `grep -n '^_plat_size() {    # <file> -> size in bytes$' ccd/ccd ccd/ccrc` prints one hit in each file.
- Record the platform block's end lines for Step 3's neutrality check: `grep -n '^# ── END PLATFORM LAYER' ccd/ccd ccd/ccrc` (`1221` and `1250` at `77c11245a`).

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-child-tmproot-witness.test.ts`:

```ts
// Child-reclamation wave 6, Task 7: the temp root's POSITIVE WITNESS
// (contract §12, R50, with R49's removal order).
//
// `_child_tmpdir`'s rc-0 arm writes `$REG/tmproots/<id>`: one versioned
// key=value line binding the leaf's dev, ino and birth time to the run that
// minted it. It is rewritten only when absent or stale, never written on rc 1
// or rc 2, and a failed write never fails a spawn. It dies only after
// `_ws_leaf_remove` has PROVEN the leaf absent (`_ws_tmproot_remove`), so a
// leaf the tail keeps because it is in use keeps its witness too.
//
// FIXTURE HOMES ONLY (`makePrHarness`). The tail cases run the sourced verb
// with the unit, the pane and the in-use probe stubbed (`CHILD_STUBS`, `pre`);
// nothing here runs ccd against the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-tmproot-witness-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const wdir = (): string => path.join(h.home, '.cc-sessions', 'tmproots');
const witness = (id: string = ID): string => path.join(wdir(), id);
const leaf = (id: string = ID): string => path.join(h.home, '.cc-tmp', id);

/** `ccd-child-tmpdir.test.ts`'s seed: the three fields `_spawn_start` refuses
 *  without, plus the marker when given. */
const seed = (id: string, child: string | null): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
  if (child !== null) h.sh(`_reg_set ${id} child '${child}'`);
};

/** A snippet's merged stdout and stderr, and its status — never a throw. */
const run = (snippet: string): { code: number; out: string } => {
  const r = h.run(`exec 2>&1; ${snippet}`);
  return { code: r.code, out: r.stdout + r.stderr };
};

/** The witness as [key, value] pairs, in file order. */
const fieldsOf = (p: string = witness()): Array<[string, string]> =>
  fs.readFileSync(p, 'utf8').replace(/\n$/, '').split(' ').map((kv) => {
    const i = kv.indexOf('=');
    return [kv.slice(0, i), kv.slice(i + 1)] as [string, string];
  });
const field = (k: string, p: string = witness()): string | undefined =>
  fieldsOf(p).find(([key]) => key === k)?.[1];

/** What the witness must say about `p`, measured by NODE's stat — never by ccd. */
const measured = (p: string): { dev: string; ino: string; btime: string; uid: string } => {
  const st = fs.statSync(p, { bigint: true });
  const bt = st.birthtimeNs / 1_000_000_000n;
  return { dev: String(st.dev), ino: String(st.ino), btime: bt > 0n ? String(bt) : '-', uid: String(process.getuid?.()) };
};
const LINE = /^v=1 id=(\S+) run=(\S+) dev=\d+ ino=\d+ btime=(?:[1-9]\d*|-) uid=\d+ at=\d{13}\n$/;

describe('_child_tmpdir writes the witness on rc 0, and only on rc 0 (R50)', () => {
  it('rc 0 writes ONE versioned line binding the leaf’s dev, ino, btime and uid to the run — silently', () => {
    seed(ID, '7');
    const before = Date.now();
    const r = run(`_child_tmpdir ${ID}; echo "[rc=$?]"`);
    const after = Date.now();
    expect(r.out, 'rc 0 prints the path and nothing else — a witness write is silent').toBe(`${leaf()}[rc=0]`);
    expect(fs.readFileSync(witness(), 'utf8')).toMatch(LINE);
    expect(fieldsOf().map(([k]) => k)).toEqual(['v', 'id', 'run', 'dev', 'ino', 'btime', 'uid', 'at']);
    expect(field('id')).toBe(ID);
    expect(field('run')).toBe('7');
    expect({ dev: field('dev'), ino: field('ino'), btime: field('btime'), uid: field('uid') }).toEqual(measured(leaf()));
    const at = Number(field('at'));
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
    expect(fs.readdirSync(wdir()), 'temp file then mv: nothing else is left in tmproots/').toEqual([ID]);
  });

  it('a leaf that already exists with no witness — one older than this wave — is witnessed on its next spawn', () => {
    seed(ID, '7');
    fs.mkdirSync(leaf(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(leaf(), 'scratch'), 'x');
    expect(fs.existsSync(witness())).toBe(false);
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(field('ino')).toBe(measured(leaf()).ino);
  });

  it('a CURRENT witness is never rewritten — its own inode and bytes stand across respawns', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const ino = fs.statSync(witness()).ino;
    const bytes = fs.readFileSync(witness(), 'utf8');
    h.sh(`_child_tmpdir ${ID} >/dev/null; _child_tmpdir ${ID} >/dev/null`);
    expect(fs.statSync(witness()).ino, 'rewritten: a respawn replaced a current witness').toBe(ino);
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
  });

  it('a leaf REPLACED by a new inode is re-witnessed — by a new file moved into place, never a write in place', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const oldLeafIno = field('ino');
    const oldWitnessIno = fs.statSync(witness()).ino;
    // Renamed AWAY, not removed: the old inode stays allocated, so the new
    // leaf cannot be handed the same inode number (ext4 reuses freed ones).
    fs.renameSync(leaf(), `${leaf()}.old`);
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(field('ino')).toBe(measured(leaf()).ino);
    expect(field('ino')).not.toBe(oldLeafIno);
    expect(fs.statSync(witness()).ino, 'the witness was written in place, not temp file then mv').not.toBe(oldWitnessIno);
    expect(fs.readdirSync(wdir())).toEqual([ID]);
  });

  it.each(['dev', 'ino', 'btime'] as const)('a witness whose %s alone no longer matches the leaf is stale, and rewritten', (key) => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const good = fs.readFileSync(witness(), 'utf8');
    const wrong = key === 'btime' ? '1' : '999999';
    fs.writeFileSync(witness(), good.replace(new RegExp(` ${key}=[^ ]+ `), ` ${key}=${wrong} `));
    expect(field(key), 'the CONTROL: the plant took').toBe(wrong);
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(field(key)).toBe(measured(leaf())[key]);
  });

  it('a malformed witness is stale too — rewritten whole', () => {
    seed(ID, '7');
    fs.mkdirSync(wdir(), { recursive: true });
    fs.writeFileSync(witness(), 'not a witness\n');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(fs.readFileSync(witness(), 'utf8')).toMatch(LINE);
  });

  it.each([['0'], ['-1']])('btime is "-" where the filesystem keeps none (stat answered %s)', (bt) => {
    seed(ID, '7');
    h.sh(`_plat_btime() { printf '%s' -- '${bt}'; }; _child_tmpdir ${ID} >/dev/null`);
    expect(field('btime')).toBe('-');
  });

  it('a recycled slug: the new child’s first rc 0 overwrites the old child’s witness', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    h.sh(`_reg_purge ${ID}`);                    // the old row goes; the witness outlives it (R25's case)
    fs.renameSync(leaf(), `${leaf()}.old`);      // and its leaf (kept allocated: a distinct inode below)
    seed(ID, '8');                               // ws-add hands the slug out again, to run 8
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(field('run')).toBe('8');
    expect(field('ino')).toBe(measured(leaf()).ino);
  });

  it('a recycled slug that inherits a KEPT leaf — the SAME inode — is re-witnessed for its new run (run joins the staleness test)', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const leafIno = field('ino');
    const oldWitnessIno = fs.statSync(witness()).ino;
    h.sh(`_reg_purge ${ID}`);                    // the old row goes; its leaf and witness are KEPT (a human verb, or the tail's in-use arm)
    seed(ID, '8');                               // ws-add hands the slug out again, to run 8
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(measured(leaf()).ino, 'the CONTROL: the new child inherited the SAME leaf').toBe(leafIno);
    expect(field('run'), 'a same-inode witness still names the old run').toBe('8');
    expect({ dev: field('dev'), ino: field('ino'), btime: field('btime'), uid: field('uid') }).toEqual(measured(leaf()));
    expect(fs.statSync(witness()).ino, 'the witness was written in place, not temp file then mv').not.toBe(oldWitnessIno);
    expect(fs.readdirSync(wdir())).toEqual([ID]);
  });

  it.each([[null], ['abc'], ['07']])('rc 1 (marker %j) writes nothing — not even tmproots/', (child) => {
    seed(ID, child);
    expect(run(`_child_tmpdir ${ID}; echo "[rc=$?]"`).out).toBe('[rc=1]');
    expect(fs.existsSync(wdir())).toBe(false);
  });

  it('rc 2 (a symlinked leaf) writes nothing', () => {
    seed(ID, '7');
    const target = path.join(h.home, 'elsewhere');
    fs.mkdirSync(target);
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    fs.symlinkSync(target, leaf());
    expect(run(`_child_tmpdir ${ID}; echo "[rc=$?]"`).out).toContain('[rc=2]');
    expect(fs.existsSync(witness())).toBe(false);
  });

  it('rc 2 leaves an EARLIER witness exactly as it was — never rewritten, never removed', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const bytes = fs.readFileSync(witness(), 'utf8');
    const ino = fs.statSync(witness()).ino;
    fs.rmSync(leaf(), { recursive: true, force: true });
    fs.writeFileSync(leaf(), 'a file where the leaf was');
    expect(run(`_child_tmpdir ${ID}; echo "[rc=$?]"`).out).toContain('[rc=2]');
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
    expect(fs.statSync(witness()).ino).toBe(ino);
  });
});

describe('a witness that cannot be written never fails the spawn — it warns', () => {
  it('tmproots/ unmakeable (a FILE stands there): rc 0, the path, and a warning', () => {
    seed(ID, '7');
    fs.writeFileSync(wdir(), 'in the way');
    const r = run(`_child_tmpdir ${ID}; echo "[rc=$?]"`);
    expect(r.out).toContain(`${leaf()}[rc=0]`);
    expect(r.out).toContain(`ccd: warn: ${ID}'s temp root`);
  });

  it('a DIRECTORY at the witness path is refused — nothing is moved inside it, no temp file is left', () => {
    seed(ID, '7');
    fs.mkdirSync(witness(), { recursive: true });
    const r = run(`_child_tmpdir ${ID}; echo "[rc=$?]"`);
    expect(r.out).toContain(`${leaf()}[rc=0]`);
    expect(r.out).toContain(`ccd: warn: ${ID}'s temp root`);
    expect(fs.readdirSync(witness()), 'mv moved the temp file INSIDE the directory').toEqual([]);
    expect(fs.readdirSync(wdir())).toEqual([ID]);
  });

  it('a stat that FAILS writes nothing and warns — unmeasured is never "-"', () => {
    seed(ID, '7');
    const r = run(`_plat_btime() { return 1; }; _child_tmpdir ${ID}; echo "[rc=$?]"`);
    expect(r.out).toContain(`${leaf()}[rc=0]`);
    expect(r.out).toContain(`ccd: warn: ${ID}'s temp root`);
    expect(fs.existsSync(witness())).toBe(false);
  });
});

describe('_ws_tmproot_witness_write refuses what is not a child’s own leaf', () => {
  const plants: Array<[string, (p: string) => void]> = [
    ['a symlink', (p) => { fs.mkdirSync(path.join(h.home, 'target')); fs.symlinkSync(path.join(h.home, 'target'), p); }],
    ['a regular file', (p) => { fs.writeFileSync(p, 'x'); }],
  ];
  it.each(plants)('a leaf that is %s', (_label, plant) => {
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    plant(leaf());
    expect(run(`_ws_tmproot_witness_write ${ID} '${leaf()}' 7; echo "[rc=$?]"`).out).toBe('[rc=1]');
    expect(fs.existsSync(witness())).toBe(false);
  });

  it.each([['abc'], ['07'], ['']])('a run outside the run-id grammar (%j)', (runId) => {
    fs.mkdirSync(leaf(), { recursive: true });
    expect(run(`_ws_tmproot_witness_write ${ID} '${leaf()}' '${runId}'; echo "[rc=$?]"`).out).toBe('[rc=1]');
    expect(fs.existsSync(wdir())).toBe(false);
  });

  it.each([['.hidden-id'], ['..'], ['a/b']])('an id that could name another file (%j)', (id) => {
    fs.mkdirSync(leaf(), { recursive: true });
    expect(run(`_ws_tmproot_witness_write '${id}' '${leaf()}' 7; echo "[rc=$?]"`).out).toBe('[rc=1]');
    expect(fs.existsSync(wdir())).toBe(false);
  });
});

describe('_ws_tmproot_witness_read: parsed, absent, or unreadable — three answers', () => {
  const GOOD = `v=1 id=${ID} run=7 dev=2064 ino=35 btime=- uid=1000 at=1791277099334\n`;
  const SEED = 'demo-good-seed';
  const plant = (text: string, id: string = ID): void => {
    fs.mkdirSync(wdir(), { recursive: true });
    fs.writeFileSync(witness(id), text);
  };
  /** Reads a GOOD witness first, so a failing read must also CLEAR every field. */
  const read = (id: string = ID): string => {
    plant(GOOD.replace(`id=${ID}`, `id=${SEED}`), SEED);
    return run(`_ws_tmproot_witness_read ${SEED} >/dev/null; _ws_tmproot_witness_read '${id}'; `
      + `printf '[rc=%s] %s|%s|%s|%s|%s|%s' "$?" "$_WS_WIT_RUN" "$_WS_WIT_DEV" "$_WS_WIT_INO" "$_WS_WIT_BTIME" "$_WS_WIT_UID" "$_WS_WIT_AT"`).out;
  };

  it('rc 0 sets every field', () => {
    plant(GOOD);
    expect(read()).toBe('[rc=0] 7|2064|35|-|1000|1791277099334');
  });

  it('rc 1 when nothing stands there — and every field is cleared', () => {
    expect(read()).toBe('[rc=1] |||||');
  });

  it.each([
    ['no trailing newline', GOOD.slice(0, -1)],
    ['a second line', `${GOOD}${GOOD}`],
    ['another id', GOOD.replace(`id=${ID}`, 'id=demo-quiet-reef')],
    ['a run outside the grammar', GOOD.replace('run=7', 'run=07')],
    ['a locale-widened digit', GOOD.replace('run=7', 'run=1²')],
    ['an unknown version', GOOD.replace('v=1', 'v=2')],
    ['keys out of order', GOOD.replace('dev=2064 ino=35', 'ino=35 dev=2064')],
    ['btime 0 (the writer spells that -)', GOOD.replace('btime=-', 'btime=0')],
    ['an oversize body', `${GOOD.slice(0, -1)}${' '.repeat(600)}\n`],
  ])('rc 2 for %s', (_label, text) => {
    plant(text);
    expect(read()).toBe('[rc=2] |||||');
  });

  it('rc 2 for a directory, and for a symlink to a GOOD witness — a link is never followed', () => {
    fs.mkdirSync(witness(), { recursive: true });
    expect(read()).toBe('[rc=2] |||||');
    fs.rmdirSync(witness());
    plant(GOOD, 'demo-quiet-reef');
    fs.symlinkSync(witness('demo-quiet-reef'), witness());
    expect(read()).toBe('[rc=2] |||||');
  });

  it('rc 2 for an id that could name another file', () => {
    expect(read('../x')).toBe('[rc=2] |||||');
    expect(read('.tmp')).toBe('[rc=2] |||||');
  });
});

describe('_ws_tmproot_remove: the witness dies only after the leaf is PROVEN absent', () => {
  /** A recording `_ws_leaf_remove`: its argc and argv, and whether the witness
   *  still stood at the instant it ran. */
  const STUB = (rc: number): string =>
    `_ws_leaf_remove() { { printf '%s|' "$#" "$@"; [[ -e "$REG/tmproots/${ID}" ]] && printf present; echo; } >> "$HOME/leaf-calls";`
    + ` _WS_LEAF_WHY="stub-why"; return ${rc}; };`;
  const calls = (): string[] => fs.readFileSync(path.join(h.home, 'leaf-calls'), 'utf8').split('\n').filter(Boolean);
  const root = (): string => path.join(h.home, '.cc-tmp');

  it('the REAL helper: the leaf and its witness both go, and tmproots/ itself stays', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    fs.writeFileSync(path.join(leaf(), 'scratch'), 'x');
    expect(run(`_ws_tmproot_remove ${ID}; echo "[rc=$?]"`).out).toBe('[rc=0]');
    expect(fs.existsSync(leaf())).toBe(false);
    expect(fs.existsSync(witness())).toBe(false);
    expect(fs.statSync(wdir()).isDirectory()).toBe(true);
  });

  it('a witness with NO leaf is nothing to do, and is cleaned', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    fs.rmSync(leaf(), { recursive: true, force: true });
    expect(run(`_ws_tmproot_remove ${ID}; echo "[rc=$?]"`).out).toBe('[rc=0]');
    expect(fs.existsSync(witness())).toBe(false);
  });

  it('the leaf goes FIRST: the witness still stood when the removal helper ran', () => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    expect(run(`${STUB(0)} _ws_tmproot_remove ${ID}; echo "[rc=$?]"`).out).toBe('[rc=0]');
    expect(calls()).toEqual([`2|${root()}|${ID}|present`]);
    expect(fs.existsSync(witness())).toBe(false);
  });

  it.each([[1], [2]])('helper rc %i is passed through, _WS_LEAF_WHY with it, and the witness stands byte-identical', (rc) => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    const bytes = fs.readFileSync(witness(), 'utf8');
    expect(run(`${STUB(rc)} _ws_tmproot_remove ${ID}; echo "[rc=$?] $_WS_LEAF_WHY"`).out).toBe(`[rc=${rc}] stub-why`);
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
  });

  it('an expected dev:ino is handed through, and its absence is never an empty third argument', () => {
    run(`${STUB(0)} _ws_tmproot_remove ${ID} 5:6; _ws_tmproot_remove ${ID}`);
    expect(calls()).toEqual([`3|${root()}|${ID}|5:6|`, `2|${root()}|${ID}|`]);
  });

  // A collector walking tmproots/ must never turn a writer's in-flight temp
  // file into a leaf to remove: the id is refused before the helper is asked.
  it.each([['.demo-quiet-mesa.4242.17.tmp'], ['.x']])('an id no witness is named for (%j) answers 1 and touches nothing — a planted file of that name stands', (id) => {
    fs.mkdirSync(wdir(), { recursive: true });
    fs.writeFileSync(witness(id), 'a writer’s in-flight temp file');
    expect(run(`${STUB(0)} _ws_tmproot_remove '${id}'; echo "[rc=$?] $_WS_LEAF_WHY"`).out)
      .toBe(`[rc=1] '${id}' is not an id a witness is named for, so nothing was touched`);
    expect(fs.existsSync(path.join(h.home, 'leaf-calls')), 'the removal helper was asked').toBe(false);
    expect(fs.readFileSync(witness(id), 'utf8')).toBe('a writer’s in-flight temp file');
  });
});

describe('the tail removes the witness only with the leaf, and keeps both when it keeps the leaf (R49, R50)', () => {
  const NOBODY = '_ws_path_users() { _WS_PATH_USERS_PIDS=""; return 0; };';
  /** A real child whose leaf the REAL writer has witnessed. */
  const witnessed = (): string => {
    makeChild(h);
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    expect(fs.existsSync(witness(CHILD_ID)), 'the CONTROL: the real writer witnessed the child’s leaf').toBe(true);
    return fs.readFileSync(witness(CHILD_ID), 'utf8');
  };

  it('a reclaim whose leaf nobody uses removes the leaf, THEN its witness — tmproots/ itself stays', () => {
    witnessed();
    const r = childReclaimVerb(h, evalOf(h).token, { pre: NOBODY });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(leaf(CHILD_ID)), 'temp root').toBe(false);
    expect(fs.existsSync(witness(CHILD_ID)), 'witness').toBe(false);
    expect(fs.statSync(wdir()).isDirectory()).toBe(true);
  }, 90_000);

  // The in-use substrate is Task 6's keep-arm case's own, and so is the wait:
  // Task 6's knob `CCD_RECLAIM_TMPROOT_WAIT_S`, set to 0 (it can only lower the
  // bound), asks the probe once after the kill and never sleeps; step (6) asks
  // again at the instant of removal. No `sleep` is stubbed.
  it.each([
    ['in use', 'CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_PIDS=4242; return 1; };'],
    ['unmeasured', 'CCD_RECLAIM_TMPROOT_WAIT_S=0; _ws_path_users() { _WS_PATH_USERS_WHY="stubbed"; return 2; };'],
  ])('a leaf the tail KEEPS (%s) keeps its witness, byte for byte', (_label, pre) => {
    const before = witnessed();
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed, 'a kept leaf is not a refusal (R49)').toBe(CHILD_ID);
    expect(fs.existsSync(leaf(CHILD_ID)), 'the kept leaf').toBe(true);
    expect(fs.readFileSync(witness(CHILD_ID), 'utf8')).toBe(before);
  }, 90_000);
});

describe('$REG/tmproots is invisible to every registry walker (R50, the pools/ precedent)', () => {
  const witnessedRow = (): string => {
    seed(ID, '7');
    h.sh(`_child_tmpdir ${ID} >/dev/null`);
    return fs.readFileSync(witness(), 'utf8');
  };

  it('_reg_purge takes the row and leaves the witness standing — it OUTLIVES the row (R25’s case)', () => {
    const bytes = witnessedRow();
    h.sh(`_reg_purge ${ID}`);
    for (const f of ['uuid', 'child', 'wrapper', 'workdir']) expect(h.reg(ID, f), f).toBeNull();
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
  });

  it('survives _reg_purge of a session whose id IS `tmproots` — the collision shape', () => {
    const bytes = witnessedRow();
    const reg = path.join(h.home, '.cc-sessions');
    fs.writeFileSync(path.join(reg, 'tmproots.uuid'), 'u');
    fs.writeFileSync(path.join(reg, 'tmproots.wrapper'), 'claude');
    h.sh('_reg_purge tmproots');
    expect(fs.existsSync(path.join(reg, 'tmproots.uuid')), 'the CONTROL: that row was purged').toBe(false);
    expect(fs.readFileSync(witness(), 'utf8')).toBe(bytes);
  });

  it('_ws_slug_free reads a slug whose only trace is its witness as FREE, and _ws_slug_residue names nothing', () => {
    witnessedRow();
    h.sh(`_reg_purge ${ID}`);
    expect(h.sh('_ws_slug_free demo quiet-mesa && echo free || echo taken')).toBe('free');
    expect(h.sh('_ws_slug_residue demo quiet-mesa')).toBe('');
  });

  it('`ccd ls` lists no row for it', () => {
    witnessedRow();
    h.sh(`_reg_purge ${ID}`);
    const out = h.sh('cmd_ls');
    expect(out).toContain('(no sessions)');
    expect(out).not.toContain('tmproots');
  });

  const CCD_DIR = path.dirname(CCD);
  /** Every shell file ccd/ ships, found by SHEBANG — never a hand-kept list. */
  const shipped = (): string[] => fs.readdirSync(CCD_DIR, { withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => path.join(CCD_DIR, e.name))
    .filter((p) => /^#!.*[/ ](ba)?sh(\s|$)/.test(fs.readFileSync(p, 'utf8').split('\n', 1)[0] ?? ''));
  /** A glob rooted at the registry, and the character right after its `*`. */
  const REG_GLOB = /(?:\$\{?(?:REG|_SVC_REG|reg)\}?|\$HOME"?\/\.cc-sessions)"?\/\*(.?)/g;
  const REG_FIND = /\bfind\b[^#\n]*\$\{?(?:REG|_SVC_REG|reg)\b/;
  const census = (files: readonly string[]): { globs: string[]; finds: string[]; bad: string[] } => {
    const globs: string[] = []; const finds: string[] = []; const bad: string[] = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*#/.test(line)) return;
        const at = `${path.basename(f)}:${i + 1}: ${line.trim()}`;
        for (const m of line.matchAll(REG_GLOB)) {
          globs.push(at);
          if (m[1] !== '.' && m[1] !== '-') bad.push(`a glob that is not suffix-shaped — ${at}`);
        }
        if (REG_FIND.test(line)) {
          finds.push(at);
          if (!/-maxdepth 1\b/.test(line) || !/-name\b/.test(line)) bad.push(`a find that is not depth-1 and name-filtered — ${at}`);
        }
      });
    }
    return { globs, finds, bad };
  };

  it('every registry glob in shipped shell is suffix-shaped, and every registry find is depth-1 and name-filtered', () => {
    // WHY THIS IS THE PROOF: a dotless directory matches no `*.<x>` or
    // `*-<x>` glob and no depth-1 `-name` filter, and its files are one level
    // further down. A bare `"$REG"/*` would see `tmproots` and hand it to a
    // walker that thinks every entry is a field file.
    const files = shipped();
    expect(files, 'the walk must reach ccd itself').toContain(CCD);
    const c = census(files);
    expect(c.globs.length, 'the scan found almost no registry glob — the regex went blind').toBeGreaterThanOrEqual(15);
    expect(c.finds.length, 'the scan found no registry find — the regex went blind').toBeGreaterThanOrEqual(3);
    expect(c.bad).toEqual([]);
  });

  it('CONTROL: it flags a bare glob and an unfiltered find, and passes the suffix shapes and a comment', () => {
    const dir = path.join(h.home, 'census-control');
    fs.mkdirSync(dir);
    const f = path.join(dir, 'planted');
    fs.writeFileSync(f, '#!/usr/bin/env bash\nfor f in "$REG"/*; do :; done\nfor f in "$REG"/*.uuid; do :; done\n'
      + 'names=$(find "$REG" -maxdepth 1)\n# for f in "$REG"/*; do :; done\n');
    const bad = census([f]).bad;
    expect(bad).toHaveLength(2);
    expect(bad[0]).toContain('planted:2:');
    expect(bad[1]).toContain('planted:4:');
  });
});

describe('_plat_btime — one format letter, two userlands', () => {
  it('GNU %W on Linux, BSD %B on Darwin', () => {
    const arm = (os: string): string => h.sh(`CCD_OS=${os}; stat() { printf '%s' "$*"; }; _plat_btime /x`);
    expect(arm('linux')).toBe('-c %W /x');
    expect(arm('darwin')).toBe('-f %B /x');
  });
});
```

In `server/test/macos-platform.test.ts`, in the `arms` table of "the Linux arms are the original GNU commands", add this directly after the `['_plat_ctime', …]` row (`grep -n "\['_plat_ctime'" server/test/macos-platform.test.ts`):

```ts
    // The temp-root witness's birth time (child-reclamation wave 6). New rather
    // than ported, so the row binds the NAME as well as the arm.
    ['_plat_btime', /^_plat_btime\(\) \{ if \[ "\$CCD_OS" = darwin \]; then stat -f %B "\$@"; else stat -c %W "\$@"; fi; \}/m],
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-tmproot-witness.test.ts)
(cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts -t '_plat_btime')
```

Expected:
- **`ccd-child-tmproot-witness`: FAIL, 53 of 59.**
  - **Cases that need a witness written** fail on the read. The message is `ENOENT: no such file or directory, open '<home>/.cc-sessions/tmproots/demo-quiet-mesa'`, or `expected false to be true` on an existence CONTROL.
  - **Writer, reader and removal cases** fail with `…command not found…[rc=127]` against the expected `[rc=1]`, `[rc=0]` or `[rc=2] |||||`.
  - **The three "never fails the spawn" cases** fail with `expected '<leaf>[rc=0]' to contain "ccd: warn: demo-quiet-mesa's temp root"`.
  - **The tail cases** fail at `the CONTROL: the real writer witnessed the child’s leaf: expected false to be true`.
  - **The `_plat_btime` case** fails with `expected '…_plat_btime: command not found' to be '-c %W /x'`.
  - **The six that pass are pins of properties today's tree already has:**
    - the three rc 1 cases;
    - the rc-2 symlink case;
    - the census and its CONTROL.

    Their reds are mutation rows 4, 21 and 22.
- **`macos-platform`: FAIL, 1:** `_plat_btime's Linux arm changed: expected '#!/usr/bin/env bash…' to match /^_plat_btime\(\) …/m`.

If a tail case fails before its CONTROL, for example with `JSON.parse` on an empty stdout, the entry conditions did not hold. Stop.

- [ ] **Step 3: `_plat_btime`, length-neutral, in BOTH copies of the platform block**

In `ccd/ccd` (`grep -n '^_plat_size() {' ccd/ccd`) and then in `ccd/ccrc` (`grep -n '^_plat_size() {' ccd/ccrc`), replace these three lines:

```bash
_plat_size() {    # <file> -> size in bytes
  if [ "$CCD_OS" = darwin ]; then stat -f %z "$@"; else stat -c %s "$@"; fi
}
```

with these three, byte for byte the same in both files:

```bash
_plat_size() { if [ "$CCD_OS" = darwin ]; then stat -f %z "$@"; else stat -c %s "$@"; fi; }   # <file> -> size in bytes
# Birth time, for the temp root's witness: `%W` and `%B` print 0 (BSD may print -1) where the filesystem keeps none.
_plat_btime() { if [ "$CCD_OS" = darwin ]; then stat -f %B "$@"; else stat -c %W "$@"; fi; }   # <file> -> birth time, epoch seconds
```

`_plat_size`'s Linux-arm pin (`/else stat -c %s "\$@"; fi/`) still matches the one-line shape, which `_plat_ctime` already uses.

Check that it is length-neutral now, before anything else moves:

```bash
git diff --numstat -- ccd/ccrc                         # 3	3	ccd/ccrc
grep -n '^# ── END PLATFORM LAYER' ccd/ccd ccd/ccrc    # the same two line numbers the entry conditions recorded
```

- [ ] **Step 4: The witness block, and `_child_tmpdir`'s rc-0 arm**

At the end of `_child_tmpdir`'s header comment, directly above `_child_tmpdir() {`, add:

```bash
# ITS rc-0 ARM ALSO WRITES THE LEAF'S POSITIVE WITNESS, `$REG/tmproots/<id>`
# (contract §12, R50): see the block below. rc 1 and rc 2 never do.
```

Replace `_child_tmpdir`'s body with the version below. It changes two things:
- the marker is read once into `run`, still through `_reg_get "$id" child`;
- one statement is added before the `printf`.

```bash
_child_tmpdir() {   # id -> rc 0 + path on stdout | 1 not a child | 2 child, leaf unusable (warned)
  local id="$1" root="$HOME/.cc-tmp" dir run
  run=$(_reg_get "$id" child)
  _child_runid_valid "$run" || return 1
  dir="$root/$id"
  if [[ -L "$dir" ]] || ! mkdir -p -m 0700 -- "$root" "$dir" 2>/dev/null \
     || [[ ! -d "$dir" ]] || ! chmod -- 0700 "$dir" 2>/dev/null; then
    echo "ccd: warn: $id is a child but $dir could not be made a private directory — spawning with the box's own TMPDIR, so this session's scratch is not contained" >&2
    return 2
  fi
  # rc 0 only, and never a refusal: the witness block below says why.
  _ws_tmproot_witness_write "$id" "$dir" "$run" \
    || echo "ccd: warn: $id's temp root $dir has no current witness — $(_ws_tmproot_witness_file "$id") could not be written; the spawn proceeds, and no collector will take this leaf until a later spawn writes it" >&2
  printf '%s' "$dir"
}
```

Directly after `_child_tmpdir`'s closing brace, and before `# ── \`ws-add --child <runId>\``, add the block:

```bash
# ── THE TEMP ROOT'S POSITIVE WITNESS (child-reclamation contract §12, R50) ──
# `$REG/tmproots/<id>` says "ccd handed THIS directory, by dev, ino and btime,
# to run <run> as its temp root": one line, `v=1 id=<id> run=<run> dev=<n>
# ino=<n> btime=<n|-> uid=<n> at=<ms>`, taken by stat of the leaf right after
# `_child_tmpdir`'s mkdir and chmod. That mkdir is `-p`, so a leaf that
# already stood (one older than this code) is witnessed as it is found: the
# witness says ccd HANDED the directory over, not that ccd created it. A
# collector takes a leaf only while its dev, ino and btime still match; a
# leaf that does not match is offered to the operator, never taken.
#
# TRUST. Any process of this uid can write this file, the session it judges
# included: it guards against ccd's own mistakes and a recycled id, never
# against a hostile session. The dev/ino/btime binding limits a forgery to a
# leaf ccd made, at the id-derived path `$HOME/.cc-tmp/<id>`, and that limit
# is convention, not an OS wall: a same-uid process can plant a directory
# there and a witness for it alike. So a collector takes a path only from the
# id, never from the witness body.
#
# WHERE. A DOTLESS registry subdirectory, the `pools/` precedent (POOLS_DIR):
# every registry glob ccd ships is suffix-shaped and every registry `find` is
# depth-1 and name-filtered, so a dotless directory is invisible to all of
# them, and the files inside it are one level further down. So `_reg_purge`
# does not take it — the witness OUTLIVES the row, the case R25 exists for —
# and `_ws_slug_free` does not count it. `ccd-child-tmproot-witness.test.ts`
# measures that census and refuses a walker that could see it. A file inside
# the leaf was rejected, and so was a sidecar in `~/.cc-tmp`: both sit where
# a session's own scratch goes, so its ordinary writes and cleanups could
# take or clobber them by accident. `tmproots/` is no harder to write on
# purpose (TRUST, above); it is only out of the session's way. The writer's
# temp file is dot-leading INSIDE `tmproots/`, never `$REG/.<x>`, so no
# `tmproots/*` glob sees it and `_reg_purge`'s dot-prefixed inventory is
# unchanged. A writer that dies between its `printf` and its `mv` leaves that
# temp file behind, and nothing in this wave reaps it: a stated residue. No
# id names it (`_ws_tmproot_id_ok` refuses every dot-leading name, at the
# reader, the writer and `_ws_tmproot_remove`), so a collector walking
# `tmproots/` skips or reaps dot-leading names and never takes one for an id.
#
# WHEN. Every rc-0 answer of `_child_tmpdir` asks; the file is WRITTEN (temp
# file, then `mv`) only when it is absent, unparseable, or its dev, ino or
# btime no longer match the leaf, or its run no longer matches the marker.
# A respawn rewrites nothing; a leaf rebuilt with a new inode (a storage
# migration, a recycled slug) is re-witnessed on its next spawn, and so is a
# leaf older than this code. So is a recycled slug's KEPT leaf of the SAME
# inode: its new child's run differs, so that child's first rc 0 rewrites
# the witness (R50). Never on rc 1 or
# rc 2, never by a separate pass, never by hand. A failed write never fails
# the spawn: `_child_tmpdir` warns, and the leaf is simply not collectable
# until a later spawn writes it.
#
# BTIME is `_plat_btime` (whole epoch seconds). Where the filesystem keeps no
# birth time it prints 0 (BSD may print -1) and the witness says `-`, binding
# dev and ino alone; a stat that FAILS writes nothing — unmeasured is never
# `-`. UID is the `-O` test: the leaf's owner IS this process's effective
# uid, so `$EUID` is that owner, not a guess.
#
# DEATH belongs to `_ws_tmproot_remove` alone (RECLAIM region), and only
# after `_ws_leaf_remove` has PROVEN the leaf absent.
_ws_tmproot_witness_file() { printf '%s' "$REG/tmproots/${1-}"; }   # id -> the witness's path (a path, not a decision)

# THE ID A WITNESS MAY BE NAMED FOR: the tail's own id shape, never
# dot-leading — `.`, `..` and the writer's `.<id>.*.tmp` names live there.
_ws_tmproot_id_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[A-Za-z0-9._-]+$ && "${1-}" != .* ]]; }

_ws_tmproot_witness_read() {   # id -> 0 parsed (sets _WS_WIT_DEV _WS_WIT_INO _WS_WIT_BTIME _WS_WIT_RUN _WS_WIT_UID _WS_WIT_AT) | 1 absent | 2 unreadable or malformed
  # THREE ANSWERS: a directory or a link planted at the name is not absent.
  # Every field is cleared first, so a failed read never leaves a previous
  # read's values standing. The run is judged by `_child_runid_valid`, the
  # one run-id grammar, never a re-spelt pattern — and BASH_REMATCH is copied
  # before that call, whose own `=~` resets it.
  local LC_ALL=C id="${1-}" w body="" line fd
  local -a m
  local re='^v=1 id=([A-Za-z0-9._-]+) run=([^ ]+) dev=([0-9]+) ino=([0-9]+) btime=([1-9][0-9]*|-) uid=([0-9]+) at=([0-9]{13})$'
  _WS_WIT_DEV=''; _WS_WIT_INO=''; _WS_WIT_BTIME=''; _WS_WIT_RUN=''; _WS_WIT_UID=''; _WS_WIT_AT=''
  _ws_tmproot_id_ok "$id" || return 2
  w=$(_ws_tmproot_witness_file "$id")
  [[ -e "$w" || -L "$w" ]] || return 1
  [[ -f "$w" && ! -L "$w" ]] || return 2
  { exec {fd}<"$w"; } 2>/dev/null || return 2
  IFS= read -r -N 513 body <&"$fd" || :
  { exec {fd}<&-; } 2>/dev/null || :
  (( ${#body} <= 512 )) && [[ "$body" == *$'\n' ]] || return 2
  line="${body%$'\n'}"
  [[ "$line" != *$'\n'* && "$line" =~ $re ]] || return 2
  m=("${BASH_REMATCH[@]}")
  [[ "${m[1]}" == "$id" ]] || return 2
  _child_runid_valid "${m[2]}" || return 2
  _WS_WIT_RUN="${m[2]}"; _WS_WIT_DEV="${m[3]}"; _WS_WIT_INO="${m[4]}"
  _WS_WIT_BTIME="${m[5]}"; _WS_WIT_UID="${m[6]}"; _WS_WIT_AT="${m[7]}"
  return 0
}

_ws_tmproot_witness_write() {   # id leaf run -> 0 written or already current | 1 not written (the caller warns)
  local LC_ALL=C id="${1-}" leaf="${2-}" run="${3-}" dir="$REG/tmproots" w di dev ino bt at tmp
  _ws_tmproot_id_ok "$id" || return 1
  _child_runid_valid "$run" || return 1
  # The leaf `_child_tmpdir` just made: a real directory, not a link, ours.
  [[ -d "$leaf" && ! -L "$leaf" && -O "$leaf" ]] || return 1
  di=$(_plat_devino "$leaf" 2>/dev/null) || return 1
  [[ "$di" =~ ^([0-9]+):([0-9]+)$ ]] || return 1
  dev="${BASH_REMATCH[1]}"; ino="${BASH_REMATCH[2]}"
  bt=$(_plat_btime "$leaf" 2>/dev/null) || return 1
  [[ "$bt" =~ ^-?[0-9]+$ ]] || return 1
  [[ "$bt" =~ ^[1-9][0-9]*$ ]] || bt=-
  # CURRENT: nothing to write. Absent, unparseable or stale: rewrite.
  if _ws_tmproot_witness_read "$id" \
     && [[ "$_WS_WIT_DEV" == "$dev" && "$_WS_WIT_INO" == "$ino" && "$_WS_WIT_BTIME" == "$bt" && "$_WS_WIT_RUN" == "$run" ]]; then
    return 0
  fi
  at=$(_plat_epoch_ms) && [[ "$at" =~ ^[0-9]{13}$ ]] || return 1
  [[ ! -L "$dir" ]] || return 1
  mkdir -p -- "$dir" 2>/dev/null || return 1
  [[ -d "$dir" && ! -L "$dir" ]] || return 1
  w=$(_ws_tmproot_witness_file "$id")
  # A link or a directory at the name is REFUSED, never replaced: `mv -f`
  # onto a directory moves the temp file INSIDE it and answers 0.
  if [[ -L "$w" ]] || { [[ -e "$w" ]] && [[ ! -f "$w" ]]; }; then return 1; fi
  tmp="$dir/.$id.$BASHPID.$RANDOM.tmp"
  { printf 'v=1 id=%s run=%s dev=%s ino=%s btime=%s uid=%s at=%s\n' \
      "$id" "$run" "$dev" "$ino" "$bt" "$EUID" "$at" > "$tmp"; } 2>/dev/null \
    || { rm -f -- "$tmp" 2>/dev/null; return 1; }
  mv -f -- "$tmp" "$w" 2>/dev/null || { rm -f -- "$tmp" 2>/dev/null; return 1; }
}
```

Do not add a `_reg_get` call anywhere in this block. The census sentence's two numbers must not move (Step 7).

- [ ] **Step 5: `_ws_tmproot_remove`, and the tail goes through it**

Directly after Task 5's `_ws_leaf_remove` closing brace in the RECLAIM region (`grep -n '^_ws_leaf_remove() {' ccd/ccd`), add:

```bash
# THE TEMP ROOT'S REMOVAL (contract §12, R49 and R50): the ONE removal helper
# on the temp root, then — on its rc 0 only, the leaf removed or PROVEN
# absent — the leaf's witness. Remove, prove, THEN unlink the witness: a
# crash between the last two leaves a witness with no leaf, which is nothing
# to do and is cleaned by the next call; the reverse order could leave a
# leaf with no witness, which no collector may ever take. A refusal or an
# unmeasured answer leaves the witness beside the leaf it still describes.
# The tail passes NO dev:ino (the row and the marker prove identity there,
# and the check-to-rm window is `_ws_leaf_remove`'s own stated residual);
# a collector passes the witness's own. A witness that cannot be unlinked
# after a proven-absent leaf is warned about and changes nothing: the act
# this helper reports is the leaf's.
# An id no witness is named for (`_ws_tmproot_id_ok`: anything dot-leading,
# `.`, `..` and the writer's own `.<id>.*.tmp` names among them) is refused
# FIRST, rc 1 with `_WS_LEAF_WHY`, and nothing is asked or touched: a
# collector walking `tmproots/` must never turn a writer's temp file into a
# leaf to remove. The writer refuses the same ids, so such a leaf was never
# witnessed either; the tail keeps and records it, a leak and never a loss.
_ws_tmproot_remove() {   # id [expect-devino] -> _ws_leaf_remove's rc (0 removed-or-absent | 1 refused | 2 unmeasured; _WS_LEAF_WHY)
  local id="${1-}" rc=0 w
  _ws_tmproot_id_ok "$id" || { _WS_LEAF_WHY="'$id' is not an id a witness is named for, so nothing was touched"; return 1; }
  if [[ -n "${2-}" ]]; then
    _ws_leaf_remove "$HOME/.cc-tmp" "$id" "$2"; rc=$?
  else
    _ws_leaf_remove "$HOME/.cc-tmp" "$id"; rc=$?
  fi
  (( rc == 0 )) || return "$rc"
  w=$(_ws_tmproot_witness_file "$id")
  rm -f -- "$w" 2>/dev/null \
    || echo "ccd: warn: $id's temp root is gone but its witness $w could not be removed — a witness with no leaf is nothing to do, and a later removal of $id cleans it" >&2
  return 0
}
```

In `_ws_reclaim_tail`'s artifacts step, find the tail's one temp-root call. It is the entry conditions' single hit outside `_ws_tmproot_remove`. Find it with `grep -n '_ws_leaf_remove "\$HOME/.cc-tmp"' ccd/ccd`, which now shows three hits: two inside `_ws_tmproot_remove` and the tail's. Then:
- Replace exactly `_ws_leaf_remove "$HOME/.cc-tmp" "$id"` with `_ws_tmproot_remove "$id"`. Leave the rest of that line as Tasks 5 and 6 wrote it: its status capture, its `_WS_LEAF_WHY` use and its kept arm. `_ws_tmproot_remove` returns the same rc and leaves `_WS_LEAF_WHY` as the helper set it.
- Add one comment line directly above it:

```bash
    # Through `_ws_tmproot_remove`, so the witness goes only once the leaf is PROVEN absent (R50); the kept arm calls neither and keeps both.
```

Leave the clips call (`_ws_leaf_remove "$HOME/.cc-clips" …`) unchanged. Afterwards `grep -c '_ws_leaf_remove "\$HOME/.cc-tmp"' ccd/ccd` prints `2`, and both hits are inside `_ws_tmproot_remove`.

- [ ] **Step 6: Re-stamp ccd, and run the tests to verify they pass**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-tmproot-witness.test.ts test/macos-platform.test.ts \
  test/ccd-child-tmpdir.test.ts test/ccd-ws-add-child.test.ts test/ccd-reg-get-census.test.ts test/ccd-die-containment.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-authdead.test.ts test/ccd-project-pool.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-account-auth.test.ts -t 'census, not a memory')
```

Run every suite in the foreground.

Expected: PASS.
- `ccd-child-tmproot-witness` passes 59 of 59.
- **`ccd-child-tmpdir` passes unchanged.**
  - Its exact `"<leaf>[rc=0]\n"` assertion is the proof that a successful witness write is silent.
  - Its marker-reader census still names only `_spawn_start`.
- **`ccd-ws-add-child`'s "spells the literal run-id pattern once"** stays green, because the reader never spells `[0-9]{0,9}`.
- **`ccd-reg-get-census`** stays green, because `_reg_get "` occurrences and lines are unchanged.
- **`ccd-account-auth`'s census** stays green with its cardinal unchanged at TWELVE. The new code writes no `$REG/.<name>` literal.
- **`ccd-child-reclaim-verb-tail`'s temp-root cases** stay green. They plant leaves with no witness, which the new helper removes exactly as before, and `rm -f` of an absent witness is a no-op.

- [ ] **Step 7: The census taxes**

1. **Length-neutral above the frozen anchor (R56).**
   - Run `git diff -U0 -- ccd/ccd | grep '^@@' | head -2`.
   - The first hunk is the platform block and must read `-<n>,3 +<n>,3`.
   - The second must start below the frozen corpus's highest `ccd/ccd` anchor. Measure that anchor with:

     ```bash
     grep -ohE '(ccd/ccd:|[`( ,]:)[0-9]+' docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
       docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md | grep -oE '[0-9]+$' | sort -n | tail -1
     ```

   - `git diff --numstat -- ccd/ccrc` still prints `3	3	ccd/ccrc`.
2. **The `_reg_get` census.** Its two numbers must equal the header's (`grep -n 'invocations across' ccd/ccd`):

   ```bash
   grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l
   grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'
   ```

   If either has moved, an extra `_reg_get` call was added. Remove it; do not re-count.
3. **The citation audit (S6-R11).**

   ```bash
   (cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND')
   ```

   It should be green: every edit above the anchor is length-neutral, and `ccd/ccrc`'s is too. If it is red, apply the procedure's steps 2, 3 and 4 exactly, as the wave-3 plan's Global Constraints state them. Name this task's insertion as the cause, and never retype an anchor.

- [ ] **Step 8: Mutation check**

Apply each row on its own: edit, re-stamp (`bash ccd/ccrc restamp ccd/ccd`), run, restore, re-stamp. `T` is `(cd server && ./node_modules/.bin/vitest run test/ccd-child-tmproot-witness.test.ts -t '<fragment>')`.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In `_child_tmpdir`, delete the whole `_ws_tmproot_witness_write … \|\| echo "ccd: warn: …" >&2` statement | `T` with `rc 0 writes ONE` | `ENOENT: no such file or directory, open '<home>/.cc-sessions/tmproots/demo-quiet-mesa'` |
| 2 | In `_child_tmpdir`, replace `\|\| echo "ccd: warn: $id's temp root …" >&2` with `\|\| return 2` | `T` with `cannot be written never fails the spawn` | `expected '[rc=2]' to contain '<home>/.cc-tmp/demo-quiet-mesa[rc=0]'` |
| 3 | In `_ws_tmproot_witness_write`, delete `[[ -d "$leaf" && ! -L "$leaf" && -O "$leaf" ]] \|\| return 1` | `T` with `refuses what is not` | `a leaf that is a symlink`: `expected '[rc=0]' to be '[rc=1]'` |
| 4 | Row 3, and also move `_child_tmpdir`'s witness statement above its `if [[ -L "$dir" ]] …` block | `T` with `rc 2` | `rc 2 (a symlinked leaf) writes nothing`: `expected true to be false` |
| 5 | In `_ws_tmproot_witness_write`, delete `_child_runid_valid "$run" \|\| return 1` | `T` with `run outside the run-id grammar` | `expected '[rc=0]' to be '[rc=1]'` for `"abc"` |
| 6 | In the CURRENT test, delete `&& "$_WS_WIT_BTIME" == "$bt"`; restore; then `"$_WS_WIT_INO" == "$ino" &&`; restore; then `"$_WS_WIT_DEV" == "$dev" &&` | `T` with `alone no longer matches` | for each in turn, its own key: `expected '1' to be '<btime>'`, `expected '999999' to be '<ino>'`, `expected '999999' to be '<dev>'` |
| 7 | Delete the whole `if _ws_tmproot_witness_read "$id" && … then return 0; fi` | `T` with `CURRENT witness is never rewritten` | `rewritten: a respawn replaced a current witness: expected <m> to be <n>` |
| 8 | Replace the `printf … > "$tmp"` / `mv -f -- "$tmp" "$w"` pair with `printf 'v=1 id=%s run=%s dev=%s ino=%s btime=%s uid=%s at=%s\n' "$id" "$run" "$dev" "$ino" "$bt" "$EUID" "$at" > "$w" \|\| return 1` | `T` with `REPLACED by a new inode` | `the witness was written in place, not temp file then mv: expected <n> not to be <n>` |
| 9 | Delete `if [[ -L "$w" ]] \|\| { [[ -e "$w" ]] && [[ ! -f "$w" ]]; }; then return 1; fi` | `T` with `DIRECTORY at the witness path` | `mv moved the temp file INSIDE the directory: expected [ '.demo-quiet-mesa.<pid>.<n>.tmp' ] to deeply equal []` |
| 10 | Delete `[[ "$bt" =~ ^[1-9][0-9]*$ ]] \|\| bt=-` | `T` with `keeps none` | `expected '0' to be '-'` (and `'-1'` for the second row) |
| 11 | Replace `bt=$(_plat_btime "$leaf" 2>/dev/null) \|\| return 1` with `bt=$(_plat_btime "$leaf" 2>/dev/null) \|\| bt=-` | `T` with `a stat that FAILS` | `expected "…[rc=0]" to contain "ccd: warn: demo-quiet-mesa's temp root"` |
| 12 | In `_ws_tmproot_witness_read`, delete `[[ "${m[1]}" == "$id" ]] \|\| return 2` | `T` with `rc 2 for another id` | `expected '[rc=0] 7\|2064\|35\|-\|1000\|1791277099334' to be '[rc=2] \|\|\|\|\|'` |
| 13 | In `_ws_tmproot_witness_read`, delete `_child_runid_valid "${m[2]}" \|\| return 2` | `T` with `rc 2 for a run outside the grammar` | `expected '[rc=0] 07\|…' to be '[rc=2] \|\|\|\|\|'` |
| 14 | In `_ws_tmproot_witness_read`, replace `[[ -f "$w" && ! -L "$w" ]] \|\| return 2` with `[[ -f "$w" ]] \|\| return 2` | `T` with `a link is never followed` | `expected '[rc=0] 7\|…' to be '[rc=2] \|\|\|\|\|'` |
| 15 | In `_ws_tmproot_witness_read`, delete the field-clearing line `_WS_WIT_DEV=''; …` | `T` with `every field is cleared` | `expected '[rc=1] 7\|2064\|…' to be '[rc=1] \|\|\|\|\|'` |
| 16 | In `_ws_tmproot_remove`, move the `w=…` and `rm -f -- "$w" …` lines above the `if [[ -n "${2-}" ]]` call | `T` with `the leaf goes FIRST` | `expected [ '2\|…\|demo-quiet-mesa\|' ] to deeply equal [ '2\|…\|demo-quiet-mesa\|present' ]` |
| 17 | In `_ws_tmproot_remove`, delete `(( rc == 0 )) \|\| return "$rc"` | `T` with `is passed through` | `expected '[rc=0] stub-why' to be '[rc=1] stub-why'` |
| 18 | Replace `_ws_tmproot_remove`'s `if … else … fi` with `_ws_leaf_remove "$HOME/.cc-tmp" "$id" "${2-}"; rc=$?` | `T` with `never an empty third argument` | `expected [ …, '3\|…\|demo-quiet-mesa\|\|' ] to deeply equal [ …, '2\|…\|demo-quiet-mesa\|' ]` |
| 19 | In `_ws_reclaim_tail`, put back `_ws_leaf_remove "$HOME/.cc-tmp" "$id"` in place of `_ws_tmproot_remove "$id"` | `T` with `nobody uses` | `witness: expected true to be false` |
| 20 | Make `_ws_tmproot_witness_file` print `"$REG/${1-}.tmproot"` | `T` with `invisible to every registry walker` | `_reg_purge takes the row`: `ENOENT … demo-quiet-mesa.tmproot`; `_ws_slug_free …`: `expected 'taken' to be 'free'` |
| 21 | Add the line `  for _f in "$REG"/*; do :; done` as the first line of `cmd_ls`'s body | `T` with `suffix-shaped` | `expected [ 'a glob that is not suffix-shaped — ccd:<n>: for _f in "$REG"/*; do :; done' ] to deeply equal []` |
| 22 | Delete the CONTROL file's second line (`for f in "$REG"/*; …`) in the test | `T` with `CONTROL: it flags` | `expected [ 'a find that … planted:3: …' ] to have a length of 2 but got 1` |
| 23 | In BOTH platform blocks, change `stat -c %W` to `stat -c %Y` | `(cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts -t '_plat_btime')`, and `T` with `GNU %W on Linux` | `_plat_btime's Linux arm changed: expected … to match /…stat -c %W…/m`; `expected '-c %Y /x' to be '-c %W /x'` |
| 24 | In `ccd/ccrc` only, change `stat -f %B` to `stat -f %b` | `(cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts -t 'byte-identical')` | `is byte-identical in ccd and ccrc`: the `toBe` diff shows the `%B` line |
| 25 | In the CURRENT test, delete ` && "$_WS_WIT_RUN" == "$run"` | `T` with `SAME inode` | `a same-inode witness still names the old run: expected '7' to be '8'` |
| 26 | In `_ws_tmproot_remove`, delete the line `_ws_tmproot_id_ok "$id" \|\| { _WS_LEAF_WHY=…; return 1; }` | `T` with `no witness is named for` | for each row, `expected '[rc=0] stub-why' to be '[rc=1] \'<id>\' is not an id a witness is named for, so nothing was touched'`: the stub was asked, and its rc 0 went on to `rm -f` the planted file |

Row 4 cannot red alone. The witness statement's ORDER is defence in depth behind row 3's guard (`[[ -d "$leaf" && ! -L "$leaf" && -O "$leaf" ]]`), which refuses the symlinked leaf wherever the statement sits. So row 4 applies row 3 too, and pins the order only together with that guard.

Row 22 is the census's own control mutation, applied to test code. Revert it like the others.

Restore everything, re-stamp, and re-run Step 6. Everything should be green.

- [ ] **Step 9: Commit**

```bash
git add ccd/ccd ccd/ccrc server/test/ccd-child-tmproot-witness.test.ts server/test/macos-platform.test.ts \
  $(git diff --name-only -- server/test/session-hook.test.ts)   # only if Step 7's audit needed S6-R11's repair
git commit -m "$(cat <<'MSG'
feat(ccd): the temp root's positive witness, removed only after its leaf

_child_tmpdir's rc-0 arm writes $REG/tmproots/<id>: one versioned line
binding the leaf's dev, ino and birth time to the run that minted it,
written by temp file and mv only when absent or stale, never on rc 1 or
rc 2. A write that fails warns, and the spawn proceeds. _ws_tmproot_remove
removes the leaf through _ws_leaf_remove and unlinks the witness only once
the leaf is proven absent; the reclaim tail now goes through it, so a leaf
it keeps in use keeps its witness. The witness directory is dotless, so
_reg_purge, _ws_slug_free and ccd ls never see it, and a census test holds
every registry glob and find to that shape. _plat_btime joins the platform
block in ccd and ccrc, length-neutral.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

### Task 8: The gone-branch pin: `_ws_reclaim_branch_state`, read three ways at every arm in one act (R53)

**Model routing:** `opus`, effort `high`. SAFETY-critical: this task changes when the destructive verb goes ahead over a missing branch, and it changes the reclaim token.

**Why:** Wave 3's reclaim folds "the branch is absent" and "the branch could not be read" into one empty `REAP_TIP`. Measured on git 2.43.0 (the fleet box), `rev-parse --verify --quiet` and `show-ref --verify --quiet` both answer rc 1 for three cases: an absent ref, a corrupt loose ref, and a ref under an unreadable directory. Only `git show-ref --exists` gives three answers: 0 present, 2 absent, and anything else (1 for a ref that will not read, 128 for no repository, 129 for a git older than 2.43 that does not know the flag) means the read did not run. On any answer but 0 or 2, a successful `rev-parse --verify --quiet refs/heads/<b>^{commit}` still reads present (the positive fallback, ruled on gone-branch.OPEN4), so only `--exists` rc 2 can ever prove absent, and a box on a git older than 2.43 (Apple's 2.39, for one) reclaims a standing branch as it does today and never a gone one. One old-git shape is a stated residual, not closed: a resume whose step 5 already deleted the branch, or whose branch someone else deleted after the pin, reads `unmeasured` there and stops at step 5 as `branch-unmeasured` on every retry. The fleet runs 2.43 (see the carried residuals at the foot of this task).

Because of the fold, the two worktree arms disagree today:
- **The present arm.** The ladder mints a token with `tip=` over a gone branch. The pin then fails `pin-failed` for good. The live `expoAI-assistant-calm-mesa` child has failed this way 95 times, while its HEAD and every reflog commit are already on `origin/main`.
- **The vanished arm (R19).** It already goes ahead over an empty tip. So does the tail's step 5, which skips the delete when `show-ref --verify` fails and then purges the row. That means an existing but unreadable branch is left with no row.

R53 rules one rule at every seam, in one act:
- the ladder's tip reads on both arms;
- the pin;
- the vanished arm's pin read;
- the tail's step-5 test.

The token gains a `branchState` input, and a read that did not run mints no token at all. A proven-absent branch pins HEAD, the WIP commit and every per-worktree ref and reflog commit, deletes no branch, and the reclaim goes ahead. Four cases stay closed:
- a branch that reappears after the tombstone stays `branch-moved`. As today, a branch made between the verb's in-lock recompute and the pin is adopted at the tip the pin reads. The gone-branch consent is therefore re-checked at the tombstone, not at the pin. This is a stated residual: that tip is pinned and its reflog is kept, so nothing is lost;
- a HEAD still symbolic to the gone branch stays `pin-failed`;
- a registry branch that is itself a SYMBOLIC ref reads `unmeasured`. Measured on git 2.43:
  - `show-ref --exists` answers 0 for it, and `rev-parse` peels it to the commit it names;
  - a plain `update-ref -d` on it deletes the branch it NAMES (the project's main line, or a branch checked out elsewhere), past the holder check, the main-line check and the reflog keep, which are all asked of the child's own branch name.

  As defence in depth, Task 3 spells both of the tail's branch CASes `update-ref -d --no-deref`;
- a read failure at step 5 stops the tail with a new `failed` word, `branch-unmeasured`, journaled through `_ws_reclaim_fail` with its own `LC_REFUSAL_WORD` sentence.

**Files:**
- Modify: `ccd/ccd`, inside the RECLAIM region only. It is `RECLAIM-BEGIN` at ccd/ccd:25241 at `77c11245a`; locate it with `grep -nF -e 'RECLAIM-BEGIN' -e 'RECLAIM-END' ccd/ccd`, which prints two lines (the region's first and last). Every edit below lands far below ccd/ccd:19109, so R56's citation tax does not apply. Confirm before editing that `grep -nF '_ws_reclaim_reset() {' ccd/ccd` prints one line whose number is greater than 19109 (below the boundary, so R56's citation tax does not apply).

  Every anchor below is a FIXED string (`grep -nF`). To a regex grep, a `$` inside a pattern is an anchor, and under the harness's `grep` (a function that runs ugrep) such a pattern matches nothing. A locate grep would then print no line, and a `# 0` check would pass over the very read it is meant to catch (measured on `77c11245a`: 0 there, against GNU grep's 4). Each grep below says what it prints. The sites:
  - `_ws_reclaim_reset`: ccd/ccd:25274, `grep -nF '_ws_reclaim_reset() {' ccd/ccd` (one line). Its `RECLAIM_HEAD` entry is at ccd/ccd:25279, `grep -nF 'RECLAIM_HEAD=""           # the child' ccd/ccd` (one line).
  - New helpers go directly after `_ws_reclaim_main_line_refuse`: ccd/ccd:25965, `grep -nF '_ws_reclaim_main_line_refuse() {' ccd/ccd` (one line).
  - The ladder's present-arm tip read: ccd/ccd:26416. It is the FIRST of the four lines that `grep -nF 'REAP_TIP=$(git -C "$main" rev-parse --verify --quiet' ccd/ccd` prints. Its fingerprint input line is at ccd/ccd:26435, the first of the two lines that `grep -nF '"worktreeHead=$wthead" "tip=$REAP_TIP" "head=' ccd/ccd` prints.
  - `_ws_reclaim_eval_absent`'s tip read (R19's vanished arm): ccd/ccd:26489, the SECOND line of the same tip-read grep. Its fingerprint line is at ccd/ccd:26502, the second line of the fingerprint grep.
  - `_ws_reclaim_pin_contained`:
    - its HEAD read: ccd/ccd:27560, `grep -nF 'headref=$(git -C "$workdir" symbolic-ref -q HEAD' ccd/ccd` (one line). Its `elif` arm ends at ccd/ccd:27565, `grep -nF 'could not read which branch $workdir has checked out' ccd/ccd` (one line);
    - its tip block: ccd/ccd:27628, `grep -nF 'THE BRANCH TIP IS A REQUIRED PIN' ccd/ccd` (one line). The block runs through the `extras+=("$REAP_TIP")` line that follows the hard failure at ccd/ccd:27632.
  - `_ws_reclaim_pin_absent_contained`'s tip read: ccd/ccd:27749, the FOURTH line of the tip-read grep.
  - `_ws_reclaim_tail`:
    - its third `local` line: ccd/ccd:27970, `grep -nF 'local holders wdreal' ccd/ccd` (one line). If Task 5 or 6 renamed `wdreal`, use the one `local holders` line inside `_ws_reclaim_tail`;
    - the settle: ccd/ccd:28106, `grep -nF 'if ! _ws_reclaim_pin "$id" "$workdir" "$main" "$branch" "$childof"; then' ccd/ccd` (one line);
    - step 5's branch test: ccd/ccd:28348, `grep -nF 'show-ref --verify --quiet "refs/heads/$branch"' ccd/ccd`. This prints FOUR lines. The one to edit is the hit inside `_ws_reclaim_tail`, the last of the four. The other three (ccd/ccd:8001, :14827 and :15673) are ws-reap and gc code outside the RECLAIM region, and are never edited.

    Earlier tasks of this wave (3, 5 and 6) edit the tail, so locate every tail site by content, never by number.
- Modify: `server/test/ccd-child-reclaim-pin.test.ts`. The one case whose behaviour R53 reverses: server/test/ccd-child-reclaim-pin.test.ts:573, `grep -nF 'FAILS when the branch no longer resolves' server/test/ccd-child-reclaim-pin.test.ts` (one line), inside `describe('the branch tip is a REQUIRED pin'`.
- Test: `server/test/ccd-child-reclaim-gone-branch.test.ts` (new; R56).
- Modify: `shared/api.ts` (gone-branch.OPEN5, R43): `LcRefusalToken` gains `'branch-unmeasured'`, and `LC_REFUSAL_WORD` gains its sentence. Find them with `grep -nF 'export type LcRefusalToken' shared/api.ts` and `grep -nF "'unit-still-active':" shared/api.ts` (one line each: the union's first line, and the `LC_REFUSAL_WORD` key, never the union member, which ends in `;`). The line numbers on the worker's tree are hints, because wave 5 and #286 moved them.
- Modify: `server/test/lifecycle-refusal-word.test.ts`: `ALL_TOKENS`, `expect(TOKENS.length).toBe(14)` (`:22` and `:35` at `77c11245a`), and the `it.each(['pin-failed', 'unit-still-active'] as const)` word case.
- Modify: `server/test/child-reclaim-status.test.ts` (R43: its failure-word list). Add one `ROWS` entry directly after the `failed unit-still-active → deferred…` row, and append `'branch-unmeasured'` to the token list of `reads a failure token’s journal word ahead of the audit sentences` (near `:274` at `e79b1da7`; a hint, so find both by their quoted names with `grep -nF`).
- Modify: `README.md`. Only the three `LC_REFUSAL_WORD` map anchors in the purge-refusal sentence, re-pointed by content (Step 4). Find it with ``grep -nF '`purge-mechanism-absent` (`shared/api.ts:' README.md`` (one line).
- Modify, only if Step 4 measures it red: `server/test/session-hook.test.ts`, the `'shared/api.ts'` entry of the CITATION DEBT `byFile` census.

**Interfaces:**
- Produces:
  ```bash
  _ws_reclaim_branch_state <gitdir-or-repo> <branch>   # prints exactly one of "present <40-hex>", "absent", "unmeasured"; always rc 0.
                                                       # git show-ref --exists under _ws_reclaim_contained: rc 2 absent, the ONLY answer
                                                       # taken as absent. On rc 0, or on any answer but 0 or 2 (an older git's 129: the
                                                       # positive fallback, gone-branch.OPEN4), present when the ref is NOT symbolic
                                                       # (symbolic-ref -q answers 1) and rev-parse --verify --quiet refs/heads/<b>^{commit}
                                                       # peels it to a commit; anything else unmeasured, a SYMBOLIC ref included.
  _ws_reclaim_tip_read <main> <branch>                 # rc 0 with REAP_TIP ('' when PROVEN absent) and RECLAIM_BRANCHSTATE (present|absent);
                                                       # rc 1 with _WS_BRANCH_WHY. The ONE tip read of the ladder's two arms, the pin and the
                                                       # vanished arm's pin.
  RECLAIM_BRANCHSTATE                                  # global, reset by _ws_reclaim_reset; '' = never read
  _WS_BRANCH_WHY                                       # global: "whether refs/heads/<b> exists in <main> could not be read (…)"
  ```
  The token format change: both ladder fingerprints gain the input `branchState=$RECLAIM_BRANCHSTATE`, immediately after `tip=$REAP_TIP`. Its value is `present` or `absent`. No token exists for a read that did not run, because the ladder answers `unmeasured` before minting. It is spelled `branchState=`, not the ruling's `branch=absent`, because the token already carries `branch=<name>` and a branch literally named `absent` would collide (departure `branch-absent-input-spelled-branchState`).
  The journal vocabulary gains `'branch-unmeasured'` (`LcRefusalToken`, with its `LC_REFUSAL_WORD` sentence): the tail's step 5 answers it, through `_ws_reclaim_fail`, when whether the branch exists could not be read. It is a `failed` line, so it needs no `CHILD_RECLAIM_PRE_LOCK_TOKEN` entry, and wave 5's executor reads its document as `resumable`, which is the tail's real state there (the breadcrumb stands at `branch`).
- Consumes:
  - `_ws_reclaim_contained`, as Task 1 left it (F6: its outermost block unsets the config variables and the repository-selecting ones);
  - the step-5 `update-ref -d --no-deref` line exactly as Task 3 left it (contained), which this task does not touch;
  - `_ws_reclaim_attic_extra`, which already skips an empty sha (`[[ -n "$sha" ]] || continue`);
  - `_ws_reclaim_unmeasured`, `_ws_reclaim_fail`;
  - test fixtures: `makePrHarness`, `makeChild`, `evalOf`, `childReclaimVerb`, `CHILD_BRANCH`, `CHILD_ID`, `verbHelpers` (`tombOf`, `atticShas`, `unsupervised`, `refusedWith`, `interrupted`, `resumeToken`, `failedPairAgrees`), `eventsOf`;
  - wave 5's readers, on the worker's own tree: `parseChildReclaimResult` (`server/src/coord/childReclaim.ts`), `childReclaimFailureLine` and `CHILD_RECLAIM_PRE_LOCK_TOKEN` (`server/src/childReclaimSweep.ts`).

- [ ] **Step 1: Write the failing tests**

Measure the box's git first. Every case below assumes `git show-ref --exists` exists:

```bash
git --version   # must be 2.43.0 or newer; if older, stop and report: this file cannot run here
```

Create `server/test/ccd-child-reclaim-gone-branch.test.ts`:

```ts
// Child reclamation, wave 6, Task 8 (contract §12, R53): the gone-branch pin.
//
// Whether the child's registry branch exists is read THREE ways, by `git
// show-ref --exists`: 0 present, 2 absent, anything else unmeasured. Measured
// on git 2.43.0: `rev-parse --verify --quiet` and `show-ref --verify --quiet`
// both answer 1 for an absent ref, a corrupt loose ref and a ref under an
// unreadable directory, so neither proves absence. Every arm takes the read in
// one act: the ladder's tip reads (the present arm and R19's vanished arm), the
// pin, the vanished arm's pin and the tail's step 5. A branch PROVEN absent
// pins HEAD, the WIP commit and every per-worktree ref and reflog commit,
// deletes no branch, and the reclaim proceeds; a read that did not run stops
// wherever it is asked.
//
// FIXTURE HOME ONLY (`makePrHarness`): the unit and pane calls are RECORDED
// (`CHILD_STUBS`, inside the fixture helpers), never made, and every ref this
// file breaks is the fixture repository's. A new file, not an addition to the
// verb suites (R56: the 600 s foreground ceiling).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_PRE_LOCK_TOKEN, childReclaimFailureLine } from '../src/childReclaimSweep.js';

let h: PrHarness;
let locked: string[] = [];
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-gone-branch-'); });
afterEach(() => {
  // Before the cleanup: `rm` cannot list a mode-000 directory.
  for (const d of locked) fs.chmodSync(d, 0o755);
  locked = [];
  h.cleanup();
});
const { tombOf, atticShas, unsupervised, refusedWith, interrupted, resumeToken, failedPairAgrees } = verbHelpers(() => h);

/** Root reads a mode-000 directory, so the unreadable cases cannot be built as root. */
const ROOT = process.getuid?.() === 0;
const ATTIC_REFLOGS = `refs/ccrc/attic/${CHILD_ID}/reflogs`;
/** `_WS_BRANCH_WHY`, the ladder's and the pins' one detail for a read that did not run. */
const READ_FAILED = new RegExp(`whether refs/heads/${CHILD_BRANCH} exists in .+ could not be read`);
type Broken = 'corrupt' | 'unreadable';
const BROKEN: readonly Broken[] = ['corrupt', 'unreadable'];

/** The child's branch as git stores it: a LOOSE ref in the fixture repository. */
const refFile = (c: Child): string => path.join(c.main, '.git', 'refs', 'heads', ...CHILD_BRANCH.split('/'));

/** A branch that EXISTS but cannot be read: its loose ref overwritten with bytes
 *  that are not a sha, or the directory that holds it made mode 000. */
function breakRef(c: Child, how: Broken): void {
  expect(fs.existsSync(refFile(c)), 'the CONTROL: the branch is a loose ref').toBe(true);
  if (how === 'corrupt') { fs.writeFileSync(refFile(c), 'not a sha\n'); return; }
  const d = path.dirname(refFile(c));
  fs.chmodSync(d, 0o000);
  locked.push(d);
}

/** The broken ref is exactly as `breakRef` left it — nothing deleted or rewrote it.
 *  Restores an unreadable directory's mode first, so assertions after it can read refs. */
function refUntouched(c: Child, how: Broken, sha: string): void {
  if (how === 'unreadable') {
    const d = path.dirname(refFile(c));
    fs.chmodSync(d, 0o755);
    locked = locked.filter((x) => x !== d);
    expect(fs.readFileSync(refFile(c), 'utf8').trim(), 'the unreadable branch still names its commit').toBe(sha);
  } else {
    expect(fs.readFileSync(refFile(c), 'utf8'), 'the corrupt ref was left exactly as it was').toBe('not a sha\n');
  }
}

/** `show-ref --exists`'s own answer, through the plain binary (never ccd). */
const existsRc = (repo: string, pre = ''): string =>
  h.sh(`${pre} git -C "${repo}" show-ref --exists "refs/heads/${CHILD_BRANCH}" >/dev/null 2>&1; printf '%s' "$?"`);

/** `_ws_reclaim_branch_state`'s answer and its rc, as `<answer>|<rc>`. */
const stateOf = (repo: string, pre = ''): string =>
  h.sh(`${pre} s=$(_ws_reclaim_branch_state "${repo}" ${CHILD_BRANCH}); printf '%s|%s' "$s" "$?"`);

const reaches = (repo: string, sha: string, ref: string): boolean => {
  try { h.git(repo, 'merge-base', '--is-ancestor', sha, ref); return true; } catch { return false; }
};

/** A child whose branch is PROVEN gone, its worktree standing: HEAD detached first
 *  (`git branch -D` refuses a checked-out branch), then the branch deleted — the live
 *  `expoAI-assistant-calm-mesa` shape (shape A). */
function goneBranch(c: Child): void {
  h.git(c.wt, 'checkout', '-q', '--detach');
  h.git(c.main, 'branch', '-q', '-D', CHILD_BRANCH);
  expect(existsRc(c.main), 'the CONTROL: git show-ref --exists answers absent').toBe('2');
}

/** The ladder's fingerprint INPUTS: `_ws_reclaim_fingerprint` redefined to write what
 *  it was handed into the fixture HOME, then hash exactly as the real one does. */
const FP_CAPTURE = `_ws_reclaim_fingerprint() { printf '%s\\n' "$@" > "$HOME/fp-inputs"; printf '%s\\n' "$@" | _plat_sha256 | cut -d' ' -f1; };`;
const fpInputs = (): string[] => fs.readFileSync(path.join(h.home, 'fp-inputs'), 'utf8').split('\n').filter(Boolean);

/** The FIRST `_ws_reclaim_branch_state` of a process answers for real; every later one
 *  answers `unmeasured`. Inside the verb the in-lock ladder reads first, so the pin
 *  that follows is the read that fails. The count lives in the fixture HOME, because
 *  every read runs in `$( … )`. */
const LATER_READS_UNMEASURED = [
  `eval "$(declare -f _ws_reclaim_branch_state | sed '1s/^_ws_reclaim_branch_state /_ws_real_branch_state /')";`,
  `_ws_reclaim_branch_state() { local n; n=$(cat "$HOME/bs-reads" 2>/dev/null || echo 0); echo $(( n + 1 )) > "$HOME/bs-reads";`,
  ` if (( n == 0 )); then _ws_real_branch_state "$@"; else printf 'unmeasured\\n'; fi; };`,
].join(' ');

/** A git older than 2.43, as far as ccd can tell: a `git` first on PATH whose
 *  `show-ref` rejects `--exists` the way git 2.42 does (exit 129), and which hands
 *  every other call to the real binary. */
function oldGit(): string {
  const real = h.sh('command -v git');
  const dir = path.join(h.home, 'oldgit');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'git'), [
    '#!/bin/sh',
    'case " $* " in *" show-ref "*"--exists "*) echo "error: unknown option exists" >&2; exit 129 ;; esac',
    `exec "${real}" "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  return 'PATH="$HOME/oldgit:$PATH";';
}

/** `_ws_reclaim_branch_state` as it would read with NO symbolic-branch guard: `present` whenever rev-parse
 *  peels the name. The guard answers first at every real read, so only this stub lets the tail's step-5 CAS
 *  meet a symbolic branch, and so pins Task 3's `--no-deref` (defence in depth) on its own. */
const PRE_GUARD_READ = `_ws_reclaim_branch_state() { local s; s=$(git -C "$1" rev-parse --verify --quiet "refs/heads/$2^{commit}" 2>/dev/null) && printf 'present %s\\n' "$s" || printf 'unmeasured\\n'; };`;

describe('_ws_reclaim_branch_state reads three ways (R53)', () => {
  it('answers present <sha>, absent, and unmeasured outside a repository — rc 0 each time', () => {
    const c = makeChild(h);
    expect(stateOf(c.main)).toBe(`present ${c.tip}|0`);
    goneBranch(c);
    expect(stateOf(c.main)).toBe('absent|0');
    expect(stateOf(path.join(h.home, 'not-a-repository')), 'no repository is no proof of absence').toBe('unmeasured|0');
  }, 60_000);

  it('a CORRUPT loose ref is unmeasured, never absent', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    breakRef(c, 'corrupt');
    expect(existsRc(c.main), 'the CONTROL: git answers neither 0 nor 2').toBe('1');
    expect(stateOf(c.main)).toBe('unmeasured|0');
  }, 60_000);

  it.skipIf(ROOT)('an UNREADABLE refs/heads directory is unmeasured, never absent', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    breakRef(c, 'unreadable');
    expect(existsRc(c.main), 'the CONTROL: git answers neither 0 nor 2').toBe('1');
    expect(stateOf(c.main)).toBe('unmeasured|0');
  }, 60_000);

  it('a git that rejects --exists reads a standing branch present and a gone one unmeasured, never absent (the positive fallback)', () => {
    const c = makeChild(h);
    const pre = oldGit();
    expect(existsRc(c.main, pre), 'the CONTROL: the shim rejects the flag').toBe('129');
    expect(stateOf(c.main, pre), 'rev-parse peels the standing branch').toBe(`present ${c.tip}|0`);
    goneBranch(c);
    expect(existsRc(c.main, pre), 'the CONTROL: the shim still rejects the flag').toBe('129');
    expect(stateOf(c.main, pre), 'only --exists rc 2 ever proves absent').toBe('unmeasured|0');
  }, 60_000);

  it('reads the repository it is NAMED — an inherited GIT_DIR cannot answer for another', () => {
    const c = makeChild(h);
    const other = h.makeRepo('other');                 // a repository with no such branch
    const pre = `export GIT_DIR="${other}/.git";`;
    expect(existsRc(c.main, pre), 'the CONTROL: uncontained, git reads the inherited repository').toBe('2');
    expect(stateOf(c.main, pre)).toBe(`present ${c.tip}|0`);
  }, 60_000);

  it('a SYMBOLIC registry branch is unmeasured, never present: update-ref -d would delete the branch it names', () => {
    const c = makeChild(h);
    goneBranch(c);
    const absentToken = evalOf(h).token;
    expect(absentToken, 'the CONTROL: a proven absence mints a token').toMatch(/^[0-9a-f]{64}$/);
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    h.git(c.main, 'symbolic-ref', `refs/heads/${CHILD_BRANCH}`, 'refs/heads/main');
    expect(existsRc(c.main), 'the CONTROL: git answers that the ref exists').toBe('0');
    expect(h.git(c.main, 'rev-parse', '--verify', '--quiet', `refs/heads/${CHILD_BRANCH}^{commit}`),
      'the CONTROL: rev-parse peels it to main’s commit').toBe(mainTip);
    expect(stateOf(c.main)).toBe('unmeasured|0');
    const a = evalOf(h);
    expect(a.verdict).toBe('unmeasured');
    expect(a.token, 'no token is minted over a symbolic branch').toBe('');
    expect(a.detail).toMatch(READ_FAILED);
    const r = childReclaimVerb(h, absentToken);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('probe-unmeasured');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'main did not move').toBe(mainTip);
    expect(h.git(c.main, 'symbolic-ref', `refs/heads/${CHILD_BRANCH}`), 'the symbolic branch stands as it was').toBe('refs/heads/main');
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
  }, 90_000);
});

describe('the ladder, present arm', () => {
  it('present arm: absence mints tip= and branchState=absent; a standing branch its sha and branchState=present', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    const p = evalOf(h, { pre: FP_CAPTURE });
    expect(p.verdict, p.detail).toBe('reclaimable');
    expect(fpInputs()).toEqual(expect.arrayContaining(['worktree=present', `tip=${c.tip}`, 'branchState=present']));
    h.git(c.main, 'branch', '-q', '-D', CHILD_BRANCH);
    const a = evalOf(h, { pre: FP_CAPTURE });
    expect(a.verdict, a.detail).toBe('reclaimable');
    expect(fpInputs()).toEqual(expect.arrayContaining(['worktree=present', 'tip=', 'branchState=absent']));
    expect(fpInputs().filter((l) => l.startsWith('branchState=')), 'one branchState input, never two').toHaveLength(1);
  }, 60_000);

  for (const how of BROKEN) {
    it.skipIf(how === 'unreadable' && ROOT)(`present arm: a ${how} branch is unmeasured, and a token minted over its absence is never spent over it`, () => {
      const c = makeChild(h);
      goneBranch(c);
      const absentToken = evalOf(h).token;
      expect(absentToken, 'the CONTROL: a proven absence mints a token').toMatch(/^[0-9a-f]{64}$/);
      h.git(c.main, 'branch', CHILD_BRANCH, c.tip);    // the branch is back, and then cannot be read
      breakRef(c, how);
      const a = evalOf(h);
      expect(a.verdict).toBe('unmeasured');
      expect(a.token, 'no token is minted over a read that did not run').toBe('');
      expect(a.detail).toMatch(READ_FAILED);
      const r = childReclaimVerb(h, absentToken);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('probe-unmeasured');
      refUntouched(c, how, c.tip);
      expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
      expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
      expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
      expect(unsupervised(), 'the unit was not touched').toEqual([]);
      expect(atticShas(c), 'nothing was pinned').toEqual([]);
    }, 90_000);
  }
});

describe('the ladder, vanished arm (R19)', () => {
  it('vanished arm: absence mints branchState=absent, and the verb reclaims from what is left', () => {
    const c = makeChild(h);
    goneBranch(c);
    fs.rmSync(c.wt, { recursive: true, force: true });
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the CONTROL: git still records the tree, detached').toMatch(/^detached$/m);
    const a = evalOf(h, { pre: FP_CAPTURE });
    expect(a.verdict, a.detail).toBe('reclaimable');
    expect(fpInputs()).toEqual(expect.arrayContaining(['worktree=absent', 'tip=', 'branchState=absent']));
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    const r = childReclaimVerb(h, a.token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticShas(c), 'the HEAD git’s record named is pinned').toContain(c.tip);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git’s stale record was cleared').not.toMatch(/^prunable /m);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'no branch was made or left').toBe('');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'no other branch moved').toBe(mainTip);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row was purged').toBeNull();
    const tomb = tombOf();
    expect(tomb['worktree']).toBe('absent');
    expect(tomb['tip'], 'no tip: there was no branch to delete').toBe('');
    expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'done']);
  }, 90_000);

  for (const how of BROKEN) {
    it.skipIf(how === 'unreadable' && ROOT)(`vanished arm: a ${how} branch is unmeasured, and the row is never purged over it`, () => {
      const c = makeChild(h);
      goneBranch(c);
      fs.rmSync(c.wt, { recursive: true, force: true });
      const absentToken = evalOf(h).token;
      expect(absentToken, 'the CONTROL: a proven absence mints a token').toMatch(/^[0-9a-f]{64}$/);
      h.git(c.main, 'branch', CHILD_BRANCH, c.tip);
      breakRef(c, how);
      const a = evalOf(h);
      expect(a.verdict).toBe('unmeasured');
      expect(a.detail).toMatch(READ_FAILED);
      const r = childReclaimVerb(h, absentToken);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('probe-unmeasured');
      refUntouched(c, how, c.tip);
      expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git’s record of the vanished tree stands').toMatch(/^prunable /m);
      expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
      expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
      expect(unsupervised(), 'the unit was not touched').toEqual([]);
    }, 90_000);
  }
});

describe('the pin and the tail', () => {
  it('the live expoAI-assistant-calm-mesa shape reclaims, HEAD and every reflog commit kept', () => {
    const c = makeChild(h);
    // The work landed on main: the live HEAD and every reflog commit are on origin/main.
    h.git(c.main, 'merge', '-q', '--ff-only', CHILD_BRANCH);
    h.git(c.main, 'push', '-q', 'origin', 'main');
    // A reset away and back leaves ORIG_HEAD in the worktree's own git directory, as the live one holds.
    h.git(c.wt, 'reset', '-q', '--hard', 'HEAD~1');
    h.git(c.wt, 'reset', '-q', '--hard', c.tip);
    const origHead = h.git(c.wt, 'rev-parse', 'ORIG_HEAD');
    goneBranch(c);
    const reflog = [...new Set(h.git(c.wt, 'reflog', 'show', '--format=%H', 'HEAD').split('\n').filter(Boolean))];
    // The CONTROLS: the live shape, measured.
    expect(h.git(c.wt, 'status', '--porcelain'), 'the tree is clean').toBe('');
    expect(reflog.length, 'the reflog names more than HEAD').toBeGreaterThan(1);
    for (const sha of [c.tip, origHead, ...reflog]) {
      expect(reaches(c.main, sha, 'refs/remotes/origin/main'), `${sha} is on origin/main`).toBe(true);
    }
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    const a = evalOf(h);
    expect(a.verdict, a.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, a.token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree is gone').toBe(false);
    expect(atticShas(c), 'HEAD is pinned by sha').toContain(c.tip);
    for (const sha of new Set([origHead, ...reflog])) {
      expect(reaches(c.main, sha, ATTIC_REFLOGS), `${sha} is kept under ${ATTIC_REFLOGS}`).toBe(true);
    }
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'no branch was made').toBe('');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'main did not move').toBe(mainTip);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row was purged').toBeNull();
    const tomb = tombOf();
    expect(tomb['worktree']).toBe('present');
    expect(tomb['tip'], 'no tip: there was no branch to delete').toBe('');
    expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'done']);
  }, 90_000);

  it('a HEAD still symbolic to the gone branch stays pin-failed, nothing pinned', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'uncommitted\n');
    // Shape B: `git branch -D` refuses a checked-out branch, but `update-ref -d` does not.
    h.git(c.main, 'update-ref', '-d', `refs/heads/${CHILD_BRANCH}`);
    expect(h.git(c.wt, 'symbolic-ref', 'HEAD'), 'the CONTROL: HEAD still names the branch').toBe(`refs/heads/${CHILD_BRANCH}`);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the CONTROL: git lists HEAD as zeros').toMatch(/^HEAD 0{40}$/m);
    const a = evalOf(h);
    // If this CONTROL is red, STOP and report: R53 rules this shape stays pin-failed; never change the ladder to meet it.
    expect(a.verdict, `the CONTROL: the ladder passes this shape (${a.detail})`).toBe('reclaimable');
    const r = childReclaimVerb(h, a.token);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toMatch(new RegExp(`still has ${CHILD_BRANCH} checked out, but ${CHILD_BRANCH} is gone`));
    expect(fs.readFileSync(path.join(c.wt, 'f1.txt'), 'utf8'), 'the uncommitted work stands').toContain('uncommitted');
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
  }, 90_000);

  it('a branch that reappears after the tombstone is kept: branch-moved', () => {
    const c = makeChild(h);
    goneBranch(c);
    interrupted(c, 'children');                      // pin and tombstone over the proven absence
    expect(tombOf()['tip'], 'the CONTROL: the record names no tip').toBe('');
    h.git(c.main, 'branch', CHILD_BRANCH, c.tip);    // re-created by someone else, after the record
    const r = childReclaimVerb(h, resumeToken('children'));
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('branch-moved');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the reappeared branch stands where it was made').toBe(c.tip);
    expect(tombOf()['tip'], 'the settle did not adopt its tip').toBe('');
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stops at the branch').toBe('reclaim:branch');
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
  }, 90_000);

  it('the settle reads the branch itself: a ref broken after the pin is pin-failed, the tree standing', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    interrupted(c, 'children');
    expect(tombOf()['tip'], 'the CONTROL: the pin recorded the tip').toBe(c.tip);
    breakRef(c, 'corrupt');
    const r = childReclaimVerb(h, resumeToken('children'));
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toMatch(READ_FAILED);
    refUntouched(c, 'corrupt', c.tip);
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb is where it was').toBe('reclaim:children');
  }, 90_000);

  it('step 5: a branch the tail cannot read stops it as branch-unmeasured, journaled failed, the row kept', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    fs.mkdirSync(path.join(h.home, '.cc-clips', CHILD_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png'), 'png');
    interrupted(c, 'children');
    // The tail died after step (4): the tree and git's record of it are gone, and the breadcrumb says `branch`.
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    h.sh(`_reg_set ${CHILD_ID} reaping reclaim:branch`);
    breakRef(c, 'corrupt');
    const r = childReclaimVerb(h, resumeToken('branch'));
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('branch-unmeasured');
    expect(o.detail).toMatch(new RegExp(`whether ${CHILD_BRANCH} exists in .+ could not be read`));
    // ONE failed line, never a refusal, carrying the document's own detail (R43, gone-branch.OPEN5).
    failedPairAgrees(r);
    const last = eventsOf(h.home, 'reclaim').pop()!;
    expect([last['outcome'], last['refusal'], last['verb']]).toEqual(['failed', 'branch-unmeasured', 'ws-reclaim']);
    expect(childReclaimFailureLine({ outcome: String(last['outcome']), refusal: String(last['refusal']) }),
      'wave 5’s reader counts it a failure').toBe(true);
    expect(Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN), 'a failed line needs no pre-lock entry').not.toContain('branch-unmeasured');
    // The tail's real state at step 5: the breadcrumb stands at the branch, so the retry resumes there.
    expect(parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr))
      .toMatchObject({ kind: 'failed', resume: 'resumable', token: 'branch-unmeasured' });
    refUntouched(c, 'corrupt', c.tip);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the branch').toBe('reclaim:branch');
    expect(fs.existsSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png')), 'the artifacts step never ran').toBe(true);
  }, 90_000);

  it('the tail deletes the registry branch itself, never the branch a symbolic one names (--no-deref)', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    interrupted(c, 'children');
    expect(tombOf()['tip'], 'the CONTROL: the pin recorded the tip').toBe(c.tip);
    // The tail died after step (4), as in the step-5 case above.
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    h.sh(`_reg_set ${CHILD_ID} reaping reclaim:branch`);
    // The registry branch becomes SYMBOLIC, naming another branch at the same commit.
    h.git(c.main, 'branch', 'ws/target', c.tip);
    h.git(c.main, 'symbolic-ref', `refs/heads/${CHILD_BRANCH}`, 'refs/heads/ws/target');
    expect(h.git(c.main, 'symbolic-ref', `refs/heads/${CHILD_BRANCH}`), 'the CONTROL: the registry branch is symbolic')
      .toBe('refs/heads/ws/target');
    // The real read answers `unmeasured` here (the case above), so the read is stubbed to its pre-guard self:
    // the CAS's own `--no-deref` is the only guard left.
    const r = childReclaimVerb(h, resumeToken('branch'), { pre: PRE_GUARD_READ });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(h.git(c.main, 'for-each-ref', '--format=%(objectname)', 'refs/heads/ws/target'),
      'the branch the symbolic one named stands').toBe(c.tip);
    expect(h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/heads/${CHILD_BRANCH}`),
      'the symbolic registry branch itself was deleted').toBe('');
  }, 90_000);

  it('the fresh pin reads the branch itself: unmeasured there is pin-failed', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    const r = childReclaimVerb(h, evalOf(h).token, { pre: LATER_READS_UNMEASURED });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toMatch(READ_FAILED);
    expect(fs.readFileSync(path.join(h.home, 'bs-reads'), 'utf8').trim(), 'the CONTROL: the ladder read, then the pin').toBe('2');
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
  }, 90_000);

  it('the vanished arm’s pin reads it too: unmeasured there is pin-failed', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token, { pre: LATER_READS_UNMEASURED });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toMatch(READ_FAILED);
    expect(fs.readFileSync(path.join(h.home, 'bs-reads'), 'utf8').trim(), 'the CONTROL: the ladder read, then the pin').toBe('2');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git’s record stands').toMatch(/^prunable /m);
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
  }, 90_000);

  it('a git older than 2.43 fails closed: unmeasured audit, probe-unmeasured verb', () => {
    const c = makeChild(h);
    goneBranch(c);
    const token = evalOf(h).token;                   // minted by the real git, over the proven absence
    const pre = oldGit();
    const a = evalOf(h, { pre });
    expect(a.verdict).toBe('unmeasured');
    expect(a.detail).toMatch(READ_FAILED);
    const r = childReclaimVerb(h, token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('probe-unmeasured');
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
  }, 90_000);

  it('a git older than 2.43 reclaims a standing branch exactly as today (the positive fallback)', () => {
    const c = makeChild(h);
    const pre = oldGit();
    const a = evalOf(h, { pre });
    expect(a.verdict, a.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, a.token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(atticShas(c), 'the tip is pinned').toContain(c.tip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch was deleted at its tip').toBe('');
    expect(h.reg(CHILD_ID, 'uuid'), 'the row was purged').toBeNull();
  }, 90_000);

  it('a token minted over absence is refused once the branch reappears: state-changed', () => {
    const c = makeChild(h);
    goneBranch(c);
    const token = evalOf(h).token;
    h.git(c.main, 'branch', CHILD_BRANCH, c.tip);
    expect(refusedWith(childReclaimVerb(h, token))).toBe('state-changed');
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
  }, 90_000);
});
```

Then rewrite the one case in `server/test/ccd-child-reclaim-pin.test.ts` whose behaviour R53 reverses. Locate it with `grep -n 'FAILS when the branch no longer resolves' server/test/ccd-child-reclaim-pin.test.ts`. Rename its `describe` to `'the branch tip is a REQUIRED pin when the branch exists'` and replace the case with:

```ts
  it('a branch PROVEN absent is no failure — no tip, and HEAD is pinned in its place (spec §5.5)', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '--detach');
    const p = pinOf(c, { between: `git -C "${c.main}" update-ref -d refs/heads/${CHILD_BRANCH}` });
    expect(p.rc, p.why).toBe('0');
    expect(p.tip, 'no tip: there is no branch').toBe('');
    expect(atticShas(c), 'HEAD is pinned in the tip’s place').toContain(c.tip);
  }, 60_000);
```

Then, in `server/test/lifecycle-refusal-word.test.ts` (R43: the new word carries its `ALL_TOKENS` entry, its disjointness from `SENTENCES` is the file's existing `shares no key with SENTENCES` case, and its sentence is pinned true of the tail's real state at step 5):
- `ALL_TOKENS`' last line `'pin-failed': true, 'unit-still-active': true,` becomes `'pin-failed': true, 'unit-still-active': true, 'branch-unmeasured': true,`, and `expect(TOKENS.length).toBe(14);` becomes `expect(TOKENS.length).toBe(15);`.
- `it.each(['pin-failed', 'unit-still-active'] as const)('%s says nothing further went, and never that anything is intact', …)` becomes `it.each(['pin-failed', 'unit-still-active', 'branch-unmeasured'] as const)(…)`, body unchanged. By step 5 the unit is stopped, the pane is gone and the tree was removed (or never stood, on the vanished arm), so the word may promise only that nothing FURTHER went.
- Directly after the `it('unit-still-active names the service AND the terminal pane, and claims only that neither was proven stopped', …)` case, add:

```ts
  // Wave 6 (spec §5.5): the tail's step 5 could not READ whether the branch
  // still stands. The word says the read failed, never that the branch is gone
  // or that it was kept, and that a retry follows.
  it('branch-unmeasured says whether the branch exists could not be read, and that ccrc tries again', () => {
    expect(LC_REFUSAL_WORD['branch-unmeasured']).toMatch(/could not read whether the branch still exists/);
    expect(LC_REFUSAL_WORD['branch-unmeasured']).toMatch(/tries again/);
    expect(LC_REFUSAL_WORD['branch-unmeasured']).not.toMatch(/\bgone\b|was kept|was deleted/);
  });
```

Then, in `server/test/child-reclaim-status.test.ts` (R43: the failure-word list; wave 5's file, on the worker's tree), make two edits. Find both sites by name: `grep -nF 'failed unit-still-active → deferred' server/test/child-reclaim-status.test.ts` and `grep -nF 'reads a failure token’s journal word ahead of the audit sentences' server/test/child-reclaim-status.test.ts` each print one line.
- Directly after the `ROWS` entry `failed unit-still-active → deferred, wave 3’s journal word, not the audit fallback` (its three lines), add:

```ts
  { name: 'failed branch-unmeasured → deferred, its journal word, not the audit fallback',
    input: base({ event: ev('failed', 'branch-unmeasured') }),
    want: { word: 'deferred', sentence: lcRefusalWord('branch-unmeasured'), at: EV_AT } },
```

  In the comment directly above those rows, `these two rows cannot pass on a missing word` becomes `these rows cannot pass on a missing word`.
- In `reads a failure token’s journal word ahead of the audit sentences`, the list `['pin-failed', 'unit-still-active', 'flock-unavailable', 'lock-unopenable']` becomes `['pin-failed', 'unit-still-active', 'flock-unavailable', 'lock-unopenable', 'branch-unmeasured']`.

- [ ] **Step 2: Run the tests to verify they fail**

Run, in the foreground with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-gone-branch.test.ts test/ccd-child-reclaim-pin.test.ts -t 'three ways|ladder|vanished|pin and the tail|PROVEN absent'
cd server && ./node_modules/.bin/vitest run test/lifecycle-refusal-word.test.ts test/child-reclaim-status.test.ts
```

Expected: FAIL. Everything below fails except three cases, which PASS. `the tail deletes the registry branch itself, never the branch a symbolic one names` is the defence Task 3 already put in place. Today's step 5 follows the symbolic ref through `show-ref --verify`, but Task 3's CAS (`update-ref -d --no-deref`) deletes only the symbolic ref, and the stub changes nothing yet. Its red is Step 5's row 18. `a token minted over absence is refused once the branch reappears` is the control, because the `tip` input already changes. `a git older than 2.43 reclaims a standing branch exactly as today` is the fallback's control: today's reads never ask `--exists`, so the shim changes nothing yet. The failures, case by case:
- **The six `_ws_reclaim_branch_state` cases:** `expected '|127' to be 'present <sha>|0'` (or `'absent|0'` / `'unmeasured|0'`). The function does not exist, so the command substitution answers 127. Their CONTROLs (`existsRc`, and the symbolic case's `rev-parse`) pass first.
- **`present arm: absence mints …`:** `expected [ …(n) ] to deeply equal ArrayContaining [ 'worktree=present', 'tip=<sha>', 'branchState=present' ]`.
- **`present arm: a corrupt/unreadable branch …` and `vanished arm: a corrupt/unreadable branch …`:** `expected 'reclaimable' to be 'unmeasured'`, because the fold mints a token.
- **`vanished arm: absence mints …`:** the `ArrayContaining` assertion, because `branchState=absent` is missing.
- **`the live expoAI-assistant-calm-mesa shape`:** `expected 1 to be 0`. stdout carries `pin-failed` with `refs/heads/ws/quiet-basin does not resolve in … — there is no branch tip to pin`, the live box's own detail.
- **`a HEAD still symbolic …`:** the detail regex fails. The pin fails at the WIP commit instead, with the WIP's own reason: it cannot diff the index against a HEAD that names no commit.
- **`a branch that reappears …`:** `Command failed: bash -c …` from `interrupted()`, because the pin refuses the absent branch.
- **`the settle reads the branch itself`:** the detail regex fails. The detail is today's `does not resolve … no branch tip to pin`.
- **`step 5: …`:** `expected 0 to be 1`. The tail skipped the delete, removed the clips and purged the row.
- **The two `… reads the branch itself / reads it too` stub cases:** `expected 0 to be 1`. Nothing consults the stub, and the reclaim completes.
- **`a git older than 2.43 …`:** `expected 'reclaimable' to be 'unmeasured'`.
- **The rewritten pin case:** `expected '1' to be '0'`, with why `refs/heads/ws/quiet-basin does not resolve`.
- **`lifecycle-refusal-word`:** `isLcRefusalToken(branch-unmeasured)` gives `expected false to be true`. `covers the whole union` gives a diff with `branch-unmeasured` only on the expected side. The `branch-unmeasured says nothing further went …` row and the new word case give `TypeError: .toMatch() expects to receive a string, but got undefined`.
- **`child-reclaim-status`:**
  - The `failed branch-unmeasured → deferred…` row: `expected { word: 'deferred', sentence: 'ccrc declined: branch-unmeasured.', … } to deeply equal { word: 'deferred', sentence: null, … }`. `lcRefusalWord` answers `null` for a token outside the union, and the derivation falls back to `refusalSentence`.
  - `gives every word it answers a sentence`: `expected null not to be null`.
  - The token loop: `branch-unmeasured has no LC_REFUSAL_WORD entry: wave 3's journal words did not land: expected null not to be null`.

The unreadable cases report as skipped when the suite runs as root.

- [ ] **Step 3: Implement — one act, every arm**

All edits are in `ccd/ccd`, inside the RECLAIM region. Locate each site by its grep (see Files).

**(a)** In `_ws_reclaim_reset`, directly after the two-line `RECLAIM_HEAD=""` entry, add:

```bash
  RECLAIM_BRANCHSTATE=""    # `present` or `absent`, as `_ws_reclaim_tip_read` PROVED it; '' = never read.
  #                           A fingerprint input (`branchState=`): a read that did not run mints no token
```

**(b)** Directly after `_ws_reclaim_main_line_refuse`'s closing `}`, add:

```bash
_ws_reclaim_branch_state() {   # gitdir-or-repo branch -> prints exactly one of `present <40-hex>`, `absent`,
  #                                 `unmeasured`; always rc 0
  # WHETHER THE BRANCH EXISTS, READ THREE WAYS (spec §5.5; spec §5.5, step
  # 3). `rev-parse --verify --quiet` and `show-ref --verify --quiet` answer 1
  # for an absent ref, a corrupt loose ref and a ref under an unreadable
  # directory alike (measured, git 2.43.0), so neither proves absence.
  # `show-ref --exists` does: 0 present, 2 absent, and anything else — 1 for a
  # ref that would not read, 128 for no repository, 129 from a git older than
  # 2.43 that does not know the flag — is a read that did not run. ONLY rc 2
  # IS EVER TAKEN AS ABSENT. It is necessary, though not sufficient alone: a
  # loose ref that is a dangling symlink over a packed entry answers 2 too,
  # while git still lists the packed branch (measured, git 2.43). That
  # branch is then never deleted, only left with no row: a leak, never a
  # loss, and a stated residual. THE POSITIVE FALLBACK (spec §5.5, old
  # git): on rc 0, or on any answer but 0 or 2, a ref that
  # `rev-parse --verify --quiet` peels to a commit reads `present`, so a box
  # on a git older than 2.43 reclaims a standing branch as before and never
  # a gone one. A SYMBOLIC branch never reads `present` (the guard below).
  # Anything else is `unmeasured`, and every caller stops on it. A branch is
  # never taken for gone over a read that did not run. Contained, so an
  # inherited GIT_DIR or GIT_NAMESPACE cannot answer for another
  # repository's refs. `present` carries the sha, read once more; a ref that
  # will not peel to a commit is unmeasured too.
  local repo="$1" b="$2" rc src sha
  if [[ -n "$b" ]]; then
    _ws_reclaim_contained git -C "$repo" show-ref --exists "refs/heads/$b" >/dev/null 2>&1; rc=$?
    if (( rc == 2 )); then
      printf 'absent\n'; return 0
    fi
    # A SYMBOLIC branch is never present: `update-ref -d` follows it and deletes
    # the branch it names (measured, git 2.43), past every check asked of <b>.
    _ws_reclaim_contained git -C "$repo" symbolic-ref -q "refs/heads/$b" >/dev/null 2>&1; src=$?
    if (( src == 1 )); then
      sha=$(_ws_reclaim_contained git -C "$repo" rev-parse --verify --quiet "refs/heads/$b^{commit}" 2>/dev/null) \
        && [[ "$sha" =~ ^[0-9a-f]{40}$ ]] && { printf 'present %s\n' "$sha"; return 0; }
    fi
  fi
  printf 'unmeasured\n'
  return 0
}

_WS_BRANCH_WHY=''
_ws_reclaim_tip_read() {   # main branch -> 0 with REAP_TIP (the tip; '' when the branch is PROVEN absent)
  #                             and RECLAIM_BRANCHSTATE (`present`|`absent`); 1 with _WS_BRANCH_WHY when
  #                             whether it exists could not be read. THE ONE TIP READ of the ladder's two
  #                             arms, the pin and the vanished arm's pin (spec §5.5: in one act).
  local s
  REAP_TIP=""; RECLAIM_BRANCHSTATE=""; _WS_BRANCH_WHY=""
  s=$(_ws_reclaim_branch_state "$1" "$2")
  case "$s" in
    "present "*) REAP_TIP="${s#present }"; RECLAIM_BRANCHSTATE=present; return 0 ;;
    absent) RECLAIM_BRANCHSTATE=absent; return 0 ;;
  esac
  _WS_BRANCH_WHY="whether refs/heads/$2 exists in $1 could not be read (git show-ref --exists answered neither present nor absent, or the ref is symbolic: a ref that will not read, no repository, a git older than 2.43, or a branch that names another) — a branch is never taken for gone over a read that did not run"
  return 1
}
```

**(c)** The ladder's present arm. Replace these two lines (the comment, then the FIRST hit of the tip-read grep):

```bash
  # The facts the pin phase will act on, each a fingerprint input.
  REAP_TIP=$(git -C "$main" rev-parse --verify --quiet "refs/heads/$branch^{commit}" 2>/dev/null) || REAP_TIP=""
```

with:

```bash
  # The facts the pin phase will act on, each a fingerprint input. The branch
  # is read THREE ways (`_ws_reclaim_tip_read`, spec §5.5): its tip, or
  # PROVEN absent (no tip to pin, no branch to delete), or a read that did not
  # run — unmeasured, and no token is minted over it.
  _ws_reclaim_tip_read "$main" "$branch" || { _ws_reclaim_unmeasured "$_WS_BRANCH_WHY"; return 1; }
```

In the same function's `REAP_TOKEN=$(_ws_reclaim_fingerprint …` call, replace the line

```bash
    "worktreeHead=$wthead" "tip=$REAP_TIP" "head=$RECLAIM_HEAD" "statusDigest=$RECLAIM_STATUSDIGEST" \
```

with

```bash
    "worktreeHead=$wthead" "tip=$REAP_TIP" "branchState=$RECLAIM_BRANCHSTATE" "head=$RECLAIM_HEAD" \
    "statusDigest=$RECLAIM_STATUSDIGEST" \
```

and put this above the `REAP_TOKEN=` line, below `# 10 is the VERB's …`:

```bash
  # `branchState` is an INPUT of its own (spec §5.5): `tip=` is empty for a
  # branch PROVEN absent, and a read that could not run mints no token at all,
  # so no token is ever spent as "absent" over a ref that would not read.
```

**(d)** `_ws_reclaim_eval_absent`. Replace its tip read, now the FIRST of the three lines that `grep -nF 'REAP_TIP=$(git -C "$main" rev-parse --verify --quiet' ccd/ccd` prints:

```bash
  REAP_TIP=$(git -C "$main" rev-parse --verify --quiet "refs/heads/$branch^{commit}" 2>/dev/null) || REAP_TIP=""
```

with

```bash
  _ws_reclaim_tip_read "$main" "$branch" || { _ws_reclaim_unmeasured "$_WS_BRANCH_WHY"; return 1; }
```

and its fingerprint line

```bash
    "registryBranch=$regbranch" "worktreeHead=$wthead" "tip=$REAP_TIP" "head=$RECLAIM_HEAD" \
```

with

```bash
    "registryBranch=$regbranch" "worktreeHead=$wthead" "tip=$REAP_TIP" "branchState=$RECLAIM_BRANCHSTATE" \
    "head=$RECLAIM_HEAD" \
```

In its header comment, change "The facts pinned are the branch tip," to "The facts pinned are the branch tip when the branch exists (`_ws_reclaim_tip_read`),".

**(e)** `_ws_reclaim_pin_contained`. Directly after the `fi` that closes the HEAD read, the one whose `elif` sets `RECLAIM_PIN_WHY="could not read which branch $workdir has checked out"`, add:

```bash
  # THE BRANCH, READ THREE WAYS, BEFORE ANYTHING IS COMMITTED (spec §5.5;
  # spec §5.5, step 3). A read that did not run stops the pin here. A branch
  # PROVEN absent is no failure: there is no tip to pin and none for the tail
  # to delete it at, and HEAD, the WIP commit and every reflog below are pinned
  # as ever — unless HEAD is still SYMBOLIC to that branch (an `update-ref -d`
  # under a checkout): HEAD then names no commit, the WIP commit has no parent
  # to stand on, and the pin fails with nothing written.
  _ws_reclaim_tip_read "$main" "$branch" || { RECLAIM_PIN_WHY="$_WS_BRANCH_WHY"; return 1; }
  if [[ "$RECLAIM_BRANCHSTATE" == absent && "$headref" == "refs/heads/$branch" ]]; then
    RECLAIM_PIN_WHY="$workdir still has $branch checked out, but $branch is gone from $main — HEAD names no commit for the WIP commit to stand on, so nothing was pinned"
    return 1
  fi
```

Then replace the whole tip block, from `# THE BRANCH TIP IS A REQUIRED PIN (spec §5.5, step 3): it is the commit the` through the `extras+=("$REAP_TIP")` line below its `|| { REAP_TIP=""; RECLAIM_PIN_WHY="refs/heads/$branch does not resolve …"; return 1; }`, with:

```bash
  # THE BRANCH TIP IS A REQUIRED PIN WHEN THE BRANCH EXISTS (spec §5.5, step
  # 3): it is the commit the tail deletes the branch at, and on a DETACHED or
  # drifted child it is not HEAD, so nothing else pins it. The WIP commit is
  # pinned beside it by sha. Read above (`_ws_reclaim_tip_read`); a branch
  # PROVEN absent leaves REAP_TIP empty, which `_ws_reclaim_attic_extra` skips.
  extras+=("$REAP_TIP")
```

**(f)** `_ws_reclaim_pin_absent_contained`. Replace its tip read (the one line the `grep -nF` tip-read grep still prints) with:

```bash
  # Read three ways (`_ws_reclaim_tip_read`, spec §5.5): a branch PROVEN
  # absent has no tip, and the record's HEAD is what is left; a read that did
  # not run is a pin that cannot be taken.
  _ws_reclaim_tip_read "$main" "$branch" || { RECLAIM_PIN_WHY="$_WS_BRANCH_WHY"; return 1; }
```

**(g)** The tail's settle. Directly after

```bash
    if ! _ws_reclaim_pin "$id" "$workdir" "$main" "$branch" "$childof"; then
      _ws_reclaim_fail "$id" "$lctx" pin-failed "$RECLAIM_PIN_WHY"; return 1
    fi
```

add:

```bash
    # A BRANCH THE RECORD SAYS WAS ABSENT IS NEVER ADOPTED (spec §5.5): the
    # pin proved no branch and recorded no tip, so one that stands now was made
    # after the record, by someone else. The settle keeps the record's empty
    # tip, and step (5) keeps that branch (`branch-moved`).
    [[ -n "$tip" ]] || REAP_TIP=""
```

**(h)** The tail's step 5. Append ` bstate` to the tail's `local` line that starts `local holders` (Tasks 5 and 6 may have changed its other names; add only this one). Then replace the line

```bash
    if git -C "$main" show-ref --verify --quiet "refs/heads/$branch"; then
```

(find it with `grep -nF 'show-ref --verify --quiet "refs/heads/$branch"' ccd/ccd`, which prints four lines: edit only the hit inside `_ws_reclaim_tail`, the last of the four; the other three are ws-reap and gc code and are never edited) with:

```bash
    # WHETHER THE BRANCH STANDS, READ THREE WAYS (spec §5.5): `absent` is
    # proven, and there is nothing to delete; a read that did not run stops the
    # tail here as `branch-unmeasured`, journaled `failed`, the row and the
    # breadcrumb kept — never skipping the delete and purging the row over a
    # branch that may still stand. The retry resumes at this step.
    bstate=$(_ws_reclaim_branch_state "$main" "$branch")
    if [[ "$bstate" != absent && "$bstate" != "present "* ]]; then
      _ws_reclaim_fail "$id" "$lctx" branch-unmeasured \
        "whether $branch exists in $main could not be read — a branch is never taken for gone over a read that did not run, so it was kept and nothing further was deleted"
      return 1
    fi
    if [[ "$bstate" == "present "* ]]; then
```

The body of that `if` (the `branch-moved` test on a tip that is not 40-hex, the holders, the main-line proof, the keep, and Task 3's contained `update-ref -d --no-deref`) and its closing `fi` are unchanged.

**(i)** The new word, in L0 (`shared/api.ts`; gone-branch.OPEN5, R43). Locate both sites by content (see Files).
- The union's last member `| 'unit-still-active';      // ws-reclaim (spec 2026-09-22 §5.6): …` loses its `;` and keeps its comment unchanged. Directly after it, add ONE line:

```ts
  | 'branch-unmeasured';      // ws-reclaim (spec §5.5): the tail's step 5 could not read whether the child's branch still exists, so it stopped before removing anything further — journaled `failed`, never `refused`
```

- In `LC_REFUSAL_WORD`, directly after the two-line `'unit-still-active':` entry and before the closing `};`, add:

```ts
  // Child reclamation, wave 6 (spec §5.5). The tail's step 5 could not read
  // whether the child's branch still exists: `git show-ref --exists` answered
  // neither present nor absent. Only ever rides `_lc_fail`, after the act
  // started. By step 5 the unit is stopped, the pane is gone and the tree was
  // removed (or never stood, on the vanished arm), so the sentence promises
  // nothing intact, only that nothing FURTHER went. The breadcrumb stays at the
  // branch, and the retry resumes there.
  'branch-unmeasured':
    'ccrc could not read whether the branch still exists, so it stopped before removing anything further; it tries again.',
```

The union gains exactly ONE line, and Step 4's citation tax depends on that. No server table changes: wave 5's reader counts any `failed` line as a failure (`childReclaimFailureLine`), `parseChildReclaimResult` reads every `failed` word but `probe-unmeasured` as `resumable`, and a `failed` line needs no `CHILD_RECLAIM_PRE_LOCK_TOKEN` entry. The ccd comment in (h) spells none of the shapes `wsaudit.test.ts` and `ccd-wsaudit-nonpoison.test.ts` harvest (a `"refused":"…"` or `"verdict":"…"` literal, `_reap_refuse` followed by a word, a `'!`-prefixed word), and `_ws_reclaim_fail "$id" "$lctx" branch-unmeasured` is the word's one literal call site.

Verify the one act took:

```bash
R() { sed -n '/── RECLAIM-BEGIN ──/,/── RECLAIM-END ──/p' ccd/ccd; }   # the RECLAIM region; every count below is scoped to it
R | grep -cF 'show-ref --exists'                                            # 3: (b)'s header line, its call, the _WS_BRANCH_WHY text
R | grep -cF 'symbolic-ref -q "refs/heads/$b"'                              # 1: (b)'s symbolic-branch guard
R | grep -cF '_ws_reclaim_tip_read "$main" "$branch"'                       # 4: (c), (d), (e), (f)
R | grep -cF 'bstate=$(_ws_reclaim_branch_state "$main" "$branch")'         # 1: (h)
R | grep -cF 'branchState=$RECLAIM_BRANCHSTATE'                             # 2: the two fingerprint calls
R | grep -cF 'rev-parse --verify --quiet "refs/heads/$branch^{commit}"'     # 0: all four old tip reads replaced
R | grep -cF 'show-ref --verify --quiet "refs/heads/$branch"'               # 0: step 5's old test replaced (three more stand OUTSIDE the region, in ws-reap and gc code: never edit them)
R | grep -cF '_ws_reclaim_fail "$id" "$lctx" branch-unmeasured'             # 1: (h)
R | grep -cF '_ws_reclaim_contained git -C "$main" worktree remove'         # 4: unchanged by this task (X3), or what Tasks 5 to 7 re-pinned it to
R | grep -cF '_ws_reclaim_contained git -C "$main" update-ref -d --no-deref' # 2: unchanged by this task (X3): Task 3's two branch CASes
```

Each line prints one number, and its comment gives the number expected and where it comes from. Every pattern is a fixed string (`-F`), so a `$` in it is literal under GNU grep and under the harness's ugrep alike. `R` keeps the three ws-reap and gc lines that spell the old step-5 test out of the `# 0` count. A `0` where the comment expects more means the edit did not land. It never means the pattern matched nothing.

- [ ] **Step 4: Re-stamp `ccd/ccd`, then run the tests to verify they pass**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts
```

Then pay the citation tax for the one `LcRefusalToken` line (i) inserted (R56). That line sits BELOW the three purge union arms README cites and ABOVE the three `LC_REFUSAL_WORD` keys it cites, so README's union anchor does not move and each map anchor moves down by one. Measure, prove the bytes identical, re-point, and re-measure the census:

```bash
OLD_U=$(grep -oE 'shared/api\.ts:[0-9]+-[0-9]+' README.md | sed 's/.*://')
OLD_M=$(sed -n '/`purge-mechanism-absent` (`shared\/api\.ts:/,+1p' README.md | grep -oE '`:[0-9]+`' | tr -d '`:' | paste -sd' ')
NEW_U=$(grep -nE "^  \| 'purge-(refused|incomplete|mechanism-absent)'" shared/api.ts | cut -d: -f1 | paste -sd' ')
NEW_M=$(grep -nE "^  'purge-(refused|incomplete|mechanism-absent)':$" shared/api.ts | cut -d: -f1 | paste -sd' ')
echo "README union ${OLD_U} map ${OLD_M} | tree union ${NEW_U} map ${NEW_M}"
read -r U1 _ U3 <<<"$NEW_U"; read -r M1 M2 M3 <<<"$NEW_M"; read -r OM1 OM2 OM3 <<<"$OLD_M"
diff <(git show "HEAD:shared/api.ts" | sed -n "${OLD_U/-/,}p;${OM1}p;${OM2}p;${OM3}p") \
     <(sed -n "${U1},${U3}p;${M1}p;${M2}p;${M3}p" shared/api.ts) && echo SAME-BYTES
```

Expected: README's union anchor spans exactly the tree's first and third union line numbers, each of the tree's three map numbers is README's plus one, and then `SAME-BYTES`. If the `diff` prints anything, STOP and report it in the wave-done mail: README was already stale at `HEAD`.

```bash
perl -pi -e "s/\`:${OM1}\`/\`:${M1}\`/; s/\`:${OM2}\`/\`:${M2}\`/; s/\`:${OM3}\`/\`:${M3}\`/" README.md
git diff --stat -- README.md     # README.md | 4 ++--  (the two lines of the purge-refusal sentence, nothing else)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|THE RANGE BOUND')
```

Expected: PASS. If more README lines changed, `git checkout -- README.md` and edit those two lines by hand. If the census's `'ccd/ccd'` entry is red, a byte moved above `ccd/ccd:19109` that this task did not mean to move: find it. If ONLY CITATION DEBT's `'shared/api.ts'` entry (and so its `total`) is red, set the entry and the `total` to the RECEIVED values, never values from this plan, put this comment directly above the entry, and re-run (PASS):

```ts
    // RE-MEASURED at child-reclamation wave 6, Task 8 (S6-R11, no rule changed): `shared/api.ts`
    // <old> -> <new>. This task inserted one `LcRefusalToken` member (`branch-unmeasured`) and its
    // `LC_REFUSAL_WORD` entry, under anchors the frozen spec/plan corpus cites by line. No corpus
    // document may be re-pointed. README's three map anchors into the same file were RE-ANCHORED BY
    // CONTENT in the same commit (`diff`-proved byte-identical), so README contributes nothing here.
```

`session-hook` is a known load flake: a red that names neither `shared/api.ts` nor `ccd/ccd` gets an isolated re-run first.

Then run each group in the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-gone-branch.test.ts test/ccd-child-reclaim-pin.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts test/ccd-child-reclaim-verb.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts test/ccd-child-reclaim-verb-reflogs.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts test/ccd-child-reclaim-entry.test.ts test/ccd-child-reclaim-hardening.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts test/ccd-ws-expire-verb.test.ts test/child-reclaim.test.ts test/ccd-refusal-scan.test.ts
cd server && ./node_modules/.bin/vitest run test/lifecycle-refusal-word.test.ts test/child-reclaim-status.test.ts test/wsaudit.test.ts test/ccd-wsaudit-nonpoison.test.ts test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tail-contained.test.ts
(cd server && ./node_modules/.bin/tsc --noEmit -p .)
(cd pwa && ./node_modules/.bin/tsc --noEmit)
```

Expected: PASS everywhere. The new file is green. The expire suites stay green unchanged: `ws-expire` reaches the same ladder, pin and tail, and its tokens are recomputed by the same code on both sides. `child-reclaim.test.ts`'s harvest is unchanged, because no `_reap_refuse` was added and `branch-unmeasured` is a `failed` word, which that harvest does not read. `ccd-refusal-scan`'s `holds literal refusal arguments set-equal to the vocabularies in both directions` now finds `branch-unmeasured` at its one `_ws_reclaim_fail` site, and its `holds the reclaim emits at exactly two` is unchanged. `wsaudit` and `ccd-wsaudit-nonpoison` are green with no edit, which proves no harvest shape was added. `tsc` prints nothing in either package. `ccd-child-reclaim-tail-contained` is green unchanged: this task adds and moves no destructive call, so Task 3's count of six (or whatever Tasks 5 to 7 re-pinned it to) stands (X3).

- [ ] **Step 5: Mutation check**

Make one edit at a time, run the command, see the red, then restore. Every row runs the new file, which does not read the stamp; rows 14 and 15 add a suite that reads source text or L0 only, never the stamp. Re-stamp once after the last restore.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In `_ws_reclaim_branch_state`, `if (( rc == 2 )); then` → `if (( rc == 1 \|\| rc == 2 )); then` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-gone-branch.test.ts -t 'CORRUPT loose ref\|a corrupt branch'` | `expected 'absent\|0' to be 'unmeasured\|0'`; and both corrupt arm cases: `expected 'reclaimable' to be 'unmeasured'` |
| 2 | In `_ws_reclaim_branch_state`, drop `_ws_reclaim_contained ` from the `show-ref --exists` call | same file, `-t 'inherited GIT_DIR'` | `expected 'absent\|0' to be 'present <sha>\|0'` |
| 3 | In `_ws_reclaim_branch_state`, the final `printf 'unmeasured\n'` → `printf 'absent\n'` | same file, `-t 'outside a repository\|rejects --exists\|older than 2.43'` | `expected 'absent\|0' to be 'unmeasured\|0'` (no repository; old git); `expected 'reclaimable' to be 'unmeasured'` (the old-git case) |
| 4 | In the ladder's present arm, `_ws_reclaim_tip_read "$main" "$branch" \|\| { _ws_reclaim_unmeasured "$_WS_BRANCH_WHY"; return 1; }` → `_ws_reclaim_tip_read "$main" "$branch" \|\| :` | same file, `-t 'present arm: a corrupt'` | `expected 'reclaimable' to be 'unmeasured'` |
| 5 | Delete `"branchState=$RECLAIM_BRANCHSTATE" ` from the present arm's fingerprint call | same file, `-t 'present arm: absence mints'` | `expected [ …(n) ] to deeply equal ArrayContaining [ 'worktree=present', 'tip=<sha>', 'branchState=present' ]` |
| 6 | In `_ws_reclaim_eval_absent`, the tip read's `\|\| { _ws_reclaim_unmeasured …; }` → `\|\| :` | same file, `-t 'vanished arm: a corrupt'` | `expected 'reclaimable' to be 'unmeasured'` |
| 7 | Delete `"branchState=$RECLAIM_BRANCHSTATE" ` from `_ws_reclaim_eval_absent`'s fingerprint call | same file, `-t 'vanished arm: absence mints'` | `expected [ …(n) ] to deeply equal ArrayContaining [ 'worktree=absent', 'tip=', 'branchState=absent' ]` |
| 8 | In `_ws_reclaim_pin_contained`, `_ws_reclaim_tip_read "$main" "$branch" \|\| { RECLAIM_PIN_WHY="$_WS_BRANCH_WHY"; return 1; }` → `… \|\| :` | same file, `-t 'settle reads the branch itself\|fresh pin reads'` | `expected 'branch-unmeasured' to be 'pin-failed'`: the tail went past the settle and stopped only at step 5 |
| 9 | In `_ws_reclaim_pin_contained`, delete the shape-B `if [[ "$RECLAIM_BRANCHSTATE" == absent && "$headref" == … ]]; then … fi` | same file, `-t 'still symbolic'` | the detail no longer matches `/still has ws\/quiet-basin checked out, but ws\/quiet-basin is gone/`. The WIP commit fails in its own words. |
| 10 | In `_ws_reclaim_pin_absent_contained`, `… \|\| { RECLAIM_PIN_WHY="$_WS_BRANCH_WHY"; return 1; }` → `… \|\| :` | same file, `-t 'vanished arm’s pin reads it too'` | `expected 'branch-unmeasured' to be 'pin-failed'` |
| 11 | Delete the settle's `[[ -n "$tip" ]] \|\| REAP_TIP=""` | same file, `-t 'reappears after the tombstone'` | `expected 0 to be 1`: the settle adopted the reappeared tip, and step 5 deleted that branch |
| 12 | In step 5, replace the new `bstate=…` line, its unmeasured `if … fi` and `if [[ "$bstate" == "present "* ]]; then` with the old `if git -C "$main" show-ref --verify --quiet "refs/heads/$branch"; then` | same file, `-t 'step 5'` | `expected 0 to be 1`: the delete was skipped and the row purged |
| 13 | In `_ws_reclaim_pin_contained`, directly after the tip read add `[[ -n "$REAP_TIP" ]] \|\| { RECLAIM_PIN_WHY="no tip"; return 1; }` (today's hard failure) | same file, `-t 'live expoAI'` | `expected 1 to be 0`, with stdout naming `pin-failed` |
| 14 | In step 5, `_ws_reclaim_fail "$id" "$lctx" branch-unmeasured \` → `_ws_reclaim_fail "$id" "$lctx" branch-elsewhere \` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-gone-branch.test.ts test/ccd-refusal-scan.test.ts -t 'step 5\|set-equal'` | `expected 'branch-elsewhere' to be 'branch-unmeasured'`; and `declared journal-only tokens with no literal ccd call-site argument: expected [ 'branch-unmeasured' ] to deeply equal []` |
| 15 | In `LC_REFUSAL_WORD['branch-unmeasured']`, `stopped before removing anything further` → `stopped, and the workspace is intact` | `cd server && ./node_modules/.bin/vitest run test/lifecycle-refusal-word.test.ts` | `branch-unmeasured says nothing further went, and never that anything is intact`: `expected '…the workspace is intact…' not to match /intact/` |
| 16 | In `_ws_reclaim_branch_state`, prefix the `sha=$(_ws_reclaim_contained git -C "$repo" rev-parse …` line with `(( rc == 0 )) && ` (the fallback dropped) | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-gone-branch.test.ts -t 'rejects --exists\|reclaims a standing branch'` | `expected 'unmeasured\|0' to be 'present <sha>\|0'`; and `expected 'unmeasured' to be 'reclaimable'` |
| 17 | In `_ws_reclaim_branch_state`, `if (( src == 1 )); then` → `if (( src <= 1 )); then` (the symbolic-branch guard dropped) | same file, `-t 'SYMBOLIC registry branch'` | `expected 'present <main’s sha>\|0' to be 'unmeasured\|0'` |
| 18 | In the tail's step 5, `update-ref -d --no-deref "refs/heads/$branch" "$tip"` → `update-ref -d "refs/heads/$branch" "$tip"` (Task 3's `--no-deref` dropped) | same file, `-t 'never the branch a symbolic one names'` | `the branch the symbolic one named stands: expected '' to be '<sha>'`. The CAS followed the symbolic ref and deleted `ws/target` |

Rows 17 and 18 are the guard and its defence in depth. Each reds alone: row 17 at the read, and row 18 only under `PRE_GUARD_READ`, the stub that stands in for the guard's absence. **Disclosed survivor:** dropping `--no-deref` from the NESTED CAS (`update-ref -d --no-deref "refs/heads/$cbr" "$chead"`) reds no case. The nested reads keep the two-way read (gone-branch.OPEN6), and no fixture builds a symbolic nested branch, so the flag there is defence in depth only.

Restore everything, re-stamp (`bash ccd/ccrc restamp ccd/ccd && node shared/mark.mjs --check ccd/ccd`), and re-run Step 4's first two commands (green).

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd shared/api.ts README.md server/test/ccd-child-reclaim-gone-branch.test.ts server/test/ccd-child-reclaim-pin.test.ts \
  server/test/lifecycle-refusal-word.test.ts server/test/child-reclaim-status.test.ts
git add server/test/session-hook.test.ts   # only if Step 4's census re-measure changed it
git commit -m "$(cat <<'MSG'
feat(ccd): a branch proven gone no longer strands a child's reclaim

Whether the child's registry branch exists is now read three ways, by
git show-ref --exists: present, absent, or a read that did not run.
The old reads answered 1 for an absent ref, a corrupt one and an
unreadable one alike. Every arm takes the read in one act: both ladder
arms, the pin, the vanished arm's pin and the tail's step 5.

A branch proven absent pins HEAD, the WIP commit and every reflog,
deletes no branch, and the reclaim goes ahead. The token carries
branchState, so it is never spent over a ref that would not read.
Four cases stay closed:
- a branch that reappears after the record stays branch-moved;
- a HEAD still on the gone branch stays pin-failed;
- a registry branch that is a symbolic ref reads unmeasured, because
  update-ref -d would follow it and delete the branch it names;
- a read that fails at step 5 stops the tail instead of purging the row,
  with a new failed word, branch-unmeasured.

On a git older than 2.43, which rejects --exists, a branch rev-parse
still peels reads present, so such a box reclaims a standing branch as
before. Only --exists' own absent answer ever proves a branch gone. So
on such a box a resume whose branch is already gone stays
branch-unmeasured, until the branch is re-created at its recorded tip
or git is upgraded.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

**The wave-done names (X2; gone-branch.OPEN6 and OPEN7).** The worker's wave-done mail names what this task changes in code `ws-expire` also runs, for workspace-lifecycle's coordinator (`ccrc-pwa-quiet-river`):
- `_ws_reclaim_branch_state` and `_ws_reclaim_tip_read`, read in the shared ladder, pin and tail (the `_WS_RCL_ACT=expire` flavour);
- the `branchState=` fingerprint input: an audit token minted before the deploy and spent after it costs one `state-changed` per child, on both verbs;
- the old-git positive fallback: on a git older than 2.43 a standing branch reads present and a gone one unmeasured;
- `branch-unmeasured`, the shared tail's step-5 `failed` word, which under `ws-expire` journals with `act expire` and `verb ws-expire`;
- the symbolic-branch guard: a registry branch that is a symbolic ref reads `unmeasured` on both verbs. Its defence in depth is Task 3's `update-ref -d --no-deref` at both branch CASes of the shared tail.

It also lists the carried residuals:
- the tail's step-3 nested-branch reads, and the manifest and PR-phase reads, keep the two-way read (gone-branch.OPEN6);
- once its branch is proven absent, a `(no branch)` stash is neither attributed nor attic-pinned; it stays in `refs/stash` and nothing deletes it (gone-branch.OPEN7);
- on a git older than 2.43, a reclaim or expiry stops at step 5 as `branch-unmeasured` on every retry in two cases: its step 5 already deleted the branch (the tail died before its `artifacts` breadcrumb), or someone else deleted the branch after the pin. Recreating the branch at the tombstone's `tip`, or upgrading git, lets it finish. The fleet runs 2.43, so this is stated, not closed (ruling S2-4);
- as today, a branch that appears between the verb's in-lock recompute and the pin is adopted at the tip the pin reads. A token minted over `branchState=absent` is then spent over it, because the gone-branch consent is re-checked at the tombstone, not at the pin. That tip is pinned and its reflog is kept, so nothing is lost (ruling S2-5);
- a loose ref that is a dangling symlink over a packed entry answers `show-ref --exists` rc 2 while git still lists the packed branch. It therefore reads `absent`, and that branch is never deleted, only left with no row: a leak, never a loss (ruling S2-6).


### Task 9: The gone-directory recovery — a second placement basis, `recorded`, in `_ws_reclaim_workdir_shared` (R54)

**Model routing:** `opus`, effort `high`. This is SAFETY-critical. Today a registry row whose workdir is gone holds every child at `unmeasured`. After this task such a row stops holding, so the destructive verb goes ahead in cases where today it refuses. Each arm must therefore fail closed, and every item on R54's never-list is pinned.

**Why:** R31 (run 208) places another row only on a `complete` resolution. A row whose directory is gone resolves only as `absent-suffix`, so it is collected into `unres` and holds every child: a present child, a vanished one, and two vanished children, who hold each other (contract R31's stated cost). R54 lifts that hold only on positive evidence, through one resolver. The audit, the verb's locked recomputation and `_ws_reclaim_owned` all reach `_ws_reclaim_workdir_shared` (R31), so one edit there reaches all three.
- **Git-record arm.** It ends the hold for a hand-deleted workspace, whose record git keeps and marks `prunable`.
- **Breadcrumb arm.** It ends "two interrupted children hold each other". After ccd's own `git worktree remove`, git's record is gone too, so the git-record arm can never fire there. For the same reason the arm places a row only while git keeps NO record of the tree (`_ws_reclaim_record` rc 1, ruling S2-1). Both verbs also write those phases over a workdir that was already absent, moved away rather than removed: ws-reap's `branch` whenever the workdir is gone at its step (f), and the reclaim tail's `reclaim:branch` before its step 5 clears git's record. A record git still keeps (a moved tree's, a locked one) is the git-record arm's to place or to hold, together with its moved-tree check.
- **Moved-tree check.** It closes the hole the git-record arm opens. A record says where a tree *was*. An `mv` leaves the stanza exactly as an `rm` does, and the moved tree's `.git` still names the same admin directory (scout, git 2.43). Rung 9 already refuses such a checkout of the child's own repository (`_ws_reclaim_gitdir_own`). A clean checkout of another repository passes `_ws_reclaim_foreign_clean` and would go with the child.

**Scope.**
- In this task:
  - the code in `ccd/ccd`'s RECLAIM region;
  - one new test file;
  - one fixture line added to an existing ladder case, whose hold the git-record arm would otherwise end.
- Not in this task:
  - Task 13 owns the prose, never this task:
    - R31's cost bullet and D-3734's text, written as the "§12 as built" note appended to contract §12, never by editing sections 1–11 (ruling gone-dir.OPEN6);
    - spec §5.5's hold sentence;
    - the note that `containment-unproven`'s copy only approximates the moved-tree case (ruling gone-dir.OPEN4).
  - No `D-` token is written anywhere. A departure is named by its slug, and the coordinator numbers it.
- Every `ccd/ccd` edit sits below `ccd/ccd:19109`, so no citation census is re-measured (R56).
- `_ws_expire_cwd_users` is not touched.
- **The coordinator's rulings on this task's open items (2026-10-06).** Each was accepted as drafted, and each fails closed:
  - `create-row-never-read` (gone-dir.DEP1): nothing in the recovery reads the lifecycle journal. A `create` row alone keeps the hold.
  - `expire-breadcrumb-not-recovered` (gone-dir.DEP2): the breadcrumb arm never accepts an `expire:` phase, so an interrupted expiry's gone row still holds.
  - Breadcrumb-arm placement (gone-dir.OPEN3): such a row is placed by its literal spelling and runs through the same SHARED/NESTED/THROUGH chain.
  The worker books the two departures by these slugs in the wave-done, and the coordinator numbers them.
- **This recovery reaches `ws-expire` with no edit in the EXPIRE region.** `_ws_expire_eval` runs the shared `_ws_reclaim_ladder` (and through it `_ws_reclaim_workdir_shared`). `ws-expire`'s tail is `_ws_reclaim_tail`, which asks `_ws_reclaim_owned`. The coordinator tells workspace-lifecycle (`ccrc-pwa-quiet-river`) before dispatch. The worker names this change in the wave-done: the `recorded` placement basis, and the moved-tree check in the ladder and in `_ws_reclaim_owned` (ruling X2).
- **No destructive call is added or moved.** Every edit is in `_ws_reclaim_record`, `_ws_reclaim_workdir_shared`, the four new helpers, `_ws_reclaim_ladder` or `_ws_reclaim_owned`. All of these sit above `_ws_reclaim_tail() {`. The new code only reads (`git rev-parse --absolute-git-dir`, `_ws_nested_checkouts`). So Task 3's pinned count of six destructive git calls in the tail's text stands and is not re-pinned here (ruling X3). Step 5 re-runs Task 3's file to show it.

**Files:**
- Modify `ccd/ccd`, all inside `RECLAIM-BEGIN`…`RECLAIM-END`. Every line number in this task is a hint, measured at `77c11245a` (and Tasks 1–8 move them). Read each site on the worker's own tree and locate it by its grep anchor. That tree already carries wave 5, because #290 merged before dispatch. Measured at #290's `e79b1da7`, wave 5 touches no `ccd/ccd` line and none of this task's test files or fixtures, so the anchors below hold as written.
  - `_ws_reclaim_record` (`ccd/ccd:25497`; `grep -n '^_ws_reclaim_record() {' ccd/ccd`): gains `RECLAIM_REC_PRUNABLE`.
  - The globals line above `_ws_reclaim_workdir_shared` (`ccd/ccd:25529`; `grep -n "^_WS_SHARED_ROWS=''" ccd/ccd`).
  - `_ws_reclaim_workdir_shared` (`ccd/ccd:25530`):
    - its header paragraph at `:25700-25708` (`grep -n 'and two vanished$' ccd/ccd`);
    - its entry reset at `:25710` (`grep -n "^  _WS_SHARED_ROWS=''" ccd/ccd`);
    - the `unres` line at `:25740` (`grep -nF '(( lit )) || (( rok )) || { unres' ccd/ccd`).
  - Four new functions, inserted directly above `_WS_RESOLVED=''` (`ccd/ccd:25774`; `grep -n "^_WS_RESOLVED=''" ccd/ccd`).
  - `_ws_reclaim_ladder`'s nested-scan tail (`ccd/ccd:26414-26415`; `grep -n '# The facts the pin phase will act on' ccd/ccd`). Task 8 edits the `REAP_TIP=` line right below this, so anchor by content only.
  - `_ws_reclaim_owned` (`ccd/ccd:27844`; header ends at `:27857`, `grep -nF 'local id="$1" wd="$2" main="$3" rc' ccd/ccd`; THROUGH check at `:27874`).
- Create `server/test/ccd-child-reclaim-recovery.test.ts`. It is a new file because of the 600 s foreground ceiling (R56).
- Modify `server/test/ccd-child-reclaim-ladder.test.ts`:
  - one fixture line and one comment sentence in `ambiguous row hold: two vanished children hold each other` (`:2186`; `grep -n 'two vanished children hold each other' server/test/ccd-child-reclaim-ladder.test.ts`);
  - the block comment at `:2145` (`grep -n 'Recovery is not here' …`).

**Interfaces:**
- Produces (bash, `ccd/ccd`):
  ```
  _ws_reclaim_recorded <id> <workdir>        rc 0: placed on recorded evidence — _WS_RECORDED_AT (the path it is
                                             placed by), _WS_RECORDED_G (resolved admin dir; '' on the breadcrumb
                                             arm); rc 1: not proven (the row holds, as before)
  _ws_reclaim_recorded_git <id> <workdir>    rc 0 with _WS_RECORDED_G; rc 1 otherwise
  _ws_reclaim_recorded_crumb <id> <workdir>  rc 0 proven, and git keeps no record of the tree; rc 1 otherwise
                                             (a record git still keeps, or a list it could not give, included)
  _ws_reclaim_moved_check <nested-list>      rc 0 none; rc 1 a recovered row's moved tree (_WS_MOVED_WHY);
                                             rc 2 unmeasured (_WS_MOVED_WHY)
  _WS_RECORDED_GDIRS                         "id<TAB>resolved-admin-dir" lines; reset by every
                                             _ws_reclaim_workdir_shared call
  RECLAIM_REC_PRUNABLE                       0|1, set by every _ws_reclaim_record call
  ```
- Consumes: these existing functions, unchanged:
  - `_ws_reclaim_resolve` (`_WS_RESOLVED`, `_WS_RESOLVE_BASIS`), `_ws_reclaim_absent` and `_ws_reclaim_plain_path`;
  - `_ws_reclaim_log_of <main> tree <path> 1` (`_WS_LOGS`, `_WS_KEEP_WHY`) and `_ws_reclaim_record`;
  - `_reg_read <id> <field>` (rc 0/1/2), `_ws_tomb_str <file> <field>` and `_ws_nested_checkouts <dir>`;
  - `_reap_refuse containment-unproven`, an existing word that adds no R43 classification, and `_ws_reclaim_unmeasured`;
  - test side: `makePrHarness`, `makeChild`, `evalOf`, `childReclaimVerb`, `CHILD_STUBS`, `CHILD_ENV`, `WS_ADD`, `CCD` and `eventsOf`.
- **Two census pins to respect.**
  - Read the other row only with `_reg_read "$o" …`. Never write `_reg_get "`, and never spell `_reg_read "$id" project`: `ccd-reg-get-census.test.ts` counts both spellings.
  - No comment may spell `_reap_refuse <word>` or `"refused":"<word>"`, the token-harvesting shapes `child-reclaim.test.ts` and R43 read.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-child-reclaim-recovery.test.ts`:

```ts
// Child reclamation wave 6, Task 9 (contract §12, R54): the gone-directory alternate-row recovery.
//
// A registry row whose workdir is GONE resolves only as a projection (`absent-suffix`), and since run 208 such a
// row holds every child's reclaim at `unmeasured` (contract R31's stated cost). R54 lets it stop holding ONLY on
// positive evidence, as a second placement basis, `recorded`, inside `_ws_reclaim_workdir_shared` — the one
// resolver the audit, the verb's locked recomputation and `_ws_reclaim_owned` all ask:
//   - the git-record arm: exactly one `<common>/worktrees/*/gitdir` names `<w>/.git`; git's porcelain list marks
//     that stanza `prunable`; the leaf is the only absent component; the parent resolves `complete` to its
//     literal spelling. The row is then placed by that physical path.
//   - the breadcrumb arm: the row's `.reaping` phase is `branch`, `artifacts` or `clips` (a `reclaim:` one only
//     beside its tombstone's `worktree: present`), the tombstone's uuid and workdir equal the row's, and git keeps
//     NO record of the tree. Both verbs write those phases over a tree that was moved away too, and only ccd's own
//     removal takes git's record with it.
// The moved-tree hole is closed: no nested checkout of the child, of any repository, may resolve its git
// directory to the admin directory a recovered row named — asked after the ladder's nested scan, and again in
// `_ws_reclaim_owned`. Every item of R54's never-list has a case here or a line in the scan at the foot.
//
// FIXTURE HOME ONLY. `makePrHarness`'s HOME is the isolation boundary: every repository, worktree, registry row,
// tombstone and the git shim live under it, and the verb runs under `CHILD_STUBS`, so no unit or pane is touched.
// A new file, not cases added to the ladder suite, for the 600 s foreground ceiling (contract R56).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, WS_ADD } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, type Child, type LadderAnswer,
} from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-recovery-'); });
afterEach(() => { h.cleanup(); });

/** `_ws_reclaim_workdir_shared`'s cannot-be-placed sentence: the row holds the child. */
const HELD = 'name a workdir that cannot be resolved completely';
/** A second CHILD of the child's own repository (`demo`), minted by the real ws-add. */
const SIB = 'demo-still-harbor';
/** A plain workspace of ANOTHER repository (`demo2`): nothing done to ITS git records can touch the child's reads. */
const FOREIGN = 'demo2-still-harbor';

/** `_ws_reclaim_eval`'s answer for any child id — `evalOf` asks `CHILD_ID` alone. */
const evalAs = (id: string): LadderAnswer => {
  const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${id} 0 '' >/dev/null;`
    + ` printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`);
  const [verdict = '', token = '', detail = ''] = out.split('\x1f');
  return { verdict, token, detail };
};
/** `_ws_reclaim_owned` — the tail's re-ask, on every arm — for any id: its rc and its why. */
const ownedOf = (id: string, wt: string, main: string): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`_ws_reclaim_owned ${id} "${wt}" "${main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { rc, why };
};
const verbAs = (id: string, token: string): { code: number; stdout: string; stderr: string } =>
  h.run(`${CHILD_STUBS} ${CHILD_ENV} cmd_ws_reclaim --expect ${token} --child-of ${CHILD_RUN} --session ${id}`);
const resumeTokenOf = (id: string, phase: string): string =>
  h.sh(`_ws_reclaim_resume_eval ${id} 0 ${CHILD_RUN} ${phase} >/dev/null; printf '%s' "$REAP_TOKEN"`);
/** git's porcelain stanza for `wt` in `main`'s list, or '' when git records no worktree there. */
const stanza = (main: string, wt: string): string =>
  h.git(main, 'worktree', 'list', '--porcelain').split('\n\n').find((s) => s.startsWith(`worktree ${wt}\n`)) ?? '';
const held = (r: LadderAnswer, id: string, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('unmeasured');
  expect(r.detail, label).toContain(`registry row(s) ${id} ${HELD}`);
  expect(r.token, label).toBe('');
};
const placed = (r: LadderAnswer, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('reclaimable');
  expect(r.token, label).toMatch(/^[0-9a-f]{64}$/);
};

const sibling = (): { wt: string; admin: string } => {
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add --child ${CHILD_RUN} demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-harbor');
  return { wt, admin: h.git(wt, 'rev-parse', '--absolute-git-dir') };
};
const foreign = (): { main: string; wt: string; admin: string } => {
  const main = h.makeGhRepo('demo2', 'o/r2');
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
  const wt = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
  const admin = h.git(wt, 'rev-parse', '--absolute-git-dir');
  expect(h.reg(FOREIGN, 'project'), 'the CONTROL: the row names its own repository').toBe('demo2');
  expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(), 'the CONTROL: git records the tree by its physical path')
    .toBe(`${wt}/.git`);
  return { main, wt, admin };
};
/** The child, the foreign workspace, the CONTROL that it is placed outside while it stands — then its tree gone. */
const goneForeign = (): { c: Child; o: { main: string; wt: string; admin: string } } => {
  const c = makeChild(h);
  const o = foreign();
  placed(evalOf(h), 'the CONTROL: while its tree stands the row is placed outside');
  fs.rmSync(o.wt, { recursive: true, force: true });
  return { c, o };
};
/** A reclaim of `id` that ran its pin phase, wrote its tombstone (`worktree: present`) and a `reclaim:branch`
 *  breadcrumb — the state the tail leaves once its step 4 has removed the tree and step 5 has not run. */
const pinned = (id: string, wt: string, main: string): void => {
  h.sh(`${CHILD_STUBS} export ${CHILD_ENV}; _ws_reclaim_eval ${id} 0 ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${id} "${wt}" "${main}" "$REAP_BRANCH" ${CHILD_RUN}`
    + ` && _ws_tombstone ${id} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN} present)" >/dev/null`
    + ` && _reg_set ${id} reaping reclaim:branch`);
  expect(h.reg(id, 'reaping'), `the CONTROL: ${id} carries the breadcrumb`).toBe('reclaim:branch');
  const tomb = JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${id}.json`), 'utf8')) as
    Record<string, unknown>;
  expect(tomb['worktree'], 'the CONTROL: its tombstone says there was a tree').toBe('present');
  expect(tomb['uuid'], 'the CONTROL: its tombstone is this row’s').toBe(h.reg(id, 'uuid'));
};
/** The tail's own step 4: `git worktree remove --force` on the tree it pinned, which takes git's record with it. */
const removedByTail = (wt: string, main: string): void => {
  h.git(main, 'worktree', 'remove', '--force', wt);
  expect(fs.existsSync(wt)).toBe(false);
};

describe('the git-record arm', () => {
  it('a hand-deleted workspace no longer holds a present child, and the verb reclaims the child', () => {
    const c = makeChild(h);
    const s = sibling();
    placed(evalOf(h), 'the CONTROL: while its tree stands the sibling is placed outside');
    fs.rmSync(s.wt, { recursive: true, force: true });
    expect(stanza(c.main, s.wt), 'the CONTROL: git keeps the record, marked prunable').toContain('\nprunable');
    const r = evalOf(h);
    placed(r, 'git’s record places the gone sibling');
    const v = childReclaimVerb(h, r.token);
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect((JSON.parse(v.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the child’s tree is gone').toBe(false);
    // What the recovery never does (R54): it only stopped the sibling holding the child.
    expect(fs.existsSync(s.wt), 'no directory was created at the gone path').toBe(false);
    expect(fs.existsSync(s.admin), 'the sibling’s admin directory stands').toBe(true);
    expect(stanza(c.main, s.wt), 'git’s record of the sibling stands, still prunable').toContain('\nprunable');
    expect(h.reg(SIB, 'workdir'), 'the sibling’s row stands').toBe(s.wt);
  }, 120_000);

  it('two hand-deleted children of one repository release each other', () => {
    const c = makeChild(h);
    const s = sibling();
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.rmSync(s.wt, { recursive: true, force: true });
    for (const wt of [c.wt, s.wt]) {
      expect(stanza(c.main, wt), `the CONTROL: git keeps the record of ${wt}, prunable`).toContain('\nprunable');
    }
    placed(evalOf(h), 'the child, its sibling placed by git’s record');
    placed(evalAs(SIB), 'the sibling, the child placed by git’s record');
    for (const wt of [c.wt, s.wt]) expect(fs.existsSync(wt), `no directory was created at ${wt}`).toBe(false);
  }, 120_000);

  it('two admin entries naming one gone tree keep the hold', () => {
    const { o } = goneForeign();
    const copy = `${o.admin}-copy`;
    fs.cpSync(o.admin, copy, { recursive: true });
    held(evalOf(h), FOREIGN, 'two records name the one path');
    fs.rmSync(copy, { recursive: true, force: true });
    placed(evalOf(h), 'the CONTROL: one record places it');
  }, 120_000);

  it('a locked record is never prunable, and keeps the hold', () => {
    makeChild(h);
    const o = foreign();
    h.git(o.main, 'worktree', 'lock', o.wt);
    fs.rmSync(o.wt, { recursive: true, force: true });
    const st = stanza(o.main, o.wt);
    expect(st, 'the CONTROL: git reads a locked gone record as locked').toContain('\nlocked');
    expect(st, 'the CONTROL: and never as prunable').not.toContain('\nprunable');
    held(evalOf(h), FOREIGN, 'a locked record');
    fs.rmSync(path.join(o.admin, 'locked'));
    expect(stanza(o.main, o.wt)).toContain('\nprunable');
    placed(evalOf(h), 'the CONTROL: unlocked, the same record places it');
  }, 120_000);

  it('a parent that is gone too keeps the hold — the leaf must be the only absent component', () => {
    goneForeign();
    const parent = path.join(h.home, 'worktrees', 'demo2');
    fs.rmSync(parent, { recursive: true, force: true });
    held(evalOf(h), FOREIGN, 'the parent is gone too');
    fs.mkdirSync(parent);
    placed(evalOf(h), 'the CONTROL: with the parent back, only the leaf is absent');
  }, 120_000);

  it('a parent spelled through a link keeps the hold — it must resolve complete to its literal spelling', () => {
    makeChild(h);
    const o = foreign();
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    const linked = path.join(h.home, 'wtlink', 'demo2', 'still-harbor');
    const row = path.join(h.home, '.cc-sessions', `${FOREIGN}.workdir`);
    fs.writeFileSync(row, linked);
    placed(evalOf(h), 'the CONTROL: while the tree stands, the linked spelling resolves completely, outside');
    fs.rmSync(o.wt, { recursive: true, force: true });
    const r = evalOf(h);
    held(r, FOREIGN, 'the row is spelled through a link');
    expect(r.detail, 'by id only').not.toContain(linked);
    fs.writeFileSync(row, o.wt);
    placed(evalOf(h), 'the CONTROL: spelled physically, the same record places it');
  }, 120_000);

  it('an unreadable worktrees/ directory or gitdir file keeps the hold — never read as no record', (ctx) => {
    if (process.getuid?.() === 0) { ctx.skip(); return; }
    const { o } = goneForeign();
    const dir = path.dirname(o.admin);
    fs.chmodSync(dir, 0o000);
    try { held(evalOf(h), FOREIGN, 'worktrees/ cannot be listed'); } finally { fs.chmodSync(dir, 0o755); }
    placed(evalOf(h), 'the CONTROL: listable again, the record places it');
    const gitdir = path.join(o.admin, 'gitdir');
    fs.chmodSync(gitdir, 0o000);
    try { held(evalOf(h), FOREIGN, 'its gitdir cannot be read'); } finally { fs.chmodSync(gitdir, 0o644); }
    placed(evalOf(h), 'the CONTROL: readable again, the record places it');
  }, 120_000);

  it('a lifecycle create row alone keeps the hold — it never decides', () => {
    // Passes before the implementation too, by construction: it pins that the implementation never makes the
    // journal's `create` row sufficient (R54: it only corroborates).
    const { o } = goneForeign();
    h.git(o.main, 'worktree', 'prune');   // the FIXTURE removes git's record; ccd never runs this
    expect(stanza(o.main, o.wt), 'the CONTROL: git records nothing').toBe('');
    expect(eventsOf(h.home, 'create').some((e) => e['id'] === FOREIGN && e['outcome'] === 'done'
      && (e['meas'] as { workdir?: unknown } | undefined)?.workdir === o.wt),
    'the CONTROL: the journal holds the row’s create, naming its workdir').toBe(true);
    held(evalOf(h), FOREIGN, 'a create row and nothing else');
  }, 120_000);
});

describe('the breadcrumb arm', () => {
  it('two interrupted children whose trees the tail removed release each other', () => {
    const c = makeChild(h);
    const s = sibling();
    // Both pinned before either tree goes, so no setup step leans on the recovery under test.
    pinned(CHILD_ID, c.wt, c.main);
    pinned(SIB, s.wt, c.main);
    removedByTail(c.wt, c.main);
    removedByTail(s.wt, c.main);
    for (const wt of [c.wt, s.wt]) {
      expect(stanza(c.main, wt), 'the CONTROL: git keeps no record — the git-record arm cannot fire').toBe('');
    }
    const mine = ownedOf(CHILD_ID, c.wt, c.main);
    expect(mine.rc, mine.why).toBe('0');
    const theirs = ownedOf(SIB, s.wt, c.main);
    expect(theirs.rc, theirs.why).toBe('0');
    const a = verbAs(CHILD_ID, resumeTokenOf(CHILD_ID, 'branch'));
    expect(a.code, a.stdout + a.stderr).toBe(0);
    expect((JSON.parse(a.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    const b = verbAs(SIB, resumeTokenOf(SIB, 'branch'));
    expect(b.code, b.stdout + b.stderr).toBe(0);
    expect((JSON.parse(b.stdout) as { reclaimed: string }).reclaimed).toBe(SIB);
    for (const wt of [c.wt, s.wt]) expect(fs.existsSync(wt), `no directory was created at ${wt}`).toBe(false);
  }, 180_000);

  const patchTomb = (id: string, doc: Record<string, unknown>): void => {
    h.sh(`_ws_tombstone_patch ${id} '${JSON.stringify(doc)}'`);
  };
  const crumb = (id: string, v: string): void => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.reaping`), v);
  };
  const VARIANTS: readonly [string, (wt: string) => void, (wt: string) => void][] = [
    ['a tombstone of another session (its uuid)',
      () => patchTomb(SIB, { uuid: 'an-earlier-child' }), () => patchTomb(SIB, { uuid: h.reg(SIB, 'uuid') })],
    ['a tombstone naming another workdir',
      () => patchTomb(SIB, { workdir: path.join(h.home, 'worktrees', 'demo', 'elsewhere') }),
      (wt) => patchTomb(SIB, { workdir: wt })],
    ['a reclaim tombstone saying worktree: absent',
      () => patchTomb(SIB, { worktree: 'absent' }), () => patchTomb(SIB, { worktree: 'present' })],
    ['a breadcrumb written before the removal (reclaim:worktree)',
      () => crumb(SIB, 'reclaim:worktree'), () => crumb(SIB, 'reclaim:branch')],
    ['an expiry’s breadcrumb (expire:branch)',
      () => crumb(SIB, 'expire:branch'), () => crumb(SIB, 'reclaim:branch')],
    ['a link planted at the gone path',
      (wt) => fs.symlinkSync(path.join(h.home, 'nowhere'), wt), (wt) => fs.unlinkSync(wt)],
  ];
  it.each(VARIANTS)('%s keeps the hold', (label, apply, restore) => {
    const c = makeChild(h);
    const s = sibling();
    pinned(SIB, s.wt, c.main);
    removedByTail(s.wt, c.main);
    expect(stanza(c.main, s.wt), 'the CONTROL: git keeps no record — only the breadcrumb can place it').toBe('');
    placed(evalOf(h), 'the CONTROL: the breadcrumb and its tombstone place the sibling');
    apply(s.wt);
    held(evalOf(h), SIB, label);
    restore(s.wt);
    placed(evalOf(h), 'the CONTROL: restored, the breadcrumb places it again');
  }, 120_000);

  it('a breadcrumb never places a row git still records — a tree moved away, its record locked', () => {
    const c = makeChild(h);
    const s = sibling();
    pinned(SIB, s.wt, c.main);
    h.git(c.main, 'worktree', 'lock', s.wt);
    // The tail's own state between its steps 4 and 5: `reclaim:branch` over a tree that was MOVED, not removed.
    fs.renameSync(s.wt, path.join(h.home, 'moved-away'));
    expect(fs.existsSync(s.wt), 'the CONTROL: nothing stands at the row’s path').toBe(false);
    expect(stanza(c.main, s.wt), 'the CONTROL: git still records the tree, locked').toContain('\nlocked');
    held(evalOf(h), SIB, 'a breadcrumb over a record git keeps');
    fs.rmSync(path.join(s.admin, 'locked'));
    expect(stanza(c.main, s.wt), 'the CONTROL: unlocked, git marks the record prunable').toContain('\nprunable');
    placed(evalOf(h), 'the CONTROL: unlocked, the git arm places it');
  }, 120_000);
});

describe('the moved-tree hole', () => {
  it('a moved checkout of ANOTHER repository inside the child keeps it — after the nested scan, and in _ws_reclaim_owned', () => {
    const c = makeChild(h);
    const o = foreign();
    placed(evalOf(h), 'the CONTROL: the other session’s tree stands outside the child');
    const moved = path.join(c.wt, 'vendor', 'still-harbor');
    fs.mkdirSync(path.dirname(moved));
    fs.renameSync(o.wt, moved);
    expect(stanza(o.main, o.wt), 'the CONTROL: an mv leaves git’s record as an rm does').toContain('\nprunable');
    expect(h.git(moved, 'rev-parse', '--absolute-git-dir'), 'the CONTROL: the moved tree names the recorded admin directory')
      .toBe(o.admin);
    expect(h.sh(`_ws_reclaim_foreign_clean "${moved}"; printf '%s' "$?"`),
      'the CONTROL: rung 9 alone would pass it — clean, every commit on its remote').toBe('0');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain(`registry row ${FOREIGN}, whose workdir is gone`);
    expect(r.token).toBe('');
    const owned = ownedOf(CHILD_ID, c.wt, c.main);
    expect(owned.rc, `the tail asks it again: ${owned.why}`).toBe('1');
    expect(owned.why).toContain(`registry row ${FOREIGN}, whose workdir is gone`);
    expect(fs.readFileSync(path.join(moved, 'README.md'), 'utf8'), 'the moved tree stands').toBe('hi\n');
  }, 120_000);

  it('a moved checkout of the child’s own repository: rung 9 refuses it in the ladder, and _ws_reclaim_owned refuses it too', () => {
    const c = makeChild(h);
    const s = sibling();
    const moved = path.join(c.wt, 'inner-moved');
    fs.renameSync(s.wt, moved);
    expect(stanza(c.main, s.wt), 'the CONTROL: git reads the record as gone').toContain('\nprunable');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail, 'rung 9’s own reader of the record answers first').toContain('another checkout');
    const owned = ownedOf(CHILD_ID, c.wt, c.main);
    expect(owned.rc, owned.why).toBe('1');
    expect(owned.why).toContain(`registry row ${SIB}, whose workdir is gone`);
    expect(fs.existsSync(path.join(moved, '.git')), 'the moved tree stands').toBe(true);
  }, 120_000);
});

describe('what the recovery never does', () => {
  it('git worktree prune never runs: a git shim that fails on it sees no call through the audit, the verb and the tail', () => {
    const c = makeChild(h);
    const s = sibling();
    const shimDir = path.join(h.home, 'prune-shim');
    fs.mkdirSync(shimDir);
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(shimDir, 'git'), [
      '#!/bin/sh',
      'prev=',
      'for a in "$@"; do',
      '  if [ "$prev" = worktree ] && [ "$a" = prune ]; then printf \'%s\\n\' "$*" >> "$HOME/prune-calls"; exit 97; fi',
      '  prev=$a',
      'done',
      `exec '${realGit}' "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    const SHIM = `PATH="${shimDir}:$PATH";`;
    const calls = path.join(h.home, 'prune-calls');
    // The CONTROL: the shim is the git ccd finds, and it catches what it claims to — running nothing.
    expect(h.sh(`${SHIM} command -v git`)).toBe(path.join(shimDir, 'git'));
    const probe = h.run(`${SHIM} git -C "${c.main}" worktree prune`);
    expect(probe.code).toBe(97);
    expect(fs.readFileSync(calls, 'utf8')).toContain('worktree prune');
    fs.rmSync(calls);
    fs.rmSync(s.wt, { recursive: true, force: true });
    const r = evalOf(h, { pre: SHIM });
    placed(r, 'git’s record places the gone sibling, under the shim');
    const v = childReclaimVerb(h, r.token, { pre: SHIM });
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '', 'git worktree prune never ran').toBe('');
    expect(fs.existsSync(s.admin), 'the sibling’s admin directory stands').toBe(true);
    expect(stanza(c.main, s.wt)).toContain('\nprunable');
  }, 120_000);

  it('its four bodies never create, prune or remove anything, never read process, pane or unit state, and never read the journal', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const FORBIDDEN: readonly [string, RegExp][] = [
      ['creates a directory', /\bmkdir\b/],
      ['prunes git’s records', /\bprune\b|\bgc\b/],
      ['removes something', /\brm\b|\brmdir\b|\bunlink\b|_reg_purge|update-ref|worktree +remove/],
      ['reads process, pane or unit state', /\/proc\b|\btmux\b|_session_probe|_svc_|systemctl|launchctl|pane_/],
      ['reads the lifecycle journal', /_LC_DIR|\.lifecycle|journal-/],
    ];
    const hits: string[] = [];
    for (const name of ['_ws_reclaim_recorded', '_ws_reclaim_recorded_git', '_ws_reclaim_recorded_crumb',
      '_ws_reclaim_moved_check']) {
      const from = src.indexOf(`\n${name}() {`);
      expect(from, `${name} is defined`).toBeGreaterThan(-1);
      const code = src.slice(from, src.indexOf('\n}\n', from)).split('\n').filter((l) => !/^\s*#/.test(l));
      for (const line of code) {
        for (const [what, re] of FORBIDDEN) if (re.test(line)) hits.push(`${name} ${what}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
```

In `server/test/ccd-child-reclaim-ladder.test.ts`, keep the existing hold pinned for the shape that has no positive evidence. Two edits:

1. In the block comment at `:2145`, replace `Recovery is not here.` with `R54's recovery needs positive evidence, and these rows carry none (ccd-child-reclaim-recovery.test.ts).`
2. In `ambiguous row hold: two vanished children hold each other`, directly after `fs.rmSync(otherWt, { recursive: true, force: true });` (`:2196`), insert:

```ts
  // Contract R54: a hand-deleted workspace whose record git still keeps (`prunable`) is placed by that record and
  // holds nobody (ccd-child-reclaim-recovery.test.ts). The hold pinned here is the shape with NO positive evidence:
  // both records pruned by the fixture, and no breadcrumb.
  h.git(c.main, 'worktree', 'prune');
  expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the CONTROL: git records neither tree')
    .not.toContain('still-harbor');
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-recovery.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts -t 'ambiguous row hold'
```

Expected: the recovery file FAILS 19 of 20. The one that passes is `a lifecycle create row alone keeps the hold`, by construction: it pins an absence. The `unreadable` case skips as root. Each failure, in order:

- `a hand-deleted workspace…` fails at `git’s record places the gone sibling: … expected 'unmeasured' to be 'reclaimable'`.
- `two hand-deleted children…` fails at `the child, its sibling placed by git’s record: … expected 'unmeasured' to be 'reclaimable'`.
- These cases pass their held step and fail at the CONTROL after it, each with `expected 'unmeasured' to be 'reclaimable'`:
  - `two admin entries…` at `one record places it`;
  - `a locked record…` at `unlocked, the same record places it`;
  - `a parent that is gone too…` at `with the parent back`;
  - `a parent spelled through a link…` at `spelled physically`;
  - `an unreadable…` at `listable again`;
  - `a breadcrumb never places a row git still records…` at `unlocked, the git arm places it`.
- `two interrupted children…` fails at `expected '1' to be '0'`. Its message names `registry row(s) demo-still-harbor name a workdir that cannot be resolved completely`.
- The six `… keeps the hold` variants each fail at `the CONTROL: the breadcrumb and its tombstone place the sibling: … expected 'unmeasured' to be 'reclaimable'`.
- Both moved-tree cases fail at `expected 'unmeasured' to be 'containment-unproven'`.
- The prune-shim case passes its two shim CONTROLs, then fails at `git’s record places the gone sibling, under the shim: … expected 'unmeasured' to be 'reclaimable'`.
- The scan fails at `_ws_reclaim_recorded is defined: expected -1 to be greater than -1`.

The ladder's `ambiguous row hold` cases stay GREEN, all three. The prune only removes evidence the code does not read yet.

If any CONTROL before a held step fails, stop: the fixture did not build the shape. For example, `foreign`'s `gitdir` CONTROL fails on a git that records relative paths.

- [ ] **Step 3: Implement**

**3.1 — `_ws_reclaim_record` reads git's `prunable` line.**

Replace the three-line header:

```
_ws_reclaim_record() {   # main path -> git's worktree record for path, read from $main ONCE: rc 0 with
  #                           RECLAIM_REC_BRANCH ('' = detached) and RECLAIM_REC_HEAD set; rc 1 when $main
  #                           records no worktree at path; rc 2 when the list could not be READ
```

with

```
_ws_reclaim_record() {   # main path -> git's worktree record for path, read from $main ONCE: rc 0 with
  #                           RECLAIM_REC_BRANCH ('' = detached) and RECLAIM_REC_HEAD set, and
  #                           RECLAIM_REC_PRUNABLE=1 when git marks that stanza `prunable` (spec §5.5's
  #                           git-record arm reads it); rc 1 when $main
  #                           records no worktree at path; rc 2 when the list could not be READ
```

Then, in its body:
- Replace `  RECLAIM_REC_BRANCH=""; RECLAIM_REC_HEAD=""; RECLAIM_REC_MAIN=0` with `  RECLAIM_REC_BRANCH=""; RECLAIM_REC_HEAD=""; RECLAIM_REC_MAIN=0; RECLAIM_REC_PRUNABLE=0`.
- Directly after the `"branch "*)   (( m )) && RECLAIM_REC_BRANCH=…` arm, add:

```
      prunable|"prunable "*) (( m )) && RECLAIM_REC_PRUNABLE=1 ;;
```

**3.2 — The global.** Replace the column-0 line `_WS_SHARED_ROWS=''; _WS_NESTED_ROWS=''; _WS_THROUGH_ROWS=''; _WS_SHARED_WHY=''`, the one directly above `_ws_reclaim_workdir_shared() {`. The new line is:

```
_WS_SHARED_ROWS=''; _WS_NESTED_ROWS=''; _WS_THROUGH_ROWS=''; _WS_SHARED_WHY=''; _WS_RECORDED_GDIRS=''
```

**3.3 — `_ws_reclaim_workdir_shared`.** Make three edits.

(a) In the header, replace

```
  # is refused by the literal arms whatever its basis. R19's arm is unchanged,
  # but an ambiguous OTHER row holds a vanished child too — and two vanished
  # children hold each other — until that row is purged or a link on its path
  # is restored to its original target, and a later attempt runs: the stated
  # cost. A directory created where a link stood ends the hold unsafely: it
```

with

```
  # is refused by the literal arms whatever its basis. R19's arm is unchanged,
  # but an ambiguous OTHER row holds a vanished child too — and two vanished
  # children hold each other — until that row is purged, a link on its path
  # is restored to its original target, or the `recorded` basis below places
  # it, and a later attempt runs: the stated cost. A directory created where
  # a link stood ends the hold unsafely: it
```

Then, directly after `  # complete and outside (pre-existing; left to a follow-up).` and before the `  local id="$1" wd="$2" mine=''…` line, insert:

```
  #
  # UNLESS GIT OR CCD RECORDED WHAT BECAME OF IT (spec §5.5): a second
  # placement basis, `recorded`, beside `complete`, for a row whose workdir is
  # GONE (`absent-suffix`). `_ws_reclaim_recorded` says what counts as
  # evidence and what it never does; on it, the row is placed by the path it
  # names and compared exactly as a `complete` row is, so a recovered row at,
  # inside or through the child still refuses. Anything short of it is
  # collected as a row that cannot be placed, as before. A record says where a
  # tree WAS, not that it is gone rather than moved, so the admin directory
  # the git-record arm named is kept in _WS_RECORDED_GDIRS (`id<TAB>dir`
  # lines, reset on every call); the ladder after its nested scan, and
  # `_ws_reclaim_owned`, ask `_ws_reclaim_moved_check` of it.
```

(b) Replace the entry reset (two-space indent) `  _WS_SHARED_ROWS=''; _WS_NESTED_ROWS=''; _WS_THROUGH_ROWS=''; _WS_SHARED_WHY=''` with:

```
  _WS_SHARED_ROWS=''; _WS_NESTED_ROWS=''; _WS_THROUGH_ROWS=''; _WS_SHARED_WHY=''; _WS_RECORDED_GDIRS=''
```

(c) Replace the one line `    (( lit )) || (( rok )) || { unres+="${unres:+, }$o"; continue; }` with:

```
    if (( ! lit && ! rok )); then
      # A GONE ROW IS PLACED ONLY ON RECORDED EVIDENCE (spec §5.5): never a
      # projection, and never a row that could not be resolved at all.
      [[ "$basis" == absent-suffix ]] && _ws_reclaim_recorded "$o" "$w" \
        || { unres+="${unres:+, }$o"; continue; }
      wr="$_WS_RECORDED_AT"; rok=1
      [[ -z "$_WS_RECORDED_G" ]] || _WS_RECORDED_GDIRS+="$o"$'\t'"$_WS_RECORDED_G"$'\n'
    fi
```

A recovered row can only reach this block when it is not `lit` and `minewhy` is empty. The `unmine` line above it has already collected every non-literal row when the child itself could not be placed, so `rok=1` here always has a `mine` to compare with.

**3.4 — The four helpers.** Insert them directly above the line `_WS_RESOLVED=''`, which follows the closing `}` of `_ws_reclaim_workdir_shared`:

```bash
_WS_RECORDED_AT=''; _WS_RECORDED_G=''; _WS_MOVED_WHY=''
_ws_reclaim_recorded() {   # id workdir -> rc 0 when the OTHER row id, whose workdir is gone, is placed on
  #                             RECORDED evidence (spec §5.5): _WS_RECORDED_AT = the path it is placed by,
  #                             _WS_RECORDED_G = the admin directory git records for it, resolved ('' on the
  #                             breadcrumb arm); rc 1 when neither arm proves it, and the row holds as before
  # A ROW WHOSE WORKDIR IS GONE STOPS HOLDING OTHER CHILDREN ONLY ON POSITIVE
  # EVIDENCE (spec §5.5). `_ws_reclaim_workdir_shared` asks this only of a
  # row its resolver placed by projection alone (`absent-suffix`). Two arms,
  # each sufficient and each fail-closed: git's own record of the tree
  # (`_ws_reclaim_recorded_git`), and ccd's own breadcrumb and tombstone
  # (`_ws_reclaim_recorded_crumb`). The lifecycle journal's `create` row is
  # not read: it proves ccd once made a tree at that spelling, never that the
  # tree is gone rather than moved, so it can only corroborate and never
  # decides alone. The leaf must be PROVEN absent (`_ws_reclaim_absent`): a
  # link standing there, dangling or not, is not absence, and nothing here
  # follows one. WHAT THIS NEVER DOES, each pinned by
  # `ccd-child-reclaim-recovery.test.ts`: create a directory at the gone path
  # (that re-points the spelling by replacement); run git's repository-wide
  # worktree pruning; delete the admin directory or purge the other row (it
  # only stops that row holding others); read process, pane, tmux or unit
  # state; follow a leaf link; or read an unreadable `worktrees/` or `gitdir`
  # as "no record". Device and inode ancestry are the path-identity
  # follow-up's.
  local o="$1" w="$2"
  _WS_RECORDED_AT=''; _WS_RECORDED_G=''
  [[ "$w" != *[[:cntrl:]]* ]] && _ws_reclaim_plain_path "$w" || return 1
  _ws_reclaim_absent "$w" || return 1
  if _ws_reclaim_recorded_git "$o" "$w" || _ws_reclaim_recorded_crumb "$o" "$w"; then
    _WS_RECORDED_AT="$w"
    return 0
  fi
  return 1
}

_ws_reclaim_recorded_git() {   # id workdir -> rc 0 with _WS_RECORDED_G when git's own record places the gone
  #                                 row (spec §5.5's git-record arm); rc 1 otherwise
  # GIT'S RECORD, FOUND THE WAY GIT ITSELF FINDS IT. git records a worktree by
  # its REAL path and, once the tree is gone, keeps the stanza and marks it
  # `prunable` (measured, git 2.43). Four conditions, all required:
  #   - the parent resolves `complete` to its own literal spelling, so the
  #     leaf is the only absent component and the row's spelling IS the
  #     physical path git recorded — a parent through a link, or itself gone,
  #     places nothing;
  #   - the repository is the row's own project's (no project: not placed);
  #   - exactly one `<common>/worktrees/*/gitdir` names `<w>/.git`, found by
  #     `_ws_reclaim_log_of`'s own matcher, never a copy of it — which fails on
  #     an unreadable `worktrees/` or `gitdir`, never reading either as "no
  #     record" — and two entries naming one path are ambiguous, so neither
  #     places it;
  #   - git's porcelain list marks that stanza `prunable`. A LOCKED record never
  #     is: a lock says the tree may live on a disk that is not mounted.
  # The admin directory comes back resolved, for `_ws_reclaim_moved_check`.
  # The record's globals are shadowed here, so asking this never changes what
  # a caller read from `_ws_reclaim_record` before it.
  local o="$1" w="$2" parent project main e g='' n=0 rc
  local -a _WS_LOGS=()
  local _WS_KEEP_WHY='' RECLAIM_REC_BRANCH='' RECLAIM_REC_HEAD='' RECLAIM_REC_MAIN=0 RECLAIM_REC_PRUNABLE=0
  parent="${w%/*}"
  [[ -n "$parent" ]] || return 1
  _ws_reclaim_resolve "$parent" || return 1
  [[ "$_WS_RESOLVE_BASIS" == complete && "$_WS_RESOLVED" == "$parent" ]] || return 1
  project=$(_reg_read "$o" project) || return 1
  [[ -n "$project" && "$project" != */* && "$project" != . && "$project" != .. && "$project" != *[[:cntrl:]]* ]] \
    || return 1
  main="$PROJECTS_ROOT/$project"
  _ws_reclaim_log_of "$main" tree "$w" 1 || return 1
  for e in ${_WS_LOGS[@]+"${_WS_LOGS[@]}"}; do
    [[ "$e" == gitdir:* ]] || continue
    g="${e#gitdir:}"; n=$(( n + 1 ))
  done
  (( n == 1 )) || return 1
  _ws_reclaim_record "$main" "$w"; rc=$?
  (( rc == 0 && RECLAIM_REC_PRUNABLE && ! RECLAIM_REC_MAIN )) || return 1
  _ws_reclaim_resolve "$g" && [[ "$_WS_RESOLVE_BASIS" == complete ]] || return 1
  _WS_RECORDED_G="$_WS_RESOLVED"
  return 0
}

_ws_reclaim_recorded_crumb() {   # id workdir -> rc 0 when the row's own breadcrumb and tombstone prove ccd's
  #                                   own act took the tree at workdir (spec §5.5's breadcrumb arm); rc 1
  #                                   otherwise
  # CCD'S OWN REMOVAL, READ OFF CCD'S OWN RECORDS. ccd takes a tree away with
  # git's own worktree removal, which takes git's record with it, so the git
  # arm can never place a tree ccd removed — and two interrupted children held
  # each other for good. Here a breadcrumb written past ccd's removal step
  # places it — ws-reap's `branch` and `clips`, a reclaim's `reclaim:branch`
  # and `reclaim:artifacts` — and only while git keeps no record of the tree:
  # both verbs write those phases over a workdir that was already absent, so
  # a record that still stands (a moved tree's, a locked one) is the git
  # arm's to judge. But a reclaim's vanished arm
  # writes `reclaim:branch` at its START, with nothing taken by ccd, so a
  # `reclaim:` phase counts only beside its tombstone's `worktree: present`.
  # The tombstone must be THIS row's: its `uuid` the row's, its `workdir` the
  # row's spelling (a recycled slug can leave an earlier act's). Every other
  # phase proves nothing — an expiry's `expire:` ones included — and so does
  # an unreadable breadcrumb, row or tombstone, a missing python3 (the
  # tombstone's one reader), or a worktree list git could not give. The
  # record's globals are shadowed here, as in the git arm.
  local o="$1" w="$2" crumb tomb tuuid twd ruuid tworktree need=0 project rc RECLAIM_REC_BRANCH='' RECLAIM_REC_HEAD='' RECLAIM_REC_MAIN=0 RECLAIM_REC_PRUNABLE=0
  crumb=$(_reg_read "$o" reaping) || return 1
  case "$crumb" in
    branch|clips) : ;;
    reclaim:branch|reclaim:artifacts) need=1 ;;
    *) return 1 ;;
  esac
  tomb="$REG/.reaped/$o.json"
  [[ -f "$tomb" && ! -L "$tomb" ]] || return 1
  tuuid=$(_ws_tomb_str "$tomb" uuid) || return 1
  twd=$(_ws_tomb_str "$tomb" workdir) || return 1
  ruuid=$(_reg_read "$o" uuid) || return 1
  [[ -n "$tuuid" && "$tuuid" == "$ruuid" && "$twd" == "$w" ]] || return 1
  if (( need )); then
    tworktree=$(_ws_tomb_str "$tomb" worktree) || return 1
    [[ "$tworktree" == present ]] || return 1
  fi
  # A BREADCRUMB SAYS CCD GOT PAST A STEP, NOT THAT CCD REMOVED THE TREE: both
  # verbs write that phase over a workdir that was already absent (moved away),
  # and only ccd's own worktree removal takes git's record with it. A tree git
  # still records is the git arm's to place or to hold.
  project=$(_reg_read "$o" project) || return 1
  [[ -n "$project" && "$project" != */* && "$project" != . && "$project" != .. && "$project" != *[[:cntrl:]]* ]] || return 1
  _ws_reclaim_record "$PROJECTS_ROOT/$project" "$w"; rc=$?
  (( rc == 1 )) || return 1
  return 0
}

_ws_reclaim_moved_check() {   # nested -> rc 0 when no checkout in nested (resolved roots, one per line, as
  #                                `_ws_nested_checkouts` prints them) uses an admin directory a recovered row
  #                                named (_WS_RECORDED_GDIRS); 1 (_WS_MOVED_WHY) when one does; 2
  #                                (_WS_MOVED_WHY) when that could not be asked
  # A RECORD SAYS WHERE A TREE WAS, NOT THAT IT IS GONE RATHER THAN MOVED
  # (spec §5.5). A move leaves git's stanza exactly as a deletion does —
  # `prunable`, its gitdir naming nothing — and the moved tree's `.git` still
  # names the same admin directory (measured, git 2.43). Moved INTO this
  # child, it is another session's tree that would go with the child's. Rung 9
  # refuses such a checkout of THIS repository (`_ws_reclaim_gitdir_own`), but
  # one of another repository passes when clean. So no nested checkout, of ANY
  # repository, may resolve its git directory to an admin directory a
  # recovered row named. A git directory that cannot be read, or resolved
  # completely, is unmeasured, never "not that tree".
  local p pg o g
  _WS_MOVED_WHY=''
  [[ -n "$_WS_RECORDED_GDIRS" ]] || return 0
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    pg=$(git -C "$p" rev-parse --absolute-git-dir 2>/dev/null) && [[ -n "$pg" ]] \
      || { _WS_MOVED_WHY="could not read the git directory of the checkout at $p, so whether it is a gone row's moved tree was never asked"; return 2; }
    _ws_reclaim_resolve "$pg" && [[ "$_WS_RESOLVE_BASIS" == complete ]] \
      || { _WS_MOVED_WHY="could not resolve the git directory of the checkout at $p completely, so whether it is a gone row's moved tree was never asked"; return 2; }
    pg="$_WS_RESOLVED"
    while IFS=$'\t' read -r o g; do
      [[ -n "$o" && "$pg" == "$g" ]] || continue
      _WS_MOVED_WHY="the checkout at $p uses the git directory git records for registry row $o, whose workdir is gone — that row's tree was moved inside this child, so ccd cannot prove the tree is this child's own"
      return 1
    done <<< "$_WS_RECORDED_GDIRS"
  done <<< "$1"
  return 0
}

```

The scan in Step 1 reads each body's code lines, including each function's first line with its trailing `#` comment. Keep the forbidden words out of those lines: `mkdir`, `prune`, `rm`, `unlink`, `update-ref`, `worktree remove`, `/proc`, `tmux`, `_svc_`, `pane_`, `.lifecycle`. The prose above already respects this.

**3.5 — The ladder asks it after the nested scan.** In `_ws_reclaim_ladder`, find these two lines (`grep -nF 'RECLAIM_FOREIGN+="$p"' ccd/ccd` prints the first one, and the second follows it):

```
    RECLAIM_FOREIGN+="$p"$'\n'
  done <<< "$nested"$'\n'
```

Insert these five lines directly below them:

```
  # NOR IS ANY CHECKOUT INSIDE IT A GONE ROW'S MOVED TREE (spec §5.5):
  # asked after the scan, over its answer — `_ws_reclaim_moved_check` says why.
  _ws_reclaim_moved_check "$nested"; rc=$?
  (( rc != 2 )) || { _ws_reclaim_unmeasured "$_WS_MOVED_WHY"; return 1; }
  (( rc == 0 )) || { _reap_refuse containment-unproven "$_WS_MOVED_WHY"; return 1; }
```

They go ABOVE Task 8's four-line `# The facts the pin phase will act on, each a fingerprint input. The branch …` comment, which stays exactly as Task 8 left it. Task 8 (c) rewrote that comment's first line and added three more, so never match it as a whole line.

**3.6 — `_ws_reclaim_owned` asks it again.** Replace

```
  # row naming it or rooted inside it, literally or resolved — an unlistable
  # registry asked nothing.
  local id="$1" wd="$2" main="$3" rc
```

with

```
  # row naming it or rooted inside it, literally or resolved — an unlistable
  # registry asked nothing; and, where a gone row was placed on git's record
  # (spec §5.5), no checkout inside the tree that is that row's moved tree.
  local id="$1" wd="$2" main="$3" rc nested
```

Then, between the `[[ -z "$_WS_THROUGH_ROWS" ]] || { _WS_OWNED_WHY=…` line and the function's `  return 0`, insert:

```
  # Scanned only when a row was placed on git's record: every other tail asks
  # exactly what it asked before (`_ws_reclaim_moved_check` says why).
  if [[ -n "$_WS_RECORDED_GDIRS" && -d "$wd" ]]; then
    nested=$(_ws_nested_checkouts "$wd") \
      || { _WS_OWNED_WHY="could not scan $wd for a gone row's moved tree"; return 1; }
    _ws_reclaim_moved_check "$nested" || { _WS_OWNED_WHY="$_WS_MOVED_WHY"; return 1; }
  fi
```

- [ ] **Step 4: Re-stamp `ccd/ccd`**

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
```

Expected:
- `restamped`, then `--check` exits 0, then `ownership` PASSES.
- Every edit is below `ccd/ccd:19109`, so no citation census moves (R56).

- [ ] **Step 5: Run the tests to verify they pass**

Run each file in the FOREGROUND, one per command, with a timeout of at least 600000 ms:

```bash
cd server
./node_modules/.bin/vitest run test/ccd-child-reclaim-recovery.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-hardening.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-reflogs.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-pin.test.ts
./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts
./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts
./node_modules/.bin/vitest run test/ccd-child-reclaim-tail-contained.test.ts
./node_modules/.bin/vitest run test/child-reclaim.test.ts test/ccd-refusal-scan.test.ts test/ccd-wsaudit-nonpoison.test.ts \
  test/ccd-reg-get-census.test.ts test/ownership.test.ts test/typecheck-tests.test.ts
```

Expected: every file PASSES.
- `ccd-child-reclaim-recovery`: 20/20, with `unreadable` skipped as root.
- The ladder suite: all three `ambiguous row hold` cases stay green. The edited one is held because its records were pruned, not because the code cannot see them.
- `child-reclaim`'s harvested word set is unchanged: `containment-unproven` already exists.
- `ccd-wsaudit-nonpoison`'s counts are unchanged: there is no new refusal word.
- `ccd-reg-get-census` is unchanged: no `_reg_get "` and no `_reg_read "$id" project` was added.
- The expire suites cover the recovery reaching `ws-expire`, which shares the ladder and `_ws_reclaim_owned`. The worker names that reach in the wave-done (ruling X2).
- `ccd-child-reclaim-tail-contained` (Task 3): its scan still counts six destructive calls in the tail, because this task adds none (ruling X3).

A red in a known load flake (`ccd-bounded-reads`, `ccd-session-state`, `typecheck-tests`) is re-run in isolation before it is called a break.

- [ ] **Step 6: Mutation check**

Apply each row alone. Re-stamp (`bash ccd/ccrc restamp ccd/ccd`), run the command (`cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-recovery.test.ts -t '<filter>'`), see the red, then restore the file byte for byte and re-stamp.

| # | Mutation (exact edit) | `-t` filter | Expected red |
|---|---|---|---|
| 1 | In `_ws_reclaim_workdir_shared`, replace the whole `if (( ! lit && ! rok )); then … fi` block with the line it replaced, `(( lit )) \|\| (( rok )) \|\| { unres+="${unres:+, }$o"; continue; }` | `hand-deleted workspace` | `git’s record places the gone sibling: … expected 'unmeasured' to be 'reclaimable'` |
| 2 | In `_ws_reclaim_recorded_git`, insert `return 1` as the first line after its `local` lines | `two hand-deleted children` | `the child, its sibling placed by git’s record: … expected 'unmeasured' to be 'reclaimable'`. `two interrupted children` stays GREEN, which shows the arms are independent. |
| 3 | In `_ws_reclaim_recorded_crumb`, insert `return 1` as the first line after its `local` line | `two interrupted children` | `expected '1' to be '0'` |
| 4 | `(( n == 1 )) \|\| return 1` → `(( n >= 1 )) \|\| return 1` | `two admin entries` | `two records name the one path: … expected 'reclaimable' to be 'unmeasured'` |
| 5 | `(( rc == 0 && RECLAIM_REC_PRUNABLE && ! RECLAIM_REC_MAIN ))` → `(( rc == 0 && ! RECLAIM_REC_MAIN ))` | `locked record` | `a locked record: … expected 'reclaimable' to be 'unmeasured'` |
| 6 | In `_ws_reclaim_record`, delete the `prunable\|"prunable "*) …` arm | `hand-deleted workspace` | `git’s record places the gone sibling: … expected 'unmeasured' to be 'reclaimable'` |
| 7 | `[[ "$_WS_RESOLVE_BASIS" == complete && "$_WS_RESOLVED" == "$parent" ]]` → `[[ "$_WS_RESOLVED" == "$parent" ]]` | `parent that is gone too` | `the parent is gone too: … expected 'reclaimable' to be 'unmeasured'` |
| 8 | The same line → `[[ "$_WS_RESOLVE_BASIS" == complete ]]` | `parent spelled through a link` | `the row is spelled through a link: … expected 'reclaimable' to be 'unmeasured'` |
| 9 | `_ws_reclaim_log_of "$main" tree "$w" 1 \|\| return 1` → `_ws_reclaim_log_of "$main" tree "$w" 1 \|\| { _WS_RECORDED_G=''; return 0; }` (an unread record treated as nothing to compare) | `unreadable worktrees` | `worktrees/ cannot be listed: … expected 'reclaimable' to be 'unmeasured'` |
| 10 | In `_ws_reclaim_recorded_crumb`, drop `&& "$tuuid" == "$ruuid"` | `another session` | `a tombstone of another session (its uuid): … expected 'reclaimable' to be 'unmeasured'` |
| 11 | Drop `&& "$twd" == "$w"` | `another workdir` | `a tombstone naming another workdir: … expected 'reclaimable' to be 'unmeasured'` |
| 12 | `reclaim:branch\|reclaim:artifacts) need=1 ;;` → `… need=0 ;;` | `worktree: absent` | `a reclaim tombstone saying worktree: absent: … expected 'reclaimable' to be 'unmeasured'` |
| 13 | In the crumb's `case`, `*) return 1 ;;` → `*) need=1 ;;` | `reclaim:worktree` and `expire:branch` | each: `… expected 'reclaimable' to be 'unmeasured'` |
| 14 | Together: in `_ws_reclaim_workdir_shared`, `[[ "$basis" == absent-suffix ]] && _ws_reclaim_recorded "$o" "$w"` → `_ws_reclaim_recorded "$o" "$w"`, AND delete `_ws_reclaim_absent "$w" \|\| return 1` from `_ws_reclaim_recorded` | `link planted` | `a link planted at the gone path: … expected 'reclaimable' to be 'unmeasured'`. **Disclosed survivor pair:** either edit alone keeps the suite green, because the other answers. They are one guard in two places. |
| 15 | In `_ws_reclaim_ladder`, delete the three `_ws_reclaim_moved_check "$nested"; rc=$?` … lines | `moved checkout of ANOTHER` | `expected 'reclaimable' to be 'containment-unproven'` |
| 16 | In `_ws_reclaim_owned`, delete the `if [[ -n "$_WS_RECORDED_GDIRS" && -d "$wd" ]]; then … fi` block | `moved checkout of the child` | `expected '0' to be '1'`. The foreign case reds at `the tail asks it again` the same way. |
| 17 | In `_ws_reclaim_workdir_shared`, delete the `[[ -z "$_WS_RECORDED_G" ]] \|\| _WS_RECORDED_GDIRS+=…` line | `moved checkout of ANOTHER` | `expected 'reclaimable' to be 'containment-unproven'` |
| 18 | In `_ws_reclaim_moved_check`, `[[ -n "$o" && "$pg" == "$g" ]]` → `[[ -n "$o" && "$p" == "$g" ]]` (the checkout's path compared, not its git directory) | `moved checkout of ANOTHER` | `expected 'reclaimable' to be 'containment-unproven'` |
| 19 | Insert `mkdir -p -- "$w" 2>/dev/null \|\| :` as the first body line of `_ws_reclaim_recorded` | `four bodies` and `hand-deleted workspace` | scan: `expected [ '_ws_reclaim_recorded creates a directory: mkdir -p -- "$w" 2>/dev/null \|\| :' ] to deeply equal []`; case: `expected 'unmeasured' to be 'reclaimable'`, because the leaf no longer reads absent |
| 20 | Insert `git -C "$main" worktree prune 2>/dev/null \|\| :` directly before `_ws_reclaim_log_of "$main" tree "$w" 1` | `git worktree prune never runs` | `git worktree prune never ran: expected '-C … worktree prune\n' to be ''`. The scan reds too: `prunes git’s records`. |
| 21 | In `_ws_reclaim_recorded_crumb`, delete `(( rc == 1 )) \|\| return 1` | `git still records` | `a breadcrumb over a record git keeps: … expected 'reclaimable' to be 'unmeasured'`. `two interrupted children` and the VARIANTS stay GREEN: `removedByTail` clears the record there, so the check passes. |

`a lifecycle create row alone keeps the hold` has no row. It pins an absence (nothing reads the journal), so the guard is the scan's `reads the lifecycle journal` line. Mutation: insert `: "$_LC_DIR"` into `_ws_reclaim_recorded_crumb` → `four bodies` reds with `… reads the lifecycle journal: : "$_LC_DIR"`.

Restore everything, re-stamp, then re-run Step 4 and the `ccd-child-reclaim-recovery` and ladder lines of Step 5. Both must be green.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-child-reclaim-recovery.test.ts server/test/ccd-child-reclaim-ladder.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): a gone alternate row is placed on recorded evidence, never on a projection

_ws_reclaim_workdir_shared gains a second placement basis, `recorded`, for a
row whose workdir is gone. Git's record places it when exactly one admin entry
names the tree, git marks that stanza prunable, the leaf is the only absent
component and the parent resolves completely to its literal spelling. Ccd's
own breadcrumb places it when the phase was written past ccd's own removal
step (a reclaim's only with worktree: present), the tombstone is this row's,
and git keeps no record of the tree: a breadcrumb also stands over a tree
that was moved away, and a record git keeps is the git arm's to judge.
Anything short of that holds, as before. The ladder after its nested scan, and
_ws_reclaim_owned, refuse a checkout inside the child that resolves to a
recovered row's admin directory: a record says where a tree was, not that it
is gone rather than moved. Nothing here creates a directory, prunes, deletes,
or reads process, pane or journal state, and a scan pins it. A hand-deleted
workspace no longer holds every child, and two interrupted children release
each other.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```


### Task 10: `probe-unmeasured` is journaled as `failed`, in ws-reclaim's lock and in `ws-audit --reclaim`

**Model routing:** `sonnet`, effort `high`. The task adds no destructive step. It adds one journal write on two answers that already exist, and one vocabulary word. The compiler and the two set-equality scans check the cross-language part.

**Why:** contract §12 R52, which amends R5′. Today a probe the reclaim ladder needs can fail to run, or its answer can be unreadable (`_ws_reclaim_unmeasured`). When that happens, both arms that answer it write NO journal line. The verb's locked recomputation prints `{"failed":"probe-unmeasured",…}` at exit 1. The audit prints its RECLAIM document with `"verdict"` holding `unmeasured`, and also exits 1. The lifecycle mirror never sees either failure, so the chip and the attention list have only the sweep's own state to go on. That gap is R43's "the failures the mirror never sees".

R52 rules what changes:
- Both arms journal ONE `failed` line, with one new `LcRefusalToken`, `probe-unmeasured`.
- The row's `verb` (`ws-reclaim` or `ws-audit`) tells the two arms apart.
- The verb arm goes through the existing failure path, `_ws_reclaim_fail`, so its stdout is the same bytes as before.

Wave 5's reader already counts any `failed` line as a failure line (`childReclaimFailureLine`), so NO server table changes. This task proves that with a round trip.

R5′'s "audit-time journaling is TERMINAL-only" gains this one exception, and R20's backoff bounds the repeat. Task 13 writes that amendment into the spec and contract prose. This task rewrites only ccd's own comment.

`ws-expire`'s byte-identical twin (`_ws_reclaim_failed_json probe-unmeasured` in the EXPIRE region) belongs to workspace-lifecycle. Do NOT touch it. Nothing this task edits is code `ws-expire` runs (the `cmd_ws_audit` line is in its `--reclaim` mode only), so this task adds no entry to the wave-done's list of ws-expire-reaching changes (X2).

**Files:**
- Modify: `ccd/ccd`, three places:
  - `_ws_reclaim_locked`'s probe-unmeasured site. At `77c11245a` it is `ccd/ccd:28589`, with its comment starting at `:28584`. Find it with `grep -n '_ws_reclaim_failed_json probe-unmeasured "\$REAP_DETAIL"' ccd/ccd`: the FIRST hit is the RECLAIM region's. The second hit, below `EXPIRE-BEGIN`, is ws-expire's and is not edited.
  - `cmd_ws_audit`'s unmeasured arm, the `return 1` line directly under `echo "ccd: ws-audit --reclaim measured nothing: …" >&2`. At `77c11245a` the `return 1` is `ccd/ccd:13167`; find it with `grep -n 'ws-audit --reclaim measured nothing' ccd/ccd`. This function sits ABOVE the frozen citation boundary (R56), so the edit is ONE-FOR-ONE: no line is added or removed.
  - The RECLAIM region's `WS-AUDIT --RECLAIM` comment, the sentence `It is journaled nowhere: no refusal, no token.` At `77c11245a` it is `ccd/ccd:28701`.
- Modify: `shared/api.ts`:
  - `LcRefusalToken`: find it with `grep -n '^export type LcRefusalToken' shared/api.ts`. Its last member is `| 'unit-still-active';` (`shared/api.ts:7692` at `77c11245a`).
  - `LC_REFUSAL_WORD`: its last entry is `'unit-still-active':` (`:7767` at `77c11245a`).
  - On the worker's tree these sit wherever the greps say, because wave 5 (#290) and #286 both moved them. Every line number in this task is a hint; the grep is the anchor.
- Modify: `server/src/childReclaimSweep.ts`. One docstring sentence, near `server/src/childReclaimSweep.ts:943` at wave 5's `e79b1da7` (a hint). Find it with `grep -n 'a failure is the `_lc_fail` line of an attempt that' server/src/childReclaimSweep.ts`.
- Modify: `server/src/coord/childReclaim.ts`, line-neutral (Step 4(f), journal.OPEN7): `CHILD_RECLAIM_PROBE_UNMEASURED` is typed `satisfies LcRefusalToken`, and `LcRefusalToken` joins the existing `shared/api.js` type import on its last line. Find them with `grep -n "^const CHILD_RECLAIM_PROBE_UNMEASURED = 'probe-unmeasured';" server/src/coord/childReclaim.ts` and `grep -n 'type RunSummary, lcRefusalWord,' server/src/coord/childReclaim.ts`.
- Modify: `README.md`. Only the three `LC_REFUSAL_WORD` map anchors in the purge-refusal sentence change, re-pointed by content (Step 6). Find it with ``grep -n '`purge-mechanism-absent` (`shared/api.ts:' README.md``.
- Modify, only if Step 6 measures it red: `server/test/session-hook.test.ts`, the `'shared/api.ts'` entry of the CITATION DEBT `byFile` census.
- Test, create: `server/test/ccd-child-reclaim-unmeasured-journal.test.ts`
- Test, modify:
  - `server/test/lifecycle-refusal-word.test.ts`: `ALL_TOKENS` and `expect(TOKENS.length).toBe(15)` as Task 8 left it (14 on main, at `:22` and `:35` at `77c11245a`).
  - `server/test/child-reclaim.test.ts`: the now-vacuous parity pin `expect(ccd).toContain('_ws_reclaim_failed_json probe-unmeasured')`, near `server/test/child-reclaim.test.ts:320` at `e79b1da7` (a hint; find it by the quoted pin).
  - `server/test/child-reclaim-status.test.ts`: one `ROWS` entry after the `failed unit-still-active` row, and the token list in `reads a failure token’s journal word ahead of the audit sentences`, near `:274` at `e79b1da7` (a hint; find both by their quoted names).
  - `server/test/ccd-child-reclaim-audit.test.ts`: the three "journaled nowhere" assertions at `:81`, `:116` and `:345` at `77c11245a`, the title at `:70`, and the comment at `:289`.

**Interfaces:**
- Consumes:
  - ccd `_ws_reclaim_fail id lctx token detail [k v]...`. It journals through `_lc_fail "$_WS_RCL_ACT" … verb "ws-$_WS_RCL_ACT"` and prints `_ws_reclaim_failed_json token detail`, rc 1 (`ccd/ccd:27831`). `_WS_RCL_ACT` is the global `reclaim` in `_ws_reclaim_locked`.
  - ccd `_lc_fail act id tx token detail [k v]...` (`ccd/ccd:5023`), which writes `outcome failed`.
  - `childReclaimFailureLine(e: { outcome: string; refusal: string | null }): boolean` (`server/src/childReclaimSweep.ts`, wave 5).
  - `parseChildReclaimResult(sessionId, stdout, stderr): ChildReclaimVerbRead`, `CHILD_RECLAIM_TOKEN_KIND` (`server/src/coord/childReclaim.ts`).
  - `parseJournalLine(line: string): JournalRow` (`server/src/coord/journalparse.ts`).
  - `lcRefusalWord(token: string): string | null`.
  - `verbHelpers(() => h).failedPairAgrees` (`server/test/childReclaimVerbHelpers.ts`).
- Produces:
  - `LcRefusalToken` gains `'probe-unmeasured'`, and `LC_REFUSAL_WORD['probe-unmeasured']: string` gives one sentence true of both arms.
  - ccd journal lines:
    - Verb arm: `{act:"reclaim", outcome:"failed", id, refusal:"probe-unmeasured", detail:<the document's detail>, verb:"ws-reclaim", dec:{surface, actor, reason}}`. There is no `tx` and no `intent` before it.
    - Audit arm: `{act:"reclaim", outcome:"failed", id, refusal:"probe-unmeasured", detail:<the document's detail>, verb:"ws-audit"}`.
  - Both stdout documents and both exit codes are UNCHANGED.

- [ ] **Step 0: Entry conditions (the branch was cut from a `main` that already carries wave 5, #290)**

```bash
grep -n "export const CHILD_RECLAIM_PRE_LOCK_TOKEN = {" server/src/childReclaimSweep.ts
grep -n "export const childReclaimFailureLine" server/src/childReclaimSweep.ts
grep -c '_ws_reclaim_failed_json probe-unmeasured "$REAP_DETAIL"' ccd/ccd
grep -n 'ws-audit --reclaim measured nothing' ccd/ccd
grep -n "expect(TOKENS.length).toBe(15)" server/test/lifecycle-refusal-word.test.ts
grep -n "expect(ccd).toContain('_ws_reclaim_failed_json probe-unmeasured')" server/test/child-reclaim.test.ts
grep -n "'probe-unmeasured'" shared/api.ts
```

Expected:
- The first two lines each print one line.
- The `grep -c` prints `2`: reclaim's site and ws-expire's twin.
- The next three each print one line.
- The last prints NOTHING.

If either wave-5 grep is empty, this branch was not cut from a `main` carrying #290: STOP and report it, because this task's pins read wave 5's reader. If `grep -c` prints anything but 2, an earlier task moved a probe site: find it before editing.

- [ ] **Step 1: Write the failing tests**

(a) Create `server/test/ccd-child-reclaim-unmeasured-journal.test.ts`:

```ts
// Child-reclamation wave 6, Task 10 (spec §5.9): a probe the
// reclaim ladder needs that could not run, or whose answer could not be read,
// is JOURNALED as `failed` with the word `probe-unmeasured`, in BOTH arms that
// answer it: `ws-reclaim`'s locked recomputation (`verb ws-reclaim`) and
// `ws-audit --reclaim`'s unmeasured answer (`verb ws-audit`). The verb arm goes
// through the existing failure path, so its stdout is byte for byte the
// document `_ws_reclaim_failed_json` always printed. A `failed` line is already
// a failure line under wave 5's reader, so no server table changes: the last
// describe proves ccd's line round-trips through that reader. Fixture HOMEs
// only: every ccd call here runs through the harness, never against $HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { decOf, eventsOf } from './lifecycleHelpers.js';
import { CHILD_ID, CHILD_STUBS, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { CHILD_RECLAIM_TOKEN_KIND, parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_PRE_LOCK_TOKEN, childReclaimFailureLine } from '../src/childReclaimSweep.js';
import { LC_REFUSAL_WORD, lcRefusalWord } from '../../shared/api.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-unmeasured-'); });
afterEach(() => { h.cleanup(); });
const { failedPairAgrees } = verbHelpers(() => h);

/** The ladder's stash read fails: `_ws_reclaim_unmeasured`, at audit time and under the lock alike. */
const STASH_FAILS = '_ws_reclaim_stash_shas() { return 1; };';
const AUDIT_STUBS = `${CHILD_STUBS} _session_verdict() { echo gone; }; ${GH_STUB}`;
const audit = (pre = ''): { code: number; stdout: string; stderr: string } =>
  h.run(`${AUDIT_STUBS} ${pre} cmd_ws_audit --session ${CHILD_ID} --reclaim`);
const shape = (e: Record<string, unknown>) =>
  ({ outcome: e['outcome'], refusal: e['refusal'], verb: e['verb'], detail: e['detail'], tx: e['tx'] ?? '' });
/** What `_ws_reclaim_failed_json` prints for this detail: ccd's own printer, never a re-spelling. */
const printedBy = (detail: string): string => {
  fs.writeFileSync(path.join(h.home, 'detail.txt'), detail);
  return h.sh('_ws_reclaim_failed_json probe-unmeasured "$(cat "$HOME/detail.txt")"');
};

describe('ws-reclaim: a probe that could not run under the lock is ONE failed line (spec §5.9)', () => {
  it('journals failed probe-unmeasured, verb ws-reclaim, the declared actor, no tx and no intent — and prints the SAME document at exit 1', () => {
    makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: STASH_FAILS, extra: "--surface agent --actor 'run:7 reclaim close'" });
    expect(r.code, r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('probe-unmeasured');
    expect(r.stdout.trim(), 'the stdout bytes are the ones _ws_reclaim_failed_json always printed').toBe(printedBy(o.detail));
    const rows = eventsOf(h.home, 'reclaim');
    expect(rows.map(shape)).toEqual([{ outcome: 'failed', refusal: 'probe-unmeasured', verb: 'ws-reclaim', detail: o.detail, tx: '' }]);
    failedPairAgrees(r);
    expect(decOf(rows[0]!)['actor'], 'the declared actor rides it, as it rides the refusal emit').toBe('run:7 reclaim close');
    expect(h.reg(CHILD_ID, 'reaping'), 'nothing started: no breadcrumb').toBeNull();
    // Wave 5's executor reads the document exactly as before: not resumable, the word as its token.
    expect(parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr)).toEqual(
      { kind: 'failed', resume: 'not-resumable', detail: `probe-unmeasured: ${o.detail}`, token: 'probe-unmeasured' });
  }, 60_000);

  it('a breadcrumb that stands but cannot be read is the same one failed line', () => {
    makeChild(h);
    const tok = evalOf(h).token;
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${CHILD_ID}.reaping`));
    const r = childReclaimVerb(h, tok);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(eventsOf(h.home, 'reclaim').map((e) => [e['outcome'], e['refusal'], e['verb']]))
      .toEqual([['failed', 'probe-unmeasured', 'ws-reclaim']]);
    failedPairAgrees(r);
  }, 60_000);
});

describe('ws-audit --reclaim: the unmeasured answer is ONE failed line, verb ws-audit (spec §5.9)', () => {
  it('exit 1, the reclaim document unchanged, one failed line carrying the document’s own detail', () => {
    makeChild(h);
    const r = audit(STASH_FAILS);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stderr).toContain('ws-audit --reclaim measured nothing');
    const a = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(a['mode']).toBe('reclaim');
    expect(a['verdict']).toBe('unmeasured');
    expect(a).not.toHaveProperty('token');
    expect(eventsOf(h.home, 'reclaim').map(shape))
      .toEqual([{ outcome: 'failed', refusal: 'probe-unmeasured', verb: 'ws-audit', detail: a['detail'], tx: '' }]);
  }, 60_000);

  it('the exception is the unmeasured answer alone: a reclaimable audit still journals nothing', () => {
    makeChild(h);
    const r = audit();
    expect(r.code, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as Record<string, unknown>)['verdict']).toBe('reclaimable');
    expect(eventsOf(h.home, 'reclaim')).toEqual([]);
  }, 60_000);
});

describe('wave 5’s reader takes both lines as failures, worded by the journal map (spec §5.9)', () => {
  it('each arm’s line parses, is a failure line, and words through LC_REFUSAL_WORD', () => {
    makeChild(h);
    childReclaimVerb(h, evalOf(h).token, { pre: STASH_FAILS });
    audit(STASH_FAILS);
    const rows = eventsOf(h.home, 'reclaim');
    expect(rows.map((e) => e['verb'])).toEqual(['ws-reclaim', 'ws-audit']);
    for (const e of rows) {
      const j = parseJournalLine(JSON.stringify(e));
      expect(j.act).toBe('reclaim');
      expect(j.outcome).toBe('failed');
      expect(childReclaimFailureLine(j), String(e['verb'])).toBe(true);
      expect(lcRefusalWord(j.refusal ?? ''), String(e['verb'])).toBe(LC_REFUSAL_WORD['probe-unmeasured']);
    }
  }, 90_000);

  it('probe-unmeasured is classified nowhere else: not a pre-lock refusal, not a ws-reclaim refusal', () => {
    // A `failed` line needs no table entry (spec §5.9). Putting the word in either table would class it a
    // second time, by a reader that need not agree.
    expect(Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)).not.toContain('probe-unmeasured');
    expect(Object.keys(CHILD_RECLAIM_TOKEN_KIND)).not.toContain('probe-unmeasured');
    expect(childReclaimFailureLine({ outcome: 'refused', refusal: 'probe-unmeasured' }), 'only ever as `failed`').toBe(false);
  });
});

describe('its word is true of both arms', () => {
  it('says nothing was removed and the next attempt starts over, and never calls itself a refusal or promises anything intact', () => {
    const w = LC_REFUSAL_WORD['probe-unmeasured'];
    expect(w).toMatch(/nothing was removed/);
    expect(w).toMatch(/from the start/);
    expect(w).not.toMatch(/refus/i);
    expect(w).not.toMatch(/intact/);
  });
});
```

(b) `server/test/lifecycle-refusal-word.test.ts`: `ALL_TOKENS`' last line, as Task 8 left it, `'pin-failed': true, 'unit-still-active': true, 'branch-unmeasured': true,` becomes `'pin-failed': true, 'unit-still-active': true, 'branch-unmeasured': true, 'probe-unmeasured': true,`. Edit that ONE line; never paste a whole literal over the tree's. The literal then reads (16 keys, Task 8's `branch-unmeasured` kept):

```ts
const ALL_TOKENS: Record<LcRefusalToken, true> = {
  'scratch-unwritable': true, 'tip-unreadable': true, 'bad-session-id': true,
  'flock-unavailable': true, 'lock-unopenable': true, 'is-a-workspace': true,
  'session-live': true, 'session-verdict-unknown': true, 'spawn-failed': true,
  'purge-refused': true, 'purge-incomplete': true, 'purge-mechanism-absent': true,
  'pin-failed': true, 'unit-still-active': true, 'branch-unmeasured': true, 'probe-unmeasured': true,
};
```

and `expect(TOKENS.length).toBe(15);` (Task 8's) becomes `expect(TOKENS.length).toBe(16);`.

(c) `server/test/child-reclaim.test.ts`: replace the whole `it("the special-cased word is ccd's own — `_ws_reclaim_failed_json probe-unmeasured`", …)` and the comment block above it (`// Parity: the ONE word this file special-cases …`) with:

```ts
  // Parity: the ONE word this file special-cases must still be the word ccd
  // prints AT THE RECLAIM SITE. Retargeted at wave 6 (spec §5.9): the site
  // became `_ws_reclaim_fail … probe-unmeasured`, so the journal line and the
  // document come from one word. A whole-file `toContain` of the old
  // `_ws_reclaim_failed_json probe-unmeasured` stayed green on ws-expire's twin
  // alone, which made it vacuous. So this reads only the code lines of the
  // RECLAIM region.
  it("the special-cased word is ccd's own — the RECLAIM region's `_ws_reclaim_fail … probe-unmeasured`", () => {
    const ccd = readFileSync(CCD, 'utf8');
    const begin = ccd.indexOf('RECLAIM-BEGIN');
    const end = ccd.indexOf('RECLAIM-END');
    expect(begin, 'the RECLAIM region is missing its BEGIN marker').toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const code = ccd.slice(begin, end).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).toMatch(/_ws_reclaim_fail "\$id" "" probe-unmeasured "\$REAP_DETAIL"/);
    expect(code, 'no unjournaled printer of the word is left in the region').not.toContain('_ws_reclaim_failed_json probe-unmeasured');
  });
```

(d) `server/test/child-reclaim-status.test.ts`:
- Directly after the `failed unit-still-active → deferred, wave 3’s journal word, not the audit fallback` row, add:

```ts
  // Wave 6 (spec §5.9): the probe that could not run, at audit time or under the lock, is a
  // `failed` line with its own journal word. It needs no table entry, only its word.
  { name: 'failed probe-unmeasured → deferred, its journal word, not the audit fallback',
    input: base({ event: ev('failed', 'probe-unmeasured') }),
    want: { word: 'deferred', sentence: lcRefusalWord('probe-unmeasured'), at: EV_AT } },
```

- In `reads a failure token’s journal word ahead of the audit sentences, never the generic fallback`, the list becomes `['pin-failed', 'unit-still-active', 'flock-unavailable', 'lock-unopenable', 'branch-unmeasured', 'probe-unmeasured']`, keeping Task 8's `branch-unmeasured`.

(e) `server/test/ccd-child-reclaim-audit.test.ts`:
- The title `'a probe that could not RUN EXITS 1 — a reclaim document saying unmeasured, no token, no terminal word, nothing journaled'` becomes `'a probe that could not RUN EXITS 1 — a reclaim document saying unmeasured, no token, no terminal word, journaled as ONE failure (spec §5.9)'`.
- Its `expect(eventsOf(h.home, 'reclaim'), 'an unmeasured answer is journaled nowhere').toEqual([]);` becomes:

```ts
    expect(eventsOf(h.home, 'reclaim').map((e) => [e['outcome'], e['refusal'], e['verb']]),
      'an unmeasured answer is ONE failed line, verb ws-audit (spec §5.9), never a refusal')
      .toEqual([['failed', 'probe-unmeasured', 'ws-audit']]);
```

- The breadcrumb case's `expect(eventsOf(h.home, 'reclaim'), 'unmeasured is journaled nowhere').toEqual([]);` becomes the same assertion with the message `'unmeasured is ONE failed line (spec §5.9)'`.
- In `absent-suffix alternate row is unmeasured and mints no token`, `expect(eventsOf(h.home, 'reclaim'), 'a retry is journaled nowhere — no terminal refusal row').toEqual([]);` becomes:

```ts
  expect(eventsOf(h.home, 'reclaim').map((e) => [e['outcome'], e['refusal'], e['verb']]),
    'a retry is ONE failed line, never a terminal refusal row (spec §5.9)')
    .toEqual([['failed', 'probe-unmeasured', 'ws-audit']]);
  const journaled = String(eventsOf(h.home, 'reclaim')[0]!['detail']);
  expect(journaled, 'the journal carries the document’s detail, no more').toBe(String(a['detail']));
  for (const leak of [raw, `${h.home}/alias`, 'alias/server']) {
    expect(journaled, `the journal never carries ${leak}`).not.toContain(leak);
  }
```

- In the comment above `const PROJECTED`, `not be placed — exit 1, \`unmeasured\`, no token, nothing journaled — and` becomes `not be placed — exit 1, \`unmeasured\`, no token, one failed line (spec §5.9) — and`.

- [ ] **Step 2: Run the tests to verify they fail**

Run in the foreground, with a timeout of at least 600000ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-unmeasured-journal.test.ts test/lifecycle-refusal-word.test.ts \
  test/child-reclaim.test.ts test/child-reclaim-status.test.ts test/ccd-child-reclaim-audit.test.ts)
```

Expected: FAIL.
- `ccd-child-reclaim-unmeasured-journal`:
  - Both ws-reclaim cases: `expected [] to deeply equal [ { outcome: 'failed', refusal: 'probe-unmeasured', verb: 'ws-reclaim', … } ]`. The two stdout assertions before it PASS, which proves the document is untouched today.
  - The audit unmeasured case: `expected [] to deeply equal [ { outcome: 'failed', … verb: 'ws-audit', … } ]`.
  - The round trip: `expected [] to deeply equal [ 'ws-reclaim', 'ws-audit' ]`.
  - The word case: `TypeError: .toMatch() expects to receive a string, but got undefined`.
  - The reclaimable-audit control and the classification case PASS. They pin what must NOT change.
- `lifecycle-refusal-word`: `isLcRefusalToken(probe-unmeasured)` gives `expected false to be true`. `covers the whole union` gives a diff with `probe-unmeasured` only on the expected side.
- `child-reclaim`: the retargeted pin gives `expected '…' to match /_ws_reclaim_fail "\$id" "" probe-unmeasured "\$REAP_DETAIL"/`.
- `child-reclaim-status`:
  - The new row gives `sentence: 'ccrc declined: probe-unmeasured.'` against `sentence: null`.
  - The token loop gives `probe-unmeasured has no LC_REFUSAL_WORD entry: …: expected null not to be null`.
  - `gives every word it answers a sentence` reds on the same null.
- `ccd-child-reclaim-audit`: the three edited cases give `expected [] to deeply equal [ [ 'failed', 'probe-unmeasured', 'ws-audit' ] ]`.

- [ ] **Step 3: Add the word to L0**

In `shared/api.ts`:
- The union's last member `| 'unit-still-active';      // ws-reclaim (spec 2026-09-22 §5.6): …` loses its `;` and keeps its comment unchanged.
- Directly after it, add ONE line:

```ts
  | 'probe-unmeasured';       // ws-reclaim and `ws-audit --reclaim` (spec §5.9): a probe the ladder needs could not run or be read, before any act — journaled `failed`, its `verb` telling the two arms apart
```

In `LC_REFUSAL_WORD`, directly after the `'unit-still-active':` entry and before the closing `};`, add:

```ts
  // Child reclamation, wave 6 (spec §5.9). A probe the reclaim ladder needs
  // could not run, or its answer could not be read. That happens at audit time
  // (`verb ws-audit`) or in ws-reclaim's locked recomputation
  // (`verb ws-reclaim`). It only ever rides `_lc_fail`, with no intent before
  // it. Two things are true of both arms: neither removed anything, and the
  // server's retry starts over (`parseChildReclaimResult` reads the verb's
  // document as not-resumable).
  'probe-unmeasured':
    'ccrc could not finish measuring this workspace — a check it relies on could not run, or its answer could not be read — so nothing was started and nothing was removed. The next attempt measures again from the start.',
```

The union gains exactly ONE line, and Step 6 depends on that.

- [ ] **Step 4: Journal both arms in ccd, then re-stamp**

(a) In `_ws_reclaim_locked`, replace the comment and the block that starts `# A PROBE THAT COULD NOT RUN IS NOT A REFUSAL` and ends at the `fi` after `return 1` with:

```bash
  # A PROBE THAT COULD NOT RUN IS NOT A REFUSAL (`_ws_reclaim_unmeasured`).
  # Nothing was measured and nothing has started: there is no intent and no
  # breadcrumb. It is JOURNALED as a failure (spec §5.9) through
  # `_ws_reclaim_fail`, so the journal line and the `"failed"` document at exit 1
  # come from one word and one detail. The server reads that document as
  # `failed` but not resumable, and the next attempt measures from the start.
  # `cmd_ws_audit`'s unmeasured answer journals the same word with `verb
  # ws-audit`. The declared surface, actor and reason ride the line, as they
  # ride the refusal emit below.
  if [[ "$REAP_VERDICT" == unmeasured ]]; then
    _ws_reclaim_fail "$id" "" probe-unmeasured "$REAP_DETAIL" dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
    return 1
  fi
```

(b) In `cmd_ws_audit`'s `elif [[ "$REAP_VERDICT" == unmeasured ]]; then` arm, replace the ONE line `      return 1` with ONE line:

```bash
      _lc_fail reclaim "$id" "" probe-unmeasured "$REAP_DETAIL" verb ws-audit; return 1
```

Do NOT add a comment line here. This function sits above the frozen citation boundary, and its explanation lives in the RECLAIM region, as for every other line of `ws-audit --reclaim`.

(c) In the RECLAIM region's `WS-AUDIT --RECLAIM` block, replace the two comment lines

```
# stderr, and the audit EXITS 1. The server maps ANY audit exit 1 to `failed`
# and retries. It is journaled nowhere: no refusal, no token.
```

with:

```
# stderr, and the audit EXITS 1. The server maps ANY audit exit 1 to `failed`
# and retries. It is journaled as a FAILURE, never a refusal (spec §5.9:
# the one audit-time line that is not a terminal refusal): one `_lc_fail` line with the
# token `probe-unmeasured` and `verb ws-audit`. ws-reclaim's locked
# recomputation journals the same word with `verb ws-reclaim`. The line is
# written on the `return 1` line itself, because `cmd_ws_audit` sits above the
# frozen citation boundary and may not grow. The sweep's backoff (spec §5.9) bounds the repeat.
```

The comment must spell none of the shapes `wsaudit.test.ts` and `ccd-wsaudit-nonpoison.test.ts` harvest:
- a `"refused":"…"` or `"verdict":"…"` literal;
- `_reap_refuse` followed by a word;
- a `'!`-prefixed word.

(d) Re-stamp, then confirm that the only edits above the boundary are one-for-one:

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
git diff -U0 -- ccd/ccd | grep -E '^@@' | awk '{ split(substr($2,2),o,","); if (o[1]+0 < 19109) print }'
```

Expected:
- `restamp` exits 0, `--check` exits 0, and `ownership` PASSES.
- The last command prints exactly two hunk headers, each of the form `@@ -<n> +<n> @@` with NO `,<count>`:
  - line 2, the stamp;
  - `cmd_ws_audit`'s `return 1` line.

  Any other hunk below 19109, or any `,` count, means a line was added or removed above the boundary (R56): undo it and keep the edit one-for-one.

(e) In `server/src/childReclaimSweep.ts`, `childReclaimAttention`'s docstring, the sentence

```
 *  (`verb ws-audit`), and a failure is the `_lc_fail` line of an attempt that
 *  started, or the `_lc_refuse` line of a pre-lock die
```

becomes

```
 *  (`verb ws-audit`), and a failure is an `_lc_fail` line (an attempt that
 *  started, or a probe that could not run, spec §5.9) or a pre-lock die's `_lc_refuse` line
```

(f) In `server/src/coord/childReclaim.ts` (journal.OPEN7), make the one word this file special-cases a member of the L0 vocabulary. Both edits are line-neutral, and the docstring above the constant does not change:
- `const CHILD_RECLAIM_PROBE_UNMEASURED = 'probe-unmeasured';` becomes:

```ts
const CHILD_RECLAIM_PROBE_UNMEASURED = 'probe-unmeasured' satisfies LcRefusalToken;
```

- The `../../../shared/api.js` import's last line, `  type ChildReclaimStatus, type MarkerState, type MirroredLifecycleEvent, type RunState, type RunSummary, lcRefusalWord,`, gains ` type LcRefusalToken,` at its end, on the same line. If the tree's import has another shape, add `type LcRefusalToken` to it without adding a line.

This edit needs Step 3: before the union has the member, `tsc` rejects the `satisfies`.

- [ ] **Step 5: Run the tests to verify they pass**

Run in the foreground, with a timeout of at least 600000ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-unmeasured-journal.test.ts test/lifecycle-refusal-word.test.ts \
  test/child-reclaim.test.ts test/child-reclaim-status.test.ts test/ccd-child-reclaim-audit.test.ts \
  test/ccd-refusal-scan.test.ts test/ccd-child-reclaim-verb.test.ts test/child-reclaim-sweep-policy.test.ts \
  test/wsaudit.test.ts test/ccd-wsaudit-nonpoison.test.ts test/ownership.test.ts test/single-definition.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit -p .)
(cd pwa && ./node_modules/.bin/tsc --noEmit)
```

Expected:
- PASS everywhere, and `tsc` prints nothing in either package.
- `ccd-refusal-scan`'s `holds literal refusal arguments set-equal to the vocabularies in both directions` now finds `probe-unmeasured` at two literal sites (`_ws_reclaim_fail`'s and `_lc_fail`'s token positions).
- Its `holds the reclaim emits at exactly two` is unchanged at 2: neither arm spells a refused emit.
- `wsaudit` and `ccd-wsaudit-nonpoison` are green with NO edit, which proves no harvest shape was added.

- [ ] **Step 6: Pay the citation tax (R56; README is repaired, the census is re-measured)**

Step 3 inserted ONE line into `LcRefusalToken`. That line sits BELOW the three purge union arms README cites and ABOVE the three `LC_REFUSAL_WORD` keys it cites. So README's union anchor does not move, and each map anchor moves down by one.

(a) Measure where README's anchors stand and where the same bytes stand now, and prove the bytes are identical:

```bash
OLD_U=$(grep -oE 'shared/api\.ts:[0-9]+-[0-9]+' README.md | sed 's/.*://')
OLD_M=$(sed -n '/`purge-mechanism-absent` (`shared\/api\.ts:/,+1p' README.md | grep -oE '`:[0-9]+`' | tr -d '`:' | paste -sd' ')
NEW_U=$(grep -nE "^  \| 'purge-(refused|incomplete|mechanism-absent)'" shared/api.ts | cut -d: -f1 | paste -sd' ')
NEW_M=$(grep -nE "^  'purge-(refused|incomplete|mechanism-absent)':$" shared/api.ts | cut -d: -f1 | paste -sd' ')
echo "README union ${OLD_U} map ${OLD_M} | tree union ${NEW_U} map ${NEW_M}"
read -r U1 _ U3 <<<"$NEW_U"; read -r M1 M2 M3 <<<"$NEW_M"; read -r OM1 OM2 OM3 <<<"$OLD_M"
diff <(git show "HEAD:shared/api.ts" | sed -n "${OLD_U/-/,}p;${OM1}p;${OM2}p;${OM3}p") \
     <(sed -n "${U1},${U3}p;${M1}p;${M2}p;${M3}p" shared/api.ts) && echo SAME-BYTES
```

Expected:
- README's union anchor spans exactly the tree's first and third union line numbers, unchanged.
- Each of the tree's three map numbers is README's number plus one.
- Then `SAME-BYTES`.

If the `diff` prints anything, STOP and report it in the wave-done mail. It means README was already stale at `HEAD`, before this task touched it. That is debt `main` carried in, since this wave has no merge step that could repair it, and it is not this task's repair.

(b) Re-point the three map anchors:

```bash
perl -pi -e "s/\`:${OM1}\`/\`:${M1}\`/; s/\`:${OM2}\`/\`:${M2}\`/; s/\`:${OM3}\`/\`:${M3}\`/" README.md
git diff --stat -- README.md
```

Expected: `README.md | 4 ++--`. That is the two lines of the purge-refusal sentence and nothing else. If more lines changed, the same backticked number also appeared elsewhere. In that case run `git checkout -- README.md` and edit those two lines by hand.

(c) Re-measure the census:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|THE RANGE BOUND')
```

Expected: PASS.
- *README HAS ITS OWN CENSUS ENTRY, and it is EMPTY* passes because of (b).
- CITATION DEBT's `byFile` should not move:
  - Its `'shared/api.ts'` entry tracks the `RoutingArm` referent, far above `LcRefusalToken`.
  - Its `'ccd/ccd'` entry sees only one-for-one edits above the boundary.

What a red means:
- If the `'ccd/ccd'` entry is red, a byte moved above the boundary that this task did not mean to move. Re-run Step 4(d)'s `git diff` filter and find it.
- If ONLY the `'shared/api.ts'` entry (and so the `total`) is red, re-measure it under the standing rule:
  1. Set the entry and the `total` to the RECEIVED values, never values from this plan.
  2. Put this comment directly above the entry:

  ```ts
      // RE-MEASURED at child-reclamation wave 6, Task 10 (S6-R11, no rule changed): `shared/api.ts`
      // <old> -> <new>. This task inserted one `LcRefusalToken` member (`probe-unmeasured`) and its
      // `LC_REFUSAL_WORD` entry, under anchors the frozen spec/plan corpus cites by line. No corpus
      // document may be re-pointed. README's three map anchors into the same file were RE-ANCHORED BY
      // CONTENT in the same commit (`diff`-proved byte-identical), so README contributes nothing here.
  ```

  3. Re-run (c): PASS.

`session-hook` is a known load flake. A red that names neither `shared/api.ts` nor `ccd/ccd` gets an isolated re-run first.

- [ ] **Step 7: Mutation check**

Make each edit, run the command, see the red, then restore. Re-stamp after every `ccd/ccd` edit and again after its restore.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | In `_ws_reclaim_locked`, replace `_ws_reclaim_fail "$id" "" probe-unmeasured "$REAP_DETAIL" dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"` with `_ws_reclaim_failed_json probe-unmeasured "$REAP_DETAIL"` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-unmeasured-journal.test.ts test/child-reclaim.test.ts` | Both ws-reclaim cases: `expected [] to deeply equal [ { outcome: 'failed', … verb: 'ws-reclaim' … } ]`. The round trip: `expected [ 'ws-audit' ] to deeply equal [ 'ws-reclaim', 'ws-audit' ]`. `child-reclaim`'s retargeted pin: `expected '…' to match /_ws_reclaim_fail "\$id" "" probe-unmeasured …/`. |
| 2 | In `cmd_ws_audit`, replace `      _lc_fail reclaim "$id" "" probe-unmeasured "$REAP_DETAIL" verb ws-audit; return 1` with `      return 1` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-unmeasured-journal.test.ts test/ccd-child-reclaim-audit.test.ts test/ccd-refusal-scan.test.ts` | The audit case: `expected [] to deeply equal [ { … verb: 'ws-audit' … } ]`. The three edited audit cases: `expected [] to deeply equal [ [ 'failed', 'probe-unmeasured', 'ws-audit' ] ]`. `ccd-refusal-scan` stays GREEN, because the verb site still spells the word, so each arm needs its own pin. |
| 3 | Both 1 and 2 together | `cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts` | `declared journal-only tokens with no literal ccd call-site argument: expected [ 'probe-unmeasured' ] to deeply equal []` |
| 4 | In `cmd_ws_audit`'s line, `verb ws-audit` becomes `verb ws-reclaim` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-unmeasured-journal.test.ts` | The audit case diff shows `verb: 'ws-reclaim'` against `'ws-audit'`. The round trip shows `[ 'ws-reclaim', 'ws-reclaim' ]`. |
| 5 | Delete ` dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"` from the `_ws_reclaim_locked` call | same | The first ws-reclaim case: `the declared actor rides it…: expected undefined to be 'run:7 reclaim close'` |
| 6 | In `LC_REFUSAL_WORD['probe-unmeasured']`, replace `nothing was removed` with `the workspace is intact` | same | The word case: `expected '…the workspace is intact…' to match /nothing was removed/` |
| 7 | In `server/src/childReclaimSweep.ts`, add `probe: 'probe-unmeasured',` to `CHILD_RECLAIM_PRE_LOCK_TOKEN` | same | The classification case: `expected [ 'flock-unavailable', 'lock-unopenable', 'probe-unmeasured' ] not to include 'probe-unmeasured'`. `tsc` also fails on the `satisfies`. |
| 8 | In `shared/api.ts`, rename the union member `'probe-unmeasured'` and its `LC_REFUSAL_WORD` key to `'probe-unmeasurable'`, leaving `server/src/coord/childReclaim.ts` alone | `cd server && ./node_modules/.bin/tsc --noEmit -p .` | Among its errors: `src/coord/childReclaim.ts(…): error TS1360: Type '"probe-unmeasured"' does not satisfy the expected type 'LcRefusalToken'.` The server's special-cased word cannot drift from the L0 token (journal.OPEN7). |

Restore all of them, re-stamp, and re-run Step 5's commands (green).

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd shared/api.ts server/src/childReclaimSweep.ts server/src/coord/childReclaim.ts README.md \
  server/test/ccd-child-reclaim-unmeasured-journal.test.ts server/test/lifecycle-refusal-word.test.ts \
  server/test/child-reclaim.test.ts server/test/child-reclaim-status.test.ts server/test/ccd-child-reclaim-audit.test.ts
git add server/test/session-hook.test.ts   # only if Step 6(c) re-measured it
git commit -m "$(cat <<'MSG'
feat(reclaim): journal probe-unmeasured as failed, in ws-reclaim and ws-audit

When a probe the reclaim ladder needs could not run, it was answered with no
journal line in either arm that answers it: ws-reclaim's locked
recomputation and ws-audit --reclaim's unmeasured answer. The mirror never
saw the failure. Both arms now write one failed line with a new journal
word, probe-unmeasured, through the existing failure path. The verb's stdout
is the bytes _ws_reclaim_failed_json always printed, and the row's verb
(ws-reclaim or ws-audit) tells the arms apart.

Wave 5's reader already counts a failed line as a failure, so no server
table changes. A round-trip test pins that. The server's one special-cased
probe-unmeasured constant is typed against the L0 union. The cmd_ws_audit edit is
one-for-one above the citation boundary. README's three shared/api.ts map
anchors are re-pointed by content.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

Task 13 carries the prose this task does not write. That includes the amendment to R5′ ("audit-time journaling is terminal-only") for this one exception, in the spec's audit-journaling paragraph and wherever the contract restates R5′, and the R43 bullet "the failures the mirror never sees", which `probe-unmeasured` and the audit-time unmeasured answer leave. It also carries `_lc_fail`'s header (journal.OPEN6): one line-neutral edit saying that a probe that ran before any act may also write `failed`. This task leaves that header alone.

---

### Task 11: The id-tied pre-lock dies are journaled `refused`, after the session id is validated, and classified as pre-lock failures

**Model routing:** `opus`, effort `high`. This reorders argv validation at the entry of the destructive verb. The rule it must keep is that no journal line is ever written against an id that has not passed its shape check. That is a security-relevant input path, so it gets judgment, not transcription.

**Why:** contract §12 R52, with R43's "wave 6 classifies each new one when it adds it".

Today `cmd_ws_reclaim` dies on a malformed `--expect` token or `--child-of` run id with nothing in the journal. The executor reads the die as a `pre-lock-die` failure with no word (`token: null`), and the mirror never sees it. R52 rules on these dies:
- **Journaled.** The two dies TIED TO AN ID, the bad token and the bad run id, are journaled `refused` through `_lc_refuse`. They follow the `flock-unavailable` and `lock-unopenable` siblings, with new tokens, AFTER the session id is validated. So the session-id check moves first.
- **Classified.** Each new token is classified in `CHILD_RECLAIM_PRE_LOCK_TOKEN`, so wave 5's reader counts its line as a FAILURE (the chip reads `deferred`), never as an unclassified refusal.
- **Unjournaled, with stated reasons.** Seven dies stay unjournaled:
  - the usage die and the four `--actor`/`--reason` checks, because they run before any id is bound;
  - a bad session id, because it is no trustworthy id to journal against;
  - python3 unavailable, because the journal's encoder (`_lc_json`) IS python3.

R52 does not name the four `--actor`/`--reason` checks, so they stay sanctioned dies (see the open issue in the plan's ledger).

Token names follow #290's entries. A key names the die, and the value is `<subject>-<condition>`, as in `flock`→`flock-unavailable` and `lock`→`lock-unopenable`. So the new pairs are `token`→`token-malformed` and `runId`→`run-id-malformed`.

**Files:**
- Modify: `ccd/ccd`, `cmd_ws_reclaim`'s id binding and its three shape checks. At `77c11245a` they start at `ccd/ccd:28488`. Find them with `grep -n 'local token=\$2 childof=\$4 id=\$6' ccd/ccd`: the hit inside `cmd_ws_reclaim`, the one followed by `_child_runid_valid`. ws-expire's own `[[ $token =~ … ]] || die "bad token"` in the EXPIRE region is NOT edited. Nothing this task edits is code `ws-expire` runs, so this task adds no entry to the wave-done's list of ws-expire-reaching changes (X2).
- Modify: `shared/api.ts`:
  - `LcRefusalToken`, the member Task 10 made last (`| 'probe-unmeasured';`).
  - `LC_REFUSAL_WORD`, after the `'probe-unmeasured':` entry.
  - `ChildReclaimAttention`'s docstring, the sentence naming "the two pre-lock tokens". It is near `shared/api.ts:3803` at `e79b1da7` (a hint); find it with ``grep -n 'pre-lock tokens (`flock-unavailable`, `lock-unopenable`)' shared/api.ts``. This edit is one-for-one.
- Modify: `server/src/childReclaimSweep.ts`, the `CHILD_RECLAIM_PRE_LOCK_TOKEN` block and `childReclaimFailureLine`'s docstring. They start near `server/src/childReclaimSweep.ts:838` at `e79b1da7` (a hint); find them with `grep -n 'export const CHILD_RECLAIM_PRE_LOCK_TOKEN' server/src/childReclaimSweep.ts`.
- Modify: `server/src/coord/childReclaim.ts`:
  - two rows of `CHILD_RECLAIM_PRE_LOCK_DIE_PATTERNS`, near `server/src/coord/childReclaim.ts:610` at `e79b1da7`, a hint (`grep -n "re: /^bad token\$/" server/src/coord/childReclaim.ts`);
  - the two comments that say "one of the two pre-lock tokens", at `:1505` and `:1562` (`grep -n 'two pre-lock tokens' server/src/coord/childReclaim.ts`).
- Modify: `README.md`, the three map anchors again (Step 6).
- Modify, only if Step 6 measures it red: `server/test/session-hook.test.ts`.
- Test, create: `server/test/ccd-child-reclaim-prelock-journal.test.ts`
- Test, modify:
  - `server/test/ccd-refusal-scan.test.ts`: the `SANCTIONED` docstring and list (`:45` at `77c11245a`), and `.toBe(15)` (`:111`).
  - `server/test/lifecycle-refusal-word.test.ts`: `ALL_TOKENS` and `.toBe(16)`, as Task 10 left them.
  - `server/test/child-reclaim-sweep-policy.test.ts`: the `childReclaimFailureLine` rows and `the pre-lock tokens are exactly the two lock dies`, near `:1316` and `:1337` at `e79b1da7` (hints; find both by their quoted names).
  - `server/test/child-reclaim.test.ts`: `PRE_LOCK_TOKEN` (near `:366` at `e79b1da7`, a hint), `expect(die('bad token'))…token: null` (`:1390`), and the comment at `:175`.
  - `server/test/child-reclaim-status.test.ts`: two `ROWS` entries after the `refused lock-unopenable under a fleet pause → paused` row, and the token loop.

**Interfaces:**
- Consumes:
  - ccd `_lc_refuse act id token detail [k v]...`. It EMITS `refused`, then `die "$detail"`, and never returns (`ccd/ccd:5033`).
  - `_child_runid_valid` (wave 1).
  - `CHILD_RECLAIM_PRE_LOCK_TOKEN`, `isChildReclaimPreLockToken`, `childReclaimFailureLine`, `childReclaimTerminalRefusal(row, kindOf)` (`server/src/childReclaimSweep.ts`, wave 5).
  - `childReclaimTokenKind`, `parseChildReclaimResult` (`server/src/coord/childReclaim.ts`).
  - `parseJournalLine`, `lcRefusalWord`, `readJournal`.
- Produces:
  - `LcRefusalToken` gains `'token-malformed' | 'run-id-malformed'`, each with an `LC_REFUSAL_WORD` sentence.
  - ```ts
    export const CHILD_RECLAIM_PRE_LOCK_TOKEN = {
      flock: 'flock-unavailable', lock: 'lock-unopenable', token: 'token-malformed', runId: 'run-id-malformed',
    } as const satisfies Readonly<Record<'flock' | 'lock' | 'token' | 'runId', LcRefusalToken>>;
    ```
  - `CHILD_RECLAIM_PRE_LOCK_DIE_PATTERNS`: `^bad token$` is assigned `token: CHILD_RECLAIM_PRE_LOCK_TOKEN.token`, and `^bad run id$` is assigned `token: CHILD_RECLAIM_PRE_LOCK_TOKEN.runId`.
  - ccd journal line, one per die: `{act:"reclaim", outcome:"refused", id:<validated id>, refusal:"token-malformed"|"run-id-malformed", detail:"bad token"|"bad run id"}`, with no `tx` and no `verb`, exactly like the flock and lock siblings.
  - The stderr line (`ccd: bad token`, `ccd: bad run id`) and exit 1 are unchanged.

- [ ] **Step 0: Entry conditions**

```bash
grep -n "flock: 'flock-unavailable', lock: 'lock-unopenable'," server/src/childReclaimSweep.ts
grep -n "re: /^bad token\$/, token: null" server/src/coord/childReclaim.ts
grep -n "the pre-lock tokens are exactly the two lock dies" server/test/child-reclaim-sweep-policy.test.ts
grep -n "'probe-unmeasured';" shared/api.ts
grep -n 'die "bad token"\|die "bad run id"\|die "bad session id"' ccd/ccd | awk -F: '$1 > 25000'
grep -n "toBe(15)" server/test/ccd-refusal-scan.test.ts; grep -n "toBe(16)" server/test/lifecycle-refusal-word.test.ts
```

Expected:
- One line each for the first four. The fourth is Task 10's last union member.
- The fifth prints SIX lines, all inside the RECLAIM and EXPIRE regions: reclaim's three dies, ws-expire's two (`bad token`, `bad session id`), and `_ws_expire_audit_contained`'s `bad session id` (at `77c11245a`: `:28489`, `:28490`, `:28491`, `:29220`, `:29221` and `:29326`).
- The last two print one line each (the scan's 15, and Task 10's 16).

If the third is empty, this branch was not cut from a `main` carrying #290: STOP and report it.

- [ ] **Step 1: Write the failing tests**

(a) Create `server/test/ccd-child-reclaim-prelock-journal.test.ts`:

```ts
// Child-reclamation wave 6, Task 11 (spec §5.9): of cmd_ws_reclaim's
// pre-lock dies, the two TIED TO AN ID — a malformed --expect token and a
// malformed --child-of run id — are journaled `refused` through `_lc_refuse`
// (emit, then the SAME die). That happens AFTER the session id is validated,
// with words wave 5's reader classes as pre-lock FAILURES. Seven dies stay
// unjournaled, each for its stated reason: the usage die and the four
// --actor/--reason checks (they run before any id is bound), a bad session id
// (no trustworthy id to journal against), and python3 unavailable (the
// journal's encoder IS python3). Fixture HOMEs only. Nothing here reaches the
// reap lock, and nothing may.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { readJournal } from './lifecycleHelpers.js';
import { CHILD_ENV, CHILD_ID, CHILD_STUBS, makeChild } from './childReclaimFixture.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { childReclaimTokenKind, parseChildReclaimResult } from '../src/coord/childReclaim.js';
import {
  CHILD_RECLAIM_PRE_LOCK_TOKEN, childReclaimFailureLine, childReclaimTerminalRefusal, isChildReclaimPreLockToken,
} from '../src/childReclaimSweep.js';
import { LC_REFUSAL_WORD, lcRefusalWord, type LcRefusalToken } from '../../shared/api.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-prelock-'); });
afterEach(() => { h.cleanup(); });

const TOK = 'a'.repeat(64);
const BAD_ID = '../x';
/** `cmd_ws_reclaim` through the sourced function, answering instead of throwing. */
const verb = (argv: string, pre = ''): { code: number; stdout: string; stderr: string } =>
  h.run(`${CHILD_STUBS} ${pre} ${CHILD_ENV} cmd_ws_reclaim ${argv}`);
const lockFile = (): string => path.join(h.home, '.cc-sessions', `.reap-${CHILD_ID}.lock`);
/** Every `reclaim` line, WHATEVER its id: a line written against a malformed id must show here too. */
const childReclaimRows = (): Record<string, unknown>[] => readJournal(h.home).filter((e) => e['act'] === 'reclaim');
const shape = (e: Record<string, unknown>) =>
  ({ outcome: e['outcome'], id: e['id'], refusal: e['refusal'], detail: e['detail'], tx: e['tx'] ?? '' });

const JOURNALED = [
  ['a malformed --expect token', `--expect x --child-of 7 --session ${CHILD_ID}`, 'token-malformed', 'bad token'],
  ['a zero run id', `--expect ${TOK} --child-of 0 --session ${CHILD_ID}`, 'run-id-malformed', 'bad run id'],
  ['a leading-zero run id', `--expect ${TOK} --child-of 07 --session ${CHILD_ID}`, 'run-id-malformed', 'bad run id'],
  // Both malformed: the token is checked first, as it always was. ONE line, never two.
  ['a malformed token AND run id', `--expect x --child-of 0 --session ${CHILD_ID}`, 'token-malformed', 'bad token'],
] as const;

describe('the id-tied pre-lock dies journal ONE refused line, then die exactly as before (spec §5.9)', () => {
  it.each(JOURNALED)('%s', (_what, argv, token, said) => {
    makeChild(h);
    const r = verb(argv);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.stdout, 'a die prints no document').toBe('');
    // The executor recognises the die WHOLE (anchored over all of stderr), so this is the stderr pin
    // that matters: the same die as before, now naming the word ccd journaled for it.
    expect(parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr))
      .toEqual({ kind: 'failed', resume: 'pre-lock-die', detail: said, token });
    expect(childReclaimRows().map(shape)).toEqual([{ outcome: 'refused', id: CHILD_ID, refusal: token, detail: said, tx: '' }]);
    expect(fs.existsSync(lockFile()), 'the lock was never opened').toBe(false);
  }, 60_000);
});

describe('the seven other pre-lock dies stay unjournaled, each for its stated reason (spec §5.9)', () => {
  it('the session id is validated FIRST: a malformed id beside a malformed token and run id dies "bad session id" and journals nothing', () => {
    makeChild(h);
    const r = verb(`--expect x --child-of 0 --session ${BAD_ID}`);
    expect(r.code).toBe(1);
    expect(parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr))
      .toEqual({ kind: 'failed', resume: 'pre-lock-die', detail: 'bad session id', token: null });
    expect(childReclaimRows(), 'an id that failed its own shape check is never journaled against').toEqual([]);
    expect(readJournal(h.home).filter((e) => e['id'] === BAD_ID), 'under no act at all').toEqual([]);
  }, 60_000);

  it('the usage die journals nothing — no id is bound yet', () => {
    makeChild(h);
    const r = verb(`--expect ${TOK} --session ${CHILD_ID}`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-reclaim');
    expect(childReclaimRows()).toEqual([]);
  }, 60_000);

  it('the python3 die journals nothing — the journal encoder is python3', () => {
    makeChild(h);
    const r = verb(`--expect ${TOK} --child-of 7 --session ${CHILD_ID}`, '_json_str() { return 1; };');
    expect(r.code).toBe(1);
    expect(parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr)).toEqual({ kind: 'failed', resume: 'pre-lock-die',
      detail: 'python3 unavailable — cannot quote the reclaim record safely', token: null });
    expect(childReclaimRows()).toEqual([]);
    expect(fs.existsSync(lockFile())).toBe(false);
  }, 60_000);

  it.each([
    ['a blank --actor', "--actor ' '", '--actor must be non-blank'],
    ['an over-long --actor', `--actor ${'x'.repeat(513)}`, '--actor is longer than'],
    ['a blank --reason', "--reason ' '", '--reason must be non-blank'],
    ['an over-long --reason', `--reason ${'x'.repeat(513)}`, '--reason is longer than'],
  ] as const)('%s journals nothing — the four --actor/--reason checks run before any id is bound', (_what, flag, said) => {
    makeChild(h);
    const r = verb(`--expect ${TOK} --child-of 7 --session ${CHILD_ID} ${flag}`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(said);
    expect(childReclaimRows()).toEqual([]);
    expect(fs.existsSync(lockFile())).toBe(false);
  }, 60_000);
});

describe('wave 5’s reader classes each journaled die as a pre-lock FAILURE, never a refusal (spec §5.9)', () => {
  it('each line ccd writes parses to a failure line, is never terminal, and words through LC_REFUSAL_WORD', () => {
    makeChild(h);
    verb(`--expect x --child-of 7 --session ${CHILD_ID}`);
    verb(`--expect ${TOK} --child-of 0 --session ${CHILD_ID}`);
    const rows = childReclaimRows();
    expect(rows.map((e) => e['refusal'])).toEqual(['token-malformed', 'run-id-malformed']);
    for (const e of rows) {
      const j = parseJournalLine(JSON.stringify(e));
      const t = String(j.refusal);
      expect(j.act).toBe('reclaim');
      expect(j.outcome).toBe('refused');
      expect(isChildReclaimPreLockToken(j.refusal), t).toBe(true);
      expect(childReclaimFailureLine(j), t).toBe(true);
      expect(childReclaimTerminalRefusal(
        { sessionId: CHILD_ID, outcome: j.outcome, refusal: j.refusal, at: j.at, failingSince: null },
        childReclaimTokenKind), t).toBe(false);
      expect(lcRefusalWord(t), t).toBe(LC_REFUSAL_WORD[t as LcRefusalToken]);
      expect(lcRefusalWord(t), t).not.toBeNull();
    }
  }, 90_000);

  it('the table keys each new word by its die, beside wave 3’s two', () => {
    expect(CHILD_RECLAIM_PRE_LOCK_TOKEN).toEqual({
      flock: 'flock-unavailable', lock: 'lock-unopenable', token: 'token-malformed', runId: 'run-id-malformed',
    });
  });
});

describe('the two words claim only what is true at their one site', () => {
  it.each(['token-malformed', 'run-id-malformed'] as const)('%s: nothing was removed, and it is a ccrc defect', (t) => {
    expect(LC_REFUSAL_WORD[t]).toMatch(/nothing was removed/);
    expect(LC_REFUSAL_WORD[t]).toMatch(/ccrc bug/);
    expect(LC_REFUSAL_WORD[t]).not.toMatch(/intact/);
  });
});
```

(b) `server/test/ccd-refusal-scan.test.ts`:
- Delete `'die "bad run id"',` from `SANCTIONED`.
- Change `expect(SANCTIONED.length, 'the sanctioned set changed size').toBe(15);` to `.toBe(14);`.
- The docstring above `SANCTIONED` becomes:

```ts
/**
 * THE FOURTEEN DIES A REFUSAL RECORD CANNOT DESCRIBE, each for one stated reason.
 * Four are `cmd_ws_reap`'s pre-lock rungs, which D15 leaves alone: three run
 * before `$id` has been validated at all and the fourth is the `_json_str`
 * probe — the emitter itself is what is missing there, so an emit would be the
 * thing being reported. Two are the `--reason` loop arms, which run before any
 * id is bound. The set is EXACT: a fifteenth sanctioned die reds the count.
 *
 * Six are cmd_ws_reclaim's (child reclamation, wave 3), for reap's own reasons: its usage line runs before $id is bound, its four --actor/--reason checks are the loop arms that run before any id is bound, and its _json_str probe is the emitter being missing. Its "bad session id" is the SAME literal as reap's and needs no second entry; it stays a die because an id that failed its own shape check is no id to journal against (spec §5.9). Its token and run-id checks are NOT here: since wave 6 they run after the session id is validated and journal through `_lc_refuse` (spec §5.9) — "bad token" stays in this set for reap's and ws-expire's own literal.
 *
 * Two are cmd_ws_expire's (workspace lifecycle, wave 3), for the same reasons: its usage line runs before $id is bound, and its _json_str probe is the emitter being missing. Its four --actor/--reason checks are the SAME literals as ws-reclaim's, and its "bad token" and "bad session id" the SAME as reap's, and need no second entry.
 */
```

(If the worker's tree's docstring differs from `77c11245a`'s, keep its other sentences and change only what this text changes.) The count NARROWS by one: `bad run id` was reclaim's alone, while `bad token` stays sanctioned for reap and ws-expire. `holds the reclaim emits at exactly two` does not move, because `_lc_refuse` never spells the refused-emit literal it counts.

(c) `server/test/lifecycle-refusal-word.test.ts`:
- `ALL_TOKENS`' last line, as Task 10 left it, `'pin-failed': true, 'unit-still-active': true, 'branch-unmeasured': true, 'probe-unmeasured': true,` gains a following line `'token-malformed': true, 'run-id-malformed': true,` (18 keys: Task 8's `branch-unmeasured` and Task 10's `probe-unmeasured` both kept).
- `.toBe(16)` becomes `.toBe(18)`.

(d) `server/test/child-reclaim-sweep-policy.test.ts`, in `describe('childReclaimFailureLine — …')`:
- Directly after `['refused', 'lock-unopenable', true],`, add:

```ts
    // Wave 6 (spec §5.9): the two id-tied argv dies, journaled once the session id is valid.
    ['refused', 'token-malformed', true],
    ['refused', 'run-id-malformed', true],
```

- The comment above `['refused', 'bad-session-id', false],` becomes:

```ts
    // A journal-only token outside the pre-lock set is NOT a failure line: a token ccd journals under
    // `reclaim` later is classified when it is added, never inherited. `bad-session-id` in particular is
    // never journaled under `reclaim` (spec §5.9: an id that failed its shape check is no id to journal against).
```

- The `exactly the two lock dies` case becomes:

```ts
  it('the pre-lock tokens are exactly the two lock dies and the two id-tied argv dies, each a word ccd journals', () => {
    // Widened at wave 6 (spec §5.9): `token-malformed` and `run-id-malformed` are journaled `refused` by
    // `_lc_refuse` before the lock, after the session id is validated. The usage, bad-session-id and python3
    // dies journal nothing, so they never enter this set.
    expect(Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN).sort())
      .toEqual(['flock-unavailable', 'lock-unopenable', 'run-id-malformed', 'token-malformed']);
    for (const t of Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)) {
      expect(isLcRefusalToken(t), t).toBe(true);
      expect(isChildReclaimPreLockToken(t), t).toBe(true);
    }
  });
```

(e) `server/test/child-reclaim.test.ts`:
- The `PRE_LOCK_TOKEN` comment and map become:

```ts
    // The failure's own word (spec §5.9): the one a pre-lock die journals as its `refusal`. ccd writes the
    // flock die through `_lc_refuse reclaim … flock-unavailable`, and the lock die likewise. Since wave 6
    // (spec §5.9) the bad-token and bad-run-id dies use `… token-malformed` and `… run-id-malformed`. The
    // usage, bad-session-id and python3 dies journal nothing, so their read carries no word. Each row's
    // word is spelled here, apart from the source.
    const PRE_LOCK_TOKEN: Readonly<Record<string, string | null>> = {
      usage: null, 'bad token': 'token-malformed', 'bad run id': 'run-id-malformed', 'bad session id': null,
      'python3 unavailable': null, 'flock unavailable': 'flock-unavailable',
    };
```

- In `parseChildReclaimResult: each read names its failure word, or none`, `expect(die('bad token')).toMatchObject({ resume: 'pre-lock-die', token: null });` becomes:

```ts
    expect(die('bad token')).toMatchObject({ resume: 'pre-lock-die', token: 'token-malformed' });
    expect(die('bad session id')).toMatchObject({ resume: 'pre-lock-die', token: null });
```

- In the comment `// A token is exactly one of: a ws-reclaim refusal the kind map classes, one of the two pre-lock`, replace `one of the two pre-lock` with `one of the pre-lock`.

(f) `server/test/child-reclaim-status.test.ts`:
- Directly after the `refused lock-unopenable under a fleet pause → paused` row, add:

```ts
  // Wave 6 (spec §5.9): the two id-tied argv dies are pre-lock refusals too.
  { name: 'refused token-malformed → deferred, its journal word, never refused',
    input: base({ event: ev('refused', 'token-malformed') }),
    want: { word: 'deferred', sentence: lcRefusalWord('token-malformed'), at: EV_AT } },
  { name: 'refused run-id-malformed → deferred, its journal word, never refused',
    input: base({ event: ev('refused', 'run-id-malformed') }),
    want: { word: 'deferred', sentence: lcRefusalWord('run-id-malformed'), at: EV_AT } },
```

- Add `'token-malformed', 'run-id-malformed'` to the token list of `reads a failure token’s journal word ahead of the audit sentences`.

- [ ] **Step 2: Run the tests to verify they fail**

Run in the foreground, with a timeout of at least 600000ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-prelock-journal.test.ts test/ccd-refusal-scan.test.ts \
  test/lifecycle-refusal-word.test.ts test/child-reclaim-sweep-policy.test.ts test/child-reclaim.test.ts test/child-reclaim-status.test.ts)
```

Expected: FAIL.
- `ccd-child-reclaim-prelock-journal`:
  - The four `JOURNALED` cases: `expected { kind: 'failed', resume: 'pre-lock-die', detail: 'bad token', token: null } to deeply equal { …, token: 'token-malformed' }`, and the same for `bad run id`.
  - The session-first case: `expected { … detail: 'bad token', token: null } to deeply equal { … detail: 'bad session id', token: null }`, because today the token is checked first.
  - The usage, python3 and four `--actor`/`--reason` cases PASS, before and after. They pin what must not change.
  - The round trip: `expected [] to deeply equal [ 'token-malformed', 'run-id-malformed' ]`.
  - The table case: a `toEqual` diff with `token` and `runId` missing.
  - The words: `TypeError: .toMatch() expects to receive a string, but got undefined`.
- `ccd-refusal-scan`:
  - `leaves no bare die` gives `expected [ 'cmd_ws_reclaim: _child_runid_valid "$childof" || die "bad run id" …' ] to deeply equal []`.
  - The count gives `expected 15 to be 14`.
- `lifecycle-refusal-word`: `expected false to be true` for both new tokens, and the union diff.
- `child-reclaim-sweep-policy`:
  - The two new rows: `expected false to be true`.
  - The exactly case: `expected [ 'flock-unavailable', 'lock-unopenable' ] to deeply equal [ …4 ]`.
- `child-reclaim`: the `bad token` and `bad run id` cases of `%s is resume: "pre-lock-die"…` give `token: null` against `'token-malformed'` and `'run-id-malformed'`, and the `die('bad token')` read fails the same way.
- `child-reclaim-status`: the two rows give `word: 'refused'` with `ccrc declined: token-malformed.` against `word: 'deferred'` with a `null` sentence. The loop gives `expected null not to be null`.

- [ ] **Step 3: Add the two words to L0**

In `shared/api.ts`:
- The union member `| 'probe-unmeasured';       // …` (Task 10) loses its `;` and keeps its comment.
- Directly after it, add exactly TWO lines:

```ts
  | 'token-malformed'         // ws-reclaim (spec §5.9): `--expect` is not 64 lowercase hex — journaled `refused` before the lock, once the session id is valid
  | 'run-id-malformed';       // ws-reclaim (spec §5.9): `--child-of` fails ccd's run-id grammar — journaled `refused` before the lock, once the session id is valid
```

In `LC_REFUSAL_WORD`, directly after the `'probe-unmeasured':` entry and before `};`, add:

```ts
  // Child reclamation, wave 6 (spec §5.9). These are the two argv dies of
  // ws-reclaim that are tied to an id. Each is journaled through `_lc_refuse`
  // before the lock, once the session id is valid. The server composes this
  // argv itself, so either one is a ccrc defect. Wave 5's reader classes both
  // as pre-lock FAILURES (`CHILD_RECLAIM_PRE_LOCK_TOKEN`), so the chip reads
  // `deferred`, never `refused`.
  'token-malformed':
    'ccrc asked for this clean-up with a confirmation token that is not a shape ccd mints, so nothing was looked up and nothing was removed. This is a ccrc bug, not something about this workspace.',
  'run-id-malformed':
    'ccrc named the run this workspace belongs to with a run id that is not a shape ccrc mints, so nothing was looked up and nothing was removed. This is a ccrc bug, not something about this workspace.',
```

In `ChildReclaimAttention`'s docstring, keep the line count, and replace

```
 *    of `failed` lines, plus `refused` lines whose token is one of the two
 *    pre-lock tokens (`flock-unavailable`, `lock-unopenable`): those are
```

with

```
 *    of `failed` lines, plus `refused` lines whose token is a pre-lock token
 *    (`CHILD_RECLAIM_PRE_LOCK_TOKEN`, `server/src/childReclaimSweep.ts`): those are
```

- [ ] **Step 4: Classify them on the server**

`server/src/childReclaimSweep.ts`: the docstring, the constant and `childReclaimFailureLine`'s docstring become:

```ts
/** The `reclaim` refusals ccd journals for a PRE-LOCK die, keyed by the die. Spelled here, once:
 *  `coord/` code reads them by property, never as a quoted literal. `flock` and `lock` date from
 *  wave 3. `token` and `runId` date from wave 6 (spec §5.9): the two argv dies tied to an id,
 *  journaled once the session id is valid. The usage, bad-session-id and python3 dies are never
 *  journaled, so they are never here. */
export const CHILD_RECLAIM_PRE_LOCK_TOKEN = {
  flock: 'flock-unavailable', lock: 'lock-unopenable', token: 'token-malformed', runId: 'run-id-malformed',
} as const satisfies Readonly<Record<'flock' | 'lock' | 'token' | 'runId', LcRefusalToken>>;
```

In `childReclaimFailureLine`'s docstring:
- `or `refused` with one\n *  of the two pre-lock tokens. ccd journals its pre-lock lock dies through `_lc_refuse`` becomes `or `refused` with one\n *  of the pre-lock tokens. ccd journals those pre-lock dies through `_lc_refuse``.
- `ONLY these two, by name` becomes `ONLY these, by name`.
- `neither token is terminal` becomes `no pre-lock token is terminal`.

The predicate's code does not change.

`server/src/coord/childReclaim.ts`: in `CHILD_RECLAIM_PRE_LOCK_DIE_PATTERNS`,

```ts
  { re: /^bad token$/, token: CHILD_RECLAIM_PRE_LOCK_TOKEN.token },
  { re: /^bad run id$/, token: CHILD_RECLAIM_PRE_LOCK_TOKEN.runId },
```

Both comments `one of the two pre-lock tokens` become `one of the pre-lock tokens`, one-for-one. No quoted pre-lock literal is written under `server/src/coord` (R43, `mail-routes.test.ts`'s kebab scanner).

- [ ] **Step 5: Reorder and journal in ccd, then re-stamp**

In `cmd_ws_reclaim`, replace the four lines

```bash
  local token=$2 childof=$4 id=$6
  [[ $token =~ ^[0-9a-f]{64}$ ]]         || die "bad token"
  _child_runid_valid "$childof"          || die "bad run id"   # wave 1's grammar, ASCII under LC_ALL=C
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]]         || die "bad session id"
```

with

```bash
  local token=$2 childof=$4 id=$6
  # THE SESSION ID IS VALIDATED FIRST (spec §5.9). The two checks after it
  # journal their refusal against `$id`, so `$id` must already be a shape ccrc
  # mints. Seven dies stay unjournaled, each for its reason:
  #   - the usage die and the four --actor/--reason checks above, because no
  #     id is bound yet;
  #   - a malformed session id, because it is no id to journal against;
  #   - the python3 probe below, which cannot journal at all, because the
  #     journal's encoder (`_lc_json`) is python3.
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]]         || die "bad session id"
  [[ $token =~ ^[0-9a-f]{64}$ ]]         || _lc_refuse reclaim "$id" token-malformed "bad token"
  _child_runid_valid "$childof"          || _lc_refuse reclaim "$id" run-id-malformed "bad run id"   # wave 1's grammar, ASCII under LC_ALL=C
```

The comment must contain no `die` followed by a double quote. `ccd-refusal-scan`'s bare-die scan and `child-reclaim.test.ts`'s `dieMessage` both read comment text. `_lc_refuse` keeps the flock and lock siblings' shape: no `verb`, empty `tx`. Its message argument is the old die text byte for byte, so the stderr line and the executor's anchored patterns are unchanged. Every edit here is below the frozen boundary (RECLAIM region).

```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
```

Expected: exit 0, exit 0, PASS.

- [ ] **Step 6: Run to pass, then pay the citation tax**

Run in the foreground, with a timeout of at least 600000ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-prelock-journal.test.ts test/ccd-refusal-scan.test.ts \
  test/lifecycle-refusal-word.test.ts test/child-reclaim-sweep-policy.test.ts test/child-reclaim.test.ts test/child-reclaim-status.test.ts \
  test/ccd-child-reclaim-verb.test.ts test/child-reclaim-sweep.test.ts test/child-reclaim-runs-route.test.ts \
  test/ccd-child-reclaim-unmeasured-journal.test.ts test/mail-routes.test.ts test/single-definition.test.ts \
  test/wsaudit.test.ts test/ccd-wsaudit-nonpoison.test.ts test/ccd-die-containment.test.ts test/ownership.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit -p .)
(cd pwa && ./node_modules/.bin/tsc --noEmit)
```

Expected: PASS everywhere, and `tsc` prints nothing.
- `ccd-child-reclaim-verb`'s `dies on a malformed argv BEFORE the lock, touching nothing` stays green unedited: same stderr, lock never opened.
- `child-reclaim`'s `an EXTENDED %s die … is NOT recognised` cases stay green, because the patterns keep their `$` anchors.
- `ccd-refusal-scan`'s vocabulary scan now finds both new words at `_lc_refuse`'s token position.

Then repeat Task 10 Step 6 (a), (b) and (c) verbatim. The expectations change:
- README's union anchor is still unchanged: the two new members land below `purge-mechanism-absent`.
- Each map number is README's plus TWO.
- `README.md | 4 ++--`.
- A census re-measure, if one is needed, says `Task 11` and names `token-malformed` and `run-id-malformed`.

- [ ] **Step 7: Mutation check**

Make each edit, run the command, see the red, then restore. Re-stamp after every `ccd/ccd` edit and again after its restore.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | Move `[[ $id =~ ^[A-Za-z0-9._-]+$ ]]         \|\| die "bad session id"` back BELOW the `_child_runid_valid` line | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-prelock-journal.test.ts` | The session-first case: `expected { kind: 'failed', resume: 'pre-lock-die', detail: 'bad token', token: 'token-malformed' } to deeply equal { … detail: 'bad session id', token: null }`. Its row assertion would show a line with `id: '../x'`. |
| 2 | Replace `_lc_refuse reclaim "$id" token-malformed "bad token"` with `die "bad token"` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-prelock-journal.test.ts test/ccd-refusal-scan.test.ts` | The `JOURNALED` token cases: `token: null` against `'token-malformed'`. `ccd-refusal-scan`: `declared journal-only tokens with no literal ccd call-site argument: expected [ 'token-malformed' ] to deeply equal []`. |
| 3 | Replace `"bad run id"` in the `_lc_refuse` call with `"bad run id (ten digits)"` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-prelock-journal.test.ts test/child-reclaim.test.ts` | The run-id cases: `resume: 'resumable'` against `'pre-lock-die'`. `child-reclaim`'s `bad run id is resume: "pre-lock-die"…` fails the same way. A reworded die cannot drift past the executor. |
| 4 | Journal the session-id die: `\|\| _lc_refuse reclaim "$id" bad-session-id "bad session id"` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-prelock-journal.test.ts` | The session-first case: `an id that failed its own shape check is never journaled against: expected [ { act: 'reclaim', … id: '../x' … } ] to deeply equal []` |
| 5 | In `CHILD_RECLAIM_PRE_LOCK_TOKEN`, delete `runId: 'run-id-malformed'`, and set the `^bad run id$` row's `token` back to `null` | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts test/ccd-child-reclaim-prelock-journal.test.ts test/child-reclaim-status.test.ts` | The policy exactly case: a 3-element array against 4. The `refused run-id-malformed` row: `expected false to be true`. The round trip: `run-id-malformed: expected false to be true`. The status row: `word: 'refused'` against `'deferred'`. |
| 6 | Set the `^bad token$` row to `token: null`, keeping the table | `cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts test/ccd-child-reclaim-prelock-journal.test.ts` | `bad token is resume: "pre-lock-die"…`: `token: null` against `'token-malformed'`. The `JOURNALED` token cases fail the same way. |
| 7 | Restore `'die "bad run id"',` to `SANCTIONED` and the count to 15 | `cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts` | `a sanctioned die that no longer exists: expected [ 'die "bad run id"' ] to deeply equal []` |
| 8 | Delete `'run-id-malformed'` from the union and the map | `cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts test/lifecycle-refusal-word.test.ts && ./node_modules/.bin/tsc --noEmit -p .` | `tokens no vocabulary owns: expected [ 'run-id-malformed' ] to deeply equal []`. `tsc` fails on `CHILD_RECLAIM_PRE_LOCK_TOKEN`'s `satisfies`. |

Restore all of them, re-stamp, and re-run Step 6's commands (green).

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd shared/api.ts server/src/childReclaimSweep.ts server/src/coord/childReclaim.ts README.md \
  server/test/ccd-child-reclaim-prelock-journal.test.ts server/test/ccd-refusal-scan.test.ts \
  server/test/lifecycle-refusal-word.test.ts server/test/child-reclaim-sweep-policy.test.ts \
  server/test/child-reclaim.test.ts server/test/child-reclaim-status.test.ts
git add server/test/session-hook.test.ts   # only if Step 6 re-measured it
git commit -m "$(cat <<'MSG'
feat(reclaim): journal the id-tied pre-lock dies, classed as pre-lock failures

ws-reclaim now validates the session id first. A malformed --expect token
or --child-of run id then journals one refused line through _lc_refuse
(token-malformed, run-id-malformed) before the same die, so the stderr line
and the exit code are unchanged. Wave 5's reader classes both words in
CHILD_RECLAIM_PRE_LOCK_TOKEN and in the die patterns, so the chip reads
them as pre-lock failures, deferred, never as refusals.

Seven dies stay unjournaled, each for its stated reason: the usage die
and the four --actor/--reason checks run before any id is bound, a bad
session id is no trustworthy id, and the journal's encoder is python3. The
sanctioned-die set loses "bad run id" (fifteen to fourteen), and the
pre-lock pins widen from two tokens to four. README's three shared/api.ts
map anchors are re-pointed by content.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

Task 13 carries the prose. That is R43's "Exactly these two tokens, by name", which now has four, and spec §5.9's pre-lock sentence.


### Task 12: the vanish re-read's second trigger: the newest reclaim end on the coord frame (R55)

**Model routing:** `sonnet`, effort `high`. This is server and PWA work with no destructive subject. The cost is in the wire rules (additive only, one reader per field) and in the PWA effect's once-per-change contract, which the board tests pin.

**This branch already carries wave 5.** Wave 6 is dispatched only after #290 (wave 5, with its fix round 1) has merged, so the worker branched from a `main` that contains it, and every file this task edits on the server and PWA side already holds #290's hunk. There is no merge step in this task. Read every server, shared and PWA anchor on this worktree's own tree. Each one carries a grep anchor, and every line number below (cited at `77c11245a` or at wave 5's pre-merge tip `e79b1da7`) is a hint only. Entry check, from the worktree root. Each line must print the stated count:

```bash
grep -c "currentChildMarks(): ReadonlyMap<string, ChildMark> | null" server/src/watch.ts        # 1
grep -c "this.childMarks = new Map(records.map" server/src/watch.ts                             # 1
grep -c "export function childReclaimRefreshDue" pwa/src/fleet/runWords.ts                      # 1
grep -c "export function childReclaimAttentionOf" pwa/src/fleet/childReclaimWords.ts            # 1
grep -c "childReclaimDoneAt" shared/api.ts server/src/watch.ts pwa/src/fleet/childReclaimWords.ts  # 0 for each file
```

If one of the first four prints 0, this branch does not carry wave 5, which wave 6's dispatch condition promised. Stop and report it in the wave-done mail. Do not merge or rebase to repair it. If the last one prints a non-zero count, someone already landed this field: stop and report.

**Why:** the residual `vanish-reread-races-mirror`, which R55 rules on.

**The race.** ccd's reclaim tail purges the child's registry row first and journals `done` only after that, with a python3 tombstone read in between. Anchors at `77c11245a`:
- The purge is at `ccd/ccd:28418` (its first line is `:28415`); `grep -n "_reg_purge" ccd/ccd` and take the hit inside `_ws_reclaim_tail`.
- The `done` line, `_lc_done "$_WS_RCL_ACT"`, is at `ccd/ccd:28439`. For a reclaim the act is `reclaim`; ws-expire shares the tail with act `expire`, which this task does not count.

The tick reads the listing first; that is where wave 5 sets `childMarks` (`grep -n "this.childMarks = new Map(records.map" server/src/watch.ts`; `watch.ts:1725` at `e79b1da7`). The journal mirror (`sweepLifecycle`, `grep -n "async sweepLifecycle(" server/src/watch.ts`; `watch.ts:3655` at `77c11245a`) runs on its own 5 s clock (`LC_SWEEP_MS`) and is void-dispatched, never awaited.

So wave 5's board re-read on the vanish (`childReclaimRefreshDue`, `pwa/src/fleet/runWords.ts:709` at `e79b1da7`) usually reaches `GET /api/runs` before the mirror holds the `done`. The row is absent and the latest event is `intent`, so `childReclaimStatus` answers `null` (`grep -n "export function childReclaimStatus" server/src/coord/childReclaim.ts`; `:1533` at `e79b1da7`). The chip then stays blank until the next board load.

**R55's fix, and nothing more:**
1. The mirror keeps the newest `at` of a `reclaim`/`done` row it has committed. The value is in memory and only ever rises.
2. The watcher exposes that value, and the `coord` frame carries it as ONE new optional field, `CoordStatus.childReclaimDoneAt`.
3. The PWA reads the field through ONE reader, `childReclaimDoneAtOf`.
4. The board re-reads the archive when that value CHANGES (not "increases") to a non-null value, and only if some finished row is still unsettled. Unsettled means its chip is `pending`, `deferred` or `paused`, or it has no chip and its run had a child. It re-reads once per change and never on a timer.
5. When a child-marked id leaves the listing, the watcher sets `lastLifecycleSweep = 0`. That is an assignment, not an await, so the mirror sweeps on that same tick.

**What this task leaves alone:**
- The tick keeps its order and gains no await.
- ccd's journal is unchanged.
- No route changes, so the auth gate census and `box-token-census.test.ts` are untouched.
- `FLEET_PROTO` is not bumped.
- `reviveFleetSession` is not involved: the coord frame is never persisted or revived, and the PWA store holds it in memory only.

**Design choices this task pins:**
- **Committed, not merely parsed.** The value is raised AFTER `CoordStore.ingestJournal` returns. A frame must never name a row that `GET /api/runs` cannot yet read.
- **The value is omitted, never `null`, while the mirror has committed no reclaim `done`.** Absence then has one meaning to the reader: "nothing measured", whether the server restarted or is older than this field. The reader handles both cases identically. Omitting the field also keeps every whole-frame coord `toEqual` pin in `server/test/fleetws.test.ts` unchanged (ten at `77c11245a` and at `e79b1da7`, measured: `grep -c "childReclaimAttention: \[\] }" server/test/fleetws.test.ts`), because a key whose value is `undefined` is equal under `toEqual` and is dropped by `JSON.stringify`.
- **Which runs had a child.** By the time the value changes, the child has left the fleet frame and its row may carry no chip. So the board remembers, for as long as it is mounted, every run id that either:
  - a fleet frame's `ChildMark` named, through `childMarkOf`; or
  - a finished row ever carried a non-null chip for, through `childReclaimChip`.
  The pure accumulator is `childRunsSeen`.
- **A disclosed residual (vanish.OPEN1, ruled accepted).** Suppose a board mounts after the child has left the fleet frame, and its first cold read lands inside the race. That board never learns the run had a child, so the row keeps a null chip until the next board load. This task does not close that gap. Task 13 lists it among the carried residuals, and the PR body states it.
- **The first value a board sees is its baseline, not a change.** This is wave 5's `prev !== null` idiom.
- **Only a `child` mark resets the clock.** A row with `none` or `unreadable` leaving the listing does not; R55 says "child-marked".

**Files:**
- Modify: `server/src/coord/mirrorplan.ts`.
  - Add `childReclaimDoneHighWater` after `shouldSweep` (`grep -n "export function shouldSweep" server/src/coord/mirrorplan.ts`; `:227` at `77c11245a`).
  - Widen the type import at `:182` (`grep -n "import type { LifecycleHealthState }" server/src/coord/mirrorplan.ts`) to `LifecycleAct, LifecycleHealthState, LifecycleOutcome`.
- Modify: `server/src/coord/mirror.ts`.
  - Add the field and the accessor `childReclaimDoneAt()`.
  - Raise the value in `commit` (`grep -n "private commit(gen: string" server/src/coord/mirror.ts`; `:160` at `77c11245a`).
  - Add `childReclaimDoneHighWater` to the `./mirrorplan.js` import on line 7.
- Modify: `server/src/coord/childReclaim.ts`. Add `childMarkLeftListing` directly after `childReclaimStatus`, before `childReclaimSessions` (`grep -n "^export function childReclaimSessions" server/src/coord/childReclaim.ts`).
- Modify: `server/src/watch.ts`.
  - `tick()`: the `childMarks` assignment.
  - `emitCoord` (`grep -n "private emitCoord(" server/src/watch.ts`; `:2048` at `77c11245a`, `:2114` at `e79b1da7`).
  - A new accessor `currentChildReclaimDoneAt()` directly after `currentChildMarks()`.
  - `childMarkLeftListing` added to the `./coord/childReclaim.js` import (`grep -n "from './coord/childReclaim.js'" server/src/watch.ts`).
- Modify: `shared/api.ts`. One optional field on `CoordStatus` (`grep -n "^export interface CoordStatus" shared/api.ts`; `:3813` at `77c11245a`, `:3869` at `e79b1da7`), and a docstring sentence.
- Modify: `pwa/src/fleet/childReclaimWords.ts`. Add `childReclaimDoneAtOf` after `childReclaimAttentionOf` (`:106` at `e79b1da7`), and extend the header.
- Modify: `pwa/src/fleet/runWords.ts`.
  - Add `childReclaimDoneRefreshDue` directly after `childReclaimRefreshDue`.
  - Add `childRunsSeen` directly after `childMarkOf` (`grep -n "^export const childMarkOf" pwa/src/fleet/runWords.ts`; `:738` at `e79b1da7`).
- Modify: `pwa/src/screens/RunsScreen.tsx`.
  - Add two store selectors beside `const conn = store((s) => s.conn);`.
  - Add two effects directly after wave 5's fleet-vanish effect (`grep -n "prevSessionIdsRef" pwa/src/screens/RunsScreen.tsx`; it closes on `}, [sessions, fleetFrameSeen]);`).
  - Add the imports.
- Test (new, R56): `server/test/child-reclaim-done-at.test.ts`
- Test (new, R56): `pwa/test/child-reclaim-done-reread.test.tsx`
- Modify: `README.md`, its `shared/api.ts:` union anchor and its three `LC_REFUSAL_WORD` map anchors, re-pointed by content (Step 5b). `CoordStatus` sits above `LcRefusalToken`, so this task's insertion moves all four, where Tasks 10 and 11 moved only the map.
- Modify, only if Step 5b measures it red: `server/test/session-hook.test.ts`, the `'shared/api.ts'` entry of the CITATION DEBT `byFile` census.

No `ccd/ccd` edit, so this task has no re-stamp.

**Interfaces:**
- Produces:
  ```ts
  // server/src/coord/mirrorplan.ts (pure)
  export function childReclaimDoneHighWater(
    prev: number | null,
    rows: readonly { readonly act: LifecycleAct; readonly outcome: LifecycleOutcome; readonly at: number | null }[],
  ): number | null;
  // server/src/coord/mirror.ts
  JournalMirror.childReclaimDoneAt(): number | null;
  // server/src/coord/childReclaim.ts (pure)
  export function childMarkLeftListing(
    prev: ReadonlyMap<string, ChildMark> | null, next: ReadonlyMap<string, ChildMark>,
  ): boolean;
  // server/src/watch.ts
  FleetWatcher.currentChildReclaimDoneAt(): number | null;
  // shared/api.ts — ADDITIVE, absence-permits, omitted (never null) while unmeasured
  interface CoordStatus { /* …existing… */ childReclaimDoneAt?: number }
  // pwa/src/fleet/childReclaimWords.ts — THE ONE READER of CoordStatus.childReclaimDoneAt
  export function childReclaimDoneAtOf(coord: unknown): number | null;
  // pwa/src/fleet/runWords.ts (pure)
  export function childRunsSeen(
    seen: ReadonlySet<number>, sessions: readonly { child?: ChildMark }[], runs: readonly RunSummary[],
  ): ReadonlySet<number>;
  export function childReclaimDoneRefreshDue(
    runs: readonly RunSummary[], hadChild: ReadonlySet<number>, before: number | null, after: number | null,
  ): boolean;
  ```
  Task 13 documents the field: its name, that it is omitted while unmeasured, that it is only-rising in memory and null after a restart, and its one reader. Task 13 also carries vanish.OPEN1's residual (see the design choices above) in its carried-residuals list, and the PR body states it.
- Consumes:
  - from `main`: `CoordStore.ingestJournal` (unchanged), `JournalMirror.commit`, `FleetWatcher.lastLifecycleSweep`, `LC_SWEEP_MS`, `emitCoord`, `ChildMark`, `isRunClosed`;
  - from wave 5 (#290): `FleetWatcher.childMarks`, `childReclaimChip`, `childMarkOf`, `CHILD_RECLAIM_UNSETTLED`, and `childReclaimRefreshDue`, which stays untouched.

- [ ] **Step 1: Write the failing tests**

Create `server/test/child-reclaim-done-at.test.ts`:

```ts
// Child-reclamation wave 6, Task 12 (spec §5.9): the vanish re-read's SECOND
// trigger.
//
// ccd purges a reclaimed child's registry row and only then journals the
// reclaim's `done`, and the journal mirror ingests on its own clock, never
// awaited by the tick. So wave 5's board re-read on the vanish usually runs
// while the mirror still holds only `intent`, and the chip reads null. What
// this file pins:
//   • the mirror keeps the newest `at` of a reclaim `done` it has COMMITTED,
//     in memory, only ever rising;
//   • the coord frame carries it as the optional `childReclaimDoneAt`, omitted
//     while nothing is measured, on both of the frame's arms;
//   • a child-marked id leaving the listing resets the mirror's clock (an
//     assignment, never an await), so the fact is usually measured on that
//     same tick;
//   • the PWA has ONE reader of the field.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bus } from '../src/bus.js';
import { FleetWatcher, LC_SWEEP_MS } from '../src/watch.js';
import { localIO, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { JournalMirror } from '../src/coord/mirror.js';
import { LC_CAP_TOKEN, childReclaimDoneHighWater } from '../src/coord/mirrorplan.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { childMarkLeftListing } from '../src/coord/childReclaim.js';
import { genFile } from './lifecycleHelpers.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { codeOnly } from './sourceScan.js';
import { LC_DIR_NAME, type ChildMark, type CoordStatus } from '../../shared/api.js';

const G1 = '1758500000000000000';
const T = 1_758_500_000_000;
const NOW = 1_785_300_000_000;
const A = 'demo-quiet-mesa';
const B = 'demo-clear-cove';

// `lifecycle-sweep.test.ts`'s idiom: only `Date` is faked, so `fs` and the
// microtask queue behave, and the mirror's clock gate reads the faked clock.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };

let seq = 0;
const ev = (id: string, act: string, outcome: string, at: number | null): Record<string, unknown> =>
  ({ uid: `w6d.1.${++seq}`, ...(at === null ? {} : { at }), act, outcome, id });
const appendTo = (dir: string) => (...rows: Record<string, unknown>[]): void =>
  fs.appendFileSync(path.join(dir, genFile(G1)), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));

/** A bare mirror over a fixture registry, every path under the fixture HOME. */
const mirrorRig = () => {
  const home = mkTmp('ccrc-cr-doneat-');
  const registryDir = path.join(home, '.cc-sessions');
  const dir = path.join(registryDir, LC_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const store = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const m = new JournalMirror({ io: { ...localIO }, registryDir, store,
    ccdVerbs: () => [LC_CAP_TOKEN], now: () => Date.now(), staleAfterMs: LC_SWEEP_MS * 3 });
  return { m, store, append: appendTo(dir) };
};

/** A full registry row, `child-reclaim-watch-view.test.ts`'s `seed`, written
 *  into the fixture registry. */
const seed = (reg: string, id: string, over: Record<string, string> = {}): void => {
  const slug = id.replace(/^demo-/, '');
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: slug, branch: `ws/${slug}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) fs.writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const unseed = (reg: string, id: string): void => {
  for (const f of fs.readdirSync(reg)) if (f.startsWith(`${id}.`)) fs.rmSync(path.join(reg, f));
};

/** A watcher with a coordination database and a lifecycle-capable ccd, every
 *  path under the fixture HOME; `testDeps`' runner is the guarded stub, so no
 *  ccd and no tmux runs. Captures every `coord` frame the bus carries. */
const tickRig = () => {
  const home = mkTmp('ccrc-cr-doneat-tick-');
  const deps = testDeps(home);
  const io: FleetIO = { ...localIO };
  const registryDir = deps.cfg.registryDir;
  const dir = path.join(registryDir, LC_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  const frames: CoordStatus[] = [];
  bus.on('coord', (c: CoordStatus) => { frames.push(c); });
  const w = new FleetWatcher(
    { ...deps, io, coord,
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-rm', LC_CAP_TOKEN] } } as never,
    bus,
  );
  return { w, io, registryDir, frames, append: appendTo(dir) };
};

const rowsOf = (...o: Record<string, unknown>[]) => o.map((x) => parseJournalLine(JSON.stringify(x)));

describe('childReclaimDoneHighWater — the mirror’s one decision (pure)', () => {
  it('takes the newest at of a reclaim done row, and of nothing else', () => {
    expect(childReclaimDoneHighWater(null, rowsOf(
      ev(A, 'reclaim', 'done', T + 4), ev(B, 'reclaim', 'done', T + 2),
      ev(A, 'reclaim', 'refused', T + 9), ev(A, 'reclaim', 'failed', T + 8),
      ev(A, 'reclaim', 'intent', T + 12), ev(B, 'reap', 'done', T + 11),
      ev(B, 'create', 'done', T + 13), ev(B, 'reclaim', 'done', null),
    ))).toBe(T + 4);
  });

  it('answers null for none, and never falls below what it was handed', () => {
    expect(childReclaimDoneHighWater(null, [])).toBeNull();
    expect(childReclaimDoneHighWater(null, rowsOf(ev(A, 'reap', 'done', T)))).toBeNull();
    expect(childReclaimDoneHighWater(T + 50, rowsOf(ev(A, 'reclaim', 'done', T + 4)))).toBe(T + 50);
    expect(childReclaimDoneHighWater(T + 50, rowsOf(ev(A, 'reclaim', 'done', T + 60)))).toBe(T + 60);
  });
});

describe('JournalMirror.childReclaimDoneAt (wave 6)', () => {
  it('is null before any sweep, and after a sweep that committed no reclaim done', async () => {
    const r = mirrorRig();
    expect(r.m.childReclaimDoneAt()).toBeNull();
    r.append(ev(A, 'reclaim', 'intent', T), ev(A, 'reclaim', 'refused', T + 1));
    await r.m.sweep();
    expect(r.store.lifecycleFor({ limit: 10 }), 'the fixture did not ingest').toHaveLength(2);
    expect(r.m.childReclaimDoneAt()).toBeNull();
  });

  it('records the newest committed reclaim done, and only ever rises', async () => {
    const r = mirrorRig();
    r.append(ev(A, 'reclaim', 'done', T + 4), ev(B, 'reclaim', 'done', T + 2));
    await r.m.sweep();
    expect(r.m.childReclaimDoneAt()).toBe(T + 4);
    r.append(ev(B, 'reclaim', 'done', T + 1));       // a late line, older than the one held
    await r.m.sweep();
    expect(r.m.childReclaimDoneAt(), 'the value fell').toBe(T + 4);
    r.append(ev(B, 'reclaim', 'done', T + 20));
    await r.m.sweep();
    expect(r.m.childReclaimDoneAt()).toBe(T + 20);
  });

  it('raises nothing when the ingest fails: the frame may only name a row GET /api/runs can read', async () => {
    const r = mirrorRig();
    r.append(ev(A, 'reclaim', 'done', T + 4));
    vi.spyOn(r.store, 'ingestJournal').mockImplementationOnce(() => { throw new Error('disk full'); });
    await r.m.sweep();                                // never throws: sweep() swallows
    expect(r.m.childReclaimDoneAt(), 'raised before the row was committed').toBeNull();
    await r.m.sweep();                                // the cursor did not move, so the row comes again
    expect(r.m.childReclaimDoneAt()).toBe(T + 4);
  });
});

describe('the coord frame carries childReclaimDoneAt (wave 6)', () => {
  it('omits the field while the mirror has committed no reclaim done — absence, never a made-up value', async () => {
    const r = tickRig();
    await r.w.tick();
    expect(r.w.currentCoord()).not.toBeNull();
    expect(r.w.currentCoord()).not.toHaveProperty('childReclaimDoneAt');
  });

  it('carries the value, and re-emits the frame only when it changes', async () => {
    const r = tickRig();
    r.append(ev(A, 'reclaim', 'done', T + 4));
    await r.w.sweepLifecycle();                       // the FIRST sweep always runs
    await r.w.tick();                                 // its own sweep is gated: Date is frozen
    expect(r.w.currentCoord()?.childReclaimDoneAt).toBe(T + 4);
    const n = r.frames.length;
    await r.w.tick();
    expect(r.frames.length, 'an unchanged value re-emitted the frame').toBe(n);
    r.append(ev(B, 'reclaim', 'done', T + 9));
    advance(LC_SWEEP_MS + 1);
    await r.w.sweepLifecycle();
    await r.w.tick();
    expect(r.frames.length).toBe(n + 1);
    expect(r.frames.at(-1)?.childReclaimDoneAt).toBe(T + 9);
  });

  it('carries it on the unmeasurable arm too: the value is the mirror’s, not the listing’s', async () => {
    const r = tickRig();
    r.append(ev(A, 'reclaim', 'done', T + 4));
    await r.w.sweepLifecycle();
    r.io.readdir = async () => null;                  // the registry no longer lists
    await r.w.tick();
    expect(r.w.currentCoord()).toMatchObject({ pause: 'unmeasurable', childReclaimDoneAt: T + 4 });
  });
});

describe('a child leaving the listing resets the mirror clock (wave 6)', () => {
  it('childMarkLeftListing: only a child-marked id that is gone, and never on the first listing', () => {
    const child: ChildMark = { kind: 'child', runId: 41 };
    const m = (...e: [string, ChildMark][]) => new Map<string, ChildMark>(e);
    expect(childMarkLeftListing(null, m())).toBe(false);
    expect(childMarkLeftListing(m([A, child]), m())).toBe(true);
    expect(childMarkLeftListing(m([A, child]), m([A, child]))).toBe(false);
    expect(childMarkLeftListing(m([A, child]), m([B, child]))).toBe(true);
    expect(childMarkLeftListing(m([A, { kind: 'none' }]), m())).toBe(false);
    expect(childMarkLeftListing(m([A, { kind: 'unreadable' }]), m())).toBe(false);
  });

  it('sweeps on the tick that sees a child vanish, and not on one that sees a plain row vanish', async () => {
    const r = tickRig();
    seed(r.registryDir, A, { child: '41' });
    seed(r.registryDir, B);
    // `sweepLifecycle` calls `sweep()` synchronously, before its first await,
    // so after an awaited tick the count is exact even though the tick never
    // awaits the sweep itself.
    const sweeps = vi.spyOn(JournalMirror.prototype, 'sweep');
    await r.w.tick();
    expect(sweeps, 'the first tick sweeps: the clock starts at 0').toHaveBeenCalledTimes(1);
    advance(2_000);
    unseed(r.registryDir, B);                         // a plain row leaves
    await r.w.tick();
    expect(sweeps, 'a plain row reset the clock').toHaveBeenCalledTimes(1);
    advance(2_000);                                   // still inside LC_SWEEP_MS
    unseed(r.registryDir, A);                         // the child leaves
    await r.w.tick();
    expect(sweeps).toHaveBeenCalledTimes(2);
    advance(1_000);
    await r.w.tick();
    expect(sweeps, 'the reset sweep did not re-arm the clock').toHaveBeenCalledTimes(2);
  });

  it('resets nothing across an unlistable tick, and resets once the next listing proves the child gone', async () => {
    const r = tickRig();
    seed(r.registryDir, A, { child: '41' });
    const sweeps = vi.spyOn(JournalMirror.prototype, 'sweep');
    await r.w.tick();
    const readdir = r.io.readdir;
    r.io.readdir = async () => null;                  // the whole-fleet listing fails
    unseed(r.registryDir, A);
    advance(1_000);
    await r.w.tick();
    expect(sweeps, 'an unlistable tick reset the clock').toHaveBeenCalledTimes(1);
    r.io.readdir = readdir;
    advance(1_000);
    await r.w.tick();
    expect(sweeps).toHaveBeenCalledTimes(2);
  });
});

describe('the PWA has ONE reader of CoordStatus.childReclaimDoneAt', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pwaSources = (dir = path.join(root, 'pwa', 'src')): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return pwaSources(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });

  // Code-only counts (`codeOnly`): a sentence ABOUT the field is not a read.
  // childReclaimWords.ts holds two: the cast's key and the property read.
  it('childReclaimDoneAtOf, in childReclaimWords.ts', () => {
    const reads = Object.fromEntries(pwaSources()
      .map((f) => [path.relative(root, f),
        (codeOnly(fs.readFileSync(f, 'utf8')).match(/\bchildReclaimDoneAt\b/g) ?? []).length] as const)
      .filter(([, n]) => n > 0));
    expect(reads).toEqual({ 'pwa/src/fleet/childReclaimWords.ts': 2 });
  });
});
```

Create `pwa/test/child-reclaim-done-reread.test.tsx`. Copy the four fixtures `r`, `sess`, `makeStore` and `NO_CAPS` VERBATIM from `pwa/test/runs-screen.test.tsx` as it stands on this branch, which already carries wave 5 (`grep -n "^const r = \|^const sess = \|^const makeStore\|^const NO_CAPS" pwa/test/runs-screen.test.tsx`). The text below is how they stood at `e79b1da7`. If `pwa`'s `tsc` reports a missing `RunSummary` or `FleetSession` field, re-copy the current text rather than patching this one. `pwa`'s tsconfig includes `test`, so the file is type-checked.

```tsx
// Child-reclamation wave 6, Task 12 (spec §5.9): the board's second trigger.
// Wave 5 re-reads the archive when a finished child's session leaves the fleet
// frame, but ccd journals the reclaim's end after the purge, so that read
// usually races the server's journal mirror and the row reads no chip. The
// coord frame now carries the newest reclaim end the mirror has committed;
// the board re-reads once per CHANGE of it, never on null, never on a timer,
// and only while some finished row is still unsettled.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ChildReclaimStatus, CoordCapsView, CoordStatus, FleetSession, RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { childReclaimDoneRefreshDue, childRunsSeen } from '../src/fleet/runWords';
import { childReclaimDoneAtOf } from '../src/fleet/childReclaimWords';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// ── fixtures copied verbatim from runs-screen.test.tsx ──
const r = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'build4-transcript-surface', programTitle: 'Build 4: transcript surface',
  wave: 3, waveOf: 4, project: 'ccrc-pwa', homeProject: null,
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', kind: 'work', reviews: null,
  claimedBy: 'ccrc-pwa-coordinator', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'ccrc-pwa-clear-cove', wrapper: 'claude', home: 'claude', project: 'ccrc-pwa',
  workdir: '/w', workspace: 'clear-cove', name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/clear-cove', ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null,
  bucket: 'working', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null, started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null, ...over,
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});
// ── end of copied fixtures ──

const T = 1_758_500_000_000;
const coordWith = (doneAt?: number, over: Partial<CoordStatus> = {}): CoordStatus => ({
  pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [],
  ...(doneAt === undefined ? {} : { childReclaimDoneAt: doneAt }), ...over,
});
const finished = (id: number, word: ChildReclaimStatus['word'] | null): RunSummary =>
  r({ id, state: 'done', closedAt: Date.now() - 60_000,
      childReclaim: word === null ? null : { word, sentence: null, at: null } });

/** One board whose cold read answers `rows`. The coord frame is already seen at
 *  `doneAt`, unless `coordSeen` is false. */
const board = async (rows: RunSummary[],
  opts: { doneAt?: number; sessions?: FleetSession[]; coordSeen?: boolean } = {}) => {
  const store = makeStore();
  act(() => { store.setState({ runs: [], runsFrameSeen: true, sessions: opts.sessions ?? [], fleetFrameSeen: true,
    coord: opts.coordSeen === false ? null : coordWith(opts.doneAt), coordFrameSeen: opts.coordSeen !== false }); });
  const loadRuns = vi.fn(async (): Promise<{ runs: RunSummary[] }> => ({ runs: rows }));
  render(<RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} />);
  await screen.findByRole('group', { name: /finished/i });
  expect(loadRuns).toHaveBeenCalledTimes(1);
  return { store, loadRuns };
};
const frame = (store: FleetStore, c: CoordStatus): void => {
  act(() => { store.setState({ coord: c, coordFrameSeen: true }); });
};
/** Long enough for a fired read to have been issued. */
const settle = async (): Promise<void> => { await act(async () => { await new Promise((res) => setTimeout(res, 60)); }); };

describe('childReclaimDoneAtOf — the one reader, absence permits', () => {
  it('reads a finite number, and null for everything else, an older server’s frame included', () => {
    expect(childReclaimDoneAtOf({ pause: 'clear', mail: 'clear' })).toBeNull();   // predates the field
    expect(childReclaimDoneAtOf(null)).toBeNull();
    expect(childReclaimDoneAtOf({ childReclaimDoneAt: null })).toBeNull();
    expect(childReclaimDoneAtOf({ childReclaimDoneAt: '1758500000000' })).toBeNull();
    expect(childReclaimDoneAtOf({ childReclaimDoneAt: Number.NaN })).toBeNull();
    expect(childReclaimDoneAtOf(coordWith(T))).toBe(T);
  });
});

describe('childReclaimDoneRefreshDue — once per change, never a poll', () => {
  const none = new Set<number>();
  it('is due on a change while a finished row reads pending, deferred or paused', () => {
    for (const word of ['pending', 'deferred', 'paused'] as const) {
      expect(childReclaimDoneRefreshDue([finished(7, word)], none, T, T + 1), word).toBe(true);
    }
  });

  it('is due on ANY change: down as well as up, and from null; never only on an increase', () => {
    expect(childReclaimDoneRefreshDue([finished(7, 'pending')], none, T + 10, T + 5)).toBe(true);
    expect(childReclaimDoneRefreshDue([finished(7, 'pending')], none, null, T)).toBe(true);
  });

  it('is not due on null, or when nothing changed', () => {
    expect(childReclaimDoneRefreshDue([finished(7, 'pending')], none, T, null)).toBe(false);
    expect(childReclaimDoneRefreshDue([finished(7, 'pending')], none, T, T)).toBe(false);
  });

  it('reads a row with no chip as unsettled only when its run had a child', () => {
    expect(childReclaimDoneRefreshDue([finished(7, null)], none, T, T + 1)).toBe(false);
    expect(childReclaimDoneRefreshDue([finished(7, null)], new Set([7]), T, T + 1)).toBe(true);
  });

  it('is not due when every finished row is settled, nor for an open row', () => {
    expect(childReclaimDoneRefreshDue([finished(7, 'reclaimed'), finished(8, 'refused')], new Set([7, 8]), T, T + 1))
      .toBe(false);
    expect(childReclaimDoneRefreshDue([r({ id: 7, state: 'working' })], new Set([7]), T, T + 1)).toBe(false);
  });
});

describe('childRunsSeen — which runs had a child, remembered across frames', () => {
  it('takes a run a fleet frame marked as a child’s, and a finished row that carried a chip', () => {
    const seen = childRunsSeen(new Set(), [
      sess({ child: { kind: 'child', runId: 41 } }),
      sess({ id: 'ccrc-pwa-keen-dune', child: { kind: 'unreadable' } }),
      sess({ id: 'ccrc-pwa-calm-reef' }),
    ], [finished(7, 'pending'), finished(8, null)]);
    expect([...seen].sort((a, b) => a - b)).toEqual([7, 41]);
  });

  it('never forgets: a later frame without the child keeps the run', () => {
    const once = childRunsSeen(new Set(), [sess({ child: { kind: 'child', runId: 41 } })], []);
    expect([...childRunsSeen(once, [], [])]).toEqual([41]);
  });
});

describe('the board re-reads the archive when the newest reclaim end changes (wave 6)', () => {
  it('re-reads once when the value changes and a finished row is still pending', async () => {
    const { store, loadRuns } = await board([finished(7, 'pending')], { doneAt: T });
    frame(store, coordWith(T + 1));
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
    frame(store, coordWith(T + 1, { pause: 'set' }));          // a new frame, the same value
    await settle();
    expect(loadRuns).toHaveBeenCalledTimes(2);
  });

  it('a null is never a reason to read: a restarted server, then its first measured value', async () => {
    const { store, loadRuns } = await board([finished(7, 'pending')], { doneAt: T });
    frame(store, coordWith());                                   // restarted: the field is absent
    await settle();
    expect(loadRuns).toHaveBeenCalledTimes(1);
    frame(store, coordWith(T));                                  // the same instant, but a change from null
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
  });

  it('the race row: no chip, but this board saw its child in a fleet frame', async () => {
    const child = sess({ child: { kind: 'child', runId: 7 } });
    const { store, loadRuns } = await board([finished(7, null)], { doneAt: T, sessions: [child] });
    act(() => { store.setState({ sessions: [] }); });           // the vanish: wave 5 sees no chip and stays quiet
    await settle();
    expect(loadRuns).toHaveBeenCalledTimes(1);
    frame(store, coordWith(T + 1));
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
  });

  it('the race row after wave 5’s re-read: pending before, no chip now', async () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [], runsFrameSeen: true, sessions: [sess()], fleetFrameSeen: true,
      coord: coordWith(T), coordFrameSeen: true }); });
    const loadRuns = vi.fn<() => Promise<{ runs: RunSummary[] }>>()
      .mockResolvedValueOnce({ runs: [finished(7, 'pending')] })
      .mockResolvedValue({ runs: [finished(7, null)] });
    render(<RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} />);
    await screen.findByRole('group', { name: /finished/i });
    act(() => { store.setState({ sessions: [] }); });           // wave 5's trigger: it reads, and races
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
    await settle();
    frame(store, coordWith(T + 1));
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(3));
  });

  it('does not re-read when every finished row is settled, or on the first frame it sees', async () => {
    const settled = await board([finished(7, 'reclaimed'), finished(8, 'refused'), finished(9, null)], { doneAt: T });
    frame(settled.store, coordWith(T + 1));
    await settle();
    expect(settled.loadRuns, 'a settled board re-read').toHaveBeenCalledTimes(1);
    cleanup();
    const late = await board([finished(7, 'pending')], { coordSeen: false });
    frame(late.store, coordWith(T));                             // the first frame: a baseline
    await settle();
    expect(late.loadRuns, 'the first frame was read as a change').toHaveBeenCalledTimes(1);
    frame(late.store, coordWith(T + 1));                         // and the baseline was taken
    await waitFor(() => expect(late.loadRuns).toHaveBeenCalledTimes(2));
  });

  it('an older server: frames that never carry the field never read', async () => {
    const { store, loadRuns } = await board([finished(7, 'pending')]);
    frame(store, coordWith(undefined, { pause: 'set' }));
    frame(store, coordWith(undefined, { mail: 'set' }));
    await settle();
    expect(loadRuns).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/child-reclaim-done-at.test.ts)
(cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-done-reread.test.tsx)
```

Expected for `child-reclaim-done-at`: 11 of 12 FAIL.

| Case | Expected failure |
|---|---|
| both `childReclaimDoneHighWater` cases | `TypeError: childReclaimDoneHighWater is not a function` |
| all three `JournalMirror.childReclaimDoneAt` cases | `TypeError: r.m.childReclaimDoneAt is not a function` |
| "carries the value, and re-emits the frame only when it changes" | `expected undefined to be 1758500000004` |
| "carries it on the unmeasurable arm too" | a `toMatchObject` diff whose received object has no `childReclaimDoneAt` |
| the `childMarkLeftListing` case | `TypeError: childMarkLeftListing is not a function` |
| "sweeps on the tick that sees a child vanish" | `expected "sweep" to be called 2 times, but got 1 times` |
| "resets nothing across an unlistable tick" | `expected "sweep" to be called 2 times, but got 1 times`, at its last assertion |
| the census | `expected {} to deeply equal { 'pwa/src/fleet/childReclaimWords.ts': 2 }` |

"omits the field while the mirror has committed no reclaim done" PASSES already. It guards the omission and goes red under mutation 4 of Step 6.

Expected for `child-reclaim-done-reread`: 13 of 14 FAIL.

| Case | Expected failure |
|---|---|
| the reader case | `TypeError: childReclaimDoneAtOf is not a function` |
| all five `childReclaimDoneRefreshDue` cases | `TypeError: childReclaimDoneRefreshDue is not a function` |
| both `childRunsSeen` cases | `TypeError: childRunsSeen is not a function` |
| board: "re-reads once", "a null is never a reason", "the race row: no chip" | `waitFor`'s timeout reporting `expected "vi.fn()" to be called 2 times, but got 1 times` |
| board: "the race row after wave 5's re-read" | the same timeout at its last `waitFor`: `expected "vi.fn()" to be called 3 times, but got 2 times` |
| board: "does not re-read when every finished row is settled" | its final `waitFor`: `expected "vi.fn()" to be called 2 times, but got 1 times` |

"an older server" PASSES: no trigger exists yet, and it goes red only if a later edit fires on an absent field.

If the "the race row after wave 5's re-read" case fails at its FIRST `waitFor` (2 calls), wave 5's trigger is not on this branch: stop, because the entry check was wrong.

- [ ] **Step 3: Implement the server side**

In `server/src/coord/mirrorplan.ts`, widen the type import (`grep -n "import type { LifecycleHealthState }"`) to:

```ts
import type { LifecycleAct, LifecycleHealthState, LifecycleOutcome } from '../../../shared/api.js';
```

Add directly after `shouldSweep`:

```ts
/**
 * Child-reclamation wave 6 (spec §5.9): the high-water mark of the `at` of a
 * `reclaim`/`done` journal row, over `prev` and `rows`. `JournalMirror` keeps it
 * so the coord frame can tell the board that a reclaim's end has been
 * committed, which is the fact the board's vanish re-read raced.
 *
 * ONLY EVER RISES. A late line, an overlapping sweep's re-read of the same
 * bytes, or a truncation's re-read from 0 can hand the mirror an older row
 * again, and none of them may lower the mark. A row with no `at` cannot be
 * placed and is skipped: `at` is ccd's clock alone, and the mirror's
 * `ingestedAt` is never an event time. `null` means no such row has been seen.
 * The act and the outcome are compared as typed literals, so a rename in
 * `LifecycleAct` or `LifecycleOutcome` is a compile error here.
 */
export function childReclaimDoneHighWater(
  prev: number | null,
  rows: readonly { readonly act: LifecycleAct; readonly outcome: LifecycleOutcome; readonly at: number | null }[],
): number | null {
  let high = prev;
  for (const r of rows) {
    if (r.act !== 'reclaim' || r.outcome !== 'done' || r.at === null) continue;
    if (high === null || r.at > high) high = r.at;
  }
  return high;
}
```

In `server/src/coord/mirror.ts`, add `childReclaimDoneHighWater` to the `./mirrorplan.js` import. Add this field directly after `private readonly unorderableSeen`:

```ts
  /** Child-reclamation wave 6 (spec §5.9): the newest `at` of a
   *  `reclaim`/`done` row this mirror has COMMITTED, or null while it has
   *  committed none. IN MEMORY: a restart reads null until the next reclaim
   *  ends, and the board treats null as "no news", never as a change. */
  private childReclaimDoneNewest: number | null = null;
```

Add this accessor directly before `health()`:

```ts
  /** `childReclaimDoneNewest`, read by `FleetWatcher.currentChildReclaimDoneAt` for
   *  the coord frame. */
  childReclaimDoneAt(): number | null {
    return this.childReclaimDoneNewest;
  }
```

Replace `commit`'s body with:

```ts
  private commit(gen: string, lines: readonly string[], cursor: number, size: number, at: number): void {
    const rows: JournalRow[] = lines.map(parseJournalLine);
    this.deps.store.ingestJournal({ gen, rows, cursor, size, at });
    // AFTER the ingest, never before it. The frame that carries this value
    // tells the board to read GET /api/runs, which reads these rows from
    // SQLite. A value raised before a commit that then threw would send the
    // board to read a row that is not there yet.
    this.childReclaimDoneNewest = childReclaimDoneHighWater(this.childReclaimDoneNewest, rows);
  }
```

In `server/src/coord/childReclaim.ts`, directly before `export function childReclaimSessions`:

```ts
/**
 * Child-reclamation wave 6 (spec §5.9): did a CHILD leave the registry
 * listing between two LISTED ticks? A child's row is purged by its reclaim, and
 * ccd journals the reclaim's `done` only after that purge, so the watcher answers
 * a `true` by resetting the journal mirror's clock. The mirror then sweeps on
 * that same tick instead of up to `LC_SWEEP_MS` later.
 *
 * Only a `child` mark counts. A row marked `none` is no child, and an
 * `unreadable` one is not known to be a child. `prev` null is the first listing
 * this process has made: there is nothing to compare, so nothing left.
 */
export function childMarkLeftListing(
  prev: ReadonlyMap<string, ChildMark> | null, next: ReadonlyMap<string, ChildMark>,
): boolean {
  if (prev === null) return false;
  for (const [id, mark] of prev) if (mark.kind === 'child' && !next.has(id)) return true;
  return false;
}
```

In `server/src/watch.ts`, add `childMarkLeftListing` to the `./coord/childReclaim.js` import. In `tick()`, replace wave 5's two lines:

```ts
      // Wave 5: the reclaim chip's registry answer, off THIS listing. Never a
      // second read; see `childMarks`.
      this.childMarks = new Map(records.map((r) => [r.id, r.child] as const));
```

with:

```ts
      // Wave 5: the reclaim chip's registry answer, off THIS listing. Never a
      // second read; see `childMarks`.
      const childMarks = new Map(records.map((r) => [r.id, r.child] as const));
      // Wave 6 (spec §5.9): a child that left the listing was, almost
      // always, just reclaimed, and ccd journals the reclaim's end AFTER the
      // purge. Reset the mirror's clock, so the `sweepLifecycle` dispatch below
      // sweeps on THIS tick, and the coord frame's `childReclaimDoneAt` usually
      // moves one tick later. An assignment, never an await: the tick's order
      // and its timing are unchanged. Only on a LISTED tick, below the fail-shut
      // return: an unlistable registry proves no child gone.
      if (childMarkLeftListing(this.childMarks, childMarks)) this.lastLifecycleSweep = 0;
      this.childMarks = childMarks;
```

Directly after `currentChildMarks()`, add:

```ts
  /** Child-reclamation wave 6 (spec §5.9): the journal mirror's newest
   *  committed reclaim end, or null when no mirror exists yet or it has
   *  committed none. In memory; read by `emitCoord` alone. */
  currentChildReclaimDoneAt(): number | null {
    return this.mirror?.childReclaimDoneAt() ?? null;
  }
```

In `emitCoord`, rename the frame literal's binding and add the field. The literal itself stays byte-identical: `child-reclaim-verdict-readers.test.ts` (c) counts its two `childReclaimAttention: this.childReclaimAttentionList` expressions. Replace `const status: CoordStatus = names === null` with `const base: CoordStatus = names === null`. Then insert, directly before `const json = JSON.stringify(status);`:

```ts
    // Wave 6 (spec §5.9): the mirror's newest committed reclaim end, on BOTH
    // arms, because it is the mirror's measurement and not the listing's.
    // OMITTED, never null, while there is none: absence is the one meaning
    // the PWA's reader gives it, whether the server restarted or predates the
    // field. Still no I/O and no `node:sqlite`: it is an in-memory field.
    const doneAt = this.currentChildReclaimDoneAt();
    const status: CoordStatus = doneAt === null ? base : { ...base, childReclaimDoneAt: doneAt };
```

Append to `emitCoord`'s docstring: `Wave 6: it also carries the mirror's newest committed reclaim end (childReclaimDoneAt), omitted while there is none; the byte-equality guard re-emits the frame on the tick after it changes.`

In `shared/api.ts`, add to `CoordStatus` after `childReclaimAttention`:

```ts
  /** Child-reclamation wave 6 (spec §5.9): the `at` (ccd's clock, epoch ms)
   *  of the newest `reclaim`/`done` journal row the server's mirror has
   *  COMMITTED. It is a trigger and nothing renders it: the board re-reads its
   *  archive once each time this value CHANGES while a finished row's reclaim
   *  chip is unsettled, because the vanish re-read races the journal.
   *
   *  OPTIONAL, ADDITIVE, absence permits. It is OMITTED, never null, while
   *  the server has committed none, which is always the case right after a
   *  restart because the value lives in memory and only ever rises. A server
   *  older than this field omits it too. The PWA's ONE reader is
   *  `childReclaimDoneAtOf` (`pwa/src/fleet/childReclaimWords.ts`). */
  childReclaimDoneAt?: number;
```

In the `CoordStatus` docstring's ADDITIVE paragraph, extend "omits both" to read: "omits both, a server older than wave 6 omits `childReclaimDoneAt`, and the PWA's ONE reader per field …".

- [ ] **Step 4: Implement the PWA side**

These three files are scanned as RAW TEXT by `server/test/child-reclaim-chip-source.test.ts`'s token case, comments included. In comments, quote no ws-reclaim refusal token, skip word or journal refusal token, and name no server sentence table.

In `pwa/src/fleet/childReclaimWords.ts`, extend the header's first sentence: "… and the ONE reader for each of the two `CoordStatus` fields this row renders, plus the one reader of a third, `childReclaimDoneAt`, which nothing renders (wave 6)." Then add after `childReclaimAttentionOf`:

```ts
/** THE ONE READER of `CoordStatus.childReclaimDoneAt` (child-reclamation wave 6,
 *  spec §5.9). Absence permits: a server older than the field, or one whose
 *  mirror has committed no reclaim end since it started, omits it. Both read as
 *  `null`, and the board treats `null` as no news, never as a change. Anything
 *  that is not a finite number is `null` too; it is a trigger, so a junk value
 *  must not fire one. */
export function childReclaimDoneAtOf(coord: unknown): number | null {
  if (typeof coord !== 'object' || coord === null) return null;
  const v = (coord as { childReclaimDoneAt?: unknown }).childReclaimDoneAt;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
```

In `pwa/src/fleet/runWords.ts`, directly after `childReclaimRefreshDue`:

```ts
/**
 * Should the board re-read its archive because the server's newest reclaim end
 * moved (child-reclamation wave 6, spec §5.9)? The vanish trigger above
 * races the server's journal mirror: ccd purges the child's row before it
 * journals the end, so that read can come back with no chip. This is the
 * second trigger, on the fact the race was waiting for.
 *
 * Due exactly when `after` is a value, it differs from `before` (a CHANGE,
 * never only an increase, because a restarted server reads null first), and
 * some FINISHED row is unsettled:
 *   • its chip is pending, deferred or paused; or
 *   • it has no chip and `hadChild` holds its run, which is the race's own row.
 * An open row is never counted: its chip is blank by design.
 */
export function childReclaimDoneRefreshDue(
  runs: readonly RunSummary[], hadChild: ReadonlySet<number>, before: number | null, after: number | null,
): boolean {
  if (after === null || after === before) return false;
  for (const run of runs) {
    if (!isRunClosed(run)) continue;
    const chip = childReclaimChip(run);
    if (chip === null ? hadChild.has(run.id) : CHILD_RECLAIM_UNSETTLED.has(chip.word)) return true;
  }
  return false;
}
```

Directly after `childMarkOf`:

```ts
/**
 * The run ids this board knows had a child (child-reclamation wave 6). A fleet
 * frame's child mark names its minting run, and a finished row carries a chip
 * only for a child. By the time the reclaim's end reaches the coord frame, the
 * child has left the fleet frame and its row may carry no chip, so the board
 * accumulates the answer across frames and reads. Never forgets: the set lives
 * as long as the board, and holds a few integers. Returns a new set.
 */
export function childRunsSeen(
  seen: ReadonlySet<number>, sessions: readonly { child?: ChildMark }[], runs: readonly RunSummary[],
): ReadonlySet<number> {
  const out = new Set(seen);
  for (const s of sessions) {
    const m = childMarkOf(s);
    if (m.kind === 'child') out.add(m.runId);
  }
  for (const run of runs) if (childReclaimChip(run) !== null) out.add(run.id);
  return out;
}
```

In `pwa/src/screens/RunsScreen.tsx`:
- Add `childReclaimDoneRefreshDue` and `childRunsSeen` to the `../fleet/runWords` import.
- Add `import { childReclaimDoneAtOf } from '../fleet/childReclaimWords';`.
- Beside `const conn = store((s) => s.conn);`, add:

```tsx
  const coordFrame = store((s) => s.coord);
  const coordFrameSeen = store((s) => s.coordFrameSeen);
```

Directly after wave 5's fleet-vanish effect (the one closing on `}, [sessions, fleetFrameSeen]);`), add:

```tsx
  // Child-reclamation wave 6 (spec §5.9): the SECOND trigger. ccd purges a
  // reclaimed child's registry row before it journals the reclaim's end, and
  // the server's journal mirror is never awaited, so the vanish read above
  // usually lands first and the row comes back with no chip. The coord frame
  // carries the newest reclaim end the mirror has committed. When THAT changes,
  // and a finished row is still unsettled, the board reads its archive once.
  // It is not a poll: it fires once per change of a value the server measured.
  // A null (a restarted server, or one older than the field) is never a reason
  // to read, and the first value this board sees is its baseline, not a change.
  //
  // Which runs had a child is remembered across frames (`childRunsSeen`). This
  // effect is declared first, so it runs first in a commit that changes both.
  const childRunsRef = useRef<ReadonlySet<number>>(new Set<number>());
  useEffect(() => {
    childRunsRef.current = childRunsSeen(childRunsRef.current, sessions, cold ?? []);
  }, [sessions, cold]);
  // `undefined` = no coord frame seen yet by this board; null = seen, no value.
  const prevDoneAtRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!coordFrameSeen) return;
    const after = childReclaimDoneAtOf(coordFrame);
    const before = prevDoneAtRef.current;
    prevDoneAtRef.current = after;
    if (before !== undefined && childReclaimDoneRefreshDue(cold ?? [], childRunsRef.current, before, after)) {
      void loadCold();
    }
    // The coord frame's dependencies only, as wave 5's effect takes the fleet
    // frame's: a cold read landing is not a change of the value, and a re-read
    // changes `cold`, never `coordFrame`, so it cannot loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordFrame, coordFrameSeen]);
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
(cd server && ./node_modules/.bin/vitest run test/child-reclaim-done-at.test.ts \
  test/lifecycle-sweep.test.ts test/lifecycle-mirror.test.ts test/lifecycle-replay.test.ts test/mirrorplan.test.ts \
  test/child-reclaim-watch-view.test.ts test/child-reclaim-verdict-readers.test.ts \
  test/child-reclaim-chip-source.test.ts test/child-reclaim-runs-route.test.ts test/fleetws.test.ts \
  test/single-definition.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit -p .)
(cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-done-reread.test.tsx test/runs-screen.test.tsx \
  test/child-reclaim-banner.test.tsx test/coord-banner.test.tsx test/stores.test.ts)
(cd pwa && ./node_modules/.bin/tsc --noEmit)
```

Expected:
- `child-reclaim-done-at` passes 12/12, and `child-reclaim-done-reread` passes 14/14.
- Every other listed suite stays green UNCHANGED:
  - `fleetws.test.ts`'s whole-frame coord `toEqual` pins (ten, measured at `e79b1da7`) all hold because the field is omitted.
  - `child-reclaim-verdict-readers` (c) and (e) hold because the frame literal is byte-identical and nothing in `server/src` reads the published attention list.
  - `child-reclaim-chip-source` holds because no token is spelled and `\bchildReclaim\b` is not matched by the new names.
- Both `tsc` runs print nothing.

Then confirm that no route, gate or ccd file moved, which leaves the auth census untouched:

```bash
git diff --name-only | grep -E 'routes\.ts|server\.ts|auth/gate\.ts|ccd/ccd$' || echo none
```

Expected: `none`.

- [ ] **Step 5b: Pay the citation tax (S6-R11; README is repaired, the census is re-measured)**

Step 3 inserted lines into `CoordStatus`: the new field, its docstring, and any rewrap of the ADDITIVE paragraph. `CoordStatus` sits far ABOVE `LcRefusalToken` and `LC_REFUSAL_WORD`, so README's union anchor AND its three map anchors all move down by the same N, the net count of lines this task added to `shared/api.ts`. Unlike Tasks 10 and 11, the insertion also sits above the CITATION DEBT `'shared/api.ts'` referent, so that entry may move too.

Run (a) and (b) in ONE shell, because (b) reads (a)'s variables.

(a) Measure. Run Task 10 Step 6(a)'s block verbatim, then:

```bash
N=$(git diff --numstat -- shared/api.ts | awk '{ print $1 - $2 }'); echo "N=${N}"
git diff -U0 -- shared/api.ts | grep '^@@'; grep -n '^export type LcRefusalToken' shared/api.ts
```

Expected:
- `N` is positive, and every hunk header the second line prints starts above the `LcRefusalToken` line number.
- The tree's first and third union line numbers are README's two union numbers (`OLD_U`), each plus N.
- Each of the tree's three map numbers is README's number plus N.
- Then `SAME-BYTES`.

If the `diff` prints anything, STOP and report it in the wave-done mail: README was already stale at `HEAD`, before this task touched it.

(b) Re-point all four anchors, the highest map number first:

```bash
perl -pi -e "s/shared\/api\.ts:${OLD_U}\`/shared\/api.ts:${U1}-${U3}\`/; s/\`:${OM3}\`/\`:${M3}\`/; s/\`:${OM2}\`/\`:${M2}\`/; s/\`:${OM1}\`/\`:${M1}\`/" README.md
git diff --stat -- README.md
```

Every number moves up by the same N, so a new number can equal an older, lower one: with N = 13, the old `:7858` becomes `:7871`, which is the old third anchor. Replacing from the highest down never meets a number it has just written.

Expected: `README.md | 4 ++--`. That is the two lines of the purge-refusal sentence (the union anchor shares the first) and nothing else. If more lines changed, run `git checkout -- README.md` and edit those two lines by hand.

(c) Re-measure the census, including README's own:

```bash
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|THE RANGE BOUND')
```

Expected: PASS. *README HAS ITS OWN CENSUS ENTRY, and it is EMPTY* passes because of (b). If ONLY the `'shared/api.ts'` CITATION DEBT entry (and so the `total`) is red, re-measure it under the standing rule, as Task 10 Step 6(c) items 1–3 say: the RECEIVED values, never values from this plan, with this comment directly above the entry:

```ts
    // RE-MEASURED at child-reclamation wave 6, Task 12 (S6-R11, no rule changed): `shared/api.ts`
    // <old> -> <new>. This task inserted `CoordStatus.childReclaimDoneAt` and its docstring, above
    // anchors the frozen spec/plan corpus cites by line. No corpus document may be re-pointed. README's
    // union anchor and three map anchors into the same file were RE-ANCHORED BY CONTENT in the same
    // commit (`diff`-proved byte-identical), so README contributes nothing here.
```

Then re-run (c): PASS. This task edits no `ccd/ccd`, so a red naming `ccd/ccd` is not this task's: `session-hook` is a known load flake, so re-run it in isolation first.

- [ ] **Step 6: Mutation check**

Make each mutation alone, run its command, see the stated red, then revert it. Commands:
- **S** = `(cd server && ./node_modules/.bin/vitest run test/child-reclaim-done-at.test.ts)`
- **P** = `(cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-done-reread.test.tsx)`

| # | Mutation (exact edit) | Cmd | Expected red |
|---|---|---|---|
| 1 | In `JournalMirror.commit`, move `this.childReclaimDoneNewest = childReclaimDoneHighWater(…)` ABOVE `this.deps.store.ingestJournal(…)` | S | "raises nothing when the ingest fails": `raised before the row was committed: expected 1758500000004 to be null` |
| 2 | In `childReclaimDoneHighWater`, replace `if (high === null \|\| r.at > high) high = r.at;` with `high = r.at;` | S | `childReclaimDoneHighWater` case 2: `expected 1758500000004 to be 1758500000050`; mirror case 2: `the value fell: expected 1758500000001 to be 1758500000004` |
| 3 | In `childReclaimDoneHighWater`, delete `\|\| r.outcome !== 'done'` | S | case 1: `expected 1758500000012 to be 1758500000004` |
| 4 | In `emitCoord`, replace `doneAt === null ? base : { ...base, childReclaimDoneAt: doneAt }` with `{ ...base, childReclaimDoneAt: doneAt }` | S | "omits the field…": `expected { pause: 'clear', …(4) } not to have property "childReclaimDoneAt"` |
| 5 | In `emitCoord`, replace `doneAt === null ?` with `doneAt === null \|\| names === null ?` | S | "carries it on the unmeasurable arm too": a `toMatchObject` diff with `childReclaimDoneAt` missing |
| 6 | In `tick()`, delete the `if (childMarkLeftListing(this.childMarks, childMarks)) this.lastLifecycleSweep = 0;` line | S | "sweeps on the tick that sees a child vanish": `expected "sweep" to be called 2 times, but got 1 times` |
| 7 | In `childMarkLeftListing`, delete `mark.kind === 'child' && ` | S | the pure case: `expected true to be false`; the tick case: `a plain row reset the clock: expected "sweep" to be called 1 times, but got 2 times` |
| 8 | In `RunsScreen.tsx`, inside the new effect, add `const raw = (coordFrame as { childReclaimDoneAt?: unknown } \| null)?.childReclaimDoneAt;` and pass `typeof raw === 'number' ? raw : null` as `after` | S | the census: `expected { …(2) } to deeply equal { 'pwa/src/fleet/childReclaimWords.ts': 2 }` |
| 9 | In `childReclaimDoneAtOf`, replace the return with `return typeof v === 'number' ? v : null;` | P | the reader case: `expected NaN to be null` |
| 10 | In `childReclaimDoneRefreshDue`, replace `after === null \|\| after === before` with `after === before` | P | "is not due on null…": `expected true to be false` |
| 11 | In `childReclaimDoneRefreshDue`, replace `after === null \|\| after === before` with `after === null \|\| (before !== null && after <= before)` | P | "is due on ANY change…": `expected false to be true` |
| 12 | In `childReclaimDoneRefreshDue`, replace `chip === null ? hadChild.has(run.id) :` with `chip === null ? false :` | P | "reads a row with no chip…": `expected false to be true`; board "the race row: no chip…": `expected "vi.fn()" to be called 2 times, but got 1 times` |
| 13 | In `childReclaimDoneRefreshDue`, delete `if (!isRunClosed(run)) continue;` | P | "is not due when every finished row is settled, nor for an open row": `expected true to be false` |
| 14 | In `RunsScreen.tsx`, replace `before !== undefined && ` with nothing | P | "does not re-read … or on the first frame it sees": `the first frame was read as a change: expected "vi.fn()" to be called 1 times, but got 2 times` |
| 15 | In `RunsScreen.tsx`, delete `prevDoneAtRef.current = after;` | P | "re-reads once when the value changes": `expected "vi.fn()" to be called 2 times, but got 1 times` |
| 16 | In `childRunsSeen`, delete the `for (const s of sessions) { … }` loop | P | `childRunsSeen` case 1: `expected [ 7 ] to deeply equal [ 7, 41 ]`; board "the race row: no chip…": `expected "vi.fn()" to be called 2 times, but got 1 times` |
| 17 | In `childRunsSeen`, delete the `for (const run of runs) …` line | P | `childRunsSeen` case 1: `expected [ 41 ] to deeply equal [ 7, 41 ]`; board "the race row after wave 5's re-read": `expected "vi.fn()" to be called 3 times, but got 2 times` |

Mutation 8 also typechecks; it is a second reader, which the census exists to refuse. If any row stays green, the guard it names is not doing its job. Fix the test, not the mutation, and re-run the row.

- [ ] **Step 7: Commit**

```bash
git add server/src/coord/mirrorplan.ts server/src/coord/mirror.ts server/src/coord/childReclaim.ts \
  server/src/watch.ts shared/api.ts pwa/src/fleet/childReclaimWords.ts pwa/src/fleet/runWords.ts \
  pwa/src/screens/RunsScreen.tsx server/test/child-reclaim-done-at.test.ts \
  pwa/test/child-reclaim-done-reread.test.tsx README.md
git add server/test/session-hook.test.ts   # only if Step 5b(c) re-measured it
git commit -m "$(cat <<'MSG'
feat(child-reclaim): a second trigger for the vanish re-read

ccd purges a reclaimed child's registry row before it journals the
reclaim's end, and the journal mirror is never awaited, so the board's
re-read on the vanish usually raced the mirror and the chip stayed blank.

The mirror now keeps the newest committed reclaim end, in memory and only
rising, and the coord frame carries it as the optional childReclaimDoneAt,
omitted while there is none. The board re-reads its archive once per change
of that value while a finished row is unsettled: a pending, deferred or
paused chip, or no chip on a run it saw mint a child. Never on null, never
on a timer. A child-marked id leaving the listing resets the mirror's clock
without an await, so the end is usually measured on that same tick. The
tick's order, ccd's journal and every route are unchanged. README's four
shared/api.ts anchors are re-pointed by content.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```


### Task 13: Docs

**Model routing:** `sonnet`, effort `high`. Docs only, plus one line-neutral `ccd/ccd` comment.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` (§1, §5.2, §5.5, §5.6, §5.9, §7, §8).
- Modify: `docs/superpowers/programs/child-reclamation-contract.md`. A "§12 as built" note is appended at the end of §12. Sections 1–11 and §12's ruling text are never edited.
- Modify: `ccd/ccd`, `_lc_fail`'s header. One line is replaced by one line, then the file is re-stamped.
- Modify: `README.md`, one sentence, line-neutral.

**Rules for every edit here:**
- Locate by content. The `find` strings below are the text as #290 left it at `e79b1da7`.
- If a later merge re-wrapped a `find`, locate it by its first distinctive phrase, apply the same change, and name `spec-rewrap-<section>` in the wave-done.
- Write no `D-` token. Where an anchor sentence already carries one, leave that parenthesis exactly as it stands.
- Line widths follow the surrounding text: about 110 columns, and list items keep their indent.

- [ ] **Step 1: Spec §5.5 step 3: the branch tip "when the branch exists", and the three-way read with the old-git fallback**

Edit 1a. Find:
```
the branch tip, which is
   required because it is the commit the tail deletes the branch at and, on a detached or drifted tree,
   nothing else pins it;
```
Replace with:
```
the branch tip when the branch exists, which is
   then required because it is the commit the tail deletes the branch at and, on a detached or drifted
   tree, nothing else pins it;
```

Edit 1b. Find (one line fragment):
```
   is destroyed, and a branch that does not resolve is one, because it leaves the tail no tip to delete at.
```
Replace with:
```
   is destroyed. Whether the branch exists is read three ways, by `git show-ref --exists`: present, absent,
   or a read that did not run. Only a proven absence goes ahead with no tip: HEAD, the WIP commit and every
   reflog and per-worktree ref commit are pinned as above, and the tail then deletes no branch. A read that
   did not run stops the reclaim: the audit answers unmeasured, and at the tail's branch step it fails
   `branch-unmeasured` with the row and the breadcrumb kept. A git older than 2.43 has no `--exists`: there a
   branch that resolves still reads present and anything else reads unmeasured, so such a box (Apple's git
   2.39, for one) reclaims a standing branch as before and never reclaims a gone one. A branch that
   reappears after the tombstone is `branch-moved`. A worktree whose HEAD is still symbolic to a branch
   proven gone stays `pin-failed`, because the WIP commit needs a HEAD.
```
The ` A` that followed the found fragment on its line (" A\n   nested checkout of a different repository…") stays, now after "needs a HEAD.".

- [ ] **Step 2: Spec §1 and §7: the example sentence (gone-branch.OPEN2)**

Edit 2a, in §1. Find:
```
(§5.9), and, until wave 6, a child whose reclaim fails past the ceiling for good, such as `pin-failed` with
its branch already gone.
```
Replace with:
```
(§5.9), and a child whose reclaim fails past the ceiling for good, such as `pin-failed` with its HEAD still
on a branch that is already gone.
```

Edit 2b, in §7 item 2. Find:
```
and, until wave 6, a child whose reclaim fails past the ceiling for
   good, such as `pin-failed` with its branch already gone.
```
Replace with:
```
and a child whose reclaim fails past the ceiling for good,
   such as `pin-failed` with its HEAD still on a branch that is already gone.
```

- [ ] **Step 3: Spec §8: the wave table rows for waves 6, 7 and 8 (R48)**

Replace the whole row that begins `| 6 | both | the collector for a child temp root that a human verb orphaned;` with these three rows:
```
| 6 | both (agent first) | what `ws-reclaim` deletes, repaired: after the kill the tail waits, bounded, until no process uses the temp root, removes it through one removal helper or keeps it and records why; the temp root's positive witness; the tail's deleting git calls contained, and git's inherited config dropped inside the containment; ccd journaling the failures the lifecycle mirror never saw; the pin for a child whose branch is already gone; recovery from a registry row whose directory is gone; the board's second re-read trigger | a child whose branch is gone is reclaimed rather than failing; a reclaimed child's temp root does not come back; a gone row no longer holds the children it cannot reach; an unmeasured probe and an id-tied pre-lock die each leave a journal line |
| 7 | agent (inert) | the collector verb for a witnessed child temp root that a human verb or a kept tail left behind: its audit and token, its capability token and agent grant | the fleet's `ccd caps` advertises the collector's token, and nothing composes it yet |
| 8 | server | the collector's lane in the sweep, under `reclaim-pause` and the sweep's pacing | an orphaned temp root is collected with no human act |
```

Then, in the paragraph under the table, find:
```
and wave 6's collector is a second destructive path.
```
Replace with:
```
wave 6 changes what the existing verb deletes and keeps, and wave 7's collector is a second destructive
path, which wave 8's lane is the first to call.
```

- [ ] **Step 4: Spec §5.2: the witness and Darwin**

Insert two paragraphs directly after the paragraph that ends `so nothing new goes unreported.` (the "Two collectors, disjoint roots" paragraph):
```

**The positive witness.** Each time `_child_tmpdir` hands a child its temp root, ccd records one line at
`$REG/tmproots/<id>`: `v=1`, the id, the run, and the leaf's device, inode, birth time (`-` where the
filesystem keeps none), owning uid and the time, taken by `stat` right after the leaf's mkdir and chmod. It is
written, by a temp file moved into place, only when it is absent or unparseable, or its device, inode, birth
time or run no longer match, so a recycled slug's new child overwrites it on its first spawn. A failed write
never fails the spawn. The registry subdirectory has no leading dot, as `pools/` has none: no registry glob
sees it, a row's purge leaves it standing, and a slug whose only trace is its witness reads free. It dies
only after the removal helper (§5.6) has proven its leaf absent. A leaf whose identity no longer matches its
witness, which is what a storage migration does to every leaf, is never collected; it is the operator's.
Identity on the box is attribution: any process of this uid can write the file, so the binding narrows a
forgery to a directory ccd itself made, and it is not a wall. Nothing collects by the witness until waves
7 and 8 (§8).

**Darwin keeps its temp roots.** Whether a process still uses a temp root is read from `/proc`, which
Darwin lacks, so there that probe answers unmeasured and every reclaim and expiry tail keeps the temp root,
recorded as kept (§5.6). The collector is Linux-first too. A Darwin box's `~/.cc-tmp` therefore grows by
one leaf per child until a person clears it.
```

- [ ] **Step 5: Spec §5.5's hold bullet: the gone-directory recovery**

In the bullet that begins `- **The hold reaches a vanished child.**`, insert this text directly after the sentence ending "and then a later attempt has to run", AFTER its existing parenthesis and full stop, with no change to the parenthesis:
```
 Since wave 6 a row whose directory is gone
  also stops holding on positive evidence alone, by one of two arms: git's own record of that worktree,
  exactly one, marked prunable, with the leaf the only absent component and the parent resolving complete to
  its literal spelling; or the row's own interrupted reclaim, whose breadcrumb phase is past the worktree's
  removal and whose tombstone says ccd removed a present tree. An interrupted expiry's breadcrumb is not such
  evidence, a lifecycle `create` row never decides, and an unreadable record is never read as no record. No
  checkout inside the child may resolve its git directory to the admin directory a recovered row named. That
  refusal reuses `containment-unproven`, whose sentence describes such a moved tree only approximately. The
  recovery creates nothing, prunes nothing and purges no row.
```

- [ ] **Step 6: Spec §5.6: what the tail removes, and what it keeps**

Insert this paragraph directly after the "Teardown order, after the pin phase:" paragraph, the one that ends `into a routine one.`:
```

**What the tail removes, and what it keeps (wave 6).** A pane's processes can outlive `tmux
kill-session`, and one that carries `TMPDIR=<leaf>` can recreate the temp root after the tail removed it.
Measured: a reclaimed child's leaf came back 3.7 s after `reclaim done`. So after the kill the tail waits,
at most 15 s, until no process of this uid uses the temp root, and asks once more at the instant of removal.
A process uses it when its `TMPDIR` is at or under the leaf, its working directory is there, or it holds a
file there open. A process of another uid, or a same-uid process the kernel will not let ccd read, is
skipped, as a stated limit. A probe that could not look answers unmeasured, never "nobody". The clips and
temp-root leaves go through one removal helper. It:
- validates the id and resolves the root physically;
- unlinks a link or file leaf without following it;
- takes a directory leaf only when it is a real directory this uid owns, at exactly root/id (and at the
  expected device and inode when a caller names them);
- removes it without crossing a file-system boundary, and reads every exit code;
- proves the leaf absent.

It answers removed, refused with a reason, or unmeasured. A temp root still in use, or unmeasured, when the
wait ends, and a leaf the helper refuses or cannot measure, is kept with its witness. The act completes,
and its `done` row records what was kept and why. That is not a refusal. The worktree's removal is
unchanged, but for the wait. Every deleting git call the tail makes runs under the reclaim's git
containment: the worktree removal, `update-ref -d` and the branch delete. So the repository's hooks and its
fsmonitor never run while it deletes. That containment first drops an inherited `GIT_CONFIG_PARAMETERS`,
`GIT_CONFIG` and `GIT_CONFIG_COUNT`, so its own `core.hooksPath`, `core.fsmonitor` and
`status.showUntrackedFiles` pins are the only entries. `ws-expire` runs the same tail.
```

- [ ] **Step 7: Spec §5.9: the pre-lock failures, the new failure lines, and the board's re-read**

Edit 7a. Find:
```
A reclaimed child's row stops
offering to open its session, which no longer exists.
```
Replace with:
```
A reclaimed child's row stops
offering to open its session, which no longer exists. The board re-reads the run archive when a finished
child leaves the fleet frame. It re-reads again whenever the newest reclaim `done` the server's journal
mirror has ingested changes, while some finished row's chip is still unsettled; that value rides the
coordination frame and is omitted until there is one. A child leaving the registry listing also brings
the mirror's next sweep forward, and the tick does not wait for it. Each re-read follows one measured fact,
so it is not a polling cadence. A board mounted after its child left, whose first read lands between the
registry purge and the journal's `done`, keeps a null chip until its next load.
```

Edit 7b. Find:
```
- The two lock refusals the attention item reads as failures (below) read `deferred` on the chip too.
```
Replace with:
```
- The four pre-lock refusals the attention item reads as failures (below) read `deferred` on the chip too.
```

Edit 7c. Find:
```
A failure includes the two refusals ccd journals when it cannot take the
reclaim's lock, `flock-unavailable` and `lock-unopenable`: ccd records them as refusals, but the server
retries them, so every surface reads them as failures and never as settled refusals. Only those two are
read that way, by name;
```
Replace with:
```
A failure includes the four refusals ccd journals before it takes the
reclaim's lock. Two are written when it cannot take the lock (`flock-unavailable` and `lock-unopenable`),
and two when the server's argv carries a malformed token or run id beside a valid session id
(`token-malformed` and `run-id-malformed`). ccd records them as refusals, but the server retries them, so
every surface reads them as failures and never as settled refusals. Only those four are read that way, by name;
```

Edit 7d. Insert directly after the sentence ending `is classified when it is added, never` + newline + `inherited.`:
```
 ccd also journals two failures as `failed`. The first is a probe that could not measure
(`probe-unmeasured`), from the locked recomputation and from `ws-audit --reclaim`, told apart by the line's
verb; it is the one audit-time line that is not a terminal refusal. The second is a tail that could not read
whether the branch still exists (`branch-unmeasured`). Seven dies stay unjournaled: the usage die and
the four `--actor`/`--reason` checks run before any id is bound, a malformed session id binds no
trustworthy id, and the journal's encoder is the `python3` whose absence the last reports.
```

Edit 7e. Measure §5.7 and change nothing unless a sentence there is now false:

```bash
sed -n '/^### 5.7 /,/^### 5.8 /p' docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md | grep -n 'temp root\|witness\|tmproots\|the tail\|vanish\|re-reads the archive'
```

Expected: no sentence that describes the tail's removal of the temp root, the witness, or the board's re-read. A hit on the sibling-list or marker re-read inside the coordination mutex is not one of these. If a hit does describe one of them, make it agree with Steps 6 and 7, and name `spec-5-7-<slug>` in the wave-done.

- [ ] **Step 8: Spec §7: a sixth item, the residuals wave 6 carries**

Insert, directly after item 5 ("**The box is not a wall.**…running ccd directly."):
```
6. **Wave 6 carries these residuals, stated rather than discovered.**
   - The manifest and PR-phase branch reads, and the tail's reads of a nested checkout's branch, keep their
     two-way read: an unreadable ref there still reads as no branch. They sit outside the reclaim's branch arms.
   - A stash made on no branch is attributed to the child by its ancestry from the branch, so with the branch
     proven absent no such stash is attributed or pinned. It stays in `refs/stash` and is never deleted.
   - A witness binds birth time in whole seconds. A leaf removed and recreated within one second on the same
     inode matches its witness. The collector's recycled-slug proof (wave 7) owns this.
   - A clips leaf the helper refuses or cannot measure is kept, recorded, and collected by nothing yet. Wave 7's
     pre-flight owns it.
   - A board mounted after its child left, whose first read lands between the registry purge and the
     journal's `done`, keeps a null chip until its next load.
   - A ccd that dies between the registry purge and the journal's `done` leaves a null chip and no attention
     item. A fix would read the tombstone, never reorder ccd.
   - `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` name this uid's own files, and they pass through the
     reclaim's git containment.
   - A straggler that writes into the removed worktree's path recreates a directory there that nothing
     collects. The tail's wait covers the temp root only.
   - On Darwin every directory temp root a tail meets is kept (§5.2). A link or file leaf is unlinked, as before.
   - Removal compares devices only. So `rm --one-file-system` does cross a bind mount of the SAME file system nested
     inside a leaf, and only root can make one.
   - The removal helper's checks are not atomic with its `rm`. A same-uid rename of another directory onto
     `<root>/<id>` between the two is removed with it. Wave 7's quarantine rename (R57) closes this for the
     collector.
   - The in-use probe reads each process's environment as exec'd, so a TMPDIR set after exec is not seen.
     - A cwd or fd reached through another mount of the same directory has a spelling neither of its compared
       spellings names. `~/.cc-tmp` is a bind mount on the fleet box, and the TMPDIR arm compares ccd's own
       spelling.
     - A pid reused within one walk is read once.
     - A process table whose churn outlasts the walk's time limit reads unmeasured, never nobody.
     - Same-uid non-dumpable processes and other uids' processes are not read.
   - On a git older than 2.43, a tail resume after its own branch CAS can stay `branch-unmeasured` until the branch
     is recreated. The fleet runs 2.43.
   - A branch created between the locked recomputation and the pin is adopted at its pinned tip, as before.
   - A dangling-symlink loose ref that shadows a packed entry reads absent. The branch is then left, never
     deleted: a leak, not a loss.
   - A symbolic registry branch reads unmeasured and is never deleted through. Every branch delete in the tail
     is `update-ref -d --no-deref`.
   - The test harness's git spawns keep the runner's own `HOME` git config.
   - A witness writer's interrupted temp file (`$REG/tmproots/.<id>.*.tmp`) is reaped by nothing.
```

- [ ] **Step 9: The contract: "§12 as built", appended to §12**

Append this text at the very end of `docs/superpowers/programs/child-reclamation-contract.md` (the end of §12, after R59), preceded by one blank line:
```
### §12 as built (wave 6, run 291)

Where wave 6's code and its draft rulings narrowed or spelled out R48–R59, sections 1–11 now read as follows.
This note amends; it edits no earlier text.

- **R5′.** Audit-time journaling is terminal-only, with one exception (R52). `ws-audit --reclaim`'s unmeasured
  answer writes one `failed` `probe-unmeasured` line with verb `ws-audit`. The locked recomputation writes the
  same word with verb `ws-reclaim`. `ws-expire`'s own unmeasured answer stays unjournaled: it is
  workspace-lifecycle's region.
- **R43.**
  - "Exactly these two tokens, by name" now names four: `flock-unavailable`, `lock-unopenable`,
    `token-malformed` and `run-id-malformed`, each in `CHILD_RECLAIM_PRE_LOCK_TOKEN` and its die pattern.
  - "The failures the mirror never sees" are now the usage die, the four `--actor`/`--reason` checks, a
    malformed session id, and `python3` unavailable. Each stays unjournaled for its stated reason.
  - `probe-unmeasured` and `branch-unmeasured` are `failed` lines, read as failure lines with no
    classification. The server's `CHILD_RECLAIM_PROBE_UNMEASURED` is typed `satisfies LcRefusalToken`.
  - `die "bad run id"` was reclaim's alone, so the sanctioned unjournaled set narrows by one.
- **R31's stated cost.** A row whose directory is gone now holds only while neither arm of R54 places it.
  - Two interrupted children whose trees the tail removed release each other through the breadcrumb arm.
  - Two hand-deleted children of one repository release each other through the git-record arm.
  - These still hold: an unreadable `worktrees/` or `gitdir`, two admin entries naming one tree, a locked
    record, a gone parent or one reached through a link, an interrupted expiry's breadcrumb, and a lifecycle
    `create` row alone.
  - R54's "only corroborates" is built as "never an input".
  - A breadcrumb-arm row is placed by its literal spelling, through the same chain.
  - The moved-tree refusal reuses `containment-unproven`, whose copy only approximates that case.
- **R49.**
  - The bound is `WS_RECLAIM_TMPROOT_WAIT_S=15`, lowered only by `CCD_RECLAIM_TMPROOT_WAIT_S`.
  - The probe's walk is bounded by `WS_PATH_USERS_SCAN_S=10`, and an expired walk is unmeasured.
  - The `done` row and the three purge-failure rows carry `meas.tmpRootKept` (`in-use`, `unmeasured` or
    `refused`) and `meas.clipsKept` (`unmeasured` or `refused`), each omitted when nothing was kept.
  - A clips leaf is kept and recorded the same way as a temp root.
  - A same-uid process the kernel will not let ccd read, or another uid's process, is skipped as a stated
    limit, as the expiry probe does.
  - The helper refuses the whole directory leaf while an entry stays unreadable, so nothing is removed in
    part.
  - On Darwin the helper removes with `rm -rfx`.
- **R50.**
  - `run` joins the staleness test.
  - An unparseable witness is stale and is rewritten.
  - `uid=` is recorded only after the owner test proves the leaf is this uid's.
  - A dot-leading id is refused.
  - Birth time comes from `_plat_btime`, in the platform block of both `ccd/ccd` and `ccd/ccrc`.
  - The tail passes no expected device and inode, because the row and the marker prove identity there.
- **R51.** The harness strip is `inheritedEnv()` (`server/test/gitEnvStrip.ts`). It is applied at every
  `process.env` spread, and at every option-less git spawn in the reclaim and expire fixtures.
- **R53.**
  - The token's absence input is spelled `branchState=present|absent`, because a second `branch=` line would
    collide with a branch named `absent`. An unmeasured read mints no token.
  - On old git, the positive fallback reads present for a branch that resolves, and unmeasured for anything
    else.
  - A step-5 read failure is the new `failed` token `branch-unmeasured`.
  - A token minted before the fleet box converged, and spent after it, answers `state-changed` once, on both
    verbs.
- **R55.** `CoordStatus.childReclaimDoneAt` is omitted, never null, while unmeasured. Only a `child` mark
  leaving the listing resets the mirror's clock, and only a reclaim `done` row raises the value.
- **Carried residuals:** spec §7 item 6.
```

- [ ] **Step 10: `_lc_fail`'s header (journal.OPEN6), line-neutral, then re-stamp**

In `ccd/ccd` (`grep -n '^_lc_fail() {' ccd/ccd`, above 19109), find the one line:
```
  # nothing was touched, which is false.
```
Replace it with ONE line:
```
  # nothing was touched, which is false. A probe that ran before any act and could not measure fails too (spec §5.9).
```

Then:
```bash
bash ccd/ccrc restamp ccd/ccd
node shared/mark.mjs --check ccd/ccd; echo "rc=$?"                  # rc=0
git diff --numstat -- ccd/ccd                                       # equal added and deleted counts (the comment line and the stamp line)
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|THE RANGE BOUND')
```

Expected: PASS. The edit is line-neutral above the boundary. If a citation case reds on an anchor at `_lc_fail`, apply S6-R11's procedure with the instrument, name `lc-fail-header-citation` in the wave-done, and never retype an anchor.

- [ ] **Step 11: README: the one sentence that becomes false, line-neutral**

Measure first:
```bash
grep -n 'temp root are already gone\|branch already gone\|journaled nowhere\|journalled nowhere\|two refusals ccd journals\|flock-unavailable' README.md
```
Expected: one hit, the purge paragraph's line `them — is reported after the worktree, branch, clips and temp root are already gone, never as an up-front`. After Task 6 the clips and temp root may be kept, so that line is false. Replace that ONE line with ONE line:
```
  them — is reported once the worktree and branch are gone and the clips and temp root gone or kept, never as an up-front
```
Any other hit is a sentence this wave may have made false. Read it, fix it line-neutrally only if it is false, and name it in the wave-done. README is otherwise untouched by this task.

```bash
git diff --numstat -- README.md     # this task's README edit: 1	1
```

- [ ] **Step 12: Checks, then commit**

```bash
git fetch origin main
(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts test/single-definition.test.ts)
git diff -U0 -- docs README.md ccd/ccd | grep -E '^\+' | grep -cE 'D-[0-9]'      # 0: no D- token added by this task
```
Expected: PASS, and `0`.

```bash
git add docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md \
  docs/superpowers/programs/child-reclamation-contract.md ccd/ccd README.md
git commit -m "docs(child-reclaim): wave 6 — the spec and contract say what the tail now deletes, keeps and journals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Tests:** none new. `ownership`, the citation cases, `deviation-refs`, `dtbd`, `topology-clean` and `single-definition` are its checks.

**Deploy class:** docs, plus one comment line in `ccd/ccd`, which ships with the wave.
### Task 14: Whole-branch verification and the PR

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified, with one exception. If Step 3's re-measurement moves a citation census, `server/test/session-hook.test.ts` and `README.md` change in their own `docs(census)` commit on this branch.

**Interfaces:**
- Consumes: everything Tasks 1–13 produced.
- Produces: the wave-6 branch, pushed, with its PR open against `main`. Landing and the deploy are the coordinator's (Step 8).

- [ ] **Step 1: The FIRST full run after implementation, in the worktree, in the foreground**

This run's verdict is the wave-done's `suite:` line (worker clause 15). Record it before any fix. A red here stays `red` however many fix rounds follow.

```bash
cd server && npm ci && find test -name '*.test.ts' | wc -l
cd server && ./node_modules/.bin/vitest run --shard=1/12
cd server && ./node_modules/.bin/vitest run --shard=2/12
cd server && ./node_modules/.bin/vitest run --shard=3/12
cd server && ./node_modules/.bin/vitest run --shard=4/12
cd server && ./node_modules/.bin/vitest run --shard=5/12
cd server && ./node_modules/.bin/vitest run --shard=6/12
cd server && ./node_modules/.bin/vitest run --shard=7/12
cd server && ./node_modules/.bin/vitest run --shard=8/12
cd server && ./node_modules/.bin/vitest run --shard=9/12
cd server && ./node_modules/.bin/vitest run --shard=10/12
cd server && ./node_modules/.bin/vitest run --shard=11/12
cd server && ./node_modules/.bin/vitest run --shard=12/12
cd agent  && npm ci && npm run test
cd pwa    && npm ci && npm run test
```

How to run them:
- Run each line from the workspace root, in the FOREGROUND, with a timeout of 600000 ms, one after another and never as parallel calls.
- Use ONE denominator for the whole set. If a shard overruns 600 s, re-run the WHOLE set as `--shard=k/24`. Never split one shard alone.
- Record each shard's `Test Files` line, and check that their sum equals the `find` count.
- `agent` is untouched by this wave and must be green unchanged.

Before calling a red a break, re-run it IN ISOLATION if it is one of these:
- `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`;
- `tmp-sweep`, whose "FAILS CLOSED" case reds on the fleet box on an untouched `main`;
- the `ccd-child-reclaim-*` and `ccd-ws-expire-*` suites (181 to 265 s each before this wave);
- this wave's real-process suites (`ccd-path-users`, `ccd-child-reclaim-tmproot-wait`), whose race cases are timing-sensitive under load.

A red that `origin/main` also shows, measured on a clean checkout of it in scratch, is reported once as `main-red` and left alone (worker clause 16).

Also record the wall time of every NEW `ccd-*` suite, and of the existing verb suites Task 6 Step 4 measured, against the 600 s ceiling. A suite at 500 s or more is named in the wave-done, never split here.

- [ ] **Step 2: Type-check, build, and the deviation and token cross-checks**

Each line from the workspace root:

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd pwa    && npm run build
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts \
  test/single-definition.test.ts test/topology-clean.test.ts
git log origin/main..HEAD --format=%B | grep -cE 'D-[0-9]'
git log origin/main..HEAD --format=%B | grep -cE '[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}'
for f in $(git diff --name-only origin/main...HEAD); do
  comm -13 <(git show "origin/main:$f" 2>/dev/null | grep -oE 'D-[0-9]+' | sort -u) \
           <(grep -oE 'D-[0-9]+' "$f" 2>/dev/null | sort -u) | sed "s#^#$f: #"
done
git diff origin/main...HEAD | grep -nE '^\+.*D-[0-9]+ ?(–|\.\.|-) ?(D-)?[0-9]+'
```

Expected:
- The server `tsc` prints nothing.
- `pwa`'s build (`tsc --noEmit && vite build`, what CI's `build-pwa` runs) exits 0.
- The four vitest files PASS.
- Both `grep -c` lines print `0`: no `D-` token and no number range in any commit message.
- The loop prints nothing. This wave adds no `D-` token to any file, and Task 13's edits keep any existing parenthesis as it stood. Anything printed is removed before the push and named in the wave-done.
- The last line prints nothing: no number range in any added line.

- [ ] **Step 3: The stamp, length-neutrality above the boundary, and the citation tax**

```bash
node shared/mark.mjs --check ccd/ccd; echo "mark rc=$?"
git diff -U0 origin/main...HEAD -- ccd/ccd | awk '/^@@/{ split($2,o,","); split($3,n,","); os=substr(o[1],2)+0;
  oc=(o[2]==""?1:o[2]+0); nc=(n[2]==""?1:n[2]+0); if (os<=19109){ d+=nc-oc; print } } END{ print "delta above 19109: " d+0 }'
git diff --numstat origin/main...HEAD -- ccd/ccrc
git diff -U0 origin/main...HEAD -- ccd/ccrc | grep '^@@'; grep -n '^# ── END PLATFORM LAYER\|^# ── PLATFORM LAYER' ccd/ccrc
git diff --name-only origin/main...HEAD -- shared/api.ts README.md server/test/session-hook.test.ts
(cd server && ./node_modules/.bin/vitest run test/ownership.test.ts)
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|THE RANGE BOUND')
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts)
```

Expected:
- `mark rc=0`.
- `delta above 19109: 0`. The printed hunks are the stamp (line 2), Task 7's platform-block edit, Task 10's `cmd_ws_audit` line and Task 13's `_lc_fail` line, each with equal old and new counts.
- `ccd/ccrc`'s numstat reads `3	3`, and its every hunk lies between the two platform-layer sentinels.
- `--name-only` prints `README.md` and `shared/api.ts`, and `session-hook.test.ts` only if a task re-measured the census.
- `ownership` PASSES, the four citation cases PASS, and `session-hook.test.ts` PASSES in full. It is a known load flake, so first re-run in isolation any red that names no anchor this wave moved.

A red here is repaired by S6-R11's procedure with the instrument, in a `docs(census)` commit, and named in the wave-done. Never retype an anchor.

- [ ] **Step 4: The hard boundary: no file outside the wave, no new verb, token, grant or migration**

```bash
git diff --name-only origin/main...HEAD | grep -vE '^(ccd/ccd|ccd/ccrc|shared/api\.ts|README\.md|docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design\.md|docs/superpowers/programs/child-reclamation-contract\.md|server/(src|test)/.+|pwa/(src|test)/.+)$'
git diff --name-only origin/main...HEAD -- agent deploy ccd/ccd-entry.py server/src/coord/schema.ts
git diff -U0 origin/main...HEAD -- ccd/ccd | grep -E '^\+(cmd_[a-z_]+\(\) *\{|.*\b[a-z]+-v[0-9]+\b)'
git diff -U0 origin/main...HEAD -- server/src | grep -E '^\+.*(CCD_ARGV\.[A-Za-z]+ *[:=(]|[A-Z_]+_CAP\b|capSupported\()'
```

Expected: all four print nothing.
- The first proves the wave stayed inside its boundary.
- The second proves no agent grant, no `deploy/` change, no entry-launcher change and no coord.db migration.
- The third proves no new `cmd_*` verb and no new capability token in ccd.
- The fourth proves no new builder or capability gate on the server.

If anything prints, STOP: revert it and name it by slug.

- [ ] **Step 5: The wave's own surface, file by file**

Run each `ccd-*` file on its own line, because each is long:

```bash
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-config-env.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tail-contained.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-path-users.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-leaf-remove.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-tmproot-wait.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-tmproot-witness.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-gone-branch.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-recovery.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-unmeasured-journal.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-prelock-journal.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pin.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts)
(cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts)
(cd server && ./node_modules/.bin/vitest run test/git-env-strip.test.ts test/child-reclaim-done-at.test.ts \
  test/ccd-lifecycle-contain.test.ts test/lifecycle-wire.test.ts test/lifecycle-refusal-word.test.ts \
  test/ccd-refusal-scan.test.ts test/child-reclaim.test.ts test/child-reclaim-status.test.ts \
  test/child-reclaim-sweep-policy.test.ts test/macos-platform.test.ts test/ccd-child-tmpdir.test.ts \
  test/fleetws.test.ts test/wsaudit.test.ts test/ccd-wsaudit-nonpoison.test.ts test/single-definition.test.ts)
(cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-done-reread.test.tsx test/runs-screen.test.tsx)
```

Expected: PASS. Then record:
- the counts each pin now reads, read from the files and never typed: Task 3's destructive-call count, `LIFECYCLE_MEAS_KEYS`, `TOKENS.length` and `SANCTIONED.length`;
- `fleetws.test.ts`'s whole-frame coord pins unchanged from `origin/main`: every one of them (ten at `e79b1da7`; `grep -c "childReclaimAttention: \[\] }" server/test/fleetws.test.ts`, the same count on both trees).

- [ ] **Step 6: Check the commit author before pushing**

```bash
git log origin/main..HEAD --format='%an <%ae> | %cn <%ce>' | sort -u
```

Expected: one line, the workspace's own noreply identity. Any other identity is a STOP: report it, and never rewrite history without a ruling.

- [ ] **Step 7: Push and open the PR, on this workspace's own branch**

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Child reclamation wave 6: what ws-reclaim deletes, repaired — the temp root's wait and witness, contained git, the gone-branch pin, the gone-directory recovery, failures journaled" --body-file - <<'EOF'
Wave 6 of 8 of the child-reclamation programme (CCR-15; spec §5.2, §5.5, §5.6, §5.9, §7, §8), run 291. **AGENT-FIRST:** the `ccd/ccd` half is live when the fleet box converges, and the server + pwa half when the server box does.

**What changes for `ws-reclaim`.**
1. **The temp root no longer comes back.** After the kill, the tail waits at most 15 s until no process of this uid uses the temp root (its `TMPDIR`, its cwd, an open fd), then removes it through ONE removal helper. The helper never follows a leaf link, takes only a real directory this uid owns at exactly root/id, never crosses a file-system boundary, reads every exit code, and proves absence. A temp root still in use or unmeasured, and a clips leaf the helper refuses or cannot measure, are KEPT and recorded on the `done` row (`tmpRootKept`, `clipsKept`). That is not a refusal. This fixes the measured recreation 3.7 s after `reclaim done`.
2. **A positive witness.** `$REG/tmproots/<id>` binds each child's temp root (device, inode, birth time, run, uid) at spawn. It outlives the row, and dies only after its leaf is proven absent. Nothing collects by it yet: the collector is wave 7's, and its lane wave 8's.
3. **Contained git.** The reclaim's git containment drops an inherited `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG` and `GIT_CONFIG_COUNT` before it pins, and the tail's six deleting git calls now run inside it, so no repository hook or fsmonitor runs while it deletes.
4. **A gone branch.** Whether the branch exists is read three ways (`git show-ref --exists`) at every arm, in one act. A proven-absent branch pins HEAD, the WIP commit and every reflog commit, and deletes no branch. A read that did not run is unmeasured at the audit, and `branch-unmeasured` at the tail with the row kept. The token gains `branchState=`. A git older than 2.43 reclaims a standing branch as before and never a gone one.
5. **A gone directory.** A registry row whose workdir is gone stops holding other children only on positive evidence: git's own prunable record, or its own interrupted reclaim's breadcrumb and tombstone. The moved-tree check runs after the nested scan and in the final ownership check. It never prunes, creates or purges.
6. **Journaling.** `probe-unmeasured` is journaled `failed` (verb `ws-reclaim` or `ws-audit`). `token-malformed` and `run-id-malformed` are journaled `refused` after the session id is validated, and are read as pre-lock failures. The usage die, the four `--actor`/`--reason` checks, a malformed session id and a missing `python3` stay unjournaled, each for its stated reason.
7. **The board.** The coord frame carries the newest reclaim `done` the mirror ingested (`childReclaimDoneAt`, optional, omitted until measured; one PWA reader; no `FLEET_PROTO` bump). The board re-reads once per change while a finished chip is unsettled, so a vanish re-read that raced the mirror is corrected. It is not a poll.

**What changes for `ws-expire`.** It shares the containment, the ladder pieces and the tail, so F6, the contained deletes, the helper with its wait and keep (recorded on the `expire` done row), the gone-branch reads and the gone-directory recovery all reach it. Its EXPIRE-region code is unchanged except for three header comment lines of `_ws_expire_cwd_users`. Its own unmeasured answer stays unjournaled. Workspace-lifecycle's coordinator was told before dispatch.

**The live case.** `expoAI-assistant-calm-mesa` has its branch proven absent, HEAD and every reflog commit on `origin/main`, and a clean tree. It fails `pin-failed` on every pass today. Once the fleet box runs this build, the sweep reclaims it with nothing lost. The operator may still recreate the branch at HEAD to reclaim it sooner.

**AGENT-FIRST windows.**
- A token minted before the fleet box converged and spent after answers `state-changed` once per child, on both verbs, because the format gained `branchState=`.
- Until the server box converges, a `token-malformed` or `run-id-malformed` line reads as an unclassified `refused`. The server composes validated argv, so this is inferred unreachable. `failed` lines have no window.
- The board's second trigger arrives with the server box.

**Not in this wave:** no new ccd verb, no capability token (`ccd caps` is unchanged), no agent grant, no coord.db migration, no `deploy/` change. `ccd/ccd` is re-stamped, and it is length-neutral above the frozen citation boundary. `ccd/ccrc`'s platform block gains `_plat_btime`, length-neutral. Every `shared/api.ts` insertion paid README's re-pointing.

**Carried residuals (spec §7 item 6):**
- the manifest, PR-phase and nested-branch reads keep their two-way read;
- a no-branch stash is not attributed when the branch is proven absent;
- a witness's birth time is in whole seconds (wave 7's recycled-slug proof);
- a kept clips leaf has no collector (wave 7's pre-flight);
- a board mounted inside the purge-to-`done` gap keeps a null chip until its next load;
- ccd dying between the purge and `done` leaves a null chip and no attention item;
- `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` pass through the containment;
- a straggler can write into the removed worktree path;
- Darwin keeps every temp root.

**Deploy:** merge, then the prerelease `release-main.yml` publishes, then the fleet's own updater moves the fleet box first and the server box second. Nobody runs `ccrc rollout` or `ccrc update` by hand, and nobody acks an update row but the operator.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Do not merge: landing is the coordinator's (Step 8).

Under `CCRC_SELECTION: enforce`, the PR's CI runs only the server tests the change selects, plus `agent`, `pwa` and `build-pwa` in full, and arbitrates that selection and nothing else.
- Re-run any other red in isolation and report it.
- Never end a turn waiting on CI (worker clause 17).
- macOS legs (`test-macos`, `probe-macos`) gate nothing (operator, 2026-09-28). Report their job ids as found, or UNMEASURED, and never wait on one. If the macOS leg reds on `ccd-child-reclaim-gone-branch`, report that runner's `git --version` (git older than 2.43 is the likely cause).

- [ ] **Step 8: Landing and deploy: the coordinator's, never the worker's**

The worker's part ends at Step 7.
- No session runs `ccrc rollout`, `ccrc update` without `--check`, or an update ack, before or after the merge.
- `~/.local/bin` is not on a fleet unit's PATH, so the coordinator invokes `~/.local/bin/ccrc`, `~/.local/bin/ccd` and `~/.local/bin/ccrc-api` by path.

**Before the merge (the coordinator, read-only).**
1. Read the review report's SAFETY and SECURITY measurements (both lenses are mandatory). A SAFETY finding stops the landing until the coordinator rules.
2. Re-measure the live case read-only on the fleet box: `expoAI-assistant-calm-mesa`'s row, the branch's `git show-ref --exists` rc in its main repository (2 expected), and its HEAD's ancestry from `origin/main`.
3. Confirm workspace-lifecycle's coordinator holds the X2 list (dispatch-time). Tell the operator, before landing, that the reclaim and expiry tails now KEEP a temp root still in use, and record why. The ledger line names this, the live case, and the AGENT-FIRST windows.
4. Land at the measured head, per `ccd/coordinator-skill/references/wave-lifecycle.md` §5. Whether `main` needs the merge queue is measured then, never assumed.

**After the merge (the coordinator observes, read-only).**
1. `release-main.yml` publishes the prerelease.
2. The fleet's updater moves the fleet box first, which is the AGENT-FIRST half, and then the server box.
3. Record:
   - both boxes' versions, from `~/.local/bin/ccrc rollout --check --to <tag>`, which measures and touches nothing;
   - that the fleet box's `~/.local/bin/ccd caps` is unchanged (this wave adds no token);
   - the first reclaim `done` rows, with or without `tmpRootKept` / `clipsKept`;
   - `$REG/tmproots/` gaining files as children spawn (an `ls` count only, never contents);
   - no new id-shaped orphan leaf in `~/.cc-tmp` after a reclaim (`ls` only);
   - the live case's next journal line, `reclaim done` expected;
   - the first board load after the server box converges.
4. A failed or reverted update row halts every move until the operator acks it. The coordinator records it and never acks it. The sweep's kill switch stays `reclaim-pause` on the Runs screen.

Promotion to `stable` is a separate operator act.

- [ ] **Step 9: Report**

Send the wave-done mail to the coordinator, per the `ccrc-worker` skill. It opens with the two signal lines (clause 15):
- `suite:`, from Step 1's FIRST full run;
- `failure:`, only when a check failed.

Then the fingerprint, measured once and sent once (clause 9). Then:
- Step 1's shard lines, their sum against the `find` count, and the `agent` and `pwa` results.
- **Re-run flakes:** each file re-run in isolation, its first and its isolated result, and every `main-red` with the clean-checkout measurement.
- The wall time of each new `ccd-*` suite, and of the verb suites before and after Task 6, against 600 s.
- Step 2's `tsc`, build and cross-check results, the two commit-message counts of `0`, and the added-token loop's output (empty).
- Step 3's `mark rc=0`, the delta above 19109 (`0`) with its hunks, `ccd/ccrc`'s numstat, the citation cases, and every census a task re-measured (with the numbers).
- Step 4's four empty outputs, and Step 5's pinned counts.
- Task 0's outputs (a1) to (l4), the recorded (e8) and (f5) numbers, and `git --version`.
- Each task's mutation table: row → the case that went red.
- **The X2 list,** one line each with its commit sha, for workspace-lifecycle's coordinator:
  - F6 (Task 1) and the contained tail (Task 3);
  - the helper and the wait (Tasks 5 and 6);
  - the gone-branch reads (Task 8);
  - the gone-directory recovery (Task 9);
  - the comment lines in `_ws_expire_cwd_users`' header (Task 6);
  - `ccdWsHelpers.ts`'s in-place strip (Task 2);
  - the platform-block edit in `ccd/ccrc` (Task 7).
- The carried residuals, as the PR body lists them.
- The PR URL, its required checks, and the macOS job ids as found, or UNMEASURED.
- The claims taken, every 409 and how it ended, and every merge of `origin/main` with the clause-16 trigger that licensed it.
- **Departures from this plan, each named by a short kebab-case slug: never a number, never a `D-` token.**

After the wave-done, stop pushing (clause 9). End the turn on the wave-done mail, which asks for the coordinator's answer (clause 17).

**Tests:** none committed by this task. Its checks are the commands above, each with its expected output.

**Deploy class:** AGENT-FIRST, through ccrc's own updater. This task ships nothing on its own.
## Review lenses

These lenses run IN ADDITION to the held-out panel (`ccd/coordinator-skill/references/review-panel.md`), which runs as written (coordinator clause 14). The review brief names that panel.
- Every finding from these lenses gets the panel's refuters, and the majority decides.
- A lens that dies or returns nothing is unverified, never approval.
- Each reviewer reads in its own worktree, at one measured tip (reviewer clauses 3 and 4). The plan text the branch is held to is the blob at `planSha`.
- Every scratch case a lens runs uses fixture HOMEs only, is never committed, and never runs `ccd` against the live `$HOME`.

### 0. SAFETY: what `ws-reclaim` and `ws-expire` delete after this wave (opus, xhigh, MANDATORY)

The destructive subject is this one alone (R48). Read these together, at the tip, against `origin/main`:
- `_ws_reclaim_tail`, whole, in both flavours (`_WS_RCL_ACT` reclaim and expire);
- `_ws_leaf_remove`, `_ws_leaf_uid`, `_ws_tmproot_remove` and the witness writer and reader;
- `_ws_path_users`, `_ws_reclaim_tmproot_wait_s` and `_ws_reclaim_tmproot_quiet`;
- `_ws_reclaim_contained`;
- `_ws_reclaim_branch_state`, `_ws_reclaim_tip_read`, both ladder arms, both pins, the settle and step 5;
- `_ws_reclaim_workdir_shared`, `_ws_reclaim_record`, `_ws_reclaim_recorded`, `_ws_reclaim_recorded_git`, `_ws_reclaim_recorded_crumb`, `_ws_reclaim_moved_check` and `_ws_reclaim_owned`;
- `_child_tmpdir`.

**Re-derive at the tip:**
- **The deletion inventory.** Enumerate every deleting call the tail makes, each with its guard and its order:
  - `git worktree remove`;
  - `update-ref -d`;
  - the branch delete;
  - the helper's `rm`/unlink on the clips and temp-root leaves;
  - the witness `rm -f`;
  - `_reg_purge`.

  Your count of destructive git calls must equal the one Task 3's scan pins. Every one of them runs under `_ws_reclaim_contained`, and none is added outside the tail.
- **The helper.**
  - rc 0 only with absence PROVEN by `_ws_reclaim_absent`.
  - rc 1 touches nothing. rc 2 either touched nothing (a read, or the permission pass, did not run) or follows a removal that failed part-way or was undone, and `_WS_LEAF_WHY` says which; the tail keeps and records what stands.
  - Every exit code is read.
  - A link or file leaf is unlinked, never followed.
  - A directory leaf is taken only when it is a real directory this uid owns (`_ws_leaf_uid`'s `ls -dn`, never a `stat` outside the platform block), with its physical path equal to root/id and a `dev:ino` match when one is given. It is removed never across a file-system boundary: `--one-file-system` (`-x` on Darwin). Both compare `st_dev` alone, so a bind mount of the SAME file system inside the leaf is crossed (GNU rm's documented limit); only root can make one. Confirm the helper's header states it as a residual.
  - A leaf with an entry that stays unreadable is refused whole.
  - The checks are not atomic with the `rm`: a same-uid rename onto `<root>/<id>` between them and the removal is removed with it. Confirm the helper's header states this window (the single-user trust model) and names wave 7's quarantine rename (R57) as what closes it.
- **The wait and keep.**
  - Derive the bound from the constants: at most 15 s, and the override can only lower it.
  - Derive the tail's worst added wall time, the `WS_PATH_USERS_SCAN_S` walk included, against `server/src/remote/runner.ts`'s 240 000 ms per-verb budget. The plan derives about 35 s: the 15 s bound, plus one walk begun just before it (10 s), plus step (6)'s re-ask (10 s).
  - "Nobody" comes only from a completed walk that reached its fixed point (a listing with no unread pid), with every leader whose entries read as vanished asked through its threads; unmeasured always keeps, and so does running out of time.
  - The re-ask comes at the instant of removal.
  - Darwin asks once and keeps a directory leaf that stands.
  - A link or file leaf is never kept for its users: it is unlinked on every platform, and wave 3's pins for it stay unconditional.
  - A kept leaf is recorded on the `done` row and on each purge-failure row, and only while something stands at it.
  - The worktree's removal is unchanged but for the wait.
- **The witness order.**
  - Remove, prove absent, THEN unlink the witness.
  - It is never written on `_child_tmpdir`'s rc 1 or rc 2.
  - Staleness includes `run`.
  - A refused or unmeasured removal leaves the witness byte-identical.
- **F6.** Beneath an outermost containment, `GIT_CONFIG_COUNT` is exactly 3, with the three pins only; a nested one makes 6. The unset sits ABOVE the count's computation.
- **The branch.**
  - Each arm reads three ways in ONE act.
  - An unmeasured read mints no token.
  - The token carries `branchState=`, so a token minted over an unreadable ref can never be spent as absent.
  - Step 5 is three-way, and its failure keeps the row and the breadcrumb.
  - The old-git fallback can answer present or unmeasured, never absent.
  - A HEAD symbolic to a gone branch stays `pin-failed`, before anything is written.
  - A reappearing branch is `branch-moved`.
- **The recovery.**
  - Each arm's conditions are exactly R54's.
  - The never-list holds in all four bodies: no mkdir, no `git worktree prune`, no removal of an admin directory, no purge, no `/proc`, pane, tmux or unit read, no leaf link followed, and no unreadable record read as none.
  - The moved-tree question is asked after the nested scan and again in `_ws_reclaim_owned`.

**Cases the reviewer runs itself (built independently of the worker's harness, in scratch):**
- **Straggler races.**
  - Run seeds 1 to at least 50.
  - Each seed spawns 1 to 4 processes that use the leaf by `TMPDIR`, by cwd or by an open fd, and exit at a random time from 0 to 20 s after the kill. One per seed recreates the leaf on exit. One per seed HOPS: every few milliseconds it forks its successor (which inherits `TMPDIR=<leaf>`) and exits, until its own random exit time. On at least five seeds, one process is a thread-group leader that calls `pthread_exit` while another of its threads keeps writing into the leaf.
  - Run each seed under `reclaim` and under `expire`.
  - Report per seed and in total:
    - (i) removals while a user lived: must be 0;
    - (ii) leaves that stand again after `done` where every user exited inside the bound: must be 0;
    - (iii) kept-and-recorded leaves, against the users that outlived the bound: they must agree;
    - (iv) the added wall time, against the derived worst case.
- **Ref states × arms.**
  - The states:
    - present;
    - absent;
    - a corrupt loose ref;
    - a mode-000 `refs/heads`;
    - an unreadable `packed-refs`;
    - present under an old-git shim (rc 129 on `--exists`);
    - absent under the shim;
    - a ref created between the in-lock ladder and the fresh pin;
    - a ref recreated after the tombstone.
  - The arms: the ladder's present arm, the ladder's vanished arm, the fresh pin, the vanished pin, the settle, and the tail's step 5.
  - Tabulate every cell. Only a proven-absent state proceeds with no tip. Every unreadable cell ends unmeasured, `pin-failed` or `branch-unmeasured`. No cell deletes a branch except at its pinned tip. No token minted over an unreadable state is accepted at spend.
- **Gone-row shapes.**
  - The shapes:
    - an `rm`'d tree;
    - a tree `mv`'d within its repository;
    - a tree `mv`'d into the child;
    - two admin entries naming one path;
    - a locked record;
    - a gone parent;
    - a parent reached through a link;
    - a leaf link;
    - an unreadable `worktrees/`;
    - an unreadable `gitdir`;
    - the breadcrumb phases {branch, artifacts, clips} × the tombstone's `worktree` {present, absent} × a uuid or workdir that does and does not match;
    - `expire:` breadcrumbs;
    - a lifecycle `create` row alone.
  - Run each through the audit, the locked recomputation and `_ws_reclaim_owned`.
  - A hold releases only on the two arms. Every other shape keeps `unmeasured` or `containment-unproven`. No prune, mkdir or removal is ever observed, so put a git shim on `worktree prune` that fails loudly.

**Mutation re-checks.** Each mutation must red its named case:
- the wait removed → `THE SWIFT-HOLLOW RACE`;
- the helper ignoring `rm`'s exit code → `an rm that fails … is UNMEASURED`;
- the probe's walk back to ONE listing → `a pid that only a SECOND listing holds`;
- the probe's task walk dropped → `a thread-group LEADER that exited before its threads`;
- a thread in exit read as unmeasured → the CONTROL of `a LIVE thread’s entry this uid may not read`;
- step (6)'s link-or-file bypass dropped → the `link` and `file` leaf cases in `ccd-child-reclaim-tmproot-wait.test.ts`;
- F6's unset moved below the count → the F6 describe;
- one tail call uncontained → the six-call scan;
- step 5 back to two-way → `step 5: a branch the tail cannot read stops it`;
- the fallback answering absent → the old-git gone case;
- the git-record arm without the prunable test → `a locked record is never prunable`;
- the breadcrumb arm without the tombstone check → the `VARIANTS` row;
- the witness unlinked before the leaf is proven absent → `the leaf goes FIRST`.

### 1. SECURITY: authority files, environments and paths (opus, high, MANDATORY)

Re-derive at the tip:
- **The witness as an authority file in a single-user trust model.**
  - Any process of this uid can write `$REG/tmproots/<id>`. State what a forged witness buys in THIS wave: no collector reads it, and the tail's unlink follows only its own proven-absent leaf. State what it would buy wave 7, given the `dev`/`ino`/`btime` binding.
  - The writer:
    - writes a dot-leading temp file inside `tmproots/` and `mv`s it;
    - refuses a directory or link at the witness path;
    - never follows a link;
    - validates the id: no dot-leading id, no `/`, the run-id grammar;
    - never writes on rc 1 or rc 2.
  - The reader gives three answers and never follows a link.
  - Re-run the walker census: every registry glob in shipped shell is suffix-shaped, and every registry `find` is depth-1 and name-filtered, so `tmproots/` is invisible to `_reg_purge`, `_ws_slug_free`, `cmd_ls` and the server's registry readers.
- **Environ reading.**
  - `/proc/<pid>/environ` is split on NUL by python3.
  - `TMPDIR` is compared in its literal and physical spellings.
  - The same uid is established by the status `Uid` line.
  - A pid that vanished is skipped as proof that it is gone, and the table is listed again until a listing names no unread pid (the fixed point), so a vanished process's successor is still read. A leader whose own entries read as vanished is asked through `task/<tid>`, and a thread entry unreadable for any reason but vanishing is unmeasured. An unparseable status is unmeasured. Non-dumpable and other-uid processes are skipped as a stated limit. The walk is bounded, and running out of time is unmeasured.
  - The stated limit also names two shapes: a TMPDIR set after exec (`environ` is the exec-time block), and a cwd or fd reached through ANOTHER MOUNT of the same directory. `~/.cc-tmp` is a bind mount on the fleet box and its device is mounted whole elsewhere, so that spelling is never compared; the TMPDIR arm compares ccd's own spelling, the one `_child_tmpdir` composes. Confirm the probe's header states both.
  - Confirm what reaches stderr, a `_WS_PATH_USERS_WHY`, a journal `detail` or a `meas` value: pids, the kind of use, and the path the use names, which is the leaf or a path under it by construction (`under()`), with tabs and newlines replaced. Nothing outside the leaf is reported, no other environment variable is ever read out, and no environ VALUE beyond that TMPDIR path. Grep the tip for every write of those variables.
- **Inherited git environment.**
  - F6's three names are unset in the outermost block only, above the count.
  - Diff git's `--local-env-vars` list against the containment's unset list on the reviewer's own git.
  - What still passes is `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM`, a residual: confirm it is stated.
  - `inheritedEnv()` is never inside `ghContainedEnv`.
  - Task 2's scan binds the fixture files it names.
  - `_ws_reclaim_branch_state` reads the repository it is named, under the containment.
- **Path resolution and link following.**
  - The helper resolves the ROOT physically. A root link to a data volume is followed by design; state why that is safe.
  - The LEAF is never followed. The physical path must equal root/id. The owner is read by `_ws_leaf_uid`'s `ls -dn`, which never follows the leaf (not `stat`, which the platform sweep refuses outside the block). The removal never crosses a file-system boundary; a same-file-system bind mount inside a leaf is the stated residual (only root can make one).
  - The recovery places by literal spelling, and requires a `complete` resolution of the parent. It follows no leaf link.
  - `_child_tmpdir`'s rc 2 arm (a symlinked leaf) is unchanged.
- **The platform block.**
  - `_plat_btime` is byte-identical in `ccd/ccd` and `ccd/ccrc`, and it is the only new `stat` format use. No `stat -c` or `stat -f` appears outside the block (`macos-platform.test.ts`).
  - The edit is length-neutral, and `ccd/ccrc` changes nowhere else.
- **Argv validation order (Task 11).**
  - The session id is validated before any journal write, and no journal line names an id that has not passed its shape check.
  - The `detail` is the fixed text (`bad token` / `bad run id`), never the rejected value.
  - The `--actor`/`--reason` dies stay before any id is bound.

### 2. Derivation and wire (opus, high)

Re-derive at the tip:
- **Journal tokens.**
  - Derive `LcRefusalToken` from `shared/api.ts`, and compare it with `ALL_TOKENS`, the `LC_REFUSAL_WORD` keys, the literal ccd call sites (`git grep` each of `branch-unmeasured`, `probe-unmeasured`, `token-malformed` and `run-id-malformed`), and `SENTENCES` (disjoint).
  - `CHILD_RECLAIM_PRE_LOCK_TOKEN` has exactly four entries, with their die patterns.
  - `CHILD_RECLAIM_TOKEN_KIND`, `childReclaimTokenKind` and `childReclaimTerminalRefusal` are byte-identical to `origin/main`.
  - `CHILD_RECLAIM_PROBE_UNMEASURED` is `satisfies LcRefusalToken`.
  - Each sentence is true at its site. `branch-unmeasured`'s, at step 5, comes after the worktree is gone. `probe-unmeasured`'s holds at both arms.
  - No comment spells a token-harvesting shape (`_reap_refuse <tok>`, `"refused":"<tok>"`).
- **Meas keys.**
  - `LIFECYCLE_MEAS_KEYS` is derived, not typed.
  - ccd's emitted `meas.` keys equal L0's (the lifecycle-contain census), and `reviveMeas` carries both new keys.
  - Each value is from `in-use | unmeasured | refused`.
  - The encoder's omission of an empty value means "nothing kept", which no reader confuses with unmeasured.
- **The token format.** `branchState=` follows `tip=` in both ladder fingerprints. State the one-`state-changed`-per-child AGENT-FIRST window on both verbs.
- **The coord field.**
  - `CoordStatus.childReclaimDoneAt?` is optional, and OMITTED (never null) while unmeasured.
  - There is ONE PWA reader, by scan.
  - `FLEET_PROTO` is unchanged, and `fleetws.test.ts`'s whole-frame pins are unchanged.
  - The value is raised only after `ingestJournal` returns, only by a reclaim `done` row, and only ever rises.
  - `emitCoord`'s byte-equality guard emits once per change.
- **Rings.**
  - `mirrorplan.ts` and `childReclaim.ts` stay pure.
  - `watch.ts` only wires: it calls `childMarkLeftListing`, sets `lastLifecycleSweep = 0`, and adds no await to the tick.
  - `shared/api.ts` imports nothing new.

### 3. PWA and cost (sonnet, high)

Re-derive at the tip:
- **The board.**
  - A re-read happens only when `childReclaimDoneAt` CHANGES (from a non-null value) and some finished row is unsettled.
  - The first frame, a null value and an older server's frames never read.
  - The re-read count per hour stays bounded by the measured reclaim rate (about 6 per hour). State the worst case with R55's disclosed residual: a chipless row in the had-child set re-reads once per change while the board stays open.
- **The tick.** No await is added. The mirror's 5 s cadence is unchanged except on a child-marked id leaving the listing, and an unlistable tick resets nothing.
- **ccd cost.**
  - Measure the tail's added wall time per reclaim on a process table of fleet size (about 20 sessions' processes): two process-table walks plus the wait. Set it against the runner's 240 000 ms.
  - Measure the witness write's cost per spawn: one `stat` and, at most, one `mv`.
  - Read the suites' wall times from the wave-done against the 600 s ceiling.
- **Darwin.** The accumulation of kept temp roots is stated in the spec (§5.2). No Darwin path removes a temp root.
## Deviations found

Numbers are ISSUED, never chosen. Wave 6's block was allocated at run 291's open (2026-10-06). It is twenty-four single numbers: 4126, 4127, 4128, 4129, 4130, 4131, 4132, 4133, 4134, 4135, 4136, 4137, 4138, 4139, 4140, 4141, 4142, 4143, 4144, 4145, 4146, 4147, 4148 and 4149. None is written as a range. None appears as a `D-` token anywhere until the coordinator defines it in this section. Fix round 1 (review 335) defined eight more numbers the coordinator issued, listed singly: 4455, 4456, 4457, 4458, 4459, 4460, 4461 and 4462.

- The worker never calls the allocator (worker clause 11; coordinator clause 10).
- A departure from this plan is named by a short kebab-case slug in the wave-done mail. It is never given a number, and never written as a `D-` token.
- The worker writes no `D-` token for a number that `origin/main` does not define, and puts none in a commit message.
- The coordinator assigns each departure a number from this block and defines it here, number and definition in one act.
- A session that cannot reach the coordinator names the slug in its report and says why.
- The drafters' departures that the coordinator accepted before dispatch are ruling text, and Task 13's "§12 as built" note records them. They take a number only if the coordinator assigns one here. Those departures are `branch-absent-input-spelled-branchState`, `old-git-fails-closed-unmeasured-not-pin-failed`, `clips-kept-recorded`, `expire-probe-header-comment`, `witness-malformed-is-stale`, `witness-uid-by-owner-test`, `witness-refuses-dot-leading-id`, `create-row-never-read` and `expire-breadcrumb-not-recovered`.

- **D-4126** `create-row-never-read` (Task 9) — R54's draft says a lifecycle `create` row "only corroborates" the
  recovery's evidence. As built, nothing in the gone-directory recovery reads the lifecycle journal at all, so a
  `create` row neither corroborates nor decides, and a row with a `create` row alone keeps the hold. Ruled at
  dispatch. It fails closed: the cost is a hold kept where a `create` row could have corroborated. It is pinned by the
  case "a lifecycle create row alone keeps the hold" and by the recovery scan's line that forbids a read of the
  lifecycle journal.
- **D-4127** `expire-breadcrumb-not-recovered` (Task 9) — the breadcrumb arm accepts only the phases `branch`,
  `artifacts` or `clips`, and never an `expire:` phase, so an interrupted expiry's gone row still holds other
  children, and ws-expire's own interrupted act is no evidence that releases it. Ruled at dispatch. It fails closed:
  such a row holds until its expiry is resumed or its row is purged. It is pinned by the variant "an expiry's
  breadcrumb (expire:branch) keeps the hold".
- **D-4128** `leaf-mount-point-refused` (Task 5) — the plan's removal helper checks identity only. As built,
  `_ws_leaf_remove` also refuses a leaf that is itself a mount point of another file system (its device is not its
  root's), compared before any chmod or rm. `rm --one-file-system` measures from its own argument, so a session's own
  FUSE or sshfs mount at its TMPDIR would have been emptied before the final rmdir failed. The coordinator accepted it
  in principle in mail 3802. The limit is that both comparisons use `st_dev` alone: a bind mount of the same file
  system at the leaf is not seen, and neither is a mount made at the leaf after the check, during the permission pass.
- **D-4129** `leaf-root-empty-or-slash-refused` (Task 5) — the helper refuses an empty root and a root that resolves
  to `/`, because the leaf would then be `/<id>`. The answer is unmeasured (rc 2). ccd never passes either, so the
  guard is defence in depth, and a case reds when it is dropped. Fix round 1 extends the same refusal to a root whose
  physical path holds a newline (`leaf-root-newline-refused`).
- **D-4130** `leaf-reason-capped` (Task 5) — each kept leaf's reason reaches the journal as one short line: control
  bytes and bytes 0x80 to 0xFF read "?", ccd's own dash is kept readable, and the line is cut at 300 bytes and marked
  with a trailing "…". A reason can carry a name the session chose and the first line of `rm`'s stderr, and past the
  journal's line cap the encoder drops the whole `meas` object, which would cost the row `childOf`, `branch`, `tip`
  and both kept keys. The helper's `_WS_LEAF_WHY` stays raw, and the clean and the cut happen where the tail journals
  it (`_ws_leaf_why_line`), because a cut at the source would cut the helper's own reasons on a long HOME. A later
  caller, wave 7's collector among them, owes the same call. The limit: a non-ASCII name reads "?". The ladder's own
  raw refusal detail is wave 3's code, uncapped, and carried.
- **D-4131** `tmproot-wait-ask-cap` (Task 6) — the tail's wait for the pane's processes ends by the clock or after
  `bound*4+1` asks, whichever comes first, where the plan ends it by the clock alone, which a backward step can
  stretch without limit. The count never shortens a wait the clock allows. The cost: under a frozen clock with every
  walk running out its 10 s bound, the wait reaches about 625 s. That is past the 240 s remote budget, but a remote
  kill lands in the wait, before any deletion, and the breadcrumb resumes. The measured worst case with a working
  clock is about 35 to 41 s.
- **D-4132** `tmproot-link-refused-everywhere` (Task 7) — a linked `$REG/tmproots` is refused everywhere the plan
  reaches it: the writer refuses it, the reader answers rc 2, and the remover warns and leaves what it reaches. The
  plan gave only the writer a check. Review 335 (F7) added the record: the writer's two `tmproots/` link checks (`[[ !
  -L "$dir" ]] || return 1` and `[[ -d "$dir" && ! -L "$dir" ]]`) are each other's defence in depth, because `mkdir
  -p` through a dangling link fails with EEXIST. Deleting either one alone leaves the witness suite green, and
  removing both reds it, so the two are pinned only together. That corrects the commit message of e5effb842, which
  claimed each guard was pinned alone. It is recorded, not fixed.
- **D-4133** `branch-state-consent-both-ways` (Task 8) — the plan's token carries `branchState=` and the locked
  recomputation checks it, but the pin then reads the branch again on its own. Another actor may delete or create the
  branch between the two reads, and the pin would act on what it read, not on what the token consented to. As built,
  the two reads must agree in both directions, or the act stops before the tombstone as `state-changed`. The cost is
  one retry. The limits: `ws-expire` keeps the recomputation-to-pin window, because `_ws_expire_locked` is
  workspace-lifecycle's, so a branch created there is still adopted at its pinned tip. A tip that moves while the
  branch stays present is still taken over, bounded by the delete's compare-and-swap.
- **D-4134** `branchstate-mismatch-is-a-failed-line` (Task 8) — the ruling says "refuse `state-changed`". As built it
  is a `failed` line carrying the token (`{"failed":"state-changed",…}`, exit 1, journaled `failed`), not a
  `{"refused":…}` document at exit 0. The intent row is already journaled when the pin runs, the region's refusal
  emits are pinned at exactly two by `ccd-refusal-scan` (a third is a refusal path that bypasses the verdict point),
  and `pin-failed` already takes this shape at this point. `state-changed` is a `SENTENCES` key, so the vocabulary
  scan accepts the literal, and the board renders a `failed` audit-token row as `deferred` with that token's sentence.
  No breadcrumb is written, so the next attempt re-audits and mints over the true state. The server first read this
  line as resumable, which was wrong, and `pre-breadcrumb-state-changed-not-resumable` corrects it.
- **D-4135** `crumb-arm-proves-no-admin-entry` (Task 9) — the breadcrumb arm also proves that git holds no admin entry
  for the tree, asked of the git-record arm's own reader. Git's list silently omits a record whose `gitdir` it cannot
  read, so "no record" alone would read an unreadable record as none. An unreadable `gitdir` or `worktrees/` therefore
  keeps the hold. It fails closed: the cost is a hold kept where the evidence cannot be read. The breadcrumb arm's
  `gitdir:` loop has a red case: an admin `gitdir` of two lines holds the row.
- **D-4136** `probe-unmeasured-word-scoped-to-attempt` (Task 10) — the `probe-unmeasured` sentence in
  `LC_REFUSAL_WORD` is scoped to the attempt that measured it: "this attempt started nothing and removed nothing. The
  next attempt measures again from the start." A resumed arm's earlier attempt may have removed something, so the
  unscoped sentence was false there. The final fix round made the change, line-neutral in `shared/api.ts`, and the
  comment on `branch-unmeasured` now names ws-reclaim and ws-expire, because expire shares the step that prints it. A
  case pins that the word is true of both arms.
- **D-4137** `strip-scan-arms-pinned` (Task 2) — the plan's verbatim CONTROL list and 13-row mutation table left three
  arms of the environment-strip scan with no case that reds when the arm is deleted. Mutation-table discipline governs
  over the verbatim text, so the scan's CONTROL plants a whole-environment copy through `Object.entries(process.env)`,
  an `execFile` call, a `spawn` call and a double-quoted `'git'` command, with three more expected hits and three more
  mutation rows. The git-spawn match accepts any quote, and the residual note in `gitEnvStrip.ts` also names
  `GIT_TEMPLATE_DIR` and `GIT_EXEC_PATH`, kept variables outside git's local list that reach the fixture repositories.
  The cost is three more CONTROL lines and rows. The strip's behaviour is unchanged.
- **D-4138** `shim-unbound-under-set-u`, `tail-no-deref-pinned` (Task 3) — two plan-text corrections. The plan's
  `SHIM` tests `"$3 $4"` whenever `$1 == -C`, and ccd is sourced under `set -uo pipefail`, so the first three-argument
  `git -C <dir> <verb>` call (the pin phase's `write-tree` is one) aborted the shim with an unbound `$4`, and every
  shim arm failed `pin-failed` before it reached the tail. The guard reads `"${3-} ${4-}"` in both comparisons. The
  plan called the missing `--no-deref` pin on the branch compare-and-swaps a disclosed survivor, and mutation
  discipline governs, so the tail scan now reds when either branch compare-and-swap drops `--no-deref`. Its classifier
  also reads `update-ref` with `-d` after another flag, `update-ref --stdin`, `branch --delete` and a call split over
  a line continuation, with a CONTROL that plants each spelling and the remaining blind spots named in its comment.
  The ws-expire hook-run case gains the CONTROL the reclaim arms carry. The cost is two mutation rows and a few
  assertions.
- **D-4139** `path-users-fail-closed-pinned` (Task 4) — five guards of `_ws_path_users` that answer unmeasured had no
  case that reds when the guard fails open: a locked thread whose stat does not parse, the same with its stat
  unreadable, a `task/` that cannot be listed, a relisting that fails, and the catch-all. Mutation discipline governs
  over the plan's text, so each has a fake-table case asserting rc 2 and a mutation row. Every C0 control byte and DEL
  in a reported path now reads "?", where the plan cleaned a tab and a newline only. The unsearchable-parent case
  asserts the absence guard's own words, so the `cd` behind it cannot stand in for it. The limits paragraph names
  three more shapes: the environment is live memory, a leader caught inside its own exit, and a non-leader thread with
  its own cwd or fd table.
- **D-4140** `journalparse-line-neutral`, `helper-header-no-r57`, `leaf-remove-guards-pinned`, `leaf-why-dash-kept-readable`, `mount-check-after-identity` (Task 5) — five
  plan-text corrections.
  - **`journalparse-line-neutral`.** The plan inserts a new `tmpRootKept`/`clipsKept` line below `residueBytes` in
    `journalparse.ts`. The two keys are appended onto the existing `residueBytes` line instead, so the frozen-cited
    `refusal: s(o, 'refusal')` line keeps its number.
  - **`helper-header-no-r57`.** The helper's header no longer ends "quarantine rename (R57)". The spec has no section
    on the quarantine rename, so the rule is stated in words.
  - **`leaf-remove-guards-pinned`.** Each guard in `_ws_leaf_remove` that could not ask (the root's resolution, this
    uid, the owner, entering the leaf, its identity, the final proof) has a case that answers unmeasured for its own
    reason. Dropped, a guard used to prove a leaf absent at `/` or to refuse for a reason that was not true. Every
    purge-failure arm is pinned to carry both kept keys.
  - **`leaf-why-dash-kept-readable`.** Before the `tr` that makes a kept reason printable ASCII, ccd's own dash is
    mapped to "-", because the `tr` would otherwise turn it into "???". Other non-ASCII still reads "?".
  - **`mount-check-after-identity`.** The mount check sits directly above the owner-bits pass, after the owner and
    device-and-inode checks, where the ruling said "before any chmod or rm". Placed first in the arm it answered
    before the device-and-inode read, and the case "the identity of" went red. Both orders refuse a mount before
    anything is touched.
- **D-4141** `step6-reasons-through-why-line`, `r49-cited-as-spec`, `tmproot-wait-bound-timed`, `m2-count-masks-x10-in-the-verb-case` (Task 6) — four
  plan-text corrections.
  - **`step6-reasons-through-why-line`.** The plan's step (6) stores raw reasons in `tmpwhy`. Task 5's fix rounds made
    `_ws_leaf_why_line` the one way a kept reason reaches the done row, so all five assignments read
    `tmpwhy=$(_ws_leaf_why_line "…")`, and the in-use sentence's dash is journaled as "-".
  - **`r49-cited-as-spec`.** The plan's comment on the wait's constant and its two Darwin test comments cite the
    contract's number for the wait's bound. They read "(spec §5.6)" instead, as a spelling rule.
  - **`tmproot-wait-bound-timed`.** The plan's tests time the verb, which takes seconds of fixture work. The wait
    itself is timed through a pre-wrapped `_ws_path_users` log, with a ×10 row, a row for the base-10 bound (`010` and
    `08`), a frozen-clock pin and a pin that the clock ends a slow wait.
  - **`m2-count-masks-x10-in-the-verb-case`.** The ×10 row reds only the slow-probe unit case added for it, not the
    verb case, because the ask-count cap (`tmproot-wait-ask-cap`) masks it there. No code was bent.
- **D-4142** `btime-stub-printf-dashdash`, plus mutation rows 11 and 20 re-cut (Task 7) — the plan's stub
  `_plat_btime() { printf '%s' -- '${bt}'; }` prints `--0`, because `printf` takes its format first and `--` is an
  argument. The writer would reject it and write nothing, so the two "keeps none" rows would fail whatever the code
  did. The stub is `printf '%s' '${bt}'`. Row 11 (`|| bt=-`) survives green, because the next line's `^-?[0-9]+$`
  rejects `-`, so it is re-cut to `|| bt=0`, which passes validation, is folded to `-` and writes a witness silently,
  and it reds on the row's stated assertion that unmeasured must never become `-`. Row 20's walker `describe` finds
  the witness through `_ws_tmproot_witness_file`, not the hard-coded `tmproots/<id>`, so `_reg_purge` is really asked
  and takes the misplaced witness. The plan's second predicted red there (`_ws_slug_free` reading taken for free)
  cannot occur, so row 20 pins the walker's blindness through `_reg_purge` only.
- **D-4143** `branch-state-guards-pinned`, `old-git-shim-cases-partly-guarded` (Task 8) — two plan-text corrections.
  The plan disclosed two guards in `_ws_reclaim_branch_state` as unpinnable equivalent mutants: an empty branch name
  is never read as absent, and a sha that is not 40 hex is never read as present. A `PATH` git shim that lies at both
  guards pins them, with mutation rows 19 and 20. The ruling said the old-git shim cases stay unconditional. Two of
  the three need a real `show-ref --exists` answering 2 for their CONTROL (one also mints its token with real git), so
  they run under a git of 2.43 or later. Only the case that reclaims a standing branch exactly as today needs none,
  and it runs on every git.
- **D-4144** `test-comments-cite-the-spec`, `prune-shim-spawn-takes-inherited-env`, `crumb-phase-list-named-per-verb`, `ladder-fixture-insertion-is-six-lines` (Task 9) — four
  plan-text corrections.
  - **`test-comments-cite-the-spec`.** The plan's test comments cite the contract. They cite the spec instead (§5.5
    for R54 and for R31's stated cost of the hold), and the file-split rule is stated in words. This is a spelling
    rule.
  - **`prune-shim-spawn-takes-inherited-env`.** The prune-shim case's `execFileSync('sh', ['-c', 'command -v git'],
    …)` passes `env: inheritedEnv()`, so `process.env` is never spread.
  - **`crumb-phase-list-named-per-verb`.** The plan's file-header comment says the phase is `branch`, `artifacts` or
    `clips`. ws-reap writes `children`, `worktree`, `branch` and `clips`, with no `artifacts` phase, so the comment
    names the phases per verb. Only the comment changed.
  - **`ladder-fixture-insertion-is-six-lines`.** The plan calls the ladder test's edit "one fixture line". The real
    insertion after `fs.rmSync(otherWt, …)` is six lines, a three-line comment, the `git worktree prune` line and a
    two-line CONTROL, and the block comment turns one line into two.
- **D-4145** `verb-test-snapshots-carry-the-journal-line` (Task 10) — the plan's file list omits
  `server/test/ccd-child-reclaim-verb.test.ts`, yet its Step 5 runs that file and expects it to pass. Five cases there
  compare the verb's snapshot before and after the locked unmeasured answer, and the snapshot includes the lifecycle
  journal's reclaim rows, which were empty and are now exactly one `failed probe-unmeasured ws-reclaim` row. One
  test-local helper, `sansTheFailure`, asserts that the journal is exactly that one row and returns the snapshot with
  it emptied, and the three call sites wrap their snapshot in it. Everything else the snapshot compares is still
  compared with `toEqual`. A mutation row proves the helper is live.
- **D-4146** `spec-hold-bullet-placement`, `spec-5-7-keep-wording` (Task 13) — two plan-text corrections, and fix
  round 1 folds two findings of review 335 into this number.
  - **`spec-hold-bullet-placement`.** The plan puts the recovery text in the middle of the spec's hold bullet,
    directly after its first ledger citation. That rewraps the two lines that carry the existing ledger parentheses,
    so they would read as added lines, and it leaves "it" in "ends it unsafely" pointing at the wrong thing. The text
    goes after the bullet's last sentence, on its own lines, with the original lines byte-identical. The plan's §7
    bullet about a branch created between the recomputation and the pin is replaced, because Task 8 now stops
    `state-changed` there.
  - **`spec-5-7-keep-wording`.** In §5.7 "keep" becomes "leave … alone", so the carved-out sentence stays coherent.
  - **F5, the old-git residual, stated completely.** On a git older than 2.43, a resume whose branch is already gone
    fails closed on every retry, at one of two places. At the tail's branch step it reads `unmeasured`
    (`branch-unmeasured`). If the branch was present at the pin and someone deletes it after the tombstone, a resume
    that enters at `children` or `worktree` never reaches that step. The settle's pin reads unmeasured and stops
    `pin-failed` on every retry, with the tree, the breadcrumb and the row standing and nothing deleted: a leak,
    retried for ever, on old git only. R53's "never `pin-failed`" therefore holds on the fresh path only. The "§12 as
    built" note states both shapes, and the same sentence is in spec §7 item 6.
  - **F14, comment-only truth fixes outside Task 13's Files list.** `_ws_reclaim_workdir_shared`'s header (two lines,
    the breadcrumb arm's "compared as text" qualifier), `cmd_ws_reclaim`'s entry comment ("a shape ccrc mints" became
    "a registry-safe charset (no `/`)"), the audit comment in `watch.ts`, and `childReclaimSweep.ts`'s "the one
    window", which became "the windows". All sit below the 19109 boundary, and the citation census re-ran green.
- **D-4147** `full-run-48-shards-big-files-by-describe`, `lc-refuse-comment-own-line`, `witness-suite-on-disposition-list` (Task 14) — the
  first full run measured one departure from the brief and found two static scans that no task-level run exercised.
  - **`full-run-48-shards-big-files-by-describe`.** The plan's Step 1 full run overran the 600 s foreground ceiling at
    /12 and again at /24, so the whole set re-ran at /48. Two shards each held one unchanged file
    (`ccrc-install.test.ts` and `ccrc-doctor.test.ts`) whose own wall time exceeds the cap, so those were run file by
    file, the two big files by `-t` describe filter in two and four calls. Every test ran and passed (296 and 759).
    That splits a shard, which the brief forbade, and it is recorded here.
  - **`lc-refuse-comment-own-line`.** `cmd_ws_reclaim`'s run-id refusal carried a trailing comment, which the
    `_lc_refuse` arity scan in `ccd-lifecycle-purge` read as a fifth positional. The comment moved to its own line
    above, with ccd re-stamped.
  - **`witness-suite-on-disposition-list`.** The witness suite names `_ws_slug_residue` in a case title and an
    assertion, and the disposition census in `ccd-workspaces.test.ts` scans every server test line for that name, so
    the suite gets one entry, counted at 2 lines.
- **D-4148** `leaf-owner-bits-pass` (Task 5) — `_ws_leaf_remove` runs `find -P <leaf> -maxdepth 0 -type d -user <me> !
  -perm -u=rwx -exec chmod u+rwx {} +` on a directory leaf before entering it, which the plan's helper does not.
  Review 335 (F13) found it on neither list, and it is the largest plan-versus-tip difference in that function.
  - **Why.** Asking the leaf's physical path means entering it, and a mode-000 leaf this uid owns would otherwise be
    kept for ever, never reached by the normalise pass below it, so wave 7's collector would meet it on every pass.
    The `{} +` form is deliberate: with `\;` find answers 0 over a chmod that failed, and now a failed chmod reaches
    find's exit code and answers unmeasured for that reason.
  - **Placement.** The pass follows the owner, device-and-inode and mount checks, so those refusals touch nothing. It
    precedes the checkout question (`leaf-moved-checkout-refused`), which must enter the leaf, so a leaf that question
    then refuses has had its own owner bits set and nothing beneath it. A foreign tree moved in AS the leaf has its
    root's owner bits set (555 reads 755 afterwards) even when it is then refused.
  - **The stated residual.** `find -P` never follows a link, but the chmod it runs dereferences its operand. The pass
    is bounded to this uid's own directory and owner bits, and a same-uid rename onto the leaf between find's test and
    the chmod is chmodded with it.
- **D-4149** `leaf-moved-checkout-refused` (Fix round 1) — the removal helper declines to remove a directory leaf that
  holds a checkout git links to somewhere else: it answers refused or unmeasured, and the tail keeps the leaf. This is
  Rule 1 of review 335's F1; Rule 2 is `leaf-rows-are-nested`. Between them they close the two leaves. The worktree's
  own moved-tree check is unchanged and still asks only of the worktree.
  - **The defect.** The gone-directory recovery let another workspace's tree be deleted once someone had moved it into
    the child's temp root or clips directory. Git records the moved tree as prunable, the recovery places its row by
    that record, the moved-tree question was asked only of the child's worktree, and step 6 removed both leaves whole.
    On base the same shape held the child unmeasured. "Inside the child" means all three trees the tail deletes: the
    worktree, `~/.cc-clips/<id>` and `~/.cc-tmp/<id>`.
  - **Where it lives.** `_ws_leaf_remove` asks `_ws_leaf_checkouts` of every DIRECTORY leaf, after the identity checks
    (real directory, owner, device and inode, mount, owner bits, physical path) and before it normalises or removes
    anything. The question is row-agnostic and is asked at the instant of removal, so every caller inherits it: step
    6's clips leaf, `_ws_tmproot_remove`, ws-expire's clips leaf and wave 7's collector. Rc 1 (refused) and rc 2
    (unmeasured) leave everything under the leaf untouched, with `_WS_LEAF_WHY` naming the checkout. Step 6's existing
    arms keep and record it (`clipsKept` or `tmpRootKept`, `refused` or `unmeasured`, on the done row and in the done
    document) and the act completes: the leaf check never fails the tail. A link or file leaf is unlinked and never
    scanned. The question runs before the normalise pass and the `rm`, which reach the whole tree. The one write
    before it is the owner-bits pass on the leaf itself (`leaf-owner-bits-pass`), which has to run so the leaf can be
    entered. A foreign tree moved in AS the leaf therefore has its root's owner bits set (555 reads 755 afterwards)
    even when it is then refused, and nothing below the leaf's root is touched.
  - **The scan.** `find -P` from the leaf's physical path, `-xdev`, `-mindepth 1` (so a tree moved AS the leaf is
    seen), bounded by `REAP_SCAN_SECONDS` under `_plat_timeout`. A timeout, any find error or stderr (an unreadable
    directory hides what is under it), or a 65th entry named `.git` (the cap is 64) is unmeasured. It does not prune
    at a `.git` directory, because a foreign tree can be parked inside a clone's `.git` as easily as anywhere else, so
    the time bound caps the walk.
  - **Each `.git` entry,** asked by `-L`, then `-d`, then `-f`, never followed, and git is never run inside a leaf.
    - A link is refused (the controller's ruling F1a): git would follow it, ccd never does.
    - A directory, a full clone, passes: it is the leaf's own scratch.
    - A file must be exactly one `gitdir: <non-empty path>` line of at most 4096 bytes with no NUL, else it is
      unmeasured (F1b: git reads the whole file). It is tested with `-f` before any read, so a FIFO is never opened.
    - A relative path resolves against the `.git` file's own directory, as git does, and the admin directory is
      resolved physically through `_ws_dir_physical` (F1c). One proven absent refuses, because git no longer records
      the tree. One that cannot be resolved is unmeasured. A `..` after another component of a relative gitdir, or any
      `..` in an absolute one, is unmeasured, because behind a link `cd -L` and the kernel disagree. Only a relative
      gitdir's leading `../` and `./` are read.
    - An admin directory whose physical path equals the leaf or begins `<leaf>/` passes (F1d): a submodule, or a
      worktree of a clone in the leaf.
    - One outside the leaf passes only as a linked worktree whose admin `gitdir` back-link names THIS `.git`,
      literally or as its directory's physical path plus `/.git` (F1e), and refuses otherwise. An absent back-link
      file refuses and an unreadable one is unmeasured. The same clause catches a recycled admin name, where a later
      `ws-add` recreated `worktrees/<name>` for another workspace. The back-link is compared as a whole file with
      trailing newlines stripped, as `_ws_reclaim_gitdir_own` reads it, and a relative back-link never matches, so it
      refuses (the fleet runs git 2.43).
    - A refusal outranks an unmeasured entry, whatever order find lists them in.
  - **The stated limits.**
    - (i) A tree stripped of its `.git`, or content that is no checkout, parked in a leaf is not seen, and base held
      these only by accident, through the blanket hold on a gone row.
    - (ii) The question and the `rm` are two looks, not one, so a same-uid rename in between is removed with the leaf,
      which wave 7's quarantine rename closes. Beside it, a registry row placed into a leaf after `_ws_reclaim_owned`'s
      ask at the start of the tail is not asked again at step 6. The removal-time question and the temp root's in-use
      probe still stand, and the worktree has the same window class.
    - (iii) A clone, a submodule of one, or a worktree of one inside a leaf is the leaf's own and goes with it. That
      includes a foreign MAIN checkout, a `.git` DIRECTORY, moved into a leaf: with no registry row naming it, it
      passes the question and is removed with its object store. The ruling accepts this, because a clone in a leaf is
      the leaf's own. A registry row that names the moved tree's old path is a gone row, and the blanket hold on a
      gone row keeps the child unmeasured.
    - (iv) The bind-mount alias spelling of a leaf is not compared, which is the existing residual.
    - Also stated: on a case-insensitive file system (Darwin APFS), a hand-renamed `.GIT` that git honours is missed
      by `find -name .git`. Git never writes that name.
  - **The cost, two fail-closed leaks the ruling accepts.** A temp root that holds any unreadable subdirectory, more
    than 64 `.git` entries, or a tree whose walk outlasts `REAP_SCAN_SECONDS` (30 s) is kept `unmeasured` on every
    pass, where the permission pass used to normalise and remove it. A clips leaf is mostly spared the first, because
    rung 8 normalises clips before the tail. The coordinator measured, on 2026-10-08, 47 `.git` entries in 6 of 45
    temp roots and none in `~/.cc-clips`, every linked one self-back-linked, so the rule holds no root today and none
    is near the cap.
  - **Two existing cases changed.** `ccd-leaf-remove.test.ts` planted a mode-000 subdirectory and expected the helper
    to remove it. The ruling makes a mode-000 directory inside a leaf unmeasured, so the fixture is now mode 0500
    (`leaf-remove-fixture-mode-0500`). Both cases still red without the permission pass, and the mode-000 shape is
    pinned as unmeasured in the new files.
  - **One arm unpinned.** The resolved arm of the back-link compare is defence in depth with no case that reds it
    alone, because `find -P` from a physical root walks no link, so the found path is already physical and the literal
    arm answers first.
- **D-4455** `leaf-rows-are-nested` (Fix round 1) — a registry row at, inside or through a child's clips or temp-root
  leaf is NESTED. This is Rule 2 of review 335's F1, and it closes the pre-existing shape its lens named: a standing
  row whose workdir lies inside the child's temp root was also taken with the leaf, on base and at the tip alike.
  - **As built.** `_ws_reclaim_workdir_shared` compares every row, standing or recovered by either arm, against the
    two leaf paths as well as the worktree, in ONE registry pass (a call per leaf would reset `_WS_RECORDED_GDIRS`
    each time). It uses all four comparisons the worktree uses, literal equal or inside and resolved equal or inside,
    plus THROUGH. Both the ladder and `_ws_reclaim_owned` reach it through the shared function, so ws-expire's ladder
    is covered the same way.
  - **The word.** A nested row refuses `containment-unproven`, terminal at reclaim and at expire alike through the
    ladder's NESTED arm. No refusal word is added, because an unknown word reads "unreadable" to the expiry lane's
    `ExpireToken`. Both NESTED detail sentences now read "…rooted inside it, or in its clips directory or temp root,
    each another session's tree", with the substring `registry row(s) <ids> rooted inside` that existing tests match
    kept (`nested-detail-names-the-leaves`).
  - **Leaves.** A leaf proven absent is skipped, so a recovered row inside an absent leaf does NOT hold. A leaf whose
    absence cannot be proven, or whose root cannot be resolved (or resolves to a `//`-leading path), answers the
    function's rc 2 (the controller's ruling F1h).
  - **Three choices the ruling left open, accepted.** A DIRECTORY leaf is placed by its root's physical path plus
    `/<id>`, as the removal helper composes it, and never by entering the leaf, so a mode-000 temp root is no hold at
    the ladder. A link or file leaf is compared by its spelling alone and is never "unresolvable": read literally, F1h
    would hold every child whose temp root is a file or link leaf for ever, and the helper unlinks such a leaf and
    follows nothing. A row at, inside or through a leaf goes into the same `_WS_NESTED_ROWS` as the worktree's nested
    rows.
  - **The cost.** An unprovable leaf, or a standing row at, inside or through a leaf, makes `_ws_reclaim_owned` fail
    resumable `worktree-remove-failed` at the start of the tail, and so on every resume until the row or the leaf is
    fixed, with nothing deleted. Fresh reclaims are held at the ladder. It is the same shape as the recorded
    moved-tree arm of that function, and it is carried to wave 7 beside it.
  - **Pin strength.** The mutation row that issues one `_ws_reclaim_workdir_shared` call per leaf reds only through
    the placement and unprovable-leaf differences, because no constructible shape changes a verdict through the
    `_WS_RECORDED_GDIRS` reset alone. The single pass is still what the ruling requires.
- **D-4456** `walker-fd-esrch-is-vanished` (Fix round 1) — `_ws_path_users`' walker read each descriptor with
  `os.readlink` and caught only `(FileNotFoundError, PermissionError)`. A same-uid process that exits between the
  descriptor listing and that read answers ESRCH (`ProcessLookupError`), which escaped to the outer handler and made
  the WHOLE walk unmeasured, so the tail kept a temp root nobody was using as `tmpRootKept=unmeasured` (the review
  measured 43 of 122 walks under fd churn). The clause is now `except VANISHED + (PermissionError,):`, matching the
  sibling walker, and the probe header's promise that a process is skipped only on proof it vanished (ENOENT or ESRCH)
  holds at every read of the walker. The direction was fail-safe, a recorded leak and never a deletion. A fake process
  table cannot produce ESRCH, because its readlink is a real file system's, so the red case injects it with a
  `sitecustomize.py` on `PYTHONPATH` that raises `ProcessLookupError` for one process's descriptor path, with a
  control that the injection reached the walker.
- **D-4457** `pre-breadcrumb-state-changed-not-resumable` (Fix round 1) — `parseChildReclaimResult` read every
  `failed` word except `probe-unmeasured` as `resumable`, so the feed said "the box resumes where it stopped" of the
  consent binding's `state-changed`, which stops the act before the tombstone and the breadcrumb and is retried from
  the start.
  - **As built.** A named set of `failed` words that are pre-breadcrumb on the fresh arm,
    `CHILD_RECLAIM_PRE_CRUMB_FAILED` (`probe-unmeasured` and `state-changed`), reads `not-resumable`. It replaces the
    one-word `CHILD_RECLAIM_PROBE_UNMEASURED` and is typed `as const satisfies readonly (LcRefusalToken |
    ChildReclaimToken)[]`, a union, because `state-changed` is a `ChildReclaimToken` and not an `LcRefusalToken`; a
    typo in it is a compile error. `isChildReclaimKebab` admits `probe-unmeasured` through the set's guard, so no
    second hand-kept literal exists. The comments and the doc of `ChildReclaimResume` are updated.
  - **`pin-failed` and `tombstone-unwritable` stay `resumable`.** Each is printed once in the fresh path's pin phase,
    before the breadcrumb, and also by the tail after it (eight producers of `pin-failed` and five of
    `tombstone-unwritable` in the tail), so the word alone cannot tell the two apart.
  - **The stated residual.** The pre-breadcrumb case of both words reads `resumable`, so the feed says the box resumes
    where it stopped of an act that is retried from the start. ws-expire's pin phase prints the same two words before
    its own breadcrumb, so the residual covers that verb too, and its parser is workspace-lifecycle's and unchanged.
    The fix is an additive `crumb:false` field on ccd's document, carried to wave 7.
  - **The resumed arm's `probe-unmeasured`, a second residual.** The word is pre-breadcrumb on the fresh arm only.
    `state-changed` is printed on the fresh arm only, because only the fresh arm runs the pin phase. But the locked
    recomputation prints `probe-unmeasured` for any unmeasured verdict, and on a resume that verdict can come from the
    resume's own reads (an unreadable tombstone, for one) while an earlier attempt's breadcrumb (for example
    `reclaim:artifacts`) still stands. The server reads it `not-resumable`, so the feed says the act is retried from
    the start, but the box's next attempt resumes from that breadcrumb and completes. It is the mirror image of the
    `pin-failed` case: the same symptom, a wrong sentence and never a wrong act, carried to wave 7 with the same
    `crumb` field, which marks a document with or without a breadcrumb and so covers both directions. The
    classification is unchanged in wave 6. It agrees with `probe-unmeasured-word-scoped-to-attempt`, whose sentence
    says only what THIS attempt did and started.
- **D-4458** `leaf-root-newline-refused` (Fix round 1) — the removal helper's root resolution, `rroot=$(cd -- "$root"
  … && pwd -P)`, dropped every trailing newline of the physical path (review 335, F4). A root resolving to `<vol>\n`
  read as `<vol>`, `lreal == leaf` passed because both sides were stripped, and `<vol>/<id>`, outside the root, was
  removed with rc 0 while the real leaf stood. Base failed closed on the same shape. The final review's label for it,
  "older code, carry", was wrong: `_ws_leaf_remove` is this wave's code.
  - **The helper.** ONE shared function, `_ws_dir_physical <dir>`, resolves a directory's physical path. It sets
    `_WS_PHYS`, or sets `_WS_PHYS_WHY` and answers non-zero when the directory cannot be entered, the sentinel suffix
    is missing, or the physical path holds a newline anywhere. It uses `_ws_reclaim_resolve`'s idiom exactly: a
    `POSIXLY_CORRECT` subshell with `unset -f builtin cd pwd printf`, then `CDPATH= builtin cd -L -- <dir> && builtin
    pwd -P && builtin printf x`, then the `\nx` suffix checked and stripped. `_ws_reclaim_resolve` and
    `_ws_reclaim_absent` are untouched.
  - **Three sites for the newline refusal,** each mapping a non-zero answer into its own unmeasured arm with the
    helper's why: `_ws_leaf_remove`'s root (rc 2), `_ws_path_users`' parent (rc 2, where a stripped newline used to
    fail OPEN: nobody found, the leaf removed while in use), and `_ws_expire_cwd_users`' parent
    (`_ws_reclaim_unmeasured`, rc 1). In `_ws_expire_cwd_users` only that resolution changed, because the rest of its
    body is workspace-lifecycle's. Its coordinator, quiet-river, consented to that one edit in mail 3961, and the
    consent covers nothing else in the function.
  - **Other callers.** Fix round 1's checkout question (`leaf-moved-checkout-refused`) also resolves through the same
    helper: its leaf, each admin directory, and each checkout's own directory for the back-link compare. So does the leaf placement in
    `_ws_reclaim_workdir_shared` (`leaf-rows-are-nested`). Each maps a failure to unmeasured.
  - **The leaf's own path takes no sentinel.** Under a newline-free physical root, with an id that holds none, a leaf
    that is no link resolves to exactly `<root>/<id>`. Only a link swapped in between the link test and the `cd` could
    differ, which is the same-uid window stated for the helper.
  - **The red cases** are the review's `vol\n` case and one each for `_ws_path_users` and `_ws_expire_cwd_users`; each
    must answer unmeasured, never "nobody" and never a removal.
- **D-4459** `witness-dropped-on-proven-absent` (Fix round 1) — when the tail's temp-root leaf was already absent and
  the in-use probe answered in-use or unmeasured (always unmeasured on Darwin), the witness stayed beside a
  proven-absent leaf, and nothing would ever call `_ws_tmproot_remove` for that id again (review 335, F6).
  - **As built.** The witness half of `_ws_tmproot_remove` (the id check, the linked-`tmproots/` warning, `rm -f`) is
    split into `_ws_tmproot_witness_drop <id>`, and `_ws_tmproot_remove` calls it after its own rc 0. Step 6's in-use
    and unmeasured arms call it ONLY when `_ws_reclaim_absent` proves the leaf absent (rc 0), and record nothing kept.
    Rc 1 keeps the leaf as before. Rc 2 is read explicitly and records `unmeasured`, with the absence proof's why
    through `_ws_leaf_why_line`, where the plan folded it into the `if`. Those arms never go through
    `_ws_tmproot_remove`, whose leaf half would run an unprobed `rm` on a leaf re-created in the window.
  - **The 2-for-2 comment retouch** (`witness-block-comment-retouched`). The sentence at the head of the witness
    block, "DEATH belongs to `_ws_tmproot_remove` alone", was false once the drop was split out, so it was rewritten
    two lines for two, naming the drop. It sits inside the witness block but outside the functions the `ccd/ccd` claim
    holder, bright-harbor, named, and it rides that consent (mail 3959), which covered disjoint regions. Quiet-river's
    consent (mail 3961) is not involved: it covers `leaf-root-newline-refused`'s one resolution in
    `_ws_expire_cwd_users` and nothing else.
  - **The drop's warning on a bad id** (`drop-warns-on-a-bad-id`). The drop answers rc 1 for an id no witness is named
    for and also warns on stderr ("is not an id a witness is named for, so no witness was touched"), where the brief
    said only that it is refused. It sets no `_WS_LEAF_WHY`, because it is not a leaf act.
  - **The stated re-create window.** A leaf re-created between the proof of absence and the drop leaves a leaf with no
    witness: a leak and never a loss, because no collector takes an unwitnessed leaf. The case that pins it is named
    THE WINDOW.
- **D-4460** `review-335-pins` (Fix round 1) — three test-only pins, in `ccd-review-335-pins.test.ts`, for guards that
  review 335 found unpinned.
  - **F8.** A linked tombstone, a symlink to a byte-identical copy, must be held unmeasured by the breadcrumb arm's
    `_ws_reclaim_recorded_crumb`, and the case reds when `! -L "$tomb"` is dropped, because `_ws_tomb_str` opens its
    file through a link. The empty-`.uuid` guard (`-n "$tuuid"`) turned out pinnable and is pinned: an empty `.uuid`
    reads rc 0 with an empty value through `_reg_read`, and the tombstone's `"uuid":""` reads as an empty value at rc
    0, so with the guard dropped `"" == ""` passes and the breadcrumb arm places the row.
  - **F9.** One rc-2 case per leaf, `clipswhy` and `tmpwhy`: an `rm` failure on a long, non-ASCII entry name must
    journal the capped reason. Each reds when its call site journals the raw reason (the row is cut to fit and loses
    its `meas`).
  - **F10.** One vanished-arm consent-window case for `branch-state-consent-both-ways`: the worktree is absent and the
    branch is deleted between the recomputation and the pin. The verb must stop `state-changed` with nothing deleted,
    and the case reds when the consent check is skipped for an absent worktree.
- **D-4461** `loadcold-high-water` (Fix round 1) — `RunsScreen.tsx`'s `loadCold` had no sequence guard, and this
  wave's second trigger puts a second read in flight a tick or two behind the vanish read of the same reclaim, so an
  older read that landed last overwrote the newer one and the row showed the stale "workspace pending" chip (review
  335, F11). The board's cold read now takes a number per call (`issued` and `applied` refs), and only a read newer
  than the last applied one sets `cold`. The `.catch` is guarded the same way. Rejections do not advance the mark,
  because a rejection carries no reading to be newer than: a stale rejection after a newer success sets no error, and
  a newer failure followed by an older success still lands the older success. The mark advances only after the body is
  read, so a success whose body cannot be read still reaches the `.catch` and shows the error state, as before. The
  race needed reordered or slow responses and healed at the next board load. A new test file pins it, with a mutation
  row for each guard and for the rejection choice.
- **D-4462** `done-document-carries-kept-leaves` (Fix round 1) — the tail's stdout done document (one `printf`, both
  verbs) gains two additive keys, `clipsKept` and `tmpRootKept`. Each is the kept word (`refused`, `unmeasured` or
  `in-use`), or `null` when nothing was kept.
  - **Printed without an encoder.** A `case` over the three words prints each: an empty value prints `null`, and any
    other value prints `"unmeasured"`, never `null`, so a kept leaf can never read as nothing kept. An earlier form
    went through the JSON string encoder, and a failed `python3` printed `null` for a leaf that WAS kept.
  - **Absence means unmeasured.** A document from an older ccd omits both keys, and a reader treats absence as
    unmeasured, never as gone.
  - **No server reader is added in this wave.** The expiry lane's reader is workspace-lifecycle's next wave, and the
    reclaim side's reader is wave 7's collector. Both parsers, `parseChildReclaimResult` and `parseExpireResult`, read
    named keys only, so the keys are safe to ship agent-first. The journal's `meas` keeps its own rule and omits a key
    when nothing was kept.
