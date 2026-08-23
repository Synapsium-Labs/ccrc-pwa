# git empirics — nested / child worktrees

**Measured on this box, 2026-08-04.**

```
$ git --version
git version 2.43.0
```

All results below are MEASURED, verbatim, from throwaway fixtures built under
`/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/2a57e3e1-6822-474f-9202-2f580ed9be65/scratchpad/probes/`
(local bare repo as `origin`, one commit, no network). Fixtures deleted at the end.

Throughout, paths are abbreviated as `$P` =
`/tmp/claude-1000/-mnt-HC-Volume-105751470-projects-OpenClawHetzner/2a57e3e1-6822-474f-9202-2f580ed9be65/scratchpad/probes`
in prose; **transcript output is verbatim and shows full paths**.

## Fixture

```
$ git init --bare -b main $P/origin.git
Initialized empty Git repository in .../probes/origin.git/
$ git clone file://$P/origin.git $P/main
Cloning into '.../probes/main'...
warning: You appear to have cloned an empty repository.
$ cd $P/main && echo hello > README.md && git add README.md && git commit -m "one commit"
[main (root-commit) 86f79a1] one commit
 1 file changed, 1 insertion(+)
 create mode 100644 README.md
$ git push -u origin main
 * [new branch]      main -> main
```

Layout under test:

```
$P/origin.git                                   bare "remote"
$P/main                                         the main checkout  (branch main)
$P/W                                            linked worktree    (branch ws/w)
$P/W/.claude/worktrees/child                    child, created FROM INSIDE W   (branch agent-child)
$P/W/.claude/worktrees/child/.claude/worktrees/grandchild
                                                grandchild, created FROM INSIDE child (branch agent-grandchild)
```

---

## E1 — Where does a worktree created from inside a linked worktree register?

**ANSWER: flat sibling in the common `.git/worktrees/`. Nesting is filesystem-only.**

```
$ git -C $P/main worktree add $P/W -b ws/w
Preparing worktree (new branch 'ws/w')
HEAD is now at 86f79a1 one commit

$ git -C $P/W worktree add $P/W/.claude/worktrees/child -b agent-child
Preparing worktree (new branch 'agent-child')
HEAD is now at 86f79a1 one commit

$ git -C $P/main worktree list
.../probes/main                                86f79a1 [main]
.../probes/W                                   86f79a1 [ws/w]
.../probes/W/.claude/worktrees/child           86f79a1 [agent-child]

$ git -C $P/W worktree list       # identical output from inside W
.../probes/main                                86f79a1 [main]
.../probes/W                                   86f79a1 [ws/w]
.../probes/W/.claude/worktrees/child           86f79a1 [agent-child]

$ ls -1 $P/main/.git/worktrees
child
W
```

The admin dirs are **siblings**, both directly under `main/.git/worktrees/`, named
after the leaf basename only (`child`, not `W/.claude/worktrees/child`):

```
$ cat $P/W/.git
gitdir: /.../probes/main/.git/worktrees/W
$ cat $P/W/.claude/worktrees/child/.git
gitdir: /.../probes/main/.git/worktrees/child

$ cat $P/main/.git/worktrees/child/gitdir
/.../probes/W/.claude/worktrees/child/.git
$ cat $P/main/.git/worktrees/child/commondir
../..
$ cat $P/main/.git/worktrees/child/HEAD
ref: refs/heads/agent-child

$ cat $P/main/.git/worktrees/W/gitdir
/.../probes/W/.git
$ cat $P/main/.git/worktrees/W/commondir
../..
```

`commondir` is `../..` for **both** — i.e. the child's common dir is `main/.git`,
*not* `W`'s gitdir. The child is a peer of its own parent.

```
$ git -C $P/W/.claude/worktrees/child rev-parse --git-dir --git-common-dir --show-toplevel
/.../probes/main/.git/worktrees/child
/.../probes/main/.git
/.../probes/W/.claude/worktrees/child
```

Consequence: **the leaf basename is the registry key.** Two children named `child`
under two different parents would collide (git disambiguates by appending a suffix,
not measured here, but the flat namespace is the point).

---

## E2 — Does `git -C W status --porcelain` see a child living under W?

**ANSWER: YES, without an ignore entry. One untracked entry per child, not recursed into.**

Without any ignore entry:

```
$ git -C $P/W status --porcelain
?? .claude/

$ git -C $P/W status --porcelain --untracked-files=all
?? .claude/worktrees/child/

$ git -C $P/W status
On branch ws/w
Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.claude/

nothing added to commit but untracked files present (use "git add" to track)

$ git -C $P/W status --porcelain --ignored
?? .claude/
```

