# The test route reads a heredoc body as text

`ccrc test --classify-shell` read every line of a heredoc body as a command, so the session hook's heavy-test arm denied
commands that start no test: a pull request body with the line ``- [x] `npm run typecheck` ``, and a `node` heredoc with
`require('playwright')`. The same reading gave `wrapped` for a body that named `systemd-run`, which is denied on every
session.

- **D-8052 (2026-11-06)** — the test route's classifier drops a heredoc body only when it can read the whole line and no command on it can run the body. The reader is `_tbodies` and `_tinert` in `ccd/ccrc-test`, ahead of `_tsegments`, which is unchanged.

## Why the change is in the classifier

The hook has one reader for this arm, `ccrc test --classify-shell`, so the wrapper and the hook agree on what a test is.
The fix belongs in that reader, and `ccd/session-hook.sh` does not change. That file is a rules file, and this change
needs nothing from it.

## The rule

A body is dropped when all of these hold; otherwise the string is read whole, as before:

1. The reader follows the whole string, and every heredoc on it ends. It gives up on what it does not model: a
   backquote, `$[…]`, a process substitution, a `${…}` with a quote, an expansion or a blank in it, a delimiter that
   is not plain, a body with no end, a body line that starts with the delimiter without being it, and a heredoc still
   open at a `)` or read in another nesting than it opened in, which also catches a shift in `$((1<<2))`.
2. An unquoted body has no live `$(` or backquote and no backslash-newline. Bash runs those substitutions whatever
   reads the body, so they are real commands, not false positives.
3. Every command on the line, outside the bodies, is on the reader list. The test programs the classifier reads for
   itself may also stand beside a body, but never as the command the body hangs on or takes a substitution, and never
   on a line with a pipe or a substitution assigned to a variable.

The list is an allowlist because many things run text, and a miss in this direction costs a false denial, not a missed
run. Any error in the reader fails the same way: it runs in a subshell and a failed read keeps the string whole.

## What stays denied

Real runs: a body fed to `bash`, `sh`, `zsh`, `dash`, `ssh`, `source` or `make -f -`; a reader piped on to any of them;
a body written to a file that a shell then runs; a substitution in command position or given to `bash -c`, `eval` or
`ssh`; a live substitution in an unquoted body.

Known false denials, kept because the guard fails closed:

- A body that does not run, on a line that also holds a command the reader does not know (`docker ps && gh pr create
  --body-file - <<'EOF'`) or a shell (`cat <<A` and `bash <<B` on one line). The fix for one is a word on the list.
- `ssh box 'cat > f' <<'EOF'`: reading the remote command is out of scope.
- An unquoted body with `$(date)` beside a line that reads as a heavy command.
- A test program beside a body on a line that also holds a pipe or `X=$(…)`.

Measured on `/bin/bash` 3.2 only: a `)` line in a body inside `$(…)` ends the substitution there. The fleet's bash is 5,
and the classifier itself needs bash 4.
