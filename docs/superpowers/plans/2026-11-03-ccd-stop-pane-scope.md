# A deliberate stop stops the session's own pane scope

**Why.** `claude-session@.service` runs with `KillMode=process`, so stopping a session signals its main process only.
Everything the agent started in the background (a test server, a watcher, a `sleep`) keeps running in the tmux pane's
transient scope, `app-claude\x2dsession.slice/tmux-spawn-<uuid>.scope`, until the scope sweep finds the scope dead for six
hours. The common case should not leak: when ccd stops a session on purpose, it should also stop that session's own pane
scope. Follow-up to the scope sweep (session-continuity spec §5.6 item 2), approved by the operator on 2026-10-26.

## Deviations found

- **D-7902 (2026-11-03)** — a deliberate stop stops the session's own pane scope: `ccd stop` and `ccd hibernate` (which
  the stop-done lane and the roll compose) read the pane's scope before the kill and, once the main process has exited
  and a grace has passed, run `systemctl --user stop --no-block <unit>`, but only while `$REG/pane-scope-stop-live`
  stands; absent, each stop logs what it would stop. The switch's one writer is the new verb `ccd pane-scope-stop
  --state live|shadow`, behind `POST /api/coord/pane-scope-stop` (session-only) and Settings › Automation › Stop
  leftovers; it ships in shadow.

## Re-grounding: the teardown paths

| Path | Verb | Pane at teardown start | Change |
| --- | --- | --- | --- |
| `ccd stop` (the PWA's Stop, a session's own shell) | `cmd_stop` | yes, until the kill: `KillMode=process` ends only the supervisor | reads the scope after `_ws_unsupervise` and before the kill, then `_pane_scope_stop` after the kill |
| stop-done (a finished worker) | composes `ccd hibernate` (`server/src/stopDone.ts`, D-5427) | yes: the hibernate re-measure requires a live pane | through `cmd_hibernate` |
| hibernation (a long-idle session) | `cmd_hibernate` | yes, same re-measure | reads the scope after `_ws_unsupervise` and before the kill, stops it after the kill |
| the roll (`hibernate --roll`) | `cmd_hibernate` | yes | the delayed stop is dispatched after the kill and before the wake, for the scope read before the kill; the wake's new pane runs in a new scope |
| the auto-swap restart | `cmd_swap` | n/a | untouched: a swap is not a stop |
| `ws-archive`, `ws-rm`, `ws-reap`, `forget` | `_ws_unsupervise` callers | varies | untouched (not in this change's scope) |

## A wedged tmux holds no stop

The stop's stamp and the unit's disable are the intent, and they come first: `_pane_scope_of` runs after `_ws_unsupervise`,
where the pane still stands, so a wedged tmux server cannot keep a row from reading stopped or a unit enabled. The read is
bounded too (`_pane_scope_tmux`, `SUBSTRATE_PROBE_DEADLINE_S`, the same call the reap's `list-panes -a` makes), which also
bounds `_panescope_record` on the spawn path. A read that runs out of time reads no scope: the stop goes on, the line says
`held: tmux did not answer within <n>s, so no scope was read`, and the scope sweep collects what is left. The verbs'
`tmux kill-session` is unbounded, as it was before this change.

## The act, in order

`_pane_scope_stop <id>`, after the kill, on what `_pane_scope_of <id>` read before it, checks step 1 at once and hands
steps 2 to 5 to `_pane_scope_reap` in its own transient unit (`_pane_scope_detach`, through `_svc_run_detached`, the
swap's own detach). The verb never waits: a plain hibernate is called with the coordination serialiser held
(`server/src/remote/runner.ts`, D-7541), so a verb that waited out the main process and the grace would hold every
coordination write for as long. The detached job inherits none of the verb's descriptors or locks and runs outside every
cgroup it might stop. Its `bash -c` string carries only words checked against a charset with no quote, space or `$`.

1. the unit's parent cgroup is the session slice (outside it nothing is logged: it is no ccd pane scope), and the unit
   is `tmux-spawn-*.scope`, or it is held (never the tmux server's own scope);
2. the main process (the pane's pid) exits within `PANE_SCOPE_EXIT_WAIT_S` (10 s), or it is held; then
   `PANE_SCOPE_STOP_GRACE_S` (10 s) passes;
3. something is still in the scope's `cgroup.procs`, or the line says nothing is left;
4. no live tmux pane but this one has its process in the scope or below it (a stop takes the subtree); tmux answering
   "no server running" is measured (no pane is live), any other failure to list holds;
5. the switch stands: `stopped <unit> (<n> processes)`; absent: `would stop <unit> (<n> processes)`.

Every outcome is one `pane-scope <id>: …` line in `swap.log`.

## Single readers and writers

- `$REG/<id>.panescope` keeps its one writer (`_panescope_record`) and its one reader (`_end_cause`): the stop derives the
  scope from the live pane's `/proc/<pid>/cgroup` through `_pane_scope_of`, which `_panescope_record` now calls too, so
  the K16 census (`server/test/census-w5/paneScopes.ts`) is unchanged.
- `$REG/pane-scope-stop-live`: one writer (`cmd_pane_scope_stop`), one acting reader (`_pane_scope_stop`), one reporting
  reader (doctor's `pane-scope-stop` check), and the coord frame's `readSwitches` read; pinned in
  `server/test/single-definition/switches-history.test.ts`.
- `KillMode`, `ccd-scope-sweep` and `ccd-cap-scopes` are unchanged.

## Mutation table (measured)

| Mutation | Red case in `server/test/ccd-stop-pane-scope.test.ts` |
| --- | --- |
| drop the other-session hold | another live session's pane in the same scope; another live pane in a child cgroup |
| stop without the switch | no `pane-scope-stop-live`: one would-stop line, no stop call |
| skip the slice and name check | a unit that is not `tmux-spawn-*.scope`; a pane scope outside the session slice |

## Landing: two pull requests

`consolidation-path-guard.test.ts` (D-5855) is red on a diff that touches `shared/switches.ts` beside any `pwa/` path, so
the switch row and the Settings card cannot share a pull request. The first carries everything but `pwa/`: ccd, the
agent's grant, the route, the coord frame's `paneScopeStop` and the doctor check. The Stop leftovers card follows in its
own pull request, which edits no `shared/switches.ts`. Between the two the switch stays in shadow, and the frame already
says so to a PWA that does not read it yet.

## Deploy

Agent lane first: the verb and the act ship in ccd, the grant in the agent's whitelist. Then the server lane, for the
route and the Settings card. It ships in shadow; the operator arms it from Settings › Automation › Stop leftovers after
reading the shadow lines.