Note `-uall` reports `?? .claude/worktrees/child/` **with a trailing slash and no
files inside it** — git recognises the nested `.git` file as a repository boundary
and refuses to descend. So the noise is *one line per child*, not a file explosion.

With the ignore entry in place (see E7) it goes silent — see E7 transcript.

**Design consequence:** ccd's dirty-tree rung, if it is `[ -n "$(git status --porcelain)" ]`,
**refuses a parent the moment any child worktree exists**, purely because the child's
directory is untracked. This is a false positive, and it is 100% reproducible.

Related, measured, and dangerous in the other direction:

```
$ git -C $P/W clean -ndx
Would skip repository .claude/worktrees/child
$ git -C $P/W clean -nd
                                              # (no output)
$ git -C $P/W clean -ndxff
Would remove .claude/
```

`git clean -fdx` **skips** nested repositories (safe). `git clean -fdxff` (double
`-f`) **would delete the child worktree's whole tree**. Any ccd path that reaches
for `clean -ffdx` destroys live child sessions.

---

## E3 — Does the MAIN repo's status see children anywhere?

**ANSWER: no. Completely invisible to `git status` in main.**

```
$ git -C $P/main status --porcelain
                                              # (no output)
$ git -C $P/main status
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```

Children are only visible in main via `git worktree list` (E1) and `git branch -vv`
(E5). Never via status — the child lives under `W`'s directory, not main's.

---

## E4 — `git worktree remove W` while a registered child lives under W

### E4a — child NOT ignored: refused, but only as generic dirt

```
$ git -C $P/main worktree remove $P/W
fatal: '/.../probes/W' contains modified or untracked files, use --force to delete it
rc=128

$ git -C $P/main worktree remove $P/W/.claude/worktrees/child
fatal: '/.../probes/W/.claude/worktrees/child' contains modified or untracked files, use --force to delete it
rc=128
```

The refusal is *not* "there is a worktree inside this one". Git has no idea. It is
the ordinary untracked-files guard from E2, and `--force` walks straight past it.

### E4b — child IGNORED (via info/exclude): **REMOVAL SUCCEEDS AND DESTROYS THE CHILD**

```
$ printf '.claude/worktrees/\n' >> $P/main/.git/info/exclude
$ git -C $P/main worktree remove $P/W
rc=0

$ ls -1 $P/W
ls: cannot access '/.../probes/W': No such file or directory

$ git -C $P/main worktree list
.../probes/main                                                    86f79a1 [main]
.../probes/W/.claude/worktrees/child                               86f79a1 [agent-child] prunable
.../probes/W/.claude/worktrees/child/.claude/worktrees/grandchild  86f79a1 [agent-grandchild] prunable
```

Two live, registered worktrees were `rm -rf`'d with **no warning, no prompt, exit 0**.
Git only checked the parent's own tracked/untracked state; the children were invisible
because they were ignored.

**Uncommitted work in the child is silently lost:**

```
$ git -C $P/W worktree add $P/W/.claude/worktrees/child -b agent-child
$ echo "precious uncommitted work" > $P/W/.claude/worktrees/child/WIP.txt
$ git -C $P/W/.claude/worktrees/child status --porcelain
?? WIP.txt

$ git -C $P/main worktree remove $P/W      # parent is "clean"
rc=0
$ cat $P/W/.claude/worktrees/child/WIP.txt
cat: '/.../probes/W/.claude/worktrees/child/WIP.txt': No such file or directory
```

This is the single sharpest hazard the exclude entry (E7) introduces: it converts
E4a's accidental refusal into a silent cascade delete.

### E4c — hand-deletion `rm -rf W`

