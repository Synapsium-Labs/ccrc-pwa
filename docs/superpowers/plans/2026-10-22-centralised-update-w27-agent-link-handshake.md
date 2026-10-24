# Centralised update management, wave 27: the link to the fleet agent cannot wait forever in a handshake: Implementation Plan

On 2026-10-22 the operator approved a wave for the agent-link wedge recorded in the programme ledger's 20:10 to
21:10 monitoring notes (in chat: "Sure"). The coordinator cut wave 27 the same day as run 833 and issued a block of
sixteen numbers starting at D-6514. Every citation below is `path:line` at the pinned base `7ebdff20c`, read with
`git show 7ebdff20c:<path>`. The worker re-reads each one in the landed text before editing it (the absorb step).

**What was measured.**
- **The incident, from the ledger.** The fleet box rebooted (down about 20:04:53, up 20:05:20). The agent listened
  again at 20:05:21, but the server never reconnected. The server box held ONE established socket to the agent port,
  opened at about 20:03:40: it had sent 232 bytes, all acked, and received nothing, with no keepalive timer. The fleet
  box had no connection on that port. The link came back by itself at 21:08:18 with no restart. What closed the
  socket is not visible from the session. Every fleet act waited behind it: update moves, mail delivery, dispatch.
- **The coordinator's reading is confirmed on its three counts, and corrected on the phase.**
  - `connect()` builds `new WebSocket(this.cfg.url)` with no options object at all (server/src/remote/client.ts:357),
    so no `handshakeTimeout` and no other `ws` or `http` option is set.
  - The heartbeat starts only at the end of `onReady` (`this.startHeartbeat()`, client.ts:528).
  - No timer exists between `connect()` and `ready`. The class's only timers are `reconnectTimer`, `heartbeatTimer`
    (client.ts:178-179) and the per-request timers (`Pending.timer`, client.ts:66).
  - **Correction: the socket never reached `open`.** The client sends `hello` only from the `open` handler
    (client.ts:364-366), and `open` fires only after a 101 response. So the 232 bytes were the HTTP upgrade request,
    and the socket sat in `ws` `readyState` CONNECTING. A planning probe (not committed) against a loopback listener
    that accepts TCP and never writes saw 224 bytes from a default client, the difference being the Host header, and
    no hello. The open-to-ready gap is real in the code but was not the observed failure (D-6515).
- **What the client does with a dead attempt.** Only `onClose` schedules a reconnect (client.ts:532-553, :552). The
  `error` handler is a deliberate no-op because `close` always follows (client.ts:369-371). A synchronous throw from
  `new WebSocket` goes straight to `markDown` and `scheduleReconnect` (client.ts:356-362). A socket that never closes
  therefore stops the reconnect loop for good. The backoff is 1 s doubling to 30 s (client.ts:73-77, :573-582) and is
  reset only in `onReady` (client.ts:526).
- **`ws` 8.21.1 (server/package.json:26; the installed copy matches the lock).**
  - `handshakeTimeout` becomes `http.request`'s `timeout` (node_modules/ws/lib/websocket.js:767), a socket IDLE timer
    that any byte read or written resets. Planning probe: `handshakeTimeout: 100` against a silent listener closed at
    107 to 109 ms; `handshakeTimeout: 150` against a peer that wrote a partial 101 line and then one byte every 50 ms
    left the socket CONNECTING after 2010 ms.
  - After a completed upgrade `ws` calls `socket.setTimeout(0)` (websocket.js:247), so `handshakeTimeout` does not
    cover `open` to `ready`. Probe: still OPEN at 1200 ms with `handshakeTimeout: 300`.
  - `terminate()` on a CONNECTING socket goes through `abortHandshake` (websocket.js:492-504, :1102-1131), which emits
    `error`, then `close` with code 1006 on the next tick, so the client's `onClose` runs and reconnects. On an OPEN
    socket it destroys the TCP socket, then `close` 1006. On a CLOSED socket it returns at once.
  - `ws` never calls `setKeepAlive`, and passes its own `createConnection` (websocket.js:752-753), so no `http.Agent`
    keepalive applies. The probe box's kernel defaults are 7200 s idle, 75 s interval, 9 probes.
- **The agent's side of the handshake** (agent/src/server.ts). On `connection` it sends nothing and arms a hello timer
  (`DEFAULT_HELLO_TIMEOUT_MS = 3000`, :95) that closes with 4401 `hello-timeout` (:1269-1271). A first frame that is
  not a good hello closes 4401 `unauthorized` (:1282-1287). A good hello is answered with `ready` synchronously in the
  same handler. It answers `ping` only after auth (:1328). So a healthy agent's `ready` follows `open` by one round
  trip, and no application frame can prove life earlier.
- **The 65-minute silence.** `server/src/remote/` has no `console.*` call at all
  (`git grep -n 'console\.' 7ebdff20c -- server/src/remote/` is empty): no connect, drop, retry or terminate is logged.
  The one line in the window, "registry directory listable again after 3926321ms unlistable", is the registry
  reader's whole-fleet episode logger (`noteWholeFleetListing`, server/src/registry.ts:743-756), not the link's.
  21:08:18 less 3926.3 s is about 20:02:52, so (by inference only) fleet reads began failing about 50 s before the hung
  socket opened.
- **Who reads link state.** Readers poll `state.connected` and `downSince`; `onStateChange` has no production
  subscriber (client.ts:206-209). `request()` refuses with `LinkNotSentError('disconnected')` whenever not ready
  (client.ts:257-260), which is how mail, dispatch and update moves all stalled. A pre-ready terminate changes NO
  observable state: during an episode the state already reads `connected: false` with `downSince` set, and `setState`
  drops a patch that changes nothing (client.ts:555-571). `FleetState`'s whole shape is pinned by `toEqual`
  (server/test/remote-connect.test.ts:53-57), so nothing new may go on `state`.
- **No operator tunable exists today.** `index.ts` passes only `url` and `token` (server/src/index.ts:153).
  `heartbeatMs`, `reconnectMinMs`, `reconnectMaxMs` and `requestTimeoutMs` (client.ts:37-48) are test seams with
  compile-time defaults (client.ts:189-199).
- **The heartbeat's terminate has no row.** Every client test passes `heartbeatMs: 60_000`
  (server/test/remoteHelpers.ts:45 and the inline `connectFleet` calls in remote-connect.test.ts). Planning probe:
  deleting `this.socket?.terminate()` in the two-missed-pongs branch (client.ts:600-602) left the 11 client-related
  server suites green, 353 of 353. The stale comment above `connectToAgent` (remoteHelpers.ts:36-38) still says the
  heartbeat "defaults fast".
