import { reviveWsAudit, type ReapResult, type WsAudit } from '../../shared/api.js';

/**
 * Refusal token → the sentence a person reads. ccd's tokens are stable
 * identifiers, not copy; rendering the raw shell string would put a bash
 * variable name on a phone screen. Anything unmapped falls back to the token
 * itself with a neutral frame, so a NEW ccd refusal degrades to something
 * readable rather than to blank.
 *
 * Exported (Task 13, beyond the plan's own interface list) so
 * `wsaudit.test.ts`'s refusal-token linkage test can enumerate this SAME map
 * against every token `ccd`'s own source can emit, in both directions —
 * rather than maintaining a second, hand-copied token list that could itself
 * drift from either side the way `branch-drift` -> `registry-branch-drift`
 * once did with nothing noticing.
 */
export const SENTENCES: Record<string, string> = {
  'no-such-session': 'ccrc has no record of this session.',
  'not-a-workspace': 'This is a project’s main checkout, not a workspace — there is nothing to remove.',
  'not-archived': 'This workspace has not been archived yet. Archiving is the staging step; it stops the session and destroys nothing.',
  'incomplete-registry': 'This session’s registry entry is missing its branch or workdir, so ccrc cannot tell what removing it would delete.',
  'worktree-missing': 'The worktree is already gone; the branch and the registry entry are still here. `ccd ws-attic` lists the commits ccrc pinned.',
  // The three rungs of `_ws_wt_branch` (ccd:303-314), which is where every
  // branch name in ccd comes from. These three sentences and ccd's three
  // refusals move together: renaming a token without moving its copy leaves the
  // fallback below printing a bash identifier on a phone screen, which is the
  // one failure mode this map exists to prevent.
  'no-worktree-record': 'git has no record of this directory as a worktree of this project, so nothing here is ccrc’s to remove.',
  'detached-head': 'git has this worktree on a detached HEAD, so ccrc cannot tell which branch it belongs to.',
  'registry-branch-drift': 'git has this worktree on a different branch than ccrc recorded. Nothing is removed while the two disagree.',
  'foreign-worktree': 'This worktree belongs to a different repository than the project it is registered under.',
  'dirty-tree': 'There are uncommitted or untracked changes here. Commit or move them first.',
  // A read that FAILED, not a tree that was clean. It gets its own sentence
  // rather than borrowing dirty-tree's, because "commit or move them first" is
  // advice about files, and this is a worktree ccrc could not open at all.
  'tree-unreadable': 'ccrc could not read this worktree, so it cannot prove nothing here would be lost. Nothing was removed.',
  'sensitive-ignored': 'There are secret-shaped files here that are in no commit and cannot be recovered. Move them out, then try again — there is no override.',
  'nested-checkouts-present':
    'Checkouts of their own live under this workspace — they are not build output. Remove or finish them first; ccd deletes no repository it did not create.',
  // D2: the four rungs of the per-child ladder in `_ws_reap_eval`, which
  // narrows `nested-checkouts-present` above to STRAY checkouts only — a
  // checkout `ccd` itself registered as a worktree of this project gets one of
  // these four instead.
  'child-dirty': 'A checkout nested under this workspace has uncommitted work of its own.',
  'child-busy': 'A checkout nested under this workspace is mid-operation — finish or abort it there first.',
  // Whole-branch review, finding I3: the old sentence ("carries commits that
  // exist nowhere else") is false for the case this rung exists to catch —
  // the workspace's own squash-merge, where the child's commits are very
  // much reachable from origin, just not from `$cbase..HEAD` inside the
  // child itself. The remedy is IN THE SENTENCE, the same rule every other
  // permanent refusal on this map states for itself: `ReapSheet` renders
  // `audit.sentence` and never `audit.detail`.
  'child-unpushed': 'A checkout nested under this workspace carries commits not reachable from origin — often the workspace’s own squash-merged history. Push or finish the child, or remove it: `git -C <project main> worktree remove <child path>`.',
  'child-branch-elsewhere': 'A nested checkout’s branch is also checked out somewhere else — removing it here would strand that other checkout.',
  // Whole-branch review, finding I4: distinct from the four rungs above.
  // `_ws_reap_eval`'s ownership pair (`_ws_common_dir` + `--show-toplevel`)
  // cannot even run when the child's directory is simply gone — `git
  // worktree list` still names the path, nothing has told git otherwise, so
  // this is a stale REGISTRATION rather than a live checkout ccd does not
  // own. `nested-checkouts-present`'s sentence ("Checkouts of their own
  // live…") would be actively wrong here: there is no checkout to move or
  // finish, only a record to prune.
  'child-record-stale': 'git still records a nested worktree whose directory is gone. Run `git worktree prune` in the project checkout, then re-check.',
  'stashes-present': 'This branch has stashed changes, which are in no commit.',
  // A stash read that FAILED, and it gets its own sentence for the same reason
  // `tree-unreadable` does: `git stash list` answers rc 0 with empty output for
  // an unreadable reflog (deviation 17), so "no stashes" and "we could not
  // count them" were the same answer until ccd started corroborating against
  // `refs/stash`.
  // The remedy is IN THE SENTENCE, not only in ccd's `detail`: `ReapSheet`
  // renders `audit.sentence` for a refusal and never `audit.detail`, and this
  // refusal is permanent and has no override, so advice that stayed in `detail`
  // would reach nobody who could act on it. `git reflog expire --all` leaves
  // `refs/stash` resolving over an empty reflog (deviation 21), which is a
  // healthy repository ccrc cannot distinguish from a broken one.
  'stash-unreadable': 'ccrc could not read this repository’s stash list, so it cannot prove nothing is stashed here. Nothing was removed. If this repository has no stashes, `git stash clear` in it clears the stale ref.',
  'no-upstream': 'This branch was never pushed, so nothing on the remote holds its commits.',
  'unpushed-commits': 'This branch has commits that are not on the remote.',
  'branch-missing': 'The branch this workspace names does not resolve.',
  'no-remote': 'This project has no `origin` remote, so ccrc cannot check its pull requests.',
  'gh-unreadable': 'ccrc could not reach GitHub, so it cannot prove this work was merged. Nothing was removed.',
  'no-bound-pr': 'No merged pull request belongs to this branch.',
  'pr-head-not-ours': 'The pull request that matches this branch name was opened from a different commit — it is not this workspace’s.',
  'not-merged': 'The pull request for this branch is not merged.',
  'pr-fields-malformed': 'GitHub’s answer for this pull request did not contain usable commit ids, so ccrc will not put any of it in a git command.',
  'fetch-failed': 'ccrc could not fetch from origin, so it cannot prove this work was merged. Nothing is claimed about your commits.',
  'merge-commit-missing': 'GitHub named a merge commit that is not in this repository even after fetching.',
  'base-missing': 'The base branch this workspace was cut from no longer resolves, so ccrc cannot describe what removing it would leave behind.',
  'tree-differs': 'GitHub reports this pull request merged, but ccrc cannot prove this branch’s work is in the merge (checked: ancestor, tree, patch-id, cherry). Not removing anything.',
  'session-busy': 'This session is in the middle of a turn.',
  'status-unknown': 'ccrc cannot read this session’s status, so it will not act on a guess.',
  // NOT a refusal — the one verdict that is neither `reapable` nor a refusal
  // (deviation 19). The proof holds and the worktree is already gone, so there
  // is nothing to confirm and no token to confirm it with; `parseAudit` gives
  // every non-`reapable` verdict a sentence, and this is that sentence.
  'reap-interrupted': 'A previous cleanup of this workspace stopped part-way and its worktree is already gone. Finish it from ccd — there is nothing left here to confirm.',
  'state-changed': 'This workspace changed since the list you were shown — nothing was removed.',
  'in-progress': 'Another cleanup of this workspace is already running.',
  'worktree-remove-failed': 'git refused to remove the worktree. The session is stopped and nothing further was deleted.',
  // Whole-branch review, finding I6: the teardown loop's merge-base
  // pre-probe (`git -C $main merge-base --is-ancestor`) never calls
  // `worktree remove` at all — it is checking, ahead of time, whether
  // `branch -d` would even succeed, because a child's `cahead==0` at CONSENT
  // time (proved against `origin/HEAD`) is not the predicate `branch -d`
  // itself applies (`$main`'s current LOCAL HEAD). Reusing
  // `worktree-remove-failed`'s sentence here claimed git refused a command
  // it was never asked to run. The usual cause is the workspace's own
  // squash-merge landing at origin before `$main`'s local checkout fetched
  // it, so the remedy is a pull, not a retry.
  'child-branch-unmerged-locally': 'A nested checkout’s branch is merged at origin but not in the local project checkout — run `git pull` in the project checkout, then re-check.',
  'branch-moved': 'The branch moved while cleaning up — nothing was deleted after the worktree.',
  // Added by Task 7, executing the Task 6 gate's required hardening: a resume
  // whose `reaping` breadcrumb holds a phase ccd never wrote (not one of
  // `worktree|branch|clips`) now refuses here rather than silently skipping
  // the worktree-removal step and deleting the branch, clips and registry
  // anyway. Deviation 35.
  'reaping-phase-unknown': 'A previous cleanup left a marker ccrc does not recognise. Nothing was removed — this needs a human to look at it directly.',
  // Pre-merge fix round, finding E: a resume now re-reads the clips
  // directory and rewrites the tombstone's `clips` field before finishing —
  // the record has to cover what THIS run destroys, not only what the
  // original run saw. If that rewrite itself fails (a hand-edited or
  // corrupted tombstone), the resume refuses rather than destroy clips a
  // document could not be made to name truthfully.
  'tombstone-unwritable': 'ccrc could not update this workspace’s cleanup record before finishing, so it stopped rather than delete anything it could not accurately describe. This needs a human to look at the tombstone file directly.',
  // Final-round confirmation-surface review, the sixteenth instance of the
  // measurement-forgery class. The clips directory EXISTS and ccd could not
  // list what is in it, so the sheet cannot name what the delete would
  // destroy — and an unlisted deletion is one nobody consented to. It gets its
  // own sentence rather than `tree-unreadable`'s: that one is about a
  // worktree, and this is about the pasted images, which are the one thing on
  // this sheet that exists nowhere else at all. The remedy is IN THE SENTENCE
  // for the reason `stash-unreadable` states — `ReapSheet` renders
  // `audit.sentence` and never `audit.detail`.
  'clips-unreadable': 'ccrc could not list this session’s pasted images (`~/.cc-clips/<session>`), so it cannot say what removing them would destroy. Nothing was removed. Check that directory’s permissions.',
  // Build 2.5's hold rung in `cmd_ws_reap` — the one token on this map that
  // reports a DECLARATION rather than a measurement: a program said it is
  // mid-flight in this workspace, and nothing archives or reaps it until
  // someone releases it. It is here because `parseReap` classifies any answer
  // without a `refused` token as `refused:'error'` and renders the raw shell
  // string, so a rung that `die`d would put a bash command on a phone screen —
  // the exact failure this map exists to prevent. The reason string itself
  // travels in `detail`; the remedy is IN THE SENTENCE for the reason
  // `stash-unreadable` states (`ReapSheet` renders `sentence`, never `detail`).
  'held': 'A program has this workspace held — it is mid-flight, so nothing was removed. Release it first (Release in the session’s actions sheet, or `ccd ws-release --session <id>`), then clean up.',
  // ── ws-rename. Nine tokens whose copy no sheet renders TODAY: automatic
  // naming logs its refusals server-side and surfaces nothing in the PWA, and
  // this branch builds no manual rename control. They are here because
  // `wsaudit.test.ts` enumerates ccd's source and requires the two sets to be
  // EQUAL — the mechanism that caught `branch-drift` -> `registry-branch-drift`
  // — and because if a rename control is ever added the copy is already right
  // rather than a bash identifier on a phone screen. Five more of ws-rename's
  // fourteen tokens (`no-such-session`, `not-a-workspace`, `incomplete-registry`,
  // `worktree-missing`, `registry-branch-drift`) are shared with ws-reap and
  // are already above — `registry-branch-drift` for the exact reason its name
  // says: `cmd_ws_rename` now refuses when git's worktree record disagrees
  // with the registry's `branch` field, the same corroboration `ws-reap`
  // already required, so it reuses `ws-reap`'s own token rather than minting a
  // second name for one fact.
  //
  // VOCABULARY DEFERRAL, recorded rather than fixed (spec:371-376): the reap
  // side says `detached-head`, `foreign-worktree` and `no-worktree-record`
  // where these say `detached`, `worktree-foreign` and `worktree-unregistered`.
  // That is a real inconsistency, left as specified because nothing renders
  // these strings — aligning them later is cheap, and churning a written plan
  // and an approved table for a cosmetic gain is not worth it now.
  // Rename-specific wording would be a lie the day any other verb reuses this
  // token: the key is a bare string in a flat map shared across every ccd
  // verb the linkage scan covers, not namespaced per-verb, so the copy stays
  // neutral even though `ws-rename` is the only emitter today.
  'bad-args': 'ccrc built a request ccd could not read. This is a ccrc bug, not something about this workspace.',
  'bad-branch': 'The name this would rename the branch to is not a valid git branch name.',
  'worktree-unregistered': 'git has no record of this directory as a worktree of this project, so there is no branch name to rename.',
  'detached': 'git has this worktree on a detached HEAD, so there is no branch to rename.',
  'worktree-foreign': 'This directory belongs to a different repository than the project it is registered under. Nothing was renamed.',
  'unchanged': 'The branch already has this name.',
  'has-upstream': 'This branch has already been pushed. Renaming it now would leave the old name on the remote and open a second branch there on the next push.',
  'name-taken-local': 'A branch with that name already exists in this project.',
  'name-taken-origin': 'A branch with that name already exists on the remote.',
};