```
$ git -C $P/main worktree list        # before
.../probes/main                                                    86f79a1 [main]
.../probes/W                                                       86f79a1 [ws/w]
.../probes/W/.claude/worktrees/child                               86f79a1 [agent-child]
.../probes/W/.claude/worktrees/child/.claude/worktrees/grandchild  86f79a1 [agent-grandchild]

$ rm -rf $P/W

$ git -C $P/main worktree list
.../probes/main                                                    86f79a1 [main]
.../probes/W                                                       86f79a1 [ws/w] prunable
.../probes/W/.claude/worktrees/child                               86f79a1 [agent-child] prunable
.../probes/W/.claude/worktrees/child/.claude/worktrees/grandchild  86f79a1 [agent-grandchild] prunable

$ git -C $P/main worktree list --porcelain
worktree /.../probes/main
HEAD 86f79a1dc07b116049a2a09b7a5c54813fa5f566
branch refs/heads/main

worktree /.../probes/W
HEAD 86f79a1dc07b116049a2a09b7a5c54813fa5f566
branch refs/heads/ws/w
prunable gitdir file points to non-existent location

worktree /.../probes/W/.claude/worktrees/child
HEAD 86f79a1dc07b116049a2a09b7a5c54813fa5f566
branch refs/heads/agent-child
prunable gitdir file points to non-existent location

worktree /.../probes/W/.claude/worktrees/child/.claude/worktrees/grandchild
HEAD 86f79a1dc07b116049a2a09b7a5c54813fa5f566
branch refs/heads/agent-grandchild
prunable gitdir file points to non-existent location

$ git -C $P/main worktree prune --dry-run -v
Removing worktrees/grandchild: gitdir file points to non-existent location
Removing worktrees/W: gitdir file points to non-existent location
Removing worktrees/child: gitdir file points to non-existent location

$ git -C $P/main status --porcelain
                                              # main unaffected
```

So: hand-deleting a parent leaves **one orphan registration per descendant**, all
flagged `prunable`, all cleanable by a single `git worktree prune` — but only if
something runs prune. Until then each orphan **pins its branch** (E5).

---

## E5 — Branch deletion while a child checkout exists

**ANSWER: refused, from anywhere, `-d` and `-D` alike. Message names the child's path.**

```
$ git -C $P/main branch -d agent-child
error: cannot delete branch 'agent-child' used by worktree at '/.../probes/W/.claude/worktrees/child'
rc=1

$ git -C $P/main branch -D agent-child
error: cannot delete branch 'agent-child' used by worktree at '/.../probes/W/.claude/worktrees/child'
rc=1

$ git -C $P/W branch -D agent-child            # from the parent worktree, same
error: cannot delete branch 'agent-child' used by worktree at '/.../probes/W/.claude/worktrees/child'
rc=1

$ git -C $P/main branch -d ws/w                # parent's own branch, same rule
error: cannot delete branch 'ws/w' used by worktree at '/.../probes/W'
rc=1
```

`git branch -vv` marks every worktree-held branch with `+` and prints the holder:

```
$ git -C $P/main branch --list -vv
+ agent-child      86f79a1 (/.../probes/W/.claude/worktrees/child) one commit
+ agent-grandchild 86f79a1 (/.../probes/W/.claude/worktrees/child/.claude/worktrees/grandchild) one commit
* main             86f79a1 [origin/main] one commit
+ ws/w             86f79a1 (/.../probes/W) one commit
```

**The refusal survives the directory's death.** After `worktree remove W` orphaned the
children, before prune:

```
$ git -C $P/main branch -d agent-child
error: cannot delete branch 'agent-child' used by worktree at '/.../probes/W/.claude/worktrees/child'
rc=1

$ git -C $P/main worktree prune -v
Removing worktrees/grandchild: gitdir file points to non-existent location
Removing worktrees/child: gitdir file points to non-existent location

$ git -C $P/main branch -d agent-child
Deleted branch agent-child (was 86f79a1).
rc=0
```

**Design consequence:** any ccd reap that deletes a branch must `worktree prune`
first, or it will fail on branches held only by dead registrations. `+` in
`branch -vv` and the `used by worktree at` string are usable machine signals — but
`branch --list -vv` is the only branch-side view that shows child paths at all.

---

## E6 — `git worktree list --porcelain` fields for a child

**ANSWER: `worktree` is the absolute path under W. There is NO parent/child field.
Nesting is purely a filesystem accident, inferable only by string-prefix matching.**

```
$ git -C $P/main worktree list --porcelain
worktree /.../probes/main
HEAD 86f79a1dc07b116049a2a09b7a5c54813fa5f566
branch refs/heads/main

worktree /.../probes/W
HEAD 86f79a1dc07b116049a2a09b7a5c54813fa5f566
branch refs/heads/ws/w

worktree /.../probes/W/.claude/worktrees/child
HEAD 86f79a1dc07b116049a2a09b7a5c54813fa5f566
branch refs/heads/agent-child
```

Fields observed across all states in this session: `worktree`, `HEAD`, `branch`,
plus `prunable <reason>` and `locked [<reason>]` when applicable. No `parent`,
no `nested`, no ordering guarantee (the `prunable` listing in E4c came back in
`main, W, child, grandchild` order but `prune -v` reported `grandchild, W, child`
— **do not rely on list order**).

The only way to reconstruct the tree is: sort the `worktree` paths and treat
`B` as a child of `A` when `B` starts with `A + "/"`. That is what ccd will have
to do.

