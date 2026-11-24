# One pending entry line stopped every child reclaim: plan

A registry row whose entry field reads `pending` held every child reclaim on a fleet for 13 hours. Two defects made
that one row: the scope path that creates the tmux server let systemd rewrite the pane command, and the rows rung let
any pending row hold every child, wherever it was. This plan fixes both in `ccd`.

## Measured

Measured on a fleet box on 2026-11-23:

- At 20:45:37 UTC on 2026-11-22 the fleet user's systemd user manager restarted, because a test run signalled every
  process of the user, and the tmux server died with it.
- The first respawn, at 20:45:54, found no server. So `ccd/ccd#_tmux_new_session` took its slow path,
  `systemd-run --user --scope … tmux new-session … '<cmd>'`.
- systemd 259 expands `${NAME}` in a scope's command by default. The pane writer `ccd/ccd#_plat_workdirid_pane`
  composes holds `p=${p%?.}`. Its stored `pane_start_command` read `p=;`, while a session created 7 s later through
  the fast path read `p=\${p%?.};`.
- With `p` empty, the writer's `case $p in /*` exits 0 and writes nothing. So the `v1 pending` line that
  `ccd/ccd#_spawn_workdirid_pending` wrote was never replaced. The pane still exec'd claude.
- `ccd/ccd#_ws_reclaim_workdir_shared` reads every registry row's entry field for every child, and a pending field
  anywhere answered `unmeasured` (`heldBy` `entry-pending`). The server logged 712 failed audits. 155 closed child
  workspaces (45 GB) piled up, and the disk reached 98 %. Nothing alerted.
- The operator cleared it with `ccd stop` then `ccd start` of that one idle session, which is ccd's own remedy.
  Reclaim resumed within a minute.
- systemd's NEWS for 254 says `--expand-environment=` is new there. It is off by default with `--scope` (with a
  warning) and on for everything else, and the scope default was to flip in a later release. Before 254, `--scope`
  ran the command as given. The 262 manual says that with `--scope`, systemd-run expands the variables itself.

## The change

1. **The scope path expands nothing** (`_tmux_new_session`). ccd reads `systemd-run --version`, bounded by
   `SUBSTRATE_PROBE_DEADLINE_S`, and keeps the answer for the process only when it is 254 or later or unreadable: a
   supervisor lives for weeks, so a pre-254 answer is asked again at the next slow-path spawn, in case systemd was
   upgraded in place under it. At 254 or later it passes `--expand-environment=no`. Below 254 it passes
   nothing, because nothing is expanded there. When the version cannot be read it passes the option: a newer
   systemd-run honours it, and an older one refuses it, so the session is created bare by the existing fallback.
   That gives a server in the wrong cgroup, never a rewritten pane command.
2. **A pending row holds only the trees it could be in** (`_ws_reclaim_workdir_shared`). A pending line's logical
   spelling is the row's `.workdir`. When that spelling resolves `complete` to itself, it crossed no link and no
   `..`, so the pane's `cd` went where the spelling reads now. The row is then placed by it, as a legacy row is, and
   the string, leaf and identity arms still refuse it when it is at, inside or through the child or a leaf. Any other
   answer holds, by row id, as before: a link on the spelling, an unplain form, or a gone or unresolvable component.
   The pending count (`pendingRows`) is unchanged, so it still counts every pending row. The expiry audit and the
   temp-root collector share the rung, so the same scope applies to them.

   **This reverses a recorded decision.** The path-identity spec's residual `pending-row-holds-every-child-box-wide`
   (§4.12) and the W3 plan's D-6432 said that narrowing the pending hold to rows placed by their strings "would defeat
   the field, so it stands", because a pending pane "may be entering anywhere". That is not so for a spelling that
   resolves `complete` to itself: the pending line's spelling is the row's current `.workdir` (a stale one reads
   legacy), and a `cd` of a spelling with no link, no `..` and no gone component enters what it names now. Such a row
   inherits only the legacy row's residual (`repointed-alias-for-legacy-rows-until-respawn`): a directory moved after
   the pane's `cd`, or a link on the spelling at the `cd` that is gone when the rung reads it. The reclaim, expiry and
   collect cwd probes cover both while a process lives inside. A gone row's spelling never resolves `complete`, so
   `gone-row-with-pending-field-holds-despite-its-release-arms` stands. This change amends §4.12 to say so, keeping
   the residual's name, which now covers the rows that still hold box-wide. Workspace lifecycle owns that residual
   (path-identity programme), so the PR asks it to weigh the reversal.
3. **Not done: keeping the stop epoch across a failed reclaim tail.** The tail's `_ws_unsupervise` rewrites
   `.stopped` with a fresh epoch on every attempt, which resets deps-shed's asleep floor. A fix has to live in
   `_ws_unsupervise`, the stamp's one writer, which ws-rm, ws-archive, ws-reap, forget and `cmd_stop` share. It
   would change a stamp that deps-shed re-reads byte for byte as a guard against races, and that several server
   readers parse. That is not small and clearly safe, so it is left for a change of its own.

## Residuals

- A pending row spelled without links, whose directory was moved after its pane entered it, is placed where its
  spelling reads now. A legacy row has the same residual, and both end at the session's next respawn.
- A pending row that leaves the rung before it is resolved holds under the word for its spelling (`not-plain`,
  `under-proc`) and that word's remedy. It no longer also carries `entry-pending`.
- Nothing yet alerts on a reclaim that stays unmeasured. D-8953 removes the cause measured here, not that gap.
- Whether the incident row's spelling crosses a link on the fleet box was not measured: this change touches no live
  box. D-8954 releases a pending row only when its spelling crosses no link, so on a box whose projects root sits
  behind a link it releases nothing, and only D-8953 stops a recurrence of the incident there. A read-only check
  (`pwd -P` of a stored `.workdir` against its spelling) answers it, and is the operator's to run.

## Tests

- `server/test/ccd-tmux-server.test.ts`: a `systemd-run` stub that expands as a v259 scope does. Through the scope
  path the pane records a valid v1 entry. 252 is passed no option. An unreadable version passes it, and the bare
  path still records. The version is read once. A 252 answer is asked again, and a 259 read after it passes the
  option. A `--version` that never answers costs the deadline, not its hang.
- `server/test/ccd-rows-rung-entry.test.ts`: an unrelated, link-free pending row no longer holds a child, though it
  is still counted. A pending row inside the child refuses. A pending row spelled through a link holds, and so does
  one that cannot be resolved completely. The count fixtures and `ccd-held-by.test.ts`'s `entry-pending` case now
  spell their pending row through a link, so they hold on every TMPDIR.

## Deviations found

- **D-8953 (2026-11-23)** — pane-writer-survives-scope-path. `_tmux_new_session` passes `--expand-environment=no`
  to systemd-run 254 or later, or when its version cannot be read, and nothing below 254. No `$` is doubled: a
  pre-254 scope expands nothing, so a `$$` would reach sh as its pid. A pre-254 answer is not kept for the process.
- **D-8954 (2026-11-23)** — pending-entry-holds-only-its-trees. A pending entry field holds a child only when the
  row's spelling does not resolve `complete` to itself. A link-free row is placed by its spelling, and its count
  stays. It supersedes D-6432's "so it stands" for the `unpend` hold, and amends the path-identity spec's §4.12.
