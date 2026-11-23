# Every push to a test box was refused by git-shell: plan

The installer gave the push user `git-shell` as its login shell and wrote its one `authorized_keys` line with the
forced command as an absolute path. sshd runs a forced command through the login shell, and `git-shell` refuses that
form, so no push ever reached the forced command. This plan names the forced command the way `git-shell` runs one.
Spec `docs/superpowers/specs/2026-10-28-test-box-design.md` §2.1, "The push user and the create-only rule".

## Measured

- On a real test box, every push failed with
  `fatal: unrecognized command '<tools>/release/installed/deploy/testbox/git/push-command <repository table>'`.
  So a parity run never ran its box leg, and every file read "box absent".
- sshd runs a forced command as `<login shell> -c "<command>"`. `git-shell -c` runs its own builtins
  (`git-receive-pack`, `git-upload-pack`, `git-upload-archive`), and otherwise only a first word with no slash in it,
  as `$HOME/git-shell-commands/<word>`. Anything else ends in `unrecognized command`.
- Reproduced locally with the real `git-shell` (`$(git --exec-path)/git-shell`): with `HOME` holding an executable
  `git-shell-commands/push-command`, `git-shell -c "push-command <table>"` runs it with argv `[<table>]` and keeps
  `SSH_ORIGINAL_COMMAND` in its environment. With the old absolute form, or without the directory, it refuses as the
  box did.

## The change

1. **Phase 5 makes `<push home>/git-shell-commands`** (0755, root's, through the installer's `dir`). It links
   `git-shell-commands/push-command` to `$TREE/deploy/testbox/git/push-command`, which is the installed release's
   script through the `installed` link. The link is replaced through a `.new` name and `mv`, and only when it names
   anything else.
   - **A link, not a copy.** A tool sync switches `installed` to a new release and does not run phase 5. The mirror's
     `core.hooksPath` and the units already name the forced command's siblings through `installed`, so a link moves the
     forced command with them. A copy would stay the older release's script until the next `--reapply`. The link is
     made as the installer's other links are (`installed`, `current`): as root on a box, so it is root's, in a
     directory only root can write.
2. **The `authorized_keys` line** becomes `restrict,command="push-command <repository table>" <key>`. The key readers
   in `--reapply` and in the first install's "is this key current" check match `command="[^"]*"`, so they accept the
   new line unchanged (the reapply and re-pair cases in `server/test/testbox-box-package.test.ts` run them).
   `--unpair` is unchanged: it empties the key and leaves the directory.
3. **No `git-shell-commands/no-interactive-login`.** With the directory present, `git-shell`'s interactive mode is
   enabled, but it is reached only by a login with no command. The forced command is run for every login with the key,
   and `restrict` gives no pty. The push user has no password (a system user), so there is no other way in. The file
   would also not close the case that matters: a key line without a forced command would let `git-shell` run its
   builtin `git-receive-pack` on any path, file or not.
4. **The rows directory takes no quote and no backslash.** `CCRC_TESTBOX_REPOS` is written into the forced command:
   `authorized_keys` ends `command=` at a `"`, and `git-shell` reads `'`, `"` and `\` in the command (a `\` drops
   out, and a lone quote fails as an unclosed quote). The box file's reader takes a `"` or a `'` inside one whole pair
   of the other quote, so `_tb_key_policy` (`ccd/testbox-knobs`) now refuses such a value. It is the one rule the
   installer and the connect card both apply, so the card refuses it too (`box-value-refused`).
5. **The link swap replaces a link or a file only.** `mv` moves the new link into a directory and follows a link to
   one, and BSD `mv` has no `-T`. So a directory at `push-command` or `push-command.new` fails the installer by name,
   and a link to a directory is removed before the swap.
6. **Tests.** `testbox-box-package` pins the new line (`pushForced` in `server/test/testboxBoxFixture.ts`) and the
   directory: its mode, its owner in the system log, the one link and its target. It runs the installed line's
   command through the real `git-shell`, as sshd would. A fetch reaches the forced command and is refused there
   (`test box push: refused: …`), and `git-receive-pack` of the listed mirror runs receive-pack. It also covers:
   - the repair of a box installed before this change: an absolute-path line, no `git-shell-commands`, and a marker
     naming an older tag. `--reapply` writes the new line with the same key and makes the link;
   - the swap's replace arm: a stale link, a file and a link to a directory are replaced, and a directory fails by
     name;
   - the quote refusal.

   Measured red against the old installer: 7 of its rows, the `git-shell` runs with the box's exact
   `unrecognized command` message. `testbox-transport`'s GIT_SSH driver runs `git-shell -c "<pushForced>"` with
   `HOME` set to a push home laid out as phase 5 lays it out, so its two push rows push through the real path. Both
   suites skip their `git-shell` rows with a printed notice only where no `git-shell` stands beside `git`, and on CI's
   Linux a row fails instead, so the arbiter cannot lose them silently.

## Rollout

A box installed before this change keeps the old line after the release reaches it: a tool sync switches `installed`
and does not run phase 5. Until the card's **Apply release to box** (or **Repair**) re-runs the installer there, every push is
still refused. That re-run does run phase 5, because the box's marker names the older tag, and it keeps the box's key.

## Deviations found

- **D-8956 (2026-11-23)** — testbox-push-forced-command-through-git-shell. The push user's forced command was named
  by an absolute path, which `git-shell -c` refuses, so every push to a test box failed. Phase 5 now links
  `git-shell-commands/push-command` in the push user's home to the installed release's script, and the key's
  `command=` names it as `push-command <repository table>`.