---

## E7 — `info/exclude` silences E2 everywhere at once

**ANSWER: YES. One line in the COMMON `info/exclude` silences every worktree,
including worktrees created later.**

```
$ tail -3 $P/main/.git/info/exclude
# exclude patterns (uncomment them if you want to use them):
# *.[oa]
# *~

$ printf '.claude/worktrees/\n' >> $P/main/.git/info/exclude

$ git -C $P/W status --porcelain
                                              # (silent)
$ git -C $P/W status --porcelain -uall
                                              # (silent)
$ git -C $P/W/.claude/worktrees/child status --porcelain
                                              # (silent)
$ git -C $P/main status --porcelain
                                              # (silent)

$ git -C $P/W status
On branch ws/w
nothing to commit, working tree clean

$ git -C $P/W status --porcelain --ignored
!! .claude/
```

It works because `info/exclude` lives in the **common** dir, which every linked
worktree shares:

```
$ git -C $P/W rev-parse --git-common-dir
/.../probes/main/.git
$ git -C $P/W/.claude/worktrees/child rev-parse --git-common-dir
/.../probes/main/.git
```

Note two things:

1. The pattern `.claude/worktrees/` (not `.claude/`) is enough — with the only
   content of `.claude/` excluded, git reports nothing for `.claude/` either, and
   `--ignored` collapses it to `!! .claude/`. A project that tracks other things
   under `.claude/` keeps them visible.
2. `info/exclude` is **not committed** — it is per-clone local state. ccd would have
   to install it into every project checkout, and re-install after a fresh clone.
   It is also the enabler for E4b's silent cascade delete; the two must ship together
   with a nested-child guard, never the exclude alone.

---

## E8 — Does `du -s W` include the child's tree?

**ANSWER: YES. A parent's `du` silently includes every descendant worktree.**

```
$ du -sh $P/W
52K	/.../probes/W
$ du -sh $P/W/.claude/worktrees/child
32K	/.../probes/W/.claude/worktrees/child
$ du -sh $P/W/.claude/worktrees/child/.claude/worktrees/grandchild
12K	/.../probes/W/.claude/worktrees/child/.claude/worktrees/grandchild

$ du -sh --exclude=.claude $P/W
12K	/.../probes/W
$ du -sh --exclude=.claude $P/W/.claude/worktrees/child
12K	/.../probes/W/.claude/worktrees/child
```

52K = 12K (W itself) + 32K (child subtree, which is 12K + 12K grandchild + dirs).
Also note: `du` with **multiple nested arguments dedupes** — passing `W` and its
child in one invocation prints only `W`. Any sizing code must invoke `du` once per
worktree, or explicitly `--exclude` descendants, or it will both double-count
(summing a parent total plus its children) and under-report (dedupe).

Per-worktree admin data lives in the common dir, not in the worktree:

```
$ du -sh $P/main/.git
332K	/.../probes/main/.git
$ du -sh $P/main/.git/worktrees
100K	/.../probes/main/.git/worktrees
```

so a reclaim estimate is `du -s <worktree> --exclude descendants` **plus** the
~30K admin dir under `main/.git/worktrees/<name>`, and objects are shared — reaping
a worktree reclaims essentially none of the object store.

---

## E9 — A child of a child

**ANSWER: same flatness. Depth is not recorded at any level.**

```
$ git -C $P/W/.claude/worktrees/child worktree add \
      $P/W/.claude/worktrees/child/.claude/worktrees/grandchild -b agent-grandchild
Preparing worktree (new branch 'agent-grandchild')
HEAD is now at 86f79a1 one commit

$ ls -1 $P/main/.git/worktrees
child
grandchild
W

$ git -C $P/main worktree list
.../probes/main                                                    86f79a1 [main]
.../probes/W                                                       86f79a1 [ws/w]
.../probes/W/.claude/worktrees/child                               86f79a1 [agent-child]
.../probes/W/.claude/worktrees/child/.claude/worktrees/grandchild  86f79a1 [agent-grandchild]

$ cat $P/W/.claude/worktrees/child/.claude/worktrees/grandchild/.git
gitdir: /.../probes/main/.git/worktrees/grandchild
$ cat $P/main/.git/worktrees/grandchild/commondir
../..
```

Status noise stays one-line-per-immediate-child at each level (no ignore entry):

```
$ git -C $P/W status --porcelain -uall
?? .claude/worktrees/child/
$ git -C $P/W/.claude/worktrees/child status --porcelain
?? .claude/
```

Arbitrary depth, zero recorded hierarchy. Everything is a peer of `main`.

