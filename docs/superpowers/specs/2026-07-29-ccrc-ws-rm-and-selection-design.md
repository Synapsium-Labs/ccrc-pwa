Both specs below are verified against the live code, not just reasoned about. Part 1's bash was executed against an isolated-HOME fixture (8 baseline failures → 0). Part 2 was applied to the real files and the suite run (409/409 green with the design in, 12 of the 16 new tests red with it out), then the tree was restored clean.

---

# PART 1 — `ccd ws-rm` orphans the branch when the worktree directory is gone

**File:** `/srv/projects/OpenClawHetzner/infra/<server-host>-portability/ccd` (`cmd_ws_rm`, lines 233–271)
**Tests:** `/srv/projects/OpenClawHetzner/infra/ccrc/server/test/ccd-workspaces.test.ts` (`describe('ws-rm')`, line 295)

## 1. The defect, exactly

```bash
local branch=""
if [[ -d "$workdir" ]]; then
  branch=$(git -C "$workdir" rev-parse --abbrev-ref HEAD 2>/dev/null)   # ← only source
  ...
fi
...
if [[ -d "$workdir" ]]; then                                            # ← only removal
  git -C "$main" worktree remove "$workdir" || die ...
fi
[[ -n "$branch" && "$branch" != HEAD ]] && git -C "$main" branch -d "$branch" 2>/dev/null || true
rm -f "$REG/$id".*
```

Both the branch read and the worktree removal are gated on `[[ -d "$workdir" ]]`. When the directory has been deleted by hand — a state `ws-gc` explicitly classifies (`stale-meta` from git's side, `dead-reg` from the registry's) — `branch` stays empty, `git worktree remove` never runs, and then `rm -f "$REG/$id".*` destroys the registry's `branch` field. The branch is left in `$main` with **no worktree, no registry entry, and no way for `ws-gc` to find it**: `_ws_gc_scan` enumerates worktree registrations and registry entries, and after `ws-rm` the branch has neither.

Three further defects in the same six lines, all fixed here:

| | |
|---|---|
| **Wrong-repo read** | `git -C "$workdir" rev-parse HEAD` answers from whatever repository owns that *directory*. If the path was recreated (`git init`, a nested clone, a moved checkout), the name returned is then passed to `git -C "$main" branch -d`. The read is not scoped to `$main`. |
| **Silent survival** | `2>/dev/null \|\| true` swallows `branch -d`'s refusal, so a deliberately-kept unmerged branch is kept *in silence* — indistinguishable from the orphaning bug. |
| **Kill-then-die** | An existing-but-unregistered directory fails `worktree remove` *after* the tmux kill and unit disable, contradicting the function's own "REFUSE FIRST" comment. |

Measured on the current script (`wsrm-cases.sh` baseline): case 1 leaves `ws/quiet-mesa` plus a prunable registration behind; case 6 tears the session down before dying.

## 2. Which source of truth wins

git's own worktree record — **never** the registry, and no longer the directory's live HEAD.

```
1. git -C "$main" worktree list --porcelain, record for this path  → AUTHORITATIVE
2. registry field  <id>.branch                                    → WITNESS ONLY
3. git -C "$workdir" rev-parse HEAD                                → REMOVED as a source
```

Rung 1 wins because it is the only source with all four properties, each verified on git 2.43.0:

- **Scoped to `$main`.** It cannot name a branch from another repository, so `branch -d` can only ever be aimed at a branch `$main` actually owns as this path's checkout.
- **Survives the directory.** A hand-deleted worktree still prints `branch refs/heads/ws/slug` under a `prunable` line.
- **Follows renames**, including hand-renames that bypass `ccd ws-rename` and therefore never reach the registry.
- **Is the thing that blocks deletion.** While the registration stands, git refuses: `error: cannot delete branch 'ws/slug' used by worktree at '…'`. So recovering the *name* without clearing the *record* would still orphan the branch. `git worktree remove` (no `--force`) succeeds on a missing directory and clears exactly that one registration — narrower than `git worktree prune`, which is repo-wide.

The registry's `branch` field is demoted to a witness because it drifts: `git branch -m` inside the workspace updates git's record and not the registry.

## 3. When the two disagree

| State | Behaviour |
|---|---|
| git has a record with a branch | Delete **git's** name with `branch -d`. If the registry recorded a different name, print `note: registry recorded 'X', git's worktree record says 'Y' — deleting 'Y'; 'X' left alone` and **leave X alone**. No fallback, ever. |
| git has a record, HEAD detached | Delete nothing; say so. |
| **git has no record** (someone ran `git worktree prune` by hand) and the registry names a branch that still exists | **Delete nothing.** Print the name and the exact command. This is the deliberate orphan: the only artefact that ever tied that name to that path is gone, and an uncorroborated `branch -d` can still destroy a merged branch that happens to share the name. Orphaning is a nuisance; deleting the wrong branch is not recoverable without a reflog the user does not know to look in. |
| Directory exists but is not a worktree of `$main` | **Refuse before teardown.** Nothing killed, nothing removed, registry intact. Recovery is stated in the message: move or delete the directory by hand, then re-run — which lands in the row above. |
| `branch -d` refuses (unmerged, or in use) | Keep the branch, print `kept branch X (unmerged, or still in use) — delete it with: git -C <main> branch -D X`. |
| `$main` itself is gone, and so is the worktree directory | `_ws_wt_branch` returns "no record", the `show-ref` corroboration fails silently, the registry entry is still cleaned. Verified: exit 0, single line of output, no git noise. |
| `$main` itself is gone but the worktree directory is still there | **Refuse, and stay refused.** There is no repository at `$main` to be a worktree *of*: `registered` is 1 and `_ws_common_dir "$main"` is empty, so the row above this one fires and nothing is torn down. The registry entry therefore cannot be removed **at all** until the user moves or deletes the directory — which lands in the row above and finishes cleanly. Verified: exit 1, one line of output, registry intact, `calls()` empty. This is **not** a regression: `4b6814a`'s pre-guard code refused the same fixture identically (`registered` was already 1 there). It is recorded because the single row this replaces claimed the registry is cleaned when `$main` is gone, without saying that it only is when the directory is gone too. |
| Registration is locked | `worktree remove` refuses → `die`; registry and branch both intact — but the session is **already stopped** by then, and the row above is the only one where "refuse" means "before teardown". Locking is not a state `_ws_common_dir` can see, so nothing refuses early: `_ws_unsupervise` and `tmux kill-session` have both run, and only then does git decline. That is why the `die` says *the session was stopped* rather than "nothing was touched", and why it hands over `worktree unlock` — verified to genuinely unblock the re-run. Measured in both directions (directory present and directory deleted by hand): exit 1, `calls()` = `[unsupervise demo-quiet-mesa, tmux kill-session -t cc-demo-quiet-mesa]`, registry entry and `ws/quiet-mesa` both still there. |

## 4. The exact bash

Insert three helpers immediately above `cmd_ws_rm`, then replace the body.

Both blocks below are the bash that **actually ships**, byte for byte — not the
bash this section first proposed. Four rounds of adversarial review changed it,
and §5a is the complete record of what changed and why; the section title means
what it says, so re-applying either block verbatim is safe. The check that keeps
that true is mechanical: extract the two fenced `bash` blocks from this section
and require each to appear verbatim in `infra/<server-host>-portability/ccd`. Run it
after any edit to either side.

```bash
# Every path git prints is fully resolved ($HOME/worktrees -> /data/worktrees ->
# /mnt/...), while the registry keeps the path ccd wrote. Resolving needs the
# path to EXIST, and the whole point of the caller below is the case where it
# does not — so resolve the longest existing prefix and re-attach the rest.
_ws_realpath() {   # path -> same path, existing prefix resolved
  local p="$1" head="$1" tail="" real
  while [[ ! -d "$head" && "$head" != / && "$head" != . && -n "$head" ]]; do
    tail="/$(basename -- "$head")$tail"; head=$(dirname -- "$head")   # -- : a path may start with -
  done
  # `>/dev/null` on the cd, not merely `2>`: `pwd -P` is the answer, so anything
  # cd itself prints would be captured as part of it. bash's own cd prints on a
  # CDPATH hit (not reachable here — $head is only ever an absolute path walked
  # upwards), but a `cd` exported as a shell function prints whatever it likes,
  # and that is reachable: bash imports it into this script through the
  # environment. Redirecting cd alone leaves `pwd -P` free to answer.
  real=$(cd -- "$head" >/dev/null 2>&1 && pwd -P) || { echo "$p"; return 0; }
  # `pwd -P` prints "/" for the root and never a trailing slash anywhere else,
  # so stripping is only ever right when there is a tail to re-attach: for the
  # root with no tail, "${real%/}" strips the only character there is.
  if [[ -n "$tail" ]]; then echo "${real%/}$tail"; else echo "$real"; fi
}

