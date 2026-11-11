# Archived-workspace expiry: the stale index lock, and the other-branch residue of the gone-branch refusal

- **D-8286 (2026-11-11)** — archived-expiry gaps before arming (#318): rung 6 of the shared reclaim/expiry ladder classifies an `index.lock` (D-5945, plan task P4-5 of `2026-10-20-workspace-disk-and-registry-truth.md`) instead of refusing on its existence, and `_ws_reclaim_head_unborn` refuses a HEAD symbolic to any branch that names no commit, not only the registry's (#2293's stated residue of D-5944).

## Why

The expiry lane runs in shadow until `$REG/expire-lane-live` exists. Its shadow output named four gaps that arming would
not close (#318). Re-checked on `origin/main` at `ff2ff75ad`:

| Gap | State on `main` | This change |
|---|---|---|
| 1. Branch-gone rows pass the audit but fail the pin | Closed for a HEAD symbolic to the registry branch by #2293 (D-5944). Open for a HEAD symbolic to **another** branch that names no commit (an orphan checkout, or a drifted HEAD whose branch was deleted under it): the ladder minted a token with an empty `head=`, and the pin refused it on every pass. | Closed: the one predicate the ladder and the pin share asks it of whatever branch HEAD names. |
| 2. A stale `index.lock` refuses `tree-busy` for good | Open (D-5945, no PR). | Closed: classified `absent`, `held`, `stale` or `unmeasured`. |
| 4. Review children have no ceiling | Closed by #885 (D-5942, `review-report-stale` on the banner). | None. |
| 5. Unregistered worktrees | The orphan-tree lane (#1208 onwards) runs in shadow until the operator arms it. | None. |

Item 3 (the permission pass's 30 s bound, D-5946) is not one of the four named gaps and is not taken here (see
"Deviations found").

## Change

- `ccd/ccd`:
  - `WS_INDEX_LOCK_STALE_S=21600`, declared once beside `REAP_SCAN_SECONDS`.
  - `_ws_index_lock_state <lockpath>` sets `_WS_LOCK_STATE` and `_WS_LOCK_WHY`:
    - `absent`: nothing stands there.
    - `stale`: a regular, empty file whose mtime is more than the bound in the past, and `_ws_path_users` answers 0
      (no process of this uid holds it).
    - `held`: a link (dangling or not), a directory, a non-empty file, a file no older than the bound (a future mtime
      included), or a holder the probe names.
    - `unmeasured`: the size, the mtime or the clock could not be read, or the probe could not run (Darwin, a walk past
      its bound).
  - Rung 6 of `_ws_reclaim_ladder` and its nested-checkout twin call it:
    - `held` refuses `tree-busy`, as before, with the reason appended to the sentence.
    - `stale` passes, and the path joins `RECLAIM_STALE_LOCKS`.
    - `unmeasured` answers `_ws_reclaim_unmeasured`.
  - The token gains `staleLock=<paths>` only when a stale lock passed. A tree with no lock keeps the token it had, so no
    other token moves. The verb's in-lock recompute binds it.
  - `ws-audit --reclaim` and `ws-audit --expire` print `"staleLock":[…]` before `verdict`, only when one passed (`_ws_stale_lock_doc`).
    The `reclaim` and `expire` intent lines carry `meas.staleLock`, the paths comma-joined (`_ws_stale_lock_meas`).
  - ccd never deletes the lock. The audit writes nothing. The pin copies the index through a scratch file
    (`_ws_reclaim_index_src`) and every contained read runs with `GIT_OPTIONAL_LOCKS=0`. The tail removes the lock with
    the tree.
  - `_ws_reclaim_head_unborn` reads HEAD first. When HEAD is symbolic to the registry branch it answers as before. When
    HEAD is symbolic to another branch, that branch is read three ways (`_ws_reclaim_branch_state`):
    - proven absent answers 0, the terminal `branch-gone-checked-out`;
    - standing answers 1, the ordinary drift, whose branch the pin keeps;
    - a read that did not run answers 2, unmeasured.
- `shared/api.ts`: `LifecycleMeas.staleLock`, so the census counts 40. `server/src/coord/journalparse.ts`: `reviveMeas`
  carries it.
- `ccd/contexts.tsv`: the three new functions, C4.

## Deviations found

- `staleLock` is an **array** of paths in the audit documents, not one path (spec §2.4 wrote `staleLock: <path>`). The
  child's own tree and a nested same-repository checkout can each hold one, and rung 6 asks both.
- The `tree-busy` sentence for a held lock now ends with why it is held (`— it was written 3s ago, within the 21600s a
  git command may hold it`, `— it holds 18 bytes`, or the probe's holders). Two exact-sentence assertions in
  `ccd-child-reclaim-ladder.test.ts` now pin the prefix and the reason.
- The other-branch residue takes the existing terminal word `branch-gone-checked-out` rather than a word of its own
  (#2293 thought it "would need its own word"). The shape is the same, a checked-out branch that does not exist, and
  so is the remedy. Reusing the word adds no row to `EXPIRE_TOKEN_KIND`, the reclaim kinds or the kept-word table, and
  the expiry lane already reports it as attention (`terminal`).
- **The permission prune is not taken, and needs a ruling before it is** (D-5946, plan task P4-6). The prune leaves read-only directories under an
  ignored `node_modules`, `cdk.out` or `dist` unnormalised, and the ignored scan's fallback only catches what `du`
  or the inside scan cannot read. A directory that is `r-x` reads and sizes cleanly, so no fallback runs. But
  `git worktree remove --force` cannot empty it. The tail then answers `worktree-remove-failed` after the pin and the
  unit stop. Nothing on the resume path runs the permission pass again (`_ws_expire_resume_eval` does not ask rung 8),
  so the resume fails the same way on every pass. Spec §2.5 calls that failure resumable, but nothing would ever let
  the resume succeed. A safe version would add a pass over the pruned directories before the tail's removal, or keep
  `u+w` on directories in the pruned subtrees. That is a change to the tail, which spec §2.5 does not cover.

## Tests

- `server/test/ccd-ws-expire-ladder.test.ts`, "rung 6 — a stale index.lock is named, not tree-busy (D-5945)" covers:
  - stale passes, named, with the probe asked of the lock;
  - a held lock is `tree-busy`, naming its holder;
  - a young lock, and a future-dated one, are `tree-busy`, with the probe never asked;
  - the bound is `WS_INDEX_LOCK_STALE_S`;
  - a non-empty lock is `tree-busy`;
  - a directory or a link at the lock path is `tree-busy`;
  - a probe that cannot run is `unmeasured`;
  - the token binds the stale lock, and a lock-free tree keeps its old token;
  - the audit document names the lock beside its token.
- The same file, the other-branch residue: an orphan checkout, and a drifted HEAD whose branch was deleted, refuse
  `branch-gone-checked-out` at the audit and at the verb; a drift onto a standing branch still passes; a branch that
  cannot be read is unmeasured.
- `server/test/ccd-child-reclaim-ladder.test.ts`, "rung 6 — a stale index.lock in the child, and in a nested checkout,
  passes named (D-5945)": the child's and the nested twin's stale lock; the nested twin held, non-empty and unmeasured;
  the reclaim audit naming both, in rung order. The real probe is used on Linux (a held fd, then none) and on Darwin
  (unmeasured).
- `server/test/ccd-child-reclaim-gone-branch.test.ts`: the orphan shape refused by the ladder, the verb and the pin
  (in the ladder's words).
- `server/test/ccd-ws-expire-verb.test.ts`: a stale lock end to end. The audit and the verb agree, the edit is in the WIP
  commit, the lock goes with the tree, and the intent carries `meas.staleLock`.
- `server/test/ccd-lifecycle-contain.test.ts` and `server/test/lifecycle-wire.test.ts`: the census moves from 39 to 40.

The stale-lock cases stub `_ws_path_users` for the lock path alone (`lockProbe`, `childReclaimFixture.ts`), so they
read the same on Darwin. Every other path asks the real probe.

### Mutation table, run

| Mutant | Expected red |
|---|---|
| holder probe skipped (`rc=0`) | "held by a process: tree-busy", "a probe that cannot run", the nested held case, the Darwin real-probe case |
| size check dropped | "a non-empty old lock", the nested non-empty case |
| age check dropped | "a young empty lock", "dated in the future", "the bound is WS_INDEX_LOCK_STALE_S" |
| unmeasured read as stale | "a probe that cannot run", the nested unmeasured case, the Darwin real-probe case |
| nested twin left on the old rule | "the nested checkout's stale lock follows the same rule", "names both stale locks" |
| `staleLock=` dropped from the token | "the token binds the stale lock", "its token differs from the lock-free tree's" |
| a link at the lock path read as absent | "a directory or a link standing at the lock path" |
| a standing other branch read as absent | "a HEAD drifted onto another branch that EXISTS still passes" |
| an unreadable other branch read as not-so | "a branch HEAD names that cannot be read is unmeasured" |

Each mutant was applied to `ccd/ccd`, run against the two ladder suites, and reverted. Every row was red.