---

## E10 — `git worktree move W` with a child nested under it

**ANSWER: ALLOWED, exit 0, no warning — and it BREAKS every nested child.**

```
$ git -C $P/main worktree move $P/W $P/W2
rc=0                                          # no output at all

$ git -C $P/main worktree list
.../probes/main                                                    86f79a1 [main]
.../probes/W/.claude/worktrees/child                               86f79a1 [agent-child] prunable
.../probes/W/.claude/worktrees/child/.claude/worktrees/grandchild  86f79a1 [agent-grandchild] prunable
.../probes/W2                                                      86f79a1 [ws/w]

$ ls -1 $P
main
origin.git
W2
```

Git updated **only** the moved worktree's `gitdir`; the children's recorded paths
still point at the dead `W` location, even though their directories physically
travelled inside `W2`:

```
$ cat $P/main/.git/worktrees/W/gitdir
/.../probes/W2/.git                             # updated
$ cat $P/main/.git/worktrees/child/gitdir
/.../probes/W/.claude/worktrees/child/.git      # STALE
$ cat $P/main/.git/worktrees/grandchild/gitdir
/.../probes/W/.claude/worktrees/child/.claude/worktrees/grandchild/.git   # STALE
```

The children themselves still *work* (their `.git` file points into the common
dir, which did not move):

```
$ ls -1 $P/W2/.claude/worktrees
child
$ cat $P/W2/.claude/worktrees/child/.git
gitdir: /.../probes/main/.git/worktrees/child
$ git -C $P/W2/.claude/worktrees/child status
On branch agent-child
nothing to commit, working tree clean
rc=0
```

…but the repo now considers them prunable, and **`git worktree prune` would delete
the admin dirs of two LIVE worktrees**:

```
$ git -C $P/main worktree list --porcelain
...
worktree /.../probes/W/.claude/worktrees/child
HEAD 86f79a1dc07b116049a2a09b7a5c54813fa5f566
branch refs/heads/agent-child
prunable gitdir file points to non-existent location

worktree /.../probes/W/.claude/worktrees/child/.claude/worktrees/grandchild
HEAD 86f79a1dc07b116049a2a09b7a5c54813fa5f566
branch refs/heads/agent-grandchild
prunable gitdir file points to non-existent location

$ git -C $P/main worktree prune --dry-run -v
Removing worktrees/grandchild: gitdir file points to non-existent location
Removing worktrees/child: gitdir file points to non-existent location
```

The fix exists but must be run **once per descendant, from inside each descendant**:

```
$ git -C $P/W2/.claude/worktrees/child worktree repair
repair: gitdir incorrect: /.../probes/main/.git/worktrees/child/gitdir
rc=0
$ git -C $P/W2/.claude/worktrees/child/.claude/worktrees/grandchild worktree repair
repair: gitdir incorrect: /.../probes/main/.git/worktrees/grandchild/gitdir
rc=0

$ git -C $P/main worktree list
.../probes/main                                                     86f79a1 [main]
.../probes/W2                                                       86f79a1 [ws/w]
.../probes/W2/.claude/worktrees/child                               86f79a1 [agent-child]
.../probes/W2/.claude/worktrees/child/.claude/worktrees/grandchild  86f79a1 [agent-grandchild]
```

(The move back, `W2` → `W`, reproduced the identical breakage and identical repair.)

**Design consequence:** ccd must never call `worktree move` on a parent without a
follow-up `worktree repair` sweep over every descendant — and there is a window
between the two where a concurrent `worktree prune` (`gc`, `ccd gc`, another agent)
destroys live sessions.

---

## EXTRA — `git worktree lock` does NOT protect a child from its parent's removal

This is the mitigation everyone reaches for first, and it **does not work**.

```
$ git -C $P/W worktree lock --reason "live agent session" $P/W/.claude/worktrees/child
lock rc=0
$ git -C $P/main worktree list
.../probes/main                                86f79a1 [main]
.../probes/W                                   86f79a1 [ws/w]
.../probes/W/.claude/worktrees/child           86f79a1 [agent-child] locked

$ git -C $P/main worktree remove $P/W          # child is LOCKED
rc=0
$ ls -1 $P/W
ls: cannot access '/.../probes/W': No such file or directory
$ ls -1 $P/W/.claude/worktrees/child
ls: cannot access '/.../probes/W/.claude/worktrees/child': No such file or directory
```

The lock is honoured **only** when the locked worktree is the direct target:

```
$ git -C $P/main worktree remove $P/W/.claude/worktrees/child
fatal: cannot remove a locked working tree, lock reason: live agent session
use 'remove -f -f' to override or unlock first
rc=128
```

