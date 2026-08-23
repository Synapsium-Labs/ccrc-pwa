# The agent stops answering with a verb list it read at boot

**Status:** design, approved 2026-08-03. Written from a measured fourteen-hour outage.

**Relationship to the extraction programme.** Finding 1 of
`2026-08-03-ccrc-pwa-findings-for-specs-1-3.md` assigned this defect to spec 3,
the installer spec, and offered two ways out: stop capturing capabilities at boot,
or have the installer enforce the order. **This spec takes the first, and takes it
out of spec 3.** The reason is where the code lives: the caps handshake is agent
and server TypeScript that migrates to `ccrc-pwa` with everything else, so fixing
it now is never wasted — whereas the installer half is aimed at a `deploy.sh` that
spec 3 exists to replace. Spec 3 keeps the installer, and inherits a fleet that no
longer depends on it for correctness.

## What happened

On 2026-08-02 every workspace control in the PWA went dead — PR open, PR state,
archive, restore, audit, reap — and stayed dead for fourteen hours while the PWA
told the user *"The fleet host is running a ccd that does not have this verb yet"*
(`pwa/src/lib/api.ts:68-69`, mapped onto the `unsupported` code at `:88`). Every
component was at exact repo parity. `ccd` was byte-identical to committed `main`.
The server, the agent and the PWA bundle had all been deployed after the merge that
added the verbs.

The outage was 113 seconds of ordering:

| time (UTC) | event |
|---|---|
| 2026-08-02 23:42:50 | `ccrc-agent` boots. Runs `ccd caps` once. The ccd live at that moment is the pre-upgrade one — 64249 bytes, preserved as `~/.local/bin/ccd.bak-20260802-234443` — and it has no `caps` verb, so the read exits 1. |
| 2026-08-02 23:44:43 | `ccd` is overwritten in place with the new 330840-byte script. |
| 2026-08-02 23:45:14, 23:51:34 | the server restarts and reconnects twice — and both times re-reads the agent's boot-time cache, which is still the failed read. |
| 2026-08-03 14:01:42 | someone restarts `ccrc-agent`. Everything works. |

Everything that could have caught it was green: `deploy.sh` exited 0, `/health`
returned `{"ok":true}`, and `ccd caps` run by hand on the box listed every verb
correctly.

## Why a restart was the only cure

`readCcdVerbs` returns `[]` on a non-zero exit (`agent/src/server.ts:304`) and is
called exactly once per process (`:417`, before the HTTP server is even created at
`:419`), closed over and handed to every connection for the process lifetime.
`verbSupported` reads `[]` as "the fleet said it supports nothing" and refuses
every gated verb (`ccdargv.ts:85-92`) — `null` means "no evidence" and permits,
`[]` means refuse, and that distinction is deliberate and pinned.

Nothing in the agent ever re-reads. Its only timers are a per-connection hello
timeout and a per-tail poll. There is no SIGHUP handler, no TTL, no watch. The
protocol offers no way to ask again: `ready` is the only frame that ever carries
`ccdVerbs` (`shared/agent-protocol.ts`). The server's `FleetClient` *does* re-read
on every handshake (`remote/client.ts:276-278`) — but only from the agent's
boot-time cache, so a reconnect refreshes to the same stale answer, as the two
reconnects in the table demonstrate.

## The refresh

A new protocol op, `caps`, joins the `AgentReq` union with its `validateReq` and
`handleReq` cases. FleetWatcher asks every `CAPS_REFRESH_MS = 60_000` — a fourth
lane beside the 2s tick (`watch.ts:79`), the 10s task sweep (`TASK_SWEEP_MS`,
`watch.ts:21`) and the 120s PR sweep — and updates `fleetState.ccdVerbs`.

**The agent's cached list stops being a boot-time constant.** This is the half that
is easy to miss. Today `readCcdVerbs`'s result is a `const` closed over by
`handleConnection` (`agent/src/server.ts:417`, `:421`) and re-sent verbatim on every
handshake (`:340`), while `FleetClient.onReady` assigns `state.ccdVerbs` from that
frame (`remote/client.ts:276-278`). If the caps handler refreshed only the server's
copy, the next reconnect would overwrite it with the agent's stale boot value and
silently undo the fix. The cached list becomes mutable agent state that the caps
handler writes back and `ready` serves.

**Pull, not push, for three reasons.**

It reuses the existing request/pending machinery. An agent too old to know the op
refuses it cleanly rather than hanging: `validateReq` switches on `msg.op` and hits
`default: return null` (`agent/src/server.ts:288-289`), so the caller gets
`fail(msg.id, 'bad-request')` (`:357`) and `handleReq` is never reached. **Not
`not-implemented`** — that path is for ops the agent knows but cannot serve.

**It cannot deadlock itself.** This is the trap in the obvious alternative: if caps
were refreshed by running `ccd caps` as an ordinary `exec` through `CCD_ARGV`, then
`ccdVerbs: []` would make `verbSupported` refuse the very call that repairs the
list. A protocol op never touches the gate. `ccd caps` also stays off the exec
whitelist, preserving the stance written at `agent/src/server.ts:293-296` — "not
whitelisted and never reachable from a connection".

And it needs no scheduler inside the agent.