export function refusalSentence(token: string): string {
  return SENTENCES[token] ?? `ccrc declined: ${token}.`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** `ccd ws-audit` stdout → WsAudit, or null when it was not one object — or
 *  when it WAS one object but `reviveWsAudit` could not make a `WsAudit` out
 *  of it (a missing required field, a wrong type, an out-of-vocabulary
 *  `merge.proof`). Either way the route's existing 502 path is what runs;
 *  `reviveWsAudit` itself throws rather than returning null so it can share
 *  `reviveFleetSession`'s literal-return discipline without a second
 *  null-collapsing convention living inside `shared/api.ts` too. */
export function parseAudit(stdout: string): WsAudit | null {
  try {
    const v: unknown = JSON.parse(stdout.trim());
    if (!isRecord(v) || typeof v.verdict !== 'string') return null;
    const sentence = v.verdict === 'reapable' ? '' : refusalSentence(v.verdict);
    try {
      return reviveWsAudit(v, sentence);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * `ccd ws-reap` stdout/code/stderr → ReapResult.
 *
 * **Empty stderr plus a non-zero exit is `indeterminate`, never "failed".**
 * `execFile` yields exactly that when the process was killed at the outer
 * timeout, when the agent disconnected mid-call, and when the server
 * restarted — and in all three cases the filesystem may be in any state
 * between untouched and fully reaped. Saying "failed" would be a claim about
 * disk that ccrc is not entitled to make; the next `ws-audit` reports the
 * breadcrumb and the reap resumes from it.
 */
export function parseReap(stdout: string, code: number, stderr: string): ReapResult {
  const text = stdout.trim();
  if (text !== '') {
    try {
      const v: unknown = JSON.parse(text);
      if (isRecord(v)) {
        if (typeof v.refused === 'string') {
          return { ...(v as unknown as ReapResult), sentence: refusalSentence(v.refused) };
        }
        if (typeof v.reaped === 'string') return { ...(v as unknown as ReapResult), sentence: '' };
      }
    } catch { /* fall through to the indeterminate/failed split below */ }
  }
  if (code !== 0 && stderr.trim() === '') {
    return { indeterminate: true, sentence: 'ccrc lost contact while cleaning up. Re-open the workspace to see its state.' };
  }
  return { refused: 'error', detail: stderr.trim(), sentence: stderr.trim() || 'ccrc could not clean up this workspace.' };
}