Worse: after the parent removal destroyed it, the locked orphan registration is
**immortal** — `prune` skips locked entries, so the phantom stays in `worktree list`
forever and pins its branch:

```
$ git -C $P/main worktree list
.../probes/main                                86f79a1 [main]
.../probes/W/.claude/worktrees/child           86f79a1 [agent-child] locked

$ git -C $P/main worktree prune --dry-run -v
                                              # (nothing — locked entries are skipped)
$ git -C $P/main worktree prune --dry-run -v --expire=now
                                              # (still nothing)

$ git -C $P/main branch -D agent-child
error: cannot delete branch 'agent-child' used by worktree at '/.../probes/W/.claude/worktrees/child'
rc=1

$ git -C $P/main worktree unlock $P/W/.claude/worktrees/child
rc=0
$ git -C $P/main worktree prune -v
Removing worktrees/child: gitdir file points to non-existent location
```

So `lock` is a good **marker** (it survives everything, shows in `list --porcelain`
as `locked <reason>`, and blocks direct removal and prune) but it is **not a guard**
against cascade deletion, and it converts an orphan into a leak that only an explicit
`unlock` clears.

---

## Summary of design-relevant facts (git 2.43.0)

| # | Fact |
|---|---|
| 1 | Child worktrees register **flat** in `<main>/.git/worktrees/<leaf-basename>`; `commondir` is `../..` for every depth. No parent/child relationship is recorded anywhere. |
| 2 | The **only** way to see nesting is string-prefix comparison of the `worktree` paths from `git worktree list --porcelain`. |
| 3 | Without an ignore entry, a child makes its parent's `git status --porcelain` non-empty (`?? .claude/`) — ccd's dirty rung fails a healthy parent. Git does not descend into the nested repo, so it is one line per child. |
| 4 | One line in the **common** `info/exclude` silences it in every worktree at once, present and future — but `info/exclude` is uncommitted per-clone state ccd must install and re-install. |
| 5 | **`git worktree remove <parent>` deletes nested children with exit 0 and no warning** once they are ignored — including their uncommitted work. The exclude entry from (4) is what unlocks this. Never ship the exclude without a nested-child guard. |
| 6 | `git clean -fdx` skips nested repos; `git clean -fdxff` deletes them. |
| 7 | `rm -rf <parent>` leaves one `prunable` orphan per descendant; a single `git worktree prune` clears them all. |
| 8 | Branch deletion is refused while **any** worktree — live or orphaned-registration — holds the branch, `-d` and `-D` alike. Reap must `prune` before `branch -D`. |
| 9 | `git worktree move <parent>` succeeds silently and **stales every descendant's `gitdir`**, marking live worktrees `prunable`. Requires a `worktree repair` per descendant, run from inside it. |
| 10 | `du -s <parent>` includes all descendants; `du` dedupes nested args in one invocation. Size one worktree at a time, `--exclude` descendants, and add the ~30K admin dir. |
| 11 | `git worktree lock` on a child does **not** stop `worktree remove <parent>` from destroying it; it only blocks direct removal/prune, and a locked orphan is immune to `prune` (even `--expire=now`) until explicitly unlocked. |

---

## Cleanup

Fixtures (`main`, `origin.git`, `W`, `W2`, `exclude.tmp`) removed from
`.../scratchpad/probes/`.

**Note:** a concurrently-running sibling agent created its own fixtures (`wt1/`,
`wt2/`) in the same `probes/` directory at 11:46. Those were **left untouched** —
only this probe's own directories were deleted, to avoid destroying another
agent's in-flight measurements.

---

## Verification

**Independent re-measurement, 2026-08-04, by a skeptical verifier.** Fresh throwaway
fixtures under `.../scratchpad/probes-verify/{f1..f5}` (local bare repo as `origin`,
one commit, no network, plain git only). Same box, `git version 2.43.0`. All five
fixtures deleted after the run; `probes-verify/` left empty.

Environment control run first, because it could have invalidated everything: there is
**no** `core.excludesfile` and **no** `~/.config/git/ignore` on this box, and
`/etc/gitconfig` does not exist — so no ambient ignore rule contaminated either the
original probe or this one.

### Verdicts

