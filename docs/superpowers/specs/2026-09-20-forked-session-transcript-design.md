# A session that forks keeps its chat — design

**Date:** 2026-09-20
**Status:** design, approved in chat; implementation plan not yet written
**Branch:** `ws/chat-message-disappears-while-waiting`
**Reported by:** the operator, 2026-09-19

## The report

> Type into the chat while it shows "waiting" — the message appears, then
> disappears, and the reply to it never appears either.

Two defects wearing one symptom. The reply never appears because the server is
tailing a transcript nobody will write to again. The message disappears because
the PWA erases its own optimistic bubble on a five-second timer.

## What is measured

Claude Code 2.1.278 forks a live session into a daemon-hosted background PTY
under a NEW sessionId. Measured on `ccrc-pwa-bright-canyon`, 2026-09-19
22:00:14: the pane process (`claude --resume <old>`, whose
`<cfg>/sessions/<pid>.json` says `kind:"interactive"`) spawned
`claude daemon run --origin transient`, which spawned
`claude bg-pty-host --session-id <new> --fork-session --resume <old>.jsonl
--reply-on-resume`.

The old transcript's last line is Claude Code's own statement about itself:

    {"type":"continued-in","sessionId":"<old>","continuedInSessionId":"<new>"}

**Nothing in this tree reads it** — grep over `server/src`, `shared`, `ccd`,
`agent/src` returns zero hits.

`ccd`'s `_sync_uuid` exists precisely to stop a pinned uuid going stale, and it
reads `<cfg>/sessions/<PANE pid>.json`. The pane's file still names the OLD id;
the fork writes its own file (`kind:"bg"`). So `$REG/<id>.uuid` is never
updated, and every uuid-keyed reader keeps pointing at a dead file. A message
typed in the PWA still reaches the session (HTTP -> tmux, unaffected), the reply
lands in the NEW file, and neither ever reaches the screen.

**Census 2026-09-20:** 14 registry sessions, 2 frozen —
`application-swift-hollow` (since 2026-09-11T16:07:21Z, eight days) and
`ccrc-pwa-bright-canyon` (since 2026-09-19T19:00:15Z). The 09-11 incident
matches to the second: fork at 16:07:21Z, the operator's message at 16:08:05Z
landed in the successor file, and the screenshot at 16:08:57Z showed neither it
nor the reply. Reproduce: for each `~/.cc-sessions/*.uuid`, locate
`~/.claude*/projects/*/<uuid>.jsonl` and grep its tail for `"type":"continued-in"`.
**After this work that count must read 0**, which is also the shape of the
doctor check in section 4.

### Two theories that were tested and retracted — do not re-derive them

- **"No WS heartbeat / zombie socket."** The browser<->server sockets genuinely
  have no liveness check (the client's `nudge()` is inert while `this.ws` is
  set; `app.register(fastifyWebsocket)` takes no options; the server<->agent
  link does have one, `server/src/remote/client.ts`). A real gap, worth its own
  ticket — but not the cause of either incident.
- **"Virtuoso stops sticking to the bottom when the pending bubble is
  removed."** False: react-virtuoso 4.18.11 fires `followOutput` on any
  `totalCount` change, decreases included (`dist/index.mjs:1826-1835`).

## Scope

Four lanes, to the root. They are ordered by deploy risk, not by importance;
lanes 1 and 2 carry no fleet-host risk and land first.

| Lane | Where | Ships how |
|---|---|---|
| 1 | `server/src/transcript/resolve.ts`, `server/src/sessionws.ts` | ordinary server deploy |
| 2 | `pwa/src/stores/session.ts` | ordinary PWA deploy |
| 3 | `ccd/ccd` (`_sync_uuid`) | AGENT-FIRST, fleet box, supervisor sweep |
| 4 | `ccd/session-hook.sh`, `ccd/ccrc-doctor-checks` | AGENT-FIRST, after lane 3 |

Lanes 1 and 3 **converge rather than compete**: the server only READS a pointer
Claude Code wrote, so once `ccd` fixes the registry there is no marker left to
follow and both answer identically. Neither is redundant — lane 1 heals every
stream that is open right now, including on a box whose `ccd` has not been
moved; lane 3 fixes the authority, so `--resume` after a restart stops
time-travelling to the pre-fork point and the hookstate/tasks/ask gates realign.

