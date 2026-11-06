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
   is not plain, a body with no end, a body line that starts with the delimiter without being it, a backslash-newline
   inside a word, a `>&` target that goes on after its digits (`>&1cat bash` runs `bash`), and a heredoc still open at a `)` or read in another nesting than it opened in, which also catches a
   shift in `$((1<<2))`. A backslash-newline after a blank joins two lines, as it does for bash, so the command after it
   is read as the command it is.
2. An unquoted body has no live `$(` or backquote and no backslash-newline. Bash runs those substitutions whatever
   reads the body, so they are real commands, not false positives.
3. Every command on the line, outside the bodies, is on the reader list, or is a test program the classifier reads for
   itself. `npx bash` is a shell, so a test program stands beside a body only by name: `vitest`, `npx vitest`, a package
   script on a short list (`npm run build`), or `ccrc test -- ` one of those. No word on its line holds a `$`, because a
   variable can carry a body whatever way it was set, and none starts `--script`, because a script shell runs a package
   script through a file. It is never the command a body hangs on or takes a substitution, and it is never on a line with
   a pipe, a word that assigns a substitution, an `npm_config_script_shell`, or a body fed to a group or a loop. A prefix
   counts only by its plain name, since `./time cat` runs `./time`, and never with `env -S`, which runs a string.

The command word is the real one. `_tsegments` cuts a word at `$(` and at a quoted newline, so `X="$(true)" bash` would
read as `X=`, then `true`, then an empty word, and the empty word is not a command. `_tbodies` therefore hands it no
substitution and no quoted newline: each substitution moves to a line of its own and leaves a mark in its word, a quoted
newline leaves a mark, and `$'…'`, which `_tsegments` does not know, becomes a mark. `_tinert` and the classifier then read
the same text, so what was cleared is what is classified, and an assignment before a command hides nothing.

The list is an allowlist because many things run text, and a miss in this direction costs a false denial, not a missed
run. Any error in the reader fails the same way: it runs in a subshell and a failed read keeps the string whole.

## What stays denied

Real runs: a body fed to `bash`, `sh`, `zsh`, `dash`, `ssh`, `source` or `make -f -`; a reader piped on to any of them;
a body written to a file that a shell then runs; a substitution in command position or given to `bash -c`, `eval` or
`ssh`; a live substitution in an unquoted body. Each of these holds through `npx`, `bunx`, `pnpx`, `npm exec`, `pnpm exec`,
`pnpm dlx`, `yarn <bin>` and `bun <file>`, through a group or a loop, and over a backslash-newline.

Known false denials, kept because the guard fails closed:

- A body that does not run, on a line that also holds a command the reader does not know (`docker ps && gh pr create
  --body-file - <<'EOF'`) or a shell (`cat <<A` and `bash <<B` on one line). The fix for one is a word on the list.
- `ssh box 'cat > f' <<'EOF'`: reading the remote command is out of scope.
- An unquoted body with `$(date)` beside a line that reads as a heavy command.
- A test program beside a body on a line that also holds a pipe or a word that assigns a substitution, or a body fed to
  a group or a loop.
- A prefix with a `/` in it or its value (`/usr/bin/env git commit -F -`, `flock /tmp/l git commit -F -`), or with an
  option that starts `--s` or holds an `S` (`timeout --signal=KILL 5 cat`).
- A test program spelled any way but by name (`npx --yes vitest`, `npm --prefix server run build`, a path), a package
  script off the list, or a test program on a line with a `$` in any word of its command.
- A backslash-newline with no blank before it (`git commit -F - <<'EOF' &&\`).

## Known limits

- `_tprogram` trusts the name, not what it resolves to. A file written to `node_modules/.bin/vitest`, a PATH change, or a
  body written over `package.json` or `.npmrc` makes `npx vitest` or `npm run build` run something else. The same holds
  for every name on the reader list.
- A reader on the list can run code by its own means: `awk` with `system()`, `node -e`, `python3 -c`, `git -c alias.x=!…`,
  `rg --pre`. The reader list says a command does not run the body as shell, not that it runs nothing.
- In a `sh -c` string a nested heredoc is read on its first line only. `_tsegments` cuts the word at its first newline, so
  `_tshell_heavy` sees `cat <<EOF` or `bash <<EOF` with no body, and the rest reads as one word that is no command.
  `sh -c 'bash <<EOF⏎npm test⏎EOF'` reads light, as it does on `main`.
- A line whose body is not dropped is read whole by `_tsegments`, with the gaps it has on `main`. A heavy command after a
  backslash-newline (`true && \` then `  npm test`), and one after a quoted substitution in an assignment
  (`X="$(true)" npm test`), read light. So does a body fed to a shell on a line where `_tsegments` loses its place in
  the quotes: a substitution or a quote nested in a quoted substitution (`X="$(true "$(true)" x)" bash <<EOF`,
  `echo "$(X=$(true) bash <<EOF…)"`) or `$'\''`. The reader refuses each of these lines, and the whole string then reads
  light, as it does on `main`.

Measured on `/bin/bash` 3.2 only: a `)` line in a body inside `$(…)` ends the substitution there. The fleet's bash is 5,
and the classifier itself needs bash 4.
