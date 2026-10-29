# The history spool's append and the join file's rotation target, raced: ruled

- **D-7503 (2026-10-29)** — the session hook's history spool append opens the file once for append and writes only through that descriptor, and it and the join file's rotation-target guards refuse only a positive non-regular type, so a file moving between absent and regular never costs a line or a rotation.

**The pattern.** Both sites in `ccd/session-hook.sh` guarded a path with `[[ ! -L "$p" && ( -f "$p" || ! -e "$p" ) ]]`. Each operand is its own `stat`. A path that moves between two probes can be "not a regular file" at the first and "not absent" at the second, and the guard refuses a path that was only absent or regular. D-7448 fixed the same idiom in the delegation spool by probing absence first. That works there because the current hour's bucket moves one way only, absent to regular. Its note named these sites as left for their own change.

**The history spool's append.** The drain renames `<id>.jsonl` away every tick and the next hook creates it again, so the path moves both ways. Absence first refuses on the drain's move (exists, then not a regular file); the old order refuses on a sibling's create (not a regular file, then exists). Measured in a fixture on macOS with a drain renaming the file and a sibling creating it: the old guard refused about 150 times in 800 drains, and the swapped one refused too. A refused guard is a lost line, because the write runs only after it. So the append now:

1. refuses only a POSITIVE non-regular type at the path: a symlink (live or dangling), a directory, a FIFO, a socket or a device. No move between absent and regular makes any of these true. A FIFO is still never opened, and a directory is still refused before the open.
2. opens the file for append once, on fd 9, as a redirection on a group (no `exec`, nothing forks, and bash restores fd 9 after it);
3. writes the line through fd 9 only if `/dev/fd/9` is a regular file and the path is still not a link.

A drain that renames the file after the open gets the line in the renamed file, which it reads like any other.

**What is still open.** Bash has no `O_NOFOLLOW` or `O_NONBLOCK` redirection. A symlink swapped in between the guard and the open is followed. An absent target is created empty and never written. A link that is swapped out again before the check is not seen. A FIFO swapped in blocks the open until Claude Code kills the hook (`HOOK_TIMEOUT_S`). These are the same residues D-4418 named, now narrower: a link that is still standing at the check never gets the line.

**The join file's rotation target.** `<id>.joinedprev` moves absent to regular (a rotation's `mv -f`) and regular to absent (a purge's `rm -f`). Its two guards in `_hook_join_record`, the one before the rotator opens `joined` and the one immediately before the rename, now refuse only a positive non-regular type, the form the entry guard on `joined` already uses (D-5434). The old form skipped a rotation when the target moved between probes. The skip lost no id, but it left `joined` over the cap until the next Start. A symlink, directory or FIFO at the target still stops the rotation.

**Tests.** `server/test/session-hook-append-race.test.ts` adds the rows. Each runs a fixed driver script; paths and counts reach it as arguments.

- *History, guard.* The shipped guard spins against a drain and a sibling and never refuses. The control rows run the old guard and the swapped guard, and each must refuse.
- *History, append.* The shipped statement appends numbered lines through the same race, and every line is found in the spool file or a drained one.
- *History, interleaving.* The real hook runs with a `DEBUG` trap that acts on the first command after the guard. A symlink swapped in there never receives the line (on main the line was written into the link's target). A drain that renames the file there gets the line in the renamed file, and no new spool file is made (on main the line made a new spool file).
- *Join.* The two shipped `joinedprev` guards never refuse while the target is renamed in and purged; the old two must refuse. Both still refuse a live or dangling symlink, a directory and a FIFO, and pass absent or regular.

**Not changed here.** The history scope marker's write (`_hook_history_scope`) uses the same idiom. An open PR edits those lines, so that site is a follow-up for after it lands.