**Program ownership, checked 2026-09-20.** No program in
`docs/superpowers/programs/` owns `transcript/resolve.ts`, `sessionws.ts`,
`stores/session.ts`, `_sync_uuid` or `ccrc-doctor-checks`. The only mentions of
`session-hook.sh` are flake notes and one Build-4 fix candidate about its
SessionStart handler, which this work does not touch. Open PRs: #152 owns
`ChatList.tsx` / `MessageBubble.tsx` / `chat.css` / `chat.test.tsx` and does NOT
touch `stores/session.ts`; #97 (ours) touches `sessionws.ts` only in its imports and
`SessionStream`'s early methods (hunks at lines 7, 16, 200 and 241), nowhere
near `shouldRepoint` at line 754; #107 adds ~556 lines to `ccd/ccd` and does not touch
`_sync_uuid`.

## 1. The server follows the pointer inside transcript resolution

The follow lives **inside** resolution, not in the stream. If the stream
switched uuid on its own, the two-second tick (`sessionws.ts`,
`data.uuid !== this.uuid`) would compare the switched value against the registry
and flap it back every tick.

`TranscriptResolution`'s `found` arm gains one field:

    readonly uuid: string    // the uuid the answered path actually holds

Always present, equal to the requested uuid when nothing was followed. It is a
positive statement, not an overloaded absence, and it exists because the
alternative — a caller parsing the uuid back out of the path's basename — is an
adapter re-deriving a distinction it was already handed.

`resolveTranscript` walks the ladder exactly as today. After it has a hit, it
reads the tail of that file and, if the last line is a `continued-in` record,
resolves the successor uuid through the same ladder and repeats. Bounded hops
with a visited set: this is data off a disk that other processes write.

**Parsing the marker is one function**, shared by every reader in the tree, so
two readers can never disagree about what counts as a marker.

### The memo is the trap

`TranscriptResolver` memoizes on `${configDir}\0${uuid}\0${dir}` and revalidates
by a single question — does the answered path still exist? A file that gains a
marker while a stream is open still exists, so a memo that only asks that
question serves the pre-fork answer for as long as the stream lives. The memo
entry therefore records the answer's `(size, mtimeMs)` alongside it, and:

- stamp unchanged -> the cached answer stands, no read at all;
- stamp changed -> re-run the ladder, which re-reads the last 8 KiB (one
  window, shared with lane 3, so both readers ask the same question).

Cost in the steady state is one `stat` per tick per open stream (which the tick
already pays) plus a small tail read on the ticks where the file actually
changed. That read duplicates bytes the backlog and the tailer are reading
anyway; the duplication is accepted deliberately, because the alternative —
having the tailer report the marker upward — puts transcript knowledge in the
delivery layer and adds a second place where "what is a marker" is decided.

### Re-pointing

`shouldRepoint` today is:

    if (cur.path === next.path && rungRank(cur) === rungRank(next)) return false;
    if (rungRank(next) < rungRank(cur)) return true;
    return !tailedExists;

A followed answer changes the path at the SAME rung, and the old file still
exists (it is frozen, not deleted), so all three clauses decline and a
mid-stream fork would never re-point. One clause is added: **a resolution whose
`uuid` differs from the uuid currently being tailed re-points, whatever the
rung.** Supersession is not a better address for the same thing; it is a
different thing, and rung order was never asked to rank it.

The frame sent is a fresh `backlog`, **not** `rotated`. The backlog arm already
re-states file / uuid / offset / missing / strandedAccount / searchComplete /
fileMeasured, and `rotated` would mint a false "Session context reset" marker in
the chat — the tick's own repoint branch refuses it for exactly that reason.
Nothing was reset; the conversation continued.

### When we do not follow

A marker whose successor does not resolve — the file does not exist, the
directory cannot be read — is not followed, and the reader stays on the file it
has. Following may give the reader a BETTER file; it may never leave the reader
with no file at all. A chain that exceeds the hop bound, or revisits a uuid,
stops at the last good answer for the same reason.

## 2. The PWA stops erasing its own message

`confirmTimeoutMs = 5_000` plus `expireConfirmed` delete the optimistic bubble
five seconds after the API accepted the send. A busy session QUEUES the message
(`inject/send.ts` proves the text left the input box and the pane answered
"Press up to edit queued messages"), so the echo cannot arrive inside five
seconds. The deletion is also an overloaded seam: "the echo arrived" and "the
echo never came" erase the bubble identically.

**The timer is load-bearing and is not removed.** A slash command's echo parses
as a `system` event (`transcript/parse.ts`, `harnessEnvelope`) while
`clearConfirmed` matches only `e.kind === 'user'`, so for `/compact` and friends
this timer is the only thing that ever clears the bubble. Any fix must keep a
terminal condition.