| Claim | Verdict |
|---|---|
| **E1** — child created from inside `W` registers **flat** at `<main>/.git/worktrees/<leaf-basename>`; `commondir` is `../..` for both; child's `--git-common-dir` is `main/.git` | **CONFIRMED** — reproduced byte-for-byte, including `ls .git/worktrees` → `child`, `W`, and the three-line `rev-parse --git-dir --git-common-dir --show-toplevel`. |
| **E1 corollary** — leaf basename is the registry key; two same-named children "would collide (git disambiguates by appending a suffix, **not measured here**)" | **CONFIRMED and now measured.** Two parents `A`/`B`, both children at `.claude/worktrees/child`: admin dirs are `child` and `child1`; both `.git` files point at the disambiguated names; nothing failed. So: no hard collision, git auto-suffixes — but the admin-dir name still encodes nothing about the path, which is the load-bearing half. |
| **E2** — `git -C W status --porcelain` shows `?? .claude/` with no ignore entry; `-uall` shows `?? .claude/worktrees/child/` and does **not** descend | **CONFIRMED** — identical output, including the `--ignored` variant printing `?? .claude/` (not `!!`). |
| **E2 sub-claim** — `git clean -nd` produces **no output** | **REFUTED.** Measured in the un-ignored state (the state E2 is describing): `git -C W clean -nd` prints `Would skip repository .claude/worktrees/child` — the same line as `-ndx`. Re-run twice; `check-ignore` confirmed the child was not ignored and `info/exclude` held no non-comment lines. The report's "no output" is only reachable **after** the E7 exclude is installed (then `-d` without `-x` skips the ignored dir). Transcript is out of state order; the conclusion it supports (clean skips nested repos) is unaffected. |
| **E2 sub-claim** — `clean -ndxff` would remove `.claude/` | **CONFIRMED.** |
| **E3** — main's `status` never sees children | **CONFIRMED** (empty `--porcelain`, "working tree clean"). |
| **E4a** — `worktree remove <parent>` refused as generic untracked dirt, rc=128; same for the child as direct target | **CONFIRMED**, identical `fatal:` wording and rc. |
| **E4b** — with the child ignored, `worktree remove <parent>` **succeeds rc=0, silently `rm -rf`s the children**, uncommitted work lost, orphans left `prunable` | **CONFIRMED — the sharpest claim reproduced exactly.** `WIP.txt` in the child, parent `status --porcelain` empty, `remove` rc=0, parent and both descendants gone, `WIP.txt` unrecoverable, `worktree list` showing two `prunable` phantoms. |
| **E4b framing / Summary fact 5** — "**The exclude entry from (4) is what unlocks this**" | **REFUTED as stated (overstated).** `git worktree remove --force <parent>` cascade-deletes **un-ignored** children too: fresh fixture, child holding untracked `WIP.txt`, no `info/exclude` entry at all → rc=0, `W` gone, child destroyed, `prunable` orphan left. So the exclude is *one* unlock, not *the* unlock; `--force` alone is sufficient. The mitigation ("never ship the exclude without a nested-child guard") is therefore necessary but **not sufficient** — the guard must also cover any `--force` path. (Checked: ccd never passes `--force` to `worktree remove` and calls `git clean` nowhere.) |
| **E4c** — `rm -rf <parent>` leaves one `prunable` orphan per descendant, all cleared by one `prune`; main unaffected | **CONFIRMED**, including the `prunable gitdir file points to non-existent location` porcelain field and the `grandchild, W, child` prune ordering. |
| **E5** — branch deletion refused from anywhere, `-d` and `-D` alike, message names the child path; `+` marker in `branch -vv`; refusal survives the directory's death and is cleared only by `prune` | **CONFIRMED** in full, both halves (pre-prune refusal rc=1, post-prune `Deleted branch` rc=0). |
| **E6** — porcelain fields are `worktree`/`HEAD`/`branch` (+`prunable`/`locked`); **no** parent/child field; nesting inferable only by path-prefix | **CONFIRMED.** No additional field appeared in any state exercised here. |
| **E7** — one line in the **common** `info/exclude` silences every worktree at once, present and future; `--ignored` collapses to `!! .claude/` | **CONFIRMED**, all four status views silent, both `--git-common-dir` answers identical. |
| **E7 note 1** — `.claude/worktrees/` (not `.claude/`) is enough, and a project tracking other things under `.claude/` keeps them visible | **CONFIRMED.** With the exclude in place, adding `.claude/settings.json` brings status back: `?? .claude/` (`-unormal`) / `?? .claude/settings.json` (`-uall`). Caveat worth recording: under default `-unormal` the sibling file still collapses to the string `?? .claude/`, so a dirty-rung consumer cannot tell "a real untracked sibling" from "a child worktree" without `-uall`. |
| **E8** — `du -s <parent>` includes descendants; `du` dedupes nested args in one invocation; admin data lives in the common dir | **CONFIRMED** — 52K / 32K / 12K reproduced to the kilobyte, `du -sh W child` printed only `W` (52K), `--exclude=.claude` gave 12K, `main/.git/worktrees` 100K for three worktrees (≈33K each). |
| **E9** — arbitrary depth, zero recorded hierarchy, one-line-per-immediate-child status noise at each level | **CONFIRMED.** |
| **E10** — `worktree move <parent>` rc=0 silently, stales every descendant's `gitdir`, marks **live** worktrees `prunable`, children keep working, fixed only by `worktree repair` run per descendant from inside it | **CONFIRMED in full**, including the exact `repair: gitdir incorrect:` lines and the restored `worktree list`. |
| **EXTRA** — `worktree lock` on a child does **not** stop `worktree remove <parent>`; lock only blocks the child as direct target; locked orphan is immune to `prune` even `--expire=now`; `unlock` then `prune` clears it | **CONFIRMED as a conclusion — transcript state is wrong.** Reproduced: direct removal of the locked child rc=128 with the documented `use 'remove -f -f'` message; locked orphan invisible to both `prune --dry-run -v` and `--expire=now`; `branch -D` rc=1; `unlock` + `prune` clears. **But** the report's transcript shows `worktree remove $P/W` → rc=0 in a state with *no* exclude installed, which contradicts its own E4a. Measured: with the child locked and **not** ignored, removing the parent is **refused** (rc=128, "contains modified or untracked files"). It succeeds rc=0 and destroys the locked child only **after** the E7 exclude is added. The EXTRA transcript was evidently captured with E7's exclude still in place and does not say so. |
| **Fixture/cleanup notes** ("fixtures deleted", "sibling agent's `wt1/`/`wt2/` left untouched") | **UNTESTED** — historical statements about the original run; `probes/` was not inspected or touched by this verification. |