# Which repository a directory belongs to, as one absolute, symlink-collapsed
# path — the only question that distinguishes "$main's worktree" from "some
# other repo that was put at that path".
#   exit: non-zero and NO output when the path is in no repository at all —
#         callers must treat the empty string as "no answer", never as a match.
# `--path-format=absolute` (git >= 2.31; this fleet is on 2.43) is doing the work.
# Plain `--git-common-dir` is not comparable as printed — a bare `.git` from a
# repo's own checkout, `../.git` from a subdirectory of one, absolute only from a
# linked worktree — and resolving it here meant a `cd` inside a command
# substitution, whose stdout ccd does not get to control: bash's own cd prints the
# directory it landed on when a relative operand hits CDPATH, and a `cd` exported
# as a shell function prints whatever it likes. Either print is captured as part
# of the answer (`2>/dev/null` catches neither), and the caller then compares
# multi-line garbage — two wrong answers that happen to match wave a squatter
# through, two that do not refuse a healthy workspace. Asking git leaves no `cd`
# to shadow. Measured on git 2.43.0 against the cd-based resolution it replaces:
# byte-identical for a repo's own checkout, a subdirectory of one, a linked
# worktree, a worktree of a worktree, --separate-git-dir, a `.git` that is itself
# a symlink, a bare repo, and a main and its worktree reached through two
# different symlinks (both sides still compare equal); and failing with no output
# for a directory in no repository at all.
_ws_common_dir() {   # dir -> /abs/.../.git
  local dir="$1" gcd
  gcd=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [[ -n "$gcd" ]] || return 1
  printf '%s\n' "$gcd"
}