**A flag, not a state.** `ChatList.tsx`'s `PendingBubble` has exactly two arms:
`state === 'sending'` renders the grey "sending" receipt, and anything else
renders the red "not sent" failure. A third state token would therefore render a
legitimate queued message as an error — and `ChatList.tsx` belongs to open PR
#152, so it cannot be edited here. So `PendingSend` gains

    queued?: boolean

beside `state: 'sending'`, in the same additive, absence-permits shape the file
already uses for `submittable`. Nothing in the UI changes today; when #152
lands, showing "queued" instead of "sending" is one line in `ChatList.tsx`.

The five-second timer sets the flag instead of deleting. A second, much longer
deadline — `queuedTimeoutMs`, default 10 minutes, injectable for tests beside
`confirmTimeoutMs` — performs today's deletion. The deletion is not removed — it is moved to a horizon where a
bubble quietly retiring is no longer a surprise, and the interval before it is
occupied by a positive fact (the API accepted this; the session has not echoed
it yet) rather than by an erasure.

The two lanes compose without knowing about each other: when lane 1 follows a
fork and sends a fresh backlog, `clearConfirmed` already runs on `backlog`
messages, so the operator's queued message clears itself the moment its echo
arrives in the successor file.

## 3. `ccd` learns the fork

`_sync_uuid` keeps its existing step — the pane pid's sessions file, which is
what catches a `/clear` rotation — and gains a second: from whatever uuid it now
holds, follow the `continued-in` chain and write the end of it. Pane first,
chain second, so this is a strict extension and no existing rotation changes
behaviour.

**It must not call `_transcript_path`.** PR #107's D-2444 measured that function
at ~36 ms, roughly 14x the pane classifier, and names paying it every five
seconds across the fleet as the thing it had to stop. `_sync_uuid` instead stats
the direct address for the uuid it holds — `<cfg>/projects/<munge(workdir)>/<uuid>.jsonl`
— and reads nothing when that file is absent.

**The read budget.** The marker can only be the final line of a file that will
never be appended to again, so the tail read is gated on quiescence: remember
the `(size, mtime)` last examined, and read the last 8 KiB only when the file
has stopped changing and that exact pair has not been examined already. A busy
session pays one `stat` per tick and nothing else; a session that goes quiet
pays one 8 KiB read per quiescence and then nothing until it moves again. The
memo lives in a shell variable, not a registry file: `ccd supervise` is one
long-lived process per session, so the variable is already per-session state,
and a supervisor restart merely costs one extra read.

Chain-walking rules are the server's: bounded hops, a visited set, and a
successor that does not exist is not followed.

