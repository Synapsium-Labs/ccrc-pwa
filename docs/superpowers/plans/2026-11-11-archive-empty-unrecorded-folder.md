# Archive: an empty folder with no git record and no branch anywhere

- **D-8335 (2026-11-11)** — an empty, unrecorded workspace folder archives (#2360): `ws-archive`'s manifest describes a stopped workspace whose folder is a plain, empty directory (not a link, not a mount point), that git keeps no worktree record of, and whose registry branch resolves in no local ref, no remote-tracking ref and on no remote asked live, as `unrecordedEmpty`, instead of refusing "cannot describe … truthfully". Every other shape without a record still refuses, and the refusal now says which condition failed.

## Why

Eight stopped or orphan workspaces had an empty folder, no worktree record and no branch, locally or on the remote.
`ws-archive` refused each one with `cannot describe <id> truthfully — nothing was touched`, which the door reads as
`manifest-unbuildable`, and the console offered nothing else. They were cleared by hand: recreate the worktree at
`origin/main` with `git worktree add`, then archive it.

The refusal is `_ws_archive_manifest`'s record rung: `_ws_wt_branch` finds no record of the path, so the helper
answered `manifest: <main> has no worktree record for <workdir>` and `cmd_ws_archive` died before it wrote anything.
The server door (`server/src/coord/archiveDoor.ts`) refuses nothing for this shape: the folder stands, so the
worktree measures `present` (local mode) or `unmeasured` (remote mode), and the refusal is ccd's alone.

The cause of the empty folders is not established. The tree carries no box-move tool, so whether a move can still
leave this shape cannot be answered from it. The proof below does not depend on the cause.

## Change

- `ccd/ccd`:
  - `_ws_archive_unrecorded_empty <main> <workdir> <branch>`, rc 0 only when every condition holds, each read
    fail-closed (a read that did not run is a no, with `_WS_UNREC_WHY` naming it):
    - the workdir is absolute, a directory, and not a link;
    - its device is its parent's (read through the parent with a trailing `/`, so a linked parent resolves): a
      mount point refuses, since an unmounted disk reads empty;
    - `find -mindepth 1 -maxdepth 1` lists no entry, a dotfile and an empty subdirectory included, and a listing that
      fails refuses;
    - `_ws_reclaim_record` answers "no record" from a worktree list it read, and `_ws_reclaim_no_record` finds no
      admin entry naming `<workdir>/.git` that the list omitted;
    - `refs/heads/<branch>` does not resolve in `$main` (rc 1; any other rc refuses);
    - no `refs/remotes/*/<branch>` stands;
    - every remote answers `ls-remote --exit-code --heads` with rc 2 ("no such head"), under `_plat_timeout 60`; rc 0
      or any other answer refuses.
  - `_ws_archive_manifest`: when git has no record, the shape is asked of the function above. Proven, the manifest is
    written with `worktreeHead`, `tip` and `ignoredDigest` as `null`, `dirty` 0, `worktreeAdmin` `null`, and
    `"unrecordedEmpty":true` as its last key, and no read asks git inside the folder (git would answer there from
    whatever repository encloses it). Not proven, the refusal keeps its words and adds the reason:
    `… has no worktree record for <workdir>, and it is not proven to hold nothing: <why>`.
  - `cmd_ws_archive`: the `ahead` read is skipped for such a manifest (`ahead=0`, so the reason is `empty`, or
    `merged:#N` when a bound PR is merged, or `stale` under `--reason stale`), for the same reason.
- `ccd/contexts.tsv`: the new function, C4.
- `server/test/growth-waivers/D-8335-ccd-ccd.json`: ccd/ccd's net growth.

Nothing changes on the server or the console: the door already sends this archive to ccd, and the success answer and
the `manifest-unbuildable` words are as they were.

## Deviations found

- The empty folder is **kept**, not removed. `ws-archive` destroys nothing by contract (its header in `ccd/ccd` and the
  SAFETY section of `CLAUDE.md`), and a kept folder lets `ws-restore` put the row back exactly as it stood. Removing an
  empty directory would make this one shape the only archive that deletes, and its restore would then refuse
  `worktree is gone`.
- The proof asks every remote live, not only the tracking refs. A tracking ref left behind refuses, even when the
  remote has dropped the branch: that ref is a fact the operator can clear, and the check stays one-directional.
- A stash naming the branch is recorded (`stashes`), not a condition: `_ws_stash_count` cannot report a failed read,
  so it cannot be part of a fail-closed proof, and archiving takes nothing from the stash.

## Tests

- `server/test/ccd-archive.test.ts`, "ws-archive: an empty folder with no git record and no branch anywhere (D-8335)":
  - the shape archives, `archivedreason` is `empty`, the manifest carries the shape, and the folder stays, empty;
  - the same through the dispatcher, the program the box runs;
  - refusals, each with nothing written: a dotfile in the folder; an empty subdirectory; the branch standing in the
    project; the branch only on the remote; a tracking ref left behind; a remote that cannot be asked; a link at the
    workdir; a mount point; a folder whose entries cannot be listed; a worktree list that cannot be read; an admin
    entry naming the folder that git's list omits.
- `server/test/archive-ccd-words.test.ts`, the console's path: the empty shape archives with no refusal for the door
  to read, and the same folder holding a file still reads `manifest-unbuildable`.
- The existing "refuses when git has no worktree record for the directory at all" (a folder with files and a branch)
  still refuses with its words.