- **Planning probe of the chosen shape** (a scratch extract of the base, since deleted): one wall-clock timer per
  attempt that terminates the attempt's own socket unless it is ready, with `readyTimeoutMs` 100 and backoff 30 to
  100 ms, saw 8 accepts in 1.5 s from a silent TCP listener and 8 from a peer that upgrades and never sends `ready`,
  against 1 accept at the base in both. The same 353 tests stayed green with it in place. This plan's own ten rows
  and client edits, applied to a second scratch extract (also deleted), ran 10 of 10 green, and at the base W27-L8
  and W27-L7 were green while W27-L1 and W27-L4 were red (the Mutation table gives each mutant's reds).
- **The plan was revised after review, after that probe.** Rows W27-L3, L5, L6, L8 and L10 changed, W27-L11 is new,
  the peer's modes are keyed by TCP accept, and the log gained a boot line and lost a phase word that claimed too
  much. The probe's figures stand for the rows as they were; for the revised rows the worker's measurement is the only
  record.
- **A second review revision followed.** W27-L4 and W27-L9 moved from 150 ms to 1000 ms (their ready attempt also
  runs under the deadline); W27-L12 (the deadline is armed before the TCP connect completes) and W27-L13 (a socket
  that cannot be created) are new; the mutation table gained M4b, M18, M19 and M20 and respelled M16; D-6526 is
  defined. Two revision probes (scratch scripts, since deleted) ground the new rows, 3 of 3 runs each:
  - a 300 ms synchronous stall right after `new WebSocket`, against a listener that never answers, with a 150 ms
    timer: armed at creation, the timer fired in CONNECTING and the listener saw 1 accept and no upgrade request;
    armed on the net socket's `connect`, it saw the upgrade request. Expired timers run before the poll phase that
    completes the connect.
  - `new WebSocket` throws `SyntaxError` synchronously for `not-a-url` (message `Invalid URL: not-a-url`, carrying the
    URL), `ftp://x/` and a URL with a fragment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.
> The dispatched worker runs it under the `ccrc-worker` skill. The brief carries only this wave's specifics: this
> plan's path, the task range, the claim groups and the deviation block.

**Goal:** no attempt to reach the agent can wait more than `connectTimeoutMs` (15 s by default) from the moment its
socket is created to the agent's `ready`, whatever phase it is stuck in: TCP connect, an upgrade never answered, an
upgrade answered a byte at a time, or a hello never answered. A stuck attempt is terminated and the existing
`onClose` path reconnects it with the existing backoff. The post-ready heartbeat, unchanged, gains the row it never
had. The link says what it does in the server log, at most once per kind per stretch without a ready link, and once
when it is ready again. After this wave a black-holed attempt costs at most the deadline plus one backoff (15 s + at
most 30 s) before the next attempt, against 65 minutes measured.

**Architecture:** one file of source, `server/src/remote/client.ts`, an L4 delivery file. It imports `ws`, and the
architecture spec calls it "the agent link, an L4 platform file"
(docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md:80).
- `RemoteFleetConfig` carries `connectTimeoutMs?: number`, a test seam beside `heartbeatMs`, with
  `DEFAULT_CONNECT_TIMEOUT_MS = 15_000` (D-6516, amended on main's #1160). `index.ts` is untouched.
- `connect()` arms `armConnectDeadline(ws)` right after `this.socket = ws`. The deadline is main's stored timer,
  `connectTimer`, `unref`'d like the other two client timers (`this.connectTimer.unref?.()`), cleared in `onReady`,
  `onClose` and `close()` and at each arm. When it fires it re-checks the facts, and acts only on the socket it
  captured (D-6514, D-6517, D-6724).
- A private `note(kind, text)` writes `console.warn('ccrc-server: agent link: …')` lines, once per kind per episode,
  and `onReady` closes the episode with one recovery line (D-6520). Nothing goes on `FleetState`, nothing on the wire.
- No `handshakeTimeout` (D-6514), no TCP keepalive (D-6518), no earlier heartbeat (D-6519), no agent change, no
  `FLEET_PROTO` change, no new `.invalidate(` call.

**Deploy class:** server box only. The change rides `ccrc update` (or `ccrc rollout`) like any server change. No box
ordering is needed: the agent and the wire are unchanged. The update that installs it restarts `ccrc.service`, so the
new client is the one that connects after the restart.

**Landing order, as dependencies:**
- Task 1 (the peer harness and the heartbeat's row) depends on nothing.
- Task 2 (the deadline) needs Task 1's harness.
- Task 3 (the log lines) needs Task 2's deadline.
- Task 4 (README and comments) needs the wording of Tasks 2 and 3.
- Task 5 is the gate and the PR.

One PR, from this workspace's own branch.

## Not in this wave

- **Logging the agent's own refusal.** Done by D-6527 (ruling 2), so this bullet no longer holds back the refusal
  line. A wrong token or a hello timeout closes 4401 before `ready` (agent/src/server.ts:1269-1287). At the base the
  client discards the close code (`ws.on('close', () => this.onClose(ws))`, client.ts:368). Now it reads the code and
  the reason: the code for the `lost`, `never-ready` and `refused` lines, the reason for `refused` only, through
  `refusalReason` (D-6522, D-6529). A bad token still retries at the backoff for as long as it stays wrong, as
  `remote-connect.test.ts`'s `'a bad token surfaces as a fatal (never-connects, permanently down) state'` describes,
  but the journal now carries one `refused` line per stretch. That remains a configuration defect, not a wedge, and
  the remedy beyond the log line is its own question (Reading 2).
- **Surfacing the link's phase in `GET /api/fleet/health` or the PWA.** It would add a field to `FleetState` or the
  wire; the log is this wave's evidence.
- **`connect()` leaking a socket on a second `start()`** (client.ts:201-204 does not check for a live socket). Only
  `connectFleet` calls `start()`, once (client.ts:634-636).
- **What closed the socket at 21:08:18.** Nothing in the client, `ws` or Node would have; it is recorded as unexplained.
- **A live drill for a silent peer** in README's "Verifying a remote-mode deploy" (README.md:3451). It would need a
  fake listener on a real box.
- **The box-token lifecycle spec's "logging nothing"**
  (docs/superpowers/specs/2026-10-07-box-token-lifecycle-design.html:366), dated HTML history (D-6523).

## Global Constraints

- **Files:**
  - Source: `server/src/remote/client.ts`.
  - Tests: `server/test/remote-liveness.test.ts` (new), `server/test/remoteHelpers.ts` (one comment).
  - Docs: `README.md` (one bullet in "Degraded mode"; it states no number, so nothing pins it to the constants).
  - This plan.
  - NOT touched: `server/src/index.ts`, `agent/`, `shared/` (no wire change), `server/test/remote-connect.test.ts`,
    every spec.
- **Functions this wave edits** (the consent list, by file):
  - `server/src/remote/client.ts`:
    - the module header (:25-31) and the `FleetClient` class doc (:150-159), comments only;
    - `RemoteFleetConfig` (:37-48), one new optional field;
    - the constants block (:73-77), one new constant;
    - the private fields (:171-181), one new field;
    - the constructor (:189-199), one new line;
    - `connect` (:353-372): the arm call, the `close` listener passing its code and reason, and one `note` call in
      the `catch` (:358-362, D-6526);
    - `onReady` (:423-530): the recovery line after `this.setState(…)` (:527);
    - `onClose` (:532-553): `code` and `reason` parameters, the `lost`, `never-ready` and failed-attempt bookkeeping,
      and the `refused` note (D-6527);
    - `startHeartbeat` (:593-611): one `note` call before the terminate (:601);
    - `armConnectDeadline` (main's #1160 method, whose expiry now writes this wave's line through the new `note`),
      and `note`, placed after `stopHeartbeat` (:613-616), and the module functions
      `preReadyPhase` and `refusalReason` (D-6529), placed after `isRecord` (:79);
    - new module types `LinkLine` and `LinkEpisode`, placed after `PtyListener` (:71).
  - `server/test/remoteHelpers.ts`: the comment above `connectToAgent` (:36-38).
  - `README.md`: one new bullet after the "When the agent connection drops" bullet (:3428-3431).
- **Claims, in groups, each taken all-or-nothing when its group frees.** Re-read the live claims before each group
  with `ccrc-api claims list --project ccrc-pwa` (a read).
  - Group A, now: `server/src/remote/client.ts`, `server/test/remote-liveness.test.ts`, `server/test/remoteHelpers.ts`.
  - Group B, at Task 4: `README.md`.

  Group B is NOT free. A read of the claims at planning time (2026-10-22, about 22:55Z) found `README.md` under live
  claim 2259, held by run 774 (landing-order wave 3e, held until its review and close, hard expiry 2026-10-23 05:10Z),
  whose intent grants README only to runs 793 and 809; claim 2247 (run 809) edits README under that consent. No live
  claim covered Group A's three files. So the coordinator asks run 774 for consent NOW, at dispatch, scoped to the
  one bullet inserted after "When the agent connection drops" in "Degraded mode", the way runs 793 and 809 got theirs.
  The worker takes Group B at Task 4 only under that consent or after claim 2259 ends, and records which in the
  as-built note. If neither has happened when Tasks 1 to 3 are done, the worker asks the coordinator, and does not
  wait in silence: Reading 10 is the fallback.
- **Pins this wave must keep green as they are:**
  - `fleet-identity-composition.test.ts`'s `'only the inventory publishes into the cell, and only the fleet client
    invalidates it'` expects exactly `['remote/client.ts:3']` code-only `.invalidate(` calls. Add none: a deadline
    reaches invalidation through `onClose`, as every other close does. Name no new method `invalidate`.
  - `remote-connect.test.ts`'s whole-object `FleetState` pin (:53-57). Add no field to `state`.
  - `remote-connect.test.ts`'s `'aborts the request, clears its timer, and ignores a late response'` counts fake
    timers with `vi.getTimerCount()` (:231, :238) after `vi.useFakeTimers()` (:222), which it installs only after the
    link is connected. The deadline is a real timer created before that, so it is not counted. Do not arm anything at
    `ready` or later.
  - The D-5513 WeakRef row in `remote-connect.test.ts` (`'drops the frame once sent: a pending account op keeps
    nothing of its frame alive …'`, :247): the deadline's closure captures the socket and the client, never a frame.
  - `single-definition.test.ts`'s single reader of `frame.ops` in `client.ts`: untouched.
- **No numeric citation in any added code or test line** (`citations.test.ts`, the D-5893 ratchet; its corpus is every
  code file outside `docs/`). Cite a symbol (`client.ts#armConnectDeadline`, `agent/src/server.ts#handleConnection`)
  or a row name. This plan's `path:line` anchors are for reading only.
- **Log lines** are `console.warn('ccrc-server: agent link: …')`, never `req.log` (the server runs with
  `logger: false`). They never print the agent URL, the token or any frame.
- **Hermetic tests.** Loopback listeners on `127.0.0.1` port 0 only, real timers, no fixture HOME needed (the peers
  are in-process listeners, not agents). No real agent, no real fleet, no live HOME. Every listener and socket the
  row opens is closed in `afterEach`.
- **Memory and vitest.** Read the session slice's `anon` in `memory.stat` before any vitest run, and run nothing above
  the programme's gate. Run ONE file at a time, in the foreground, from inside `server/`:
  `timeout -s INT 560 ./node_modules/.bin/vitest run test/<one>.test.ts --pool=forks --maxWorkers=1`, adding
  `-t '<case>'` where a step names one case. Never use bare `npx vitest`. Every `vi.waitFor` passes its own
  `{ timeout }` (the default is 1000 ms).
- **Mutations one at a time,** never in parallel, and only on a COMMITTED implementation: each task commits before
  its mutation step, so HEAD holds the task's code. Apply one mutant, run the named file, record the red rows,
  restore with `git checkout HEAD -- src/remote/client.ts` (from inside `server/`), and confirm
  `git diff --quiet HEAD -- src/remote/client.ts` before the next. (A plain `git checkout --` restores from the index,
  which before a commit is the previous task's code: it would discard the task's own work and the check would pass.)
  Task 1 Step 3 is the one mutation before a commit, and there `client.ts` is still the base.
  A mutant counts only if vitest collected and ran every row in the file: the summary's failed plus passed equals the
  file's row count at that task (1 at Task 1, 8 at Task 2, 15 at Task 3, 25 after review 852's fix
  round). A transform, parse or import error runs no row; that is a broken mutant, not a red. Rewrite it so it
  parses and run it again; never record it as red.
- **The absorb step.** Before each task's first edit, run `git fetch origin main` and re-read every anchor that task
  names in the landed text. Absorb `origin/main` with `git merge`, never a rebase or a force push of a published
  branch. The coordinator lands the PR.
- **Public repo.** Commits use the noreply identity. No hosts, IPs (loopback in tests excepted), home paths, lane,
  account or session names in code, comments, commits or the PR body. Write "the server box", "the fleet box" and
  "the agent port".
- **Routing.** Execute natively, inside the subscription, with no handoff. Pass the model explicitly on every subagent:
  - implementer subagents run on `sonnet`, one per task;
  - the per-task reviewer and the whole-branch reviewer run on `opus`;
  - scouts and transcription-grade edits (Task 1 Step 4's comment) run on `haiku`;
  - Task 4's README insert runs on `sonnet`: it waits on a claim and runs the prose scanners.

  The orchestrator reviews every diff. The wave-done fingerprint is this workspace branch's tip. The `suite:` line
  follows worker clause 15 (Task 5 Step 4).

## Review Focus

- **Every pre-ready phase is bounded by one wall clock.** An unanswered upgrade, a trickled upgrade and an unanswered
  hello each end within `connectTimeoutMs` plus scheduling: rows W27-L1 to W27-L4. A TCP connect that hangs has NO
  hermetic row: every peer here is a listening loopback socket, so the kernel completes the TCP handshake at once,
  and a loopback port that accepts no TCP refuses at once instead of hanging (no listener in Node leaves SYNs
  unanswered). What a row CAN pin is that the clock is already running before the TCP connect completes: W27-L12
  stalls the loop past the deadline right after the socket is created, and attempt 0 then ends with no upgrade
  request written, which a deadline armed at TCP connect (M18) or at `open` (M2) cannot do. W27-L1 and L2 do not
  show this (every peer accepts TCP at once), and no row shows a connect that hangs for real.
- **A socket that cannot even be created is logged.** A synchronous throw from `new WebSocket` prints the boot line
  once, naming the error, never the URL. Row W27-L13 (D-6526).
- **A ready link is never cut by the deadline.** The deadline re-checks `this.ready` when it fires. Row W27-L5.
- **A leftover deadline never speaks for the current attempt.** It compares its captured socket with `this.socket`
  before it logs or counts anything. Rows W27-L6 and W27-L7.
- **Shutdown.** `close()` during the upgrade settles, schedules nothing and logs nothing. Row W27-L7.
- **The heartbeat's terminate is pinned at last.** Row W27-L8.
- **The log is evidence, not noise.** One line per kind per episode, a second episode logged afresh, the phase named
  only as far as `readyState` can prove it, the boot stretch logged at both ends, the recovery line counting failed
  attempts. Rows W27-L8 to W27-L11 and W27-L13.
- **The refusal line, its range, its order and its phase.** An agent that closes a hello with a code from 4400 to
  4499 prints one `refused` line per stretch, after the line that opened it: never for 4399 or 4500, after the boot
  line in a boot stretch, and after the `(closing)` line when the socket is still closing. Rows W27-L14 (once, with a
  printable reason), W27-L21 (order), W27-L22 (range) and W27-L23 (phase).
- **The token never reaches the journal through a refusal reason.** The window is 8 consecutive characters of the
  token (all of a shorter token), checked on the full decoded reason before the cut, and an empty token checks
  nothing. Rows W27-L15 to W27-L20.
- **The deadline's timer is `unref`'d.** A client that is closed with a long deadline pending lets its process exit.
  Row W27-L24 runs a child process and races its exit against a bound far below the deadline.
- **The deadline keeps the backoff.** A timed-out attempt does not reset the delay: only a `ready` does. Row W27-L25
  (D-6585).
- **No reader moves.** No `FleetState` field, no wire field, no new `.invalidate(` call, no operator setting.

## Risk notes

- **A stalled agent.** An agent whose event loop stalls longer than 15 s between `open` and `ready` has its attempt
  terminated and retried, each retry costing it one handshake, at the grown backoff (up to 30 s). Such an agent would
  also fail the heartbeat after `ready` (about 30 to 45 s), so the deadline is not the stricter of the two by much.
  A healthy agent answers within one round trip (`handleConnection` sends `ready` synchronously).
- **The deadline's timer.** At most one deadline per attempt is alive, each for at most `connectTimeoutMs`, `unref`'d
  (`connectTimer.unref?.()`), so none keeps the process alive. It is main's stored timer, `connectTimer`, cleared in
  `onReady`, `onClose` and `close()` and at each arm, with the fire-time check kept (D-6724). Its closure holds the
  attempt's socket and the client, both already reachable while the attempt lives; until it is cleared a closed
  socket is held, at most 15 s longer. Nothing holds a request frame (the D-5513 row stays green).
- **Log volume.** An episode prints at most three opening lines and one recovery line: its opener (`lost`, `no-pong`,
  `never-ready` or `no-ready`), if a later attempt in it hangs, one `no-ready`, and, if the agent refuses a hello with
  a close code from 4400 to 4499, one `refused` (D-6527). `lost` and `no-pong` need a ready
  link and `never-ready` needs none since start, so no two of those share an episode. An ordinary agent restart,
  which every fleet update does, prints two: `lost (close …)` and `ready again, …`. A server restart whose first
  attempt is ready prints nothing. The incident's shape (a ready link lost, then attempts that hang for 65 minutes)
  prints three lines in all: `lost`, one `no ready within`, and `ready again`. A black hole that starts at a server
  restart prints two (`no ready within`, then `ready again`). Neither prints one line per attempt. A malformed agent
  URL prints one `never-ready` line (`socket not created`) and nothing after it (D-6526).
  (Amended on review 852.) The worst case has a measured rate. A peer that sends `ready` and then drops the socket at
  once logs two lines per flap, `lost` and `ready again`: about 120 a minute at the production defaults, which is
  about 171,000 a day if it flaps all day (review 852). Ruling 4 stands: that is evidence of a real fault. It stays
  far below journald's default per-service rate limit, so it costs journal space and nothing else.
- **Test-run stderr.** Suites that force a reconnect (`ws.terminate()` in remote-connect, remote-io and others) now
  print `lost` and `ready again` lines on stderr, and a suite whose first attempt fails (the bad-token row) prints a
  `never-ready` line. No suite asserts an empty `console.warn` across a client (update-inventory filters its spies by
  message), so this is noise, not a red.
- **Timing rows under load.** Every row waits for its outcome with `vi.waitFor` at a 5000 to 8000 ms timeout against
  an expected 150 to about 3300 ms (W27-L9's three 1000 ms deadlines plus backoff), and a deleted guard never
  produces the awaited outcome at all. Each dependence on load is named and cured, not assumed away:
  - **The 150 ms rows share one event loop with their peer** (W27-L1, L2, L12). A stall of 150 ms or more (GC, a
    starved box) lets the deadline fire before the poll phase completes the handshake, so an attempt can be aborted
    before its upgrade request is written. A review probe (`ws` 8.21.1, a 200 ms synchronous stall after
    `new WebSocket`) saw 1 accept, 0 upgrades and `readyState` CONNECTING at the deadline. Cure: none of these rows
    has an attempt meant to succeed; each asserts only `accepts() >= 2` and either the CONNECTING word (W27-L1, L2) or
    no upgrade on attempt 0 (W27-L12), both of which an early-aborted attempt also gives; and the peer chooses its
    mode by the TCP ACCEPT index, not the upgrade index, so an attempt aborted early still uses up its slot. W27-L12
    makes that very stall on purpose: a load stall only adds to it.
  - **A row whose green needs a healthy handshake inside the deadline runs at 1000 ms** (W27-L3, L4, L5, L9). In
    W27-L4 and W27-L9 the attempt meant to reach `ready` runs under the same deadline as the silent ones, and needs
    TCP accept, upgrade, 101, hello and `ready` on the one event loop it shares with its peer. At 150 ms a stall
    there would let the guarded deadline cut it; the next attempt would then be ready too, so the link connects, but
    with one more accept and one more failed attempt (`accepts()` 4, `4 attempts`), red with no guard deleted. Keying
    by accept does not help, because that extra attempt is a real fourth accept. At 1000 ms a stall of a whole second
    is needed; W27-L4 then takes about 2.1 s and W27-L9 about 3.2 s, inside their 8000 ms waits and vitest's 20 s
    `testTimeout`. The exact counts stay, so M8 and M11 still bite. W27-L3's word is the OPEN one, which a stalled
    first attempt would misname, and W27-L5's first handshake must reach `ready` within 1000 ms, or the guarded
    deadline cuts it and `accepts()` reads 2 with no guard deleted.
  - **W27-L5 and W27-L7 assert an ABSENCE over a window, and the deadline lies INSIDE each window on purpose**
    (1000 ms inside 2000 ms, 2000 ms inside 2600 ms): that is what makes M4, M4b and M7 red, and timers expire in
    order, so the mutant's red does not depend on load. Their greens do, as above.
  - **W27-L6's green does not depend on upgrade latency.** It accepts either pre-ready word for attempt 1 and refuses
    only `(closed)`, which only a stale deadline can print. It needs attempt 1 to exist before attempt 0's deadline
    (a 500 ms backoff against a 2000 ms deadline); if it does not, `this.socket` is null when the stale deadline fires
    and the guarded deadline is silent anyway.
  - **W27-L13 asserts after a fixed sleep, and its green does not depend on load.** The throw is synchronous inside
    `connectFleet`, so its one line is printed before the row's first `await`; the 500 ms sleep only gives the
    retries time to print a second line, which a working dedupe never does. Load means fewer retries, never a red.
- **Mixed builds.** None: server-only, wire unchanged. An older server keeps the old behaviour until its update.
- **The deadline and the backoff.** A pre-ready failure does not reset the backoff (only `onReady` does,
  client.ts:526), so after a long outage the retry interval is 30 s. That is intended and unchanged, and W27-L25
  pins that the deadline does not reset it either (D-6585).

## Mutation table

Each guard this wave adds or pins, the mutation that removes or weakens it, and the rows that go red. The worker
measures each one alone, once, at the end of the task named in the Guard column, with the rows as they stand then:
mutate, run `./node_modules/.bin/vitest run test/remote-liveness.test.ts --pool=forks --maxWorkers=1` from `server/`,
record the red rows, restore, and see green again. The as-built note records the worker's own measurement beside the
last column. That column is the planning probe's: this plan's Task 1 to 3 rows and client edits AS FIRST DRAFTED,
applied to a scratch extract of the base (since deleted), with each mutant run against ALL ten rows of that draft, so
a Task 2 mutant can red a Task 3 log row too. Restored, the ten rows were green every time. M7's red on W27-L10 came
through a closed client's leftover deadline printing into a later row's `console.warn` spy, which is the defect M7
introduces. Separately, at the base, deleting the heartbeat's terminate left 353 of 353 client-suite tests green, so
W27-L8 is the first row that sees M6. The review revision changed W27-L3, L5, L6, L8 and L10 and added W27-L11 and
M14 to M17, and the second revision moved W27-L4 and L9 to 1000 ms and added W27-L12, W27-L13, M4b and M18 to M20,
so the "Expected red" column is the plan's claim for the revised rows and the probe column is history:
where they differ, the worker's measurement decides, and a row that measures green against its expected red stops
the task (below).

Review 852's fix round re-measured M1 to M23 on the final 25 rows and measured M24 to M36 (As built). Where the
campaign measured otherwise than this table claimed, the Expected red column is corrected and says so (M3, M4, M21,
M25, M31). The probe column of M24 to M36 reads "measured in review 852's fix round". Review 860's fix round adds
M37 and M38, the window mutants (probe column "measured in review 860's fix round"). The fix round on main's #1160
(D-6724) respells M1, M3, M5, M18 and M35 to the landed names and adds M39 to M45, the clears, the two halves of the guard
and the `unref` behind the `close()` clear.

| # | Guard (task) | Mutation | Expected red (at least), at the task's end | Planning probe: mutant / restored |
|---|---|---|---|---|
| M1 | the deadline is armed per attempt (T2) | delete the `this.armConnectDeadline(ws)` call in `connect` | W27-L1, L2, L3, L4, L12 | probe: red L1, L2, L3, L4, L6, L9; restored 10/10 green |
| M2 | it is armed at socket creation, not at `open` (T2) | move the call into the `open` handler | W27-L1, L2, L4, L12 (L3 stays green) | probe: red L1, L2, L4, L9; restored 10/10 green |
| M3 | it is a wall clock, not an idle timer (T2) | delete the call and pass `{ handshakeTimeout: this.cfg.connectTimeoutMs }` to `new WebSocket` | W27-L2, L3, and (amended on review 852) L1 through Task 3's line assertion: the idle timer ends the silent upgrade, but as a `never-ready` boot line, not a `no ready within` line; L4 stays green | probe: red L1, L2, L3, L6, L9; restored 10/10 green |
| M4 | a ready link is left alone (T2) | delete `if (this.ready) return;` from the deadline (amended on review 852: from Task 3 the guard is M4b's `if (ws !== this.socket \|\| this.ready) return;`, this spelling has no anchor, and M4 is now the same edit as M4b) | W27-L5; (amended on main's #1160) green: equivalent under the `onReady` clear, M43 reds it (D-6725) | probe: red L5; restored 10/10 green |
| M4b | the same guard as Task 3 ships it (T3) | delete `\|\| this.ready` from the deadline's guard `if (ws !== this.socket \|\| this.ready) return;` | W27-L5 (a `no ready within 1000ms (ready not sent)` line and a second accept) | unmeasured: added in review |
| M5 | the seam reaches the deadline (T2) | the constructor sets `connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS`, ignoring `cfg` | W27-L1, L2, L3, L4, L12 (15 s is past each 5 to 8 s wait) | probe: red L1, L2, L3, L4, L6, L9; restored 10/10 green |
| M6 | the heartbeat ends a silent ready link (pinned, T1) | delete `this.socket?.terminate()` in the miss-limit branch | W27-L8 | probe: red L8; restored 10/10 green |
| M7 | a leftover deadline says nothing (T3) | delete `ws !== this.socket \|\|` from the deadline's guard | W27-L6, L7 (each prints a `(closed)` line); (amended on main's #1160) green: equivalent under the `onClose` and `close()` clears, M44 reds it (D-6725) | probe (first draft): red L6, L7, L10; restored 10/10 green |
| M8 | one line per kind per episode (T3) | delete the `ep.logged.has(kind)` return in `note` | W27-L9 | probe: red L9; restored 10/10 green |
| M9 | the recovery line (T3) | delete the `console.warn` in `onReady`'s episode close | W27-L8, L9, L10, L11 | probe (first draft): red L9, L10; restored 10/10 green |
| M10 | the phase is named only as far as `readyState` proves it (T3) | swap the CONNECTING and OPEN words in `preReadyPhase` | W27-L1, L2, L3, L9 (W27-L6 accepts either word) | probe (first draft): red L1, L2, L3, L6, L9; restored 10/10 green |
| M11 | failed attempts are counted (T3) | delete `ep.failedAttempts++` in `onClose` | W27-L9, L10, L11 (`0 attempts`) | probe (first draft): red L9; restored 10/10 green |
| M12 | a lost ready link is logged (T3) | delete the `this.note('lost', …)` call in `onClose` | W27-L10 | probe: red L10; restored 10/10 green |
| M13 | a heartbeat terminate is logged (T3) | delete the `this.note('no-pong', …)` call in `startHeartbeat` | W27-L8 (its first line reads `lost`) | probe: red L8; restored 10/10 green |
| M14 | `lost` only opens an episode, never follows `no-pong` (T3) | delete `if (!this.episode)` before the `lost` note in `onClose` | W27-L8 (its second line reads `lost (close 1006)`) | unmeasured: added in review |
| M15 | `ready` closes the episode, so the next stretch logs afresh (T3) | delete `this.episode = null;` in `onReady` | W27-L8 (its third line repeats `ready again`, the second `no pong` is suppressed) | unmeasured: added in review |
| M16 | the boot stretch is logged at its first failed attempt (T3) | in `onClose`, replace the two lines `const ep = this.episode ?? this.note('never-ready', …); ep.failedAttempts++;` with exactly `const ep = this.episode; if (ep) ep.failedAttempts++;` (never `ep?.failedAttempts++`, a SyntaxError that runs no row) | W27-L6, L11 (no `never-ready` line) | unmeasured: added in review |
| M17 | only the boot stretch prints `never-ready` (T3) | in `onClose`, replace `this.episode ?? this.note('never-ready', …)` with the bare `this.note('never-ready', …)` | W27-L9, L10 (an extra `never-ready` line) | unmeasured: added in review |
| M18 | the deadline is armed at socket creation, before the TCP connect completes (T2) | in `connect`, replace `this.armConnectDeadline(ws);` with `(ws as unknown as { _req: import('node:http').ClientRequest })._req.once('socket', (s) => s.once('connect', () => this.armConnectDeadline(ws)));` (`ws` keeps its request as `_req`, websocket.js `initAsClient`) | W27-L12 (attempt 0 writes its upgrade) | revision probe of the shape, not the row: armed on `connect`, the upgrade was written, 3 of 3 |
| M19 | a socket that cannot be created is logged (T3) | delete the `this.note('never-ready', …)` call in `connect`'s `catch` | W27-L13 (no line) | unmeasured: added in review |
| M20 | that line never prints the URL (T3) | in that call, print `err.message` in place of `err.name` | W27-L13 (the line reads `socket not created: Invalid URL: not-a-url`) | revision probe: `ws`'s message for `not-a-url` is `Invalid URL: not-a-url` |
| M21 | an agent refusal is logged once (T3) | delete the `this.note('refused', …)` call in `onClose` | W27-L14, L15 (D-6529), and (amended on review 852) every later row that expects a `refused` line, L16 to L23 | unmeasured: added by ruling 2 |
| M22 | that line prints a sanitised reason (T3) | print the raw reason, `reason.toString()`, with no cut or replacement | W27-L14, L15 (D-6529) | unmeasured: added by ruling 2 |
| M23 | a refusal reason that repeats the token is withheld (T3) | delete the token-window check in `refusalReason` | W27-L15 | unmeasured: added by D-6529 |
| M24 | the token check runs on the full reason, before the cut (T3) | in `refusalReason`, cut to 64 first and check that text: `const full = reason.toString('utf8').slice(0, 64);` | W27-L16 | measured in review 852's fix round |
| M25 | the window is 8 characters, not the whole token (T3) | replace the window loop with `if (full.includes(token)) return '[withheld: repeats the token]';` | W27-L17, and (amended on review 852) L20: `includes('')` is always true, so an empty token withholds every reason | measured in review 852's fix round |
| M26 | the window is capped by a short token's length (T3) | a fixed width of 8: drop the `Math.min(…, token.length)` | W27-L19 | measured in review 852's fix round |
| M27 | an empty token checks nothing (T3) | delete the `width > 0 &&` guard | W27-L20 | measured in review 852's fix round |
| M28 | the window is no narrower than 8 (T3) | `Math.min(4, token.length)` | W27-L18 | measured in review 852's fix round |
| M29 | the window is no wider than 8 (T3) | `Math.min(16, token.length)` | W27-L17 | measured in review 852's fix round |
| M30 | the check runs before the character replacement (T3) | run the check on the text after the printable-ASCII replacement and drop the later `.replace` | none: equivalent for a printable token (D-6529); measured green, 25 of 25 | measured in review 852's fix round |
| M31 | the refused line follows the boot line (T3) | move the `refused` note before the `never-ready` expression in `onClose`'s pre-ready arm | W27-L21, and (amended on review 852) the other boot-refusal rows, L16 to L20 and L22 | measured in review 852's fix round |
| M32 | the refused range has an upper bound (T3) | `code >= 4000` in place of `code >= 4400 && code <= 4499` | W27-L22 | measured in review 852's fix round |
| M33 | the refused range is more than the one code 4401 (T3) | `code === 4401` in place of the range | W27-L22 | measured in review 852's fix round |
| M34 | the closing phase has its own word (T3) | map CLOSING to `ready not sent` in `preReadyPhase` | W27-L23 | measured in review 852's fix round |
| M35 | the deadline's timer is `unref`'d (T2) | delete `this.connectTimer.unref?.();` in `armConnectDeadline` | W27-L24; (amended on main's #1160) green: `close()` clears the timer first, M45 reds it (D-6725) | measured in review 852's fix round |
| M36 | the deadline keeps the backoff (T2) | set `this.backoffMs = this.cfg.reconnectMinMs;` in the deadline callback, before `ws.terminate()` | W27-L25 | measured in review 852's fix round |
| M37 | the window is exactly 8, not 9 (T3; review 860) | `Math.min(9, token.length)` | W27-L17 | measured in review 860's fix round |
| M38 | the window is exactly 8, not 10 (T3; review 860) | `Math.min(10, token.length)` | W27-L17 | measured in review 860's fix round |
| M39 | the `onReady` clear (#1160) | delete `this.clearConnectDeadline();` in `onReady` | none alone (D-6725) | measured in the #1160 fix round |
| M40 | the `onClose` clear (#1160) | delete it in `onClose` | none alone (D-6725) | measured in the #1160 fix round |
| M41 | the `close()` clear (#1160) | delete it in `close()` | none alone (D-6725) | measured in the #1160 fix round |
| M42 | the clear at arm (#1160) | delete the `this.clearConnectDeadline();` at the top of `armConnectDeadline` | none alone (D-6725) | measured in the #1160 fix round |
| M43 | the ready half, both ways (D-6724) | M4 plus M39 | W27-L5, and main's C3 | measured in the #1160 fix round |
| M44 | the current-socket half, both ways (D-6724) | M7 plus M40 plus M41 | W27-L7 | measured in the #1160 fix round |
| M45 | the `unref`, behind the `close()` clear (D-6725) | M35 plus M41 | W27-L24 | measured in the #1160 fix round |

The deadline's choice to terminate its CAPTURED socket, not `this.socket`, has no row of its own (D-6517): before
Task 3 a stale deadline can reach only a closed socket, where `terminate` is a no-op, and from Task 3 the
current-socket check makes the two the same socket. If any row in the "Expected red" column measures green, stop and
report to the coordinator before weakening a row or a guard.

## Deviations found

Twenty numbers were issued to run 833: sixteen starting at D-6514 at run-open (D-6514 to D-6529), D-6585 and D-6586
for the review-852 fix round, and D-6724 and D-6725 for the fix round on main's #1160. Every one is defined below, in
order, and none is left in reserve:
- The plan defined the first fourteen, D-6514 to D-6527 (D-6527 by the coordinator's ruling on Reading 2).
- The build spent the last two of the first block as departures: D-6528 and D-6529.
- The fix round spent D-6585 as a departure, and gave D-6586, which no departure took, its own entry as an unspent
  number.
- The fix round on main's #1160 spent D-6724 on the absorb and D-6725 as a departure: three recorded red sets that
  the merged clears make unreachable.

Every entry is written `- **D-<n>** — <text>`, the form the server's one definition reader accepts
(`server/src/coord/ledger.ts#DEFINITION`: after the number it needs `**` and then an em-dash, `(` or `:`). The form
`- **D-<n>.**` that this plan first used is invisible to it, so the reconcile sweep would never mark the numbers
landed and `deviation-refs`' cross-tree check would see nothing to compare (Task 5 Step 3 measures it with the
reader itself).

- **D-6514** — The bound is ONE wall-clock deadline per attempt, from the socket's creation in `connect()` to the
  agent's `ready`, instead of the brief's `handshakeTimeout` plus a separate timer from `open` to `ready`. Why:
  - `handshakeTimeout` is an idle timer (websocket.js:767, via `http.request`'s `timeout`). A peer that writes a byte
    now and then holds it open; the planning probe measured a socket still CONNECTING after 2010 ms at
    `handshakeTimeout: 150`.
  - It stops at the upgrade (`socket.setTimeout(0)`, websocket.js:247), so the brief needed a second timer anyway.
  - One deadline covers all four phases (TCP connect, unanswered upgrade, trickled upgrade, unanswered hello) with one
    guard, so each mutation has one meaning. Two guards over one phase would make M1 and M3 ambiguous.
  - `handshakeTimeout` is not passed as well: once the deadline exists it would only end the same attempt sooner, and
    it would be a second guard with no row of its own. The phase evidence it would give comes from `readyState` at
    the deadline instead (D-6520).
- **D-6515** — The coordinator's reading is corrected on the phase: the hung socket never reached `open`. The 232 bytes
  were the HTTP upgrade request, and `hello` is sent only from the `open` handler (client.ts:364-366). So
  `handshakeTimeout` alone would have bounded THIS incident; the open-to-ready gap is real in the code but was not
  observed. The wave bounds both, by D-6514. The ledger's "listable again after 3926321ms" is the registry reader's
  log (`noteWholeFleetListing`), not the link's; the link logs nothing at the base.
- **D-6516** — `DEFAULT_READY_TIMEOUT_MS = 15_000`, exposed only as `readyTimeoutMs?` on `RemoteFleetConfig`, a test
  seam beside `heartbeatMs`. Why 15 s:
  - `ready` is the agent's answer to `hello`, and the client already waits 15 s for an answer to a request
    (`DEFAULT_REQUEST_TIMEOUT_MS`, client.ts:76). The link waits no longer for its own handshake than for any answer.
  - It is five times the agent's own hello bound (3 s), and a healthy agent answers in one round trip.
  - It is below the heartbeat's post-ready window (about 30 to 45 s), so a stuck attempt is cut no later than a dead
    ready link would be.
  - It cuts a TCP connect to a vanished box from the kernel's SYN-retry span (about 127 s at 6 retries) to 15 s.

  It is its own constant, not derived from `heartbeatMs` or `requestTimeoutMs`, so a row can shorten one without the
  other. No environment variable or config key is added and `index.ts` still passes only `url` and `token`, so wave 24's
  unification of operator tunables has nothing new to absorb.

  (Amended on main's #1160.) The wave first named them `DEFAULT_READY_TIMEOUT_MS` and `readyTimeoutMs`. Main's #1160
  landed the same value under `DEFAULT_CONNECT_TIMEOUT_MS = 15_000` and `connectTimeoutMs?`, and the absorb kept
  main's names (D-6724). The reasons above hold unchanged for the landed constant.
- **D-6517** — The deadline is a one-shot timer that is never cleared. When it fires it returns if its captured socket
  is ready (`this.ready`) and, from Task 3, if that socket is no longer current (`ws !== this.socket`); otherwise it
  terminates the CAPTURED socket. Why:
  - Clearing it in `onReady`, `onClose` and `close()` would be three more guards over the same facts its fire-time
    check already reads, and none could have a red row: with the check present, a missing clear changes nothing.
  - Terminating the captured socket, never `this.socket`, means a stale deadline can only touch a socket that is
    already CLOSED (a socket is replaced only after its `close`), where `terminate()` returns at once (websocket.js
    `terminate`). The current-socket check is therefore needed only once the deadline logs and counts (Task 3).
  - `this.closed` is not checked: `close()` nulls `this.socket` and terminates the socket itself, so a later fire
    fails the current-socket check.
  - (Amended on review 852) The timer is `unref`'d, so a deadline that has not fired never keeps the process alive;
    W27-L24 pins it (M35). The deadline never resets the backoff: only `onReady` does, so a run of timed-out
    attempts keeps growing the delay to its ceiling; W27-L25 pins it (M36).
  - (Amended on main's #1160.) The merged timer is main's stored `connectTimer`, cleared in `onReady`, `onClose`,
    `close()` and at each arm, so "never cleared" and the first bullet's argument are history. The fire-time check,
    the captured socket, the `unref` and the backoff rule stand. What the clears add is measured under D-6724.
- **D-6518** — No TCP keepalive. Why: `ws` never sets it and it can be set before connect only through a wrapped
  `createConnection` (websocket.js:752-753), a new seam; it detects only an idle half-open socket, after the idle time
  plus probes (Node sets the idle time only; interval and count stay the kernel's 75 s and 9, unmeasured on the
  deployed Node); and loopback cannot simulate a vanished peer without packet filtering, so no hermetic row can go red
  when it is deleted. The deadline bounds every pre-ready phase and the heartbeat bounds everything after.
- **D-6519** — The heartbeat is unchanged and still starts at `ready`. Why: before `open`, `ws.send` throws
  (CONNECTING, the incident's phase); before auth the agent closes any non-hello frame with 4401
  (agent/src/server.ts:1282-1287); and between `hello` and `ready` a pong could prove nothing that `ready` does not
  prove one round trip later. The deadline is the pre-ready liveness check.
- **D-6520** — The link logs, from `client.ts` (L4, which owns the socket and the timers and here states facts, not
  policy). An episode opens at the first opening line and closes at the next `ready`. Each opening kind is printed at
  most once per episode; later fires of the same kind are counted, not printed. (Amended on review 852.) The list
  is complete with six kinds of line: the five `LinkLine` kinds (`lost`, `no-pong`, `never-ready`, `no-ready` and
  `refused`), then the recovery line. `refused` never opens an episode: it follows the line that did. The lines are
  exactly:
  - `ccrc-server: agent link: lost (close <code>); reconnecting`: a ready link's socket closed, printed only when it
    opens the episode (so not after a `no-pong` line; row W27-L8, M14);
  - `ccrc-server: agent link: no pong to <limit> heartbeats <ms>ms apart; terminating the socket and reconnecting`;
  - `ccrc-server: agent link: no ready since the server started (close <code>); retrying`: an attempt closed before
    `ready` while no episode is open, which happens only before the first `ready` since start, because every later
    loss of a ready link opens an episode first (row W27-L11, M16 and M17); when `new WebSocket` itself throws, the
    same kind prints `(socket not created: <error name>)` in place of `(close <code>)` (D-6526, row W27-L13). (Amended
    on review 852.) This boot line prints only when an attempt closes, or its socket cannot be created, before the
    first `ready` since the server started (amended on review 860) and no other line has
    opened the stretch: row W27-L9 shows a stretch opened by `no ready within` with no boot line;
  - `ccrc-server: agent link: no ready within <ms>ms (<phase>); terminating this attempt and retrying`, where
    `<phase>` is `connect or upgrade unanswered` for CONNECTING, `ready not sent` for OPEN, `closing` for CLOSING and
    `closed` for CLOSED;
  - `ccrc-server: agent link: agent refused the hello (close <code> <reason>); retrying` (D-6527, listed here on
    review 852): an attempt closed before `ready` with a close code from 4400 to 4499. `<reason>` is the peer's close
    reason after `refusalReason` (D-6529): `[withheld: repeats the token]` when it repeats the token, otherwise
    printable ASCII only, cut to 64 characters, and `-` when empty. In the boot stretch it follows the `never-ready`
    line; after a lost ready link it follows `lost`; after a timed-out attempt it follows `no ready within`;
  - `ccrc-server: agent link: ready again, <ms>ms after this stretch's first line (<n> attempts ended without a
    ready)`, on the `ready` that closes an episode.

  The phase word says only what `readyState` can prove. In `ws`, CONNECTING is set in the constructor
  (websocket.js:67) and left only in `setSocket` after a validated 101 (websocket.js:257), so it spans the TCP
  connect, the upgrade write and the wait for the 101; nothing moves it when the connect completes. The word
  therefore names both (`connect or upgrade unanswered`): a black-holed box and an unanswered upgrade print the same
  line, and the one the incident turned on (232 bytes sent and acked) is still read from the socket table, not the
  log. Telling them apart needs a fact the client does not own today (Reading 8). The four words are four states;
  they are not four failures.

  The duration is measured from the stretch's FIRST LINE, and says so. It leaves out what came before that line: the
  heartbeat's detection window for a `no-pong` stretch (up to `heartbeatMs × (HEARTBEAT_MISS_LIMIT + 1)`, about
  45 s) and the deadline itself for a stretch opened by `no-ready`. `state.downSince` would not do better: `markDown`
  sets it in the `onClose` that follows the opening line, never earlier, so it is the same instant or one tick later,
  and choosing it would be a choice no row can tell apart.

  The episode is a private field, never on `FleetState` (whose shape is pinned) and never on the wire. The URL, the
  token and frames are never printed. Why: the 65 minutes were silent because the link logs nothing at all; the
  registry reader's episode logger (`noteWholeFleetListing`) is the house shape for "one line on entry, one on exit",
  and the boot line keeps that true for a stretch that starts at a server restart and is made only of refusals
  (Reading 9).
- **D-6521** — The wave adds a row for the existing heartbeat terminate (W27-L8), which no test pins at the base
  (planning probe: deleting it left 353 of 353 client-suite tests green). Why: the deadline hands every post-ready
  case to the heartbeat, so the wave's bound rests on it, and mutation-table discipline asks for a red row.
- **D-6522** — `onClose` gains the close code (`ws.on('close', (code) => this.onClose(ws, code))`). Why: the code is
  the one fact that tells an agent restart (1001 or 1006) from a refusal.
  - (Amended on review 852) `onClose` reads the close code and the reason (`ws.on('close', (code, reason) =>
    this.onClose(ws, code, reason))`, D-6527). The code feeds the `lost`, `never-ready` and `refused` lines. The reason
    feeds only `refused`, through `refusalReason` (D-6529).
  - The first draft left a 4401 refusal after a lost ready link counted and not printed. That is withdrawn: the
    `refused` line prints it, once per stretch.
- **D-6523** — README gains one bullet in "Degraded mode"; the box-token lifecycle spec's "reconnects forever, 1 s
  doubling to 30 s, logging nothing" (2026-10-07-box-token-lifecycle-design.html:366) is left as dated HTML history,
  which stays as it is until revised. Its first two clauses remain true.
- **D-6524** — The rows go in a new file, `server/test/remote-liveness.test.ts`, not in `remote-connect.test.ts`. Why:
  a new test file is selected on a pull request by CI rule 1 (`.github/ci/select-tests.mjs`), the rows need peers of
  their own that no existing describe uses, and `remote-connect.test.ts` (1024 lines) keeps its pins untouched.
  `remoteHelpers.ts` changes by one comment (the stale "default fast", D-6521's finding) and stays otherwise as is;
  the rows reuse its `connectToAgent` (the peer never checks a token).
- **D-6525** — The rows' peer is one `node:http` server with a `noServer` `WebSocketServer`, whose behaviour is chosen
  per attempt by a function of the attempt's TCP ACCEPT index, recorded on `'connection'` and read on `'upgrade'`.
  Why: one port can then be silent for the first N attempts and healthy after, which is the incident's recovery shape
  (W27-L4) and the only way to see a recovery line (W27-L9); the accept count is read at the same listener; and
  keying by accept, not by upgrade, keeps an attempt that a stalled loop aborts before its request is written in its
  own slot (Risk notes). A raw `net` server could not hand a later attempt to a real WebSocket handshake.
- **D-6526** — An attempt whose socket cannot even be created is logged, by the boot line. Why: `connect()`'s `catch`
  (a synchronous throw from `new WebSocket`, client.ts:356-362) goes straight to `markDown` and `scheduleReconnect`
  and never reaches `onClose`, so at the base, and in this plan before this entry, a malformed agent URL retries at a
  backoff growing to 30 s forever and logs nothing at either end: the 65-minute silence on a path the wave's goal did
  not reach. Nothing validates the URL first: `agentUrl: env.CCRC_AGENT_URL ?? null` (server/src/config.ts:470), and
  the composition root checks only that it is set (server/src/index.ts:149-153). `ws` 8.21.1 throws `SyntaxError`
  there for an unparsable URL, a protocol other than ws, wss, http, https or ws+unix, or a fragment
  (websocket.js `initAsClient`, measured by the revision probe). The `catch` now first calls
  `this.note('never-ready', 'no ready since the server started (socket not created: <error name>); retrying')`:
  - it prints the error's NAME, never its message, because for an unparsable URL `ws`'s message is
    `Invalid URL: <the url>` and the URL is never printed (row W27-L13, M20);
  - it is the `never-ready` kind, so it prints once per episode like the `(close <code>)` form, and its wording is
    true: the throw depends only on the URL, fixed for the process, so no `ready` has happened or can;
  - it counts no failed attempt, for the same reason: no `ready` can follow, so no recovery line could carry the
    count, and a count no row can see would be a guard with no red (M19 is the line's row).

  The review offered listing the path under "Not in this wave" instead, as the 4401 refusal is. It is folded in
  because it is three lines in the one function already being edited, and unlike the refusal it would otherwise
  leave a path with no line at all.

- **D-6527** (the coordinator's ruling on Reading 2) — An attempt the agent refuses is logged, once per episode.
  - When an attempt closes before `ready` with a close code from 4400 to 4499 (the agent's refusal range: it sends 4401
    for both `unauthorized` and `hello-timeout`), `onClose` calls
    `this.note('refused', 'agent refused the hello (close <code> <reason>); retrying')`.
  - The reason is the peer's close reason, read as untrusted. It is decoded as UTF-8, cut to 64 bytes, and every
    character outside printable ASCII is replaced by `?`. An empty reason prints `-`. The line never prints the URL,
    the token or a frame.
  - `refused` is its own kind. In the boot stretch the `never-ready` line and one `refused` line can both print; after
    a lost ready link, `lost` and then one `refused`.
  - `onClose` reads the reason as well as the code (`ws.on('close', (code, reason) => …)`), which widens D-6522.
  - Why: after a ready link is lost, a box token that no longer matches (a rotation, or a hand edit) makes every
    attempt close 4401. Before this entry the journal would show one `lost` line and then nothing, forever, on a path
    the box-token lifecycle work makes ordinary.
  - Row W27-L14 (Task 3): a ready link is lost, then the peer closes each hello with 4401 for at least three attempts,
    with a reason of 120 bytes that carries a control character. The log has exactly one line containing `refused`
    and `close 4401`, its reason is the 64-byte printable form, and no line contains the token.
  - Mutants: M21 deletes the `refused` note (W27-L14 red); M22 prints the raw reason, with no cut or replacement
    (W27-L14 red) (and D-6529: W27-L15, M23).
  - (Amended on review 852) Rows W27-L21 (order), W27-L22 (range) and W27-L23 (phase) pin the claims W27-L14 did not:
    - W27-L21: a boot-time 4401 on attempts 0 to 2, then ready on attempt 3, logs the boot line, one `refused` line,
      then `ready again` with 3 attempts;
    - W27-L22: 4399, 4400, 4499 and 4500 each close every hello; the `refused` line prints for 4400 and 4499 only;
    - W27-L23: a raw 4401 close frame, with the peer's TCP side never ended, leaves the client's socket CLOSING; the
      deadline's line names the phase `closing`, and the `refused` line follows it.
  - Mutants M31 to M34: M31 moves the `refused` note before the `never-ready` expression (W27-L21 and the other
    boot-refusal rows); M32 reads `code >= 4000` (W27-L22); M33 reads `code === 4401` (W27-L22); M34 maps CLOSING to
    `ready not sent` (W27-L23).
  - (Amended on review 852) W27-L14's "no line contains the token" assertion cannot fail through `refusalReason`: its
    reason holds no fragment of the token. W27-L15 to W27-L20 are the rows that guard the token window.

- **D-6528** (the worker, Task 2) — W27-L12 as drafted failed with no mutant applied, three of three whole-file runs,
  and passed alone. Its premise, that expired timers run before the poll phase that completes the TCP connect, holds
  only when the row's body starts outside libuv's timers phase. After a row that ends on a timer callback (W27-L1 or
  W27-L7, measured pairwise), the body starts inside the timers phase, the loop goes on to poll, attempt 0 writes its
  upgrade, and only the next timers phase fires the deadline (`expected true to be false` at `upgraded(0)`). The row
  now awaits one `setImmediate` before `connectToAgent`, so the next phase after the held loop is timers. Its
  assertions are unchanged and M18 still reds it alone (1 failed, 7 passed); unmutated the file ran 8 of 8 green,
  three of three, at a load average of 50 to 98. Reported in the wave-done under ruling 12: the row was not
  weakened, its starting phase was fixed.
- **D-6529** (the worker, Task 3 review) — The `refused` line printed a peer-chosen close reason after a character
  replacement and a cut to 64, which a reason that echoes the client's own hello frame
  (`{"t":"hello","token":"…"}`, all printable ASCII) survives: the box token would reach the journal, against
  D-6527's own sentence that the line never prints the token. `refusalReason(reason, token)` replaces
  `printableReason`: when the full decoded reason contains any 8 consecutive characters of the token (all of it, when
  the token is shorter than 8; no check for an empty token), the line prints `[withheld: repeats the token]` in
  place of the reason. Eight characters, because a shorter window matches ordinary words in an ordinary reason and
  withholds it for nothing, and a longer one lets a partial echo through. The check runs on the full decoded text,
  before the replacement and the cut, because the cut would otherwise hide a token that starts past the 64th
  character, and the replacement could split one. A peer that deliberately breaks the token up already holds it, so
  the check covers the accidental echo only. W27-L15 (a peer that echoes the hello as the close reason) and M23
  (the check deleted) pin it.

  (Amended on review 852.) Rows W27-L16 to W27-L20 pin the window's properties, and mutants M24 to M30 try to break
  them:
  - W27-L16: the check runs on the full text: 58 `x` and then the token, so only 6 token characters lie inside the
    cut (M24: the check on the cut text);
  - W27-L17: exactly 8 consecutive token characters withhold the reason (M25: `includes(token)`; M29: a window of 16;
    amended on review 860: M37, a window of 9, and M38, a window of 10);
  - W27-L18: 7 consecutive token characters are printed, so the window is 8 and no narrower (M28: a window of 4);
  - W27-L19: a token shorter than the window, `abc`, withholds a reason that holds all of it (M26: a fixed width of
    8);
  - W27-L20: an empty token checks nothing and the reason is printed (M27: the `width > 0` guard deleted; M25 too,
    because `includes('')` is always true).

  M30 (the check run after the printable-ASCII replacement) is equivalent for a printable token, so no row can red it.
  The replacement is one-for-one on characters and leaves a printable one as it is, so a window of printable
  characters occurs in the replaced text exactly where it occurs in the full text. A window that holds a `?` could
  also match a replaced character, which errs toward withholding; no row's token has one.

  The coordinator's ruling on review 852's F7 (no code change): the link's token is the agent token the operator types
  at install, with only a non-empty check. So a token of four characters or fewer can withhold a fixed reason such as
  `unauthorized`. This errs toward not printing, and it stands (W27-L19 pins the short-token rule).
- **D-6585** (the worker, review 852 fix round) — W27-L25 asserts the time from just before the connect to the fifth
  accept against 950 ms, not the fourth gap against the minimum, which the ruling's example suggested. Why:
  - a gap subtracts the earlier accept's time, which load delays, so a stall shortens it;
  - libuv arms timers from its cached loop time, so a timer armed after a stall inside one loop iteration fires early,
    and the exact timer sum (about 1150 ms) is not a safe floor either. The 950 ms floor is that sum less slack.

  The mutant that resets the backoff in the deadline callback (M36) measured 613 to 629 ms for the same quantity, far
  below the floor.

  (Amended on review 860.) The reviewer's reason for keeping the departure: under M36 every gap is about 150 ms (the
  deadline of 100 ms plus a reset backoff of 50 ms), so the ruling's example form, "the fourth gap at least twice the
  minimum", stays green and would not catch the flattened backoff. The sum-to-the-fifth-accept form reds it.
- **D-6586** — `unused` (run 833): issued to this wave's review-852 fix round; no departure took it.
- **D-6724** (the worker, main's #1160 fix round) — The absorb of main's #1160 (3dada7dc9), which bounds the same
  span, socket creation to `ready`, at the same 15 s. One deadline survives: main's span, with this wave's journal
  line.
  - Kept from main, because they are on main and its four rows in `remote-connect.test.ts` use them: the field
    `RemoteFleetConfig.connectTimeoutMs`, the constant `DEFAULT_CONNECT_TIMEOUT_MS`, the stored timer
    `connectTimer`, and the private methods `armConnectDeadline` and `clearConnectDeadline`. The ruling left the
    private names to the worker; main's are kept so that the field, the constant and the methods share one word,
    and main's rows and comments need no edit.
  - Removed from this wave: `readyTimeoutMs`, `DEFAULT_READY_TIMEOUT_MS`, and `armReadyDeadline` with its local
    one-shot timer.
  - Kept from this wave: the expiry still writes the `no ready within` line through `note`; the guard is the same
    two facts (`ws !== this.socket || this.ready`); the deadline never resets the backoff. Every journal and
    refusal-line rule of this wave is unchanged. The 25 rows of `remote-liveness.test.ts` and `remoteHelpers.ts`
    take the renamed field and nothing else, and main's four rows are byte-identical.
  - Against D-6517, the timer is now cleared in `onReady`, `onClose`, `close()` and at each arm.
    Measured on the merged code (As built): each clear repeats a fact the fire-time check already reads, and each
    half of the check repeats a clear, so no single one of them has a red row; only the pairs red. That is D-6725.
- **D-6725** (the worker, main's #1160 fix round) — Three red sets recorded before the absorb no longer hold on the
  merged code, and the rows were not changed: the ruling says the 25 rows take the renamed field and nothing else.
  Main's clears and this wave's fire-time check now cover the same facts twice. D-6517 said that with the check
  present a missing clear changes nothing; the converse now holds too.
  - M4 (delete `|| this.ready`) and M39 (delete the `onReady` clear) are each green. Together (M43) they red W27-L5
    and main's C3 ("never fires once ready arrived in time").
  - M7 (delete `ws !== this.socket ||`), M40 and M41 (delete the `onClose` and `close()` clears) are each green.
    Together (M44) they red W27-L7 only: W27-L6 stays green because the next attempt's arm clears the old timer
    first (the clear M42 deletes), and C4 stays green because `close()` nulls `this.socket`.
  - M35 (delete `this.connectTimer.unref?.()`) is green. W27-L24's child calls `close()`, which now clears the timer,
    so the `unref` no longer decides whether the child exits. With the `close()` clear also deleted (M45) W27-L24
    reds. On the merged code the timer lives only while its socket is current and not closed, and that socket's own
    handle holds the event loop for the same span, so no row can red the `unref` alone.
  - M42 (delete the clear at each arm) is green: `onClose` has already cleared the previous attempt's timer before
    the next `connect`.
  - W27-L24's comment still says "the deadline is never cleared, so only `unref` lets the child exit", which is no
    longer true. It is left as it is, under the same ruling, for the coordinator to rule.

Any reserve number still undefined at wave-done is defined in this section before the wave-done fingerprint, in the
house form for an issued number no departure took (as `delegation-broker-wave3-observe.md` writes its run 740
numbers): the number, an em-dash, `` `unused` (run 833): issued to this wave; no departure took it.`` Then the
reconcile sweep marks it landed like the rest. Nothing returns a number to the allocator, so a number left undefined
anywhere would surface after 7 days in the server's stale-allocation warning ("never landed in a plan"), reported and
never reclaimed.

## File structure

- `server/src/remote/client.ts`:
  - Task 2: `DEFAULT_CONNECT_TIMEOUT_MS`, `RemoteFleetConfig.connectTimeoutMs`, the constructor line, the arm
    call in `connect`, `armConnectDeadline` and `clearConnectDeadline`, and the field's doc comment (as landed on
    main's #1160 and merged, D-6724).
  - Task 3: `LinkLine`, `LinkEpisode`, `preReadyPhase`, the `episode` field, `note`, the current-socket half of the
    deadline's guard and its line, the `close` listener's code, `onClose`'s bookkeeping, `startHeartbeat`'s note,
    `onReady`'s recovery line, the `note` call in `connect`'s `catch` (D-6526), the `refused` note in `onClose`
    and `refusalReason` (D-6527, D-6529), the module header comment.
- `server/test/remote-liveness.test.ts` (new): Task 1 creates it with the peer harness and W27-L8; Task 2 adds W27-L1
  to W27-L5, W27-L7 and W27-L12; Task 3 adds W27-L6, W27-L9, W27-L10, W27-L11, W27-L13, W27-L14, W27-L15, the log
  assertions of L1, L2, L3 and L7, W27-L8's two-episode extension, and the `connectFleet` import. Review 852's fix
  round adds W27-L16 to W27-L25 and the harness they need.
- `server/test/remoteHelpers.ts`: Task 1, the comment above `connectToAgent`.
- `README.md`: Task 4, one bullet.

## Tasks

Every row runs on real timers against an in-process loopback peer, and never against a real agent. Every red and
green below is the worker's to measure; the planning probe's figures are named where they exist.

### Task 1: the peer harness, and the heartbeat's missing row (W27-a; D-6521, D-6524, D-6525)

**Files:**
- Create: `server/test/remote-liveness.test.ts`.
- Modify: `server/test/remoteHelpers.ts` (the comment above `connectToAgent`, :36-38).

**Interfaces:**
- Produces, inside the test file (not exported): `type PeerMode`, `interface LinkPeer` (with `upgraded(attempt)`, whether
  that accept's upgrade request arrived), `linkPeer(modeOf)` (`modeOf` takes the attempt's TCP accept index, from 0),
  `sleep`, `linkLines(warn)`.

- [ ] **Step 1: Write the harness.** Create the file with this header and harness, exactly:

  ```ts
  // Wave 27 (D-6514 to D-6526): the link to the fleet agent cannot wait forever before `ready`.
  // Every row runs on real timers against an in-process loopback peer (`linkPeer`), never a real agent: a node:http
  // server whose upgrade handling is chosen per attempt, so one port can be silent first and healthy later.
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { createServer, type IncomingMessage } from 'node:http';
  import type { Socket } from 'node:net';
  import type { Duplex } from 'node:stream';
  import { WebSocketServer } from 'ws';
  import type { ConnectedFleet } from '../src/remote/client.js';
  import { connectToAgent } from './remoteHelpers.js';

  type PeerMode =
    | 'silent-upgrade'   // accept TCP, read the upgrade request, never answer
    | 'trickle-upgrade'  // answer with a partial 101 status line, then one byte every 50 ms, never finishing
    | 'refuse'           // destroy the socket as soon as the upgrade request arrives
    | 'silent-hello'     // complete the upgrade, read hello, never send ready
    | 'ready'            // answer hello with ready and every ping with pong
    | 'ready-no-pong'    // answer hello with ready, never answer a ping
    | 'ready-then-drop'; // answer hello with ready, then terminate the socket 100 ms later

  interface LinkPeer {
    port: number;
    accepts(): number; // TCP connections the listener accepted
    hellos(): number;  // hello frames received
    upgraded(attempt: number): boolean; // whether that accept's upgrade request arrived, whatever the mode
    close(): Promise<void>;
  }

  async function linkPeer(modeOf: (attempt: number) => PeerMode): Promise<LinkPeer> {
    const sockets = new Set<Socket>();
    const intervals = new Set<NodeJS.Timeout>();
    // The attempt number is the TCP accept index, not the upgrade index: an attempt the client aborts before it
    // writes its upgrade request (a stalled loop lets the deadline win) still uses up its slot.
    const attemptOf = new Map<Duplex, number>();
    let accepted = 0;
    let hellos = 0;
    const upgradedAttempts = new Set<number>();
    const wss = new WebSocketServer({ noServer: true });
    const http = createServer();
    http.on('connection', (s: Socket) => {
      attemptOf.set(s, accepted++);
      sockets.add(s);
      s.on('error', () => undefined);
      s.on('close', () => { sockets.delete(s); attemptOf.delete(s); });
    });
    http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      socket.on('error', () => undefined);
      const attempt = attemptOf.get(socket);
      if (attempt === undefined) { socket.destroy(); return; } // never: node:http upgrades the accepted socket
      upgradedAttempts.add(attempt);
      const mode = modeOf(attempt);
      if (mode === 'silent-upgrade') return;
      if (mode === 'refuse') { socket.destroy(); return; }
      if (mode === 'trickle-upgrade') {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nX-Pad: ');
        const t = setInterval(() => { if (!socket.destroyed) socket.write('a'); }, 50);
        intervals.add(t);
        socket.on('close', () => { clearInterval(t); intervals.delete(t); });
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as { t?: unknown };
          if (msg.t === 'hello') {
            hellos++;
            if (mode === 'silent-hello') return;
            ws.send(JSON.stringify({ t: 'ready', v: 1 }));
            if (mode === 'ready-then-drop') setTimeout(() => ws.terminate(), 100);
          } else if (msg.t === 'ping' && mode !== 'ready-no-pong') {
            ws.send(JSON.stringify({ t: 'pong' }));
          }
        });
      });
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
    const address = http.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    return {
      port,
      accepts: () => accepted,
      hellos: () => hellos,
      upgraded: (attempt) => upgradedAttempts.has(attempt),
      close: () => new Promise<void>((resolve) => {
        for (const t of intervals) clearInterval(t);
        for (const s of sockets) s.destroy();
        wss.close();
        http.close(() => resolve());
      }),
    };
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /** The link's own log lines, in order, from a `console.warn` spy. */
  const linkLines = (warn: { mock: { calls: unknown[][] } }): string[] =>
    warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server: agent link: '));

  describe('W27: the link to the fleet agent cannot wait forever before ready (D-6514 to D-6526)', () => {
    let peer: LinkPeer | undefined;
    let fleet: ConnectedFleet | undefined;

    afterEach(async () => {
      await fleet?.close();
      fleet = undefined;
      await peer?.close();
      peer = undefined;
      vi.restoreAllMocks();
    });
  });
  ```

- [ ] **Step 2: Write the heartbeat row,** inside the describe:

  ```ts
  it('W27-L8: a ready link that misses two pongs is terminated and retried', async () => {
    peer = await linkPeer(() => 'ready-no-pong');
    fleet = connectToAgent(peer.port, { heartbeatMs: 50 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
  });
  ```

- [ ] **Step 3: Measure it against the base guard, red first.** In `server/src/remote/client.ts`, delete
  `this.socket?.terminate(); // -> 'close' -> reconnect` in `startHeartbeat`'s miss-limit branch, then run
  `timeout -s INT 560 ./node_modules/.bin/vitest run test/remote-liveness.test.ts --pool=forks --maxWorkers=1` from
  `server/`. Expected: W27-L8 fails (one accept, the `waitFor` times out). Restore with
  `git checkout -- src/remote/client.ts`, run it again: green. Record both in the as-built note (M6).
- [ ] **Step 4: The stale comment.** In `server/test/remoteHelpers.ts`, replace the three comment lines above
  `connectToAgent` with exactly:

  ```ts
  /** `reconnectMinMs`/`reconnectMaxMs` default fast, so a reconnect row is quick; `heartbeatMs` defaults SLOW
   *  (60 s), so no row sees a heartbeat miss it did not ask for. Pass `heartbeatMs` down to test the heartbeat
   *  (remote-liveness.test.ts's W27-L8) and `readyTimeoutMs` to test the deadline before ready. */
  ```

- [ ] **Step 5: Run** `remote-liveness` whole (green), then `typecheck-tests` and `citations`.
- [ ] **Step 6: Commit.**
  `test(remote): pin the heartbeat's terminate with a loopback peer (wave 27, D-6521, D-6524, D-6525)`.

### Task 2: one deadline from socket to ready (W27-b; D-6514, D-6516, D-6517)

> Since main's #1160 was absorbed (D-6724), the field is `connectTimeoutMs`, the constant
> `DEFAULT_CONNECT_TIMEOUT_MS` and the method `armConnectDeadline`, on a stored timer cleared in `onReady`, `onClose`
> and `close()`; the code below is this task as built before that.

**Files:**
- Modify: `server/src/remote/client.ts`: `RemoteFleetConfig` (:37-48), the constants block (:73-77), the private fields
  (:171-181), the constructor (:189-199), `connect` (:353-372), and new `armReadyDeadline` after `stopHeartbeat`.
- Test: `server/test/remote-liveness.test.ts`.

**Interfaces:**
- Produces: `RemoteFleetConfig.readyTimeoutMs?: number` (default `DEFAULT_READY_TIMEOUT_MS = 15_000`), and the private
  method `armReadyDeadline(ws: WebSocket): void`.

- [ ] **Step 1: Write the failing rows,** inside the describe:

  ```ts
  it('W27-L1: an upgrade never answered is dropped at the deadline and retried', async () => {
    peer = await linkPeer(() => 'silent-upgrade');
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 150 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(fleet.state.connected).toBe(false);
  });

  it('W27-L2: an upgrade answered a byte at a time is dropped too (a wall clock, not idle)', async () => {
    peer = await linkPeer(() => 'trickle-upgrade');
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 150 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
  });

  it('W27-L3: a hello never answered with ready is dropped at the deadline and retried', async () => {
    // 1000 ms, not 150: this row's line names the OPEN phase, so the first attempt must have upgraded by then.
    peer = await linkPeer(() => 'silent-hello');
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 1000 });
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 8000 });
    expect(peer.hellos()).toBeGreaterThanOrEqual(1);
  });

  it('W27-L4: once the peer answers, the next attempt reaches ready', async () => {
    // 1000 ms, not 150: the attempt meant to reach ready runs under the same deadline, and must not be cut.
    peer = await linkPeer((n) => (n < 2 ? 'silent-upgrade' : 'ready'));
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 1000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 8000 });
    expect(peer.accepts()).toBe(3);
  });

  it('W27-L5: a ready inside the deadline holds: the deadline never cuts a ready link', async () => {
    peer = await linkPeer(() => 'ready');
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 1000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 5000 });
    await sleep(2000); // the deadline lies inside this window on purpose: M4 fires it here
    expect(peer.accepts()).toBe(1);
    expect(fleet.state.connected).toBe(true);
  });

  it('W27-L7: close() during the upgrade settles, retries nothing and logs nothing', async () => {
    peer = await linkPeer(() => 'silent-upgrade');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 2000 });
    await vi.waitFor(() => expect(peer!.accepts()).toBe(1), { timeout: 5000 });
    await fleet.close();
    fleet = undefined;
    await sleep(2600);
    expect(peer.accepts()).toBe(1);
    expect(linkLines(warn)).toEqual([]);
  });

  it('W27-L12: the deadline runs from socket creation, before the TCP connect completes', async () => {
    // A loop held past the deadline right after the socket is created: expired timers run before the poll phase
    // that completes the TCP connect and writes the upgrade, so attempt 0 ends with no upgrade request sent.
    // A deadline armed at TCP connect or later would let attempt 0 write its upgrade first.
    peer = await linkPeer(() => 'silent-upgrade');
    fleet = connectToAgent(peer.port, { readyTimeoutMs: 150 });
    const held = Date.now();
    while (Date.now() - held < 300) { /* hold the event loop past the deadline */ }
    await vi.waitFor(() => expect(peer!.accepts()).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    expect(peer.upgraded(0)).toBe(false); // M18 is what proves `upgraded` can read true
  });
  ```

  W27-L12 as landed also awaits one `setImmediate` before `connectToAgent` (D-6528).

  `connectToAgent`'s `extra` is `Partial<RemoteFleetConfig>`, so `readyTimeoutMs` is a type error until Step 3 adds
  the field. vitest strips types without checking them, so the rows still run and fail at runtime; `typecheck-tests`
  is the run that sees the type error, and it goes green with Step 3.
- [ ] **Step 2: Run them red,** from `server/`:

  ```
  timeout -s INT 560 ./node_modules/.bin/vitest run test/remote-liveness.test.ts --pool=forks --maxWorkers=1
  ```

  Expected: W27-L1, L2, L3, L4 and L12 fail (one accept, never ready, each `waitFor` timing out). W27-L5, L7 and L8
  pass: L5 and L7 are the anchors this task must keep green.
- [ ] **Step 3: Implement.**
  - In `RemoteFleetConfig`, after `heartbeatMs`:

    ```ts
    /** ms from a new socket's creation to the agent's `ready` before that attempt is terminated and retried: one wall
     *  clock over TCP connect, the upgrade and the hello (wave 27, D-6514). Default 15000. A test seam like the
     *  fields around it; the composition root passes only `url` and `token`. */
    readyTimeoutMs?: number;
    ```

  - After `DEFAULT_REQUEST_TIMEOUT_MS`: `const DEFAULT_READY_TIMEOUT_MS = 15_000;` with the comment
    `// The answer to hello waits no longer than the answer to a request (D-6516).`
  - In the constructor, after `heartbeatMs`: `readyTimeoutMs: cfg.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,`.
  - In `connect`, right after `this.socket = ws;`: `this.armReadyDeadline(ws);`.
  - After `stopHeartbeat`:

    ```ts
    /** One wall-clock bound per attempt, from socket creation to `ready` (wave 27, D-6514). Never cleared: it re-checks
     *  when it fires (D-6517). A ready link is left alone; otherwise the CAPTURED socket is terminated, never
     *  `this.socket`, so a deadline outliving its attempt can only reach a socket already closed, where `terminate`
     *  returns at once. `terminate` on CONNECTING aborts the handshake and on OPEN destroys the socket; either way
     *  `close` follows and `onClose` reconnects with the existing backoff. */
    private armReadyDeadline(ws: WebSocket): void {
      const timer = setTimeout(() => {
        if (this.ready) return;
        ws.terminate();
      }, this.cfg.readyTimeoutMs);
      timer.unref?.();
    }
    ```

- [ ] **Step 4: Run them green**, then run `remote-connect`, `remote-io`, `remote-pty`, `remote-runner`,
  `remote-tail` and `fleet-identity-client` whole, one at a time. All green unchanged. Run `citations` and
  `typecheck-tests`.
- [ ] **Step 5: Commit** (before the mutations, so HEAD holds the deadline and every restore restores it).
  `fix(remote): one deadline from socket to ready bounds the handshake (wave 27, D-6514, D-6516, D-6517)`.
- [ ] **Step 6: Mutation rows** M1 to M5 and M18, each alone, each restored to HEAD (Global Constraints, the Mutation
  table). Confirm `git diff --quiet HEAD -- src/remote/client.ts` after the last; the as-built note records the reds.

### Task 3: the link says what it does (W27-c; D-6517, D-6520, D-6522, D-6526, D-6527, D-6529)

> Since main's #1160 was absorbed (D-6724), the field is `connectTimeoutMs`, the constant
> `DEFAULT_CONNECT_TIMEOUT_MS` and the method `armConnectDeadline`, on a stored timer cleared in `onReady`, `onClose`
> and `close()`; the code below is this task as built before that.

**Files:**
- Modify: `server/src/remote/client.ts`: the module types after `PtyListener` (:71), `preReadyPhase` and
  `refusalReason` after `isRecord` (:79), the private fields, `connect`'s `catch` (:358-362) and `close` listener
  (:368, passing code and reason), `onReady` (after `this.setState(…)`, :527), `onClose` (:532-553, with its `reason`
  parameter and its `refused` note), `startHeartbeat` (:600-602), `armReadyDeadline`, and new `note`.
- Test: `server/test/remote-liveness.test.ts`.

**Interfaces:**
- Produces: `type LinkLine = 'lost' | 'no-pong' | 'never-ready' | 'no-ready' | 'refused'`;
  `interface LinkEpisode { since: number; logged: Set<LinkLine>; failedAttempts: number }`;
  `function preReadyPhase(readyState: number): string`;
  `function refusalReason(reason: Buffer, token: string): string`;
  the private field `episode: LinkEpisode | null` (null means no stretch without a ready link is open; it is private
  state, never a seam);
  the private method `note(kind: LinkLine, text: string): LinkEpisode` (it returns the open episode, so a caller never
  reads `this.episode` back through a non-null assertion);
  `onClose(ws: WebSocket, code: number, reason: Buffer)`.

- [ ] **Step 1: Write the failing rows.**
  - Add the expected lines after `linkLines`, exactly (D-6520's texts):

    ```ts
    const NO_READY = (ms: number, phase: string): string =>
      `ccrc-server: agent link: no ready within ${ms}ms (${phase}); terminating this attempt and retrying`;
    const NO_PONG = (ms: number): string =>
      `ccrc-server: agent link: no pong to 2 heartbeats ${ms}ms apart; terminating the socket and reconnecting`;
    const LOST = (code: number): string => `ccrc-server: agent link: lost (close ${code}); reconnecting`;
    const NEVER_READY = (code: number): string =>
      `ccrc-server: agent link: no ready since the server started (close ${code}); retrying`;
    const READY_AFTER = (failed: number): RegExp => new RegExp('^ccrc-server: agent link: ready again, \\d+ms after '
      + `this stretch's first line \\(${failed} attempts ended without a ready\\)$`);
    const NOT_CREATED = (name: string): string =>
      `ccrc-server: agent link: no ready since the server started (socket not created: ${name}); retrying`;
    const REFUSED = (code: number, reason: string): string =>
      `ccrc-server: agent link: agent refused the hello (close ${code} ${reason}); retrying`;
    ```

  - Change the header's client import to `import { connectFleet, type ConnectedFleet } from '../src/remote/client.js';`
    (W27-L13 calls `connectFleet` itself, with a URL `connectToAgent` cannot build).

  - Extend W27-L1, L2, L3 and L8 by spying first
    (`const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);` before `connectToAgent`) and adding,
    after the existing `waitFor`:
    - W27-L1 and W27-L2: `expect(linkLines(warn)[0]).toBe(NO_READY(150, 'connect or upgrade unanswered'));`
    - W27-L3: `expect(linkLines(warn)[0]).toBe(NO_READY(1000, 'ready not sent'));`
    - W27-L8, two episodes, so the episode's open and close are both pinned (M14, M15): the peer reconnects into the
      same `ready-no-pong` mode, so a second stretch follows within about 200 ms.

      ```ts
      await vi.waitFor(() => {
        expect(peer!.accepts()).toBeGreaterThanOrEqual(3);
        expect(linkLines(warn).length).toBeGreaterThanOrEqual(3);
      }, { timeout: 5000 });
      expect(linkLines(warn).slice(0, 3)).toEqual([NO_PONG(50), expect.stringMatching(READY_AFTER(0)), NO_PONG(50)]);
      ```
  - W27-L7 already asserts `linkLines(warn)` is empty.
  - Add:

    ```ts
    it('W27-L6: a deadline left over from a replaced attempt speaks for nothing current', async () => {
      // Attempt 0 is refused at once (the boot line); attempt 1 starts about 500 ms later and never gets ready.
      // Attempt 0's deadline fires at about 2000 ms, while attempt 1 is current and not ready: it must stay silent,
      // so the next line is attempt 1's own, at about 2500 ms. Either pre-ready word passes, so the green does not
      // depend on how fast attempt 1 upgrades; only a stale deadline can print `(closed)`.
      peer = await linkPeer((n) => (n === 0 ? 'refuse' : 'silent-hello'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fleet = connectToAgent(peer.port, { readyTimeoutMs: 2000, reconnectMinMs: 500, reconnectMaxMs: 500 });
      await vi.waitFor(() => expect(linkLines(warn).length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
      expect(linkLines(warn)[0]).toBe(NEVER_READY(1006));
      expect(linkLines(warn)[1]).toMatch(new RegExp('^ccrc-server: agent link: no ready within 2000ms '
        + '\\((connect or upgrade unanswered|ready not sent)\\); terminating this attempt and retrying$'));
    });

    it('W27-L9: one no-ready line per stretch, naming its phase, and one recovery line with a count', async () => {
      // 1000 ms, not 150: the attempt meant to reach ready runs under the same deadline, and must not be cut.
      peer = await linkPeer((n) => (n < 3 ? 'silent-upgrade' : 'ready'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fleet = connectToAgent(peer.port, { readyTimeoutMs: 1000 });
      await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 8000 });
      expect(linkLines(warn)).toEqual([
        NO_READY(1000, 'connect or upgrade unanswered'), expect.stringMatching(READY_AFTER(3)),
      ]);
    });

    it('W27-L10: a ready link that drops logs lost with its close code, then ready again', async () => {
      // Attempt 1 is refused: counted inside the open episode, and never a boot line, because a link was ready.
      peer = await linkPeer((n) => (n === 0 ? 'ready-then-drop' : n === 1 ? 'refuse' : 'ready'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fleet = connectToAgent(peer.port);
      await vi.waitFor(() => {
        expect(peer!.accepts()).toBeGreaterThanOrEqual(3);
        expect(fleet!.state.connected).toBe(true);
        expect(linkLines(warn)).toHaveLength(2);
      }, { timeout: 5000 });
      expect(linkLines(warn)).toEqual([LOST(1006), expect.stringMatching(READY_AFTER(1))]);
    });

    it('W27-L11: a stretch with no ready since start is logged at its first failed attempt and at its first ready',
      async () => {
        peer = await linkPeer((n) => (n < 2 ? 'refuse' : 'ready'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        fleet = connectToAgent(peer.port);
        await vi.waitFor(() => {
          expect(fleet!.state.connected).toBe(true);
          expect(linkLines(warn)).toHaveLength(2);
        }, { timeout: 5000 });
        expect(linkLines(warn)).toEqual([NEVER_READY(1006), expect.stringMatching(READY_AFTER(2))]);
      });

    it('W27-L13: an attempt whose socket cannot be created prints the boot line once, naming the error, not the URL',
      async () => {
        // `new WebSocket` throws synchronously for this URL, so the line is printed inside `connectFleet`; the sleep
        // gives the retries (30 ms backoff, growing to 100 ms) time to print a second line, which they must not.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        fleet = connectFleet({
          url: 'not-a-url', token: 'unused', reconnectMinMs: 30, reconnectMaxMs: 100, heartbeatMs: 60_000,
        });
        await sleep(500);
        expect(linkLines(warn)).toEqual([NOT_CREATED('SyntaxError')]);
        expect(fleet.state.connected).toBe(false);
      });
    ```

  - Rows W27-L14 to W27-L25 follow, by name only; their code is in `server/test/remote-liveness.test.ts`, not pasted
    here. Ruling 2 added W27-L14, D-6529 added W27-L15, and review 852's fix round added W27-L16 to W27-L25 with the
    harness they need (the `close-hello` and `echo-hello` peer modes, `acceptTimes()`, `rawClosePeer`, `refusalLines`):
    - W27-L14: an agent that refuses each hello is logged once, with a printable reason;
    - W27-L15: a refusal reason that repeats the token is withheld, never printed;
    - W27-L16: the token check runs on the full reason, before the 64-character cut;
    - W27-L17: 8 token characters in a row are enough to withhold the reason;
    - W27-L18: 7 token characters in a row are printed (the window is 8);
    - W27-L19: a token shorter than the window withholds a reason that holds all of it;
    - W27-L20: an empty token checks nothing, so the reason is printed;
    - W27-L21: a boot-time refusal logs the boot line, one refused line, then ready;
    - W27-L22: the refused range is 4400 to 4499: 4399 and 4500 print the boot line only;
    - W27-L23: a close frame with the TCP side never ended logs (closing), then the refused line;
    - W27-L24: the deadline timer never keeps the process alive;
    - W27-L25: the deadline keeps the backoff growing: five attempts take at least the timers they wait on.

- [ ] **Step 2: Run them red.** Expected: every line assertion fails (no line at all), W27-L13 included. W27-L7, W27-L12
  and the black-box halves stay green.
- [ ] **Step 3: Implement.**
  - After `type PtyListener …`:

    ```ts
    /** The kinds of line a stretch without a ready link prints, each at most once per stretch; all but `refused` can
     *  open one (wave 27, D-6520, D-6527). */
    type LinkLine = 'lost' | 'no-pong' | 'never-ready' | 'no-ready' | 'refused';
    /** One stretch without a ready link that has printed a line: when it opened, which kinds it printed, and how many
     *  attempts ended without a ready since. Private to the client; never on `state`, never on the wire. */
    interface LinkEpisode { since: number; logged: Set<LinkLine>; failedAttempts: number }
    ```

  - After `isRecord`:

    ```ts
    /** The phase a pre-ready attempt is in, named only as far as the socket's own `readyState` proves it (D-6520):
     *  `ws` holds CONNECTING from the constructor until a validated 101, across the TCP connect and the upgrade. */
    function preReadyPhase(readyState: number): string {
      if (readyState === WebSocket.CONNECTING) return 'connect or upgrade unanswered';
      if (readyState === WebSocket.OPEN) return 'ready not sent';
      if (readyState === WebSocket.CLOSING) return 'closing';
      return 'closed';
    }

    /** A peer's close reason, read as untrusted (D-6527, D-6529). A peer that echoes the hello must not put the token in
     *  the journal, so a reason repeating any 8 consecutive characters of it (all of a shorter token) is withheld; one
     *  that breaks the token up on purpose already holds it, so this covers the accidental echo. The check runs on the
     *  full decoded text. Otherwise: every character outside printable ASCII becomes `?`, cut to 64; empty prints `-`. */
    function refusalReason(reason: Buffer, token: string): string {
      const full = reason.toString('utf8');
      const width = Math.min(8, token.length);
      for (let i = 0; width > 0 && i + width <= token.length; i++) {
        if (full.includes(token.slice(i, i + width))) return '[withheld: repeats the token]';
      }
      const text = full.replace(/[^\x20-\x7e]/g, '?').slice(0, 64);
      return text === '' ? '-' : text;
    }
    ```

  - Field, after `missedPongs`: `private episode: LinkEpisode | null = null;`.
  - `note`, after `armReadyDeadline`:

    ```ts
    /** One `ccrc-server: agent link:` line per kind per episode; opens the episode if none is open, and returns it
     *  (D-6520). */
    private note(kind: LinkLine, text: string): LinkEpisode {
      const ep = this.episode ?? (this.episode = { since: Date.now(), logged: new Set(), failedAttempts: 0 });
      if (ep.logged.has(kind)) return ep;
      ep.logged.add(kind);
      console.warn(`ccrc-server: agent link: ${text}`);
      return ep;
    }
    ```

  - `armReadyDeadline`'s callback becomes:

    ```ts
    if (ws !== this.socket || this.ready) return;
    this.note('no-ready', `no ready within ${this.cfg.readyTimeoutMs}ms (${preReadyPhase(ws.readyState)}); `
      + 'terminating this attempt and retrying');
    ws.terminate();
    ```

    and its doc comment gains: `A deadline whose attempt is no longer current says nothing: its line and count belong
    to the current attempt.`
  - `connect`: `ws.on('close', (code, reason) => this.onClose(ws, code, reason));`, and its `catch` becomes (D-6526):

    ```ts
    } catch (err) {
      // A throw here depends only on the URL, so no `ready` can follow: the boot line, once, naming the error and
      // never its message, which for an unparsable URL carries the URL (D-6526).
      this.note('never-ready', 'no ready since the server started (socket not created: '
        + `${err instanceof Error ? err.name : 'a non-Error throw'}); retrying`);
      this.markDown();
      this.scheduleReconnect();
      return;
    }
    ```
  - `onClose(ws: WebSocket, code: number, reason: Buffer)`: after the stale-socket guard,
    `const wasReady = this.ready;`. After
    `this.markDown();` and before `if (this.closed) return;`:

    ```ts
    if (wasReady) {
      if (!this.episode) this.note('lost', `lost (close ${code}); reconnecting`);
    } else {
      // No episode is open here only before the first `ready` since start: every later loss of a ready link has
      // opened one (D-6520).
      const ep = this.episode
        ?? this.note('never-ready', `no ready since the server started (close ${code}); retrying`);
      ep.failedAttempts++;
      if (code >= 4400 && code <= 4499) {
        this.note('refused', `agent refused the hello (close ${code} ${refusalReason(reason, this.cfg.token)}); retrying`);
      }
    }
    ```

  - `startHeartbeat`'s miss-limit branch, before the terminate:

    ```ts
    this.note('no-pong', `no pong to ${HEARTBEAT_MISS_LIMIT} heartbeats ${this.cfg.heartbeatMs}ms apart; `
      + 'terminating the socket and reconnecting');
    ```

  - `onReady`, right after `this.setState({ connected: true, downSince: null });`:

    ```ts
    const ep = this.episode;
    this.episode = null;
    if (ep) {
      console.warn(`ccrc-server: agent link: ready again, ${Date.now() - ep.since}ms after this stretch's first line `
        + `(${ep.failedAttempts} attempts ended without a ready)`);
    }
    ```

  - The module header (:25-31): "wrapped in reconnect-with-backoff + heartbeat" becomes "wrapped in a deadline from
    socket to ready, reconnect-with-backoff and a heartbeat, and logging one line per kind per stretch without a ready
    link". The class doc (:150-159) gains "a deadline that ends an attempt with no ready," before "a heartbeat".
- [ ] **Step 4: Run them green**, then the six remote suites of Task 2 Step 4 again, plus `fleet-identity-composition`
  and `update-inventory`, one at a time. Run `citations`, `typecheck-tests` and `single-definition`.
- [ ] **Step 5: Commit** (before the mutations, as in Task 2).
  `feat(remote): the agent link logs its drops, its deadline and its recovery (wave 27, D-6517, D-6520, D-6522,
  D-6526)`.
- [ ] **Step 6: Mutation rows** M4b, M5, M7 to M17, M19 to M23, each alone, each restored to HEAD (the Mutation
  table). Confirm `git diff --quiet HEAD -- src/remote/client.ts` after the last. Review 852's fix round adds M24 to
  M36 and re-measures every mutant on the final 25 rows (As built).

### Task 4: README says what the link now does (W27-d; D-6523)

**Files:**
- Modify: `README.md`, after the bullet that starts "When the agent connection drops" (:3428-3431), in "Degraded mode".

- [ ] **Step 1: Take the Group B claim** (Global Constraints): only under run 774's scoped consent to claim 2259, or
  after that claim has ended. Re-read the claims first; record which in the as-built note.
- [ ] **Step 2: Insert this bullet,** exactly, after that bullet:

  ```md
  - The server bounds every attempt to reach the agent. An attempt with no `ready` within a fixed deadline of its
    socket being created (a connect or an upgrade never answered, a hello never answered) is terminated and retried
    after a delay that grows on each failure and resets once a link is ready, and a ready link that stops answering
    the server's periodic ping is terminated and retried the same way. The server's log says so, once per kind per
    stretch without a link, each line starting `ccrc-server: agent link:`: when a ready link is lost (or, in its
    place, when an unanswered ping ends it), when an attempt times out (with the deadline, and whether the attempt was
    still connecting or upgrading or had sent its hello), when an attempt closes, or its socket cannot be created,
    before the first ready since the server started and no other line has opened the stretch, when the agent refuses
    the hello (with its close code and a printable cut of its reason, withheld if it repeats the token), and when
    the link is ready again, with the time since that stretch's first line. None of these values is an operator
    setting.
  ```

  This is the landed text. It departs from the first draft by the refusal clause (D-6527) and by review 852's F1
  and F2: the backoff and the ping said in words, and when the boot line prints. Review 860's F2 added "or its socket
  cannot be created" to the boot-line clause (amended on review 860).

  The bullet states no number on purpose. The deadline, the heartbeat interval, the miss limit and the backoff are
  module-private constants in `client.ts`, and no row ties README prose to them (the house pins README values only
  through parity rows, as `stall-settings-readme.test.ts` does); the `no ready within <ms>ms` and `no pong to …`
  lines print the live values into the journal, which is where an operator reads them.

- [ ] **Step 3: Run** `docs-parity`, `topology-clean`, `private-names`, `readme-holds` and `pools-prose`, one at a time.
- [ ] **Step 4: Commit.** `docs(readme): the agent link's bounds and its log lines (wave 27, D-6523)`.

### Task 5: The gate and the PR

- [ ] **Step 1: Landing tip.** Run `git fetch origin main`, merge it (after the first push; rebase before it), and
  re-read every anchor named above in the landed text.
- [ ] **Step 2: Touched suites, one file at a time, behind the memory gate,** whole, in `server/`:
  `remote-liveness`, `remote-connect`, `remote-io`, `remote-pty`, `remote-runner`, `remote-tail`,
  `fleet-identity-client`, `fleet-identity-composition`, `update-inventory`, `caps-refresh`, `secret-mask`.
  **Unmeasured, and so listed:** every other suite that `client.ts` selects (CI rule 3 selects about 228 tests). Push,
  read the PR's `select tests` summary, confirm it lists `remote-liveness` and the remote suites, and leave the rest
  to CI.
- [ ] **Step 3: Repo guards.**
  - `citations`, `docs-parity`, `single-definition`, `topology-clean`, `private-names`, `dtbd`, `typecheck-tests`.
  - `GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts`. None of this wave's files is a growth
    file; run it to confirm.
  - After `git fetch origin main`, run `deviation-refs`. Then measure the definitions with the server's OWN reader,
    not a grep that may accept a form the reader rejects. From `server/` this prints `20 20` and the twenty
    issued numbers in order, D-6514 to D-6529, then D-6585 and D-6586, then D-6724 and D-6725 (every one is defined,
    and none is in reserve; see Deviations found):

    ```
    ./node_modules/.bin/tsx -e "import { readFileSync } from 'node:fs';
    import { definitionsIn } from './src/coord/ledger.ts';
    const path = '../docs/superpowers/plans/2026-10-22-centralised-update-w27-agent-link-handshake.md';
    const ns = definitionsIn([{ path, text: readFileSync(path, 'utf8') }]).map((d) => d.n)
      .filter((n) => n >= 6514 && n <= 6529 || n === 6585 || n === 6586 || n === 6724 || n === 6725);
    console.log(ns.length, new Set(ns).size, ns.join(' '));"
    ```

    At planning time, with the first form, this printed `0 0`; with the entries rewritten it printed `12 12` for
    D-6514 to D-6525, and with D-6526 added it prints `13 13` for D-6514 to D-6526 (measured at this revision). With
    D-6527 to D-6529 defined it printed `16 16`, with D-6585 and D-6586 it printed `18 18`, and with D-6724 and D-6725
    it prints `20 20`. Check too that none of
    the twenty is defined on `origin/main` (the same reader over `git show origin/main:<plan>` for
    any plan `deviation-refs` names).
- [ ] **Step 4: The wave-done fingerprint.** The `suite:` line follows worker clause 15: `green` or `red` from the FIRST
  full suite run after the implementation was complete, `unrun` when no full run happened locally. The per-file runs
  of Steps 2 and 3 are listed in the as-built note, not folded into the word.
- [ ] **Step 5: The PR body.**
  - The incident in one paragraph (an upgrade never answered, no bound, no log, 65 minutes), with D-6515's correction.
  - The bound (D-6514, D-6516, D-6517): one wall clock per attempt, 15 s, main's stored timer cleared in `onReady`,
    `onClose` and `close()` with the fire-time check kept (D-6724), acting on its own socket, and the recovery bound
    (deadline plus one backoff, at most 45 s) against 65 minutes.
  - The rejected options and why: `handshakeTimeout` (D-6514), TCP keepalive (D-6518), an earlier heartbeat (D-6519).
  - The six kinds of log line verbatim, and the boot line's `socket not created` form (D-6520, D-6526); that an
    ordinary
    agent restart now prints two, the incident's shape (a ready link lost, then hung attempts) three, and a black hole
    from a server restart two (Risk notes, "Log volume").
  - The heartbeat's first row (D-6521) and the measured mutation table.
  - That no operator setting, wire field, `FleetState` field or agent change is added.
  - The function list of Global Constraints, `refusalReason`, `onClose`'s `reason` parameter and its `refused` note
    included.
  - The PR body ends with the attribution line this session's reminder gives.

## Readings (for the coordinator to rule; each chosen where no ruling decided it)

1. **The deadline's value.** Chosen: 15 s, its own constant, equal to the request timeout (D-6516). The alternatives:
   10 s (twice the agent's hello bound plus headroom; a stuck attempt ends 5 s sooner, and a stalled agent is cut
   sooner too), or `heartbeatMs × (HEARTBEAT_MISS_LIMIT + 1)`, 45 s, matching the post-ready window (no new constant,
   but a row can no longer shorten the deadline without shortening the heartbeat). Recommendation: 15 s.
2. **The agent's 4401 refusal is still mostly silent.** A wrong token or a hello timeout retries forever. Before the
   first `ready` since start, the `never-ready` line prints it once with its code (`close 4401`); after a ready link
   has been lost, it is counted inside the episode, not printed, and the reason string is never read. The options:
   leave the rest to a follow-up (chosen, D-6522); or add an opening kind, `refused (close 4401 <reason>)`, printed
   once per episode, in this wave (about six lines and one row against a peer that closes 4401 on hello).
   Recommendation: a follow-up, because it is a configuration defect with its own remedy; it is cheap enough to fold
   in if the coordinator would rather not open one.
3. **Where the deadline's logic lives.** Chosen: in `client.ts`, beside the heartbeat's miss limit, which already makes
   the same class of transport-liveness choice there. The alternative moves `preReadyPhase` and the episode rule into
   an L1 file that imports nothing, read by the client. Recommendation: keep it in `client.ts`; the phase word is a
   rendering of a fact, and an L1 file for four lines would add a ring edge and a file to every scan for no decision.
4. **The recovery line on every ordinary reconnect.** Chosen: yes, so each agent restart (every fleet update) prints
   `lost` and `ready again`. The alternative prints the recovery line only when the episode included a `no-ready` or
   `no-pong` line. Recommendation: every reconnect; two lines per agent restart is the evidence the 65 minutes lacked,
   and it dates every link drop in the server's journal.
5. **The "no line since 20:03:30" in the ledger.** The registry arithmetic puts that logger's entry line near
   20:02:52, and the ledger saw a last line at 20:03:30. Which line that was is not recorded and cannot be read from
   the tree; it changes nothing in this plan. Recommendation: none needed; note it as unexplained if the ledger
   revisits the incident.
6. **What closed the socket at 21:08:18.** Not visible from the code: nothing in the client, `ws` or Node would time it
   out, and every byte was acked. Options: leave it unexplained (chosen), or measure the path between the boxes on
   the next reboot. Recommendation: leave it; after this wave the client ends such a socket itself within 15 s.
7. **Rollout timing.** This is a server-only change that rides `ccrc update`. Whether to move the server box as soon
   as it is released, or with the next ordinary update, is the coordinator's and the operator's call; nothing in the
   tree depends on it. Recommendation: with the next ordinary update; the wedge needs a fleet-box reboot during a
   reconnect to recur.
8. **Telling a hung TCP connect from an unanswered upgrade.** Chosen: one word, `connect or upgrade unanswered`,
   because `readyState` cannot tell them apart (D-6520). The alternative records the net socket's `connect` per
   attempt through a caller's `createConnection` (`ws` keeps it, websocket.js:752-753), printing `connect unanswered`
   before it and `upgrade unanswered` after. It costs a new seam that must re-create `ws`'s own `netConnect` and
   `tlsConnect` choice by URL scheme, and its `connect unanswered` arm can have no hermetic red row: a loopback port
   that accepts no TCP refuses at once, and Node has no listener that leaves SYNs unanswered, so the mutant "always
   `upgrade unanswered`" would survive every row. The same seam is the only door to TCP keepalive (D-6518), so the two
   would come together. Recommendation: one word in this wave; a follow-up only if a later incident needs the split
   from the journal, where the socket table (`ss` on the server box) already gives it.
9. **The boot stretch.** Chosen: an attempt that closes before the first `ready` since start, with no episode open,
   prints `no ready since the server started (close <code>); retrying` and opens the episode, so the first `ready`
   prints the recovery line (W27-L11). Without it, a server restart (every `ccrc update` of the server box does one)
   into an agent that refuses for an hour would log nothing at either end, the 65-minute silence in another form.
   The alternative states in D-6520 and README that such a stretch is unlogged, with a row pinning the silence.
   Recommendation: the line. It costs one line at a boot whose first attempt fails, and none at an ordinary boot.
10. **README under claim 2259.** Chosen: the coordinator asks run 774 now for consent scoped to the one bullet, and
    the worker takes Group B under it (Global Constraints). The alternative, if consent has not come when Tasks 1 to
    3 are done: land Tasks 1 to 3 and Task 5 as this wave's PR, so the client fix does not wait on prose, and carry
    Task 4 as a one-bullet follow-up once claim 2259 ends (its hard expiry is 2026-10-23 05:10Z). Recommendation: ask
    now; split rather than hold a finished fix behind a README claim.
11. **The socket that cannot be created.** Chosen: fold it into this wave as the boot line's `socket not created`
    form, printed once, error name only, no count (D-6526, W27-L13). The alternative lists it under "Not in this wave"
    beside the 4401 refusal. Recommendation: fold it in; it is three lines in a function this wave already edits, and
    without it a malformed agent URL is the one attempt path that still logs nothing at all.
12. **W27-L12 rests on the event loop's phase order.** It holds the loop 300 ms past a 150 ms deadline and relies on
    expired timers running before the poll phase that completes the TCP connect (revision probe, 3 of 3, and the
    earlier review probe). Chosen: keep the row, because it is the only red M18 has and load only deepens the stall
    it makes. The alternative drops it and records "armed at creation rather than at TCP connect" as a named gap.
    Recommendation: keep it; if it ever reds without a mutant, that is a change in Node's loop worth knowing about,
    and the row's comment says so. As measured in Task 2, it did red unmutated in whole-file runs, from the row's
    starting phase, not from a change in Node's loop; D-6528 fixes the phase.

## Coordinator rulings on this plan's readings (2026-10-22)

The coordinator read the plan whole and rules as follows. Where a ruling changes a count, a row list or a section,
the worker updates every place the plan states it, in the first task that touches it.

1. **The deadline: 15 s**, its own constant, as chosen.
2. **The refusal is folded in, as D-6527**, not left to a follow-up. The "Not in this wave" bullet on logging the
   agent's refusal is superseded by it; the rest of that bullet (the close code read for `lost` and `never-ready`)
   stands. Task 3 gains W27-L14 and mutants M21 and M22. Its row count becomes 14, wherever the plan says 13.
3. **The logic stays in `client.ts`**, as chosen.
4. **The recovery line prints on every reconnect**, as chosen.
5. **The ledger's 20:03:30** stays unexplained. It changes nothing here.
6. **What closed the socket at 21:08:18** stays unexplained, as chosen.
7. **Rollout:** with the next ordinary update, through the console like any other. Nothing in this wave asks for a
   move of its own.
8. **One phase word**, `connect or upgrade unanswered`, as chosen. No follow-up is opened for the split.
9. **The boot line stays**, as chosen.
10. **README:** the coordinator asked run 774's coordinator for consent on 2026-10-22 (mail 8312), scoped to the one
    bullet after "When the agent connection drops". At the base that bullet starts at README.md:3427, not :3428:
    place by content. The worker takes Group B only under a CONSENT reply that the coordinator forwards, or after
    claim 2259 ends. If neither has come when Tasks 1 to 3 are done, split as Reading 10 says. Land Tasks 1 to 3 and
    Task 5 as this wave's PR, say so in the wave-done, and leave Task 4 to a one-bullet follow-up.
11. **The socket that cannot be created is folded in** (D-6526), as chosen.
12. **W27-L12 stays**, as chosen. If it ever reds with no mutant applied, report it in the wave-done; do not weaken
    the row to make it green.

## Coordinator rulings on review 852 (2026-10-23)

Recorded verbatim from the coordinator's fix-round mail. Two paths are written as names: the report's as "the review's report", as the ruling asks, and the reviewer's scratch rows by that name, because both paths name fleet sessions and this repository is public.

Run 833, wave 27: fix round 1, ruled on review 852 (the review's report; read it whole). Record this verbatim in the plan as "Coordinator rulings on review 852 (2026-10-23)", and write the report's path as "the review's report".

The review found no defect in the deadline or the episode bookkeeping. Every as-built mutant reds for the reason its row states. Both of your departures stand: D-6528 was measured green in 17 runs in every order, and red under M18, M18b, M18c and M18d in every order. D-6529 does what its text says. CI's repo-owned legs are green, remote-liveness was selected, and merge-tree is clean. What is missing is rows for properties the deviations argue, two README lines, and stale plan text.

Deviations: amend D-6517, D-6520, D-6522, D-6527 and D-6529 in place where this round changes what they say, each marked "amended on review 852". D-6585 and D-6586 are your reserve for this round, issued for it, spent in order. Before wave-done, give each unspent one its own entry in the house form.

The reviewer's scratch rows were copied out for the worker (the reviewer's scratchpad goes with its workspace). Take what fits into remote-liveness.test.ts as W27-L16 upward, in this file's style and with its harness. Do not ship the scratch file itself.

1. F3, D-6529's properties (important). Rows for:
- the check runs on the full reason before the cut: 58 bytes, then the token (P1b);
- the 8-character window: 10 token characters are withheld (P2a), and 7 are printed (P2b);
- a short token: all of a token shorter than the window withholds (P4);
- an empty token: the reason prints (P6).
Measure red under the review's mutants: the check on the cut text, `includes(token)`, a fixed width of 8, the `width > 0` guard deleted, and widths 4 and 16. A mutant your rows cannot red, say so with its reason.
2. F4, D-6527's ordering, range and phase (important). Rows O1 (a boot-time 4401 on attempts 0 to 2, then ready on 3: the boot line, one refused line, then ready), O2 (codes 4399, 4400, 4499 and 4500: the refused line only for 4400 to 4499) and O3 (a raw 4401 close frame with TCP never ended: `(closing)`, then the refused line). Measure red under MC, MD, ME and MF.
3. F5, the timer's unref: a row that reds when `timer.unref?.()` is deleted. Prefer behaviour: a child process that connects with a long readyTimeoutMs, calls close() at once, and must exit within a bound far below the deadline.
4. F6, the deadline keeps the backoff: a row against a silent listener with a short readyTimeoutMs and a small reconnect range, asserting the gaps grow. Assert a lower bound only (for example, the fourth gap at least twice the minimum), since load only lengthens gaps. Mutation: reset backoffMs in the deadline callback.
5. F7, short tokens: no code change. The agent token is typed by the operator with only a non-empty check, so D-6529's text says a token of four characters or fewer can withhold a fixed reason such as `unauthorized`, and that this errs toward not printing.
6. F8: drop "no token" from W27-L14's title, or make its assertion able to fail. F9: fix LinkLine's comment, since `refused` never opens an episode.
7. README, inside the consented bullet only, still stating no number:
- F1: the boot line prints when an attempt closes before the first ready and no other line has opened the stretch. Match W27-L9.
- F2: say what "the usual backoff" is in words: a delay that grows on each failure and resets on each ready. Drop "the heartbeat", or say in words what it is.
8. The plan's stale text, F10 to F16: Review Focus lists L14 to the last row, the refusal line and the token window. The Deviations preamble reads sixteen, with no reserve left. Task 5's reader count reads `16 16`. "Six log lines" with D-6520's list complete. Task 3's body matches ruling 2. Task 4's exact text matches the landed bullet, with the departure recorded there. The Global Constraints function list. D-6522 and "Not in this wave" match the refused line.
9. The mutation record, F17 to F20: re-measure every mutant recorded against 14 rows on the final row count. Say that M4 is now the same edit as M4b. Correct the As built commit list: the setImmediate shipped with the row in Task 2's commit. Say that M1, M2 and M5 red L12 only through its waitFor.
10. The rate, (c): ruling 4 stands. A peer that sends ready and drops at once logs two lines per flap, about 120 a minute. That is evidence of a real fault, and it stays far below journald's default per-service rate limit, so it costs journal space and nothing else. Write the measured rate into the plan's Risk notes, so the next reader does not rediscover it.

Mutation runs: on a scratch copy only. Around each vitest call, in a subshell: `n=$(ps -L -u "$(id -u)" --no-headers | wc -l); ulimit -u $((n + 1500)); timeout -k 10 600 ./node_modules/.bin/vitest run ...`. Restore byte-identical (cmp) after each, and say how each mutant ended.

Gates as before, one file at a time: remote-liveness (whole file three times, the new rows alone), remote-connect, remote-io, remote-pty, remote-runner, remote-tail, fleet-identity-client, fleet-identity-composition, update-inventory, caps-refresh, citations, docs-parity, readme-holds, pools-prose, single-definition, topology-clean, private-names, dtbd, deviation-refs (after `git fetch origin main`), typecheck-tests, and growth-check with GROWTH_CHECK=1. Measure every new row red, then green, with the before and after in the wave-done.

README: re-read the owner claim before editing. It is 2306, under run 774's consent 8314. Landing as before: first-ready. Wave 23 (#1137) is in the merge queue now, so main moves. Measure merge-tree against main and against #1149 before you push. Never update-branch, rebase or force-push. Send the wave-done in the same turn as the push. The next review will be lean: the new rows and the texts.

## Coordinator rulings on review 860 (2026-10-23)

Recorded verbatim from the coordinator's second fix-round mail, with the report's path written as "the review's report", as the ruling asks.

Run 833, wave 27: fix round 2, ruled on review 860 (the review's report; read it whole). Record this verbatim in the plan as "Coordinator rulings on review 860 (2026-10-23)", and write the report's path as "the review's report".

The review found the round sound. M24 to M36 red as claimed, each by its own assertion, M30 stays green, every suite in the brief is green, CI's repo-owned legs are green, and merge-tree against main 49e7f187a is clean. Three findings remain, all small. This round ships no new behaviour.

1. F1, the window is not pinned at 8 (important). Ruled: pin it, do not narrow the claim. D-6529 argues the 8 as a safety bound, and a red suite is the mechanism, so the rows must red on a window of 9 or 10. My ruling 1 on review 852 asked for 10 characters (P2a); that was my gap, and this corrects it.
- Change W27-L17 to withhold exactly 8 token characters in a row (for example `token.slice(20, 28)`), so its title is true. W27-L18, which prints 7, stays as it is. Together they pin the window at exactly 8.
- Add the review's two window mutants to the table as M37 (width 9) and M38 (width 10). Each must red W27-L17 by its assertion. Re-run M25, M29 and M30 against the new L17 and record them; M29 must still red it, and M30 must still stay green.
- The plan's "the window is 8" claims (Review Focus, D-6529's amendment, and the As built text) and M29's guard text then stand as written. If any of them names 10, fix it to 8.

2. F2, the boot line's wording (minor). In README's bullet (the clause that now reads "when an attempt closes before the first ready since the server started and no other line has opened the stretch"), write "when an attempt closes, or its socket cannot be created, before the first ready since the server started ...". Make the same change in D-6520, so its sentence agrees with the not-created case it already names. Mark D-6520 "amended on review 860". This stays inside the bullet already consented for this wave and adds no digit; nothing else in README changes.

3. F3, the As built record (minor). Add 21488feb9 and d0aa1b780, and this round's commits, to the fix-round commit list. Say the campaign was re-run at d0aa1b780 for M34 and M35 by review 860 and holds, and record the window mutants of this round at your tip.

4. Review question (c), D-6585 (no change to the ruling). The departure stands. Add the reviewer's reason to its text, marked "amended on review 860": under M36 every gap is about 150 ms, so the form "the fourth gap at least twice the minimum" stays green and would not catch the flattened backoff.

The refuted items stay as they are. The README timeout clause need not name `closing`.

Deviations: none are issued for this round, and none should be needed; the changes are amendments in place. If you meet a real departure, write D-TBD-<slug> and say so in the wave-done.

Measure before wave-done:
- remote-liveness three times, whole file; then readme-holds, docs-parity, citations, single-definition, topology-clean, private-names, dtbd, deviation-refs after `git fetch origin main`, and growth-check with GROWTH_CHECK=1. One file at a time, foreground.
- Mutants on a scratch copy only. Around each vitest call, in a subshell: n=$(ps -L -u "$(id -u)" --no-headers | wc -l); ulimit -u $((n + 1500)); timeout -k 10 600 ./node_modules/.bin/vitest run ... Restore with cmp after each.
- `git merge-tree` against the new origin/main and against each open head that touches README, before the push. Absorb main only on a measured conflict or a red, by an ordinary git merge that keeps both sides; never update-branch, rebase or force-push.
- Scan the round's added prose for private names.

Push once, and send the wave-done in the same turn. Keep claim 2300 until the merge.

## Coordinator rulings on main's #1160 (2026-10-23)

Recorded verbatim from the coordinator's third fix-round mail (8652), as the ruling asks.

Run 833, wave 27: fix round 3. Main moved under PR #1172, and the PR no longer merges. Record this verbatim in the plan as "Coordinator rulings on main's #1160 (2026-10-23)".

What happened. PR #1160 ("deadline on agent connect so a half-open socket can't strand the controller") landed on main at 16:39Z as 3dada7dc9, outside this programme, for the same 2026-10-22 incident. It bounds the same span you bound: socket creation to `ready`, 15 s by default, terminate the still-current not-ready socket and let `onClose` reconnect, cleared in `onReady`, `onClose` and `close()`, `unref`'d. Its names are `RemoteFleetConfig.connectTimeoutMs`, `DEFAULT_CONNECT_TIMEOUT_MS = 15_000`, `connectTimer`, `armConnectDeadline` and `clearConnectDeadline`, in server/src/remote/client.ts, with four rows in server/test/remote-connect.test.ts. `git merge-tree` of origin/main against 95d84c393 now conflicts in client.ts only. Your wave-done was right when you sent it; main moved after review 866.

Ruled: absorb main by an ordinary `git merge origin/main` on your workspace branch (a measured conflict, so the consent rules allow it), and leave ONE deadline.
1. One config field, one default constant, one timer, one arm and one clear. The field and the constant keep main's landed names, `connectTimeoutMs` and `DEFAULT_CONNECT_TIMEOUT_MS`, because they are on main and its rows use them. `readyTimeoutMs` and `DEFAULT_READY_TIMEOUT_MS` go. Pick one set of private names for the timer and its two methods, and say which in the departure. No second timer, guard or default survives anywhere.
2. Your behaviour stays: the expiry still writes your `no ready within ...` journal line, the backoff is kept through the deadline, and every journal and refusal-line rule of this wave is unchanged.
3. Main's four rows in remote-connect.test.ts stay byte-identical and green. Your 25 rows in remote-liveness.test.ts and remoteHelpers.ts take the renamed field; nothing else in them changes.
4. README changes only if a line of yours names the old field (it names none at your tip). README auto-merges; keep main's side and yours.
5. Plan: amend D-6516 in place, marked "amended on main's #1160", to name the landed field and constant. D-6724 and D-6725 are issued for this round, spent in order. Spend D-6724 on the absorb itself: which names survived and why, what was removed, and that the merged deadline is main's span with this wave's journal line. Give D-6725, if unspent, its own entry in the house form before wave-done. Update the Global Constraints, Review Focus, Mutation table and As built text wherever they name the old field.

Measure before wave-done:
- The deadline mutants re-run on the merged code: at least M1 to M5, and every mutant whose row arms or clears the timer. Each must red your rows as recorded, and deleting the arm must also red main's remote-connect rows 1 and 2. Record before and after in As built.
- remote-liveness three times whole-file, remote-connect three times whole-file, then remote-io, readme-holds, docs-parity, citations, single-definition, topology-clean, private-names, dtbd, deviation-refs after `git fetch origin main`, and growth-check with GROWTH_CHECK=1. One file at a time, foreground.
- Mutants on a scratch copy only, under `n=$(ps -L -u "$(id -u)" --no-headers | wc -l); ulimit -u $((n + 1500)); timeout -k 10 600 ...` in a subshell, restored by cmp after each.
- After the merge, `git merge-tree` against the then-current origin/main is clean. Never rebase, force-push or update-branch.
- Scan the round's added prose for private names.

Your push removes the PR from the merge queue; that is expected. Push once and send the wave-done in the same turn. Claim 2342 covers your four paths; if you need server/test/remote-connect.test.ts edited (you should not), stop and ask me first. A lean review follows, then I queue the PR again.

## As built (run 833, 2026-10-23)

The worker's record. Measured on the workspace branch over base `a68c90f15` (main did not move during the wave, and
the `client.ts` anchors were unchanged from `7ebdff20c`).

- **Commits, in order:**
  - the plan alone;
  - Task 1, the harness and W27-L8;
  - Task 2, the deadline, with W27-L12 and the `setImmediate` that D-6528 describes: no committed tree held W27-L12
    without it;
  - D-6528, which changed only the plan (the entry);
  - Task 3, the log lines and D-6527's refusal line;
  - Task 3's review fix, D-6529;
  - Task 4, the README bullet;
  - this note.
- **Claims:**
  - Group A was claim 2300.
  - README went in under run 774's consent: request 8312, consent 8314. The owner claim was live as 2306 at Task 4
    (re-declared from 2259, 2278 and 2295). Claim 2300's intent was renewed to cite all three. The change is one
    hunk, nine added lines at Task 4, ten after review 852's fix round and eleven after review 860's, with no existing
    line touched.
- **Deviations:** eighteen defined, each once (the server's reader prints `18 18`; it printed `16 16` for D-6514 to
  D-6529 before the fix round). The first block's two reserve numbers were spent:
  - D-6528: W27-L12's starting phase. The row went red with no mutant applied; it is reported under ruling 12.
  - D-6529: a refusal reason that repeats the token is withheld.

  The fix round's two numbers: D-6585 is the W27-L25 floor, a departure from the ruling's example; D-6586 is unused
  and has its own entry. The fix round on main's #1160 brought the count to twenty (the reader prints `20 20`):
  D-6724 is the absorb and D-6725 the three red sets it made unreachable.
- **The README bullet** adds one clause for the refusal line (D-6527, D-6529). The consent allows the link's journal
  lines, and the clause states no number. The fix round rewrote the bullet (below).
- **Rows:** 15 in `remote-liveness.test.ts` at the first wave-done, W27-L1 to W27-L15, all green. W27-L15 is the
  echoed-hello row of D-6529. The fix round brought it to 25, W27-L1 to W27-L25.
- **Mutations**, as re-measured in review 852's fix round on the final 25 rows. Each mutant was applied alone to a
  scratch copy of the branch at 77c949950 and run once over the whole file, so every run collected all 25 rows
  (failed + passed = 25). Every red was an assertion, with no vitest timeout and no process-cap or harness error. Each
  mutant was restored with a copy and a byte-for-byte `cmp`. M6's Task 1 base row is kept as history, and the earlier
  per-task measurements are superseded by this table:

| # | Red rows measured (25 rows) | failed+passed | Note |
|---|---|---|---|
| M6 (Task 1, base) | W27-L8 | 1+0 | history: the heartbeat's terminate has its first row |
| M1 | W27-L1, L2, L3, L4, L6, L9, L12, L23, L25 | 9+16 | L12 reds through its `waitFor` only (below) |
| M2 | W27-L1, L2, L4, L9, L12, L25 | 6+19 | L3 green, as expected; L12 through its `waitFor` only |
| M3 | W27-L1, L2, L3, L6, L9, L23 | 6+19 | L1 red against the plan's "stays green", twice: Task 3's line assertion; L4 green |
| M4 = M4b | W27-L5 | 1+24 | M4's spelling has no anchor since Task 3; one edit, measured once |
| M5 | W27-L1, L2, L3, L4, L6, L9, L12, L23, L25 | 9+16 | L12 through its `waitFor` only |
| M6 | W27-L8 | 1+24 | |
| M7 | W27-L6, L7 | 2+23 | earlier runs also showed L10 or L14 under load: a closed client's deadline printing into a later spy |
| M8 | W27-L9, L13, L14, L15, L16, L17, L18, L19, L20, L21, L22 | 11+14 | every row that expects one line per kind |
| M9 | W27-L8, L9, L10, L11, L21 | 5+20 | |
| M10 | W27-L1, L2, L3, L9 | 4+21 | |
| M11 | W27-L9, L10, L11, L21 | 4+21 | |
| M12 | W27-L10, L14 | 2+23 | L14's first line is `lost` |
| M13 | W27-L8 | 1+24 | |
| M14 | W27-L8 | 1+24 | |
| M15 | W27-L8 | 1+24 | |
| M16 | W27-L6, L11, L16, L17, L18, L19, L20, L21, L22 | 9+16 | the boot-refusal rows expect the `never-ready` line |
| M17 | W27-L9, L10, L23 | 3+22 | |
| M18 | W27-L12 | 1+24 | red at `upgraded(0)`: the only mutant family that exercises that assertion |
| M19 | W27-L13 | 1+24 | |
| M20 | W27-L13 | 1+24 | |
| M21 | W27-L14 to L23 | 10+15 | every row that expects a `refused` line |
| M22 | W27-L14, L15, L16, L17, L19 | 5+20 | |
| M23 | W27-L15, L16, L17, L19 | 4+21 | |
| M24 | W27-L16 | 1+24 | |
| M25 | W27-L17, L20 | 2+23 | L20 beyond the expected L17, twice: `includes('')` is always true |
| M26 | W27-L19 | 1+24 | |
| M27 | W27-L20 | 1+24 | |
| M28 | W27-L18 | 1+24 | |
| M29 | W27-L17 | 1+24 | |
| M30 | none | 0+25 | green: the equivalent mutant (D-6529), no row can red it |
| M31 | W27-L16 to L22 | 7+18 | |
| M32 | W27-L22 | 1+24 | |
| M33 | W27-L22 | 1+24 | |
| M34 | W27-L23 | 1+24 | |
| M35 | W27-L24 | 1+24 | |
| M36 | W27-L25 | 1+24 | |

- **M1, M2 and M5 and W27-L12.** All three red W27-L12 only through its `waitFor` (`accepts() >= 2`), never through
  `upgraded(0)`, so their L12 reds say nothing for or against D-6528. Only the M18 family exercises that assertion.
- **The review-852 fix round**, on this branch after the as-built commit:
  - commits, in order: the coordinator's rulings recorded (61acb84b5); rows W27-L16 to W27-L25 and the text fixes to
    W27-L14's title and `LinkLine`'s comment (36427c5a3); the README rewrite (c5ea2efd5); the L24 and L25 review
    fixes (b605bedbe and 77c949950); and the plan text edit that wrote this list;
  - rows W27-L16 to W27-L25: the token window (L16 to L20), the refusal's order, range and phase (L21 to L23), the
    timer's `unref` (L24) and the backoff (L25, D-6585);
  - the README bullet, rewritten inside the consented bullet and still stating no number: it says when the boot line
    prints, the retry delay in words (it grows on each failure and resets once a link is ready), and the ping in
    words.
- **The review-860 fix round**, on this branch after review 852's:
  - commits, in order, after the plan text edit above: the plan's as-built suites (21488feb9); the L23 and L24 fixes,
    with the README hunk's size named in the plan (d0aa1b780); the coordinator's rulings on review 860 recorded
    (cafaa85d0); and "test(remote): W27-L17 withholds exactly 8 token characters; README and D-6520 cover the socket
    not created (wave 27, review 860)", which carries the L17 change, the README clause, the plan amendments and this
    record;
  - the campaign was re-run at d0aa1b780 for M34 and M35 by review 860 and holds: M34 reds W27-L23 only, M35 reds
    W27-L24 only;
  - W27-L17 now carries exactly 8 token characters in a row (`token.slice(20, 28)`, where it carried 10), so its
    title is true and, with W27-L18 (7 printed), the window is pinned at exactly 8;
  - the window mutants, measured at this round's tip on a scratch copy over all 25 rows (failed + passed = 25), each
    by assertion, each restored by copy and a byte-for-byte `cmp`:
    - M37 (width 9): W27-L17 only, 1+24;
    - M38 (width 10): W27-L17 only, 1+24;
    - M25 re-run against the new L17: W27-L17 and W27-L20, 2+23 (as before: `includes('')` is always true);
    - M29 re-run: W27-L17 only, 1+24;
    - M30 re-run: none, 0+25, still the equivalent mutant;
  - the README clause now reads "when an attempt closes, or its socket cannot be created, before the first ready"; the
    bullet is eleven added lines.
- **The fix round on main's #1160** (mail 8652), on this branch after review 860's:
  - main's #1160 (3dada7dc9) landed at 16:39Z under PR #1172 and bounds the same span; `git merge-tree` of
    95d84c393 against origin/main 5d6d0b760 conflicted in `client.ts` only;
  - commits, in order: the merge of origin/main, "one connect deadline under #1160's names (wave 27, D-6724)"
    (e743a9965), an ordinary `git merge` whose resolution keeps main's field, constant, timer and clear,
    moves this wave's `no ready within` line into `armConnectDeadline`, removes `readyTimeoutMs`,
    `DEFAULT_READY_TIMEOUT_MS` and `armReadyDeadline`, and renames the field in `remote-liveness.test.ts` and
    `remoteHelpers.ts` (nothing else in them changed); the coordinator's rulings recorded (bacf850d1); the plan's
    names for the landed deadline, D-6516 and D-6517 amended, D-6724 (2d0775338); and this record, with D-6725;
  - main's `remote-connect.test.ts` is byte-identical to origin/main; README merged with no conflict and is still one
    added-only hunk of eleven lines against the new merge-base, with no digit;
  - the deadline mutants, re-measured on the merged code on a scratch copy, each mutant run once over all 25 rows of
    `remote-liveness` (failed + passed = 25) and over main's four connect-deadline rows of `remote-connect`, C1 to C4
    in file order (failed + passed = 4, the other 66 skipped). Every red was an assertion; each mutant was restored by
    copy and a byte-for-byte `cmp`; every green was re-run once and stayed green. Load average 30 to 24.

| # | Recorded before (25 rows) | `remote-liveness` red rows | f+p | main's rows red | f+p | Held? |
|---|---|---|---|---|---|---|
| M1 | W27-L1, L2, L3, L4, L6, L9, L12, L23, L25 | the same | 9+16 | C1, C2 | 2+2 | yes; the ruling's C1 and C2 red |
| M2 | W27-L1, L2, L4, L9, L12, L25 | the same | 6+19 | C1 | 1+3 | yes |
| M3 | W27-L1, L2, L3, L6, L9, L23 | the same | 6+19 | C2 | 1+3 | yes |
| M4 = M4b | W27-L5 | none | 0+25 | none | 0+4 | no: equivalent under the `onReady` clear (D-6725) |
| M5 | as M1 | the same | 9+16 | C1, C2 | 2+2 | yes |
| M7 | W27-L6, L7 | none | 0+25 | none | 0+4 | no: equivalent under the `onClose` and `close()` clears (D-6725) |
| M18 | W27-L12 | the same | 1+24 | none | 0+4 | yes |
| M35 | W27-L24 | none | 0+25 | none | 0+4 | no: `close()` clears the timer before the `unref` matters (D-6725) |
| M36 | W27-L25 | the same | 1+24 | none | 0+4 | yes |
| M39 | (new) | none | 0+25 | none | 0+4 | the `onReady` clear alone: green |
| M40 | (new) | none | 0+25 | none | 0+4 | the `onClose` clear alone: green |
| M41 | (new) | none | 0+25 | none | 0+4 | the `close()` clear alone: green |
| M42 | (new) | none | 0+25 | none | 0+4 | the clear at arm alone: green |
| M43 | (new) | W27-L5 | 1+24 | C3 | 1+3 | the ready half, both ways |
| M44 | (new) | W27-L7 | 1+24 | none | 0+4 | the current-socket half, both ways |
| M45 | (new) | W27-L24 | 1+24 | none | 0+4 | the `unref` behind the `close()` clear |

  - the suites of this round, one file at a time, are recorded in the wave-done.
- **Suites run** at the README commit (before review 852), one file at a time, at a load average of 18 to 45:
  - all green: `remote-liveness` 15, `remote-connect` 66, `remote-io` 217, `remote-pty` 6, `remote-runner` 28,
    `remote-tail` 4, `fleet-identity-client` 6, `fleet-identity-composition` 4, `update-inventory` 90,
    `caps-refresh` 8, `citations` 4, `single-definition` 841, `topology-clean` 60, `private-names` 47, `dtbd` 1,
    `deviation-refs` 31, `typecheck-tests` 12, `growth-check` 45 (with `GROWTH_CHECK=1`), and from Task 4
    `docs-parity` 54, `readme-holds` 17 and `pools-prose` 27;
  - `secret-mask`: 82 of 83. One case went red: "a 2 MB TUI pane history is masked in slices …", whose check is the
    largest gap between yields under 50 ms. The same case went red on a clean checkout of `origin/HEAD`, three of
    three runs alternated with the branch (72 to 107 ms, against 51 to 93 ms on the branch). The test imports
    `FleetClient` as a type only, and this branch changes nothing else under `server/src`. So it is load, and main
    shares it; this wave did not cause it.
  - `typecheck-tests` went red twice under a load average of 80 to 100, both times on its own 120 s tsc timeout. The
    direct `tsc` runs were clean each time, and the quiet re-run passed 12 of 12.
- Suites (review 852 fix round), one file at a time at a load average of 15 to 38, each run under the ruling's
  process-cap wrapper:
  - `remote-liveness`: the whole file 25 of 25 three times (about 22 s each), and each of W27-L16 to W27-L25 green
    alone;
  - every new row red under its own mutant first, then green (the campaign above);
  - `remote-connect` 66, `remote-io` 217, `remote-pty` 6, `remote-runner` 28, `remote-tail` 4,
    `fleet-identity-client` 6, `fleet-identity-composition` 4, `update-inventory` 90, `caps-refresh` 8,
    `single-definition` 841, `typecheck-tests` 12 and `growth-check` 45, all green;
  - `citations`, `docs-parity`, `readme-holds`, `pools-prose`, `topology-clean`, `private-names`, `dtbd` and
    `deviation-refs`, run again at the final tip, are recorded in the wave-done.
- **The full suite was not run locally.** CI's selection runs it for the PR, so the wave-done's `suite:` word is
  `unrun`.