The edit stays inside `_sync_uuid`. `ccd/ccd` carries a large open PR (#107) and
one function is the whole conflict surface we are willing to create.

## 4. The hook, and the signal the operator sees

### The hook

`ccd/session-hook.sh` exits at once for a forked session
(`[[ -n "${TMUX_PANE:-}" ]] || exit 0`), and the forked process has no `TMUX` or
`TMUX_PANE` at all (measured via `/proc/<pid>/environ`).
`ccrc-pwa-bright-canyon.hookstate.json` was last written at 21:58:09 — two
minutes before the fork — through three hours of active work. So the ask card,
the subagent list and the compaction card all go dark for exactly the sessions
that need them.

Widening that guard is not enough: the hook learns WHICH ccd session it is from
the tmux session name (`tmux display-message -p '#S'` -> `cc-<id>`), and a fork
has no pane to ask. The fallback is `$CLAUDE_CODE_SESSION_ID` — which the hook
already writes into hookstate — matched against `$REG/*.uuid`. Attribution is
then positive and measured: the hook writes for a session only when the registry
itself names that uuid as its own, so a stranger's Claude session on the same
box exits 0 exactly as it does today. That is the reason the guard exists, and
it survives intact.

**The hook must never become the registry writer.** It reports; `ccd` decides.
This is also why lane 4 lands after lane 3: until the registry knows the new
uuid there is nothing for the hook to match against, and for the few seconds
between a fork and the next supervise tick the hook writes nothing — the same
honest silence it has today.

Independently, `server/src/hookstate.ts` rejects a hookstate whose `sessionId`
differs from the registry uuid. With lane 3 in place that gate agrees with
reality again and needs no change.

### The doctor check

`ccrc doctor` gains one check, `transcripts`: for every session in the registry,
stat the transcript for its current uuid and read its last line; count the ones
that end in a `continued-in` marker. **PASS at 0.** Above 0 it WARNs and names
the ids — a fork whose supervise tick has not run yet is a real transient, and
the remedy line says so; a count that persists across runs is a stuck registry
uuid and the remedy names that too.

This is the user-facing signal the operator chose: **silent in the chat, visible
in `ccrc doctor`**. The chat says nothing because there is nothing to say — the
conversation continued and the operator is reading it.

Shape follows the file's own conventions: one entry in `CCRC_DOCTOR_CHECKS`, one
`_check_transcripts` function, one test (`ccrc-doctor.test.ts`'s first case
fails the build if the table and the functions disagree in either direction).
The registry path is spelled literally as `$HOME/.cc-sessions`, as
`_check_pools` does and for the same reason — this file is sourced under `set -u`
by things that are not `ccrc`, so it may reference no other tool's variable. An
absent registry and an unsearchable one are told apart, following the verdicts
that file already gives them: an unsearchable `$HOME/.cc-sessions` is a FAIL,
because nothing under it can be reached, and a registry with no sessions in it
is a vacuous PASS in those words — never a SKIP, because a check that skips on
the doctor's own healthy fixture is a check that cannot be counted
(`_check_routing`'s rule, stated there).

## Testing

Every lane ships red-first with a mutation table: a measured before/after, not a
comment.

| Lane | The guard | The test that goes red when it is deleted |
|---|---|---|
| 1 | a resolved transcript that ends in a marker answers the successor's path and uuid | resolver unit test over a fixture config dir with a two-file chain |
| 1 | a chain longer than the bound, or one that loops, stops and answers the last good file | resolver unit test with a three-hop and a self-referential fixture |
| 1 | a marker whose successor is missing is not followed | resolver unit test; the answer is the original file, never a fallback |
| 1 | the memo does not serve a pre-fork answer after the file gains a marker | resolver test: resolve, append a marker, resolve again |
| 1 | a differing uuid re-points at the same rung | `shouldRepoint` unit test |
| 1 | the repoint sends `backlog`, never `rotated` | `sessionws.test.ts` frame assertion |
| 2 | the five-second deadline sets `queued` and deletes nothing | `pwa/test/stores.test.ts` with an injected short timeout |
| 2 | the long deadline still deletes, and revokes object URLs with it | same suite, both timeouts injected |
| 2 | an echo arriving in a fresh `backlog` clears a queued pending | same suite |
| 3 | `_sync_uuid` writes the end of the chain, pane-file first | `ccd-*` suite against a fixture HOME with a planted chain |
| 3 | a growing transcript is never tail-read | the same suite, asserting the read budget |
| 4 | a forked session with no `TMUX_PANE` writes hookstate when the registry names its uuid | `session-hook.test.ts` against a fixture HOME |
| 4 | a session whose uuid no registry row names still writes nothing | same suite — this is the guard, stated in the other direction |
| 4 | `transcripts` counts a planted marker and passes at zero | `ccrc-doctor.test.ts` |

Fixture HOMEs only. Never `ccd` against the live `$HOME`.

## Rollout

Lanes 1 and 2 are ordinary server and PWA deploys and depend on nothing under
`ccd/`, so they violate no rollout order.

Lanes 3 and 4 are AGENT-FIRST: fleet box first, then the server box, and they
take effect only once the `claude-session@*` supervisors restart — which is
`ccrc update`'s step-4 sweep behind its mandatory `KillMode=process` preflight,
the one scoped exception to "never touch those units". `main` gained
`ccrc rollout` on 2026-09-19, and the first move onto that channel is by hand,
once per box (D-3106): record `CCRC_ROLE`, then `ssh <box> ccrc update --to
vX.Y.Z`. Each of those steps needs the operator's explicit approval at the time;
none of them is implied by approving this design.

**Live-fleet caution, until lane 3 ships:** do not restart or swap
`ccrc-pwa-bright-canyon` or `application-swift-hollow`. Their registry uuid
still names the pre-fork transcript, so a `--resume` would time-travel them.

## Out of scope

- The browser<->server WebSocket heartbeat. A real gap, its own ticket.
- Any visible "queued" label in the chat: `ChatList.tsx` belongs to #152.
- Any change to `server/src/hookstate.ts`'s sessionId gate: with lane 3 it
  agrees with reality again.
- Deviation numbers. They are issued by `POST /api/ledger/deviations` and
  defined in the same act, which happens when the implementation plan is
  written — never looked up, never guessed.