# THE branch source of truth: git's own record of which branch the worktree at
# $2 has checked out, read from the repo at $1. Not `rev-parse HEAD` inside the
# worktree — that answers from whatever repository owns that directory, which
# after a hand-deletion and a stray `git init` need not be $1 at all, and the
# name it returns is then deleted in $1. This lookup cannot leave $1, survives
# the directory being gone (the record stays, marked `prunable`), and follows a
# branch rename whether ccd or the user did it.
#   stdout: branch name, empty for a detached HEAD
#   exit:   0 = git has a registration for that path, 1 = it has none
# `git worktree list` failing (repo gone, corrupt, not a repo) yields no records
# and therefore exit 1 — "no evidence", which is the reading that deletes
# nothing.
_ws_wt_branch() {   # main path
  local main="$1" path="$2" real cur="" line
  real=$(_ws_realpath "$path")
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) cur="${line#worktree }" ;;
      "branch "*)   [[ "$cur" == "$real" || "$cur" == "$path" ]] && { echo "${line#branch refs/heads/}"; return 0; } ;;
      detached)     [[ "$cur" == "$real" || "$cur" == "$path" ]] && { echo ""; return 0; } ;;
    esac
  done < <(git -C "$main" worktree list --porcelain 2>/dev/null)
  return 1
}
```

`cmd_ws_rm`, from the `local main=` line to the end (everything above it is unchanged):

```bash
  local main="$PROJECTS_ROOT/$project"

  # Gather the evidence BEFORE anything is torn down, and gather it from git.
  # `registered` is what decides whether there is anything for `worktree remove`
  # to clear, so it is read from $? on its own line: with no `set -e`, a
  # `local branch=$(...)` would return local's status, not the function's.
  local branch registered
  branch=$(_ws_wt_branch "$main" "$workdir"); registered=$?

  if [[ -d "$workdir" ]]; then
    # REFUSE FIRST, tear down second. A directory that exists but is not a
    # worktree of $main is not ours to remove and its HEAD is not ours to
    # delete: move or delete it by hand and re-run, and the missing-directory
    # path below will finish the job.
    #
    # `registered` cannot decide this on its own: it comes from git's RECORD,
    # and the record outlives the directory. Delete the directory by hand and
    # put anything else back at that path — a `git init`, another repo's
    # worktree — and the record still names it, so `registered` is 0 while the
    # directory belongs to someone else. Trusting it alone killed the session
    # and disabled the unit, and only THEN did `worktree remove` refuse. So ask
    # the directory too, and require both to say $main.
    local wd_common main_common
    wd_common=$(_ws_common_dir "$workdir"); main_common=$(_ws_common_dir "$main")
    (( registered == 0 )) && [[ -n "$main_common" && "$wd_common" == "$main_common" ]] \
      || die "$workdir is not a worktree of $main — nothing was touched; move or delete the directory by hand, then re-run (with it gone, ccd clears the leftover record itself; \`git worktree prune\` will not, while the directory is there)"
    # --porcelain counts untracked files, which is what `git worktree remove`
    # itself objects to. Doing this after the kill would leave the uncommitted
    # work intact but the session dead and out of supervision — and the refusal
    # would be lying about it. A status we could not read is not a clean one
    # (same rule as _ws_gc_dirty).
    local dirty
    dirty=$(git -C "$workdir" status --porcelain 2>/dev/null) \
      || die "could not read $workdir — nothing was touched"
    [[ -z "$dirty" ]] || die "worktree not removed (uncommitted changes?) — nothing was touched: $workdir"
  fi

  _ws_unsupervise "$id"
  tmux kill-session -t "$(_tmux "$id")" 2>/dev/null || true

  if (( registered == 0 )); then
    # Not gated on the directory existing: `git worktree remove` clears the
    # registration either way, and while that registration stands git refuses to
    # delete the branch it names ("cannot delete branch used by worktree at").
    # Still no --force: the tree can have changed since the check above, and a
    # locked worktree refuses either way. By here the session IS stopped, so say
    # that rather than repeat "nothing touched".
    # The recovery has to work in the state it is printed in. `worktree prune`
    # only drops records whose directory is MISSING, so it is named for exactly
    # that case and not offered as a general remedy — the "directory is there
    # but is not ours" case refuses above, before anything is torn down.
    git -C "$main" worktree remove "$workdir" \
      || die "worktree record not cleared for $workdir — the session was stopped; git refused: unlock it (git -C $main worktree unlock $workdir) or clean the tree, then re-run — and if the directory is already gone, git -C $main worktree prune clears the record"
  fi

  local reg_branch; reg_branch=$(_reg_get "$id" branch)
  if [[ -n "$branch" ]]; then
    # git had a record, so the registry is a witness, never the decider: a
    # divergence means the branch was renamed outside ccd, and the name to
    # delete is the one git actually had checked out there.
    [[ -n "$reg_branch" && "$reg_branch" != "$branch" ]] \
      && echo "note: registry recorded '$reg_branch', git's worktree record says '$branch' — deleting '$branch'; '$reg_branch' left alone" >&2
    # No -D: an unmerged branch must survive — and must SAY so, or it is
    # orphaned in silence.
    git -C "$main" branch -d "$branch" 2>/dev/null \
      || echo "kept branch $branch (unmerged, or still in use) — delete it with: git -C $main branch -D $branch" >&2
  elif (( registered == 0 )); then
    echo "note: $workdir was on a detached HEAD — no branch to delete" >&2
    # "No branch to delete" is only half the truth when the registry named one:
    # the teardown above just took away its worktree and its registration, and
    # the line below takes away its registry entry, leaving it with no ws-gc row
    # either — invisible, which is the state this whole path exists to prevent.
    # Same rung-3 rule as the no-record case: git never corroborated that name
    # for this path (the record it did hold was detached), so name it and hand
    # over the command rather than delete it unverified.
    if [[ -n "$reg_branch" ]] && git -C "$main" show-ref --verify --quiet "refs/heads/$reg_branch" 2>/dev/null; then
      echo "warn: registry says branch '$reg_branch', which still exists and now has no worktree — not deleting it unverified. If it is finished: git -C $main branch -d $reg_branch" >&2
    fi
  elif [[ -n "$reg_branch" ]] && git -C "$main" show-ref --verify --quiet "refs/heads/$reg_branch" 2>/dev/null; then
    # No git record at all (someone pruned it by hand). The registry name is
    # uncorroborated — the only thing that ever tied it to this path is now
    # gone — and deleting the wrong branch costs incomparably more than leaving
    # the right one behind. Name it and hand over the command.
    echo "warn: no worktree record for $workdir; registry says branch '$reg_branch', which still exists — not deleting it unverified. If it is finished: git -C $main branch -d $reg_branch" >&2
  fi

  rm -f "$REG/$id".*
  echo "removed workspace $id"
}
```

### Exit-code discipline (`set -uo pipefail`, no `set -e`)

- `branch=$(_ws_wt_branch …); registered=$?` — **two statements, `local` on its own line.** `local branch=$(cmd)` returns `local`'s status (always 0) and would make every path look registered.
- `dirty=$(…) || die` — the old code swallowed the status, so an unreadable tree read as clean. It was not then *removed*: `git worktree remove` runs its own dirty check and refuses. What actually happened is the kill-then-die one row up — the session stopped and the unit disabled, then a refusal. `_ws_gc_dirty` already documents the opposite rule ("Unknown counts as dirty"); `ws-rm` now agrees. Reachable, and pinned: truncate the workspace's private index (`$main/.git/worktrees/<slug>/index`) and `status --porcelain` exits 128 while `--git-common-dir` still answers, so the identity guard passes and this line is all that is left.
- The old `[[ … ]] && git … 2>/dev/null || true` one-liner is deleted: it conflated "no branch" with "delete failed" and reported neither. Every branch outcome is now an explicit `if/elif/else` with its own message.
- `_ws_wt_branch` reads via `< <(…)`, so git's own exit status is invisible; that is intentional and commented — a failed `worktree list` yields no records, which resolves to "no evidence", which deletes nothing.
- No `--force` anywhere, no `-D` anywhere, no repo-wide `git worktree prune` — `prune` is only ever *suggested* in a die message.

### Verified

`wsrm-cases.sh` (mirrors `makeCcdHarness`: isolated `HOME`, real git repos with an origin) run against both scripts:

```
current ccd : PASS=27 FAIL=8
patched     : PASS=35 FAIL=0
```

The 8 baseline failures are cases 1, 2, 3, 5, 6, 7; all 12 existing-behaviour guards (happy path incl. the exact `calls()` sequence, ws-rename, dirty refusal, untracked refusal, unmerged survival, main-checkout refusal, unknown id) stay green in both. Additionally verified by hand: a symlinked `~/worktrees` (git records `/real-worktrees/…`, registry holds `/worktrees/…` — `_ws_realpath` matches them and the branch is deleted); the whole `$WORKTREES_ROOT/<project>` removed (walk-up path); `$main` deleted (clean single-line output); a locked registration (refuses, keeps everything).

## 5. Tests to add — `test/ccd-workspaces.test.ts`, inside `describe('ws-rm')`

The existing `addOne()` / `RM` helpers and `h.sh`/`reg`/`calls` aliases are reused unchanged. `sh()` returns stdout only, so snippets that assert on a message append `2>&1`.

```ts
  const main = (): string => path.join(home, 'projects', 'demo');
  const branches = (glob: string): string =>
    execFileSync('git', ['-C', main(), 'branch', '--list', glob], { encoding: 'utf8' }).trim();
  const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, HOME: home,
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' });

  // THE BUG. A hand-deleted directory left the branch with no worktree, no
  // registry entry and no ws-gc row — invisible forever. git still holds the
  // record (marked `prunable`), which is both where the name comes from and
  // what blocks `branch -d` until `worktree remove` clears it.
  it('deletes the branch when the worktree directory was removed by hand', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });
    sh(`${RM} cmd_ws_rm demo-quiet-mesa`);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(branches('ws/quiet-mesa')).toBe('');
    expect(execFileSync('git', ['-C', main(), 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8' })).not.toContain('quiet-mesa');
  });

  // Not "delete more": an unmerged branch still survives on that path — and now
  // says so, instead of being kept in silence by `2>/dev/null || true`.
  it('keeps an unmerged branch when the directory is gone, and says it kept it', () => {
    const wt = addOne();
    fs.writeFileSync(path.join(wt, 'x.txt'), 'ahead\n');
    execFileSync('git', ['-C', wt, 'add', 'x.txt'], { env: gitEnv() });
    execFileSync('git', ['-C', wt, 'commit', '-m', 'ahead of base'], { env: gitEnv() });
    const sha = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    fs.rmSync(wt, { recursive: true, force: true });

    const out = sh(`${RM} cmd_ws_rm demo-quiet-mesa 2>&1`);
    expect(out).toContain('kept branch ws/quiet-mesa');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(execFileSync('git', ['-C', main(), 'branch', '--contains', sha],
      { encoding: 'utf8' })).toContain('quiet-mesa');
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
  });

  // The wrong-branch test. A hand `git branch -m` bypasses ws-rename, so the
  // registry keeps the OLD name — and a decoy under that old name is merged,
  // i.e. `branch -d` would happily take it. Git's record wins; the decoy lives.
  // This is what fails loudly if anyone "simplifies" the fix to "use the
  // registry field".
  it('trusts git over the registry when they disagree, and touches nothing else', () => {
    const wt = addOne();
    execFileSync('git', ['-C', wt, 'branch', '-m', 'feat/handmade'], { env: gitEnv() });
    execFileSync('git', ['-C', main(), 'branch', 'ws/quiet-mesa', 'main'], { env: gitEnv() });
    fs.rmSync(wt, { recursive: true, force: true });

    const out = sh(`${RM} cmd_ws_rm demo-quiet-mesa 2>&1`);
    expect(branches('feat/handmade')).toBe('');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(out).toContain("registry recorded 'ws/quiet-mesa'");
  });

  // Rung 3: no worktree record at all. Deleting the wrong branch costs more
  // than leaving the right one, so ws-rm finishes the teardown and hands over
  // the command instead of guessing from an uncorroborated registry field.
  it('will not delete an uncorroborated branch, and names the command instead', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });
    execFileSync('git', ['-C', main(), 'worktree', 'prune']);
    const out = sh(`${RM} cmd_ws_rm demo-quiet-mesa 2>&1`);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(out).toContain('branch -d ws/quiet-mesa');
  });

  // REFUSE FIRST. Previously this killed the session and the unit, then died on
  // `worktree remove` — the worst of both.
  it('refuses a directory that is not a worktree of the project, before any teardown', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });
    execFileSync('git', ['-C', main(), 'worktree', 'prune']);
    fs.mkdirSync(wt, { recursive: true });
    expect(() => sh(`${RM} cmd_ws_rm demo-quiet-mesa`)).toThrow();
    expect(reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    expect(fs.existsSync(wt)).toBe(true);
    expect(calls()).toEqual([]);
  });

  it('deletes no branch for a detached HEAD, and still clears the record', () => {
    const wt = addOne();
    execFileSync('git', ['-C', wt, 'checkout', '--detach'], { env: gitEnv() });
    fs.rmSync(wt, { recursive: true, force: true });
    sh(`${RM} cmd_ws_rm demo-quiet-mesa`);
    expect(reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(execFileSync('git', ['-C', main(), 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8' })).not.toContain('quiet-mesa');
  });
```

Keep every existing `ws-rm` test; the "removes the RENAMED branch after ws-rename" one (`FINDING 4`) is what proves rung 1 still follows `ccd ws-rename`, and the isolation test at line 29 is what keeps `PROJECTS_ROOT`/`WORKTREES_ROOT` overridable only by `HOME`.

**Red-first check:** temporarily change `branch=$(_ws_wt_branch "$main" "$workdir")` back to the old `[[ -d "$workdir" ]]`-gated `rev-parse` and re-run — the first, third and sixth tests must fail. If they stay green, the source-of-truth swap is untested.

## 5a. Every correction found in review

The bash in §4 shipped verbatim and the suite in §5 went green, and both were
still wrong: four rounds of adversarial review found states where the code did
not do what §3's table says. **§4 above has been rewritten to the bash that
actually ships**, so it is safe to re-apply; this section is the complete record
of how it differs from what §4 originally proposed, and why. An earlier version
of this section said "§4 above is kept as written", which left a section titled
*the exact bash* disagreeing with the file in **both** of its blocks — anyone
re-applying it verbatim would have re-introduced (1) through (4) below and
deleted the helper (5) hardens.

**(1) Refuse-first was decided by git's record alone, so a stale record defeated
it.** §3 row 4 promises that a directory which exists but is not a worktree of
`$main` is refused with "nothing killed, nothing removed". `registered` comes
from `git worktree list`, i.e. from the *record*, and the record outlives the
directory: hand-delete a workspace and put anything else at that path — a `git
init`, another repository's worktree — *without* `git worktree prune`, and git
still claims the path. `registered` is 0, the guard passes, `_ws_unsupervise`
and `tmux kill-session` run, and only then does `git worktree remove` refuse
("validation failed … is not a .git file") and `die`. Kill-then-die, the third
row of §1's own defect table, survived in the one state nobody built a fixture
for. §5's refusal test runs `git worktree prune` first, which is exactly the
variant where the record cannot lie — so the suite could not see it. Worse, the
`die` on `worktree remove` suggested `git worktree prune`, which is a **no-op**
while the directory exists (prune only drops records whose directory is
missing), so `ccd ws-rm` was wedged with no working recovery on offer.

The record can only answer "did git ever register this path". The missing
question is "which repository does the directory belong to *now*", and only the
directory can answer it. `_ws_common_dir` asks, and refuse-first requires both:

```bash
    local wd_common main_common
    wd_common=$(_ws_common_dir "$workdir"); main_common=$(_ws_common_dir "$main")
    (( registered == 0 )) && [[ -n "$main_common" && "$wd_common" == "$main_common" ]] \
      || die "$workdir is not a worktree of $main — nothing was touched; move or delete the directory by hand, then re-run (…)"
```

A bare `rev-parse --git-common-dir` is not comparable as printed — measured on
git 2.43.0 it returns an absolute path from a linked worktree (of either repo)
but `.git` from a repo's own checkout and `../.git` from a subdirectory of one.
**`--path-format=absolute` (git ≥ 2.31; this box runs 2.43.0) makes git answer
absolutely itself**, which is what ships:

```bash
gcd=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
```

Two earlier attempts resolved it in the shell instead — `cd -- "$dir" && cd --
"$gcd" && pwd -P`, then the same with a `CDPATH=` prefix — and **both were
wrong**, for the reason recorded in (5) and (6): capturing `cd`'s stdout means
anything else that writes to stdout lands in the answer, and `CDPATH=` closes
only the channel bash itself owns. Asking git directly needs no subshell, no
`cd`, and no reasoning about the environment at all. Verified equivalent to the
`cd` form across 20 layouts (own checkout, subdirectories, linked worktree,
worktree-of-a-worktree, `--separate-git-dir`, `.git` as a symlink, symlinked
`$PROJECTS_ROOT` and `$WORKTREES_ROOT`, hand-rewritten `gitdir:`/`commondir`
pointing through symlinks), which also collapses the symlinked-worktree-root
case, and it fails closed (non-zero, no output) on a directory in no repository.

Requiring `$main`'s side to be non-empty stops two *failures* comparing equal.
It appears unreachable now that the lookup returns non-zero rather than an empty
string on failure — `registered == 0` already implies `$main` is a repo — so
treat it as defence, not as the mechanism.

**(2) The detached-HEAD path silently orphaned the registry's branch.** §3 row 2
says "delete nothing; say so", and §4 said only `note: … was on a detached HEAD
— no branch to delete`, then wiped the registry. If the registry named a branch
that still exists in `$main` — the ordinary case, since ccd wrote that field at
`ws-add` and a hand `git checkout --detach` does not update it — that branch is
left with no worktree, no registration, no registry entry and therefore no
`ws-gc` row: verbatim the "invisible forever" state §1 exists to eliminate. §5's
detached test asserted the branch survives, which pinned the orphan as correct.
The rung-3 path already had the right shape, so this path now borrows it: name
the branch, hand over `git -C <main> branch -d <name>`, delete nothing. The
name still is not corroborated (the record git held was detached), so it is
still not deleted — the fix is to the *message*, and "say so" now includes
saying what was left behind.

**(3) `_ws_realpath` read a leading `-` as an option, and mangled the
filesystem root.** §4's original three lines were

```bash
    tail="/$(basename "$head")$tail"; head=$(dirname "$head")
  done
  real=$(cd "$head" 2>/dev/null && pwd -P) || { echo "$p"; return 0; }
  echo "${real%/}$tail"
```

Two defects, both in the shipped `_ws_realpath` block above now:

- **A path component that starts with `-` becomes an option.** `basename`,
  `dirname` and `cd` all parse their operand, so a workdir whose missing
  component is `-n` was fed to `basename -n`. Every one of the three now takes
  `--`. Measured after: `_ws_realpath -n` → `<cwd>/-n`, no stderr.
- **`${real%/}` deletes the root.** `pwd -P` prints `/` for the root and never a
  trailing slash anywhere else, so the strip is only ever right when there *is* a
  tail to re-attach; for the root with no tail it strips the only character there
  is and returns the empty string. The re-attach is now guarded on `$tail` being
  non-empty. Measured after: `/` → `/`, `/nope` → `/nope`, `//a//b` → `/a/b`,
  `/tmp/` → `/tmp`.

`_ws_realpath ""` still returns the cwd. Left alone deliberately: it is
unreachable — `workdir` is checked non-empty before `cmd_ws_rm` ever calls this.

**(4) The `worktree remove` `die` named a recovery that cannot work.** Covered in
prose by an earlier version of (1) but never shown, so here is the shipped
string: both `die` messages now name a recovery that works **in the state they
fire in**. The refuse-first one says *move or delete the directory by hand, then
re-run (with it gone, ccd clears the leftover record itself; `git worktree prune`
will not, while the directory is there)* — verified end to end: deleting the
directory really does let the next run clear the leftover record and delete the
branch. The `worktree remove` one no longer offers bare `prune`, which is a no-op
while the directory exists; it distinguishes the two reasons git actually
refuses:

```
worktree record not cleared for <workdir> — the session was stopped; git refused: unlock it (git -C <main> worktree unlock <workdir>) or clean the tree, then re-run — and if the directory is already gone, git -C <main> worktree prune clears the record
```

`worktree unlock` was verified to genuinely unblock the re-run on a locked
registration. "The session was stopped" rather than "nothing was touched",
because by that line it has been.

**(5) An exported `CDPATH` defeated `_ws_common_dir` in BOTH directions.** The
resolution in (1) was `(cd -- "$dir" && cd -- "$gcd" && pwd -P) 2>/dev/null`.
`$gcd` is a bare `.git` exactly when `$dir` is a repo's own checkout — so always
for `$main` — and bash searches `CDPATH` for any operand that is neither absolute
nor `./`- nor `../`-prefixed, then **prints the directory it landed on**. That
print is on *stdout*, so it becomes part of the function's answer and the
`2>/dev/null` catches none of it. Measured on git 2.43.0 / bash 5.2:

- `export CDPATH=.` — an ordinary `.bashrc` line — returns the right path
  **twice** for `$main` and once for a linked worktree (whose `--git-common-dir`
  is absolute and so bypasses `CDPATH`). The comparison in (1) fails and `ws-rm`
  dies *"is not a worktree of `$main`"* on **every healthy workspace of every
  project**, offering only "delete the directory by hand" — i.e. the guard added
  to protect the user's directory now demands they destroy it.
- `export CDPATH=<any dir containing .git>` sends **both** resolutions to that
  third repository. Two wrong answers compare **equal**, the guard passes, and
  the squatter of (1) is waved through: session killed, unit disabled, then
  `worktree remove` dies. Verbatim the kill-then-die (1) exists to close, and it
  kills again on every re-run.

The first fix was `CDPATH=` as a command prefix on the inner `cd`, chosen over
`cd -- "./$gcd"` because an empty assignment is **unconditional** and therefore
correct for both shapes `$gcd` takes, while a prepended `./` is correct only for
the relative one and would corrupt the absolute path a linked worktree answers
with. **That fix has since been replaced outright — see (6). It closes one of the
two ways a captured `cd` can print, and the other one regressed a healthy
`ws-rm` just as hard.**

Deliberately extended by one line beyond the report: `cmd_ws_add`'s
`common=$(cd "$main" && cd "$(git rev-parse --git-common-dir)" && pwd -P)` is
where this pattern was *inherited* from, and it is not merely latent there — its
`$common` feeds `$common/info/exclude`. Measured under `CDPATH=.` in an
isolated-HOME fixture, the two-line `$common` sends the `.ccrc/` line to a path
with an embedded newline instead of `$main/.git/info/exclude`, so `.ccrc/` is
left un-ignored in every worktree of that repo. An earlier version of this
paragraph added that "`_ws_realpath` needs no such change: its `cd` operand is
`$head`, which only ever walks *up* an already-absolute path" — true of CDPATH
and of nothing else, and corrected in (6).

**(6) `CDPATH=` was the wrong SHAPE of fix, and the channel it left open
regressed a healthy `ws-rm` exactly as hard.** A `CDPATH=` prefix stops bash's
**own** `cd` from printing. It stops nothing else. A `cd` defined as a shell
function and exported with `export -f` is imported by every bash child through
the environment (as `BASH_FUNC_cd%%`), so it reaches `bash ccd` no matter what
the script writes on the `cd` line — and the classic wrapper, `builtin cd "$@" &&
echo …`, echoes on every call, onto the captured stdout. Measured against the
`CDPATH=` fix in an isolated-HOME fixture: `$wd_common` and `$main_common` both
arrive multi-line and differ in their first line, the comparison in (1) fails,
and `ws-rm` refuses a **healthy** workspace (`rc=1`, directory and registry both
intact) with the message that offers only "delete the directory by hand" — a
strict regression from `b0d9fc7`, which removed it correctly. `readonly CDPATH=.`
in a shell that then *sources* ccd is a second instance: the prefix assignment
itself fails and the subshell returns empty. The dangerous direction stays
fail-safe — a squatter is still refused with `calls()` empty, because two
*different* chatty answers cannot compare equal.

Nothing that can be written on a `cd` whose stdout is captured makes it safe, so
the two `--git-common-dir` sites stop using `cd` at all:

```
git -C "$dir" rev-parse --path-format=absolute --git-common-dir
```

`--path-format=absolute` is git ≥ 2.31 (this fleet runs 2.43) and answers the
same question with no subshell, no `cd` and no CDPATH reasoning — which is what
retired the 13-line rationale above and the `readonly CDPATH` case with it.
Measured **before** replacing anything, against the resolution it replaces:
byte-identical for a repo's own checkout, a subdirectory of one, a linked
worktree, a worktree of a worktree, `--separate-git-dir` (and a worktree of one),
a `.git` that is itself a symlink, a bare repo, a checkout reached through a
symlink, and a main and its worktree reached through two *different* symlinks —
both sides still comparing **equal**, which is the only property the guard needs.
Non-zero with no output for a directory in no repository and for a nonexistent
path. 20 layouts, 0 differences; identical under exported `GIT_DIR` and
`GIT_COMMON_DIR` too. `cmd_ws_add` takes the same call, so its `CDPATH=` prefix
is gone too — and with it a comment that claimed the misdirected write would land
"in a THIRD repository's `info/exclude`". It never could: the captured print
makes the path **two lines**, so `mkdir -p` creates a junk directory whose name
ends in a newline, `.ccrc/` is written inside that, and neither repo's exclude
gets the line.

Three more `cd` captures were the same class, and replacing the two above was
measured **not** to close it:

- **`_ws_realpath`.** Its operand is always absolute, so CDPATH never reached it,
  but an exported `cd` prints regardless of the operand. Its answer is what
  `_ws_wt_branch` compares against git's records, and on the layout the fleet
  actually runs — `$HOME/worktrees` a symlink — that comparison is the only one
  that can match (`$cur == $path` cannot). Measured: with both
  `--git-common-dir` sites already fixed, a chatty `cd` **still** refused a
  healthy workspace there.
- **`_ws_gc_scan`**, twice (`$wsroot` and `$mainreal`). Both roots gain a
  newline, every prefix test in `_ws_gc_row` fails, and every workspace ccd owns
  is reported `foreign` instead of `tracked`. Inert rather than destructive —
  `ws-gc --prune` declines foreign rows — but the fleet silently stops seeing its
  own reclaimable space.

None of the three can ask git: the path need not exist and need not be in a
repository at all. They redirect `cd` itself instead, so only `pwd -P` can answer
— `>/dev/null 2>&1`, not `2>/dev/null`. Measured: exactly one line of output
under a chatty exported `cd`, under `CDPATH=.` and under `readonly CDPATH=.`,
and `_ws_realpath`'s `|| { echo "$p"; return 0; }` fallback still fires when `cd`
genuinely fails.

**(7) The `cmd_ws_add` hardening shipped with zero regression coverage, and the
control named for it could not fail.** (5) claimed "the existing `ws-add`
`info/exclude` assertion is the control for the `cmd_ws_add` line". True as
worded — it pins the normal path — and useless: it never runs under a hostile
environment, so the line could be reverted with all 419 tests green. Retracted,
and the test now has a hostile variant that asserts *where* the write landed
rather than only that it exists; see the table below.

### The tests each round added

**For (1) and (2)**, four tests, for the states the original suite could not
reach: the directory recreated as its own repository (committed, so the dirty
guard is not what refuses), recreated as another repository's worktree, a second
run of a refused removal (which used to kill twice), and the detached message
naming the branch. Suite: 413 → 417.

**For (5)**, two tests, one per direction — a healthy workspace still removed
under `CDPATH=.`, and (1)'s squatter still refused with `calls()` empty under a
`CDPATH` holding a decoy `.git`. Both were watched fail first, with the exact two
failures predicted above. The harness's existing `sh(snippet, env)` parameter is
what passes `CDPATH`, so no harness change was needed. Suite: 417 → 419, all
green. Its claim about the `cmd_ws_add` control is retracted in (7).

**For (6) and (7)**, five tests, all watched fail first, and every one of the five
changed lines shown to be load-bearing by reverting it **alone**, in place:

| line reverted | goes red |
|---|---|
| `_ws_realpath`'s `>/dev/null` | the symlinked-root chatty `ws-rm` (1 failed) |
| `_ws_common_dir` → the `CDPATH=` form | both chatty `ws-rm` directions (2 failed) |
| `cmd_ws_add` → the `CDPATH=` form | the `ws-add` hostile variant, shape 2 (1 failed) |
| `cmd_ws_add` → the unhardened form | the `ws-add` hostile variant, shape 1 (1 failed) |
| either `_ws_gc_scan` capture | the `ws-gc` chatty classification test (1 failed) |

Three sit in `describe('ws-rm')` beside (5)'s pair — healthy, healthy under a
symlinked `$HOME/worktrees`, and the squatter — one in `ccd-ws-gc.test.ts`
requiring `_ws_gc_scan` to produce byte-identical output with and without the
shadow, and one is the `ws-add` hostile variant, which runs the exclude write
under **both** shapes (a real repo on `CDPATH`, asserting the decoy's own exclude
stays clean; then an exported chatty `cd`, on a second project so the
`grep -qxF` short-circuit cannot make it pass off the first write). The chatty
`cd` is injected as the environment variable bash itself uses for exported
functions, `BASH_FUNC_cd%%`, through the existing `sh(snippet, env)` — again no
harness change. Suite: 419 → 424, all green.

**(3), (4) and (8) carry no new test.** (3) and (4) were reached by inspection and
confirmed by direct measurement of the helper and the message, and both are about
inputs the callers cannot produce (a `-`-leading component, the filesystem root)
or about a string. (8) is a §3 row, not a behaviour change. §3's rows are the
specification; a message assertion pinned to either wording would break on the
next honest rewording.

**(8) §3's "Registration is locked" row promised an outcome without saying which
state it holds in** — the same defect class this round's earlier edit fixed in the
`$main` rows one line above it, left untouched in the same commit. "Registry and
branch both intact" is true, but the session is already stopped by then: locking
is not a state `_ws_common_dir` can see, so refuse-first cannot fire, and
`_ws_unsupervise` and `tmux kill-session` have both run before git declines.
Measured in both directions (directory present, and hand-deleted): exit 1,
`calls()` = `[unsupervise demo-quiet-mesa, tmux kill-session -t
cc-demo-quiet-mesa]`, registry entry and `ws/quiet-mesa` both still there, and
the `die` naming `git -C <main> worktree unlock <workdir>`. The shipped string was
already honest ("the session was stopped"); only the table row was silent. Row
corrected, no code change.

## 6. Deliberately out of scope

`_ws_gc_prune_row`'s `dead-reg` branch (`ccd:~500`) has the identical hole: it `rm -f "$REG/…".*` without touching the branch. By this spec's ladder `dead-reg` is *by definition* rung 3 — it exists only when git has no record — so the correct change there is a **message**, not a deletion: name the registry's branch and hand over `git -C <main> branch -d <name>`. One-line follow-up, same rule, no new risk.

---

# PART 2 — Selection is polarity. Status is hue. Neither borrows the other's channel.

Synthesis of the winner (*Reverse Video*, 19) with two grafts from the runners-up: *Elevation*'s decision to keep the amber perimeter, and *Ink rail*'s `aria-current` (both proposed it; neither shipped it correctly). Verified: applied to the real files, `409/409` tests and `92/92` contrast pairs pass; with the implementation reverted, 12 of the 16 new tests go red.

## The law

**Selection is achromatic polarity. Status is hue. Status never owns a perimeter except attention. Selection never owns a perimeter at all.**

This is forced, not chosen: `--accent` and `--status-busy` are the same hex (`#45D67E`), and the four account hues own the cool half of the wheel — so on the fleet screen every hue is spoken for and any coloured selection is a status or identity collision by construction. Polarity is the one channel status does not use and cannot use, and it reads in every vision type and in greyscale.

Scope of the law: **the fleet screen**, where status and selection coexist. `.proj-row--selected` in the project-picker sheet (`fleet.css:426`, `background: var(--accent-tint)`) stays exactly as it is — that list renders no status marks at all, so there is nothing there for a hue to collide with. The winner's claim that *any* coloured selection is a collision was overreach; this is the precise version.

**Desktop-only by construction.** `shell.css:24-26` hides `.shell-nav` below 900px once a session is open, so `.sess-line--active` cannot render on a phone. Review this at 1440×900, not in a 390px frame — and the "near-white bar on a phone in bed" risk does not exist.

## The CSS (real tokens, measured with `design/contrast-check.mjs`'s own math)

Replace `fleet.css:563` (`.sess-line--active { background: var(--bg-raised); }`) with:

```css
/* ── SELECTION — reverse video ────────────────────────────────────
   Selection takes the two loudest channels a row has — the fill and the
   POLARITY of its ink — and status is evicted from both. It cannot be
   chromatic here: --accent and --status-busy are the same hex (#45D67E,
   tokens.css) and the four account hues own the cool half of the wheel, so
   any coloured selection on THIS screen is a status or identity collision by
   construction. Polarity is the one channel status does not use and cannot
   use, and it reads in every vision type and in greyscale.
   The old signal was --bg-raised on --bg-surface: 1.10:1 dark / 1.17:1 light
   — less than the hairline that merely separates one card from the next
   (1.25 / 1.31), and the same fill the ··· button already wears on every row.
   The new one is 15.68:1 dark / 16.58:1 light.
   Desktop-only by construction: shell.css hides .shell-nav below 900px once a
   session is open, so no phone ever renders a selected row. */
.sess-line--active {
  background: var(--ink-primary);
  color: var(--bg-page);               /* 16.94:1 dark / 15.26:1 light */
}

/* .sess-open is color: inherit, so the label inherits the flip. Weight is the
   second, non-colour channel. */
.sess-line--active .sess-label { font-weight: var(--weight-semibold); }

/* The meta line goes achromatic. --status-*-text and the account hues are
   tuned for --bg-surface and die on the slab (busy-text 1.47:1 dark / 2.61:1
   light; acct claude 1.46 / 2.42). The SEMANTICS survive: the state is still
   the word working/waiting/exited, ⚠ is still a shape, the account is still
   its mono name (tokens.css: "colour is the secondary cue"), and the status
   hue survives in the lamp two cells left. --edge-strong rather than
   --bg-raised: it flips polarity with the pair (#39403A dark, #C3CAC2 light)
   and lands at 9.27:1 / 9.91:1, which keeps a REAL ink step under the 16.94:1
   label instead of two maximal inks pretending to be a hierarchy. */
.sess-line--active .sess-meta,
.sess-line--active .sess-state,
.sess-line--active .sess-tally,
.sess-line--active .sess-warn,
.sess-line--active .sess-acct,
.sess-line--active .sess-acct-away,
.sess-line--active .sess-meta > *:not(:first-child)::before {
  color: var(--edge-strong);
}

/* The lamp keeps its hue by keeping its floor. --lamp-size (18px) has sat in
   tokens.css since day one, documented as exactly this ("status-dot lamp
   bezel: --bg-well floor") and used nowhere. The plate is what makes every dot
   on this row sit on --bg-well — the one background design/contrast-check.mjs
   already verifies all four dots against at 3:1 in BOTH themes (dark 10.67 /
   11.20 / 5.31 / 6.08; light 4.10 / 4.64 / 3.83 / 3.15). Without it the
   dark-theme dots die on the near-white slab (busy 1.63, attention 1.55).
   Absolutely positioned so it costs the first grid column nothing: widening
   .sess-lamp would push this row's label ~10px right of every sibling's and
   break the shared left edge. At 18px centred on an 8px dot it overhangs 5px
   per side into the row's own 8px padding and 8px gap — no reflow, no tap
   target moves. */
.sess-line--active .sess-lamp { position: relative; }
.sess-line--active .sess-lamp::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--lamp-size);
  height: var(--lamp-size);
  margin: calc(var(--lamp-size) / -2) 0 0 calc(var(--lamp-size) / -2);
  border-radius: var(--r-full);
  background: var(--bg-well);
}
/* The plate is positioned; without this it paints over the unpositioned dot. */
.sess-line--active .sess-lamp > .dot { position: relative; }

/* The ··· keeps its 32×32 box, hairline and tap overlay — it flips polarity
   with the row instead of dissolving into it. Its normal --bg-raised fill is
   14.32:1 against the slab, i.e. a bright chip punched into the bar, the
   inverse of its shipped identity. Re-grounding to --bg-page keeps the matched
   pair with .proj-card-add intact in form (glyph 9.36:1 dark / 6.81:1 light on
   that fill). The hairline stays exempt as a hairline, exactly as
   --edge-subtle on --bg-raised is. */
.sess-line--active .sess-actions {
  background: var(--bg-page);
  border-color: var(--edge-strong);
  color: var(--ink-secondary);
}

/* base.css draws :focus-visible in --accent, which measures 1.63:1 on the dark
   slab — an invisible ring on exactly the row most likely to hold focus.
   Colour only, plus a 1px offset so the ring's outer edge lands 3px out,
   inside the row's own 4px padding, instead of flush with the slab's edge
   where subpixel rounding can drop 1px onto --bg-surface. */
.sess-line--active :focus-visible {
  outline-color: var(--bg-page);
  outline-offset: 1px;
}

/* Forced colours flatten fill AND ink to Canvas/CanvasText: the polarity
   channel does not exist there, and the row would be left with font-weight
   alone. An inset border is the channel that survives. */
@media (forced-colors: active) {
  .sess-line--active {
    outline: 2px solid CanvasText;
    outline-offset: -2px;
  }
}
```

Replace `fleet.css:737-738` (the two status borders) with:

```css
/* .proj-card--busy is DELETED. Green on the perimeter is what was being read
   as "selected project", and on a one-session project (9 of 9 live)
   `group.busy > 0` is the same predicate the row already renders three times:
   the lamp's hue, its glow + breathe, and the word "working".
   Amber STAYS, byte for byte. Attention is the only status that asks the
   reader to act and the one a fold must never hide; with green gone it is the
   only coloured perimeter on the screen, so it reads as an exception rather
   than as wallpaper (it fires on 0 of 9 live cards). Selection never touches a
   perimeter under this design, so the two can never contend for it. */
.proj-card--attention { border-color: var(--status-attention-text); }
```

After `fleet.css:785` (`.proj-card-attn`), add:

```css
/* The one thing the green perimeter said that a row cannot: something is
   running inside a FOLDED card. It comes back as a WORD, never a second dot.
   A green ● beside the amber ● would separate the two most opposite meanings
   on this screen by hue alone, at 1.06:1 luminance in dark and 1.07:1 in
   light, with no tempo (neither glyph is a .dot, so neither breathes or
   pulses) and no word — unreadable in greyscale, under deuteranopia, and under
   prefers-reduced-motion. The rule instead: ATTENTION IS A MARK, BUSY IS A
   WORD. Different form, so the distinction survives with no colour at all.
   --status-busy-text / --bg-surface is an already-gated pair (10.70:1 dark,
   6.34:1 light). */
.proj-card-busy {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--status-busy-text);
}

/* A fold hides the selected row exactly as it would hide a pending dialog, so
   the card name wears the slab at chip scale — one idiom at two scales, so
   "inverted = the one you are in" reads the same on a row and on a folded
   card. Costs 8px of a nowrap+ellipsis name, on one card, only while folded. */
.proj-card[data-holds-selection] .proj-card-name {
  background: var(--ink-primary);
  color: var(--bg-page);
  border-radius: var(--r-sm);
  padding: 0 var(--sp-1);
}
```

## The JSX — three files, five edits

**`src/fleet/ProjectCard.tsx:59-64`** — the card stops reading busy and starts reading selection:

```tsx
  // Status never owns the card's perimeter except for attention (the one state
  // that asks the reader to ACT). Busy lost it: on a one-session project the
  // rollup was a strict duplicate of the row's own lamp + word, and green on a
  // frame was being read as "selected".
  const cardClass = 'proj-card' + (group.attention ? ' proj-card--attention' : '');

  // Selection is a fact about the reader, not about the project, so it never
  // touches the perimeter — but a fold can hide it exactly as it can hide a
  // pending dialog, so the header carries it (as the slab, at chip scale)
  // while folded. This is the only place the card itself reads selectedId.
  const holdsSelection =
    collapsed && selectedId !== null && group.sessions.some((s) => s.id === selectedId);

  return (
    <section
      className={cardClass}
      data-collapsed={collapsed || undefined}
      data-holds-selection={holdsSelection || undefined}
    >
```

**`src/fleet/ProjectCard.tsx`, after the `group.attention` glyph (line 100)** — busy's fold-proof channel:

```tsx
          {/* Attention is an interrupt and shows folded or not; busy is ambient
              and shows only when the fold has hidden the rows that carry it.
              A WORD, never a second dot — two ● glyphs differing only in hue
              sit at 1.06:1 luminance and would make "quietly working, ignore"
              and "blocked, waiting on you" indistinguishable in greyscale. */}
          {collapsed && group.busy > 0 && (
            <span className="proj-card-busy">
              {group.busy > 1 ? `${group.busy} working` : 'working'}
            </span>
          )}
```

No `role="img"`, no `aria-label`: it is text, so its accessible name is its text, and it cannot duplicate `StatusDot`'s `role=img`/`working` the way a dot would (that duplication broke two tests when a runner-up tried it).

**`src/fleet/SessionLine.tsx:76-78`** — the inline account colour must be dropped, not overridden:

```tsx
  // Inline styles beat every selector short of !important, so the account hue
  // has to be dropped HERE on the selected row: .sess-line--active's achromatic
  // override could never win against it, and the hue measures 1.46:1 on the
  // dark slab. The account survives as its mono name.
  const acctStyle: CSSProperties | undefined = selected
    ? undefined
    : dead
      ? { color: 'var(--ink-secondary)' }
      : { color: `var(${acctVar})` };
```

**`src/fleet/SessionLine.tsx:91`** — selection becomes real to assistive tech (grep confirms there is no `aria-current` anywhere in `src/` today; one review claimed it already ships — it does not):

```tsx
      {/* Selection reached nothing but a className before this: there is no
          other aria-current in src. The row navigates to /s/<id>, so `page`
          is the correct token — this is not a listbox option. */}
      <button
        ref={labelRef}
        type="button"
        className="sess-open"
        aria-current={selected ? 'page' : undefined}
        onClick={open}
      >
```

**`design/contrast-check.mjs`** — add `edgeStrong: "#39403A"` to `D`, `edgeStrong: "#C3CAC2"` to `Lt`, and exactly **one** pair (90 → 92, all passing at 9.27 dark / 9.91 light):

```js
  // The selected fleet row inverts (.sess-line--active: background
  // --ink-primary), so its 12px meta line takes --edge-strong ON the slab — a
  // hairline token used as text, which is the ONE genuinely new combination
  // this treatment introduces. Everything else it needs is already gated and
  // ratios are symmetric: the label's ink (--bg-page on --ink-primary) is
  // `ink-primary / page`, the ··· glyph is `ink-secondary / page`, and the four
  // dots on the lamp plate are the `* dot / lamp well` pairs.
  // Do NOT add "dot on the selected slab" pairs: pairs() runs every entry in
  // BOTH themes (line below), and those dots measure 1.55-2.87 in dark, which
  // would redden the gate for a state that cannot occur — the plate is what
  // they actually sit on.
  [`${name} selected-row meta ink / slab`, T.edgeStrong, T.inkP, 4.5],
```

## The green and amber card borders

**Green is deleted. Amber stays, untouched.**

The winner deleted both; *Elevation* kept amber and was fatally flawed only because it put selection on `border-color` too. This design puts selection on `background`/`color`, so the collision that killed *Elevation* cannot occur: **no rule in this spec sets `border-color` on `.proj-card`.** With green gone, the perimeter is monosemous — one colour, one meaning, "this project is waiting on you" — and it fires on 0 of 9 live cards, so it reads as an alarm instead of decoration.

## What information is removed, and where it lives now

| Removed | Where it lives |
|---|---|
| **Green card border, expanded card** (every live card) | The row already says it three times: the `--status-busy` lamp, its `--glow-dot-busy` + `dot-breathe`, and the word `working` in `--status-busy-text`. On a one-session project `group.busy > 0` *is* `session.status === 'busy'` — the border was a fourth rendering of one fact, in the loudest channel on the screen. |
| **Green card border, collapsed card** — the only thing it said that a row could not | `.proj-card-busy`: the mono word `working` / `N working` in the card head, rendered only while folded. |
| **"how many are busy"** | The border never carried it (a boolean over a count). The word does: `2 working`. |
| **Status hue on the selected row's meta line** (`working`/`waiting` colour, the red `⚠`, the account hue) | The state is still a **word**; `⚠` is still a **shape**; the account is still its **mono name** (tokens.css already rules that for chips "colour is the secondary cue"); and the status **hue survives intact in the lamp**, on its `--bg-well` plate, two cells to the left. This affects exactly one row on the screen — the one whose full detail is open in the pane beside it. |

Nothing else is lost. `group.busy` and `group.attention` keep their meanings and both are still consumed.

## A correction found in review: the busy count is not the busy word

The sentence directly above is where this spec was wrong. `group.busy` could **not** keep its meaning, because the same edit that promoted it from a boolean to a rendered number also changed what it is claiming.

**The two predicates never agreed.** `groupFleet.ts` counted `m.status === 'busy'`. `SessionLine.tsx` renders the word attention-first — `busy = !attention && status === 'busy'`, where `attention = !dead && dialogPending` — so `waiting` outranks `working` on a row. The two diverge on exactly one state, `status: 'busy'` **and** `dialogPending: true`, and that state is fully reachable: `server/src/fleet.ts:73` derives `dialogPending` from a separate pending-dialog set with no coupling to `status`.

**Why the divergence was harmless until this design, and is not now.** `busy` only ever fed `group.busy > 0` on `.proj-card--busy`, a boolean border. A busy session holding a pending dialog made that border true, and something *was* running, so the border was still honest. This spec deletes the border and replaces it with a counted word — the table row above literally banks the upgrade ("the border never carried it (a boolean over a count). The word does: `2 working`"). A count is a claim about the rows the fold is hiding, and the claim was false. The bug ships in this spec's own JSX (line 513), not in the implementation of it: `{collapsed && group.busy > 0 && …}` reads a predicate that does not mean what the word says.

Two reproductions, both rendered through the real `groupFleet` + `ProjectCard`:

| State | Folded head | Same sessions, expanded |
|---|---|---|
| One session, `status:'busy'`, `dialogPending:true` | `▸ demo  team·max  ● working` | that one row reads **`waiting`** |
| Two sessions, both `busy`, one also `dialogPending` | `● 2 working` | `waiting` \| `working` — **one** working |

The first is the worse of the two: the amber attention mark and the word `working` describe the *same* session, so a folded card asserts two sessions in opposite states out of one that is only waiting on the reader. That is a direct hit on this design's own thesis clause — **attention is a mark, busy is a word** — which assumes the mark and the word are talking about different sessions.

**The fix**, one predicate, in `groupFleet.ts`:

```ts
busy: members.filter((m) => m.status === 'busy' && !m.dialogPending).length,
```

No dead clause is needed (`dead` and `busy` are exclusive statuses; that is why `attention` needs its explicit one). `group.attention` is untouched — both facts are true of such a session, and mark and word are different forms, so they never contend. `group.busy` has exactly **one** consumer, `ProjectCard`'s folded word, so the changed meaning reaches nothing else; the fix belongs in `groupFleet` rather than at the call site, and the field now carries a doc comment saying it counts *the word*, not the status.

Add to the test list under **`test/groupFleet.test.ts`**: a busy + `dialogPending` member counts 0 while `attention` stays true, and a group of one such member plus one merely-busy member counts 1. Add to **`test/project-card.test.tsx`**: the two reproductions above, folded and expanded asserted in the same `it` (the defect *is* the disagreement between them), with the group built by the real `groupFleet` — a hand-written `busy: 1` literal pins the bug instead of the rule. Existing counterparts stay green: `groupFleet`'s "counts busy members for the collapsed header" (no dialogs) and the `getAllByText('working')` control, which already pinned the expanded side of precisely this mismatch while nothing pinned the folded side.

Suite after: `413/413`, `92/92` contrast pairs, `tsc` clean.

## Every fatal flaw, against the parts kept

1. **"Collapsed card: busy vs attention becomes hue-only at 1.06:1, no tempo, no word — a regression."** *Resolved by changing the form, not the colour.* Busy is a **word**, attention stays a **mark**. Presence/absence is preserved and upgraded: a folded card now says either `● ` (amber, act) or `working` (ambient) or both, and the two are distinguishable with the screen in greyscale, with `prefers-reduced-motion` on, and with no colour perception at all. Pinned by `queryByRole('img', { name: /working/ })` returning null on a folded busy card.
2. **"Do not add the proposed pairs to `contrast-check.mjs` — `pairs()` is theme-symmetric and the dark dots would redden the gate."** *Accepted verbatim.* The winner's five bullets are not added; the "dots on the light slab" pairs in particular are explicitly warned against in the comment. Exactly one pair is added (`edge-strong / ink-primary`), which passes in both themes because the token flips polarity with the pair. Verified: `ALL 92 PASS`.
3. **"Light + selected + dead = 2.89:1, rescued to 3.15 by a plate at 1.09:1 — legalistic."** *Reframed and accepted with its real number.* The plate is not a bezel; it is the guarantee that every dot on this row sits on `--bg-well` — the one background the gate already verifies all four dots against, in both themes, and the exact surface tokens.css annotates for light `--status-dead` ("3.15:1 vs lamp well"). The "still load-bearing in light" rhetoric is dropped. 3.15 clears 1.4.11 by 5%, and 1.4.1 is independently clean: `role="img" aria-label="not running"` plus the word `exited` at 9.27:1 two cells away. `--status-dead` is not lifted — a token change to fix one composited state would move every dead mark in the app.
4. **"`.sess-actions` becomes a bright chip on a dark slab in light theme and no rule was supplied."** *Rule supplied.* It flips polarity with the row: `--bg-page` fill, `--edge-strong` hairline, `--ink-secondary` glyph (9.36:1 dark / 6.81:1 light). Box, alignment and the 44px `::before` overlay are untouched, so the matched pair with `.proj-card-add` survives — `fleet-css.test.ts`'s pair assertion reads the base rule and stays green.
5. **"Ink ladder collapses: 16.94 vs 14.32 is two maximal inks, not a hierarchy."** *Fixed with the runner-up's own suggestion.* The meta line takes `--edge-strong` (9.27 / 9.91), which flips polarity with the pair and gives a real secondary step under the label.
6. **"The forced-colors claim is false — only font-weight survives."** *Correct, and fixed* with an explicit `@media (forced-colors: active)` inset `CanvasText` outline.
7. **"`.proj-row--selected` already ships a chromatic selection fill, contradicting the thesis."** *Correct; the thesis is narrowed rather than the sheet changed.* The law binds the fleet screen, where status and selection coexist; the picker sheet renders no status marks, so `--accent-tint` there collides with nothing.
8. **"`.sess-line--active` cannot render below 900px, so on the phone this is pure subtraction."** *True and stated up front.* On a phone the fleet and the session never share a screen, so there is no selection to show; what the phone loses is only the green border, whose information the row and the folded-card word both carry. Review at 1440×900.
9. **"Salience inversion — the slab wins the first fixation while a pending dialog is 8px."** *Partly accepted, partly answered.* The selected row is loud but **static and constant**, and the eye habituates to it; attention is an **onset** — an amber dot appearing and pulsing at double tempo — plus an amber perimeter that this design **keeps** (the winner deleted it), plus a fold-proof `●`. The selected row is also the one already open beside it, so a false first fixation costs nothing.

## Tests to pin it

All verified: `409/409` with the design applied; reverting `src/` + `design/` turns 12 of these red (the other 4 are controls/regression guards that must stay green either way).

**`test/fleet-css.test.ts`** — jsdom applies no stylesheet, so these read the CSS as text via the existing `ruleFor` helper. Note `ruleFor`'s regex anchors at line start, so descendant selectors like `.sess-line--active .sess-actions {` cannot hijack the base `.sess-actions` lookups.

- inverts the selected row: `.sess-line--active` contains `background: var(--ink-primary)` **and** `color: var(--bg-page)`
- no busy perimeter left, amber intact: `expect(() => ruleFor('.proj-card--busy')).toThrow()` (assert the *rule* is gone, not the string — the deletion note names the class) and `css` still contains the exact `.proj-card--attention` line
- strips every status/account hue from the slab: the multi-selector block names `.sess-state`, `.sess-tally`, `.sess-warn`, `.sess-acct`, `.sess-acct-away` and the `:not(:first-child)::before` middot, and declares `color: var(--edge-strong)` — this is the one that catches a *stranded* descendant when someone adds a new coloured cell to `.sess-meta`
- the lamp plate: `background: var(--bg-well)`, `width: var(--lamp-size)`, `position: absolute`, and `.sess-line--active .sess-lamp > .dot { position: relative }`
- the focus ring survives: `outline-color: var(--bg-page)`
- the ··· stays a real button: `background: var(--bg-page)` and **no** `width`/`height` (colour only)
- forced colours: a `@media (forced-colors: active)` block giving `.sess-line--active` `outline: 2px solid CanvasText`

**`test/project-card.test.tsx`**

- never puts busy on the card border (className lacks `proj-card--busy` with `busy: 1`)
- still puts attention on it *(control — green before and after)*
- says what is running inside a folded card **as a word, not a second dot**: `getByText('2 working')` **and** `queryByRole('img', { name: /working/ })` is null
- leaves the header silent about busy while the rows are visible: `getAllByText('working')` has length 1 *(control — this is what stops anyone "improving" the word into an always-on header rollup and re-creating the duplication)*
- marks a folded card that holds the selection (`data-holds-selection` present)
- does not mark an expanded card, and does not mark a folded card holding no selected session *(controls)*

**`test/session-line.test.tsx`**

- announces the open row: `aria-current="page"` on the label button when `selected`, absent otherwise
- **drops the inline account hue when selected** — `.sess-acct`'s `style.color` is `''` selected and non-empty otherwise. This is the one that fails if someone reverts `acctStyle` to a plain `CSSProperties`, and it is the difference between an achromatic row and an account hue sitting at 1.46:1 on the slab.

**`test/contrast.test.ts`** — unchanged; it already fails on any `FAIL` line and on a non-zero exit. The new pair rides the existing gate at 92.

## Residual risks, named

- **The slab is loud in dark theme** (near-white bar in a `#0B0D0C` app). Ship `--ink-primary` first. If it needs dimming, the single-token swap is `background: var(--ink-secondary)` (8.67:1 fill step, ink still 9.36:1) with every other rule unchanged — do not pre-emptively soften.
- **`--ink-primary` becomes a background and `--bg-page` becomes an ink.** Worth one line in tokens.css, or the next reader files it as a mistake. It is the only pairing in the set that is maximal in both themes without a per-theme override, because the two tokens flip together.
- **`--glow-dot-busy` will haze a few px of green at the plate's rim** in dark theme. Cosmetic, one row, no contrast consequence.
- **The folded-card name chip costs 8px** of a `nowrap`+ellipsis name in a 252–343px sidebar, on one card, only while folded.
- **Multi-session projects have never been seen live** (9 projects × 1 session). Fabricate a 3-session project before landing to confirm the slab reads as one row rather than a block.
