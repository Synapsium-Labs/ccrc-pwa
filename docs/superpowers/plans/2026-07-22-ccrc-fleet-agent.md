# ccrc Fleet-Agent (remote fleet control) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (orchestrated via Workflow tonight). Each task: TDD, run the suite, commit.

**Goal:** ccrc server (stays on <server-host>) drives the cc fleet on a REMOTE host through a small authenticated agent — no SSH in the runtime path.

**Architecture:** `infra/ccrc/agent` = WS service on the fleet host (tailnet iface + bearer token) exposing a whitelisted exec/file/tail/pty surface. Server side: a `RemoteFleet` providing the existing `Runner`/`SpawnPty` seams plus a new injected `FleetIO` fs-facade; `CCRC_FLEET=local|remote` picks implementations. Degraded mode: disk-cached fleet snapshot + Hetzner reboot action.

**Tech:** Node ≥22, TS ESM strict, vitest, `ws` (already a dep), node-pty (already a dep). Mirror `infra/ccrc/server` conventions exactly (tsconfig, eslint, test layout).

## Global constraints
- ESM strict TS; ES2022 only (no `findLast` etc.); vitest; all tests green after every task: `npm test` in `infra/ccrc/server` (and `infra/ccrc/agent` once it exists).
- Never bind 0.0.0.0. Agent binds `CCRC_AGENT_HOST` (default 127.0.0.1). Bearer token required on every connection.
- Path whitelist (canonical prefix check after realpath) for ALL file ops: `$HOME/.cc-sessions/`, `$HOME/.cc-limits/`, `$HOME/.cc-clips/`, `$HOME/.claude*/`, `/srv/projects/`. Writes additionally restricted to `$HOME/.cc-clips/`.
- Exec whitelist: `tmux` [`has-session`,`list-panes`,`capture-pane`,`send-keys`,`resize-window`]; `ccd` [`start`,`enable`,`ensure`,`stop`,`swap`,`clip`]. Reject anything else with `{ok:false, err:'forbidden'}`.
- Commit style: `feat(ccrc-agent): …` / `feat(ccrc): …`, Co-Authored-By trailer as configured.

## Pinned interfaces (all tasks conform to THESE)

`infra/ccrc/shared/agent-protocol.ts` (T2 creates; shown here as the contract):
```ts
export interface AgentHello { t: 'hello'; token: string }
export interface AgentReady { t: 'ready'; v: 1 }
export interface ExecReq   { t: 'req'; id: number; op: 'exec'; cmd: string; args: string[]; timeoutMs?: number }
export interface ReadReq   { t: 'req'; id: number; op: 'read'; path: string }
export interface ReadFromReq { t: 'req'; id: number; op: 'readFrom'; path: string; offset: number }
export interface ReaddirReq{ t: 'req'; id: number; op: 'readdir'; path: string }
export interface StatReq   { t: 'req'; id: number; op: 'stat'; path: string }
export interface WriteB64Req { t: 'req'; id: number; op: 'writeB64'; path: string; dataB64: string }
export interface TailOpenReq { t: 'req'; id: number; op: 'tailOpen'; path: string; offset: number }
export interface TailCloseReq{ t: 'req'; id: number; op: 'tailClose'; tailId: number }
export interface PtyOpenReq  { t: 'req'; id: number; op: 'ptyOpen'; sessionId: string; cols: number; rows: number }
export interface PtyInput    { t: 'pty'; ptyId: number; ev: 'input'; dataB64: string }
export interface PtyResize   { t: 'pty'; ptyId: number; ev: 'resize'; cols: number; rows: number }
export interface PtyClose    { t: 'pty'; ptyId: number; ev: 'close' }
export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReaddirReq|StatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq;
export interface ResOk  { t: 'res'; id: number; ok: true;  [k: string]: unknown } // op-specific payload fields below
export interface ResErr { t: 'res'; id: number; ok: false; err: string }
// exec → {code, stdout, stderr}; read → {data: string|null}; readFrom → {data: string, size: number}|{data: null};
// readdir → {names: string[]|null}; stat → {mtimeMs, size}|{missing: true}; writeB64 → {}; tailOpen → {tailId};
// ptyOpen → {ptyId}
export interface TailData  { t: 'tail'; tailId: number; dataB64: string }       // appended bytes
export interface TailReset { t: 'tail'; tailId: number; reset: true; size: number } // file truncated/rotated
export interface PtyData   { t: 'pty'; ptyId: number; ev: 'data'; dataB64: string }
export interface PtyExit   { t: 'pty'; ptyId: number; ev: 'exit' }
export interface Ping { t: 'ping' }  export interface Pong { t: 'pong' }
```