### Design consequences checked against the real `ccd` (not just asserted)

The report hedges its ccd consequences ("if it is `[ -n "$(git status --porcelain)" ]`").
Re-opened `/srv/projects/OpenClawHetzner/infra/<server-host>-portability/ccd`
(5439 lines) and grepped for every consumer:

- **The dirty rung is exactly that shape.** `ccd:1078` `dirty=$(git -C "$workdir" status --porcelain 2>"$derrf")`, `ccd:1082` `[[ -z "$dirty" ]] || die "worktree not removed (uncommitted changes?)…"`. So E2's false positive is **real, not hypothetical**: any nested child worktree hard-blocks `ws-reap` on a healthy parent. E2's design consequence is **CONFIRMED against code**.
- **`ccd` already installs into the common `info/exclude`.** `ccd:913` `grep -qxF '.ccrc/' "$common/info/exclude" || echo '.ccrc/' >> …`, using `--git-common-dir` resolved at `ccd:911`. E7's mechanism is not a proposal — it is an established pattern in this very file. The pattern written today is `.ccrc/`, **not** `.claude/worktrees/`, so E4b's cascade is **not currently armed** by ccd's own exclude.
- **`ccd` never arms the other unlocks.** No `git clean` anywhere in the file; `worktree remove` at `ccd:1099` is deliberately un-`--force`d (comment at `ccd:1092` says so). Both E4b-adjacent hazards are currently closed by construction.
- **The E10 hazard has a live trigger.** `ccd:4573` executes a **repo-wide** `git -C "$main" worktree prune` in `_ws_gc_prune_row`'s `stale-meta` arm (the comment at `ccd:4568` calls out that it is repo-wide). Combined with E10, a `worktree move` of a parent — or any transient stale `gitdir` — plus a concurrent `ccd ws-gc` deletes the admin dirs of **live** descendants. Also relevant: `ccd:4579` `foreign-stale` deliberately declines to prune foreign metadata, but nested children of a ccd workspace would not read as foreign.
- Other `status --porcelain` consumers that would inherit E2's false positive if pointed at a parent: `ccd:407`, `1466`, `1726`, `2265`, `2644`, `2999`, `3821`, `4302`. Test consumers: `infra/ccrc/server/test/ccd-{ws-reap,ws-gc,ws-audit,workspaces,archive,pr-state}.test.ts`.

### Bottom line

Ten of eleven summary facts survive verbatim re-measurement. **One is overstated
(fact 5: the exclude is not the only unlock — `remove --force` cascades through
un-ignored children too), and two transcripts are captured in an undeclared state
(E2's `clean -nd`; the whole EXTRA lock block).** No load-bearing conclusion collapsed;
the mitigation implied by fact 5 needs widening to cover `--force`.