**The agent stat-gates the re-read.** It keeps the cached list and compares the
mtime and size of the path `resolveSpawnCmd('ccd', home)` resolves to — the same
path it would exec, which is not necessarily `~/.local/bin/ccd`. Only a change in
either re-execs `ccd caps`. A replacement identical in both is treated as no
change, which is the accepted cost of not hashing. The verb is a static heredoc and
does no I/O, but a spawn on every 2s tick would be 43,200 bash processes a day to
learn nothing.

## What this fixes, and what it leaves

It fixes **staleness** outright: a newly installed ccd becomes visible within one
`CAPS_REFRESH_MS`, with no process restart and nothing for an operator to remember.

It downgrades **stuck-empty** from permanent to self-healing. A failed `ccd caps`
still yields `[]` and still refuses every gated verb — but for at most sixty
seconds, rather than until someone notices.

**The `[]` encoding does not change, and neither do its tests.** Four assertions
pin it — `agent/test/exec.test.ts:178-184` and `:186-198`,
`server/test/remote-connect.test.ts:31`, and
`server/test/whitelist-subset.test.ts:179-192` (assertion at `:188-192`, the
mutation record at `:179-187`), the last of which records that the mutation
`verbs === null || verbs.length === 0` once left the entire suite green. A third
state distinguishing "caps unreadable" from "caps says nothing" was considered and
rejected: it would reopen a behaviour the codebase pinned on purpose, to buy a more
accurate sentence during a window this refresh already closes.

The residue is honest and small: for at most sixty seconds after an unreadable caps
read, the PWA says the fleet's ccd lacks the verb when the truth is that its caps
could not be read.

## Error handling

| condition | behaviour |
|---|---|
| agent predates the `caps` op | replies `bad-request` — `validateReq` rejects unknown ops before `handleReq` — and the server keeps its current `ccdVerbs`; no error surfaced |
| `ccd caps` exits non-zero on refresh | `[]`, as today; refused verbs stay refused until a later refresh succeeds |
| ccd path missing at stat time | cached list retained; the refresh is a no-op rather than a clearing event |
| ccd replaced with identical mtime and size | treated as no change; accepted cost of not hashing |
| fleet down during a refresh | ordinary transport failure; `ccdVerbs` untouched (`setState` compares only `connected`/`downSince`, `client.ts:316-323`) |

## Testing

**Agent** — the `caps` op: answers with the verb list; re-execs only when the
resolved ccd path's mtime or size changed; returns the cached list otherwise; an
unreadable ccd yields `[]` without clearing a previously good list; **a refreshed
list is what the next `ready` frame carries**. The four pinned assertions stay
exactly as written and must still pass untouched.

**Server** — the refresh updates `fleetState.ccdVerbs`; a `bad-request` reply
leaves it alone; a transport failure leaves it alone; a verb that appears after a
refresh becomes callable without a reconnect; **a reconnect after a refresh does
not regress the list to the agent's boot value**.

**Mutation sweep** over the whole diff, per `.superpowers/sdd/<plan>/CONSTRAINTS.md`.

## Handed to spec 3, not solved here

Three defects surfaced alongside this one. All three are in `deploy.sh`, which
spec 3 exists to replace, so patching them now would be work thrown away. They are
recorded in `2026-08-03-ccrc-pwa-findings-for-specs-1-3.md` rather than designed
here.

- **`deploy.sh` never builds the PWA**, yet its `rsync --delete` covers
  `server/dist-pwa` — only `dist` is excluded. A deploy ships whatever bundle sits
  on the deploying machine, or deletes the one on the box.
- **`deploy.sh` never ships `ccd`.** Recorded as finding 1's second instance: the
  installed copy was 4,258 lines behind main.
- **`ccd` installs in place**, which is how a 64KB script became a 330KB script
  under every running `ccd supervise` process. Bash reads scripts by byte offset.
  Two supervisors started `Sat Aug 1 10:52:27 2026` are still alive against a
  script replaced `2026-08-02 23:44:43`. They are a bounded case rather than live
  corruption — `cmd_supervise` is a single loop already resident past the point new
  bytes would be read — but the class is real and an atomic install removes it
  rather than shrinking it.
- **`CCRC_SSH_KEY` defaults to a key that does not exist on openclaw**
  (`<your-key>`; the fleet host calls it `<your-key>`), a difference
  `deploy.sh:4-6` documents without acting on. Deploying from the fleet host fails
  at first contact with a bare `Permission denied (publickey)`.

## Out of scope

- **A third caps state.** Rejected above, with reasons. If the residual sentence
  proves to matter in practice, it is a separate spec that must argue its way past
  four deliberate assertions.
- **Restarting the two supervisors that predate the swap.** Argued above: bounded,
  and restarting them kills live panes and in-flight turns. The agent resolves
  `ccd` fresh on every exec, so no fleet action ever runs through a supervisor's
  copy.
- **Everything in the handoff section.** Spec 3's.

## Definition of done

Installing a new ccd on a fleet host makes its new verbs callable from the PWA
within one `CAPS_REFRESH_MS`, with no restart and nothing for an operator to
remember — and any window in which the fleet claims a verb does not exist closes on
its own rather than lasting until someone notices. A reconnect after a refresh does
not regress the fleet to what the agent read at boot.