`infra/ccrc/server/src/io.ts` (T1 creates):
```ts
export interface FleetIO {
  readFile(path: string): Promise<string | null>;                      // null = missing
  readFileFrom(path: string, offset: number): Promise<{ data: string; size: number } | null>;
  readdir(path: string): Promise<string[] | null>;
  stat(path: string): Promise<{ mtimeMs: number; size: number } | null>;
  writeFileB64(path: string, dataB64: string): Promise<void>;          // mkdir -p parent
  tailFile(path: string, offset: number, onData: (chunk: Buffer) => void, onReset: (size: number) => void): Promise<() => void>; // returns close()
}
export const localIO: FleetIO; // node:fs implementation preserving today's exact behavior
```
`Deps` (server.ts) gains `io: FleetIO`; `index.ts` builds local or remote deps from config.

Config additions (`config.ts`): `CCRC_FLEET` ('local'|'remote', default 'local'), `CCRC_AGENT_URL`, `CCRC_AGENT_TOKEN`, `CCRC_HETZNER_TOKEN`, `CCRC_FLEET_SERVER_ID`. Agent env: `CCRC_AGENT_HOST` (default 127.0.0.1), `CCRC_AGENT_PORT` (default 7789), `CCRC_AGENT_TOKEN`.

---

### Task 1: FleetIO facade + thread through all call sites
**Files:** Create `server/src/io.ts`; Modify `server/src/{server.ts,commands.ts,livestate.ts,clip.ts,sessionws.ts,lifecycle.ts,limits.ts,registry.ts,transcript/tail.ts}`; tests alongside existing ones.
**Interfaces:** Produces `FleetIO`, `localIO`, `Deps.io`. Consumers: every later task.
- Replace each direct `node:fs` use in the listed files with `deps.io` calls (thread `io` through constructors/params the same way `run`/`tmux` flow today). `server.ts`'s `existsSync` (PWA dist check) STAYS local — it concerns the server's own box.
- `transcript/tail.ts`: refactor `TranscriptTailer` to consume `io.tailFile` — `localIO.tailFile` keeps the current `fs.watch`+`createReadStream` logic (move it into io.ts), tailer keeps its public API so `sessionws.ts` changes minimally.
- `clip.ts`: `mkdir`+`writeFile` become `io.writeFileB64`.
- TDD: for each module, existing tests must pass unchanged with `localIO` injected; add io.test.ts covering localIO (readFileFrom offsets, tailFile append+truncate via tmp files, writeFileB64 mkdir-p).
- Commit: `feat(ccrc): FleetIO facade — all fleet fs behind an injected seam`

