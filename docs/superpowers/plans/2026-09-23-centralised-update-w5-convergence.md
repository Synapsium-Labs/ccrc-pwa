# Centralised update management — programme wave 5 (spec W4, server side): convergence and the one-tap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tap on the PWA moves the fleet: the agent answers a typed `update` op by spawning exactly one of two absolute argv templates, the server's dispatcher turns an operator's request (or an `auto` intent) into at most one node move at a time — fleet-role before server-role, halted by a `failed`/`reverted` row, bounded by a deadline — and the `/settings` screen and the fleet banner's five move controls, rendered disabled by wave 3, become live confirm sheets that name the nodes they move, in order, and send `apply {tag}` or `rollback {to}` by direction.

**Architecture:** One new member of the existing `req` envelope (`UpdateReq`, `shared/agent-protocol.ts`) with its closed error vocabulary; the agent's `validateReq`/`handleReq` pair answers it by reading `~/.ccrc/update.json` itself and spawning `$HOME/.local/bin/ccrc <update|rollback> --to <tag> --detach --from pwa` through `execFile` — never through `isExecAllowed` or the exec op — behind ONE agent-wide spawn gate, and advertises `ops: ['update']` on `ready`. Server side, two new `CoordStore` writers (`requestNode`, the request group; `dispatchNode`, the ONE lease acquire) plus a refusal-note writer on the lease group; a PURE L1 dispatcher (`server/src/update/dispatch.ts`: eligibility, halt, order, capability refusals, direction, deadline, the answer mapping) and its L3 act (`server/src/update/converge.ts`: plan → re-check the live link → acquire → send the op over `FleetClient.request` or spawn locally through an injected two-template `LocalUpdateSpawn`, never a raw `Runner` → map the answer), run single-flight from `FleetWatcher` after every inventory sweep, intent write and request write. `update/routes.ts` gains `POST /api/updates/apply` and `POST /api/updates/rollback`, session-only, whose single-node `409`s are the dispatcher's own predicate called synchronously. The PWA gets two client methods, one pure move planner and one confirm sheet shared by every move control.

**Tech Stack:** TypeScript on node `>=22.13.0` (`node:sqlite` `DatabaseSync`, synchronous, under `tx()`); Fastify 5; `ws` (the agent link, unchanged transport); `node:child_process` `execFile` on the agent; React 19 + Vite, vitest + jsdom + `@testing-library/react` in `pwa/`; vitest in `server/` and `agent/`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` — §2 decisions 1, 7, 8, 9, 11, 13, 14, 15, 16, 17; §9's dispatcher-side capability refusals and the `auto` enforcement; §10 in full (trigger, eligibility, `dispatchNode`'s checks, one node at a time fleet-first, halt, the `update` op, the agent advertising `ops`, the server node spawned locally, a refusal releasing the lease, offline nodes, the lease and the deadline, provenance verdicts not halting); §12's `apply` and `rollback` rows and their census; §13's move controls ENABLED with their confirm sheets ("W4 adds"); §15 row W4 (the server half); §18 rows "`auto` needs the gate cap, at dispatch time", "every capability refusal is in the dispatcher", "the server row is never refused for `agentOps`", "the op validates the tag with the one guard" (the op half), "the op never execs", "the spawn argv is absolute", "an agent without the op is never sent it", "`bad-request` from an advertising agent halts", "a one-tap is a row", "a refusal does not consume the request", "a request write triggers dispatch", "`apply` names a tag", "`apply` refuses an older tag; an unversioned node is never "not newer"", "`rollback` is catalogue-gated and defaults to `previous`", "one dispatch per sweep", "fleet before server", "`failed` halts dispatch", "a provenance refusal does not halt", "a refusal releases in the same turn", "the deadline bounds a node that never wrote", "`accepted` does not settle", "`unknown` is busy" (the fixture-row half W2 deferred here), "a refusing write never returns void" (`dispatchNode`), "six session doors, one dual-credential read" (the two this wave appends), "no write route takes the box token", "Install names the order and the direction".

**Producers:** W2 — `git show 2b5d4ce1:docs/superpowers/plans/2026-09-22-centralised-update-w2-control-plane.md` (the plan as executed, its Deviations and Interfaces corrected through the fix rounds; the merged copy on `main` once it lands); wave 3 — `git show d638c602:docs/superpowers/plans/2026-09-23-centralised-update-w3-settings-and-notification.md`; wave 4 — `git show 4b361c00:docs/superpowers/plans/2026-09-22-centralised-update-w4a-node-side.md`. ALL THREE MERGE BEFORE this wave is dispatched; every task assumes their code is on `main` and spells every shared name exactly as those plans do. Anchors into files none of them touches are at `d759c914`; anchors into files they change are by QUOTED producer text, never by line.

**Out of scope, said once:** any edit to `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `ccd/ccd` or a systemd unit (wave 4 owns every bash change; this wave only CALLS `ccrc update --to <tag> --detach --from pwa` and `ccrc rollback --to <tag> --detach --from pwa`); versioned installs, `ccrc versions`, arm 1 and the `versions` cap word (wave 6); dispatch groups, `CCRC_UPDATE_CONCURRENCY` and anything per-tenant (spec §14's two seams); a writer for `updateState = 'applying'` (D-3382); the PWA bundle's own update; the live exit criterion (the coordinator's, at rollout).

## Global Constraints

- **Producer names are spelled as the producers spell them**: `NodeRow`, `NodeWire`, `UpdatesView`, `ReleaseRow`, `RefusalRow`, `UpdateIntentRow`, `nodes()`, `node()`, `releases()`, `refusalsFor()`, `intentFor()`, `releaseLease`, `settleNode`, `ackNode`, `resolveNode`, `SETTLED_UPDATE_STATES`, `BUSY_UPDATE_STATES`, `IN_FLIGHT_UPDATE_PHASES`, `UPDATE_PHASES`, `isReleaseTag`, `isRequestKind`, `RequestKind`, `FLEET_SCOPE`, `UPDATE_GATE_CAP`, `UPDATE_STORE_REFUSE_CODES`/`isUpdateStoreRefuseCode`, `UpdateRouteError`, `UpdateRouteRefusal`, `WRITER_GROUPS`, `W2_WRITERS`, `W3_WRITERS`, `UPDATE_RING_FILES`, `UPDATE_DOORS`, `EligibilityRow`, `eligibleTags`, `resolveInputFor`, `resolveNodeIntent`, `resolveAndProject`, `SERVER_LABEL`, `FLEET_LABEL`, `sweepThenProject`, `inventoryNow()`, `triggerInventory()`, `pushRelease`, `readReadyOps`, `FleetState.agentOps`, `NODE_FILES`, `cfg.role`, `cfg.home`, `cfg.ccrcDir`, `cfg.updateDeadlineMs`, `registerUpdateRoutes`, `refuse`, `reproject`, `ensureInventory`, `parseAckBody`, `toNodeWire`, `UPDATE_ERROR_TEXT`/`updateErrorText`, `MOVE_DISABLED_TEXT`, `pendingTag`, `nodeVersion`, `releaseDirection`, `useUpdatesView`, `UpdateBanner`, `bannerRelease`, `canAck`, `api.updates`/`setUpdateIntent`/`refreshUpdates`/`ackUpdateNode`, `postJsonOr`, `printableDetail`, `updateEpoch()`, `UNIX_SECONDS_MAX` (W2's one seconds bound, `shared/api.ts`; `REPORT_TIME_MAX_S`/`MAX_UNIX_S` no longer exist); wave 4's `--detach`, `--from pwa`, `update.json`'s seven keys and SECONDS (rulings R1, R14), `_upd_lock`, the cap words `update-json update-gate rollback detach` — one spelling per name across this plan.
- **The two spawn argvs are exactly** `$HOME/.local/bin/ccrc update --to <tag> --detach --from pwa` and `$HOME/.local/bin/ccrc rollback --to <tag> --detach --from pwa`, `<tag>` the only variable token, the first token absolute, built ONCE by `updateLauncherPath(home)` + `updateSpawnArgv(kind, tag)` (`shared/agent-protocol.ts`, Task 1; the argv frozen, a non-tag or non-kind a `RangeError`) and used by both the agent (Task 2) and the server-role local spawn (Task 5, through the composition-root factory `localUpdateSpawnFor(realRunner, cfg.home)`, D-3397). No source spells the launcher as one quoted path string (Task 1's scan).
- **The exec surface is untouched**: `EXEC_COMMANDS = ['tmux','ccd']`, `FORBIDDEN_COMMANDS`, `EXEC_WHITELIST` (`agent/src/whitelist.ts`) do not change; the `update` case never calls `isExecAllowed`, `runExec` or `resolveSpawnCmd`, and no `exec` op carries `ccrc`. `agent/test/whitelist-structural.test.ts`, `whitelist-prototype.test.ts`, `whitelist-noghosts.test.ts` and `server/test/whitelist-subset.test.ts` are run, never edited (agent/CLAUDE.md: safety hardware).
- **`isReleaseTag` is the ONE tag-shape guard** (W2 Task 1, `shared/api.ts`): the agent's `validateReq` and the dispatcher call it; the two move routes' body parsers call W2's ingress gate `isIngestibleReleaseTag` (`server/src/update/resolve.ts`, which calls `isReleaseTag` first) exactly as `parseIntentBody` does, so a leading-zero or over-64-byte `tag`/`to` answers `400 bad-tag` on every update route D-3494; no file restates `RELEASE_TAG`'s source (`single-definition.test.ts`'s one-holder scan stays green).
- **L0 `shared/*.ts` imports only L0 siblings, and `shared/api.ts` imports nothing at runtime.** `shared/api.ts` gains no import line (`peers-claims-l0.test.ts:157-167` pins its three type-only lines); every wave-5 addition there is APPENDED inside the END-OF-FILE update block (after wave 3's `UPDATE_GATE_CAP`, the file's last line after wave 3) or edits a W2 line in place — never a line above `:7535` (README's anchors into this file at the tip: `:7474-7476`, `:7514`, `:7522`, `:7535`) (D-3188, ruling R13). `shared/agent-protocol.ts` gains ONE import line, `import { isReleaseTag, isRequestKind, type RequestKind } from './api.js';`, directly after its existing `import type { BuildInfo } from './buildinfo.js';` — two VALUES and one type, because `updateSpawnArgv` guards its arguments at runtime (the `shared/roster.ts` sibling-value-import precedent; `shared/api.ts` imports nothing from `agent-protocol.ts`, so no cycle forms; nothing under `pwa/src` imports `agent-protocol.ts`).
- **L1 is `server/src/update/dispatch.ts`**: pure decisions over rows it is handed, imports only `'../../../shared/api.js'`, `'../../../shared/agent-protocol.js'` (`UPDATE_OP`, Task 4; `firstStderrLine`, `isUpdateOpError`, `UpdateOpError`, Task 5), `'../../../shared/semver.js'` and `'./resolve.js'` (`type EligibilityRow` and one value, W2's `floorOf` — `resolve.ts` is L1 itself, so the value import keeps this file L1, D-3403) — four specifiers, pinned by Task 4's import-block assertion; `UPDATE_GATE_CAP` comes from `shared/api.ts` directly, not through `resolve.ts`'s re-export; no `fs`, no store, no fastify, no `FleetClient`, no `Runner`, no timer; it declares its own structural `DispatchRow` (the consumer declares the port). `server/src/update/converge.ts` is L3: it orchestrates the act through injected ports only (no `node:sqlite`, no `db.js`, no store reach — the update-ring scan). Both join `UPDATE_RING_FILES` (Task 4 and Task 5, one line replaced in place). Every file under `server/src/update/` imports shared modules as `'../../../shared/<x>.js'` (ruling R7).
- **`coord.db` stays synchronous** (`tx()`, `db.ts:245`, `BEGIN IMMEDIATE`): every new `CoordStore` writer has a ONE-LINE signature with a return type (`mail-hardening.test.ts`'s `SIG`), puts its guard in the `WHERE`, returns a result union (never `void`), and appears in `WRITER_GROUPS`. The dispatcher never `await`s inside a store `tx`, and never `await`s between `planDispatch` and `dispatchNode` (D-3377).
- **One writer per column group**: request columns — `requestNode` sets, `settleNode`/`ackNode` clear (no `clearRequest`: `ackNode` already clears, W2 D-3183); lease columns — `dispatchNode` (acquire), `releaseLease`, `settleNode`, `ackNode`, and `noteDispatchRefusal` (`updateDetail` only, on an `idle` row, D-3375). A refusal or a drop NEVER clears a request (decision 7).
- **At most one busy lease fleet-wide**: `dispatchNode`'s `WHERE` is `updateState IN SETTLED AND supersededBy IS NULL AND NOT EXISTS (SELECT 1 FROM nodes WHERE supersededBy IS NULL AND updateState NOT IN SETTLED)` in ONE `tx`; `NOT IN SETTLED` is W2's busy (an out-of-vocabulary token is busy, the `unknown`-is-busy direction).
- **Result by re-measurement, never by the reply**: `accepted` holds the lease and triggers `triggerInventory()`; only W2's sweep (`sweepPlanFor` → `settleNode`) or a met request (D-3380) settles a row.
- **Units**: every `coord.db` column is epoch **ms**; the deadline is `cfg.updateDeadlineMs` (`CCRC_UPDATE_DEADLINE_MS`, default `900_000`) measured from the later of `updateStartedAt` and `reportedUpdatedAt` (both ms — W2's validator converted the report's SECONDS once); `UPDATE_SPAWN_TIMEOUT_MS = 20_000` (agent and local spawn) is strictly below `UPDATE_OP_TIMEOUT_MS = 30_000` (the server's `FleetClient.request` deadline for the op), pinned in Task 1 (D-3374).
- **Role gate**: the dispatcher runs iff `cfg.role === 'server' || cfg.role === 'both'` (W2 Task 9); a fleet-reached node is the row whose `agentOps` is NOT NULL, a locally spawned node the row whose `agentOps` IS NULL (decision 11 — `agentOps` NULL is "no agent by construction", and is never refused for `agentOps`). A move that cannot be sent — no link wired, the link down, the LIVE `FleetState.agentOps` lacking `update`, no local spawner — is noted and takes NO lease (D-3398).
- **Box token never writes intent** (decision 15): `apply` and `rollback` call neither `requireMailToken` nor `checkMailToken`, are not in `gate.ts`'s `EXEMPT`, are registered AFTER W2's ack handler and BEFORE the projection read (which stays LAST), and no comment in `update/routes.ts` spells `app.get('`/`app.post('` or either box-token call with its parenthesis (W2 Task 13's three scanner facts).
- **Census numerals** (Task 6, measured on the merged tree before editing): `scanRoutes('update/routes.ts').length` 5 → 7; `ROUTES.length` 86 → 88; the `httpCount` digit comments 83 → 85; `gate.ts`'s header "all 83 routes" → "all 85 routes"; `EXEMPT` (33 keys, 32 HTTP) and every lane numeral (README/`gate.ts` "twenty-seven", "twenty-four"; `ALL_LANES.length === COORD_LANES.length + 3`) UNCHANGED (D-3388); `UPDATE_DOORS` 4 → 6.
- **Wire discipline**: additive only; `FLEET_PROTO`/`FLEET_PROTO_MIN` stay 1; `ResErr.detail?` is optional with ONE reader (`AgentOpError`, `server/src/remote/client.ts`), which cuts it to `UPDATE_OP_DETAIL_MAX` (D-3391); `AgentReady.ops` is `['update']` from this wave's agent (whose own `ReadyFrame` makes `ops` required, the `ccdVerbs`/`observedEpoch` idiom) and W2's `readReadyOps` stays its one reader; an older agent omitting `ops` reads `''`/`[]` and is never sent the op.
- **PWA**: every move control is ENABLED through ONE confirm sheet (`UpdateMoveSheet`, a `Sheet`, not `QuickConfirm` — D-3389); the node list it names is `planMove`'s, ordered by the shared `compareDispatchOrder`; both move methods are writes on `postJsonOr` (a 2xx whose body will not parse reads `'unreadable'`, never a failure — D-1150); tag order is `compareReleaseTags`/`isNewerTag` after `isReleaseTag`; a Darwin row still renders no Update/Roll back (D-3308) and draws no arrow (D-3309); untrusted text renders as React text; wave 3's CSS/contrast rules hold (`fleet.css` appended; `audit.mjs` `INHERITED_GROUNDS` kept exact — a retired rule's entry is removed with it; `node design/contrast-check.mjs` green); every screen test reproduces the full `afterEach`.
- **Cited files move no cited line** (ruling R13): `shared/api.ts` above `:7535`, `single-definition.test.ts` (`:32-37`, `:1274`, `:1303`, census 8) and README's anchors — every edit is appended after them or line-neutral, each task says which, and that task's green run includes `server/test/session-hook.test.ts`.
- **Tests use fixture HOMEs only** (`mkTmp`/`removeTmpFixtures`); never the live `$HOME`, a live `coord.db`, a real `~/.local/bin/ccrc` or a real `systemd-run`: the agent's spawn is the injected `AgentOpts.spawnUpdate`, the server's the injected `Deps.updateRunner` (a `LocalUpdateSpawn` built by `localUpdateSpawnFor` over a recording `Runner`); a test that spawns a real child spawns a fixture script under the fixture HOME.
- **Suites run in the foreground, one file at a time, inside the package, timeout ≥ 600000 ms**: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts` (agent and pwa likewise; `npm ci` first where `node_modules` is absent) — never bare `npx vitest`; the type gate is CI's own `Typecheck` step, `./node_modules/.bin/tsc --noEmit`, in `server/` and `agent/` (`npm run build` in `agent/` is plain `tsc`, which also emits the gitignored `agent/dist` — Tasks 1–2 use it as a compile check), and `npm run build` in `pwa/`; Task 9 runs the server suite sharded and the agent and pwa suites whole.
- **No residue in tracked text**: no hostname, username, absolute home path, docserver URL or org name; `server/test/topology-clean.test.ts` runs after `git add` and before every commit that adds a file.
- **Deviation numbers are issued by the allocator** (`POST /api/ledger/deviations`) and defined in the same act. This plan's departures carry the numbers the coordinator minted for run 132 on 2026-09-23. A departure found while executing takes the next unspent number of the run's RESERVE block, named in the wave brief, and is defined in `## Deviations found` in the same commit that first cites it; an unspent reserve number is never written as a `D-` token anywhere (`deviation-refs.test.ts`), and a concrete `D-TBD-` spelling never lands (`dtbd.test.ts`).
- **Mutation-table discipline**: every guard ships with a test that goes red when the guard is removed or mutated, measured before/after; each task names the §18 rows it pins. TDD red-first.
- **Commit on the workspace branch only** — at least one commit per task, `feat(update): …` / `test(update): …`, never a separate feature branch.
- **A rollback target's channel can be stale** (carried from W2's D-3215, ruling R21): an OLDER off-page stable release that is demoted while a newer stable is GitHub's latest is never re-read, so `coord.db` still reads it channel `stable`; a rollback target is chosen from `releases` rows, so its channel badge can be stale; the dispatcher never relies on a rollback target's channel (of the target's releases row, `moveRefusal`'s rollback arm asks only that it exists — yanked permitted — and that this node has not refused the tag).

## Review Focus

Failure modes the spec implies but no §18 row exercises, most likely first:

1. **A request met out of band is never cleared.** The phase table settles only a BUSY row whose report changed; a node that reached the requested tag some other way — a CLI `ccrc update` on the box, `ccrc rollout`, or a detached run that finished after the server's op request timed out and released the lease `idle` — keeps `requestedTag` standing forever, and every later sweep re-dispatches a move that is already done (answered `busy` while it runs, then `not-newer`). **Task 4** adds the plan cases (an `idle` row whose `currentVersion` equals `requestedTag` → a `met` entry, never a move; an `update` request below current → `not-newer`, never met); **Task 5** adds the end-to-end late-`accepted` case: the op times out, the lease releases `idle`, the fixture node then converges, and the next run settles the request through `settleNode` with no second op sent.
2. **The order under partial eligibility.** "Fleet-role before server-role" is trivially true when both nodes are eligible; it breaks when the fleet node has an outstanding request but is unreachable, busy, or refused, and the server node is eligible — a naive "first eligible" moves the server first. **Task 4** adds: fleet requested + unreachable, server requested → no move, the server row noted `waiting-for-fleet` (D-3381); fleet refused `no-detach-cap` → the server still waits until the fleet request is acked; fleet with NO request → the server moves; a `null`-role row (rank 2) waits like a server row; the same order from `planMove` in the PWA (**Task 8**: the sheet names the fleet node first whatever the wire order); and **Task 6**'s `{all: true}` writes no request the dispatcher could only refuse, so a macOS or capless fleet node cannot park the server behind it (D-3401). An `auto`-driven server move is held the same way behind a fleet row auto has not yet converged — unreachable, refused, or not yet moved — while an operator's request on the server is never held by it (D-3402; **Task 4**'s auto-hold table, **Task 7**'s gated server behind a gateless fleet under `'*'` auto).
3. **A standing in-flight report whose writer died.** `~/.ccrc/update.json` persists; a detached run killed after writing `installing` leaves a phase in `IN_FLIGHT_UPDATE_PHASES` with nobody holding `_upd_lock`, and the agent's busy check answers `busy` to every op forever — while the reverse (the lock held between `_upd_lock` and the first `resolving` write) reaches the spawn and comes back `spawn-failed` with the lock sentence. **Task 2** adds both cases (the dead-writer report answers `busy` with a detail naming the phase, target and start second; a held lock with no in-flight report answers `spawn-failed` carrying `ccrc: update: another update holds …` — `_ccrc_die`'s `$PROG: ` prefix included — as its first stderr line; a FIFO planted at `update.json` is refused by `fstat` after an `O_NONBLOCK` open instead of blocking the agent's event loop); **Task 5** adds "a `busy` answer is re-sent at most once per run and never halts, and the row's `updateDetail` names what the node said", and the server-role half of the FIFO case: a FIFO at the server's own `update.json` is refused unopened by W2's `readNodeFile`, so the dispatch run completes (D-3384).
4. **The reply outlives the request.** The server gives up on an op after `UPDATE_OP_TIMEOUT_MS`; if the agent's own spawn deadline were longer, a timeout would release the lease `idle` while the node was still starting a detached run, and the next sweep would dispatch the same node again. `ccrc rollback --detach` asks the release host whether the tag exists BEFORE it detaches (wave 4 Task 7), so the parent is not instant. **Task 1** pins `UPDATE_SPAWN_TIMEOUT_MS < UPDATE_OP_TIMEOUT_MS`; **Task 2** adds a parent that outlives `UPDATE_SPAWN_TIMEOUT_MS` → `spawn-failed` naming the timeout; **Task 5** adds the server-role local spawn under the same bound (a `LocalUpdateSpawn` that never exits → transport `timeout` → `idle` exactly at `UPDATE_SPAWN_TIMEOUT_MS`, request standing, its late exit writing nothing, and a run while that parent still lives answering `busy` instead of starting a second one, D-3400) and a late agent answer after the server's timeout being dropped (no second lease write).
5. **A refusal note that overwrites a verdict or churns.** Every run re-plans every node; a refusal noted on each run would rewrite `updateDetail` every 60 s, and a note written onto a `failed` row would erase the `provenance:` prefix the halt exception reads — turning a non-halting provenance verdict into a halting failure. **Task 3** adds: `noteDispatchRefusal` writes only on an `idle` row (a `failed`/`reverted`/busy row answers `not-idle` and is untouched) and only when the text differs (`changed: false` on a repeat); **Task 4** adds the provenance-verdict row (`failed`, `provenance: …`) as non-halting AND never noted (`DispatchPlan.refusals` lists idle rows only); **Task 5** asserts two consecutive runs over the same refused fixture perform one write.

## Deviations found

Plan-level departures from the spec's literal text, each carrying the number the allocator issued for it (run 132, minted 2026-09-23). The first three were fixed by the coordinator while decomposing the wave; the rest were found while writing the task interfaces or the task bodies, and each says which task found it. Where two tasks found the same departure it is one bullet naming both. D-3402 was proposed writing Task 7 and adopted in review of Task 4 (its bullet says so). The four bullets after D-3403 (D-3492, D-3493, D-3494 and D-3495, issued to run 132 on 2026-09-23 when this plan was re-pointed) were found re-pointing it onto W2's executed tree (2b5d4ce1).

- **D-3370** — Spec §10 names the op's `ResErr` words (`bad-tag`, `bad-kind`, `busy`) inline and adds `bad-request` from the envelope, but `ResErr.err` is a bare `string` with no closed vocabulary anywhere in the tree (`shared/agent-protocol.ts`'s `export interface ResErr { t: 'res'; id: number; ok: false; err: string }` — W2 changed this file, so quoted, not by line; every existing literal — `forbidden`, `not-implemented`, `bad-request` — is a free string matched by ad hoc comparisons, and `FleetClient`'s rejection carries it as an opaque `Error.message`, `client.ts`'s `entry.reject(new Error(typeof msg.err === 'string' ? msg.err : 'error'));`). The op's own words are declared ONCE in `shared/agent-protocol.ts` (Task 1): `UPDATE_OP_ERRORS = ['bad-tag', 'bad-kind', 'busy', 'spawn-failed'] as const`, `UpdateOpError`, `isUpdateOpError`; the agent's handler sends only these (plus the envelope's `bad-request`, which it never sends for this op), and the dispatcher's answer mapping (`classifyOpAnswer`, Task 5) switches over `UpdateOpError` with an exhaustive `never` arm, so a word added on one side alone is a compile error. The envelope's other words stay free strings. Pinned by Task 1's array/guard agreement and single-holder case, and Task 5's exhaustiveness line. Cost if wrong: none; one array.
- **D-3371** — Spec §10 says the handler refuses "when `~/.ccrc/update.json` says an update is in flight"; W2's read admission (`isCcrcNodeFile`, W2 Task 8) exists for the SERVER's wire reads through `checkPath`. The agent's busy check is the agent's own decision about its own box, so `readInFlightReport` reads `path.join(home, CCRC_DIR_NAME, NODE_FILES.report)` directly — the `readObservedEpoch` read-and-fold idiom (`agent/src/server.ts:657-664`, `export function readObservedEpoch(home: string): number | null {`), never `checkPath` — opening it `O_RDONLY|O_NONBLOCK` and refusing it unless `fstat` reports a regular file of at most `UPDATE_REPORT_READ_MAX` (65536) bytes (found writing Task 2: a FIFO at that name would otherwise block the agent's whole event loop inside `open(2)`), and parses it with the ONE shared parser `inFlightReport` (Task 1, `shared/api.ts`), which the server-role local spawn also uses (Task 5). Absent, unreadable, over-cap, not a regular file, unparseable or not-in-flight → not busy (the node's own `_upd_lock` then decides, and a held lock answers `spawn-failed` with the lock sentence). Pinned by Task 2's busy and not-busy cases (a FIFO among them; the `O_NONBLOCK` mutation hangs the process and is measured under `timeout 60`, exit 124 the red) and a source scan that the `update` case names no `checkPath`. Cost if wrong: none; a same-user writer who plants an in-flight report makes the op answer `busy`, which that writer could achieve by holding the lock anyway.
- **D-3372** — Spec §10 says the op answers `ResOk {accepted: true}` and that `accepted` "means a unit was queued", without saying when the agent may say so. The agent answers `accepted` only after the `--detach` PARENT exits 0 — which wave 4's `_upd_detach` does at once after `_upd_phase queued` and a successful `_svc_run_detached` — and a non-zero exit (a refused `--detach` on Darwin, a held or unmeasurable lock, `systemd-run` failing, rollback's unpublished tag, exit 2 for an argument refusal) answers `spawn-failed` with the parent's first non-empty stderr line, `_ccrc_die`'s `ccrc: ` prefix included, every run outside 0x20–0x7E turned into one space and trimmed (W2 Task 11's `printableDetail` rule, applied per line), cut to `UPDATE_OP_DETAIL_MAX = 200` characters (`firstStderrLine`, Task 1). So "accepted" is a measured fact about the node (a `queued` report exists and a unit was started), never "a process was forked". Pinned by Task 2's exit-0 → `accepted` and exit-1 → `spawn-failed` cases (the detail is the fixture's first stderr line, byte for byte). Cost if wrong: the op's answer waits for the detach parent — bounded by `UPDATE_SPAWN_TIMEOUT_MS` (D-3374).
- **D-3373** — Found writing Task 1's interface. D-3372 carries a stderr line and `busy` carries what `update.json` said, but `ResErr` has only `err: string` and `FleetClient` rejects with `new Error(err)`, dropping any other field. `ResErr` gains an OPTIONAL, additive `detail?: string` (absence permits; no `FLEET_PROTO` bump), and its ONE reader is `client.ts`'s rejection, which now rejects with `AgentOpError` — a subclass of `Error` whose `message` is still `err` (so every existing `.message` comparison — `caps()`, `createRunner`'s catch arm at `remote/runner.ts:185`, the exec callers — is unchanged) and which carries `code: string` and `detail: string | null` (cut at that reader, D-3391). The agent's `fail` gains the optional `detail`, spread only when given, and a typed `failUpdate(id, err: UpdateOpError, detail?)` (Task 2). A transport failure stays a plain `Error` (`disconnected`, `timeout`, `aborted`), so the dispatcher tells "the node answered" from "the link failed" by `instanceof`, never by a message string. Pinned by Task 1's client cases (a `ResErr` with and without `detail`; an existing `.message` caller unchanged; a dropped link not an `AgentOpError`). Cost if wrong: none; one optional field.
- **D-3374** — Found writing Task 1's interface. Spec §10 says the op "rides `FleetClient.request` (… 15 s default timeout …)". The agent's answer waits for the `--detach` parent (D-3372), and `ccrc rollback --detach` asks the release host whether the tag exists before it detaches (wave 4 Task 7's existence check, a network round trip), so 15 s is not a bound this wave controls. The agent bounds its spawn with `UPDATE_SPAWN_TIMEOUT_MS = 20_000` (a parent still running is killed and answered `spawn-failed` naming the timeout) and the server passes `UPDATE_OP_TIMEOUT_MS = 30_000` to `request()` for this op only, both declared in `shared/agent-protocol.ts` and held `UPDATE_SPAWN_TIMEOUT_MS < UPDATE_OP_TIMEOUT_MS` by a test, so the agent's answer always arrives before the server gives up (Review Focus 4). The server-role local spawn is raced against the same `UPDATE_SPAWN_TIMEOUT_MS`. Cost if wrong: a dispatch to a dead link holds the single-flight for up to 30 s instead of 15 s.
- **D-3375** — Found writing Task 3's interface. Spec §9/§10 say a capability refusal is "a settled, NON-halting refusal shown in `updateDetail`", and §12 says `{all: true}` "reports per-node refusals through `updateDetail` as the dispatcher reaches each" — but a refusal happens BEFORE any lease is acquired, and §6 names only `dispatchNode`, `releaseLease` and `settleNode` as lease writers (W2 added `ackNode`, D-3183); `releaseLease` refuses a row that is not busy (`not-busy`), and `settleNode`/`ackNode` clear the request, which decision 7 forbids for a refusal. A fifth lease-group writer, `noteDispatchRefusal(nodeId, detail)`, writes `updateDetail` ONLY, ONLY on a live row whose `updateState = 'idle'`, and ONLY when the text differs (`changed: false` otherwise, so a refusal re-planned every sweep writes once — Review Focus 5); it never touches a `failed`/`reverted` row, whose detail is the verdict the halt reads. `WRITER_GROUPS`' lease row gains it. Pinned by Task 3's store cases and the writer-group scan, and by Task 4/5's "refused twice, written once". Cost if wrong: one more method in the lease group.
- **D-3376** — Found writing Task 3's interface. Decision 8 says moving down is "an explicit verb, an explicit button … never a resolver outcome", and §10 lets `dispatchNode` acquire for either kind. `dispatchNode(nodeId, target, 'rollback', …)` therefore also requires, in its `WHERE`, `requestedKind = 'rollback' AND requestedTag = target`: a rollback lease can be acquired only for a rollback an operator requested, so a planner bug that turns an automatic move into a rollback is refused by the store (`no-request`) and writes nothing. An `update` acquire carries no such clause (auto-driven updates have no request). Pinned by Task 3's "a rollback with no rollback request is refused `no-request` and writes nothing" and the mutation that drops the clause. Cost if wrong: none; a clause.
- **D-3377** — Found writing Task 4's interface. Spec §10 says `dispatchNode` "checks, in one transaction: the capability set … the direction … and the lease". Capabilities and direction need the semver comparator, the release catalogue and the caps vocabulary — policy the store must not hold (L1 vs L3). They are decided by the pure `planDispatch` over rows read by `nodes()`/`releases()`/`refusalsFor()` in the SAME synchronous stretch as `dispatchNode`'s acquire (`runDispatch` does no `await` between its role gate and the acquire, and `node:sqlite` is synchronous in a single-threaded process), and the acquire's `WHERE` re-checks everything SQL can: settled, not superseded, no other busy row, and for a rollback the request (D-3376). Pinned by Task 5's source scan that no `await` sits between `runDispatch`'s role gate and `.dispatchNode(` in `converge.ts` and by the store's two-sweeps case. Cost if wrong: a second server process over the same `coord.db` could plan on rows the first changed — this design runs one.
- **D-3378** — Found writing Task 4's interface. Spec §10: "`failed` with a `provenance:` detail writes this node's refusal (§8), returns the node to `idle` on the next sweep". No lease writer can move `failed` → `idle` without clearing the request (`settleNode` refuses a halted row; `ackNode` clears the request and the refusals — the operator's act); a new writer for it would be a sixth. The row STAYS `failed` with its `provenance:` detail; `isHalting` excludes it (the prefix is `PROVENANCE_DETAIL_PREFIX = 'provenance:'`, the word W2's `sweepPlanFor` tests), `dispatchNode` accepts it (`failed` is settled), and the resolver has already moved on to the next release eligible FOR THIS NODE. So the observable promise — no halt, the next eligible release dispatches, other nodes untouched — holds; only the word on the row differs. Pinned by Task 4's "a provenance-failed row does not halt and is eligible" and Task 5's end-to-end case (a second node dispatches while the first reads `failed` / `provenance: …`). Cost if wrong: the inventory shows `failed` where the spec says `idle`, beside the refusal's own line.
- **D-3379** — Found writing Task 4's interface. Spec §10: "a node with `currentVersion NULL` (unversioned) is never 'not newer'". `currentVersion` is also NULL when the stamp could not be READ (`stampRead` ≠ `'ok'` — EACCES, a symlink, garbage, an unmeasured placeholder), which W2 keeps apart from unversioned (§18 "`stampRead` keeps EACCES from unversioned") and wave 3 keeps apart on every surface (D-3307). The dispatcher treats ONLY `stampRead = 'ok'` with a NULL version as unversioned (`UNVERSIONED_DETAIL`); any other `stampRead`, or `'ok'` with a version that is not a release tag, refuses the update `stamp-unread`, non-halting, and the route answers it as `409 stamp-unread`; the PWA's `moveLines` says `stamp not read` for such a node, never `unversioned` (Task 8). A rollback is not stopped by an unread stamp — it names its own direction. Pinned by Task 4's pair (an `ok` stamp with no version dispatches with the unversioned detail; an `unreadable` stamp is refused), the route case and Task 8's line case. Cost if wrong: a node whose stamp cannot be read waits for its stamp to read instead of being moved blind.
- **D-3380** — Found writing Task 4's interface (Review Focus 1). Spec §10 says only `settleNode` (convergence) and `ack` clear a request, and §8's table reaches `settleNode` only for a busy row whose report changed. A request whose tag the node ALREADY runs (`stampRead = 'ok'` and `currentVersion = requestedTag`, either kind) on an IDLE row is settled by the dispatcher through `settleNode(nodeId, 'met: <tag>', null)` — W2's writer, whose `WHERE updateState NOT IN halted` admits an `idle` row and refuses a halted one, which is why a `failed`/`reverted` row's request is never `met` (found writing Task 4) — and never dispatched. That is convergence measured, so decision 7's "cleared only by convergence or by the operator" holds. Pinned by Task 4's `met` plan cases (including "met needs an idle row whose stamp read") and Task 5's late-`accepted` case. Cost if wrong: none; a request for the running tag has nothing left to do.
- **D-3381** — Found writing Task 4's interface (Review Focus 2). Spec §10 orders "fleet-role nodes before server-role nodes" and "continues down the eligible list", without saying whether a fleet node that is requested but not dispatchable (unreachable, refused) is passed over. A move for any node of rank ≠ 0 — a server-role or `both` row (rank 1) and a `null`-role row (rank 2, found writing Task 4: an unnamed role never jumps the fleet) — is DEFERRED while any live fleet-role row holds an outstanding request (`requestedTag` set, whatever its `requestedKind` reads, its state or its reachability); the waiting row — when it is idle and its own move is otherwise clear — is noted `waiting-for-fleet — <fleet label>'s request for <tag> is outstanding — <label> moves to <target> after it is settled or acked` (the fleet row reaches `dispatchRefusalDetail` as its `RefusalBlocker`), and moves on the first run after the fleet request is settled or acked. A fleet-role row with no request never blocks a REQUEST; an `auto`-driven server move has its own hold, D-3402. Pinned by Task 4's partial-eligibility table and Task 8's `planMove` order; Task 6's D-3401 keeps `{all: true}` from writing a fleet request that could only park the server. Cost if wrong: a fleet node that can never move holds the server's request until the operator acks the fleet row.
- **D-3382** — Found writing Task 5's interface. Spec §8's table maps the in-flight phases to `applying`, but no lease writer moves `pending` → `applying`: W2's `sweepPlanFor` answers `in-flight` → no action, and wave 5's writers are the acquire, the release, the settle, the note and the ack. `dispatchNode` acquires `pending`, and the row reads `pending` until the sweep settles or releases it; the PWA's state line already shows the report's phase beside it (`pending — installing`, wave 3's `nodeStateLine`). `BUSY_UPDATE_STATES` counts both, so nothing that reads busy-ness changes. Pinned by Task 5's end-to-end case reading `pending` while the report says `installing`. Cost if wrong: one word on the inventory row.
- **D-3383** — Found writing Task 5's interface. Spec §19 lists one new file, `server/src/update/dispatch.ts`, for the dispatcher. Its decision is pure (L1) and its act orchestrates a store, a link and a spawn (L3); ring membership is a property of a file's imports (W2's D-3187 split `resolve.ts`/`project.ts` for the same reason). The act lives in a sibling, `server/src/update/converge.ts`, which imports `dispatch.ts`; `dispatch.ts` stays L1. Pinned by the update-ring scan (both files in `UPDATE_RING_FILES`) and an import-block assertion on `dispatch.ts`. Cost if wrong: one more file in the directory.
- **D-3384** — Found writing Task 5's interface. Spec §10 gives the busy refusal to the agent's handler only and spawns the server node "locally … through its `Runner`" with no busy check; without one, a CLI `ccrc update` already running on the server box makes the local `--detach` parent exit 1 on `_upd_lock` and the dispatcher would read `spawn-failed` — a halting `failed` for a node that was merely busy. The local path reads `NODE_FILES.report` under `cfg.ccrcDir` through W2's bounded `readNodeFile` over `localIo` (lstat to a regular file, size-capped, raced against one `openPoolReadDeadline(INVENTORY_BUDGET_MS)`; found in review: a plain `readFileMeasured` there blocks for good on a FIFO, after the lease is taken, and the single-flight dispatch run never settles) AFTER the acquire and before the spawn, and answers `busy` through the same `inFlightReport` parser the agent uses (D-3371), so both roles map an in-flight node to `idle` with the detail. Pinned by Task 5's server-role busy case and its FIFO case (mutation M19). Cost if wrong: none; one read.
- **D-3385** — Found writing Task 6's interface. Spec §12: "`{all: true}` = every live, non-superseded node", answered `202 {requested}`. A node already at or above the named tag has nothing to converge to, and writing it a request the dispatcher can only refuse `not-newer` leaves a request standing until ack (decision 7: a refusal never consumes it). `{all: true}` therefore writes a request only for a node the move would take FORWARD, and — without `tag` — only for a node with a `desiredTag`; the reply is `202 {ok: true, requested, skipped}` (`MoveRequestAnswer`), `skipped` naming every other live node with its `MoveSkip.why` (a single-node move answers `skipped: []`); a single named node with no `desiredTag` and no `tag` answers `409 no-desired` with the node's `resolveDetail`. D-3401 (Task 6) widens the skip rule from "not forward" to every refusal the dispatcher itself would give. Pinned by Task 6's `{all: true}` cases and Task 8's sheet. Cost if wrong: the reply carries one more field than the spec's.
- **D-3386** — Found writing Task 6's interface. Spec §12's single-node `409 busy` does not say whose lease. It answers `busy` only when the NAMED node's own `updateState` is busy; a lease held by ANOTHER node is not a refusal — the request is written and waits its turn (one node at a time), `202`. Likewise `409 halted` names the halting rows in `detail`. Pinned by Task 6's pair (own row `pending` → `409 busy`; the other row `pending` → `202`, request written). Cost if wrong: none.
- **D-3387** — Found writing Task 6's interface. Spec §12's `rollback` row lists `unknown-tag` / `no-previous` / `refused-by-node` / `halted` / `busy` / `no-rollback-cap`, but the rollback argv carries `--detach` and rides the op, so the dispatcher also refuses it `no-detach-cap` and, over the link, `agent-predates-update-op` — and "the route evaluates the dispatcher's own predicates synchronously". Both words are answered by the rollback route too, from the same `moveRefusal` call. Pinned by Task 6's rollback cases for both. Cost if wrong: none; the route says what the dispatcher would.
- **D-3388** — Found writing Task 6's interface. The decomposition lists "README's lane numeral" among Task 6's census moves, but `apply` and `rollback` consult no box token, so `ALL_LANES` does not grow and every lane numeral (README's auth paragraph and `gate.ts`'s reason 2 and CSRF note: "twenty-seven", "twenty-four") is UNCHANGED; only the route counts and `UPDATE_DOORS` move. Task 6 runs the census to prove the numerals still derive, and edits no lane word. Pinned by `box-token-census.test.ts`'s "README states the DERIVED lane counts" staying green with no README edit in Task 6. Cost if wrong: none.
- **D-3389** — Found writing Task 8's interface. Spec §13 puts the banner's action "behind `QuickConfirm`", whose confirm button runs `onConfirm(); onClose();` unconditionally (`QuickConfirm.tsx:33-34`) — it closes on every tap and cannot render a refusal; `AbandonSheet.tsx:1-12` records choosing `Sheet` for exactly that reason. A single-node `apply`/`rollback` can `409` synchronously, and one sheet serves all five controls so they cannot disagree, so every move opens `UpdateMoveSheet` (a `Sheet`): it names the nodes in order, sends, renders a refusal IN the sheet through `updateErrorText` (with the nodes already requested, when some were), and closes only on a 2xx; the banner re-polls through its new optional `onMoved` prop, which `FleetScreen` binds to its one poll's `reload`. Pinned by Task 8's "a 409 renders in the sheet, which stays open", the fleet-screen `onMoved` case, and the source scan that `UpdateBanner.tsx` and `SettingsScreen.tsx` import no `QuickConfirm`. Cost if wrong: none; the banner's sheet is taller than a `QuickConfirm`.
- **D-3390** — Found writing Task 8's interface. Spec §13: a release row reads **Roll back** "when every live node runs a newer one" and sends `rollback {to}`; spec §12's `rollback` route is single-node (`{nodeId, to?}`). The release row's Roll back therefore posts one `rollback {nodeId, to}` per node, in `compareDispatchOrder` order (fleet first), stopping at the first refusal, which the sheet renders with the nodes already requested named; the dispatcher still moves them one at a time. Pinned by Task 8's two-node rollback case (two posts, fleet first; a refusal on the first leaves the second unsent). Cost if wrong: a two-node rollback is two requests, which is what the dispatcher needs anyway.
- **D-3391** — Found writing Task 1. D-3373 gives `ResErr.detail` one reader, the rejection in `client.ts`. The agent bounds its own details to `UPDATE_OP_DETAIL_MAX` (200) through `firstStderrLine`, but the wire does not enforce that on a peer, and the dispatcher writes what it reads into an inventory row. So `AgentOpError`'s one reader cuts `detail` to `UPDATE_OP_DETAIL_MAX` (`msg.detail.slice(0, UPDATE_OP_DETAIL_MAX)`, a value import `client.ts` gains from `shared/agent-protocol.ts`). A peer that ignores the agent's limit therefore cannot put an unbounded string into a `coord.db` row. This is the second line of defence: Task 5's `classifyOpAnswer` still passes every node-supplied word through `firstStderrLine` before any store write. Pinned by Task 1's "a detail longer than UPDATE_OP_DETAIL_MAX is cut at this reader" case. Cost if wrong: none.
- **D-3392** — Found writing Task 2. Spec §10 gives the handler one `busy` refusal, for an in-flight `update.json`. The agent also answers `busy`, with the detail `an update op is already spawning on this agent`, while it is waiting on a `--detach` parent of its own. That check is ONE gate per agent process: `interface UpdateGate { spawning: boolean }`, made once in `startAgent` and handed to every connection as `ConnCtx.updateGate`. The skeleton had a per-connection `updateSpawning` flag. A server whose link drops mid-spawn reconnects on a NEW socket and re-sends the op. With a per-connection flag, a second `--detach` parent would start beside the first, and since both parents only PROBE the lock (wave 4 Task 3), both would write `queued` and start a unit. Pinned by the second-connection half of Task 2's parked-spawn case (busy on the same connection AND on a second one; after release the first answers `accepted` and a third op spawns). Cost if wrong: none; it is one object.
- **D-3393** — Found writing Task 2. Spec §10 says what the op answers when the `--detach` parent exits non-zero, but not what it answers when the launcher cannot be started at all. `realUpdateSpawn` maps a SPAWN error (`ENOENT`/`EACCES`, an error whose `syscall` is `spawn …`) to code 1 with stderr `could not start the launcher (<errno code>)`. The op therefore answers `spawn-failed` with that sentence. Without it, a node with no `ccrc` installed would show `spawn-failed: no message`. `realUpdateSpawn` runs `execFile` with `encoding: 'utf8'` and `UPDATE_SPAWN_MAX_BUFFER` (1 MiB). Pinned by Task 2's absent-launcher case (`could not start the launcher (ENOENT)`). Cost if wrong: none.
- **D-3394** — Found writing Task 4 and again writing Task 6; one departure. Spec §12's `apply` row requires "a releases row that is listed, not yanked and not refused by this node" and answers every failure of it as `409 unknown-tag`. Task 4's `moveRefusal` answers `refused-by-node` for a tag THIS node has refused, for BOTH kinds, after the `unknown-tag` check. A node refusing a tag is a different fact from the catalogue not listing it. One word for both would make every caller work out again which was meant, and the remedy differs: ack the node, versus pick another tag. The `apply` route answers whatever word `moveRefusal` returns (Task 6 has no catalogue pre-check of its own), so `apply`, `rollback` and the dispatcher's noted refusal all use one word, and `UPDATE_ERROR_TEXT` gives it its own sentence telling the operator to ack the node. Another node's refusal is never an input. Pinned by Task 4's "an update to a refused tag is refused-by-node too", Task 6's apply `refused-by-node` case and its route/planner agreement table. Cost if wrong: an `apply` 409 names the refusal where the spec's text says `unknown-tag`.
- **D-3395** — Found writing Task 4. Spec §12 requires an `apply` tag to be a releases row "that is listed, not yanked and not refused". The dispatcher reads "listed" as `bundleListed = 1`, the resolver's own eligibility column (W2 Task 12's `eligibleTags`). So `moveRefusal` refuses an update to a row with no provenance bundle with `unknown-tag`, before a node spends a detached run on a release it would refuse on provenance anyway. That covers a requested update as well as an automatic one. A rollback needs only a releases row: yanked and bundle-less rows are permitted (decision 8). Pinned by Task 4's "an update needs a listed, unyanked row with its bundle — else unknown-tag". Cost if wrong: an operator cannot request an update to a release published without its bundle.
- **D-3396** — Found writing Task 4. Spec §10 makes a node eligible whenever `requestedTag` is set. A request whose `requestedKind` reads `null` is a stored word this build cannot name (W2's reader folds it, D-3181; Task 3's `RequestNodeResult.replaced.kind` is `RequestKind | null` for the same reason). Such a request moves nothing, and `auto` does NOT take over that node. Like every undispatchable request (decision 7), it stands until an `ack` or until a newer build that can name its kind settles it. It still counts as an outstanding fleet request for D-3381. Pinned by Task 4's "a request whose kind this build cannot read moves nothing, and auto does not take over". Cost if wrong: a node carrying a newer build's request kind sits still until acked.
- **D-3397** — Found writing Task 5. Spec §10 spawns the server node "locally … through its `Runner`", and the skeleton put `updateRunner?: Runner` on `Deps`. A raw `Runner` there would let any route run any argv, `ccd` included, outside `runCcd`/`CcdArgv`. That is the guarantee task 13S built and `ccdargv-brand.test.ts` pins: nothing downstream of the composition root holds a runner. So the field is a two-template CAPABILITY, `LocalUpdateSpawn = (kind, tag) => Promise<ExecResult>`, built at the composition root by `localUpdateSpawnFor(realRunner, cfg.home)` (the `ccdRunner` idiom) in both `deps` arms of `index.ts`. It runs only `$HOME/.local/bin/ccrc <update|rollback> --to <tag> --detach --from pwa` through `updateLauncherPath`/`updateSpawnArgv`, and a non-tag or non-kind throws `RangeError` before anything runs. `ConvergeDeps.runLocal` is a `LocalUpdateSpawn | null`, and `ConvergeDeps` carries no `home`. Pinned by a `@ts-expect-error` line saying a raw `Runner` is not a `Deps['updateRunner']` (compiled by `typecheck-tests.test.ts`; mutation M14), by the exact-argv cases and by the `'; rm -rf ~'` throw case. Cost if wrong: none; one factory.
- **D-3398** — Found writing Task 5. Spec §10 says the dispatcher never sends the op to a link-reached node whose `agentOps` lack `update`. That `agentOps` is the row's value from the last sweep and can be up to 60 s old. After the fleet box is rolled back to a pre-op build, or before any `ready` frame (`FleetState.agentOps` `undefined`), the LIVE state can lack the op while the row still carries it. `runDispatch` therefore re-reads the live state after the plan and BEFORE the acquire, together with three other unsendable conditions: no link wired, link down, and no local spawner (`NO_FLEET_LINK_DETAIL`, `LINK_DOWN_DETAIL`, `NO_LOCAL_RUNNER_DETAIL`). Any of these notes the row (for the ops case, `agent-predates-update-op — …`), takes no lease, sends nothing and leaves the request standing (`MoveOutcome` `not-sent`). The skeleton instead acquired and then released `idle`. Pinned by Task 5's "advertises the op while the LIVE link does not" case (mutation M7), the link-down and no-spawner cases, and the no-link-wired case (mutation M16); the ops and link-down cases also re-run after the `ready`/reconnect and see the standing request sent, so `not-sent` is shown to be transient. Cost if wrong: none; a dropped agent is refused one sweep earlier.
- **D-3399** — Found writing Task 5. Spec §10 names `ResOk {accepted: true}` as the op's success answer and says nothing about an ok reply without it. `converge.ts`'s `linkAnswer` maps such a reply to the word `OK_WITHOUT_ACCEPTED = 'ok-without-accepted'`. It is not an `UpdateOpError`, so `classifyOpAnswer`'s any-other-word arm releases the lease `failed` with `agent answered ok-without-accepted`, which halts until ack. A malformed success is treated as a server/agent bug, never as a move. Pinned by Task 5's converge case and `update-op-answer.test.ts`'s unknown-word cases. Cost if wrong: a misbehaving agent halts the fleet instead of being believed.
- **D-3400** — Found reviewing Task 5. Spec §10 spawns the server node "locally … through its `Runner`" and says nothing about a spawn that outlives its bound. `realRunner` passes `execFile` no deadline (deliberately, `exec.ts`), so `runDispatch`'s race against `UPDATE_SPAWN_TIMEOUT_MS` stops WAITING and releases the lease `idle` with the request standing, but kills nothing. A `ccrc rollback --detach` parent asks the release host before it writes `queued` (wave 4 Task 7), so the next run could read `update.json` as not in flight and start a second `--detach` parent beside the first. Both would only PROBE the lock (wave 4), which is the hazard D-3392 closes on the agent. `converge.ts` keeps a module-private `WeakSet<LocalUpdateSpawn>` of spawns whose child has not exited. It is checked and taken with no `await` between, and an entry is cleared by the child's own promise settling, never by the bound. While the entry is set, the move answers `busy` with `LOCAL_SPAWNING_DETAIL = 'an update op is already spawning on this server'`, which releases `idle` and never halts. Not chosen: killing the parent at the bound, the agent's `realUpdateSpawn` shape. That would change `localUpdateSpawnFor`'s port away from `Runner`, which Tasks 6 and 7 build on, and would turn this role's timeout from `idle` into a halting `spawn-failed`. Pinned by Task 5's never-exiting-spawn case (a second run spawns nothing and answers `busy`; after the exit, a third run spawns) and mutations M17 and M18. Cost if wrong: a parent that never exits holds the server row at `busy` until this process restarts, visible in `updateDetail`.
- **D-3401** — Found writing Task 6; it also absorbs the departure Task 8's writer proposed under the slug apply-all-skips-darwin (skip macOS nodes with a new `not-managed` word), which is therefore not a separate departure and mints no number — `no-detach-cap` already skips them. Spec §12 says `{all: true}` covers "every live, non-superseded node", and D-3385 narrows skipping only to nodes the tag does not take forward. That rule still writes requests the dispatcher can only refuse: a macOS node (wave 4's `detach` word is Linux-only, `CCRC_CAP_WORDS_LINUX=(detach)`, so it is refused `no-detach-cap`), any other node with no `detach` word, an agent without the op, a tag this node refused, and a yanked, bundle-less or unknown tag. Under decision 7 such a request stands until `ack`. On a fleet-role row it would also defer every server-role move, through D-3381. So `{all: true}` asks the dispatcher's own `moveRefusal` about each live node, in `compareDispatchOrder`, with the fleet's halt set aside (`NO_HALT = {haltedBy: [], leaseHeldBy: null}`). It writes a request only when that answer is null. Otherwise it lists the node in `skipped` with the refusal word, typed by the new `MoveSkipWhy = Exclude<DispatchRefusal, 'halted' | 'no-update-gate' | 'no-rollback-cap' | 'waiting-for-fleet'> | 'no-desired'`. A node it skips gets no request, so `planDispatch` never considers it and the dispatcher's own note never reaches it; `{all: true}` therefore also NOTES each skip on the row, through the dispatcher's writer and sentence — `noteDispatchRefusal(nodeId, dispatchRefusalDetail(refusal, view, target))` — which is how spec §12's "reports per-node refusals through `updateDetail`" still holds (the writer refuses a `failed`/`reverted`/busy row and writes a repeated text once). `not-newer` alone is not noted: that node is already at or past the tag, which is not a refusal. The halt stays the dispatcher's to enforce at dispatch time, so `{all: true}` on a halted fleet is still `202` with the requests written. This also settles the Install-on-a-yanked-release question from Task 8: the reply is `202` with every node skipped `unknown-tag`, and no request is written. Task 8's `planMove` previews by version and OS alone, so a Linux node the server skips on caps, agent, refusal or catalogue is named in the sheet and comes back in `skipped`, and the reply is authoritative. Pinned by Task 6's darwin case (it also checks that `planDispatch` then moves the server, and that the row's `updateDetail` names the refusal), its verdict case, mutation rows 9, 13, 14 and 16, and Task 8's sheet case that says a skipped node the sheet named. Cost if wrong: an operator who wants a request left standing on a node that cannot move yet has to tap again once it can.
- **D-3402** — Proposed writing Task 7; adopted in review of Task 4 (spec §10's standing order read literally). D-3381 holds back a server-role move only while a live fleet-role row has an outstanding REQUEST, which leaves `auto` uncovered: take `auto` set on `'*'` where the fleet row cannot auto-move — it is unreachable, or it is refused `no-update-gate`/`no-detach-cap` after being offline when `auto` was set — and a planner holding only behind requests auto-moves the gated server row before the fleet, against spec §10's "fleet-role nodes before server-role nodes (the standing order: the server reads what the fleet host's hook writes; the agent caches `ccd caps` at boot)". So `planDispatch` also holds a rank ≠ 0 move whose `source` is `'auto'` as `waiting-for-fleet` while any live fleet-role row has `autoPermits(view.auto, row.channel)` and a non-null `desiredTag`, whatever its state, reachability or refusal. A converged fleet row's `desiredTag` is NULL (the resolver resolves nothing at or below its floor). So is that of a fleet row whose floor was never measured (`highestVersion` NULL with `floorRead` `'unmeasured'`, resolved `RESOLVE_DETAIL.floorUnmeasured()`), which has NOT converged. `fleetAuto` needs a non-null `desiredTag`, so the hold does not fire on such a row, and a server row's auto move is not held behind a fleet row whose floor has not been measured yet D-3492. So the hold means exactly "a fleet row has an auto move pending". That equals "the fleet has not converged" only for fleet rows whose floor has been measured. The note reads `waiting-for-fleet — <fleet label>'s auto update to <its desiredTag> has not landed — <label> moves to <target> after it does, or once that node's own auto is off` (its `RefusalBlocker` carries `auto: true`). An operator's explicit request on the server row is never held by it. The operator has two ways out: tap Update on the fleet row (a request needs `detach`, not the gate), or set that row's own intent to `auto: 'off'`. Pinned by Task 4's auto-hold table (unreachable, refused, converged or auto-off, a request never held), its rewritten two-auto case and mutation rows 9b/9c, and Task 7's end-to-end case (a gated server behind a gateless fleet under `'*'` auto: the fleet moves first once gated, then the server). Cost if wrong: a fleet row that can never auto-move holds the server's auto move until one of those two operator acts.
- **D-3403** — Found reviewing Task 4. Spec §10's direction rule names only `currentVersion` ("`update` … must be strictly newer than `currentVersion` … a node with `currentVersion NULL` is never 'not newer'"), while decision 8 says a requested `update` "moves a node only to a strictly NEWER version than its floor" and §10's offline paragraph says the dispatcher "re-checks capabilities, direction and the floor". A dispatcher that compared with `currentVersion` alone would clear an Install of v0.0.9 on a node rolled back to v0.0.8 under a v0.0.10 floor; the node's own `_upd_floor_check` would then refuse it inside the detached run, and the `failed` row that leaves halts every move in the fleet until `ack`. `moveRefusal`'s update arm therefore answers `not-newer` whenever the target is not strictly newer than W2's `floorOf(highestVersion, currentVersion)` — the resolver's own floor (D-3202: the floor file's tag, or the running tag when that is higher or the file is absent) — so the dispatcher and the resolver can never disagree about where a node's floor is. Four consequences, each a reading choice: (1) an unversioned node is "never not newer" only when it has NO floor; one whose floor file reads v0.0.9 is `not-newer` for v0.0.9 and below; (2) a target EQUAL to the floor is refused, as decision 8 says "strictly newer", although the node's own check would accept it — back to the floor tag is `rollback`, which is catalogue-gated and never floor-gated; (3) `DispatchRow` gains `highestVersion` and `floorRead` (W2's `TagFileRead`, `shared/api.ts`), and `dispatch.ts` takes one VALUE import, `floorOf`, from `./resolve.js`, which the plan had kept type-only; (4) D-3492 a NULL `highestVersion` whose `floorRead` is `'unmeasured'` is NOT "no floor". The resolver answers `RESOLVE_DETAIL.floorUnmeasured()` before `floorOf` (`resolveOnChannel`), so `moveRefusal`'s update arm makes the same check first and refuses the update with its own word, `floor-unread` (its sentence says the floor has not been measured; never `stamp-unread`, whose sentence is about the build stamp): non-halting, never `not-newer` and never the unversioned pass. A rollback is not stopped by it. The `not-newer` sentence names the floor when it is not the running tag, and Task 6's `UPDATE_ERROR_TEXT` sentence stops claiming the node "already runs" the tag; Task 8's `takesForward` applies the same floor, so a sheet never names a node the route would skip `not-newer` (a floor never measured, `floor-unread`, is not previewed: the 202's `skipped` names it). Pinned by Task 4's rolled-back and floored-unversioned cases (mutation row 7c), Task 6's `409 not-newer` below the floor with `{all: true}` skipping it, and Task 8's planner case. Cost if wrong: a node rolled back below its floor cannot be moved back up by Install; the operator uses Roll back (to a newer tag) or waits for a release above its floor.
- **D-3492** — Found re-pointing this plan onto W2's executed tree (2b5d4ce1). Spec §6's null discipline says "`highestVersion NULL` = unconstrained … the floor comparison then falls back to `currentVersion`", and §10's direction rule says an `update` "must be strictly newer than `currentVersion` … a node with `currentVersion NULL` (unversioned) is never "not newer"". W2 D-3213 splits that NULL in two with `floorRead` (`TagFileRead`: `'measured' | 'absent' | 'unmeasured'`): a floor never measured (its file has failed to read — EACCES, a refused symlink, over-cap — on every sweep since the row was placed, or `markUnreachable` placed the row and nothing has been measured since; a failed read after an earlier measurement carries that measurement's value and state forward) is NOT "no floor", and W2's resolver refuses to resolve it (`RESOLVE_DETAIL.floorUnmeasured()`, checked in `resolveOnChannel` before `floorOf`). The dispatcher does the same: `DispatchRow` carries `floorRead`, and `moveRefusal`'s update arm, directly after the `stamp-unread` check and before `not-newer`, refuses a NULL `highestVersion` whose `floorRead` is `'unmeasured'` with its OWN word, `floor-unread`, which makes `DISPATCH_REFUSALS` eleven words, placed directly after `stamp-unread` (its fifth position). It is non-halting, noted on an idle row as `floor-unread — <label>'s floor has not been measured — <tag> waits until it is`, never `not-newer` and never the unversioned pass; a rollback is not stopped by it (rollback is catalogue-gated, never floor-gated, D-3403). A word of its own, not `stamp-unread`: the stamp DID read, and one word for two conditions would tell the operator "build stamp could not be read" about a floor, with a different remedy. It follows through every consumer: the routes answer `409 floor-unread` (`UpdateRouteError` derives it from `DispatchRefusal`), `{all: true}` skips and notes it (`MoveSkipWhy` derives it too), and `UPDATE_ERROR_TEXT` and its test's `SENTENCES` gain one sentence, so Task 6's census counts are 12 → 23 and 10 → 21. A fleet row in this state has a NULL `desiredTag`, so it does not hold a server auto move either (D-3402). Pinned by Task 4's unmeasured-floor loop in "an unversioned node WITH a floor …" and the reach table's `floor-unread` entry (mutation row 7d), and Task 6's agreement-table row; none of these is measured yet. Cost if wrong: a node whose floor file will not read cannot be moved up by Install until it does; the operator fixes the file or uses Roll back, and the vocabulary carries one more word.
- **D-3493** — Found re-pointing this plan onto W2's executed tree (2b5d4ce1). Spec §7 describes the watcher's lanes as "`void`-dispatched with a `.catch` (… the `CAPS_REFRESH_MS` shape)", and that shape's catch is silent (`.catch(() => { /* one bad refresh must not kill the poll */ })`); §10 names the dispatcher's triggers and says nothing about a run that rejects. W2 D-3209 found that a silent `.catch(() => {})` on the catalogue lane let `catalogueState` read "up to date" after a failed poll, and at the tip both of W2's update lanes (the catalogue poll and `dispatchInventorySweep`) log a rejection instead of swallowing it. `FleetWatcher.triggerDispatch()` (Task 5) follows the tip, not the older shape: `void this.dispatchNow().catch(…)` whose handler is `console.warn('ccrc-server: a dispatch run rejected: <stack or message>')`. The single-flight's `finally` still clears the run and honours a queued follow-up, so a rejection stops nothing. A rejected run would be a throw out of `runDispatch` (a store writer throwing on a locked or corrupt `coord.db`, say); leaving no trace would put a noted or leased row in the inventory with nothing in the journal that says why. Not pinned by a case: it is a log line, not a guard; Task 5's cases cover what a run writes, and none plants a rejecting run. Cost if wrong: one journal line per rejected run.
- **D-3494** — Found re-pointing this plan onto W2's executed tree (2b5d4ce1). Spec §12 says of `apply`'s `tag`: "the route checks `isReleaseTag` (`400`)". §4 says "`isReleaseTag` is the ONE tag-shape guard: the agent's op handler, the routes, the resolver and `cmd_update`'s bash twin … all agree on it". W2 D-3216 leaves `RELEASE_TAG`/`isReleaseTag` untouched. On top of them it adds an ingress-only gate, `isIngestibleReleaseTag` (`server/src/update/resolve.ts`), which calls `isReleaseTag` first and then refuses a tag over 64 bytes or one with a leading zero in any component (`v0.0.010`, which `compareReleaseTags` would read as a second spelling of `v0.0.10`). W2 applies it at the catalogue's element parse and at `parseIntentBody`'s `pinnedTag`, answered `400 bad-tag`. The two move routes do exactly what the intent route does. Task 6's `tagField`, shared by `parseApplyBody`'s `tag` and `parseRollbackBody`'s `to`, calls `isIngestibleReleaseTag` and answers `400 bad-tag` naming the field, so one tag answers the same on every update route. The dispatcher, the agent's `validateReq` and `updateSpawnArgv` keep `isReleaseTag`. Pinned by Task 6's parser case, which lists `v0.0.010` among the `bad-tag` shapes. Cost if wrong: none a caller can reach. Such a tag can never be a catalogue row (the catalogue's ingress skips it), so the spec's literal rule would have answered `409 unknown-tag` for it; this plan answers `400 bad-tag` instead.
- **D-3495** — Found re-pointing this plan onto W2's executed tree (2b5d4ce1). Spec §6's null discipline says "`previousVersion NULL` = nothing to roll back to, which the rollback route says (`409 no-previous`)", and §12 says `to` is "filled from the node's measured `previousVersion` when omitted, `409 no-previous` when that is NULL". W2 D-3213 adds `previousRead`. A NULL `previousVersion` whose `previousRead` is `'unmeasured'` means the previous file did not read, not that there is no previous install. Task 6's `singleNodeMove` still answers `409 no-previous` for both and never goes looking for a tag. For `'unmeasured'` it adds `detail: 'the previous release has not been measured yet — name one with to'`; `'absent'` answers the bare `{error: 'no-previous'}` as before. There is no new word, unlike D-3492: the remedy is the same either way (name a `to`), and `no-previous` is a route word, not a `DispatchRefusal`, so no note or skip reads it. Pinned by Task 6's two `no-previous` cases (`previousRead: 'absent'` → no `detail`; `'unmeasured'` → that detail, exactly). Cost if wrong: one optional field on one `409` body.

## File structure

**New**
- `server/src/update/dispatch.ts` — L1, four import specifiers (`shared/api`, `shared/agent-protocol`, `shared/semver`, `./resolve` — `EligibilityRow` and `floorOf`). The pure dispatcher: eligibility, the halt predicate, the dispatch order, the capability refusals, the direction, the met-request rule, the deadline predicate, the single-node `moveRefusal` the routes call, `dispatchRefusalDetail`/`RefusalBlocker`, and the op-answer mapping (`classifyOpAnswer`, Task 5).
- `server/src/update/converge.ts` — L3 (D-3383). `runDispatch`: the deadline sweep, plan → the unsendable checks (D-3398) → `dispatchNode` → send the op or spawn locally → map the answer → release/hold; `dispatchViewsFor`, the one builder of the dispatcher's views, shared with the routes; `LocalUpdateSpawn`/`localUpdateSpawnFor` (D-3397); `inFlightSentence`.
- `pwa/src/fleet/movePlan.ts` — the pure move planner: `planMove` (which nodes a move names, in dispatch order), `moveTarget`, `moveHeadline`, `moveLines`, and `moveRequests` (the request(s) it sends).
- `pwa/src/fleet/UpdateMoveSheet.tsx` — the one confirm sheet every move control opens; `sendMove`, `MoveSendError`, `MOVE_EMPTY_TEXT`, `MOVE_UNREADABLE_TEXT`.
- `server/test/update-op-vocabulary.test.ts` — Task 1's L0 pins (errors, argv templates, timeouts, `firstStderrLine`, `inFlightReport`) and `AgentOpError`.
- `agent/test/update-op.test.ts` — the op over a real agent WS with an injected spawn, plus the real `realUpdateSpawn` over a fixture launcher.
- `server/test/update-store-dispatch.test.ts` — `requestNode`, `dispatchNode`, `noteDispatchRefusal`.
- `server/test/update-dispatch.test.ts` — `planDispatch`'s table, `moveRefusal`, `deadlineExpired`, `dispatchRefusalDetail`, the import-block assertion.
- `server/test/update-op-answer.test.ts` — `classifyOpAnswer`'s whole table (Task 5).
- `server/test/update-converge.test.ts` — `runDispatch` end to end on a fixture `coord.db`, the `FleetWatcher` triggers, the `index.ts` text pin and the raw-`Runner` type pin.
- `server/test/update-apply-routes.test.ts` — the `apply`/`rollback` rows.
- `server/test/update-auto-dispatch.test.ts` — the `auto` enforcement at dispatch time.
- `pwa/test/move-plan.test.ts`, `pwa/test/update-move-sheet.test.tsx` — the planner and the sheet.

**Changed**
- `shared/agent-protocol.ts` — L0. One import line (`isReleaseTag`, `isRequestKind`, type `RequestKind` from `./api.js`); `UpdateReq` in `AgentReq`; `ResErr.detail?`; the op-payload comment's `update → {accepted: true}`; `UPDATE_OP`, `UPDATE_OP_ERRORS`/`UpdateOpError`/`isUpdateOpError`; `UPDATE_OP_FROM`, `UPDATE_LAUNCHER_PARTS`, `updateLauncherPath`, `updateSpawnArgv`; `UPDATE_SPAWN_TIMEOUT_MS`, `UPDATE_OP_TIMEOUT_MS`, `UPDATE_OP_DETAIL_MAX`, `firstStderrLine`; `AgentReady.ops`'s docstring.
- `shared/api.ts` — L0, end-of-file block only, no import line. `InFlightReport`, `inFlightReport` bounding the report's seconds by W2's `UNIX_SECONDS_MAX` (same block, never a private copy) (Task 1); `'bad-kind'`, `'no-request'`, `'not-idle'` appended to `UPDATE_STORE_REFUSE_CODES` (Task 3); `DISPATCH_REFUSALS`/`DispatchRefusal`/`isDispatchRefusal`, `dispatchRank`, `compareDispatchOrder` (Task 4); `UpdateRouteError` widened in place, `ApplyUpdateBody`, `RollbackUpdateBody`, `MoveSkipWhy`, `MoveSkip`, `MoveRequestAnswer` (Task 6).
- `server/src/remote/client.ts` — L3. One value import (`UPDATE_OP_DETAIL_MAX`); `AgentOpError`, the one reader of `ResErr.detail`, which cuts it (D-3391) (Task 1).
- `agent/src/server.ts` — agent. The `node:fs` import widened; `ReqRefusal` and `validateReq`'s `update` case; `fail`'s optional `detail` and `failUpdate`; `handleReq`'s `update` case; `UPDATE_REPORT_READ_MAX`/`readInFlightReport`; `UpdateSpawn`, `UPDATE_SPAWN_MAX_BUFFER`, `realUpdateSpawn`, `UpdateGate`; `AgentOpts.spawnUpdate?`; `ConnCtx`'s two fields; `handleConnection` taking the one `updateGate`; `ReadyFrame`'s required `ops` and the ready frame's `ops`.
- `agent/CLAUDE.md` — the update op: the one wire-triggered spawn outside the exec whitelist, and the procedure for an op.
- `server/src/coord/store.ts` — L3. `RequestNodeResult`, `DispatchNodeResult`, `NoteDispatchRefusalResult`; `requestNode`, `dispatchNode`, `noteDispatchRefusal`; the `// ── update inventory ──` banner's two stale passages; no import edit.
- `server/src/watch.ts` — L4. `dispatchNow()`, `triggerDispatch()`, the private `dispatchOnce()` and single-flight fields, and the call site at the end of `sweepThenProject`.
- `server/src/server.ts` — L4. `Deps.updateRunner?: LocalUpdateSpawn`, `Deps.sendUpdateOp?: SendUpdateOp`, one type import.
- `server/src/index.ts` — L5. Binds `updateRunner: localUpdateSpawnFor(realRunner, cfg.home)` (both arms) and `sendUpdateOp` to `fleet.client.request({ t: 'req', op: 'update', tag, kind }, UPDATE_OP_TIMEOUT_MS)` (remote arm).
- `server/src/update/routes.ts` — L4. `parseApplyBody`, `parseRollbackBody`, the two routes and their private helpers; the intent handler's dispatch trigger; the module and `sessionAuth` docstrings' route numerals.
- `server/src/auth/gate.ts` — the header's route count (83 → 85).
- `server/test/update-writer-groups.test.ts` — `W5_WRITERS`, the floor over three lists, `noteDispatchRefusal` in the lease row.
- `server/test/single-definition.test.ts` — `'dispatch.ts'`, `'converge.ts'` in `UPDATE_RING_FILES` (in place); appended describes (the op errors and the launcher, Task 1; the dispatch refusals and order, Task 4).
- `server/test/mail-routes.test.ts` — run only (the three new store words are admitted through `isUpdateStoreRefuseCode`).
- `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts` — the two routes, the moved counts, `UPDATE_DOORS`.
- `server/test/remote-connect.test.ts` — W2 Task 8's real-agent literal `agentOps: []` becomes `agentOps: ['update']` (Task 2).
- `server/test/update-inventory.test.ts` — W2 Task 11's real-agent case's `agentOps: []` becomes `agentOps: ['update']` (Task 2).
- `server/test/update-dispatch.test.ts` — Task 5 edits its import-block list in place only if Step 1 finds three specifiers there (Task 4 already lists four).
- `server/test/update-routes.test.ts` — one import line (`DETACH_CAP`) and one describe: the intent route's dispatch trigger (Task 6).
- `pwa/src/lib/api.ts` — `applyUpdate`, `rollbackUpdate` on `postJsonOr` (Task 8); the widened `UPDATE_ERROR_TEXT`, eleven sentences (Task 6); `MOVE_DISABLED_TEXT` deleted (Task 8).
- `pwa/src/screens/SettingsScreen.tsx`, `pwa/src/fleet/UpdateBanner.tsx` — the five controls enabled through `UpdateMoveSheet`; `UpdateBanner`'s optional `onMoved`.
- `pwa/src/screens/FleetScreen.tsx` — `<UpdateBanner updates={updates.view} onMoved={updates.reload} />`, one line in place (Task 8).
- `pwa/src/fleet/fleet.css`, `pwa/design/audit.mjs` — the sheet's rules appended; the `.settings-move-note` and `.update-banner-note` rules removed, and the `.settings-move-note` registry entry with them; no new registry entry (the sheet is self-grounded).
- `pwa/test/api.test.ts` — Task 6: `SENTENCES` gains the eleven words, its length pins 12 → 23 and 10 → 21; Task 8: the route census reads six literals, the disabled-literal pin becomes a literal-absence scan, one describe for the two client methods.
- `pwa/test/settings-screen.test.tsx`, `pwa/test/update-banner.test.tsx` — the "disabled" pins become "enabled and ordered"; `pwa/test/fleet-screen.test.tsx` — one describe appended (the `onMoved` wiring).
- `README.md` — the Releases section: the one-tap paragraph, the dispatcher's order and halt, `ack`; four corrections (W2's opener, wave 3's Settings paragraph, wave 4's "Update and rollout" opener, and an `Update op` bullet in Remote fleet mode's agent list) (Task 9).
- `CLAUDE.md` — the box-token bullet's doors (Task 6); the Deploy bullet's one-tap sentence and the README size claim if it moves (Task 9).

## Tasks

### Task 1: The op's vocabulary (L0)

**Files:**
- Modify: `shared/agent-protocol.ts` — ONE import line, `import { isReleaseTag, isRequestKind, type RequestKind } from './api.js';`, directly after `import type { BuildInfo } from './buildinfo.js';` (`:13` at `d759c914`). **CORRECTED from "one type-only line"**: `updateSpawnArgv` throws unless `isReleaseTag(tag)` and `isRequestKind(kind)` hold, and those are runtime calls, so the line imports two VALUES and one type. `shared/api.ts` imports nothing at runtime and nothing from this file, so no cycle forms, and `agent-protocol.ts` is not on the PWA's import path. Also: `UpdateReq` directly after `PtyOpenReq` (`:274`); `AgentReq`'s union (`:278`) gains `|UpdateReq` at its end, the line replaced in place; `ResErr` (`:280`) gains `detail?: string` in place, plus a docstring above it; the op-payload comment's last line (`:288`, quoted: `// writeB64 → {}; tailOpen → {tailId}; ptyOpen → {ptyId}; caps → {verbs: string[]}`) gains `; update → {accepted: true}` in place; the op block (`UPDATE_OP` through `firstStderrLine`) goes directly AFTER that line and before `ReadFailure`'s docstring (`:290`). **CORRECTED from "directly after `ResErr`, before the op-payload comments"**: that position would cut `ResOk`/`ResErr` off from the comment that describes their payloads. `AgentReady.ops`'s W2 line (quoted: `ops?: string[];   // ADDITIVE (design 2026-09-20 §8/§10): the ops this agent answers; absent from every agent before W4`) gets one JSDoc line above it, in place. **Every `shared/agent-protocol.ts` line number here is a `d759c914` number** (`:13`, `:274`, `:278`, `:280`, `:288`, `:290`): W2 Task 8 inserts `CCRC_DIR_NAME`/`NODE_FILES`/`NodeFileKey`/`NODE_FILE_BASENAMES` after `POOL_EPOCH_FILE_NAME` (`:116`) and a JSDoc paragraph plus `ops?` inside `AgentReady` (`:64-88`), so on the merged tree every anchor below `:64` sits lower — locate each by its QUOTED text, which Step 1 prints with its merged-tree line, never by the number. The citation audit's corpus cites no line of this file (re-measured in Step 1), so the inserts need not be line-neutral.
- Modify: `shared/api.ts` — `InFlightReport`, and `inFlightReport` (bounded by W2's `UNIX_SECONDS_MAX`, already declared in this file, so there is no private copy) APPENDED after the file's last line (wave 3's `export const UPDATE_GATE_CAP = 'update-gate';`), inside the end-of-file update block (D-3188, R13). No import line is added (`peers-claims-l0.test.ts:157-167` pins the three).
- Modify: `server/src/remote/client.ts` — one value import line `import { UPDATE_OP_DETAIL_MAX } from '../../../shared/agent-protocol.js';` directly after the `import type { … } from '../../../shared/agent-protocol.js';` block (`:2-12`); `AgentOpError` directly after W2 Task 8's `readReadyOps` closing `}`; the one rejection site (quoted: `entry.reject(new Error(typeof msg.err === 'string' ? msg.err : 'error'));`, `:295` at `d759c914`) rejects with it.
- Modify: `server/test/single-definition.test.ts` — one describe APPENDED after the file's last line, with four cases. (1) `UPDATE_OP_ERRORS` and `UpdateOpError` each have one holder, `shared/agent-protocol.ts`. (2) The four words are listed together in one file. (3) The launcher's `'.local', 'bin', 'ccrc'` parts are spelled in one file across the four TS roots. (4) No TS root spells the launcher as one quoted path string. Nothing is inserted above `:32-37`, `:1274` or `:1303` (R13).
- Test: `server/test/update-op-vocabulary.test.ts` (create)
- Run, not edited: `server/test/session-hook.test.ts -t 'every line citation is anchored'` (R13: `shared/api.ts` and `single-definition.test.ts` are cited), `server/test/typecheck-tests.test.ts`, `server/test/remote-connect.test.ts` (the client's existing rejection cases), `server/test/remote-runner.test.ts` (`createRunner`'s catch arm, the one existing reader of a rejection's `.message`), `server/test/peers-claims-l0.test.ts` (the `shared/api.ts` import pin), `server/test/update-states.test.ts` (W2's vocabularies), `server/test/topology-clean.test.ts` (after `git add`). Also `cd server && ./node_modules/.bin/tsc --noEmit`, `cd agent && npm run build` (the agent compiles `../shared/**/*.ts`) and `cd pwa && npm run build` (the PWA's `tsconfig.json` includes `../shared`, under `verbatimModuleSyntax` and `noUnusedLocals`).

**Interfaces:**
- Consumes: `RequestKind`, `isRequestKind`, `isReleaseTag`, `UpdatePhase`, `isUpdatePhase`, `IN_FLIGHT_UPDATE_PHASES` (W2 Task 1, `shared/api.ts`); `AgentReady.ops?` and `readReadyOps` (W2 Task 8); wave 4's `update.json` line — `{"target":<"vX.Y.Z"|null>,"phase":"<phase>","startedAt":<int>,"updatedAt":<int>,"detail":<"…"|null>,"from":"<word>","pid":<int>}`, times in unix SECONDS (wave 4 Task 1, R1/R14); wave 4's two verbs, `ccrc update --to <tag> --detach --from <word>` (Task 3) and `ccrc rollback --to <tag> --detach --from <word>` (Task 7), whose `--from` word `pwa` is in `UPD_FROM_WORDS`; W2 Task 11's `printableDetail` rule (every run outside 0x20–0x7E becomes one space, then trimmed), which `firstStderrLine` applies per line; `FleetClient.request`/`onMessage`/`onClose` (`client.ts:176-209`, `:286-300`, `:414-419` at `d759c914`; W2 Task 8's import, `readReadyOps` and `state` initialiser shift them, so they are located by quoted text), and `createRunner`'s catch arm, which reads `e.message` (`remote/runner.ts:185` at `d759c914`) — the ONE existing reader of a rejection's message: `caps()` (`client.ts:236-245` at the W2 tip) and every `remote/io.ts` arm `catch` without reading the error at all.
- Produces (in `shared/agent-protocol.ts`):

```ts
import { isReleaseTag, isRequestKind, type RequestKind } from './api.js';   // CORRECTED: values + one type

/** Design 2026-09-20 §10: one member of the req envelope, not a new frame. `kind` absent = 'update'. */
export interface UpdateReq { t: 'req'; id: number; op: 'update'; tag: string; kind?: RequestKind }
export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReadB64Req|ReaddirReq|StatReq|LstatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq|CapsReq|UpdateReq;
export interface ResErr { t: 'res'; id: number; ok: false; err: string; detail?: string }   // D-3373

export const UPDATE_OP = 'update';
export const UPDATE_OP_ERRORS = ['bad-tag', 'bad-kind', 'busy', 'spawn-failed'] as const;   // D-3370
export type UpdateOpError = (typeof UPDATE_OP_ERRORS)[number];
export function isUpdateOpError(v: unknown): v is UpdateOpError;
export const UPDATE_OP_FROM = 'pwa';
export const UPDATE_LAUNCHER_PARTS = ['.local', 'bin', 'ccrc'] as const;
export function updateLauncherPath(home: string): string;            // RangeError unless '/'-led with no trailing '/'
export function updateSpawnArgv(kind: RequestKind, tag: string): readonly string[];   // frozen; RangeError on a caller bug
export const UPDATE_SPAWN_TIMEOUT_MS = 20_000;                       // D-3374
export const UPDATE_OP_TIMEOUT_MS = 30_000;                          // > UPDATE_SPAWN_TIMEOUT_MS, pinned
export const UPDATE_OP_DETAIL_MAX = 200;
/** CORRECTED: every run of characters outside 0x20–0x7E becomes ONE SPACE (W2's printableDetail rule, per
 *  line), not dropped; first line non-empty after trim; cut to UPDATE_OP_DETAIL_MAX; none → 'no message'. */
export function firstStderrLine(stderr: string): string;
```

- Produces (in `shared/api.ts`, appended):

```ts
export interface InFlightReport { phase: UpdatePhase; target: string | null; startedAtS: number | null }
/** Non-null iff the text is one JSON object whose `phase` (read BY NAME, unknown keys ignored, R2) is in
 *  IN_FLIGHT_UPDATE_PHASES; target through isReleaseTag else null; startedAt a positive safe integer ≤
 *  99_999_999_999 (SECONDS) else null. Unparseable, a non-object, a terminal or unknown phase → null. */
export function inFlightReport(text: string): InFlightReport | null;
```

  The bound `99_999_999_999` is W2's `UNIX_SECONDS_MAX` (C5, final fix wave), exported from this same file, so `inFlightReport` reads it by name and needs no import. `inventory.ts` and `resolve.ts` both import it, and neither declares its own copy, so this file declares none either.

- Produces (in `server/src/remote/client.ts`):

```ts
export class AgentOpError extends Error {
  readonly code: string; readonly detail: string | null;
  constructor(code: string, detail: string | null);   // message = code; name = 'AgentOpError'
}
// the rejection — CORRECTED: the detail is cut to UPDATE_OP_DETAIL_MAX at this, its one reader (D-3391):
// entry.reject(new AgentOpError(typeof msg.err === 'string' ? msg.err : 'error', typeof msg.detail === 'string' ? msg.detail.slice(0, UPDATE_OP_DETAIL_MAX) : null));
```

- Spec §18 rows pinned: "the op validates the tag with the one guard" (the argv half; mutation: accept any string in `updateSpawnArgv` → red), "the spawn argv is absolute" (mutation: return `'ccrc'` from `updateLauncherPath` → red). Review Focus 4 (the timeout order).

- [ ] **Step 1: Re-measure the base — the three producers are on `main`**

Run from the worktree root:

```bash
git fetch origin main && git log --oneline -1 origin/main
git grep -n -e 'export function isReleaseTag' -e 'export function isRequestKind' -e 'export function isUpdatePhase' \
  -e 'export const IN_FLIGHT_UPDATE_PHASES' -e "export const UPDATE_GATE_CAP = 'update-gate';" -- shared/api.ts
tail -n 1 shared/api.ts
git grep -n -e 'export const NODE_FILES' -e 'export const CCRC_DIR_NAME' -e '  ops?: string\[\];' -- shared/agent-protocol.ts
git grep -n -e "^import type { BuildInfo } from './buildinfo.js';" -e '^export interface PtyOpenReq ' -e '^export type AgentReq = ' \
  -e '^export interface ResErr ' -e 'caps → {verbs: string\[\]}$' -e '^/\*\* Why a `read`' -- shared/agent-protocol.ts
git grep -n -e 'export function readReadyOps' \
  -e "entry.reject(new Error(typeof msg.err === 'string' ? msg.err : 'error'));" -- server/src/remote/client.ts
tail -n 1 server/test/single-definition.test.ts
git grep -nE "'\.local',\s*'bin',\s*'ccrc'|['\"][^'\"]*/\.local/bin/ccrc['\"/]" -- shared server/src pwa/src agent/src
git grep -nE '(agent-protocol|client)\.ts:[0-9]' -- README.md \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md
```

Expected:
- Each of the first four `git grep`s prints exactly one hit per pattern. The third prints the six Step 4 anchors of `shared/agent-protocol.ts` at their MERGED-tree lines (at `d759c914` they were `:13`, `:274`, `:278`, `:280`, `:288`, `:290`; W2 Task 8 moves every one but the first) — Step 4 edits at the lines printed here.
- `tail -n 1 shared/api.ts` prints `export const UPDATE_GATE_CAP = 'update-gate';`, and `tail -n 1 server/test/single-definition.test.ts` prints `});`.
- The last two `git grep`s print nothing and exit 1: no TS root spells the launcher yet, and no document in the audit's corpus cites either file by line.
- **CORRECTED corpus:** the session-hook citation audit reads THREE documents (`session-hook.test.ts`'s `CORPUS`, `:7073-7076` at `d759c914`): `specs/2026-09-09-graphify-compaction-card-design.md`, `plans/2026-09-10-graphify-compaction-card-plan-a.md` and `README.md`. The skeleton's glob `2026-09-1*-compaction-card*` matches neither of the first two.
- If any producer name is missing, stop: W2 or wave 3 has not merged, and this task's anchors are wrong.

- [ ] **Step 2: Write the failing tests**

Create `server/test/update-op-vocabulary.test.ts`:

```ts
// Design 2026-09-20 §10 — the `update` op's L0 vocabulary, and the one reader
// of the `detail` its refusals carry (programme wave 5, Task 1).
//
// Four things are pinned here and nowhere else:
//
//  1. The op's refusal words are a CLOSED list (D-3370).
//     `ResErr.err` was a bare string with no vocabulary at all, so the agent's
//     word and the dispatcher's comparison could drift with nothing red.
//  2. The two spawn argvs are TEMPLATES. `updateSpawnArgv` returns one of exactly
//     two shapes, with the tag the only variable token, and throws on any tag
//     `isReleaseTag` refuses: the argv half of §18 "the op validates the tag
//     with the one guard". `updateLauncherPath` is absolute: §18 "the spawn argv
//     is absolute".
//  3. The agent gives up on the `--detach` parent BEFORE the server gives up on
//     the op (Review Focus 4, D-3374). A server that timed out first
//     would release the lease while the node was still starting a run.
//  4. `AgentOpError` (D-3373): an answer the agent SENT is told
//     from a link that FAILED by `instanceof`, never by a message string, and
//     `message` stays `err`, so every existing `.message` caller is unchanged.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  UPDATE_OP, UPDATE_OP_ERRORS, isUpdateOpError, UPDATE_OP_FROM, UPDATE_LAUNCHER_PARTS, updateLauncherPath,
  updateSpawnArgv, UPDATE_SPAWN_TIMEOUT_MS, UPDATE_OP_TIMEOUT_MS, UPDATE_OP_DETAIL_MAX, firstStderrLine,
} from '../../shared/agent-protocol.js';
import { IN_FLIGHT_UPDATE_PHASES, inFlightReport } from '../../shared/api.js';
import { AgentOpError, connectFleet, type ConnectedFleet } from '../src/remote/client.js';
import { TOKEN } from './remoteHelpers.js';

describe('UPDATE_OP_ERRORS — the only words the update op refuses with', () => {
  it('is exactly the four words, and the op and its --from word are what wave 4 spells', () => {
    expect([...UPDATE_OP_ERRORS]).toEqual(['bad-tag', 'bad-kind', 'busy', 'spawn-failed']);
    expect(UPDATE_OP).toBe('update');
    expect(UPDATE_OP_FROM).toBe('pwa');
  });

  it('isUpdateOpError answers exactly the array — no trimming, no case folding, no envelope word', () => {
    for (const w of UPDATE_OP_ERRORS) expect(isUpdateOpError(w), w).toBe(true);
    // `bad-request` is the ENVELOPE's word for an op `validateReq` does not
    // know. From this op it means "the agent predates it" (spec §10), which is
    // exactly why it must never be one of the op's own words.
    for (const v of ['', 'BUSY', ' busy', 'busy ', 'bad-request', 'forbidden', null, undefined, 1]) {
      expect(isUpdateOpError(v), String(v)).toBe(false);
    }
  });
});

describe('the two spawn argv templates (§18 "the op validates the tag with the one guard", "the spawn argv is absolute")', () => {
  it('update and rollback are exactly the spec §10 templates', () => {
    expect([...updateSpawnArgv('update', 'v0.0.9')]).toEqual(['update', '--to', 'v0.0.9', '--detach', '--from', 'pwa']);
    expect([...updateSpawnArgv('rollback', 'v0.0.8')]).toEqual(['rollback', '--to', 'v0.0.8', '--detach', '--from', 'pwa']);
  });

  it('the tag is the only variable token, and a caller cannot append to a template', () => {
    const a = updateSpawnArgv('update', 'v0.0.9');
    const b = updateSpawnArgv('update', 'v10.20.30');
    expect(a.map((t, i) => (t === b[i] ? '=' : i))).toEqual(['=', '=', 2, '=', '=', '=']);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('throws on any tag isReleaseTag refuses — a caller bug, never a spawn', () => {
    for (const tag of ['; rm -rf ~', 'v0.0.9 ', 'v0.0.9\n', '0.0.9', 'V0.0.9', 'v0.0', '', 'v0.0.9; rm -rf ~']) {
      for (const kind of ['update', 'rollback'] as const) {
        expect(() => updateSpawnArgv(kind, tag), `${kind} ${JSON.stringify(tag)}`).toThrow(RangeError);
      }
    }
  });

  it('throws on a kind outside RequestKind', () => {
    for (const kind of ['sideways', 'Update', '', 'install']) {
      expect(() => updateSpawnArgv(kind as never, 'v0.0.9'), kind).toThrow(RangeError);
    }
  });

  it('the launcher is $HOME/.local/bin/ccrc — absolute, never bare ccrc', () => {
    expect([...UPDATE_LAUNCHER_PARTS]).toEqual(['.local', 'bin', 'ccrc']);
    expect(updateLauncherPath('/h')).toBe('/h/.local/bin/ccrc');
    expect(updateLauncherPath('/tmp/fixture-home')).toBe('/tmp/fixture-home/.local/bin/ccrc');
    for (const home of ['h', '', './h', '~/h', '/h/', '/']) {
      expect(() => updateLauncherPath(home), JSON.stringify(home)).toThrow(RangeError);
    }
  });
});

describe('the op timeouts — the agent answers before the server gives up (Review Focus 4, D-3374)', () => {
  it('UPDATE_SPAWN_TIMEOUT_MS is strictly below UPDATE_OP_TIMEOUT_MS', () => {
    expect(UPDATE_SPAWN_TIMEOUT_MS).toBe(20_000);
    expect(UPDATE_OP_TIMEOUT_MS).toBe(30_000);
    expect(UPDATE_SPAWN_TIMEOUT_MS).toBeLessThan(UPDATE_OP_TIMEOUT_MS);
  });
});

describe('firstStderrLine — what a spawn-failed answer carries (D-3372)', () => {
  it('is the first line with anything in it, exactly', () => {
    expect(firstStderrLine('\n\nccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)\nsecond\n'))
      .toBe('ccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)');
    expect(firstStderrLine('\r\n  \nline one\r\nline two')).toBe('line one');
  });

  it("keeps printable ASCII only — every other run is one space, then trimmed (W2's printableDetail rule)", () => {
    expect(firstStderrLine('a—b\u0000c')).toBe('a b c');
    expect(firstStderrLine('\tindented\u0007')).toBe('indented');
  });

  it('is cut to UPDATE_OP_DETAIL_MAX', () => {
    expect(UPDATE_OP_DETAIL_MAX).toBe(200);
    expect(firstStderrLine('x'.repeat(300))).toBe('x'.repeat(200));
  });

  it("says 'no message' when there is no line at all — never an empty detail", () => {
    for (const s of ['', '\n', ' \n\t\n', '\u0000']) expect(firstStderrLine(s), JSON.stringify(s)).toBe('no message');
  });
});

/** wave 4's `update.json` line — seven keys, times in unix SECONDS (rulings R1/R14). */
const LINE = (o: Record<string, unknown> = {}): string => `${JSON.stringify({
  target: 'v0.0.9', phase: 'installing', startedAt: 1790000000, updatedAt: 1790000060, detail: null, from: 'pwa',
  pid: 4242, ...o,
})}\n`;

describe('inFlightReport — is a run in flight right now (asked by the agent and by the server-role spawn)', () => {
  it('every in-flight phase is in flight — and the list is not empty', () => {
    expect(IN_FLIGHT_UPDATE_PHASES).toHaveLength(9);
    for (const phase of IN_FLIGHT_UPDATE_PHASES) {
      expect(inFlightReport(LINE({ phase })), phase).toEqual({ phase, target: 'v0.0.9', startedAtS: 1790000000 });
    }
  });

  it('a terminal, unknown or off-vocabulary phase is not in flight', () => {
    for (const phase of ['done', 'reverted', 'failed', 'unknown', 'installed', 'INSTALLING', '', null, 3]) {
      expect(inFlightReport(LINE({ phase })), String(phase)).toBeNull();
    }
    // `undefined` is dropped by JSON.stringify: a report with no phase key at all.
    expect(inFlightReport(LINE({ phase: undefined }))).toBeNull();
  });

  it("reads wave 4's seven-key line by name — the pid key, and any newer key, is ignored (ruling R2)", () => {
    expect(inFlightReport(LINE())).toEqual({ phase: 'installing', target: 'v0.0.9', startedAtS: 1790000000 });
    expect(inFlightReport(LINE({ extra: { nested: true } })))
      .toEqual({ phase: 'installing', target: 'v0.0.9', startedAtS: 1790000000 });
  });

  it('a start time that is not unix SECONDS reads null, and the report is kept (ruling R1)', () => {
    for (const startedAt of [1790000000000, 0, -1, 1.5, '1790000000', null]) {
      expect(inFlightReport(LINE({ startedAt })), String(startedAt))
        .toEqual({ phase: 'installing', target: 'v0.0.9', startedAtS: null });
    }
  });

  it('a target off the tag shape reads null', () => {
    for (const target of [null, 'latest', 'v0.0.9 ', 9]) {
      expect(inFlightReport(LINE({ target }))?.target, String(target)).toBeNull();
    }
  });

  it('a text that is not one JSON object is not in flight', () => {
    for (const text of ['{', '[]', 'null', '"installing"', '42', '', '[{"phase":"installing"}]']) {
      expect(inFlightReport(text), JSON.stringify(text)).toBeNull();
    }
  });
});

/** A hand-rolled agent: the hello/ready handshake, then every `req` answered by
 *  `answer` — or, for `'drop'`, the socket terminated under the request. */
function fakeAgent(
  answer: (req: Record<string, unknown>) => Record<string, unknown> | 'drop',
): Promise<{ port: number; wss: WebSocketServer }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
      const address = wss.address();
      resolve({ port: typeof address === 'object' && address !== null ? address.port : 0, wss });
    });
    wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.t === 'hello') { ws.send(JSON.stringify({ t: 'ready', v: 1 })); return; }
        if (msg.t !== 'req') return;
        const a = answer(msg);
        if (a === 'drop') { ws.terminate(); return; }
        ws.send(JSON.stringify({ t: 'res', id: msg.id, ...a }));
      });
    });
  });
}

describe('AgentOpError — the one reader of ResErr.detail (D-3373)', () => {
  let wss: WebSocketServer | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (wss) {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss!.close(() => resolve()));
    }
    wss = undefined;
  });

  async function connect(answer: Parameters<typeof fakeAgent>[0]): Promise<ConnectedFleet> {
    const agent = await fakeAgent(answer);
    wss = agent.wss;
    fleet = connectFleet({ url: `ws://127.0.0.1:${agent.port}`, token: TOKEN, heartbeatMs: 60_000, reconnectMinMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    return fleet;
  }
  /** The rejection itself, as a value — a resolution is a failure of the case. */
  const rejection = (p: Promise<unknown>): Promise<unknown> =>
    p.then(() => { throw new Error('the request resolved'); }, (e: unknown) => e);
  const OP = { t: 'req', op: 'update', tag: 'v0.0.9' } as const;

  it('an answer the agent sent carries its word and its detail; message stays the word', async () => {
    const DETAIL = 'update.json says installing (target v0.0.8, started 1790000000)';
    const f = await connect(() => ({ ok: false, err: 'busy', detail: DETAIL }));
    const e = await rejection(f.client.request(OP));
    expect(e).toBeInstanceOf(AgentOpError);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ name: 'AgentOpError', message: 'busy', code: 'busy', detail: DETAIL });
  });

  it('no detail, or a detail that is not a string, reads null — absence permits', async () => {
    let n = 0;
    const f = await connect(() => (n++ === 0 ? { ok: false, err: 'spawn-failed' } : { ok: false, err: 'bad-tag', detail: 42 }));
    expect(await rejection(f.client.request(OP))).toMatchObject({ code: 'spawn-failed', detail: null });
    expect(await rejection(f.client.request(OP))).toMatchObject({ code: 'bad-tag', detail: null });
  });

  it('a detail longer than UPDATE_OP_DETAIL_MAX is cut at this reader (D-3391)', async () => {
    const f = await connect(() => ({ ok: false, err: 'spawn-failed', detail: 'y'.repeat(300) }));
    expect(await rejection(f.client.request(OP))).toMatchObject({ code: 'spawn-failed', detail: 'y'.repeat(UPDATE_OP_DETAIL_MAX) });
  });

  it("an err that is not a string reads 'error', as it always did", async () => {
    const f = await connect(() => ({ ok: false, err: 7 }));
    expect(await rejection(f.client.request(OP))).toMatchObject({ message: 'error', code: 'error', detail: null });
  });

  it("every existing .message caller is unchanged — the runner still reports the agent's word as stderr", async () => {
    const f = await connect(() => ({ ok: false, err: 'forbidden' }));
    await expect(f.runner('tmux', ['has-session', '-t', 'cc-x'])).resolves.toMatchObject({ code: 1, stderr: 'forbidden' });
  });

  it('a link that fails is NOT an AgentOpError — the dispatcher tells the two apart by instanceof', async () => {
    const f = await connect(() => 'drop');
    const e = await rejection(f.client.request(OP));
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(AgentOpError);
    expect((e as Error).message).toBe('disconnected');
  });
});
```

Append to the END of `server/test/single-definition.test.ts`, after its last `});`:

```ts

// — design 2026-09-20 §10: the update op's refusal words and its launcher, declared once —
// APPENDED, never inserted: `session-hook.test.ts`'s citation audit cites this
// file by line (`:32-37`, `:1274`, `:1303`), so an insert above those moves them.
describe('the update op — its refusal words and its launcher are declared once', () => {
  it('UPDATE_OP_ERRORS and UpdateOpError are each declared in exactly one file, shared/agent-protocol.ts', () => {
    for (const re of [/^\s*export const UPDATE_OP_ERRORS\b/m, /^\s*export type UpdateOpError\b/m]) {
      const holders = ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel);
      expect(holders, String(re)).toEqual(['shared/agent-protocol.ts']);
    }
  });

  it('the four words are listed together in one file — a second list is a second vocabulary', () => {
    // The ordered list, not the words alone: `bad-tag` and `busy` are also
    // route and store words (`UpdateRouteError`, `UPDATE_STORE_REFUSE_CODES`),
    // and the dispatcher's answer mapping names `spawn-failed` in a `case`.
    const LIST = /'bad-tag'\s*,\s*'bad-kind'\s*,\s*'busy'\s*,\s*'spawn-failed'/;
    const holders = ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it("the launcher's path parts are spelled in one file — the agent and the server-role spawn call updateLauncherPath", () => {
    const PARTS = /'\.local'\s*,\s*'bin'\s*,\s*'ccrc'/;
    const holders = ALL.filter((f) => PARTS.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it('no TS root spells the launcher as one quoted path string', () => {
    // `'…/.local/bin/ccrc'` or `"…/.local/bin/ccrc/…"`. `ccrc-api`'s path
    // (`coord/envelope.ts`) is a different binary and does not match: the
    // character after `ccrc` must be a quote or a slash.
    const QUOTED = /['"][^'"\n]*\/\.local\/bin\/ccrc['"/]/;
    const holders = ALL.filter((f) => QUOTED.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run (foreground, from inside `server/`, timeout ≥ 600000 ms):
- `cd server && ./node_modules/.bin/vitest run test/update-op-vocabulary.test.ts`
- `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the update op — its refusal words'`

Expected: FAIL. vitest's module runner resolves a missing named export to `undefined`, so the file loads and each case fails on its own:
- `UPDATE_OP_ERRORS is not iterable`, `isUpdateOpError is not a function`, `updateSpawnArgv is not a function`, `updateLauncherPath is not a function`, `firstStderrLine is not a function`, `inFlightReport is not a function`, and `expected undefined to be 20000` in the timeouts case.
- The AgentOpError cases: the `toBeInstanceOf` cases fail because the matcher refuses an `undefined` constructor. That includes the dropped-link case's `not.toBeInstanceOf`, so it is red here too; it goes green in Step 7. The `toMatchObject` cases fail because a plain `Error` has no `code`.
- One case passes already, because it pins behaviour that must not change: the runner case (`stderr: 'forbidden'`).
- The first three single-definition cases fail with `expected [] to deeply equal [ 'shared/agent-protocol.ts' ]`, and the fourth passes: it is the absence pin, green before and after.

- [ ] **Step 4: Implement `shared/agent-protocol.ts`**

The line numbers below are `d759c914`'s; edit at the merged-tree lines Step 1 printed for the same quoted text.

After `import type { BuildInfo } from './buildinfo.js';` (`:13`), add:

```ts
import { isReleaseTag, isRequestKind, type RequestKind } from './api.js';
```

Directly after the `PtyOpenReq` line (`:274`), insert:

```ts
/** Design 2026-09-20 §10: ONE member of the existing `req` envelope, not a new
 *  top-level frame. `kind` absent means `'update'` (the agent's `validateReq`
 *  fills it in). `tag` passes `isReleaseTag` before any case body sees it — a
 *  failure answers `bad-tag`, never `bad-request`, which from this op means
 *  exactly one thing: the agent predates it. */
export interface UpdateReq { t: 'req'; id: number; op: 'update'; tag: string; kind?: RequestKind }
```

Replace the `AgentReq` line (`:278`) with:

```ts
export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReadB64Req|ReaddirReq|StatReq|LstatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq|CapsReq|UpdateReq;
```

Replace the `ResErr` line (`:280`) with:

```ts
/** `detail` is ADDITIVE (design 2026-09-20 §10, D-3373): what an
 *  agent can say beyond the word — the `--detach` parent's first stderr line,
 *  what `update.json` said. Absence permits: every op but `update` sends none,
 *  and an agent from before the field sends none. Its ONE reader is
 *  `server/src/remote/client.ts`'s `AgentOpError`. No `FLEET_PROTO` bump. */
export interface ResErr { t: 'res'; id: number; ok: false; err: string; detail?: string }
```

Replace the payload comment's last line (`:288`) with:

```ts
// writeB64 → {}; tailOpen → {tailId}; ptyOpen → {ptyId}; caps → {verbs: string[]}; update → {accepted: true}
```

Directly after that line, and before `ReadFailure`'s docstring, insert:

```ts

// ── the `update` op (design 2026-09-20 §10) ─────────────────────────────────
// Everything both ends of the op must agree on is declared here, once. The
// agent (`agent/src/server.ts`) spawns from these templates. The server's
// dispatcher spawns its OWN node from the same two calls
// (`server/src/update/converge.ts`) and maps the same words
// (`server/src/update/dispatch.ts`'s `classifyOpAnswer`). Bash cannot import this, so `ccd/ccrc`
// spells its side itself (`UPD_FROM_WORDS`, the `--detach`/`--to` parser), and
// wave 4's tests hold that side.

/** The op's name — and the one word an agent that answers it lists in `ready.ops`. */
export const UPDATE_OP = 'update';

/** D-3370 — the ONLY words the agent's `update` case
 *  answers with. `ResErr.err` has no closed vocabulary (every other op's words
 *  are free strings), so this op's own are declared here. The dispatcher's
 *  answer mapping switches over `UpdateOpError` with a `never` arm, so a word
 *  added on one side alone is a compile error. `bad-request` is deliberately
 *  NOT a member: it is the envelope's word for an op `validateReq` does not
 *  know, which from this op means the agent predates it. */
export const UPDATE_OP_ERRORS = ['bad-tag', 'bad-kind', 'busy', 'spawn-failed'] as const;
export type UpdateOpError = (typeof UPDATE_OP_ERRORS)[number];
/** Use THIS, never `UPDATE_OP_ERRORS.includes(x as UpdateOpError)` — `isRunState`'s rule. */
export function isUpdateOpError(v: unknown): v is UpdateOpError {
  return typeof v === 'string' && (UPDATE_OP_ERRORS as readonly string[]).includes(v);
}

/** The `--from` word every console-driven move carries — a member of wave 4's
 *  `UPD_FROM_WORDS` (`ccd/ccrc`), which refuses any other at exit 2. */
export const UPDATE_OP_FROM = 'pwa';

/** `$HOME/.local/bin/ccrc` as parts: the installed shim, ABSOLUTE (§18 "the
 *  spawn argv is absolute"). A systemd user unit's PATH does not carry
 *  `~/.local/bin` (the reason `resolveSpawnCmd` exists for `ccd`), and a bare
 *  name would run whatever PATH found first. Spelled here once, and
 *  `single-definition.test.ts` holds it to this file. */
export const UPDATE_LAUNCHER_PARTS = ['.local', 'bin', 'ccrc'] as const;

/** `<home>/.local/bin/ccrc`. Throws `RangeError` unless `home` is absolute
 *  (`/`-led) with no trailing `/`: that is a caller bug (the agent's
 *  `cfg.home`, the server's own `cfg.home`), never something to spawn. Joined
 *  by hand because L0 imports no `node:path`. */
export function updateLauncherPath(home: string): string {
  if (!home.startsWith('/') || home.endsWith('/')) {
    throw new RangeError(`updateLauncherPath: home must be absolute with no trailing slash (got ${JSON.stringify(home)})`);
  }
  return [home, ...UPDATE_LAUNCHER_PARTS].join('/');
}

/** THE TWO TEMPLATES (spec §10): `[kind, '--to', tag, '--detach', '--from',
 *  UPDATE_OP_FROM]`. The spawn is therefore `ccrc update --to <tag> --detach
 *  --from pwa` or `ccrc rollback --to <tag> --detach --from pwa`, with `tag` the
 *  only variable token. Throws `RangeError` unless `isRequestKind(kind)` and
 *  `isReleaseTag(tag)`. The tag guard runs AGAIN here, though the agent's
 *  `validateReq` ran it first, so an edit that lets an unvalidated tag through
 *  the shape gate still never reaches `execFile`. Frozen: a caller cannot
 *  append a flag to a template. */
export function updateSpawnArgv(kind: RequestKind, tag: string): readonly string[] {
  if (!isRequestKind(kind)) {
    throw new RangeError(`updateSpawnArgv: kind must be update or rollback (got ${JSON.stringify(kind)})`);
  }
  if (!isReleaseTag(tag)) {
    throw new RangeError('updateSpawnArgv: tag is not a release tag (vX.Y.Z) — a caller bug; nothing was spawned');
  }
  return Object.freeze([kind, '--to', tag, '--detach', '--from', UPDATE_OP_FROM]);
}

/** D-3374 — the agent's bound on the `--detach` parent, and the
 *  server-role local spawn's. The parent is not instant: `ccrc rollback
 *  --detach` asks the release host whether the tag exists before it detaches
 *  (wave 4 Task 7). */
export const UPDATE_SPAWN_TIMEOUT_MS = 20_000;
/** The server's `FleetClient.request` deadline for THIS op only (the client's
 *  default is 15 s). Held strictly above `UPDATE_SPAWN_TIMEOUT_MS` by a test.
 *  The agent's answer, even "the parent timed out", therefore always arrives
 *  before the server gives up, so a timeout never releases a lease while a
 *  node is still starting a run. */
export const UPDATE_OP_TIMEOUT_MS = 30_000;
/** The bound on `ResErr.detail`. It is 200, the same as W2's
 *  `REPORT_DETAIL_MAX` for `update.json`'s own detail. */
export const UPDATE_OP_DETAIL_MAX = 200;

/** What a `spawn-failed` answer carries (spec §10, D-3372).
 *  Each line of the `--detach` parent's stderr is cleaned by W2's
 *  `printableDetail` rule: every run of characters outside printable ASCII
 *  (0x20–0x7E) becomes one space, then the ends are trimmed. The first line
 *  with anything left in it is the answer, cut to `UPDATE_OP_DETAIL_MAX`. With
 *  no such line the answer is `'no message'`, never an empty detail. */
export function firstStderrLine(stderr: string): string {
  for (const raw of stderr.split('\n')) {
    const line = raw.replace(/[^\x20-\x7e]+/g, ' ').trim();
    if (line !== '') return line.slice(0, UPDATE_OP_DETAIL_MAX);
  }
  return 'no message';
}
```

In `AgentReady`, directly above W2's `ops?: string[];` line (quoted in Files), insert one line:

```ts
  /** The one op word defined for this list is `UPDATE_OP` (`'update'`), which programme wave 5's agent sends; `readReadyOps` reads it. */
```

- [ ] **Step 5: Implement `shared/api.ts` (appended)**

After the file's last line (`export const UPDATE_GATE_CAP = 'update-gate';`), append:

```ts

/** What a `~/.ccrc/update.json` text says about a run IN FLIGHT (design
 *  2026-09-20 §10). Two callers ask it: the agent's `update` op, before it spawns
 *  (D-3371), and the server-role local spawn
 *  (programme wave 5 Task 5). The inventory NEVER asks it: `reportFrom`
 *  (`server/src/update/inventory.ts`) is that reader, and it answers a different
 *  question — the five report columns, with `unknown` for garbage. This one
 *  answers only "is a run in flight right now". So garbage is `null` here, not
 *  busy, and the node's own `_upd_lock` decides instead. `startedAtS` stays in
 *  SECONDS (ruling R1) because it is shown, never compared. */
export interface InFlightReport { phase: UpdatePhase; target: string | null; startedAtS: number | null }
/** Non-null iff `text` is ONE JSON object whose `phase` is in
 *  `IN_FLIGHT_UPDATE_PHASES`. Fields are read BY NAME and every other key is
 *  ignored (ruling R2: wave 4's `pid`, and any later key). `target` passes
 *  through `isReleaseTag`, else `null`. `startedAt` must be a positive safe
 *  integer ≤ `UNIX_SECONDS_MAX` (W2's one declaration, above in this file), else `null`, and the report is still kept. */
export function inFlightReport(text: string): InFlightReport | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const doc = parsed as Record<string, unknown>;
  const phase = doc.phase;
  if (!isUpdatePhase(phase) || !(IN_FLIGHT_UPDATE_PHASES as readonly UpdatePhase[]).includes(phase)) return null;
  const started = doc.startedAt;
  return {
    phase,
    target: isReleaseTag(doc.target) ? doc.target : null,
    startedAtS: typeof started === 'number' && Number.isSafeInteger(started) && started > 0 && started <= UNIX_SECONDS_MAX
      ? started : null,
  };
}
```

- [ ] **Step 6: Implement `server/src/remote/client.ts`**

Directly after the `import type { … } from '../../../shared/agent-protocol.js';` block (`:2-12`), add:

```ts
import { UPDATE_OP_DETAIL_MAX } from '../../../shared/agent-protocol.js';
```

Directly after `readReadyOps`'s closing `}` (W2 Task 8), insert:

```ts

/**
 * A `ResErr` the AGENT SENT (design 2026-09-20 §10, D-3373), as
 * opposed to a request the LINK failed. A link failure stays a plain `Error`
 * whose message is `disconnected`, `timeout` or `aborted`. The dispatcher must
 * tell "the node answered busy" from "the node could not be asked", and a
 * message string cannot do that, because nothing stops an agent word from being
 * spelled `timeout`. `instanceof` can.
 *
 * `message` is `err`, exactly what `new Error(err)` carried before this class
 * existed, so the one existing `.message` reader (`createRunner`'s catch arm,
 * which reports it as stderr) is unchanged; `caps()` and the io adapter catch
 * without reading the error at all. `detail` is `ResErr`'s ADDITIVE field. Absence
 * permits: an agent that sends none reads `null`. `onMessage` below is its ONE
 * reader, and it cuts the text to `UPDATE_OP_DETAIL_MAX`
 * (D-3391), because a peer that ignores the agent's
 * own bound must not write an unbounded string into an inventory row.
 */
export class AgentOpError extends Error {
  readonly code: string;
  readonly detail: string | null;
  constructor(code: string, detail: string | null) {
    super(code);
    this.name = 'AgentOpError';
    this.code = code;
    this.detail = detail;
  }
}
```

In `onMessage`, replace:

```ts
      if (msg.ok === false) {
        entry.reject(new Error(typeof msg.err === 'string' ? msg.err : 'error'));
```

with:

```ts
      if (msg.ok === false) {
        // THE ONE READER of `ResErr.detail` (design 2026-09-20 §10, D-3373): an answer the agent
        // SENT rejects as an `AgentOpError`. A link failure never reaches this line (`onClose`, the timer, the abort).
        entry.reject(new AgentOpError(typeof msg.err === 'string' ? msg.err : 'error', typeof msg.detail === 'string' ? msg.detail.slice(0, UPDATE_OP_DETAIL_MAX) : null));
```

- [ ] **Step 7: Run to verify they pass**

Run (foreground, one file at a time, timeout ≥ 600000 ms):
- `cd server && ./node_modules/.bin/vitest run test/update-op-vocabulary.test.ts`, then `test/single-definition.test.ts`, `test/remote-connect.test.ts`, `test/remote-runner.test.ts`, `test/peers-claims-l0.test.ts`, `test/update-states.test.ts`, `test/session-hook.test.ts -t 'every line citation is anchored'`, `test/typecheck-tests.test.ts`
- `cd server && ./node_modules/.bin/tsc --noEmit`
- `cd agent && npm ci` (only if `agent/node_modules` is absent) `&& npm run build`
- `cd pwa && npm ci` (only if `pwa/node_modules` is absent) `&& npm run build`

Expected: PASS, exit 0 everywhere.
- `update-op-vocabulary.test.ts` gains 24 cases: 2 + 5 + 1 + 4 + 6 + 6. `single-definition.test.ts` gains 4.
- `remote-connect.test.ts` and `remote-runner.test.ts` pass unchanged. Every existing rejection case matches `.message`, and `AgentOpError` keeps it; `createRunner`'s catch arm, the one `.message` reader, still reports the agent's word as `stderr`.
- `peers-claims-l0.test.ts` passes: `shared/api.ts` still has exactly its three type-only import lines.
- `session-hook` passes because nothing was inserted above a cited line. It is a known load flake: re-run a red in isolation before calling it a break. So is `typecheck-tests`.
- The PWA build compiles `shared/agent-protocol.ts` under `verbatimModuleSyntax` (the `type RequestKind` specifier is inline, as that option requires) and `noUnusedLocals`.

- [ ] **Step 8: Mutation measurement**

Make each edit, run the named file, see the named case red, restore by editing the line back (never `git checkout --`), and re-run green:

1. §18 "the op validates the tag with the one guard" (the argv half): in `updateSpawnArgv`, delete the three lines `if (!isReleaseTag(tag)) { … }`. `update-op-vocabulary.test.ts` reds on `throws on any tag isReleaseTag refuses — a caller bug, never a spawn`.
2. §18 "the spawn argv is absolute": make `updateLauncherPath`'s return `return 'ccrc';`. It reds on `the launcher is $HOME/.local/bin/ccrc — absolute, never bare ccrc`.
3. Review Focus 4: set `UPDATE_OP_TIMEOUT_MS = 15_000`. It reds on `UPDATE_SPAWN_TIMEOUT_MS is strictly below UPDATE_OP_TIMEOUT_MS`.
4. D-3373: put the rejection back to `entry.reject(new Error(typeof msg.err === 'string' ? msg.err : 'error'));`. Four AgentOpError cases red: `an answer the agent sent …`, `no detail …`, `a detail longer than …`, `an err that is not a string …`. The runner case and the dropped-link case stay green; they are the controls showing that the plain-`Error` path is what they measure.
5. D-3391: delete `.slice(0, UPDATE_OP_DETAIL_MAX)` in the rejection. It reds on `a detail longer than UPDATE_OP_DETAIL_MAX is cut at this reader`.
6. `inFlightReport`'s in-flight test: delete `|| !(IN_FLIGHT_UPDATE_PHASES as readonly UpdatePhase[]).includes(phase)`. It reds on `a terminal, unknown or off-vocabulary phase is not in flight` (the `done` row first).
7. `firstStderrLine`'s bound: replace `line.slice(0, UPDATE_OP_DETAIL_MAX)` with `line`. It reds on `is cut to UPDATE_OP_DETAIL_MAX`.
8. D-3370, the one-list pin: add `const UPDATE_OP_WORDS = ['bad-tag', 'bad-kind', 'busy', 'spawn-failed'];` to `server/src/remote/client.ts`. `single-definition.test.ts` reds on `the four words are listed together in one file — a second list is a second vocabulary`. Remove the line.

Count the cases in vitest's summary line before and after every restore; it must read the same green number each time (24 in the new file).

- [ ] **Step 9: Commit**

```bash
git add shared/agent-protocol.ts shared/api.ts server/src/remote/client.ts \
  server/test/update-op-vocabulary.test.ts server/test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts && cd ..
git commit -m "feat(update): the update op's L0 vocabulary — UpdateReq in the req envelope, four closed refusal words, the two absolute argv templates, the op timeouts in order, inFlightReport, and AgentOpError as the one reader of ResErr.detail"
```

### Task 2: The agent answers the op

**Files:**
- Modify: `agent/src/server.ts`. All anchors below are re-measured at the wave-2 tip (`2b5d4ce1`). W2 DOES touch this file: Task 8's `CCRC_DIR_NAME`/`NODE_FILE_BASENAMES` value import (`:30-36`), and D-3195's node-file arm inside `handleReq`'s `lstat` case. So every anchor from `:30` down sits 6 lines lower than at `d759c914`, and every anchor below the `lstat` case sits 42 lines lower. Neither wave 3 nor wave 4 touches this file, measured against their Files lists.
  - `node:fs` import (`:2`): gains `closeSync, constants as fsConstants, fstatSync, openSync, readSync`.
  - Type import block from `'../../shared/agent-protocol.js'` (`:7-29`): gains `UpdateOpError` and `UpdateReq`, alphabetically, after `TailReset`.
  - Value import block (`:30-36`, W2's multi-line import, which already carries `CCRC_DIR_NAME` and `NODE_FILE_BASENAMES`): replaced by one import of `CCRC_DIR_NAME, NODE_FILE_BASENAMES, NODE_FILES, parseCcdCaps, parseObservedEpochDoc, POOL_EPOCH_FILE_NAME, UPDATE_OP, UPDATE_SPAWN_TIMEOUT_MS, firstStderrLine, updateLauncherPath, updateSpawnArgv`, plus one new line after it: `import { inFlightReport, isReleaseTag, isRequestKind, type InFlightReport } from '../../shared/api.js';`.
  - `AgentOpts` (`:64-72`): gains `spawnUpdate?: UpdateSpawn` after `spawnPty?`.
  - `ReadyFrame` (`:151-177`): narrows `ops` to REQUIRED, the file's own `ccdVerbs`/`observedEpoch` idiom, with its docstring extended.
  - `fail` (`:189-191`): gains an optional `detail`, and `failUpdate` is added after it.
  - `UpdateSpawn`, `UPDATE_SPAWN_MAX_BUFFER`, `realUpdateSpawn` and `UpdateGate` go directly after `runExec` (`:280-299`), before `interface PtyEntry`.
  - `ConnCtx` (`:307-314`): gains `spawnUpdate: UpdateSpawn` and `updateGate: UpdateGate`.
  - `handleReq`: gains `case 'update'` directly before its `default:` (`:466`).
  - `ReqRefusal` goes directly above `validateReq`'s docstring (`:491`). `validateReq` gains `case 'update'` before its `default: return null` (`:562`), and its return type widens to `AgentReq | ReqRefusal | null`.
  - `UPDATE_REPORT_READ_MAX` and `readInFlightReport` go directly after `readObservedEpoch` (`:657-664`).
  - `handleConnection` (`:750-759`): takes `updateGate`, and its `ctx` carries both new fields.
  - The ready frame literal (`:799-801`, **CORRECTED from `:696-716`** at `d759c914`, which is `refreshVerbs`): gains `ops: [UPDATE_OP]`.
  - The message handler (`:816-825`): sends `failUpdate(req.id, req.refuse)` for a `ReqRefusal`.
  - `startAgent` (`:869-894`, **CORRECTED from `:832-852`** at `d759c914`; its `spawnPty:` default is `:880`): defaults `spawnUpdate: rawOpts.spawnUpdate ?? realUpdateSpawn`, makes ONE `updateGate` and passes it to every connection.
- Modify: `agent/CLAUDE.md` — one bullet under "Agent runtime facts", directly after the `ptyOpen` bullet (quoted: ``- `ptyOpen` only ever spawns `tmux attach -t cc-<sessionId>` with `sessionId` sanitized to `[A-Za-z0-9_-]+` —``). It says the `update` op is the ONE wire-triggered spawn outside the exec whitelist, and gives the procedure for adding an op.
- Test: `agent/test/update-op.test.ts` (create). A real agent over a fixture HOME, a recording `spawnUpdate`, and the `agent/test/build-fp.test.ts` WS idiom with its every-client `afterEach`.
- Modify: `server/test/remote-connect.test.ts` — W2 Task 8's real-agent literal in `'reaches connected:true with downSince:null after a good handshake'` (quoted: `agentOps: [],` inside the whole-object `toEqual`, under the comment that begins ``// `agentOps: []`, not absent: a REAL W2 agent sends no `ops` ``) becomes `agentOps: ['update'],`, and its four-line comment is replaced in place. The case title names no ops, so it is kept.
- Modify: `server/test/update-inventory.test.ts` — **ADDED (missing from the skeleton)**: W2 Task 11's real-agent case `'a ready frame measures the fleet node inside the same second'` asserts (quoted) `expect(row).toMatchObject({ role: 'fleet', caps: ['verify', 'node-id', 'floor'], os: 'linux', highestVersion: 'v0.0.12', agentOps: [], reachable: true });` over `bootAgent`. It reds the moment the real agent advertises the op, so `agentOps: []` becomes `agentOps: ['update']` in place.
- Run only, **CORRECTED from "modify only if red"**: `agent/test/build-fp.test.ts` and `agent/test/observed-epoch.test.ts` carry NO whole-object ready-frame assertion (measured, `git grep -n "hello()" agent/test`: every `hello()` result is read one field at a time), so neither can red on `ops`.
- Run, not edited:
  - `agent/test/whitelist-structural.test.ts`, `agent/test/whitelist-prototype.test.ts`, `agent/test/whitelist-noghosts.test.ts` (safety hardware, agent/CLAUDE.md).
  - `agent/test/whitelist.test.ts`, `agent/test/exec.test.ts`, `agent/test/malformed.test.ts` (the envelope's `bad-request` for an unknown op, unchanged), `agent/test/module-format.test.ts` (the agent now imports `shared/api.ts` at runtime).
  - `server/test/whitelist-subset.test.ts`, `server/test/ccrc-api-closed.test.ts` (its `EXEC_COMMANDS` literal pin), `server/test/single-definition.test.ts` (W2's `'update.json'` quoted-name scan walks `agent/src`, and Task 1's launcher scans), `server/test/typecheck-tests.test.ts` (it compiles `agent/test` too), `server/test/topology-clean.test.ts` (after `git add`).
  - `cd agent && npm run build`.

**Interfaces:**
- Consumes: Task 1's `UpdateReq`, `UPDATE_OP`, `UpdateOpError`, `updateLauncherPath`, `updateSpawnArgv`, `UPDATE_SPAWN_TIMEOUT_MS`, `firstStderrLine`, `inFlightReport`, `InFlightReport`, `ResErr.detail?`; `isReleaseTag`, `isRequestKind` (W2 Task 1); `CCRC_DIR_NAME`, `NODE_FILES.report`, `AgentReady.ops?` (W2 Task 8); `send`, `ok`, `fail` (`agent/src/server.ts:181-191`); `ConnCtx.cfg.home`; `readObservedEpoch`'s read-and-fold idiom (`:657-664`); `ptyOpen`'s validated-single-token template (`:451-465`); the `ReadyFrame` narrowing idiom (`:151-177`); wave 4's `--detach` parent contract. That parent exits 0 once `queued` is written and `_svc_run_detached` succeeded. It exits 1 with `ccrc: …` on stderr (`_ccrc_die` prints `$PROG: $*`) for a held lock (`ccrc: update: another update holds ~/.ccrc/update.lock (pid <p>, target <t>)`), an unmeasurable lock, Darwin (`ccrc: --detach is Linux-only (decision 17)`), or a failing `systemd-run`. It exits 2 for an argument refusal.
- Produces (in `agent/src/server.ts`):

```ts
/** validateReq's answer for a well-shaped op whose ARGUMENT fails its guard — sent as failUpdate(id, refuse). */
export interface ReqRefusal { refuse: Extract<UpdateOpError, 'bad-tag' | 'bad-kind'>; id: number }   // CORRECTED: narrowed
/** The update op's spawn port — execFile(file, args, {timeout}) in production; tests inject a recorder. */
export type UpdateSpawn = (file: string, args: readonly string[], timeoutMs: number) =>
  Promise<{ code: number; stderr: string; killed: boolean }>;
/** CORRECTED: a SPAWN error (the launcher absent or not executable) answers code 1 with stderr
 *  `could not start the launcher (<errno code>)` (D-3393), never an empty stderr. */
export const realUpdateSpawn: UpdateSpawn;
/** `~/.ccrc/update.json` read DIRECTLY (never checkPath, D-3371): opened
 *  O_RDONLY|O_NONBLOCK, refused unless fstat says a regular file of at most 65536 bytes, parsed by
 *  inFlightReport; absent / unreadable / over-cap / not a regular file / unparseable → null (not busy). */
export function readInFlightReport(home: string): InFlightReport | null;
// AgentOpts gains: spawnUpdate?: UpdateSpawn   — default realUpdateSpawn
// CORRECTED (D-3392): ConnCtx gains spawnUpdate: UpdateSpawn and updateGate: UpdateGate, where
//   interface UpdateGate { spawning: boolean } is made ONCE in startAgent and shared by every connection —
//   not a per-connection `updateSpawning: boolean`.
// CORRECTED: fail(id, message, detail?) — detail spread only when given; failUpdate(id, err: UpdateOpError, detail?).
// CORRECTED: ReadyFrame = Omit<AgentReady, 'ccdVerbs' | 'observedEpoch' | 'ops'> & { ccdVerbs: string[]; observedEpoch: number | null; ops: string[] }.
```

- `validateReq`'s `case 'update'`:
  - The numeric `id` rule is unchanged. A missing or non-numeric `id` returns `null`, which is the envelope's rule; the handler answers nothing when there is no `id`.
  - `tag` not `isReleaseTag` → `{refuse: 'bad-tag', id}`.
  - `kind` present and not `isRequestKind` → `{refuse: 'bad-kind', id}`; `null` counts as present.
  - Otherwise → `{t: 'req', id, op: 'update', tag, kind}`, with `kind` defaulting to `'update'`. No other key is carried.
- `handleReq`'s `case 'update'`, in order, with no `await` before the busy decision:
  1. `ctx.updateGate.spawning` → `failUpdate(id, 'busy', 'an update op is already spawning on this agent')`.
  2. `readInFlightReport(home)` non-null → `failUpdate(id, 'busy', \`update.json says ${phase} (target ${target ?? 'none'}, started ${startedAtS ?? 'unknown'})\`)` (Review Focus 3).
  3. `file = updateLauncherPath(home)`, `argv = updateSpawnArgv(req.kind ?? 'update', req.tag)`. Set `spawning`, `await ctx.spawnUpdate(file, argv, UPDATE_SPAWN_TIMEOUT_MS)`, and clear `spawning` in `finally`.
  4. `killed` → `failUpdate(id, 'spawn-failed', \`the --detach parent did not exit within ${UPDATE_SPAWN_TIMEOUT_MS} ms\`)`. `code !== 0` → `failUpdate(id, 'spawn-failed', firstStderrLine(stderr))`. Otherwise → `ok(id, { accepted: true })` (D-3372).

  The case names no `isExecAllowed`, `runExec`, `resolveSpawnCmd`, `checkPath` or `EXEC_WHITELIST`.
- Ready frame: `ops: [UPDATE_OP]` — the whole list; W2's `readReadyOps` reads it as `['update']`.
- Cases (spec §10 Pins). The skeleton's list, with two changes. The parked spawn is an in-process deferred rather than a fixture file. The lock-sentence fixture carries the real `ccrc: ` prefix.
  - Refusals, with nothing spawned:
    - `tag: '; rm -rf ~'` → `bad-tag`, the recorder saw nothing.
    - `42`, `null`, an absent tag, `['v0.0.9']` → `bad-tag`.
    - `kind: 'sideways'`, `null`, `'Update'`, `1` → `bad-kind`.
    - No `id` → no reply, and the connection still serves.
    - `kind` absent → the update template.
  - The spawn and its answers:
    - The recorder saw exactly `[<home>/.local/bin/ccrc, ['update','--to','v0.0.9','--detach','--from','pwa']]` with timeout `UPDATE_SPAWN_TIMEOUT_MS`, and the rollback twin for `kind: 'rollback'`.
    - Exit 0 → `{t:'res', id, ok:true, accepted:true}`, exactly.
    - Exit 1 with stderr `ccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)\nsecond\n` → `spawn-failed` with that first line (Review Focus 3's lock case).
    - `killed: true` → `spawn-failed` naming the timeout (Review Focus 4).
    - A spawn port that throws → the envelope's `.catch` answers, and the gate is released.
  - Busy and not busy:
    - `update.json` in `queued`/`installing`/`restoring` → `busy`, with the phase, target and start second in `detail`, nothing spawned.
    - `done`/`failed`/`reverted` → spawned.
    - An unparseable, a 70 KiB, an EACCES (`chmod 000`, skipped under root) and a FIFO (`mkfifo`, skipped on Darwin) `update.json` → spawned.
    - `readInFlightReport` called directly: absent → `null`, `installing` → the report.
    - A second op while the first spawn is parked → `busy` with the spawning detail, on the SAME connection and on a SECOND one. After release the first answers `accepted` and a third op spawns.
  - The ready frame carries `ops: ['update']`.
  - Source scans:
    - `handleReq`'s `case 'update'` block names none of `isExecAllowed(`, `runExec(`, `resolveSpawnCmd(`, `checkPath(`, `EXEC_WHITELIST`, while the SAME cut of `case 'exec'` does name `isExecAllowed(` (the control).
    - `validateReq`'s case calls `isReleaseTag(msg.tag)` and `isRequestKind(kind)` and spells no regex.
    - `realUpdateSpawn`'s and `readInFlightReport`'s bodies name no exec path.
  - The exec surface: `EXEC_COMMANDS` still `['tmux','ccd']`, `ccrc` on neither list, and `isExecAllowed` refuses both `ccrc` and the absolute launcher with the template argv.
  - The real `realUpdateSpawn`, over a fixture `$HOME/.local/bin/ccrc` script, as the agent's DEFAULT spawn (no injection), with `process.env.PATH` cut to `/usr/bin:/bin` and `process.env.HOME` set to the fixture for every case in that describe and restored in its `afterEach` — **ADDED**: `execFile` passes the operator's env to the child, so mutation 5's bare `'ccrc'` would otherwise resolve the REAL launcher on the operator's PATH: it records `$0` and the exact argv, and answers `accepted`. The same script exiting 1 answers its first real stderr line. An absent launcher answers `could not start the launcher (ENOENT)`. A `sleep 5` launcher called directly with a 300 ms bound comes back `killed`.
- Spec §18 rows pinned:
  - "the op validates the tag with the one guard". Mutation: drop the `isReleaseTag` check → the `; rm` case answers the argv guard's `RangeError` message instead of `bad-tag`. Drop the argv guard as well → the recorder records the tag and the case reds on "nothing spawned".
  - "the op never execs". Mutations: route the case through `isExecAllowed('ccrc', …)` → the op answers `forbidden` and the scan reds; call `runExec` → the scan reds.
  - "the spawn argv is absolute". Mutation: pass `'ccrc'` as the file → the argv case reds.
  - "an agent without the op is never sent it", the agent half: the ready frame advertises exactly `['update']`. Mutation: drop `ops` → `update-op.test.ts`, `remote-connect.test.ts` and `update-inventory.test.ts` red.
  - Review Focus 3 and 4.

- [ ] **Step 1: Re-measure the base**

Run from the worktree root:

```bash
git grep -n -e "case 'ptyOpen': {" -e '    default: {' -e 'function validateReq(' -e 'export function readObservedEpoch(' \
  -e 'type ReadyFrame = ' -e "t: 'ready', v: 1, ccdVerbs: verbCache.verbs" -e 'const req = validateReq(msg);' \
  -e 'spawnPty: rawOpts.spawnPty ?? spawnFleetPty,' -- agent/src/server.ts
git grep -n -e 'export const UPDATE_OP_ERRORS' -e 'export function updateSpawnArgv' -- shared/agent-protocol.ts
git grep -n 'export function inFlightReport' -- shared/api.ts
git grep -n -e 'agentOps: \[\],' -- server/test/remote-connect.test.ts server/test/update-inventory.test.ts
git grep -n "hello()" -- agent/test/build-fp.test.ts agent/test/observed-epoch.test.ts
ls agent/node_modules >/dev/null 2>&1 || (cd agent && npm ci)
```

Expected:
- One hit per pattern in `agent/src/server.ts`, except `case 'ptyOpen': {`, which has two: `handleReq`'s (`:451`) and `validateReq`'s (`:554`). The `    default: {` hit is `handleReq`'s (`:466`); `validateReq`'s default is the bare `    default:` at `:562`.
- Task 1's three exports are present.
- The W2 literals are present, five hits in all. `remote-connect.test.ts` has one. It is W2 Task 8's, inside `'reaches connected:true with downSince:null after a good handshake'`, and Step 3 moves it. If a `fakeReadyAgent` case shows another hit, leave it alone. `update-inventory.test.ts` has four:
  - the `ROW` fixture (`caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.12', …`)
  - the `meas` fixture (`… provenance: 'verified', caps: ['verify', 'node-id', 'floor'], agentOps: [],`)
  - the unreachable-placeholder case (`… stampRead: 'unreadable', agentOps: [],`)
  - the real-agent line in `'a ready frame measures the fleet node inside the same second'` (`expect(row).toMatchObject({ role: 'fleet', … agentOps: [], reachable: true });`)

  Step 3 moves only the real-agent line. The two fixtures and the unreachable case do not read a real agent, so they stay `[]`. Four hits in this file means the producer landed as planned. It does not mean it drifted.
- Every `hello()` in the two agent files is read one field at a time (`.build`, `.observedEpoch`, `.t`, `'build' in …`), never compared whole.

- [ ] **Step 2: Write the failing test**

Create `agent/test/update-op.test.ts`:

```ts
// Design 2026-09-20 §10: the `update` op, answered by a REAL agent over a real
// loopback WS against a fixture HOME (the `build-fp.test.ts` idiom). Every spawn
// is the injected `AgentOpts.spawnUpdate` recorder, with one exception: the
// describe at the end runs `realUpdateSpawn` over a fixture launcher UNDER the
// fixture HOME, with the process's PATH and HOME contained for its cases. None
// of these cases touches a real `~/.local/bin/ccrc` or the live `$HOME`.
//
// What is pinned (spec §10 Pins, §18):
//  - The argument is gated in `validateReq`, before any case body runs, and
//    nothing spawns. A bad tag answers `bad-tag` (`isReleaseTag`, the one
//    guard) and a bad kind `bad-kind`. Neither is ever `bad-request`, which
//    from this op must mean "the agent predates it".
//  - `busy` in two situations. One: `~/.ccrc/update.json` says a run is in
//    flight, read directly and bounded
//    (D-3371). Two: another op is still
//    spawning on this AGENT (D-3392).
//  - The spawn is exactly one of two absolute argv templates, bounded by
//    `UPDATE_SPAWN_TIMEOUT_MS`.
//  - The answer is `accepted` only once the `--detach` parent exited 0.
//    Anything else is `spawn-failed`, carrying the parent's first stderr line
//    (D-3372) or the timeout named.
//  - The ready frame advertises exactly `['update']`.
//  - The op reaches no exec path. This is a SOURCE scan, because no behavioural
//    case can see an extra call whose answer comes out the same.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInFlightReport, realUpdateSpawn, type RunningAgent, type UpdateSpawn } from '../src/server.js';
import { EXEC_COMMANDS, FORBIDDEN_COMMANDS, isExecAllowed } from '../src/whitelist.js';
import {
  UPDATE_SPAWN_TIMEOUT_MS, updateLauncherPath, updateSpawnArgv, type AgentReady,
} from '../../shared/agent-protocol.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_TS = path.resolve(here, '..', 'src', 'server.ts');

interface Res { t: 'res'; id: number; ok: boolean; err?: string; detail?: string; accepted?: boolean }
interface SpawnCall { file: string; args: string[]; timeoutMs: number }
type SpawnAnswer = Awaited<ReturnType<UpdateSpawn>>;

/** A recording `spawnUpdate`. After `park()`, every call waits until
 *  `release()`, which stands in for a `--detach` parent still running. */
function recorder(answer: SpawnAnswer = { code: 0, stderr: '', killed: false }) {
  const calls: SpawnCall[] = [];
  let gate: Promise<void> | null = null;
  let open: () => void = () => {};
  const spawn: UpdateSpawn = async (file, args, timeoutMs) => {
    calls.push({ file, args: [...args], timeoutMs });
    if (gate !== null) await gate;
    return answer;
  };
  return {
    calls,
    spawn,
    park(): void { gate = new Promise<void>((r) => { open = r; }); },
    release(): void { gate = null; open(); },
  };
}

/** wave 4's `update.json` line — seven keys, times in unix SECONDS (rulings R1/R14). */
const reportLine = (o: Record<string, unknown> = {}): string => `${JSON.stringify({
  target: 'v0.0.8', phase: 'installing', startedAt: 1790000000, updatedAt: 1790000060, detail: null, from: 'pwa',
  pid: 4242, ...o,
})}\n`;
function reportPath(home: string): string {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  return path.join(home, '.ccrc', 'update.json');
}
const TEMPLATE = ['update', '--to', 'v0.0.9', '--detach', '--from', 'pwa'];

/** The text between `open` and the first `close` match after it: a named slice
 *  of the real source, which fails loudly when either anchor is missing. */
function slice(src: string, open: string, close: RegExp): string {
  const at = src.indexOf(open);
  expect(at, `${open} not found in agent/src/server.ts`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(at + open.length);
  const end = close.exec(rest);
  expect(end, `no end after ${open}`).not.toBeNull();
  return rest.slice(0, end!.index);
}
/** Every way into the exec surface or the wire read gate. */
const EXEC_PATH = /\b(?:isExecAllowed|runExec|resolveSpawnCmd|checkPath)\s*\(|\bEXEC_WHITELIST\b/;
const CASE_END = /\n    (?:case '|default:)/;

describe('the update op', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  /** EVERY client this file opens, closed by the hook whether the case passed or
   *  threw (`build-fp.test.ts`'s reason: mutation sweeps run with red asserts). */
  const clients: TestClient[] = [];
  const open = async (port: number): Promise<TestClient> => {
    const c = new TestClient(port);
    clients.push(c);
    await c.hello();
    return c;
  };

  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
      rmSync(fixture.outside, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  /** A fixture HOME, a real agent spawning through `rec`, and one authenticated client. */
  async function up(rec = recorder()): Promise<{ c: TestClient; rec: ReturnType<typeof recorder>; home: string }> {
    fixture = makeFixture();
    agent = await boot(fixture, { spawnUpdate: rec.spawn });
    return { c: await open(agent.port), rec, home: fixture.home };
  }

  describe('validateReq gates the argument before any case body runs', () => {
    it("a tag that fails isReleaseTag is bad-tag — the '; rm' fixture spawns nothing", async () => {
      const { c, rec } = await up();
      const res = await c.req<Res>(1, { op: 'update', tag: '; rm -rf ~' });
      // "Nothing spawned" is asserted FIRST: with both guard layers removed
      // (Step 8 mutation 2) the answer is `accepted`, and this is the line that
      // must name what happened — the tag reached the spawn.
      expect(rec.calls, 'the recorder saw a spawn').toEqual([]);
      expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'bad-tag' });
    });

    it('a tag that is not a string, or no tag at all, is bad-tag', async () => {
      const { c, rec } = await up();
      const frames: Record<string, unknown>[] = [
        { op: 'update', tag: 42 }, { op: 'update', tag: null }, { op: 'update' }, { op: 'update', tag: ['v0.0.9'] },
      ];
      for (const [i, frame] of frames.entries()) {
        expect(await c.req<Res>(i + 1, frame), JSON.stringify(frame)).toEqual({ t: 'res', id: i + 1, ok: false, err: 'bad-tag' });
      }
      expect(rec.calls).toEqual([]);
    });

    it('a kind outside RequestKind is bad-kind — never bad-request, and nothing spawns', async () => {
      const { c, rec } = await up();
      for (const [i, kind] of (['sideways', null, 'Update', 1] as const).entries()) {
        expect(await c.req<Res>(i + 1, { op: 'update', tag: 'v0.0.9', kind }), String(kind))
          .toEqual({ t: 'res', id: i + 1, ok: false, err: 'bad-kind' });
      }
      expect(rec.calls).toEqual([]);
    });

    it('no id is no reply (the envelope rule, unchanged) and the connection keeps serving', async () => {
      const { c, rec } = await up();
      c.send({ t: 'req', op: 'update', tag: 'v0.0.9' });
      expect(await c.req<Res>(2, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ id: 2, ok: true, accepted: true });
      await expect(c.waitFor((m) => (m as Res).t === 'res' && (m as Res).id === undefined, 300)).rejects.toThrow('timed out');
      expect(rec.calls).toHaveLength(1);
    });

    it('kind absent is the update template', async () => {
      const { c, rec } = await up();
      await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' });
      expect(rec.calls.map((x) => x.args)).toEqual([TEMPLATE]);
    });
  });

  describe('the spawn — two absolute templates, and an answer only once the --detach parent exited', () => {
    it('update: exactly <home>/.local/bin/ccrc update --to <tag> --detach --from pwa, bounded, then accepted', async () => {
      const { c, rec, home } = await up();
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9', kind: 'update' }))
        .toEqual({ t: 'res', id: 1, ok: true, accepted: true });
      expect(rec.calls).toEqual([
        { file: path.join(home, '.local', 'bin', 'ccrc'), args: TEMPLATE, timeoutMs: UPDATE_SPAWN_TIMEOUT_MS },
      ]);
    });

    it('rollback: the twin template', async () => {
      const { c, rec, home } = await up();
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.8', kind: 'rollback' })).toMatchObject({ ok: true, accepted: true });
      expect(rec.calls).toEqual([{
        file: path.join(home, '.local', 'bin', 'ccrc'),
        args: ['rollback', '--to', 'v0.0.8', '--detach', '--from', 'pwa'],
        timeoutMs: UPDATE_SPAWN_TIMEOUT_MS,
      }]);
    });

    it('a parent that exits 1 is spawn-failed carrying its first stderr line — the held-lock case (Review Focus 3)', async () => {
      const LOCK = 'ccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)';
      const { c } = await up(recorder({ code: 1, stderr: `${LOCK}\nsecond\n`, killed: false }));
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' }))
        .toEqual({ t: 'res', id: 1, ok: false, err: 'spawn-failed', detail: LOCK });
    });

    it('a parent killed at the bound is spawn-failed naming the timeout (Review Focus 4)', async () => {
      const { c } = await up(recorder({ code: 1, stderr: '', killed: true }));
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toEqual({
        t: 'res', id: 1, ok: false, err: 'spawn-failed',
        detail: `the --detach parent did not exit within ${UPDATE_SPAWN_TIMEOUT_MS} ms`,
      });
    });

    it('a spawn port that throws is answered by the envelope, and the gate is released', async () => {
      fixture = makeFixture();
      let first = true;
      const spawn: UpdateSpawn = async () => {
        if (first) { first = false; throw new Error('spawn port failed'); }
        return { code: 0, stderr: '', killed: false };
      };
      agent = await boot(fixture, { spawnUpdate: spawn });
      const c = await open(agent.port);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' }))
        .toEqual({ t: 'res', id: 1, ok: false, err: 'spawn port failed' });
      expect(await c.req<Res>(2, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
    });
  });

  describe('busy — a run in flight, or a spawn still running on this agent', () => {
    it('update.json in flight is busy, naming the phase, target and start second — nothing spawned', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      for (const [i, phase] of (['queued', 'installing', 'restoring'] as const).entries()) {
        writeFileSync(p, reportLine({ phase }));
        expect(await c.req<Res>(i + 1, { op: 'update', tag: 'v0.0.9' }), phase).toEqual({
          t: 'res', id: i + 1, ok: false, err: 'busy',
          detail: `update.json says ${phase} (target v0.0.8, started 1790000000)`,
        });
      }
      writeFileSync(p, reportLine({ target: null, startedAt: 1790000000000 }));
      expect(await c.req<Res>(4, { op: 'update', tag: 'v0.0.9' }))
        .toMatchObject({ err: 'busy', detail: 'update.json says installing (target none, started unknown)' });
      expect(rec.calls).toEqual([]);
    });

    it('a finished report is not busy — done, failed and reverted all spawn', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      for (const [i, phase] of (['done', 'failed', 'reverted'] as const).entries()) {
        writeFileSync(p, reportLine({ phase }));
        expect(await c.req<Res>(i + 1, { op: 'update', tag: 'v0.0.9' }), phase).toMatchObject({ ok: true, accepted: true });
      }
      expect(rec.calls).toHaveLength(3);
    });

    it('a report the agent cannot use is not busy — unparseable, over the 64 KiB bound', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      writeFileSync(p, '{');
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
      // In flight AND over the bound: only the bound can make this one spawn.
      writeFileSync(p, `{"phase":"installing","pad":"${'x'.repeat(70 * 1024)}"}\n`);
      expect(await c.req<Res>(2, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
      expect(rec.calls).toHaveLength(2);
    });

    it.skipIf(process.getuid?.() === 0)('an unreadable report (EACCES) is not busy', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      writeFileSync(p, reportLine());
      chmodSync(p, 0o000);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
      expect(rec.calls).toHaveLength(1);
    });

    // A FIFO at the report's name must not wedge the agent in open(2): the read
    // is O_NONBLOCK and refuses anything fstat does not call a regular file.
    // Skipped on Darwin: the FIFO probes are measured flaky on the macOS runner.
    it.skipIf(process.platform === 'darwin')('a FIFO at update.json is not busy, and does not wedge the agent', async () => {
      const { c, rec, home } = await up();
      const p = reportPath(home);
      expect(spawnSync('mkfifo', [p]).status).toBe(0);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
      expect(rec.calls).toHaveLength(1);
    });

    it('readInFlightReport reads the file directly: absent is null, in flight is the report', () => {
      fixture = makeFixture();
      expect(readInFlightReport(fixture.home)).toBeNull();
      writeFileSync(reportPath(fixture.home), reportLine());
      expect(readInFlightReport(fixture.home)).toEqual({ phase: 'installing', target: 'v0.0.8', startedAtS: 1790000000 });
    });

    it('a second op while the first is still spawning is busy — on this connection AND on another', async () => {
      const rec = recorder();
      const { c } = await up(rec);
      rec.park();
      c.send({ t: 'req', id: 1, op: 'update', tag: 'v0.0.9' });
      await vi.waitFor(() => expect(rec.calls).toHaveLength(1), { timeout: 3000 });
      const DETAIL = 'an update op is already spawning on this agent';
      expect(await c.req<Res>(2, { op: 'update', tag: 'v0.0.9' }))
        .toEqual({ t: 'res', id: 2, ok: false, err: 'busy', detail: DETAIL });
      // A reconnecting server is a NEW connection: the gate belongs to the agent
      // process, not to the socket (D-3392).
      const other = await open(agent!.port);
      expect(await other.req<Res>(1, { op: 'update', tag: 'v0.0.9' }))
        .toEqual({ t: 'res', id: 1, ok: false, err: 'busy', detail: DETAIL });
      rec.release();
      expect(await c.waitFor<Res>((m) => (m as Res).t === 'res' && (m as Res).id === 1))
        .toEqual({ t: 'res', id: 1, ok: true, accepted: true });
      expect(await c.req<Res>(3, { op: 'update', tag: 'v0.0.9' })).toMatchObject({ ok: true, accepted: true });
      expect(rec.calls).toHaveLength(2);
    });
  });

  it("the ready frame advertises exactly ['update'] (§18 \"an agent without the op is never sent it\", the agent half)", async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { spawnUpdate: recorder().spawn });
    const c = new TestClient(agent.port);
    clients.push(c);
    expect((await c.hello() as AgentReady).ops).toEqual(['update']);
  });

  describe('the op reaches no exec path (§18 "the op never execs") — read from the source', () => {
    const src = readFileSync(SERVER_TS, 'utf8');

    it("handleReq's update case names no exec-surface call; the same cut of the exec case does (the control)", () => {
      const handle = slice(src, 'async function handleReq(', /\n\}\n/);
      const body = slice(handle, "case 'update': {", CASE_END);
      expect(body).not.toMatch(EXEC_PATH);
      expect(body).toMatch(/const file = updateLauncherPath\(home\);/);
      expect(body).toMatch(/const argv = updateSpawnArgv\(req\.kind \?\? 'update', req\.tag\);/);
      expect(body).toMatch(/ctx\.spawnUpdate\(file, argv, UPDATE_SPAWN_TIMEOUT_MS\)/);
      expect(slice(handle, "case 'exec': {", CASE_END)).toMatch(/isExecAllowed\(/);
    });

    it("validateReq's update case calls the one tag guard and the one kind guard, and restates neither", () => {
      const validate = slice(src, 'function validateReq(', /\n\}\n/);
      const body = slice(validate, "case 'update': {", CASE_END);
      expect(body).toMatch(/isReleaseTag\(msg\.tag\)/);
      expect(body).toMatch(/isRequestKind\(kind\)/);
      expect(body, 'the tag shape is restated here').not.toMatch(/\/\^v|RELEASE_TAG/);
    });

    it('the spawn port and the report read name no exec path either', () => {
      const spawnBody = slice(src, 'export const realUpdateSpawn', /\ninterface PtyEntry/);
      expect(spawnBody).not.toMatch(EXEC_PATH);
      expect(spawnBody).toMatch(/execFile\(file, args, /);
      const readBody = slice(src, 'export function readInFlightReport(', /\n\}\n/);
      expect(readBody).not.toMatch(EXEC_PATH);
      expect(readBody).toMatch(/NODE_FILES\.report/);
    });

    it('the exec surface is untouched: ccrc is on neither list, and the exec op refuses the template', () => {
      expect([...EXEC_COMMANDS]).toEqual(['tmux', 'ccd']);
      expect((EXEC_COMMANDS as readonly string[]).includes('ccrc')).toBe(false);
      expect((FORBIDDEN_COMMANDS as readonly string[]).includes('ccrc')).toBe(false);
      const argv = [...updateSpawnArgv('update', 'v0.0.9')];
      expect(isExecAllowed('ccrc', argv)).toBe(false);
      expect(isExecAllowed(updateLauncherPath('/h'), argv)).toBe(false);
    });
  });

  describe('realUpdateSpawn — one real child, under the fixture HOME', () => {
    // CONTAINMENT, not convenience. `execFile` hands the child THIS process's
    // env, which is the operator's: a PATH carrying the real `~/.local/bin` and
    // the real HOME. Every launcher here is the fixture's ABSOLUTE path, but
    // under Step 8's mutation 5 (`const file = 'ccrc';`) an uncontained PATH
    // would resolve the REAL `ccrc` and run a real `ccrc rollback --to v0.0.9
    // --detach --from pwa` against the live box. So every case in this
    // describe runs with PATH cut to the system directories (the scripts need
    // only `/bin/sh`, `printf` and `sleep`) and HOME at the fixture, restored
    // whether the case passed or threw.
    const saved = { PATH: process.env.PATH, HOME: process.env.HOME };
    function contain(home: string): void {
      process.env.PATH = '/usr/bin:/bin';
      process.env.HOME = home;
    }
    afterEach(() => {
      for (const k of ['PATH', 'HOME'] as const) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    });
    function plantLauncher(home: string, body: string): string {
      const bin = path.join(home, '.local', 'bin');
      mkdirSync(bin, { recursive: true });
      const file = path.join(bin, 'ccrc');
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
      return file;
    }

    it("is the agent's default: the absolute launcher runs with the exact argv, and exit 0 is accepted", async () => {
      fixture = makeFixture();
      contain(fixture.home);
      const argvFile = path.join(fixture.home, 'argv');
      plantLauncher(fixture.home, `printf '%s\\n' "$0" "$@" > '${argvFile}'`);
      agent = await boot(fixture);   // NO spawnUpdate: startAgent's default is the thing under test
      const c = await open(agent.port);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9', kind: 'rollback' }))
        .toEqual({ t: 'res', id: 1, ok: true, accepted: true });
      expect(readFileSync(argvFile, 'utf8')).toBe(
        [path.join(fixture.home, '.local', 'bin', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--detach', '--from', 'pwa', '']
          .join('\n'));
    });

    it("a parent that exits 1 is spawn-failed with its first real stderr line, byte for byte", async () => {
      fixture = makeFixture();
      contain(fixture.home);
      plantLauncher(fixture.home, "printf 'ccrc: --detach is Linux-only (decision 17)\\nsecond line\\n' >&2\nexit 1");
      agent = await boot(fixture);
      const c = await open(agent.port);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toEqual({
        t: 'res', id: 1, ok: false, err: 'spawn-failed', detail: 'ccrc: --detach is Linux-only (decision 17)',
      });
    });

    it('a launcher that is not there is spawn-failed naming why, never an empty detail (D-3393)', async () => {
      fixture = makeFixture();
      contain(fixture.home);
      agent = await boot(fixture);
      const c = await open(agent.port);
      expect(await c.req<Res>(1, { op: 'update', tag: 'v0.0.9' })).toEqual({
        t: 'res', id: 1, ok: false, err: 'spawn-failed', detail: 'could not start the launcher (ENOENT)',
      });
    });

    it('a parent that outlives the bound is killed, and says so', async () => {
      fixture = makeFixture();
      contain(fixture.home);
      const file = plantLauncher(fixture.home, 'exec sleep 5');
      const t0 = Date.now();
      const r = await realUpdateSpawn(file, updateSpawnArgv('update', 'v0.0.9'), 300);
      expect(r).toMatchObject({ killed: true });
      expect(r.code).not.toBe(0);
      expect(Date.now() - t0).toBeLessThan(4000);
    });
  });
});
```

- [ ] **Step 3: Move the two server literals the real agent's ready frame reaches**

In `server/test/remote-connect.test.ts`, inside `'reaches connected:true with downSince:null after a good handshake'`, replace W2's block:

```ts
    // `agentOps: []`, not absent: a REAL W2 agent sends no `ops` (the field is
    // W4's), and the client records "ready arrived, no op named" — `[]` — which
    // is not local mode's `undefined`. When W4's agent starts advertising
    // `['update']`, this literal is the line that must move with it.
    await vi.waitFor(
      () => expect(fleet!.state).toEqual({
        connected: true, downSince: null, ccdVerbs: [], rosterFp: null, build: null, observedEpoch: null,
        agentOps: [],
      }),
```

with:

```ts
    // `agentOps: ['update']`: the REAL agent advertises the one op it answers
    // beyond the closed set (design 2026-09-20 §10, programme wave 5 Task 2),
    // read through `readReadyOps`. This literal read `[]` while the agent sent
    // no `ops`; a ready frame that stops sending the word reds HERE — §18 "an
    // agent without the op is never sent it", on the agent's side.
    await vi.waitFor(
      () => expect(fleet!.state).toEqual({
        connected: true, downSince: null, ccdVerbs: [], rosterFp: null, build: null, observedEpoch: null,
        agentOps: ['update'],
      }),
```

In `server/test/update-inventory.test.ts`, in `'a ready frame measures the fleet node inside the same second'`, replace:

```ts
    expect(row).toMatchObject({ role: 'fleet', caps: ['verify', 'node-id', 'floor'], os: 'linux', highestVersion: 'v0.0.12', agentOps: [], reachable: true });
```

with:

```ts
    // `agentOps: ['update']`: the real agent advertises the update op (programme wave 5 Task 2), and the
    // inventory stores what the one reader, `readReadyOps`, read off its ready frame.
    expect(row).toMatchObject({ role: 'fleet', caps: ['verify', 'node-id', 'floor'], os: 'linux', highestVersion: 'v0.0.12', agentOps: ['update'], reachable: true });
```

- [ ] **Step 4: Run to verify they fail**

Run (foreground, one file at a time, timeout ≥ 600000 ms):
- `cd agent && ./node_modules/.bin/vitest run test/update-op.test.ts`
- `cd server && ./node_modules/.bin/vitest run test/remote-connect.test.ts -t 'reaches connected:true'` and `./node_modules/.bin/vitest run test/update-inventory.test.ts -t 'a ready frame measures'`

Expected: FAIL.
- In `update-op.test.ts`, every op case receives `{ ok: false, err: 'bad-request' }`: today's `validateReq` has no `update` case, so its `default: return null` answers the envelope's word. That fails as `expected … to deeply equal … err: 'bad-tag'` / `'bad-kind'` / `ok: true, accepted: true`, and with `expected [] to have a length of 1` where a spawn was expected. The `'; rm'` and `bad-kind` cases fail on the word, not on the spawn.
- The ready case fails with `expected undefined to deeply equal [ 'update' ]`.
- The first three scan cases fail with `case 'update': { not found in agent/src/server.ts` or `export const realUpdateSpawn not found …`.
- `readInFlightReport is not a function` and `realUpdateSpawn is not a function`.
- The exec-surface case passes before and after: it pins a surface this task must not move.
- The two server cases fail on `agentOps` (`[]` received, `[ 'update' ]` expected).

Do not run the `whitelist-*` suites at this step. They compile `agent/test` with a real `tsc`, and the new file's imports do not exist yet.

- [ ] **Step 5: Implement in `agent/src/server.ts`**

Replace `import { readFileSync } from 'node:fs';` (`:2`) with:

```ts
import { closeSync, constants as fsConstants, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
```

In the `import type { … } from '../../shared/agent-protocol.js';` block, after `  TailReset,`, add:

```ts
  UpdateOpError,
  UpdateReq,
```

Replace the value import block (`:30-36`):

```ts
import {
  CCRC_DIR_NAME,
  NODE_FILE_BASENAMES,
  parseCcdCaps,
  parseObservedEpochDoc,
  POOL_EPOCH_FILE_NAME,
} from '../../shared/agent-protocol.js';
```

with:

```ts
import {
  CCRC_DIR_NAME, NODE_FILE_BASENAMES, NODE_FILES, parseCcdCaps, parseObservedEpochDoc, POOL_EPOCH_FILE_NAME, UPDATE_OP,
  UPDATE_SPAWN_TIMEOUT_MS, firstStderrLine, updateLauncherPath, updateSpawnArgv,
} from '../../shared/agent-protocol.js';
import { inFlightReport, isReleaseTag, isRequestKind, type InFlightReport } from '../../shared/api.js';
```

In `AgentOpts`, after the `spawnPty?` line, add:

```ts
  spawnUpdate?: UpdateSpawn; // default realUpdateSpawn (execFile) — tests inject a recorder; the `update` op's ONLY spawn
```

Replace `ReadyFrame`'s docstring's last line and the type (`:173-177`, from ` *  compile while silently omitting it. */` through the closing `};`) with:

```ts
 *  compile while silently omitting it.
 *
 *  `ops` is narrowed the same way, for the same reason (design 2026-09-20 §10):
 *  the wire declares it optional so a READER tolerates an agent from before the
 *  `update` op, and this build is never that agent. It answers the op, so its
 *  own frame type says so, and the send site cannot compile while silently
 *  omitting the one word the server's dispatcher looks for before it sends it. */
type ReadyFrame = Omit<AgentReady, 'ccdVerbs' | 'observedEpoch' | 'ops'> & {
  ccdVerbs: string[];
  observedEpoch: number | null;
  ops: string[];
};
```

Replace `fail` (`:189-191`) with:

```ts
/** `detail` is ADDITIVE (design 2026-09-20 §10, D-3373): spread
 *  only when there is one, so every existing refusal's frame is byte-identical
 *  to what it was. */
function fail(id: number, message: string, detail?: string): ResErr {
  return detail === undefined
    ? { t: 'res', id, ok: false, err: message }
    : { t: 'res', id, ok: false, err: message, detail };
}

/** The `update` op's refusals. `err` is typed to the op's closed vocabulary
 *  (`UPDATE_OP_ERRORS`), so a word the server's answer mapping does not know is
 *  a compile error here, not a string that drifts. */
function failUpdate(id: number, err: UpdateOpError, detail?: string): ResErr {
  return fail(id, err, detail);
}
```

Directly after `runExec`'s closing `}` (`:299`), before `interface PtyEntry {`, insert:

```ts

/**
 * The `update` op's spawn port (design 2026-09-20 §10). It is the ONE place a
 * wire-triggered request reaches a process spawn outside the exec whitelist,
 * and it is deliberately NOT `runExec`: `runExec` is the exec op's executor,
 * and a call to it here would put this op on the exec path in the reader's
 * mind, which is exactly what §18 "the op never execs" forbids. Production is
 * `realUpdateSpawn`; tests inject a recorder through `AgentOpts.spawnUpdate`.
 */
export type UpdateSpawn = (file: string, args: readonly string[], timeoutMs: number) =>
  Promise<{ code: number; stderr: string; killed: boolean }>;

/** Enough for any sentence a `--detach` parent prints; past it `execFile` kills the child. */
const UPDATE_SPAWN_MAX_BUFFER = 1024 * 1024;

/**
 * `execFile(file, args)`, bounded by `timeoutMs` — the ABSOLUTE launcher and one
 * of the two templates, both built by the caller from `shared/agent-protocol.ts`.
 *
 * Three answers, kept apart:
 *  - `killed` — the parent was still running at the bound (`execFile`'s own flag).
 *  - A spawn error — the launcher absent or not executable (`ENOENT`/`EACCES`,
 *    `syscall` `spawn <file>`). It answers code 1 with the sentence
 *    `could not start the launcher (<code>)` (D-3393).
 *    Without that sentence the parent's stderr is empty, and a node with no
 *    `ccrc` installed would read `spawn-failed: no message` on the console.
 *  - Every other failure — the parent's own exit code and its stderr.
 */
export const realUpdateSpawn: UpdateSpawn = (file, args, timeoutMs) => new Promise((resolve) => {
  execFile(file, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: UPDATE_SPAWN_MAX_BUFFER }, (error, _stdout, stderr) => {
    if (error === null) { resolve({ code: 0, stderr, killed: false }); return; }
    if (typeof error.code === 'string' && typeof error.syscall === 'string' && error.syscall.startsWith('spawn')) {
      resolve({ code: 1, stderr: `could not start the launcher (${error.code})`, killed: false });
      return;
    }
    resolve({ code: typeof error.code === 'number' ? error.code : 1, stderr, killed: error.killed === true });
  });
});

/** ONE per agent PROCESS, shared by every connection (D-3392).
 *  A server whose link dropped while an op was spawning reconnects on a NEW
 *  socket and re-sends the op, and a per-connection flag would let that second
 *  `--detach` parent start beside the first. Both parents only PROBE the lock
 *  (wave 4 Task 3), so both would pass it and write `queued`. */
interface UpdateGate { spawning: boolean }
```

In `ConnCtx`, after `spawnPty: PtySpawn;`, add:

```ts
  spawnUpdate: UpdateSpawn;
  updateGate: UpdateGate;
```

In `handleReq`, directly before `    default: {` (`:466`), insert:

```ts
    case 'update': {
      // Design 2026-09-20 §10. THE ONE wire-triggered spawn outside the exec
      // whitelist (agent/CLAUDE.md). `validateReq` has already refused a tag
      // that fails `isReleaseTag` and a kind outside `RequestKind`, so this body
      // never sees an unvalidated argument. `updateSpawnArgv` checks both AGAIN
      // and throws on a caller bug, so an edit that lets one through reaches
      // the envelope's `.catch`, never `execFile`. Nothing here consults the
      // exec whitelist, and nothing here may: `ccrc` is on neither list, and
      // the argv is one of two templates with `tag` the only variable token.
      //
      // No `await` before the busy decision. The gate is checked and taken in
      // one synchronous stretch, so two ops arriving together cannot both pass.
      if (ctx.updateGate.spawning) {
        send(ws, failUpdate(req.id, 'busy', 'an update op is already spawning on this agent'));
        return;
      }
      const home = ctx.cfg.home;
      const inFlight = readInFlightReport(home);
      if (inFlight !== null) {
        send(ws, failUpdate(req.id, 'busy',
          `update.json says ${inFlight.phase} (target ${inFlight.target ?? 'none'}, started ${inFlight.startedAtS ?? 'unknown'})`));
        return;
      }
      const file = updateLauncherPath(home);
      const argv = updateSpawnArgv(req.kind ?? 'update', req.tag);
      ctx.updateGate.spawning = true;
      let spawned: Awaited<ReturnType<UpdateSpawn>>;
      try {
        spawned = await ctx.spawnUpdate(file, argv, UPDATE_SPAWN_TIMEOUT_MS);
      } finally {
        ctx.updateGate.spawning = false;
      }
      // D-3372: `accepted` is a measured fact about the
      // node. The `--detach` parent exits 0 only after it wrote `queued` and
      // `_svc_run_detached` started the unit (wave 4 Task 3). It is never "a
      // process was forked". Everything else is `spawn-failed`, carrying what
      // the parent said.
      if (spawned.killed) {
        send(ws, failUpdate(req.id, 'spawn-failed', `the --detach parent did not exit within ${UPDATE_SPAWN_TIMEOUT_MS} ms`));
        return;
      }
      if (spawned.code !== 0) {
        send(ws, failUpdate(req.id, 'spawn-failed', firstStderrLine(spawned.stderr)));
        return;
      }
      send(ws, ok(req.id, { accepted: true }));
      return;
    }
```

Directly above `validateReq`'s docstring (the `/**` that opens ` * Runtime shape/type validation for an already-JSON-parsed \`req\` frame.`), insert:

```ts
/** `validateReq`'s answer for a well-shaped op whose ARGUMENT failed its guard
 *  (design 2026-09-20 §10). The message handler sends it as
 *  `failUpdate(id, refuse)` before any case body runs. It is not `null`,
 *  because the handler answers `null` with `bad-request`, which from the
 *  `update` op must mean exactly one thing: this agent predates it. */
export interface ReqRefusal { refuse: Extract<UpdateOpError, 'bad-tag' | 'bad-kind'>; id: number }

```

Replace `function validateReq(msg: Record<string, unknown>): AgentReq | null {` with:

```ts
function validateReq(msg: Record<string, unknown>): AgentReq | ReqRefusal | null {
```

and, directly before its `    default:` / `      return null;` pair, insert:

```ts
    case 'update': {
      // The ONE tag-shape guard (`isReleaseTag`, never a regex here) and the
      // one kind guard. A failed argument is a `ReqRefusal` carrying the op's
      // own word; nothing past this point sees an unvalidated tag.
      if (!isReleaseTag(msg.tag)) return { refuse: 'bad-tag', id };
      const kind = msg.kind === undefined ? 'update' : msg.kind;
      if (!isRequestKind(kind)) return { refuse: 'bad-kind', id };
      return { t: 'req', id, op: 'update', tag: msg.tag, kind } satisfies UpdateReq;
    }
```

Directly after `readObservedEpoch`'s closing `}` (`:664`), insert:

```ts

/** Wave 4's writer puts ONE line of a few hundred bytes. Anything larger is not its report. */
const UPDATE_REPORT_READ_MAX = 65_536;

/**
 * Spec §10: the handler refuses when `~/.ccrc/update.json` says an update is in
 * flight. The agent reads the file ITSELF, as `readObservedEpoch` and
 * `readBuildStamp` read theirs (D-3371). This
 * is the agent's own decision about its own box, not a wire file op, so it
 * never goes through `checkPath`: that gate exists for what the SERVER reads.
 *
 * `null` (not busy) covers every failure: an absent, unreadable, over-cap or
 * unparseable file, a non-regular one, and a report that is not in flight.
 * The node's own `_upd_lock` then decides, and a held lock comes back as
 * `spawn-failed` with the lock's sentence. Opened `O_NONBLOCK`, because a FIFO
 * planted at this name would otherwise block `open(2)` and, with it, this
 * agent's whole event loop; `fstat` then refuses it as not a regular file. The
 * CONTENT is judged by `inFlightReport` (`shared/api.ts`), the same parser the
 * server-role spawn uses, so the two roles cannot disagree about what "in
 * flight" means.
 */
export function readInFlightReport(home: string): InFlightReport | null {
  let fd: number;
  try {
    fd = openSync(path.join(home, CCRC_DIR_NAME, NODE_FILES.report), fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > UPDATE_REPORT_READ_MAX) return null;
    const buf = Buffer.alloc(st.size);
    const n = readSync(fd, buf, 0, st.size, 0);
    return inFlightReport(buf.subarray(0, n).toString('utf8'));
  } catch {
    return null;
  } finally {
    try { closeSync(fd); } catch { /* nothing left to release */ }
  }
}
```

Replace `handleConnection`'s signature and its `ctx` literal (`:750-759`) with:

```ts
function handleConnection(
  ws: WebSocket, opts: Required<Omit<AgentOpts, 'helloTimeoutMs'>>, helloTimeoutMs: number, verbCache: VerbCache,
  updateGate: UpdateGate,
): void {
  let authed = false;
  const ctx: ConnCtx = {
    cfg: { home: opts.home, projectsRoot: opts.projectsRoot },
    tails: new Map(),
    nextTailId: 1,
    ptys: new Map(),
    nextPtyId: 1,
    spawnPty: opts.spawnPty,
    spawnUpdate: opts.spawnUpdate,
    updateGate,
  };
```

Replace the ready frame literal (`:799-801`):

```ts
      const frame: ReadyFrame = {
        t: 'ready', v: 1, ccdVerbs: verbCache.verbs, observedEpoch: readObservedEpoch(opts.home),
      };
```

with:

```ts
      // `ops` (design 2026-09-20 §10): the request ops this agent answers beyond
      // the closed set every agent has always had, which is exactly one today.
      // It is required in `ReadyFrame`, so it cannot be dropped silently.
      const frame: ReadyFrame = {
        t: 'ready', v: 1, ccdVerbs: verbCache.verbs, observedEpoch: readObservedEpoch(opts.home), ops: [UPDATE_OP],
      };
```

In the message handler, directly after the `if (!req) { … return; }` block (`:818-825`), insert:

```ts
      // A well-shaped op whose ARGUMENT failed its guard (design 2026-09-20
      // §10) is answered with the op's own word, never `bad-request`.
      if ('refuse' in req) { send(ws, failUpdate(req.id, req.refuse)); return; }
```

In `startAgent`, after `    spawnPty: rawOpts.spawnPty ?? spawnFleetPty,`, add:

```ts
    spawnUpdate: rawOpts.spawnUpdate ?? realUpdateSpawn,
```

and replace:

```ts
  wss.on('connection', (ws) => handleConnection(ws, opts, helloTimeoutMs, verbCache));
```

with:

```ts
  // ONE update gate per agent process, shared by every connection (D-3392).
  const updateGate: UpdateGate = { spawning: false };
  wss.on('connection', (ws) => handleConnection(ws, opts, helloTimeoutMs, verbCache, updateGate));
```

- [ ] **Step 6: Record the op in `agent/CLAUDE.md`**

Directly after the `ptyOpen` bullet (its second line ends `never an arbitrary command.`), insert:

```markdown
- The **`update` op** (design 2026-09-20 §10) is the ONE wire-triggered spawn outside the exec whitelist. It spawns
  exactly one of two argv templates — `$HOME/.local/bin/ccrc update|rollback --to <tag> --detach --from pwa`, built by
  `updateLauncherPath` + `updateSpawnArgv` (`shared/agent-protocol.ts`), `tag` the only variable token — validated by
  `isReleaseTag` in `validateReq` BEFORE any case body runs (`bad-tag`/`bad-kind`, never `bad-request`, which from this
  op means "this agent predates it"). It never calls `isExecAllowed`, `runExec` or `resolveSpawnCmd`, and `ccrc` is on
  neither `EXEC_COMMANDS` nor `FORBIDDEN_COMMANDS`; `test/update-op.test.ts`'s source scan reds the day either changes.
  Its busy check reads `~/.ccrc/update.json` itself (bounded, `O_NONBLOCK`, never through `checkPath`), and one gate
  per agent process refuses a second op while a `--detach` parent is still running. **Adding an op:** an `AgentReq`
  member in `shared/agent-protocol.ts`; a `validateReq` case that type-checks every field (an argument failing its
  guard answers a `ReqRefusal` word, a shape failure `null`); a `handleReq` case; and, when the server must know this
  agent answers it, a word in the ready frame's `ops` (`readReadyOps`, `server/src/remote/client.ts`, is its reader).
```

- [ ] **Step 7: Run to verify they pass**

Run (foreground, one file at a time, timeout ≥ 600000 ms):
- `cd agent && ./node_modules/.bin/vitest run test/update-op.test.ts`, then `test/whitelist-structural.test.ts`, `test/whitelist-prototype.test.ts`, `test/whitelist-noghosts.test.ts`, `test/whitelist.test.ts`, `test/exec.test.ts`, `test/malformed.test.ts`, `test/build-fp.test.ts`, `test/observed-epoch.test.ts`, `test/module-format.test.ts`
- `cd agent && npm run build`
- `cd server && ./node_modules/.bin/vitest run test/remote-connect.test.ts`, then `test/update-inventory.test.ts`, `test/whitelist-subset.test.ts`, `test/ccrc-api-closed.test.ts`, `test/single-definition.test.ts`, `test/typecheck-tests.test.ts`

Expected: PASS, exit 0 everywhere.
- `update-op.test.ts` holds 26 cases: 5 gate, 5 spawn, 7 busy, 1 ready, 4 scan, 4 real child. On Darwin it runs 25, because the FIFO case is skipped; under root it runs 25, because the EACCES case is skipped.
- The three `whitelist-*` suites compile `agent/test` with a real `tsc`, now including the new file. They must stay green unchanged, which is their job: the exec surface did not move.
- `malformed.test.ts`'s `unknown op` row (`frobnicate`) still answers `bad-request`.
- `module-format.test.ts` proves the real emit still carries every `shared/*.mjs` the agent imports. The new `shared/api.js` import is a `.ts` module, so it is emitted by the same `tsc` run.
- `single-definition.test.ts` stays green: `agent/src/server.ts` quotes no node-file name (it uses `NODE_FILES.report`), and no launcher parts (it calls `updateLauncherPath`).
- `typecheck-tests` is a known load flake: re-run it in isolation before calling a red a break.

- [ ] **Step 8: Mutation measurement**

Make each edit, run the named file, see the named case red, restore by editing back (never `git checkout --`), and re-run green:

1. §18 "the op validates the tag with the one guard", layer 1: in `validateReq`'s update case, replace `if (!isReleaseTag(msg.tag)) return { refuse: 'bad-tag', id };` with `if (typeof msg.tag !== 'string') return { refuse: 'bad-tag', id };`. `update-op.test.ts` reds on `a tag that fails isReleaseTag is bad-tag …`: the answer is the argv guard's `RangeError` message, not `bad-tag`. The recorder still saw nothing, because layer 2 held.
2. The same row, both layers: keep mutation 1 and ALSO delete `updateSpawnArgv`'s `if (!isReleaseTag(tag)) { … }` (Task 1). Now the case reds on its FIRST assertion, `the recorder saw a spawn` (`expect(rec.calls, …).toEqual([])`, deliberately placed before the word): the recorder recorded `'; rm -rf ~'` as the tag, and the answer was `accepted`. That is the spec's "a `; rm` fixture spawns". Restore both.
3. §18 "the op never execs", the whitelist path: at the top of `handleReq`'s update case add `if (!isExecAllowed('ccrc', [...updateSpawnArgv(req.kind ?? 'update', req.tag)])) { send(ws, fail(req.id, 'forbidden')); return; }`. Every accepted case reds on `err: 'forbidden'`, and `handleReq's update case names no exec-surface call …` reds.
4. §18 "the op never execs", the exec executor: replace `spawned = await ctx.spawnUpdate(file, argv, UPDATE_SPAWN_TIMEOUT_MS);` with `spawned = await runExec(file, [...argv], UPDATE_SPAWN_TIMEOUT_MS);`. The scan case reds (both the `EXEC_PATH` and the `ctx.spawnUpdate(` assertions), and so does every RECORDER case that expects a spawn: `runExec` really ran the fixture launcher those cases never plant (an absolute path under the fixture HOME, so nothing else can run), the answer is `spawn-failed` with `no message` instead of `accepted`, and the recorder saw nothing. Of the real-child cases only the absent-launcher one reds (`no message`); the other three run their planted script through `runExec` and stay green, which is why the scan is this row's pin.
5. §18 "the spawn argv is absolute": replace `const file = updateLauncherPath(home);` with `const file = 'ccrc';`. It reds on `update: exactly <home>/.local/bin/ccrc …` and `rollback: the twin template` (file `ccrc`), on the scan's `const file = updateLauncherPath(home);` assertion, and on the first two real-child cases, which now answer `spawn-failed` / `could not start the launcher (ENOENT)`: the bare name is looked up on the CONTAINED PATH (`/usr/bin:/bin`) and found nowhere. That containment is what makes this mutation safe to run; never run it with the real-child describe's `contain(…)` calls removed.
6. §18 "an agent without the op is never sent it" (the agent half): delete `, ops: [UPDATE_OP]` from the ready frame literal. `update-op.test.ts` reds on `the ready frame advertises exactly ['update'] …` (`undefined`). `server/test/remote-connect.test.ts` reds on `reaches connected:true …` (`agentOps: []`), and `server/test/update-inventory.test.ts` on `a ready frame measures …`.
7. The in-flight refusal: delete the `const inFlight = readInFlightReport(home);` line and its `if` block. It reds on `update.json in flight is busy …` (spawned, `accepted`).
8. D-3392: move the gate onto the connection. In `handleConnection`'s `ctx` literal replace `updateGate,` with `updateGate: { spawning: false },`. The same-connection half of `a second op while the first is still spawning …` stays green, and the second-connection half reds: that op passes the fresh gate, reaches the parked recorder, and `other.req` fails with `timed out waiting for ws message` instead of answering `busy`. Then delete the `if (ctx.updateGate.spawning) { … }` block: the same-connection half reds too. Restore both.
9. The report bound: set `UPDATE_REPORT_READ_MAX = 1_000_000`. It reds on `a report the agent cannot use is not busy …` (the 70 KiB in-flight report now answers `busy`).
10. The timeout arm: delete the `if (spawned.killed) { … }` block. It reds on `a parent killed at the bound is spawn-failed naming the timeout` (the detail reads `no message`).
11. `accepted` only after exit 0: replace `if (spawned.code !== 0) {` with `if (false) {`. It reds on `a parent that exits 1 …` (the recorder case and the real-child case).
12. D-3393: delete `realUpdateSpawn`'s spawn-error branch (the `if (typeof error.code === 'string' && …) { … }` block). It reds on `a launcher that is not there …` (the detail reads `no message`).
13. The `O_NONBLOCK` open (Linux only; this mutation HANGS the process, because `open(2)` on a FIFO with no writer blocks the event loop, which vitest's timeout cannot interrupt): remove `| fsConstants.O_NONBLOCK`. Run `cd agent && timeout 60 ./node_modules/.bin/vitest run test/update-op.test.ts -t 'a FIFO at update.json'`. Exit 124 is the red. Restore, and re-run without `timeout`: green.

Count the cases in vitest's summary line before and after every restore; it must read the same green number each time.

- [ ] **Step 9: Commit**

```bash
git add agent/src/server.ts agent/CLAUDE.md agent/test/update-op.test.ts \
  server/test/remote-connect.test.ts server/test/update-inventory.test.ts
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts && cd ..
git commit -m "feat(update): the agent answers the update op — tag and kind gated in validateReq, busy on an in-flight update.json or a running spawn, one of two absolute argv templates spawned off the exec path, accepted only after the --detach parent exits 0, and ops: ['update'] on ready"
```

### Task 3: Store — the request and lease-acquire writers

**Files:**
- Modify: `server/src/coord/store.ts` — the three result types directly after W2 Task 5's `AckNodeResult` (quoted: `export type AckNodeResult =` … `  | { ok: false; why: 'busy'; state: BusyUpdateState };`) and before W2 Task 5's `/** The columns \`NODE_COLUMNS\` names, as SQLite hands them back. */ interface RawNodeRow`; the three methods in W2 Task 5's `// ── update inventory ──` section directly after `ackNode(nodeId: string): AckNodeResult`'s closing `  }` and before the docstring of `nodes()` (`/** Every LIVE node — the inventory every reader starts from; …`); and that section's banner comment, whose two sentences "`W4 adds` `dispatchNode`" / "`W4's` `requestNode` sets it" and "Nothing in W2 calls a lease writer on a real row …" become false the moment these methods land — two three-line passages replaced, the first by four lines and the second by three (nothing cites the banner, so the one added line moves no citation). *(Correction: the skeleton said "`isRequestKind` (and `type RequestKind` if not already present) merged into the existing `'../../../shared/api.js'` import lines in place". Every name this task needs is ALREADY imported there by W2 — `isReleaseTag` by Task 4's `  isReleaseTag, isUpdateChannel,` line, `isRequestKind` and `type RequestKind`/`type UpdateState` by Task 5's two lines — so there is NO import edit; an added `isRequestKind` would be a duplicate identifier, TS2300.)* `store.ts` is cited by no document in the session-hook corpus (W2 Task 4, measured at `d759c914`), so the inserts need not be line-neutral.
- Modify: `shared/api.ts` — `'bad-kind', 'no-request', 'not-idle',` appended to `UPDATE_STORE_REFUSE_CODES` as a new line after wave 3's `  'unknown-release', 'already-notified',`, and three entries appended to its docstring after wave 3's last entry (`already-notified — …`) — in place, in the END-OF-FILE block (R5, D-3188). *(Correction: the skeleton appended two words. `NoteDispatchRefusalResult`'s `'not-idle'` arm is a single-quoted kebab token in `server/src/coord/store.ts`, and `mail-routes.test.ts`'s scan — `/'([a-z]+(?:-[a-z]+)+)'/g` over every `server/src/coord/*.ts` — admits it through no existing vocabulary: `MailGate`'s `'not-idle'` (`shared/api.ts:5362`) has no guard in the scan's admission chain (`mail-routes.test.ts:710-775`, measured at `d759c914`) and lives in `watch.ts`, outside the scanned directory. Unappended, the scan reds on it; so it is the third word. And `'bad-kind'` needs no admission from the scanner at all — it is already a `MailRejectCode` (`MAIL_REJECT_CODES`' ingress line, `shared/api.ts:4965` at `d759c914`), so the scan passes it before and after this task; it is appended anyway because R5's ONE store vocabulary must hold every kebab word the store's results spell, and this task's `everyKebabWhyDeclared` (compile time) and `isUpdateStoreRefuseCode` loop (runtime) are the only pins that say so.)*
- Modify: `server/test/update-writer-groups.test.ts` — `WRITER_GROUPS`' lease row (quoted: `writers: ['dispatchNode', 'releaseLease', 'settleNode', 'ackNode'] },`) gains `'noteDispatchRefusal'` in place; `const W5_WRITERS = ['requestNode', 'dispatchNode', 'noteDispatchRefusal'] as const;` (with its docstring) directly after wave 3's `W3_WRITERS`; the floor case iterates `[...W2_WRITERS, ...W3_WRITERS, ...W5_WRITERS]` and its title says "every W2, W3 and W5 writer"
- Test: `server/test/update-store-dispatch.test.ts` (create)
- Run, not edited: `server/test/mail-routes.test.ts` (the kebab scan reds on `'no-request'` before the append and is green after; `'bad-kind'` is already admitted as a `MailRejectCode`), `server/test/mail-hardening.test.ts` (`SIG`), `server/test/single-definition.test.ts` (the SQL-tuple scans over `store.ts`), `server/test/session-hook.test.ts` (R13), `server/test/update-store-nodes.test.ts` (W2's lease cases unchanged), `server/test/update-store-notified.test.ts` and `server/test/update-store-intent.test.ts` (their "a word is declared twice" checks read the same array), `server/test/typecheck-tests.test.ts` (the new file's type-level lines), `server/test/topology-clean.test.ts` (a new file)

**Interfaces:**
- Consumes: `tx` (`db.ts:245`, `BEGIN IMMEDIATE`, synchronous); W2 Task 5's module constants `SETTLED_UPDATE_SQL`, `HALTED_UPDATE_SQL`, the `nodes` lease/request/identity columns, `NodeRow`, `NodeMeasurement`, `ackNode`, `releaseLease`, `settleNode`, `rekeyNode`, `upsertNodeMeasurement`, `node()`, and the private `nodeLeaseRow` (its `updateState` already folded to `'unknown'` for a token this build cannot name); `SETTLED_UPDATE_STATES`, `isReleaseTag`, `isRequestKind`, `RequestKind`, `REQUEST_KINDS`, `UpdateState` (W2 Task 1); `UPDATE_STORE_REFUSE_CODES`/`UpdateStoreRefuseCode`/`isUpdateStoreRefuseCode` as wave 3 leaves it (W2's seventeen (Tasks 4–6's fifteen + fix round 1's `single-not-one`, `withdrawn-not-empty`) + `unknown-release`, `already-notified`); `WRITER_GROUPS`, `W2_WRITERS`, `W3_WRITERS` and the analyser (`scan`, `violations`) in `update-writer-groups.test.ts` (W2 Task 7, wave 3 Task 1); `openCoordDb` (`db.ts:114`), `mkTmp` (`tmpHelpers.ts:38`, cleaned by its own file-scoped `afterAll`).
- Produces (in `store.ts`, every signature ONE line):

```ts
export type RequestNodeResult =
  // CORRECTION: `replaced.kind` is `RequestKind | null` — null = the stored word is one this build cannot name
  // (W2's reader folds it to null, D-3181); typing it `RequestKind` would force the writer to invent a word.
  | { ok: true; replaced: { tag: string; kind: RequestKind | null } | null }   // the request that stood before, overwritten
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'bad-tag' }
  | { ok: false; why: 'bad-kind' };
export type DispatchNodeResult =
  | { ok: true }
  | { ok: false; why: 'busy'; heldBy: string }                          // a live busy row exists — this node's own or another's
  | { ok: false; why: 'no-request' }                                    // D-3376
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'bad-tag' }
  | { ok: false; why: 'bad-kind' };
export type NoteDispatchRefusalResult =
  | { ok: true; changed: boolean }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'not-idle'; state: UpdateState };

requestNode(nodeId: string, tag: string, kind: RequestKind, at: number): RequestNodeResult   // request columns only; WHERE supersededBy IS NULL; lease untouched
dispatchNode(nodeId: string, target: string, kind: RequestKind, startedAt: number, detail: string): DispatchNodeResult   // THE lease acquire, one tx
noteDispatchRefusal(nodeId: string, detail: string): NoteDispatchRefusalResult   // D-3375: updateDetail only, WHERE updateState = 'idle' AND supersededBy IS NULL AND updateDetail IS NOT ?
```

- `dispatchNode`'s one statement: `UPDATE nodes SET updateState = 'pending', updateTarget = ?, updateStartedAt = ?, updateDetail = ? WHERE nodeId = ? AND supersededBy IS NULL AND updateState IN ${SETTLED_UPDATE_SQL} AND NOT EXISTS (SELECT 1 FROM nodes b WHERE b.supersededBy IS NULL AND b.updateState NOT IN ${SETTLED_UPDATE_SQL}) AND (? <> 'rollback' OR (requestedKind = 'rollback' AND requestedTag = ?))` — the rollback clause is ONE statement with `kind` bound, not two SQL texts chosen by an `if`, so the writer-group scan reads one `this.db.prepare(` window and the clause cannot be dropped from one branch only. On zero changes the row is read back in the same `tx` only to LABEL the refusal (the `markAcked` idiom, `store.ts:3686-3699` at `d759c914`): `unknown-node`, `superseded`, `busy` (with `heldBy` = the first live busy row by `nodeId`), else `no-request`. Request columns are never written. `kind` checked by `isRequestKind` and `tag`/`target` by `isReleaseTag` before the `tx` (`bad-kind`/`bad-tag`, nothing written); `at`/`startedAt` not a non-negative safe integer → `RangeError` (a caller bug — wave 3's `markReleaseNotified` stance: SQLite binds `NaN` as NULL).
- The row's own `updateState IN ${SETTLED_UPDATE_SQL}` is SUBSUMED by the `NOT EXISTS`: the outer `WHERE` already requires the row to be live, and a live row is one of the rows the subquery reads, so a busy self fails the subquery. It stays as the rule's plain statement; the `NOT EXISTS` carries the pins, and Step 7 measures the subsumption as a control rather than leaving it an unmutated row.
- No `clearRequest`: W2's `ackNode` and `settleNode` already clear the request group, and `WRITER_GROUPS`' request row (`requestNode`, `settleNode`, `ackNode`) is unchanged.
- "Writes nothing" is MEASURED, not inferred from a re-read: the test reads `SELECT total_changes()` on the store's own connection before and after each refusal (measured with `node:sqlite` on node 24.14.1: `BEGIN IMMEDIATE`/`COMMIT` and a zero-match `UPDATE` leave it unchanged; a one-row `UPDATE` moves it by 1).
- Cases: `requestNode` writes the three request columns and nothing else (a whole-row before/after diff), returns the previous request in `replaced` (and `kind: null` for a stored word this build cannot name), refuses a superseded row, an unknown id, a non-tag (`'; rm -rf ~'` among them) and a bad kind with nothing written, throws on a bad `at`, and leaves a busy lease busy; `dispatchNode` on an idle row → `pending` with target, `startedAt`, detail, the request columns unchanged; an `update` acquire needs no request (auto-driven); a second node's `dispatchNode` while the first is `pending` → `{why: 'busy', heldBy: <first>}`, nothing written, and the holder's own second acquire → `busy` held by itself (§18 "one dispatch per sweep" — the store half); a row planted `applying`, `unknown` or `paused` (a token this build cannot name) blocks every acquire (§18 "`unknown` is busy", the fixture-row half W2 deferred here); a `failed` or `reverted` row may be acquired and a `failed` row elsewhere blocks nothing (the halt is the planner's, Task 4); a SUPERSEDED row's stale busy lease blocks nothing (W2's "a superseded row is invisible", applied to the subquery); `rollback` with no request, with an `update` request for the same tag, and with a rollback request for another tag → `no-request`, nothing written; with the matching rollback request → `pending`; unknown id, superseded, non-tag, bad kind → refused, nothing written; a bad `startedAt` throws; `releaseLease` after a real `dispatchNode` leaves the request standing and frees the lease for the next node (§18 "a refusal does not consume the request", re-pinned with a real acquire); `noteDispatchRefusal` on `idle` → `changed: true`, `updateDetail` the only column changed; the same text again → `changed: false` with `total_changes()` unmoved; on `failed` (a `provenance:` verdict), `reverted`, `applying`, `unknown`, `paused` and a real `pending` lease → `not-idle` with the read-back state, nothing written, the verdict intact (Review Focus 5); unknown id and superseded row refused; every kebab refusal word of the three results is an `UpdateStoreRefuseCode` (runtime and compile time) and no result type is `void` (compile time).
- Spec §18 rows pinned: "a refusing write never returns `void`" (`dispatchNode` — mutations: its return type `void` → `typecheck-tests.test.ts` reds; a refusal arm that returns `undefined` → the `busy` cases red), "one dispatch per sweep" (mutation: drop the `NOT EXISTS` clause → red), "`unknown` is busy" (mutation: the subquery's `NOT IN ${SETTLED_UPDATE_SQL}` → a hand-typed `IN ('pending', 'applying')` → the planted-`unknown`/`paused` cases red), "one writer per column group" (the writer-group scan — mutation: write `requestedTag` inside `dispatchNode` → red), "a refusal does not consume the request" (mutation: `releaseLease` clears `requestedTag` → the real-acquire case reds). Review Focus 5 (the store half).

- [ ] **Step 1: Write the failing tests**

Create `server/test/update-store-dispatch.test.ts`:

```ts
// Design 2026-09-20 §6/§10/§12 (programme wave 5 — spec W4's server half,
// Task 3) — the writers W2 named and left unwritten, and the refusal note:
//   requestNode         — the request group's SETTER (the apply/rollback routes, Task 6);
//   dispatchNode        — the lease group's ONE ACQUIRE (the dispatcher's act, Task 5);
//   noteDispatchRefusal — `updateDetail` on an idle row, once per change of text
//                         (D-3375).
// W2's update-store-nodes.test.ts PLANTED every busy row "for W4's dispatcher
// to reach"; here `dispatchNode` makes them for real, and only the rows the
// store must refuse (a state this wave never writes) are planted by raw SQL.
// "Writes nothing" is measured with SQLite's own `total_changes()` on the
// store's connection, never inferred from a re-read that could miss a column.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  UPDATE_STORE_REFUSE_CODES, isUpdateStoreRefuseCode, type RequestKind, type UpdateStoreRefuseCode,
} from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import {
  CoordStore, type DispatchNodeResult, type NodeMeasurement, type NoteDispatchRefusalResult, type RequestNodeResult,
} from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const UUID_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';   // the fleet box
const UUID_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';   // no row carries it
const UUID_S = '05050505-0505-4505-8505-050505050505';   // the server box

const fresh = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('update-store-dispatch-'), 'coord.db')));

/** A clean fleet-node measurement (W2 Task 5's fixture shape); each case overrides what it is about. */
const meas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: 'fleet', role: 'fleet', label: 'fleet',
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'detach', 'rollback'], agentOps: ['update'], highestVersion: 'v0.0.9',
  previousVersion: 'v0.0.8', floorRead: 'measured', previousRead: 'measured', os: 'linux', measuredAt: T0, report: null, ...over,
});

/** The two live nodes the fleet has: the fleet box (A, agent-reached) and the server box (S, no agent). */
const twoNodes = (): CoordStore => {
  const s = fresh();
  expect(s.upsertNodeMeasurement(meas({ nodeId: UUID_A })).ok).toBe(true);
  expect(s.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null })).ok).toBe(true);
  return s;
};

/** A store whose label-keyed row `fleet` is superseded by UUID_A (W2's `rekeyNode` does it). */
const superseded = (): CoordStore => {
  const s = fresh();
  s.upsertNodeMeasurement(meas());
  s.upsertNodeMeasurement(meas({ nodeId: UUID_A }));
  expect(s.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'superseded', retired: 0, revived: false });
  return s;
};

/** A lease state this wave never writes, planted — `state` is a raw string so a
 *  token outside `UpdateState` can be planted too. */
const plantState = (s: CoordStore, nodeId: string, state: string, detail = 'planted'): void => {
  s.db.prepare('UPDATE nodes SET updateState = ?, updateDetail = ? WHERE nodeId = ?').run(state, detail, nodeId);
};

/** Rows modified on the store's connection so far (SQLite's `total_changes()`). */
const writes = (s: CoordStore): number =>
  (s.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

/** Run one store call and assert it modified no row. */
const quiet = <T>(s: CoordStore, call: () => T, label = ''): T => {
  const before = writes(s);
  const out = call();
  expect(writes(s), `${label} wrote a row`).toBe(before);
  return out;
};

// The refusal words: every kebab `why` of the three results is an
// `UpdateStoreRefuseCode` (W2 ruling R5 — one vocabulary, appended to). The
// one-word arms (`superseded`, `busy`) are below the kebab scan's reach, as
// W2's own `superseded`/`busy`/`halted` are, and are not declared there.
// Held against the result types BOTH ways at compile time
// (`typecheck-tests.test.ts`), asserted below so the lines are read.
type Why = Extract<RequestNodeResult | DispatchNodeResult | NoteDispatchRefusalResult, { ok: false }>['why'];
const KEBAB_WHYS = ['unknown-node', 'bad-tag', 'bad-kind', 'no-request', 'not-idle'] as const satisfies readonly Why[];
const ONE_WORD_WHYS = ['superseded', 'busy'] as const satisfies readonly Why[];
const everyWhyListed: [Exclude<Why, (typeof KEBAB_WHYS)[number] | (typeof ONE_WORD_WHYS)[number]>] extends [never]
  ? true : never = true;
const everyKebabWhyDeclared: [Exclude<(typeof KEBAB_WHYS)[number], UpdateStoreRefuseCode>] extends [never]
  ? true : never = true;
// §18 "a refusing write never returns void": a writer whose return type is
// `void` makes its line `never`, and `= true` stops compiling.
const requestNeverVoid: [ReturnType<CoordStore['requestNode']>] extends [void] ? never : true = true;
const dispatchNeverVoid: [ReturnType<CoordStore['dispatchNode']>] extends [void] ? never : true = true;
const noteNeverVoid: [ReturnType<CoordStore['noteDispatchRefusal']>] extends [void] ? never : true = true;

describe("requestNode — the request group's setter (design 2026-09-20 §6, §12)", () => {
  it('writes the three request columns and nothing else, and says which request it overwrote (decision 7)', () => {
    const s = twoNodes();
    const before = s.node(UUID_A)!;
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0 + 5)).toEqual({ ok: true, replaced: null });
    expect(s.node(UUID_A)).toEqual({ ...before, requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: T0 + 5 });
    expect(s.requestNode(UUID_A, 'v0.0.8', 'rollback', T0 + 9))
      .toEqual({ ok: true, replaced: { tag: 'v0.0.10', kind: 'update' } });
    expect(s.node(UUID_A)).toEqual({ ...before, requestedTag: 'v0.0.8', requestedKind: 'rollback', requestedAt: T0 + 9 });
    expect(s.node(UUID_S)!.requestedTag).toBeNull();   // another node's request group is not this one's
  });

  it('reports a stored kind this build cannot name as null — never folded into a word it is not', () => {
    const s = twoNodes();
    s.db.prepare("UPDATE nodes SET requestedTag = 'v0.0.9', requestedKind = 'reinstall', requestedAt = ? WHERE nodeId = ?")
      .run(T0, UUID_A);
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0 + 1))
      .toEqual({ ok: true, replaced: { tag: 'v0.0.9', kind: null } });
    expect(s.node(UUID_A)).toMatchObject({ requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: T0 + 1 });
  });

  it('writes a request beside a held lease and leaves the lease exactly as it was — the request waits its turn', () => {
    const s = twoNodes();
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'auto: v0.0.10')).toEqual({ ok: true });
    const leased = s.node(UUID_A)!;
    expect(s.requestNode(UUID_A, 'v0.0.11', 'update', T0 + 1)).toEqual({ ok: true, replaced: null });
    expect(s.node(UUID_A)).toEqual({ ...leased, requestedTag: 'v0.0.11', requestedKind: 'update', requestedAt: T0 + 1 });
  });

  it('refuses an unknown id, a superseded row, a non-tag and an unknown kind, writing nothing', () => {
    const s = superseded();
    expect(quiet(s, () => s.requestNode(UUID_B, 'v0.0.10', 'update', T0), 'unknown'))
      .toEqual({ ok: false, why: 'unknown-node' });
    expect(quiet(s, () => s.requestNode('fleet', 'v0.0.10', 'update', T0), 'superseded'))
      .toEqual({ ok: false, why: 'superseded', supersededBy: UUID_A });
    for (const tag of ['0.0.10', 'v0.0', 'v0.0.10\n', '', '; rm -rf ~']) {
      expect(quiet(s, () => s.requestNode(UUID_A, tag, 'update', T0), JSON.stringify(tag)), JSON.stringify(tag))
        .toEqual({ ok: false, why: 'bad-tag' });
    }
    for (const kind of ['sideways', '', 'UPDATE']) {
      expect(quiet(s, () => s.requestNode(UUID_A, 'v0.0.10', kind as RequestKind, T0), kind), kind)
        .toEqual({ ok: false, why: 'bad-kind' });
    }
    expect(s.node(UUID_A)).toMatchObject({ requestedTag: null, requestedKind: null, requestedAt: null });
  });

  it('an `at` that is not a non-negative integer throws before any SQL — SQLite would bind NaN as NULL', () => {
    const s = twoNodes();
    const before = writes(s);
    for (const at of [Number.NaN, 1.5, -1, Number.POSITIVE_INFINITY]) {
      expect(() => s.requestNode(UUID_A, 'v0.0.10', 'update', at), String(at)).toThrow(RangeError);
    }
    expect(writes(s)).toBe(before);
  });
});

describe('dispatchNode — the ONE lease acquire (design 2026-09-20 §6, §10)', () => {
  it('acquires an idle row: pending, with the target, the start and the detail; the request columns unchanged', () => {
    const s = twoNodes();
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0).ok).toBe(true);
    const before = s.node(UUID_A)!;
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0 + 7, 'request: v0.0.10')).toEqual({ ok: true });
    expect(s.node(UUID_A)).toEqual({ ...before, updateState: 'pending', updateTarget: 'v0.0.10',
      updateStartedAt: T0 + 7, updateDetail: 'request: v0.0.10' });
  });

  it('acquires an update with no request standing — an auto-driven move has none (§9)', () => {
    const s = twoNodes();
    expect(s.dispatchNode(UUID_S, 'v0.0.10', 'update', T0, 'auto: v0.0.10')).toEqual({ ok: true });
    expect(s.node(UUID_S)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10', requestedTag: null });
  });

  it('refuses a second node while the first holds the lease, naming the holder and writing nothing (§18 "one dispatch per sweep")', () => {
    const s = twoNodes();
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'a')).toEqual({ ok: true });
    const other = s.node(UUID_S)!;
    expect(quiet(s, () => s.dispatchNode(UUID_S, 'v0.0.10', 'update', T0 + 1, 's'), 'second node'))
      .toEqual({ ok: false, why: 'busy', heldBy: UUID_A });
    expect(s.node(UUID_S)).toEqual(other);
    // The holder's own second acquire is busy too — held by itself — and its lease is untouched.
    expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.11', 'update', T0 + 2, 'again'), 'own row'))
      .toEqual({ ok: false, why: 'busy', heldBy: UUID_A });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: T0,
      updateDetail: 'a' });
  });

  it('counts applying, unknown AND a token this build cannot name as a held lease (§18 "unknown is busy")', () => {
    for (const state of ['applying', 'unknown', 'paused']) {
      const s = twoNodes();
      plantState(s, UUID_S, state);
      expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'a'), state), state)
        .toEqual({ ok: false, why: 'busy', heldBy: UUID_S });
      expect(quiet(s, () => s.dispatchNode(UUID_S, 'v0.0.10', 'update', T0, 's'), state), state)
        .toEqual({ ok: false, why: 'busy', heldBy: UUID_S });
      expect(s.node(UUID_A)!.updateState, state).toBe('idle');
    }
  });

  it("acquires a failed or a reverted row, and a failed row elsewhere blocks nothing — the halt is the planner's (Task 4)", () => {
    for (const state of ['failed', 'reverted'] as const) {
      const s = twoNodes();
      plantState(s, UUID_A, state);
      expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'x'), state).toEqual({ ok: true });
      expect(s.node(UUID_A)!.updateState, state).toBe('pending');
    }
    const s = twoNodes();
    plantState(s, UUID_S, 'failed', 'provenance: sigstore refused v0.0.10');
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'x')).toEqual({ ok: true });
  });

  it("a superseded row's stale busy lease blocks nothing — the NOT EXISTS reads live rows only (§8 \"a superseded row is invisible\")", () => {
    const s = superseded();
    plantState(s, 'fleet', 'applying');
    expect(s.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null })).ok).toBe(true);
    expect(s.dispatchNode(UUID_S, 'v0.0.10', 'update', T0, 's')).toEqual({ ok: true });
  });

  it('acquires a rollback only for the rollback an operator requested (D-3376)', () => {
    const s = twoNodes();
    expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.8', 'rollback', T0, 'r'), 'no request'))
      .toEqual({ ok: false, why: 'no-request' });
    expect(s.requestNode(UUID_A, 'v0.0.8', 'update', T0).ok).toBe(true);        // an UPDATE request for that tag
    expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.8', 'rollback', T0, 'r'), 'update request'))
      .toEqual({ ok: false, why: 'no-request' });
    expect(s.requestNode(UUID_A, 'v0.0.7', 'rollback', T0).ok).toBe(true);      // a rollback to ANOTHER tag
    expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.8', 'rollback', T0, 'r'), 'other tag'))
      .toEqual({ ok: false, why: 'no-request' });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', updateTarget: null, updateDetail: null });
    expect(s.requestNode(UUID_A, 'v0.0.8', 'rollback', T0 + 1).ok).toBe(true);
    const before = s.node(UUID_A)!;
    expect(s.dispatchNode(UUID_A, 'v0.0.8', 'rollback', T0 + 2, 'rollback: v0.0.8')).toEqual({ ok: true });
    expect(s.node(UUID_A)).toEqual({ ...before, updateState: 'pending', updateTarget: 'v0.0.8',
      updateStartedAt: T0 + 2, updateDetail: 'rollback: v0.0.8' });
  });

  it('refuses an unknown id, a superseded row, a non-tag and an unknown kind, writing nothing', () => {
    const s = superseded();
    expect(quiet(s, () => s.dispatchNode(UUID_B, 'v0.0.10', 'update', T0, 'x'), 'unknown'))
      .toEqual({ ok: false, why: 'unknown-node' });
    expect(quiet(s, () => s.dispatchNode('fleet', 'v0.0.10', 'update', T0, 'x'), 'superseded'))
      .toEqual({ ok: false, why: 'superseded', supersededBy: UUID_A });
    for (const tag of ['0.0.10', 'v0.0', 'v0.0.10 ', '', '; rm -rf ~']) {
      expect(quiet(s, () => s.dispatchNode(UUID_A, tag, 'update', T0, 'x'), JSON.stringify(tag)), JSON.stringify(tag))
        .toEqual({ ok: false, why: 'bad-tag' });
    }
    for (const kind of ['sideways', '', 'ROLLBACK']) {
      expect(quiet(s, () => s.dispatchNode(UUID_A, 'v0.0.10', kind as RequestKind, T0, 'x'), kind), kind)
        .toEqual({ ok: false, why: 'bad-kind' });
    }
    expect(s.node(UUID_A)!.updateState).toBe('idle');
  });

  it('a startedAt that is not a non-negative integer throws before any SQL', () => {
    const s = twoNodes();
    const before = writes(s);
    for (const at of [Number.NaN, 1.5, -1, Number.POSITIVE_INFINITY]) {
      expect(() => s.dispatchNode(UUID_A, 'v0.0.10', 'update', at, 'x'), String(at)).toThrow(RangeError);
    }
    expect(writes(s)).toBe(before);
    expect(s.node(UUID_A)!.updateState).toBe('idle');
  });

  it('releaseLease after a real acquire leaves the request standing and frees the lease (§18 "a refusal does not consume the request")', () => {
    const s = twoNodes();
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0).ok).toBe(true);
    expect(s.requestNode(UUID_S, 'v0.0.10', 'update', T0).ok).toBe(true);
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0 + 1, 'request: v0.0.10')).toEqual({ ok: true });
    expect(s.releaseLease(UUID_A, 'idle', 'busy — update.json says installing', null)).toEqual({ ok: true, state: 'idle' });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', updateDetail: 'busy — update.json says installing',
      requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: T0 });
    expect(s.dispatchNode(UUID_S, 'v0.0.10', 'update', T0 + 2, 'request: v0.0.10')).toEqual({ ok: true });
  });
});

describe('noteDispatchRefusal — a refusal written where the operator reads it (design §9, §10, §12)', () => {
  const REFUSAL = 'no-detach-cap — fleet cannot run a detached update (no detach cap)';

  it('writes updateDetail on an idle row and nothing else', () => {
    const s = twoNodes();
    expect(s.requestNode(UUID_A, 'v0.0.10', 'update', T0).ok).toBe(true);
    const before = s.node(UUID_A)!;
    expect(s.noteDispatchRefusal(UUID_A, REFUSAL)).toEqual({ ok: true, changed: true });
    expect(s.node(UUID_A)).toEqual({ ...before, updateDetail: REFUSAL });
  });

  it('the same text again is changed: false and writes nothing — a refusal re-planned every sweep is written once (Review Focus 5)', () => {
    const s = twoNodes();
    expect(s.noteDispatchRefusal(UUID_A, REFUSAL)).toEqual({ ok: true, changed: true });
    const noted = s.node(UUID_A)!;
    expect(quiet(s, () => s.noteDispatchRefusal(UUID_A, REFUSAL), 'repeat')).toEqual({ ok: true, changed: false });
    expect(s.node(UUID_A)).toEqual(noted);
    expect(s.noteDispatchRefusal(UUID_A, 'not-newer — v0.0.9 is not newer than v0.0.9')).toEqual({ ok: true, changed: true });
  });

  it('never writes a row that is not idle — a failed row\'s detail is the verdict the halt reads (Review Focus 5)', () => {
    const VERDICT = 'provenance: sigstore refused v0.0.10';
    for (const [stored, read] of [['failed', 'failed'], ['reverted', 'reverted'], ['applying', 'applying'],
      ['unknown', 'unknown'], ['paused', 'unknown']] as const) {
      const s = twoNodes();
      plantState(s, UUID_A, stored, VERDICT);
      expect(quiet(s, () => s.noteDispatchRefusal(UUID_A, REFUSAL), stored), stored)
        .toEqual({ ok: false, why: 'not-idle', state: read });
      expect(s.node(UUID_A)!.updateDetail, stored).toBe(VERDICT);
    }
    const s = twoNodes();
    expect(s.dispatchNode(UUID_A, 'v0.0.10', 'update', T0, 'request: v0.0.10')).toEqual({ ok: true });
    expect(quiet(s, () => s.noteDispatchRefusal(UUID_A, REFUSAL), 'pending'))
      .toEqual({ ok: false, why: 'not-idle', state: 'pending' });
    expect(s.node(UUID_A)!.updateDetail).toBe('request: v0.0.10');
  });

  it('refuses an unknown id and a superseded row, writing nothing', () => {
    const s = superseded();
    expect(quiet(s, () => s.noteDispatchRefusal(UUID_B, REFUSAL), 'unknown')).toEqual({ ok: false, why: 'unknown-node' });
    expect(quiet(s, () => s.noteDispatchRefusal('fleet', REFUSAL), 'superseded'))
      .toEqual({ ok: false, why: 'superseded', supersededBy: UUID_A });
  });
});

describe('the refusal words (W2 ruling R5)', () => {
  it('every kebab refusal word is declared, once, in the ONE update-store vocabulary; no writer returns void', () => {
    expect([everyWhyListed, everyKebabWhyDeclared, requestNeverVoid, dispatchNeverVoid, noteNeverVoid])
      .toEqual([true, true, true, true, true]);
    for (const w of KEBAB_WHYS) expect(isUpdateStoreRefuseCode(w), w).toBe(true);
    expect(new Set(UPDATE_STORE_REFUSE_CODES).size, 'a word is declared twice').toBe(UPDATE_STORE_REFUSE_CODES.length);
  });
});
```

In `server/test/update-writer-groups.test.ts`, replace `WRITER_GROUPS`' lease row's second line

```ts
      writers: ['dispatchNode', 'releaseLease', 'settleNode', 'ackNode'] },
```

with

```ts
      writers: ['dispatchNode', 'releaseLease', 'settleNode', 'ackNode', 'noteDispatchRefusal'] },
```

directly after wave 3's declaration

```ts
const W3_WRITERS = ['markReleaseNotified'] as const;
```

add

```ts

/** The programme-wave-5 writers the same floor requires (spec W4's
 *  dispatcher, Task 3): the request group's setter, the lease group's ONE
 *  acquire, and the refusal note on an idle row (D-3375).
 *  A list of its own, as W3's is, so each floor entry says which wave put it
 *  there. */
const W5_WRITERS = ['requestNode', 'dispatchNode', 'noteDispatchRefusal'] as const;
```

and replace the floor case's first three lines (as wave 3 left them)

```ts
  it('finds every W2 and W3 writer writing — a renamed table reds this, and so does rewriting a required writer\'s ONLY write into one of the header\'s four invisible shapes (a writer with more than one statement in the scan is unaffected, and a NEW illegitimate write built the same way would not red either — see header)', () => {
    const found = new Set(stmts.map((s) => s.method));
    for (const w of [...W2_WRITERS, ...W3_WRITERS]) {
```

with

```ts
  it('finds every W2, W3 and W5 writer writing — a renamed table reds this, and so does rewriting a required writer\'s ONLY write into one of the header\'s four invisible shapes (a writer with more than one statement in the scan is unaffected, and a NEW illegitimate write built the same way would not red either — see header)', () => {
    const found = new Set(stmts.map((s) => s.method));
    for (const w of [...W2_WRITERS, ...W3_WRITERS, ...W5_WRITERS]) {
```

(the case's body below those lines — the two `expect`s — is unchanged).

- [ ] **Step 2: Run them to verify they fail, and record the audit's baseline**

Run, from `server/`, one at a time, foreground (timeout ≥ 600000 ms):
- `./node_modules/.bin/vitest run test/update-store-dispatch.test.ts` — Expected: FAIL, `Tests  20 failed (20)`. Nineteen fail on the first call of a missing writer — `TypeError: s.requestNode is not a function` (or `s.dispatchNode`, `s.noteDispatchRefusal`); the two throw cases report it as `expected error to be instance of RangeError`. "every kebab refusal word is declared …" fails at `bad-kind: expected false to be true` (`unknown-node` and `bad-tag` are W2's words and pass first).
- `./node_modules/.bin/vitest run test/update-writer-groups.test.ts` — Expected: FAIL, exactly one case: "finds every W2, W3 and W5 writer writing …" with `the scan found no statement of requestNode writing an update table: expected false to be true`. (Its first `expect` — `requestNode is in no writer group` — passes: W2 named it in the request row; `noteDispatchRefusal` is in the lease row by Step 1's edit.)
- `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` — Expected: PASS. Write down its `Tests` line (W2 measured `13 passed | 320 skipped (333)` on its own tree; W2 and wave 3 are merged here, so re-read it rather than trusting that one); Step 6 must print the same line.

- [ ] **Step 3: Implement the three writers in `server/src/coord/store.ts`**

No import edit: `isReleaseTag`, `isRequestKind`, `type RequestKind` and `type UpdateState` are already in the `'../../../shared/api.js'` block (W2 Task 4's `  isReleaseTag, isUpdateChannel,` and Task 5's two lines).

Directly after W2 Task 5's

```ts
export type AckNodeResult =
  | { ok: true; clearedRequest: boolean; clearedRefusals: number }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'busy'; state: BusyUpdateState };
```

add (a blank line first):

```ts

/** Design 2026-09-20 §6/§12 (programme wave 5). `requestNode`'s answers.
 *  `replaced` is the request that stood before this one and is now
 *  overwritten — `null` when none stood; its `kind` is `null` when the stored
 *  word is one this build cannot name (the reader's fallback, D-3181), never
 *  folded into a word it is not. `bad-tag`/`bad-kind` are decided before any
 *  SQL; `unknown-node`/`superseded` are read back after the zero-change
 *  write. The C2 warning `setAccountPools` carries applies: bind the value and
 *  discriminate `.ok` before answering the operator. */
export type RequestNodeResult =
  | { ok: true; replaced: { tag: string; kind: RequestKind | null } | null }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'bad-tag' }
  | { ok: false; why: 'bad-kind' };

/** `dispatchNode`'s answers — THE lease acquire (design §10). `busy` names
 *  the first live row holding a lease (`heldBy`, by nodeId) — this node's own
 *  or another's: one node at a time, fleet-wide. `no-request` is a rollback
 *  with no matching operator rollback request
 *  (D-3376). Every refusal writes nothing. */
export type DispatchNodeResult =
  | { ok: true }
  | { ok: false; why: 'busy'; heldBy: string }
  | { ok: false; why: 'no-request' }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'bad-tag' }
  | { ok: false; why: 'bad-kind' };

/** `noteDispatchRefusal`'s answers (D-3375).
 *  `changed: false` = the row already said this, and nothing was written.
 *  `not-idle` carries the state that refused the note: a `failed`/`reverted`
 *  row's detail is the verdict the halt reads, and a busy row's is its
 *  lease's — neither is the dispatcher's to overwrite. */
export type NoteDispatchRefusalResult =
  | { ok: true; changed: boolean }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'not-idle'; state: UpdateState };
```

In W2 Task 5's `// ── update inventory (design 2026-09-20 §6, §8, §10; W2) ───────────────` banner, replace the three lines

```ts
  // (`rekeyNode`), lease (`releaseLease`, `settleNode`, `ackNode`; W4 adds
  // `dispatchNode`), resolved (`resolveNode`), request (`settleNode` and
  // `ackNode` clear it; W4's `requestNode` sets it). Every guard is in the
```

with

```ts
  // (`rekeyNode`), lease (`dispatchNode` acquires; `releaseLease`,
  // `settleNode` and `ackNode` release; `noteDispatchRefusal` notes a refusal
  // on an idle row), resolved (`resolveNode`), request (`requestNode` sets it;
  // `settleNode` and `ackNode` clear it). Every guard is in the
```

and the three lines

```ts
  // precedent). Nothing in W2 calls a lease writer on a real row — no W2 code
  // acquires a lease — so the release and settle arms are pinned on planted
  // fixtures for W4's dispatcher to reach.
```

with

```ts
  // precedent). W2 pinned the release and settle arms on PLANTED leases;
  // programme wave 5's `dispatchNode` is the acquire that makes them real
  // (`update-store-dispatch.test.ts`).
```

Directly after W2 Task 5's `ackNode` method — its last lines

```ts
      return { ok: false, why: 'busy', state: busyOf(row.updateState) ?? 'unknown' };
    });
  }
```

— and before `nodes()`'s docstring (`/** Every LIVE node — the inventory every reader starts from; …`), add (a blank line first):

```ts

  /** The request group's SETTER (design §6, §12; programme wave 5): the
   *  `apply` and `rollback` routes write the operator's one-tap here, and it
   *  stands until convergence (`settleNode`) or the operator (`ackNode`)
   *  clears it — a refusal or a drop never does (decision 7). Writes the three
   *  request columns and nothing else, on a LIVE row; a request on a row that
   *  holds a lease is written and waits, the lease untouched. The previous
   *  request is read inside the same IMMEDIATE transaction only to REPORT it
   *  (`replaced`); the write's own `WHERE` is the guard. `at` is the caller's
   *  clock: a value that is not a non-negative safe integer throws, because
   *  SQLite binds NaN as NULL (`markReleaseNotified`'s reason). */
  requestNode(nodeId: string, tag: string, kind: RequestKind, at: number): RequestNodeResult {
    if (!Number.isSafeInteger(at) || at < 0) {
      throw new RangeError(`requestNode: at must be a non-negative integer ms timestamp, got ${String(at)}`);
    }
    if (!isReleaseTag(tag)) return { ok: false, why: 'bad-tag' };
    if (!isRequestKind(kind)) return { ok: false, why: 'bad-kind' };
    return tx(this.db, (): RequestNodeResult => {
      const prev = this.db.prepare('SELECT requestedTag, requestedKind FROM nodes WHERE nodeId = ?')
        .get(nodeId) as { requestedTag: string | null; requestedKind: string | null } | undefined;
      const res = this.db.prepare(
        'UPDATE nodes SET requestedTag = ?, requestedKind = ?, requestedAt = ? WHERE nodeId = ? AND supersededBy IS NULL',
      ).run(tag, kind, at, nodeId);
      if (Number(res.changes) > 0) {
        if (prev === undefined || prev.requestedTag === null) return { ok: true, replaced: null };
        return { ok: true, replaced: { tag: prev.requestedTag,
          kind: isRequestKind(prev.requestedKind) ? prev.requestedKind : null } };
      }
      const row = this.nodeLeaseRow(nodeId);
      if (row === null) return { ok: false, why: 'unknown-node' };
      // The row exists and the only other predicate is `supersededBy IS NULL`.
      return { ok: false, why: 'superseded', supersededBy: row.supersededBy! };
    });
  }

  /** THE lease acquire (design §6, §10; programme wave 5) — the ONE writer
   *  that moves a settled row to busy. One `UPDATE … WHERE` under `tx`
   *  (`BEGIN IMMEDIATE`, synchronous), so two sweeps cannot dispatch two
   *  nodes: the row must be live and settled; NO live row anywhere may hold a
   *  lease (busy is `NOT IN` settled, so `unknown` and a token this build
   *  cannot name hold it — W2's stance; a superseded row is invisible here as
   *  everywhere); and a rollback must match the operator's rollback request
   *  (D-3376 — a move down is never automatic;
   *  an update carries no such clause, since an auto-driven update has no
   *  request). The row's own `IN settled` predicate is subsumed by the
   *  `NOT EXISTS` (a live row is one of the rows it reads) and is kept as the
   *  rule's plain statement. Capability, direction and the halt are policy,
   *  decided by the pure planner (`update/dispatch.ts`) in the same
   *  synchronous stretch (D-3377). The request columns are
   *  never written here, and the row reads `pending` until the sweep settles
   *  or releases it (D-3382). A zero-change write is read
   *  back in the same transaction only to LABEL the refusal (the `markAcked`
   *  idiom). `startedAt` is the caller's clock and throws as `requestNode`'s
   *  `at` does. */
  dispatchNode(nodeId: string, target: string, kind: RequestKind, startedAt: number, detail: string): DispatchNodeResult {
    if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
      throw new RangeError(`dispatchNode: startedAt must be a non-negative integer ms timestamp, got ${String(startedAt)}`);
    }
    if (!isReleaseTag(target)) return { ok: false, why: 'bad-tag' };
    if (!isRequestKind(kind)) return { ok: false, why: 'bad-kind' };
    return tx(this.db, (): DispatchNodeResult => {
      const res = this.db.prepare(
        "UPDATE nodes SET updateState = 'pending', updateTarget = ?, updateStartedAt = ?, updateDetail = ? " +
        `WHERE nodeId = ? AND supersededBy IS NULL AND updateState IN ${SETTLED_UPDATE_SQL} ` +
        `AND NOT EXISTS (SELECT 1 FROM nodes b WHERE b.supersededBy IS NULL AND b.updateState NOT IN ${SETTLED_UPDATE_SQL}) ` +
        "AND (? <> 'rollback' OR (requestedKind = 'rollback' AND requestedTag = ?))",
      ).run(target, startedAt, detail, nodeId, kind, target);
      if (Number(res.changes) > 0) return { ok: true };
      const row = this.nodeLeaseRow(nodeId);
      if (row === null) return { ok: false, why: 'unknown-node' };
      if (row.supersededBy !== null) return { ok: false, why: 'superseded', supersededBy: row.supersededBy };
      const holder = this.db.prepare(
        `SELECT nodeId FROM nodes WHERE supersededBy IS NULL AND updateState NOT IN ${SETTLED_UPDATE_SQL} ORDER BY nodeId LIMIT 1`,
      ).get() as { nodeId: string } | undefined;
      if (holder !== undefined) return { ok: false, why: 'busy', heldBy: holder.nodeId };
      // Live, settled, no lease held anywhere, and still refused: the rollback
      // clause is the only predicate left (an update cannot reach this line).
      return { ok: false, why: 'no-request' };
    });
  }

  /** A refusal the dispatcher planned, written where the operator reads it
   *  (design §9/§10/§12: a settled, non-halting refusal "shown in
   *  `updateDetail`"; D-3375). `updateDetail` ONLY, ONLY
   *  on a live `idle` row, and ONLY when the text differs — the dispatcher
   *  re-plans every node on every run, so one refusal is written once, not
   *  every sweep. It never touches a `failed`/`reverted` row, whose detail is
   *  the verdict `isHalting` reads (the `provenance:` prefix is what keeps a
   *  provenance verdict non-halting), nor a busy row, whose detail is its
   *  lease's; and it never touches the request (decision 7). */
  noteDispatchRefusal(nodeId: string, detail: string): NoteDispatchRefusalResult {
    return tx(this.db, (): NoteDispatchRefusalResult => {
      const res = this.db.prepare(
        'UPDATE nodes SET updateDetail = ? WHERE nodeId = ? AND supersededBy IS NULL ' +
        "AND updateState = 'idle' AND updateDetail IS NOT ?",
      ).run(detail, nodeId, detail);
      if (Number(res.changes) > 0) return { ok: true, changed: true };
      const row = this.nodeLeaseRow(nodeId);
      if (row === null) return { ok: false, why: 'unknown-node' };
      if (row.supersededBy !== null) return { ok: false, why: 'superseded', supersededBy: row.supersededBy };
      if (row.updateState !== 'idle') return { ok: false, why: 'not-idle', state: row.updateState };
      return { ok: true, changed: false };
    });
  }
```

Three scanners read this text, and each is satisfied by construction: every signature is ONE line with a return type (`mail-hardening.test.ts`'s and `update-writer-groups.test.ts`'s `SIG`); every write is inside a `this.db.prepare(` window with its SET list spelled literally (`setColumns` reads `requestedTag, requestedKind, requestedAt` / `updateState, updateTarget, updateStartedAt, updateDetail` / `updateDetail` and stops at the first `WHERE`, so the subquery is never read as a SET item; the `SELECT … FROM nodes` windows write nothing and are skipped); and every kebab word in prose is in backticks, so the only single-quoted kebab tokens `mail-routes.test.ts`'s scan finds are the result arms' `why` values (`'pending'`, `'idle'`, `'rollback'` inside the SQL are one word each).

- [ ] **Step 4: Run the store test and the group scan, and watch the vocabulary case and the kebab scanner go red**

Run, from `server/`, one at a time, foreground:
- `./node_modules/.bin/vitest run test/update-store-dispatch.test.ts` — Expected: FAIL, `Tests  1 failed | 19 passed (20)`: exactly "every kebab refusal word is declared, once, in the ONE update-store vocabulary; no writer returns void", at `bad-kind: expected false to be true`. The writers are complete; their words are not yet declared.
- `./node_modules/.bin/vitest run test/update-writer-groups.test.ts` — Expected: PASS, 20 cases (wave 3's count, W2's at `2b5d4ce1`: no case added; the floor now finds all three W5 writers, and "every column a statement writes is owned by a group its method writes" reads `requestNode`'s statement as the request group's and `dispatchNode`'s and `noteDispatchRefusal`'s as the lease group's).
- `./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'` — Expected: FAIL, `no-request is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode, SetAccountPoolsRefuseCode or UpdateStoreRefuseCode` (the message tail W2 Task 4 and wave 3 Task 1 quote): `DispatchNodeResult`'s `'no-request'` is the first undeclared single-quoted kebab token the scan reaches in `store.ts` — `'unknown-node'` and `'bad-tag'` before it are W2's, and `RequestNodeResult`'s `'bad-kind'` is already a `MailRejectCode` (`shared/api.ts:4974`), admitted by the chain's first clause. This red is the measurement that the scanner sees the new arms; Step 5 fixes it and touches no test file.

- [ ] **Step 5: Append the three words to the ONE update-store vocabulary in `shared/api.ts`** (W2 ruling R5, D-3192)

Both edits are in place inside W2's end-of-file update block — below every line `session-hook.test.ts`'s citation audit and README cite (`shared/api.ts` above `:7526`), so no cited line moves (ruling R13, D-3188). No new declaration, and `mail-routes.test.ts` is NOT edited: W2 Task 4's one `|| isUpdateStoreRefuseCode(tok)` admits a member added later.

In the array's docstring, replace wave 3's last entry's closing line

```ts
 *                    sends nothing (design §13: one push per tag). */
```

(the line after ` *                    already set. The first mark stands, and the caller`) with

```ts
 *                    sends nothing (design §13: one push per tag).
 *    bad-kind      — `requestNode`/`dispatchNode` (programme wave 5): a kind
 *                    outside `REQUEST_KINDS`; decided before any SQL.
 *    no-request    — `dispatchNode`: a rollback with no matching operator
 *                    rollback request — a move down is never automatic
 *                    (design decision 8). Nothing is written.
 *    not-idle      — `noteDispatchRefusal`: the row is not `idle`. A
 *                    `failed`/`reverted` row's detail is the verdict the halt
 *                    reads and a busy row's is its lease's; nothing is written. */
```

and wave 3's array

```ts
export const UPDATE_STORE_REFUSE_CODES = [
  'bad-tag', 'duplicate-tag', 'bad-row', 'empty-listing', 'unknown-node',
  'bad-node-id', 'label-key-taken', 'not-busy', 'stale-report',
  'empty-patch', 'bad-field', 'unknown-scope', 'no-channel', 'journal-unreadable', 'journal-unwritable',
  'single-not-one', 'withdrawn-not-empty',
  'unknown-release', 'already-notified',
] as const;
```

with

```ts
export const UPDATE_STORE_REFUSE_CODES = [
  'bad-tag', 'duplicate-tag', 'bad-row', 'empty-listing', 'unknown-node',
  'bad-node-id', 'label-key-taken', 'not-busy', 'stale-report',
  'empty-patch', 'bad-field', 'unknown-scope', 'no-channel', 'journal-unreadable', 'journal-unwritable',
  'single-not-one', 'withdrawn-not-empty',
  'unknown-release', 'already-notified',
  'bad-kind', 'no-request', 'not-idle',
] as const;
```

(`bad-tag` and `unknown-node` are W2 Task 4's words, reused — not appended a second time; the uniqueness checks in this task's test, wave 3's `update-store-notified.test.ts` and W2's `update-store-intent.test.ts` would red on a duplicate.)

- [ ] **Step 6: Run green**

Run, from `server/`, one at a time, foreground (timeout ≥ 600000 ms):
- `./node_modules/.bin/vitest run test/update-store-dispatch.test.ts` — PASS, 20 cases.
- `./node_modules/.bin/vitest run test/update-writer-groups.test.ts` — PASS, 20 cases.
- `./node_modules/.bin/vitest run test/mail-routes.test.ts` — PASS, the whole file (the kebab scanner admits `no-request` and `not-idle` through W2 Task 4's `isUpdateStoreRefuseCode` guard; `bad-kind` it admitted as a `MailRejectCode` before this task).
- `./node_modules/.bin/vitest run test/update-store-nodes.test.ts` — PASS, W2's count (its planted-lease cases are unchanged by three new methods).
- `./node_modules/.bin/vitest run test/update-store-notified.test.ts test/update-store-intent.test.ts` — PASS (the array holds no duplicate).
- `./node_modules/.bin/vitest run test/mail-hardening.test.ts` — PASS (no `mail_deliveries` write added; the new signatures are one line).
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — PASS (the array is still defined once, in `shared/api.ts`; `store.ts` spells no bracket tuple of a vocabulary — the settled fragment is W2's `.join`-built `SETTLED_UPDATE_SQL`, and `'idle'`/`'pending'`/`'rollback'` are single literals).
- `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` — PASS, printing the SAME `Tests` line Step 2 recorded (ruling R13: `shared/api.ts` is cited, and both of this task's edits there sit in the end-of-file block; a red means a line landed above a cited one — move it, never re-point the census). A known load flake: re-run a red in isolation before reading it.
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — PASS (the new file compiles under `test/tsconfig.tests.json`; `everyWhyListed`/`everyKebabWhyDeclared` compile only while the three results' arms are exactly `KEBAB_WHYS` ∪ `ONE_WORD_WHYS` and each kebab one is an `UpdateStoreRefuseCode`, and the three `…NeverVoid` lines only while no writer returns `void`). A known load flake — re-run in isolation before calling a red real.

- [ ] **Step 7: Mutation measurement**

Save the green files first, from the repo root — each mutation is restored from these copies, NEVER with `git checkout --` (which would discard this task's uncommitted work):

```bash
G="$(mktemp -d)"; cp server/src/coord/store.ts "$G/store.ts"; cp shared/api.ts "$G/api.ts"
```

Each row: make the edit, run the named file(s) from `server/`, see the named case(s) red, then `cp "$G/store.ts" server/src/coord/store.ts` (or `cp "$G/api.ts" shared/api.ts`) and re-run green.

| # | §18 row / guard | Edit (in `dispatchNode` unless named) | Run | Red |
|---|---|---|---|---|
| 1 | "one dispatch per sweep" | delete the line `` `AND NOT EXISTS (SELECT 1 FROM nodes b WHERE b.supersededBy IS NULL AND b.updateState NOT IN ${SETTLED_UPDATE_SQL}) ` + `` | `test/update-store-dispatch.test.ts` | "refuses a second node while the first holds the lease …" (`second node wrote a row` — the acquire went through) and "counts applying, unknown AND a token …" (`applying wrote a row`) |
| 2 | "`unknown` is busy" (a hand-typed busy list is the defect) | in that `AND NOT EXISTS` line, `b.updateState NOT IN ${SETTLED_UPDATE_SQL}` → `b.updateState IN ('pending', 'applying')` | `test/update-store-dispatch.test.ts` | "counts applying, unknown AND a token this build cannot name as a held lease" at `unknown` (`unknown wrote a row` — `applying` passes first, being in the hand-typed list) |
| 3 | the own-row predicate is subsumed (a CONTROL, expected GREEN) | delete `` AND updateState IN ${SETTLED_UPDATE_SQL} `` from the `WHERE nodeId = ?` line (keep the rest of the line) | `test/update-store-dispatch.test.ts` | NONE — PASS, 20 cases, and that green is the measurement: a live busy self already fails the `NOT EXISTS`, so the own-row clause carries no pin of its own and the table says so rather than listing it as guarded. Restore |
| 4 | a superseded row is invisible to the subquery | in the `AND NOT EXISTS` line, delete `b.supersededBy IS NULL AND ` | `test/update-store-dispatch.test.ts` | "a superseded row's stale busy lease blocks nothing …" (`expected { ok: false, why: 'no-request' } to deeply equal { ok: true }` — the acquire is refused by the superseded row, and the unmutated labelling read, which reads live rows only, finds no holder) |
| 5 | D-3376 | delete the line `"AND (? <> 'rollback' OR (requestedKind = 'rollback' AND requestedTag = ?))",`, remove the `+` ending the line above it, and change `.run(target, startedAt, detail, nodeId, kind, target)` to `.run(target, startedAt, detail, nodeId)` | `test/update-store-dispatch.test.ts` | "acquires a rollback only for the rollback an operator requested" (`no request wrote a row` — the rollback acquired with no request standing) |
| 6 | "one writer per column group" (a request column in the acquire) | `"UPDATE nodes SET updateState = 'pending', updateTarget = ?,` → `"UPDATE nodes SET updateState = 'pending', requestedTag = NULL, updateTarget = ?,` | `test/update-writer-groups.test.ts test/update-store-dispatch.test.ts` | "every column a statement writes is owned …" with `dispatchNode (store.ts:N) writes nodes.requestedTag — the request group's writers are requestNode, settleNode, ackNode`; and "acquires an idle row …" (`requestedTag: null` where `'v0.0.10'` stood) |
| 7 | "one writer per column group" (a lease column in the setter) | in `requestNode`, `'UPDATE nodes SET requestedTag = ?,` → `'UPDATE nodes SET updateDetail = NULL, requestedTag = ?,` | `test/update-writer-groups.test.ts test/update-store-dispatch.test.ts` | "every column a statement writes is owned …" with `requestNode (store.ts:N) writes nodes.updateDetail — the lease group's writers are dispatchNode, releaseLease, settleNode, ackNode, noteDispatchRefusal`; and "writes a request beside a held lease …" (`updateDetail: null`) |
| 8 | "a refusing write never returns `void`" (runtime) | replace `if (holder !== undefined) return { ok: false, why: 'busy', heldBy: holder.nodeId };` with `if (holder !== undefined) return undefined as unknown as DispatchNodeResult;` | `test/update-store-dispatch.test.ts` | "refuses a second node …" and "counts applying, unknown …" (`expected undefined to deeply equal { ok: false, why: 'busy', … }`) |
| 9 | "a refusing write never returns `void`" (type) | change the signature's `): DispatchNodeResult {` to `): void {` | `test/typecheck-tests.test.ts` | the tsc run fails: `TS2322` at `dispatchNode`'s `return tx(…)` in `store.ts`, and `TS2322: Type 'true' is not assignable to type 'never'.` at `dispatchNeverVoid` in `update-store-dispatch.test.ts` (the line's own name says which guard; the message measured with `tsc --strict` over the same construction) |
| 10 | Review Focus 5 — never overwrite a verdict | in `noteDispatchRefusal`, `"AND updateState = 'idle' AND updateDetail IS NOT ?",` → `'AND updateDetail IS NOT ?',` | `test/update-store-dispatch.test.ts` | "never writes a row that is not idle …" at `failed` (`failed wrote a row`) |
| 11 | Review Focus 5 — written once | in `noteDispatchRefusal`, `"AND updateState = 'idle' AND updateDetail IS NOT ?",` → `"AND updateState = 'idle'",` and `.run(detail, nodeId, detail)` → `.run(detail, nodeId)` | `test/update-store-dispatch.test.ts` | "the same text again is changed: false and writes nothing …" (`repeat wrote a row`) |
| 12 | a superseded row is never requested | in `requestNode`, delete ` AND supersededBy IS NULL` from its `UPDATE` | `test/update-store-dispatch.test.ts` | "refuses an unknown id, a superseded row, a non-tag and an unknown kind, writing nothing" in the `requestNode` describe (`superseded wrote a row`) |
| 13 | "a refusal does not consume the request" (W2's writer, with a real acquire) | in `releaseLease`, `'UPDATE nodes SET updateState = ?, updateDetail = ? WHERE nodeId = ? AND supersededBy IS NULL ' +` → `'UPDATE nodes SET updateState = ?, updateDetail = ?, requestedTag = NULL WHERE nodeId = ? AND supersededBy IS NULL ' +` | `test/update-store-dispatch.test.ts` | "releaseLease after a real acquire leaves the request standing …" (`requestedTag: null`); W2's `update-writer-groups` and `update-store-nodes` red as well |
| 14 | the attribution and the W5 floor | rewrite `noteDispatchRefusal`'s signature as three lines: `  noteDispatchRefusal(` / `    nodeId: string, detail: string,` / `  ): NoteDispatchRefusalResult {` | `test/update-writer-groups.test.ts` | "finds every W2, W3 and W5 writer writing …" (`the scan found no statement of noteDispatchRefusal writing an update table`) and "store.ts carries no write the scan cannot attribute" (`… the walk-back crossed a method close — the signature of the method writing nodes is not single-line`) |
| 15 | R5 — the words are declared, and the scanner reads them | in `shared/api.ts`, delete the line `  'bad-kind', 'no-request', 'not-idle',` | `test/mail-routes.test.ts -t 'every quoted kebab token'` and `test/update-store-dispatch.test.ts` | the scan names `no-request` (not `bad-kind`, which `MAIL_REJECT_CODES` admits); "every kebab refusal word is declared …" at `bad-kind: expected false to be true`. Restore; then change that line to `  'no-request', 'not-idle',` (drop `bad-kind` alone) → the scan stays GREEN (the `MailRejectCode` clause admits it) and "every kebab refusal word is declared …" reds at `bad-kind` — this task's case is the only pin on `bad-kind`'s membership. Restore; then change that line to `  'bad-kind', 'no-request',` (drop `not-idle` alone) → the scan names `not-idle` and the same case reds at `not-idle` — the third word is load-bearing. Restore; then append `'bad-tag',` to that line (a duplicate) → the same case red at `a word is declared twice` |

After the last restore, `diff "$G/store.ts" server/src/coord/store.ts && diff "$G/api.ts" shared/api.ts` prints nothing, and Step 6's first three commands PASS again.

- [ ] **Step 8: Commit**

Run first: `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` (a new file is added; run after `git add`) — Expected: PASS.

```bash
git add server/src/coord/store.ts shared/api.ts server/test/update-store-dispatch.test.ts server/test/update-writer-groups.test.ts
git commit -m "feat(update): the request setter and the one lease acquire — requestNode, dispatchNode (one busy lease fleet-wide, a rollback only on request), noteDispatchRefusal (idle rows, once per text) (programme wave 5 Task 3)"
```

### Task 4: The dispatcher's decision (L1)

**Files:**
- Create: `server/src/update/dispatch.ts` — L1; imports only `'../../../shared/api.js'`, `'../../../shared/agent-protocol.js'` (for `UPDATE_OP`, Task 1 — CORRECTED from the skeleton's three specifiers: the `agentOps` check needs the op's one spelling, and `agent-protocol.ts` is L0 — after Task 1 it imports only its L0 siblings, `./buildinfo.js` (type) and `./api.js` (`isReleaseTag`, `isRequestKind` and `type RequestKind`, Task 1's one import line), so a fourth `shared/` specifier keeps this file L1), `'../../../shared/semver.js'`, and `'./resolve.js'` — `type EligibilityRow` plus ONE value, `floorOf` (W2 Task 12; CORRECTED from the skeleton's "type-only": the update arm's floor check needs W2's one definition of the floor, D-3403, and `resolve.ts` is itself L1 — pure functions over two `shared/` modules — so a value import from it keeps this file L1; the ring case reads specifiers only) (R7)
- Modify: `shared/api.ts` — `DISPATCH_REFUSALS`, `DispatchRefusal`, `isDispatchRefusal`, `dispatchRank`, `compareDispatchOrder` APPENDED after Task 1's `inFlightReport` closing `}` (the file's last line after Task 1; end-of-file block, D-3188, R13) — no line above moves and no `import` is added (`peers-claims-l0.test.ts`'s three-import pin)
- Modify: `server/test/single-definition.test.ts` — the ONE `UPDATE_RING_FILES` line (quoted after wave 3: `  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts', 'notify.ts'];`) gains `'dispatch.ts'` IN PLACE (one line for one line — line-neutral, R13); one describe APPENDED after the file's last line (after Task 1's appended describe): `DispatchRefusal`, `DISPATCH_REFUSALS`, `isDispatchRefusal`, `dispatchRank`, `compareDispatchOrder` each have one holder (`shared/api.ts`), and no file across the four TS roots spells a second list — parenthesised OR bracketed — of the eleven words. No import line is added or changed: the describe states the eleven words as a literal (NOT W2's `SQL_VOCABS` idiom — that list is built from the arrays its import line names; F16's `NODE_FILES` describe derives its own by a dynamic `import()`), chained to L0's array by `update-dispatch.test.ts`
- Test: `server/test/update-dispatch.test.ts` (create) — including the import-block assertion on `dispatch.ts` (exactly the four specifiers above) and a type-level line that `NodeRow` satisfies `DispatchRow`
- Run, not edited: `server/test/session-hook.test.ts` (R13 — `shared/api.ts` and `single-definition.test.ts` are cited), `server/test/typecheck-tests.test.ts`, `server/test/update-resolve.test.ts`, `server/test/update-states.test.ts`, `server/test/peers-claims-l0.test.ts`, `server/test/topology-clean.test.ts` (after `git add` — a file is added, Step 8); `cd pwa && npm run build` (the PWA bundles `shared/api.ts` under `noUnusedLocals`)

**Interfaces:**
- Consumes: `UPDATE_GATE_CAP` (wave 3 Task 7, `shared/api.ts` — imported from its L0 home directly, not through `resolve.ts`'s `export { UPDATE_GATE_CAP }` — the one VALUE this file takes from `./resolve.js` is `floorOf`; either way `dispatch.ts` quotes no `'update-gate'`, which keeps wave 3's one-holder scan green), `SETTLED_UPDATE_STATES`, `isReleaseTag`, `NodeRole`, `RequestKind`, `AutoMode`, `UpdateChannel`, `UpdateState`, `StampRead` (W2 Task 1); `isNewerTag` (W2 Task 2, `shared/semver.ts`; throws `RangeError` on a non-tag, so every call sits behind `isReleaseTag` on both arguments); `EligibilityRow` (W2 Task 12, `resolve.ts`, type) and `floorOf(highestVersion, currentVersion)` (W2 Task 12, `resolve.ts`, value — D-3202's floor: `highestVersion` when it is a tag, the running tag when that is higher or the floor is NULL, NULL when neither is a tag; the resolver's own floor, so the dispatcher and the resolver can never disagree about where a node's floor is); `highestVersion` (W2 Task 5's `NodeRow` column, `~/.ccrc/floor`) and `floorRead` (W2 D-3213's `NodeRow` column, `TagFileRead` — `'measured' | 'absent' | 'unmeasured'`, `shared/api.ts`): a NULL `highestVersion` is unconstrained only when `floorRead` is not `'unmeasured'` — the resolver refuses a never-measured floor BEFORE it calls `floorOf` (`resolveOnChannel`, `RESOLVE_DETAIL.floorUnmeasured`), and the dispatcher refuses that update the same way, with its OWN word `floor-unread` — never `stamp-unread`, whose sentence is about the build stamp (D-3492); `UPDATE_OP` (Task 1, `shared/agent-protocol.ts`); wave 4's cap words `detach` and `rollback` (wave 4 Task 13's `CCRC_CAP_WORDS=(verify node-id floor update-json update-gate rollback)` and `CCRC_CAP_WORDS_LINUX=(detach)`, which `_inst_caps` writes to `~/.ccrc/ccrc-caps`), declared here as `DETACH_CAP`/`ROLLBACK_CAP`. CORRECTED: `BUSY_UPDATE_STATES` is not consumed — busy is "not settled", W2's own stance (`NOT IN SETTLED_UPDATE_SQL`, its D-2803 note), so an out-of-vocabulary state is busy by construction; `compareReleaseTags` is not needed (`isNewerTag` decides every direction).
- Produces (in `shared/api.ts`) — exactly the skeleton's block:

```ts
export const DISPATCH_REFUSALS = ['unknown-tag', 'not-newer', 'refused-by-node', 'stamp-unread', 'floor-unread', 'no-detach-cap',
  'no-update-gate', 'no-rollback-cap', 'agent-predates-update-op', 'halted', 'waiting-for-fleet'] as const;
export type DispatchRefusal = (typeof DISPATCH_REFUSALS)[number];
export function isDispatchRefusal(v: unknown): v is DispatchRefusal;
export function dispatchRank(role: NodeRole | null): 0 | 1 | 2;   // fleet 0; server, both 1; null 2
export function compareDispatchOrder(a: { role: NodeRole | null; label: string; nodeId: string }, b: { role: NodeRole | null; label: string; nodeId: string }): number;
```

- Produces (in `server/src/update/dispatch.ts`) — the skeleton's block with its CORRECTIONS, each marked:

```ts
export const DETACH_CAP = 'detach';
export const ROLLBACK_CAP = 'rollback';
export const UNVERSIONED_DETAIL = 'unversioned box — any eligible release is newer';   // spec §10, verbatim
export const PROVENANCE_DETAIL_PREFIX = 'provenance:';                                  // W2 sweepPlanFor's test
export const DEADLINE_DETAIL = 'deadline';                                              // spec §10 "failed: deadline"
export interface DispatchRow {
  nodeId: string; role: NodeRole | null; label: string;
  currentVersion: string | null; highestVersion: string | null; floorRead: TagFileRead;   // CORRECTED: + highestVersion, the floor (D-3403); + floorRead, W2 D-3213 (D-3492)
  stampRead: StampRead; caps: readonly string[]; agentOps: readonly string[] | null;
  reachable: boolean; updateState: UpdateState; updateTarget: string | null; updateStartedAt: number | null;
  updateDetail: string | null; reportedUpdatedAt: number | null;
  channel: UpdateChannel | null; desiredTag: string | null;
  requestedTag: string | null; requestedKind: RequestKind | null; requestedAt: number | null;
}
export interface DispatchNodeView { row: DispatchRow; auto: AutoMode; refusedTags: ReadonlySet<string> }
export interface DispatchInput { nodes: readonly DispatchNodeView[]; releases: readonly EligibilityRow[] }
export interface DispatchMove { nodeId: string; kind: RequestKind; target: string; source: 'request' | 'auto'; viaLink: boolean; detail: string }
export interface PlannedRefusal { nodeId: string; refusal: DispatchRefusal; detail: string }
export interface MetRequest { nodeId: string; tag: string }
export interface FleetGate { haltedBy: string[]; leaseHeldBy: string | null }
export interface DispatchPlan {
  gate: FleetGate; move: DispatchMove | null;
  refusals: PlannedRefusal[];   // CORRECTED: IDLE rows only — a refused failed/reverted row keeps its verdict detail (Review Focus 5)
  met: MetRequest[];            // CORRECTED: an IDLE row whose stamp read and equals the request — settleNode refuses a halted row
}
/** CORRECTED (added): the row a refusal sentence names besides the node — the halting row, or the fleet row a
 *  server-role node waits on. The skeleton's three-argument signature had no way to name either. `auto` is set
 *  only when that fleet row holds the server back by its unconverged AUTO move (D-3402);
 *  absent, a fleet row's wait is its request. */
export interface RefusalBlocker { label: string; tag: string | null; auto?: true }
export function isHalting(row: Pick<DispatchRow, 'updateState' | 'updateDetail'>): boolean;
export function fleetGate(rows: readonly DispatchRow[]): FleetGate;
export function autoPermits(auto: AutoMode, channel: UpdateChannel | null): boolean;
export function moveRefusal(view: DispatchNodeView, move: { kind: RequestKind; target: string; source: 'request' | 'auto' }, releases: readonly EligibilityRow[], gate: FleetGate): DispatchRefusal | null;
/** CORRECTED: `target: string` (every refusal is of a move that has one) and a fourth, defaulted `blocker`. */
export function dispatchRefusalDetail(refusal: DispatchRefusal, view: DispatchNodeView, target: string, blocker?: RefusalBlocker | null): string;
export function deadlineExpired(row: Pick<DispatchRow, 'updateState' | 'updateStartedAt' | 'reportedUpdatedAt'>, now: number, deadlineMs: number): boolean;
export function planDispatch(input: DispatchInput): DispatchPlan;
```

- `moveRefusal`'s order, first match wins: `halted` (any live halting row) → (update) `stamp-unread` (`stampRead ≠ 'ok'`, or `ok` with a non-tag version — D-3379) → (update) `floor-unread` (a NULL `highestVersion` whose `floorRead` is `'unmeasured'` — a floor never measured is not "no floor", W2 D-3213, D-3492; its own word, so its sentence names the floor and never the stamp) → (update) `not-newer` (a target not strictly newer than the node's FLOOR, W2's `floorOf(highestVersion, currentVersion)` — the floor file's tag, or the running tag when that is higher or the floor is NULL: so a versioned node is never "moved" to a tag at or below what it runs, and a rolled-back node is never moved back up to or below its floor by an `update` — spec decision 8, "requested as an `update`, moves a node only to a strictly NEWER version than its floor", and §10's "the dispatcher re-checks capabilities, direction and the floor"; an unversioned node with NO floor never — D-3403; its sentence names the floor when the floor is not the running tag) → `unknown-tag` (update: no releases row, or yanked, or `bundleListed` false — D-3395; rollback: no releases row, yanked PERMITTED) → `refused-by-node` (THIS node's refusals, either kind — D-3394) → `no-detach-cap` (every move, the server's too) → (rollback) `no-rollback-cap` → (auto) `no-update-gate` → (`agentOps` not NULL) `agent-predates-update-op`. `waiting-for-fleet` is never `moveRefusal`'s: `planDispatch` adds it to a node `moveRefusal` cleared, of rank ≠ 0 (CORRECTED from "rank 1": a `null`-role row, rank 2, waits too — an unnamed role never jumps the fleet), while any live fleet-role row has `requestedTag` set, whatever its state or reachability (D-3381); and, when the cleared node's own move is `source: 'auto'`, while any live fleet-role row has `autoPermits(view.auto, row.channel)` and a non-null `desiredTag` — the fleet row auto has not yet converged — whatever its state, reachability or refusal (D-3402; an operator's request on the server row is never held by it, and the note's `RefusalBlocker` carries `auto: true`).
- `planDispatch`: a view is considered iff its row is settled and reachable and it has an intended move — a request (`requestedTag` set; a `requestedKind` that reads `null` moves nothing and auto does not take over, D-3396) outranking auto (`autoPermits(view.auto, row.channel)` and `desiredTag` set → `update`, `source: 'auto'`). Considered nodes are visited in `compareDispatchOrder`; a met request goes to `met`; otherwise a refusal goes to `refusals` (idle rows only); the first cleared node is the move unless `gate.leaseHeldBy` is set. The move's `detail` is `UNVERSIONED_DETAIL` for an update to an unversioned node, else `<requested|auto> <kind> from <current> to <target>`.
- Spec §18 rows pinned: "fleet before server" (mutation: drop the sort → the fleet-auto / server-request case reds), "`failed` halts dispatch" (mutation: `isHalting` returns false → red), "a provenance refusal does not halt" (mutation: delete the prefix exception → red), "every capability refusal is in the dispatcher" (each word has a planner case; mutation: remove `no-detach-cap` → red), "the server row is never refused for `agentOps`" (mutation: check `agentOps` on a NULL row → red), "an agent without the op is never sent it" (mutation: drop the `agentOps` check → red), "`apply` refuses an older tag; an unversioned node is never "not newer"" (the dispatcher half — mutations: remove `not-newer`; make the NULL arm refuse), decision 8's floor on a requested `update` (mutation: compare against the running tag alone → the rolled-back and floored-unversioned cases red), "`auto` needs the gate cap, at dispatch time" (the planner half; Task 7 the act), "`unknown` is busy" (the planner half — `unknown` holds the lease and is deadline-bounded). Review Focus 1, 2 and 5 (the planner halves).

Every count and red below was MEASURED on a scratch copy of `d759c914` carrying, as stand-ins for the merged producers, W2 Task 1's end-of-file block, W2 Task 2's `shared/semver.ts`, W2 Task 12's `resolve.ts` with wave 3 Task 7's `UPDATE_GATE_CAP` move applied, and Task 1's `UPDATE_OP` — exactly the names this task consumes. On the merged tree the files are larger, so re-measure the counts rather than copy them; the red NAMES are what must match. The floor check (D-3403 — `DispatchRow.highestVersion`, the `floorOf` import, the `not-newer` sentence's floor arm, the fixture's `highestVersion: 'v0.0.9'`, the three fixtures that set it explicitly and the two floor cases) and the auto hold (D-3402 — `fleetAuto`, the `auto` blocker sentence, the rewritten two-auto case, the fleet-auto / server-request order case and the four auto-hold cases) were added in review and RE-MEASURED on a second stand-in tree — the same stand-ins, W2 Task 12's `floorOf` copied from its committed text, `NodeRow` stood in with `highestVersion` — under `tsc --strict --noUncheckedIndexedAccess --noUnusedLocals`: Step 6's `update-dispatch` count and mutation rows 1–14 and 16 below are from that run, EXCEPT row 7d, every `floorRead` line and the `floor-unread` word itself — its place in `DISPATCH_REFUSALS`, its sentence and its entry in the reach table (W2 D-3213, D-3492) — added when the unit was re-pointed onto W2's tip and not yet measured. Rows 15, 17 and 18 (the ring, and the two that need `single-definition.test.ts` and the real tree) were not re-run after review.

- [ ] **Step 1: Write the failing dispatcher test**

Create `server/test/update-dispatch.test.ts` (Task 5 puts its `classifyOpAnswer` table in its own `update-op-answer.test.ts` and adds no line here — its only possible edit, the import-block list below, already names the four specifiers):

```ts
// The dispatcher's decision (design 2026-09-20 §9/§10; programme wave 5, Task
// 4): planDispatch's table — eligibility, the halt, the order, the capability
// refusals, the direction, the met request — moveRefusal (the predicate the
// routes answer a single node's 409 with), deadlineExpired, the L0 order and
// refusal vocabulary, and the import block that keeps dispatch.ts L1. Values
// in, values out: nothing here needs a fixture home, a store or a clock.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEADLINE_DETAIL, DETACH_CAP, PROVENANCE_DETAIL_PREFIX, ROLLBACK_CAP, UNVERSIONED_DETAIL,
  autoPermits, deadlineExpired, dispatchRefusalDetail, fleetGate, isHalting, moveRefusal, planDispatch,
  type DispatchNodeView, type DispatchPlan, type DispatchRow, type FleetGate,
} from '../src/update/dispatch.js';
import type { EligibilityRow } from '../src/update/resolve.js';
import type { NodeRow } from '../src/coord/store.js';
import {
  DISPATCH_REFUSALS, UPDATE_GATE_CAP, UPDATE_STATES, compareDispatchOrder, dispatchRank, isDispatchRefusal,
  type AutoMode, type DispatchRefusal, type NodeRole, type RequestKind, type UpdateState,
} from '../../shared/api.js';
import { UPDATE_OP } from '../../shared/agent-protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const FLEET_ID = '0f0f0f0f-0000-4000-8000-00000000000f';
const SERVER_ID = '5e5e5e5e-0000-4000-8000-00000000005e';
/** Wave 4's seven words on Linux (its Task 13's two arrays, written by `_inst_caps`), through the constants that spell them. */
const W4_CAPS = ['verify', 'node-id', 'floor', 'update-json', UPDATE_GATE_CAP, ROLLBACK_CAP, DETACH_CAP];

/** A W4 fleet node: v0.0.9 on stable with its floor at v0.0.9 (it completed that install), reachable, idle,
 *  advertising the op, no request, no desired tag. */
const fleet = (o: Partial<DispatchRow> = {}): DispatchRow => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet',
  currentVersion: 'v0.0.9', highestVersion: 'v0.0.9', floorRead: 'measured', stampRead: 'ok', caps: W4_CAPS, agentOps: [UPDATE_OP],
  reachable: true, updateState: 'idle', updateTarget: null, updateStartedAt: null, updateDetail: null,
  reportedUpdatedAt: null, channel: 'stable', desiredTag: null,
  requestedTag: null, requestedKind: null, requestedAt: null, ...o,
});
/** The server's own row: spawned locally, so `agentOps` is NULL by construction (decision 11). */
const server = (o: Partial<DispatchRow> = {}): DispatchRow =>
  fleet({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...o });
const ask = (tag: string, kind: RequestKind = 'update'): Partial<DispatchRow> =>
  ({ requestedTag: tag, requestedKind: kind, requestedAt: 1_000 });
const view = (row: DispatchRow, auto: AutoMode = 'off', refused: readonly string[] = []): DispatchNodeView =>
  ({ row, auto, refusedTags: new Set(refused) });
const rel = (tag: string, o: Partial<EligibilityRow> = {}): EligibilityRow =>
  ({ tag, channel: 'stable', bundleListed: true, yanked: false, ...o });
/** v0.0.8 yanked; v0.0.9 and v0.0.10 stable; v0.0.11 dev; v0.0.12 listed WITHOUT its provenance bundle. */
const RELEASES: EligibilityRow[] = [
  rel('v0.0.8', { yanked: true }), rel('v0.0.9'), rel('v0.0.10'), rel('v0.0.11', { channel: 'dev' }),
  rel('v0.0.12', { bundleListed: false }),
];
const plan = (...nodes: DispatchNodeView[]): DispatchPlan => planDispatch({ nodes, releases: RELEASES });
const OPEN: FleetGate = { haltedBy: [], leaseHeldBy: null };
const refusalOf = (v: DispatchNodeView, kind: RequestKind, target: string,
  source: 'request' | 'auto' = 'request', gate: FleetGate = OPEN): DispatchRefusal | null =>
  moveRefusal(v, { kind, target, source }, RELEASES, gate);
const words = (p: DispatchPlan): [string, DispatchRefusal][] => p.refusals.map((r) => [r.nodeId, r.refusal]);

describe('the L0 refusal vocabulary and the dispatch order (design 2026-09-20 §9/§10)', () => {
  it('DISPATCH_REFUSALS is the eleven words, in order, with no duplicate', () => {
    expect([...DISPATCH_REFUSALS]).toEqual([
      'unknown-tag', 'not-newer', 'refused-by-node', 'stamp-unread', 'floor-unread', 'no-detach-cap',
      'no-update-gate', 'no-rollback-cap', 'agent-predates-update-op', 'halted', 'waiting-for-fleet',
    ]);
    expect(new Set(DISPATCH_REFUSALS).size).toBe(DISPATCH_REFUSALS.length);
  });

  it('isDispatchRefusal admits every member and nothing else', () => {
    for (const w of DISPATCH_REFUSALS) expect(isDispatchRefusal(w), w).toBe(true);
    const probes: unknown[] = ['', null, undefined, 1, {}, [], 'busy', 'toString',
      ...DISPATCH_REFUSALS.flatMap((w) => [w.toUpperCase(), ` ${w}`, `${w} `, [w]])];
    for (const p of probes) expect(isDispatchRefusal(p), JSON.stringify(p)).toBe(false);
  });

  it('dispatchRank: fleet 0, server and both 1, an unnamed role 2', () => {
    const ranks: [NodeRole | null, number][] = [['fleet', 0], ['server', 1], ['both', 1], [null, 2]];
    for (const [role, rank] of ranks) expect(dispatchRank(role), String(role)).toBe(rank);
  });

  it('compareDispatchOrder: rank, then label, then nodeId — by code unit, never the locale', () => {
    const rows = [
      { role: null, label: 'a', nodeId: 'n1' }, { role: 'server' as const, label: 'server', nodeId: 'n2' },
      { role: 'both' as const, label: 'box', nodeId: 'n3' }, { role: 'fleet' as const, label: 'z', nodeId: 'n4' },
      { role: 'fleet' as const, label: 'B', nodeId: 'n5' }, { role: 'fleet' as const, label: 'a', nodeId: 'n7' },
      { role: 'fleet' as const, label: 'a', nodeId: 'n6' },
    ];
    // 'B' (0x42) before 'a' (0x61): a locale collation would put `a` first.
    expect([...rows].sort(compareDispatchOrder).map((r) => r.nodeId)).toEqual(['n5', 'n6', 'n7', 'n4', 'n3', 'n2', 'n1']);
    expect(compareDispatchOrder(rows[0]!, rows[0]!)).toBe(0);
  });
});

describe('the halt predicate and the fleet gate', () => {
  it('reverted and failed halt; idle and every busy state do not', () => {
    for (const s of UPDATE_STATES) {
      expect(isHalting({ updateState: s, updateDetail: null }), s).toBe(s === 'reverted' || s === 'failed');
    }
  });

  it('a failed row whose detail BEGINS provenance: does not halt — only the prefix counts', () => {
    expect(PROVENANCE_DETAIL_PREFIX).toBe('provenance:');
    expect(isHalting({ updateState: 'failed', updateDetail: 'provenance: signature does not verify' })).toBe(false);
    expect(isHalting({ updateState: 'failed', updateDetail: 'spawn-failed — provenance: later in the text' })).toBe(true);
    expect(isHalting({ updateState: 'failed', updateDetail: 'provenance signature' })).toBe(true);
    expect(isHalting({ updateState: 'reverted', updateDetail: 'provenance: a reverted row halts whatever it says' })).toBe(true);
  });

  it('fleetGate names the halting rows by nodeId and the first busy row — `unknown` holds the lease', () => {
    const a = fleet({ nodeId: 'b', updateState: 'failed', updateDetail: 'stamp-mismatch' });
    const b = fleet({ nodeId: 'a', updateState: 'reverted' });
    const c = fleet({ nodeId: 'c', updateState: 'failed', updateDetail: 'provenance: x' });
    expect(fleetGate([a, b, c])).toEqual({ haltedBy: ['a', 'b'], leaseHeldBy: null });
    for (const busy of ['pending', 'applying', 'unknown'] as UpdateState[]) {
      expect(fleetGate([fleet({ nodeId: 'z' }), fleet({ nodeId: 'y', updateState: busy })]).leaseHeldBy, busy).toBe('y');
    }
  });
});

describe('autoPermits', () => {
  it('off never; stable only on a stable-resolved node; channel on any resolved channel', () => {
    const table: [AutoMode, 'stable' | 'dev' | null, boolean][] = [
      ['off', 'stable', false], ['off', 'dev', false], ['off', null, false],
      ['stable', 'stable', true], ['stable', 'dev', false], ['stable', null, false],
      ['channel', 'stable', true], ['channel', 'dev', true], ['channel', null, false],
    ];
    for (const [auto, channel, want] of table) expect(autoPermits(auto, channel), `${auto}/${channel}`).toBe(want);
  });
});

describe('planDispatch — one node at a time, fleet-role first (§18 "fleet before server")', () => {
  it('two requested nodes: the fleet node moves, the server waits for it and says so', () => {
    const p = plan(view(fleet(ask('v0.0.10'))), view(server(ask('v0.0.10'))));
    expect(p.move).toEqual({
      nodeId: FLEET_ID, kind: 'update', target: 'v0.0.10', source: 'request', viaLink: true,
      detail: 'requested update from v0.0.9 to v0.0.10',
    });
    expect(p.refusals).toEqual([{
      nodeId: SERVER_ID, refusal: 'waiting-for-fleet',
      detail: "waiting-for-fleet — fleet's request for v0.0.10 is outstanding — server moves to v0.0.10 after it is settled or acked",
    }]);
    expect(p.met).toEqual([]);
  });

  it('the same with the server first on the wire', () => {
    const p = plan(view(server(ask('v0.0.10'))), view(fleet(ask('v0.0.10'))));
    expect(p.move?.nodeId).toBe(FLEET_ID);
  });

  it('two AUTO-eligible nodes, the server first on the wire: the fleet node moves and the server waits for its auto move (D-3402)', () => {
    const p = plan(
      view(server({ desiredTag: 'v0.0.10' }), 'stable'),
      view(fleet({ desiredTag: 'v0.0.10' }), 'stable'),
    );
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, source: 'auto', kind: 'update', target: 'v0.0.10' });
    expect(p.refusals).toEqual([{
      nodeId: SERVER_ID, refusal: 'waiting-for-fleet',
      detail: "waiting-for-fleet — fleet's auto update to v0.0.10 has not landed — server moves to v0.0.10 after it does, or once that node's own auto is off",
    }]);
  });

  it('a fleet AUTO move and a server REQUEST, the server first on the wire: the fleet moves, the server waits its turn un-noted', () => {
    // Nothing DEFERS the server here — a fleet row with no request never holds a request, and the auto hold holds
    // auto moves only — so only the ORDER keeps the server second (the case mutation 1 reds).
    const p = plan(view(server(ask('v0.0.10'))), view(fleet({ desiredTag: 'v0.0.10' }), 'stable'));
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, source: 'auto', target: 'v0.0.10' });
    expect(p.refusals).toEqual([]);
  });

  it('the server row moves locally (viaLink false) once the fleet has nothing asked of it', () => {
    const p = plan(view(fleet()), view(server(ask('v0.0.10'))));
    expect(p.move).toMatchObject({ nodeId: SERVER_ID, viaLink: false, target: 'v0.0.10' });
  });

  it('a busy row anywhere holds the one lease: no move, the waiting node is not noted', () => {
    for (const busy of ['pending', 'applying', 'unknown'] as UpdateState[]) {
      const p = plan(view(fleet({ nodeId: 'held', label: 'other', updateState: busy })), view(fleet(ask('v0.0.10'))));
      expect(p.move, busy).toBeNull();
      expect(p.gate.leaseHeldBy, busy).toBe('held');
      expect(p.refusals, busy).toEqual([]);
    }
  });
});

describe('planDispatch — the halt (§18 "`failed` halts dispatch", "a provenance refusal does not halt")', () => {
  it('a failed row halts every move, and every requested idle row is noted halted, naming the halting node', () => {
    const p = plan(
      view(fleet({ nodeId: 'dead', label: 'other', updateState: 'failed', updateDetail: 'stamp-mismatch' })),
      view(fleet(ask('v0.0.10'))), view(server(ask('v0.0.10'))),
    );
    expect(p.move).toBeNull();
    expect(p.gate.haltedBy).toEqual(['dead']);
    expect(words(p)).toEqual([[FLEET_ID, 'halted'], [SERVER_ID, 'halted']]);
    expect(p.refusals[0]!.detail)
      .toBe('halted — a failed or reverted node (other) halts every move until it is acked — fleet waits for v0.0.10');
  });

  it('a reverted row halts too', () => {
    const p = plan(view(fleet({ nodeId: 'back', updateState: 'reverted' })), view(server(ask('v0.0.10'))));
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[SERVER_ID, 'halted']]);
  });

  it('a provenance-failed row halts nothing, and is itself eligible to a newer tag it has not refused', () => {
    const verdict = { updateState: 'failed' as const, updateDetail: 'provenance: signature does not verify' };
    const p = plan(view(fleet({ ...verdict, ...ask('v0.0.10') }), 'off', ['v0.0.11']));
    expect(p.gate.haltedBy).toEqual([]);
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, target: 'v0.0.10' });
    // …and another node moves beside it while it reads failed with no intent of its own.
    const q = plan(view(fleet(verdict)), view(server(ask('v0.0.10'))));
    expect(q.move).toMatchObject({ nodeId: SERVER_ID });
  });

  it('a provenance-failed row whose standing request names the refused tag: no move, NEVER noted, auto does not take over', () => {
    // Decision 7: the refusal does not consume the request, so it stands until ack; the verdict detail is what
    // the halt exception reads, and a note written over it would turn a non-halting verdict into a halt.
    const row = fleet({ updateState: 'failed', updateDetail: 'provenance: bundle absent', ...ask('v0.0.10'), desiredTag: 'v0.0.9' });
    const p = plan(view(row, 'channel', ['v0.0.10']));
    expect(p.move).toBeNull();
    expect(p.refusals).toEqual([]);
    expect(p.met).toEqual([]);
  });
});

describe('planDispatch — who is considered', () => {
  it('an unreachable node is not considered: no move, no note, no met', () => {
    const p = plan(view(fleet({ ...ask('v0.0.10'), reachable: false })));
    expect(p).toEqual({ gate: OPEN, move: null, refusals: [], met: [] });
    expect(plan(view(fleet({ ...ask('v0.0.9'), reachable: false }))).met).toEqual([]);
  });

  it('auto off with a desiredTag moves nothing; auto stable on a dev-resolved node moves nothing', () => {
    expect(plan(view(fleet({ desiredTag: 'v0.0.10' }), 'off')).move).toBeNull();
    expect(plan(view(fleet({ desiredTag: 'v0.0.11', channel: 'dev' }), 'stable')).move).toBeNull();
  });

  it('auto channel with a desiredTag moves the node to it, source auto', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.11', channel: 'dev' }), 'channel'));
    expect(p.move).toEqual({
      nodeId: FLEET_ID, kind: 'update', target: 'v0.0.11', source: 'auto', viaLink: true,
      detail: 'auto update from v0.0.9 to v0.0.11',
    });
  });

  it('auto on a node whose caps lack the gate word is refused no-update-gate (the planner half of §18)', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.10', caps: W4_CAPS.filter((c) => c !== UPDATE_GATE_CAP) }), 'stable'));
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[FLEET_ID, 'no-update-gate']]);
  });

  it('a request outranks auto on the same node', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.11', channel: 'dev', ...ask('v0.0.10') }), 'channel'));
    expect(p.move).toMatchObject({ target: 'v0.0.10', source: 'request' });
  });

  it('a request whose kind this build cannot read moves nothing, and auto does not take over', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.10', requestedTag: 'v0.0.10', requestedKind: null }), 'stable'));
    expect(p).toEqual({ gate: OPEN, move: null, refusals: [], met: [] });
  });
});

describe('planDispatch — the direction and the met request (§18 "`apply` refuses an older tag…", Review Focus 1)', () => {
  it('an update requested at the running tag is met, never moved and never refused', () => {
    const p = plan(view(fleet(ask('v0.0.9'))));
    expect(p.met).toEqual([{ nodeId: FLEET_ID, tag: 'v0.0.9' }]);
    expect(p.move).toBeNull();
    expect(p.refusals).toEqual([]);
  });

  it('a rollback requested at the running tag is met too', () => {
    expect(plan(view(fleet(ask('v0.0.9', 'rollback')))).met).toEqual([{ nodeId: FLEET_ID, tag: 'v0.0.9' }]);
  });

  it('met needs an idle row whose stamp read: a halted row and an unread stamp are never met', () => {
    const halted = fleet({ updateState: 'reverted', ...ask('v0.0.9') });
    expect(plan(view(halted)).met).toEqual([]);
    const unread = fleet({ stampRead: 'unreadable', ...ask('v0.0.9') });
    expect(plan(view(unread)).met).toEqual([]);
  });

  it('an update below the running tag is not-newer — never met', () => {
    const p = plan(view(fleet({ currentVersion: 'v0.0.10', ...ask('v0.0.9') })));
    expect(p.met).toEqual([]);
    expect(words(p)).toEqual([[FLEET_ID, 'not-newer']]);
    expect(p.refusals[0]!.detail).toBe("not-newer — v0.0.9 is not newer than fleet's v0.0.10 — moving a node down is a rollback");
  });

  it('by the comparator, not the text: v0.0.10 is newer than v0.0.9', () => {
    expect(refusalOf(view(fleet()), 'update', 'v0.0.10')).toBeNull();
    expect(refusalOf(view(fleet({ currentVersion: 'v0.0.10' })), 'update', 'v0.0.9')).toBe('not-newer');
  });

  it('an unversioned node (stamp read, no version, no floor) is never "not newer" and moves with the spec\'s detail', () => {
    expect(UNVERSIONED_DETAIL).toBe('unversioned box — any eligible release is newer');
    const p = plan(view(fleet({ currentVersion: null, highestVersion: null, floorRead: 'absent', ...ask('v0.0.9') })));
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, target: 'v0.0.9', detail: UNVERSIONED_DETAIL });
  });

  it('a stamp that could not be read is stamp-unread, never unversioned (D-3379)', () => {
    for (const stampRead of ['absent', 'unreadable', 'malformed'] as const) {
      const p = plan(view(fleet({ stampRead, currentVersion: null, ...ask('v0.0.10') })));
      expect(words(p), stampRead).toEqual([[FLEET_ID, 'stamp-unread']]);
    }
    // A stamp that read but carries a non-tag version is the same unread fact.
    expect(refusalOf(view(fleet({ currentVersion: '0.0.9' })), 'update', 'v0.0.10')).toBe('stamp-unread');
  });

  it('an update needs a listed, unyanked row with its bundle — else unknown-tag', () => {
    expect(refusalOf(view(fleet({ currentVersion: 'v0.0.7', highestVersion: 'v0.0.7' })), 'update', 'v0.0.8'), 'yanked').toBe('unknown-tag');
    expect(refusalOf(view(fleet()), 'update', 'v0.0.12'), 'no bundle listed').toBe('unknown-tag');
    expect(refusalOf(view(fleet()), 'update', 'v0.0.99'), 'no row').toBe('unknown-tag');
    expect(refusalOf(view(fleet({ currentVersion: null })), 'update', 'v9'), 'not a tag, on an unversioned node').toBe('unknown-tag');
  });

  it('a rolled-back node: an update at or below its FLOOR is not-newer, naming the floor — the node would refuse it, and that failed row would halt the fleet (D-3403)', () => {
    // Rolled back from v0.0.10 to v0.0.8: the floor file keeps v0.0.10 (decision 8 — a rollback is sticky).
    const back = view(fleet({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.10' }));
    expect(refusalOf(back, 'update', 'v0.0.9'), 'above what it runs, below its floor').toBe('not-newer');
    expect(refusalOf(back, 'update', 'v0.0.10'), 'at its floor').toBe('not-newer');
    expect(refusalOf(back, 'update', 'v0.0.11'), 'above its floor').toBeNull();
    expect(dispatchRefusalDetail('not-newer', back, 'v0.0.9'))
      .toBe("not-newer — v0.0.9 is not newer than fleet's floor v0.0.10 (it runs v0.0.8) — pin a newer tag, or use rollback");
    const p = plan(view(fleet({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.10', ...ask('v0.0.9') })));
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[FLEET_ID, 'not-newer']]);
    // Rollback is the verb that names its direction: it is catalogue-gated, never floor-gated (decision 8).
    expect(refusalOf(back, 'rollback', 'v0.0.10')).toBeNull();
  });

  it('an unversioned node WITH a floor is not-newer at or below it; with none it is never not-newer (D-3403)', () => {
    const floored = view(fleet({ currentVersion: null, highestVersion: 'v0.0.9' }));
    expect(refusalOf(floored, 'update', 'v0.0.9')).toBe('not-newer');
    expect(refusalOf(floored, 'update', 'v0.0.10')).toBeNull();
    expect(refusalOf(view(fleet({ currentVersion: null, highestVersion: null, floorRead: 'absent' })), 'update', 'v0.0.9')).toBeNull();
    // A floor value that is not a tag is no floor (floorOf's own rule, W2 Task 12).
    expect(refusalOf(view(fleet({ currentVersion: null, highestVersion: '0.0.9' })), 'update', 'v0.0.9')).toBeNull();
    // A NULL floor never MEASURED (W2 D-3213, floorRead 'unmeasured') is not "no floor": the resolver refuses it
    // before floorOf, and so does the dispatcher — versioned or not, with its own word (the stamp DID read). A
    // rollback is not floor-gated.
    for (const currentVersion of ['v0.0.8', null]) {
      const unmeasured = view(fleet({ currentVersion, highestVersion: null, floorRead: 'unmeasured' }));
      expect(refusalOf(unmeasured, 'update', 'v0.0.10'), String(currentVersion)).toBe('floor-unread');
      expect(dispatchRefusalDetail('floor-unread', unmeasured, 'v0.0.10'))
        .toBe("floor-unread — fleet's floor has not been measured — v0.0.10 waits until it is");
      expect(refusalOf(unmeasured, 'rollback', 'v0.0.9')).toBeNull();
    }
  });
});

describe('planDispatch — rollback (decision 8: an explicit request, catalogue-gated)', () => {
  it('to a yanked release moves — rolling back to a yanked release is the point', () => {
    const p = plan(view(fleet(ask('v0.0.8', 'rollback'))));
    expect(p.move).toEqual({
      nodeId: FLEET_ID, kind: 'rollback', target: 'v0.0.8', source: 'request', viaLink: true,
      detail: 'requested rollback from v0.0.9 to v0.0.8',
    });
  });

  it('to a tag no releases row names is unknown-tag', () => {
    expect(refusalOf(view(fleet()), 'rollback', 'v0.0.7')).toBe('unknown-tag');
  });

  it('to a tag THIS node refused is refused-by-node; another node\'s refusal is not an input', () => {
    expect(refusalOf(view(fleet(), 'off', ['v0.0.8']), 'rollback', 'v0.0.8')).toBe('refused-by-node');
    const p = plan(view(fleet(ask('v0.0.8', 'rollback'))), view(server(), 'off', ['v0.0.8']));
    expect(p.move).toMatchObject({ nodeId: FLEET_ID, kind: 'rollback' });
  });

  it('an update to a refused tag is refused-by-node too (D-3394)', () => {
    expect(refusalOf(view(fleet(), 'off', ['v0.0.10']), 'update', 'v0.0.10')).toBe('refused-by-node');
  });

  it('without the rollback word it is no-rollback-cap; an update on the same node still moves', () => {
    const caps = W4_CAPS.filter((c) => c !== ROLLBACK_CAP);
    expect(refusalOf(view(fleet({ caps })), 'rollback', 'v0.0.8')).toBe('no-rollback-cap');
    expect(refusalOf(view(fleet({ caps })), 'update', 'v0.0.10')).toBeNull();
  });

  it('is never a not-newer: a rollback names its direction, and an unread stamp does not stop it', () => {
    expect(refusalOf(view(fleet({ currentVersion: 'v0.0.8' })), 'rollback', 'v0.0.10')).toBeNull();
    expect(refusalOf(view(fleet({ stampRead: 'unreadable', currentVersion: null })), 'rollback', 'v0.0.9')).toBeNull();
  });
});

describe('planDispatch — capabilities (§18 "every capability refusal is in the dispatcher")', () => {
  it('no detach word: no-detach-cap, for either kind, on the server row too', () => {
    const caps = W4_CAPS.filter((c) => c !== DETACH_CAP);
    expect(refusalOf(view(fleet({ caps })), 'update', 'v0.0.10')).toBe('no-detach-cap');
    expect(refusalOf(view(fleet({ caps })), 'rollback', 'v0.0.8')).toBe('no-detach-cap');
    expect(refusalOf(view(server({ caps })), 'update', 'v0.0.10')).toBe('no-detach-cap');
  });

  it('a link-reached row whose agent advertises nothing is agent-predates-update-op (§18 "an agent without the op is never sent it")', () => {
    const p = plan(view(fleet({ agentOps: [], ...ask('v0.0.10') })));
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[FLEET_ID, 'agent-predates-update-op']]);
    expect(refusalOf(view(fleet({ agentOps: ['something-else'] })), 'update', 'v0.0.10')).toBe('agent-predates-update-op');
  });

  it('the server row (agentOps NULL) is never refused for agentOps (§18)', () => {
    const p = plan(view(server(ask('v0.0.10'))));
    expect(p.move).toMatchObject({ nodeId: SERVER_ID, viaLink: false });
  });

  it('a REQUEST on a node without the gate word moves — a request needs detach, not the auto gate', () => {
    const caps = W4_CAPS.filter((c) => c !== UPDATE_GATE_CAP);
    const p = plan(view(fleet({ caps, desiredTag: 'v0.0.11', ...ask('v0.0.10') }), 'channel'));
    expect(p.move).toMatchObject({ target: 'v0.0.10', source: 'request' });
  });

  it('the server row under auto without the gate word is no-update-gate — checked for caps, never for agentOps', () => {
    const caps = W4_CAPS.filter((c) => c !== UPDATE_GATE_CAP);
    expect(refusalOf(view(server({ caps })), 'update', 'v0.0.10', 'auto')).toBe('no-update-gate');
  });

  it('every word but waiting-for-fleet is reachable from moveRefusal alone', () => {
    const halted: FleetGate = { haltedBy: ['x'], leaseHeldBy: null };
    const without = (c: string): string[] => W4_CAPS.filter((w) => w !== c);
    const reach: Record<Exclude<DispatchRefusal, 'waiting-for-fleet'>, DispatchRefusal | null> = {
      halted: refusalOf(view(fleet()), 'update', 'v0.0.10', 'request', halted),
      'stamp-unread': refusalOf(view(fleet({ stampRead: 'unreadable' })), 'update', 'v0.0.10'),
      'floor-unread': refusalOf(view(fleet({ highestVersion: null, floorRead: 'unmeasured' })), 'update', 'v0.0.10'),
      'not-newer': refusalOf(view(fleet()), 'update', 'v0.0.9'),
      'unknown-tag': refusalOf(view(fleet()), 'update', 'v0.0.12'),
      'refused-by-node': refusalOf(view(fleet(), 'off', ['v0.0.10']), 'update', 'v0.0.10'),
      'no-detach-cap': refusalOf(view(fleet({ caps: without(DETACH_CAP) })), 'update', 'v0.0.10'),
      'no-rollback-cap': refusalOf(view(fleet({ caps: without(ROLLBACK_CAP) })), 'rollback', 'v0.0.8'),
      'no-update-gate': refusalOf(view(fleet({ caps: without(UPDATE_GATE_CAP) })), 'update', 'v0.0.10', 'auto'),
      'agent-predates-update-op': refusalOf(view(fleet({ agentOps: [] })), 'update', 'v0.0.10'),
    };
    for (const [want, got] of Object.entries(reach)) expect(got, want).toBe(want);
  });

  it('the order of the checks: a halted fleet says so before any one node\'s fault', () => {
    const worst = view(fleet({ stampRead: 'unreadable', caps: [], agentOps: [] }), 'off', ['v0.0.10']);
    expect(refusalOf(worst, 'update', 'v0.0.10', 'request', { haltedBy: ['x'], leaseHeldBy: null })).toBe('halted');
    expect(refusalOf(worst, 'update', 'v0.0.10')).toBe('stamp-unread');
    expect(refusalOf(view(fleet({ caps: [], agentOps: [] }), 'off', ['v0.0.9']), 'update', 'v0.0.9')).toBe('not-newer');
    expect(refusalOf(view(fleet({ caps: [], agentOps: [] }), 'off', ['v0.0.12']), 'update', 'v0.0.12')).toBe('unknown-tag');
    expect(refusalOf(view(fleet({ caps: [], agentOps: [] }), 'off', ['v0.0.10']), 'update', 'v0.0.10')).toBe('refused-by-node');
    expect(refusalOf(view(fleet({ caps: [], agentOps: [] })), 'rollback', 'v0.0.8')).toBe('no-detach-cap');
    expect(refusalOf(view(fleet({ caps: [DETACH_CAP], agentOps: [] })), 'rollback', 'v0.0.8')).toBe('no-rollback-cap');
    expect(refusalOf(view(fleet({ caps: [DETACH_CAP], agentOps: [] })), 'update', 'v0.0.10', 'auto')).toBe('no-update-gate');
  });
});

describe('planDispatch — the order under partial eligibility (D-3381, Review Focus 2)', () => {
  const serverAsks = view(server(ask('v0.0.10')));

  it('fleet requested but unreachable: nothing moves, the server waits for the fleet', () => {
    const p = plan(view(fleet({ ...ask('v0.0.10'), reachable: false })), serverAsks);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[SERVER_ID, 'waiting-for-fleet']]);
  });

  it('fleet requested but refused: the fleet is noted, the server still waits until the fleet row is acked', () => {
    const p = plan(view(fleet({ ...ask('v0.0.10'), caps: W4_CAPS.filter((c) => c !== DETACH_CAP) })), serverAsks);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[FLEET_ID, 'no-detach-cap'], [SERVER_ID, 'waiting-for-fleet']]);
  });

  it('fleet requested and holding its own lease: nothing moves, the server waits', () => {
    const p = plan(view(fleet({ ...ask('v0.0.10'), updateState: 'pending', updateStartedAt: 5 })), serverAsks);
    expect(p.move).toBeNull();
    expect(p.gate.leaseHeldBy).toBe(FLEET_ID);
    expect(words(p)).toEqual([[SERVER_ID, 'waiting-for-fleet']]);
  });

  it('fleet requested and already there: its request is met on this run, the server waits one run', () => {
    const p = plan(view(fleet(ask('v0.0.9'))), serverAsks);
    expect(p.met).toEqual([{ nodeId: FLEET_ID, tag: 'v0.0.9' }]);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[SERVER_ID, 'waiting-for-fleet']]);
  });

  it('a fleet node with NO request never blocks: the server moves', () => {
    expect(plan(view(fleet({ desiredTag: 'v0.0.10' }), 'off'), serverAsks).move).toMatchObject({ nodeId: SERVER_ID });
  });

  it('a server-role node with its own refusal reports that refusal, not the wait', () => {
    const p = plan(view(fleet(ask('v0.0.10'))), view(server({ ...ask('v0.0.10'), caps: [] })));
    expect(words(p)).toEqual([[SERVER_ID, 'no-detach-cap']]);
  });
});

describe('planDispatch — an auto server move waits for a fleet row auto has not converged (D-3402)', () => {
  const serverAuto = view(server({ desiredTag: 'v0.0.10' }), 'stable');

  it('fleet auto-eligible but unreachable: nothing moves, the server waits for the fleet', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.10', reachable: false }), 'stable'), serverAuto);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[SERVER_ID, 'waiting-for-fleet']]);
  });

  it('fleet auto-eligible but refused no-update-gate: the fleet is noted, the gated server still waits', () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.10', caps: W4_CAPS.filter((c) => c !== UPDATE_GATE_CAP) }), 'stable'), serverAuto);
    expect(p.move).toBeNull();
    expect(words(p)).toEqual([[FLEET_ID, 'no-update-gate'], [SERVER_ID, 'waiting-for-fleet']]);
  });

  it('a converged fleet (desiredTag NULL) or a fleet whose own auto is off never holds it: the server auto-moves', () => {
    expect(plan(view(fleet(), 'stable'), serverAuto).move).toMatchObject({ nodeId: SERVER_ID, source: 'auto', viaLink: false });
    expect(plan(view(fleet({ desiredTag: 'v0.0.10' }), 'off'), serverAuto).move).toMatchObject({ nodeId: SERVER_ID, source: 'auto' });
  });

  it("an operator's request on the server is never held by the fleet's auto — only by a fleet request", () => {
    const p = plan(view(fleet({ desiredTag: 'v0.0.10', reachable: false }), 'stable'), view(server(ask('v0.0.10'))));
    expect(p.move).toMatchObject({ nodeId: SERVER_ID, source: 'request' });
    expect(p.refusals).toEqual([]);
  });
});

describe('deadlineExpired (spec §10: the later of updateStartedAt and reportedUpdatedAt)', () => {
  const D = 900_000;
  const busy = (o: Partial<DispatchRow>): DispatchRow => fleet({ updateState: 'pending', ...o });

  it('counts from updateStartedAt when the node never wrote a report — strictly after the deadline', () => {
    expect(deadlineExpired(busy({ updateStartedAt: 1_000 }), 1_000 + D - 1, D)).toBe(false);
    expect(deadlineExpired(busy({ updateStartedAt: 1_000 }), 1_000 + D, D)).toBe(false);
    expect(deadlineExpired(busy({ updateStartedAt: 1_000 }), 1_000 + D + 1, D)).toBe(true);
  });

  it('a later report extends it; an earlier one does not shorten it', () => {
    expect(deadlineExpired(busy({ updateStartedAt: 1_000, reportedUpdatedAt: 500_000 }), 1_000 + D + 1, D)).toBe(false);
    expect(deadlineExpired(busy({ updateStartedAt: 1_000, reportedUpdatedAt: 500_000 }), 500_000 + D + 1, D)).toBe(true);
    expect(deadlineExpired(busy({ updateStartedAt: 900, reportedUpdatedAt: 100 }), 900 + D - 1, D)).toBe(false);
  });

  it('a busy row that nothing ever dated is expired; a settled row never is', () => {
    expect(deadlineExpired(busy({ updateState: 'unknown' }), 0, D)).toBe(true);
    for (const s of ['idle', 'failed', 'reverted'] as UpdateState[]) {
      expect(deadlineExpired(fleet({ updateState: s, updateStartedAt: 0 }), 10 * D, D), s).toBe(false);
    }
    expect(DEADLINE_DETAIL).toBe('deadline');
  });
});

describe('dispatchRefusalDetail — one sentence per word, stable across runs (Review Focus 5)', () => {
  it('every word renders `<word> — …` naming the node and the tag', () => {
    const v = view(fleet({ label: 'fleet-box' }));
    for (const w of DISPATCH_REFUSALS) {
      const d = dispatchRefusalDetail(w, v, 'v0.0.10', { label: 'other-box', tag: 'v0.0.11' });
      expect(d.startsWith(`${w} — `), w).toBe(true);
      expect(d, w).toContain('fleet-box');
      expect(d, w).toContain('v0.0.10');
    }
  });

  it('the two blocker words name the blocker', () => {
    const v = view(server());
    expect(dispatchRefusalDetail('waiting-for-fleet', v, 'v0.0.10', { label: 'fleet', tag: 'v0.0.11' }))
      .toBe("waiting-for-fleet — fleet's request for v0.0.11 is outstanding — server moves to v0.0.10 after it is settled or acked");
    expect(dispatchRefusalDetail('waiting-for-fleet', v, 'v0.0.10', { label: 'fleet', tag: 'v0.0.11', auto: true }))
      .toBe("waiting-for-fleet — fleet's auto update to v0.0.11 has not landed — server moves to v0.0.10 after it does, or once that node's own auto is off");
    expect(dispatchRefusalDetail('halted', v, 'v0.0.10', { label: 'fleet', tag: null })).toContain('(fleet)');
  });

  it('planning the same refused rows twice renders byte-identical notes', () => {
    const nodes = [view(fleet({ ...ask('v0.0.10'), caps: [] })), view(server(ask('v0.0.10')))];
    expect(plan(...nodes).refusals).toEqual(plan(...nodes).refusals);
  });
});

describe('the ring (programme wave 5, D-3383)', () => {
  it('dispatch.ts imports only the three shared modules and the resolver — no fs, no store, no link, no Runner', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'update', 'dispatch.ts'), 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)]
      .map((m) => m[1] ?? m[2]);
    expect(new Set(specs)).toEqual(new Set([
      '../../../shared/api.js', '../../../shared/agent-protocol.js', '../../../shared/semver.js', './resolve.js',
    ]));
    expect(/\brequire\(|import\(/.test(src)).toBe(false);
  });
});

// NodeRow — what `nodes()` returns — satisfies DispatchRow structurally, so the act (Task 5) hands the store's
// rows straight in. A column renamed on either side is TS2322 here (typecheck-tests.test.ts compiles this file).
const _rowFits: DispatchRow = null as unknown as NodeRow;
void _rowFits;
```

- [ ] **Step 2: Write the failing single-definition edits (one line in place, one describe appended)**

In `server/test/single-definition.test.ts`, replace the `UPDATE_RING_FILES` declaration IN PLACE — match it by CONTENT and keep its leading whitespace (W2 Task 7's two-space indent inside the appended top-level describe). Replace

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts', 'notify.ts'];
```

with

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts', 'notify.ts', 'dispatch.ts'];
```

Then append after the file's last line (the closing `});` of the describe Task 1 appended). The block starts with a blank line:

```ts

// ── Programme wave 5 (design 2026-09-20 §9/§10): the dispatcher's words and order ──
// APPENDED after the file's last line: `session-hook.test.ts`'s citation audit
// cites this file by line, so nothing above may move (R13). No import is
// added either — the eleven words are stated here as a LITERAL, on purpose (the
// opposite of W2's `SQL_VOCABS`, which imports its arrays): `update-dispatch.test.ts` holds L0's array equal to
// this same list, and the fingerprint below must find shared/api.ts's array,
// so a word added on one side alone reds one of the two.
//
// THE FINGERPRINT is W2's SQL-tuple shape widened to brackets: two or more
// quoted members and nothing else, in any order, parenthesised OR bracketed —
// a copy from memory is as likely a `['halted', 'not-newer']` filter as an SQL
// `IN (…)`. A Record keyed by the type (dispatch.ts's sentences, the PWA's
// UPDATE_ERROR_TEXT) is braced, held exhaustive by the compiler, and is not a
// copy. KNOWN WIDTH: a list spelled across a spread or a template is not seen.
describe('the dispatcher refusal words and the dispatch order are declared once, in L0 (programme wave 5)', () => {
  const WORDS = [
    'unknown-tag', 'not-newer', 'refused-by-node', 'stamp-unread', 'floor-unread', 'no-detach-cap',
    'no-update-gate', 'no-rollback-cap', 'agent-predates-update-op', 'halted', 'waiting-for-fleet',
  ];
  const alt = `(?:${WORDS.map((w) => w.replace(/-/g, '\\-')).join('|')})`;
  const item = `\\s*['"]${alt}['"]\\s*`;
  const LIST = new RegExp(`\\(${item}(?:,${item})+,?\\s*\\)|\\[${item}(?:,${item})+,?\\s*\\]`);
  const DEF = /^\s*(?:export\s+)?(?:declare\s+)?(?:type\s+DispatchRefusal\b\s*(?:<[^>\n]*>)?\s*=|interface\s+DispatchRefusal\b)/m;
  const VALUE = /^\s*(?:export\s+)?(?:const|let|var)\s+DISPATCH_REFUSALS\b/m;
  const FNS = ['isDispatchRefusal', 'dispatchRank', 'compareDispatchOrder'] as const;

  it('CONTROL: the list fingerprint sees a copy in any order, either bracket, and nothing that is not one', () => {
    expect(LIST.test("if (['halted', 'not-newer'].includes(w))")).toBe(true);
    expect(LIST.test("WHERE why IN ( 'waiting-for-fleet', \"halted\" )")).toBe(true);
    expect(LIST.test("[\n  'no-detach-cap',\n  'no-rollback-cap',\n]")).toBe(true);
    expect(LIST.test("['halted']"), 'one word states no set').toBe(false);
    expect(LIST.test("['halted', 'busy']"), 'a non-member breaks the list').toBe(false);
    expect(LIST.test("{ 'not-newer': 'a', halted: 'b' }"), 'a keyed record is not a list').toBe(false);
    expect(LIST.test("moveRefusal(view, 'halted')"), 'an argument list with a non-literal').toBe(false);
  });

  it('declares DispatchRefusal once, in shared/api.ts', () => {
    expect(DEF.test("import {\n  type DispatchRefusal,\n} from '../../../shared/api.js';"), 'import specifier').toBe(false);
    expect(DEF.test("type DispatchRefusal = 'halted';"), 'un-exported local declaration').toBe(true);
    expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('defines the array, its guard, the rank and the comparator once, in shared/api.ts', () => {
    expect(ALL.filter((f) => VALUE.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
    for (const name of FNS) {
      const FN = new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
      expect(ALL.filter((f) => FN.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
  });

  it('no source across the four roots spells a second list of the words — shared/api.ts holds the one', () => {
    expect(ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });
});
```

Check the placement before running anything: `git diff -U0 server/test/single-definition.test.ts | grep '^@@'` → exactly two hunks, one `@@ -N +N @@` (the ring line, one for one) and one `@@ -M,0 +M+1,55 @@` whose `M` is the file's last line before this step. Any other hunk is an insert above a cited line — undo it.

- [ ] **Step 3: Run both red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-dispatch.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/update/dispatch.js' imported from …/server/test/update-dispatch.test.ts`, `Test Files  1 failed (1)`, `Tests  no tests` (measured).

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'programme wave 5'`
Expected: FAIL — `Tests  3 failed | 1 passed` (the rest skipped): "declares DispatchRefusal once, in shared/api.ts", "defines the array, its guard, the rank and the comparator once, in shared/api.ts" and "no source across the four roots spells a second list of the words — shared/api.ts holds the one", each `AssertionError: expected [] to deeply equal [ 'shared/api.ts' ]`; the CONTROL passes (measured).

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'update ring'`
Expected: FAIL in "covers the directory — absent means nothing expects it, present means every listed file is visited (never a skip)" with `dispatch.ts is listed but not on disk` (W2 Task 7's floor; not measurable on the scratch tree, which has no update ring — confirm the message on the merged tree).

- [ ] **Step 4: Append the L0 vocabulary and order to `shared/api.ts`**

Append after the file's last line — Task 1's `inFlightReport` closing `}` (match by content). No line above changes and no `import` is added; `NodeRole` is W2 Task 1's, already declared above in the same block:

```ts

/* ---------------------------------------------------------------------------
 * THE DISPATCHER'S VOCABULARY AND ORDER (design 2026-09-20 §9/§10; programme
 * wave 5, Task 4). Still inside the end-of-file update block (D-3188, ruling
 * R13): appended, so no line README or the session-hook audit cites moves.
 * `server/src/update/dispatch.ts` (L1) decides with these; the update routes
 * answer with the words; the PWA's move planner sorts with the comparator —
 * one spelling of each, which `single-definition.test.ts` holds.
 * ------------------------------------------------------------------------- */

/** Why the dispatcher did not move a node it considered (spec §9/§10). EVERY word is NON-halting: it is noted
 *  in `updateDetail` on an `idle` row (D-3375) and a standing request stays standing
 *  (decision 7). The routes answer every word but `no-update-gate` (auto only — a route writes a request, never
 *  auto) and `waiting-for-fleet` (the order, not a refusal of this node) as a single-node `409`. */
export const DISPATCH_REFUSALS = [
  'unknown-tag', 'not-newer', 'refused-by-node', 'stamp-unread', 'floor-unread', 'no-detach-cap',
  'no-update-gate', 'no-rollback-cap', 'agent-predates-update-op', 'halted', 'waiting-for-fleet',
] as const;
export type DispatchRefusal = (typeof DISPATCH_REFUSALS)[number];
/** Use THIS, never `DISPATCH_REFUSALS.includes(x as DispatchRefusal)` — `isRunState`'s rule. */
export function isDispatchRefusal(v: unknown): v is DispatchRefusal {
  return typeof v === 'string' && (DISPATCH_REFUSALS as readonly string[]).includes(v);
}

/** THE dispatch order's one spelling (spec §10's standing order: the server reads what the fleet host's hook
 *  writes, and the agent caches `ccd caps` at boot). `fleet` 0; `server` and `both` 1 — the box the server
 *  process runs on; `null`, a role token this build cannot name, 2 — last, so an unnamed row never jumps the
 *  fleet. */
export function dispatchRank(role: NodeRole | null): 0 | 1 | 2 {
  if (role === 'fleet') return 0;
  if (role === 'server' || role === 'both') return 1;
  return 2;
}

/** `dispatchRank`, then `label`, then `nodeId`, the last two by UTF-16 code unit — never `localeCompare`, whose
 *  answer follows the box's locale. The server's `planDispatch` and the PWA's `planMove` both sort with this, so
 *  a confirm sheet names the nodes in the order the dispatcher will move them. */
export function compareDispatchOrder(a: { role: NodeRole | null; label: string; nodeId: string }, b: { role: NodeRole | null; label: string; nodeId: string }): number {
  const rank = dispatchRank(a.role) - dispatchRank(b.role);
  if (rank !== 0) return rank;
  if (a.label !== b.label) return a.label < b.label ? -1 : 1;
  if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
  return 0;
}
```

- [ ] **Step 5: Write `server/src/update/dispatch.ts`**

```ts
// L1 — THE DISPATCHER'S DECISION (design 2026-09-20 §9/§10; programme wave 5,
// Task 4). Pure: rows in, a plan out — no fs, no store, no fastify, no link,
// no Runner, no timer, no clock (`now` is a parameter). `converge.ts` (L3,
// Task 5, D-3383) reads the rows, calls planDispatch,
// acquires the one lease with `dispatchNode` in the same synchronous stretch
// (D-3377) and sends the op; the update routes (Task 6) call
// `moveRefusal` for a single node's synchronous 409 — the dispatcher's own
// predicate, never a copy of it. Ring membership is a property of the import
// block below, and update-dispatch.test.ts pins it by reading it.
//
// EVERY TAG IS COMPARED BEHIND isReleaseTag: shared/semver.ts throws
// RangeError on a non-tag, and a row carries whatever an older build and a
// same-user writer left in it.
import {
  SETTLED_UPDATE_STATES, UPDATE_GATE_CAP, compareDispatchOrder, dispatchRank, isReleaseTag,
  type AutoMode, type DispatchRefusal, type NodeRole, type RequestKind, type StampRead, type TagFileRead, type UpdateChannel,
  type UpdateState,
} from '../../../shared/api.js';
import { UPDATE_OP } from '../../../shared/agent-protocol.js';
import { isNewerTag } from '../../../shared/semver.js';
import { floorOf, type EligibilityRow } from './resolve.js';

/** Wave 4's other two ccrc-caps words (`_inst_caps`; `detach` is Linux-only, decision 17). UPDATE_GATE_CAP is
 *  the third's one spelling (shared/api.ts, D-3305); these two have no reader outside this file. */
export const DETACH_CAP = 'detach';
export const ROLLBACK_CAP = 'rollback';
/** Spec §10, verbatim: the lease detail for an update to a node whose stamp reads but names no version. */
export const UNVERSIONED_DETAIL = 'unversioned box — any eligible release is newer';
/** The word W2's `sweepPlanFor` tests before it records a node's refusal of a release: a `failed` row whose
 *  detail begins with it is a verdict on the RELEASE, and does not halt (D-3378). */
export const PROVENANCE_DETAIL_PREFIX = 'provenance:';
/** Spec §10's `failed: deadline` — the detail `runDispatch` (Task 5) releases an expired lease with. */
export const DEADLINE_DETAIL = 'deadline';

/** The columns this module reads. `NodeRow` (coord/store.ts) satisfies it structurally — the consumer declares
 *  the port (L2), so this file never imports the store. `highestVersion` is `~/.ccrc/floor` (NULL = absent =
 *  unconstrained unless `floorRead` is `'unmeasured'` — W2 D-3213: never measured, refused `floor-unread` like the
 *  resolver's `floorUnmeasured`), otherwise read only through W2's `floorOf`. */
export interface DispatchRow {
  nodeId: string; role: NodeRole | null; label: string;
  currentVersion: string | null; highestVersion: string | null; floorRead: TagFileRead;
  stampRead: StampRead; caps: readonly string[]; agentOps: readonly string[] | null;
  reachable: boolean; updateState: UpdateState; updateTarget: string | null; updateStartedAt: number | null;
  updateDetail: string | null; reportedUpdatedAt: number | null;
  channel: UpdateChannel | null; desiredTag: string | null;
  requestedTag: string | null; requestedKind: RequestKind | null; requestedAt: number | null;
}
/** One live node as the dispatcher sees it: its row, the `auto` its intent resolved to, and the tags THIS node
 *  refused (decision 16 — another node's refusal is not an input). */
export interface DispatchNodeView { row: DispatchRow; auto: AutoMode; refusedTags: ReadonlySet<string> }
export interface DispatchInput { nodes: readonly DispatchNodeView[]; releases: readonly EligibilityRow[] }
/** `viaLink` = the row has an agent (`agentOps` not NULL) — the op rides the link; false = the server's own
 *  row, spawned locally (decision 11). */
export interface DispatchMove { nodeId: string; kind: RequestKind; target: string; source: 'request' | 'auto'; viaLink: boolean; detail: string }
export interface PlannedRefusal { nodeId: string; refusal: DispatchRefusal; detail: string }
export interface MetRequest { nodeId: string; tag: string }
/** Over the live rows: `haltedBy` every halting row's nodeId, in nodeId order; `leaseHeldBy` the first busy
 *  row's, or null. */
export interface FleetGate { haltedBy: string[]; leaseHeldBy: string | null }
export interface DispatchPlan {
  gate: FleetGate;
  /** null: nothing dispatchable — the reason is in gate / refusals / met. */
  move: DispatchMove | null;
  /** One per considered IDLE node refused, in compareDispatchOrder. A refused `failed`/`reverted` row is not
   *  listed: its updateDetail is the verdict the halt reads, and a note must never overwrite it (Review Focus 5). */
  refusals: PlannedRefusal[];
  /** D-3380 — an idle node already running its requested tag; settled by the act, never
   *  dispatched. */
  met: MetRequest[];
}
/** The row a refusal sentence names besides the node itself: the halting row, or the fleet row that holds a
 *  server-role node back — by its request, or, with `auto: true`, by the auto move it has not yet made
 *  (D-3402; `tag` is then its desiredTag). */
export interface RefusalBlocker { label: string; tag: string | null; auto?: true }

const SETTLED: readonly string[] = SETTLED_UPDATE_STATES;
/** Busy is NOT settled — W2's stance (`NOT IN SETTLED_UPDATE_SQL`), so `unknown` holds the lease. */
const isSettled = (s: UpdateState): boolean => SETTLED.includes(s);

/** A settled state other than `idle` halts dispatch until `ack` (spec §10) — derived from the settled list the
 *  way W2's store derives HALTED_UPDATE_STATES, so a settled state added later halts by default — EXCEPT a
 *  `failed` row whose detail begins PROVENANCE_DETAIL_PREFIX: a verdict on the release, not a fault of the node. */
export function isHalting(row: Pick<DispatchRow, 'updateState' | 'updateDetail'>): boolean {
  if (!isSettled(row.updateState) || row.updateState === 'idle') return false;
  if (row.updateState === 'failed' && row.updateDetail !== null && row.updateDetail.startsWith(PROVENANCE_DETAIL_PREFIX)) return false;
  return true;
}

const byNodeId = (a: DispatchRow, b: DispatchRow): number => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0);

export function fleetGate(rows: readonly DispatchRow[]): FleetGate {
  const sorted = [...rows].sort(byNodeId);
  return {
    haltedBy: sorted.filter(isHalting).map((r) => r.nodeId),
    leaseHeldBy: sorted.find((r) => !isSettled(r.updateState))?.nodeId ?? null,
  };
}

/** 'off' → false; 'stable' → the node resolved to stable; 'channel' → it resolved to any channel. */
export function autoPermits(auto: AutoMode, channel: UpdateChannel | null): boolean {
  switch (auto) {
    case 'off': return false;
    case 'stable': return channel === 'stable';
    case 'channel': return channel !== null;
    default: {
      const unhandled: never = auto;
      return unhandled;
    }
  }
}

/** What the node's version reads as. ONLY a stamp that read (`ok`) with no version is unversioned; a stamp that
 *  could not be read is never "unversioned" (D-3379; wave 3's D-3307 line). */
type Current = { kind: 'versioned'; tag: string } | { kind: 'unversioned' } | { kind: 'unread' };
function currentOf(row: Pick<DispatchRow, 'stampRead' | 'currentVersion'>): Current {
  if (row.stampRead !== 'ok') return { kind: 'unread' };
  if (row.currentVersion === null) return { kind: 'unversioned' };
  return isReleaseTag(row.currentVersion) ? { kind: 'versioned', tag: row.currentVersion } : { kind: 'unread' };
}

type Intended = { kind: RequestKind; target: string; source: 'request' | 'auto' };
/** A request outranks auto — the operator's tap is the stronger intent. A request this build cannot read (a
 *  kind token outside RequestKind reads null, D-3181) moves NOTHING and auto does not take over: the request
 *  stands until ack, like any other refusal of it (decision 7; D-3396). */
function intendedMove(v: DispatchNodeView): Intended | null {
  const r = v.row;
  if (r.requestedTag !== null) {
    return r.requestedKind !== null ? { kind: r.requestedKind, target: r.requestedTag, source: 'request' } : null;
  }
  if (autoPermits(v.auto, r.channel) && r.desiredTag !== null) return { kind: 'update', target: r.desiredTag, source: 'auto' };
  return null;
}

/** THE per-node predicate, shared with the routes (Task 6): the first refusal in this order, else null —
 *  halted; (update) stamp-unread, floor-unread — a floor never measured (W2 D-3213), not-newer — the target
 *  not strictly newer than the node's floor, W2's floorOf (D-3403); unknown-tag — for an update, no listed (bundleListed), unyanked
 *  releases row (spec §12's apply rule, D-3395); for a rollback, no releases row at all (yanked PERMITTED: rolling back
 *  to a yanked release is the point); refused-by-node (THIS node's refusals only, either kind,
 *  D-3394); no-detach-cap (every move rides `--detach`, the server's too);
 *  (rollback) no-rollback-cap; (auto) no-update-gate; and for a node reached over the link only (agentOps not
 *  NULL) agent-predates-update-op — the server's row, NULL by construction, is never checked for it
 *  (decision 11). The order is cheapest-and-most-general first: a halted fleet says so before any one node's
 *  capability does. */
export function moveRefusal(view: DispatchNodeView, move: { kind: RequestKind; target: string; source: 'request' | 'auto' }, releases: readonly EligibilityRow[], gate: FleetGate): DispatchRefusal | null {
  const row = view.row;
  if (gate.haltedBy.length > 0) return 'halted';
  const tagOk = isReleaseTag(move.target);
  const known = tagOk ? releases.find((r) => r.tag === move.target) : undefined;
  if (move.kind === 'update') {
    const cur = currentOf(row);
    if (cur.kind === 'unread') return 'stamp-unread';
    // W2 D-3213: a NULL floor never MEASURED (floorRead 'unmeasured') is not "no floor" — the resolver refuses it
    // before floorOf (`resolveOnChannel`), and so does this: a tag sent below a floor nobody read would be refused
    // by the node, and that failed row would halt the fleet (D-3403). D-3492
    if (row.highestVersion === null && row.floorRead === 'unmeasured') return 'floor-unread';
    // THE FLOOR (spec decision 8: a requested update "moves a node only to a strictly NEWER version than its
    // floor"; §10: the dispatcher "re-checks capabilities, direction and the floor"). W2's floorOf is the
    // resolver's own floor — the floor file's tag, or the running tag when that is higher (D-3202) or the file is
    // absent — so a versioned node is never sent a tag at or below what it runs, and a rolled-back node is never
    // sent one at or below its floor: its ccrc would refuse it (`_upd_floor_check`), and the `failed` row that
    // refusal leaves would halt every move in the fleet (D-3403). An unversioned node with
    // no floor has nothing to compare against: it is never "not newer" (spec §10). floorOf answers a tag or null.
    const floor = floorOf(row.highestVersion, row.currentVersion);
    if (tagOk && floor !== null && !isNewerTag(move.target, floor)) return 'not-newer';
    if (known === undefined || known.yanked || !known.bundleListed) return 'unknown-tag';
  } else if (known === undefined) {
    return 'unknown-tag';
  }
  if (view.refusedTags.has(move.target)) return 'refused-by-node';
  if (!row.caps.includes(DETACH_CAP)) return 'no-detach-cap';
  if (move.kind === 'rollback' && !row.caps.includes(ROLLBACK_CAP)) return 'no-rollback-cap';
  if (move.source === 'auto' && !row.caps.includes(UPDATE_GATE_CAP)) return 'no-update-gate';
  if (row.agentOps !== null && !row.agentOps.includes(UPDATE_OP)) return 'agent-predates-update-op';
  return null;
}

type Sentence = (row: DispatchRow, target: string, blocker: RefusalBlocker | null) => string;
/** One sentence per word; a Record over the type, so a word added to DISPATCH_REFUSALS without its sentence is a
 *  compile error. Each names the node's label and the tag, so a note read out of context still says whose. */
const REFUSAL_SENTENCE: Record<DispatchRefusal, Sentence> = {
  'unknown-tag': (r, t) =>
    `${t} is not a release ${r.label} can be moved to — an update needs a catalogue row listed with its provenance bundle and not yanked, a rollback a catalogue row`,
  'not-newer': (r, t) => {
    const floor = floorOf(r.highestVersion, r.currentVersion);
    return floor !== null && floor !== r.currentVersion
      ? `${t} is not newer than ${r.label}'s floor ${floor} (it runs ${r.currentVersion ?? 'an unversioned build'}) — pin a newer tag, or use rollback`
      : `${t} is not newer than ${r.label}'s ${r.currentVersion ?? 'version'} — moving a node down is a rollback`;
  },
  'refused-by-node': (r, t) =>
    `${r.label} refused ${t} on a provenance verdict — ack the node to clear the refusal`,
  'stamp-unread': (r, t) =>
    `${r.label}'s build stamp reads ${r.stampRead}, so its version is unknown — ${t} waits until the stamp reads`,
  'floor-unread': (r, t) =>
    `${r.label}'s floor has not been measured — ${t} waits until it is`,
  'no-detach-cap': (r, t) =>
    `${r.label}'s ccrc-caps has no ${DETACH_CAP} — its ccrc predates the one-tap, or it is macOS (decision 17); ${t} waits`,
  'no-update-gate': (r, t) =>
    `auto is on for ${r.label} but its ccrc-caps has no ${UPDATE_GATE_CAP}, so auto will not move it to ${t}; an operator request still can`,
  'no-rollback-cap': (r, t) =>
    `${r.label}'s ccrc-caps has no ${ROLLBACK_CAP} — its ccrc cannot roll back to ${t}`,
  'agent-predates-update-op': (r, t) =>
    `${r.label}'s agent does not advertise the ${UPDATE_OP} op — update its agent first; ${t} waits`,
  halted: (r, t, b) =>
    `a failed or reverted node${b === null ? '' : ` (${b.label})`} halts every move until it is acked — ${r.label} waits for ${t}`,
  'waiting-for-fleet': (r, t, b) =>
    b?.auto === true
      ? `${b.label}'s auto update to ${b.tag ?? 'a release'} has not landed — ${r.label} moves to ${t} after it does, or once that node's own auto is off`
      : `${b?.label ?? 'a fleet node'}'s request for ${b?.tag ?? 'a release'} is outstanding — ${r.label} moves to ${t} after it is settled or acked`,
};

/** `${refusal} — ${sentence}`. `blocker` names the halting row (halted) or the fleet row holding a server-role
 *  node back (waiting-for-fleet); every other word ignores it. Deterministic, so a refusal re-planned every run
 *  renders the same text and `noteDispatchRefusal` writes it once (Review Focus 5). */
export function dispatchRefusalDetail(refusal: DispatchRefusal, view: DispatchNodeView, target: string, blocker: RefusalBlocker | null = null): string {
  return `${refusal} — ${REFUSAL_SENTENCE[refusal](view.row, target, blocker)}`;
}

/** Busy AND (neither timestamp set — a lease nothing ever dated, bounded all the same — OR now − max(
 *  updateStartedAt, reportedUpdatedAt) > deadlineMs). Both columns are epoch ms (W2's validator converted the
 *  report's seconds once). A settled row never expires. */
export function deadlineExpired(row: Pick<DispatchRow, 'updateState' | 'updateStartedAt' | 'reportedUpdatedAt'>, now: number, deadlineMs: number): boolean {
  if (isSettled(row.updateState)) return false;
  const marks = [row.updateStartedAt, row.reportedUpdatedAt].filter((t): t is number => t !== null);
  if (marks.length === 0) return true;
  return now - Math.max(...marks) > deadlineMs;
}

function moveDetail(row: DispatchRow, m: Intended): string {
  const cur = currentOf(row);
  if (m.kind === 'update' && cur.kind === 'unversioned') return UNVERSIONED_DETAIL;
  const from = cur.kind === 'versioned' ? cur.tag : cur.kind === 'unversioned' ? 'an unversioned build' : 'an unread stamp';
  return `${m.source === 'auto' ? 'auto' : 'requested'} ${m.kind} from ${from} to ${m.target}`;
}

/** Pure. Considered = live (the store's `nodes()` returns no other), reachable, settled rows with a request, or
 *  with auto permitting and a desiredTag. For each, in compareDispatchOrder: a request an IDLE row already runs
 *  is `met`; otherwise moveRefusal decides, and a node it clears whose rank is not fleet's (1 or 2) is deferred
 *  `waiting-for-fleet` while any live fleet-role row holds a request — whatever that row's state or
 *  reachability (D-3381) — and, when its own move is AUTO, while any live fleet-role row
 *  is one auto has not converged: auto permits it and it has a desiredTag (a converged row's is NULL), whatever
 *  its state, reachability or refusal (D-3402; a request is never held by it). The
 *  move is the first cleared node, unless a lease is held (one node at a time, fleet-wide); a cleared node after
 *  it waits its turn un-noted. */
export function planDispatch(input: DispatchInput): DispatchPlan {
  const gate = fleetGate(input.nodes.map((v) => v.row));
  const ordered = [...input.nodes].sort((a, b) => compareDispatchOrder(a.row, b.row));
  const fleetAsk = ordered.find((v) => dispatchRank(v.row.role) === 0 && v.row.requestedTag !== null) ?? null;
  const fleetAuto = ordered.find((v) =>
    dispatchRank(v.row.role) === 0 && autoPermits(v.auto, v.row.channel) && v.row.desiredTag !== null) ?? null;
  const haltedRow = gate.haltedBy.length > 0 ? ordered.find((v) => v.row.nodeId === gate.haltedBy[0]) ?? null : null;
  const met: MetRequest[] = [];
  const refusals: PlannedRefusal[] = [];
  let move: DispatchMove | null = null;
  for (const v of ordered) {
    const row = v.row;
    if (!isSettled(row.updateState) || !row.reachable) continue;
    const m = intendedMove(v);
    if (m === null) continue;
    if (m.source === 'request' && row.updateState === 'idle' && row.stampRead === 'ok' && row.currentVersion === m.target) {
      met.push({ nodeId: row.nodeId, tag: m.target });
      continue;
    }
    let refusal = moveRefusal(v, m, input.releases, gate);
    let blocker: RefusalBlocker | null = refusal === 'halted' && haltedRow !== null ? { label: haltedRow.row.label, tag: null } : null;
    if (refusal === null && dispatchRank(row.role) !== 0) {
      if (fleetAsk !== null) {
        refusal = 'waiting-for-fleet';
        blocker = { label: fleetAsk.row.label, tag: fleetAsk.row.requestedTag };
      } else if (m.source === 'auto' && fleetAuto !== null) {
        refusal = 'waiting-for-fleet';
        blocker = { label: fleetAuto.row.label, tag: fleetAuto.row.desiredTag, auto: true };
      }
    }
    if (refusal !== null) {
      if (row.updateState === 'idle') {
        refusals.push({ nodeId: row.nodeId, refusal, detail: dispatchRefusalDetail(refusal, v, m.target, blocker) });
      }
      continue;
    }
    if (move === null && gate.leaseHeldBy === null) {
      move = { nodeId: row.nodeId, kind: m.kind, target: m.target, source: m.source, viaLink: row.agentOps !== null, detail: moveDetail(row, m) };
    }
  }
  return { gate, move, refusals, met };
}
```

Three facts about the text, each held by a scan that runs in Step 6: it quotes no `'update-gate'` (wave 3's one-holder scan — the gate word arrives through `UPDATE_GATE_CAP`, including inside the sentences' template literals); it holds no parenthesised or bracketed list of two or more quoted words of any W2 vocabulary (W2 Task 1's SQL-tuple scans) or of the eleven refusal words (Step 2's scan — `REFUSAL_SENTENCE` is a braced `Record`, held exhaustive by the compiler); and it contains no copy of the tag regex source (W2's "spells the tag shape once"). Measured over the text above with W2's `tupleOf` fingerprint for all twelve vocabularies (`SQL_VOCABS`, TagFileRead included — W2 D-3213): zero hits.

- [ ] **Step 6: Run green — the new file, the scans, the citation audit, the compilers**

Run, one at a time, foreground, from `server/`:
- `./node_modules/.bin/vitest run test/update-dispatch.test.ts` → `Tests  64 passed (64)` (measured on the stand-in tree: 57 before review, plus the fleet-auto / server-request order case, the two floor cases and the four auto-hold cases)
- `./node_modules/.bin/vitest run test/single-definition.test.ts` → PASS, every case; `-t 'programme wave 5'` alone → `4 passed` (measured); the update ring's three cases green with `dispatch.ts` on disk and free of `node:sqlite`, a `db.js` import and a handle reach
- `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` → `13 passed` (measured on the scratch tree as `13 passed | 320 skipped (333)`): `shared/api.ts` and `single-definition.test.ts` took appends and one one-for-one line only, so no cited line moved (R13). `session-hook` is a named load flake — a red is re-run in isolation before it is read
- `./node_modules/.bin/vitest run test/update-resolve.test.ts test/update-states.test.ts test/peers-claims-l0.test.ts` → PASS, counts unchanged (this task edits none of their subjects' existing lines)
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` → no output (measured on the scratch tree); `./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean'` → PASS — this is the gate that checks `_rowFits` (NodeRow satisfies DispatchRow) and the `Record<DispatchRefusal, Sentence>` exhaustiveness; on the scratch tree, with `NodeRow` stood in, the file compiled clean under `test/tsconfig.tests.json` plus `types: ['node']`
- `cd ../pwa && npm ci && npm run build` → exit 0 (`shared/api.ts` is bundled under `noUnusedLocals`; everything appended is exported)

- [ ] **Step 7: Mutation measurements (restore each by copying back the Step 4/5 text — never `git checkout --`; the sentinel is `git diff --stat` showing only this task's files)**

Each was measured on the scratch tree with exactly the code above, running `./node_modules/.bin/vitest run test/update-dispatch.test.ts` unless another command is named.

| # | §18 row / focus | Edit (in `server/src/update/dispatch.ts` unless named) | Measured red |
|---|---|---|---|
| 1 | "fleet before server" | `const ordered = [...input.nodes].sort((a, b) => compareDispatchOrder(a.row, b.row));` → `const ordered = [...input.nodes];` | 1: "a fleet AUTO move and a server REQUEST, the server first on the wire: the fleet moves, the server waits its turn un-noted". Only this case: a fleet REQUEST defers the server whatever the order (D-3381), and so does an unconverged fleet AUTO row for an auto server move (D-3402) — which is why the case pairs a fleet auto move with a server request, the one shape no deferral covers |
| 2 | "`failed` halts dispatch" | first line of `isHalting` → `return false;` | 5: "reverted and failed halt; idle and every busy state do not", "a failed row whose detail BEGINS provenance: does not halt — only the prefix counts", "fleetGate names the halting rows by nodeId and the first busy row — `unknown` holds the lease", "a failed row halts every move, and every requested idle row is noted halted, naming the halting node", "a reverted row halts too" |
| 3 | "a provenance refusal does not halt" | delete the line `if (row.updateState === 'failed' && … startsWith(PROVENANCE_DETAIL_PREFIX)) return false;` | 3: "a failed row whose detail BEGINS provenance: …", "fleetGate names the halting rows …", "a provenance-failed row halts nothing, and is itself eligible to a newer tag it has not refused" |
| 4 | "every capability refusal is in the dispatcher" | delete `if (!row.caps.includes(DETACH_CAP)) return 'no-detach-cap';` | 5: "no detach word: no-detach-cap, for either kind, on the server row too", "every word but waiting-for-fleet is reachable from moveRefusal alone", "the order of the checks: …", "fleet requested but refused: …", "a server-role node with its own refusal reports that refusal, not the wait" |
| 5 | "the server row is never refused for `agentOps`" | `row.agentOps !== null && !row.agentOps.includes(UPDATE_OP)` → `!(row.agentOps ?? []).includes(UPDATE_OP)` | 15 (10 before review — the auto-hold and order cases move or defer the server too), "the server row (agentOps NULL) is never refused for agentOps (§18)" among them, with every case that moves or defers the server |
| 6 | "an agent without the op is never sent it" | delete the `agent-predates-update-op` line | 2: "a link-reached row whose agent advertises nothing is agent-predates-update-op (…)", "every word but waiting-for-fleet is reachable from moveRefusal alone" |
| 7a | "`apply` refuses an older tag…" — `not-newer` removed | delete the `not-newer` line (`if (tagOk && floor !== null && …) return 'not-newer';`) | 6: "an update below the running tag is not-newer — never met", "by the comparator, not the text: …", "every word but waiting-for-fleet is reachable …", "the order of the checks: …", "a rolled-back node: an update at or below its FLOOR is not-newer …", "an unversioned node WITH a floor is not-newer at or below it …" |
| 7b | same row — the NULL arm refuses | `if (cur.kind === 'unread') return 'stamp-unread';` → `if (cur.kind !== 'versioned') return 'stamp-unread';` | 3: "an unversioned node (stamp read, no version, no floor) is never "not newer" and moves with the spec's detail", "an update needs a listed, unyanked row with its bundle — else unknown-tag", "an unversioned node WITH a floor is not-newer at or below it …" |
| 7c | decision 8's floor (D-3403) | `const floor = floorOf(row.highestVersion, row.currentVersion);` → `const floor = cur.kind === 'versioned' ? cur.tag : null;` (the running tag alone — the pre-review rule) | 2: "a rolled-back node: an update at or below its FLOOR is not-newer …", "an unversioned node WITH a floor is not-newer at or below it …" |
| 7d | W2 D-3213's unmeasured floor, its own word `floor-unread` (D-3492) | delete `if (row.highestVersion === null && row.floorRead === 'unmeasured') return 'floor-unread';` | 2: "an unversioned node WITH a floor is not-newer at or below it; with none it is never not-newer (D-3403)", "every word but waiting-for-fleet is reachable from moveRefusal alone" (its `floor-unread` entry) (NOT measured — added when re-pointed onto W2's tip; measure before relying on it) |
| 8 | "`auto` needs the gate cap, at dispatch time" (planner half) | delete the `no-update-gate` line | 4: "auto on a node whose caps lack the gate word is refused no-update-gate (…)", "the server row under auto without the gate word is no-update-gate — …", "every word but waiting-for-fleet …", "the order of the checks: …" |
| 9 | D-3381 (Review Focus 2) | `      if (fleetAsk !== null) {` → `      if (false) {` | 5: "two requested nodes: the fleet node moves, the server waits for it and says so" and the four "fleet requested …" partial-eligibility cases |
| 9b | D-3402 (Review Focus 2) | `      } else if (m.source === 'auto' && fleetAuto !== null) {` → `      } else if (false) {` | 3: "two AUTO-eligible nodes, the server first on the wire: … waits for its auto move …", "fleet auto-eligible but unreachable: …", "fleet auto-eligible but refused no-update-gate: …" |
| 9c | the auto hold never holds a request | drop `m.source === 'auto' && ` from the same line | 2: "an operator's request on the server is never held by the fleet's auto — only by a fleet request", "a fleet AUTO move and a server REQUEST, the server first on the wire: …" (the server's request is noted `waiting-for-fleet` instead of waiting its turn un-noted) |
| 10 | D-3380 (Review Focus 1) | the met `if (…)` → `if (false)` | 3: "an update requested at the running tag is met, …", "a rollback requested at the running tag is met too", "fleet requested and already there: …" |
| 10b | met only on an idle row | drop `row.updateState === 'idle' && ` from the met condition | 1: "met needs an idle row whose stamp read: a halted row and an unread stamp are never met" |
| 11 | Review Focus 5 (planner half) | `if (row.updateState === 'idle') {` before `refusals.push` → `if (true) {` | 1: "a provenance-failed row whose standing request names the refused tag: no move, NEVER noted, auto does not take over" |
| 12 | deadline strictly after | `> deadlineMs` → `>= deadlineMs` | 1: "counts from updateStartedAt when the node never wrote a report — strictly after the deadline" |
| 13 | "the deadline bounds a node that never wrote" (planner half) | `if (marks.length === 0) return true;` → `return false;` | 1: "a busy row that nothing ever dated is expired; a settled row never is" |
| 13b | the later of the two marks | `[row.updateStartedAt, row.reportedUpdatedAt]` → `[row.updateStartedAt]` | 1: "a later report extends it; an earlier one does not shorten it" |
| 14 | "`rollback` is catalogue-gated" — yanked permitted | `} else if (known === undefined) {` → `} else if (known === undefined || known.yanked) {` | 6, "to a yanked release moves — rolling back to a yanked release is the point" first |
| 15 | the ring (D-3383) | add `import { readFileSync } from 'node:fs'; void readFileSync;` after the `./resolve.js` import | 1: "dispatch.ts imports only the three shared modules and the resolver — …" |
| 16 | "`unknown` is busy" (planner half) | in `shared/api.ts`, move `'unknown'` from `BUSY_UPDATE_STATES` to `SETTLED_UPDATE_STATES` | 4 here: "reverted and failed halt; …", "fleetGate names …", "a busy row anywhere holds the one lease: …", "a busy row that nothing ever dated is expired; …" (W2's `update-states.test.ts` reds as well) |
| 17 | "vocabularies are declared once" | create `pwa/src/mut-dispatch-words.ts` = `export const HOLD = ['waiting-for-fleet', 'halted'];` and `server/src/mut-dispatch-type.ts` = `export type DispatchRefusal = 'halted';` + `export function compareDispatchOrder(): number { return 0; }`; run `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'programme wave 5'` (names WITHOUT a `__` prefix — `sources()` skips those) | 3: the three holder cases, `expected [ 'shared/api.ts', …(1) ] to deeply equal [ 'shared/api.ts' ]` (the second naming `compareDispatchOrder:`). `rm` both files; re-run → `4 passed` |
| 18 | the literal is chained to L0 | in `shared/api.ts`, add `'on-fire',` after `'waiting-for-fleet',` in `DISPATCH_REFUSALS` only | `single-definition … -t 'programme wave 5'` → 1: "no source across the four roots spells a second list …" (the fingerprint no longer recognises the array); `update-dispatch.test.ts` → 2: "DISPATCH_REFUSALS is the eleven words, in order, with no duplicate", "every word renders `<word> — …` naming the node and the tag" — and `tsc` refuses `REFUSAL_SENTENCE` (the Record lacks `'on-fire'`) |

- [ ] **Step 8: Residue check and commit**

From the worktree root (CORRECTED: the paths are repo-root-relative, so a `git add` run inside `server/` fails on `server/shared/api.ts`):

```bash
git add shared/api.ts server/src/update/dispatch.ts server/test/update-dispatch.test.ts server/test/single-definition.test.ts
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)   # → PASS (two files are added)
git commit -m "feat(update): the dispatcher's decision, L1 — planDispatch (met, halt, fleet-first order, one lease), moveRefusal shared with the routes, deadlineExpired; DISPATCH_REFUSALS and compareDispatchOrder declared once in L0"
```


### Task 5: The dispatcher's act

**Files:**
- Modify: `server/src/update/dispatch.ts` — `AGENT_REJECTED_DETAIL`, `OpAnswer`, `AnswerAction`, `classifyOpAnswer` (and two module-private sentences and one private helper) APPENDED after the file's last line (Task 4's `planDispatch` and whatever follows it); the file's `'../../../shared/agent-protocol.js'` import (Task 4 takes `UPDATE_OP` from it) gains `firstStderrLine, isUpdateOpError, type UpdateOpError` in place — names added to an EXISTING specifier, so the file keeps Task 4's four specifiers (`'../../../shared/api.js'`, `'../../../shared/agent-protocol.js'`, `'../../../shared/semver.js'`, type-only `'./resolve.js'`) and Task 4's ring case in `update-dispatch.test.ts` (a `Set` equality over exactly those four) stays green unedited. `shared/agent-protocol.ts` is L0: after Task 1 it imports `./buildinfo.js` (types) and `./api.js` (`isReleaseTag`, `isRequestKind`, `type RequestKind`) — shared modules only, no `node:*` — so the file stays L1
- Create: `server/src/update/converge.ts` — L3 (D-3383); imports `node:path`, `'../../../shared/api.js'`, `'../../../shared/agent-protocol.js'`, `'./dispatch.js'`, `'./resolve.js'`, `'./project.js'` (`resolveInputFor`), `'./inventory.js'` (`INVENTORY_BUDGET_MS`, `readNodeFile` — W2 Task 11's bounded node-file reader), `'../pools.js'` (`openPoolReadDeadline`, exported by W2 Task 10), `'../remote/client.js'` (`AgentOpError`), and type-only `'../exec.js'` (`ExecResult`, `Runner`), `'../io.js'` (`FleetIO`), `'../fleetstate.js'` (`FleetState`), `'../coord/store.js'` (row and result types). No `node:sqlite`, no `db.js`, no `store.db`/`coord.db` reach (the update-ring scan)
- Modify: `server/src/watch.ts` — one import line directly after W2 Task 12's `import { resolveAndProject, type ProjectionOutcome } from './update/project.js';`; two private fields directly after wave 3's `  private inventorySwept = false;`; `dispatchNow()`, `triggerDispatch()` and the private `dispatchOnce()` directly after W2 Task 11's `triggerInventory()` (its closing `  }`); ONE call site at the end of `sweepThenProject`, between wave 3's `    this.pushRelease(now);` and `    return outcomes;` (quoted), `this.triggerDispatch();` under a two-line comment. `watch.ts` is cited by no document in the session-hook audit's corpus (W2 Task 12 measured it), so the inserts need not be line-neutral
- Modify: `server/src/server.ts` — one import line `import type { LocalUpdateSpawn, SendUpdateOp } from './update/converge.js';` directly after W2 Task 13's `import { registerUpdateRoutes } from './update/routes.js';`; `Deps` gains `updateRunner?: LocalUpdateSpawn;` and `sendUpdateOp?: SendUpdateOp;`, each with its docstring, directly after W2 Task 13's `  updateIntentLog?: UpdateIntentLog;` (quoted). CORRECTED: `updateRunner` is NOT a raw `Runner` (D-3397)
- Modify: `server/src/index.ts` — two import lines directly after `import { readLocalCcdCaps } from './localcaps.js';` (`:20` at `d759c914`): `import { localUpdateSpawnFor } from './update/converge.js';` and `import { UPDATE_OP_TIMEOUT_MS } from '../../shared/agent-protocol.js';`; in BOTH `deps` literals, on the line after W2 Task 13's `    updateIntentLog,`, `    updateRunner: localUpdateSpawnFor(realRunner, cfg.home),`; in the REMOTE literal only, the line after that, `    sendUpdateOp: (tag, kind) => fleet.client.request({ t: 'req', op: 'update', tag, kind }, UPDATE_OP_TIMEOUT_MS),`. CORRECTED: the skeleton's `fleetClient.request({ op: 'update', tag, kind }, …)` does not compile — `FleetClient.request`'s payload is `Omit<AgentReq-member, 'id'>` and keeps `t: 'req'` (every existing caller passes it: `client.ts:238` at the W2 tip (Task 1's inserts above `FleetClient` move it again; re-locate by the quoted text), `this.request({ t: 'req', op: 'caps' })`), and W2's hoisted `fleetClient` is `FleetClient | null` while `fleet.client` is the non-null value in scope in that arm
- Modify: `server/test/single-definition.test.ts` — the ONE `UPDATE_RING_FILES` line (as Task 4 leaves it, ending `'notify.ts', 'dispatch.ts'];`) gains `'converge.ts'` IN PLACE — one line replaced by one line (R13; census 8 unchanged)
- Test: `server/test/update-op-answer.test.ts` (create) — `classifyOpAnswer`'s whole table. CORRECTED from "appended to `update-dispatch.test.ts`": a new file adds no import line to a file Task 4 owns
- Test: `server/test/update-converge.test.ts` (create) — `runDispatch` end to end over a real `CoordStore` on an `mkTmp` `coord.db`, a recording `SendUpdateOp`, a recording `Runner` behind `localUpdateSpawnFor`, a fixture `FleetState`; the `FleetWatcher` single-flight and sweep trigger; a source scan of `converge.ts`; a text pin over `index.ts` (the W2 Task 13 idiom); a type pin that a raw `Runner` is not a `Deps['updateRunner']`
- Run, not edited: `server/test/update-dispatch.test.ts` (Task 4's table and its four-specifier ring case stay green), `server/test/lifecycle-sweep.test.ts` (it counts `setInterval(` in `watch.ts` — this task's `watch.ts` inserts add no timer; the one new `setTimeout` is `converge.ts`'s), `server/test/update-store-dispatch.test.ts` (Task 3), `server/test/update-inventory.test.ts`, `server/test/update-projection.test.ts`, `server/test/update-routes.test.ts` (W2's watcher paths now end in a dispatch run with nothing to move), `server/test/push-copy.test.ts` (wave 3's `sweepThenProject` call sites), `server/test/readiness.test.ts`, `server/test/readiness-sweep.test.ts` (they drive `tick()`), `server/test/boot.test.ts` (boots `index.ts` in local mode), `server/test/ccdargv-brand.test.ts` (`Deps` still carries no `run`), `server/test/single-definition.test.ts`, `server/test/session-hook.test.ts` (R13), `server/test/typecheck-tests.test.ts`, `./node_modules/.bin/tsc --noEmit -p .`, `server/test/topology-clean.test.ts` (after `git add`)

**Interfaces:**
- Consumes: Task 3's `requestNode`, `dispatchNode`, `noteDispatchRefusal` and their result types; W2's `releaseLease`, `settleNode`, `refuseRelease`, `markUnreachable`, `upsertNodeMeasurement`, `applyReleaseListing`, `nodes()`, `node()`, `releases()`, `refusalsFor()`, `intentFor()`, `updateEpoch()` (Tasks 4–6), `NodeRow`, `ReleaseRow`, `RefusalRow`, `UpdateIntentRow`, `NodeMeasurement`, `ReleaseListingRow`; `resolveInputFor` (W2 Task 12, `project.ts` — its store parameter is `Omit<ProjectStore, 'resolveNode' | 'nodes'>`, which INCLUDES `updateEpoch()`), `resolveNodeIntent` (`resolve.ts`); `SERVER_LABEL`, `FLEET_LABEL`, `sweepPlanFor`, `SweepPlan` (W2 Task 11, tests); `FleetWatcher.inventoryNow()`/`triggerInventory()` (Task 11), `sweepThenProject` as wave 3 leaves it (its tail `this.inventorySwept = true;` / `this.pushRelease(now);` / `return outcomes;`), wave 3's `private inventorySwept = false;`; `cfg.role`, `cfg.home`, `cfg.ccrcDir`, `cfg.updateDeadlineMs` (W2 Task 9); `FleetState.connected`, `FleetState.agentOps?: readonly string[]` (W2 Task 8 — `undefined` before any `ready`); Task 4's `planDispatch`, `deadlineExpired`, `dispatchRefusalDetail`, `DEADLINE_DETAIL`, `DispatchMove`, `DispatchNodeView`, `DispatchPlan`; Task 1's `UPDATE_OP`, `UPDATE_OP_ERRORS`, `UpdateOpError`, `isUpdateOpError`, `UPDATE_OP_TIMEOUT_MS`, `UPDATE_SPAWN_TIMEOUT_MS`, `updateLauncherPath`, `updateSpawnArgv`, `firstStderrLine`, `inFlightReport`, `InFlightReport`, `AgentOpError`; `NODE_FILES.report` (W2 Task 8); `Runner`, `ExecResult`, `realRunner` (`exec.ts:40-69` at `d759c914`); `FleetIO` (`lstatMeasured`/`statMeasured`/`readFileMeasured`, `io.ts:127-135` at `d759c914` — reached only through `readNodeFile`); `readNodeFile(io, filePath, deadline)`, `NodeFileRead` and `INVENTORY_BUDGET_MS` (W2 Task 11, `inventory.ts`: lstat to `regular` only, size ≤ `NODE_FILE_CAP_BYTES`, every step raced against the deadline); `openPoolReadDeadline` (W2 Task 10, `pools.ts`); W2's `ackNode` (tests only); `FleetClient.request(payload, timeoutMs?, signal?)` (`client.ts:176-209` at `d759c914`; a transport failure rejects a plain `Error('disconnected' | 'timeout' | 'aborted')`, `:178`, `:180`, `:191`, `:197`, `:233`, `:419`; a late `res` whose entry timed out is dropped at `:289-290`, `const entry = this.pending.get(id); if (!entry) return;` — W2 Task 8's and Task 1's inserts above `FleetClient` move every one of these, so re-locate by the quoted text); `testDeps`, `mkTmp`.
- Produces (in `server/src/update/dispatch.ts`, pure):

```ts
export const AGENT_REJECTED_DETAIL = 'agent rejected the update op';   // spec §10, verbatim — halting
export type OpAnswer =
  | { kind: 'accepted' }
  | { kind: 'refused'; err: string; detail: string | null }            // an AgentOpError's words, or the local spawn's non-zero exit as 'spawn-failed'
  | { kind: 'transport'; why: 'disconnected' | 'timeout' | 'aborted' | 'other'; message: string };
export type AnswerAction =
  | { kind: 'hold'; detail: string }                                    // accepted: the lease stands; never idle (D-3382)
  | { kind: 'release'; to: 'idle' | 'failed'; detail: string };
/** `advertised` = the LIVE FleetState.agentOps includes UPDATE_OP at answer time (true for a local spawn).
 *  accepted → hold; busy → idle `busy — <detail>`; bad-request & advertised → failed AGENT_REJECTED_DETAIL;
 *  bad-request & !advertised → idle `agent-predates-update-op — …`; bad-tag / bad-kind → failed
 *  `agent refused the op: <err>`; spawn-failed → failed `spawn-failed — <detail>`; any other word → failed
 *  `agent answered <err>`; transport → idle `<why> — the node dropped mid-dispatch; the request stands`
 *  (`other` carries its message in place of that clause). Every node-supplied word passes firstStderrLine
 *  before it is stored. Exhaustive over UpdateOpError (a `never` arm). */
export function classifyOpAnswer(a: OpAnswer, advertised: boolean): AnswerAction;
```

- Produces (in `server/src/update/converge.ts`) — CORRECTED against the skeleton in five places, each marked:

```ts
export type SendUpdateOp = (tag: string, kind: RequestKind) => Promise<ResOk>;
/** CORRECTED (D-3397): the server-role spawn as a two-template CAPABILITY, not a raw Runner. */
export type LocalUpdateSpawn = (kind: RequestKind, tag: string) => Promise<ExecResult>;
/** The composition-root factory (`ccdRunner`'s idiom, `lifecycle.ts`): run(updateLauncherPath(home), updateSpawnArgv(kind, tag)).
 *  A non-tag or non-kind throws RangeError synchronously, before `run` is called. */
export function localUpdateSpawnFor(run: Runner, home: string): LocalUpdateSpawn;
/** The store port (L2, declared by the consumer); CoordStore satisfies it. CORRECTED: + updateEpoch(), which
 *  resolveInputFor's parameter type requires. */
export interface ConvergeStore {
  nodes(): NodeRow[]; releases(): ReleaseRow[]; refusalsFor(nodeId: string): RefusalRow[];
  intentFor(scope: string): UpdateIntentRow | null; updateEpoch(): { epoch: number; issuedAt: number };
  dispatchNode(nodeId: string, target: string, kind: RequestKind, startedAt: number, detail: string): DispatchNodeResult;
  releaseLease(nodeId: string, to: SettledUpdateState, detail: string, reportStartedAt: number | null): ReleaseLeaseResult;
  settleNode(nodeId: string, detail: string, reportStartedAt: number | null): SettleNodeResult;
  noteDispatchRefusal(nodeId: string, detail: string): NoteDispatchRefusalResult;
}
/** CORRECTED: no `home` (the spawn capability carries it); runLocal is a LocalUpdateSpawn. */
export interface ConvergeDeps {
  store: ConvergeStore; role: NodeRole; ccrcDir: string; localIo: FleetIO; deadlineMs: number;
  fleet: { state: FleetState; send: SendUpdateOp } | null;      // null in local mode or with no link wired
  runLocal: LocalUpdateSpawn | null;                             // null → a server-row move is noted NO_LOCAL_RUNNER_DETAIL, no lease
  onAccepted: () => void;                                        // FleetWatcher.triggerInventory
}
export const NO_FLEET_LINK_DETAIL: string;     // 'disconnected — no fleet link is wired on this server; the request stands'
export const LINK_DOWN_DETAIL: string;         // 'disconnected — the fleet link is down; the request stands'
export const NO_LOCAL_RUNNER_DETAIL: string;   // 'no local runner — this server was started without an update spawner; the request stands'
export const OK_WITHOUT_ACCEPTED = 'ok-without-accepted';   // D-3399
export const SPAWN_TIMEOUT_MESSAGE: string;    // `the --detach parent did not exit within ${UPDATE_SPAWN_TIMEOUT_MS} ms`
export const LOCAL_SPAWNING_DETAIL: string;    // 'an update op is already spawning on this server' — D-3400
/** The busy sentence — the same words Task 2's agent sends for an in-flight report. */
export function inFlightSentence(r: InFlightReport): string;
/** The ONE builder of the dispatcher's views (Task 6's routes call it too). */
export function dispatchViewsFor(store: Omit<ConvergeStore, 'dispatchNode' | 'releaseLease' | 'settleNode' | 'noteDispatchRefusal'>): DispatchNodeView[];
/** CORRECTED: + 'not-sent' (a move that cannot be sent takes no lease) and 'release-refused' (the store refused the release). */
export type MoveOutcome =
  | { nodeId: string; result: 'accepted'; detail: string }
  | { nodeId: string; result: 'released'; to: 'idle' | 'failed'; detail: string }
  | { nodeId: string; result: 'release-refused'; to: 'idle' | 'failed'; detail: string; why: Extract<ReleaseLeaseResult, { ok: false }>['why'] }
  | { nodeId: string; result: 'not-sent'; detail: string }
  | { nodeId: string; result: 'acquire-refused'; why: Extract<DispatchNodeResult, { ok: false }>['why'] };
export type DispatchRunResult =
  | { ran: false; why: 'no-coord' | 'not-server-role' }
  | { ran: true; expired: string[]; settled: string[]; noted: number; plan: DispatchPlan; outcome: MoveOutcome | null };
/** In order, in ONE synchronous stretch: role gate; (1) every busy row deadlineExpired → releaseLease(id, 'failed',
 *  DEADLINE_DETAIL, null); (2) planDispatch({ nodes: dispatchViewsFor(store), releases: store.releases() }); (3) each
 *  met → settleNode(id, `met: ${tag}`, null); (4) each refusal → noteDispatchRefusal; (5) CORRECTED — a move that
 *  cannot be sent (no link wired, link down, the LIVE agentOps lacking the op D-3398, no local
 *  spawner) is noted and takes no lease; (6) dispatchNode(…, now, move.detail). THEN await: viaLink → fleet.send;
 *  else the server-role busy read (D-3384, bounded through readNodeFile), the spawn gate
 *  (D-3400) and runLocal raced against UPDATE_SPAWN_TIMEOUT_MS; classifyOpAnswer → hold
 *  (onAccepted()) or releaseLease(id, to, detail, null). */
export async function runDispatch(deps: ConvergeDeps, now: number): Promise<DispatchRunResult>;

// server/src/watch.ts — FleetWatcher gains:
dispatchNow(): Promise<DispatchRunResult>;   // single-flight: joins the run in flight and asks for ONE follow-up; else starts one synchronously
triggerDispatch(): void;                     // void this.dispatchNow().catch(warn) — warned, never a silent catch D-3493
private dispatchRun: Promise<DispatchRunResult> | null;
private dispatchAgain: boolean;
private dispatchOnce(): Promise<DispatchRunResult>;   // ADDED: the one builder of ConvergeDeps from Deps; 'no-coord' without deps.coord
// server/src/server.ts — Deps gains:
updateRunner?: LocalUpdateSpawn;   // CORRECTED from Runner — localUpdateSpawnFor(realRunner, cfg.home) in index.ts, both arms
sendUpdateOp?: SendUpdateOp;       // remote arm only: fleet.client.request({ t: 'req', op: 'update', tag, kind }, UPDATE_OP_TIMEOUT_MS)
```

- Cases (spec §10 Pins, end to end), in `update-converge.test.ts` unless named: two requested nodes with `auto = 'off'` → one op per run, fleet first, the server row noted and not spawned; a run while the fleet lease is held moves nobody (`gate.leaseHeldBy`); the server node dispatched on the run after W2's sweep settles the fleet node (a `done` report through `sweepPlanFor` → `settleNode`); the other way out of D-3381 — a fleet request refused `no-detach-cap` holds the server until W2's `ackNode` clears it, and the next run moves the server; `accepted` never settles (row `pending`, `requestedTag` standing, `onAccepted` once); the row reads `pending` while the report says `installing` and a report `updatedAt` inside the deadline keeps the lease (D-3382); `busy` → `idle` with the node's detail, request standing, re-sent on the next run only and never halting; `bad-request` with live `agentOps: ['update']` → `failed` `agent rejected the update op` and the next run is halted, and once `ackNode` returns the row to `idle` the run after it is not halted and moves the server; `bad-request` after the live ops dropped mid-dispatch → `idle` with the skew detail, and not re-sent once the row is re-measured with `agentOps: []`; `bad-tag` → `failed`; a local `spawn-failed` carrying the lock sentence → `failed` with the first stderr line; an ok reply without `accepted: true` → `failed` (D-3399); `disconnected` during the send → `idle`, not sent while the sweep marks the node unreachable, sent again once it is measured reachable; a send rejected `timeout`, then the node converging out of band → the next run settles `met: v0.0.10` and sends nothing (Review Focus 1); a row whose `agentOps` is `[]` gets no frame; a row that advertises the op while the LIVE state does not (or has no `ready` yet) gets no frame and no lease (D-3398), and is sent the op on the next run once a `ready` names it; a link that is down gets no frame and no lease, and is sent it on the next run once the link is back; no link wired at all (`fleet: null`) → noted `NO_FLEET_LINK_DETAIL`, no lease; no local spawner → noted, no lease; `role: 'fleet'` → `{ran: false, why: 'not-server-role'}`; the deadline from `updateStartedAt` with no report (`−1` stands, `+1` → `failed` `deadline`, the request standing, the server not spawned); the server row spawns through `localUpdateSpawnFor` with exactly `[<home>/.local/bin/ccrc, ['update','--to','v0.0.10','--detach','--from','pwa']]` and never through `sendUpdateOp`; `localUpdateSpawnFor` throws `RangeError` on `'; rm -rf ~'` before running anything; a server-role in-flight `update.json` → `idle` `busy — update.json says installing …`, nothing spawned (D-3384); a FIFO planted at the server's `update.json` never blocks the run — W2's `readNodeFile` refuses it as not regular, so the run completes and the spawn is the node's `_upd_lock`'s to decide; a spawn that never exits → `idle` `timeout — …` exactly at `UPDATE_SPAWN_TIMEOUT_MS` (fake timers), a run while that parent is still alive answers `busy — an update op is already spawning on this server` and spawns nothing, its late exit writes nothing, and the run after the exit spawns again (Review Focus 4, D-3400); a refused node re-planned twice → one note (Review Focus 5); a provenance-failed server row does not halt the fleet node's dispatch and its verdict is never overwritten; `dispatchViewsFor` carries the resolved `auto` and this node's refused tags; a source scan finds no `await` between the role gate and `.dispatchNode(` in `runDispatch` (D-3377); `FleetWatcher`: an inventory run ends in one dispatch run; a run's acquire lands in the caller's turn, two triggers during it → exactly one follow-up; no `coord` → `no-coord`; `index.ts` binds `updateRunner` in both arms and `sendUpdateOp` in the remote one; a raw `Runner` is not assignable to `Deps['updateRunner']`. In `update-op-answer.test.ts`: `classifyOpAnswer` over every `UpdateOpError` word × `advertised`, `bad-request` × `advertised`, an unknown word, each transport `why`, a missing detail, an unprintable multi-line detail.
- Spec §18 rows pinned: "a one-tap is a row" (M2), "a refusal does not consume the request" (M4), "a refusal releases in the same turn" (M3), "the deadline bounds a node that never wrote" (M5), "`accepted` does not settle" (M1), "`bad-request` from an advertising agent halts" (M6), "one dispatch per sweep" (the act half — M8, M9), "an agent without the op is never sent it" (end to end — M7 for this task's live re-check, M16 for the no-link-wired arm; Task 4's planner mutation also reds this file's `agentOps: []` case). Review Focus 1, 3 (the server side's bounded busy read, M19), 4 (the bound M11, and the spawn gate D-3400 M17–M18), 5.

- [ ] **Step 1: Measure the producers on the merged tree before writing anything**

W2, wave 3, wave 4 and Tasks 1–4 are on the branch. From the workspace root, run each and compare:

```bash
grep -n "^    this.pushRelease(now);$" server/src/watch.ts
grep -n -A1 "^    this.pushRelease(now);$" server/src/watch.ts | tail -n1
grep -n "^  private inventorySwept = false;$" server/src/watch.ts
grep -n "^  triggerInventory(): void {$" server/src/watch.ts
grep -n "^import { resolveAndProject, type ProjectionOutcome } from './update/project.js';$" server/src/watch.ts
grep -n "^  updateIntentLog?: UpdateIntentLog;$" server/src/server.ts
grep -n "^import { registerUpdateRoutes } from './update/routes.js';$" server/src/server.ts
grep -c "^    updateIntentLog,$" server/src/index.ts
grep -n "^import { readLocalCcdCaps } from './localcaps.js';$" server/src/index.ts
grep -n "const UPDATE_RING_FILES" server/test/single-definition.test.ts
grep -n "^import" server/src/update/dispatch.ts
grep -n "^export function planDispatch\|^export function deadlineExpired\|^export function dispatchRefusalDetail\|^export const DEADLINE_DETAIL" server/src/update/dispatch.ts
grep -n "agent-protocol" server/test/update-dispatch.test.ts
grep -n "^export class AgentOpError" server/src/remote/client.ts
grep -n "^export function inFlightReport\|^export interface InFlightReport" shared/api.ts
grep -n "^export function updateSpawnArgv\|^export function updateLauncherPath\|^export const UPDATE_SPAWN_TIMEOUT_MS\|^export const UPDATE_OP_TIMEOUT_MS\|^export const UPDATE_OP_ERRORS" shared/agent-protocol.ts
grep -n "^  requestNode(\|^  dispatchNode(\|^  noteDispatchRefusal(" server/src/coord/store.ts
```

Expected: one hit each for the `grep -n` lines; the `-A1 … | tail -n1` line prints `    return outcomes;` (the pushRelease call is the last statement before `sweepThenProject`'s return); `grep -c … index.ts` prints `2`; `UPDATE_RING_FILES` is one line ending `'notify.ts', 'dispatch.ts'];`; `dispatch.ts`'s import block names `'../../../shared/api.js'`, `'../../../shared/semver.js'`, `'./resolve.js'` (type-only) and — for `UPDATE_OP` — `'../../../shared/agent-protocol.js'`, the last as the one line `import { UPDATE_OP } from '../../../shared/agent-protocol.js';`; the `update-dispatch.test.ts` grep shows two hits, its own `import { UPDATE_OP } from '../../shared/agent-protocol.js';` and the ring case's expected `Set`, which already names `'../../../shared/agent-protocol.js'` beside the other three (Task 4 wrote it with four). Any other answer means a producer landed differently: stop and report the difference rather than place code relative to a line that is not there.

- [ ] **Step 2: Write the failing answer-mapping test**

Create `server/test/update-op-answer.test.ts`:

```ts
// Design 2026-09-20 §10 — `classifyOpAnswer` (server/src/update/dispatch.ts, L1): what ONE op's answer does
// to the lease the dispatcher holds. Pure: an answer and whether the agent advertises the op, in; `hold` or
// release-to-a-state, out. The act (`converge.ts`) applies it; `update-converge.test.ts` pins that end to end.
//
// The `Record<UpdateOpError, …>` below is the test's half of D-3370: a word added to
// UPDATE_OP_ERRORS without a row here is a compile error (typecheck-tests.test.ts compiles this directory), and
// the dispatcher's own `never` arm makes it one in `dispatch.ts` too.
import { describe, expect, it } from 'vitest';
import { UPDATE_OP_ERRORS, type UpdateOpError } from '../../shared/agent-protocol.js';
import { AGENT_REJECTED_DETAIL, classifyOpAnswer, type AnswerAction, type OpAnswer } from '../src/update/dispatch.js';

const refused = (err: string, detail: string | null = null): OpAnswer => ({ kind: 'refused', err, detail });
const LOCK = 'update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)';

describe('classifyOpAnswer — accepted never settles (§18 "`accepted` does not settle")', () => {
  it.each([true, false])('accepted HOLDS the lease (advertised=%s) — only the sweep settles it', (advertised) => {
    expect(classifyOpAnswer({ kind: 'accepted' }, advertised))
      .toEqual({ kind: 'hold', detail: 'accepted — the node queued a detached run' });
  });
});

describe('classifyOpAnswer — every UpdateOpError word (D-3370)', () => {
  const EXPECTED: Record<UpdateOpError, AnswerAction> = {
    'bad-tag': { kind: 'release', to: 'failed', detail: 'agent refused the op: bad-tag' },
    'bad-kind': { kind: 'release', to: 'failed', detail: 'agent refused the op: bad-kind' },
    busy: { kind: 'release', to: 'idle', detail: `busy — ${LOCK}` },
    'spawn-failed': { kind: 'release', to: 'failed', detail: `spawn-failed — ${LOCK}` },
  };

  it('has a row for exactly the words the op answers with', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...UPDATE_OP_ERRORS].sort());
  });

  for (const err of UPDATE_OP_ERRORS) {
    for (const advertised of [true, false]) {
      it(`${err} (advertised=${advertised}) — busy never halts; bad-tag, bad-kind and spawn-failed do`, () => {
        expect(classifyOpAnswer(refused(err, LOCK), advertised)).toEqual(EXPECTED[err]);
      });
    }
  }

  it('a missing detail reads as its own words, never an empty dash', () => {
    expect(classifyOpAnswer(refused('busy'), true))
      .toEqual({ kind: 'release', to: 'idle', detail: 'busy — the node gave no detail' });
    expect(classifyOpAnswer(refused('spawn-failed'), true))
      .toEqual({ kind: 'release', to: 'failed', detail: 'spawn-failed — no message' });
  });

  it('a node-supplied detail is stored as ONE printable line (firstStderrLine)', () => {
    // Task 1's rule: a run outside 0x20–0x7E becomes ONE space — so the NUL between the two words is the space.
    expect(classifyOpAnswer(refused('spawn-failed', 'first\u0000line\nsecond line'), true))
      .toEqual({ kind: 'release', to: 'failed', detail: 'spawn-failed — first line' });
  });
});

describe('classifyOpAnswer — bad-request (§18 "`bad-request` from an advertising agent halts")', () => {
  it('from an agent that ADVERTISES the op: failed, the spec\'s sentence — halting', () => {
    expect(AGENT_REJECTED_DETAIL).toBe('agent rejected the update op');
    expect(classifyOpAnswer(refused('bad-request'), true))
      .toEqual({ kind: 'release', to: 'failed', detail: AGENT_REJECTED_DETAIL });
  });

  it('from an agent that does not: idle, the version-skew sentence — the request stands', () => {
    expect(classifyOpAnswer(refused('bad-request'), false)).toEqual({
      kind: 'release', to: 'idle',
      detail: 'agent-predates-update-op — the agent answered bad-request and does not advertise the update op; the request stands',
    });
  });
});

describe('classifyOpAnswer — any other word, and the transport', () => {
  it.each([true, false])('a word outside the vocabulary is failed and named (advertised=%s)', (advertised) => {
    expect(classifyOpAnswer(refused('forbidden'), advertised))
      .toEqual({ kind: 'release', to: 'failed', detail: 'agent answered forbidden' });
    expect(classifyOpAnswer(refused('ok-without-accepted'), advertised))
      .toEqual({ kind: 'release', to: 'failed', detail: 'agent answered ok-without-accepted' });
  });

  it.each(['disconnected', 'timeout', 'aborted'] as const)('%s is idle — the node said nothing, so the request stands', (why) => {
    expect(classifyOpAnswer({ kind: 'transport', why, message: why }, true))
      .toEqual({ kind: 'release', to: 'idle', detail: `${why} — the node dropped mid-dispatch; the request stands` });
  });

  it('other carries its own message, cut to one printable line', () => {
    expect(classifyOpAnswer({ kind: 'transport', why: 'other', message: 'EPIPE\nstack' }, true))
      .toEqual({ kind: 'release', to: 'idle', detail: 'other — EPIPE; the request stands' });
  });
});
```

- [ ] **Step 3: Run it red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-op-answer.test.ts`
Expected: FAIL — every case but "has a row for exactly the words the op answers with" (which compares the test's own record with Task 1's array) fails with `TypeError: … classifyOpAnswer is not a function`; "from an agent that ADVERTISES the op" first fails on `expected undefined to be 'agent rejected the update op'`. 20 of 21 red.

- [ ] **Step 4: Implement `classifyOpAnswer` in `server/src/update/dispatch.ts`**

In the file's import block, the import from `'../../../shared/agent-protocol.js'` (Task 4's, which carries `UPDATE_OP`) gains three names in place, so it reads (order of Task 4's own names kept):

```ts
import { UPDATE_OP, firstStderrLine, isUpdateOpError, type UpdateOpError } from '../../../shared/agent-protocol.js';
```

No specifier is added, so Task 4's ring case in `update-dispatch.test.ts` (its `Set` of the four specifiers) is not edited. `shared/agent-protocol.ts` imports only shared modules (`./buildinfo.js` types, and Task 1's `./api.js` line), so the file stays L1.

Append after the file's last line:

```ts

// ── the op's answer (wave 5, Task 5) ─────────────────────────────────────────

/** Spec §10, verbatim: the words a HALTING `failed` carries when an agent that ADVERTISES the op still answered
 *  `bad-request` — it has the op and refused this frame, which only a server-side bug produces. */
export const AGENT_REJECTED_DETAIL = 'agent rejected the update op';
const ACCEPTED_DETAIL = 'accepted — the node queued a detached run';
const SKEW_DETAIL =
  `agent-predates-update-op — the agent answered bad-request and does not advertise the ${UPDATE_OP} op; the request stands`;

/** What came back from ONE op: the agent's reply over the link, or the server-role spawn's exit. `refused` is a
 *  word the NODE said (an AgentOpError, or a non-zero local exit as `spawn-failed`); `transport` is the link or
 *  the spawn failing to answer at all — never a word the node said. */
export type OpAnswer =
  | { kind: 'accepted' }
  | { kind: 'refused'; err: string; detail: string | null }
  | { kind: 'transport'; why: 'disconnected' | 'timeout' | 'aborted' | 'other'; message: string };

/** What the act does to the lease it holds. `hold` writes nothing: only the inventory sweep (or a met request)
 *  settles a lease, so the row reads `pending` until then (D-3382). */
export type AnswerAction =
  | { kind: 'hold'; detail: string }
  | { kind: 'release'; to: 'idle' | 'failed'; detail: string };

/** A node-supplied word or detail, as ONE printable line of at most UPDATE_OP_DETAIL_MAX characters — the row's
 *  `updateDetail` is rendered on the PWA and must not carry a second line, a control byte or a megabyte. */
const said = (text: string | null, none: string): string => (text === null ? none : firstStderrLine(text));

/**
 * THE ANSWER MAPPING (spec §10). `advertised` is whether the LIVE `FleetState.agentOps` names the op when the
 * answer arrives (always `true` for the server-role spawn): an agent that advertises the op and still answers
 * `bad-request` HALTS, one that does not is version skew and waits. `busy` and every transport failure release
 * the lease `idle` with the request standing (decision 7: a refusal never consumes it); `bad-tag`, `bad-kind`,
 * `spawn-failed` and any word this build cannot name release it `failed`, which halts until `ack`.
 * Exhaustive over `UpdateOpError`: a word added to UPDATE_OP_ERRORS and not here is a compile error at the
 * `never` below (D-3370).
 */
export function classifyOpAnswer(a: OpAnswer, advertised: boolean): AnswerAction {
  if (a.kind === 'accepted') return { kind: 'hold', detail: ACCEPTED_DETAIL };
  if (a.kind === 'transport') {
    const what = a.why === 'other' ? said(a.message, 'no message') : 'the node dropped mid-dispatch';
    return { kind: 'release', to: 'idle', detail: `${a.why} — ${what}; the request stands` };
  }
  if (a.err === 'bad-request') {
    return advertised
      ? { kind: 'release', to: 'failed', detail: AGENT_REJECTED_DETAIL }
      : { kind: 'release', to: 'idle', detail: SKEW_DETAIL };
  }
  if (!isUpdateOpError(a.err)) return { kind: 'release', to: 'failed', detail: `agent answered ${said(a.err, 'no word')}` };
  const err: UpdateOpError = a.err;
  switch (err) {
    case 'busy': return { kind: 'release', to: 'idle', detail: `busy — ${said(a.detail, 'the node gave no detail')}` };
    case 'bad-tag':
    case 'bad-kind': return { kind: 'release', to: 'failed', detail: `agent refused the op: ${err}` };
    case 'spawn-failed': return { kind: 'release', to: 'failed', detail: `spawn-failed — ${said(a.detail, 'no message')}` };
    default: {
      const unhandled: never = err;
      return unhandled;
    }
  }
}
```

- [ ] **Step 5: Run it green, and Task 4's file**

Run, from `server/`, foreground, one at a time:
- `./node_modules/.bin/vitest run test/update-op-answer.test.ts` — Expected: PASS (21 cases).
- `./node_modules/.bin/vitest run test/update-dispatch.test.ts` — Expected: PASS; its import-block assertion reads the four specifiers.
- `./node_modules/.bin/tsc --noEmit -p .` — Expected: exit 0.

- [ ] **Step 6: Write the failing act test**

Create `server/test/update-converge.test.ts`:

```ts
// Design 2026-09-20 §10 — the dispatcher's ACT (`runDispatch`, server/src/update/converge.ts) end to end, over
// a real CoordStore on an `mkTmp` coord.db: the lease is acquired by Task 3's real `dispatchNode`, the op is
// "sent" through a recording SendUpdateOp, the server-role node is spawned through `localUpdateSpawnFor` over a
// recording Runner, and every settle and release is W2's own writers — including the sweep's, driven through
// W2's `sweepPlanFor` in the sweep's own order. Nothing here reads the live $HOME, spawns a real `ccrc` or
// talks to a real agent: the link is a function, the spawn is a recorder, the node files live under a fixture
// HOME.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UPDATE_SPAWN_TIMEOUT_MS, type ResOk } from '../../shared/agent-protocol.js';
import type { NodeRole, RequestKind } from '../../shared/api.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import { realRunner, type ExecResult, type Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import { localIO, type FleetIO } from '../src/io.js';
import { AgentOpError } from '../src/remote/client.js';
import type { Deps } from '../src/server.js';
import {
  LINK_DOWN_DETAIL, LOCAL_SPAWNING_DETAIL, NO_FLEET_LINK_DETAIL, NO_LOCAL_RUNNER_DETAIL, SPAWN_TIMEOUT_MESSAGE,
  dispatchViewsFor, inFlightSentence, localUpdateSpawnFor, runDispatch,
  type ConvergeDeps, type DispatchRunResult, type LocalUpdateSpawn, type SendUpdateOp,
} from '../src/update/converge.js';
import { AGENT_REJECTED_DETAIL, DEADLINE_DETAIL } from '../src/update/dispatch.js';
import { FLEET_LABEL, SERVER_LABEL, sweepPlanFor, type SweepPlan } from '../src/update/inventory.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const DEADLINE = 900_000;
const FLEET_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const SERVER_ID = '05050505-0505-4505-8505-050505050505';
const ACCEPTED: ResOk = { t: 'res', id: 1, ok: true, accepted: true };
const LAUNCHER_ARGV = ['update', '--to', 'v0.0.10', '--detach', '--from', 'pwa'];
const IN_FLIGHT = 'update.json says installing (target v0.0.10, started 1790000000)';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const url = (tag: string): string => `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`;
const rel = (tag: string, publishedAt: number): ReleaseListingRow => ({
  tag, channel: 'stable', publishedAt, commitSha: null, tarballUrl: url(tag), bundleListed: true, notes: null, draft: false,
});
const seedReleases = (store: CoordStore): void => {
  expect(store.applyReleaseListing([rel('v0.0.8', T0 - 3000), rel('v0.0.9', T0 - 2000), rel('v0.0.10', T0 - 1000)],
    T0 - 500, 'complete').ok).toBe(true);
};

/** A clean fleet-node measurement: link-reached (its agentOps names the op), every cap both argvs need. */
const fleetMeas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'update-json', 'detach', 'rollback'], agentOps: ['update'],
  highestVersion: 'v0.0.9', previousVersion: 'v0.0.8', floorRead: 'measured', previousRead: 'measured', os: 'linux', measuredAt: T0, report: null, ...over,
});
/** The server's own row: spawned locally, `agentOps` NULL by construction (decision 11). */
const serverMeas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement =>
  fleetMeas({ nodeId: SERVER_ID, role: 'server', label: SERVER_LABEL, agentOps: null, ...over });

/** What W2's inventory sweep does with ONE measurement, in its own order (`applyMeasurement`: plan against the
 *  pre-upsert row → upsert → refuse → lease), through W2's own writers — so a lease this task acquired is
 *  settled or released by the same plan and the same writers production uses. TWO differences, deliberate. It skips `applyMeasurement`'s collision check, its re-key and its read-state overrides (the unmeasured floor/previous/report carries and the stamp-unmeasured report restore): every measurement below is fully read, with `stampRead: 'ok'`, into an existing UUID row, so none of them would fire. And the
 *  writers' `reportStartedAt` is passed `null` here (`latestStartOf` is private to `inventory.ts`), so the
 *  store's precedence guard is not exercised by this file — W2's `update-inventory.test.ts` and
 *  `update-store-nodes.test.ts` pin it, and every report below starts after the lease it reports on. */
const sweepOnce = (store: CoordStore, m: NodeMeasurement): SweepPlan => {
  const plan = sweepPlanFor(store.node(m.nodeId), m);
  expect(store.upsertNodeMeasurement(m).ok).toBe(true);
  if (plan.refuse !== null) store.refuseRelease(m.nodeId, plan.refuse.tag, m.measuredAt, plan.refuse.detail);
  if (plan.lease.kind === 'settle') store.settleNode(m.nodeId, plan.lease.detail, null);
  if (plan.lease.kind === 'release') store.releaseLease(m.nodeId, plan.lease.to, plan.lease.detail, null);
  return plan;
};

interface Harness {
  store: CoordStore; home: string; state: FleetState; deps: ConvergeDeps;
  sent: { tag: string; kind: RequestKind }[]; spawned: { cmd: string; args: string[] }[]; accepted: () => number;
}

/** A fixture coord.db with three listed stable releases, a connected link whose live agentOps names the op, a
 *  recording send (default: accepted) and a recording Runner behind `localUpdateSpawnFor` (default: exit 0). */
function harness(o: {
  send?: SendUpdateOp; run?: Runner; noLocal?: true; agentOps?: readonly string[]; role?: NodeRole; localIo?: FleetIO;
} = {}): Harness {
  const home = mkTmp('update-converge-');
  const store = new CoordStore(openCoordDb(path.join(home, 'coord.db')));
  seedReleases(store);
  const sent: Harness['sent'] = [];
  const spawned: Harness['spawned'] = [];
  const state: FleetState = {
    connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, agentOps: o.agentOps ?? ['update'],
  };
  let accepted = 0;
  const send: SendUpdateOp = o.send ?? (async () => ACCEPTED);
  const run: Runner = o.run ?? (async (): Promise<ExecResult> => ({ code: 0, stdout: '', stderr: '' }));
  const recording: Runner = (cmd, args) => { spawned.push({ cmd, args }); return run(cmd, args); };
  const deps: ConvergeDeps = {
    store, role: o.role ?? 'server', ccrcDir: path.join(home, '.ccrc'), localIo: o.localIo ?? localIO,
    deadlineMs: DEADLINE,
    fleet: { state, send: (tag, kind) => { sent.push({ tag, kind }); return send(tag, kind); } },
    runLocal: o.noLocal === true ? null : localUpdateSpawnFor(recording, home),
    onAccepted: () => { accepted += 1; },
  };
  return { store, home, state, deps, sent, spawned, accepted: () => accepted };
}

const seedFleet = (h: Harness, tag: string | null = 'v0.0.10', over: Partial<NodeMeasurement> = {}): void => {
  expect(h.store.upsertNodeMeasurement(fleetMeas(over)).ok).toBe(true);
  if (tag !== null) expect(h.store.requestNode(FLEET_ID, tag, 'update', T0).ok).toBe(true);
};
const seedServer = (h: Harness, tag: string | null = 'v0.0.10', over: Partial<NodeMeasurement> = {}): void => {
  expect(h.store.upsertNodeMeasurement(serverMeas(over)).ok).toBe(true);
  if (tag !== null) expect(h.store.requestNode(SERVER_ID, tag, 'update', T0).ok).toBe(true);
};

type Ran = Extract<DispatchRunResult, { ran: true }>;
const ran = (r: DispatchRunResult): Ran => {
  if (!r.ran) throw new Error(`the dispatch run did not run: ${r.why}`);
  return r;
};

/** A local io whose update.json answers `absent` at once — no fs promise between the acquire and the spawn. The busy
 *  read goes through W2's `readNodeFile`, whose FIRST call is `lstatMeasured`, so that is the one that must answer. */
const absentIo: FleetIO = {
  ...localIO,
  lstatMeasured: async () => ({ ok: false, reason: 'absent' }),
  readFileMeasured: async () => ({ ok: false, reason: 'absent' }),
};

describe('runDispatch — one node at a time, fleet first (spec §10 Pins)', () => {
  it('two requested nodes: ONE op per run, the fleet node first; the server node moves only after W2\'s sweep settles the fleet node (§18 "one dispatch per sweep", "fleet before server")', async () => {
    const h = harness();
    seedFleet(h);
    seedServer(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(h.spawned).toEqual([]);
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: 'v0.0.10' });

    // The lease is held: a second run moves nobody, however many nodes are waiting.
    const r2 = ran(await runDispatch(h.deps, T0 + 2000));
    expect(r2.outcome).toBeNull();
    expect(r2.plan.gate.leaseHeldBy).toBe(FLEET_ID);
    expect(h.sent).toHaveLength(1);
    expect(h.spawned).toEqual([]);

    // The sweep sees `done` with the stamp at the target and settles the fleet row — W2's writer, not ours.
    const swept = sweepOnce(h.store, fleetMeas({
      currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: T0 + 60_000,
      report: { phase: 'done', target: 'v0.0.10', startedAt: T0 + 6000, updatedAt: T0 + 50_000, detail: null },
    }));
    expect(swept.lease.kind).toBe('settle');
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', requestedTag: null });

    const r3 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r3.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    expect(h.sent).toHaveLength(1);   // the server node is never sent the op over the link
  });

  it('a fleet request the dispatcher refuses holds the server until W2\'s ackNode clears it; the next run moves the server (D-3381, the acked way out)', async () => {
    const h = harness();
    seedFleet(h, 'v0.0.10', { caps: ['verify', 'node-id', 'floor', 'update-json'] });
    seedServer(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toBeNull();
    expect(h.spawned).toEqual([]);
    expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^no-detach-cap — /);
    expect(h.store.node(SERVER_ID)?.updateDetail).toMatch(/^waiting-for-fleet — /);
    expect(h.store.ackNode(FLEET_ID).ok).toBe(true);
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r2.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    expect(h.sent).toEqual([]);
  });

  it('accepted HOLDS the lease: the row stays pending with its request, and the inventory is asked once (§18 "`accepted` does not settle", "a one-tap is a row")', async () => {
    const h = harness();
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'accepted', detail: 'accepted — the node queued a detached run' });
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: T0 + 1000,
      requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: T0,
    });
    expect(h.accepted()).toBe(1);
  });

  it('the row reads pending while the report says installing, and a report updatedAt inside the deadline keeps the lease (D-3382)', async () => {
    const h = harness();
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    const swept = sweepOnce(h.store, fleetMeas({
      measuredAt: T0 + DEADLINE,
      report: { phase: 'installing', target: 'v0.0.10', startedAt: T0 + 6000, updatedAt: T0 + DEADLINE - 4000, detail: 'placing the tree' },
    }));
    expect(swept.lease.kind).toBe('none');
    const r = ran(await runDispatch(h.deps, T0 + 1000 + DEADLINE + 1));
    expect(r.expired).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', reportedPhase: 'installing' });
  });
});

describe('runDispatch — the answer decides only what happens to the lease (§18 "a refusal releases in the same turn", "a refusal does not consume the request")', () => {
  it('busy → idle in the same run, with what the node said; the request stands; re-sent on the NEXT run only, never halting (Review Focus 3)', async () => {
    const h = harness({ send: async () => { throw new AgentOpError('busy', IN_FLIGHT); } });
    seedFleet(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toEqual({ nodeId: FLEET_ID, result: 'released', to: 'idle', detail: `busy — ${IN_FLIGHT}` });
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: `busy — ${IN_FLIGHT}`, requestedTag: 'v0.0.10', requestedKind: 'update',
    });
    expect(h.sent).toHaveLength(1);
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(h.sent).toHaveLength(2);
    expect(r2.plan.gate.haltedBy).toEqual([]);
    expect(h.store.node(FLEET_ID)?.updateState).toBe('idle');
    expect(h.accepted()).toBe(0);
  });

  it('bad-request from an agent whose LIVE ops name the op → failed, the spec\'s sentence, and the next run is halted (§18 "`bad-request` from an advertising agent halts")', async () => {
    const h = harness({ send: async () => { throw new AgentOpError('bad-request', null); } });
    seedFleet(h);
    seedServer(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toEqual({ nodeId: FLEET_ID, result: 'released', to: 'failed', detail: AGENT_REJECTED_DETAIL });
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: AGENT_REJECTED_DETAIL, requestedTag: 'v0.0.10' });
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r2.outcome).toBeNull();
    expect(r2.plan.gate.haltedBy).toEqual([FLEET_ID]);
    expect(h.spawned).toEqual([]);
    // The halt lasts until `ack`: W2's ackNode returns the row to idle and clears its request, and the next
    // run is no longer halted — the server, still requested, moves.
    expect(h.store.ackNode(FLEET_ID).ok).toBe(true);
    const r3 = ran(await runDispatch(h.deps, T0 + 121_000));
    expect(r3.plan.gate.haltedBy).toEqual([]);
    expect(r3.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    expect(h.sent).toHaveLength(1);
  });

  it('bad-request after the live ops dropped mid-dispatch → idle with the skew sentence; once the row is re-measured without the op it is never sent again', async () => {
    let h: Harness | null = null;
    h = harness({ send: async () => { h!.state.agentOps = []; throw new AgentOpError('bad-request', null); } });
    seedFleet(h);
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r1.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'released', to: 'idle' });
    expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^agent-predates-update-op — /);
    expect(h.store.node(FLEET_ID)?.requestedTag).toBe('v0.0.10');
    sweepOnce(h.store, fleetMeas({ agentOps: [], measuredAt: T0 + 2000 }));
    ran(await runDispatch(h.deps, T0 + 3000));
    expect(h.sent).toHaveLength(1);
  });

  it('bad-tag → failed', async () => {
    const h = harness({ send: async () => { throw new AgentOpError('bad-tag', null); } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: 'agent refused the op: bad-tag' });
  });

  it('a server-role spawn that exits 1 on the lock → failed, carrying the parent\'s FIRST stderr line (Review Focus 3)', async () => {
    const lock = 'update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)';
    const h = harness({ run: async () => ({ code: 1, stdout: '', stderr: `${lock}\nsecond line` }) });
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'released', to: 'failed', detail: `spawn-failed — ${lock}` });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
  });

  it('an ok reply without accepted: true → failed, named (D-3399)', async () => {
    const h = harness({ send: async () => ({ t: 'res', id: 1, ok: true }) });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: 'agent answered ok-without-accepted' });
  });

  it('disconnected during the send → idle, the request standing; not sent while the sweep says unreachable; sent again once measured reachable', async () => {
    let calls = 0;
    const h = harness({ send: async () => { calls += 1; if (calls === 1) throw new Error('disconnected'); return ACCEPTED; } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: 'disconnected — the node dropped mid-dispatch; the request stands', requestedTag: 'v0.0.10',
    });
    expect(h.store.markUnreachable(FLEET_LABEL, 'fleet', T0 + 2000).ok).toBe(true);
    ran(await runDispatch(h.deps, T0 + 2500));
    expect(h.sent).toHaveLength(1);
    sweepOnce(h.store, fleetMeas({ measuredAt: T0 + 3000 }));
    ran(await runDispatch(h.deps, T0 + 3500));
    expect(h.sent).toHaveLength(2);
    expect(h.store.node(FLEET_ID)?.updateState).toBe('pending');
  });

  it('a send that timed out, then a node that converged out of band → the next run settles the request `met`, and sends nothing (Review Focus 1)', async () => {
    const h = harness({ send: async () => { throw new Error('timeout'); } });
    seedFleet(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: 'timeout — the node dropped mid-dispatch; the request stands', requestedTag: 'v0.0.10',
    });
    // The detached run the op started finished anyway; the sweep measures the new stamp on an idle row.
    expect(sweepOnce(h.store, fleetMeas({ currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: T0 + 120_000 }))
      .lease.kind).toBe('none');
    const r = ran(await runDispatch(h.deps, T0 + 121_000));
    expect(r.settled).toEqual([FLEET_ID]);
    expect(r.outcome).toBeNull();
    expect(h.sent).toHaveLength(1);
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateDetail: 'met: v0.0.10', requestedTag: null, requestedKind: null, requestedAt: null,
    });
  });
});

describe('runDispatch — a node that cannot be sent the op is never sent it, and takes no lease (§18 "an agent without the op is never sent it")', () => {
  it('a row measured with agentOps [] gets no frame — the planner\'s refusal, noted', async () => {
    const h = harness({ agentOps: [] });
    seedFleet(h, 'v0.0.10', { agentOps: [] });
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toBeNull();
    expect(h.sent).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateStartedAt: null, requestedTag: 'v0.0.10' });
    expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^agent-predates-update-op — /);
  });

  it('a row that advertises the op while the LIVE link does not (or has sent no ready) gets no frame and no lease (D-3398)', async () => {
    for (const live of [[], undefined] as const) {
      const h = harness();
      h.state.agentOps = live;
      seedFleet(h);
      const r = ran(await runDispatch(h.deps, T0 + 1000));
      expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'not-sent' });
      expect(h.sent).toEqual([]);
      expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateStartedAt: null, requestedTag: 'v0.0.10' });
      expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^agent-predates-update-op — /);
      // `not-sent` is transient: the next `ready` names the op, and the standing request is sent on the next run.
      h.state.agentOps = ['update'];
      const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
      expect(r2.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
      expect(h.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
      expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10' });
    }
  });

  it('a link that is down gets no frame and no lease', async () => {
    const h = harness();
    h.state.connected = false;
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'not-sent', detail: LINK_DOWN_DETAIL });
    expect(h.sent).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: LINK_DOWN_DETAIL, updateStartedAt: null });
    // The reconnect: the standing request is sent on the next run.
    h.state.connected = true;
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r2.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10' });
  });

  it('no fleet link wired at all → a link-reached row is noted NO_FLEET_LINK_DETAIL, sent nothing, and takes no lease', async () => {
    const h = harness();
    h.deps.fleet = null;
    seedFleet(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: FLEET_ID, result: 'not-sent', detail: NO_FLEET_LINK_DETAIL });
    expect(h.sent).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({
      updateState: 'idle', updateStartedAt: null, updateDetail: NO_FLEET_LINK_DETAIL, requestedTag: 'v0.0.10',
    });
  });

  it('no local spawner → the server row is noted and takes no lease', async () => {
    const h = harness({ noLocal: true });
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'not-sent', detail: NO_LOCAL_RUNNER_DETAIL });
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', updateDetail: NO_LOCAL_RUNNER_DETAIL, updateStartedAt: null });
  });

  it('a fleet-role server does not dispatch at all', async () => {
    const h = harness({ role: 'fleet' });
    seedFleet(h);
    expect(await runDispatch(h.deps, T0 + 1000)).toEqual({ ran: false, why: 'not-server-role' });
    expect(h.sent).toEqual([]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: null, updateStartedAt: null });
  });
});

describe('runDispatch — the deadline (§18 "the deadline bounds a node that never wrote")', () => {
  it('a lease whose node never wrote a report stands at deadline − 1, fails `deadline` at + 1 with the request standing, and halts the server\'s turn', async () => {
    const h = harness();
    seedFleet(h);
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    const before = ran(await runDispatch(h.deps, T0 + 1000 + DEADLINE - 1));
    expect(before.expired).toEqual([]);
    expect(h.store.node(FLEET_ID)?.updateState).toBe('pending');
    const after = ran(await runDispatch(h.deps, T0 + 1000 + DEADLINE + 1));
    expect(after.expired).toEqual([FLEET_ID]);
    expect(h.store.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: DEADLINE_DETAIL, requestedTag: 'v0.0.10' });
    expect(after.plan.gate.haltedBy).toEqual([FLEET_ID]);
    expect(after.outcome).toBeNull();
    expect(h.spawned).toEqual([]);
  });
});

describe('runDispatch — the server-role spawn (§18 "the spawn argv is absolute", D-3397)', () => {
  it('spawns exactly the absolute launcher and the update template, and never uses the link', async () => {
    const h = harness();
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
    expect(h.sent).toEqual([]);
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10' });
  });

  it('localUpdateSpawnFor throws RangeError on a non-tag BEFORE running anything', () => {
    const calls: string[][] = [];
    const spawn: LocalUpdateSpawn = localUpdateSpawnFor(async (cmd, args) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: '', stderr: '' };
    }, mkTmp('update-converge-spawn-'));
    expect(() => spawn('update', '; rm -rf ~')).toThrow(RangeError);
    expect(calls).toEqual([]);
  });

  it('an in-flight update.json on the server box answers busy and spawns nothing (D-3384)', async () => {
    const h = harness();
    mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(h.home, '.ccrc', 'update.json'),
      '{"target":"v0.0.10","phase":"installing","startedAt":1790000000,"updatedAt":1790000005,"detail":null,"from":"cli","pid":7}\n');
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(inFlightSentence({ phase: 'installing', target: 'v0.0.10', startedAtS: 1790000000 })).toBe(IN_FLIGHT);
    expect(r.outcome).toEqual({ nodeId: SERVER_ID, result: 'released', to: 'idle', detail: `busy — ${IN_FLIGHT}` });
    expect(h.spawned).toEqual([]);
    expect(h.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', requestedTag: 'v0.0.10' });
  });

  it('a FIFO planted at the server\'s update.json never blocks the run: W2\'s readNodeFile refuses it unopened, and the node\'s own _upd_lock decides (the agent\'s O_NONBLOCK rule, server side)', async () => {
    // Opened for reading, a FIFO with no writer blocks open(2) for good — AFTER the lease was taken, so the
    // dispatcher's single-flight run would never settle and no later trigger would run the deadline sweep.
    // `readNodeFile` lstats first and refuses anything that is not a regular file, so the FIFO is never opened.
    const h = harness();
    mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    execFileSync('mkfifo', [path.join(h.home, '.ccrc', 'update.json')]);
    seedServer(h);
    const r = ran(await runDispatch(h.deps, T0 + 1000));
    expect(r.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toEqual([{ cmd: `${h.home}/.local/bin/ccrc`, args: LAUNCHER_ARGV }]);
  });

  it('a spawn whose parent never exits is answered `timeout` exactly at UPDATE_SPAWN_TIMEOUT_MS; while it lives no second parent starts; its late exit writes nothing (Review Focus 4, D-3400)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const parked: { finish?: (r: ExecResult) => void } = {};
    let calls = 0;
    // The FIRST spawn parks; any later one exits 0 at once, as a `--detach` parent does.
    const h = harness({
      localIo: absentIo,
      run: () => {
        calls += 1;
        return calls === 1
          ? new Promise<ExecResult>((resolve) => { parked.finish = resolve; })
          : Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
    });
    seedServer(h);
    let done = false;
    const running = runDispatch(h.deps, T0 + 1000).then((r) => { done = true; return r; });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.spawned).toHaveLength(1);
    expect(h.store.node(SERVER_ID)?.updateState).toBe('pending');
    await vi.advanceTimersByTimeAsync(UPDATE_SPAWN_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);   // flush the continuation; the clock does not move
    expect(done).toBe(true);
    const r = ran(await running);
    expect(r.outcome).toEqual({
      nodeId: SERVER_ID, result: 'released', to: 'idle', detail: 'timeout — the node dropped mid-dispatch; the request stands',
    });
    expect(SPAWN_TIMEOUT_MESSAGE).toBe(`the --detach parent did not exit within ${UPDATE_SPAWN_TIMEOUT_MS} ms`);
    // The race gave up waiting; the parent did not exit. `realRunner` passes execFile no timeout, so nothing
    // killed it — and a rollback parent asks the release host before it writes `queued`, so update.json can still
    // read not-in-flight. The next run must not start a second `--detach` parent beside it.
    const second = runDispatch(h.deps, T0 + 61_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.spawned).toHaveLength(1);
    const r2 = ran(await second);
    expect(r2.outcome).toEqual({
      nodeId: SERVER_ID, result: 'released', to: 'idle', detail: `busy — ${LOCAL_SPAWNING_DETAIL}`,
    });
    expect(LOCAL_SPAWNING_DETAIL).toBe('an update op is already spawning on this server');
    const settledRow = h.store.node(SERVER_ID);
    parked.finish!({ code: 0, stdout: '', stderr: '' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.node(SERVER_ID)).toEqual(settledRow);
    expect(h.accepted()).toBe(0);
    // The parent has exited: the gate is open again, and the standing request is spawned on the next run.
    const r3 = ran(await runDispatch(h.deps, T0 + 62_000));
    expect(r3.outcome).toMatchObject({ nodeId: SERVER_ID, result: 'accepted' });
    expect(h.spawned).toHaveLength(2);
    expect(h.accepted()).toBe(1);
  });
});

describe('runDispatch — refusal notes (Review Focus 5)', () => {
  it('a node refused on two consecutive runs is written ONCE', async () => {
    const h = harness();
    seedFleet(h, 'v0.0.10', { caps: ['verify', 'node-id', 'floor', 'update-json'] });
    const r1 = ran(await runDispatch(h.deps, T0 + 1000));
    const r2 = ran(await runDispatch(h.deps, T0 + 61_000));
    expect(r1.noted).toBe(1);
    expect(r2.noted).toBe(0);
    expect(h.store.node(FLEET_ID)?.updateDetail).toMatch(/^no-detach-cap — /);
    expect(h.sent).toEqual([]);
  });

  it('a provenance-failed server row does not halt the fleet node\'s dispatch, and its verdict is never overwritten (§18 "a provenance refusal does not halt", end to end)', async () => {
    const h = harness();
    seedFleet(h, null);
    seedServer(h);
    ran(await runDispatch(h.deps, T0 + 1000));
    const verdict = 'provenance: the bundle signature did not verify';
    const swept = sweepOnce(h.store, serverMeas({
      measuredAt: T0 + 9000,
      report: { phase: 'failed', target: 'v0.0.10', startedAt: T0 + 6000, updatedAt: T0 + 9000, detail: verdict },
    }));
    expect(swept.lease).toMatchObject({ kind: 'release', to: 'failed' });
    expect(swept.refuse).toMatchObject({ tag: 'v0.0.10' });
    expect(h.store.node(SERVER_ID)?.updateDetail).toMatch(/^provenance:/);
    const serverBefore = h.store.node(SERVER_ID);
    expect(h.store.requestNode(FLEET_ID, 'v0.0.10', 'update', T0 + 10_000).ok).toBe(true);
    const r = ran(await runDispatch(h.deps, T0 + 11_000));
    expect(r.plan.gate.haltedBy).toEqual([]);
    expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(h.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(h.store.node(SERVER_ID)).toEqual(serverBefore);
  });
});

describe('dispatchViewsFor — the one builder of the dispatcher\'s input (the routes read the same views)', () => {
  it('carries every live row, its resolved auto, and only THIS node\'s refused tags', () => {
    const h = harness();
    seedFleet(h, null);
    seedServer(h, null);
    expect(h.store.refuseRelease(SERVER_ID, 'v0.0.10', T0, 'provenance: x').ok).toBe(true);
    const views = dispatchViewsFor(h.store);
    const byId = new Map(views.map((v) => [v.row.nodeId, v]));
    expect([...byId.keys()].sort()).toEqual([FLEET_ID, SERVER_ID].sort());
    expect(byId.get(FLEET_ID)?.auto).toBe('off');
    expect([...(byId.get(FLEET_ID)?.refusedTags ?? [])]).toEqual([]);
    expect([...(byId.get(SERVER_ID)?.refusedTags ?? [])]).toEqual(['v0.0.10']);
  });
});

describe('converge.ts — nothing yields between the plan and the lease (D-3377)', () => {
  it('runDispatch plans once, acquires once, and holds no await anywhere above the acquire', () => {
    const src = readFileSync(new URL('../src/update/converge.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export async function runDispatch(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body.split('planDispatch(').length - 1).toBe(1);
    expect(body.split('.dispatchNode(').length - 1).toBe(1);
    const lease = body.indexOf('.dispatchNode(');
    expect(body.indexOf('planDispatch(')).toBeLessThan(lease);
    expect(body.slice(0, lease)).not.toMatch(/\bawait\b/);
  });
});

describe('FleetWatcher — the dispatcher runs single-flight, at the end of every inventory run', () => {
  const watcherFor = (o: { send?: SendUpdateOp; role?: NodeRole } = {}) => {
    const home = mkTmp('update-converge-watch-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(path.join(home, 'coord.db')));
    seedReleases(coord);
    const sent: { tag: string; kind: RequestKind }[] = [];
    const fleetState: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, agentOps: ['update'] };
    const deps: Deps = {
      ...base, cfg: { ...base.cfg, role: o.role ?? 'server' }, coord, fleetState,
      sendUpdateOp: (tag, kind) => { sent.push({ tag, kind }); return (o.send ?? (async () => ACCEPTED))(tag, kind); },
      updateRunner: localUpdateSpawnFor(async () => ({ code: 0, stdout: '', stderr: '' }), home),
    };
    const watcher = new FleetWatcher(deps, new Bus());
    const once = vi.spyOn(watcher as unknown as { dispatchOnce(): Promise<DispatchRunResult> }, 'dispatchOnce');
    return { coord, watcher, once, sent };
  };

  it('an inventory run ends in exactly one dispatch run', async () => {
    const { watcher, once } = watcherFor({ role: 'both' });
    await watcher.inventoryNow();
    expect(once).toHaveBeenCalledTimes(1);
  });

  it('a run acquires in the caller\'s own turn; two triggers during it ask for exactly ONE follow-up (§18 "one dispatch per sweep", the act half)', async () => {
    const reply: { answer?: (r: ResOk) => void } = {};
    const { coord, watcher, once, sent } = watcherFor({ send: () => new Promise<ResOk>((resolve) => { reply.answer = resolve; }) });
    const inventory = vi.spyOn(watcher, 'triggerInventory').mockImplementation(() => {});
    expect(coord.upsertNodeMeasurement(fleetMeas()).ok).toBe(true);
    expect(coord.requestNode(FLEET_ID, 'v0.0.10', 'update', T0).ok).toBe(true);
    const first = watcher.dispatchNow();
    expect(coord.node(FLEET_ID)).toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.10' });
    expect(watcher.dispatchNow()).toBe(first);
    watcher.triggerDispatch();
    watcher.triggerDispatch();
    expect(once).toHaveBeenCalledTimes(1);
    reply.answer!(ACCEPTED);
    await first;
    expect(once).toHaveBeenCalledTimes(2);
    await (once.mock.results[1]!.value as Promise<DispatchRunResult>);
    await new Promise((resolve) => setImmediate(resolve));
    expect(once).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(inventory).toHaveBeenCalledTimes(1);
  });

  it('without a coord store there is nothing to dispatch', async () => {
    const watcher = new FleetWatcher(testDeps(mkTmp('update-converge-nocoord-')), new Bus());
    await expect(watcher.dispatchNow()).resolves.toEqual({ ran: false, why: 'no-coord' });
  });
});

describe('the composition root binds the two update ports (a text pin over index.ts; no suite boots it in remote mode)', () => {
  it('names updateRunner in both deps literals and sendUpdateOp — with t: \'req\' and the op\'s own timeout — in the remote one only', () => {
    const indexTs = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const depsLiterals = indexTs.match(/^  deps = \{\n[\s\S]*?^  \};$/gm) ?? [];
    expect(depsLiterals).toHaveLength(2);
    expect(depsLiterals[0]).toContain('io: fleet.io');
    expect(depsLiterals[1]).toContain('io: localIO');
    for (const lit of depsLiterals) expect(lit).toMatch(/^    updateRunner: localUpdateSpawnFor\(realRunner, cfg\.home\),$/m);
    expect(depsLiterals[0]).toMatch(
      /^    sendUpdateOp: \(tag, kind\) => fleet\.client\.request\(\{ t: 'req', op: 'update', tag, kind \}, UPDATE_OP_TIMEOUT_MS\),$/m);
    expect(depsLiterals[1]).not.toContain('sendUpdateOp');
  });

  it('Deps carries no raw Runner for the update spawn — only the two-template capability (D-3397)', () => {
    // @ts-expect-error — a raw Runner is not a LocalUpdateSpawn: its second parameter is an argv, not a tag
    const raw: NonNullable<Deps['updateRunner']> = realRunner;
    void raw;
    expect(typeof localUpdateSpawnFor(realRunner, '/h')).toBe('function');
  });
});
```

- [ ] **Step 7: Run it red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-converge.test.ts`
Expected: FAIL — the file does not load (`Failed to load url ../src/update/converge.js … Does the file exist?`, or `Cannot find module '…/server/src/update/converge.js'`, depending on the resolver's wording); 0 tests run.

- [ ] **Step 8: Create `server/src/update/converge.ts`**

```ts
// The dispatcher's ACT (design 2026-09-20 §10) — L3, D-3383. `dispatch.ts` DECIDES
// (pure, L1); this file DOES: it reads the rows through the ConvergeStore port, asks the planner, writes the
// planner's met settles and refusal notes, acquires THE lease, and only then crosses a process boundary — the
// fleet link's `update` op for a link-reached node, the server-role spawn for the server's own row — and maps
// what came back onto the lease with W2's writers. The RESULT of a move is never read off the reply: `accepted`
// holds the lease and asks for a sweep, and only the sweep (or a met request) settles it.
//
// ORDER IS THE MECHANISM. Everything from the role gate to the acquire is one synchronous stretch (`node:sqlite`
// is synchronous and this process is single-threaded), so no other run, route or sweep changes a row between
// the plan and the lease (D-3377; `update-converge.test.ts` scans `runDispatch` for a yield
// above the acquire). The acquire's own WHERE re-checks what SQL can.
import path from 'node:path';
import {
  inFlightReport, type InFlightReport, type NodeRole, type RequestKind, type SettledUpdateState,
} from '../../../shared/api.js';
import {
  NODE_FILES, UPDATE_OP, UPDATE_SPAWN_TIMEOUT_MS, firstStderrLine, updateLauncherPath, updateSpawnArgv, type ResOk,
} from '../../../shared/agent-protocol.js';
import {
  DEADLINE_DETAIL, classifyOpAnswer, deadlineExpired, dispatchRefusalDetail, planDispatch,
  type DispatchMove, type DispatchNodeView, type DispatchPlan, type OpAnswer,
} from './dispatch.js';
import { resolveNodeIntent } from './resolve.js';
import { resolveInputFor } from './project.js';
import { INVENTORY_BUDGET_MS, readNodeFile } from './inventory.js';
import { openPoolReadDeadline } from '../pools.js';
import { AgentOpError } from '../remote/client.js';
import type { ExecResult, Runner } from '../exec.js';
import type { FleetIO } from '../io.js';
import type { FleetState } from '../fleetstate.js';
import type {
  DispatchNodeResult, NodeRow, NoteDispatchRefusalResult, RefusalRow, ReleaseLeaseResult, ReleaseRow,
  SettleNodeResult, UpdateIntentRow,
} from '../coord/store.js';

/** The fleet link's `request()` narrowed to the one op; `index.ts` binds it with UPDATE_OP_TIMEOUT_MS. */
export type SendUpdateOp = (tag: string, kind: RequestKind) => Promise<ResOk>;

/** D-3397: the server-role spawn as a CAPABILITY — it runs the two templates and nothing
 *  else. A raw `Runner` on `Deps` would hand every route a way around `CcdArgv` (task 13S's `runCcd` rule). */
export type LocalUpdateSpawn = (kind: RequestKind, tag: string) => Promise<ExecResult>;

/** The composition-root factory, `ccdRunner`'s idiom (`lifecycle.ts`): binds a Runner and this box's home into
 *  a LocalUpdateSpawn. The argv is built by the ONE builder the agent uses; a non-tag or a kind outside
 *  RequestKind throws RangeError synchronously, before `run` is called. */
export function localUpdateSpawnFor(run: Runner, home: string): LocalUpdateSpawn {
  return (kind, tag) => run(updateLauncherPath(home), [...updateSpawnArgv(kind, tag)]);
}

/** The store port (L2, declared by the consumer); CoordStore satisfies it structurally. `updateEpoch` is here
 *  because `resolveInputFor`'s store parameter requires it. */
export interface ConvergeStore {
  nodes(): NodeRow[]; releases(): ReleaseRow[]; refusalsFor(nodeId: string): RefusalRow[];
  intentFor(scope: string): UpdateIntentRow | null; updateEpoch(): { epoch: number; issuedAt: number };
  dispatchNode(nodeId: string, target: string, kind: RequestKind, startedAt: number, detail: string): DispatchNodeResult;
  releaseLease(nodeId: string, to: SettledUpdateState, detail: string, reportStartedAt: number | null): ReleaseLeaseResult;
  settleNode(nodeId: string, detail: string, reportStartedAt: number | null): SettleNodeResult;
  noteDispatchRefusal(nodeId: string, detail: string): NoteDispatchRefusalResult;
}

export interface ConvergeDeps {
  store: ConvergeStore; role: NodeRole; ccrcDir: string; localIo: FleetIO; deadlineMs: number;
  /** null in local mode, or with no link wired. */
  fleet: { state: FleetState; send: SendUpdateOp } | null;
  /** null → a server-row move is noted NO_LOCAL_RUNNER_DETAIL and takes no lease. */
  runLocal: LocalUpdateSpawn | null;
  /** FleetWatcher.triggerInventory: an accepted move is re-measured at once, never believed. */
  onAccepted: () => void;
}

export const NO_FLEET_LINK_DETAIL = 'disconnected — no fleet link is wired on this server; the request stands';
export const LINK_DOWN_DETAIL = 'disconnected — the fleet link is down; the request stands';
export const NO_LOCAL_RUNNER_DETAIL = 'no local runner — this server was started without an update spawner; the request stands';
/** D-3399: an ok reply that does not say `accepted: true` is a word this build cannot name. */
export const OK_WITHOUT_ACCEPTED = 'ok-without-accepted';
export const SPAWN_TIMEOUT_MESSAGE = `the --detach parent did not exit within ${UPDATE_SPAWN_TIMEOUT_MS} ms`;
/** D-3400: the server-side twin of the agent's `an update op is already spawning on this agent`. */
export const LOCAL_SPAWNING_DETAIL = 'an update op is already spawning on this server';

/** The busy sentence — the same words Task 2's agent sends for an in-flight report, so both roles read alike. */
export function inFlightSentence(r: InFlightReport): string {
  return `update.json says ${r.phase} (target ${r.target ?? 'none'}, started ${r.startedAtS ?? 'unknown'})`;
}

/** The ONE builder of the dispatcher's views: every live row, its RESOLVED auto (the resolver's own answer for
 *  this node, never a second reading of the intent rows) and this node's refused tags. The routes (Task 6) call
 *  it too, so a route's synchronous 409 and a dispatch run read the same views. */
export function dispatchViewsFor(
  store: Omit<ConvergeStore, 'dispatchNode' | 'releaseLease' | 'settleNode' | 'noteDispatchRefusal'>,
): DispatchNodeView[] {
  return store.nodes().map((row) => ({
    row,
    auto: resolveNodeIntent(resolveInputFor(store, row)).auto,
    refusedTags: new Set(store.refusalsFor(row.nodeId).map((f) => f.tag)),
  }));
}

export type MoveOutcome =
  | { nodeId: string; result: 'accepted'; detail: string }
  | { nodeId: string; result: 'released'; to: 'idle' | 'failed'; detail: string }
  | { nodeId: string; result: 'release-refused'; to: 'idle' | 'failed'; detail: string; why: Extract<ReleaseLeaseResult, { ok: false }>['why'] }
  | { nodeId: string; result: 'not-sent'; detail: string }
  | { nodeId: string; result: 'acquire-refused'; why: Extract<DispatchNodeResult, { ok: false }>['why'] };

export type DispatchRunResult =
  | { ran: false; why: 'no-coord' | 'not-server-role' }
  | { ran: true; expired: string[]; settled: string[]; noted: number; plan: DispatchPlan; outcome: MoveOutcome | null };

const liveOps = (s: FleetState): readonly string[] => s.agentOps ?? [];

/** Why a planned move cannot be SENT, or null when it can. Decided before the acquire, so a move that could
 *  never leave this process takes no lease and churns no row: no link wired, the link down, the LIVE agent not
 *  advertising the op (the row's agentOps is up to one sweep old — D-3398), no local spawner. */
function unsendableDetail(deps: ConvergeDeps, view: DispatchNodeView, move: DispatchMove): string | null {
  if (!move.viaLink) return deps.runLocal === null ? NO_LOCAL_RUNNER_DETAIL : null;
  if (deps.fleet === null) return NO_FLEET_LINK_DETAIL;
  if (!deps.fleet.state.connected) return LINK_DOWN_DETAIL;
  if (!liveOps(deps.fleet.state).includes(UPDATE_OP)) return dispatchRefusalDetail('agent-predates-update-op', view, move.target);
  return null;
}

function transportWhy(message: string): 'disconnected' | 'timeout' | 'aborted' | 'other' {
  return message === 'disconnected' || message === 'timeout' || message === 'aborted' ? message : 'other';
}

/** The link's answer. An AgentOpError is a word the NODE said; any other rejection is the transport. */
async function linkAnswer(deps: ConvergeDeps, move: DispatchMove): Promise<OpAnswer> {
  if (deps.fleet === null) return { kind: 'transport', why: 'disconnected', message: NO_FLEET_LINK_DETAIL };
  try {
    const res = await deps.fleet.send(move.target, move.kind);
    return res.accepted === true ? { kind: 'accepted' } : { kind: 'refused', err: OK_WITHOUT_ACCEPTED, detail: null };
  } catch (e) {
    if (e instanceof AgentOpError) return { kind: 'refused', err: e.code, detail: e.detail };
    const message = e instanceof Error ? e.message : String(e);
    return { kind: 'transport', why: transportWhy(message), message };
  }
}

const TIMED_OUT = Symbol('timed-out');

/** The spawn raced against UPDATE_SPAWN_TIMEOUT_MS — the agent's own bound, strictly below the link's
 *  UPDATE_OP_TIMEOUT_MS (D-3374). A late exit after the bound resolves into nothing. */
function withinSpawnDeadline<T>(p: Promise<T>): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), UPDATE_SPAWN_TIMEOUT_MS);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

/** `~/.ccrc/update.json` on THIS box, through the one shared parser and W2's BOUNDED node-file reader — the
 *  same `readNodeFile` the inventory sweep reads this file with: lstat to a regular file only, size ≤
 *  NODE_FILE_CAP_BYTES, every step raced against one deadline. It runs AFTER the lease is taken, so an unbounded
 *  read here (a FIFO blocks `open(2)` for good) would leave the row `pending` and the single-flight dispatch run
 *  unsettled, and no later trigger would reach the deadline sweep. Absent, unreadable, non-regular, too large or
 *  not in flight all read "not busy" — the node's own `_upd_lock` then decides, the agent's rule
 *  (D-3371; Task 2's `readInFlightReport` is the agent's `O_NONBLOCK` twin). */
async function localInFlight(deps: ConvergeDeps): Promise<InFlightReport | null> {
  const deadline = openPoolReadDeadline(INVENTORY_BUDGET_MS);
  try {
    const read = await readNodeFile(deps.localIo, path.join(deps.ccrcDir, NODE_FILES.report), deadline);
    return read.ok ? inFlightReport(read.content) : null;
  } finally {
    deadline?.close();
  }
}

/** D-3400: the server-role spawns whose `--detach` parent has not exited yet, by capability
 *  (one `LocalUpdateSpawn` per process in production — `index.ts` builds it once — and one per harness in a
 *  test). `realRunner` passes `execFile` no deadline, so the race below stops WAITING at UPDATE_SPAWN_TIMEOUT_MS
 *  but kills nothing; an entry leaves this set only when the child's own promise settles. While it is here, the
 *  next run answers `busy` instead of starting a second parent — both parents would only PROBE the lock (wave 4),
 *  and a rollback parent asks the release host before it writes `queued`. The agent's process-wide `UpdateGate`
 *  (D-3392) is the same rule on the other role. */
const spawning = new WeakSet<LocalUpdateSpawn>();

/** The server-role answer: the busy read (D-3384), the spawn gate, then the `--detach`
 *  parent's exit. */
async function localAnswer(deps: ConvergeDeps, move: DispatchMove): Promise<OpAnswer> {
  const spawn = deps.runLocal;
  if (spawn === null) return { kind: 'transport', why: 'other', message: NO_LOCAL_RUNNER_DETAIL };
  const busy = await localInFlight(deps);
  if (busy !== null) return { kind: 'refused', err: 'busy', detail: inFlightSentence(busy) };
  // Checked and taken with no await between: two runs can never both pass.
  if (spawning.has(spawn)) return { kind: 'refused', err: 'busy', detail: LOCAL_SPAWNING_DETAIL };
  let child: Promise<ExecResult>;
  try {
    child = spawn(move.kind, move.target);   // a non-tag or non-kind throws RangeError here, before anything runs
  } catch (e) {
    return { kind: 'transport', why: 'other', message: e instanceof Error ? e.message : String(e) };
  }
  spawning.add(spawn);
  const clear = (): void => { spawning.delete(spawn); };
  child.then(clear, clear);
  try {
    const res = await withinSpawnDeadline(child);
    if (res === TIMED_OUT) return { kind: 'transport', why: 'timeout', message: SPAWN_TIMEOUT_MESSAGE };
    return res.code === 0 ? { kind: 'accepted' } : { kind: 'refused', err: 'spawn-failed', detail: firstStderrLine(res.stderr) };
  } catch (e) {
    return { kind: 'transport', why: 'other', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * One dispatch run (design 2026-09-20 §10). In order, in one synchronous stretch: the role gate; the deadline
 * sweep; the plan over rows read after it; the met settles; the refusal notes; a move that cannot be sent,
 * noted; THE lease. Then, and only then, the op or the spawn — and the answer decides only what happens to
 * the lease: hold (and ask for a sweep), or release it idle/failed in this same run.
 */
export async function runDispatch(deps: ConvergeDeps, now: number): Promise<DispatchRunResult> {
  if (deps.role !== 'server' && deps.role !== 'both') return { ran: false, why: 'not-server-role' };
  const { store } = deps;
  // (1) The deadline: a busy lease its node has not written to for deadlineMs fails, and failed halts.
  const expired: string[] = [];
  for (const row of store.nodes()) {
    if (!deadlineExpired(row, now, deps.deadlineMs)) continue;
    if (store.releaseLease(row.nodeId, 'failed', DEADLINE_DETAIL, null).ok) expired.push(row.nodeId);
  }
  // (2) The plan, over rows read after those writes.
  const views = dispatchViewsFor(store);
  const plan = planDispatch({ nodes: views, releases: store.releases() });
  // (3) A request the node already runs is convergence, measured (D-3380).
  const settled: string[] = [];
  for (const m of plan.met) {
    if (store.settleNode(m.nodeId, `met: ${m.tag}`, null).ok) settled.push(m.nodeId);
  }
  // (4) Every refusal is noted: idle rows only, changed words only (D-3375).
  let noted = 0;
  const note = (nodeId: string, detail: string): void => {
    const w = store.noteDispatchRefusal(nodeId, detail);
    if (w.ok && w.changed) noted += 1;
  };
  for (const r of plan.refusals) note(r.nodeId, r.detail);
  const done = (outcome: MoveOutcome | null): DispatchRunResult => ({ ran: true, expired, settled, noted, plan, outcome });
  const move = plan.move;
  if (move === null) return done(null);
  const view = views.find((v) => v.row.nodeId === move.nodeId);
  if (view === undefined) return done({ nodeId: move.nodeId, result: 'acquire-refused', why: 'unknown-node' });
  // (5) A move that cannot be sent takes no lease: it is noted, and the request stands.
  const unsendable = unsendableDetail(deps, view, move);
  if (unsendable !== null) {
    note(move.nodeId, unsendable);
    return done({ nodeId: move.nodeId, result: 'not-sent', detail: unsendable });
  }
  // (6) THE lease. Everything above ran in this one turn.
  const got = store.dispatchNode(move.nodeId, move.target, move.kind, now, move.detail);
  if (!got.ok) return done({ nodeId: move.nodeId, result: 'acquire-refused', why: got.why });
  // (7) Only now does the act leave this process; the reply decides only what happens to the lease.
  const answer = move.viaLink ? await linkAnswer(deps, move) : await localAnswer(deps, move);
  const advertised = move.viaLink ? deps.fleet !== null && liveOps(deps.fleet.state).includes(UPDATE_OP) : true;
  const action = classifyOpAnswer(answer, advertised);
  if (action.kind === 'hold') {
    deps.onAccepted();
    return done({ nodeId: move.nodeId, result: 'accepted', detail: action.detail });
  }
  const released = store.releaseLease(move.nodeId, action.to, action.detail, null);
  if (!released.ok) {
    return done({ nodeId: move.nodeId, result: 'release-refused', to: action.to, detail: action.detail, why: released.why });
  }
  return done({ nodeId: move.nodeId, result: 'released', to: action.to, detail: action.detail });
}
```

- [ ] **Step 9: Run it — only the watcher and composition-root cases are red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-converge.test.ts`
Expected: FAIL in exactly the four cases that need Step 10's wiring: the three `FleetWatcher` cases (`dispatchOnce does not exist` from the spy in the first two, `watcher.dispatchNow is not a function` in the third) and "names updateRunner in both deps literals …" (`expected … to match /^    updateRunner: localUpdateSpawnFor…/m`). Every `runDispatch`, `dispatchViewsFor`, source-scan and type-pin case passes (vitest does not typecheck; the type pin is Step 11's `typecheck-tests` run).

- [ ] **Step 10: Wire the watcher, `Deps`, the composition root and the ring scan**

(a) `server/src/watch.ts` — directly after `import { resolveAndProject, type ProjectionOutcome } from './update/project.js';`:

```ts
import { runDispatch, type DispatchRunResult } from './update/converge.js';
```

(b) Directly after wave 3's `  private inventorySwept = false;`:

```ts
  /** Wave 5 (design 2026-09-20 §10): the dispatcher's ONE run in flight, and whether a trigger arrived while
   *  it ran. However many triggers arrive during a run, they ask for ONE follow-up after it — so a request
   *  written mid-run is planned by a run that reads it, and no two runs ever hold the plan-then-acquire
   *  stretch at once. */
  private dispatchRun: Promise<DispatchRunResult> | null = null;
  private dispatchAgain = false;
```

(c) Directly after `triggerInventory()`'s closing `  }`:

```ts

  /**
   * The dispatcher's ONE run (design 2026-09-20 §10), single-flight. Called at the end of every inventory run
   * (`sweepThenProject`) and by the update routes after every intent and request write. A call while a run is
   * in flight JOINS it and asks for exactly one follow-up; otherwise it starts a run SYNCHRONOUSLY — the run's
   * plan and lease acquire happen in the caller's own turn, so a route's reply already reads `pending`.
   */
  dispatchNow(): Promise<DispatchRunResult> {
    if (this.dispatchRun !== null) {
      this.dispatchAgain = true;
      return this.dispatchRun;
    }
    const run = this.dispatchOnce().finally(() => {
      this.dispatchRun = null;
      if (this.dispatchAgain) {
        this.dispatchAgain = false;
        this.triggerDispatch();
      }
    });
    this.dispatchRun = run;
    return run;
  }

  /** For a caller that must not wait: the inventory run's tail, a route's reply. */
  triggerDispatch(): void {
    void this.dispatchNow().catch((err: unknown) => {
      // D-3493 — the update lanes' rule at the tip: a rejection is warned, never swallowed.
      console.warn(`ccrc-server: a dispatch run rejected: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    });
  }

  /** The act's deps, built from this process's Deps — the ONE place they are assembled. The server's own
   *  update.json is read through `localIO` in both modes (`deps.io` is the FLEET box's io in remote mode). */
  private async dispatchOnce(): Promise<DispatchRunResult> {
    const coord = this.deps.coord;
    if (coord === undefined) return { ran: false, why: 'no-coord' };
    const { cfg, fleetState, sendUpdateOp, updateRunner } = this.deps;
    return runDispatch({
      store: coord, role: cfg.role, ccrcDir: cfg.ccrcDir, localIo: localIO, deadlineMs: cfg.updateDeadlineMs,
      fleet: sendUpdateOp !== undefined && fleetState !== undefined ? { state: fleetState, send: sendUpdateOp } : null,
      runLocal: updateRunner ?? null,
      onAccepted: () => this.triggerInventory(),
    }, Date.now());
  }
```

(d) The call site — inside `sweepThenProject`, replace

```ts
    this.pushRelease(now);
    return outcomes;
```

with

```ts
    this.pushRelease(now);
    // Wave 5 (design 2026-09-20 §10): the sweep is what settles a lease, so every inventory run ends in ONE
    // dispatch run — the next node's turn starts on the beat that freed it.
    this.triggerDispatch();
    return outcomes;
```

Check: `grep -n 'this.triggerDispatch()' server/src/watch.ts` — Expected: two hits, `sweepThenProject`'s and `dispatchNow`'s follow-up. `grep -n 'runDispatch(' server/src/watch.ts` — Expected: one hit, inside `dispatchOnce`.

(e) `server/src/server.ts` — directly after `import { registerUpdateRoutes } from './update/routes.js';`:

```ts
import type { LocalUpdateSpawn, SendUpdateOp } from './update/converge.js';
```

and directly after `  updateIntentLog?: UpdateIntentLog;` in `Deps`:

```ts
  /** Design 2026-09-20 §10 (wave 5): the SERVER-role node's own move, spawned on this box with the same absolute
   *  argv the agent uses. A two-template capability, never a raw `Runner` — a runner here would give every
   *  route a way around `runCcd` (D-3397). `localUpdateSpawnFor(realRunner, cfg.home)` in
   *  `index.ts`, both arms; absent → the dispatcher notes the server row and moves nothing there. */
  updateRunner?: LocalUpdateSpawn;
  /** Design 2026-09-20 §10 (wave 5): the fleet link's `request()` narrowed to the `update` op, with
   *  `UPDATE_OP_TIMEOUT_MS`. Remote mode only — in local mode no node is link-reached. */
  sendUpdateOp?: SendUpdateOp;
```

(f) `server/src/index.ts` — directly after `import { readLocalCcdCaps } from './localcaps.js';`:

```ts
import { localUpdateSpawnFor } from './update/converge.js';
import { UPDATE_OP_TIMEOUT_MS } from '../../shared/agent-protocol.js';
```

In the REMOTE `deps` literal (the one with `io: fleet.io`), on the line after `    updateIntentLog,`:

```ts
    updateRunner: localUpdateSpawnFor(realRunner, cfg.home),
    sendUpdateOp: (tag, kind) => fleet.client.request({ t: 'req', op: 'update', tag, kind }, UPDATE_OP_TIMEOUT_MS),
```

In the LOCAL `deps` literal (the one with `io: localIO`), on the line after `    updateIntentLog,`:

```ts
    updateRunner: localUpdateSpawnFor(realRunner, cfg.home),
```

The two `    updateIntentLog,` lines are byte-identical: edit each with its FOLLOWING line as context — the remote arm's `    refreshCaps: makeRefreshCaps(fleet.client, fleet.state),` and the local arm's comment line that begins "`connected`/`downSince` are inert for local mode". The server box's own move runs on `realRunner` in BOTH modes: in remote mode `fleet.runner` is the fleet box's runner, which is not where the server node lives.

(g) `server/test/single-definition.test.ts` — the `UPDATE_RING_FILES` line as Task 4 left it, matched by content with its leading whitespace kept:

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts', 'notify.ts', 'dispatch.ts'];
```

becomes

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts', 'notify.ts', 'dispatch.ts', 'converge.ts'];
```

Check it is line-neutral: `git diff --numstat -- server/test/single-definition.test.ts` — Expected: `1	1	server/test/single-definition.test.ts`.

- [ ] **Step 11: Run green, and every neighbour the wiring touches**

Run, from `server/`, each in the foreground (timeout ≥ 600000 ms):
- `./node_modules/.bin/vitest run test/update-converge.test.ts` — Expected: PASS (33 cases).
- `./node_modules/.bin/vitest run test/update-op-answer.test.ts` — Expected: PASS (21 cases).
- `./node_modules/.bin/vitest run test/update-dispatch.test.ts` — Expected: PASS (Task 4's table unchanged).
- `./node_modules/.bin/vitest run test/update-store-dispatch.test.ts` — Expected: PASS (Task 3).
- `./node_modules/.bin/vitest run test/update-inventory.test.ts` — Expected: PASS; its watcher cases now end each sweep in a dispatch run that finds no request and writes nothing.
- `./node_modules/.bin/vitest run test/update-projection.test.ts` — Expected: PASS.
- `./node_modules/.bin/vitest run test/update-routes.test.ts` — Expected: PASS.
- `./node_modules/.bin/vitest run test/push-copy.test.ts` — Expected: PASS (wave 3's `pushRelease` call is untouched and still precedes the new line).
- `./node_modules/.bin/vitest run test/readiness.test.ts` and `test/readiness-sweep.test.ts` — Expected: PASS (`tick()` is untouched).
- `./node_modules/.bin/vitest run test/lifecycle-sweep.test.ts` — Expected: PASS; "adds NO new timer" still counts one `setInterval(` in `watch.ts`.
- `./node_modules/.bin/vitest run test/boot.test.ts` — Expected: PASS (it boots `index.ts` in local mode; the local literal's `updateRunner` builds a closure and runs nothing).
- `./node_modules/.bin/vitest run test/ccdargv-brand.test.ts` — Expected: PASS (`Deps` still has no `run`; `b6-no-run-on-deps.ts` still fails on TS2339 alone).
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — Expected: PASS; "the update ring" reads `converge.ts` and finds no `node:sqlite`, no `db.js` import and no `coord.db`/`store.db` reach.
- `./node_modules/.bin/vitest run test/session-hook.test.ts` — Expected: PASS (R13: Step 10(g) replaced one line with one; `shared/api.ts` is not touched by this task). A named load flake — re-run in isolation before reading a red.
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — Expected: PASS; the `@ts-expect-error` in the type pin is USED (a raw `Runner` is not a `LocalUpdateSpawn`). A named load flake.
- `./node_modules/.bin/tsc --noEmit -p .` — Expected: exit 0.
- `git add server/src/update/converge.ts server/test/update-converge.test.ts server/test/update-op-answer.test.ts`, then `./node_modules/.bin/vitest run test/topology-clean.test.ts` — Expected: PASS (fixture UUIDs, `example.invalid`, `~/.ccrc` in a message, no hostname or absolute home path).

- [ ] **Step 12: Mutation measurements (each red, then restored and green)**

From `server/`, make one backup directory for the whole table — `T=$(mktemp -d)` — and for each row: `cp <file> "$T/$(basename <file>)"`; apply the edit with the `perl -0pi -e` shown; confirm it landed with the `grep -c` shown (it must print `1` unless the row names another count — M7, M8, M10, M15 and M17 remove their line and must print `0`, M9 must print `1` — or the row measured nothing); run the named file and see the named case red; restore with `cp "$T/$(basename <file>)" <file>` and confirm `cmp "$T/$(basename <file>)" <file>` exits 0. After the last row, run `test/update-converge.test.ts` and `test/update-op-answer.test.ts` once more — both green (the control that every restore took).

| # | §18 row / pin | File, edit | Landed check | Must red |
|---|---|---|---|---|
| M1 | "`accepted` does not settle" | `src/update/dispatch.ts`: `perl -0pi -e "s/if \(a\.kind === 'accepted'\) return \{ kind: 'hold', detail: ACCEPTED_DETAIL \};/if (a.kind === 'accepted') return { kind: 'release', to: 'idle', detail: ACCEPTED_DETAIL };/"` | `grep -c "kind: 'release', to: 'idle', detail: ACCEPTED_DETAIL" src/update/dispatch.ts` | `update-op-answer.test.ts` "accepted HOLDS the lease"; `update-converge.test.ts` "accepted HOLDS the lease: the row stays pending …" (`updateState: 'idle'`) |
| M2 | "a one-tap is a row" | `src/update/converge.ts`: `perl -0pi -e 's/\n    deps\.onAccepted\(\);\n/\n    store.settleNode(move.nodeId, action.detail, null);\n    deps.onAccepted();\n/'` | `grep -c 'store.settleNode(move.nodeId, action.detail, null);' src/update/converge.ts` | "accepted HOLDS the lease …" (`requestedTag: null`); "two requested nodes: ONE op per run …" (the second run moves the server: `r2.outcome` not null) |
| M3 | "a refusal releases in the same turn" | `src/update/converge.ts`: `perl -0pi -e 's/const released = store\.releaseLease\(move\.nodeId, action\.to, action\.detail, null\);/const released: ReleaseLeaseResult = { ok: true, state: action.to };/'` | `grep -c 'const released: ReleaseLeaseResult = { ok: true, state: action.to };' src/update/converge.ts` | "busy → idle in the same run …" (`updateState: 'pending'`) |
| M4 | "a refusal does not consume the request" | same line: `perl -0pi -e 's/const released = store\.releaseLease\(move\.nodeId, action\.to, action\.detail, null\);/const released = store.settleNode(move.nodeId, action.detail, null);/'` | `grep -c 'const released = store.settleNode(move.nodeId, action.detail, null);' src/update/converge.ts` | "busy → idle …" and "disconnected during the send …" (`requestedTag: null`) |
| M5 | "the deadline bounds a node that never wrote" (computed from the report alone) | `src/update/converge.ts`: `perl -0pi -e 's/if \(!deadlineExpired\(row, now, deps\.deadlineMs\)\) continue;/if (!deadlineExpired({ ...row, updateStartedAt: null }, now, deps.deadlineMs)) continue;/'` | `grep -c 'updateStartedAt: null }, now, deps.deadlineMs' src/update/converge.ts` | "a lease whose node never wrote a report stands at deadline − 1 …" (`before.expired` is `[FLEET_ID]`) |
| M6 | "`bad-request` from an advertising agent halts" | `src/update/dispatch.ts`: `perl -0pi -e 's/return advertised\n/return false\n/'` | `grep -c '^    return false$' src/update/dispatch.ts` | `update-op-answer.test.ts` "from an agent that ADVERTISES the op"; `update-converge.test.ts` "bad-request from an agent whose LIVE ops name the op …" (`to: 'idle'`) |
| M7 | "an agent without the op is never sent it" (the live re-check, D-3398) | `src/update/converge.ts`: `perl -0pi -e 's/\n  if \(\!liveOps\(deps\.fleet\.state\)\.includes\(UPDATE_OP\)\) return dispatchRefusalDetail\(\x27agent-predates-update-op\x27, view, move\.target\);//'` | `grep -c "dispatchRefusalDetail('agent-predates-update-op'" src/update/converge.ts` must print `0` | "a row that advertises the op while the LIVE link does not …" (`h.sent` has one frame) |
| M8 | "one dispatch per sweep" (single-flight) | `src/watch.ts`: `perl -0pi -e 's/\n    if \(this\.dispatchRun !== null\) \{\n      this\.dispatchAgain = true;\n      return this\.dispatchRun;\n    \}//'` | `grep -c 'this.dispatchAgain = true;' src/watch.ts` must print `0` | "a run acquires in the caller's own turn; two triggers …" (`once` called 3 times; `dispatchNow()` not `toBe(first)`) |
| M9 | an inventory run ends in a dispatch run | `src/watch.ts`: `perl -0pi -e 's/\n    this\.triggerDispatch\(\);\n    return outcomes;/\n    return outcomes;/'` | `grep -c 'this.triggerDispatch()' src/watch.ts` must print `1` | "an inventory run ends in exactly one dispatch run" (`once` called 0 times) |
| M10 | D-3384 | `src/update/converge.ts`: `perl -0pi -e 's/\n  if \(busy \!== null\) return \{ kind: \x27refused\x27, err: \x27busy\x27, detail: inFlightSentence\(busy\) \};//'` | `grep -c 'if (busy !== null)' src/update/converge.ts` must print `0` | "an in-flight update.json on the server box answers busy …" (`h.spawned` has one entry) |
| M11 | Review Focus 4 (the spawn bound) | `src/update/converge.ts`: `perl -0pi -e 's/resolve\(TIMED_OUT\), UPDATE_SPAWN_TIMEOUT_MS\)/resolve(TIMED_OUT), UPDATE_SPAWN_TIMEOUT_MS * 2)/'` | `grep -c 'UPDATE_SPAWN_TIMEOUT_MS \* 2' src/update/converge.ts` | "a spawn whose parent never exits is answered `timeout` exactly at …" (`expected false to be true`) |
| M12 | D-3377 | `src/update/converge.ts`: `perl -0pi -e 's/\n  const got = store\.dispatchNode\(/\n  await Promise.resolve();\n  const got = store.dispatchNode(/'` | `grep -c 'await Promise.resolve();' src/update/converge.ts` | "runDispatch plans once, acquires once, and holds no await anywhere above the acquire" |
| M13 | the `never` arm (D-3370) | `../shared/agent-protocol.ts`: `perl -0pi -e "s/\['bad-tag', 'bad-kind', 'busy', 'spawn-failed'\] as const/['bad-tag', 'bad-kind', 'busy', 'spawn-failed', 'x'] as const/"` | `grep -c "'spawn-failed', 'x'\] as const" ../shared/agent-protocol.ts` | `./node_modules/.bin/tsc --noEmit -p .` exits non-zero with `error TS2322` at `src/update/dispatch.ts`'s `const unhandled: never = err;`; `update-op-answer.test.ts` "has a row for exactly the words the op answers with" |
| M14 | D-3397 | `src/server.ts`: `perl -0pi -e 's/  updateRunner\?: LocalUpdateSpawn;/  updateRunner?: import("\.\/exec\.js").Runner;/'` | `grep -c 'updateRunner?: import("./exec.js").Runner;' src/server.ts` | `test/typecheck-tests.test.ts` (TS2578 "Unused '@ts-expect-error' directive" in `update-converge.test.ts`, beside TS2322 at `src/watch.ts`'s `runLocal: updateRunner ?? null`, at both of `src/index.ts`'s `updateRunner: localUpdateSpawnFor(realRunner, cfg.home),` lines, and at `watcherFor`'s `updateRunner:` in `update-converge.test.ts`) |
| M15 | the remote arm is wired | `src/index.ts`: `perl -0pi -e "s/\n    sendUpdateOp: \(tag, kind\) => fleet\.client\.request\(\{ t: 'req', op: 'update', tag, kind \}, UPDATE_OP_TIMEOUT_MS\),//"` | `grep -c 'sendUpdateOp:' src/index.ts` must print `0` | "names updateRunner in both deps literals and sendUpdateOp …"; `tsc --noEmit` stays exit 0 (`Deps.sendUpdateOp` is optional — the gap this text pin exists for) |
| M16 | D-3398 — the no-link-wired arm | `src/update/converge.ts`: `perl -0pi -e 's/if \(deps\.fleet === null\) return NO_FLEET_LINK_DETAIL;/if (deps.fleet === null) return null;/'` (only `unsendableDetail`'s line carries that text; `linkAnswer`'s own null arm is untouched) | `grep -c 'if (deps.fleet === null) return null;' src/update/converge.ts` | "no fleet link wired at all → …" (`result: 'released'` — the skeleton's acquire-then-fail shape: the lease is taken and `linkAnswer`'s arm releases it `idle`) |
| M17 | D-3400 — the check | `src/update/converge.ts`: `perl -0pi -e 's/\n  if \(spawning\.has\(spawn\)\) return \{ kind: \x27refused\x27, err: \x27busy\x27, detail: LOCAL_SPAWNING_DETAIL \};//'` | `grep -c 'spawning.has(spawn)' src/update/converge.ts` must print `0` | "a spawn whose parent never exits …" (`expected [ …(2) ] to have a length of 1` right after the second run starts — a second parent spawned beside the parked one) |
| M18 | D-3400 — cleared by the child's exit, never by the bound | `src/update/converge.ts`: `perl -0pi -e 's/  child\.then\(clear, clear\);/  void withinSpawnDeadline(child).then(clear, clear);/'` | `grep -c 'void withinSpawnDeadline(child).then(clear, clear);' src/update/converge.ts` | the same case, the same assertion (the gate opened at `UPDATE_SPAWN_TIMEOUT_MS` while the parent still ran) |
| M19 | the bounded busy read (the server's twin of Task 2's `O_NONBLOCK` rule) | `src/update/converge.ts`: `perl -0pi -e 's/await readNodeFile\(deps\.localIo, path\.join\(deps\.ccrcDir, NODE_FILES\.report\), deadline\)/await deps.localIo.readFileMeasured(path.join(deps.ccrcDir, NODE_FILES.report))/'` | `grep -c 'await deps.localIo.readFileMeasured(' src/update/converge.ts` | run THIS row as `timeout 180 ./node_modules/.bin/vitest run test/update-converge.test.ts -t 'a FIFO planted'`: red is the case failing on the 20 s `testTimeout`, or the run killed by `timeout` (exit 124 — the blocked `open(2)` holds a libuv worker thread and can hold the process open); exit 0 measured nothing. Then `pgrep -f '[v]itest run test/update-converge'` must print nothing (kill any worker left behind before the next row); the FIFO's `mkTmp` directory may survive a killed run — remove it by hand |

Two rows of this task's §18 list are pinned here by a SIBLING's mutation, not by a row above: "a provenance refusal does not halt" (Task 4's "fold the prefix test into `failed`" also reds this file's provenance-failed case) and "an agent without the op is never sent it" for a row measured `agentOps: []` (Task 4's "drop the `agentOps` check" also reds "a row measured with agentOps [] gets no frame"). Run `test/update-converge.test.ts` under each of Task 4's two mutations while measuring them there, and record both reds.

- [ ] **Step 13: Commit**

```bash
git add server/src/update/dispatch.ts server/src/update/converge.ts server/src/watch.ts server/src/server.ts \
  server/src/index.ts server/test/single-definition.test.ts server/test/update-op-answer.test.ts \
  server/test/update-converge.test.ts
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts && cd ..
git commit -m "feat(update): the dispatcher's act — runDispatch acquires one lease, sends the op or spawns locally, maps the answer; single-flight after every sweep"
```

### Task 6: The routes

**Files:**
- Modify: `server/src/update/routes.ts` — `APPLY_BODY_KEYS`, `ROLLBACK_BODY_KEYS`, `parseApplyBody`, `parseRollbackBody` (and the module-private `tagField`, `tagOrNull`, `NO_HALT`, `routeWord`, `skipWord`, `singleNodeMove`, `requestAll`, `requestRefusal`) directly after W2's `parseAckBody`; the two registrations directly after W2's `app.post('/api/updates/ack', …)` handler's closing `});` and BEFORE the projection read, which stays LAST; W2's intent handler gains `watcher?.triggerDispatch();` after its `await reproject(req);` (quoted with its following comment line, below); the module docstring's three numerals and `registerUpdateRoutes`' `sessionAuth` docstring numeral, in place, line for line (*correction*: W2's docstring says "Four routes are session-only" and "The fifth, the projection read" — false once this task lands); imports: `dispatchViewsFor` (`./converge.js`), `dispatchRefusalDetail`, `fleetGate`, `moveRefusal`, `type FleetGate` (`./dispatch.js`), `CoordStore`, `RequestNodeResult` (`../coord/store.js` — W2's line there is the VALUE import `import { NODE_ID_RE, type NodeRow, … } from '../coord/store.js';`, so the two names go in WITH an inline `type` each: `type CoordStore`, `type RequestNodeResult`), and `isReleaseTag` (W2's routes.ts does not import it: its one tag check is `isIngestibleReleaseTag` from `./resolve.js`, D-3216), `SETTLED_UPDATE_STATES`, `compareDispatchOrder`, `type DispatchRefusal`, `type MoveRequestAnswer`, `type MoveSkip`, `type MoveSkipWhy`, `type RequestKind` (`../../../shared/api.js`, a value import with inline types), merged into the existing import lines in place
- Modify: `shared/api.ts` — W2's `UpdateRouteError` union widened IN PLACE: its last line (quoted: `  | 'journal-unreadable' | 'journal-unwritable';`) loses its `;` and one line follows it, `  | Exclude<DispatchRefusal, 'no-update-gate' | 'waiting-for-fleet'> | 'no-previous' | 'no-desired';` (inside the end-of-file block — every W2 line there is below `:7526`, R13); `ApplyUpdateBody`, `RollbackUpdateBody`, `MoveSkipWhy`, `MoveSkip`, `MoveRequestAnswer` APPENDED after the file's last line (Task 4's `compareDispatchOrder`) — *correction*: `MoveSkipWhy` is new and `MoveSkip.why` is widened to it (D-3401)
- Modify: `pwa/src/lib/api.ts` — `UPDATE_ERROR_TEXT` gains one sentence per new `UpdateRouteError` word, directly after its `'journal-unwritable'` entry (its `Record<Exclude<UpdateRouteError, 'unauthenticated'>, string>` makes the widening a compile error without them, D-3302); no route literal is added (wave 3's census "spells exactly the four W2 update routes — no apply, no rollback" is Task 8's to rewrite and stays green here)
- Modify: `pwa/test/api.test.ts` — *correction* (the skeleton said only "its census follows"): wave 3's `SENTENCES` table (typed by the same `Record`, so it too is a compile error until it moves) gains the same eleven entries after its `'journal-unwritable'` entry; `expect(entries, 'guards the guard — an empty census passes everything').toHaveLength(12);` → `23`; `expect(updateOnly, 'guards the guard').toHaveLength(10);` → `21` and its comment's "The ten words" → "The twenty-one words" (eleven because `DispatchRefusal` carries `floor-unread`, D-3492)
- Modify: `server/src/auth/gate.ts` — the header's digit claim (quoted after W2: ` * THE GATE. One `onRequest` hook stands in front of all 83 routes, the static`) → `85`; nothing else in the file (no `EXEMPT` entry, no lane word)
- Modify: `server/test/auth-gate.test.ts` — `expect(scanRoutes('update/routes.ts').length).toBe(5);` → `7` with a comment naming `POST /api/updates/apply` and `POST /api/updates/rollback`; `expect(ROUTES.length).toBe(86);` → `88` (comment `86 -> 88`); the registration key array gains `'POST /api/updates/apply', 'POST /api/updates/rollback',` on a new line after W2's `'POST /api/updates/ack', 'GET /api/updates/intent/:nodeId',`; the table parser's comment `// 86 scanned + the static wildcard when the bundle is built.` → `88`; the two D-1223 digit comments (`all 83 HTTP routes`) → `85` (the `32 exempt` beside the second is unchanged); the `EXEMPT` key list and `EXEMPT_BUT_AUTHENTICATED` UNCHANGED
- Modify: `server/test/box-token-census.test.ts` — `UPDATE_DOORS` gains `'/api/updates/apply', '/api/updates/rollback'` and its docstring's "the FOUR the W2 wave registers of §12's six" / "Programme wave 5 (spec W4 part B) appends …" sentences become the census of six; the ack-anchored planted-call control is duplicated for the `apply` registration line; `ALL_LANES`' `+ 3` UNCHANGED
- Modify: `CLAUDE.md` — the box-token bullet's update sentence (quoted from W2 Task 13, below) names `POST /api/updates/apply` and `POST /api/updates/rollback` and drops the "(programme wave 5, spec W4 part B, adds …)" parenthesis; seven lines for seven (line-neutral); no capitalised number word (`coord-pause-route.test.ts`'s `CARD_RE`). Lands HERE, not in Task 9, because `box-token-census.test.ts`'s "names every update route" reds in this commit without it
- Test: `server/test/update-apply-routes.test.ts` (create); `server/test/update-routes.test.ts` (W2 Task 13's file as wave 3 Task 3 leaves it) — W2's vitest import already carries `vi` (`import { describe, it, expect, afterEach, vi } from 'vitest';`, no edit); two import lines (`import { DETACH_CAP } from '../src/update/dispatch.js';` and `import { localUpdateSpawnFor, type LocalUpdateSpawn } from '../src/update/converge.js';`) after W2's `import { UPDATE_GATE_CAP } from '../src/update/resolve.js';`; `open()`'s options type (wave 3's line, ending `push?: { notify: (p: PushPayload) => Promise<void> } } = {},`) gains `updateRunner?: LocalUpdateSpawn`, in place, and its `deps` literal gains `...(o.updateRunner ? { updateRunner: o.updateRunner } : {}),` directly after wave 3's `...(o.push ? { push: o.push as never } : {}),` (no existing caller passes it, so every W2 and wave-3 case builds the same `deps`); and one describe appended after the file's last line (wave 3's appended `POST /api/updates/refresh announces what its poll listed` describe): an intent write that sets `auto` is followed in the same request by the lease acquire. *Correction, twice*: (1) the fixture plants the server's OWN row — `nodeId`/`label` `SERVER_LABEL`, `role: 'both'`, `agentOps: null`, caps carrying `update-gate` and `detach` — because without it W2's `ensureInventory` sweeps the fixture box, writes a capless server row, and the intent answers `409 auto-needs-rollback-gate`; (2) it plants NO fleet row and wires `updateRunner`, because Task 5's `runDispatch` decides sendability BEFORE the acquire (its step (5), `unsendableDetail`): in local mode no `sendUpdateOp` is wired, so a fleet-row move is noted `NO_FLEET_LINK_DETAIL` and takes no lease, and a server-row move with no `updateRunner` is noted `NO_LOCAL_RUNNER_DETAIL` and takes none either — the skeleton's fixture (a fleet row with `agentOps: ['update']`) would never acquire, and the case would stay red after this task
- Run, not edited: `server/test/coord-pause-route.test.ts`, `server/test/pools-prose.test.ts`, `server/test/session-hook.test.ts` (R13), `server/test/mail-routes.test.ts`, `server/test/single-definition.test.ts` (the update-ring scan over `routes.ts`, and Task 4's `DispatchRefusal` one-holder scan over `pwa/src`), `server/test/typecheck-tests.test.ts`, `server/test/topology-clean.test.ts` (after `git add`), `cd pwa && npm ci && npm run build`, `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts`; README is NOT edited here (D-3388) and `box-token-census.test.ts`'s "README states the DERIVED lane counts" is the proof

**Interfaces:**
- Consumes: W2 Task 13's `registerUpdateRoutes(app, deps, sessionAuth, watcher?)`, `refuse(reply, code, body)`, `reproject(req)`, the `501 not-configured` stance (`!deps.coord`); W2's `node()`, `nodes()`, `resolveInputFor` (`./project.js` — the ONE `ReleaseRow` → `EligibilityRow` mapping; *correction*: `dispatchViewsFor` answers views only and a `DispatchRow` is not a `NodeRow`, so the route takes `releases` from `resolveInputFor(coord, row).releases` rather than writing a second mapping), `SETTLED_UPDATE_STATES`, `isReleaseTag`; Task 3's `requestNode`, `RequestNodeResult`, `noteDispatchRefusal` (`{all: true}`'s skip note — D-3375's writer: `updateDetail` only, an `idle` row only, once per text), `dispatchNode` (tests only); Task 4's `moveRefusal`, `fleetGate`, `dispatchRefusalDetail`, `planDispatch` (tests only), `FleetGate`, `DispatchRefusal`, `compareDispatchOrder`, `DETACH_CAP`, `ROLLBACK_CAP`; Task 5's `dispatchViewsFor`, `FleetWatcher.triggerDispatch()`, `Deps.updateRunner?: LocalUpdateSpawn` (*correction*: NOT a raw `Runner`, D-3397 — the tests build it with `localUpdateSpawnFor(runner, cfg.home)`, as `index.ts` does), `localUpdateSpawnFor`, `LocalUpdateSpawn` (tests only), and `runDispatch`'s order (sendability decided before `dispatchNode`: a move with no link or no local spawner takes no lease); Task 1's `updateLauncherPath`, `updateSpawnArgv` (tests only); `UpdateRouteError`, `UpdateRouteRefusal`, `UPDATE_DOORS`, `UPDATE_ERROR_TEXT`.
- Produces (in `shared/api.ts`):

```ts
export type UpdateRouteError =
  | 'unauthenticated' | 'not-configured' | 'bad-tag' | 'bad-request' | 'unknown-scope' | 'unknown-node'
  | 'superseded' | 'busy' | 'auto-needs-rollback-gate' | 'rate-limited' | 'no-channel'
  | 'journal-unreadable' | 'journal-unwritable'
  | Exclude<DispatchRefusal, 'no-update-gate' | 'waiting-for-fleet'> | 'no-previous' | 'no-desired';   // wave 5
export type ApplyUpdateBody = ({ nodeId: string } | { all: true }) & { tag?: string };
export interface RollbackUpdateBody { nodeId: string; to?: string }
/** CORRECTED (D-3401): the dispatcher's own per-node refusal with the halt set aside, or no tag. */
export type MoveSkipWhy = Exclude<DispatchRefusal, 'halted' | 'no-update-gate' | 'no-rollback-cap' | 'waiting-for-fleet'> | 'no-desired';
export interface MoveSkip { nodeId: string; why: MoveSkipWhy }
/** spec §12's `202 {requested}`, plus `skipped` (D-3385); a single-node move answers skipped: []. */
export interface MoveRequestAnswer { ok: true; requested: string[]; skipped: MoveSkip[] }
```

- Produces (in `server/src/update/routes.ts`):

```ts
export const APPLY_BODY_KEYS = ['nodeId', 'all', 'tag'] as const;
export const ROLLBACK_BODY_KEYS = ['nodeId', 'to'] as const;
export type ParsedApplyBody =
  | { ok: true; target: { nodeId: string } | { all: true }; tag: string | null }
  | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };
export function parseApplyBody(body: unknown): ParsedApplyBody;         // exactly one of nodeId (non-empty string) / all (=== true) — both → bad-request 'all', neither → 'nodeId'; an unknown key → bad-request; tag: absent → null, a string `isIngestibleReleaseTag` refuses (off RELEASE_TAG, over 64 bytes, or a leading-zero component — D-3216) → bad-tag, anything else (null included) → bad-request 'tag'
export type ParsedRollbackBody =
  | { ok: true; nodeId: string; to: string | null }
  | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };
export function parseRollbackBody(body: unknown): ParsedRollbackBody;   // the same field rules, keys nodeId / to
```

- The route contract (every refusal body is `UpdateRouteRefusal`; `triggerDispatch()` after every successful request write, synchronously, before the reply — "a request write triggers dispatch in the same turn"; neither route calls `reproject` — a request changes no resolution input):

  | Route | Answers | Credential |
  |---|---|---|
  | `POST /api/updates/apply` | `202 MoveRequestAnswer` · `400 bad-tag` / `bad-request {field}` · `404 unknown-node` · for a single node `409 superseded {detail}` / `no-desired {detail?}` / `busy {detail: state}` (D-3386) / `halted {detail: the halting nodeIds}` / `unknown-tag` / `not-newer` / `stamp-unread` / `floor-unread` (D-3492) / `refused-by-node` (D-3394) / `no-detach-cap` / `agent-predates-update-op` — each with `detail: dispatchRefusalDetail(…)` — `{all: true}` always `202` · `501 not-configured` | session |
  | `POST /api/updates/rollback` | `202 MoveRequestAnswer` · `400 bad-tag` / `bad-request {field}` · `404 unknown-node` · `409 superseded` / `no-previous` / `busy` / `halted` / `unknown-tag` (yanked permitted) / `refused-by-node` / `no-detach-cap` / `no-rollback-cap` / `agent-predates-update-op` (D-3387) · `501` | session |

- Single-node predicate (`singleNodeMove`, shared by both routes): `node(nodeId)` (404 / 409 superseded) → the target (`tag`/`to`, else `desiredTag` for apply — `409 no-desired` with `detail: resolveDetail` when NULL — or `previousVersion` for rollback — `409 no-previous` when NULL; each read through `isReleaseTag`) → the node's OWN lease (`updateState` not in `SETTLED_UPDATE_STATES` → `409 busy`) → `moveRefusal(view, {kind, target, source: 'request'}, resolveInputFor(coord, row).releases, fleetGate(views.map(v => v.row)))` over `dispatchViewsFor(coord)` — the dispatcher's own function, never a copy; *correction*: the route does NO catalogue pre-check of its own (the skeleton's "apply first checks the tag is a listed, unyanked, unrefused releases row" would be a second copy of `moveRefusal`'s `unknown-tag`/`refused-by-node` arms). `{all: true}` (`requestAll`): every live row in `compareDispatchOrder`; target `tag` else `desiredTag` (none → skipped `no-desired`); `moveRefusal(…, NO_HALT)` non-null → skipped with that word AND, for every word but `not-newer`, noted on the row through `noteDispatchRefusal(row.nodeId, dispatchRefusalDetail(refusal, view, target))` — *correction* (review): spec §12 has `{all: true}` "report per-node refusals through `updateDetail` as the dispatcher reaches each", but a skipped node gets no request, so `planDispatch` never considers it and `runDispatch`'s step (4) never notes it; without the route's own note the refusal would reach only the 202's `skipped` and nothing the inventory shows. `not-newer` is not noted: a node already at or past the tag was not refused, it is there (the dispatcher's own equal-tag case is `met`, never a refusal), and its row already reads what it runs. The writer answers `not-idle` for a `failed`/`reverted`/busy row, so a verdict or a lease keeps its detail, and `changed: false` for a repeated text; any other refusal is thrown (unreachable in the same synchronous read, like `requestNode`'s); else `requestNode` → `requested`.
- Cases (spec §12 Pins): `apply` with `tag` older than current → `409 not-newer`; on an unversioned node with no floor and any eligible tag → `202`; on a node rolled back below its floor, a tag at or below the floor → `409 not-newer` naming the floor, and `{all: true}` skips it `not-newer` (D-3403, Task 4's `floorOf` rule); a `tag` failing the shape → `400 bad-tag`; a single-node `apply` on a halted fleet → `409 halted` in the same request, and `{all: true}` on the same fleet → `202` with the requests written; `apply` without `tag` requests the node's `desiredTag`, with `tag` the named tag and not the resolved newest; `rollback` without `to` on `previousVersion NULL` → `409 no-previous`; with a tag no `releases` row names → `409 unknown-tag`; with a yanked row → `202`; with a tag this node refused → `409 refused-by-node`, another node's refusal ignored; own row `pending` → `409 busy`, the other row `pending` → `202`; `{all: true, tag}` over a current, an unreadable and two behind nodes → `requested` names the behind ones fleet-first, `skipped` the others; a node that can never run the op is skipped and the server behind it plans a move; a node whose floor was never measured answers `409 floor-unread`, never `stamp-unread` (the agreement table's row); a skipped node's refusal is in its row's `updateDetail` (`no-detach-cap — …`, `stamp-unread — …`), a `not-newer` skip leaves the row's detail as it was, and a skipped row holding a `failed` verdict keeps its verdict's detail; after a `202` the node row is already `pending` when the reply is read; a route `409` and `planDispatch` agree on one fixture table; armed + no session → `401`; the box token alone → `401`; a `mail-token` header beside a session is ignored; armed + a live session from a foreign `Origin` → `403 {ok: false, error: 'foreign-origin'}` on both moves with nothing written, and the same cookie from the box's own origin → `202` (spec §12: "being non-GET they get the CSRF origin check for free" — measured, not assumed: `needsOriginCheck` is an EXEMPT allow-list, and `auth-passkey.test.ts`'s `BODYLESS_WRITES` names neither move; Fastify parses `text/plain`, so a bare form can send either body).
- Spec §18 rows pinned: "`apply` names a tag", "`apply` refuses an older tag; an unversioned node is never "not newer"" (the route half), "`rollback` is catalogue-gated and defaults to `previous`", "a request write triggers dispatch", "six session doors, one dual-credential read", "no write route takes the box token", "every capability refusal is in the dispatcher" (the route calls `moveRefusal`, and the agreement table reds when a route-only check stands in for it).

- [ ] **Step 1: Re-measure the merged tree before editing**

Run, from the repo root, each on its own:

```bash
grep -c "app\.\(get\|post\)('/api/updates" server/src/update/routes.ts
grep -n "expect(scanRoutes('update/routes.ts').length).toBe(5);\|expect(ROUTES.length).toBe(86);\|// 86 scanned + the static wildcard\|over all 83 HTTP routes\|covers all 83 HTTP routes, not the 32 exempt" server/test/auth-gate.test.ts
grep -n "stands in front of all 83 routes" server/src/auth/gate.ts
grep -n "^const UPDATE_DOORS = " server/test/box-token-census.test.ts
grep -c "^  | 'journal-unreadable' | 'journal-unwritable';$" shared/api.ts
grep -n "triggerDispatch(): void" server/src/watch.ts
grep -n "export function dispatchViewsFor" server/src/update/converge.ts
grep -n "export function moveRefusal\|export function fleetGate\|export function dispatchRefusalDetail\|export function planDispatch\|export const DETACH_CAP\|export const ROLLBACK_CAP\|export interface FleetGate" server/src/update/dispatch.ts
grep -n "  requestNode(nodeId: string, tag: string, kind: RequestKind, at: number): RequestNodeResult" server/src/coord/store.ts
grep -n "updateRunner?: LocalUpdateSpawn;" server/src/server.ts
grep -n "export function localUpdateSpawnFor" server/src/update/converge.ts
grep -n "export function compareDispatchOrder\|export type DispatchRefusal" shared/api.ts
grep -n "^import { UPDATE_GATE_CAP } from '../src/update/resolve.js';$\|push?: { notify: (p: PushPayload) => Promise<void> } } = {},$\|^    ...(o.push ? { push: o.push as never } : {}),$\|^describe('POST /api/updates/refresh announces what its poll listed" server/test/update-routes.test.ts
```

Expected: `5`; five hits in `auth-gate.test.ts` (one per pattern); one hit in `gate.ts`; one `UPDATE_DOORS` line with the four W2 paths; `1`; one hit each for the Task 1–5 exports; and four hits in `update-routes.test.ts`, one per pattern, the `describe` the LAST of them (nothing is appended after wave 3's describe but its closing `});`). Any other answer means a producer landed differently from its plan: stop and re-read the landed code before writing a line — every edit below is anchored on these texts.

- [ ] **Step 2: Write the failing tests**

Create `server/test/update-apply-routes.test.ts`:

```ts
// Update-management programme wave 5, Task 6 (design 2026-09-20 §12): the two
// MOVE routes — `POST /api/updates/apply` and `POST /api/updates/rollback`.
//
// What is measured here is the ROUTE: its body grammar; its single-node 409s,
// which must be the dispatcher's own `moveRefusal` answered synchronously — so
// one table below runs `planDispatch` over the same rows and compares words;
// the `{all: true}` fan-out and what it skips; the same-turn dispatch trigger;
// and the credential (a session; the box token is never a way in).
//
// Every row is planted through the store's own writers: `upsertNodeMeasurement`
// for the measured columns, `resolveNode` for a resolved desired, `rekeyNode`
// for a superseded row, `refuseRelease` for a refusal, and `dispatchNode` /
// `releaseLease` for a lease — no hand-written UPDATE. Every box is a `mkTmp`
// fixture home; the one spawn a case reaches is an injected `Runner`, behind
// `localUpdateSpawnFor` exactly as `index.ts` builds `Deps.updateRunner`, that
// records its argv and answers only when the test says so.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type ExecResult, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { UPDATE_GATE_CAP } from '../src/update/resolve.js';
import { resolveInputFor } from '../src/update/project.js';
import { DETACH_CAP, ROLLBACK_CAP, planDispatch } from '../src/update/dispatch.js';
import { dispatchViewsFor, localUpdateSpawnFor } from '../src/update/converge.js';
import { parseApplyBody, parseRollbackBody } from '../src/update/routes.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { updateLauncherPath, updateSpawnArgv } from '../../shared/agent-protocol.js';
import type { MoveRequestAnswer, RequestKind } from '../../shared/api.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
/** Cheap-cost scrypt — `update-routes.test.ts`'s ARMED fixture. */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
/** A same-site page on another host — `auth-passkey.test.ts`'s CSRF sibling. */
const SIBLING = 'https://other-box.example.com';
/** Node-ids in `_inst_node_id`'s lowercase shape (`NODE_ID_RE`). */
const FLEET_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const OTHER_ID = '1f1e1d1c-1b1a-4918-9716-151413121110';
const SERVER_ID = '2f2e2d2c-2b2a-4928-a726-252423222120';
const THIRD_ID = '3f3e3d3c-3b3a-4938-b736-353433323130';

/** The three W1 words plus wave 4's four: a node that can take every move. */
const MOVE_CAPS: readonly string[] = ['verify', 'node-id', 'floor', 'update-json', UPDATE_GATE_CAP, ROLLBACK_CAP, DETACH_CAP];
const without = (word: string): string[] => MOVE_CAPS.filter((w) => w !== word);

const failingRunner: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

/** A W4-era fleet node: its agent advertises the op, it runs v0.0.9, and its previous install was v0.0.8. */
const fleetNode = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main',
  currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: MOVE_CAPS, agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8',
  floorRead: 'measured', previousRead: 'measured',
  os: 'linux', measuredAt: 1_000, report: null,
  ...over,
});
/** The server's own row: `agentOps` NULL — no agent by construction (decision 11). */
const serverNode = (over: Partial<NodeMeasurement> = {}): NodeMeasurement =>
  fleetNode({ nodeId: SERVER_ID, role: 'server', label: SERVER_LABEL, agentOps: null, ...over });
/** A stamp that could not be read: the `current*` columns say nothing about what runs. */
const UNREAD: Partial<NodeMeasurement> = {
  stampRead: 'unreadable', currentVersion: null, currentSha: null, currentRef: null,
  currentBuiltAt: null, currentDirty: null,
};

const plant = (coord: CoordStore, m: NodeMeasurement): void => {
  const r = coord.upsertNodeMeasurement(m);
  expect(r.ok, `planting ${m.nodeId}: ${JSON.stringify(r)}`).toBe(true);
};

const rel = (tag: string, channel: 'stable' | 'dev', publishedAt: number, draft = false): ReleaseListingRow => ({
  tag, channel, publishedAt, commitSha: null, tarballUrl: `https://example.invalid/ccrc-${tag}.tar.gz`,
  bundleListed: true, notes: null, draft,
});
/** v0.0.7 and v0.0.12 arrive as drafts, which the catalogue stores YANKED (W2 Task 4's `yanked = draft`). */
const LISTING: readonly ReleaseListingRow[] = [
  rel('v0.0.7', 'stable', 1_000, true), rel('v0.0.8', 'stable', 1_100), rel('v0.0.9', 'stable', 1_200),
  rel('v0.0.10', 'stable', 1_300), rel('v0.0.11', 'dev', 1_400), rel('v0.0.12', 'stable', 1_500, true),
];
const catalogue = (coord: CoordStore): void => {
  const r = coord.applyReleaseListing(LISTING, 4_000, 'complete');
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(coord.releases().filter((x) => x.yanked).map((x) => x.tag).sort(), 'the two drafts must read yanked')
    .toEqual(['v0.0.12', 'v0.0.7']);
};

/** A resolved desired, written by the resolver's own writer (no resolution runs in these fixtures). */
const desire = (coord: CoordStore, nodeId: string, desiredTag: string | null, resolveDetail: string | null = null): void => {
  expect(coord.resolveNode(nodeId, { channel: 'stable', desiredTag, resolveDetail }).ok).toBe(true);
};
/** A busy lease, taken by the ONE acquire (Task 3). */
const hold = (coord: CoordStore, nodeId: string): void => {
  expect(coord.dispatchNode(nodeId, 'v0.0.10', 'update', 5, 'fixture lease')).toEqual({ ok: true });
};
/** A settled `failed` verdict: acquired, then released by W2's writer with the detail the halt reads. */
const verdict = (coord: CoordStore, nodeId: string, detail: string): void => {
  hold(coord, nodeId);
  expect(coord.releaseLease(nodeId, 'failed', detail, null)).toEqual({ ok: true, state: 'failed' });
};

/** A `Runner` that records its call and answers only when the test says so — the server-role
 *  local spawn parked mid-flight, so the lease can be read while it is still held. */
const heldRunner = () => {
  let answer!: (r: ExecResult) => void;
  const answered = new Promise<ExecResult>((resolve) => { answer = resolve; });
  const calls: [string, string[]][] = [];
  const runner: Runner = (cmd, args) => { calls.push([cmd, [...args]]); return answered; };
  return { runner, calls, release: (r: ExecResult): void => answer(r) };
};

interface Opened { app: FastifyInstance; coord: CoordStore; home: string }
const opened: { app: FastifyInstance; coord: CoordStore | null }[] = [];

afterEach(async () => {
  for (const o of opened.splice(0)) {
    await o.app.close();
    o.coord?.db.close();
  }
});

/** `watcher` off by default: a route case measures the request row, and with no watcher
 *  `watcher?.triggerDispatch()` is a no-op, so nothing moves the lease under it. */
const open = async (o: { auth?: boolean; watcher?: boolean; runner?: Runner } = {}): Promise<Opened> => {
  const home = mkTmp('ccrc-update-apply-');
  seedRoster(home);
  const cfg = { ...loadConfig({ CCRC_HOME: home }), authEnabled: o.auth ?? false };
  if (o.auth) {
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  }
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: Deps = {
    cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner), io: localIO,
    queue: new KeyedQueue(), mailToken: TOKEN, coord,
    updateIntentLog: new UpdateIntentLog(defaultUpdateIntentLogPath(cfg.ccrcDir)),
    // `Deps.updateRunner` is the two-template capability, never a raw Runner (Task 5,
    // D-3397): the recording Runner goes behind the same factory.
    ...(o.runner ? { updateRunner: localUpdateSpawnFor(o.runner, cfg.home) } : {}),
  };
  const bus = new Bus();
  // A REAL watcher, never started: the routes call its `triggerDispatch()` and nothing else.
  const watcher = o.watcher
    ? new FleetWatcher(deps, bus, 10_000, path.join(cfg.ccrcDir, 'state-cache.json'))
    : undefined;
  const app = await buildServer(deps, bus, watcher);
  await app.ready();
  opened.push({ app, coord });
  return { app, coord, home };
};

/** A box with no coordination database at all. */
const openBare = async (): Promise<FastifyInstance> => {
  const home = mkTmp('ccrc-update-apply-bare-');
  seedRoster(home);
  const cfg = { ...loadConfig({ CCRC_HOME: home }), authEnabled: false };
  const app = await buildServer({
    cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner),
    io: localIO, queue: new KeyedQueue(), mailToken: TOKEN,
  } as Deps);
  await app.ready();
  opened.push({ app, coord: null });
  return app;
};

const post = (app: FastifyInstance, url: string, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: body as never, headers });

const login = async (app: FastifyInstance): Promise<string> => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};

describe('the move bodies — one grammar per field', () => {
  it('apply: exactly one of nodeId / all, and an optional tag through the one guard', () => {
    expect(parseApplyBody({ nodeId: FLEET_ID })).toEqual({ ok: true, target: { nodeId: FLEET_ID }, tag: null });
    expect(parseApplyBody({ nodeId: FLEET_ID, tag: 'v0.0.10' }))
      .toEqual({ ok: true, target: { nodeId: FLEET_ID }, tag: 'v0.0.10' });
    expect(parseApplyBody({ all: true })).toEqual({ ok: true, target: { all: true }, tag: null });
    const bad: [unknown, string][] = [
      [null, 'body'], ['x', 'body'], [[FLEET_ID], 'body'],
      [{}, 'nodeId'], [{ nodeId: '' }, 'nodeId'], [{ nodeId: 7 }, 'nodeId'],
      [{ nodeId: FLEET_ID, all: true }, 'all'], [{ all: false }, 'all'], [{ all: 'yes' }, 'all'],
      [{ nodeId: FLEET_ID, force: true }, 'force'], [{ nodeId: FLEET_ID, tag: null }, 'tag'], [{ all: true, tag: 9 }, 'tag'],
    ];
    for (const [body, field] of bad) {
      expect(parseApplyBody(body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad-request', field });
    }
    for (const tag of ['0.0.9', 'v0.0.9 ', 'V0.0.9', 'v0.0', 'v0.0.9\n', '; rm -rf ~', 'v0.0.010']) {
      expect(parseApplyBody({ all: true, tag }), JSON.stringify(tag)).toEqual({ ok: false, error: 'bad-tag', field: 'tag' });
    }
  });

  it('rollback: a nodeId, and an optional to through the one guard', () => {
    expect(parseRollbackBody({ nodeId: FLEET_ID })).toEqual({ ok: true, nodeId: FLEET_ID, to: null });
    expect(parseRollbackBody({ nodeId: FLEET_ID, to: 'v0.0.8' })).toEqual({ ok: true, nodeId: FLEET_ID, to: 'v0.0.8' });
    const bad: [unknown, string][] = [
      [null, 'body'], [[FLEET_ID], 'body'], [{}, 'nodeId'], [{ nodeId: 7 }, 'nodeId'],
      [{ nodeId: FLEET_ID, all: true }, 'all'], [{ nodeId: FLEET_ID, tag: 'v0.0.8' }, 'tag'], [{ nodeId: FLEET_ID, to: null }, 'to'],
    ];
    for (const [body, field] of bad) {
      expect(parseRollbackBody(body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad-request', field });
    }
    for (const to of ['0.0.8', 'v0.0.8 ', 'v0.0.8\n']) {
      expect(parseRollbackBody({ nodeId: FLEET_ID, to }), JSON.stringify(to)).toEqual({ ok: false, error: 'bad-tag', field: 'to' });
    }
  });
});

describe('POST /api/updates/apply — one named node (spec §12)', () => {
  it('501 not-configured on a box with no coordination database', async () => {
    const app = await openBare();
    const r = await post(app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(r.statusCode).toBe(501);
    expect(r.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('requests the NAMED tag, not the resolved newest — and writes the request group only (§18 "apply names a tag")', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    desire(f.coord, FLEET_ID, 'v0.0.10');
    const before = f.coord.node(FLEET_ID)!;
    const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.11' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [FLEET_ID], skipped: [] } satisfies MoveRequestAnswer);
    const after = f.coord.node(FLEET_ID)!;
    expect(after).toMatchObject({ requestedTag: 'v0.0.11', requestedKind: 'update' });
    expect(after.requestedAt).toBeGreaterThan(0);
    // No watcher, so nothing dispatched: every other column is exactly what it was.
    expect({ ...after, requestedTag: null, requestedKind: null, requestedAt: null }).toEqual(before);
  });

  it("without tag, requests the node's resolved desiredTag", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    desire(f.coord, FLEET_ID, 'v0.0.10');
    const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID });
    expect(r.statusCode, r.body).toBe(202);
    expect(f.coord.node(FLEET_ID)).toMatchObject({ requestedTag: 'v0.0.10', requestedKind: 'update' });
  });

  it("409 no-desired with the resolver's own sentence when nothing resolved and no tag was named — nothing written", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    desire(f.coord, FLEET_ID, null, 'pinned v0.0.99: it is not in the release catalogue');
    const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'no-desired', detail: 'pinned v0.0.99: it is not in the release catalogue' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it('409 not-newer for a tag older than current; an unversioned node is never "not newer" (§18)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    // The stamp READ ok and carries no version, and no floor file: "never not newer" is the no-floor case
    // (an unversioned node WITH a floor is floor-bound, D-3403).
    plant(f.coord, serverNode({ currentVersion: null, highestVersion: null, floorRead: 'absent' }));
    const older = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.8' });
    expect(older.statusCode, older.body).toBe(409);
    expect(older.json()).toMatchObject({ ok: false, error: 'not-newer' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
    for (const tag of ['v0.0.8', 'v0.0.10']) {
      const r = await post(f.app, '/api/updates/apply', { nodeId: SERVER_ID, tag });
      expect(r.statusCode, `${tag}: ${r.body}`).toBe(202);
      expect(f.coord.node(SERVER_ID)!.requestedTag).toBe(tag);
    }
  });

  it("409 not-newer at or below a rolled-back node's FLOOR, naming it; {all: true} skips that node (D-3403)", async () => {
    const f = await open();
    catalogue(f.coord);
    // Rolled back from v0.0.10 to v0.0.8: the floor file keeps v0.0.10. Its ccrc would refuse v0.0.9 inside the
    // detached run, and the failed row that leaves would halt the fleet — so the route refuses it here instead.
    plant(f.coord, fleetNode({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.10', previousVersion: 'v0.0.10' }));
    for (const tag of ['v0.0.9', 'v0.0.10']) {
      const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag });
      expect(r.statusCode, `${tag}: ${r.body}`).toBe(409);
      expect(r.json()).toMatchObject({ ok: false, error: 'not-newer' });
      expect(r.json().detail, tag).toContain("floor v0.0.10 (it runs v0.0.8)");
    }
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
    const all = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.9' });
    expect(all.statusCode, all.body).toBe(202);
    expect(all.json()).toEqual({ ok: true, requested: [], skipped: [{ nodeId: FLEET_ID, why: 'not-newer' }] });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
    // Above the floor it moves (v0.0.11 is the dev release: the route checks direction, never the channel).
    const above = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.11' });
    expect(above.statusCode, above.body).toBe(202);
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBe('v0.0.11');
  });

  it('409 stamp-unread: a stamp that could not be read is never taken for unversioned (D-3379)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode(UNREAD));
    const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toMatchObject({ ok: false, error: 'stamp-unread' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it("409 unknown-tag for a tag no row names and for a yanked one; refused-by-node for this node's refusal only", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    for (const tag of ['v0.0.99', 'v0.0.12']) {
      const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag });
      expect(r.statusCode, `${tag}: ${r.body}`).toBe(409);
      expect(r.json()).toMatchObject({ ok: false, error: 'unknown-tag' });
    }
    expect(f.coord.refuseRelease(FLEET_ID, 'v0.0.10', 6, 'provenance: signature mismatch').ok).toBe(true);
    const refused = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ ok: false, error: 'refused-by-node' });
    // Decision 16: a refusal is keyed by the node that refused.
    const other = await post(f.app, '/api/updates/apply', { nodeId: OTHER_ID, tag: 'v0.0.10' });
    expect(other.statusCode, other.body).toBe(202);
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it('409 no-detach-cap; 409 agent-predates-update-op for a link-reached node — never for the server row (§18)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ caps: without(DETACH_CAP) }));
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other', agentOps: [] }));
    plant(f.coord, serverNode());
    const capless = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(capless.statusCode, capless.body).toBe(409);
    expect(capless.json()).toMatchObject({ ok: false, error: 'no-detach-cap' });
    const old = await post(f.app, '/api/updates/apply', { nodeId: OTHER_ID, tag: 'v0.0.10' });
    expect(old.statusCode, old.body).toBe(409);
    expect(old.json()).toMatchObject({ ok: false, error: 'agent-predates-update-op' });
    // agentOps NULL is "no agent by construction": spawned locally, never asked for an op word.
    const server = await post(f.app, '/api/updates/apply', { nodeId: SERVER_ID, tag: 'v0.0.10' });
    expect(server.statusCode, server.body).toBe(202);
  });

  it("409 halted in the same request, naming the halting row; a provenance verdict does not halt", async () => {
    const halted = await open();
    catalogue(halted.coord);
    plant(halted.coord, fleetNode());
    plant(halted.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    verdict(halted.coord, OTHER_ID, 'spawn-failed — update: fixture refusal');
    const r = await post(halted.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'halted', detail: OTHER_ID });
    expect(halted.coord.node(FLEET_ID)!.requestedTag).toBeNull();

    const verified = await open();
    catalogue(verified.coord);
    plant(verified.coord, fleetNode());
    plant(verified.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    verdict(verified.coord, OTHER_ID, 'provenance: signature mismatch');
    const ok = await post(verified.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(ok.statusCode, ok.body).toBe(202);
  });

  it("busy is the named node's OWN lease — another node's lease is a turn, not a refusal (D-3386)", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    hold(f.coord, FLEET_ID);
    const own = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(own.statusCode, own.body).toBe(409);
    expect(own.json()).toEqual({ ok: false, error: 'busy', detail: 'pending' });
    const other = await post(f.app, '/api/updates/apply', { nodeId: OTHER_ID, tag: 'v0.0.10' });
    expect(other.statusCode, other.body).toBe(202);
    expect(f.coord.node(OTHER_ID)!.requestedTag).toBe('v0.0.10');
    expect(f.coord.node(FLEET_ID)!.updateState, 'a request on another node touched the held lease').toBe('pending');
  });

  it('404 unknown-node; 409 superseded naming its successor; 400 bad-tag and bad-request naming the field', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ nodeId: FLEET_LABEL }));           // the pre-W1 label-keyed row
    plant(f.coord, fleetNode());
    expect(f.coord.rekeyNode(FLEET_LABEL, FLEET_ID)).toMatchObject({ ok: true, how: 'superseded' });
    const sup = await post(f.app, '/api/updates/apply', { nodeId: FLEET_LABEL, tag: 'v0.0.10' });
    expect(sup.statusCode).toBe(409);
    expect(sup.json()).toEqual({ ok: false, error: 'superseded', detail: FLEET_ID });
    const unknown = await post(f.app, '/api/updates/apply', { nodeId: 'no-such-node', tag: 'v0.0.10' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ ok: false, error: 'unknown-node' });
    const badTag = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10 ' });
    expect(badTag.statusCode).toBe(400);
    expect(badTag.json()).toEqual({ ok: false, error: 'bad-tag', field: 'tag' });
    const badBody = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, all: true });
    expect(badBody.statusCode).toBe(400);
    expect(badBody.json()).toEqual({ ok: false, error: 'bad-request', field: 'all' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });
});

describe('POST /api/updates/apply {all: true} — every live node the move takes forward', () => {
  it('requests only the nodes the tag moves forward, in DISPATCH order, and names the rest in skipped (D-3385)', async () => {
    const f = await open();
    catalogue(f.coord);
    // Labelled so that label order (nodes()'s) would put the server FIRST.
    plant(f.coord, fleetNode({ label: 'zeta-fleet' }));
    plant(f.coord, serverNode());
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other', currentVersion: 'v0.0.10' }));
    plant(f.coord, fleetNode({ nodeId: THIRD_ID, label: 'unread', ...UNREAD }));
    const atTag = f.coord.node(OTHER_ID)!.updateDetail;
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({
      ok: true, requested: [FLEET_ID, SERVER_ID],
      skipped: [{ nodeId: OTHER_ID, why: 'not-newer' }, { nodeId: THIRD_ID, why: 'stamp-unread' }],
    } satisfies MoveRequestAnswer);
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBe('v0.0.10');
    expect(f.coord.node(SERVER_ID)!.requestedTag).toBe('v0.0.10');
    expect(f.coord.node(OTHER_ID)!.requestedTag, 'a request the dispatcher can only refuse was written').toBeNull();
    expect(f.coord.node(THIRD_ID)!.requestedTag).toBeNull();
    // §12: the refusal is said where the operator reads the node — a node already at the tag is not refused.
    expect(f.coord.node(THIRD_ID)!.updateDetail, 'the unread node was skipped silently').toMatch(/^stamp-unread — /);
    expect(f.coord.node(OTHER_ID)!.updateDetail, 'a node already at the tag was told it was refused').toBe(atTag);
  });

  it("without tag, each node's OWN desiredTag; a node with none is skipped no-desired", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, serverNode());
    desire(f.coord, FLEET_ID, 'v0.0.10');
    desire(f.coord, SERVER_ID, null, 'no release is eligible on stable');
    const r = await post(f.app, '/api/updates/apply', { all: true });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [FLEET_ID], skipped: [{ nodeId: SERVER_ID, why: 'no-desired' }] });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBe('v0.0.10');
    expect(f.coord.node(SERVER_ID)!.requestedTag).toBeNull();
  });

  it('a node the dispatcher could never move is skipped with its refusal, so it cannot hold the server behind it (D-3401)', async () => {
    const f = await open();
    catalogue(f.coord);
    // A macOS fleet node: `--detach` is Linux-only (decision 17), so no `detach` word.
    plant(f.coord, fleetNode({ os: 'darwin', caps: without(DETACH_CAP) }));
    plant(f.coord, serverNode());
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [SERVER_ID], skipped: [{ nodeId: FLEET_ID, why: 'no-detach-cap' }] });
    // No request, so the dispatcher never reaches this node: the route notes it (spec §12's "per-node
    // refusals through updateDetail"), through the one writer the dispatcher uses.
    expect(f.coord.node(FLEET_ID)!.updateDetail, 'the skip was said nowhere the operator reads the node')
      .toMatch(/^no-detach-cap — /);
    // D-3381 defers a server move while ANY fleet row holds a request —
    // so a request written on the darwin row would have parked the server behind it for good.
    const plan = planDispatch({
      nodes: dispatchViewsFor(f.coord),
      releases: resolveInputFor(f.coord, f.coord.node(SERVER_ID)!).releases,
    });
    expect(plan.move?.nodeId, JSON.stringify(plan.refusals)).toBe(SERVER_ID);
  });

  it("a skipped node whose row holds a verdict keeps the verdict's detail — the note never overwrites it", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ caps: without(DETACH_CAP) }));
    // A provenance verdict: non-halting, and its `provenance:` prefix is what keeps it so.
    verdict(f.coord, FLEET_ID, 'provenance: signature mismatch');
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [], skipped: [{ nodeId: FLEET_ID, why: 'no-detach-cap' }] });
    expect(f.coord.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: 'provenance: signature mismatch' });
  });

  it('always 202 on a halted fleet, requests written — while a single-node apply on the same fleet is 409 halted', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    verdict(f.coord, OTHER_ID, 'spawn-failed — update: fixture refusal');
    const one = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(one.statusCode).toBe(409);
    expect(one.json()).toMatchObject({ error: 'halted' });
    const all = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(all.statusCode, all.body).toBe(202);
    expect((all.json() as MoveRequestAnswer).requested).toContain(FLEET_ID);
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBe('v0.0.10');
  });
});

describe('POST /api/updates/rollback (spec §12)', () => {
  it('without to, rolls back to the measured previousVersion', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    const r = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [FLEET_ID], skipped: [] });
    expect(f.coord.node(FLEET_ID)).toMatchObject({ requestedTag: 'v0.0.8', requestedKind: 'rollback' });
  });

  it('409 no-previous when previousVersion is NULL — the route never goes looking for one', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ previousVersion: null, previousRead: 'absent' }));
    desire(f.coord, FLEET_ID, 'v0.0.10');
    const r = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'no-previous' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it('409 no-previous on an UNMEASURED previous file says so — never read as "no previous install" (D-3213)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ previousVersion: null, previousRead: 'unmeasured' }));
    const r = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'no-previous', detail: 'the previous release has not been measured yet — name one with to' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it('catalogue-gated: a tag no releases row names → unknown-tag; a yanked row is permitted', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    const missing = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID, to: 'v0.0.5' });
    expect(missing.statusCode, missing.body).toBe(409);
    expect(missing.json()).toMatchObject({ ok: false, error: 'unknown-tag' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
    const yanked = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID, to: 'v0.0.7' });
    expect(yanked.statusCode, yanked.body).toBe(202);
    expect(f.coord.node(FLEET_ID)).toMatchObject({ requestedTag: 'v0.0.7', requestedKind: 'rollback' });
  });

  it("409 refused-by-node for this node's refusal; another node's refusal is not an input", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    expect(f.coord.refuseRelease(FLEET_ID, 'v0.0.8', 6, 'provenance: signature mismatch').ok).toBe(true);
    const own = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID, to: 'v0.0.8' });
    expect(own.statusCode, own.body).toBe(409);
    expect(own.json()).toMatchObject({ ok: false, error: 'refused-by-node' });
    const other = await post(f.app, '/api/updates/rollback', { nodeId: OTHER_ID, to: 'v0.0.8' });
    expect(other.statusCode, other.body).toBe(202);
  });

  it('409 no-rollback-cap, no-detach-cap and agent-predates-update-op — the words the dispatcher would say (D-3387)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ caps: without(ROLLBACK_CAP) }));
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other', caps: without(DETACH_CAP) }));
    plant(f.coord, fleetNode({ nodeId: THIRD_ID, label: 'third', agentOps: [] }));
    for (const [nodeId, error] of [[FLEET_ID, 'no-rollback-cap'], [OTHER_ID, 'no-detach-cap'], [THIRD_ID, 'agent-predates-update-op']] as const) {
      const r = await post(f.app, '/api/updates/rollback', { nodeId, to: 'v0.0.8' });
      expect(r.statusCode, `${nodeId}: ${r.body}`).toBe(409);
      expect(r.json()).toMatchObject({ ok: false, error });
      expect(f.coord.node(nodeId)!.requestedTag).toBeNull();
    }
  });

  it('409 halted and 409 busy, exactly as apply answers them', async () => {
    const halted = await open();
    catalogue(halted.coord);
    plant(halted.coord, fleetNode());
    plant(halted.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    verdict(halted.coord, OTHER_ID, 'reverted-looking failure — fixture');
    const h = await post(halted.app, '/api/updates/rollback', { nodeId: FLEET_ID });
    expect(h.statusCode, h.body).toBe(409);
    expect(h.json()).toEqual({ ok: false, error: 'halted', detail: OTHER_ID });

    const busy = await open();
    catalogue(busy.coord);
    plant(busy.coord, fleetNode());
    hold(busy.coord, FLEET_ID);
    const b = await post(busy.app, '/api/updates/rollback', { nodeId: FLEET_ID });
    expect(b.statusCode, b.body).toBe(409);
    expect(b.json()).toEqual({ ok: false, error: 'busy', detail: 'pending' });
  });

  it('400 bad-tag for a to off the tag shape; 404 unknown-node', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    const bad = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID, to: '0.0.8' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ ok: false, error: 'bad-tag', field: 'to' });
    const unknown = await post(f.app, '/api/updates/rollback', { nodeId: 'no-such-node' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ ok: false, error: 'unknown-node' });
  });
});

describe("the route and the dispatcher agree — one predicate, two callers (§18 \"every capability refusal is in the dispatcher\")", () => {
  // Each case: the route's single-node 409 word, then the SAME request written past the
  // route and planned. A route with a check of its own would answer a word the planner
  // does not — or, with the planner's check gone, the planner would MOVE a node the route refuses.
  const CASES: { name: string; kind: RequestKind; target: string; setup: (c: CoordStore) => void }[] = [
    { name: 'not-newer', kind: 'update', target: 'v0.0.8', setup: (c) => plant(c, fleetNode()) },
    { name: 'stamp-unread', kind: 'update', target: 'v0.0.10', setup: (c) => plant(c, fleetNode(UNREAD)) },
    // D-3492: the stamp read, the floor never did (W2 D-3213) — its own word, not stamp-unread.
    { name: 'floor-unread', kind: 'update', target: 'v0.0.10', setup: (c) => plant(c, fleetNode({ highestVersion: null, floorRead: 'unmeasured' })) },
    { name: 'no-detach-cap', kind: 'update', target: 'v0.0.10', setup: (c) => plant(c, fleetNode({ caps: without(DETACH_CAP) })) },
    { name: 'agent-predates-update-op', kind: 'update', target: 'v0.0.10', setup: (c) => plant(c, fleetNode({ agentOps: [] })) },
    { name: 'unknown-tag', kind: 'rollback', target: 'v0.0.5', setup: (c) => plant(c, fleetNode()) },
    { name: 'refused-by-node', kind: 'rollback', target: 'v0.0.8', setup: (c) => {
      plant(c, fleetNode());
      expect(c.refuseRelease(FLEET_ID, 'v0.0.8', 6, 'provenance: signature mismatch').ok).toBe(true);
    } },
    { name: 'no-rollback-cap', kind: 'rollback', target: 'v0.0.8', setup: (c) => plant(c, fleetNode({ caps: without(ROLLBACK_CAP) })) },
    { name: 'halted', kind: 'update', target: 'v0.0.10', setup: (c) => {
      plant(c, fleetNode());
      plant(c, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
      verdict(c, OTHER_ID, 'spawn-failed — update: fixture refusal');
    } },
  ];

  it.each(CASES)('$name: the route answers the word planDispatch refuses the same request with', async (c) => {
    const f = await open();
    catalogue(f.coord);
    c.setup(f.coord);
    const url = c.kind === 'update' ? '/api/updates/apply' : '/api/updates/rollback';
    const body = c.kind === 'update' ? { nodeId: FLEET_ID, tag: c.target } : { nodeId: FLEET_ID, to: c.target };
    const r = await post(f.app, url, body);
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().error).toBe(c.name);
    expect(f.coord.requestNode(FLEET_ID, c.target, c.kind, 9)).toMatchObject({ ok: true });
    const plan = planDispatch({
      nodes: dispatchViewsFor(f.coord),
      releases: resolveInputFor(f.coord, f.coord.node(FLEET_ID)!).releases,
    });
    expect(plan.move, 'the planner moved a node the route refused').toBeNull();
    expect(plan.refusals.find((p) => p.nodeId === FLEET_ID)?.refusal).toBe(c.name);
  });
});

describe('a request write dispatches in the same turn (§18 "a request write triggers dispatch")', () => {
  it('apply: when the 202 is read, the named node already holds the lease', async () => {
    const held = heldRunner();
    const f = await open({ watcher: true, runner: held.runner });
    catalogue(f.coord);
    plant(f.coord, serverNode({ role: 'both' }));                  // local mode's own row: spawned through the Runner
    const before = Date.now();
    const r = await post(f.app, '/api/updates/apply', { nodeId: SERVER_ID, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    const row = f.coord.node(SERVER_ID)!;
    expect(row.updateState, 'no dispatch ran in the apply request').toBe('pending');
    expect(row.updateTarget).toBe('v0.0.10');
    expect(row.updateStartedAt!).toBeGreaterThanOrEqual(before);
    expect(row.requestedTag, 'the request stands until convergence or ack').toBe('v0.0.10');
    // Let the parked spawn answer before the fixture closes. A refused --detach parent is a
    // halting spawn-failed (Task 5's mapping); here it only proves which arm was reached.
    held.release({ code: 1, stdout: '', stderr: 'update: fixture refusal\n' });
    await vi.waitFor(() => expect(f.coord.node(SERVER_ID)!.updateState).toBe('failed'), { timeout: 3000 });
    expect(held.calls).toEqual([[updateLauncherPath(f.home), [...updateSpawnArgv('update', 'v0.0.10')]]]);
  });

  it('rollback: likewise, the lease is acquired for the requested rollback before the reply', async () => {
    const held = heldRunner();
    const f = await open({ watcher: true, runner: held.runner });
    catalogue(f.coord);
    plant(f.coord, serverNode({ role: 'both' }));
    const r = await post(f.app, '/api/updates/rollback', { nodeId: SERVER_ID });
    expect(r.statusCode, r.body).toBe(202);
    expect(f.coord.node(SERVER_ID), 'no dispatch ran in the rollback request')
      .toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.8', requestedKind: 'rollback' });
    held.release({ code: 1, stdout: '', stderr: 'update: fixture refusal\n' });
    await vi.waitFor(() => expect(f.coord.node(SERVER_ID)!.updateState).toBe('failed'), { timeout: 3000 });
    expect(held.calls).toEqual([[updateLauncherPath(f.home), [...updateSpawnArgv('rollback', 'v0.0.8')]]]);
  });
});

describe('credentials, armed (decision 15: the box token never writes intent)', () => {
  it("no session → the gate's 401; the box token alone → the gate's 401; nothing is written", async () => {
    const f = await open({ auth: true });
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    for (const [url, body] of [
      ['/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' }],
      ['/api/updates/rollback', { nodeId: FLEET_ID }],
    ] as const) {
      const anon = await post(f.app, url, body);
      expect(anon.statusCode, url).toBe(401);
      expect(anon.json()).toMatchObject({ verdict: 'no-session' });
      const token = await post(f.app, url, body, { 'x-ccrc-mail-token': TOKEN });
      expect(token.statusCode, `${url} with the box token`).toBe(401);
      expect(token.json()).toMatchObject({ verdict: 'no-session' });
    }
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it('a session is the credential, and a box-token header beside it changes nothing', async () => {
    const f = await open({ auth: true });
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    const cookie = await login(f.app);
    const apply = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' }, { cookie });
    expect(apply.statusCode, apply.body).toBe(202);
    const rollback = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID },
      { cookie, 'x-ccrc-mail-token': 'not-the-token' });
    expect(rollback.statusCode, rollback.body).toBe(202);
    expect(f.coord.node(FLEET_ID)).toMatchObject({ requestedTag: 'v0.0.8', requestedKind: 'rollback' });
  });

  it('a live session from a foreign Origin is 403 foreign-origin on both moves — the CSRF check reaches them (§12)', async () => {
    // §12 says the moves "get the CSRF origin check for free" by being non-GET and not in EXEMPT;
    // this measures it on the two routes rather than trusting the structure (the one-tap is the
    // highest-value write a same-site page could forge, and Fastify parses a form's text/plain).
    const f = await open({ auth: true });
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    const cookie = await login(f.app);
    for (const [url, body] of [
      ['/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' }],
      ['/api/updates/rollback', { nodeId: FLEET_ID }],
    ] as const) {
      const forged = await post(f.app, url, body, { cookie, origin: SIBLING });
      expect(forged.statusCode, `${url}: ${forged.body}`).toBe(403);
      expect(forged.json()).toEqual({ ok: false, error: 'foreign-origin' });
    }
    expect(f.coord.node(FLEET_ID)!.requestedTag, 'a forged move wrote a request').toBeNull();
    // The control: the same cookie from the box's OWN origin is let through, so the 403 above is the
    // Origin's and not a broken session.
    const own = loadConfig({ CCRC_HOME: f.home }).origin;
    const same = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' }, { cookie, origin: own });
    expect(same.statusCode, same.body).toBe(202);
  });
});
```

In `server/test/update-routes.test.ts` (W2 Task 13's file, as wave 3 Task 3 leaves it) — three in-place edits, then one append:

- directly after `import { UPDATE_GATE_CAP } from '../src/update/resolve.js';` add:

```ts
import { DETACH_CAP } from '../src/update/dispatch.js';
import { localUpdateSpawnFor, type LocalUpdateSpawn } from '../src/update/converge.js';
```

- in `open()`'s options type (wave 3's line), replace `push?: { notify: (p: PushPayload) => Promise<void> } } = {},` with `push?: { notify: (p: PushPayload) => Promise<void> }; updateRunner?: LocalUpdateSpawn } = {},`;
- in `open()`'s `deps` literal, directly after `    ...(o.push ? { push: o.push as never } : {}),` add `    ...(o.updateRunner ? { updateRunner: o.updateRunner } : {}),`.

Then append after the file's last line (the closing `});` of wave 3's `POST /api/updates/refresh announces what its poll listed (plan W3 Task 3)` describe):

```ts

describe('POST /api/updates/intent dispatches in the same request (update-management wave 5, spec §10\'s triggers)', () => {
  it('an auto write on a gated box is followed, before the reply, by the lease acquire it makes possible', async () => {
    // The local spawn answers at once with a refused `--detach` parent: the case measures only
    // that the acquire happened in the request, and which arm it reached.
    const calls: [string, string[]][] = [];
    const refusing: Runner = async (cmd, args) => {
      calls.push([cmd, [...args]]);
      return { code: 1, stdout: '', stderr: 'update: fixture refusal\n' };
    };
    // The spawn's `home` only builds the launcher path (`updateLauncherPath`), which `refusing` never
    // executes — the argv itself is pinned by `update-apply-routes.test.ts`, not here.
    const f = await open({ watcher: true, updateRunner: localUpdateSpawnFor(refusing, '/nonexistent-fixture-home') });
    catalogue(f.coord);
    // The server's OWN row and no other. Planted so `ensureInventory` does not sweep the fixture box and
    // write a capless one (the auto gate would answer 409); no fleet row, because in local mode no
    // `sendUpdateOp` is wired and Task 5's `runDispatch` notes a link-less move WITHOUT a lease — so the
    // move the dispatcher can make here is the server row's, through the wired local spawn.
    plant(f.coord, measured({
      nodeId: SERVER_LABEL, label: SERVER_LABEL, role: 'both', agentOps: null,
      caps: ['verify', 'node-id', 'floor', UPDATE_GATE_CAP, DETACH_CAP],
    }));
    const before = Date.now();
    const r = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'stable' });
    expect(r.statusCode, r.body).toBe(200);
    const row = f.coord.node(SERVER_LABEL)!;
    expect(row.desiredTag).toBe('v0.0.10');
    // `updateTarget`/`updateStartedAt` outlive a release (W2's releaseLease writes state and
    // detail only), so this reads the acquire whatever the spawn answered after it.
    expect(row.updateTarget, 'no dispatch ran in the intent request').toBe('v0.0.10');
    expect(row.updateStartedAt!).toBeGreaterThanOrEqual(before);
    expect(row.requestedTag, 'an auto move writes no request').toBeNull();
    // Let the run finish before the fixture closes: the refused parent is a halting spawn-failed.
    await vi.waitFor(() => expect(f.coord.node(SERVER_LABEL)!.updateState).toBe('failed'), { timeout: 3000 });
    expect(calls, 'the move reached the local spawn once').toHaveLength(1);
  });
});
```
- [ ] **Step 3: Run them red**

Run, one at a time, foreground, from `server/`, timeout ≥ 600000 ms:
- `./node_modules/.bin/vitest run test/update-apply-routes.test.ts` — Expected: FAIL. The two grammar cases fail with `TypeError: parseApplyBody is not a function` / `parseRollbackBody is not a function` (the named imports resolve to `undefined`); every route case fails on its first status assertion with `expected 404 to be 202` / `expected 404 to be 409` / `expected 404 to be 501` (Fastify's `Route POST:/api/updates/apply not found`); the armed anonymous and box-token-only case PASSES already (the gate's `onRequest` hook answers `401` before routing), and that is expected — its mutation is row 6 of Step 12. The foreign-Origin case FAILS, but only at its same-origin control (`expected 404 to be 202`): its two `403 foreign-origin` assertions already hold, because the gate checks the Origin of a request the router matched to nothing too (`exemptKey(method, undefined)` is `null`, so `needsOriginCheck` is true) — which is why its guard is measured by mutation row 15, not by this red.
- `./node_modules/.bin/vitest run test/update-routes.test.ts -t 'dispatches in the same request'` — Expected: FAIL `no dispatch ran in the intent request: expected null to be 'v0.0.10'`.

- [ ] **Step 4: Widen the wire vocabulary in `shared/api.ts`**

In W2's `UpdateRouteError` (the end-of-file update block; Step 1 measured its last line unique), replace:

```ts
  | 'journal-unreadable' | 'journal-unwritable';
```

with:

```ts
  | 'journal-unreadable' | 'journal-unwritable'
  | Exclude<DispatchRefusal, 'no-update-gate' | 'waiting-for-fleet'> | 'no-previous' | 'no-desired';   // wave 5: the moves' 409s (spec §12)
```

(`DispatchRefusal` is Task 4's type, declared further down the same block; a type alias may name a later declaration.) Then append after the file's last line (Task 4's `compareDispatchOrder`):

```ts

/** `POST /api/updates/apply` (design 2026-09-20 §12, update-management wave 5). Exactly one of `nodeId` / `all`;
 *  `tag` absent = each named node's resolved `desiredTag`. */
export type ApplyUpdateBody = ({ nodeId: string } | { all: true }) & { tag?: string };
/** `POST /api/updates/rollback` (§12). `to` absent = the node's measured `previousVersion`. */
export interface RollbackUpdateBody { nodeId: string; to?: string }
/** Why `{all: true}` wrote no request for a live node (D-3385, D-3401):
 *  the dispatcher's own per-node refusal with the fleet's halt set aside (an update move is never asked for the
 *  rollback cap, and never `no-update-gate` — that is auto's), or no tag to move it to. Every refusal word but
 *  `not-newer` is also noted in that node's `updateDetail` (§12), which is where the inventory shows it. */
export type MoveSkipWhy =
  | Exclude<DispatchRefusal, 'halted' | 'no-update-gate' | 'no-rollback-cap' | 'waiting-for-fleet'> | 'no-desired';
export interface MoveSkip { nodeId: string; why: MoveSkipWhy }
/** §12's `202 {requested}`, plus `skipped`. `requested` is in dispatch order (`compareDispatchOrder`); a single-node
 *  move answers `requested: [nodeId]` and `skipped: []`. A request, not a dispatch: the row shows it as
 *  `request: {tag, kind, at}` until convergence or `ack` clears it. */
export interface MoveRequestAnswer { ok: true; requested: string[]; skipped: MoveSkip[] }
```

- [ ] **Step 5: Run the PWA type gate red — the widened union has no sentences yet**

Run: `cd pwa && npm ci && npm run build`
Expected: FAIL in `tsc`, twice — `src/lib/api.ts` (`UPDATE_ERROR_TEXT`) and `test/api.test.ts` (`SENTENCES`), each `error TS2740: Type '{ … }' is missing the following properties from type 'Record<Exclude<UpdateRouteError, "unauthenticated">, string>': …` naming the new words (`"unknown-tag"`, `"not-newer"`, `"refused-by-node"`, `"stamp-unread"`, `"floor-unread"`, and the rest). D-3302's keying is doing its job.

- [ ] **Step 6: The eleven sentences, and the census that counts them**

`pwa/src/lib/api.ts` — in `UPDATE_ERROR_TEXT`, directly after `  'journal-unwritable': 'The server cannot write its intent journal — nothing was changed.',`:

```ts
  'unknown-tag': 'That tag is not a release this node can move to — choose one from the release list.',
  'not-newer': 'That release is not newer than what that node runs, or than its floor after a rollback — use Roll back to move it there.',
  'refused-by-node': 'That node refused this release when it failed verification — acknowledge the node to clear the refusal first.',
  'stamp-unread': 'That node’s build stamp could not be read, so nothing can say whether the release is newer — nothing was requested.',
  'floor-unread': 'That node’s floor has not been measured yet, so nothing can say whether the release is above it — nothing was requested.',
  'no-detach-cap': 'That node cannot start a detached update yet — update it once from its own shell.',
  'no-rollback-cap': 'That node cannot roll back on request yet — update it once from its own shell.',
  'agent-predates-update-op': 'That node’s agent predates the update op — update the node once by hand, then it can be moved from here.',
  halted: 'An update failed or was reverted — acknowledge that node before moving any other.',
  'no-previous': 'That node records no previous release to roll back to — pick a tag from the release list.',
  'no-desired': 'That node has no resolved release to install — choose a tag, or check its channel and pin.',
```

`pwa/test/api.test.ts` — in wave 3's `SENTENCES` table, directly after `    'journal-unwritable': 'The server cannot write its intent journal — nothing was changed.',`, the same eleven entries at the table's four-space indent:

```ts
    'unknown-tag': 'That tag is not a release this node can move to — choose one from the release list.',
    'not-newer': 'That release is not newer than what that node runs, or than its floor after a rollback — use Roll back to move it there.',
    'refused-by-node': 'That node refused this release when it failed verification — acknowledge the node to clear the refusal first.',
    'stamp-unread': 'That node’s build stamp could not be read, so nothing can say whether the release is newer — nothing was requested.',
    'floor-unread': 'That node’s floor has not been measured yet, so nothing can say whether the release is above it — nothing was requested.',
    'no-detach-cap': 'That node cannot start a detached update yet — update it once from its own shell.',
    'no-rollback-cap': 'That node cannot roll back on request yet — update it once from its own shell.',
    'agent-predates-update-op': 'That node’s agent predates the update op — update the node once by hand, then it can be moved from here.',
    halted: 'An update failed or was reverted — acknowledge that node before moving any other.',
    'no-previous': 'That node records no previous release to roll back to — pick a tag from the release list.',
    'no-desired': 'That node has no resolved release to install — choose a tag, or check its channel and pin.',
```

and in the same file replace `    expect(entries, 'guards the guard — an empty census passes everything').toHaveLength(12);` with `    expect(entries, 'guards the guard — an empty census passes everything').toHaveLength(23);`, replace `    // The ten words no other table owns. `not-configured` and `bad-request`` with `    // The twenty-one words no other table owns. `not-configured` and `bad-request``, and replace `    expect(updateOnly, 'guards the guard').toHaveLength(10);` with `    expect(updateOnly, 'guards the guard').toHaveLength(21);`. (None of the eleven words is owned by `apiErrorText`, `sendErrorText`, `submitErrorText`, `uploadErrorText` or `kickoffErrorText` — measured at `d759c914`: `grep -rn "'halted'\|'unknown-tag'\|'not-newer'\|'refused-by-node'\|'stamp-unread'\|'floor-unread'\|'no-detach-cap'\|'no-rollback-cap'\|'agent-predates-update-op'\|'no-previous'\|'no-desired'" pwa/src` → no hits — so the pass-through case holds for all twenty-one. The `floor-unread` word was added to that grep when the unit was re-pointed onto W2's tip and is not measured — re-run it.)

Run: `cd pwa && npm run build` → exit 0; `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts` → PASS (wave 3's route-literal census still reads the four W2 routes: no sentence spells a route path).

- [ ] **Step 7: Implement the routes in `server/src/update/routes.ts`**

(a) Imports — merge into W2's existing lines in place: `type CoordStore` and `type RequestNodeResult` into the `import { NODE_ID_RE, type NodeRow, type ReleaseRow, type SetIntentResult, type UpdateIntentPatch, type UpdateIntentRow } from '../coord/store.js';` line, each with an inline `type` (the clause is a VALUE import carrying `NODE_ID_RE`); `isReleaseTag` (not imported by W2's routes.ts — `tagOrNull` below needs it), `SETTLED_UPDATE_STATES`, `compareDispatchOrder` and `type DispatchRefusal, type MoveRequestAnswer, type MoveSkip, type MoveSkipWhy, type RequestKind` into the `'../../../shared/api.js'` block; and two new lines after `import { SERVER_LABEL, buildInfoOfRow } from './inventory.js';`:

```ts
import { dispatchViewsFor } from './converge.js';
import { dispatchRefusalDetail, fleetGate, moveRefusal, type FleetGate } from './dispatch.js';
```

(b) The module docstring and the `sessionAuth` docstring, line for line (four in-place replacements, each unique in the file): ` * THE CREDENTIALS. Four routes are session-only and carry NO box-token check at` → ` * THE CREDENTIALS. Six routes are session-only and carry NO box-token check at`; ` * none of the four is named in `auth/gate.ts`'s EXEMPT table, so armed they sit` → ` * none of the six is named in `auth/gate.ts`'s EXEMPT table, so armed they sit`; ` * as every route is (`gate.ts`'s unarmed-exposure note). The fifth, the` → ` * as every route is (`gate.ts`'s unarmed-exposure note). The seventh, the`; `   /** `buildServer`'s `sessionAuth` — read by the projection read alone; the four` → `   /** `buildServer`'s `sessionAuth` — read by the projection read alone; the six`.

(c) Directly after W2's `parseAckBody` function's closing `}`:

```ts

/** `POST /api/updates/apply`'s keys (design 2026-09-20 §12, update-management wave 5). */
export const APPLY_BODY_KEYS = ['nodeId', 'all', 'tag'] as const;
/** `POST /api/updates/rollback`'s keys (§12). */
export const ROLLBACK_BODY_KEYS = ['nodeId', 'to'] as const;

type TagField = { ok: true; tag: string | null } | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };

/** An OPTIONAL tag field through the one guard: absent → null; a string `isIngestibleReleaseTag` accepts → itself; any
 *  other string → `bad-tag` (§12's own answer); anything else — `null` included, because absence is spelled by
 *  leaving the key out — → `bad-request` naming the field. */
function tagField(o: Record<string, unknown>, field: string): TagField {
  if (!(field in o)) return { ok: true, tag: null };
  const v = o[field];
  if (typeof v !== 'string') return { ok: false, error: 'bad-request', field };
  if (!isIngestibleReleaseTag(v)) return { ok: false, error: 'bad-tag', field };   // D-3216: the intent route's pin guard, one predicate
  return { ok: true, tag: v };
}

export type ParsedApplyBody =
  | { ok: true; target: { nodeId: string } | { all: true }; tag: string | null }
  | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };

/** The apply body: EXACTLY ONE of `nodeId` (a non-empty string) and `all` (`true`, and nothing truthy in its
 *  place) names what moves — both is ambiguous and names the extra key, `all`; neither names `nodeId`. An
 *  unknown key is `bad-request` naming it, the `parseIntentBody` rule. */
export function parseApplyBody(body: unknown): ParsedApplyBody {
  const bad = (field: string): ParsedApplyBody => ({ ok: false, error: 'bad-request', field });
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad('body');
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(APPLY_BODY_KEYS as readonly string[]).includes(k)) return bad(k);
  }
  const hasNode = 'nodeId' in o;
  const hasAll = 'all' in o;
  if (hasNode === hasAll) return bad(hasNode ? 'all' : 'nodeId');
  let target: { nodeId: string } | { all: true };
  if (hasAll) {
    if (o.all !== true) return bad('all');
    target = { all: true };
  } else {
    const nodeId = o.nodeId;
    if (typeof nodeId !== 'string' || nodeId === '') return bad('nodeId');
    target = { nodeId };
  }
  const tag = tagField(o, 'tag');
  if (!tag.ok) return tag;
  return { ok: true, target, tag: tag.tag };
}

export type ParsedRollbackBody =
  | { ok: true; nodeId: string; to: string | null }
  | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };

/** The rollback body: a `nodeId`, and an optional `to` through the one guard. */
export function parseRollbackBody(body: unknown): ParsedRollbackBody {
  const bad = (field: string): ParsedRollbackBody => ({ ok: false, error: 'bad-request', field });
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad('body');
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(ROLLBACK_BODY_KEYS as readonly string[]).includes(k)) return bad(k);
  }
  const nodeId = o.nodeId;
  if (typeof nodeId !== 'string' || nodeId === '') return bad('nodeId');
  const to = tagField(o, 'to');
  if (!to.ok) return to;
  return { ok: true, nodeId, to: to.tag };
}

/** A column that should hold a tag, read through the one guard — a value off the shape names no move. */
const tagOrNull = (v: string | null): string | null => (isReleaseTag(v) ? v : null);

/** The fleet's halt SET ASIDE: `{all: true}` asks each node only the per-node question — would the dispatcher
 *  refuse THIS node this move whatever the rest of the fleet is doing. The halt itself is the dispatcher's to
 *  enforce at dispatch time, and a request written while the fleet is halted waits for the `ack`. */
const NO_HALT: FleetGate = { haltedBy: [], leaseHeldBy: null };

type MoveRouteWord = Exclude<DispatchRefusal, 'no-update-gate' | 'waiting-for-fleet'>;

/** A dispatcher refusal as a route word. `moveRefusal` never answers `no-update-gate` for an operator request
 *  (that is auto's), and `waiting-for-fleet` is `planDispatch`'s, never `moveRefusal`'s — so either one here
 *  means the dispatcher's contract changed, and it is thrown (a 500 naming it), never folded into another word. */
function routeWord(r: DispatchRefusal): MoveRouteWord {
  if (r === 'no-update-gate' || r === 'waiting-for-fleet') {
    throw new Error(`update: moveRefusal answered ${r} for an operator request — the dispatcher's contract changed`);
  }
  return r;
}

/** The same, for `{all: true}`'s skip list: under `NO_HALT` an update move is never `halted`, never asked for
 *  the rollback cap, and never auto's `no-update-gate`. */
function skipWord(r: DispatchRefusal): MoveSkipWhy {
  if (r === 'halted' || r === 'no-update-gate' || r === 'no-rollback-cap' || r === 'waiting-for-fleet') {
    throw new Error(`update: moveRefusal answered ${r} for an unhalted update request — the dispatcher's contract changed`);
  }
  return r;
}

type SingleMove =
  | { ok: true; target: string }
  | { ok: false; code: number; body: Omit<UpdateRouteRefusal, 'ok'> };

/**
 * THE SINGLE-NODE PREDICATE a move route answers with (spec §12: "the route evaluates the dispatcher's own
 * predicates synchronously … and answers the 409 the dispatcher would"). In order: the row (404, 409
 * superseded); the target — the named tag, else the resolved `desiredTag` for an update (409 no-desired, with
 * the resolver's sentence) or the measured `previousVersion` for a rollback (409 no-previous: never fetched);
 * the node's OWN lease (409 busy, D-3386 — another node's lease is a turn, not a
 * refusal); then `moveRefusal` over the views the dispatcher itself plans from (`dispatchViewsFor`), with the
 * catalogue through `resolveInputFor` — W2's one mapping of the releases table — so a route 409 and the
 * dispatcher's refusal are one function's answer, never two copies of it. `halted` names the halting rows;
 * every other word carries the dispatcher's own sentence.
 */
function singleNodeMove(coord: CoordStore, nodeId: string, kind: RequestKind, named: string | null): SingleMove {
  const row = coord.node(nodeId);
  if (row === null) return { ok: false, code: 404, body: { error: 'unknown-node' } };
  if (row.supersededBy !== null) return { ok: false, code: 409, body: { error: 'superseded', detail: row.supersededBy } };
  const target = named ?? tagOrNull(kind === 'rollback' ? row.previousVersion : row.desiredTag);
  if (target === null) {
    if (kind === 'rollback') return { ok: false, code: 409, body: { error: 'no-previous', ...(row.previousRead === 'unmeasured' ? { detail: 'the previous release has not been measured yet — name one with to' } : {}) } };   // D-3495 (D-3213: NULL is "none" only when previousRead is absent)
    return {
      ok: false, code: 409,
      body: row.resolveDetail === null ? { error: 'no-desired' } : { error: 'no-desired', detail: row.resolveDetail },
    };
  }
  if (!(SETTLED_UPDATE_STATES as readonly string[]).includes(row.updateState)) {
    return { ok: false, code: 409, body: { error: 'busy', detail: row.updateState } };
  }
  const views = dispatchViewsFor(coord);
  const view = views.find((v) => v.row.nodeId === nodeId);
  if (view === undefined) return { ok: false, code: 404, body: { error: 'unknown-node' } };
  const gate = fleetGate(views.map((v) => v.row));
  const refusal = moveRefusal(view, { kind, target, source: 'request' }, resolveInputFor(coord, row).releases, gate);
  if (refusal === null) return { ok: true, target };
  const error = routeWord(refusal);
  const detail = error === 'halted' ? gate.haltedBy.join(', ') : dispatchRefusalDetail(error, view, target);
  return { ok: false, code: 409, body: { error, detail } };
}

/** `requestNode`'s refusals as HTTP. Every arm is unreachable past `singleNodeMove` in the same synchronous
 *  stretch, and each is mapped anyway, so a store that learns a refusal answers its word rather than a 500. */
function requestRefusal(r: Exclude<RequestNodeResult, { ok: true }>, tagKey: 'tag' | 'to'): { code: number; body: Omit<UpdateRouteRefusal, 'ok'> } {
  switch (r.why) {
    case 'unknown-node': return { code: 404, body: { error: 'unknown-node' } };
    case 'superseded': return { code: 409, body: { error: 'superseded', detail: r.supersededBy } };
    case 'bad-tag': return { code: 400, body: { error: 'bad-tag', field: tagKey } };
    case 'bad-kind': return { code: 400, body: { error: 'bad-request', field: 'kind' } };
  }
}

/**
 * `{all: true}` — every live node, in DISPATCH order (`compareDispatchOrder`, fleet first), so `requested`
 * reads in the order the dispatcher will move them. A request is written only for a node the move can take
 * FORWARD: with no tag named and no `desiredTag`, it is skipped `no-desired`; otherwise it is skipped with the
 * dispatcher's own refusal of that node, the fleet's halt set aside (`NO_HALT`) — `not-newer`, `stamp-unread`
 * (D-3385), `floor-unread` (a floor never measured, W2 D-3213), or a word the node cannot outgrow by waiting, `no-detach-cap` and the rest
 * (D-3401: a request the dispatcher can only refuse stands until `ack`, and on a fleet
 * row it would hold every server move behind it, D-3381). Always 202 (§12).
 *
 * A SKIP IS SAID ON THE ROW, not only in the reply (§12: "reports per-node refusals through `updateDetail`").
 * A skipped node gets no request, so `planDispatch` never considers it and the dispatcher's own note never
 * reaches it — the route notes the refusal itself, through the dispatcher's writer and sentence
 * (`noteDispatchRefusal`, `dispatchRefusalDetail`). That writer answers `not-idle` for a `failed`/`reverted`/
 * busy row (a verdict or a lease keeps its detail) and `changed: false` for a repeated text. `not-newer` is not
 * noted: that node was not refused a capability — it already runs the tag or a newer one, or it was rolled back
 * below a floor at or above the tag (D-3403) — and its row already reads what it runs
 * and its floor; the 202's `skipped` says it.
 */
function requestAll(coord: CoordStore, tag: string | null, now: number): MoveRequestAnswer {
  const requested: string[] = [];
  const skipped: MoveSkip[] = [];
  const views = new Map(dispatchViewsFor(coord).map((v) => [v.row.nodeId, v] as const));
  for (const row of [...coord.nodes()].sort(compareDispatchOrder)) {
    const view = views.get(row.nodeId);
    if (view === undefined) {
      throw new Error(`update: live node ${row.nodeId} has no dispatch view in the same synchronous read`);
    }
    const target = tag ?? tagOrNull(row.desiredTag);
    if (target === null) {
      skipped.push({ nodeId: row.nodeId, why: 'no-desired' });
      continue;
    }
    const refusal = moveRefusal(view, { kind: 'update', target, source: 'request' }, resolveInputFor(coord, row).releases, NO_HALT);
    if (refusal !== null) {
      const why = skipWord(refusal);
      skipped.push({ nodeId: row.nodeId, why });
      if (why !== 'not-newer') {
        const noted = coord.noteDispatchRefusal(row.nodeId, dispatchRefusalDetail(refusal, view, target));
        if (!noted.ok && noted.why !== 'not-idle') {
          throw new Error(`update: noteDispatchRefusal refused live node ${row.nodeId} (${noted.why}) in the same synchronous read`);
        }
      }
      continue;
    }
    const written = coord.requestNode(row.nodeId, target, 'update', now);
    if (!written.ok) {
      throw new Error(`update: requestNode refused live node ${row.nodeId} (${written.why}) in the same synchronous read`);
    }
    requested.push(row.nodeId);
  }
  return { ok: true, requested, skipped };
}
```

(d) In the intent handler, replace:

```ts
    await reproject(req);
    // The epoch RE-MEASURED after the write, the `POST /api/pools/accounts/:id`
```

with:

```ts
    await reproject(req);
    // A request is not the only write that makes a node dispatchable: an `auto` write does
    // too, once the resolution above has stored its `desiredTag` (spec §10's triggers).
    watcher?.triggerDispatch();
    // The epoch RE-MEASURED after the write, the `POST /api/pools/accounts/:id`
```

(e) Directly after the ack handler's closing `  });` (the one that follows `    const answer: AckAnswer = { ok: true, node: toNodeWire(row) };\n    return answer;`) and before the projection read's docstring:

```ts

  /**
   * THE ONE-TAP (spec §12, update-management wave 5). A REQUEST, not a dispatch: the request columns are
   * written (`requestNode`), and the dispatcher is asked to run in the same turn — `triggerDispatch()` starts
   * its run synchronously, and the run acquires the lease before its first await (Task 5), so a node the
   * dispatcher can move already reads `pending` when this reply is read. The result is learned by
   * re-measurement (the inventory sweep), never from this answer. Session-only: no box-token check at all,
   * not in EXEMPT (decision 15). A single named node answers the dispatcher's own 409 synchronously
   * (`singleNodeMove`); `{all: true}` always answers 202, with what it skipped and why, each refusal also
   * noted on its node's row (`requestAll`).
   */
  app.post('/api/updates/apply', async (req, reply) => {
    if (!deps.coord) return refuse(reply, 501, { error: 'not-configured' });
    const parsed = parseApplyBody(req.body);
    if (!parsed.ok) return refuse(reply, 400, { error: parsed.error, field: parsed.field });
    const now = Date.now();
    if ('all' in parsed.target) {
      const all = requestAll(deps.coord, parsed.tag, now);
      if (all.requested.length > 0) watcher?.triggerDispatch();
      return reply.code(202).send(all);
    }
    const { nodeId } = parsed.target;
    const move = singleNodeMove(deps.coord, nodeId, 'update', parsed.tag);
    if (!move.ok) return refuse(reply, move.code, move.body);
    const written = deps.coord.requestNode(nodeId, move.target, 'update', now);
    if (!written.ok) {
      const { code, body } = requestRefusal(written, 'tag');
      return refuse(reply, code, body);
    }
    watcher?.triggerDispatch();
    const answer: MoveRequestAnswer = { ok: true, requested: [nodeId], skipped: [] };
    return reply.code(202).send(answer);
  });

  /**
   * MOVING DOWN is its own verb (decision 8): an explicit request, never a resolver outcome — which is why the
   * store's lease acquire for a rollback also requires this request (D-3376).
   * `to` defaults to the MEASURED `previousVersion` (409 no-previous when there is none — never fetched), and
   * must be a releases row (yanked permitted) this node has not refused, so a forged or mistyped body cannot
   * send a node fetching an arbitrary tag (§12). The same single-node predicate as apply, so it also answers
   * the op's own words, `no-detach-cap` and `agent-predates-update-op` (D-3387).
   */
  app.post('/api/updates/rollback', async (req, reply) => {
    if (!deps.coord) return refuse(reply, 501, { error: 'not-configured' });
    const parsed = parseRollbackBody(req.body);
    if (!parsed.ok) return refuse(reply, 400, { error: parsed.error, field: parsed.field });
    const move = singleNodeMove(deps.coord, parsed.nodeId, 'rollback', parsed.to);
    if (!move.ok) return refuse(reply, move.code, move.body);
    const written = deps.coord.requestNode(parsed.nodeId, move.target, 'rollback', Date.now());
    if (!written.ok) {
      const { code, body } = requestRefusal(written, 'to');
      return refuse(reply, code, body);
    }
    watcher?.triggerDispatch();
    const answer: MoveRequestAnswer = { ok: true, requested: [parsed.nodeId], skipped: [] };
    return reply.code(202).send(answer);
  });
```

W2 Task 13's three scanner facts hold for everything above: no comment spells a registration call with its opening quote or either box-token function with its parenthesis; the two handlers sit after the four W2 session-only ones and before the projection read, which is still registered LAST; and nothing names the database handle on a `coord`/`store` receiver (the update-ring `REACH` scan).

- [ ] **Step 8: Run the route tests, the type check and the ring scan green**

Run, one at a time, foreground, from `server/`:
- `./node_modules/.bin/vitest run test/update-apply-routes.test.ts` — Expected: PASS, every case.
- `./node_modules/.bin/vitest run test/update-routes.test.ts` — Expected: PASS (W2's and wave 3's cases unchanged — none passes `updateRunner`, and none of W2's intent cases builds a watcher, so the new `watcher?.triggerDispatch()` is a no-op there — plus the appended one).
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json` — Expected: no output, exit 0 (`requestRefusal`'s switch is exhaustive over `RequestNodeResult`'s four refusal arms; `routeWord`/`skipWord` narrow by their throws).
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — Expected: PASS (`routes.ts` imports no `node:sqlite` and no `db.js`; no file under `pwa/src` or `server/src` holds a second array literal of `DISPATCH_REFUSALS`' words — `UPDATE_ERROR_TEXT` is an object whose keys are separated by sentences).

- [ ] **Step 9: Run the route scanners and read their reds — they are this task's next failing tests**

Run: `cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts` then `./node_modules/.bin/vitest run test/box-token-census.test.ts`.
Expected, exactly these FAILs and no others:
- `auth-gate.test.ts` › "found all three files, and EXACTLY the route count the surface has" — `expected 7 to be 5`.
- `auth-gate.test.ts` › "the property loop names the HTTP-route count" — `expected [ 83 ] to deeply equal [ 85 ]`; "the third probe names the whole and the exempt part" — `expected [ 83, 32 ] to deeply equal [ 85, 32 ]`; "gate.ts's own docstring names the HTTP-route count it stands in front of" — `expected [ 83 ] to deeply equal [ 85 ]`; "the scanner-meta comment names the scanned route count" — `expected [ 86 ] to deeply equal [ 88 ]`.
- `box-token-census.test.ts` › "UPDATE_DOORS is exactly the rest of what the file registers, in both directions" (the file's rest carries `/api/updates/apply` and `/api/updates/rollback`); "CLAUDE.md's box-token bullet names every update route by its backticked verb and path" (`does not name \`POST /api/updates/apply\``).

Everything structural passes: the gated sweep finds both new routes armed-anonymous `401 no-session`; the dark-vs-authenticated property holds (`testDeps` carries no coordination database, so both answer `501`); "exactly one handler there consults the box token" is still the projection read. If anything else reds, stop.

- [ ] **Step 10: The census and the prose**

`server/test/auth-gate.test.ts`:
- Replace `    expect(scanRoutes('update/routes.ts').length).toBe(5);` with:

```ts
    // 7 since update-management wave 5 (design 2026-09-20 §12) registered the two
    // moves, `POST /api/updates/apply` and `POST /api/updates/rollback`, beside
    // them — session-only and NOT EXEMPT like W2's four, no box token at all.
    expect(scanRoutes('update/routes.ts').length).toBe(7);
```

- Replace `    expect(ROUTES.length).toBe(86);` with:

```ts
    // 88 since wave 5's two moves joined that file: 51 + 30 + 7, 86 -> 88.
    expect(ROUTES.length).toBe(88);
```

- After `      'POST /api/updates/ack', 'GET /api/updates/intent/:nodeId',` insert:

```ts
      // …and wave 5's two moves, which the same lost-file failure would drop with them.
      'POST /api/updates/apply', 'POST /api/updates/rollback',
```

- Replace `    // 86 scanned + the static wildcard when the bundle is built.` with `    // 88 scanned + the static wildcard when the bundle is built.`
- Replace `    // THE PROPERTY, in one loop over all 83 HTTP routes, with THREE probes each:` with `    // THE PROPERTY, in one loop over all 85 HTTP routes, with THREE probes each:`
- Replace `          //    is not itself flag-aware — the assertion that covers all 83 HTTP routes, not the 32 exempt.` with `          //    is not itself flag-aware — the assertion that covers all 85 HTTP routes, not the 32 exempt.`

(No new line contains any of the D-1223 needles — `in one loop over all`, `the assertion that covers all`, `scanned + the static wildcard`, `websockets and every HTTP route` — so each claim is still exactly one line.)

`server/src/auth/gate.ts` — replace ` * THE GATE. One `onRequest` hook stands in front of all 83 routes, the static` with ` * THE GATE. One `onRequest` hook stands in front of all 85 routes, the static`.

`server/test/box-token-census.test.ts` — replace W2's block:

```ts
/** The update control plane's session-only routes (design 2026-09-20 §12 census
 *  step (b): the FOUR the W2 wave registers of §12's six). Registered from `server/src/update/routes.ts`,
 *  which `coord-pause-route.test.ts`'s `SESSION_ONLY` harvest cannot see for the
 *  kickoff route's reason. Hand-kept for the NAMES only: the update-surface
 *  describe below derives the same set from the file and compares in both
 *  directions, so a route there cannot join or leave without this literal
 *  moving. Programme wave 5 (spec W4 part B) appends `/api/updates/apply` and
 *  `/api/updates/rollback` with their routes. */
const UPDATE_DOORS = ['/api/updates', '/api/updates/intent', '/api/updates/refresh', '/api/updates/ack'];
```

with:

```ts
/** The update control plane's session-only routes (design 2026-09-20 §12 census
 *  step (b): all six of §12's session routes — W2's four and wave 5's two moves). Registered from `server/src/update/routes.ts`,
 *  which `coord-pause-route.test.ts`'s `SESSION_ONLY` harvest cannot see for the
 *  kickoff route's reason. Hand-kept for the NAMES only: the update-surface
 *  describe below derives the same set from the file and compares in both
 *  directions, so a route there cannot join or leave without this literal
 *  moving. */
const UPDATE_DOORS = ['/api/updates', '/api/updates/intent', '/api/updates/refresh', '/api/updates/ack',
  '/api/updates/apply', '/api/updates/rollback'];
```

and in W2's `describe('the update surface: one dual-credential read, every other route session-only (decision 15)', …)`, directly after the closing `  });` of its "a box-token call planted in update/routes.ts is SEEN" case, insert:

```ts

  it('a box-token call planted in the apply handler is SEEN too — the first write route wave 5 adds', () => {
    // The same control over the newest registration: the one-tap is the route this census
    // exists to keep off the box token, so its slice is proved live on its own.
    const anchor = "app.post('/api/updates/apply', async (req, reply) => {";
    expect(UPDATE_SRC, 'the apply registration line moved — re-point this control at it').toContain(anchor);
    for (const call of ['requireMailToken(req, reply);', 'checkMailToken(deps.mailToken ?? null, undefined);']) {
      const planted = UPDATE_SRC.replace(anchor, `${anchor}\n    ${call}`);
      expect(lanesIn(planted), `a planted ${call} went unseen`).toContain('POST /api/updates/apply');
    }
    expect(lanesIn(UPDATE_SRC)).not.toContain('POST /api/updates/apply');
  });
```

`CLAUDE.md` — in the box-token bullet, replace W2 Task 13's seven lines:

```markdown
  set, and `box-token-census.test.ts` now checks this sentence against it in both directions (D-1231). The update
  control plane's routes are session-only by design (the box token never writes intent — design 2026-09-20,
  decision 15): `GET /api/updates`, `POST /api/updates/intent`, `POST /api/updates/refresh` and `POST
  /api/updates/ack` consult no box token. They are registered from `server/src/update/routes.ts`, a file neither
  `SESSION_ONLY` nor the kickoff literal can see, so `box-token-census.test.ts` reads it as a lane source of its
  own and keeps their names in a hand-kept `UPDATE_DOORS`, checked against that file in both directions (programme
  wave 5, spec W4 part B, adds `apply` and `rollback` there with their routes).
```

with exactly seven lines (the file's length does not move):

```markdown
  set, and `box-token-census.test.ts` now checks this sentence against it in both directions (D-1231). The update
  control plane's routes are session-only by design (the box token never writes intent — design 2026-09-20,
  decision 15): `GET /api/updates`, `POST /api/updates/intent`, `POST /api/updates/refresh`, `POST
  /api/updates/ack`, `POST /api/updates/apply` and `POST /api/updates/rollback` consult no box token. They are
  registered from `server/src/update/routes.ts`, a file neither `SESSION_ONLY` nor the kickoff literal can see, so
  `box-token-census.test.ts` reads it as a lane source of its own and keeps their names in a hand-kept
  `UPDATE_DOORS`, checked against that file in both directions.
```

(Every new route is named in the NO-box-token clause, after "What does need saying here", where the over-claim scan does not read it as a lane; the bullet is flattened before matching, so `` `POST\n  /api/updates/ack` `` reads as one span; no capitalised number word is added, so `coord-pause-route.test.ts`'s `CARD_RE` still finds only `FOUR`.)

- [ ] **Step 11: Run green — every file this task touched or that reads what it touched**

Record `wc -l CLAUDE.md` before Step 10 and compare after it: unchanged. Then run each, foreground, from `server/`, timeout ≥ 600000 ms:
- `./node_modules/.bin/vitest run test/update-apply-routes.test.ts`
- `./node_modules/.bin/vitest run test/update-routes.test.ts`
- `./node_modules/.bin/vitest run test/auth-gate.test.ts`
- `./node_modules/.bin/vitest run test/box-token-census.test.ts` (including "README states the DERIVED lane counts" — green with no README edit, D-3388)
- `./node_modules/.bin/vitest run test/coord-pause-route.test.ts` (reads the same CLAUDE.md bullet for its `FOUR`)
- `./node_modules/.bin/vitest run test/pools-prose.test.ts`
- `./node_modules/.bin/vitest run test/single-definition.test.ts`
- `./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'` (no edit — its scan reads `server/src/coord` only; a red here means `routes.ts` landed under `coord/`)
- `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` — the citation audit over `shared/api.ts` (one line added below `:7526`, the rest appended), whose census (`'shared/api.ts': 1`, `'server/test/single-definition.test.ts': 8`) and README's empty entry stay unchanged
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` (a known load flake — re-run in isolation before calling a red real)
- `cd ../pwa && npm run build && ./node_modules/.bin/vitest run test/api.test.ts`

Expected: PASS for all eleven.

- [ ] **Step 12: Mutation measurements — each guard reds when removed, restored byte for byte**

Before each row copy every file it edits: `B=$(mktemp -d); cp <file> "$B/$(basename <file>).orig"`; after the run restore with `cp "$B/$(basename <file>).orig" <file> && cmp "$B/$(basename <file>).orig" <file>` — never `git checkout --` (the task's edits are uncommitted and a checkout would eat them). Runs are from `server/`.

1. §18 "`apply` names a tag" — in the apply handler replace `singleNodeMove(deps.coord, nodeId, 'update', parsed.tag)` with `singleNodeMove(deps.coord, nodeId, 'update', null)`. Run `./node_modules/.bin/vitest run test/update-apply-routes.test.ts -t 'requests the NAMED tag'` → FAIL on `toMatchObject({ requestedTag: 'v0.0.11' … })` (`requestedTag: 'v0.0.10'` was written — the resolved newest). Restore.
2. §18 "`apply` refuses an older tag; an unversioned node is never "not newer"" (the route half) — (a) in `singleNodeMove` replace `if (refusal === null) return { ok: true, target };` with `if (refusal === null || kind === 'update') return { ok: true, target };` → `-t '409 not-newer for a tag older'` FAIL `expected 202 to be 409`, and the agreement table's six `update` rows red (`not-newer`, `stamp-unread`, `floor-unread`, `no-detach-cap`, `agent-predates-update-op`, `halted` — each `expected 202 to be 409`; the `floor-unread` row not measured). Restore. (b) directly after the `supersededBy` line in `singleNodeMove` insert `if (kind === 'update' && row.currentVersion === null) return { ok: false, code: 409, body: { error: 'not-newer' } };` → `-t '409 not-newer for a tag older'` FAIL on the SERVER_ID loop (`v0.0.8: … expected 409 to be 202`). Restore.
3. §18 "`rollback` is catalogue-gated and defaults to `previous`" — (a) replace `if (refusal === null) return { ok: true, target };` with `if (refusal === null || kind === 'rollback') return { ok: true, target };` → `-t 'catalogue-gated'` FAIL `expected 202 to be 409` (the `v0.0.5` request was written). Restore. (b) replace `tagOrNull(kind === 'rollback' ? row.previousVersion : row.desiredTag)` with `tagOrNull(row.desiredTag)` → `-t 'without to, rolls back'` FAIL `expected 409 to be 202` (no desired in that fixture: `no-previous`), and `-t 'no-previous when previousVersion is NULL'` FAIL `expected 202 to be 409` (its `desiredTag` v0.0.10 was taken for a rollback target). Restore.
4. §18 "a request write triggers dispatch" — delete `    watcher?.triggerDispatch();` from the apply handler's single-node path (the one directly before `const answer: MoveRequestAnswer = { ok: true, requested: [nodeId], skipped: [] };`) → `-t 'apply: when the 202 is read'` FAIL `no dispatch ran in the apply request: expected 'idle' to be 'pending'`. Restore. The same line in the rollback handler → `-t 'rollback: likewise'` FAIL `no dispatch ran in the rollback request`. Restore. The intent handler's → `./node_modules/.bin/vitest run test/update-routes.test.ts -t 'dispatches in the same request'` FAIL `no dispatch ran in the intent request: expected null to be 'v0.0.10'`. Restore.
5. §18 "six session doors, one dual-credential read" — (a) delete `'/api/updates/rollback'` from `UPDATE_DOORS` → `./node_modules/.bin/vitest run test/box-token-census.test.ts` FAIL "UPDATE_DOORS is exactly the rest of what the file registers, in both directions". Restore. (b) in CLAUDE.md change `` `POST /api/updates/apply` and `POST /api/updates/rollback` consult no box token `` to `` `POST /api/updates/apply` consult no box token `` → FAIL "CLAUDE.md's box-token bullet names every update route by its backticked verb and path" (`does not name \`POST /api/updates/rollback\``) and "CLAUDE.md's box-token bullet is TRUE, not merely present" (`does not name /api/updates/rollback`). Restore.
6. §18 "no write route takes the box token" — insert as the first line of the apply handler `    if (checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]) !== 'ok') return refuse(reply, 401, { error: 'unauthenticated' });` → `test/box-token-census.test.ts` FAIL "exactly one handler there consults the box token" (`UPDATE_LANES` gains `POST /api/updates/apply`), "UPDATE_DOORS is exactly the rest…", "a box-token call planted in the apply handler is SEEN too" (its last `not.toContain`) and "is TRUE" (`/api/updates/apply acquired a box-token gate`); and `test/update-apply-routes.test.ts -t 'a session is the credential'` FAIL `expected 401 to be 202`. Restore.
7. §18 "every capability refusal is in the dispatcher" — TWO edits together: in `server/src/update/dispatch.ts` delete the one statement in `moveRefusal` that returns `'no-detach-cap'` (`grep -n "'no-detach-cap'" server/src/update/dispatch.ts` finds it), and in `singleNodeMove` directly before `const views = dispatchViewsFor(coord);` insert `if (!row.caps.includes('detach')) return { ok: false, code: 409, body: { error: 'no-detach-cap' } };`. Run `test/update-apply-routes.test.ts -t 'the route and the dispatcher agree'` → FAIL on the `no-detach-cap` row (`the planner moved a node the route refused: expected { nodeId: … } to be null`), while `-t 'no-detach-cap; 409 agent-predates'` stays GREEN — the route-only check answers the 409 itself, the half that proves nothing, which is why the agreement table exists. Restore both files.
8. D-3386 — in `singleNodeMove` replace `if (!(SETTLED_UPDATE_STATES as readonly string[]).includes(row.updateState)) {` with `if (coord.nodes().some((n) => !(SETTLED_UPDATE_STATES as readonly string[]).includes(n.updateState))) {` → `-t "busy is the named node's OWN lease"` FAIL on the second post (`expected 409 to be 202`). Restore.
9. D-3385 / D-3401 — in `requestAll` delete the whole `if (refusal !== null) { … continue; }` block, from its `if` to its closing `}` → `-t 'requests only the nodes the tag moves forward'` FAIL (`requested` gains `OTHER_ID` and `THIRD_ID`), `-t 'could never move'` FAIL (`requested` gains the darwin row and `plan.move` is null — the server `waiting-for-fleet`) and `-t "keeps the verdict's detail"` FAIL (`requested` gains `FLEET_ID`). Restore.
10. The dispatch order of `requested` — in `requestAll` replace `[...coord.nodes()].sort(compareDispatchOrder)` with `[...coord.nodes()]` → `-t 'requests only the nodes the tag moves forward'` FAIL (`requested: [SERVER_ID, FLEET_ID]` — label order). Restore.
11. The census control is live — in the new planted-apply case change `anchor` to `"app.post('/api/updates/applied', async (req, reply) => {"` → `test/box-token-census.test.ts` FAIL "the apply registration line moved". Restore.
12. The route-count prose is pinned — in `gate.ts` put `83` back into ` * THE GATE. One `onRequest` hook stands in front of all 85 routes, the static` → `test/auth-gate.test.ts -t "gate.ts's own docstring"` FAIL `expected [ 83 ] to deeply equal [ 85 ]`. Restore.
13. Spec §12 "reports per-node refusals through `updateDetail`" — in `requestAll` replace `      if (why !== 'not-newer') {` with `      if (false) {` (the note call is never reached) → `-t 'requests only the nodes the tag moves forward'` FAIL `the unread node was skipped silently`, and `-t 'could never move'` FAIL `the skip was said nowhere the operator reads the node`. Restore.
14. The `not-newer` exception — replace the same line with `      if (true) {` → `-t 'requests only the nodes the tag moves forward'` FAIL `a node already at the tag was told it was refused` (`OTHER_ID`'s detail became `not-newer — …`). Restore.
15. Spec §12 "the CSRF origin check for free" — in `server/src/auth/gate.ts`, directly before `  ['GET /*',` insert `  ['POST /api/updates/apply', 'mutation: the one-tap exempted from the gate — this row must be seen red'],` (a reason over 40 characters, so "every EXEMPT entry states its reason" stays green and the reds are the exemption's own) → `./node_modules/.bin/vitest run test/update-apply-routes.test.ts -t 'foreign Origin'` FAIL `/api/updates/apply: … expected 202 to be 403` (the forged move is let through and writes its request); `-t 'no session → the gate'` FAIL `expected 202 to be 401` on the apply leg; and `./node_modules/.bin/vitest run test/auth-gate.test.ts -t 'exempts exactly the six classes'` FAIL (the key list gains `POST /api/updates/apply`). Restore.
16. A verdict row is tolerated, not thrown on — in `requestAll` replace `        if (!noted.ok && noted.why !== 'not-idle') {` with `        if (!noted.ok) {` → `-t "keeps the verdict's detail"` FAIL `expected 500 to be 202` (the `failed` row's `not-idle` answer thrown). Restore.

After the last restore: `git diff --stat` shows only this task's intended edits, and Step 11's runs of `update-apply-routes`, `update-routes`, `auth-gate` and `box-token-census` are green again.

- [ ] **Step 13: Commit**

```bash
git add server/src/update/routes.ts shared/api.ts pwa/src/lib/api.ts pwa/test/api.test.ts server/src/auth/gate.ts \
  server/test/update-apply-routes.test.ts server/test/update-routes.test.ts \
  server/test/auth-gate.test.ts server/test/box-token-census.test.ts CLAUDE.md
git fetch origin main && (cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
git commit -m "feat(update): POST /api/updates/apply and /api/updates/rollback — session-only, single-node 409s from the dispatcher's own moveRefusal, {all: true} skips what it cannot move forward, a request write dispatches in the same turn; route census 86 -> 88, UPDATE_DOORS six

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `topology-clean` PASS before the commit (the new test file's fixtures spell `example.invalid` and invented UUIDs only).

### Task 7: The auto path

**Files:**
- Test: `server/test/update-auto-dispatch.test.ts` (create) — `runDispatch` and `FleetWatcher` end to end over a real `CoordStore` with intent rows written by `setIntent` DIRECTLY (bypassing the route, as a node offline when `auto` was set would be), a recording `SendUpdateOp`, and a recording `Runner` behind Task 5's `localUpdateSpawnFor` (the server-role spawn is a `LocalUpdateSpawn`, never a raw `Runner` — D-3397)
- Modify: none in `server/src` unless Step 2's run on the untouched tree reds (then `server/src/update/dispatch.ts`'s `moveRefusal` and/or `planDispatch`, the fix given in Step 2); W2's intent route's `409 auto-needs-rollback-gate` is UNCHANGED (its W2 cases stay green)
- Run, not edited: `server/test/update-routes.test.ts` (the advisory 409 — run green under Step 3's mutation too, which is the §18 row's "with the route 409 still in place"), `server/test/update-dispatch.test.ts`, `server/test/update-converge.test.ts`, `server/test/typecheck-tests.test.ts` (this file is compiled by it), `server/test/topology-clean.test.ts` (after `git add` — the task adds a file). No cited file is edited (the one file this task creates is in no citation corpus), so `session-hook.test.ts` is not owed (R13)

**Interfaces:**
- Consumes: Task 4's `planDispatch`, `autoPermits`, `moveRefusal`, `DETACH_CAP`, `ROLLBACK_CAP` (`server/src/update/dispatch.ts`); `UPDATE_GATE_CAP` (wave 3 Task 7 moved it to `shared/api.ts`; `resolve.ts` re-exports it — this test imports the L0 spelling); Task 5's `runDispatch`, `ConvergeDeps` (`store`, `role`, `ccrcDir`, `localIo`, `deadlineMs`, `fleet: { state, send } | null`, `runLocal: LocalUpdateSpawn | null`, `onAccepted` — no `home`: the spawn capability carries it), `DispatchRunResult`, `SendUpdateOp` (`(tag, kind) => Promise<ResOk>`), `localUpdateSpawnFor(run: Runner, home)`, `dispatchViewsFor` (reached through `runDispatch`), `FleetWatcher.dispatchNow()`, `Deps.updateRunner?: LocalUpdateSpawn` (built here with `localUpdateSpawnFor`, as `index.ts` builds it); Task 3's `requestNode`; W2's `setIntent(scope, patch, log, now)`, `UpdateIntentPatch`, `intentFor` (Task 6), `UpdateIntentLog`, `defaultUpdateIntentLogPath` (`server/src/coord/updateintentlog.ts`, Task 6), `upsertNodeMeasurement`/`NodeMeasurement`, `markUnreachable`, `settleNode` (the writer W2's sweep settles a converged lease with), `node()`, `nodes()` (Task 5), `applyReleaseListing`/`ReleaseListingRow` (Task 4), `resolveAndProject` (Task 12, `server/src/update/project.ts` — the resolver is what writes `desiredTag`/`channel` onto the row the dispatcher reads, so every intent write here is followed by one resolve, exactly as the intent route's `reproject` and every sweep's `sweepThenProject` do), `RESOLVE_DETAIL`, `autoGateBlockers` (Task 12, `resolve.ts`, the route's advisory check), `SERVER_LABEL`, `FLEET_LABEL` (Task 11), `DEFAULT_UPDATE_DEADLINE_MS` (Task 9, `config.ts`), `buildServer`, `testDeps` (`server/test/helpers.ts:146`), `mkTmp` (`server/test/tmpHelpers.ts:38`, removed by its own `afterAll`).
- Produces: no new export — this task pins the enforcement §9 says is the dispatcher's ("**That refusal is advisory; the dispatcher is the enforcement** (§10): an auto-driven dispatch to a node whose measured `caps` lack `update-gate` is refused at dispatch time, whatever the intent row says, so a node that was offline when `auto` was set cannot converge unattended on its return").
- Correction (fixture shape, not an interface change): Task 4's `moveRefusal` order puts `no-detach-cap` BEFORE `no-update-gate`, and wave 4's `_inst_caps` writes the four W4 words together (`CCRC_CAP_WORDS=(verify node-id floor update-json update-gate rollback)` + `CCRC_CAP_WORDS_LINUX=(detach)`), so a REAL capless box — a W1–W3 install, caps `verify node-id floor` — is refused `no-detach-cap`, never `no-update-gate`. The §18 row's "capless auto fixture" therefore carries every W4 word EXCEPT the gate (`NO_GATE` below), which isolates the one check the row names; the W1-caps box is pinned beside it as the control that stays refused (and stays green) under Step 3's mutation.
- Cases: `auto: 'channel'` set on `'*'` by `setIntent` while the fleet node lacks `update-gate` in its measured `caps` → `runDispatch` sends no op, the fleet row reads `updateDetail` beginning `no-update-gate — `, no lease, `requestedTag` still NULL; the same node measured again WITH `update-gate` (a fixture re-measurement through `upsertNodeMeasurement`) → the next run dispatches `update` to `desiredTag` with `source: 'auto'`; a node unreachable when `auto` was set (the advisory predicate names it, the intent is written around the route) is not considered while away and is refused `no-update-gate` on its return; a W1-caps box → `no-detach-cap` (control); `auto: 'stable'` on a node resolved `dev` → nothing, nothing noted; `auto: 'off'` → nothing; a per-node intent row `auto: 'channel'` over a fleet row `'*'` `off` → that node only (both directions: the fleet node over the link, the server node spawned locally); an operator request on a capless node with `auto` set → moves (a requested `update` needs `detach`, not `update-gate`); the server row lacking `update-gate` under `auto` → `no-update-gate` (it is checked for caps, never for `agentOps`), and spawned with the exact argv once gated; the intent route still answers `409 auto-needs-rollback-gate` for the capless node (advisory, unchanged) and the same node, `auto` written around it, is refused by `FleetWatcher.dispatchNow()`; a gated server behind a gateless fleet under `'*'` auto is held `waiting-for-fleet` and not spawned, and once the fleet is gated the fleet moves first and the server only after the fleet has converged (D-3402, Task 4's hold, end to end); an auto move is never a rollback (a node rolled back below its floor resolves `desiredTag` NULL with `RESOLVE_DETAIL.rolledBack` and nothing is dispatched).
- Spec §18 rows pinned: "`auto` needs the gate cap, at dispatch time" (mutation: remove the dispatcher's `no-update-gate` check with the route `409` still in place → the capless auto fixture dispatches → red), "every capability refusal is in the dispatcher" (the auto path dispatches a capless node when the check is route-only → red — the same mutation, with `update-routes.test.ts` run green under it to show the route check alone does not stop it).

- [ ] **Step 1: Write the test**

Create `server/test/update-auto-dispatch.test.ts`:

```ts
// Centralised update management, programme wave 5 Task 7 (design 2026-09-20 §9
// "auto", §10, §18 "`auto` needs the gate cap, at dispatch time" and "every
// capability refusal is in the dispatcher"). The intent route's
// `409 auto-needs-rollback-gate` is ADVISORY; the dispatcher is the enforcement.
// So every intent row below that a capless node would have made the route
// refuse is written by `setIntent` DIRECTLY — the path a node that was offline
// when `auto` was set takes back into the dispatcher (§9) — and then resolved,
// as the route's `reproject` and every sweep's `sweepThenProject` resolve,
// because `desiredTag` is a stored column the resolver writes. Nothing here
// reads the live `$HOME`: every box is a `mkTmp` fixture, the fleet link is a
// recording `SendUpdateOp`, and the server-role spawn a recording `Runner`
// behind `localUpdateSpawnFor` — the same two-template capability `index.ts` binds.
import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { FLEET_SCOPE, UPDATE_GATE_CAP, type RequestKind } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import {
  CoordStore, type NodeMeasurement, type ReleaseListingRow, type UpdateIntentPatch,
} from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { DEFAULT_UPDATE_DEADLINE_MS } from '../src/config.js';
import type { Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import { localIO } from '../src/io.js';
import { Bus } from '../src/bus.js';
import { buildServer, type Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { RESOLVE_DETAIL, autoGateBlockers } from '../src/update/resolve.js';
import { resolveAndProject } from '../src/update/project.js';
import { DETACH_CAP, ROLLBACK_CAP } from '../src/update/dispatch.js';
import { localUpdateSpawnFor, runDispatch, type ConvergeDeps, type DispatchRunResult } from '../src/update/converge.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_790_000_000_000;
/** Two node-ids in `_inst_node_id`'s lowercase shape (`NODE_ID_RE`) — a node
 *  scope in `setIntent` must be one (W2 D-3194). */
const FLEET_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const SERVER_ID = '05050505-0505-4505-8505-050505050505';

/** What a W1–W3 install writes: no W4 word at all. */
const W1_CAPS = ['verify', 'node-id', 'floor'];
/** Every W4 word but the gate. `moveRefusal` checks `detach` before the gate, so
 *  only this shape isolates `no-update-gate` — a real pre-W4 box is W1_CAPS and
 *  is refused `no-detach-cap` first (the control case below). */
const NO_GATE = [...W1_CAPS, 'update-json', ROLLBACK_CAP, DETACH_CAP];
const GATED = [...NO_GATE, UPDATE_GATE_CAP];

/** One stable and one dev release, both with a bundle listed: a stable node at
 *  v0.0.9 resolves v0.0.10, a dev node v0.0.11. */
const LISTING: readonly ReleaseListingRow[] = [
  { tag: 'v0.0.10', channel: 'stable', publishedAt: NOW - 120_000, commitSha: null,
    tarballUrl: 'https://example.invalid/ccrc-v0.0.10.tar.gz', bundleListed: true, notes: null, draft: false },
  { tag: 'v0.0.11', channel: 'dev', publishedAt: NOW - 60_000, commitSha: null,
    tarballUrl: 'https://example.invalid/ccrc-v0.0.11.tar.gz', bundleListed: true, notes: null, draft: false },
];

/** The fleet node as the inventory measures it over a W4 agent: `agentOps`
 *  advertises the op, so the only refusal left to find is the capability one. */
const fleetNode = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main',
  currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: NO_GATE, agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8', floorRead: 'measured', previousRead: 'measured', os: 'linux',
  measuredAt: NOW - 60_000, report: null,
  ...over,
});
/** The server's own row: spawned locally, `agentOps` NULL by construction (decision 11). */
const serverNode = (over: Partial<NodeMeasurement> = {}): NodeMeasurement =>
  fleetNode({ nodeId: SERVER_ID, role: 'server', label: SERVER_LABEL, agentOps: null, ...over });

interface Box {
  home: string; ccrcDir: string; store: CoordStore; log: UpdateIntentLog; state: FleetState;
  sent: { tag: string; kind: RequestKind }[];
  spawned: { cmd: string; args: string[] }[];
  accepted: number;
}

/** A fixture HOME with its own coord.db and the catalogue above — never the live one. */
function box(): Box {
  const home = mkTmp('ccrc-update-auto-');
  const ccrcDir = path.join(home, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  const store = new CoordStore(openCoordDb(path.join(ccrcDir, 'coord.db')));
  const listed = store.applyReleaseListing(LISTING, NOW - 30_000, 'complete');
  expect(listed.ok, JSON.stringify(listed)).toBe(true);
  return {
    home, ccrcDir, store, log: new UpdateIntentLog(defaultUpdateIntentLogPath(ccrcDir)),
    // Task 11's fixture shape, connected, with a W4 agent's `ready.ops`.
    state: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, agentOps: ['update'] },
    sent: [], spawned: [], accepted: 0,
  };
}

/** The recording `Runner` the local spawn capability runs: it records the argv
 *  `localUpdateSpawnFor` hands it and exits 0, as a `--detach` parent does. */
const recorder = (spawned: { cmd: string; args: string[] }[]): Runner => async (cmd, args) => {
  spawned.push({ cmd, args: [...args] });
  return { code: 0, stdout: '', stderr: '' };
};

/** A two-box fleet's server: the link records every op it is asked to send and
 *  answers `accepted`; the local spawn is Task 5's `localUpdateSpawnFor` over the
 *  recorder, so the argv asserted below is the one the capability builds. */
const deps = (b: Box): ConvergeDeps => ({
  store: b.store, role: 'server', ccrcDir: b.ccrcDir, localIo: localIO,
  deadlineMs: DEFAULT_UPDATE_DEADLINE_MS,
  fleet: {
    state: b.state,
    send: async (tag, kind) => {
      b.sent.push({ tag, kind });
      return { t: 'res', id: b.sent.length, ok: true, accepted: true };
    },
  },
  runLocal: localUpdateSpawnFor(recorder(b.spawned), b.home),
  onAccepted: () => { b.accepted += 1; },
});

const measure = (b: Box, m: NodeMeasurement): void => {
  const r = b.store.upsertNodeMeasurement(m);
  expect(r.ok, `measuring ${m.nodeId}: ${JSON.stringify(r)}`).toBe(true);
};
/** The resolver, as the intent route and every sweep run it after a write. */
const resolve = async (b: Box, now: number): Promise<void> => {
  await resolveAndProject({ store: b.store, role: 'server', ccrcDir: b.ccrcDir }, now);
};
/** `setIntent` DIRECTLY — around the advisory route — then the resolver. */
const intend = async (b: Box, scope: string, patch: UpdateIntentPatch, now = NOW): Promise<void> => {
  const w = b.store.setIntent(scope, patch, b.log, now);
  expect(w.ok, JSON.stringify(w)).toBe(true);
  await resolve(b, now);
};
type Ran = Extract<DispatchRunResult, { ran: true }>;
const run = async (b: Box, now = NOW): Promise<Ran> => {
  const r = await runDispatch(deps(b), now);
  if (!r.ran) throw new Error(`runDispatch did not run: ${r.why}`);
  return r;
};

describe('auto needs the gate cap, at dispatch time (spec §9, §18)', () => {
  it('a node whose measured caps lack update-gate is refused no-update-gate under auto: no op, no lease, no request', async () => {
    const b = box();
    measure(b, fleetNode());
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    expect(b.store.node(FLEET_ID)).toMatchObject({ channel: 'stable', desiredTag: 'v0.0.10' });
    const r = await run(b);
    expect(r.plan.move).toBeNull();
    expect(r.plan.refusals).toEqual([expect.objectContaining({ nodeId: FLEET_ID, refusal: 'no-update-gate' })]);
    expect(r.outcome).toBeNull();
    expect(b.sent, 'the capless node was sent the op').toEqual([]);
    expect(b.spawned).toEqual([]);
    expect(b.accepted).toBe(0);
    const row = b.store.node(FLEET_ID)!;
    expect(row).toMatchObject({
      updateState: 'idle', updateTarget: null, updateStartedAt: null,
      requestedTag: null, requestedKind: null, requestedAt: null,
    });
    expect(row.updateDetail).toMatch(/^no-update-gate — /);
  });

  it('the same node re-measured WITH update-gate dispatches on the next run — the caps read are the ones measured now', async () => {
    const b = box();
    measure(b, fleetNode());
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    expect((await run(b)).plan.move).toBeNull();
    measure(b, fleetNode({ caps: GATED, measuredAt: NOW + 60_000 }));
    await resolve(b, NOW + 60_000);
    const r = await run(b, NOW + 60_000);
    expect(r.plan.move).toMatchObject({ nodeId: FLEET_ID, kind: 'update', target: 'v0.0.10', source: 'auto', viaLink: true });
    expect(r.outcome).toMatchObject({ nodeId: FLEET_ID, result: 'accepted' });
    expect(b.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(b.spawned).toEqual([]);
    expect(b.accepted).toBe(1);
    // An auto move is a lease, never a request: nothing for ack to clear.
    expect(b.store.node(FLEET_ID)).toMatchObject({
      updateState: 'pending', updateTarget: 'v0.0.10', updateStartedAt: NOW + 60_000, requestedTag: null,
    });
  });

  it('a node offline when auto was set cannot converge unattended on its return (§9, the sentence this row is about)', async () => {
    const b = box();
    measure(b, fleetNode());
    expect(b.store.markUnreachable(FLEET_LABEL, 'fleet', NOW - 30_000)).toMatchObject({ ok: true, nodeId: FLEET_ID });
    b.state.connected = false;
    // The route would have refused this write — the advisory predicate names the node, reachable or not.
    expect(autoGateBlockers(FLEET_SCOPE, b.store.nodes().map((n) => ({ nodeId: n.nodeId, caps: n.caps }))))
      .toEqual([FLEET_ID]);
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    const away = await run(b);
    expect(away.plan.move).toBeNull();
    expect(away.plan.refusals, 'an unreachable node is not considered, so nothing is noted').toEqual([]);
    expect(b.store.node(FLEET_ID)?.updateDetail).toBeNull();
    // It comes back — still capless.
    b.state.connected = true;
    measure(b, fleetNode({ measuredAt: NOW + 60_000 }));
    await resolve(b, NOW + 60_000);
    const back = await run(b, NOW + 60_000);
    expect(back.plan.move).toBeNull();
    expect(back.plan.refusals).toEqual([expect.objectContaining({ nodeId: FLEET_ID, refusal: 'no-update-gate' })]);
    expect(b.sent).toEqual([]);
    expect(b.store.node(FLEET_ID)).toMatchObject({ reachable: true, updateState: 'idle', requestedTag: null });
  });

  it('control: a W1-caps box under auto is refused no-detach-cap — moveRefusal checks detach first, and still no op', async () => {
    const b = box();
    measure(b, fleetNode({ caps: W1_CAPS }));
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    const r = await run(b);
    expect(r.plan.move).toBeNull();
    expect(r.plan.refusals).toEqual([expect.objectContaining({ nodeId: FLEET_ID, refusal: 'no-detach-cap' })]);
    expect(b.sent).toEqual([]);
  });

  it("auto 'stable' on a node resolved dev moves nothing and notes nothing — the node is not considered", async () => {
    const b = box();
    measure(b, fleetNode({ caps: GATED }));
    await intend(b, FLEET_SCOPE, { channel: 'dev', auto: 'stable' });
    expect(b.store.node(FLEET_ID)).toMatchObject({ channel: 'dev', desiredTag: 'v0.0.11' });
    const r = await run(b);
    expect(r.plan.move).toBeNull();
    expect(r.plan.refusals).toEqual([]);
    expect(b.sent).toEqual([]);
    expect(b.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: null });
  });

  it("auto 'off' moves nothing, gated or not — notify only", async () => {
    const b = box();
    measure(b, fleetNode({ caps: GATED }));
    await intend(b, FLEET_SCOPE, { auto: 'off' });
    expect(b.store.node(FLEET_ID)?.desiredTag).toBe('v0.0.10');
    const r = await run(b);
    expect(r.plan.move).toBeNull();
    expect(r.plan.refusals).toEqual([]);
    expect(b.sent).toEqual([]);
    expect(b.spawned).toEqual([]);
  });

  it("a per-node auto row over '*' off moves that node only — the fleet node over the link", async () => {
    const b = box();
    measure(b, fleetNode({ caps: GATED }));
    measure(b, serverNode({ caps: GATED }));
    await intend(b, FLEET_ID, { auto: 'channel' });
    expect(b.store.intentFor(FLEET_SCOPE)!.auto).toBe('off');
    const r = await run(b);
    expect(r.plan.move).toMatchObject({ nodeId: FLEET_ID, source: 'auto', viaLink: true });
    expect(b.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(b.spawned, 'the server row follows `*` (off) and must not move').toEqual([]);
    expect(b.store.node(SERVER_ID)).toMatchObject({ updateState: 'idle', updateDetail: null });
  });

  it("a per-node auto row over '*' off moves that node only — the server node, spawned locally", async () => {
    const b = box();
    measure(b, fleetNode({ caps: GATED }));
    measure(b, serverNode({ caps: GATED }));
    await intend(b, SERVER_ID, { auto: 'channel' });
    const r = await run(b);
    expect(r.plan.move).toMatchObject({ nodeId: SERVER_ID, source: 'auto', viaLink: false });
    expect(b.spawned).toEqual([
      { cmd: `${b.home}/.local/bin/ccrc`, args: ['update', '--to', 'v0.0.10', '--detach', '--from', 'pwa'] },
    ]);
    expect(b.sent, 'the fleet row follows `*` (off) and must not be sent the op').toEqual([]);
    expect(b.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', updateDetail: null });
  });

  it('an operator request on a capless node moves under auto — a requested update needs detach, not the gate', async () => {
    const b = box();
    measure(b, fleetNode());
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    expect(b.store.requestNode(FLEET_ID, 'v0.0.10', 'update', NOW)).toMatchObject({ ok: true });
    const r = await run(b);
    expect(r.plan.move).toMatchObject({ nodeId: FLEET_ID, kind: 'update', target: 'v0.0.10', source: 'request' });
    expect(b.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    // The request stands until convergence settles it (decision 7) — the lease is what moved.
    expect(b.store.node(FLEET_ID)).toMatchObject({ updateState: 'pending', requestedTag: 'v0.0.10', requestedKind: 'update' });
  });

  it('the server row lacking update-gate under auto is refused no-update-gate — checked for caps, never for agentOps', async () => {
    const b = box();
    measure(b, serverNode());
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    const refused = await run(b);
    expect(refused.plan.move).toBeNull();
    expect(refused.plan.refusals).toEqual([expect.objectContaining({ nodeId: SERVER_ID, refusal: 'no-update-gate' })]);
    expect(b.spawned).toEqual([]);
    expect(b.store.node(SERVER_ID)?.updateDetail).toMatch(/^no-update-gate — /);
    // Gated, the same row moves — and agentOps NULL is never read as "predates the op".
    measure(b, serverNode({ caps: GATED, measuredAt: NOW + 60_000 }));
    await resolve(b, NOW + 60_000);
    const moved = await run(b, NOW + 60_000);
    expect(moved.plan.move).toMatchObject({ nodeId: SERVER_ID, source: 'auto', viaLink: false });
    expect(b.spawned).toEqual([
      { cmd: `${b.home}/.local/bin/ccrc`, args: ['update', '--to', 'v0.0.10', '--detach', '--from', 'pwa'] },
    ]);
    expect(b.sent).toEqual([]);
  });

  it("a gated server waits behind a gateless fleet under '*' auto; once gated the fleet moves first, then the server (D-3402)", async () => {
    const b = box();
    measure(b, fleetNode());                          // NO_GATE: auto cannot move it
    measure(b, serverNode({ caps: GATED }));
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    const held = await run(b);
    expect(held.plan.move).toBeNull();
    expect(held.plan.refusals.map((r) => [r.nodeId, r.refusal]))
      .toEqual([[FLEET_ID, 'no-update-gate'], [SERVER_ID, 'waiting-for-fleet']]);
    expect(b.sent).toEqual([]);
    expect(b.spawned, 'the server auto-moved before the fleet').toEqual([]);
    expect(b.store.node(SERVER_ID)?.updateDetail).toMatch(/^waiting-for-fleet — /);
    // The fleet is gated: it moves first, over the link, while the server still waits.
    measure(b, fleetNode({ caps: GATED, measuredAt: NOW + 60_000 }));
    await resolve(b, NOW + 60_000);
    const first = await run(b, NOW + 60_000);
    expect(first.plan.move).toMatchObject({ nodeId: FLEET_ID, source: 'auto', viaLink: true });
    expect(b.sent).toEqual([{ tag: 'v0.0.10', kind: 'update' }]);
    expect(b.spawned).toEqual([]);
    // The fleet converges — measured at the target and settled by W2's writer, as its sweep settles a `done`
    // report — so its desiredTag resolves NULL, and the server moves on the next run.
    measure(b, fleetNode({ caps: GATED, currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: NOW + 120_000 }));
    expect(b.store.settleNode(FLEET_ID, 'converged at v0.0.10', null)).toMatchObject({ ok: true });
    await resolve(b, NOW + 120_000);
    expect(b.store.node(FLEET_ID)?.desiredTag).toBeNull();
    const second = await run(b, NOW + 120_000);
    expect(second.plan.move).toMatchObject({ nodeId: SERVER_ID, source: 'auto', viaLink: false });
    expect(b.spawned).toEqual([
      { cmd: `${b.home}/.local/bin/ccrc`, args: ['update', '--to', 'v0.0.10', '--detach', '--from', 'pwa'] },
    ]);
    expect(b.sent).toHaveLength(1);
  });

  it('an auto move is never a rollback: a node rolled back below its floor resolves nothing, and nothing is dispatched', async () => {
    const b = box();
    // Floor v0.0.10 (highest), running v0.0.8: the only eligible stable tag is the floor itself.
    measure(b, fleetNode({ caps: GATED, currentVersion: 'v0.0.8', highestVersion: 'v0.0.10', previousVersion: 'v0.0.10' }));
    await intend(b, FLEET_SCOPE, { auto: 'channel' });
    expect(b.store.node(FLEET_ID)).toMatchObject({
      desiredTag: null, resolveDetail: RESOLVE_DETAIL.rolledBack('v0.0.8', 'v0.0.10'),
    });
    const r = await run(b);
    expect(r.plan.move).toBeNull();
    expect(r.plan.refusals).toEqual([]);
    expect(b.sent).toEqual([]);
    expect(b.store.node(FLEET_ID)).toMatchObject({ updateState: 'idle', requestedTag: null, requestedKind: null });
  });
});

describe('the advisory route and the enforcing dispatcher, one box (FleetWatcher.dispatchNow)', () => {
  it('the intent route still answers 409 auto-needs-rollback-gate; auto written around it is refused at dispatch', async () => {
    const home = mkTmp('ccrc-update-auto-watch-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    expect(coord.applyReleaseListing(LISTING, NOW - 30_000, 'complete').ok).toBe(true);
    const spawned: { cmd: string; args: string[] }[] = [];
    // `Deps.updateRunner` is a LocalUpdateSpawn (Task 5, D-3397) — bound as index.ts binds it.
    const updateRunner = localUpdateSpawnFor(recorder(spawned), home);
    const log = new UpdateIntentLog(defaultUpdateIntentLogPath(base.cfg.ccrcDir));
    const deps: Deps = { ...base, coord, updateIntentLog: log, updateRunner };
    const bus = new Bus();
    // A REAL watcher, never started; its state cache on the fixture home.
    const w = new FleetWatcher(deps, bus, 60_000, path.join(base.cfg.ccrcDir, 'state-cache.json'));
    const app = await buildServer(deps, bus, w);
    await app.ready();
    try {
      // The local-mode box: its one row is the server's own, labelled SERVER_LABEL,
      // so the route's on-demand sweep (`ensureInventory`) does not re-measure it.
      const m = coord.upsertNodeMeasurement(serverNode({ role: base.cfg.role }));
      expect(m.ok, JSON.stringify(m)).toBe(true);
      const res = await app.inject({ method: 'POST', url: '/api/updates/intent', payload: { scope: '*', auto: 'channel' } });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: 'auto-needs-rollback-gate', nodes: [SERVER_ID] });
      expect(coord.intentFor(FLEET_SCOPE)!.auto).toBe('off');
      // The enforcement does not lean on that refusal: the row written around it.
      expect(coord.setIntent(FLEET_SCOPE, { auto: 'channel' }, log, NOW).ok).toBe(true);
      await resolveAndProject({ store: coord, role: base.cfg.role, ccrcDir: base.cfg.ccrcDir }, NOW);
      const r = await w.dispatchNow();
      if (!r.ran) throw new Error(`dispatchNow did not run: ${r.why}`);
      expect(r.plan.refusals).toEqual([expect.objectContaining({ nodeId: SERVER_ID, refusal: 'no-update-gate' })]);
      expect(r.outcome).toBeNull();
      expect(spawned, 'the capless server node was spawned under auto').toEqual([]);
      expect(coord.node(SERVER_ID)?.updateDetail).toMatch(/^no-update-gate — /);
    } finally {
      await app.close();
      coord.db.close();
    }
  });
});
```

- [ ] **Step 2: Run it on the tree Tasks 4–5 left**

Run: `cd server && ./node_modules/.bin/vitest run test/update-auto-dispatch.test.ts`
Expected: PASS, 13 cases (12 + 1; the D-3402 case was added in review and this count is UNMEASURED — count them). This task pins an enforcement Tasks 4–5 already shipped, so the red-first measurement is Step 3's mutation, and this run is its control ("a green mutation needs a control": the same file, the untouched tree). A red HERE means the auto arm is missing from Tasks 4–5, and the fix is in `server/src/update/dispatch.ts`:
- a capless case moves (`expected { nodeId: …, source: 'auto', … } to be null`) → `moveRefusal` lacks the check. Add Task 4's line after the rollback-only `no-rollback-cap` check and before the link-only `agent-predates-update-op` check (Task 4's docstring order), spelled over `moveRefusal`'s own local `const row = view.row;`, with `UPDATE_GATE_CAP` merged into the file's `'../../../shared/api.js'` import if it is not already there:

  ```ts
    // Spec §9: the intent route's 409 is advisory; THIS is the enforcement. Auto-driven only — a requested
    // update needs `detach` (checked above), never the gate.
    if (move.source === 'auto' && !row.caps.includes(UPDATE_GATE_CAP)) return 'no-update-gate';
  ```
- a per-node or gated case moves nothing (`expected null to match object { source: 'auto' }`) → `planDispatch`'s considered set lacks the auto arm. `planDispatch` considers a view through Task 4's private `intendedMove(v)`; its auto arm, after the request arm (`if (r.requestedTag !== null) { … }`, over its local `const r = v.row;`), is:

  ```ts
    if (autoPermits(v.auto, r.channel) && r.desiredTag !== null) return { kind: 'update', target: r.desiredTag, source: 'auto' };
  ```
Re-run until green; count the cases (13).

- [ ] **Step 3: Mutation — the dispatcher's gate check removed, the route's 409 left in place (§18 "`auto` needs the gate cap, at dispatch time", "every capability refusal is in the dispatcher")**

```bash
cd server
cp src/update/dispatch.ts "${TMPDIR:-/tmp}/w5-t7-dispatch.ts.orig"
grep -c "return 'no-update-gate'" src/update/dispatch.ts    # must print 1 — if not, stop and locate the one return by hand
sed -i "/return 'no-update-gate'/d" src/update/dispatch.ts
./node_modules/.bin/vitest run test/update-auto-dispatch.test.ts
./node_modules/.bin/vitest run test/update-routes.test.ts
```

Expected: `update-auto-dispatch.test.ts` FAILS exactly 6 cases — "a node whose measured caps lack update-gate …", "the same node re-measured WITH update-gate …" (its first run moves), "a node offline when auto was set …" (the return run moves), "the server row lacking update-gate …", "a gated server waits behind a gateless fleet … " (its first run moves the gateless fleet — added in review, unmeasured), and "the intent route still answers 409 …" (its route assertions PASS, then `expected [] to deeply equal [ ObjectContaining{ nodeId: '05050505-…', refusal: 'no-update-gate' } ]` — the capless node was dispatched with the 409 still in place). The other 7 stay green (the W1-caps control is still refused `no-detach-cap`). `update-routes.test.ts` stays GREEN, every case: the advisory 409 alone does not stop an auto move — which is the row. Restore, and prove the restore:

```bash
cp "${TMPDIR:-/tmp}/w5-t7-dispatch.ts.orig" src/update/dispatch.ts
cmp src/update/dispatch.ts "${TMPDIR:-/tmp}/w5-t7-dispatch.ts.orig" && git diff --quiet -- src/update/dispatch.ts && echo restored
./node_modules/.bin/vitest run test/update-auto-dispatch.test.ts
```

Expected: `restored`, then PASS, 13 cases. (If Step 2 needed its fix, that fix is still uncommitted here, so `git diff --quiet` is false by design: drop it from the line and let `cmp` against the backup — taken AFTER the fix — be the proof.)

- [ ] **Step 4: Mutation — the gate demanded of every move (the check's precision)**

Same backup. Remove the conjunct that tests the move's source from Task 4's gate line, so the gate is required of a requested move too:

```bash
sed -i "s/if (move.source === 'auto' && !row.caps.includes(UPDATE_GATE_CAP)) return 'no-update-gate';/if (!row.caps.includes(UPDATE_GATE_CAP)) return 'no-update-gate';/" src/update/dispatch.ts
grep -c "if (!row.caps.includes(UPDATE_GATE_CAP)) return 'no-update-gate';" src/update/dispatch.ts   # must print 1 — if 0, Task 4's line is spelled otherwise: stop and edit that one conjunct by hand
./node_modules/.bin/vitest run test/update-auto-dispatch.test.ts
```

Expected: FAIL exactly 1 case — "an operator request on a capless node moves under auto …" (`expected null to match object { nodeId: '0f0e0d0c-…', kind: 'update', target: 'v0.0.10', source: 'request' }`); the 12 others stay green (every move in the D-3402 case is an auto move of a node the gate already governs, so demanding the gate of requests too changes nothing there). Restore with the same `cp` / `cmp` / `git diff --quiet` / `echo restored` sequence as Step 3, and re-run: PASS, 13 cases.

- [ ] **Step 5: Run the neighbours**

```bash
cd server
./node_modules/.bin/vitest run test/update-routes.test.ts
./node_modules/.bin/vitest run test/update-dispatch.test.ts
./node_modules/.bin/vitest run test/update-converge.test.ts
./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected: PASS, each (the new file compiles under `typecheck-tests.test.ts` — the `Ran` narrowing, the `ConvergeDeps` literal and the `ResOk` answer are all type-checked there). If Step 2 needed its fix, `update-dispatch.test.ts` is where Task 4's own table must still be green over it.

- [ ] **Step 6: Commit**

```bash
git add server/test/update-auto-dispatch.test.ts
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts && cd ..
git commit -m "test(update): auto needs the gate cap at dispatch time — a capless node under auto is refused no-update-gate whatever the intent row says; the route's 409 is advisory"
```

If Step 2 needed its fix, `server/src/update/dispatch.ts` joins the `git add` and the message's type is `feat(update):`.

### Task 8: The PWA controls, enabled

**Files:**
- Create: `pwa/src/fleet/movePlan.ts` (pure: `MoveIntent`, `PlannedMove`, `MoveRequest`, `planMove`, `moveTarget`, `moveHeadline`, `moveLines`, `moveRequests`, `moveEmptyText`, `moveLabel`), `pwa/src/fleet/UpdateMoveSheet.tsx` (`MOVE_UNREADABLE_TEXT`, `MOVE_NOTHING_REQUESTED_TEXT`, `MOVE_REST_TEXT`, `MoveSendError`, `sendMove`, `moveSkippedText`, `UpdateMoveSheet`)
- Modify: `pwa/src/lib/api.ts` — `applyUpdate` and `rollbackUpdate` in the returned object directly after wave 3's `ackUpdateNode` (quoted: `    ackUpdateNode: (nodeId: string) =>` / `      postJsonOr<AckAnswer | 'unreadable'>('/api/updates/ack', 'unreadable', { nodeId }),`), each on `postJsonOr` *(CORRECTED from the skeleton's `postJson` — see Interfaces)*; `moveSkipText` directly after wave 3's `updateErrorText` *(ADDED by review: the sheet says a skipped node's word through the one table)*; the import line (wave 3 Task 5's one `import type { AccountsResponse, AckAnswer, … } from '../../../shared/api';` line) gains `ApplyUpdateBody, MoveRequestAnswer, MoveSkipWhy, RollbackUpdateBody` in place, in the line's alphabetical order; `MOVE_DISABLED_TEXT`, its docstring and the blank line above it DELETED (no reader remains)
- Modify: `pwa/src/screens/SettingsScreen.tsx` — wave 3 Task 8's `ReleaseItem` and `ReleaseList` replaced whole (the move button loses `disabled`, its note span and `useId`, and calls `onMove`); wave 3 Task 9's `NodeItem` and `NodeList` replaced whole (Update enabled iff `pendingTag(n) !== null`, Roll back iff `isReleaseTag(n.previousVersion)` AND the node's measured tag is newer than it, or the stamp gives no tag to compare it with *(ADDED by review: a rollback leaves `previous` in place — wave 4's D-3262 — so a node just rolled back reads `previousVersion` equal to its running tag, and a tap there would be a `202` the dispatcher files as `met`)*, both calling `onMove`; a Darwin row still renders neither, D-3308; the row renders `n.update.detail` under its state line *(ADDED by review: the dispatcher records every outcome in `updateDetail` — `halted`, `busy — …`, `agent-predates-update-op — …`, `deadline`, a spawn's stderr line — and wave 3's `nodeStateLine` reads only `update.state` and the report, so nothing on the PWA said them; spec §12 has `{all: true}` report per-node refusals "through `updateDetail`")*); Task 7's `UpdatesBody` gains ONE state line and its two list lines are replaced by three (the lists get `onMove`, one `UpdateMoveSheet` whose `onDone` is `reload`); the two block comments that spell the retired constant (Task 8's and Task 9's) are reworded; imports: `planMove, type MoveIntent, type PlannedMove` (`'../fleet/movePlan'`) and `UpdateMoveSheet` (`'../fleet/UpdateMoveSheet'`) added, `MOVE_DISABLED_TEXT` removed from the `'../lib/api'` line
- Modify: `pwa/src/fleet/UpdateBanner.tsx` — its header's "Update all is DISABLED" paragraph reworded, its import block replaced, `UpdateBanner` replaced (Update all loses `disabled`/the note and opens `UpdateMoveSheet` with `planMove(view, { scope: 'fleet', direction: 'update', tag: bannerRelease(view).tag })`; a new optional `onMoved` prop is the re-poll after a 2xx); `bannerRelease` and `updateBannerText` untouched; no `QuickConfirm` import (D-3389)
- Modify: `pwa/src/screens/FleetScreen.tsx` — the quoted `      <UpdateBanner updates={updates.view} />` (wave 3 Task 11) becomes `      <UpdateBanner updates={updates.view} onMoved={updates.reload} />` *(CORRECTION: the skeleton listed no FleetScreen edit, but spec §13's "a `202` closes it and re-polls" needs the banner to reach the screen's one poll — FleetScreen injects the view, so `useUpdatesView(0)`'s own `reload` is a no-op there; one line replaced in place, line-neutral)*
- Modify: `pwa/src/fleet/fleet.css` — `.update-move-sheet`, `.update-move-sheet .update-move-list`, `.update-move-sheet .update-move-node`, `.update-move-sheet .update-move-error` appended after the last line; the `.settings-move-note` rule (wave 3 Task 8) and the `.update-banner-note` rule (wave 3 Task 11) deleted; one line of wave 3 Task 9's inventory header comment that names `.settings-move-note` reworded
- Modify: `pwa/design/audit.mjs` — the `'fleet.css .settings-move-note'` `INHERITED_GROUNDS` entry deleted (it would be stale — `contrast.test.ts`'s "has no stale inherited registry entry"). *(CORRECTION: the skeleton expected "one entry per new colour rule over an unpainted ancestor"; there are none — `.update-move-sheet` is SELF-GROUNDED (its own `color` and `background`, the `.abandon-sheet` pairing, `fleet.css:2796-2804` at `d759c914`) and the one child rule that sets a colour names it as its ancestor, which is `audit.mjs`'s route 4, "named-ancestor descendants" (`audit.mjs:69-72`); measured on a scratch copy, Step 13)*
- Test: `pwa/test/move-plan.test.ts` (create), `pwa/test/update-move-sheet.test.tsx` (create); wave 3's "disabled" pins REWRITTEN in place as "enabled and ordered" pins: `pwa/test/settings-screen.test.tsx` ("renders every move button DISABLED, described by the one W3 sentence …" → four cases; "renders Update and Roll back DISABLED on every managed row, described by the one W3 sentence …" → four cases; the Darwin case loses its one `MOVE_DISABLED_TEXT` line), `pwa/test/update-banner.test.tsx` ("renders Update all DISABLED, described by the one W3 sentence …" → two cases), `pwa/test/api.test.ts` (the route-literal census "spells exactly the four W2 update routes — no apply, no rollback …" → six literals; "MOVE_DISABLED_TEXT is the one literal every disabled move control carries" → a literal-absence scan over `pwa/src`; the two lead-comment lines above wave 3's `describe('the update plane client (W3 Task 5)', …)` that say no move method exists reworded in place, two for two; one describe appended for the two client methods); `pwa/test/fleet-screen.test.tsx` — *(CORRECTION: wave 3 wrote no "disabled" case in this file — its two banner cases assert the poll count and the silence — so nothing is rewritten; one describe is APPENDED after the file's last line: Update all on the real screen, which is also the only pin of FleetScreen's `onMoved` wiring)*
- Run, not edited: `pwa/test/contrast.test.ts`, `pwa/test/fleet-css.test.ts`, `pwa/test/use-updates-view.test.tsx`, `pwa/test/build-line.test.tsx`, `pwa/test/fleet-host-banner.test.tsx`, `pwa/test/tap-targets.test.tsx`, `pwa/test/app.test.tsx`, `pwa/test/sheet-handle-only.test.tsx` (it walks `pwa/src` for `<Sheet … full>` consumers; `UpdateMoveSheet` is a new, non-`full` one), `node design/contrast-check.mjs`, `cd pwa && npm run build`, `server/test/single-definition.test.ts` (it walks `pwa/src`: the order comparator and the refusal words have one holder), `server/test/topology-clean.test.ts` (two files added), `server/test/session-hook.test.ts` (R13 governs nothing here — no edited file is cited by its corpus. Its `CORPUS` is the compaction-card spec, its plan A and `README.md` (`session-hook.test.ts:7073-7077`), and its `FILE_RE` admits only `.ts|.mts|.mjs|.js|.sh`, so of this task's files only `lib/api.ts`, `api.test.ts`, `movePlan.ts`, `move-plan.test.ts` and `design/audit.mjs` could be cited at all; measured at `d759c914`: `git grep -nE '(lib/api|api\.test|movePlan|move-plan\.test|design/audit)\.(ts|mjs):[0-9]' -- README.md docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md` prints nothing. Outside that corpus, `CoordBanner.tsx:47` and `coord-banner.test.tsx:177` cite `lib/api.ts:153-164`, above every line this task deletes, and `useProjectedHome.ts:19` / `RunsScreen.tsx:717` cite `FleetScreen.tsx` lines already drifted, which this task's one-for-one line replacement does not move — run once as the cheap proof)

**Interfaces:**
- Consumes: Task 4's `compareDispatchOrder` (`shared/api.ts`, end-of-file block); Task 6's `ApplyUpdateBody`, `RollbackUpdateBody`, `MoveRequestAnswer` (its `skipped: MoveSkip[]`), `MoveSkipWhy` and the widened `UpdateRouteError`, whose new words `UPDATE_ERROR_TEXT` carries (its `Record<Exclude<UpdateRouteError, 'unauthenticated'>, string>` makes that a compile error without them, D-3302); the two routes' answers — `202 MoveRequestAnswer` · `400`/`404`/`409`/`501` refusals (`UpdateRouteRefusal`); wave 3's `UpdatesView`/`NodeWire`, `pendingTag`, `nodeVersion` (`pwa/src/fleet/useUpdatesView.ts`), `UpdatesPoll.reload`, `releaseDirection`, `bannerRelease`, `updateErrorText`, `ApiError`, `postJsonOr` (`pwa/src/lib/api.ts:382` at `d759c914`), `toast` (`pwa/src/components/Toast.tsx:33`), `Sheet` (`pwa/src/components/Sheet.tsx:27`), `.qc-consequence`/`.qc-actions`/`.btn-primary`/`.btn-ghost` (`pwa/src/components/primitives.css`), the `AbandonSheet.tsx` busy/error/generation idiom (`gen` `:164`, its cleanup `:169`, `confirm` `:177` at `d759c914`); `isReleaseTag` (W2 Task 1), `isNewerTag` (W2 Task 2, `shared/semver.ts` — throws `RangeError` on a non-tag, so every call sits behind `isReleaseTag`).
- Produces (in `pwa/src/lib/api.ts`) — **CORRECTED** from the skeleton's `postJson<MoveRequestAnswer>`: both methods are WRITES whose 2xx means a request row was written, so an answer whose body cannot be parsed is "requested, unconfirmed", not a failure — the file's own D-1150 doctrine (`postJsonOr`'s docstring: "Only a caller that can state a SAFE reading of 'no answer' may have this"), and the reason wave 3's `setUpdateIntent` and `ackUpdateNode` use it. With `postJson` a truncated `202` rejects with a `TypeError` and the sheet would say the move failed while the request stood.

```ts
applyUpdate: (body: ApplyUpdateBody) =>
  postJsonOr<MoveRequestAnswer | 'unreadable'>('/api/updates/apply', 'unreadable', body),
rollbackUpdate: (body: RollbackUpdateBody) =>
  postJsonOr<MoveRequestAnswer | 'unreadable'>('/api/updates/rollback', 'unreadable', body),
```

- Produces (in `pwa/src/lib/api.ts`) — **ADDED** (review, spec §12's per-node refusal reporting): a `{all: true}` `202` can skip a node the sheet named, for a reason the plan cannot preview, and its word is a `MoveSkipWhy` — a subset of `UPDATE_ERROR_TEXT`'s keys, so the sentence is the table's own, never a second copy:

```ts
/** The update table's sentence for a word `{all: true}`'s 202 skipped a node with. */
export function moveSkipText(why: MoveSkipWhy): string;
```

- Produces (in `pwa/src/fleet/movePlan.ts`, pure) — the skeleton's four names unchanged, plus `moveTarget`, `MoveRequest` and `moveRequests` *(ADDED: the request(s) one confirm sends are a pure decision this file names — "which nodes a move names, in dispatch order, and the request(s) it sends" — so the direction is testable without a render)*, and `moveEmptyText`, `moveLabel` and `PlannedMove.inventory` *(ADDED by review: the empty-plan sentence said "every node is already there" when a node was AHEAD of the target; and a `409 halted` names halting nodes the move does not move, so the plan keeps the inventory it was planned over to label them)*; `moveLines`' current word is **CORRECTED**:

```ts
export type MoveIntent =
  | { scope: 'node'; direction: 'update'; nodeId: string; tag: string }     // apply {nodeId, tag}
  | { scope: 'node'; direction: 'rollback'; nodeId: string; to: string }    // rollback {nodeId, to}
  | { scope: 'fleet'; direction: 'update'; tag: string }                    // apply {all: true, tag}
  | { scope: 'fleet'; direction: 'rollback'; to: string };                  // one rollback {nodeId, to} per node, in order (D-3390)
export interface PlannedMove { intent: MoveIntent; nodes: NodeWire[]; inventory: readonly NodeWire[] }   // nodes: the ones it moves, sorted by compareDispatchOrder; inventory: the view's nodes it was planned over
export type MoveRequest =
  | { route: 'apply'; body: ApplyUpdateBody }
  | { route: 'rollback'; body: RollbackUpdateBody };
/** fleet/update: nodes the tag takes forward (a tag nodeVersion older than it, or stampRead 'ok' with none — and
 *  never one whose floor, a tag `highestVersion`, is at or above it: D-3403), not
 *  darwin; fleet/rollback: every non-darwin node whose nodeVersion is newer than `to`; node: that node alone
 *  (none when the view does not carry it). A target that is not a release tag names nothing. Never reorders the view. */
export function planMove(view: UpdatesView, intent: MoveIntent): PlannedMove;
/** The tag a move points at: `tag` forward, `to` back. */
export function moveTarget(intent: MoveIntent): string;
/** `Update ${tag}` / `Roll back to ${to}` — the sheet's title and its confirm button's label. */
export function moveHeadline(intent: MoveIntent): string;
/** One line per node, in order: `${i + 1}. ${label} (${role ?? 'unknown role'}) ${current} → ${target}`, where
 *  current is nodeVersion(n), else 'unversioned' when stampRead is 'ok', else 'stamp not read'. */
export function moveLines(plan: PlannedMove): string[];
/** node/update → [apply {nodeId, tag}]; fleet/update → [apply {all: true, tag}]; node/rollback → [rollback {nodeId, to}];
 *  fleet/rollback → one rollback {nodeId, to} per plan node, in plan order; an empty plan → []. */
export function moveRequests(plan: PlannedMove): MoveRequest[];
/** An empty plan's sentence, stating only what was measured: node → `Nothing to move — that node is no longer in
 *  the inventory.`; a non-tag target → `Nothing to move — ${target} is not a release tag.`; fleet/update →
 *  `Nothing to move — ${tag} takes no managed node forward.`; fleet/rollback → `Nothing to move — no managed node is measured on a release newer than ${to}.` */
export function moveEmptyText(intent: MoveIntent): string;
/** The label `plan.inventory` gives `nodeId`, else the id itself (a node that has left the inventory). */
export function moveLabel(plan: PlannedMove, nodeId: string): string;
```

  *(the current-word correction: the skeleton's `${nodeVersion ?? 'unversioned'}` prints `unversioned` for a node whose stamp could not be READ — `nodeVersion` is null for both — which is the fold spec §18 "`stampRead` keeps EACCES from unversioned" forbids and wave 3's `currentText` keeps apart on the inventory row (D-3307); a node-scope Roll back can reach such a node, since it stays enabled when the stamp gives no tag to compare `previousVersion` with.)*

- Produces (in `pwa/src/fleet/UpdateMoveSheet.tsx`) — **CORRECTED** rejection shape and two added constants: the skeleton's "rejects with the first ApiError and the nodeIds already requested" is one value carrying two facts, so it is a named error class; and a resolved answer can be `'unreadable'` (the client correction above).

```tsx
/** The info toast after a 2xx whose body would not parse (postJsonOr's 'unreadable'): the request may stand. */
export const MOVE_UNREADABLE_TEXT = "Requested — the server's answer could not be read; the screen will re-check.";
/** ADDED (review): a readable 2xx that requested no node and skipped none the sheet named — said in place. */
export const MOVE_NOTHING_REQUESTED_TEXT = 'The server requested no node — reload the screen to see each row.';
/** ADDED (review): appended when a per-node sequence stopped part-way — this sheet re-sends nothing. */
export const MOVE_REST_TEXT = 'Move the rest from the release list once that node settles.';
/** A move refused part-way: `err` is the refusal (an ApiError from the route, or a transport error), `requested`
 *  the nodeIds whose single-node request was already written (empty for a refusal on the first request). */
export class MoveSendError extends Error { readonly err: unknown; readonly requested: readonly string[] }
/** Sends moveRequests(plan) in order through api.applyUpdate / api.rollbackUpdate, stopping at the first refusal.
 *  Resolves every answer sent; rejects with a MoveSendError. */
export function sendMove(plan: PlannedMove): Promise<Array<MoveRequestAnswer | 'unreadable'>>;
/** ADDED (review): the answers' skips of nodes this plan NAMED, as `Not requested — <label>: <moveSkipText(why)>`
 *  joined by a space; null when there are none. A skip of a node the plan never named (a macOS node, one at the
 *  tag) is the plan agreeing with the server and is not said. A `skipped` that is not an array reads as none. */
export function moveSkippedText(answers: ReadonlyArray<MoveRequestAnswer | 'unreadable'>, plan: PlannedMove): string | null;
/** A Sheet: moveHeadline as the title, moveLines as an ordered list (aria-label "Nodes this moves, in order"), a
 *  confirm button labelled moveHeadline and a Cancel; both disabled and the confirm reading `Sending…` while
 *  sending; a refusal renders updateErrorText(err) — plus ` Blocked by: <labels>.` for a `halted` whose detail
 *  names the halting nodes, and ` Already requested: <labels>. ${MOVE_REST_TEXT}` when some were — IN the sheet
 *  (role="alert"), which stays open, and calls onDone iff something was requested; once something was requested
 *  the confirm is gone and Cancel reads Close (re-sending the plan would start with the node now pending, a
 *  `409 busy` that never reaches the rest). A 2xx whose moveSkippedText is not null — or, every answer readable,
 *  that requested nothing (MOVE_NOTHING_REQUESTED_TEXT) — is said the same way, IN the sheet, plus
 *  ` Requested: <labels>.` when some were, with onDone iff something was requested or an answer was unreadable,
 *  and no confirm; any other 2xx closes it (onClose) after onDone, toasting MOVE_UNREADABLE_TEXT if an answer was
 *  unreadable. An empty plan renders moveEmptyText(intent) and no confirm button. Renders nothing unless open and
 *  plan !== null. A late answer for a plan the sheet no longer shows is dropped (AbandonSheet's generation idiom). */
export function UpdateMoveSheet(props: { open: boolean; plan: PlannedMove | null; onClose: () => void; onDone: () => void }): ReactNode;
```

- Produces (in `pwa/src/fleet/UpdateBanner.tsx`) — **CORRECTED** props: `UpdateBanner({ updates, onMoved }?: { updates?: UpdatesView | null; onMoved?: () => void })`. Injected (`updates` given) → `onMoved` is the re-poll after a 2xx (FleetScreen passes `updates.reload`); self-polling (`updates` undefined) → the banner's own `reload`. Update all is ENABLED whenever the banner speaks.
- Cases (spec §13 "W4 adds", §18 "Install names the order and the direction"): Install's sheet names the nodes fleet-then-server whatever the wire order and sends `apply {all: true, tag}`; a row where every node is newer reads Roll back and sends one `rollback {nodeId, to}` per node, fleet first; a refusal on the first leaves the second unsent, the sheet says why and stays open; a refusal on the second names the first as already requested and re-polls; Update on a node row sends `apply {nodeId, tag: pendingTag}`; Roll back on a node row sends `rollback {nodeId, to: previousVersion}`; Update is disabled on a node with no `pendingTag`, Roll back when `previousVersion` is not a tag, or is the running tag or a newer one (a node just rolled back); the inventory row renders `update.detail`; no move button carries a note or an `aria-describedby`; a single-node `409 not-newer` renders its `UPDATE_ERROR_TEXT` sentence (not `apiErrorText`'s floor) inside the sheet, which stays open; a `202` closes it and re-polls; an unreadable `2xx` closes it with `MOVE_UNREADABLE_TEXT`; a `202` whose `skipped` names a node the sheet listed keeps it OPEN, saying that node's label and its `moveSkipText` sentence in place and naming the nodes it did request, with no confirm left to re-send; a readable `202` that requested nothing (Install on a yanked or unlisted row: every node skipped `unknown-tag`) stays open the same way; a skip of a node it never listed is not said and the sheet closes; a `202` with nothing skipped toasts nothing (spec §12's per-node refusals, D-3401); a refusal part-way through a fleet rollback leaves no confirm, so the requested node is never re-sent into its own `409 busy`; a single-node `409 halted` names the halting node by its inventory label; an empty plan says what was measured (`moveEmptyText`), never "every node is already there"; Update all on the banner opens the same sheet with the banner's tag and the ordered node list, and on the real fleet screen re-polls the screen's one poll; `planMove` excludes a Darwin node, a node at or above the tag, a node the tag leaves at or below its floor (`highestVersion`, D-3403 — the route skips it `not-newer`) and a node whose stamp was not read, includes an unversioned one with no floor above the tag; `v0.0.10` over `v0.0.9` in both directions; `lib/api.ts` spells exactly the six update route literals; no file under `pwa/src` spells `MOVE_DISABLED_TEXT` or `lands with the next release (W4)` (literal-absence scan, over a walk proven to reach the tree); `UpdateBanner.tsx` and `SettingsScreen.tsx` import no `QuickConfirm` and do import `UpdateMoveSheet`; the sheet renders a label with markup as text; busy disables both buttons and a second tap sends nothing; a late answer for a superseded plan is dropped.
- Spec §18 rows pinned: "Install names the order and the direction" (mutations: drop `planMove`'s sort → the fleet-then-server cases red; send an older tag as `apply` from the release row → the Roll back case reds; build `apply` bodies in `moveRequests`' rollback arm → red), "unreachable is not current" (wave 3's pins stay green — the controls read `pendingTag`; `use-updates-view.test.tsx` and the banner's silence cases run unedited), and the retirement of "the move controls are disabled in W3" (its pins rewritten, not deleted: each now asserts the control is ENABLED, or disabled only for want of a target, and names its request).

- [ ] **Step 1: Record the contrast audit's census before any edit**

Run: `cd pwa && node design/contrast-check.mjs | grep -E '^ALL [0-9]+ PASS$|rules set a colour with no ground'` (foreground; `npm ci` first if `pwa/node_modules` is absent)
Expected: an `ALL <p> PASS` line and a `# <u> rules set a colour with no ground this auditor can recover …` line. Write both numbers down: after Step 13, `<u>` is unchanged and `<p>` is exactly `<p> + 2` — the two measurements of `.settings-move-note` (dark, light) leave with its rule, and four arrive (`.update-move-sheet` and `.update-move-sheet .update-move-error`, two themes each). Measured on a scratch copy of `pwa/` at `d759c914` with wave 3's `.settings-move-note` rule and entry simulated: `ALL 564 PASS` / `255` before, `ALL 566 PASS` / `255` after; on the branch the numbers are whatever wave 3 left, which is why this step measures rather than quotes.

- [ ] **Step 2: Write the failing planner suite**

Create `pwa/test/move-plan.test.ts`:

```ts
// The move planner (centralised-update design 2026-09-20 §13 "W4 adds", §18
// "Install names the order and the direction"; programme wave 5 Task 8).
// Pure functions over a view — no render, no fetch. The order is the
// dispatcher's (compareDispatchOrder), the set is what the move takes
// somewhere, and tag order is semver across the v0.0.9/v0.0.10 boundary.
import { describe, expect, it } from 'vitest';
import type { NodeWire, UpdatesView } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import {
  moveEmptyText, moveHeadline, moveLabel, moveLines, moveRequests, moveTarget, planMove, type MoveIntent,
} from '../src/fleet/movePlan';

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const FLEET_ID = '55555555-5555-4555-8555-555555555555';
const SERVER_ID = '66666666-6666-4666-8666-666666666666';
const ID_A = '77777777-7777-4777-8777-777777777777';
const ID_B = '88888888-8888-4888-8888-888888888888';
const ID_C = '99999999-9999-4999-8999-999999999999';
const ID_D = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_E = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** A stamp at `version`; `undefined` = an unversioned (deploy.sh) build — the key is ABSENT, as the parser leaves it. */
const stamp = (version: string | undefined): BuildInfo => ({
  sha: 'e'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});
/** A full NodeWire: a measured, reachable fleet node on v0.0.9 with a previous v0.0.8. */
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8',
  measuredAt: T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
/** The server's own row: no agent by construction (`agentOps: null`). */
const server = (over: Partial<NodeWire> = {}): NodeWire =>
  node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
const view = (nodes: NodeWire[]): UpdatesView => ({
  catalogue: { lastOkAt: T0, lastError: null }, releases: [], nodes, intent: [],
});
const ids = (intent: MoveIntent, nodes: NodeWire[]): string[] =>
  planMove(view(nodes), intent).nodes.map((n) => n.nodeId);

const UP: MoveIntent = { scope: 'fleet', direction: 'update', tag: 'v0.0.10' };
const DOWN: MoveIntent = { scope: 'fleet', direction: 'rollback', to: 'v0.0.8' };

describe('planMove — the nodes one tap moves, in dispatch order', () => {
  it('names the fleet-role node before the server-role node whatever the wire order (§18 "Install names the order")', () => {
    expect(ids(UP, [server(), node()])).toEqual([FLEET_ID, SERVER_ID]);
    expect(ids(UP, [node(), server()])).toEqual([FLEET_ID, SERVER_ID]);
    expect(ids(DOWN, [server(), node()])).toEqual([FLEET_ID, SERVER_ID]);
  });

  it('is compareDispatchOrder: rank, then label — a both-role node ranks with the server, an unnamed role last', () => {
    const b = node({ nodeId: ID_A, label: 'b-fleet' });
    const a = node({ nodeId: ID_B, label: 'a-fleet' });
    const both = server({ nodeId: ID_C, role: 'both', label: 'a-both' });
    const none = server({ nodeId: ID_D, role: null, label: 'a-none' });
    expect(ids(UP, [none, server(), both, b, a])).toEqual([ID_B, ID_A, ID_C, SERVER_ID, ID_D]);
  });

  it('a fleet update names only nodes the tag takes FORWARD — never one at or above it, a macOS node, or a stamp that was not read', () => {
    const at = node({ nodeId: ID_A, label: 'at', current: stamp('v0.0.10') });
    const above = node({ nodeId: ID_B, label: 'above', current: stamp('v0.0.11') });
    const mac = node({ nodeId: ID_C, label: 'mac', os: 'darwin' });
    const unread = node({ nodeId: ID_D, label: 'unread', stampRead: 'unreadable', current: null });
    const unversioned = server({ current: stamp(undefined) });   // read, no tag: any eligible release is newer
    expect(ids(UP, [at, above, mac, unread, unversioned, node()])).toEqual([FLEET_ID, SERVER_ID]);
  });

  it("a fleet update never names a node the tag leaves at or below its FLOOR — the route skips it not-newer (D-3403)", () => {
    // Rolled back to v0.0.8 under a v0.0.10 floor, and an unversioned box whose floor file reads v0.0.10.
    const back = node({ nodeId: ID_A, label: 'back', current: stamp('v0.0.8'), highestVersion: 'v0.0.10' });
    const floored = server({ nodeId: ID_B, label: 'floored', current: stamp(undefined), highestVersion: 'v0.0.10' });
    expect(ids(UP, [back, floored, node()])).toEqual([FLEET_ID]);
    expect(ids({ scope: 'fleet', direction: 'update', tag: 'v0.0.11' }, [floored, back])).toEqual([ID_A, ID_B]);
  });

  it('compares by semver, never string order: v0.0.10 takes v0.0.9 forward, and v0.0.9 rolls v0.0.10 back', () => {
    expect(ids({ scope: 'fleet', direction: 'update', tag: 'v0.0.10' }, [node({ current: stamp('v0.0.9') })])).toEqual([FLEET_ID]);
    expect(ids({ scope: 'fleet', direction: 'update', tag: 'v0.0.9' }, [node({ current: stamp('v0.0.10') })])).toEqual([]);
    expect(ids({ scope: 'fleet', direction: 'rollback', to: 'v0.0.9' }, [node({ current: stamp('v0.0.10') })])).toEqual([FLEET_ID]);
    expect(ids({ scope: 'fleet', direction: 'rollback', to: 'v0.0.10' }, [node({ current: stamp('v0.0.9') })])).toEqual([]);
  });

  it('a fleet rollback names every non-macOS node running a NEWER tag — an unversioned node has nothing to roll back from', () => {
    const mac = node({ nodeId: ID_A, label: 'mac', os: 'darwin' });
    const bare = server({ nodeId: ID_B, label: 'bare', current: stamp(undefined) });
    const there = node({ nodeId: ID_C, label: 'there', current: stamp('v0.0.8') });
    expect(ids(DOWN, [server(), mac, bare, there, node()])).toEqual([FLEET_ID, SERVER_ID]);
  });

  it('a node move names that node alone, and a nodeId the view does not carry names nothing', () => {
    expect(ids({ scope: 'node', direction: 'update', nodeId: SERVER_ID, tag: 'v0.0.10' }, [node(), server()])).toEqual([SERVER_ID]);
    expect(ids({ scope: 'node', direction: 'rollback', nodeId: ID_E, to: 'v0.0.8' }, [node(), server()])).toEqual([]);
  });

  it('a target that is not a release tag names nothing — the comparator, which throws, is never handed it', () => {
    expect(ids({ scope: 'fleet', direction: 'update', tag: 'vnext' }, [node()])).toEqual([]);
    expect(ids({ scope: 'fleet', direction: 'rollback', to: 'latest' }, [node()])).toEqual([]);
  });

  it('never reorders the view it was handed — the poll holds that array', () => {
    const wire = [server(), node()];
    planMove(view(wire), UP);
    expect(wire.map((n) => n.nodeId)).toEqual([SERVER_ID, FLEET_ID]);
  });
});

describe('moveRequests — what one confirm sends, by direction', () => {
  it('a node update is apply {nodeId, tag}; a node rollback is rollback {nodeId, to}', () => {
    const nodes = [node(), server()];
    expect(moveRequests(planMove(view(nodes), { scope: 'node', direction: 'update', nodeId: FLEET_ID, tag: 'v0.0.10' })))
      .toEqual([{ route: 'apply', body: { nodeId: FLEET_ID, tag: 'v0.0.10' } }]);
    expect(moveRequests(planMove(view(nodes), { scope: 'node', direction: 'rollback', nodeId: SERVER_ID, to: 'v0.0.8' })))
      .toEqual([{ route: 'rollback', body: { nodeId: SERVER_ID, to: 'v0.0.8' } }]);
  });

  it('a fleet update is ONE apply {all: true, tag} — the server writes the per-node requests', () => {
    expect(moveRequests(planMove(view([server(), node()]), UP))).toEqual([{ route: 'apply', body: { all: true, tag: 'v0.0.10' } }]);
  });

  it('a fleet rollback is one rollback {nodeId, to} per node, fleet first (D-3390)', () => {
    expect(moveRequests(planMove(view([server(), node()]), DOWN))).toEqual([
      { route: 'rollback', body: { nodeId: FLEET_ID, to: 'v0.0.8' } },
      { route: 'rollback', body: { nodeId: SERVER_ID, to: 'v0.0.8' } },
    ]);
  });

  it('an empty plan sends nothing', () => {
    expect(moveRequests(planMove(view([node({ current: stamp('v0.0.10') })]), UP))).toEqual([]);
    expect(moveRequests(planMove(view([node()]), { scope: 'node', direction: 'update', nodeId: ID_E, tag: 'v0.0.10' }))).toEqual([]);
  });
});

describe('moveHeadline / moveLines / moveTarget — what the sheet says', () => {
  it('headline: Update <tag> forward, Roll back to <to> back; the target is whichever the move points at', () => {
    expect(moveHeadline(UP)).toBe('Update v0.0.10');
    expect(moveHeadline({ scope: 'node', direction: 'rollback', nodeId: FLEET_ID, to: 'v0.0.8' })).toBe('Roll back to v0.0.8');
    expect(moveTarget(UP)).toBe('v0.0.10');
    expect(moveTarget(DOWN)).toBe('v0.0.8');
  });

  it('lines: numbered in plan order, current → target; an unknown role, an unversioned build and an unread stamp each say so', () => {
    expect(moveLines(planMove(view([server({ current: stamp(undefined) }), node()]), UP))).toEqual([
      '1. fleet (fleet) v0.0.9 → v0.0.10',
      '2. server (server) unversioned → v0.0.10',
    ]);
    expect(moveLines(planMove(
      view([node({ role: null, stampRead: 'unreadable', current: null })]),
      { scope: 'node', direction: 'rollback', nodeId: FLEET_ID, to: 'v0.0.8' },
    ))).toEqual(['1. fleet (unknown role) stamp not read → v0.0.8']);
  });
});

describe('moveEmptyText — an empty plan says only what was measured', () => {
  it('names the direction and the target — never "every node is already there", since a node can be AHEAD of it', () => {
    // The release-row case: v0.0.9 over a fleet on v0.0.10 and a server on v0.0.9 reads Install
    // (releaseDirection: not EVERY node is newer) and takes nobody forward — the fleet node is past it.
    const up9: MoveIntent = { scope: 'fleet', direction: 'update', tag: 'v0.0.9' };
    expect(planMove(view([node({ current: stamp('v0.0.10') }), server()]), up9).nodes).toEqual([]);
    expect(moveEmptyText(up9)).toBe('Nothing to move — v0.0.9 takes no managed node forward.');
    expect(moveEmptyText(DOWN)).toBe('Nothing to move — no managed node is measured on a release newer than v0.0.8.');
    expect(moveEmptyText({ scope: 'node', direction: 'rollback', nodeId: ID_E, to: 'v0.0.8' }))
      .toBe('Nothing to move — that node is no longer in the inventory.');
    expect(moveEmptyText({ scope: 'fleet', direction: 'update', tag: 'vnext' })).toBe('Nothing to move — vnext is not a release tag.');
  });
});

describe('moveLabel — a node by the label the inventory gives it', () => {
  it('reads the inventory the move was planned over, so a node the move does not name still has a label; an unknown id reads as itself', () => {
    const p = planMove(view([server(), node()]), { scope: 'node', direction: 'update', nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(p.nodes.map((n) => n.nodeId)).toEqual([FLEET_ID]);
    expect(moveLabel(p, SERVER_ID)).toBe('server');
    expect(moveLabel(p, ID_E)).toBe(ID_E);
  });
});
```

- [ ] **Step 3: Write the failing sheet suite**

Create `pwa/test/update-move-sheet.test.tsx`:

```tsx
// UpdateMoveSheet — the ONE confirm sheet every move control opens
// (centralised-update design 2026-09-20 §13 "W4 adds"; programme wave 5 Task 8).
// Rendered directly, over plans built by the real planMove, with the two client
// methods spied (never a real fetch). What it names, what one confirm sends,
// how a refusal is said (in the sheet, which stays open), the AbandonSheet
// busy/generation idiom, and the source facts that keep every move control on
// this one sheet.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MoveRequestAnswer, NodeWire, UpdatesView } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { ApiError, api, apiErrorText, moveSkipText, updateErrorText } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { ToastHost } from '../src/components/Toast';
import { planMove, type MoveIntent, type PlannedMove } from '../src/fleet/movePlan';
import {
  MOVE_NOTHING_REQUESTED_TEXT, MOVE_REST_TEXT, MOVE_UNREADABLE_TEXT, MoveSendError, UpdateMoveSheet, sendMove,
} from '../src/fleet/UpdateMoveSheet';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const FLEET_ID = '12121212-1212-4212-8212-121212121212';
const SERVER_ID = '34343434-3434-4434-8434-343434343434';
const LIST = 'Nodes this moves, in order';
const stamp = (version: string | undefined): BuildInfo => ({
  sha: 'f'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8',
  measuredAt: T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const server = (over: Partial<NodeWire> = {}): NodeWire =>
  node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
const view = (nodes: NodeWire[]): UpdatesView => ({
  catalogue: { lastOkAt: T0, lastError: null }, releases: [], nodes, intent: [],
});
/** Plans come from the real planner, wire order server-first, so every order assertion is the planner's. */
const plan = (intent: MoveIntent, nodes: NodeWire[] = [server(), node()]): PlannedMove => planMove(view(nodes), intent);
const UP: MoveIntent = { scope: 'fleet', direction: 'update', tag: 'v0.0.10' };
const DOWN: MoveIntent = { scope: 'fleet', direction: 'rollback', to: 'v0.0.8' };
const ok = (requested: string[]): MoveRequestAnswer => ({ ok: true, requested, skipped: [] });
const refusal = (error: string): ApiError => new ApiError(409, { ok: false, error });

/** Mount the sheet (and the one toast subscriber) over a plan; onClose/onDone are spies, so the sheet stays mounted. */
const mount = (p: PlannedMove | null) => {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<><ToastHost /><UpdateMoveSheet open={p !== null} plan={p} onClose={onClose} onDone={onDone} /></>);
  return { onClose, onDone };
};
const lines = (): (string | null)[] =>
  within(screen.getByRole('list', { name: LIST })).getAllByRole('listitem').map((li) => li.textContent);

/** Switches the sheet's plan mid-flight, the way a screen reopens it on another control. */
function Harness({ first, second, onDone }: { first: PlannedMove; second: PlannedMove; onDone: () => void }): ReactNode {
  const [p, setP] = useState<PlannedMove | null>(first);
  return (
    <>
      <button type="button" onClick={() => setP(second)}>switch plan</button>
      <UpdateMoveSheet open={p !== null} plan={p} onClose={() => setP(null)} onDone={onDone} />
    </>
  );
}

describe('UpdateMoveSheet — what it names', () => {
  it('names the nodes it moves in dispatch order — fleet then server whatever the wire order — under the headline, which is also its confirm', () => {
    mount(plan(UP));
    expect(lines()).toEqual(['1. fleet (fleet) v0.0.9 → v0.0.10', '2. server (server) v0.0.9 → v0.0.10']);
    expect(screen.getByRole('button', { name: 'Update v0.0.10' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
  });

  it('an empty plan says so and offers no confirm — nothing to send', () => {
    mount(plan(UP, [node({ current: stamp('v0.0.10') })]));
    // moveEmptyText, spelled out: the node is AT the tag, and the sentence says only what was measured.
    expect(screen.getByText('Nothing to move — v0.0.10 takes no managed node forward.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: LIST })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update v0.0.10' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders nothing while closed, or with no plan', () => {
    const closed = render(<UpdateMoveSheet open={false} plan={plan(UP)} onClose={() => {}} onDone={() => {}} />);
    expect(closed.container).toBeEmptyDOMElement();
    expect(document.querySelector('.update-move-sheet')).toBeNull();
    cleanup();
    render(<UpdateMoveSheet open plan={null} onClose={() => {}} onDone={() => {}} />);
    expect(document.querySelector('.update-move-sheet')).toBeNull();
  });

  it('renders a label carrying markup as literal text', () => {
    const LABEL = '<b>fleet</b><img src=x onerror=alert(1)>';
    mount(plan(UP, [node({ label: LABEL })]));
    const list = screen.getByRole('list', { name: LIST });
    expect(list.querySelector('b, img')).toBeNull();
    expect(lines()).toEqual([`1. ${LABEL} (fleet) v0.0.9 → v0.0.10`]);
  });
});

describe('UpdateMoveSheet — what one confirm sends', () => {
  it('a fleet update sends ONE apply {all: true, tag}, then calls onDone and closes', async () => {
    const apply = vi.spyOn(api, 'applyUpdate').mockResolvedValue(ok([FLEET_ID, SERVER_ID]));
    const rollback = vi.spyOn(api, 'rollbackUpdate');
    const { onClose, onDone } = mount(plan(UP));
    expect(apply).not.toHaveBeenCalled();   // opening is not confirming
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls).toEqual([[{ all: true, tag: 'v0.0.10' }]]);
    expect(rollback).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toast'), 'nothing was skipped, so nothing is said').toBeNull();
  });

  it('a 202 that skipped a node the sheet NAMED says so IN the sheet, by label and sentence, and stays open with nothing left to send (spec §12)', async () => {
    // The server skipped the fleet node for a reason the plan cannot preview (no `detach` word), and a
    // node the sheet never listed for one the plan already agreed with (it is at the tag).
    const ELSEWHERE = '56565656-5656-4656-8656-565656565656';
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({
      ok: true, requested: [SERVER_ID],
      skipped: [{ nodeId: FLEET_ID, why: 'no-detach-cap' }, { nodeId: ELSEWHERE, why: 'not-newer' }],
    });
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    // Exact text: the unlisted node's skip is not in it; the node that WAS requested is named after it.
    expect(said.textContent).toBe(`Not requested — fleet: ${moveSkipText('no-detach-cap')} Requested: server.`);
    expect(onDone).toHaveBeenCalledTimes(1);   // a request was written — re-poll
    expect(onClose).not.toHaveBeenCalled();    // never a close that reads as "both moved"
    expect(screen.queryByRole('button', { name: 'Update v0.0.10' })).toBeNull();   // the reply is final: nothing to re-send
    expect(screen.getByRole('button', { name: 'Close' })).not.toBeDisabled();
    // One table: the skip's sentence is the one a single-node 409 of the same word renders.
    expect(moveSkipText('no-detach-cap')).toBe(updateErrorText(refusal('no-detach-cap')));
  });

  it('a 202 that requested NOTHING — Install on a yanked or unlisted row, every node skipped unknown-tag — stays open and re-polls nothing', async () => {
    const s = moveSkipText('unknown-tag');
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({
      ok: true, requested: [],
      skipped: [{ nodeId: FLEET_ID, why: 'unknown-tag' }, { nodeId: SERVER_ID, why: 'unknown-tag' }],
    });
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`Not requested — fleet: ${s} server: ${s}`);
    expect(onDone).not.toHaveBeenCalled();   // nothing was written
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a readable 202 that requested nothing and skipped no node the sheet listed says so, and stays open', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({ ok: true, requested: [], skipped: [] });
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(MOVE_NOTHING_REQUESTED_TEXT);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a skip of a node the sheet never listed is the plan agreeing with the server — it closes and says nothing', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({
      ok: true, requested: [FLEET_ID], skipped: [{ nodeId: SERVER_ID, why: 'not-newer' }],
    });
    const { onClose, onDone } = mount(plan(UP, [server({ current: stamp('v0.0.10') }), node()]));
    expect(lines()).toEqual(['1. fleet (fleet) v0.0.9 → v0.0.10']);
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('a fleet rollback posts one rollback {nodeId, to} per node, fleet first, and closes after the last', async () => {
    const rollback = vi.spyOn(api, 'rollbackUpdate')
      .mockResolvedValueOnce(ok([FLEET_ID]))
      .mockResolvedValueOnce(ok([SERVER_ID]));
    const apply = vi.spyOn(api, 'applyUpdate');
    const { onClose } = mount(plan(DOWN));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.8' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(rollback.mock.calls).toEqual([[{ nodeId: FLEET_ID, to: 'v0.0.8' }], [{ nodeId: SERVER_ID, to: 'v0.0.8' }]]);
    expect(apply).not.toHaveBeenCalled();
  });

  it('while sending, both buttons are disabled and a second tap sends nothing', async () => {
    const pending = Promise.withResolvers<MoveRequestAnswer | 'unreadable'>();
    const apply = vi.spyOn(api, 'applyUpdate').mockReturnValue(pending.promise);
    const { onClose } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const busy = screen.getByRole('button', { name: 'Sending…' });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(busy);
    expect(apply).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(ok([FLEET_ID, SERVER_ID])); await pending.promise; });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('UpdateMoveSheet — a refusal is said in the sheet, which stays open', () => {
  it('a refusal on the first node leaves the second unsent', async () => {
    const err = refusal('no-rollback-cap');
    const rollback = vi.spyOn(api, 'rollbackUpdate').mockResolvedValue(ok([SERVER_ID])).mockRejectedValueOnce(err);
    const { onClose, onDone } = mount(plan(DOWN));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.8' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(updateErrorText(err));
    expect(rollback.mock.calls).toEqual([[{ nodeId: FLEET_ID, to: 'v0.0.8' }]]);
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();   // nothing was requested, so nothing to re-poll
    expect(screen.getByRole('button', { name: 'Roll back to v0.0.8' })).not.toBeDisabled();
  });

  it('a refusal on the second names the node already requested, and re-polls so the inventory shows it', async () => {
    const err = refusal('busy');
    vi.spyOn(api, 'rollbackUpdate').mockResolvedValueOnce(ok([FLEET_ID])).mockRejectedValueOnce(err);
    const { onClose, onDone } = mount(plan(DOWN));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.8' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`${updateErrorText(err)} Already requested: fleet. ${MOVE_REST_TEXT}`);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('after a part-way rollback the sheet offers no second send — the node already requested is never re-sent into its own 409 busy', async () => {
    const err = refusal('no-rollback-cap');
    const rollback = vi.spyOn(api, 'rollbackUpdate').mockResolvedValueOnce(ok([FLEET_ID])).mockRejectedValueOnce(err);
    const { onClose } = mount(plan(DOWN));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.8' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`${updateErrorText(err)} Already requested: fleet. ${MOVE_REST_TEXT}`);
    expect(screen.queryByRole('button', { name: 'Roll back to v0.0.8' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(rollback.mock.calls).toEqual([[{ nodeId: FLEET_ID, to: 'v0.0.8' }], [{ nodeId: SERVER_ID, to: 'v0.0.8' }]]);
  });

  it("a single-node 409 not-newer renders the update table's own sentence, never the generic floor", async () => {
    const err = refusal('not-newer');
    vi.spyOn(api, 'applyUpdate').mockRejectedValue(err);
    const { onClose } = mount(plan({ scope: 'node', direction: 'update', nodeId: SERVER_ID, tag: 'v0.0.10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(updateErrorText(err));
    expect(updateErrorText(err)).not.toBe(apiErrorText(err));   // Task 6 gave the word a sentence (D-3302's table)
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a single-node 409 halted names the halting node by its inventory label — a node the plan does not move', async () => {
    // Task 6's singleNodeMove answers `detail: gate.haltedBy.join(', ')` — node ids, not labels.
    const err = new ApiError(409, { ok: false, error: 'halted', detail: SERVER_ID });
    vi.spyOn(api, 'applyUpdate').mockRejectedValue(err);
    const { onClose } = mount(plan({ scope: 'node', direction: 'update', nodeId: FLEET_ID, tag: 'v0.0.10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe(`${updateErrorText(err)} Blocked by: server.`);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Update v0.0.10' })).not.toBeDisabled();   // nothing was requested
  });

  it('a 2xx whose body could not be read still closes — the request may stand — and says the answer was unread', async () => {
    vi.spyOn(api, 'applyUpdate').mockResolvedValue('unreadable');
    const { onClose, onDone } = mount(plan(UP));
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(MOVE_UNREADABLE_TEXT, { selector: '.toast' })).toBeInTheDocument();
  });

  it('a late answer for a plan the sheet no longer shows is dropped (the AbandonSheet generation idiom)', async () => {
    const pending = Promise.withResolvers<MoveRequestAnswer | 'unreadable'>();
    vi.spyOn(api, 'applyUpdate').mockReturnValueOnce(pending.promise);
    const onDone = vi.fn();
    render(<Harness first={plan(UP)} second={plan({ scope: 'node', direction: 'rollback', nodeId: FLEET_ID, to: 'v0.0.8' })} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    fireEvent.click(screen.getByText('switch plan'));
    // A macrotask, not one microtask: sendMove's own await and its `.then` must
    // both have run, or "not called" would pass before the late answer arrived.
    await act(async () => { pending.resolve(ok([FLEET_ID, SERVER_ID])); await new Promise((r) => setTimeout(r, 0)); });
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Roll back to v0.0.8' })).not.toBeDisabled();
  });

  it('sendMove rejects with a MoveSendError carrying the refusal and the nodes already requested', async () => {
    const err = refusal('halted');
    vi.spyOn(api, 'rollbackUpdate').mockResolvedValueOnce(ok([FLEET_ID])).mockRejectedValueOnce(err);
    const failed = await sendMove(plan(DOWN)).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(MoveSendError);
    expect((failed as MoveSendError).err).toBe(err);
    expect((failed as MoveSendError).requested).toEqual([FLEET_ID]);
  });
});

describe('one sheet for every move (D-3389)', () => {
  const src = (...p: string[]): string => readFileSync(path.join(import.meta.dirname, '..', 'src', ...p), 'utf8');

  it('UpdateBanner and SettingsScreen import no QuickConfirm — both open UpdateMoveSheet', () => {
    for (const [file, text] of [
      ['UpdateBanner.tsx', src('fleet', 'UpdateBanner.tsx')],
      ['SettingsScreen.tsx', src('screens', 'SettingsScreen.tsx')],
    ] as const) {
      expect(text, file).not.toMatch(/components\/QuickConfirm/);
      expect(text, file).toMatch(/from '(\.\/|\.\.\/fleet\/)UpdateMoveSheet'/);
    }
  });

  it('the sheet puts wire text into the DOM only as text children', () => {
    expect(src('fleet', 'UpdateMoveSheet.tsx')).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
```

- [ ] **Step 4: Rewrite the client pins in `pwa/test/api.test.ts`**

(a) Line 2, in place: `import { readFileSync } from 'node:fs';` → `import { readdirSync, readFileSync } from 'node:fs';`

(b) The value import from `'../src/lib/api'` (line 4, as wave 3 Task 5 left it): delete the name `MOVE_DISABLED_TEXT, ` and nothing else. The type import directly under it (wave 3 Task 5's `import { FLEET_SCOPE, type AckAnswer, … } from '../../shared/api';`): add `type MoveRequestAnswer, ` in its alphabetical place (after `type IntentWriteAnswer, `), in place.

(b2) The two lines of wave 3 Task 5's lead comment directly above that describe, in place, two for two (a comment that would be false once the move methods land):

```ts
// operator could be unconfirmed about. No method exists for the two move routes
// W3 leaves disabled — pinned below by the route literals the file spells.
```

becomes

```ts
// operator could be unconfirmed about. The two move routes' methods are
// programme wave 5's (the last describe below); the census counts every literal.
```

(c) In wave 3's `describe('the update plane client (W3 Task 5)', …)`, replace the whole case beginning `  it('spells exactly the four W2 update routes — no apply, no rollback (spec §18: the move controls are disabled in W3)', () => {` through its closing `  });` with:

```ts
  it('spells exactly the six update routes — the four W2 routes plus apply and rollback (programme wave 5; W3 held it to four)', () => {
    // The route LITERALS, not a method-name guess: every quoted `/api/updates…`
    // path the client holds. Wave 5 adds the two move routes and nothing else.
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'api.ts'), 'utf8');
    const routes = [...new Set(src.match(/'\/api\/updates[^']*'/g) ?? [])].sort();
    expect(routes).toEqual([
      "'/api/updates'", "'/api/updates/ack'", "'/api/updates/apply'",
      "'/api/updates/intent'", "'/api/updates/refresh'", "'/api/updates/rollback'",
    ]);
  });
```

and replace the whole case `  it('MOVE_DISABLED_TEXT is the one literal every disabled move control carries', () => {` … `  });` with:

```ts
  it('no file under pwa/src spells the retired disabled-control sentence or its constant — the move controls are live (programme wave 5)', () => {
    const root = path.join(import.meta.dirname, '..', 'src');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(tsx?|css)$/.test(f));
    // The walk reached the tree: a scan over zero files would pass vacuously.
    expect(files).toContain(path.join('lib', 'api.ts'));
    expect(files).toContain(path.join('fleet', 'UpdateBanner.tsx'));
    expect(files).toContain(path.join('screens', 'SettingsScreen.tsx'));
    const hits = files.filter((f) => {
      const text = readFileSync(path.join(root, f), 'utf8');
      return text.includes('MOVE_DISABLED_TEXT') || text.includes('lands with the next release (W4)');
    }).sort();
    expect(hits).toEqual([]);
  });
```

(d) Append after the file's last line:

```ts

// ── Centralised update management, programme wave 5 Task 8: the move client ─
// The two move routes (wave 5 Task 6), session-gated only. Each is a WRITE
// whose 2xx means a request row was written — so, like setUpdateIntent and
// ackUpdateNode, both degrade a 2xx they cannot parse to `unreadable` (D-1150)
// rather than reporting a failure that did not happen, and a refusal still
// rejects with its ApiError, whose body updateErrorText reads.
describe('the move client — applyUpdate / rollbackUpdate (programme wave 5 Task 8)', () => {
  const NODE_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
  const ANSWER: MoveRequestAnswer = { ok: true, requested: [NODE_ID], skipped: [] };
  /** A fresh Response per call — a body can be read once. */
  const answering = (status: number, body: unknown) => vi.fn().mockImplementation(async () => jsonResponse(status, body));
  const headersOf = (init: RequestInit): Headers => new Headers(init.headers);

  it('applyUpdate POSTs {nodeId, tag} or {all: true, tag} as JSON to /api/updates/apply and resolves the answer', async () => {
    const fetchImpl = answering(202, ANSWER);
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.applyUpdate({ nodeId: NODE_ID, tag: 'v0.0.10' })).resolves.toEqual(ANSWER);
    await expect(api.applyUpdate({ all: true, tag: 'v0.0.10' })).resolves.toEqual(ANSWER);
    const calls = fetchImpl.mock.calls as [string, RequestInit][];
    expect(calls).toHaveLength(2);
    for (const [url, init] of calls) {
      expect(url).toBe('/api/updates/apply');
      expect(init.method).toBe('POST');
      expect(headersOf(init).get('content-type')).toBe('application/json');
      expect(headersOf(init).get('accept')).toBe('application/json');
      expect(headersOf(init).get('x-ccrc-mail-token')).toBeNull();   // session-gated only (decision 15)
    }
    expect(calls.map(([, init]) => JSON.parse(init.body as string))).toEqual([
      { nodeId: NODE_ID, tag: 'v0.0.10' },
      { all: true, tag: 'v0.0.10' },
    ]);
  });

  it('rollbackUpdate POSTs {nodeId, to} as JSON to /api/updates/rollback and resolves the answer', async () => {
    const fetchImpl = answering(202, ANSWER);
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.rollbackUpdate({ nodeId: NODE_ID, to: 'v0.0.8' })).resolves.toEqual(ANSWER);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/updates/rollback');
    expect(init.method).toBe('POST');
    expect(headersOf(init).get('content-type')).toBe('application/json');
    expect(headersOf(init).get('x-ccrc-mail-token')).toBeNull();
    expect(JSON.parse(init.body as string)).toEqual({ nodeId: NODE_ID, to: 'v0.0.8' });
  });

  it('both resolve `unreadable` on a 2xx whose body cannot be read — the request may have been written (D-1150)', async () => {
    const api = createApi(async () => new Response('{"ok":true,"requ', {
      status: 202, headers: { 'content-type': 'application/json' },
    }));
    await expect(api.applyUpdate({ all: true, tag: 'v0.0.10' })).resolves.toBe('unreadable');
    await expect(api.rollbackUpdate({ nodeId: NODE_ID, to: 'v0.0.8' })).resolves.toBe('unreadable');
  });

  it('a refusal rejects with its ApiError, status and body intact', async () => {
    const api = createApi(answering(409, { ok: false, error: 'not-newer' }) as unknown as typeof fetch);
    const err = await api.applyUpdate({ nodeId: NODE_ID, tag: 'v0.0.8' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual({ ok: false, error: 'not-newer' });
  });
});
```

- [ ] **Step 5: Rewrite the settings pins in `pwa/test/settings-screen.test.tsx`**

(a) The `'../src/lib/api'` import line (wave 3 Tasks 7–9: `ApiError`, `MOVE_DISABLED_TEXT`, `api`, `updateErrorText`): delete the name `MOVE_DISABLED_TEXT` and add `apiErrorText` after `api`, in place — the line reads `import { ApiError, api, apiErrorText, updateErrorText } from '../src/lib/api';` if it held only those four names (keep any other name it holds).

(b) In `describe('SettingsScreen — the release list: rendering (design 2026-09-20 §13)', …)`, replace the whole case beginning `  it('renders every move button DISABLED, described by the one W3 sentence (§18 "the move controls are disabled in W3")', async () => {` through its closing `  });` with:

```tsx
  it('renders every move button ENABLED, with no note beside it (spec §13 "W4 adds" — W3 rendered them disabled)', async () => {
    const list = await renderList(
      [t8Release('v0.0.10'), t8Release('v0.0.9'), t8Release('v0.0.8', { channel: 'dev' })],
      [t8Node({ current: t8Stamp('v0.0.9') }), t8Server({ current: t8Stamp('v0.0.9') })],
    );
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Install', 'Install', 'Roll back']);
    for (const b of buttons) {
      expect(b).not.toBeDisabled();
      expect(b).not.toHaveAttribute('aria-describedby');
    }
    expect(list.querySelector('.settings-move-note')).toBeNull();
  });

  it('Install opens the move sheet naming the nodes fleet-then-server whatever the wire order, and sends apply {all: true, tag} (§18 "Install names the order and the direction")', async () => {
    const apply = vi.spyOn(api, 'applyUpdate').mockResolvedValue({ ok: true, requested: [T8_NODE_A, T8_NODE_B], skipped: [] });
    const rollback = vi.spyOn(api, 'rollbackUpdate');
    const list = await renderList(
      [t8Release('v0.0.10')],
      [t8Server({ current: t8Stamp('v0.0.9') }), t8Node({ current: t8Stamp('v0.0.9') })],   // the server row first on the wire
    );
    fireEvent.click(within(list).getByRole('button', { name: 'Install' }));
    const sheet = await screen.findByRole('list', { name: 'Nodes this moves, in order' });
    expect(within(sheet).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1. fleet (fleet) v0.0.9 → v0.0.10',
      '2. server (server) v0.0.9 → v0.0.10',
    ]);
    expect(apply).not.toHaveBeenCalled();   // opening is not confirming
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Nodes this moves, in order' })).toBeNull());
    expect(apply.mock.calls).toEqual([[{ all: true, tag: 'v0.0.10' }]]);
    expect(rollback).not.toHaveBeenCalled();
    await waitFor(() => expect(api.updates).toHaveBeenCalledTimes(2));   // the 202 re-polled the screen
  });

  it('a release every node runs newer than reads Roll back and sends one rollback {nodeId, to} per node, fleet first', async () => {
    const rollback = vi.spyOn(api, 'rollbackUpdate')
      .mockResolvedValueOnce({ ok: true, requested: [T8_NODE_A], skipped: [] })
      .mockResolvedValueOnce({ ok: true, requested: [T8_NODE_B], skipped: [] });
    const apply = vi.spyOn(api, 'applyUpdate');
    const list = await renderList(
      [t8Release('v0.0.10'), t8Release('v0.0.9')],
      [t8Server({ current: t8Stamp('v0.0.10') }), t8Node({ current: t8Stamp('v0.0.10') })],
    );
    fireEvent.click(within(rowOf(list, 'v0.0.9')).getByRole('button', { name: 'Roll back' }));
    const sheet = await screen.findByRole('list', { name: 'Nodes this moves, in order' });
    expect(within(sheet).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1. fleet (fleet) v0.0.10 → v0.0.9',
      '2. server (server) v0.0.10 → v0.0.9',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.9' }));
    await waitFor(() => expect(rollback).toHaveBeenCalledTimes(2));
    expect(rollback.mock.calls).toEqual([[{ nodeId: T8_NODE_A, to: 'v0.0.9' }], [{ nodeId: T8_NODE_B, to: 'v0.0.9' }]]);
    expect(apply).not.toHaveBeenCalled();
  });

  it('a refusal on the first node leaves the second unsent; the sheet says why and stays open', async () => {
    const refusal = new ApiError(409, { ok: false, error: 'no-rollback-cap' });
    const rollback = vi.spyOn(api, 'rollbackUpdate')
      .mockResolvedValue({ ok: true, requested: [T8_NODE_B], skipped: [] })
      .mockRejectedValueOnce(refusal);
    const list = await renderList(
      [t8Release('v0.0.10'), t8Release('v0.0.9')],
      [t8Server({ current: t8Stamp('v0.0.10') }), t8Node({ current: t8Stamp('v0.0.10') })],
    );
    fireEvent.click(within(rowOf(list, 'v0.0.9')).getByRole('button', { name: 'Roll back' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Roll back to v0.0.9' }));
    const said = await screen.findByText(updateErrorText(refusal));
    expect(said).toHaveAttribute('role', 'alert');
    expect(rollback.mock.calls).toEqual([[{ nodeId: T8_NODE_A, to: 'v0.0.9' }]]);
    expect(screen.getByRole('button', { name: 'Roll back to v0.0.9' })).not.toBeDisabled();
    expect(api.updates).toHaveBeenCalledTimes(1);   // nothing was requested — nothing to re-poll
  });
```

(c) In `describe('SettingsScreen — the node inventory: rendering (design 2026-09-20 §13)', …)`: in the case `  it('a Darwin row reads the macOS sentence in place of its desired, and offers no move', async () => {`, delete the one line `    expect(within(row).queryByText(MOVE_DISABLED_TEXT)).toBeNull();` (its two `queryByRole(… 'Update' / 'Roll back')` lines are the pin and stay). Then replace the whole case beginning `  it('renders Update and Roll back DISABLED on every managed row, described by the one W3 sentence (§18 "the move controls are disabled in W3")', async () => {` through its closing `  });` with:

```tsx
  it('enables Update iff the node has a pendingTag and Roll back iff previousVersion is a tag — no note on any row (spec §13 "W4 adds")', async () => {
    const { list } = await renderNodes([
      t9Node({ desiredTag: 'v0.0.10', previousVersion: 'v0.0.8' }),
      t9Server({ previousVersion: 'not-a-tag' }),   // on its desired tag; a previous that is no tag
    ]);
    const a = rowOf(list, T9_NODE_A);
    expect(within(a).getByRole('button', { name: 'Update' })).not.toBeDisabled();
    expect(within(a).getByRole('button', { name: 'Roll back' })).not.toBeDisabled();
    const b = rowOf(list, T9_NODE_B);
    expect(within(b).getByRole('button', { name: 'Update' })).toBeDisabled();
    expect(within(b).getByRole('button', { name: 'Roll back' })).toBeDisabled();
    for (const row of [a, b]) {
      for (const button of within(row).getAllByRole('button')) expect(button).not.toHaveAttribute('aria-describedby');
    }
    expect(list.querySelector('.settings-move-note')).toBeNull();
  });

  it('Update on a node row opens the sheet for that node alone and sends apply {nodeId, tag: pendingTag}', async () => {
    const apply = vi.spyOn(api, 'applyUpdate').mockResolvedValue({ ok: true, requested: [T9_NODE_A], skipped: [] });
    const { list, updates } = await renderNodes([t9Node({ desiredTag: 'v0.0.10' }), t9Server()]);
    fireEvent.click(within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Update' }));
    const sheet = await screen.findByRole('list', { name: 'Nodes this moves, in order' });
    expect(within(sheet).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1. fleet (fleet) v0.0.9 → v0.0.10']);
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));   // a 202 re-polls
    expect(apply.mock.calls).toEqual([[{ nodeId: T9_NODE_A, tag: 'v0.0.10' }]]);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Nodes this moves, in order' })).toBeNull());
  });

  it('Roll back on a node row sends rollback {nodeId, to: previousVersion}', async () => {
    const rollback = vi.spyOn(api, 'rollbackUpdate').mockResolvedValue({ ok: true, requested: [T9_NODE_A], skipped: [] });
    const { list } = await renderNodes([t9Node({ previousVersion: 'v0.0.8' })]);
    fireEvent.click(within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Roll back' }));
    const sheet = await screen.findByRole('list', { name: 'Nodes this moves, in order' });
    expect(within(sheet).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1. fleet (fleet) v0.0.9 → v0.0.8']);
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to v0.0.8' }));
    await waitFor(() => expect(rollback).toHaveBeenCalledTimes(1));
    expect(rollback).toHaveBeenCalledWith({ nodeId: T9_NODE_A, to: 'v0.0.8' });
  });

  it('a single-node 409 not-newer renders its sentence inside the sheet, which stays open and re-polls nothing', async () => {
    const refusal = new ApiError(409, { ok: false, error: 'not-newer' });
    vi.spyOn(api, 'applyUpdate').mockRejectedValue(refusal);
    const { list, updates } = await renderNodes([t9Node({ desiredTag: 'v0.0.10' })]);
    fireEvent.click(within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Update' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update v0.0.10' }));
    const said = await screen.findByText(updateErrorText(refusal));
    expect(said).toHaveAttribute('role', 'alert');
    expect(updateErrorText(refusal)).not.toBe(apiErrorText(refusal));   // the update table's own word (Task 6)
    expect(screen.getByRole('button', { name: 'Update v0.0.10' })).not.toBeDisabled();
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it('Roll back needs somewhere to go: disabled when previousVersion is the running tag or a newer one (a rollback leaves previous in place, wave 4 D-3262)', async () => {
    const AHEAD = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
    const BARE = '6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b';
    const { list } = await renderNodes([
      t9Node({ previousVersion: 'v0.0.8' }),                                    // on v0.0.9: back to v0.0.8
      t9Server({ previousVersion: 'v0.0.9' }),                                  // just rolled back: previous IS current
      t9Node({ nodeId: AHEAD, label: 'ahead', previousVersion: 'v0.0.10' }),    // a "previous" newer than current
      t9Node({ nodeId: BARE, label: 'bare', current: t9Stamp(undefined), previousVersion: 'v0.0.8' }),   // no tag to compare
    ]);
    expect(within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Roll back' })).not.toBeDisabled();
    expect(within(rowOf(list, T9_NODE_B)).getByRole('button', { name: 'Roll back' })).toBeDisabled();
    expect(within(rowOf(list, AHEAD)).getByRole('button', { name: 'Roll back' })).toBeDisabled();
    expect(within(rowOf(list, BARE)).getByRole('button', { name: 'Roll back' })).not.toBeDisabled();
  });

  it("renders the dispatcher's own word for the row — update.detail — under the state line (spec §12: per-node refusals are reported through updateDetail)", async () => {
    const HALT = 'halted — another node failed; acknowledge it to go on';
    const { list } = await renderNodes([
      t9Node({ update: { state: 'idle', target: null, startedAt: null, detail: HALT } }),
      t9Server({ update: { state: 'failed', target: 'v0.0.10', startedAt: T9_T0, detail: 'deadline' } }),
    ]);
    expect(within(rowOf(list, T9_NODE_A)).getByText(HALT)).toHaveClass('settings-node-detail');
    expect(within(rowOf(list, T9_NODE_B)).getByText('deadline')).toHaveClass('settings-node-detail');
  });
```

- [ ] **Step 6: Rewrite the banner pin and pin the fleet screen's wiring**

In `pwa/test/update-banner.test.tsx`: the `'@testing-library/react'` import gains `waitFor, within` (in place: `import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';`); `import { api, MOVE_DISABLED_TEXT } from '../src/lib/api';` becomes `import { api } from '../src/lib/api';`. In `describe('UpdateBanner — its two buttons', …)`, replace the whole case beginning `  it('renders Update all DISABLED, described by the one W3 sentence (spec §18 "the move controls are disabled in W3")', () => {` through its closing `  });` with:

```tsx
  it("Update all is ENABLED and opens the move sheet: the banner's tag, the nodes in dispatch order, sent as apply {all: true, tag} (spec §13 \"W4 adds\")", async () => {
    const apply = vi.spyOn(api, 'applyUpdate').mockResolvedValue({ ok: true, requested: [FLEET_ID, SERVER_ID], skipped: [] });
    const onMoved = vi.fn();
    render(<UpdateBanner updates={view({ nodes: [serverNode(), fleetNode()] })} onMoved={onMoved} />);
    const all = screen.getByRole('button', { name: 'Update all' });
    expect(all).not.toBeDisabled();
    expect(all).not.toHaveAttribute('aria-describedby');
    fireEvent.click(all);
    const list = await screen.findByRole('list', { name: 'Nodes this moves, in order' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1. fleet (fleet) v0.0.7 → v0.0.9',
      '2. server (server) v0.0.7 → v0.0.9',
    ]);
    expect(apply).not.toHaveBeenCalled();   // opening is not confirming
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.9' }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls).toEqual([[{ all: true, tag: 'v0.0.9' }]]);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Nodes this moves, in order' })).toBeNull());
  });

  it('self-polling, a confirmed Update all re-polls /api/updates itself', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(view());
    vi.spyOn(api, 'applyUpdate').mockResolvedValue({ ok: true, requested: [FLEET_ID, SERVER_ID], skipped: [] });
    render(<UpdateBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update v0.0.9' }));
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
  });
```

In `pwa/test/fleet-screen.test.tsx`, append after the file's last line (the closing `});` of wave 3 Task 12's appended describe):

```tsx

// ── centralised-update programme wave 5 Task 8: the banner's one tap ─────────
// Update all is live on the real screen: the sheet names the nodes in
// dispatch order, one confirm sends apply {all: true, tag}, and the SCREEN's
// one poll re-reads the inventory — FleetScreen hands the banner its reload
// (the banner is injected, so its own useUpdatesView(0) reload is a no-op).
describe('Update all on the fleet screen (programme wave 5)', () => {
  const FLEET = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
  const SERVER = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';
  const nodeOf = (nodeId: string, role: 'fleet' | 'server'): NodeWire => ({
    nodeId, role, label: role, os: 'linux',
    current: { sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version: 'v0.0.7' },
    stampRead: 'ok', installState: 'complete', provenance: 'verified',
    caps: [], agentOps: role === 'server' ? null : ['update'], highestVersion: 'v0.0.7', previousVersion: null,
    measuredAt: Date.now() - MIN, reachable: true, unreachableSince: null,
    channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
    request: null, report: null,
    update: { state: 'idle', target: null, startedAt: null, detail: null },
  });
  const behind = (): UpdatesView => ({
    catalogue: { lastOkAt: Date.now() - 4 * MIN, lastError: null },
    releases: [],
    nodes: [nodeOf(SERVER, 'server'), nodeOf(FLEET, 'fleet')],   // the server row first on the wire
    intent: [],
  });

  it('opens the move sheet naming the fleet node first, sends apply {all: true, tag}, and re-polls the screen', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(behind());
    const apply = vi.spyOn(api, 'applyUpdate').mockResolvedValue({ ok: true, requested: [FLEET, SERVER], skipped: [] });
    render(<FleetScreen store={makeStore()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update all' }));
    const list = await screen.findByRole('list', { name: 'Nodes this moves, in order' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1. fleet (fleet) v0.0.7 → v0.0.9',
      '2. server (server) v0.0.7 → v0.0.9',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.9' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledWith({ all: true, tag: 'v0.0.9' });
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
  });
});
```

(`NodeWire`, `UpdatesView`, `MIN`, `makeStore`, `within`, `waitFor`, `fireEvent`, `api` are already imported or declared at file level — wave 3 Task 11 added the two types to the `:4` import.)

- [ ] **Step 7: Run the suites to verify they fail**

Run, one at a time, foreground, from `pwa/`:

`./node_modules/.bin/vitest run test/move-plan.test.ts`
Expected: FAIL — `Test Files  1 failed (1)`, `Error: Failed to resolve import "../src/fleet/movePlan" from "test/move-plan.test.ts". Does the file exist?` (no case runs).

`./node_modules/.bin/vitest run test/update-move-sheet.test.tsx`
Expected: FAIL — `Test Files  1 failed (1)` with `Failed to resolve import "../src/fleet/movePlan"` (or `"../src/fleet/UpdateMoveSheet"` — vite names the first it cannot resolve); no case runs.

`./node_modules/.bin/vitest run test/api.test.ts`
Expected: FAIL — exactly six cases red, every other case green: the four move-client cases (`TypeError: api.applyUpdate is not a function` / `api.rollbackUpdate is not a function`), the six-route census (`expected [ …(4) ] to deeply equal [ …(6) ]`) and the literal-absence scan (`expected [ 'fleet/UpdateBanner.tsx', 'lib/api.ts', 'screens/SettingsScreen.tsx' ] to deeply equal []`). If the scan names any other file, a surface this task does not know spells the retired sentence — stop and report it.

`./node_modules/.bin/vitest run test/settings-screen.test.tsx`
Expected: FAIL — exactly the ten new cases red, every other case (the Darwin case included) green: the three cases that spy on nothing and read a control — "renders every move button ENABLED …", "enables Update iff the node has a pendingTag …" and "Roll back needs somewhere to go …" (its row-A line comes first) — on `toBeDisabled` inverted (`Received element is disabled`); "renders the dispatcher's own word for the row …" at its first `getByText` (`Unable to find an element with the text: halted — …` — wave 3's row has no such line); and the six sheet cases at their FIRST line, `vi.spyOn(api, 'applyUpdate')` / `vi.spyOn(api, 'rollbackUpdate')` over a method the client does not have yet: `Error: The property "applyUpdate" is not defined on the object.` (or `"rollbackUpdate"` — `@vitest/spy`'s `spyOn` assertion, read in its source, vitest 4.1). *(CORRECTED: this step said the six fail on `Unable to find role=…`; they never reach a render.)*

`./node_modules/.bin/vitest run test/update-banner.test.tsx test/fleet-screen.test.tsx`
Expected: FAIL — exactly three cases red, each at its `vi.spyOn(api, 'applyUpdate')` line with `Error: The property "applyUpdate" is not defined on the object.`: the banner's "Update all is ENABLED …" and "self-polling, a confirmed Update all re-polls …", and fleet-screen's "opens the move sheet naming the fleet node first …"; every other case green (the banner's silence cases included — nothing here has touched the component). *(CORRECTED: this step said `Received element is disabled` and `Unable to find role` timeouts; the spy refuses first.)*

- [ ] **Step 8: Create `pwa/src/fleet/movePlan.ts`**

```ts
// The move planner (centralised-update design 2026-09-20 §13 "W4 adds", §18
// "Install names the order and the direction"; programme wave 5 Task 8). PURE
// — no fetch, no React, no clock. Given the last good /api/updates view and
// what the operator tapped, it answers which nodes that tap moves, in the
// order the server will move them, and the request(s) one confirm sends. All
// five move controls (Install / Roll back on a release row, Update / Roll back
// on an inventory row, Update all on the fleet banner) build a MoveIntent and
// hand the plan to the ONE sheet (UpdateMoveSheet), so they cannot disagree.
//
// ORDER IS THE DISPATCHER'S. compareDispatchOrder (shared/api.ts) is the one
// spelling of "fleet-role before server-role, then label, then node id"; the
// server's planDispatch moves nodes in that order and this file lists them in
// it, so the sheet cannot name the server first while the fleet moves first.
//
// THE SET IS WHAT THE MOVE TAKES SOMEWHERE. A fleet-wide update names each
// node the tag takes FORWARD — one running an older tag, or one whose stamp
// was READ and carries no tag (an unversioned box: any eligible release is
// newer, never "not newer") — the not-newer / stamp-unread half of the rule
// POST /api/updates/apply {all: true} skips by (D-3385).
// The route also skips a node its dispatcher would refuse for a reason this
// view cannot decide without a second copy of the dispatcher (a tag the node
// refused, a missing capability, a floor never measured (floor-unread) —
// MoveSkipWhy, shared/api.ts); the 202 names
// those in `skipped`, and the sheet says the ones it named (moveSkippedText). It never names a
// node whose stamp was not read (unmeasured is not unversioned) or a macOS
// node (not centrally managed, decision 17 — no PWA surface offers it a move,
// D-3308, D-3309). A fleet-wide rollback names every non-macOS node running a
// NEWER tag than the target, and sends one single-node rollback per node, in
// order (D-3390): the rollback route names one node.
//
// TAG ORDER IS SEMVER: isNewerTag, always behind isReleaseTag (it throws
// RangeError on a non-tag) — v0.0.10 is newer than v0.0.9.
import { compareDispatchOrder, isReleaseTag } from '../../../shared/api';
import type { ApplyUpdateBody, NodeWire, RollbackUpdateBody, UpdatesView } from '../../../shared/api';
import { isNewerTag } from '../../../shared/semver';
import { nodeVersion } from './useUpdatesView';

export type MoveIntent =
  | { scope: 'node'; direction: 'update'; nodeId: string; tag: string }
  | { scope: 'node'; direction: 'rollback'; nodeId: string; to: string }
  | { scope: 'fleet'; direction: 'update'; tag: string }
  | { scope: 'fleet'; direction: 'rollback'; to: string };

/** The nodes a move names, sorted by compareDispatchOrder — what the sheet lists and what it sends for — and
 *  the inventory it was planned over, so a node an answer names that the move does not (a halting row) has a
 *  label (moveLabel). */
export interface PlannedMove { intent: MoveIntent; nodes: NodeWire[]; inventory: readonly NodeWire[] }

export type MoveRequest =
  | { route: 'apply'; body: ApplyUpdateBody }
  | { route: 'rollback'; body: RollbackUpdateBody };

/** `tag` takes `n` forward: a tag it runs is older, or its stamp was READ and carries no tag — and in either case
 *  the tag is strictly newer than the node's floor when `highestVersion` is a tag, the dispatcher's rule
 *  (D-3403: `moveRefusal` answers `not-newer` at or below `floorOf(highestVersion,
 *  currentVersion)`, and `{all: true}` skips that node), so the sheet never names a node the route will skip
 *  `not-newer`. A floor that was never measured (`floor-unread`, D-3492) is not previewed
 *  here: the route skips it and the 202's `skipped` names it. */
function takesForward(n: NodeWire, tag: string): boolean {
  if (isReleaseTag(n.highestVersion) && !isNewerTag(tag, n.highestVersion)) return false;
  const v = nodeVersion(n);
  if (v !== null) return isNewerTag(tag, v);
  return n.stampRead === 'ok';
}

/** `n` runs a tag newer than `tag` — the only node a rollback to `tag` has anywhere to take. */
function runsNewer(n: NodeWire, tag: string): boolean {
  const v = nodeVersion(n);
  return v !== null && isNewerTag(v, tag);
}

export function planMove(view: UpdatesView, intent: MoveIntent): PlannedMove {
  const all: readonly NodeWire[] = Array.isArray(view.nodes) ? view.nodes : [];
  let picked: NodeWire[];
  if (intent.scope === 'node') {
    picked = all.filter((n) => n.nodeId === intent.nodeId);
  } else if (intent.direction === 'update') {
    const tag = intent.tag;
    picked = isReleaseTag(tag) ? all.filter((n) => n.os !== 'darwin' && takesForward(n, tag)) : [];
  } else {
    const to = intent.to;
    picked = isReleaseTag(to) ? all.filter((n) => n.os !== 'darwin' && runsNewer(n, to)) : [];
  }
  // `filter` returned a fresh array, so this sort never reorders the poll's view.
  return { intent, nodes: picked.sort(compareDispatchOrder), inventory: all };
}

export function moveTarget(intent: MoveIntent): string {
  return intent.direction === 'update' ? intent.tag : intent.to;
}

export function moveHeadline(intent: MoveIntent): string {
  return intent.direction === 'update' ? `Update ${intent.tag}` : `Roll back to ${intent.to}`;
}

/** What a node runs, in the words the inventory row keeps apart (wave 3's currentText): a tag, an unversioned
 *  build (a stamp that was read and carries none), or a stamp that was never read — never folded together. */
function currentWord(n: NodeWire): string {
  const v = nodeVersion(n);
  if (v !== null) return v;
  return n.stampRead === 'ok' ? 'unversioned' : 'stamp not read';
}

export function moveLines(plan: PlannedMove): string[] {
  const target = moveTarget(plan.intent);
  return plan.nodes.map((n, i) => `${i + 1}. ${n.label} (${n.role ?? 'unknown role'}) ${currentWord(n)} → ${target}`);
}

export function moveRequests(plan: PlannedMove): MoveRequest[] {
  if (plan.nodes.length === 0) return [];
  const i = plan.intent;
  if (i.scope === 'node') {
    return i.direction === 'update'
      ? [{ route: 'apply', body: { nodeId: i.nodeId, tag: i.tag } }]
      : [{ route: 'rollback', body: { nodeId: i.nodeId, to: i.to } }];
  }
  if (i.direction === 'update') return [{ route: 'apply', body: { all: true, tag: i.tag } }];
  const to = i.to;
  return plan.nodes.map((n): MoveRequest => ({ route: 'rollback', body: { nodeId: n.nodeId, to } }));
}

/** What an empty plan says — only what was measured. A node move names nothing only when the view no longer
 *  carries the node; a fleet move to a non-tag names nothing; otherwise no managed (non-macOS) node was measured
 *  on the far side of the target (forward: takesForward — older, or unversioned, and above its floor). That is not
 *  "every node is already there": a node can be AHEAD of it (a release row that reads Install because not every
 *  node is newer), or below it but at its floor. */
export function moveEmptyText(intent: MoveIntent): string {
  if (intent.scope === 'node') return 'Nothing to move — that node is no longer in the inventory.';
  const target = moveTarget(intent);
  if (!isReleaseTag(target)) return `Nothing to move — ${target} is not a release tag.`;
  return intent.direction === 'update'
    ? `Nothing to move — ${target} takes no managed node forward.`
    : `Nothing to move — no managed node is measured on a release newer than ${target}.`;
}

/** A node's label from the inventory the move was planned over, else its id (a node that has left it). */
export function moveLabel(plan: PlannedMove, nodeId: string): string {
  return plan.inventory.find((n) => n.nodeId === nodeId)?.label ?? nodeId;
}
```

Run: `cd pwa && ./node_modules/.bin/vitest run test/move-plan.test.ts`
Expected: PASS — `Tests  17 passed (17)` (14 measured before review, plus the floor case and the two empty-sentence/label cases — unmeasured).

- [ ] **Step 9: Create `pwa/src/fleet/UpdateMoveSheet.tsx`**

```tsx
// UpdateMoveSheet — the ONE confirm sheet every move control opens
// (centralised-update design 2026-09-20 §13 "W4 adds"; programme wave 5
// Task 8): Install / Roll back on a /settings release row, Update / Roll back
// on an inventory row, and the fleet banner's Update all. It names the nodes
// the move takes, numbered in the order the server's dispatcher moves them
// (movePlan.ts), under the move's own headline, and one confirm sends the
// request(s) by direction — `apply {tag}` forward, `rollback {to}` back.
//
// A `Sheet`, not `QuickConfirm` (D-3389):
// QuickConfirm's confirm runs `onConfirm(); onClose();` unconditionally, and a
// single-node apply or rollback can be REFUSED synchronously — the route
// answers the dispatcher's own predicate as a 409. The refusal is said IN this
// sheet, through updateErrorText, and the sheet stays open; it closes only on
// a 2xx that requested what it named. The busy flag and the generation
// counter are AbandonSheet's idiom: an
// answer for a plan the sheet no longer shows is dropped.
//
// RESULT BY RE-MEASUREMENT. A 202 means a request row was written — never that
// a node moved. The sheet calls onDone (its caller re-polls /api/updates) and
// closes; the inventory then shows the request and, later, the move. A 2xx
// whose body would not parse is still a written request (postJsonOr, D-1150):
// the sheet closes the same way and a toast says the answer was unread.
//
// A SKIP IS SAID. `{all: true}`'s 202 lists in `skipped` every node the
// server's dispatcher would refuse (MoveSkipWhy, D-3401).
// This plan previews by version and OS alone, so a node it NAMED can come back
// skipped for a capability, the agent, a refusal or the catalogue: the sheet
// says each such node and its sentence IN PLACE (moveSkippedText) and stays
// open with no confirm — the reply is final, and Task 6's requestAll writes
// no request and no updateDetail for a skipped node, so this sentence is the
// only place the operator learns why. A readable reply that requested nothing
// at all is said the same way (MOVE_NOTHING_REQUESTED_TEXT); a skip of a node
// the sheet never listed is the plan agreeing with the server, and is not said.
//
// A fleet-wide rollback is one single-node request per node, in order,
// stopping at the first refusal (D-3390); the
// refusal then names the nodes already requested, and onDone re-polls so the
// inventory shows them. The sheet then offers NO second send: re-sending the
// plan would start with the node now pending, whose own route answers 409
// busy before the rest is reached (MOVE_REST_TEXT points at the release list).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MoveRequestAnswer } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { ApiError, api, moveSkipText, updateErrorText } from '../lib/api';
import { moveEmptyText, moveHeadline, moveLabel, moveLines, moveRequests, type PlannedMove } from './movePlan';
import './fleet.css';

export const MOVE_UNREADABLE_TEXT = "Requested — the server's answer could not be read; the screen will re-check.";
/** A readable 2xx that requested no node and skipped none this sheet named (one left the inventory between the
 *  tap and the send): nothing was written, so the sheet says so rather than closing on it. */
export const MOVE_NOTHING_REQUESTED_TEXT = 'The server requested no node — reload the screen to see each row.';
/** After a per-node sequence stopped part-way: the node already requested is not re-sent from this sheet. */
export const MOVE_REST_TEXT = 'Move the rest from the release list once that node settles.';

/** A move refused part-way. Two facts, so one value that carries both: the refusal itself (`err` — an ApiError
 *  from the route, or a transport error) and the nodes whose single-node request was already written. */
export class MoveSendError extends Error {
  readonly err: unknown;
  readonly requested: readonly string[];
  constructor(err: unknown, requested: readonly string[]) {
    super(err instanceof Error ? err.message : 'move refused');
    this.name = 'MoveSendError';
    this.err = err;
    this.requested = requested;
  }
}

export async function sendMove(plan: PlannedMove): Promise<Array<MoveRequestAnswer | 'unreadable'>> {
  const answers: Array<MoveRequestAnswer | 'unreadable'> = [];
  const requested: string[] = [];
  for (const r of moveRequests(plan)) {
    try {
      answers.push(r.route === 'apply' ? await api.applyUpdate(r.body) : await api.rollbackUpdate(r.body));
    } catch (err) {
      throw new MoveSendError(err, [...requested]);
    }
    const body = r.body;
    if ('nodeId' in body) requested.push(body.nodeId);
  }
  return answers;
}

/** The answers' skips of nodes this plan NAMED — the server refused them for a reason the plan could not preview.
 *  A skip of a node the plan never listed is the plan agreeing with the server, and is not said. */
export function moveSkippedText(answers: ReadonlyArray<MoveRequestAnswer | 'unreadable'>, plan: PlannedMove): string | null {
  const named = new Map(plan.nodes.map((n) => [n.nodeId, n.label] as const));
  const said: string[] = [];
  for (const a of answers) {
    if (a === 'unreadable' || !Array.isArray(a.skipped)) continue;
    for (const s of a.skipped) {
      const label = named.get(s.nodeId);
      if (label !== undefined) said.push(`${label}: ${moveSkipText(s.why)}`);
    }
  }
  return said.length === 0 ? null : `Not requested — ${said.join(' ')}`;
}

/** The labels a `409 halted` names in its `detail` — the halting nodeIds, `, `-joined (Task 6's singleNodeMove),
 *  usually NOT the node this sheet moves, so they are read through the plan's inventory. None for any other
 *  refusal, or a detail that is not a string. */
function haltedBy(refusal: unknown, plan: PlannedMove): string[] {
  if (!(refusal instanceof ApiError) || typeof refusal.body !== 'object' || refusal.body === null) return [];
  const { error, detail } = refusal.body as { error?: unknown; detail?: unknown };
  if (error !== 'halted' || typeof detail !== 'string' || detail === '') return [];
  return detail.split(', ').map((id) => moveLabel(plan, id));
}

/** The refusal's own sentence (updateErrorText, code-first); for `halted`, the nodes that halt the fleet; then
 *  the nodes already requested when some were, and that the rest is not re-sent from here. Other refusals'
 *  `detail` is not appended: `busy`'s is the moved node's own state word, which the sentence already says, and
 *  `no-desired`/`no-previous` cannot reach this sheet — every move it sends names its tag. */
function moveErrorText(err: unknown, plan: PlannedMove): string {
  const refusal = err instanceof MoveSendError ? err.err : err;
  const said = updateErrorText(refusal);
  const blockers = haltedBy(refusal, plan);
  const head = blockers.length === 0 ? said : `${said} Blocked by: ${blockers.join(', ')}.`;
  const requested = err instanceof MoveSendError ? err.requested : [];
  if (requested.length === 0) return head;
  return `${head} Already requested: ${requested.map((id) => moveLabel(plan, id)).join(', ')}. ${MOVE_REST_TEXT}`;
}

export function UpdateMoveSheet({ open, plan, onClose, onDone }: {
  open: boolean; plan: PlannedMove | null; onClose: () => void; onDone: () => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The sheet has had its final answer while staying open (a part-way refusal,
  // or a 2xx that did not request what it named): no confirm is offered again.
  const [answered, setAnswered] = useState(false);
  // AbandonSheet's generation: every close and every new plan bumps it in the
  // effect's cleanup, and an answer issued under an older generation is dropped.
  const gen = useRef(0);
  useEffect(() => {
    setBusy(false);
    setError(null);
    setAnswered(false);
    return () => { gen.current += 1; };
  }, [open, plan]);

  if (!open || plan === null) return null;
  const headline = moveHeadline(plan.intent);
  const lines = moveLines(plan);

  const confirm = (): void => {
    if (busy || answered) return;
    const mine = gen.current;
    setBusy(true);
    setError(null);
    void sendMove(plan).then(
      (answers) => {
        if (gen.current !== mine) return;   // superseded — another plan is shown now
        setBusy(false);
        const unread = answers.includes('unreadable');
        const requested = answers.flatMap((a) => (a !== 'unreadable' && Array.isArray(a.requested) ? a.requested : []));
        // The reply is authoritative (D-3401): a node this sheet NAMED that it skipped, or a
        // readable reply that requested nothing at all, is said HERE and the sheet stays open — never a close
        // that reads as "moved". onDone only when something may have been written.
        const short = moveSkippedText(answers, plan) ?? (!unread && requested.length === 0 ? MOVE_NOTHING_REQUESTED_TEXT : null);
        if (short !== null) {
          setAnswered(true);
          setError(requested.length === 0 ? short : `${short} Requested: ${requested.map((id) => moveLabel(plan, id)).join(', ')}.`);
          if (requested.length > 0 || unread) onDone();
          return;
        }
        if (unread) toast(MOVE_UNREADABLE_TEXT);
        onDone();
        onClose();
      },
      (err: unknown) => {
        if (gen.current !== mine) return;   // superseded — this refusal is for a plan no longer shown
        setBusy(false);
        setError(moveErrorText(err, plan));
        if (err instanceof MoveSendError && err.requested.length > 0) {
          // Part-way (a fleet rollback): the requested node is pending now, and re-sending this plan would start
          // with it — its own 409 busy, never reaching the rest. So this sheet offers no second send.
          setAnswered(true);
          onDone();
        }
      },
    );
  };

  return (
    <Sheet open onClose={onClose} title={headline}>
      <div className="update-move-sheet">
        {lines.length === 0 ? (
          <p className="qc-consequence">{moveEmptyText(plan.intent)}</p>
        ) : (
          <ol className="update-move-list" aria-label="Nodes this moves, in order">
            {plan.nodes.map((n, i) => <li key={n.nodeId} className="update-move-node">{lines[i]}</li>)}
          </ol>
        )}
        <div className="qc-actions">
          {lines.length > 0 && !answered && (
            <button type="button" className="btn-primary" disabled={busy} onClick={confirm}>
              {busy ? 'Sending…' : headline}
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
            {answered ? 'Close' : 'Cancel'}
          </button>
        </div>
        {error !== null && <p className="update-move-error" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 10: The client — `pwa/src/lib/api.ts`**

Replace the import line (wave 3 Task 5's) in place, the four names in the line's alphabetical order:

```ts
import type { AccountsResponse, AckAnswer, ApplyUpdateBody, AutoMode, CatalogueState, CatchUp, ClaimSummary, CoordCaps, CoordCapsView, FleetHealth, FleetSession, IntentWriteAnswer, LifecycleQueryResult, LoginRequest, MoveRequestAnswer, MoveSkipWhy, NotifyEvent, NotifyMode, PaneHistoryReply, PasskeyAssertFinish, PasskeyAssertStart, PasskeyListResponse, PasskeyRegisterFinish, PasskeyRegisterStart, ProjectPoolWire, ProjectRow, PrView, ReapResult, RollbackUpdateBody, RouteField, RouteFields, RunSummary, SlashCommand, StagedClip, UpdateChannel, UpdateRouteError, UpdatesView, WsAudit } from '../../../shared/api';
```

(If a merged review round changed that line, add exactly the four names to what merged.)

Insert directly after wave 3's `updateErrorText` (its last two lines, `  return apiErrorText(err);` / `}`):

```ts

/** The sentence for a word `{all: true}`'s 202 skipped a node with (`MoveRequestAnswer.skipped`, programme wave 5).
 *  `MoveSkipWhy` is a subset of `UPDATE_ERROR_TEXT`'s keys, so this is the table's own sentence — the one a
 *  single-node 409 of the same word renders — and a skip word with no sentence is a compile error here. */
export function moveSkipText(why: MoveSkipWhy): string {
  return UPDATE_ERROR_TEXT[why];
}
```

Delete the blank line above, and all of, this block (wave 3 Task 5), so `kickoffErrorText`'s line is followed by one blank line and `UpdateIntentRequest`'s docstring:

```ts

/**
 * The one sentence every move control carries while it is DISABLED (design
 * 2026-09-20 §13, §15 row W3): Install and Roll back on a release row, Update
 * and Roll back on a node row, and the fleet banner's Update all. One literal,
 * so five controls cannot disagree about when they arrive, and the wave that
 * enables them retires one line. This client has no method for either move
 * route, on purpose — `api.test.ts` pins the census of the update routes it
 * spells, so nothing here can be wired to a disabled control early.
 */
export const MOVE_DISABLED_TEXT = 'lands with the next release (W4)';
```

Insert directly after wave 3's `ackUpdateNode` (the two quoted lines `    ackUpdateNode: (nodeId: string) =>` / `      postJsonOr<AckAnswer | 'unreadable'>('/api/updates/ack', 'unreadable', { nodeId }),`):

```ts
    /** `POST /api/updates/apply` (programme wave 5) — move one node (`{nodeId}`) or
     *  every node the tag takes forward (`{all: true}`), to `tag` or, without one,
     *  to each node's resolved desired tag. The answer is a REQUEST written, never
     *  a move made: `202 {requested, skipped}`; the dispatcher moves the nodes one
     *  at a time and the inventory is where the result is read.
     *
     *  `postJsonOr`, the `setUpdateIntent` argument (D-1150): a 2xx whose body
     *  would not parse may still have written the request, so the move sheet
     *  says "requested, unconfirmed" and re-polls rather than reporting a refusal
     *  that did not happen. A refusal — `400`, `404`, a single node's `409`
     *  (the dispatcher's own predicate), `501` — still rejects with its
     *  `ApiError`, which `updateErrorText` reads code-first. */
    applyUpdate: (body: ApplyUpdateBody) =>
      postJsonOr<MoveRequestAnswer | 'unreadable'>('/api/updates/apply', 'unreadable', body),
    /** `POST /api/updates/rollback` (programme wave 5) — one node back to `to`, or
     *  without one to its `previousVersion`. Single-node by route: a fleet-wide
     *  rollback is one of these per node, in dispatch order (the move sheet's
     *  `sendMove`). `postJsonOr` for `applyUpdate`'s reason. */
    rollbackUpdate: (body: RollbackUpdateBody) =>
      postJsonOr<MoveRequestAnswer | 'unreadable'>('/api/updates/rollback', 'unreadable', body),
```

Run: `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts test/update-move-sheet.test.tsx`
Expected: `api.test.ts` — every case green but the literal-absence scan, which now lists `[ 'fleet/UpdateBanner.tsx', 'screens/SettingsScreen.tsx' ]` (Steps 11–12 retire those two); `update-move-sheet.test.tsx` — every case green but "UpdateBanner and SettingsScreen import no QuickConfirm — both open UpdateMoveSheet" (`expected '…' to match /from '(\.\/|\.\.\/fleet\/)UpdateMoveSheet'/`), which Steps 11–12 turn green.

- [ ] **Step 11: The settings screen — `pwa/src/screens/SettingsScreen.tsx`**

Imports, merged into the lines waves 3 wrote: the `'../lib/api'` line loses `MOVE_DISABLED_TEXT` (it keeps `ApiError`, `api`, `updateErrorText`); two NEW lines beside the `'../fleet/useUpdatesView'` import:

```tsx
import { planMove, type MoveIntent, type PlannedMove } from '../fleet/movePlan';
import { UpdateMoveSheet } from '../fleet/UpdateMoveSheet';
```

`useId` stays imported (`UpdatesSection`, `UpdatesBody` and Task 10's section still call it); `isReleaseTag` is already imported (wave 3 Task 8).

In wave 3 Task 8's block comment, replace the three lines

```tsx
// The move button is rendered and DISABLED in this wave: its routes are
// programme wave 5's, and MOVE_DISABLED_TEXT is the one sentence every
// disabled move control carries (Task 5).
```

with

```tsx
// The move button opens the one move sheet (UpdateMoveSheet, programme wave
// 5): Install asks for the tag on every node it takes forward, Roll back asks
// for it node by node, and the sheet names those nodes in dispatch order.
```

Replace wave 3 Task 8's `function ReleaseItem(…) { … }` and `function ReleaseList(…) { … }` whole with:

```tsx
function ReleaseItem({ release: r, nodes, onMove }: {
  release: ReleaseWire; nodes: readonly NodeWire[]; onMove: (intent: MoveIntent) => void;
}): ReactNode {
  const refused = refusedLine(r, nodes);
  const direction = releaseDirection(r.tag, nodes);
  // By DIRECTION (§13): a release every node runs newer than is a rollback to
  // it, anything else an install of it — the same releaseDirection that
  // labels the button, so the label and the request cannot disagree.
  const intent: MoveIntent = direction === 'rollback'
    ? { scope: 'fleet', direction: 'rollback', to: r.tag }
    : { scope: 'fleet', direction: 'update', tag: r.tag };
  return (
    <li className="settings-release" data-tag={r.tag}>
      <div className="settings-release-head">
        <span className="settings-release-tag">{r.tag}</span>
        <span className="settings-release-date">{releaseDate(r.publishedAt)}</span>
        {isUpdateChannel(r.channel) && (
          <span className={`settings-badge settings-badge--${r.channel}`}>{r.channel}</span>
        )}
        {verifiedAt(r.tag, nodes) && <span className="settings-badge settings-badge--verified">verified</span>}
        {r.bundleListed === true && <span className="settings-badge">bundle listed</span>}
        {r.yanked === true && <span className="settings-badge">yanked</span>}
      </div>
      {refused !== null && <p className="settings-release-refused">{refused}</p>}
      {typeof r.notes === 'string' && r.notes !== '' && <pre className="settings-release-notes">{r.notes}</pre>}
      <div className="settings-release-actions">
        <button type="button" className="btn-ghost settings-move" onClick={() => onMove(intent)}>
          {direction === 'rollback' ? 'Roll back' : 'Install'}
        </button>
      </div>
    </li>
  );
}

function ReleaseList({ releases, nodes, onMove }: {
  releases: readonly ReleaseWire[]; nodes: readonly NodeWire[]; onMove: (intent: MoveIntent) => void;
}): ReactNode {
  if (releases.length === 0) return null;
  return (
    <ul className="settings-releases" aria-label="Releases">
      {sortReleases(releases).map((r) => <ReleaseItem key={r.tag} release={r} nodes={nodes} onMove={onMove} />)}
    </ul>
  );
}
```

In wave 3 Task 9's block comment, replace the two lines

```tsx
// Update and Roll back are rendered DISABLED beside MOVE_DISABLED_TEXT (their
// routes are programme wave 5's). Ack is live — its route is W2's — and is
```

with

```tsx
// Update and Roll back open the one move sheet (UpdateMoveSheet, programme
// wave 5): Update iff pendingTag names a tag, Roll back iff previousVersion
// is a tag the node runs newer than. Ack is live — its route is W2's — and is
```

Replace wave 3 Task 9's `function NodeItem(…) { … }` and `function NodeList(…) { … }` whole with:

```tsx
function NodeItem({ node: n, releases, now, onAcked, onMove }: {
  node: NodeWire; releases: readonly ReleaseWire[]; now: number; onAcked: () => void;
  onMove: (intent: MoveIntent) => void;
}): ReactNode {
  const [acking, setAcking] = useState(false);
  const darwin = n.os === 'darwin';
  const next = pendingTag(n);   // null for a Darwin node too — the predicate's own guard
  // Roll back needs somewhere to go: the stamp's previous version, when it is a tag this node runs NEWER than
  // (or the stamp carries no tag to compare it with). A rollback leaves `previous` in place (wave 4's D-3262),
  // so a node just rolled back reads previousVersion === its running tag: a tap there would be a 202 filed `met`.
  const v = nodeVersion(n);
  const previous = isReleaseTag(n.previousVersion) && (v === null || isNewerTag(v, n.previousVersion)) ? n.previousVersion : null;
  const reach = reachabilityLine(n, now);
  const request = requestLine(n, now);
  const ackable = canAck(n, releases);

  const ack = (): void => {
    setAcking(true);
    void api.ackUpdateNode(n.nodeId).then(
      (answer) => { if (answer === 'unreadable') toast(ACK_UNREADABLE_TEXT); },
      (err: unknown) => { toast(updateErrorText(err), 'error'); },
    ).finally(() => {
      setAcking(false);
      onAcked();
    });
  };

  let desired: ReactNode = null;
  if (darwin) {
    desired = <span className="settings-node-detail">{MACOS_UNMANAGED_TEXT}</span>;
  } else if (next !== null) {
    // pendingTag returns a tag only for a node whose channel passed
    // isUpdateChannel; restating that test here would be a SECOND arrow
    // predicate, so the type is asserted, not re-derived (Task 11's argument).
    const channel = n.channel as UpdateChannel;
    desired = (
      <span className="settings-node-desired">
        {`→ ${next}`}
        <span className={`settings-badge settings-badge--${channel}`}>{channel}</span>
      </span>
    );
  } else if (!isReleaseTag(n.desiredTag) || !isUpdateChannel(n.channel)) {
    desired = typeof n.resolveDetail === 'string' && n.resolveDetail !== ''
      ? <span className="settings-node-detail">{n.resolveDetail}</span>
      : null;
  }

  return (
    <li className="settings-node" data-node-id={n.nodeId}>
      <div className="settings-node-head">
        <span className="settings-node-label">{n.label}</span>
        <span className="settings-node-detail">{`${n.role ?? 'unknown role'} · ${typeof n.os === 'string' ? n.os : 'unknown'}`}</span>
      </div>
      <p className="settings-node-versions">
        <span className={currentIsAmber(n) ? 'settings-node-current settings-node-current--amber' : 'settings-node-current'}>
          {currentText(n)}
        </span>
        {desired}
      </p>
      {reach !== null && <p className="settings-node-detail">{reach}</p>}
      {request !== null && <p className="settings-node-detail">{request}</p>}
      <p className="settings-node-detail">{nodeStateLine(n)}</p>
      {/* The dispatcher's own word for this row (`updateDetail` on the wire): halted, busy — …, a spawn's stderr
          line, deadline, met: … — one printable line the server already bounds, rendered as a text child. */}
      {typeof n.update?.detail === 'string' && n.update.detail !== '' && <p className="settings-node-detail">{n.update.detail}</p>}
      <div className="settings-node-actions">
        {!darwin && (
          <>
            <button
              type="button"
              className="btn-ghost settings-move"
              disabled={next === null}
              onClick={() => { if (next !== null) onMove({ scope: 'node', direction: 'update', nodeId: n.nodeId, tag: next }); }}
            >
              Update
            </button>
            <button
              type="button"
              className="btn-ghost settings-move"
              disabled={previous === null}
              onClick={() => { if (previous !== null) onMove({ scope: 'node', direction: 'rollback', nodeId: n.nodeId, to: previous }); }}
            >
              Roll back
            </button>
          </>
        )}
        <button type="button" className="btn-ghost settings-move" disabled={!ackable || acking} onClick={ack}>Ack</button>
      </div>
    </li>
  );
}

function NodeList({ nodes, releases, now, onAcked, onMove }: {
  nodes: readonly NodeWire[]; releases: readonly ReleaseWire[]; now: number; onAcked: () => void;
  onMove: (intent: MoveIntent) => void;
}): ReactNode {
  if (nodes.length === 0) return null;
  return (
    <ul className="settings-nodes" aria-label="Nodes">
      {nodes.map((n) => <NodeItem key={n.nodeId} node={n} releases={releases} now={now} onAcked={onAcked} onMove={onMove} />)}
    </ul>
  );
}
```

In Task 7's `UpdatesBody`, directly after its quoted `  const [refreshNote, setRefreshNote] = useState<string | null>(null);`, add:

```tsx
  // The move the operator is confirming — a plan taken at the tap, so a poll
  // landing while the sheet is open cannot change the list under a thumb.
  const [move, setMove] = useState<PlannedMove | null>(null);
  const openMove = (intent: MoveIntent): void => setMove(planMove(view, intent));
```

and replace its two quoted list lines (wave 3 Tasks 8 and 9)

```tsx
      {view !== null && <ReleaseList releases={view.releases} nodes={view.nodes} />}
        {view !== null && <NodeList nodes={view.nodes} releases={view.releases} now={now} onAcked={reload} />}
```

(the second line's indentation is whatever Task 9 merged) with:

```tsx
      {view !== null && <ReleaseList releases={view.releases} nodes={view.nodes} onMove={openMove} />}
      {view !== null && <NodeList nodes={view.nodes} releases={view.releases} now={now} onAcked={reload} onMove={openMove} />}
      <UpdateMoveSheet open={move !== null} plan={move} onClose={() => setMove(null)} onDone={reload} />
```

Run: `cd pwa && ./node_modules/.bin/vitest run test/settings-screen.test.tsx`
Expected: PASS — every case, the ten new ones included. (`nodeVersion` and `isNewerTag` are already imported — wave 3 Task 8 added both for `releaseDirection`.)

- [ ] **Step 12: The banner and the fleet screen**

In `pwa/src/fleet/UpdateBanner.tsx`, replace the header's last paragraph

```tsx
// "Update all" is DISABLED beside MOVE_DISABLED_TEXT: the apply route it would
// call does not exist in this wave (spec §13, §18 "the move controls are
// disabled in W3"). "See what's new" opens /settings, where the release list is.
```

with

```tsx
// "Update all" opens the one move sheet (UpdateMoveSheet, programme wave 5)
// with this banner's tag: every node the tag takes forward, named in dispatch
// order, and one `apply {all: true, tag}` on confirm — a Sheet, because a
// close-on-tap confirm cannot say a refusal (D-3389).
// After a 2xx the sheet calls onMoved: the screen's re-poll when the view was
// injected, this banner's own when it polls. "See what's new" opens /settings,
// where the release list is.
```

Replace its import block (wave 3 Task 11's nine lines, from `import { useId } from 'react';` through `import './fleet.css';`) with:

```tsx
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { UpdateChannel, UpdatesView } from '../../../shared/api';
import { compareReleaseTags } from '../../../shared/semver';
import { versionsSummary } from '../../../shared/update-summary';
import { navigate } from '../lib/router';
import { planMove, type PlannedMove } from './movePlan';
import { UpdateMoveSheet } from './UpdateMoveSheet';
import { UPDATES_POLL_MS, nodeVersion, pendingTag, useUpdatesView } from './useUpdatesView';
import './fleet.css';
```

Replace `export function UpdateBanner(…) { … }` whole (`bannerRelease` and `updateBannerText` above it are untouched) with:

```tsx
export function UpdateBanner({ updates: injected, onMoved }: {
  updates?: UpdatesView | null; onMoved?: () => void;
} = {}): ReactNode {
  // Polls only when nothing was injected: FleetScreen polls once for the whole
  // screen; the standalone shape (tests, any other mount) still self-polls.
  const polled = useUpdatesView(injected === undefined ? UPDATES_POLL_MS : 0);
  const view = injected === undefined ? polled.view : injected;
  // The move being confirmed — a plan taken at the tap, so a poll landing
  // while the sheet is open cannot change the list under a thumb.
  const [move, setMove] = useState<PlannedMove | null>(null);
  // After a 2xx: the screen's re-poll when it handed one down, else this
  // banner's own (useUpdatesView(0)'s reload is a no-op, by its contract).
  const moved = injected === undefined ? polled.reload : (onMoved ?? (() => {}));
  const release = view !== null ? bannerRelease(view) : null;
  const text = view !== null ? updateBannerText(view) : null;
  return (
    <>
      {view !== null && release !== null && text !== null && (
        <div className="update-banner" role="status">
          <span className="update-banner-msg">{text}</span>
          <div className="update-banner-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setMove(planMove(view, { scope: 'fleet', direction: 'update', tag: release.tag }))}
            >
              Update all
            </button>
            <button type="button" className="btn-primary" onClick={() => navigate('/settings')}>
              {"See what's new"}
            </button>
          </div>
        </div>
      )}
      <UpdateMoveSheet open={move !== null} plan={move} onClose={() => setMove(null)} onDone={moved} />
    </>
  );
}
```

(The sheet sits OUTSIDE the banner's own condition, so a poll that silences the banner while the sheet is open does not unmount a send in flight; closed, it renders nothing, so every silence case's `toBeEmptyDOMElement()` still holds.)

In `pwa/src/screens/FleetScreen.tsx`, replace the quoted line `      <UpdateBanner updates={updates.view} />` with:

```tsx
      <UpdateBanner updates={updates.view} onMoved={updates.reload} />
```

Run: `cd pwa && ./node_modules/.bin/vitest run test/update-banner.test.tsx test/fleet-screen.test.tsx test/update-move-sheet.test.tsx test/api.test.ts`
Expected: PASS, every file (the literal-absence scan and the QuickConfirm/import scan now green).

- [ ] **Step 13: The CSS and the registry**

In `pwa/src/fleet/fleet.css`, delete wave 3 Task 8's line `.settings-move-note { font-size: var(--text-2xs); color: var(--ink-tertiary); }` and wave 3 Task 11's four lines

```css
.update-banner-note {
  flex-basis: 100%;
  font-size: var(--text-xs);
}
```

and in wave 3 Task 9's inventory header comment replace the line `   and the move row reuses its .settings-move-note, both already measured. */` with `   (already measured); the move buttons carry no note of their own. */`. Then append after the file's last line:

```css

/* — centralised update management, programme wave 5 Task 8: the move sheet —
   The ONE confirm sheet every move control opens (UpdateMoveSheet.tsx): the
   nodes it moves, numbered in dispatch order, one confirm, a refusal said in
   place. Self-grounded — its own `color` AND `background`, the .abandon-sheet
   pairing — so the children below are named-ancestor DESCENDANTS
   design/audit.mjs recovers a ground for and measures; none of them needs an
   INHERITED_GROUNDS entry. The number is in each line's text (movePlan's
   moveLines), so the list draws no marker of its own; the lines are
   same-user text (labels) and wrap inside the phone width. */
.update-move-sheet {
  display: grid;
  gap: var(--sp-3);
  color: var(--ink-primary);
  background: var(--bg-surface);
  border-radius: var(--r-md);
  padding: var(--sp-3);
}
.update-move-sheet .update-move-list {
  display: grid;
  gap: var(--sp-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.update-move-sheet .update-move-node {
  min-width: 0;
  font: var(--weight-regular) var(--text-sm) / var(--leading-normal) var(--font-mono);
  overflow-wrap: anywhere;
}
/* `--status-dead-text` on `--bg-surface`: the pair `.abandon-sheet
   .abandon-error` already measures (6.80:1 DARK / 5.73:1 LIGHT). */
.update-move-sheet .update-move-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--status-dead-text);
}
```

In `pwa/design/audit.mjs`, delete wave 3 Task 8's four-line entry:

```js
  'fleet.css .settings-move-note': {
    under: ['var(--bg-page)'],
    why: "the 'lands with the next release (W4)' note beside a disabled Install/Roll back button, in the same unfilled release row (and in any other unfilled row of this screen that reuses it). Same ground as .settings-release-date; the NOTE is live text and is measured, unlike the disabled button beside it (primitives.css .btn-ghost:disabled, WCAG 1.4.3)",
  },
```

Run: `cd pwa && node design/contrast-check.mjs | grep -E '^ALL [0-9]+ PASS$|rules set a colour with no ground|update-move'`
Expected: `ALL <p+2> PASS` (Step 1's `<p>` plus 2), the uncovered line still reading Step 1's `<u>`, and exactly these four rows (measured on a scratch copy of `pwa/` at `d759c914` with this CSS: `ALL 566 PASS`, uncovered `255`):

```
PASS   15.68  (min 4.5)  DARK  fleet.css .update-move-sheet  var(--ink-primary) on var(--bg-surface)
PASS   16.58  (min 4.5)  LIGHT fleet.css .update-move-sheet  var(--ink-primary) on var(--bg-surface)
PASS    6.80  (min 4.5)  DARK  fleet.css .update-move-sheet .update-move-error [in fleet.css .update-move-sheet]  var(--status-dead-text) on var(--bg-surface)
PASS    5.73  (min 4.5)  LIGHT fleet.css .update-move-sheet .update-move-error [in fleet.css .update-move-sheet]  var(--status-dead-text) on var(--bg-surface)
```

Then `node design/contrast-check.mjs --uncovered | grep '^#   ' | grep -c 'update-move\|settings-move-note\|update-banner-note'` → prints `0` (the `^#   ` filter is load-bearing: `--uncovered` prints the PASS table first).

- [ ] **Step 14: Run green, the neighbours and the gates**

Run, one at a time, foreground, from `pwa/`:
`./node_modules/.bin/vitest run test/move-plan.test.ts test/update-move-sheet.test.tsx` → PASS — `Tests  38 passed (38)` (17 + 21; the floor case and this review's move-plan and sheet cases are unmeasured).
`./node_modules/.bin/vitest run test/api.test.ts test/settings-screen.test.tsx test/update-banner.test.tsx test/fleet-screen.test.tsx` → PASS, every file; each file's total is its wave-3 total plus this task's net (api `+4`: two cases rewritten in place, four appended; settings `+8`: two cases replaced by ten; banner `+1`; fleet-screen `+1`) — a smaller green is not this green.
`./node_modules/.bin/vitest run test/use-updates-view.test.tsx test/contrast.test.ts test/fleet-css.test.ts test/build-line.test.tsx test/fleet-host-banner.test.tsx test/tap-targets.test.tsx test/app.test.tsx` → PASS, every file (`contrast.test.ts`'s "has no stale inherited registry entry" and "contains no identities beyond the grandfathered blind spots" read Step 13's registry; `use-updates-view.test.tsx` and the banner's silence cases are §18 "unreachable is not current", unedited).
`npm run build` → `tsc --noEmit` clean over `src` and `test` (an import left naming `MOVE_DISABLED_TEXT`, or an unused `useId`, fails here, not in vitest), then the vite build.
`node design/contrast-check.mjs` → exit 0, Step 13's `ALL <p+2> PASS`.

From `server/`: `./node_modules/.bin/vitest run test/single-definition.test.ts` → PASS (it walks `pwa/src`: `movePlan.ts` imports `compareDispatchOrder` and spells no refusal word, no `RELEASE_TAG` source, no `'update-gate'`, no summary clause); `./node_modules/.bin/vitest run test/session-hook.test.ts` → PASS (a known load flake: re-run in isolation before calling a red real).

- [ ] **Step 15: Mutation measurement (spec §18 "Install names the order and the direction"; the retirement of "the move controls are disabled in W3"; D-3390; D-3389)**

Each mutation is one hand edit, the named file run red, then the edit reversed by hand — never `git checkout --`, which would discard this task's uncommitted work — and the restore confirmed by the `grep -c` stated. All commands from `pwa/`.

1. §18 "Install names the order" — in `src/fleet/movePlan.ts`, change `  return { intent, nodes: picked.sort(compareDispatchOrder), inventory: all };` to `  return { intent, nodes: picked, inventory: all };`. Run `./node_modules/.bin/vitest run test/move-plan.test.ts test/update-move-sheet.test.tsx test/settings-screen.test.tsx test/update-banner.test.tsx test/fleet-screen.test.tsx` → RED — every case whose wire lists the server row first (derived from each fixture's wire order; count the reds against this list): move-plan "names the fleet-role node before the server-role node whatever the wire order …", "is compareDispatchOrder …", "a fleet update names only nodes the tag takes FORWARD …", "a fleet rollback names every non-macOS node running a NEWER tag …", "a fleet rollback is one rollback {nodeId, to} per node, fleet first …" and "lines: numbered in plan order …"; the sheet's "names the nodes it moves in dispatch order …", "a fleet rollback posts one rollback {nodeId, to} per node, fleet first …", "a refusal on the first node leaves the second unsent", "a refusal on the second names the node already requested …", "after a part-way rollback the sheet offers no second send …" (it names `server` as already requested) and "sendMove rejects with a MoveSendError …" — the four skip/nothing-requested cases stay green, since moveSkippedText reads the ANSWER's order and the listed-skip case's plan names one node; settings "Install opens the move sheet naming the nodes fleet-then-server …", "a release every node runs newer than reads Roll back …" and "a refusal on the first node leaves the second unsent; the sheet says why …"; the banner's "Update all is ENABLED …" (its "self-polling …" case stays green — `view()`'s wire is fleet-first); fleet-screen "opens the move sheet naming the fleet node first …" (each lists or sends `server` first). Restore; `grep -c 'nodes: picked.sort(compareDispatchOrder), inventory: all };' src/fleet/movePlan.ts` → `1`.
2. §18 "…and the direction" (the release row sends an older tag as `apply`) — in `src/screens/SettingsScreen.tsx`'s `ReleaseItem`, change `    ? { scope: 'fleet', direction: 'rollback', to: r.tag }` to `    ? { scope: 'fleet', direction: 'update', tag: r.tag }`. Run `./node_modules/.bin/vitest run test/settings-screen.test.tsx` → RED: "a release every node runs newer than reads Roll back …" and "a refusal on the first node leaves the second unsent …" (the plan is an update to an older tag, which takes no node forward: the sheet reads `Nothing to move …` and has no `Roll back to v0.0.9` button). Restore; `grep -c "? { scope: 'fleet', direction: 'rollback', to: r.tag }" src/screens/SettingsScreen.tsx` → `1`.
3. The direction in the request builder (D-3390) — in `moveRequests`, change `  return plan.nodes.map((n): MoveRequest => ({ route: 'rollback', body: { nodeId: n.nodeId, to } }));` to `  return plan.nodes.map((n): MoveRequest => ({ route: 'apply', body: { nodeId: n.nodeId, tag: to } }));`. Run `./node_modules/.bin/vitest run test/move-plan.test.ts test/update-move-sheet.test.tsx` → RED: "a fleet rollback is one rollback {nodeId, to} per node …" and, in the sheet file, every case that stubs `rollbackUpdate` for a fleet rollback — "a fleet rollback posts one rollback {nodeId, to} per node …", "a refusal on the first node leaves the second unsent", "a refusal on the second names the node already requested …", "after a part-way rollback the sheet offers no second send …" and "sendMove rejects with a MoveSendError …" (`rollbackUpdate` never called; the unstubbed `applyUpdate` answers instead). Restore; `grep -c "route: 'rollback', body: { nodeId: n.nodeId, to } }));" src/fleet/movePlan.ts` → `1`.
4. The retirement of "disabled in W3" (Update) — in `NodeItem`, change `              disabled={next === null}` to `              disabled`. Run `./node_modules/.bin/vitest run test/settings-screen.test.tsx` → RED: "enables Update iff the node has a pendingTag …", "Update on a node row opens the sheet …" and "a single-node 409 not-newer renders its sentence …". Restore; `grep -c 'disabled={next === null}' src/screens/SettingsScreen.tsx` → `1`.
5. Roll back's own gate — change `              disabled={previous === null}` to `              disabled={false}`. Run the same file → RED: "enables Update iff the node has a pendingTag and Roll back iff previousVersion is a tag …" (row B's Roll back enabled) and "Roll back needs somewhere to go …" (rows B and `ahead` enabled). Restore; `grep -c 'disabled={previous === null}' src/screens/SettingsScreen.tsx` → `1`.
6. A refusal stops the sequence — in `sendMove`, change `      throw new MoveSendError(err, [...requested]);` to `      continue;`. Run `./node_modules/.bin/vitest run test/update-move-sheet.test.tsx test/settings-screen.test.tsx` → RED — every refusal case, since a swallowed refusal resolves `sendMove` and the sheet then closes on it (a node was requested) or says `MOVE_NOTHING_REQUESTED_TEXT` in place of the refusal (none was): the sheet's "a refusal on the first node leaves the second unsent" (two `rollbackUpdate` calls), "a refusal on the second names the node already requested …", "after a part-way rollback the sheet offers no second send …", "a single-node 409 not-newer renders the update table's own sentence …", "a single-node 409 halted names the halting node …" and "sendMove rejects with a MoveSendError …"; settings "a refusal on the first node leaves the second unsent …" and "a single-node 409 not-newer renders its sentence inside the sheet …". Restore; `grep -c 'throw new MoveSendError(err, \[...requested\]);' src/fleet/UpdateMoveSheet.tsx` → `1`.
7. The sheet stays open on a refusal (the `QuickConfirm` defect) — in the rejection arm, after `        setError(moveErrorText(err, plan));` add the line `        onClose();`. Run `./node_modules/.bin/vitest run test/update-move-sheet.test.tsx test/settings-screen.test.tsx` → RED: every refusal case that asserts `onClose` not called, and settings' two refusal cases (the sheet unmounts, the alert with it). Restore; `grep -c '        onClose();' src/fleet/UpdateMoveSheet.tsx` → `1` (the success arm's).
8. A macOS node is never offered a move — in `planMove`, change `all.filter((n) => n.os !== 'darwin' && takesForward(n, tag))` to `all.filter((n) => takesForward(n, tag))`. Run `./node_modules/.bin/vitest run test/move-plan.test.ts` → RED: "a fleet update names only nodes the tag takes FORWARD …" (`mac` listed). Restore; `grep -c "n.os !== 'darwin' && takesForward(n, tag)" src/fleet/movePlan.ts` → `1`.
9. Unmeasured is not unversioned — in `takesForward`, change `  return n.stampRead === 'ok';` to `  return true;`. Run the same file → RED: the same case (`unread` listed). Restore; `grep -c "  return n.stampRead === 'ok';" src/fleet/movePlan.ts` → `1`.
10. Semver, never string order — in `takesForward`, change `  if (v !== null) return isNewerTag(tag, v);` to `  if (v !== null) return tag > v;`. Run the same file → RED: "compares by semver, never string order …" and every case that updates to `v0.0.10` over a `v0.0.9` node (`'v0.0.10' > 'v0.0.9'` is false as strings) — "names the fleet-role node before the server-role node …", "is compareDispatchOrder …", "a fleet update names only nodes the tag takes FORWARD …", "a fleet update is ONE apply {all: true, tag} …" and "lines: numbered in plan order …". Restore; `grep -c '  if (v !== null) return isNewerTag(tag, v);' src/fleet/movePlan.ts` → `1`.
10b. The floor (D-3403) — in `takesForward`, delete the line `  if (isReleaseTag(n.highestVersion) && !isNewerTag(tag, n.highestVersion)) return false;`. Run `./node_modules/.bin/vitest run test/move-plan.test.ts` → RED: "a fleet update never names a node the tag leaves at or below its FLOOR …" (`back` and `floored` listed; added in review, unmeasured — confirm it reds this case alone). Restore; `grep -c '  if (isReleaseTag(n.highestVersion) && !isNewerTag(tag, n.highestVersion)) return false;' src/fleet/movePlan.ts` → `1`.
11. The screen's re-poll reaches the banner — in `src/screens/FleetScreen.tsx`, change `<UpdateBanner updates={updates.view} onMoved={updates.reload} />` to `<UpdateBanner updates={updates.view} />`. Run `./node_modules/.bin/vitest run test/fleet-screen.test.tsx` → RED: "opens the move sheet naming the fleet node first … and re-polls the screen" (`expected "spy" to be called 2 times, but got 1 times`). Restore; `grep -c 'onMoved={updates.reload}' src/screens/FleetScreen.tsx` → `1`.
12. One sheet, never `QuickConfirm` (D-3389) — add the line `import { QuickConfirm } from '../components/QuickConfirm';` after `UpdateBanner.tsx`'s `import { navigate } from '../lib/router';`. Run `./node_modules/.bin/vitest run test/update-move-sheet.test.tsx -t 'import no QuickConfirm'` → RED. Delete the line; `grep -c 'components/QuickConfirm' src/fleet/UpdateBanner.tsx` → `0`.
13. The generation idiom — in `UpdateMoveSheet`'s effect, change `    return () => { gen.current += 1; };` to `    return () => {};`. Run `./node_modules/.bin/vitest run test/update-move-sheet.test.tsx` → RED: "a late answer for a plan the sheet no longer shows is dropped …" (`onDone` called once). Restore; `grep -c 'return () => { gen.current += 1; };' src/fleet/UpdateMoveSheet.tsx` → `1`.
14. The retired sentence stays retired — append `export const MOVE_DISABLED_TEXT = 'lands with the next release (W4)';` as the last line of `src/lib/api.ts`. Run `./node_modules/.bin/vitest run test/api.test.ts` → RED: "no file under pwa/src spells the retired disabled-control sentence …" (`expected [ 'lib/api.ts' ] to deeply equal []`). Delete the line; `grep -c MOVE_DISABLED_TEXT src/lib/api.ts` → `0`.
15. The registry is kept exact (the control for Step 13's deletion) — re-insert the four-line `'fleet.css .settings-move-note': { … },` entry quoted in Step 13 before `INHERITED_GROUNDS`' closing `};` in `design/audit.mjs`. Run `./node_modules/.bin/vitest run test/contrast.test.ts` → RED: "has no stale inherited registry entry" (the entry names a rule `fleet.css` no longer has). Delete it again; `grep -c "'fleet.css .settings-move-note'" design/audit.mjs` → `0`.

16. Spec §12's per-node refusals reach the operator, in the sheet — in `UpdateMoveSheet`'s success arm change `        const short = moveSkippedText(answers, plan) ?? (!unread && requested.length === 0 ? MOVE_NOTHING_REQUESTED_TEXT : null);` to `        const short: string | null = null;`. Run `./node_modules/.bin/vitest run test/update-move-sheet.test.tsx` → RED: "a 202 that skipped a node the sheet NAMED says so IN the sheet …", "a 202 that requested NOTHING …" and "a readable 202 that requested nothing and skipped no node the sheet listed …" (each closes: `onClose` called, no alert). Restore; `grep -c 'const short = moveSkippedText(answers, plan) ??' src/fleet/UpdateMoveSheet.tsx` → `1`.
17. Only the nodes the sheet named are said — in `moveSkippedText`, change ``      if (label !== undefined) said.push(`${label}: ${moveSkipText(s.why)}`);`` to ``      said.push(`${label ?? s.nodeId}: ${moveSkipText(s.why)}`);``. Run the same file → RED: "a 202 that skipped a node the sheet NAMED says so IN the sheet …" (the alert's text gains `56565656-…: That node already runs that release …`) and "a skip of a node the sheet never listed … closes and says nothing" (its unlisted skip is now said, so the sheet stays open). Restore; `grep -c 'if (label !== undefined) said.push' src/fleet/UpdateMoveSheet.tsx` → `1`.

18. Nothing requested is not a success — in the same line change ` ?? (!unread && requested.length === 0 ? MOVE_NOTHING_REQUESTED_TEXT : null);` to ` ?? null;`. Run `./node_modules/.bin/vitest run test/update-move-sheet.test.tsx` → RED: "a readable 202 that requested nothing and skipped no node the sheet listed …" (the sheet closes). Restore; `grep -c 'MOVE_NOTHING_REQUESTED_TEXT : null);' src/fleet/UpdateMoveSheet.tsx` → `1`.
19. No second send after a part-way refusal — delete the rejection arm's line `          setAnswered(true);` (the one inside `if (err instanceof MoveSendError && err.requested.length > 0) {`). Run `./node_modules/.bin/vitest run test/update-move-sheet.test.tsx` → RED: "after a part-way rollback the sheet offers no second send …" (the `Roll back to v0.0.8` confirm is back, and the ghost button reads `Cancel`). Restore; `grep -c 'setAnswered(true);' src/fleet/UpdateMoveSheet.tsx` → `2`.
20. Roll back needs somewhere to go — in `NodeItem`, change `  const previous = isReleaseTag(n.previousVersion) && (v === null || isNewerTag(v, n.previousVersion)) ? n.previousVersion : null;` to `  const previous = isReleaseTag(n.previousVersion) ? n.previousVersion : null;`. Run `./node_modules/.bin/vitest run test/settings-screen.test.tsx` → RED: "Roll back needs somewhere to go …" (rows B and `ahead` enabled). Restore; `grep -c '(v === null || isNewerTag(v, n.previousVersion))' src/screens/SettingsScreen.tsx` → `1`.
21. The row says the dispatcher's word — in `NodeItem`, delete the line `      {typeof n.update?.detail === 'string' && n.update.detail !== '' && <p className="settings-node-detail">{n.update.detail}</p>}`. Run `./node_modules/.bin/vitest run test/settings-screen.test.tsx` → RED: "renders the dispatcher's own word for the row …". Restore; `grep -c 'n.update.detail}</p>}' src/screens/SettingsScreen.tsx` → `1`.
22. A halt names its blocker — in `haltedBy`, change `  return detail.split(', ').map((id) => moveLabel(plan, id));` to `  return [];`. Run `./node_modules/.bin/vitest run test/update-move-sheet.test.tsx` → RED: "a single-node 409 halted names the halting node …". Restore; `grep -c "return detail.split(', ').map((id) => moveLabel(plan, id));" src/fleet/UpdateMoveSheet.tsx` → `1`.
23. The empty sentence says what was measured — in `moveEmptyText`, change ``    ? `Nothing to move — ${target} takes no managed node forward.` `` to `    ? 'Nothing to move — every node is already there.'`. Run `./node_modules/.bin/vitest run test/move-plan.test.ts test/update-move-sheet.test.tsx` → RED: "moveEmptyText — … names the direction and the target …" and the sheet's "an empty plan says so and offers no confirm …". Restore; `grep -c 'takes no managed node forward' src/fleet/movePlan.ts` → `1`.

After the last restore, Step 14's first two `pwa` commands are green again with the same counts, `npm run build` is clean, and `git status --short` lists exactly this task's fourteen paths — two `??` sources, two `??` tests, ten ` M`.

- [ ] **Step 16: Commit**

```bash
git add pwa/src/fleet/movePlan.ts pwa/src/fleet/UpdateMoveSheet.tsx pwa/src/lib/api.ts pwa/src/screens/SettingsScreen.tsx pwa/src/fleet/UpdateBanner.tsx pwa/src/screens/FleetScreen.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/move-plan.test.ts pwa/test/update-move-sheet.test.tsx pwa/test/api.test.ts pwa/test/settings-screen.test.tsx pwa/test/update-banner.test.tsx pwa/test/fleet-screen.test.tsx
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts && cd ..
git commit -m "feat(update): the five move controls go live — one UpdateMoveSheet naming the nodes in dispatch order, apply {tag} / rollback {to} by direction, applyUpdate/rollbackUpdate on the client, the W3 disabled sentence retired"
```

(`topology-clean.test.ts` reads `git ls-files` — the index — so it runs AFTER `git add`, when the two new sources and two new tests are tracked; a red there is residue in a new file: fix it, re-add, re-run, then commit.)

### Task 9: Docs, the gate, the PR

**Files:**
- Modify: `README.md` — the Releases section's "**Control plane (update-management W2).**" paragraph (W2 Task 15, as wave 3 Task 13 and wave 4 Task 16 left it): its "Not yet" tail is replaced line-for-line, located BY CONTENT with a line-count assertion (both producers rewrote the same three lines, so the merged words are whichever the second merge resolved — no quoted `old` can be trusted there), and one new paragraph, "**Moving a node from the console (update-management W4, server side).**", inserted after wave 3's "**Settings, the update banner and release pushes (update-management W3).**" paragraph and its blank line: the one-tap (`apply`/`rollback`, the request as a row), the dispatcher's order (fleet-role before server-role, one at a time), the halt (`failed`/`reverted` until `ack`; a provenance verdict does not halt), the deadline (`CCRC_UPDATE_DEADLINE_MS`), and `ack`. The new text carries no `file:line` or `:<digits>` token (the session-hook audit's `REF_RE`, `session-hook.test.ts:7080` at `d759c914`); no lane numeral changes (D-3388)
- *Correction — four more README places this wave falsifies, each edited here (all line-neutral but the last):* (a) W2's opener "nothing in it moves a node yet" (W2 Task 15 Step 1's first two lines — neither wave 3 nor wave 4 touches them); (b) wave 3's Settings paragraph "Every control that would move a node — Install, Roll back, Update, Update all — is shown disabled until the next release" (wave 3 Task 13 Step 2 (b); Task 8 enables them); (c) wave 4's "Update and rollout" opener "— per box, explicit, never automatic." (wave 4 Task 16 Step 2's first replacement; an `auto` intent now runs the verb unattended, Tasks 5 and 7); (d) the agent's narrow-surface list in "Remote fleet mode" (`README.md:1520-1521` at `d759c914`, the `- **pty**:` bullet, "only ever spawns `tmux attach -t cc-<sessionId>`") gains one `- **Update op**:` bullet after it — the agent now spawns a second fixed template (Task 2), and a list headed "deliberately narrow" that omits it under-claims the surface (+4 lines)
- Modify: `CLAUDE.md` — the Deploy bullet gains ONE sentence after W2's `GET /api/updates` sentence (W2 Task 15 Step 2's inserted line, quoted: ``  `/api/fleet/health`'s `builds` is a view of it. A``): the PWA's one tap ends in the same `ccrc update --to <tag>` on the node (`--detach --from pwa`), the fleet node over the agent's `update` op and the server node spawned locally, and `ccrc rollout` stays the path when the console is down; the README size claim (`CLAUDE.md:10`) re-measured by `echo $(( ($(wc -l < README.md) + 50) / 100 * 100 ))` and set only if it moves. The box-token bullet is Task 6's and is not edited here
- Guard files READ by this task's edits, run and none edited (Step 5): every suite that reads `README.md` or `CLAUDE.md` whole or by passage — wave 4 Task 16's measured census (`git grep -nE "README\.md'|'CLAUDE\.md'" -- server/test agent/test pwa/test`, less the fixtures that only write a file of that name): `pools-prose`, `oss-metadata`, `session-hook`, `box-token-census`, `coord-pause-route`, `crossrepo-prose`, `readme-holds`, `readme-roster-mirror`, `ccrc-update`, `ccrc-install-graphify`, `coordinator-skill`, `worker-skill`, `reviewer-skill`, `license`, `ledger-instruction`, `mail-hardening`, `topology-clean` *(correction: the skeleton's Run line named seven of these; a guard list that omits a reader of an edited file is not the census it claims to be)*
- NOT edited by this task: `docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md` — ruling R12: the coordinator replaces every «dev:…» placeholder, in prose AND inside code-block comments, with an allocator-issued number in one pass before dispatch; Step 6 only verifies it happened and never types a number
- Run: the whole server suite, sharded, foreground: `cd server && ./node_modules/.bin/vitest run --shard=<i>/4` for `i` in 1..4 (the known load flakes re-run in isolation before a red is called real), then `./node_modules/.bin/tsc --noEmit`; `cd agent && npm ci && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit`; `cd pwa && npm ci && npm run build && ./node_modules/.bin/vitest run`; `cd pwa && node design/contrast-check.mjs` and its `--uncovered` census; `server/test/session-hook.test.ts`, `server/test/pools-prose.test.ts`, `server/test/oss-metadata.test.ts`, `server/test/box-token-census.test.ts`, `server/test/topology-clean.test.ts`, `server/test/dtbd.test.ts`, `server/test/deviation-refs.test.ts` (after `git fetch origin main`) individually after the doc edits *(correction: the skeleton ran `npm run build` in `agent/`, which is plain `tsc` and EMITS `agent/dist`; the gate is CI's own `Typecheck` step, `tsc --noEmit`, `.github/workflows/ci.yml:127` at `d759c914`, run in all three packages — the skeleton had no server typecheck, and `server/tsconfig.json` includes `src` and `../shared` only, so it is the one check that sees a type error in Tasks 1–6's `server/src` and `shared/` edits under the server's settings)*
- PR: `gh pr create` from the workspace branch; the body ends with the session's attribution line, lists every departure by the number the coordinator's pass gave it (*correction: the skeleton said "every «dev:<slug>»"; by R12 no placeholder survives to this task — Step 6 STOPS on one*), and names the live exit criterion as the coordinator's

**Interfaces:**
- Consumes: every task above; W2 Task 15's, wave 3 Task 13's and wave 4 Task 16's README paragraphs (quoted by their bold openers, never by line — README is producer-changed); `pools-prose.test.ts:868-883`'s 100-line ratchet and `oss-metadata.test.ts:89-100`'s 10% check on CLAUDE.md's `~N lines` claim (both at `d759c914`); the box-token bullet as Task 6 leaves it.
- Produces: README prose (one paragraph, one agent bullet, four line-neutral corrections), one CLAUDE.md sentence, the PR. The exit criterion (spec §15 row W4, server half) — "one tap moves the live fleet node then the server node and the inventory shows both" — is the COORDINATOR's at rollout (Step 12), not this task's: the wave-done reports the suites, the PR and the fixture proofs, and the rollout reads `GET /api/updates` after one Update all.
- The facts the new prose states are the tasks', each re-checked against the task that ships it — reword one and the claim must still match: the five controls and one sheet, fleet first — Install / Roll back on a release row and Update / Roll back on an inventory row on `/settings`, Update all on the FLEET screen's banner only (Task 8, `planMove` + `compareDispatchOrder`, D-3389); `apply {nodeId}|{all: true}, tag?` defaulting to `desiredTag`, `rollback {nodeId, to?}` defaulting to `previousVersion`, both session-only, the single-node `409` words — `not-newer`, `stamp-unread` (D-3379), `floor-unread` (a floor never measured, D-3492), `halted`, `busy` as the node's OWN lease (D-3386), the capability words, `agent-predates-update-op`, `unknown-tag`, `refused-by-node`, `no-previous`, `no-desired` — `{all: true}` always `202` with `requested`/`skipped`, a node the dispatcher would refuse skipped with its word (Task 6, D-3385, D-3401, D-3387); the request as a row and the three triggers on a `server`/`both` box (Tasks 3, 5, 6); one busy lease fleet-wide, fleet-role first, the server waiting on an outstanding fleet request (Tasks 3, 4, D-3381); the op sent only to an advertising agent, `agent-predates-update-op` otherwise (Tasks 2, 4); the agent's `busy` from `update.json`, the two absolute argvs, `accepted` after the detach parent exits 0 (Task 2, D-3371, D-3372); the server node spawned the same way, behind the same `update.json` busy read first, in `converge.ts` (Task 5; the spawn itself is `localUpdateSpawnFor`, D-3384); `accepted` holds, the row reads `pending`, a met request settles without a move (Task 5, D-3382, D-3380); a refusal releases in the same turn and never consumes the request — `busy` and a transport failure to `idle`, `spawn-failed`, `bad-tag`/`bad-kind` and a `bad-request` from an advertising agent to `failed` (Task 5's `classifyOpAnswer`) — and a capability refusal takes no lease and is noted on an idle row (Tasks 3, 5, D-3375); the halt until `ack`, `ackNode` clearing request and refusals (W2 Task 5, Task 4's `isHalting`); the provenance row keeping `failed` and its detail and staying eligible (Task 4, D-3378); `failed: deadline` from the later of `updateStartedAt`/`reportedUpdatedAt`, default 15 minutes, halting (Tasks 4, 5; W2 Task 9's `cfg.updateDeadlineMs`, whose default is `DEFAULT_UPDATE_DEADLINE_MS = 15 * 60_000`); `auto` moving a node with no request only where `autoPermits(auto, channel)` holds — `stable` for a node resolved to stable, `channel` for any — and its dispatch-time `update-gate` check (Task 4, Task 7); a macOS node with no `detach` cap (spec §10 "`--detach` refuses on Darwin … and the `detach` capability is not written there"; D-3308's no-controls Darwin row).
- Spec §18 rows pinned: none new; the task's gate is the whole mutation table this wave shipped, re-run on the merged tree (Step 7), plus one control that the size ratchet reads this task's claim (Step 8).

- [ ] **Step 1: Precondition — the three producers are on `main`, and this branch is on top of it**

```bash
git status --porcelain
git fetch origin main
git grep -c 'Control plane (update-management W2)' origin/main -- README.md
git grep -c 'Settings, the update banner and release pushes (update-management W3)' origin/main -- README.md
git grep -c 'One update at a time, reported, gated, and undone' origin/main -- README.md
git merge-base --is-ancestor origin/main HEAD && echo up-to-date || echo behind
```
Expected: no `git status` output (Tasks 1–8 committed), then `origin/main:README.md:1` three times, then `up-to-date`. A `0` on any grep means that producer has not merged — STOP and report to the coordinator (this task's text states their facts). `behind` means `main` moved while this wave ran: `git merge --no-edit origin/main` (never a rebase — the workspace branch is bound to its PR by its tip), resolve keeping both sides' hunks, and re-run Step 7 on the merged tree before this task goes on; a merge is a tree nobody ran until it is green.

- [ ] **Step 2: The red — a claims check over the prose this wave falsifies and owes**

`$SCRATCH` is the session scratchpad directory. Write this check there (it is the task's instrument, not a committed test — a prose pin against prose is green while both lie; the committed guards are Step 5's):

```bash
cat > "$SCRATCH/w5-doc-claims.sh" <<'SH'
#!/usr/bin/env bash
# Wave 5 Task 9: README/CLAUDE.md sentences this wave makes false must be gone; the ones it owes must be present.
# Both files are hard-wrapped prose, so each is FLATTENED first and a phrase spanning a line break is still found.
cd "$(git rev-parse --show-toplevel)" || exit 2
flat() { tr '\n' ' ' < "$1" | tr -s ' '; }
R="$(flat README.md)"; C="$(flat CLAUDE.md)"
rc=0
for gone in 'nothing in it moves a node yet' 'no apply or rollback route' \
            'is shown disabled until the next release' 'per box, explicit, never automatic.'; do
  case "$R" in *"$gone"*) echo "STILL PRESENT (README): $gone"; rc=1 ;; esac
done
for owed in '**Moving a node from the console (update-management W4, server side).**' \
            'row **halts** every further move until **Ack** (`POST /api/updates/ack`)' \
            '- **Update op**: `update` only ever spawns' 'unattended only under `auto` (below)' \
            'what moves a node is the one-tap, below.' 'opens one confirm sheet (below).'; do
  case "$R" in *"$owed"*) ;; *) echo "MISSING (README): $owed"; rc=1 ;; esac
done
for owed in "The PWA's one tap (\`POST /api/updates/apply\` or \`POST /api/updates/rollback\`)" \
            "the fleet node's through the agent's \`update\` op"; do
  case "$C" in *"$owed"*) ;; *) echo "MISSING (CLAUDE.md): $owed"; rc=1 ;; esac
done
[ "$rc" = 0 ] && echo "doc claims: ok"
exit "$rc"
SH
bash "$SCRATCH/w5-doc-claims.sh"; echo "exit $?"
```
Expected (RED): four `STILL PRESENT (README)` lines, six `MISSING (README)` lines, two `MISSING (CLAUDE.md)` lines, `exit 1`. Fewer `STILL PRESENT` lines means a producer merged other words than its committed plan says — read that paragraph, and in Step 3 edit the words that merged, keeping the line count; name it in the wave-done. (The two CLAUDE.md patterns use `\`` inside double quotes so the backticks are literal — an unescaped backtick in a double-quoted bash string executes.)

- [ ] **Step 3: README — the four line-neutral corrections, then the paragraph and the bullet**

From the repo root:

```bash
python3 - <<'PY'
import pathlib, sys
p = pathlib.Path('README.md')
t = p.read_text()

def once(old, new, what):
    """Replace exactly one occurrence, line-neutral unless told otherwise."""
    global t
    n = t.count(old)
    if n != 1:
        sys.exit(f'{what}: expected exactly one occurrence, found {n} -- read the merged text and make the same change by hand, keeping its line count')
    if old.count('\n') != new.count('\n'):
        sys.exit(f'{what}: the replacement is not line-neutral')
    t = t.replace(old, new)

def para_bounds(opener):
    s = t.find(opener)
    if s < 0 or t.count(opener) != 1:
        sys.exit(f'{opener}: expected exactly one paragraph opener')
    e = t.find('\n\n', s)
    return s, e          # t[s:e] is the paragraph, without its trailing newline

# (a) W2's opener: the server now moves nodes.
once("update state; nothing\nin it moves a node yet.",
     "update state; what moves\na node is the one-tap, below.",
     "W2 opener")

# (b) W2's tail, by content: from the line that begins "`/api/fleet/health`'s `builds` is" to the paragraph's end.
s, e = para_bounds('**Control plane (update-management W2).**')
k = t.find("\n`/api/fleet/health`'s `builds` is", s, e)
if k < 0:
    sys.exit("W2 tail: no line beginning `/api/fleet/health`'s `builds` is inside the W2 paragraph")
old_tail = t[k + 1:e]
print('W2 tail as merged:\n' + old_tail + '\n')
flat_tail = ' '.join(old_tail.split())      # hard-wrapped: a phrase may span a line break
if 'no apply or rollback route' not in flat_tail:
    sys.exit('W2 tail: it does not name "no apply or rollback route" -- nothing of this wave to remove; read it')
if 'fleet-side projection reader' in flat_tail:
    sys.exit('W2 tail: still names the fleet-side projection reader -- Step 1 proved wave 4 merged, so its edit to this sentence was lost when the second of wave 3 and wave 4 resolved these three lines; STOP and report it')
new_tail = ("`/api/fleet/health`'s `builds` is a view of the inventory rows, and the PWA no longer reads it. An `auto`\n"
            "other than `off` is refused (`409`) until every node the intent covers lists `update-gate` in its `ccrc-caps`\n"
            "(an install of the W4 node side writes it); the dispatcher checks the same word again at every auto move.")
if old_tail.count('\n') != new_tail.count('\n'):
    sys.exit(f'W2 tail: merged as {old_tail.count(chr(10)) + 1} lines, the replacement is 3 -- rewrap the replacement to that count by hand, same words')
t = t[:k + 1] + new_tail + t[e:]

# (c) Wave 3's Settings paragraph: the move controls are enabled (Task 8).
once("Update, Update\nall — is shown disabled until the next release.",
     "Update, Update\nall — opens one confirm sheet (below).",
     "W3 disabled sentence")

# (d) Wave 4's "Update and rollout" opener: an `auto` intent runs the verb unattended (Tasks 5, 7).
once("— per box, explicit, never automatic.",       # mid-line: the sentence runs on into `--check`'s
     "— per box, explicit; unattended only under `auto` (below).",
     "W4 never-automatic")

# The new paragraph, after wave 3's Settings paragraph and its blank line.
PARA = """**Moving a node from the console (update-management W4, server side).** Install and Roll back on a release, Update
and Roll back on a node, and Update all on the fleet screen's banner each open one confirm sheet that names the
nodes the move takes, fleet first, and sends `POST /api/updates/apply` (`{nodeId}` or `{all: true}`, with an
optional `tag` — without one, the node's desired tag) or `POST /api/updates/rollback` (`{nodeId}`, with an
optional `to` — without one, the node's previous version). Both are session-only: the box token never moves a node.
A single-node move the dispatcher would refuse answers `409` with its word in the same request (not newer, an unread
stamp or floor, halted, the node's own lease busy, a missing capability, an agent that predates the op, an unknown or
refused tag, no previous version, no desired tag); `{all: true}` always answers `202`, writing a request only for a
node the tag takes forward and the dispatcher could move, and naming every other live node as skipped, with its word.
What is written is a **request** on the node's row, never a command. On a `server` or `both` box the dispatcher
reads the rows after every inventory sweep, every intent write and every request write, and moves at most one node
at a time across the fleet: fleet-role nodes before server-role ones, and the server node waits while any fleet
node's request is outstanding. A fleet node is moved over the agent link by the `update` op, which only an agent
that advertises it in its ready frame is ever sent (an older agent's node is refused `agent-predates-update-op`
until that box is updated by hand). The agent answers `busy` while `~/.ccrc/update.json` reports a run in flight;
otherwise it runs `~/.local/bin/ccrc update --to <tag> --detach --from pwa`, or `rollback` in place of `update` —
two fixed argument lists with the tag the only word that varies, outside the exec whitelist — and answers
`accepted` once the detaching parent has exited 0. The server node is spawned the same way on its own box, after
the same `busy` check. `accepted` only holds the lease (the row reads `pending`): the node settles when a later
sweep measures it on the target, and a request for the tag a node already runs is settled without a move. A
refusal releases the lease in the same turn and never consumes the request — `busy`, a dropped link or a timeout
returns the row to `idle` for a later sweep, while a spawn that fails, a tag or kind the agent refuses, or a
`bad-request` from an agent that advertised the op fails it; a capability refusal takes no lease, is noted on the
row and waits. A `failed` or `reverted` row **halts** every further move until **Ack** (`POST /api/updates/ack`)
returns it to idle and clears its request and refusals; a `provenance:` verdict on a release does not halt (the row
keeps `failed` and that detail), and the node moves on to the next release eligible for it. A lease is failed
`deadline` once `CCRC_UPDATE_DEADLINE_MS` (default 15 minutes) has passed since the later of the dispatch and the
node's last report, and that halts too. With `auto` on (`stable` only for a node on the stable channel), the
dispatcher moves a node to its desired tag with no request, and refuses a node whose `ccrc-caps` lacks
`update-gate` at that moment, whatever the intent route admitted. A macOS node lists no `detach` capability
(`--detach` is Linux-only), so the console offers it no move and the dispatcher refuses one; `ccrc rollout` stays
the path when the console itself is down.
"""
s, e = para_bounds('**Settings, the update banner and release pushes (update-management W3).**')
t = t[:e + 2] + PARA + '\n' + t[e + 2:]

# The agent's narrow surface: the second fixed template (Task 2). An insertion (+4), not line-neutral.
PTY = ("- **pty**: `ptyOpen` only ever spawns `tmux attach -t cc-<sessionId>`, with\n"
       "  `sessionId` sanitized to `[A-Za-z0-9_-]+` — never an arbitrary command.\n")
BULLET = ("- **Update op**: `update` only ever spawns `~/.local/bin/ccrc update` or `rollback`, as\n"
          "  `--to <tag> --detach --from pwa`, with the tag checked by the one release-tag guard\n"
          "  first — never through the exec whitelist, never an arbitrary command. The agent\n"
          "  names it in its ready frame, and the server sends it to no agent that does not.\n")
if t.count(PTY) != 1:
    sys.exit('pty bullet: expected exactly one occurrence')
t = t.replace(PTY, PTY + BULLET)

p.write_text(t)
print('README written')
PY
```
Expected: the merged W2 tail printed — three lines, wave 3's rewrite (the PWA no longer reads `builds`; the settings and notification items gone) with wave 4's (the projection-reader item gone; the `update-gate` clause's parenthesis about the W4 node side), in whichever words their second merge resolved, still naming "no apply or rollback route" — then `README written`. The script writes only after every edit has succeeded, so any `sys.exit` leaves README untouched — and it reports intent, not the result: Step 4 measures the result. Any exit other than the two read-and-decide cases named in its messages is a merged text this plan did not foresee: apply the same change by hand, keeping each edit's line count, and say so in the wave-done.

Constraints this text was written to (re-check them if you reword it): no `:<digits>` token anywhere (`REF_RE`'s file part is OPTIONAL, `session-hook.test.ts:7080` at `d759c914`, so any `:N` in README is a citation it tries to resolve — `provenance:` and `session-only:` are followed by a backtick and a space); every line has an even number of backticks (no code span split across a line); none of the passage markers other suites slice README by (Step 4 counts them), because `passage()` takes the FIRST occurrence of its `from` marker and the Releases section sits above most of them; no hostname, org, account label or address (`topology-clean.test.ts`); the new bullet opens `- **` inside the agent list, where no passage ends on a `- **` marker (the only suite whose `to` marker is `'\n- **'` slices CLAUDE.md, `box-token-census.test.ts:411-412` at `d759c914`). The paragraph is 32 lines plus its blank; the bullet 4 — Step 4's size figure depends on it. *(Correction: an earlier draft put Update all "on the fleet screen's banner and on `/settings`" — wave 3 renders `UpdateBanner` on `FleetScreen` alone and Task 8 enables it there, so `/settings` carries four of the five controls; its 409 list omitted `stamp-unread` and `agent-predates-update-op` (and, before the unit was re-pointed onto W2's tip, had no `floor-unread`: "an unread stamp or floor" now covers both, reflowed inside the same four lines) and read "busy" as any lease, where Task 6's is the node's OWN; its `{all: true}` sentence omitted the refused-node skip; and it never said which op answers fail the row — Task 5's `classifyOpAnswer`. The paragraph grew from 29 lines to 32.)*

- [ ] **Step 4: CLAUDE.md — the one-tap sentence; re-measure the README size claim; the claims check green**

```bash
grep -cF "  \`/api/fleet/health\`'s \`builds\` is a view of it. A" CLAUDE.md
```
Expected: `1` (W2 Task 15 Step 2's line; wave 4 Task 16 Step 5 edits the Deploy bullet ABOVE it and the SAFETY section, and Task 6 edits the box-token bullet — none of them this line). Replace that line with these five:

```markdown
  `/api/fleet/health`'s `builds` is a view of it. The PWA's one tap (`POST /api/updates/apply` or
  `POST /api/updates/rollback`) ends in the same `ccrc update --to <tag>` or `ccrc rollback --to <tag>` on the
  node, run `--detach --from pwa` — the fleet node's through the agent's `update` op, the server node's spawned
  locally, one node at a time and fleet first, a `failed`/`reverted` row halting the rest until `ack` — and
  `ccrc rollout` stays the path when the console is down. A
```
No suite slices the Deploy bullet (the CLAUDE.md passages the suites read are the box-token bullet, the account-pools bullet, the void-writer sentence and the ledger bullet — `box-token-census.test.ts`, `pools-prose.test.ts`, `mail-hardening.test.ts`, `ledger-instruction.test.ts`); the text opens no `- **` bullet (the box-token passage's `to` marker), carries no capitalised count word (`coord-pause-route.test.ts`'s `CARD_RE`, `:406` at `d759c914`), names no roadmap state (CLAUDE.md's own rule: live build state is not tracked there), and every line has an even backtick count.

Then the README size claim, and the result of Steps 3–4:

```bash
wc -l < README.md
grep -o 'README.md` (~[0-9,]* lines)' CLAUDE.md
echo $(( ($(wc -l < README.md) + 50) / 100 * 100 ))
```
Expected, if the producers merged as their committed plans say: `3437` — `3279` at `d759c914`, plus W2's 22 (its Task 15 Step 3), wave 3's 19 (its Task 13 Step 3), wave 4's 80 (*correction: its Task 16 Step 5 says 79, but its Step 4 (b) replacement is eight lines for two, +6, not the "Seven lines for two (+5)" it states — measured by applying wave 4's committed replacement blocks to a copy of `d759c914`'s README after W2's and wave 3's: 3400*), and this task's 37 (Step 3's paragraph and blank, 33, and the bullet, 4; its four corrections are line-neutral) — against a claim of `~3400` (wave 4 set it), so the last number printed is `3400` and CLAUDE.md's `:10` is NOT edited. When the last number differs from the claim (README moved elsewhere on `main`), set `CLAUDE.md:10`'s figure to it — the figure's own precision is the nearest hundred, which `pools-prose.test.ts:868-883` (100 lines) and `oss-metadata.test.ts:89-100` (10%) always admit — and name the measurement in the wave-done. CLAUDE.md's own line count matters to neither.

```bash
git diff -U0 README.md CLAUDE.md | grep '^+[^+]' | grep -nE ':[0-9]'
git diff -U0 README.md CLAUDE.md | grep '^+[^+]' | awk '{ n = gsub(/`/, "`"); if (n % 2) print "SPLIT CODE SPAN: " $0 }'
for m in 'What is gated, and what is not:' 'Enrolling a passkey' '**Caps and pause.**' 'Pause is a' '**Run lifecycle**' \
         '**The mail bus and its token.**' '`/api/mail` (and its ack route)' 'Minting the token file matters' \
         'An account entry is' '`accounts.sh` is a pure projection' 'It compares the **projections**' \
         'The file holds one token' '### Placement honors the disabled marker' \
         '### Account pools: tagging a project to a set of accounts'; do
  printf '%s  %s -> %s\n' "$m" "$(git show HEAD:README.md | grep -cF -- "$m")" "$(grep -cF -- "$m" README.md)"
done
bash "$SCRATCH/w5-doc-claims.sh"; echo "exit $?"
```
Expected: the first two print nothing; every marker's count is unchanged (`a -> a`); then `doc claims: ok` and `exit 0` (GREEN).

- [ ] **Step 5: The prose guards, then commit the docs**

From inside `server/`, foreground, one file per call, timeout ≥ 600000 ms:

```bash
cd server
for t in pools-prose oss-metadata session-hook box-token-census coord-pause-route crossrepo-prose readme-holds \
         readme-roster-mirror ccrc-update ccrc-install-graphify coordinator-skill worker-skill reviewer-skill license \
         ledger-instruction mail-hardening topology-clean; do
  ./node_modules/.bin/vitest run "test/$t.test.ts" || { echo "RED: $t"; break; }
done
```
Expected: all green. Every one of these reads README or CLAUDE.md; none reads the Releases section or the Deploy bullet, so each is a control here, not a subject — except `pools-prose`/`oss-metadata` (the size claim Step 4 measured) and `session-hook` (README's own citation entry stays empty). `session-hook` is a known load flake (CLAUDE.md): a red there is re-run in isolation before it is read as this text's fault; a real red from it names a README citation, and the remedy is to drop the `:<digits>` token from the new text, never to add a README anchor. `box-token-census` stays green with no README lane word touched — the proof of D-3388. `topology-clean`'s history-range scan needs `origin/main` resolvable — Step 1 fetched it.

```bash
cd ..
git add README.md CLAUDE.md
git commit -m "docs(update): the one-tap in the Releases section — requests, the dispatcher's order, the halt, the deadline, ack; the agent's update op; CLAUDE.md names the one tap's path"
```

- [ ] **Step 6: The plan and the code carry minted numbers, not placeholders**

```bash
git fetch origin main
git grep -nE '«dev:[a-z0-9-]+»' -- docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md
git grep -nE '«dev:[a-z0-9-]+»' -- server/src server/test agent/src agent/test agent/CLAUDE.md pwa/src pwa/test pwa/design shared README.md CLAUDE.md
git grep -nE 'D-TBD-[a-z0-9]' -- docs/ server/ shared/ agent/ ccd/ pwa/ README.md CLAUDE.md
```
Expected: all three print nothing. The first two patterns need a real slug between the guillemets, so they match neither this step's own text nor an ellipsis form; the second covers the code comments Tasks 1–8 carried placeholders into (ruling R12: the coordinator's one pass replaces them in the plan, so the transcribed code carries the numbers); the third is `dtbd.test.ts`'s `PATTERN` (`:18` at `d759c914`), which its own `[` keeps from matching itself. If a placeholder remains, the coordinator has not minted that departure: STOP and put it to the coordinator as a structured ask (worker skill) naming the slug and its file — never allocate or type a `D-` number here (`POST /api/ledger/deviations` issues numbers; a number written without being issued seals its band for good). A departure found DURING execution is defined in `## Deviations found` under a number the wave brief issued, in the same commit that first cites it; with none issued it is reported to the coordinator, never committed as a concrete placeholder.

Then, from inside `server/`:

```bash
./node_modules/.bin/vitest run test/deviation-refs.test.ts
./node_modules/.bin/vitest run test/dtbd.test.ts
./node_modules/.bin/vitest run test/topology-clean.test.ts
```
Expected: PASS. `deviation-refs` compares this branch's plan entries against `origin/main`'s without merging (`crossTreeCollisions`, `deviation-refs.test.ts:409` and `:459` at `d759c914`) — a red names a number defined in two plans, which is the coordinator's to re-mint, not this task's to edit.

- [ ] **Step 7: The gate — every suite and every typecheck, the wave's mutation table re-run on the merged tree**

CI's server leg installs `agent/` and `pwa/` modules too, because `typecheck-tests.test.ts` spawns their compilers (`.github/workflows/ci.yml:100-119` at `d759c914`); a workspace with only `server/node_modules` fails that one file rather than skipping it. So first:

```bash
test -d agent/node_modules || (cd agent && npm ci)
test -d pwa/node_modules || (cd pwa && npm ci)
```

Then each in the FOREGROUND with the tool's maximum timeout (600000 ms), one command per call, every log kept in `$SCRATCH` so the PR body quotes the run and never a retyped count:

```bash
cd server && ./node_modules/.bin/vitest run --shard=1/4 2>&1 | tee "$SCRATCH/w5-server-1.log"; echo "exit ${PIPESTATUS[0]}"
cd server && ./node_modules/.bin/vitest run --shard=2/4 2>&1 | tee "$SCRATCH/w5-server-2.log"; echo "exit ${PIPESTATUS[0]}"
cd server && ./node_modules/.bin/vitest run --shard=3/4 2>&1 | tee "$SCRATCH/w5-server-3.log"; echo "exit ${PIPESTATUS[0]}"
cd server && ./node_modules/.bin/vitest run --shard=4/4 2>&1 | tee "$SCRATCH/w5-server-4.log"; echo "exit ${PIPESTATUS[0]}"
cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
cd agent && ./node_modules/.bin/vitest run 2>&1 | tee "$SCRATCH/w5-agent.log"; echo "exit ${PIPESTATUS[0]}"
cd agent && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
cd pwa && npm run build; echo "exit $?"
cd pwa && ./node_modules/.bin/vitest run 2>&1 | tee "$SCRATCH/w5-pwa.log"; echo "exit ${PIPESTATUS[0]}"
```
Expected: every `exit 0`. `echo "exit ${PIPESTATUS[0]}"` reports vitest's status, not `tee`'s. `npm run build` in `pwa/` is `tsc --noEmit && vite build`; the other two packages are typechecked exactly as CI's `Typecheck` step does (`ci.yml:127` at `d759c914`). A red in a known load flake (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) is re-run in isolation (`./node_modules/.bin/vitest run test/<file>.test.ts`) before it is called a break; a red anywhere else is this wave's until shown otherwise. These runs ARE the wave's mutation table re-run on the merged tree: every §18 row Tasks 1–8 pinned is a case in one of them.

The counts, from the logs:

```bash
grep -hE '^ *(Test Files|Tests) ' "$SCRATCH"/w5-server-[1-4].log
grep -hE '^ *Tests ' "$SCRATCH"/w5-server-[1-4].log | sed -nE 's/.*\(([0-9]+)\)[[:space:]]*$/\1/p' | awk '{ s += $1 } END { print "server cases:", s }'
grep -hE '^ *(Test Files|Tests) ' "$SCRATCH/w5-agent.log" "$SCRATCH/w5-pwa.log"
gh run list -b main -w ci --limit 1
```
Compare the server, agent and pwa totals against that `main` run (`gh run view <id> --log | grep -E 'Test Files|Tests '`): the difference must be exactly this wave's new cases — a green that ran fewer cases than `main` is not the same green. If a sharded run is killed on this box, CI's unsharded leg is the arbiter; say so in the wave-done.

The contrast gate and its blind spot, from `pwa/`:

```bash
cd pwa && node design/contrast-check.mjs; echo "exit $?"
cd pwa && node design/contrast-check.mjs --uncovered | grep -E '^#   .*update-move'
```
Expected: `exit 0` with no FAIL row, and the grep prints nothing — every colour rule Task 8 appended (`.update-move-*`) is self-grounded or registered in `INHERITED_GROUNDS` (the anchored `^#   ` pattern reads only the census rows `--uncovered` prints after the report; an unanchored one would match the wave's own `PASS` rows and could never be empty).

The wave's literal claims, read off the tree (each is pinned by a task's test; this is the reviewer-facing reading, not a second mechanism):

```bash
BASE="$(git merge-base HEAD origin/main)"
git diff --stat "$BASE" HEAD -- agent/src/whitelist.ts ccd/ deploy/
git grep -nE 'MOVE_DISABLED_TEXT|lands with the next release \(W4\)' -- pwa/src
git grep -nE "'/api/updates/(apply|rollback)'" -- server/src/update/routes.ts pwa/src/lib/api.ts
git grep -n 'components/QuickConfirm' -- pwa/src/fleet/UpdateBanner.tsx pwa/src/screens/SettingsScreen.tsx
```
Expected: the first two print nothing (the exec whitelist, every bash file and every unit untouched — the out-of-scope line; no disabled literal left); the third prints the two registrations in `routes.ts` and the two client methods in `lib/api.ts` (Task 8's route-literal census in `pwa/test/api.test.ts` is what pins the second file's six literals); the fourth nothing (D-3389 — the pattern is Task 8's own import pin, `update-move-sheet.test.tsx`'s `not.toMatch(/components\/QuickConfirm/)`, so a comment that names the primitive is not read as an import).

- [ ] **Step 8: The control — the size ratchet reads the claim this task measured**

After Step 5's commit, from the repo root:

```bash
grep -c '(~[0-9]* lines)' CLAUDE.md
N="$(grep -oE '\(~[0-9]+ lines\)' CLAUDE.md | grep -oE '[0-9]+')"; echo "claim $N"
sed -i "s/(~$N lines)/(~$((N - 300)) lines)/" CLAUDE.md
(cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts); echo "exit $?"
sed -i "s/(~$((N - 300)) lines)/(~$N lines)/" CLAUDE.md
git diff --exit-code CLAUDE.md && echo restored
(cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts); echo "exit $?"
```
Expected: `1` (one size claim in the file); `claim 3400` (or Step 4's figure); the mutated run FAILS "keeps CLAUDE.md's README size claim within 100 lines of the real file" with `CLAUDE.md says <N-300> lines, README.md is <n> — re-measure it in this commit`, `exit 1`; `restored` (the file byte-equal to the commit — restored by the inverse edit, never by `git checkout --`); the last run green, `exit 0`. `oss-metadata`'s 10% check is not expected to red on a 300-line shift of a ~3400-line file (under 9%), so it is not this control.

- [ ] **Step 9: Push and open the PR**

Check the commit identity before the push (the pre-push hook refuses identity residue, and a workspace can carry a placeholder identity):

```bash
git log --format='%an <%ae>' origin/main..HEAD | sort -u
git config user.name; git config user.email
```
Expected: one author line, equal to the configured identity, and that identity the operator's intended one. If it is not, STOP and ask — rewriting authorship is not this task's call.

```bash
git push
REPO_URL="$(gh repo view --json url --jq .url)"
PLAN=docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md
SPEC=docs/superpowers/specs/2026-09-20-centralised-update-management-design.md
{
  echo "Programme wave 5 of the centralised update management design (the server half of the spec's W4): the agent's update op, the store's request and lease-acquire writers, the dispatcher, POST /api/updates/apply and /rollback, and the settings screen's and banner's move controls enabled behind one confirm sheet."
  echo
  echo "- Spec: $REPO_URL/blob/main/$SPEC (section 10 in full; section 9's dispatcher-side capability refusals and the auto enforcement; section 12's apply and rollback rows; section 13's move controls; the server half of the W4 row of section 15)"
  echo "- Plan: $REPO_URL/blob/main/$PLAN"
  echo
  echo "Tasks:"
  grep -E '^### Task [0-9]+:' "$PLAN" | sed 's/^### /- /'
  echo
  echo "Deviations defined in the plan:"
  grep -oE '^- \*\*D-[0-9]+\*\*[^.]*' "$PLAN" | sed 's/^- //'
  echo
  echo "Out of scope: every bash change (ccd/ccrc, its doctor checks, ccd/ccd, the units — wave 4 shipped the node side this wave only calls), versioned installs and ccrc versions (wave 6), dispatch groups and anything per-tenant, a writer for the applying state, the PWA bundle's own update. The exec whitelist is unchanged: the update op spawns two fixed argument lists outside it and never reaches it."
  echo
  echo "CLAUDE.md: the box-token bullet names the two new session-only doors (Task 6); the Deploy bullet names the one tap's path (Task 9)."
  echo
  echo "Test plan: server (four shards), agent and pwa suites and all three typechecks green locally; CI is the arbiter."
  grep -hE '^ *(Test Files|Tests) ' "$SCRATCH"/w5-server-[1-4].log | sed 's/^ */server: /'
  grep -hE '^ *(Test Files|Tests) ' "$SCRATCH/w5-agent.log" | sed 's/^ */agent: /'
  grep -hE '^ *(Test Files|Tests) ' "$SCRATCH/w5-pwa.log" | sed 's/^ */pwa: /'
  echo
  echo "Exit criterion (the coordinator's, after rollout): one tap moves the live fleet node, then the server node, and GET /api/updates shows both on the new tag."
} > "$SCRATCH/w5-pr-body.md"
grep -c '^- \*\*D-[0-9]' "$PLAN"
grep -c 'D-[0-9]' "$SCRATCH/w5-pr-body.md"
```
Expected: both counts non-zero and the first equal to the number of entries in the plan's `## Deviations found` — a `0` means the numbering pass has not happened, and Step 6 should already have stopped you. Read `$SCRATCH/w5-pr-body.md` once (the three `Test Files`/`Tests` groups are the logs' own lines). Append the session's attribution line (from the system reminder) as the body's last line, then:

```bash
gh pr create --base main \
  --title "feat(update): W4 server side — the update op, the dispatcher, apply and rollback, the move controls enabled" \
  --body-file "$SCRATCH/w5-pr-body.md"
```
The PR body carries `blob/main` links only — never a docserver link (it is tailnet-only and dies with the worktree).

- [ ] **Step 10: CI**

```bash
PR="$(gh pr view --json number --jq .number)"
gh pr checks "$PR" --watch --fail-fast
```
Run it in the foreground and re-issue it until it returns: exit `0` is all green, `1` a failure (read the failing leg's log first — `gh run view --log-failed`), `8` still pending (an answer, not an error). Never end the turn to wait for CI; a session that does is not woken by the result. The macOS leg runs the server suite again and can take up to half an hour — re-issue the watch; do not merge around it. A red that also reds on `main`'s latest `ci` run is `main`'s, not this PR's: name both runs in the wave-done.

- [ ] **Step 11: The wave-done**

When green, report the wave-done per the `ccrc-worker` skill: the measured fingerprint (`git rev-parse HEAD` equal to `git ls-remote origin "refs/heads/$(git branch --show-current)"`), the PR number, Step 7's counts (server total and per shard, agent, pwa) beside `main`'s, Step 4's README measurement, and the FIXTURE proofs that stand in for the live exit criterion, by test file:
- `agent/test/update-op.test.ts` (Task 2) — a real agent over a fixture HOME: the `; rm -rf ~` tag answers `bad-tag` with nothing spawned; the recorder sees exactly `[<home>/.local/bin/ccrc, ['update','--to','v0.0.9','--detach','--from','pwa']]` and the rollback twin; an in-flight `update.json` answers `busy`; the ready frame carries `ops: ['update']` (the live "the agent answers the op");
- `server/test/remote-connect.test.ts` (Task 2's edit) — the real agent's ready frame reaches `FleetState.agentOps` as `['update']` (the live "the server sends the op to this agent");
- `server/test/update-converge.test.ts` (Task 5) — two requested nodes: one op per run, the fleet node first, the server node dispatched on the run after the fleet node settles; `accepted` alone leaves the row `pending`; the server row spawned through `ConvergeDeps.runLocal` (`localUpdateSpawnFor`) with the exact absolute launcher and template and never over the link (`ConvergeDeps.fleet.send`, which `index.ts` wires from `Deps.sendUpdateOp`) (the live "the fleet node, then the server node");
- `server/test/update-apply-routes.test.ts` (Task 6) — after a `202` the node row is already `pending` when the reply is read; `{all: true, tag}` over a current and a behind node requests the behind one (the live "one tap");
- `server/test/update-auto-dispatch.test.ts` (Task 7) — a capless node under `auto` is refused `no-update-gate` at dispatch;
- `pwa/test/update-move-sheet.test.tsx`, `pwa/test/move-plan.test.ts`, `pwa/test/settings-screen.test.tsx`, `pwa/test/update-banner.test.tsx` (Task 8) — Install's and Update all's sheet names the fleet node before the server node whatever the wire order and sends `apply {all: true, tag}`; a `409` renders inside the sheet, which stays open (the live "the tap on the phone").

The worker does not merge: `main`'s ruleset wants an approval nobody can give, so the operator merges with `--admin`.

- [ ] **Step 12: The live exit criterion (the coordinator, after rollout)**

The merge cuts a PRERELEASE (the `dev` channel), so a bare `rollout` would not reach it. Take the tag the release lane put on the MERGE commit — not "the newest release", which is another PR's if anything merged after — and move the fleet onto it by hand, fleet box first (the server sends the op only to an agent whose ready frame advertises it, so the agent must be on this build before the server asks):

```bash
PR=<the wave-5 PR number>
git fetch origin main --tags
MERGE="$(gh pr view "$PR" --json mergeCommit --jq .mergeCommit.oid)"
W5_TAG="$(git tag --points-at "$MERGE" | grep -Ex 'v[0-9]+\.[0-9]+\.[0-9]+')"; echo "$W5_TAG"
gh release view "$W5_TAG" --json isPrerelease --jq .isPrerelease     # true: the dev channel
ccrc rollout --check
ccrc rollout --to "$W5_TAG"
```
Expected: exactly one tag; both boxes on `W5_TAG`, exit `0` (or `3` with the doctor's FAIL lines read — the box is on the build; `4` means a health gate restored a box: stop and read its `~/.ccrc/update.json`).

The one tap needs a release to move TO. On the phone: `/settings` → channel `dev` (a prerelease is desired only on `dev`), then wait for the NEXT merge to `main` — any PR — to publish its prerelease (`gh release list --limit 1` names a tag newer than `W5_TAG`; call it `NEXT`), and tap **Check now**; then open the fleet screen, where the banner lives (wave 3 renders `UpdateBanner` on `FleetScreen` only; `/settings` has no Update all). Expected: the banner reads `NEXT is out on dev — …`, and **Update all** is enabled. Tap it. Expected: the sheet is titled `Update NEXT`, lists `1. fleet (fleet) W5_TAG → NEXT` then `2. server (server) W5_TAG → NEXT`, and its confirm closes it.

On the server box, in the operator's own shell — the `ccrc_session` cookie value comes from a signed-in browser and is typed, never echoed, logged or pasted into a transcript:

```bash
ssh -t <server box>
read -rs CCRC_SESSION
for i in $(seq 1 80); do
  curl -fsS -b "ccrc_session=$CCRC_SESSION" http://127.0.0.1:7788/api/updates \
    | jq -c '[.nodes[] | {label, v: .current.version, state: .update.state, target: .update.target,
                          req: .request.tag, phase: .report.phase, detail: .update.detail}]' \
    || echo "no answer (the server is restarting under its own update)"
  sleep 15
done
```
Expected, in order (interrupt the loop once the last holds): the fleet row `pending`, target `NEXT`, `phase` walking `queued` … `done`, while the server row stays `idle` with `req: "NEXT"` (its `detail`, when the run that moved the fleet noted it, begins `waiting-for-fleet — `); then the fleet row `idle` on `v: "NEXT"` with `req: null`; then the server row `pending`, a few `no answer` lines while `ccrc.service` restarts under the detached run, and the server row `idle` on `v: "NEXT"` with `req: null`. Never two rows `pending` at once, and no row `failed` or `reverted`. That is the one tap moving the fleet node, then the server node. Then the provenance of the move:

```bash
jq -c '{phase, from, target}' ~/.ccrc/update.json
ssh <fleet box> "jq -c '{phase, from, target}' ~/.ccrc/update.json"
unset CCRC_SESSION
```
Expected: both `{"phase":"done","from":"pwa","target":"NEXT"}` — the console drove both runs (wave 4's `--from pwa`), not a CLI or a rollout. Restore the channel the operator wants on `/settings` (back to `stable` unless they keep `dev`). That set is spec §15's W4 exit criterion, server half, measured on the live fleet; record the outcome in the programme's memory file (`centralised-update-management-programme`: wave 5 SHIPPED, `W5_TAG`, `NEXT`, the deviations) — wave 6 (versioned installs) is next.

