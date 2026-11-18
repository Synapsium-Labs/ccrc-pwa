# Approvals PR 0: the stale deny digest — task note

Programme `overlord` (#2491), plan `docs/superpowers/plans/2026-11-18-overlord-approvals.md` (#3036, on main as
2375f6dcc), §3.2.1, Table 3c and Tasks 0.1 to 0.4. The coordinator's plan-review rulings of 2026-11-18 (F1, F5, F6,
F7) are folded into that plan. Departures from the plan on main are named by slug; the coordinator mints their
numbers.

## What shipped

- **The digest history** (`$REG/child-deny.digests`). The install spine (`ccd/install-session-hooks.sh`) is its one
  writer: one `<digest> <epoch ms>` line per digest the managed deny file has had, newest last, at most 32 lines. A run
  that rewrites the deny file records the outgoing file's digest, then the incoming one; any run records the current
  file's digest when it is not the last line already (ruling F1). Lines not of the shape are dropped on a rewrite; the
  file is written to a temporary file and renamed, so a symlink at the name is replaced, never followed. `--remove`
  leaves it; `ccrc uninstall` removes it with the deny file.
- **The hook** (`_hook_approval_wait`). A digest equal to the managed file's is sent as before. A digest the history
  names is sent with `denyDigest`, which is advisory: the server decides nothing from it (ruling F6). A digest in
  neither returns silently, as before. The history is read only when the digest is not current, with builtins only,
  so the current-digest path gains no fork and no read.
- **The trusted-file write deny.** The history joins the hook's `TNS` list, so a child may not write it by the
  shell's writers, after a `cd`, or with an edit tool (ruling F6).
- **The server.** `denyStandingOf` (L1) answers `current`, `history` or `none` from the child's spawn digest, the
  managed file's digest and the history. The raise refuses `deny-not-engaged` only for `none`, and mints a `history`
  child's row held, its class left as the classifier gave it, with `approvals.denyCurrent = 0` (ruling F5; migration
  100 by position on today's main). The rule door asks `approvalAllowRefusal` (L1), which refuses an allow on a row
  whose deny rules are not current with a new word, `deny-not-current` (`APPROVAL_REFUSALS`, `REFUSAL_STATUS`, a
  `409`). It answers after `guard-forbidden` and before `guard-escalate`, whatever the row's class: the fact is the
  child's, so it answers the same before and after a server restart. A deny is signed and a hand-over works as
  before. The brief tells the claimant the child runs under older deny rules and offers no allow.

## Task 0.1: does a running Claude Code re-read a changed `--settings` file?

**No.** Measured from the 2.1.327 build's own code, the build every fleet child runs today. At start, a `--settings`
argument that names a file is read once and its content is pinned in the settings source
(`replaceFlagSettingsFilePinnedContent`). Every later load of the flag settings source passes that pinned content to
the parser as the expected content, so the file on disk is not read again. A child spawned before the deny list
changed keeps the old rules for its whole life. So the re-stamp option in Table 3c would record a fact that is
false, and it is never worth adding.

A live run on a fixture session was tried first: a print-mode session with stream-json input, a deny rule added
between two turns. It could not run. The nested session's sign-in refresh failed, and the measurement does not
touch credentials. The finding above rests on reading the build's code.

## Departures (by slug)

- `brief-says-older-rules`: the brief to the claimant gains one line for a row whose deny rules are not current, and
  it offers no allow for that row. Without it, a coordinator mailed an `ordinary` stale row would try an allow that is
  then refused.
- `no-capability-word`: §7 lists `approval-deny-history-v1`. Nothing reads it, and no approval capability word
  exists in the tree yet. An older server refuses a history digest with `deny-not-engaged`, and an older hook never
  sends one, so both directions already fail toward the operator without the word. It is not added.
- `no-installer-lock`: §3.2.1 says the trim happens "under the installer's existing lock". The install spine has no
  lock. The trim is still safe against a concurrent install: the spine writes the new history to a temporary file
  named by its own process id, beside the history, then moves it into place with one atomic rename (`mv -f`). A
  reader therefore never sees a half-written or interleaved file, and two installs never write the same temporary
  file. What a race can cost: two installs that read the old history at once each rename their own copy, and the
  later rename wins, so the earlier one's new line can be lost. Installs run from the update and doctor paths, one at
  a time in practice. The next install records the current digest again whenever it is not the last line.
- `failed-write-records-the-file-left`: Task 0.2 says a failed write of the managed file appends nothing. The spine
  instead records the digest of the file the failed write left in place, when that digest is not already last. That
  file is the installed one, so the history still never names a file that was not installed, which is the reason the
  plan gives. A guard to skip the history on a failed write was not added: no fixture can fail the deny file's write
  while leaving the history writable, so no test could turn it red.

## Accepted costs and residuals

- **Children already stale before the first install of this build are not recovered** (ruling F1). Their digest
  was never recorded, so they stay `none` and keep skipping the hold. Each one routes once it is respawned, renewed
  or rolled. Measured on 2026-11-18: 11 of 48 live children with a pane. Those are the children this PR was opened
  for, so they are not rescued by it.
- **A stale child's prompt is now held like a current child's `escalate` prompt** (ruling F7). It costs its claimant
  a brief and up to the window before the prompt reaches the operator, where before it reached the operator at once.
- **A rollback inside a row's window.** An older server's rule door does not read `denyCurrent`. If the server is
  rolled back while a stale `ordinary` row is still inside its window, that row can be allowed. The window is 60 s
  on the main thread and 180 s for a subagent.
- **The history file is trusted as written.** It sits in the registry beside the deny file. The hook's write deny
  now covers it, but a top-level session runs with the same reach the guard section of `CLAUDE.md` describes for
  the other trusted files.

## Mutation measurements

Every guard was measured red by a mutant applied in place. The file was restored from a copy saved before the
first mutant, and the restore was checked byte for byte.

- Installer: 11 mutants, all killed (a line on every install, no bound, malformed lines kept, a write through a
  symlink, a write on `--remove`, seconds for milliseconds, the old history dropped, the outgoing digest never
  recorded, recorded after the incoming one, read through a symlink, the current digest never recorded). Uninstall:
  1 killed.
- Hook: 8 mutants, all killed (a digest in neither sent, `denyDigest` dropped, any line naming any digest, the line
  not anchored, a symlinked history read, the history read on the current path, the truncated body without
  `denyDigest`, `denyDigest` sent for a current digest). Write deny: the new alternative removed reds 6 cases.
- L1 deciders: in `server/test/sim/mutation-floors.json`, `denyStandingOf` (17 mutants) and `approvalAllowRefusal`
  (10 mutants: among them the currency check dropped, inverted, answered as `guard-forbidden` or as
  `guard-escalate`, and asked before forbidden), every mutant killed, floor 1.