### Task 2: shared protocol + agent service
**Files:** Create `shared/agent-protocol.ts` (contract above, verbatim), `agent/package.json`, `agent/tsconfig.json`, `agent/src/{index.ts,server.ts,whitelist.ts,fileops.ts,tail.ts}`, `agent/test/*.test.ts`.
**Interfaces:** Consumes protocol; produces a runnable agent (`node agent/dist/index.js`) + exported `startAgent(opts): {close}` for in-proc tests.
- Plain `ws` WebSocketServer over `node:http`. First frame must be valid `hello` within 3 s or socket closed. Wrong token → close code 4401.
- Implement ops: exec (whitelists; `execFile`, maxBuffer 8 MB, per-req timeout default 10 s / cap 120 s), read/readFrom/readdir/stat/writeB64 (path whitelist via `realpath` prefix check; parents mkdir'd for writes), tailOpen/tailClose (fs.watch + read-at-offset; emit TailReset when size < offset), ping→pong.
- Multiple concurrent clients allowed; per-connection tail/pty registries cleaned on disconnect.
- Tests: auth (no hello / bad token / good), exec whitelist accept+reject, file ops against tmp fixture dirs (whitelist enforced — attempts outside → forbidden), tail append + truncate, malformed JSON → close.
- Commit: `feat(ccrc-agent): WS agent — whitelisted exec/file/tail surface`

### Task 3: RemoteFleet client + remote mode wiring
**Files:** Create `server/src/remote/{client.ts,runner.ts,io.ts}`; Modify `server/src/{config.ts,index.ts}`; `server/test/remote*.test.ts`.
**Interfaces:** Consumes protocol + T2's `startAgent` (dev-dep on agent for tests). Produces `connectFleet(cfg): { runner: Runner; io: FleetIO; spawnPty: SpawnPty; state: {connected: boolean; downSince: number|null}; onStateChange(cb); close() }` (spawnPty throws until T4 lands — stub method present).
- `client.ts`: single WS, hello/ready handshake, request table (id → resolver) with per-op timeouts, reconnect with backoff 1 s→30 s, heartbeat every 15 s (2 misses → destroy socket → reconnect), in-flight requests rejected on disconnect (`err:'disconnected'`).
- `runner.ts`: `Runner` over exec op (ccd ops get 90 s timeout, tmux ops 10 s). `io.ts`: `FleetIO` over read ops; `tailFile` over tailOpen/tailClose + auto-re-open after reconnect (fresh offset via stat; emit reset upstream so the tailer resyncs).
- `index.ts`: `CCRC_FLEET=remote` → build deps from `connectFleet`; local unchanged.
- Tests against in-proc agent (tmp HOME fixtures): end-to-end exec/read/tail through the client; reconnect test (close server socket, assert backoff reconnect + tail resume); auth-fail surfaces as fatal state.
- Commit: `feat(ccrc): RemoteFleet — Runner+FleetIO over the agent WS`

### Task 4: pty proxy
**Files:** Modify `agent/src/server.ts` (+`agent/src/pty.ts`), `server/src/remote/{client.ts,pty.ts}`; tests both sides.
**Interfaces:** Produces remote `SpawnPty` satisfying `PtyLike` (pty.ts) so `server.ts`'s `/ws/pty/:id` bridge works unchanged.
- Agent: `ptyOpen` spawns node-pty `tmux attach -t cc-<sessionId>` (reuse `attachPty` logic; sessionId sanitized `[A-Za-z0-9_-]+`), streams `PtyData` b64; handles input/resize/close; `PtyExit` on process exit; kill on disconnect.
- Server: `RemotePty implements PtyLike` — `onData` wires PtyData, `write` sends input, `resize`, `kill` sends close. `connectFleet().spawnPty` returns it.
- Tests: agent-side with a fake spawn (echo pty), client-side round-trip through in-proc agent (data both directions, resize call recorded, exit propagates).
- Commit: `feat(ccrc): remote pty — terminal drawer over the agent`

### Task 5: degraded mode + reboot action + PWA surface
**Files:** Modify `server/src/{server.ts,watch.ts or fleet.ts as fits}`, create `server/src/fleetstate.ts`; PWA: `pwa/src/fleet/FleetHostBanner.tsx`, modify fleet view + api client + css; tests both.
**Interfaces:** Consumes T3's `state`/`onStateChange`. Produces `/api/fleet/health` → `{mode:'local'|'remote', connected, downSince}`; `POST /api/fleet/reboot` → 202 `{ok:true}` | 409 (mode local) | 502 (Hetzner error).
- `fleetstate.ts`: on each successful full fleet poll in remote mode, persist snapshot to `~/.ccrc/state-cache.json` (atomic tmp+rename); on `connected=false`, fleet API serves the cached snapshot with `stale: true` + `downSince`.
- Reboot: guard `mode==='remote'`; POST Hetzner `servers/${CCRC_FLEET_SERVER_ID}/actions/reboot` with `CCRC_HETZNER_TOKEN` (undici fetch); no token/id configured → 501.
- PWA: banner when `stale` — "Fleet host unreachable since <t>" + Reboot button with confirm dialog whose copy names the collateral: "Reboots the whole fleet box (also restarts the rp-llm services on it)". Poll /api/fleet/health with existing polling util.
- Tests: cache write+serve-stale path (inject fake state), reboot route guards (local→409, no-token→501, happy→202 with fetch mocked), PWA banner render + confirm flow (existing component-test patterns).
- Commit: `feat(ccrc): degraded mode — snapshot cache, unreachable banner, fleet-host reboot`

### Task 6: deploy plumbing + docs
**Files:** Modify `infra/ccrc/deploy/deploy.sh`; create `infra/ccrc/deploy/{ccrc-agent.service,ccrc.env.example,ccrc-agent.env.example}`; modify `infra/ccrc/README.md`.
- deploy.sh: parameterize the hardcoded health URL (`CCRC_HEALTH_URL` env, default current value); add `deploy.sh agent <host>` target (rsync agent+shared → box, `npm ci && npm run build`, install user unit, restart); ship env files if present locally (never commit real tokens — examples only).
- `ccrc-agent.service` (user unit): ExecStart `/usr/bin/env node <dir>/agent/dist/index.js`, `EnvironmentFile=%h/.ccrc/agent.env`, Restart=always.
- README: remote-mode config table, agent security model (tailnet bind + bearer + whitelists), degraded-mode semantics, e2e instructions.
- Commit: `feat(ccrc): agent deploy target + units + docs`

## Self-review notes
- Type names/signatures cross-checked (PtyLike matches pty.ts; Runner matches exec.ts; protocol ids numeric per-connection).
- No placeholder steps; each task lists concrete files, ops, tests, commit.
- Spec coverage: §4 transport/ops/degraded/deploy → T2/T3/T4/T5/T6; §4 "existing tests stay green" → T1.
- Out of plan (orchestrator, band-3): token generation, box deploys, live e2e vs real fleet, cutover.
