# Box token lifecycle, wave 1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ccrc server mint, hold, hand out, rotate and check its own box token with no human after install, so that the first automatic rotation retires the value that leaked into transcripts.

**Architecture:** The server becomes the authority: it mints at boot, keeps the current value in `~/.ccrc/mail.token`, stages each new generation in its own 0600 file, and accepts a small constant-time set (current, up to two pending, previous) through the one `checkMailToken`. A driver on its own 60 s timer stages a generation, sends the new `token-sync` agent op carrying only a one-time code, and promotes the value only when the fleet box confirms it over the agent link; the fleet box's `ccrc token sync` trades the code for the value at `POST /api/token/claim`, writes the file atomically and proves it with one call. Part A ships the server, the agent op and the both-role writer; Part B ships the fleet verb, doctor (PASS or SKIP only), the console card and the deploy-side retirements, against Part A's merged interfaces.

**Tech Stack:** TypeScript (Node `>=22.16.0`, ESM, `"type":"module"` in every package), Fastify 5 with `@fastify/websocket`, `node:crypto` (`randomBytes`, `createHash`, `timingSafeEqual`), `node:fs/promises`, vitest; bash 3.2-compatible shell with `curl -K -` and `python3` on the fleet side; React (PWA) with vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-07-box-token-lifecycle-design.html` (approved 2026-10-07, revision 5).

Provenance: the programme ledger is `docs/superpowers/programs/box-token-lifecycle.md`. Part A is run 320 (the ledger's row 1); Part B is the ledger's row 2, a run opened before run 320 closes. The deviation block issued at run-open is 4388 to 4417, shared by both parts. This contract was drafted on 2026-10-07 by a workflow from `main` at 282e79e44 (plus docs only). Rows marked (prototype) were run against the real files or the server package's own installed modules before they were written here.

## Global Constraints

- Node floor `>=22.16.0`, identical in `server/`, `agent/`, `pwa/` `package.json` `engines`; never lower it (`server/test/node-floor.test.ts`).
- Rings by IMPORTS, not path: L0 `shared/*.ts` imports nothing but other `shared/*.ts` (never `node:*`, the PWA bundles it); L1 `server/src/token/policy.ts` imports only L0 and decides; L2 `server/src/token/ports.ts` holds interfaces declared by their consumer; L3 adapters (`files.ts`, `link.ts`, `boot.ts`, `door.ts`, `coord/token.ts`) may use `node:fs`/`node:crypto` and never narrow a distinction they received; L4 (`driver.ts`, `token/routes.ts`) owns timers, Fastify and replies and decides nothing; L5 is `server/src/index.ts` only.
- No overloaded null at a seam: absent, unusable, placeholder and unreadable are four outcomes of a value-file read; absent, unreadable and an id are three outcomes of a generation read; `unmeasured` transport is never folded into `https`; `proof-unmeasured` is never folded into `proof-failed`.
- Server log lines are `console.warn('ccrc-server: box token: …')`; never `req.log` (the server runs `Fastify({ logger: false })`).
- Census pins move in the same change as the route they count: the 27 box-token lanes stay 27; `UNGATED`, `SESSION_ONLY` and `UPDATE_DOORS` are unchanged; `CODE_DOORS = ['/api/token/claim']` and `TOKEN_DOORS = ['/api/token/rotate']` are new and checked in both directions; the EXEMPT reasons become seven; `gate.ts`'s "stands in front of all 86 routes" becomes 88; `auth-gate.test.ts` gains `scanRoutes('token/routes.ts')` with an exact count of 2.
- Wire is additive-only: no `FLEET_PROTO` or `FLEET_PROTO_MIN` change; one reader per new field (`readReadyOps` for the `token-sync` ready word, `readTokenTransport` for `transport`, `readGenerationFile` for the generation file, `readBoxTokenView` in the PWA for `UpdatesView.boxToken`); an older peer's absence grants nothing.
- Tests use FIXTURE HOMEs only (`mkTmp` from `server/test/tmpHelpers.ts`, `makeCcdHarness` from `server/test/ccdWsHelpers.ts` where ccd is involved); never run `ccd`, `ccrc` or the server against the live `$HOME`; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; a test's `curl` is either the recording stub on a fixture `PATH`, or the real curl behind `loopbackCurlFront` (`ccrcContainedEnv(…, { curl: 'loopback' })`, `server/test/containedTools.ts`), which reaches only `127.0.0.1` ports listed in the fixture HOME's `curl-allow-ports`; never an uncontained real curl.
- Never print a token value, a claim code, or the sha256 of either: not in logs, argv, environment, op results, `token-sync.json`, doctor lines, the console, census files or test output. Tests that prove this build their search patterns from pieces at runtime.
- A token or code reaches `curl` only on stdin through `-K -` (`printf 'header = "x-ccrc-mail-token: %s"\n'` or a `data` line); never `-H` with a value, never argv, never environ.
- Every new or edited shell file that handles a token starts with `set +x` as its first statement, then `umask 077`.
- macOS portability in every shell edit: no bare `timeout`, no `stat -c`, no `mv -T`, no `mktemp` without a template, no GNU `date` (`server/test/macos-platform.test.ts` scans every shebanged file under `ccd/`).
- Single definition: the op word, the error words, the exit-code table, the argv template, the claim path, the code shape, the op bounds, the generation-id shape and the fleet file's fixed comment line are declared once in L0; the shell spellings in `ccd/ccrc-token-sync` and `ccd/ccrc-doctor-checks` are pinned to them by a text-scan test.
- Run one test file per call, in the FOREGROUND, timeout at most 600000 ms, never bare `npx vitest`, never a whole suite on this box. The one form, from the repo root: `mkdir -p .tmp-<task> && (cd <server|agent|pwa> && TMPDIR="$PWD/../.tmp-<task>" ./node_modules/.bin/vitest run test/<file>)`, where `<task>` is the task id in lower case (`.tmp-a1` … `.tmp-b7`). Every line of a fenced command block is its own call; nothing in a block depends on an earlier line's `cd`. Each task's commit step ends with `rm -rf .tmp-<task>`, run from the repo root. A bare `vitest run test/<file>` or a bare file name in prose means this form.
- TDD red first: every guard ships with a test that is run RED before the guard exists and GREEN after; mutation-table discipline: for each guard, the step that adds it names the one-line deletion or mutation that turns its test red, and the worker measures that before and after.
- One commit per task, on the workspace branch the brief names (never a separate feature branch); the commit is made in its own call after a green, foreground read of the task's test files.
- The repo is public: no hostnames, IPs, real home paths, account or pool names, emails or docserver URLs in code, tests, comments or commit messages; fixtures use `pool-a`/`pool-b` and `<home>`.
- Deviation numbers: only the numbers this contract assigns (D-4388 to D-4397) and the coordinator's D-4398 and D-4399 are defined by the plan. Numbers are issued, never looked up: a worker (or a subagent) that needs another writes `D-TBD-<slug>` in `## Deviations found` and reports it; the coordinator assigns a number from 4400 to 4417 and defines it in the same act. The plan carries no pending deviation now (the coordinator numbered the last two, D-4398 and D-4399). A concrete `D-TBD-` placeholder with a real slug never lands (`dtbd.test.ts`): a worker reports it and the coordinator numbers it. Before every commit that adds or defines a `D-` number: `git fetch origin main`, then `(cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts)` and `test/dtbd.test.ts`, one call each.

## Review Focus

1. A lost op result after the fleet box already wrote the new file (the 50 s op timeout fires while the verb finished, or the link drops between the child's exit and the result frame, or the server restarts between the claim's 200 and the promotion). Expected: the handed-out generation stays accepted and is never promoted on an HTTP presentation; a generation read whose id equals the issued id and whose `measuredAt` is later than `handedOutAt` confirms and promotes it; with no such read, past `confirmBy` a forward rotation runs and its confirmation discards the older value; the fleet sees no 401 at any point; the hand-out is persisted before the 200 (D-4394). Pinning tests: Task A6 (`token-policy.test.ts`, "promotion only on fleet confirmation", "handed-out deadline without a fleet 401"), Task A7 (`token-boot.test.ts`, "a restart after the hand-out keeps the handed-out value accepted, its deadline unchanged, and confirms it by a later generation read") and Task A9 (`token-rotation-e2e.test.ts`, "lost result").
2. A single box whose role is DERIVED `both` (no `CCRC_ROLE` recorded: a `deploy.sh`-placed box, or any dev launch with `CCRC_FLEET` unset) after Part A removes `/api/notify`'s tolerance. Expected: the both-role writer never writes `~/.cc-secrets/ccrc-mail.token` (a planted fleet file is byte-identical after boot, and so is one on a recorded `both` box whose `~/.ccrc/agent.env` carries a `CCRC_AGENT_TOKEN` key, the mark of a fleet box; D-4399); when that box has no fleet file, boot warns once, naming the fleet path and that the role is unrecorded, because its `notify.sh` will now be refused; the rotation gate holds with `role-unrecorded`. A recorded `both` box with no fleet file gets one at boot and its `notify.sh` is accepted, also when it carries the README's single-box `agent.env` (`CCRC_SERVER_URL` only). Pinning test: Task A7 (`token-boot.test.ts`, "recorded role only", "recorded both with the README's agent.env is armed" and "derived both with no fleet file warns").
3. The leaked value written back after the first rotation by an older checkout's `deploy.sh` (`ship_secret` over both boxes, then a server restart). Expected: boot finds the value's sha256 in `box-token-retired.json`, never adopts it, mints a fresh current value, records `rotationOwed` with `retired-written-back`, warns; the written-back value answers 401 and is counted as a retired presentation; the fleet box is resynced through the code path, which needs no box token. Pinning tests: Task A7 (`token-boot.test.ts`, "a retired value never returns") and Task A9 (`token-rotation-e2e.test.ts`, "resync after a write-back").
4. A wave-1 doctor line that says PASS while the first rotation is stuck (held, failed, a pending value past `confirmBy`, owed but not started, `proof-unmeasured`, a failed boot mint, a boot recovery not yet followed by a rotation, a retired value presented). With the FAIL and WARN arms off (the 15:30 ruling), a PASS there is the one way an operator reads a stalled retirement as healthy. Expected: each of those states prints `SKIP box-token: …` carrying its reason word, never `PASS`; a `PASS` names "fleet confirmed" only when the fleet confirmed the current generation id; the same fixture with the arms constant flipped prints the armed FAIL or WARN, proving the arms are compiled in. Because doctor's exit code, its summary count and `ccrc update`'s exit 3 never see a SKIP, two more things carry wave 1: the console card's alert also fires on a failed mint and on a rotation owed and not completed for `STALL_ALERT_MS` (24 h), not only at three failures; and the coordinator's post-landing proof and the arming PR are scheduled ("After merge" below). Pinning tests: Task B5 (`doctor-box-token.test.ts`), Task A9 (`token-rotation-e2e.test.ts`, "a rotation owed and held past STALL_ALERT_MS raises the stall alert") and Task B6 (`box-token-card.test.tsx`, "a stalled rotation raises the alert").
5. The public claim door under load or replay while a rotation is live (it is reachable from the internet through the server's public name, with no source matcher and no per-source budget). Expected: 1000 junk claims exhaust the 30-a-minute miss budget and answer 429, yet the live code still answers 200; no number of misses burns a live code; two claims with the live code in the same tick give exactly one 200 and one 410 `code-used`; a replay of a burned code answers 410 and discards nothing; a 2 KiB body answers 413 with the same small body; every response, including Fastify's own 400 and 413, carries `Cache-Control: no-store`. Pinning test: Task A8 (`token-claim-route.test.ts`).

## File Structure

Part A (run 320):

| File | Responsibility | Ring | Task |
|---|---|---|---|
| `shared/agent-protocol.ts` | The `token-sync` op: its word, request type, error words, exit-code table, argv template, bounds, code shape, transport reader, verb-missing detector; `NODE_FILES.tokenGeneration` | L0 | A1 |
| `shared/box-token.ts` (new) | Token-lifecycle wire and words shared by server, agent and PWA: claim path and bodies, value and generation shapes, hold, phase, origin and owed words, `BoxTokenView`, `RotateAnswer`, the fleet file's fixed comment line, `readGenerationFile` | L0 | A1 |
| `server/src/update/inventory.ts` | `MEASURED_FILE_KEYS` also excludes `tokenGeneration` (the driver reads it, D-4389); docstring only otherwise | L3 | A1 |
| `server/src/readiness.ts` | Docstring count "eight" becomes "nine" | L3 | A1 |
| `agent/src/whitelist.ts` | Docstring counts "eight" become "nine" (the grant derives from `NODE_FILE_BASENAMES`; no code change) | agent | A1 |
| `agent/test/whitelist.test.ts` | `EIGHT` becomes `NINE`, gaining `box-token-generation` | test | A1 |
| `server/test/single-definition.test.ts` | `EIGHT_BASENAMES` becomes `NINE_BASENAMES` (end-of-file describe only) | test | A1 |
| `server/test/token-shared.test.ts` (new) | Pins the L0 bounds order and shapes | test | A1 |
| `agent/src/tokensync.ts` (new) | The token-sync spawn port: stdin pipe, explicit env, SIGTERM then SIGKILL, drain; the child's answer mapped to the op result | agent | A2 |
| `agent/src/server.ts` | `validateReq` and `handleReq` cases, `ReqRefusal` widened by `bad-code`, `ready.ops` gains `token-sync`, one process-wide gate, `AgentOpts.spawnTokenSync` | agent | A2 |
| `agent/CLAUDE.md` | The update op is no longer the ONE wire-triggered spawn; the node-file count | docs | A2 |
| `agent/test/token-sync-op.test.ts` (new) | The op's validation, spawn, env, stdin, bounds, mapping and source scan | test | A2 |
| `agent/test/update-op.test.ts` | The ready-frame ops list becomes `['update', 'token-sync']` | test | A2 |
| `server/test/update-spawn-twin-bodies.test.ts` | Asserts the token-sync body is not a third twin (D-4390) | test | A2 |
| `server/test/whitelist-subset.test.ts` | Layer 4 gains its second wire-triggered spawn: `spawnTokenSync(` called once, in `case 'token-sync'`, and nowhere else | test | A2 |
| `server/test/remote-connect.test.ts`, `server/test/update-inventory.test.ts` | Pins that read a real agent's `agentOps` (`['update', 'token-sync']`) | test | A2 |
| `server/src/coord/token.ts` | `BoxTokenHolder`, `matchDigestSlots`, `checkMailToken` widened to a holder plus an optional lane; docstring for the removed tolerance | L3 | A3, A4 |
| `server/src/server.ts` | `Deps.mailToken` type widened; lane argument at its two call sites; `/api/notify` fails shut; `Deps.tokenDriver`; `registerTokenRoutes` call | L4 | A3, A4, A8 |
| `server/src/coord/routes.ts` | Lane argument at its eleven call sites; the `requireMailToken` legacy detail loses "(that is /api/notify only)" | L4 | A3, A4 |
| `server/src/update/routes.ts` | Lane argument at its one call site | L4 | A3 |
| `server/src/auth/gate.ts` | Reason 2's notify paragraph rewritten (order-pinned numbers kept); the notify EXEMPT reason; the seventh reason; the `POST /api/token/claim` EXEMPT entry; "88 routes" | L4 | A4, A8 |
| `README.md` | A2: the agent section's read-grant count and a token-sync op bullet; A4: the notify-tolerance sentences in the auth paragraph that Part A falsifies (D-4396); A8: the claim door named in the auth paragraph's exempt list | docs | A2, A4, A8 |
| `server/test/coord-token.test.ts` | Accept-set, constant-time, holder and lane cases | test | A3 |
| `server/test/notify-token.test.ts` | `legacy` and `unconfigured` on `/api/notify` answer 401 | test | A4 |
| `server/test/routes.test.ts` | The notify-ingestion pair presents a token (a pin A4 moves) | test | A4 |
| `server/src/token/ports.ts` (new) | `TokenStore`, `TokenSyncLink`, `GenerationReader`, `GateRowsSource`, `BothRoleWriter`, and the read vocabularies (`TokenPaths`, `FileMeta`, `ValueRead`, `StateRead`, `RetiredRead`) that `files.ts` re-exports | L2 | A5 |
| `server/src/token/files.ts` (new) | Paths, measured reads, atomic fsynced 0600 writes with write records, the atomic rename, state and retired files, mints, fleet-file and generation-file writers, the `agent.env` fleet-marker read, and the ports' one adapter each (`fileTokenStore`, `fileBothRoleWriter`) | L3 | A5 |
| `server/test/token-files.test.ts` (new) | The adapter, its crash points, and the five readers agreeing on the written fleet file | test | A5 |
| `server/src/token/policy.ts` (new) | `BoxTokenState`, timings, `rotationGate`, `bothRoleWriterArmed`, `claimVerdict`, `nextAction`, confirmation, retirement, backoff, `phaseOf`, `recoveryPlan` | L1 | A6 |
| `server/test/token-policy.test.ts` (new) | Every pure decision | test | A6 |
| `server/src/token/boot.ts` (new) | The boot order of spec 4.2 and 4.2.1, and the both-role boot write (D-4388) | L3 | A7 |
| `server/src/index.ts` | Calls `bootBoxToken`, prints its warnings, passes the holder as `mailToken`; builds and starts the driver | L5 | A7, A9 |
| `server/test/token-boot.test.ts` (new) | Mint, refusals, recovery, retired refusal, recorded role only, the notify mixed-version case | test | A7 |
| `server/src/token/door.ts` (new) | `ClaimDoor`: code slots, burned codes, miss bucket, constant-time match, one synchronous claim step | L3 | A8 |
| `server/src/token/routes.ts` (new) | `registerTokenRoutes`: the claim door and the rotate route; the `TokenRouteDriver` port | L4 | A8 |
| `CLAUDE.md` | One sentence in the coordination bullet naming both routes, after its "What does need saying here" split | docs | A8 |
| `server/test/token-claim-route.test.ts` (new) | The door's guards and headers | test | A8 |
| `server/test/auth-gate.test.ts` | Fourth route file, counts, seven reasons, armed sweep set | test | A8 |
| `server/test/box-token-census.test.ts` | `TOKEN_SRC`, `CODE_DOORS`, `TOKEN_DOORS`, the planted control, the CLAUDE.md sentence | test | A8 |
| `server/src/token/link.ts` (new) | `TokenSyncLink` over `FleetClient.request`; `GenerationReader` over `readNodeFile`; `gateRowsOver` (`NodeRow` to `GateNode`) | L3 | A9 |
| `server/src/token/driver.ts` (new) | `BoxTokenDriver`: own timer, mint retry, stage, send, confirm, promote, grace, retire, backoff, holds, both-role rotation, the run-time re-read of the token files, the unaccounted-for alerts, `view()` (with the stall alert) | L4 | A9 |
| `server/test/token-rotation-e2e.test.ts` (new) | A whole rotation with a fake agent, in process | test | A9 |

Part B (the ledger's row 2):

| File | Responsibility | Ring | Task |
|---|---|---|---|
| `ccd/ccrc-token-sync` (new) | `ccrc token sync --from agent` and `ccrc token probe --file <path>` | shell | B1, B2 |
| `ccd/ccrc` | `token)` dispatch to `$CCRC_HERE/ccrc-token-sync`, the usage line, `token-sync` in `CCRC_CAP_WORDS`; uninstall removes the two node-scoped non-secret files | shell | B1, B3 |
| `server/test/ccrc-token-sync.test.ts` (new) | The verb and the probe under fixture HOMEs with a recording curl; the shell-to-L0 parity scan | test | B1, B2 |
| `server/test/ccrc-cli.test.ts` | The usage verb list gains `token` | test | B1 |
| `server/test/ccrc-install.test.ts` | B1: the cap word pinned to its machinery; B5: `BASE_LIVE_SHAPE` re-measured | test | B1, B5 |
| `server/test/ccrc-update.test.ts` | `CAPS_NOW` gains `token-sync` | test | B1 |
| `server/test/containedTools.ts`, `server/test/ccrc-containment.test.ts` | `CLAIM_DATA_LINE_ERE`: the loopback curl front admits the claim's one `data` line | test | B1 |
| `server/test/ccrc-uninstall.test.ts`, `server/test/install-census.test.ts` | Uninstall and purge rules | test | B3 |
| `server/test/token-rotation-real-verb.test.ts` (new) | A rotation whose fake agent runs the real verb against the in-process server on loopback | test | B4 |
| `ccd/ccrc-doctor-checks` | `box-token` entry and `_check_box-token` (PASS or SKIP in wave 1) | shell | B5 |
| `server/test/doctor-box-token.test.ts` (new) | Every state's line, the arms compiled in | test | B5 |
| `server/test/ccrc-doctor.test.ts` | The table and functions agree (its first case) | test | B5 |
| `shared/api.ts` | `UpdatesView.boxToken?: BoxTokenView` (one import, one field) | L0 | B6 |
| `server/src/update/routes.ts` | `GET /api/updates` carries `boxToken` from `deps.tokenDriver?.view()` | L4 | B6 |
| `pwa/src/lib/api.ts` | `rotateBoxToken()` and `readBoxTokenView` | pwa | B6 |
| `pwa/src/screens/SettingsScreen.tsx` | The "Box token" card and "Rotate now" | pwa | B6 |
| `pwa/test/box-token-card.test.tsx` (new) | The card's words, the alerts and the button | test | B6 |
| `pwa/src/fleet/useUpdatesView.ts` | `asUpdatesView`'s rebuild keeps `boxToken` | pwa | B6 |
| `server/test/update-routes.test.ts` | `GET /api/updates` carries `boxToken` iff a driver is set | test | B6 |
| `deploy/deploy.sh` | `ship_secret` and both calls removed; rsync excludes kept | deploy | B7 |
| `deploy/notify.sh` | `set +x` first; no POST without a token value (D-4393) | deploy | B7 |
| `deploy/ccrc-mail.token.example` | Comment rewritten: the server mints, no copy is needed; placeholder line kept | deploy | B7 |
| `README.md` | B6: one Settings sentence; B7: the shipping and hand-mint lines (3943-3944, 3972, 5080 at 282e79e44, and the install section's hand-mint lines) | docs | B6, B7 |
| `CLAUDE.md` | The SAFETY bullet's "from one gitignored `deploy/ccrc-mail.token`" | docs | B7 |
| `server/test/token-boot.test.ts` | The derived-both notify case: after D-4393 no request reaches the server | test | B7 |
| `server/test/install-coordinator-skill.test.ts`, `server/test/notify-addr.test.ts`, `server/test/coord-token.test.ts` | The `ship_secret` pin flips to absence; notify's no-token path; the notify.sh text pins | test | B7 |

## Interfaces

### L0, `shared/agent-protocol.ts` (Task A1)

```ts
// Added to NODE_FILES (the agent's read grant and the server's reads derive from it):
export const NODE_FILES = {
  stamp: 'build.json', installed: 'installed', caps: 'ccrc-caps', floor: 'floor', previous: 'previous',
  nodeId: 'node-id', report: 'update.json', projection: 'update-intent',
  tokenGeneration: 'box-token-generation',
} as const;

export const TOKEN_SYNC_OP = 'token-sync';
export interface TokenSyncReq { t: 'req'; id: number; op: 'token-sync'; code: string }
// AgentReq gains `|TokenSyncReq` at the end of its union.

export const TOKEN_SYNC_OP_ERRORS = ['bad-code', 'busy', 'spawn-failed', 'claim-refused', 'code-used',
  'write-failed', 'proof-failed', 'proof-unmeasured', 'stale-client'] as const;
export type TokenSyncOpError = (typeof TOKEN_SYNC_OP_ERRORS)[number];
export function isTokenSyncOpError(v: unknown): v is TokenSyncOpError;

/** The verb's own refusal words and their exit codes; `busy` and `spawn-failed` are the agent's, never the verb's. */
export const TOKEN_SYNC_EXIT: Readonly<Record<Exclude<TokenSyncOpError, 'busy' | 'spawn-failed'>, number>> = {
  'bad-code': 20, 'claim-refused': 21, 'code-used': 22, 'write-failed': 23,
  'proof-failed': 24, 'proof-unmeasured': 25, 'stale-client': 26,
};
/** First stderr line of a refusal: `ccrc: token sync: <word>: <sentence>`. */
export const TOKEN_SYNC_STDERR_PREFIX = 'ccrc: token sync: ';
/** The generation id's shape as a regex SOURCE, so TOKEN_SYNC_SYNCED_RE and box-token.ts's GENERATION_ID_RE build from one spelling. */
export const GENERATION_ID_HEX = '[0-9a-f]{16}';
/** The verb's ONE stdout line on success; built from GENERATION_ID_HEX and TOKEN_TRANSPORTS, source exactly `^synced ([0-9a-f]{16}) (http|https)$`. */
export const TOKEN_SYNC_SYNCED_RE: RegExp;

export const TOKEN_TRANSPORTS = ['http', 'https'] as const;
export type TokenTransport = (typeof TOKEN_TRANSPORTS)[number];
/** The ONE reader of the op result's additive `transport` field: anything else, including absence, is 'unmeasured'. */
export function readTokenTransport(raw: unknown): TokenTransport | 'unmeasured';

/** 32 random bytes as unpadded base64url = 43 characters. (prototype: randomBytes(32).toString('base64url') is 43 chars and matches) */
export const CLAIM_CODE_RE = /^[A-Za-z0-9_-]{43}$/;
export function isClaimCode(v: unknown): v is string;

export const TOKEN_SYNC_FROM = 'agent';
/** Frozen ['token', 'sync', '--from', 'agent']; the file is updateLauncherPath(home). */
export function tokenSyncSpawnArgv(): readonly string[];

export const TOKEN_SYNC_SPAWN_TIMEOUT_MS = 40_000;   // SIGTERM to the process group at this bound
export const TOKEN_SYNC_KILL_GRACE_MS = 2_000;       // then SIGKILL
export const TOKEN_SYNC_DRAIN_MS = 2_000;            // one drain deadline after exit or kill
export const TOKEN_SYNC_OP_TIMEOUT_MS = 50_000;      // the server's FleetClient.request deadline for this op
export const CLAIM_CODE_TTL_MS = 60_000;
// pinned: SPAWN + KILL_GRACE + DRAIN < OP_TIMEOUT < CLAIM_CODE_TTL (44 000 < 50 000 < 60 000)

/** A spawn-failed detail that means "this ccrc has no `token` verb" (a named hold, never a failure, D-4395). */
export const TOKEN_VERB_MISSING_PREFIXES = ['ccrc: unknown argument: token', 'could not start the launcher'] as const;
export function isTokenVerbMissing(detail: string | null | undefined): boolean;
```

Op wire. Request `{t:'req', id, op:'token-sync', code}`; `validateReq` refuses a non-`isClaimCode` code with `ReqRefusal {refuse:'bad-code', id}` before any case body, and a missing or non-string code the same way. Success `{t:'res', id, ok:true, synced:'<16 hex>', transport:'http'|'https'}` (the agent omits `transport` only when the child's stdout carried none, which the server reads as `unmeasured`). Failure `{t:'res', id, ok:false, err:<TokenSyncOpError>, detail?:<firstStderrLine, at most 200>}`. `bad-request` from this op still means "the agent predates it". `ready.ops` becomes `[UPDATE_OP, TOKEN_SYNC_OP]`.

Agent mapping of the child (Task A2): killed at the bound -> `spawn-failed` with detail `stopped at the 40000 ms bound`; exit 0 and stdout matching `TOKEN_SYNC_SYNCED_RE` -> success; exit code equal to `TOKEN_SYNC_EXIT[w]` AND first stderr line starting with `TOKEN_SYNC_STDERR_PREFIX + w + ':'` -> `w`; anything else -> `spawn-failed` with `firstStderrLine(stderr)`.

### Agent, `agent/src/tokensync.ts` (Task A2)

```ts
export interface TokenSyncSpawnResult { code: number; stdout: string | null; stderr: string; killed: boolean; pid: number | null }
export type TokenSyncSpawn = (file: string, args: readonly string[], code: string, timeoutMs: number) => Promise<TokenSyncSpawnResult>;
/** The child's whole environment; nothing else of the agent's reaches it. */
export interface TokenSyncEnv { HOME: string; PATH: string; LANG: string }
export function tokenSyncEnv(home: string, from?: NodeJS.ProcessEnv): TokenSyncEnv;   // PATH ?? '/usr/bin:/bin', LANG ?? 'C'
export function makeTokenSyncSpawn(env: TokenSyncEnv): TokenSyncSpawn;
export type TokenSyncAnswer = { ok: true; synced: string; transport: TokenTransport } | { ok: false; err: TokenSyncOpError; detail: string };
export function tokenSyncAnswer(r: TokenSyncSpawnResult): TokenSyncAnswer;   // the ONE mapping above
// agent/src/server.ts: AgentOpts.spawnTokenSync?: TokenSyncSpawn (default makeTokenSyncSpawn(tokenSyncEnv(home)));
// ReqRefusal.refuse widens by Extract<TokenSyncOpError, 'bad-code'>.
```

### L0, `shared/box-token.ts` (Task A1)

```ts
import type { NodeRole } from './api.js';
import { GENERATION_ID_HEX, type ReadFailure, type TokenTransport } from './agent-protocol.js';

export const TOKEN_CLAIM_PATH = '/api/token/claim';
export const TOKEN_ROTATE_PATH = '/api/token/rotate';
export const CLAIM_BODY_LIMIT_BYTES = 1024;
export const TOKEN_VALUE_RE = /^[0-9a-f]{64}$/;
export const GENERATION_ID_RE: RegExp;   // new RegExp(`^${GENERATION_ID_HEX}$`)

export interface ClaimRequestBody { code: string; nodeId: string }   // nodeId is checked against the store's NODE_ID_RE (server/src/coord/store.ts:1003) in door.ts; never re-spelled
export const CLAIM_REFUSALS = ['bad-request', 'wrong-node', 'no-claim', 'code-expired', 'code-used', 'rate-limited', 'unavailable'] as const;
export type ClaimRefusal = (typeof CLAIM_REFUSALS)[number];
export type ClaimResponse = { ok: true; value: string; generation: string } | { ok: false; error: ClaimRefusal };
// Status codes: 200 hand-out; 400 bad-request; 403 wrong-node; 404 no-claim; 410 code-expired | code-used;
// 413 bad-request (route bodyLimit, same small body); 429 rate-limited; 503 unavailable (the hand-out could not be recorded, D-4394).

export const TOKEN_ORIGINS = ['adopted', 'minted', 'rotated'] as const;
export type TokenOrigin = (typeof TOKEN_ORIGINS)[number];
export const OWED_REASONS = ['adopted', 'fleet-behind', 'confirm-deadline', 'retired-written-back', 'recovered',
  'aux-unusable', 'unverifiable-files', 'code-used', 'claim-misbound'] as const;
export type OwedReason = (typeof OWED_REASONS)[number];
export const TOKEN_HOLDS = ['update-in-flight', 'agent-predates-op', 'verb-missing', 'stale-client', 'fleet-rows',
  'node-id-unmeasured', 'link-down', 'pending-cap', 'no-coord', 'role-unrecorded', 'mint-failed'] as const;
export type TokenHold = (typeof TOKEN_HOLDS)[number];
export const BOX_TOKEN_PHASES = ['unconfigured', 'idle', 'staged', 'handed-out', 'promoting', 'grace', 'held', 'failed'] as const;
export type BoxTokenPhase = (typeof BOX_TOKEN_PHASES)[number];

/** The fixed comment line a fleet token file gets when none existed (both writers). */
export const FLEET_TOKEN_FILE_COMMENT = '# ccrc box token: written by ccrc and rotated by the server; do not edit or copy it';

/** What a run-time re-read of a server token file found (spec 4.2, §6 "A token file broken on re-read"). Memory is kept in every case. */
export const TOKEN_FILE_PROBLEMS = ['missing', 'unusable', 'placeholder', 'unreadable', 'changed', 'retired'] as const;
export type TokenFileProblem = (typeof TOKEN_FILE_PROBLEMS)[number];

/** ~/.ccrc/box-token-generation: one line, `<16 lowercase hex>\n`. The ONE reader; malformed reads as unreadable.
 *  The parameter derives `ReadFailure` (single-definition's "one absent/unreadable read vocabulary"), never re-spells the pair. */
export type GenerationRead = { kind: 'id'; id: string } | { kind: 'absent' } | { kind: 'unreadable' };
export type GenerationFileInput = { ok: true; content: string } | { ok: false; reason: ReadFailure | 'too-large' };
export function readGenerationFile(read: GenerationFileInput): GenerationRead;

/** What the console and the rotate route show. Numbers are ms since the epoch unless named S. No value, code or hash. */
export interface BoxTokenView {
  phase: BoxTokenPhase;
  origin: TokenOrigin | null;
  currentSeq: number | null;          // display sequence number of the current generation
  currentSince: number | null;
  lastRotationAt: number | null;
  rotationOwed: boolean;
  owedWhy: OwedReason | null;
  hold: TokenHold | null;
  holdNode: string | null;            // the node a hold names (e.g. the one updating), else null
  failures: number;                   // consecutive
  lastFailure: string | null;         // a TokenSyncOpError, 'timeout', 'disconnected' or 'mint-failed'
  banner: boolean;                    // failures >= 3
  /** A failed mint, or a rotation owed and not completed for STALL_ALERT_MS (since this server process first saw it owed). */
  stalled: { why: 'mint-failed' | 'owed'; since: number } | null;
  fileProblem: { at: number; file: 'current' | 'pending' | 'previous'; word: TokenFileProblem } | null;   // the last re-read's finding
  fleetConfirmed: 'current' | 'behind' | ReadFailure | 'own-write' | 'unknown';   // the same six words, ReadFailure derived
  fleetTransport: TokenTransport | 'unmeasured' | null;   // null: no sync yet
  lastSync: { at: number; word: string } | null;          // 'synced' or a refusal word
  previousPresented: number;
  retiredPresented: number;
  retiredRefused: boolean;            // the server's own proof at the last retirement
  lastBootRecovery: { at: number; source: 'pending' | 'previous' } | null;
  role: NodeRole;
}

export type RotateAnswer =
  | { ok: true; outcome: 'started' | 'joined'; view: BoxTokenView }       // 200
  | { ok: false; error: 'held'; hold: TokenHold; node: string | null; view: BoxTokenView }   // 409
  | { ok: false; error: 'rate-limited'; retryAfterS: number }             // 429
  | { ok: false; error: 'not-configured' };                               // 501
```

### Server state and files (Tasks A5, A6)

Every server path derives from `dir = path.dirname(cfg.mailTokenPath)`; the three fleet-side paths derive from the home. The generation file is a NODE file (the verb, doctor, uninstall and the agent's read grant all name `$HOME/.ccrc/box-token-generation`), so it is `path.join(home, CCRC_DIR_NAME, NODE_FILES.tokenGeneration)`, never a quoted literal (A1's `QUOTED` scan) and never beside a moved `mail.token`:

```ts
// server/src/token/ports.ts (declared here, re-exported by files.ts, so L2 imports no L3)
export interface TokenPaths {
  dir: string; current: string /* <dir>/mail.token */; previous: string /* <dir>/mail-previous.token */;
  pending(id: string): string /* <dir>/mail-pending-<id>.token */; state: string /* <dir>/box-token.json */;
  retired: string /* <dir>/box-token-retired.json */; generation: string /* <home>/.ccrc/box-token-generation */;
  fleetFile: string /* <home>/.cc-secrets/ccrc-mail.token */; agentEnv: string /* <home>/.ccrc/agent.env */;
}
// server/src/token/files.ts
export function tokenPaths(mailTokenPath: string, home: string): TokenPaths;
```

`box-token.json` (0600, server-written, no secret), type declared in `server/src/token/policy.ts`:

```ts
export interface WriteRecord { dev: number; ino: number; writtenAtMs: number }   // fstat of the temp before rename
export interface PendingGen {
  id: string; seq: number; stagedAt: number;
  handedOutAt: number | null; confirmBy: number | null;   // set together at hand-out; confirmBy = handedOutAt + CONFIRM_DEADLINE_MS
  write: WriteRecord;
}
export interface BoxTokenState {
  v: 1;
  origin: TokenOrigin;
  rotationOwed: boolean; owedWhy: OwedReason | null;
  current: { id: string | null; seq: number; since: number; write: WriteRecord | null };   // id null and write null for an adopted value
  pending: PendingGen[];                                  // at most MAX_PENDING
  previous: { id: string | null; seq: number; graceUntil: number; hardUntil: number;
              currentPresented: boolean; write: WriteRecord } | null;
  promoting: { id: string } | null;                       // spec §5 step (a)
  recovering: { source: 'pending' | 'previous' } | null;  // spec 4.2.1 step (a)
  fleetConfirmed: string | null;                          // the generation id the fleet last confirmed
  nextSeq: number;
  lastRotationAt: number | null;
  failures: number; lastFailure: string | null;
  hold: TokenHold | null; holdNode: string | null;
  lastSync: { at: number; word: string; transport: TokenTransport | 'unmeasured' } | null;
  counters: { previousPresented: number; retiredPresented: number };   // copied from the holder each tick, for doctor
  retiredRefusedAt: number | null;                        // spec 10.3, "retired value refused: yes"
  mintFailedAt: number | null;
  lastBootRecovery: { at: number; source: 'pending' | 'previous' } | null;
  /** The driver's last run-time re-read finding (A9). OPTIONAL so every state constructor and every state written
   *  before it reads unchanged; `readState` accepts it absent, null or this shape, anything else is unusable. */
  fileProblem?: { at: number; file: 'current' | 'pending' | 'previous'; word: TokenFileProblem } | null;
}
```

`box-token-retired.json` (0600): `{"v":1,"retired":[{"len":64,"sha256":"<64 hex>","at":<ms>}]}`. Value files hold one bare value line (`<64 hex>\n`), no comment.

```ts
// FileMeta, ValueRead, StateRead and RetiredRead are DECLARED in server/src/token/ports.ts and re-exported here.
// server/src/token/files.ts (L3)
export interface FileMeta { dev: number; ino: number; mtimeMs: number; mode: number; kind: 'regular' | 'symlink' | 'other' }
export type ValueRead =
  | { kind: 'value'; value: string; meta: FileMeta }
  | { kind: 'absent' }
  | { kind: 'unusable'; meta: FileMeta }          // readable, no value line (MailTokenFileUnusable's class)
  | { kind: 'placeholder' }                       // PLACEHOLDER_TOKEN
  | { kind: 'unreadable'; code: string };         // EACCES, EISDIR, ELOOP, EIO, other
export async function readValueFile(p: string): Promise<ValueRead>;           // lstat first; extraction is coord/token.ts's extractToken (exported for this)
export async function writeValueFileAtomic(p: string, text: string): Promise<WriteRecord>;
  // temp `<dir>/.<base>.tmp-<16 hex>` opened O_WRONLY|O_CREAT|O_EXCL mode 0o600, write, fsync, fstat, close,
  // rename over p, open dir 'r', fsync, close. A throw before the rename leaves p byte-equal and removes the temp.
  // (prototype: rename keeps the temp's dev and ino; the file is 0600; an in-place truncate keeps the ino and moves mtime.)
export type StateRead = { kind: 'state'; state: BoxTokenState } | { kind: 'absent' } | { kind: 'unusable' };
export async function readState(p: string): Promise<StateRead>;
export async function writeState(p: string, s: BoxTokenState): Promise<void>;     // same atomic write
export type RetiredRead = { kind: 'retired'; digests: string[] } | { kind: 'absent' } | { kind: 'unusable' };
export async function readRetired(p: string): Promise<RetiredRead>;
export async function appendRetired(p: string, valueDigestHex: string, at: number): Promise<void>;
export function valueDigestHex(value: string): string;      // sha256 hex, never persisted except in the retired file
export function mintValue(): string;                        // randomBytes(32) as 64 lowercase hex
export function mintGenerationId(): string;                 // randomBytes(8) as 16 lowercase hex
export function mintClaimCode(): string;                    // randomBytes(32).toString('base64url')
export function fleetFileText(existing: string | null, value: string): string;
  // existing's `#` and blank lines kept verbatim in order, then the value line; null -> FLEET_TOKEN_FILE_COMMENT + '\n' + value + '\n'
export async function writeFleetTokenFile(p: string, value: string): Promise<void>;
  // mkdir -p of <home>/.cc-secrets with mode 0o700 only when absent; never chmod an existing directory; atomic write
export async function writeGenerationFile(p: string, id: string): Promise<void>;   // `<id>\n`, atomic, 0600
export async function fileExists(p: string): Promise<boolean>;                    // lstat, any kind
export async function renameOverAtomic(from: string, to: string): Promise<void>;  // rename(2), then a directory fsync
/** Whether ~/.ccrc/agent.env marks a FLEET box (D-4399): absent -> false; present and readable
 *  with no line whose key is CCRC_AGENT_TOKEN -> false (the README's single-box file carries CCRC_SERVER_URL only);
 *  a CCRC_AGENT_TOKEN key line, or any read failure -> true (unknown is the safe answer). Keys only: no value is kept. */
export async function readAgentEnvMarksFleet(p: string): Promise<boolean>;
export function fileTokenStore(paths: TokenPaths): TokenStore;             // the TokenStore port's one adapter
export function fileBothRoleWriter(paths: TokenPaths): BothRoleWriter;     // the fleet file, then the generation file
```

### Holder and accept-set (Task A3), `server/src/coord/token.ts`

```ts
export type TokenSlot = 'current' | 'pending0' | 'pending1' | 'previous';
export const TOKEN_SLOTS: readonly TokenSlot[] = ['current', 'pending0', 'pending1', 'previous'];
export interface HolderSlots {
  current: string | null;
  pending: readonly { id: string; value: string }[];   // at most 2
  previous: { value: string; until: number } | null;    // until = the hard bound; the driver removes it at retirement
}
export class BoxTokenHolder {
  constructor(opts?: { now?: () => number; compare?: (a: Buffer, b: Buffer) => boolean });
  setSlots(s: HolderSlots): void;                // recomputes the four sha256 digests; empty slots get per-process random dummies
  setRetired(digestsHex: readonly string[]): void;
  hasCurrent(): boolean;
  pendingValue(id: string): string | null;       // the claim door's value source (memory, never the pending file)
  currentValue(): string | null;                 // for the both-role writer and the retirement self-check only
  match(presented: string): TokenSlot | null;    // constant time over all four slots
  isRetired(presented: string): boolean;
  noteRetiredPresented(lane: string): void;      // count, plus at most one warning a minute naming the lane and count
  counters(): { matched: Record<TokenSlot, number>; retired: number; retiredByLane: Readonly<Record<string, number>> };
}
/** Constant time: every slot compared every time, results folded with `|=` into numbers; no ||, &&, ||=, &&=, ?:,
 *  return, break, some or find inside the combine. Answers the matched index or -1. */
export function matchDigestSlots(presented: Buffer, slots: readonly Buffer[], compare?: (a: Buffer, b: Buffer) => boolean): number;
export function extractToken(raw: string): string | null;   // now exported (unchanged rule)
/** Unchanged words. A string `expected` keeps today's exact behaviour (tests inject literals). A holder with no
 *  current value answers 'unconfigured'. `lane` names the caller for the retired-presentation count; absent -> 'unnamed'. */
export function checkMailToken(expected: string | BoxTokenHolder | null, presented: unknown, lane?: string): 'ok' | 'legacy' | 'bad' | 'unconfigured';
```

`Deps.mailToken?: string | BoxTokenHolder | null` (`server/src/server.ts`). Every one of the 14 call sites keeps `deps.mailToken ?? null` and gains its route key as the third argument (`'POST /api/notify'`, `'GET /api/pools/epoch'`, `route` inside `requireMailToken`, `'POST /api/mail'`, `'POST /api/mail/:id/ack'`, the dual-credential reads' own `VERB /path`, `'GET /api/updates/intent/:nodeId'`).

### Policy (Task A6), `server/src/token/policy.ts` (L1)

```ts
export const GRACE_MS = 5 * 60_000;
export const GRACE_HARD_MS = 60 * 60_000;
export const CONFIRM_DEADLINE_MS = 5 * 60_000;
export const DRIVER_TICK_MS = 60_000;
export const BACKOFF_MIN_MS = 60_000;
export const BACKOFF_MAX_MS = 60 * 60_000;
export const HOLD_REPROBE_MS = 60 * 60_000;
export const FAILURES_FOR_BANNER = 3;
export const MAX_PENDING = 2;
export const CLAIM_MISS_BUDGET = 30;
export const CLAIM_MISS_WINDOW_MS = 60_000;
export const CLAIM_ALERT_EVERY_MS = 60_000;
export const BURNED_CODES_KEPT = 8;
export const BURNED_CODE_KEEP_MS = 10 * 60_000;
export const ROTATE_NOW_MIN_INTERVAL_MS = 60_000;
/** Added at plan assembly (review). The driver's run-time re-read of the server's token files runs at the readiness
 *  sweep's cadence (watch.ts's READINESS_SWEEP_MS, 600 s), which the driver does not import. */
export const TOKEN_FILE_REREAD_MS = 10 * 60_000;
/** Added at plan assembly (review). A rotation owed and not completed this long raises the console's stall alert. */
export const STALL_ALERT_MS = 24 * 60 * 60_000;

/** State helpers, so the L4 driver changes state only through L1. Every minted value carries a generation id: a
 *  server-minted current that the fleet has never confirmed then reads `behind` against an absent or different fleet
 *  generation, which is how a fresh two-box install hands the fleet box its first value. */
export function mintedState(now: number, write: WriteRecord, prior: BoxTokenState | null, owed: OwedReason | null, id: string): BoxTokenState;
export function adoptedState(now: number, prior: BoxTokenState | null): BoxTokenState;   // current.id null, owed 'adopted'
// owe, stagedState, handedOutState, promotedState, extendedGraceState, codeExpiresAt, provedWrite (signatures in Task A6)

export interface GateNode {
  nodeId: string; nodeIdMeasured: boolean /* NODE_ID_RE.test(nodeId), computed by the rows source */; label: string;
  role: NodeRole | null; reachable: boolean; os: NodeOs;
  caps: readonly string[]; agentOps: readonly string[] | null;
  updateState: UpdateState; reportedPhase: UpdatePhase | null;
}
export interface GateInput {
  fleetMode: 'local' | 'remote'; role: NodeRole; roleSource: 'recorded' | 'derived-absent' | 'derived-invalid';
  agentEnvMarksFleet: boolean;            // files.ts's readAgentEnvMarksFleet (D-4399)
  nodes: readonly GateNode[] | null;     // null: no coord (hold no-coord)
  linkUp: boolean;                        // remote only
  learned: { hold: 'verb-missing' | 'stale-client'; at: number } | null;
  lastReadyAt: number | null;             // a fresh ready after `learned.at` re-probes at once
  handedOutUnconfirmed: number;
  mintFailed: boolean;
  now: number;
}
// No trigger kind and no auto/intent field: every trigger meets the same gate (R1 as amended by R5).
export type GateVerdict = { open: true; mode: 'remote' | 'both-local'; nodeId: string | null }   // nodeId: the one measured fleet node a code is bound to
  | { open: false; hold: TokenHold; node: string | null };
export function rotationGate(i: GateInput): GateVerdict;
  // order: mint-failed; no-coord; local mode -> role-unrecorded unless bothRoleWriterArmed, then the own row's
  // update-in-flight and verb-missing (caps lack 'token-sync'); remote -> update-in-flight on ANY row
  // (updateState in BUSY_UPDATE_STATES or reportedPhase in IN_FLIGHT_UPDATE_PHASES), fleet-rows unless exactly one
  // reachable role-'fleet' row, node-id-unmeasured unless nodeIdMeasured, link-down, agent-predates-op unless
  // agentOps includes 'token-sync', verb-missing when caps were read (os !== 'unknown') and lack 'token-sync'
  // (os 'unknown' with no caps is a deploy.sh box: the op itself probes), a learned hold not yet re-probed
  // (no ready since, and less than HOLD_REPROBE_MS old), pending-cap when handedOutUnconfirmed >= MAX_PENDING.
export function bothRoleWriterArmed(i: { role: NodeRole; roleSource: GateInput['roleSource']; fleetMode: 'local' | 'remote'; agentEnvMarksFleet: boolean }): boolean;
  // role === 'both' && roleSource === 'recorded' && fleetMode === 'local' && !agentEnvMarksFleet

export interface CodeSlot { digest: string; generation: string; nodeId: string; expiresAt: number }
export interface BurnedCode { digest: string; generation: string; at: number }
export interface ClaimDoorState { live: readonly CodeSlot[]; burned: readonly BurnedCode[]; misses: { windowStart: number; count: number } }
export type ClaimMatch = { kind: 'malformed' } | { kind: 'live'; index: number } | { kind: 'burned'; index: number } | { kind: 'none' };
export type ClaimReply =
  | { status: 200; error: null; generation: string }
  | { status: 400 | 404 | 429; error: 'bad-request' | 'no-claim' | 'rate-limited'; generation: null }
  | { status: 403 | 410; error: 'wrong-node' | 'code-expired' | 'code-used'; generation: string };
export type ClaimAlert = { kind: 'expired' | 'wrong-node' | 'replay'; generation: string } | { kind: 'misses'; count: number } | null;
/** live first (never budget-checked), then malformed/none charge the miss bucket; a live match past TTL or bound to
 *  another node is burned and reported; a burned match is 410 code-used and changes nothing. */
export function claimVerdict(state: ClaimDoorState, match: ClaimMatch, nodeId: string, now: number):
  { reply: ClaimReply; next: ClaimDoorState; alert: ClaimAlert };

export type GenerationObservation = { read: GenerationRead; measuredAt: number };
export type SyncResult =
  | { kind: 'synced'; generation: string; transport: TokenTransport | 'unmeasured' }
  | { kind: 'refused'; word: TokenSyncOpError; detail: string | null }
  | { kind: 'predates-op' } | { kind: 'unsent' } | { kind: 'lost'; why: 'timeout' | 'disconnected' | 'aborted' };
export type DriverAction =
  | { kind: 'none' }
  | { kind: 'hold'; hold: TokenHold; node: string | null }
  | { kind: 'retry-mint' }
  | { kind: 'stage'; why: OwedReason | 'rotate-now' }           // mint a new generation, write its pending file
  | { kind: 'send'; generation: string; nodeId: string }        // issue a code bound to nodeId for a Staged generation, send the op
  | { kind: 'promote'; generation: string; via: 'op-result' | 'generation-read' | 'own-write' }
  | { kind: 'retire'; why: 'grace' | 'hard-bound' }
  | { kind: 'extend-grace' }
  | { kind: 'backoff'; until: number };
export function nextAction(i: { state: BoxTokenState | null /* null: a failed boot mint with no history -> retry-mint */; gate: GateVerdict; generation: GenerationObservation | null;
  rotateRequested: boolean; backoffUntil: number | null; now: number }): DriverAction;
export function confirmedGeneration(state: BoxTokenState, obs: GenerationObservation): string | null;
  // the id of a handed-out pending gen equal to obs.read.id with obs.measuredAt > handedOutAt; else null
export function applySyncResult(state: BoxTokenState, sent: string, r: SyncResult, now: number):
  { state: BoxTokenState; promote: string | null; learned: { hold: 'verb-missing' | 'stale-client'; at: number } | null };
export function retireDue(prev: NonNullable<BoxTokenState['previous']>, now: number): 'no' | 'grace' | 'hard-bound' | 'extend';
export function backoffMs(failures: number): number;      // 60 s doubling, capped at 1 h; 0 failures -> 0
export function phaseOf(state: BoxTokenState | null, hold: TokenHold | null, hasCurrent: boolean): BoxTokenPhase;
export type RecoveryPlan = { kind: 'refuse' } | { kind: 'finish-promotion'; id: string } | { kind: 'from-previous' };
export function recoveryPlan(i: { state: BoxTokenState | null; current: FileMetaLike; pending: FileMetaLike | null;
  previous: FileMetaLike | null; retired: readonly string[] }): RecoveryPlan;
  // FileMetaLike = { meta: FileMeta | null; usable: boolean; placeholder: boolean; digest: string | null }; FileMeta re-declared here
  // structurally (L1 imports no L3); the proof of spec 4.2.1: state present, origin minted|rotated, regular file,
  // (dev, ino) equal to the write record, mtime <= record time, not retired.
```

### Ports (Task A5), `server/src/token/ports.ts` (L2, declared for the driver)

```ts
export interface TokenStore {
  readonly paths: TokenPaths;
  readState(): Promise<StateRead>; writeState(s: BoxTokenState): Promise<void>;
  readValue(p: string): Promise<ValueRead>;
  writeValue(p: string, value: string): Promise<WriteRecord>;
  removeValue(p: string): Promise<void>;           // ENOENT is success
  readRetired(): Promise<RetiredRead>; appendRetired(digestHex: string, at: number): Promise<void>;
  renameOver(from: string, to: string): Promise<void>;   // promotion step (c)
  mintValue(): string; mintGenerationId(): string; mintClaimCode(): string;
}
export interface TokenSyncLink { send(code: string): Promise<SyncResult> }
export interface GenerationReader { read(): Promise<GenerationObservation> }
export interface GateRowsSource { nodes(): readonly GateNode[] | null; linkUp(): boolean; lastReadyAt(): number | null }
export interface BothRoleWriter { write(value: string, generation: string | null): Promise<void> }   // fleet file, then the generation file when non-null
```

### Boot (Task A7), `server/src/token/boot.ts` (D-4388)

```ts
export interface BootInput { mailTokenPath: string; home: string; role: NodeRole; roleSource: RoleSource; fleetMode: FleetMode; now: number }
export interface BootResult {
  holder: BoxTokenHolder; state: BoxTokenState | null; mintFailed: boolean;
  bothWriterArmed: boolean; agentEnvMarksFleet: boolean;  // the driver's gate uses the answer boot used
  warnings: string[];                                     // index.ts prints each with console.warn
}
/** Spec 4.2 in order: finish a recorded promotion; read mail.token (hand-made unusable or placeholder still throws
 *  MailTokenFileUnusable / MailTokenPlaceholderUnedited, a read error still throws); recover a proved
 *  server-written file (4.2.1); refuse a retired value (mint, owe 'retired-written-back'); mint if absent with no
 *  history; recover from history if absent with history; mint failure boots with no current value; adopt with
 *  origin 'adopted' and rotationOwed; auxiliary files through the same reads; then, when bothWriterArmed, make the
 *  fleet file agree with the current value. */
export async function bootBoxToken(i: BootInput): Promise<BootResult>;
```

Warning words (each one line, paths and display numbers only): `ccrc-server: box token: minted a new value at <path> (no token existed)`; `ccrc-server: box token: adopted the hand-made value at <path>; the first rotation is owed`; `ccrc-server: box token: <path> carries no usable value, but this server wrote it (generation #<seq>); recovered from <sibling path>, also written by this server. A forward rotation is owed now; the fleet box's calls may answer 401 until it confirms one.`; `ccrc-server: box token: <path> held a retired value; it was not adopted, a fresh value was minted and a rotation is owed`; `ccrc-server: box token: could not mint at <path> (<errno>); every box-token lane answers 401 until a mint succeeds — the driver retries each minute`; `ccrc-server: box token: this box's role is not recorded as both, so the server will not write <fleet path>; with no file there, notify.sh is refused (record CCRC_ROLE=both in ~/.ccrc/ccrc.env)`.

### Claim door and rotate route (Task A8)

```ts
// server/src/token/door.ts (L3)
export class ClaimDoor {
  constructor(opts: { valueOf: (generation: string) => string | null; warn: (line: string) => void;
    compare?: (a: Buffer, b: Buffer) => boolean /* test-only: counts compares */ });
  issue(generation: string, nodeId: string, now: number): string;   // mints a code, keeps its sha256 only, at most 2 live
  revoke(generation: string): void;
  /** ONE synchronous step, no await: shape check, sha256, matchDigestSlots over a FIXED 2 live + BURNED_CODES_KEPT
   *  burned slots (dummies fill), claimVerdict, apply `next`, warn on alerts (capped). The 200 carries the value from valueOf. */
  claimNow(body: unknown, now: number): ClaimStep;
  readonly alerts: { expired: string[]; wrongNode: string[]; replays: number };   // generations the driver must discard
}
export type ClaimStep =
  | { status: 200; generation: string; value: string }
  | { status: 400 | 403 | 404 | 410 | 429; error: ClaimRefusal; generation: string | null };

// server/src/token/routes.ts (L4)
export interface TokenRouteDriver {
  readonly door: ClaimDoor;
  commitHandOut(generation: string, at: number): Promise<void>;   // persists handedOutAt/confirmBy (fsynced); rejects -> 503, generation discarded (D-4394)
  rotateNow(now: number): Promise<RotateAnswer>;
  view(): BoxTokenView;
}
export function registerTokenRoutes(app: FastifyInstance, deps: Pick<Deps, 'tokenDriver'>): void;
// POST /api/token/claim: { bodyLimit: CLAIM_BODY_LIMIT_BYTES, onRequest: sets Cache-Control: no-store,
//   errorHandler: 413 or 400 with {ok:false,error:'bad-request'} } (prototype: Fastify 5 applies the route
//   onRequest header to its own 413 and JSON-parse 400, and the route errorHandler reshapes them).
//   No driver -> 404 no-claim (the same small body; it never says whether a rotation exists).
// POST /api/token/rotate: session-only (NOT EXEMPT), no body; no driver -> 501 not-configured.
```

`Deps.tokenDriver?: TokenRouteDriver` (`server/src/server.ts`), read at request time. Gate: `EXEMPT` gains `['POST /api/token/claim', '<reason 7 text>']`; reason 7 reads "a door that authenticates by a single-use code it issued itself".

### Driver and link (Task A9)

```ts
// server/src/token/link.ts (L3)
export function tokenSyncLinkOver(client: Pick<FleetClient, 'request'>): TokenSyncLink;
  // request({t:'req', op:'token-sync', code}, TOKEN_SYNC_OP_TIMEOUT_MS): ResOk with GENERATION_ID_RE synced ->
  // synced + readTokenTransport; AgentOpError 'bad-request' -> predates-op; AgentOpError with an
  // isTokenSyncOpError word -> refused; other AgentOpError -> refused 'spawn-failed'; LinkNotSentError -> unsent;
  // Error 'timeout' | 'disconnected' | 'aborted' -> lost.
export function generationReaderOver(io: FleetIO, ccrcDir: string, now: () => number): GenerationReader;
  // readNodeFile(io, path.join(ccrcDir, NODE_FILES.tokenGeneration), openPoolReadDeadline(INVENTORY_BUDGET_MS)),
  // then readGenerationFile; measuredAt is taken AFTER the read resolves.
export function gateRowsOver(store: { nodes(): NodeRow[] } | null, linkUp: () => boolean, lastReadyAt: () => number | null): GateRowsSource;
  // NodeRow -> GateNode (an adapter's mapping, not L5's); nodeIdMeasured is the store's own NODE_ID_RE; no coord -> nodes() null.

// server/src/token/driver.ts (L4)
export interface DriverDeps {
  store: TokenStore; holder: BoxTokenHolder; door?: ClaimDoor;
  link: TokenSyncLink | null;               // null in local mode
  generation: GenerationReader | null;      // null in local mode
  rows: GateRowsSource;
  env: Pick<GateInput, 'fleetMode' | 'role' | 'roleSource' | 'agentEnvMarksFleet'>;
  bothWriter: BothRoleWriter | null;        // non-null iff bothRoleWriterArmed
  now?: () => number; warn?: (line: string) => void;
}
export class BoxTokenDriver implements TokenRouteDriver {
  constructor(deps: DriverDeps, boot: BootResult);
  readonly door: ClaimDoor;
  start(): void;                 // first tick at once, then every DRIVER_TICK_MS; the interval is unref'd
  stop(): void;
  tick(): Promise<void>;         // single-flight: a tick while one runs joins it
  rotateNow(now: number): Promise<RotateAnswer>;
  commitHandOut(generation: string, at: number): Promise<void>;
  view(): BoxTokenView;
}
```

In `server/src/index.ts`, remote arm: `link = tokenSyncLinkOver(fleet.client)`, `generation = generationReaderOver(fleet.io, cfg.ccrcDir, Date.now)`, rows from `gateRowsOver(coord, …)` (`server/src/token/link.ts`), `linkUp` from `fleet.state.connected`, `lastReadyAt` recorded by `fleetClient.onConnected`. Local arm: `link = null`, `generation = null`. The driver is built before `buildServer`, set as `deps.tokenDriver`, and started after `app.listen` (Task A7 Step 9 may move its build after `listen` if the boot bound needs it; `deps.tokenDriver` is read at request time).

Driver behaviour added at plan assembly (review findings; not prototyped, so each lands red first): the run-time re-read (every `TOKEN_FILE_REREAD_MS`, the files compared with memory, memory kept, one warning per finding, `fileProblem` persisted); the alerts `a handed-out value is unaccounted for (generation #<seq>)` (a handed-out value past `confirmBy`, once per generation) and `handed-out values unaccounted for` (the `pending-cap` hold); `view().stalled` (a failed mint, or owed for `STALL_ALERT_MS`); a minted value's generation id (boot and `retryMint` pass `store.mintGenerationId()` / `mintGenerationId()` to `mintedState`).

### Part B interfaces

`ccrc token` CLI (`ccd/ccrc-token-sync`, dispatched by `ccd/ccrc`'s `token)   cmd_token "$@" ;;`, where `cmd_token` refuses by name when the sibling file is missing and then runs `exec "$BASH" "$CCRC_HERE/ccrc-token-sync" "$@"`, `cmd_adopt`'s precedent: no exec-bit dependency):

- `ccrc token sync --from agent`. stdin: one line, the code (`^[A-Za-z0-9_-]{43}$`), then EOF; nothing is read from argv or the environment. stdout on success: exactly `synced <16 hex> <http|https>`. stderr on refusal: first line `ccrc: token sync: <word>: <sentence>`. Exit: 0 synced; 2 usage (no subverb, unknown subverb, `--from` other than `agent`); 1 environment (no curl, no python3, `~/.ccrc/agent.env` unreadable, no `CCRC_SERVER_URL`, no or malformed `~/.ccrc/node-id`); otherwise `TOKEN_SYNC_EXIT[word]`. Order: `set +x`, `umask 077`, sweep `.ccrc-token-sync.*` in both `~/.cc-secrets` and `~/.ccrc` (one temp prefix, two directories: the claim answer and the token file in the first, the generation file and the report renamed within the second), stale-client check by content of `~/.local/bin/ccrc-api`, address from `CCRC_SERVER_URL` with `ws:`->`http:` and `wss:`->`https:` (transport recorded, never refused), claim `POST <url>/api/token/claim` with `{"code":…,"nodeId":…}` as curl `--data @-`-equivalent on stdin through `-K -`, response to a 0600 temp in `~/.cc-secrets` with `--max-filesize 4096 --max-time 15`, answer must be `{"ok":true,"value":"<64 hex>","generation":"<16 hex>"}`; 410 `code-used` -> `code-used`, any other non-200 -> `claim-refused`; write the token file (temp from `mktemp ~/.cc-secrets/.ccrc-token-sync.XXXXXX`, preamble kept or `FLEET_TOKEN_FILE_COMMENT`, python3 `os.fsync` then `os.rename`, then a directory fsync where `os.open(dir)` allows) -> `write-failed` on any failure; write `~/.ccrc/box-token-generation` by temp and rename; prove with `GET <url>/api/ledger` (token on stdin): 400 proved, 401 `proof-failed`, anything else (501, 5xx, timeout) `proof-unmeasured`; write `~/.ccrc/token-sync.json`; clear `code` and `tok` (one `python3` process checks the claim answer and writes the token file, so the value never enters the shell and there is no `value` variable). A generation-file write that fails after the token file was renamed answers `write-failed` with its own sentence; the server keeps the handed-out value accepted.
- `~/.ccrc/token-sync.json` (0600): `{"v":1,"at":<unix seconds>,"result":"synced"|<word>,"generation":"<16 hex>"|null,"transport":"http"|"https"|null,"proof":"proved"|"proof-failed"|"proof-unmeasured"|null}`.
- stale-client: `~/.local/bin/ccrc-api` absent passes; present passes only when it carries `-K -` and no `-H` argument naming `x-ccrc-mail-token`; a symlink is followed (a release-tree link passes the same test).
- `ccrc token probe --file <path> [--url <base>]`: reads the file's value line by the extraction rule inside its own process, sends it through `-K -` to `GET <base>/api/ledger` (base defaults to `CCRC_SERVER_URL` from `~/.ccrc/agent.env`, rewritten as above), prints exactly one line `probe: <http status> <accepted|refused|unmeasured>` (400 accepted, 401 refused, else unmeasured); exit 0 when the status was 400 or 401, 1 otherwise; never prints the value.
- `CCRC_CAP_WORDS` gains `token-sync`; uninstall removes `~/.ccrc/box-token-generation` and `~/.ccrc/token-sync.json` with the node files; `box-token.json`, `box-token-retired.json` and the value files stay with `mail.token`; `--purge` takes `~/.ccrc` whole; neither touches `~/.cc-secrets/ccrc-mail.token`.

Doctor `box-token` (`ccd/ccrc-doctor-checks`): one table entry `box-token`, one `_check_box-token`, a file-level constant `_BT_ARMS_ON=0` (no flag file; the follow-up PR flips it). Arms: role `server` -> server arm; `fleet` -> fleet arm; `both` -> both; unrecorded -> server arm when `~/.ccrc/box-token.json` or `~/.ccrc/mail.token` exists, fleet arm when `~/.ccrc/agent.env` exists, else `SKIP box-token: no-role — …`. D-3111's server-role skip never covers this check. Reads `box-token.json` and `token-sync.json` with `python3 -c`, the token files by mode and extraction inside the check, never printed. Lines:

- `PASS box-token: server: generation #<seq>, rotated <age> ago, fleet confirmed[, retired value refused]` (an adopted value is always owed, so a PASS always names a rotation; "fleet confirmed" is printed only when `fleetConfirmed` equals a non-null `current.id`; the tail is printed once `retiredRefusedAt` is set, spec 10.3).
- `PASS box-token: fleet: token file 0600, generation recorded, last sync proved, transport <http|https>`.
- Both arms on one line, joined by `; `, worst verdict wins.
- Every armed-later state: `SKIP box-token: <word> — <sentence>; reported as SKIP until the FAIL and WARN arms ship`. Server words: `token-absent`, `token-mode`, `token-unusable`, `state-absent`, `state-unreadable`, `mint-failed`, `held:<TokenHold>`, `failed:<word>`, `pending-overdue`, `rotation-owed:<OwedReason>`, `proof-unmeasured`, `recovered`, `retired-presented`, `fleet-behind`, `fleet-unconfirmed` (the current value has no generation id and nothing is owed: the fleet's confirmation cannot be measured), `file:<TokenFileProblem>` (the driver's last re-read). Fleet words: `fleet-token-absent`, `fleet-token-mode`, `fleet-token-unusable`, `no-generation`, `generation-malformed`, `never-synced`, `sync:<word>`, `proof-unmeasured`, `sync-unreadable`. With `_BT_ARMS_ON=1` the same states print FAIL (`token-*`, `state-unreadable`, `mint-failed`, `failed:*` at 3 or more failures, `retired-presented`, `file:*`, `fleet-token-*`) or WARN (the rest) with a remedy line. The both-role writer's own box (no sync report read) is role `both` recorded, `CCRC_FLEET` not `remote`, and an `agent.env` that does not mark a fleet box (D-4399; the check reads key names only, in-process). `transport http` is printed on PASS lines and never changes a verdict.

Console (Task B6): `UpdatesView.boxToken?: BoxTokenView` (`shared/api.ts`, additive, absent from an older server); `GET /api/updates` sets it from `deps.tokenDriver?.view()`; `pwa/src/lib/api.ts` gains `rotateBoxToken(): Promise<RotateAnswer | 'unreadable'>` (`POST /api/token/rotate`; a 2xx whose body will not parse resolves `'unreadable'`, D-1150's `postJsonOr` rule) and `readBoxTokenView(raw: unknown): BoxTokenView | null` (the one reader; malformed -> null, shown as "not reported"); `pwa/src/fleet/useUpdatesView.ts`'s `asUpdatesView` rebuild keeps `boxToken`. The card renders a "retired value refused: yes | not yet" line, the re-read's file finding, and one `role="alert"` for three failures or for `stalled`.

## Deviations found

- **D-4388** — The boot sequence lives in `server/src/token/boot.ts` as `bootBoxToken`, an L3 composition helper that `server/src/index.ts` calls once and whose warnings it prints, instead of inline in `index.ts` as the spec's 4.1 table places it (L5). `index.ts` runs top-level awaits with side effects (`loadConfig`, the coord database, `app.listen`), so a boot written inline could only be tested by spawning the whole server (`boot.test.ts`'s pattern), which cannot plant the dozens of file states 4.2.1 and §10.1 require at a reasonable cost; as a function it is exercised in process under a fixture HOME by `token-boot.test.ts`. `index.ts` keeps the composition (which path, which role, what to do with the result) and stays the only L5 file.
- **D-4389** — The driver reads the fleet box's `box-token-generation` itself, on its own tick, through the inventory's own `readNodeFile` (lstat-gated, size-capped, deadline-bounded) over the fleet `FleetIO`, recording `measuredAt` after the read resolves; it is not fed by a callback from the inventory sweep, and `MEASURED_FILE_KEYS` excludes `tokenGeneration` as it already excludes `projection`. The sweep's dependencies are composed in `server/src/watch.ts`, which the spec itself keeps the driver out of because other runs edit it (claim 1070 at plan time); reusing `readNodeFile` means no read rule is spelled twice. The cost is one more three-round-trip read a minute over the agent; the name still joins `NODE_FILES`, so the agent's grant is exactly the spec's.
- **D-4390** — The token-sync spawn is its own bounded body in `agent/src/tokensync.ts`, not a third pinned twin of the update op's bounded-spawn body and not that body with stdin as a parameter. Its kill sequence (SIGTERM to the group at 40 s, SIGKILL 2 s later, so the verb's trap removes its temps) and its stdin pipe and explicit `{HOME, PATH, LANG}` environment differ from the twin's SIGKILL-only, stdin-ignored, inherited-environment body, and the update op's killed-spawn arms (D-3400, D-3413) are measured against exactly that body; parameterising it would change a pinned, measured behaviour for an op this wave does not touch. `update-spawn-twin-bodies.test.ts` gains a case that `agent/src/tokensync.ts` carries no bounded-spawn sentinel and that `agent/src/server.ts` still carries exactly one, so the twins stay two and the third body stays visibly separate.
- **D-4391** — Every place the spec says "doctor FAIL" for a wave-1 state (4.2 step 3, a retired value written back; 4.2 step 5 and the §6 row, a failed boot mint; §5's hard bound naming a retirement; §6's repeated-failure and broken-file rows) reports `SKIP` with its reason word in wave 1. §4.8, §11's "Doctor FAIL arms in wave 1" row and the operator's 15:30 ruling (FAIL arms off in wave 1, on before the weekly schedule ships) govern those sentences, which describe the check once armed. The arms are compiled in behind `_BT_ARMS_ON=0` and proven by a test that flips the constant in a copy of the file.
- **D-4392** — The console's data rides `GET /api/updates` as one optional fleet-wide `boxToken: BoxTokenView` object, carrying the server's side and the fleet's confirmed generation, last sync word and transport, rather than splitting the fleet's fields onto its `NodeWire` row as 4.7 sketches. The fleet's generation lives in the driver's memory, not in a `nodes` column (spec §8's coord.db row), so putting it on `NodeWire` would make `toNodeWire` and the PWA's `asUpdatesView` validator read the driver; one object has one producer (`driver.view()`), one reader (`readBoxTokenView`) and touches neither.
- **D-4393** — `deploy/notify.sh` sends nothing and exits 0 when it has no token value, instead of posting with no header as it does today. Once Part A removes `/api/notify`'s `legacy` and `unconfigured` tolerance, a tokenless post is a guaranteed 401 that `curl -f … || true` swallows, so it only adds a request the server must refuse; the missing file is what the doctor's fleet arm reports. The spec names only `set +x` for this file; this removes the no-token path the task names, and the header comment that promised the tolerance goes with it.
- **D-4394** — The claim door persists the hand-out (`handedOutAt` and `confirmBy` in `box-token.json`, fsynced) after its synchronous burn and before it sends the 200; if that write fails it answers 503 `unavailable` and the generation is discarded, never handed out. The spec fixes the burn before the first await but does not order the persistence against the reply; without this order a crash between the reply and the write would boot with the generation recorded as Staged, discard it, and leave the fleet holding a value the server no longer accepts, which is the 401 window G3 forbids.
- **D-4395** — A `spawn-failed` answer whose detail starts with `ccrc: unknown argument: token` (an older `ccrc` without the verb, `_ccrc_usage_die`'s line) or `could not start the launcher` (no `ccrc` at the absolute path) is the named hold `verb-missing`, re-probed on a fresh ready or hourly and never counted as a failure. The spec names only "a ccrc without the verb"; a node with no launcher at all is the same condition seen one step earlier, and counting it as a failure would raise the three-failure banner on a box that simply has not installed the release.
- **D-4396** — Part A rewrites the README auth paragraph's sentences about `/api/notify` accepting a tokenless request (and passing everything on a server with no token file), in the same change that removes that tolerance; the spec's §9.1 puts all README lines in PR B. Those sentences become false the moment PR A merges, and the README is this tree's canonical overview; the deploy.sh and hand-mint lines, which stay true until PR B, stay in PR B.
- **D-4397** — Wave 2's weekly interval is not declared in wave 1, although §8's single-definition row lists it among the L0 declarations. Nothing in wave 1 reads it; a constant with no reader would be dead code, and `single-definition.test.ts`'s seven-day literal ban (`server/test/single-definition.test.ts:4774-4780`) only matters once a reader exists, which is wave 2's first PR.

- **D-4399** — RULED by the operator, 2026-10-07 about 21:13 UTC: "Has a CCRC_AGENT_TOKEN line" (the narrowing below, not the README alternative). Spec 4.10 says the both-role writer never acts "when `~/.ccrc/agent.env` exists, because that marks a fleet box". The README's own single-box setup (README.md:545-546 at 282e79e44) writes `~/.ccrc/agent.env` with `CCRC_SERVER_URL` alone, because `ccrc-api`, `ccd-pool-sync` and `ccd-update-sync` read the address from that file and from nowhere else. Read literally, the spec rule leaves every single box set up by the README unarmed: its fleet copy is never written, the gate holds on `role-unrecorded` (a word that names the wrong remedy), the leaked value never retires there, and once A4 makes `/api/notify` fail shut its `notify.sh` is refused. This plan narrows the marker: `agent.env` marks a fleet box when it has a line whose KEY is `CCRC_AGENT_TOKEN` (every `ccrc install --role fleet` writes that key, `ccd/ccrc:12928` at 282e79e44; the README's single-box line never does), or when it cannot be read; an absent file, or a readable one with no such key, does not. The check reads key names only, inside the process, and keeps no value (`readAgentEnvMarksFleet`, Task A5; the shell twin in Task B5). The spec's purpose is kept: a server started in a fleet box's real HOME without `CCRC_FLEET=remote` still never writes the live fleet file, because that box's `agent.env` carries the agent token. The alternative the operator may rule instead (the README block stops writing `agent.env` and `ccrc-api` gets another address source on a both box) would replace Tasks A5's `readAgentEnvMarksFleet` with a presence check and change B7's README block; The coordinator assigned the number in the same act as the ruling.
- **D-4398** — (assigned by the coordinator, 2026-10-07: a technical narrowing that keeps §6's stated intent, that an unreadable read is never treated as behind) Spec §6's row "The generation file cannot be read" says "Unknown, so hold; it is never read as behind". `nextAction` answers `none` for an unreadable read when nothing is owed, and lets an OWED rotation proceed, rather than holding with a new `TOKEN_HOLDS` word. The hold the row asks for is a hold on the "behind" inference, which the plan keeps (an unreadable read never stages a `fleet-behind` rotation, pinned by `token-policy.test.ts`'s "an unreadable generation read is never behind"). Holding an owed rotation on it would block the first rotation whenever the read is merely unmeasured (a slow agent link), although the op result confirms without the file. The state stays visible without a hold word: `view().fleetConfirmed` reads `unreadable` and the card says "the fleet box's generation file could not be read".
- **D-4400** — (Task A6, controller ruling on review) The plan's `promotedState` set `pending: []`, discarding every other pending value on a promotion, including a LATER handed-out one. The spec is binding: "a handed-out value is dropped only when a later value is confirmed or the fleet itself reports the code used". Sequence: G handed out and its result lost; past `confirmBy` a forward rotation hands out G2 and its result is lost too; a generation read still showing G promotes G and dropped G2; the fleet's verb then writes G2 and the next presentation is a 401. `promotedState(X)` now keeps the pending entries that were handed out (`handedOutAt !== null`) and whose `seq` is greater than X's, and drops the rest (earlier ones, and values never handed out). G2's own later confirmation then promotes it normally. Pinned by `token-policy.test.ts`'s "promoting an earlier handed-out value keeps a LATER handed-out one accepted" and "promotion drops earlier values and later values never handed out".
- **D-4401** — (Task A6, controller ruling on review) The plan's `applySyncResult` answered `{kind:'predates-op'}` by dropping the staged value with no failure, no hold and no backoff, so an agent that advertised `token-sync` yet answered `bad-request` made the driver re-stage and re-send on every tick, invisibly. `predates-op` is now learned as the hold `agent-predates-op` (already a `TOKEN_HOLDS` word), exactly like `verb-missing` and `stale-client`: never a failure, returned in `learned`, honoured by `rotationGate` as a learned hold and re-probed on a fresh ready (`lastReadyAt > learned.at`) or after `HOLD_REPROBE_MS`. The learned-hold union (`GateInput.learned`, `applySyncResult`'s `learned`) widens by `'agent-predates-op'`. A value never handed out is still dropped; a handed-out one is kept. `unsent` stays a silent drop. Pinned by "predates-op is learned as the agent-predates-op hold, never a failure" and "a learned agent-predates-op hold stands until a fresh ready or the hourly re-probe".
- **D-4402** — (Task A6, controller ruling on review) The plan's `nextAction` bypassed backoff with `why !== 'rotate-now'`, but while a rotation is owed `why` is the owed reason, so "Rotate now" never bypassed backoff in exactly the stuck first-rotation case the operator presses it for. The bypass now tests `i.rotateRequested`, not the `why` word; the staged `why` is unchanged. Pinned by "\"Rotate now\" bypasses backoff also while a rotation is owed".
- **D-4403** — (Task A5, controller ruling on review) Two departures. (1) The plan's `isBoxTokenState` check was partial: it left seven `BoxTokenState` fields unchecked (`recovering`, `holdNode`, `lastFailure`, `lastSync`, `retiredRefusedAt`, `mintFailedAt`, `lastBootRecovery`) and checked `promoting.id` only as a string, although its docstring promises every reader of a field the type the field declares. A parseable but malformed `box-token.json` would then crash a consumer (A7's recovery arm dereferences `recovering.source`; `paths.pending(id)` throws on a malformed id). Each of the seven fields must now be present and null or its declared shape (`recovering` and `lastBootRecovery` carry a `pending`/`previous` source; `lastSync.transport` is one of `TOKEN_TRANSPORTS` or `unmeasured`), `promoting.id` must match `GENERATION_ID_RE`, and anything else reads `unusable`; `fileProblem` stays optional. Pinned by "a state with a missing or malformed field reads unusable ...". (2) (final whole-branch review) The plan's `readState` and `readRetired` folded EVERY read failure but ENOENT (EACCES, EIO, EISDIR) into `unusable`, the answer for malformed content: an overloaded seam, which let boot take a transient read error for "no history", rewrite `box-token.json` and lose the hand-out record, the owed reason and the counters. Both readers now answer a distinct `{ kind: 'unreadable'; code }` (declared in `ports.ts` beside `ValueRead`'s own `unreadable`); ENOENT stays `absent` and malformed content stays `unusable`. Boot refuses on an unreadable state or retired file, throwing an Error that names the path and the errno only (like `mail.token`'s own read error) and writes nothing; at run time the one driver read of the retired list (at retirement) keeps the list in memory on `unreadable` and warns once. Pinned by `token-files.test.ts` "a state or retired file that cannot be read answers unreadable with the errno word, never unusable", `token-boot.test.ts` "an unreadable %s file refuses boot, naming the path and the errno only, and writes nothing over it" (state and retired) and `token-rotation-e2e.test.ts` "a retired file that cannot be read at grace end: one warning, the tick survives, the previous value is still retired".
- **D-4404** — (Task A7, worker departure from the prototype's `boot.ts`) Five arms the quoted code did not have, each pinned by a case added to `token-boot.test.ts`. (1) `finishPromotion` renames the pending file over `mail.token` only when `mail.token` is absent, a usable value, or unusable AND the server's own write (origin not adopted, `provedWrite` against the current record); over a placeholder, an unreadable file or a hand-made unusable one it abandons the promotion, so the main read refuses boot as today (spec 4.2.1: a hand-made file still refuses; the prototype renamed over any of them). (2) After a boot-finished promotion whose first arm runs, the previous slot is kept only when the old current was copied to it (`promotedState`'s own contract, `previousWrite` null otherwise); the prototype labelled whatever `mail-previous.token` held with the old current's id, and that stale file is now deleted. The "(c) already done" arm still labels whatever `mail-previous.token` holds, from a bare lstat: a boot-finished promotion that skipped (b) and then crashed between the rename and the removal of that previous file can re-accept a stale value for up to `GRACE_HARD_MS`, a retired one still being refused. (3) The pending files of the values `promotedState` drops are deleted when boot finishes a promotion (spec §5 step (d), "discard the other pending values"); the prototype left them orphaned. (4) A mint whose write rejects from the post-rename directory fsync (the file WAS replaced, durability unproven) reads the file back and, when it holds the minted value, boots with it recorded and warns `could not confirm the directory sync …`; the prototype booted unconfigured with a value already in `mail.token`. (5) A recorded promotion finished over a torn `mail.token` that the server wrote (unusable and `provedWrite`) is a recovery from the pending sibling, not a plain promotion: boot warns with the contract's recovery line naming the pending file, owes a forward rotation (`owedWhy` `recovered`) and records `lastBootRecovery` with source `pending` (spec 4.2 step 2, 4.2.1 act (c)); an absent or intact old `mail.token` stays a plain promotion. An unusable `box-token.json` follows the plan's arm unchanged (treated as no state, value files unverifiable, then rewritten); a hand-made unusable `mail.token` beside it still refuses boot and leaves the state file byte-identical.
- **D-4405** — (Task A8, controller ruling on preflight) The plan's `ClaimDoor` spelled the code's expiry as `now + CLAIM_CODE_TTL_MS` and the burned-code age filter as an inline `now - x.at < BURNED_CODE_KEEP_MS`; the shipped door calls A6's `codeExpiresAt(now)` and `keepBurned(burned, now)` instead, and imports neither constant. Task A6 had already shipped both functions, and `codeExpiresAt`'s own docstring says "the door spells TTL nowhere else"; keeping the plan's two copies would have made that sentence false and left one rule in two places, so a later change to the TTL or the burned window could move the verdict's arithmetic and the door's apart. `keepBurned` also caps the list at `BURNED_CODES_KEPT`, which the verdict applies to the same list, so the door's pre-filter and the verdict can no longer disagree. `token-claim-route.test.ts` pins it (the door's source names neither constant and calls both functions; a burned code ages out through `keepBurned`).
- **D-4406** — (Task A9, controller ruling) The plan's `drainDoorAlerts` emptied the door's `alerts.expired` and `alerts.wrongNode` lists and discarded nothing, although `ClaimDoor`'s docstring and its own warning promise "the driver must discard" (and "the generation will be discarded"): a code burned by its TTL or by a claim from the wrong node left its generation staged, in the holder's slot and on disk, so the promise was false. `drainDoorAlerts` now acts: for every generation in either list that is still in `pending` and NOT handed out (`handedOutAt` null), the driver revokes its code, drops it from the state and the holder and deletes its pending file (idempotent, then persists); a handed-out value is never dropped this way (spec: only a later confirmation, or the fleet reporting the code used, drops one); `wrongNode` still owes `claim-misbound`. Pinned by `token-rotation-e2e.test.ts`'s "a burned code (expired|wrongNode) discards its staged generation …" and "a HANDED-OUT generation is never dropped by an alert".
- **D-4407** — (Task A9, controller ruling) The plan's `retire()` compared `s.retiredRefusedAt === now` against the reading `runTick` took before the retirement, while `retireValue` stamped `retiredRefusedAt` from a later `this.now()` reading, so the grace-retirement line almost never ended " and is refused" although the self-check had refused the value. `retireValue` now returns whether the self-check refused it (the stamp it wrote is the only reading of "refused"), and `retire()` prints from that answer; `retire()` no longer takes a clock reading. Pinned by `token-rotation-e2e.test.ts`'s "grace retirement prints \" and is refused\" when the retired value is refused, however the clock moves between readings".
- **D-4408** — (Task A9, implementer's deviation, accepted by the controller on review) A `writeValue`/`renameOver` rejection from the post-rename directory fsync means the target WAS replaced with its durability unproven (`TokenStore`'s own contract), but the plan's driver treated every rejection as "target unchanged". Five arms now treat the target as unknown and re-read it. (1) `stage`: a rejected pending-file write removes that file (the generation id is recorded nowhere, so it would be an orphan holding a value). (2) `retryMint`: a rejected `mail.token` write is read back and, when it holds the minted value, the mint is recorded and warned `could not confirm the directory sync …` (boot's own D-4404 item 4), instead of staying unconfigured over a file already replaced. (3) `promote` step (c): a rejected rename is followed by a re-read of `mail.token`; when it carries the promoted value (c) is done and the promotion goes on in the same tick; otherwise the error stands and the next tick retries. (4) `promote` step (b) is written from the old current still in memory on every attempt, also when (c) already happened, so a retry after a completed rename keeps the previous slot and its grace (the plan skipped (b) when the pending file was gone and then promoted with no previous value). (5) `promote` reads `mail.token` back also when the pending file is already gone: it usually is this promotion's own rename, but a file removed out of band looks the same, so when `mail.token` does not carry the promoted value the fleet-confirmed value is rewritten from memory (atomically, one warning, no value printed) and the current generation's write record follows the new file; the plan promoted over a file that never received it. A `writeState` rejection needs no arm of its own: the driver's memory is authoritative and its next `commit` rewrites the file. Pinned by `token-rotation-e2e.test.ts`: item (1) "staging: a pending file written but rejected is removed; nothing is sent"; item (2) "mint retry: a mail.token written but rejected is read back and kept, not retried over"; item (3) "promotion: a rename that happened but rejected is re-read, the value is current and the old one stays in grace"; item (4) "the rename done and a later step failing: the next tick finishes it and the old value stays accepted as previous"; item (5) "a pending file deleted out of band: mail.token is rewritten from memory with the promoted value, and the record follows it"; the `writeState` remark by "hand-out: a state record written but rejected leaves no handed-out record on disk and no pending file (pin)".
- **D-4409** — (Task A9, controller ruling on review; items (5) to (7) from the final whole-branch review) Seven departures from the plan's driver, each found on review. (1) `setHold` changed `state.hold`/`holdNode` in memory only and no hold tick committed, so `box-token.json` never recorded a hold while the view showed it; Part B's doctor reads `held:<TokenHold>` from that file and would have reported a plain owed rotation with the wrong remedy. The hold is now persisted through the serialised `commit` whenever it or its node actually changes, and cleared there the same way. (2) `presentedBase` was taken after `commit(next)`, while the new current is already accepted from `pushSlots`, so a presentation in that window was folded into the base and never counted as "the new value was presented"; it is now taken in the same synchronous step as, and before, the slot swap. (3) `retryMint` would have overwritten `mail.token` on a null state that no failed boot mint explains (`nextAction` asks for a mint on a null state); it now does nothing, with one warning, unless a mint actually failed. (4) `send` did not revoke its claim code when `link.send` threw; the revoke is now in a `finally`, so a code never outlives its op. Pinned by `token-rotation-e2e.test.ts`: item (1) "the hold is recorded on disk and cleared there" and the on-disk assertion in the LIVE SAFETY case; item (2) "the new current presented while its record is being written is counted as presented"; item (3) "a null state with no failed mint leaves mail.token as it is, warns once, and sends nothing"; item (4) "a link that rejects still has its code revoked". (5) `commitHandOut` persisted the hand-out from a snapshot taken before its `await` and assigned that snapshot to memory afterwards, so an op result lost while the write was in flight (a link drop, or a timeout behind a slow fsync) was folded over a state in which the generation was not yet handed out: `send` dropped the generation (file, holder slot) as unclaimed, the late assignment brought back a record with no value, and the route still answered 200 with the value, which the server then refused (401) while `promote` found no value for the generation and warned on every tick, forever. The hand-out is now applied to memory in the same synchronous step as the staged check, before the write, as `commit()` does, so any concurrent fold sees it handed out and keeps it; a failed write still discards the generation and rejects (503). The promote guard, when the named generation has no value in memory, now also drops that pending entry (persisted) with one warning. Pinned by `token-rotation-e2e.test.ts` "a lost op result while the hand-out is being written keeps the value accepted; the 200 carries it; a later generation read promotes it" and "a promotion naming a pending entry with no value drops it, once". (6) The plan counted only a match on `current` as the new value being presented, and nothing presents it on a recorded `both` box (no proof call, no `ccd-pool-sync.timer`), so an idle one extended each grace, owed `fleet-behind`, and staged another own-write rotation every grace end (measured: 12 promotions an hour). `promotedState` now records the new current as presented when the promotion is an own-write (the server's own write of the fleet file is the presentation) or when the generation was matched in a pending slot after its hand-out (the fleet's proof call, spec §5); the decision is `promotionPresentsCurrent` in `policy.ts`, and the driver only attributes each pending-slot match to the generation that held the slot. Pinned by `token-rotation-e2e.test.ts` "a recorded both box, adopted value, an hour of idle ticks: exactly one promotion" and "a fleet proof call against the pending value counts as the new current being presented", and `token-policy.test.ts` "promotedState: an own-write promotion, or a generation already presented while pending, records the new current as presented". (7) `discard` deleted a generation's file before it removed the value from the holder and the state, so a delete that failed (EACCES, EIO) threw mid-way and left a dropped value (for instance one an outside party had claimed, `code-used`) still accepted, and still recorded, so that it returned after a restart. It now removes the value from the code door, the holder and the state (persisted) first, then deletes the files, warning on a failed delete; a failed delete leaves only an orphan file, which boot treats as unverifiable (a restart before the file is removed can re-accept it as such until a rotation drops it), an accepted cost that needs a failing delete AND a restart. Pinned by `token-rotation-e2e.test.ts` "a staged file that cannot be deleted leaves an orphan file only".
- **D-4413** — (fix round 1, coordinator ruling; review 349, I4) The pending cap gets an exit. The plan's gate held `pending-cap` while two handed-out values stood unconfirmed, and nothing but a generation read naming one of them, or a `code-used` result, could drop them: two lost hand-outs (or two unverifiable pending files found at boot, parked A7 m3) held the gate for good, kept both values accepted indefinitely against §6's "at most the confirm deadline plus one sync", and `rotateNow` answered `joined` while nothing ran. The ruling: while BOTH pending values at the cap are past `confirmBy`, a forward rotation may stage into a third pending slot (`pendingExitOpen`, `PENDING_HARD_CAP = 3`); its confirmation drops both older values, by the existing rule that a value leaves when a later one is confirmed (`promotedState`, D-4400). There are never more than three pending values and the third slot exists only for this exit (the gate holds `pending-cap` at three handed out, and `nextAction` stages nothing while three are pending). The holder's fixed-slot compare grows by exactly one slot (`pending2`, five slots), still the `|=` fold with the comparator called once per slot. "Rotate now" answers `joined` only while a send or a promotion is actually in flight (a send running, or a promotion running or recorded; an earlier press's leftover flag is not an in-flight rotation, so a press whose own tick has not reached its send is answered by the gate, the cap's hold or the rate limit, never `joined`; part B task R0, review 352 F5); a press during a confirm wait or an own-write backoff answers `started` and may stage one more rotation once that wait ends. At the cap with nothing in flight it answers the `pending-cap` hold (through the existing `held` answer, before the rate limit; state-machine m1). Boot clause: boot's unverifiable pending files take the same exit, so the boot reader keeps up to the cap of three (`unverifiable()`), never dropping the exit's value, and they carry `confirmBy` like any handed-out value. Review F4 rides on the cap: `readState` answers `unusable` with an additive `why: 'over-cap'` for a state whose `pending` list is longer than the cap and which is otherwise valid up to the cap (entries past the cap are not validated, so a malformed one there also reads over-cap; this fails safe, because boot adopts neither: an over-cap state refuses boot, and any other unusable state takes D-4414's set-aside posture, a fresh current minted and a rotation owed; part B task R0, review 352 F13), and boot REFUSES it with an error naming the path and the word only, writing nothing over the file, instead of dying on the holder's RangeError; any other malformed state keeps the plain `unusable` arm (D-4403's, whose handling D-4414 replaced with the set-aside posture). Pinned by `token-policy.test.ts` ("the pending cap has an exit"), `coord-token.test.ts` (the five-slot compare), `token-files.test.ts` and `token-boot.test.ts` (the over-cap reader and refusal, three unverifiable files) and `token-rotation-e2e.test.ts` ("the pending cap has an exit": after two lost hand-outs the exit rotation runs and confirms and both older values leave; Rotate now at the cap answers the hold, also within a minute of an earlier press; a press during a confirm wait answers `started`).
- **D-4410** — (fix round 1, coordinator ruling; review 349, F1 and security M2) A retired value's record is never lost, and an unusable retired file never lets a foreign value in. The digest is durable BEFORE the value leaves the accept set: the state change that retires a value writes its sha256 into `box-token.json` (the optional `retiring` list of `{sha256, at}`, checked entry by entry by `isBoxTokenState`; absent and `null` read as none) and only then empties the slot, deletes the file and appends to `box-token-retired.json`. The record stays until that append has landed; a failed append is retried from it on every driver tick (warned once while it stands, never the digest or the value), and a failure never drops the digest. If the record itself cannot be written, the value is NOT retired: it stays accepted and the tick retries. This number records the exception to "a digest is never persisted except in the retired file": a digest awaiting its append is also in `box-token.json`, nowhere else, never in a log, a warning or `view()`. Boot reads the digests in force as the retired file's plus the `retiring` record's, so a value whose append never landed is refused after a restart (sec-M2: ENOSPC on the append, then a restart). At boot a retired file that reads `unusable` (read, but not the shape) never lets boot adopt a value it cannot match to its own write record (`foreignUnderUnusableRetired`, L1: only a current whose (dev, ino, mtime) match `state.current.write` stays): a server-written current stays current; any other `mail.token` (a hand-made value, a value written back, an adopted current that has no record) is not adopted: boot mints a fresh current, owes a forward rotation with the existing word `retired-written-back` (the fleet resyncs by code, which needs no box token) and warns once. The unusable file is moved aside as `box-token-retired.json.unusable-<boot time>` (then `-1`, `-2`... when a name is taken, by a hard link that refuses an existing name; it never overwrites) after boot's decisions and just before it records `box-token.json` (so a boot that refuses for another reason leaves it where it was), and a fresh list starts. The digests that had landed in the set-aside file are not read back, so the posture outlives that boot: while ANY set-aside retired file stands (a directory listing of the names `moveAsideUnusable` makes; its content is never read), every boot keeps the same foreign posture as the unusable case, so a `mail.token` boot cannot match to its own write record is never adopted (mint fresh, owe `retired-written-back`, warn once, the warning naming the set-aside file and saying that removing it after review is what allows a hand-made value to be adopted again). A retired digest whose append has landed is also taught to the holder before the record is cleared, so a failing clear never leaves a retired value counted as plain bad. Listing the directory for those names is fail-closed: only a proven ENOENT of the directory means none, and any other failure (EACCES on a -wx directory, which opens its files but cannot list them; EMFILE; ENOMEM) refuses boot through `refuseUnreadable` (path and errno only, nothing written), because answering "none" would drop the posture and re-open the write-back hole; the set-aside name's mark is one definition (`SET_ASIDE_MARK`, `files.ts`). EACCES and every other read failure on the retired file read `unreadable`, so boot refuses (D-4403 item 2); `appendRetired` now names the two outcomes apart too (it reported an unreadable file as "unusable"). Pinned by `token-boot.test.ts` (F1's sequence: an unusable retired file, L written back, a restart, L refused; a foreign value; the server-written current stays; one warning and the set-aside, never overwriting; EACCES and EISDIR refuse; the `retiring` record refuses a value the file lacks), `token-rotation-e2e.test.ts` (sec-M2's probe: ENOSPC on the append, then a restart with L written back, L refused and the record landing; the retry; the digest in `box-token.json` before the value leaves; a record that cannot be written keeps the value accepted; F1's sequence through the driver; nothing printed), `token-files.test.ts` (the `retiring` shape, unreadable versus unusable, `moveAsideUnusable`) and `token-policy.test.ts`.
- **D-4411** — (fix round 1, coordinator ruling; review 349, F2) A later generation that the fleet confirmed is a third exit from Previous. When the fleet confirms a generation while a previous value is still in grace, the promotion may retire that previous value early, because the fleet has confirmed a later value and G3 holds. This adds a third exit to spec Figure 5's two ("grace passed and new current presented", and "the hard bound"). The early retirement goes through the same `retireValue` as the `retire` action, so it records its digest as D-4410 requires, and it logs a line of its own (spec §7.1) that says the fleet confirmed a later generation (it carries no id): `the fleet confirmed a later generation; the previous value was retired early`, with ` and is refused` when the self-check refused the value. The fix round first reproduced the `retire` action's `grace ended` verbatim as ruled; part B task R0 (review 352) changed the line only, because a confirmed later generation, not the grace, ended the value, and the rule is unchanged. Pinned by `token-rotation-e2e.test.ts` ("a later generation the fleet confirmed retires a previous value early": the probe's sequence, L retired at the second promotion with its line, its digest recorded, and refused afterwards; and the same with a failed append, refused after a restart).
- **D-4412** — (fix round 1, coordinator ruling; review 349, state-machine I3) A retired value presented on a box-token lane owes one forward rotation, within a bound. A retired presentation, on any box-token lane, makes a rotation owed with its own owed word, `retired-presented` (added to `OWED_REASONS`, additive), as well as today's count and warning. The server cannot tell the fleet from the holder of the leaked value, so the bound is the protection: nothing new is owed while a rotation is owed or in flight (owed, staged, handed out, promoting, or a send or promotion running); presentations owe at most one rotation per `HOLD_REPROBE_MS`; the gate, the one-at-a-time rule and backoff apply as they do to every rotation (the owed state is an ordinary owed rotation). The decision is `oweForRetiredPresentation` in `policy.ts` (L1); the driver only feeds it the holder's new retired count and the clock, and keeps the time it last owed one in memory (a restart resets that clock, while the owed flag itself is persisted). Pinned by `token-policy.test.ts` (each condition alone) and `token-rotation-e2e.test.ts` (I3's fleet-only write-back is resynced with no 401 after the first; a flood owes exactly one rotation per `HOLD_REPROBE_MS`; nothing new is owed while a rotation is owed; a closed gate sends nothing). R0 (review 352 F9) removed the dead `busy` input of `oweForRetiredPresentation` and the policy case that fed it: the "a send or promotion running" condition holds through `pending` and `promoting` (a send leaves a pending value, a promotion records `promoting`, and the driver weighs presentations only in a tick's preamble, where ticks are single-flight), and the e2e case "F9: a retired presentation made while a send is in flight is weighed on the next tick, not lost, and owes one rotation" pins it.
- **D-4414** — (part B task R0, coordinator ruling; review 352, F1, F2, F3 and F6) No path retires or drops a value without its durable digest, and no failure makes boot adopt a value it did not write. This extends D-4410, and it replaces the first clause of the last sentence of D-4404 (an unusable `box-token.json` follows the plan's arm unchanged: the value beside it is adopted as unverifiable). D-4404's other clause stands: a hand-made unusable `mail.token` beside an unusable state still refuses boot and leaves the state file byte-identical. (F1) A `box-token.json` that reads `unusable` takes D-4410's foreign posture, exactly as an unusable retired file does: it is set aside as `box-token.json.unusable-<boot time>` (then `-1`, `-2`..., by a hard link that refuses an existing name; it never overwrites) after boot's decisions and just before the new record is written, a fresh current is minted and a forward rotation is owed under `retired-written-back`, and no `mail.token` that boot cannot match to its own write record is adopted. The `retiring` record, the only durable home of a digest whose append had not landed, lived in that file, so the posture outlives the boot as the retired file's does: while ANY set-aside state file stands (a directory listing of the names; its content is never read) every boot keeps the posture. A state file that cannot be moved aside refuses boot (path and errno only), because writing the new record would overwrite what it holds; an over-cap or unreadable state keeps D-4413's and D-4403's refusals. The accepted cost of this ruled rule: any unusable `box-token.json` (damage, or a rollback below a build that writes a newer `v`) now forces a fresh mint. On a remote fleet the old shared value is then refused until a code resync lands, and while `verb-missing` or `agent-predates-op` holds the gate there is no automatic end to that 401. A recorded both box is unaffected, because boot's armed write resyncs the fleet file. (F3) A value file is never deleted before its digest is durable. `retireValue` keeps a previous file it cannot READ (EACCES, EIO), with the `previous` record: nothing is deleted or cleared, one warning (no value, no digest) is printed while that stands, the read is retried on later ticks, and the retirement blocks nothing else (`nextAction`'s `retireHeld`); a promotion that would retire a previous value early waits the same way, because its step (b) would replace that file. Boot's auxiliary arm likewise keeps the record and the file of an unreadable previous file (slot empty, a rotation owed, a warning); an unusable one (read, no value) is dropped as before. The accept set still drops the value at its hard bound, in memory (the holder's slot, and the dummy slot after it). (F2) On a recorded both box a failing own-write never blocks the previous value's retirement at its hard bound: `nextAction` answers `retire` once `hardUntil` has passed BEFORE its own-write branch, so the digest is recorded whatever the fleet-file write does. (F6) A failed mint keeps its owed rotation: `BootResult.mintOwed` carries the word the failed mint owed (`retired-written-back` for a foreign or written-back value, `recovered` for a missing file with history, null for a first mint), and the driver's `retryMint` owes it. Pinned by `token-boot.test.ts` ("F1's sequence, a version this build does not read (v:2)" and "..., one malformed retiring entry"; "boot 2 and after: while the set-aside state file stands, a written-back value is still not adopted"; "an unreadable mail-previous.token: the record and the file stay"; "a foreign value under an unusable retired file and a mint that fails: BootResult names retired-written-back"), `token-policy.test.ts` ("D-4414 F2: the hard bound retires the previous value before the own-write branch") and `token-rotation-e2e.test.ts` ("D-4414 F2: ... own-write failing persistently past hardUntil, then L written back and a restart: L is refused"; "D-4414 F3: ... the driver keeps it, warns once, and records the digest once a read works" and "a promotion over an unreadable previous value does not overwrite its file"; "D-4414 F6: ... the rotation owed is retired-written-back and the fleet file is rewritten").
- **D-4551** — (Task B5 fix round 1, run 350 worker ruling, reported to the coordinator in the wave-done; review of B5, I1) Doctor reports the two stalled retirements that D-4410 and D-4414 made reachable after the brief was written, as two doctor-local server words (like `pending-overdue` and `fleet-unconfirmed`: no L0 change, nothing in `shared/`). `retire-overdue:<minutes>`: `previous` is set and the clock is past `previous.hardUntil` by more than one driver tick (`_BT_TICK_MS` = `DRIVER_TICK_MS`, 60 s, pinned to the policy constant; the slack lets the tick that retires it run). It is reachable because `retireValue` keeps a previous file it cannot read and returns `held` on every tick (D-4414, F3), so the retirement stalls past the spec section 5 hard bound of 1 h. The holder has already dropped the previous value from memory at that bound, so nothing retired is accepted; the risk is that the value's digest is not yet recorded as retired, so a value written back would be adopted at the next boot. The spec says the previous value is retired anyway, and a FAIL names the stall. `retiring-unlanded:<minutes>`: the oldest `retiring[].at` (D-4410) is older than two driver ticks (one tick for the append to run, plus one tick of slack), so the append to `box-token-retired.json` keeps failing and `box-token.json` holds the only durable copy of that digest. In wave 1 both print `SKIP box-token: <word> — <sentence>; reported as SKIP until the FAIL and WARN arms ship`; with `_BT_ARMS_ON=1` both are FAIL, each with a remedy line. Why: Review Focus 4 requires every stuck retirement to SKIP with its word, never PASS, and the brief's check printed `PASS … the previous value in grace` for the first (`hardUntil` was validated and never compared with the clock) and `PASS … retired value refused` for the second. "In grace" is now printed only while the clock is at or before `hardUntil`, and a finding of either word removes every PASS part of the server arm's line. Pinned by `doctor-box-token.test.ts`: a SKIP row and an armed FAIL row for each word, the in-grace PASS case, the slack case, the young-digest case, and mutations that drop the `hardUntil` compare, the `retiring` check and the `now <= hardUntil` grace guard (the report's rows).

Numbers 4398 to 4417 are reserved for the coordinator to assign (the Global Constraints' deviation rule); no worker takes one itself.

## Tasks

The full task sections follow this index, Part A then Part B, each in task-id order. Every section's **Files** list is its `git add` set.

Part A (run 320). **Execution order: A1, A2, A3, A4, A6, A5, A7, A8, A9.** A5's `files.ts`/`ports.ts` import types A6 declares and `token-files.test.ts` builds a state with A6's `mintedState`, so A6 runs before A5; A8 imports A5 (`mintClaimCode`) and A6 (`claimVerdict`, the door constants), so it runs after both; A9 imports A8's `ClaimDoor` and `TokenRouteDriver`.

- **A1** — L0 token-sync words, bounds, wire and the ninth node file. Files: `shared/agent-protocol.ts`, `shared/box-token.ts` (new), `server/src/update/inventory.ts`, `server/src/readiness.ts`, `agent/src/whitelist.ts` (docstrings), `agent/test/whitelist.test.ts`, `server/test/single-definition.test.ts`, `server/test/token-shared.test.ts` (new). Consumes: `NODE_FILES`, `updateLauncherPath`, `UPDATE_OP_DETAIL_MAX`, `ReadFailure`. Produces: every L0 name in Interfaces' two L0 blocks (with `GENERATION_ID_HEX`, `GenerationFileInput`, `TOKEN_FILE_PROBLEMS`, and `BoxTokenView.stalled`/`fileProblem`).
- **A2** — The `token-sync` agent op. Files: `agent/src/tokensync.ts` (new), `agent/src/server.ts`, `agent/CLAUDE.md`, `README.md` (the agent section's read-grant count and a token-sync op bullet), `agent/test/token-sync-op.test.ts` (new), `agent/test/update-op.test.ts`, `server/test/update-spawn-twin-bodies.test.ts`, `server/test/whitelist-subset.test.ts`, `server/test/remote-connect.test.ts`, `server/test/update-inventory.test.ts`. Consumes: A1's op words, argv, bounds, `isClaimCode`. Produces: the agent block in Interfaces (`TokenSyncSpawn`, `TokenSyncEnv`, `tokenSyncEnv`, `makeTokenSyncSpawn(env: TokenSyncEnv)`, `tokenSyncAnswer`), `AgentOpts.spawnTokenSync`, the op on the wire, `ready.ops` word.
- **A3** — The accept-set check and `BoxTokenHolder`. Files: `server/src/coord/token.ts`, `server/src/server.ts` (Deps type, two lane arguments), `server/src/coord/routes.ts` (eleven lane arguments), `server/src/update/routes.ts` (one lane argument), `server/test/coord-token.test.ts`. Consumes: nothing new. Produces: `BoxTokenHolder`, `HolderSlots`, `TokenSlot`, `matchDigestSlots`, exported `extractToken`, widened `checkMailToken`.
- **A4** — `/api/notify` fails shut. Files: `server/src/server.ts` (notify handler), `server/src/auth/gate.ts` (reason 2's notify paragraph, the notify EXEMPT reason; order-pinned numbers kept), `server/src/coord/routes.ts` (the legacy detail), `server/src/coord/token.ts` (docstring), `README.md` (D-4396), `server/test/notify-token.test.ts` (its absent-token and no-token-configured cases, lines 61-80 at 282e79e44, flip to 401), `server/test/routes.test.ts` (the notify-ingestion pair presents a token); `server/test/box-token-census.test.ts` and `server/test/auth-gate.test.ts` are run unchanged to prove reason 2's order-pinned numbers did not move. Consumes: A3's `checkMailToken`. Produces: `/api/notify` answering 401 on `legacy`, `unconfigured` and `bad`.
- **A5** — Token file adapter and ports. Files: `server/src/token/ports.ts` (new), `server/src/token/files.ts` (new), `server/test/token-files.test.ts` (new). Consumes: A1's `FLEET_TOKEN_FILE_COMMENT`, `TOKEN_VALUE_RE`, `GENERATION_ID_RE`, `CCRC_DIR_NAME`, `NODE_FILES.tokenGeneration`, `TOKEN_FILE_PROBLEMS`; A3's `extractToken`, `PLACEHOLDER_TOKEN`; A6's types and `mintedState`. Produces: `TokenPaths`, `tokenPaths`, `ValueRead`, `FileMeta`, `StateRead`, `RetiredRead` (declared in `ports.ts`, re-exported by `files.ts`), `readValueFile`, `writeValueFileAtomic`, `renameOverAtomic`, state and retired readers and writers, mints, `fleetFileText`, `writeFleetTokenFile`, `writeGenerationFile`, `fileExists`, `readAgentEnvMarksFleet`, `fileTokenStore`, `fileBothRoleWriter`, the five ports. Runs after A6.
- **A6** — Rotation policy. Files: `server/src/token/policy.ts` (new), `server/test/token-policy.test.ts` (new). Consumes: A1's L0 words; `BUSY_UPDATE_STATES`, `IN_FLIGHT_UPDATE_PHASES` from `shared/api.ts`. Produces: `BoxTokenState`, `PendingGen`, `WriteRecord` type, every timing constant (with `TOKEN_FILE_REREAD_MS` and `STALL_ALERT_MS`), the state helpers (`mintedState` with its generation id), `rotationGate`, `bothRoleWriterArmed`, `claimVerdict` and its types, `nextAction`, `confirmedGeneration`, `applySyncResult`, `retireDue`, `backoffMs`, `phaseOf`, `recoveryPlan`.
- **A7** — Boot: mint, adopt, recovery, retired refusal and the both-role boot write. Files: `server/src/token/boot.ts` (new), `server/src/index.ts`, `server/test/token-boot.test.ts` (new). Consumes: A3 holder, A4's fail-shut notify (for the mixed-version case), A5 files, A6 `recoveryPlan`, `bothRoleWriterArmed`, state helpers. Produces: `bootBoxToken`, `BootInput`, `BootResult` (with `agentEnvMarksFleet`), the boot warnings; `index.ts` passing the holder as `mailToken`. Its boot-bound step is a gate before its commit.
- **A8** — The claim door, the rotate route and their census. Files: `server/src/token/door.ts` (new), `server/src/token/routes.ts` (new), `server/src/server.ts` (`Deps.tokenDriver`, `registerTokenRoutes` call), `server/src/auth/gate.ts` (seventh reason, EXEMPT entry, 88), `CLAUDE.md`, `README.md` (the claim door in the auth paragraph's exempt list), `server/test/token-claim-route.test.ts` (new), `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts`. Consumes: A1 claim words and shapes, A3 `matchDigestSlots`, A5 `mintClaimCode`, A6 `claimVerdict` and door constants. Produces: `ClaimDoor` (with the test-only `compare` option), `ClaimStep`, `TokenRouteDriver`, `registerTokenRoutes`, both routes, `CODE_DOORS`, `TOKEN_DOORS`. Runs after A7 (it was drafted in group 2, which is why its section's prototype note names stand-ins).
- **A9** — The driver, its link and a whole rotation in process. Files: `server/src/token/link.ts` (new), `server/src/token/driver.ts` (new), `server/src/index.ts`, `server/test/token-rotation-e2e.test.ts` (new). Consumes: A2's op on the wire, A5 store and ports, A6 policy, A7 `BootResult`, A8 `ClaimDoor` and `TokenRouteDriver`, `readNodeFile`, `openPoolReadDeadline`, `INVENTORY_BUDGET_MS`, `FleetClient.request`, `AgentOpError`, `LinkNotSentError`. Produces: `tokenSyncLinkOver`, `generationReaderOver`, `gateRowsOver`, `DriverDeps`, `BoxTokenDriver` (with `view()`), the driver started from `index.ts`.

Part B (the ledger's row 2), in order, built against Part A as merged:

- **B1** — `ccrc token sync`. Files: `ccd/ccrc-token-sync` (new), `ccd/ccrc` (dispatch through `cmd_token`, usage, `CCRC_CAP_WORDS`), `server/test/ccrc-token-sync.test.ts` (new), `server/test/ccrc-cli.test.ts`, `server/test/ccrc-install.test.ts`, `server/test/ccrc-update.test.ts`, `server/test/containedTools.ts`, `server/test/ccrc-containment.test.ts`. Consumes: A1's exit table, stderr prefix, synced line, claim path, code and generation shapes, `FLEET_TOKEN_FILE_COMMENT`; A8's claim door contract. Produces: the verb, its report file, the `token-sync` cap word, the shell-to-L0 parity scan (the synced line included), `CLAIM_DATA_LINE_ERE`.
- **B2** — `ccrc token probe`. Files: `ccd/ccrc-token-sync`, `server/test/ccrc-token-sync.test.ts`. Consumes: B1's address and token handling. Produces: the probe subverb and its one output line.
- **B3** — Uninstall and purge rules for the new files. Files: `ccd/ccrc` (uninstall), `server/test/ccrc-uninstall.test.ts`, `server/test/install-census.test.ts`. Consumes: the node-scoped file names (`NODE_FILES.tokenGeneration`, `token-sync.json`). Produces: uninstall removing the two non-secret files and leaving value and state files and `~/.cc-secrets/ccrc-mail.token`.
- **B4** — A rotation through the real verb. Files: `server/test/token-rotation-real-verb.test.ts` (new). Consumes: A9 driver, A8 routes, A2's agent op with `spawnTokenSync` running the real `ccd/ccrc-token-sync` under a fixture HOME against the in-process server on loopback, B1. Produces: the end-to-end and mixed-version proofs of spec 10.2 with the real verb (the verb-missing hold included). Not prototyped (it needs Part A merged); its first run is its measurement.
- **B5** — Doctor `box-token`, PASS or SKIP only. Files: `ccd/ccrc-doctor-checks`, `server/test/doctor-box-token.test.ts` (new), `server/test/ccrc-doctor.test.ts`, `server/test/ccrc-install.test.ts` (`BASE_LIVE_SHAPE`). Consumes: A6's `BoxTokenState` field names, A1's hold, owed and file-problem words, B1's `token-sync.json`. Produces: the check, its words, `_BT_ARMS_ON=0` and the armed arms behind it.
- **B6** — The console card and "Rotate now". Files: `shared/api.ts`, `server/src/update/routes.ts`, `pwa/src/lib/api.ts`, `pwa/src/fleet/useUpdatesView.ts`, `pwa/src/screens/SettingsScreen.tsx`, `README.md` (one Settings sentence), `pwa/test/box-token-card.test.tsx` (new), `server/test/update-routes.test.ts`. Consumes: A1 `BoxTokenView`, `RotateAnswer`; A8's rotate route; A9's `view()`. Produces: `UpdatesView.boxToken`, `rotateBoxToken`, `readBoxTokenView`, the card.
- **B7** — deploy.sh stops shipping the token; notify.sh hardening; the example, README and CLAUDE.md lines. Files: `deploy/deploy.sh`, `deploy/notify.sh`, `deploy/ccrc-mail.token.example`, `README.md`, `CLAUDE.md`, `server/test/install-coordinator-skill.test.ts`, `server/test/notify-addr.test.ts`, `server/test/coord-token.test.ts` (its notify.sh text pins at 147-236 at 282e79e44, which quote the curl line), `server/test/token-boot.test.ts` (the derived-both notify case). Consumes: A4's fail-shut notify, A7's boot mint. Produces: no `ship_secret`; notify.sh `set +x` and its no-token path (D-4393); the rewritten comment and README lines.

## After merge (coordinator, not a worker task)

These are not a worker's steps and no task's commit depends on them. They are what makes wave 1's PASS-or-SKIP doctor safe: doctor's exit code, its summary count and `ccrc update`'s exit 3 never see a SKIP, so a stalled first rotation is visible only on the console card (its alerts), in the server log and in the SKIP line, until the arms ship.

1. **The §10.3 post-landing proof**, read-only, never printing a value, due within 24 hours of the release that carries both parts reaching both boxes (`ccrc rollout`'s converged report). Read on the server box: doctor's `box-token` line names no hold (`ccrc doctor` shows `PASS box-token: server: generation #<n>, rotated <age> ago, fleet confirmed, retired value refused`, or a SKIP whose word says why not); `GET /api/updates`' `boxToken` shows `phase` `idle` or `grace`, `origin` `rotated`, `fleetConfirmed` `current` and `retiredRefused: true`; on the fleet box `PASS box-token: fleet: …, last sync proved`. Then `ccrc token probe --file deploy/ccrc-mail.token` from the checkout that holds the gitignored source token prints `probe: 401 refused`. Record the result in the programme ledger; the operator then deletes `deploy/ccrc-mail.token` (the ledger's Carried constraints).
2. **The arming PR**, as its own ledger row: flips `_BT_ARMS_ON=0` to `1` in `ccd/ccrc-doctor-checks` (the arms already ran in `doctor-box-token.test.ts`). Trigger: the GPT-lane programme's lane-1 B4 soak gate recorded closed (no new doctor WARN may ship while it is open). Bound: merged before wave 2's first PR (the weekly schedule), per the 15:30 ruling. The ledger's row 3 bundles this with wave 2 today; split it out so its trigger and bound are tracked.
3. If the proof finds the first rotation held or failed, the remedy is the console's named hold or a fix wave, never a hand rotation (the 11:06 ruling).

## Part A task sections (run 320)

Group 3 note (A5, A6, A7, A9): Drafted by a workflow agent on 2026-10-07 from main 282e79e44. Every step below was prototyped in an isolated worktree against scaffold implementations of A1, A3, A4 and A8 written from the contract's Interfaces (those tasks' own sections own their real text); the code shown here is the code that ran. Tests run as the Global Constraints' test rule says (one file per call, foreground, `TMPDIR` under `.tmp-<task>`). **Execution order inside group 3: A6, then A5, then A7, then A9** (A8 runs between A7 and A9; see the Tasks index). A5's `files.ts` and `ports.ts` import types that A6 declares (`BoxTokenState`, `WriteRecord`, `GateNode`, `SyncResult`, `GenerationObservation`), and `token-files.test.ts` builds a state with A6's `mintedState`; with A5 first, its commit would fail `typecheck-tests.test.ts`. The sections stay in task-id order.

### Task A1: L0 token-sync words, bounds, wire and the ninth node file

(prototype) measured: server/test/token-shared.test.ts: red (suite failed to load: `Cannot find module '../../shared/box-token.js'`), then 1 failed | 17 passed with L0 in place and the inventory unchanged -> green 18 passed; agent/test/whitelist.test.ts: red 1 failed | 24 passed -> green 25 passed; server/test/single-definition.test.ts: red 1 failed | 405 passed -> green 406 passed; server/test/update-inventory.test.ts (unchanged by this task): 1 failed | 89 passed under mutation M2 below; tsc --noEmit clean for server/, agent/, server/test/tsconfig.tests.json and agent/test/tsconfig.tests.json; 2026-10-07 on main 282e79e44

**Files:**
- Modify: `shared/agent-protocol.ts` — `AgentReady.ops` docstring (101); the `NODE_FILES` docstring (149-155, a paragraph appended), `NODE_FILES` (157-160, one key added), the `NODE_FILE_BASENAMES` docstring (162); `TokenSyncReq` after `UpdateReq` (328); `AgentReq` (332); the op-payload comment (347); the token-sync block inserted after `decideKilledSpawn` (after 625, before the `ReadFailure` docstring at 627).
- Create: `shared/box-token.ts`.
- Modify: `server/src/update/inventory.ts` — `MeasuredFileKey` (78), the `MEASURED_FILE_KEYS` docstring and filter (82-87) (D-4389).
- Modify: `server/src/readiness.ts` — docstring "eight" -> "nine" (52).
- Modify: `agent/src/whitelist.ts` — docstring counts only (59, 67, 76, 78, 87, 97, 102, 104, 115); no code change (the grant derives from `NODE_FILE_BASENAMES`).
- Test (create): `server/test/token-shared.test.ts`.
- Test (pins moved): `agent/test/whitelist.test.ts` (148-232: `EIGHT` -> `NINE`, titles, `REFUSED` widened); `server/test/single-definition.test.ts` (the `one NODE_FILES` describe, 3721-3820: `EIGHT_BASENAMES` -> `NINE_BASENAMES`, length 9, `QUOTED` gains `box-token-generation`, the CONTROL plants nine).
- Test (run unchanged, holds D-4389): `server/test/update-inventory.test.ts` — its `Object.keys(reads)` seven-key pin (the case "a read that never answers is unreadable inside the budget", 192-205 at 282e79e44).

**Interfaces:**
- Consumes: `NODE_FILES`, `NODE_FILE_BASENAMES`, `updateLauncherPath`, `UPDATE_OP_DETAIL_MAX` (through `firstStderrLine`, used by A2), `ReadFailure` (`shared/agent-protocol.ts`); `NodeRole` (`shared/api.ts`).
- Produces (`shared/agent-protocol.ts`): `NODE_FILES.tokenGeneration = 'box-token-generation'`; `TOKEN_SYNC_OP`; `interface TokenSyncReq { t: 'req'; id: number; op: 'token-sync'; code: string }` (in `AgentReq`); `TOKEN_SYNC_OP_ERRORS`, `type TokenSyncOpError`, `isTokenSyncOpError(v: unknown): v is TokenSyncOpError`; `TOKEN_SYNC_EXIT` (frozen); `TOKEN_SYNC_STDERR_PREFIX`; `GENERATION_ID_HEX = '[0-9a-f]{16}'` (ADDED, see the note below); `TOKEN_TRANSPORTS`, `type TokenTransport`, `readTokenTransport(raw: unknown): TokenTransport | 'unmeasured'`; `TOKEN_SYNC_SYNCED_RE` (source exactly `^synced ([0-9a-f]{16}) (http|https)$`, built from `GENERATION_ID_HEX` and `TOKEN_TRANSPORTS`); `CLAIM_CODE_RE`, `isClaimCode(v: unknown): v is string`; `TOKEN_SYNC_FROM`, `tokenSyncSpawnArgv(): readonly string[]`; `TOKEN_SYNC_SPAWN_TIMEOUT_MS` 40 000, `TOKEN_SYNC_KILL_GRACE_MS` 2 000, `TOKEN_SYNC_DRAIN_MS` 2 000, `TOKEN_SYNC_OP_TIMEOUT_MS` 50 000, `CLAIM_CODE_TTL_MS` 60 000; `TOKEN_VERB_MISSING_PREFIXES`, `isTokenVerbMissing(detail: string | null | undefined): boolean`.
- Produces (`shared/box-token.ts`): `TOKEN_CLAIM_PATH`, `TOKEN_ROTATE_PATH`, `CLAIM_BODY_LIMIT_BYTES`, `TOKEN_VALUE_RE`, `GENERATION_ID_RE`; `ClaimRequestBody`, `CLAIM_REFUSALS`/`ClaimRefusal`, `ClaimResponse`; `TOKEN_ORIGINS`/`TokenOrigin`, `OWED_REASONS`/`OwedReason`, `TOKEN_HOLDS`/`TokenHold`, `BOX_TOKEN_PHASES`/`BoxTokenPhase`; `FLEET_TOKEN_FILE_COMMENT`; `TOKEN_FILE_PROBLEMS`/`TokenFileProblem` (added at plan assembly: the driver's re-read words); `type GenerationFileInput = { ok: true; content: string } | { ok: false; reason: ReadFailure | 'too-large' }` (ADDED name); `GenerationRead`; `readGenerationFile(read: GenerationFileInput): GenerationRead`; `BoxTokenView` (with `stalled` and `fileProblem`, added at plan assembly); `RotateAnswer`.
- Two contract spellings changed to keep `single-definition.test.ts` green (both measured, mutation M4): the contract's `readGenerationFile` parameter spells `reason: 'absent' | 'unreadable' | 'too-large'` and its `BoxTokenView.fleetConfirmed` spells `'absent' | 'unreadable'` adjacent; either is a second holder for the describe "one absent/unreadable read vocabulary" (its `PAIR` regex scans `shared/`). Both now derive `ReadFailure`: the parameter type is the named `GenerationFileInput` above, and `fleetConfirmed: 'current' | 'behind' | ReadFailure | 'own-write' | 'unknown'` (the same six words).

- [ ] **Step 1: Write the failing test**

Create `server/test/token-shared.test.ts`:

```ts
// Box-token lifecycle, wave 1, Task A1: the L0 words, bounds and shapes both ends of the `token-sync` op and the
// claim door agree on (spec 2026-10-07 §4.4, §8 "Single definition", §10 "Op bounds"). Every name here is declared
// ONCE, in `shared/agent-protocol.ts` or `shared/box-token.ts`; the agent, the server and (in Part B) the PWA import
// it, and Part B's text-scan holds the shell's spellings to these values.
//
// What is pinned:
//  1. The bounds' ORDER: the agent always answers (spawn bound + kill grace + drain) before the server gives up on
//     the op, and the server gives up before the code it sent expires, so a lost answer is never a code still live.
//  2. The closed vocabularies and the exit table (a word on one side alone is a red here, not a drift).
//  3. The shapes: the claim code, the generation id (spelled once), the synced line, the transport reader.
//  4. The ninth node file, and that the inventory sweep does not read it (D-4389: the driver reads it).
//  5. `readGenerationFile`, the ONE reader of `~/.ccrc/box-token-generation`: three outcomes, malformed is unreadable.
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLAIM_CODE_RE, CLAIM_CODE_TTL_MS, GENERATION_ID_HEX, NODE_FILE_BASENAMES, NODE_FILES, TOKEN_SYNC_DRAIN_MS,
  TOKEN_SYNC_EXIT, TOKEN_SYNC_FROM, TOKEN_SYNC_KILL_GRACE_MS, TOKEN_SYNC_OP, TOKEN_SYNC_OP_ERRORS,
  TOKEN_SYNC_OP_TIMEOUT_MS, TOKEN_SYNC_SPAWN_TIMEOUT_MS, TOKEN_SYNC_STDERR_PREFIX, TOKEN_SYNC_SYNCED_RE,
  TOKEN_TRANSPORTS, TOKEN_VERB_MISSING_PREFIXES, UPDATE_OP, isClaimCode, isTokenSyncOpError, isTokenVerbMissing,
  readTokenTransport, tokenSyncSpawnArgv,
} from '../../shared/agent-protocol.js';
import {
  BOX_TOKEN_PHASES, CLAIM_BODY_LIMIT_BYTES, CLAIM_REFUSALS, FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, OWED_REASONS,
  TOKEN_CLAIM_PATH, TOKEN_FILE_PROBLEMS, TOKEN_HOLDS, TOKEN_ORIGINS, TOKEN_ROTATE_PATH, TOKEN_VALUE_RE, readGenerationFile,
} from '../../shared/box-token.js';
import { localIO, type FleetIO } from '../src/io.js';
import { readNodeFiles } from '../src/update/inventory.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BOX_TOKEN_TS = path.resolve(here, '..', '..', 'shared', 'box-token.ts');

describe('the token-sync op bounds (spec §4.4, §10 "Op bounds")', () => {
  it('are the spec values', () => {
    expect(TOKEN_SYNC_SPAWN_TIMEOUT_MS).toBe(40_000);
    expect(TOKEN_SYNC_KILL_GRACE_MS).toBe(2_000);
    expect(TOKEN_SYNC_DRAIN_MS).toBe(2_000);
    expect(TOKEN_SYNC_OP_TIMEOUT_MS).toBe(50_000);
    expect(CLAIM_CODE_TTL_MS).toBe(60_000);
  });

  it('spawn bound + kill grace + drain < op timeout < code TTL: the agent answers first, and the code outlives the op', () => {
    expect(TOKEN_SYNC_SPAWN_TIMEOUT_MS + TOKEN_SYNC_KILL_GRACE_MS + TOKEN_SYNC_DRAIN_MS).toBeLessThan(TOKEN_SYNC_OP_TIMEOUT_MS);
    expect(TOKEN_SYNC_OP_TIMEOUT_MS).toBeLessThan(CLAIM_CODE_TTL_MS);
  });
});

describe('the token-sync op words (spec §4.4)', () => {
  it('the op word is its own, beside the update op', () => {
    expect(TOKEN_SYNC_OP).toBe('token-sync');
    expect(TOKEN_SYNC_OP).not.toBe(UPDATE_OP);
  });

  it('the error words are exactly the nine, closed, and isTokenSyncOpError reads them and nothing else', () => {
    expect([...TOKEN_SYNC_OP_ERRORS]).toEqual(['bad-code', 'busy', 'spawn-failed', 'claim-refused', 'code-used',
      'write-failed', 'proof-failed', 'proof-unmeasured', 'stale-client']);
    for (const w of TOKEN_SYNC_OP_ERRORS) expect(isTokenSyncOpError(w), w).toBe(true);
    // `bad-request` stays the envelope's word for "this agent predates the op"; there is no insecure-url word (R2).
    for (const w of ['bad-request', 'insecure-url', 'BUSY', '', null, 1, undefined]) expect(isTokenSyncOpError(w), String(w)).toBe(false);
  });

  it('the exit table covers every verb word, exactly once, 20 to 26, and never the two agent-only words', () => {
    expect({ ...TOKEN_SYNC_EXIT }).toEqual({
      'bad-code': 20, 'claim-refused': 21, 'code-used': 22, 'write-failed': 23,
      'proof-failed': 24, 'proof-unmeasured': 25, 'stale-client': 26,
    });
    expect(Object.keys(TOKEN_SYNC_EXIT).sort())
      .toEqual(TOKEN_SYNC_OP_ERRORS.filter((w) => w !== 'busy' && w !== 'spawn-failed').sort());
    expect(new Set(Object.values(TOKEN_SYNC_EXIT)).size).toBe(Object.keys(TOKEN_SYNC_EXIT).length);
    expect(Object.isFrozen(TOKEN_SYNC_EXIT)).toBe(true);
  });

  it('the refusal line prefix and the synced line', () => {
    expect(TOKEN_SYNC_STDERR_PREFIX).toBe('ccrc: token sync: ');
    // The exact source, because Part B's shell-parity scan compares the verb's printf against it.
    expect(TOKEN_SYNC_SYNCED_RE.source).toBe('^synced ([0-9a-f]{16}) (http|https)$');
    expect(TOKEN_SYNC_SYNCED_RE.exec('synced 0123456789abcdef https')?.slice(1)).toEqual(['0123456789abcdef', 'https']);
    expect(TOKEN_SYNC_SYNCED_RE.exec('synced 0123456789abcdef http')?.slice(1)).toEqual(['0123456789abcdef', 'http']);
    for (const bad of ['synced 0123456789ABCDEF https', 'synced 0123456789abcde https', 'synced 0123456789abcdef ws',
      'synced 0123456789abcdef', ' synced 0123456789abcdef https', 'synced 0123456789abcdef https\nx']) {
      expect(TOKEN_SYNC_SYNCED_RE.test(bad), bad).toBe(false);
    }
  });

  it('readTokenTransport is the one reader of the additive transport field: absence and junk are unmeasured, never https', () => {
    expect([...TOKEN_TRANSPORTS]).toEqual(['http', 'https']);
    expect(readTokenTransport('http')).toBe('http');
    expect(readTokenTransport('https')).toBe('https');
    for (const raw of [undefined, null, '', 'HTTPS', 'ws', 'wss', 1, true, ['https'], { t: 'https' }]) {
      expect(readTokenTransport(raw), JSON.stringify(raw)).toBe('unmeasured');
    }
  });

  it('the claim code is 32 random bytes as unpadded base64url, and isClaimCode is its one guard', () => {
    expect(CLAIM_CODE_RE.source).toBe('^[A-Za-z0-9_-]{43}$');
    for (let i = 0; i < 200; i += 1) {
      const code = randomBytes(32).toString('base64url');
      expect(isClaimCode(code), 'a minted code').toBe(true);
    }
    const good = 'A'.repeat(43);
    for (const bad of ['A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}+`, `${'A'.repeat(42)}/`,
      `${'A'.repeat(42)}\n`, `${good}\n`, ` ${'A'.repeat(42)}`, '']) {
      expect(isClaimCode(bad), JSON.stringify(bad)).toBe(false);
    }
    for (const bad of [undefined, null, 43, ['A'.repeat(43)]]) expect(isClaimCode(bad)).toBe(false);
    expect(isClaimCode(good)).toBe(true);
  });

  it('the spawn argv is one frozen template with no variable token', () => {
    expect(TOKEN_SYNC_FROM).toBe('agent');
    const argv = tokenSyncSpawnArgv();
    expect([...argv]).toEqual(['token', 'sync', '--from', 'agent']);
    expect(Object.isFrozen(argv)).toBe(true);
    expect(() => (argv as string[]).push('--x')).toThrow(TypeError);
    expect([...tokenSyncSpawnArgv()]).toEqual(['token', 'sync', '--from', 'agent']);
  });

  it('isTokenVerbMissing names an older ccrc and an absent launcher, and nothing else (D-4395)', () => {
    expect([...TOKEN_VERB_MISSING_PREFIXES]).toEqual(['ccrc: unknown argument: token', 'could not start the launcher']);
    expect(isTokenVerbMissing('ccrc: unknown argument: token')).toBe(true);
    expect(isTokenVerbMissing('could not start the launcher (ENOENT)')).toBe(true);
    expect(isTokenVerbMissing('could not start the launcher (EACCES)')).toBe(true);
    for (const d of [null, undefined, '', 'no message', 'ccrc: token sync: bad-code: x', 'ccrc: unknown argument: update',
      ' ccrc: unknown argument: token']) {
      expect(isTokenVerbMissing(d), String(d)).toBe(false);
    }
  });
});

describe('the ninth node file (spec 4.5, §8 "No secret in the agent\'s read grant")', () => {
  it('NODE_FILES.tokenGeneration is box-token-generation, and the derived list carries nine names', () => {
    expect(NODE_FILES.tokenGeneration).toBe('box-token-generation');
    expect(NODE_FILE_BASENAMES).toHaveLength(9);
    expect(NODE_FILE_BASENAMES).toContain('box-token-generation');
  });

  it('the inventory sweep never reads it: the driver does (D-4389)', async () => {
    const ccrcDir = path.join(mkTmp('ccrc-token-shared-inv-'), '.ccrc');
    mkdirSync(ccrcDir, { recursive: true });
    writeFileSync(path.join(ccrcDir, NODE_FILES.tokenGeneration), '0123456789abcdef\n');
    const asked: string[] = [];
    const recording: FleetIO = {
      ...localIO,
      lstatMeasured: async (p: string) => { asked.push(path.basename(p)); return localIO.lstatMeasured(p); },
    };
    const reads = await readNodeFiles(recording, ccrcDir, 5_000);
    expect(Object.keys(reads)).not.toContain('tokenGeneration');
    expect(asked.length, 'the sweep read nothing at all').toBeGreaterThan(0);
    expect(asked).not.toContain('box-token-generation');
  });
});

describe('shared/box-token.ts — the claim door, value and generation shapes, and the lifecycle words', () => {
  it('the two routes, the body bound and the value and generation shapes', () => {
    expect(TOKEN_CLAIM_PATH).toBe('/api/token/claim');
    expect(TOKEN_ROTATE_PATH).toBe('/api/token/rotate');
    expect(CLAIM_BODY_LIMIT_BYTES).toBe(1024);
    expect(TOKEN_VALUE_RE.source).toBe('^[0-9a-f]{64}$');
    expect(TOKEN_VALUE_RE.test(randomBytes(32).toString('hex'))).toBe(true);
    expect(TOKEN_VALUE_RE.test('A'.repeat(64))).toBe(false);
    expect(GENERATION_ID_RE.source).toBe('^[0-9a-f]{16}$');
    expect(GENERATION_ID_RE.test(randomBytes(8).toString('hex'))).toBe(true);
  });

  it('the generation-id shape is spelled once: both regexes are built from GENERATION_ID_HEX', () => {
    expect(GENERATION_ID_HEX).toBe('[0-9a-f]{16}');
    expect(GENERATION_ID_RE.source).toContain(GENERATION_ID_HEX);
    expect(TOKEN_SYNC_SYNCED_RE.source).toContain(GENERATION_ID_HEX);
    const src = readFileSync(BOX_TOKEN_TS, 'utf8');
    expect(src.includes('{16}'), 'box-token.ts re-spells the generation id').toBe(false);
  });

  it('the closed vocabularies', () => {
    expect([...CLAIM_REFUSALS]).toEqual(['bad-request', 'wrong-node', 'no-claim', 'code-expired', 'code-used', 'rate-limited', 'unavailable']);
    expect([...TOKEN_ORIGINS]).toEqual(['adopted', 'minted', 'rotated']);
    expect([...OWED_REASONS]).toEqual(['adopted', 'fleet-behind', 'confirm-deadline', 'retired-written-back', 'recovered',
      'aux-unusable', 'unverifiable-files', 'code-used', 'claim-misbound']);
    expect([...TOKEN_HOLDS]).toEqual(['update-in-flight', 'agent-predates-op', 'verb-missing', 'stale-client', 'fleet-rows',
      'node-id-unmeasured', 'link-down', 'pending-cap', 'no-coord', 'role-unrecorded', 'mint-failed']);
    expect([...BOX_TOKEN_PHASES]).toEqual(['unconfigured', 'idle', 'staged', 'handed-out', 'promoting', 'grace', 'held', 'failed']);
    // Added at plan assembly (review: the run-time re-read); its words are never the read vocabulary's pair.
    expect([...TOKEN_FILE_PROBLEMS]).toEqual(['missing', 'unusable', 'placeholder', 'unreadable', 'changed', 'retired']);
  });

  it('the fleet file comment is one printable-ASCII comment line', () => {
    expect(FLEET_TOKEN_FILE_COMMENT).toBe('# ccrc box token: written by ccrc and rotated by the server; do not edit or copy it');
    expect(FLEET_TOKEN_FILE_COMMENT).toMatch(/^# [\x20-\x7e]+$/);
  });

  it('readGenerationFile: an id, absent, or unreadable; too-large and every malformed body read unreadable', () => {
    expect(readGenerationFile({ ok: true, content: '0123456789abcdef\n' })).toEqual({ kind: 'id', id: '0123456789abcdef' });
    expect(readGenerationFile({ ok: false, reason: 'absent' })).toEqual({ kind: 'absent' });
    expect(readGenerationFile({ ok: false, reason: 'unreadable' })).toEqual({ kind: 'unreadable' });
    expect(readGenerationFile({ ok: false, reason: 'too-large' })).toEqual({ kind: 'unreadable' });
    for (const content of ['0123456789abcdef', '0123456789ABCDEF\n', '0123456789abcde\n', '0123456789abcdef0\n',
      '0123456789abcdef\n\n', '0123456789abcdef\r\n', ' 0123456789abcdef\n', '0123456789abcdef\nx\n', '', '\n']) {
      expect(readGenerationFile({ ok: true, content }), JSON.stringify(content)).toEqual({ kind: 'unreadable' });
    }
  });

  it('is L0: it imports only its shared siblings, never node:*', () => {
    const src = readFileSync(BOX_TOKEN_TS, 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(new Set(specs)).toEqual(new Set(['./api.js', './agent-protocol.js']));
    expect(/\brequire\(|import\(|['"]node:/.test(src), 'a require, a dynamic import or a node: specifier').toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
mkdir -p .tmp-a1 && (cd server && TMPDIR="$PWD/../.tmp-a1" ./node_modules/.bin/vitest run test/token-shared.test.ts)
```

Expected: the suite fails to load, `Error: Cannot find module '../../shared/box-token.js' imported from …/server/test/token-shared.test.ts`, `Tests  no tests`.

- [ ] **Step 3: Write the L0 declarations**

Edit `shared/agent-protocol.ts` exactly as below (the whole diff against 282e79e44; the last hunk inserts the token-sync block between `decideKilledSpawn` and the `ReadFailure` docstring):

```diff
diff --git a/shared/agent-protocol.ts b/shared/agent-protocol.ts
--- a/shared/agent-protocol.ts
+++ b/shared/agent-protocol.ts
@@ -98,7 +98,8 @@ export interface AgentHello { t: 'hello'; token: string }
 export interface AgentReady {
   t: 'ready'; v: 1; ccdVerbs?: string[]; rosterFp?: string; build?: BuildInfo;
   observedEpoch?: number | null;
-  /** The one op word defined for this list is `UPDATE_OP` (`'update'`), which programme wave 5's agent sends; `readReadyOps` reads it. */
+  /** The op words defined for this list are `UPDATE_OP` (`'update'`), which programme wave 5's agent sends, and
+   *  `TOKEN_SYNC_OP` (`'token-sync'`, box-token lifecycle wave 1); `readReadyOps` reads them. */
   ops?: string[];   // ADDITIVE (design 2026-09-20 §8/§10): the ops this agent answers; absent from every agent before W4
 }
 
@@ -152,14 +153,23 @@ export const POOL_EPOCH_FILE_NAME = 'pool-epoch';
  * server process writes its OWN box's `update-intent` from W2, and W4's
  * `ccd-update-sync` writes a fleet node's. A name read before its writer
  * exists answers `absent`, which is the truth about that node.
+ *
+ * `tokenGeneration` (`box-token-generation`, box-token lifecycle wave 1, spec
+ * 4.5) is the ninth: one line, the 16-hex id of the box-token generation the
+ * node last wrote (`ccrc token sync` on a fleet node, the server's both-role
+ * writer on a both box). It holds an id, never a value, which is the only
+ * reason it may join this object. The server's token driver reads it on its
+ * own tick (D-4389), so the inventory sweep's `MEASURED_FILE_KEYS` leaves it
+ * out, as it leaves out `projection`.
  */
 export const CCRC_DIR_NAME = '.ccrc';
 export const NODE_FILES = {
   stamp: 'build.json', installed: 'installed', caps: 'ccrc-caps', floor: 'floor', previous: 'previous',
   nodeId: 'node-id', report: 'update.json', projection: 'update-intent',
+  tokenGeneration: 'box-token-generation',
 } as const;
 export type NodeFileKey = keyof typeof NODE_FILES;
-/** The eight names as one list, DERIVED — the agent's admission set and every
+/** The nine names as one list, DERIVED — the agent's admission set and every
  *  scan over it read this, never a restatement. */
 export const NODE_FILE_BASENAMES: readonly string[] = Object.values(NODE_FILES);
 
@@ -326,10 +336,14 @@ export interface PtyOpenReq  { t: 'req'; id: number; op: 'ptyOpen'; sessionId: s
  *  failure answers `bad-tag`, never `bad-request`, which from this op means
  *  exactly one thing: the agent predates it. */
 export interface UpdateReq { t: 'req'; id: number; op: 'update'; tag: string; kind?: RequestKind }
+/** Box-token lifecycle spec 4.4: ONE member of the `req` envelope. `code` is the only field and passes `isClaimCode`
+ *  in the agent's `validateReq` before any case body sees it; a failure answers `bad-code`, never `bad-request`. It
+ *  carries no URL, path, value or argv: the fleet box reaches the server at the address it already has. */
+export interface TokenSyncReq { t: 'req'; id: number; op: 'token-sync'; code: string }
 export interface PtyInput    { t: 'pty'; ptyId: number; ev: 'input'; dataB64: string }
 export interface PtyResize   { t: 'pty'; ptyId: number; ev: 'resize'; cols: number; rows: number }
 export interface PtyClose    { t: 'pty'; ptyId: number; ev: 'close' }
-export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReadB64Req|ReaddirReq|StatReq|LstatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq|CapsReq|UpdateReq;
+export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReadB64Req|ReaddirReq|StatReq|LstatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq|CapsReq|UpdateReq|TokenSyncReq;
 export interface ResOk  { t: 'res'; id: number; ok: true;  [k: string]: unknown } // op-specific payload fields below
 /** `detail` is ADDITIVE (design 2026-09-20 §10, D-3373): what an
  *  agent can say beyond the word — the `--detach` parent's first stderr line,
@@ -345,6 +359,7 @@ export interface ResErr { t: 'res'; id: number; ok: false; err: string; detail?:
 //   silence for `regular` — the D-114 shape, in the one direction that matters here, because
 //   `regular` is the only answer that lets a caller condemn anything.
 // writeB64 → {}; tailOpen → {tailId}; ptyOpen → {ptyId}; caps → {verbs: string[]}; update → {accepted: true, detail?: string} (D-3413: `detail` only from the bound's arms B and D)
+// token-sync → {synced: <16 hex>, transport?: 'http'|'https'} (transport ADDITIVE; its one reader is readTokenTransport)
 
 // ── the `update` op (design 2026-09-20 §10) ─────────────────────────────────
 // Everything both ends of the op must agree on is declared here, once. The
@@ -624,6 +639,86 @@ export function decideKilledSpawn(i: {
   return { arm: 'D', detail: head + text + tail };
 }
 
+// ── the `token-sync` op (box-token lifecycle spec 2026-10-07 §4.4) ─────────────
+// Everything both ends of the op agree on, declared once. The agent
+// (`agent/src/tokensync.ts`, `agent/src/server.ts`) spawns from the template and
+// maps the child's answer with these words; the server's link
+// (`server/src/token/link.ts`) reads the result with them; bash cannot import
+// this, so `ccd/ccrc-token-sync` spells its side itself and Part B's text scan
+// holds those spellings to these values.
+
+/** The op's name, and the word an agent that answers it lists in `ready.ops`. */
+export const TOKEN_SYNC_OP = 'token-sync';
+
+/** The ONLY words the op refuses with. `bad-request` is deliberately NOT a member: from this op it keeps meaning
+ *  "the agent predates it" (the envelope's word for an op `validateReq` does not know). There is no insecure-url
+ *  word: a plain-http install rotates (R2). `busy` and `spawn-failed` are the agent's own; the rest are the verb's. */
+export const TOKEN_SYNC_OP_ERRORS = ['bad-code', 'busy', 'spawn-failed', 'claim-refused', 'code-used',
+  'write-failed', 'proof-failed', 'proof-unmeasured', 'stale-client'] as const;
+export type TokenSyncOpError = (typeof TOKEN_SYNC_OP_ERRORS)[number];
+/** Use THIS, never `TOKEN_SYNC_OP_ERRORS.includes(x as TokenSyncOpError)` — `isRunState`'s rule. */
+export function isTokenSyncOpError(v: unknown): v is TokenSyncOpError {
+  return typeof v === 'string' && (TOKEN_SYNC_OP_ERRORS as readonly string[]).includes(v);
+}
+
+/** The verb's own refusal words and their exit codes; `busy` and `spawn-failed` are the agent's, never the verb's.
+ *  The agent maps a child's answer to a word only when BOTH the exit code and the first stderr line agree. */
+export const TOKEN_SYNC_EXIT: Readonly<Record<Exclude<TokenSyncOpError, 'busy' | 'spawn-failed'>, number>> = Object.freeze({
+  'bad-code': 20, 'claim-refused': 21, 'code-used': 22, 'write-failed': 23,
+  'proof-failed': 24, 'proof-unmeasured': 25, 'stale-client': 26,
+});
+/** First stderr line of a refusal: `ccrc: token sync: <word>: <sentence>`. */
+export const TOKEN_SYNC_STDERR_PREFIX = 'ccrc: token sync: ';
+
+/** The generation id's shape, as a regex BODY: 8 random bytes as 16 lowercase hex. The ONE spelling;
+ *  `GENERATION_ID_RE` (`shared/box-token.ts`) and `TOKEN_SYNC_SYNCED_RE` below are built from it. */
+export const GENERATION_ID_HEX = '[0-9a-f]{16}';
+
+export const TOKEN_TRANSPORTS = ['http', 'https'] as const;
+export type TokenTransport = (typeof TOKEN_TRANSPORTS)[number];
+/** The ONE reader of the op result's additive `transport` field: anything else, including absence, is
+ *  `'unmeasured'` — never folded into `https`, because an older agent's silence proves nothing about the wire. */
+export function readTokenTransport(raw: unknown): TokenTransport | 'unmeasured' {
+  return typeof raw === 'string' && (TOKEN_TRANSPORTS as readonly string[]).includes(raw) ? (raw as TokenTransport) : 'unmeasured';
+}
+
+/** The verb's ONE stdout line on success: `synced <generation> <transport>`. */
+export const TOKEN_SYNC_SYNCED_RE = new RegExp(`^synced (${GENERATION_ID_HEX}) (${TOKEN_TRANSPORTS.join('|')})$`);
+
+/** 32 random bytes as unpadded base64url = 43 characters. */
+export const CLAIM_CODE_RE = /^[A-Za-z0-9_-]{43}$/;
+/** The ONE code guard: the agent's `validateReq` and the server's claim door both call it. */
+export function isClaimCode(v: unknown): v is string {
+  return typeof v === 'string' && CLAIM_CODE_RE.test(v);
+}
+
+/** The `--from` word the agent's spawn carries; the verb refuses any other at exit 2. */
+export const TOKEN_SYNC_FROM = 'agent';
+/** THE template: `ccrc token sync --from agent`, no variable token (the code rides stdin). The file is
+ *  `updateLauncherPath(home)`, the same absolute shim the update op spawns. Frozen: a caller cannot append a flag. */
+export function tokenSyncSpawnArgv(): readonly string[] {
+  return Object.freeze(['token', 'sync', '--from', TOKEN_SYNC_FROM]);
+}
+
+/** The agent's bound on the verb: SIGTERM to the child's process group at this bound, so its trap removes its temps. */
+export const TOKEN_SYNC_SPAWN_TIMEOUT_MS = 40_000;
+/** Then SIGKILL, this long after the SIGTERM. */
+export const TOKEN_SYNC_KILL_GRACE_MS = 2_000;
+/** ONE drain deadline, armed by the child's exit or by the SIGKILL, whichever comes first, never restarted. */
+export const TOKEN_SYNC_DRAIN_MS = 2_000;
+/** The server's `FleetClient.request` deadline for this op (the client's default is 15 s). */
+export const TOKEN_SYNC_OP_TIMEOUT_MS = 50_000;
+/** A claim code's life. Pinned: SPAWN + KILL_GRACE + DRAIN < OP_TIMEOUT < CLAIM_CODE_TTL (44 000 < 50 000 < 60 000),
+ *  by `server/test/token-shared.test.ts`, so the agent always answers first and a lost answer is never a live code. */
+export const CLAIM_CODE_TTL_MS = 60_000;
+
+/** A `spawn-failed` detail that means "this ccrc has no `token` verb" (a named hold, never a failure, D-4395):
+ *  `_ccrc_usage_die`'s line from an older `ccrc`, or the agent's own sentence when no launcher is there at all. */
+export const TOKEN_VERB_MISSING_PREFIXES = ['ccrc: unknown argument: token', 'could not start the launcher'] as const;
+export function isTokenVerbMissing(detail: string | null | undefined): boolean {
+  return typeof detail === 'string' && TOKEN_VERB_MISSING_PREFIXES.some((p) => detail.startsWith(p));
+}
+
 /** Why a `read`/`readB64`/`readFrom`/`stat` op couldn't produce its answer —
  *  the ONE vocabulary both ends of this wire fold the op's boolean
  *  `absent?: true` flag into once they have it. `absent` means a PROVEN
```

Create `shared/box-token.ts`:

```ts
// L0 — the box-token lifecycle's wire and words (spec 2026-10-07 §4, §8 "Single definition"), shared by the
// server (its claim door, rotate route, driver and doctor-facing state), the agent and, from Part B, the PWA's card.
// It imports nothing but its `shared/` siblings, never `node:*`: the PWA bundles it.
//
// Nothing here is a secret or derives from one. A token value, a claim code and the sha256 of either never appear in
// a type this file declares except `ClaimResponse.value`, the one 200 body the claim door hands the fleet box.
import type { NodeRole } from './api.js';
import { GENERATION_ID_HEX, type ReadFailure, type TokenTransport } from './agent-protocol.js';

/** The fleet box's one door: it trades a single-use code for the staged value (spec 4.6). */
export const TOKEN_CLAIM_PATH = '/api/token/claim';
/** The console's "Rotate now" (session-gated, not EXEMPT). */
export const TOKEN_ROTATE_PATH = '/api/token/rotate';
/** The claim route's `bodyLimit`: a code and a node-id fit many times over; past it Fastify answers 413. */
export const CLAIM_BODY_LIMIT_BYTES = 1024;
/** A box-token value: 32 random bytes as 64 lowercase hex. */
export const TOKEN_VALUE_RE = /^[0-9a-f]{64}$/;
/** A generation id, built from the one spelling (`GENERATION_ID_HEX`, `shared/agent-protocol.ts`). */
export const GENERATION_ID_RE = new RegExp(`^${GENERATION_ID_HEX}$`);

/** `nodeId` is checked against the store's `NODE_ID_RE` (`server/src/coord/store.ts`) in the door; never re-spelled. */
export interface ClaimRequestBody { code: string; nodeId: string }
export const CLAIM_REFUSALS = ['bad-request', 'wrong-node', 'no-claim', 'code-expired', 'code-used', 'rate-limited', 'unavailable'] as const;
export type ClaimRefusal = (typeof CLAIM_REFUSALS)[number];
/** Status codes: 200 hand-out; 400 bad-request; 403 wrong-node; 404 no-claim; 410 code-expired | code-used;
 *  413 bad-request (route bodyLimit, same small body); 429 rate-limited; 503 unavailable (the hand-out could not be
 *  recorded, D-4394). */
export type ClaimResponse = { ok: true; value: string; generation: string } | { ok: false; error: ClaimRefusal };

export const TOKEN_ORIGINS = ['adopted', 'minted', 'rotated'] as const;
export type TokenOrigin = (typeof TOKEN_ORIGINS)[number];
export const OWED_REASONS = ['adopted', 'fleet-behind', 'confirm-deadline', 'retired-written-back', 'recovered',
  'aux-unusable', 'unverifiable-files', 'code-used', 'claim-misbound'] as const;
export type OwedReason = (typeof OWED_REASONS)[number];
export const TOKEN_HOLDS = ['update-in-flight', 'agent-predates-op', 'verb-missing', 'stale-client', 'fleet-rows',
  'node-id-unmeasured', 'link-down', 'pending-cap', 'no-coord', 'role-unrecorded', 'mint-failed'] as const;
export type TokenHold = (typeof TOKEN_HOLDS)[number];
export const BOX_TOKEN_PHASES = ['unconfigured', 'idle', 'staged', 'handed-out', 'promoting', 'grace', 'held', 'failed'] as const;
export type BoxTokenPhase = (typeof BOX_TOKEN_PHASES)[number];

/** The fixed comment line a fleet token file gets when none existed (both writers: the server's both-role writer and
 *  `ccrc token sync`). An existing file's own `#` and blank lines are kept instead. */
export const FLEET_TOKEN_FILE_COMMENT = '# ccrc box token: written by ccrc and rotated by the server; do not edit or copy it';

/** What the driver's run-time re-read of a server token file found (spec 4.2, §6 "A token file broken on re-read").
 *  The last good value in memory is kept in every case; an out-of-band edit is never adopted at run time.
 *  `missing`, not the read vocabulary's word: this is a finding about a file the server wrote, not a read outcome. */
export const TOKEN_FILE_PROBLEMS = ['missing', 'unusable', 'placeholder', 'unreadable', 'changed', 'retired'] as const;
export type TokenFileProblem = (typeof TOKEN_FILE_PROBLEMS)[number];

/** What a node-file read hands `readGenerationFile`: the inventory's `NodeFileRead`, restated structurally because L0
 *  imports no `server/src`. The failure words are `ReadFailure`'s, DERIVED, never re-spelled as a quoted pair
 *  (`single-definition.test.ts`'s "one absent/unreadable read vocabulary"). */
export type GenerationFileInput = { ok: true; content: string } | { ok: false; reason: ReadFailure | 'too-large' };
/** `~/.ccrc/box-token-generation`'s three outcomes, never folded: an id, proven absent, or unreadable. */
export type GenerationRead = { kind: 'id'; id: string } | { kind: 'absent' } | { kind: 'unreadable' };
/** The ONE reader. The file is exactly one line, `<16 lowercase hex>\n`; anything else (no newline, a second line,
 *  CRLF, upper case, a short or long id) is malformed and reads `unreadable`, as does an over-cap file. Only a
 *  proven absence reads `absent`. */
export function readGenerationFile(read: GenerationFileInput): GenerationRead {
  if (!read.ok) return read.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };
  const { content } = read;
  if (!content.endsWith('\n')) return { kind: 'unreadable' };
  const id = content.slice(0, -1);
  return GENERATION_ID_RE.test(id) ? { kind: 'id', id } : { kind: 'unreadable' };
}

/** What the console and the rotate route show. Numbers are ms since the epoch unless named S. No value, code or hash. */
export interface BoxTokenView {
  phase: BoxTokenPhase;
  origin: TokenOrigin | null;
  currentSeq: number | null;          // display sequence number of the current generation
  currentSince: number | null;
  lastRotationAt: number | null;
  rotationOwed: boolean;
  owedWhy: OwedReason | null;
  hold: TokenHold | null;
  holdNode: string | null;            // the node a hold names (e.g. the one updating), else null
  failures: number;                   // consecutive
  lastFailure: string | null;         // a TokenSyncOpError, 'timeout', 'disconnected' or 'mint-failed'
  banner: boolean;                    // failures >= 3
  /** A failed mint, or a rotation owed and not completed for STALL_ALERT_MS (server/src/token/policy.ts), measured from
   *  when this server process first saw it owed. The console's alert for a stall that never counts as a failure. */
  stalled: { why: 'mint-failed' | 'owed'; since: number } | null;
  /** The last run-time re-read's finding about a server token file, or null when every file agreed with memory. */
  fileProblem: { at: number; file: 'current' | 'pending' | 'previous'; word: TokenFileProblem } | null;
  /** The fleet's generation read against the current one. Its two failure words are `ReadFailure`'s, derived, never
   *  re-spelled as a quoted pair (`single-definition.test.ts`'s "one absent/unreadable read vocabulary"). */
  fleetConfirmed: 'current' | 'behind' | ReadFailure | 'own-write' | 'unknown';
  fleetTransport: TokenTransport | 'unmeasured' | null;   // null: no sync yet
  lastSync: { at: number; word: string } | null;          // 'synced' or a refusal word
  previousPresented: number;
  retiredPresented: number;
  retiredRefused: boolean;            // the server's own proof at the last retirement
  lastBootRecovery: { at: number; source: 'pending' | 'previous' } | null;
  role: NodeRole;
}

export type RotateAnswer =
  | { ok: true; outcome: 'started' | 'joined'; view: BoxTokenView }       // 200
  | { ok: false; error: 'held'; hold: TokenHold; node: string | null; view: BoxTokenView }   // 409
  | { ok: false; error: 'rate-limited'; retryAfterS: number }             // 429
  | { ok: false; error: 'not-configured' };                               // 501
```

- [ ] **Step 4: Run it: the inventory guard is still missing**

```bash
mkdir -p .tmp-a1 && (cd server && TMPDIR="$PWD/../.tmp-a1" ./node_modules/.bin/vitest run test/token-shared.test.ts)
```

Expected: `Tests  1 failed | 17 passed (18)`; the one failure is "the inventory sweep never reads it: the driver does (D-4389)", `AssertionError: expected [ 'stamp', 'installed', 'caps', …(5) ] to not include 'tokenGeneration'` — `NODE_FILES` grew and `MEASURED_FILE_KEYS` followed it.

- [ ] **Step 5: Exclude the ninth file from the sweep (D-4389) and move the docstring counts**

```diff
diff --git a/server/src/readiness.ts b/server/src/readiness.ts
--- a/server/src/readiness.ts
+++ b/server/src/readiness.ts
@@ -49,7 +49,7 @@ export interface ReadinessDeps {
    * `cfg.mailTokenPath` describes the SERVER box (`<home>/.ccrc/mail.token`).
    * On the live topology `CCRC_FLEET=remote` is standing config, so `io` is
    * the agent-backed FleetIO — handing it that path asks the FLEET box's agent
-   * about a server-box file. The agent admits only eight `.ccrc` node files, never `mail.token`, the
+   * about a server-box file. The agent admits only nine `.ccrc` node files, never `mail.token`, the
    * refusal maps to `unreadable`, and `boxToken` pins at `unmeasurable`
    * forever, so the verdict could never answer `ready` in production.
    * Whitelisting it would be worse than the bug: the fleet host's own token
diff --git a/server/src/update/inventory.ts b/server/src/update/inventory.ts
--- a/server/src/update/inventory.ts
+++ b/server/src/update/inventory.ts
@@ -75,16 +75,20 @@ const OS_LINE = /^os (linux|darwin)$/;
 export type NodeFileRead =
   | { ok: true; content: string }
   | { ok: false; reason: ReadFailure | 'too-large' };
-type MeasuredFileKey = Exclude<NodeFileKey, 'projection'>;
+type MeasuredFileKey = Exclude<NodeFileKey, 'projection' | 'tokenGeneration'>;
 export type NodeFileReads = Record<MeasuredFileKey, NodeFileRead>;
 export interface NodeConnection { label: string; role: NodeRole; agentOps: readonly string[] | null }
 
 /** Derived from `NODE_FILES`, never hand-listed. `update-intent` is in the
  *  agent's read set so a later screen can SHOW what a fleet node last
  *  received; it is never read back as authority (§8), so the measurement does
- *  not read it at all. */
+ *  not read it at all. `box-token-generation` (box-token lifecycle wave 1) is
+ *  in the read set for the token driver, which reads it itself on its own tick
+ *  through `readNodeFile` (D-4389), so the sweep leaves it out too and still
+ *  reads seven files. */
 const MEASURED_FILE_KEYS: readonly MeasuredFileKey[] =
-  (Object.keys(NODE_FILES) as NodeFileKey[]).filter((k): k is MeasuredFileKey => k !== 'projection');
+  (Object.keys(NODE_FILES) as NodeFileKey[])
+    .filter((k): k is MeasuredFileKey => k !== 'projection' && k !== 'tokenGeneration');
 
 const ABSENT: NodeFileRead = { ok: false, reason: 'absent' };
 const UNREADABLE: NodeFileRead = { ok: false, reason: 'unreadable' };
```

In `agent/src/whitelist.ts`, docstrings only: in lines 56-118 every whole word `eight` becomes `nine` (lines 59, 67, 76, 78, 87, 97, 102 twice, 104, 115; line 778's "measured on all eight" is about prototype-named commands and stays), and the first line names the ninth:

```diff
diff --git a/agent/src/whitelist.ts b/agent/src/whitelist.ts
--- a/agent/src/whitelist.ts
+++ b/agent/src/whitelist.ts
@@ -56,7 +56,9 @@ function underClaudeGlob(canonicalHome: string, canonicalTarget: string): boolea
 export type PathMode = 'read' | 'write';
 
 /**
- * The eight `~/.ccrc` NODE FILES (design 2026-09-20 §8) — the one read grant
+ * The nine `~/.ccrc` NODE FILES (design 2026-09-20 §8; the ninth,
+ * `box-token-generation`, is box-token lifecycle wave 1's and holds an id,
+ * never a value) — the one read grant
  * in this file that is not a prefix. `~/.ccrc` also holds `agent.env` (this
  * agent's own bearer), `auth.scrypt`, `coord.db`, `deploy.env` and every other
  * secret-bearing file `ccd/ccrc` writes, so an `isUnder(…/.ccrc)` arm would
@@ -64,7 +66,7 @@ export type PathMode = 'read' | 'write';
  * against the names `NODE_FILES` declares (`shared/agent-protocol.ts`), in a
  * Set built once per check.
  *
- * TWO conditions. `canonicalTarget` must BE one of the eight, AND it must be
+ * TWO conditions. `canonicalTarget` must BE one of the nine, AND it must be
  * the path the caller literally named — canonical === `<canonical
  * ~/.ccrc>/<the literal basename>`. Without the second: `~/.ccrc/floor` as a
  * live symlink to `~/.ccrc/installed` canonicalises onto a member, and this
@@ -73,9 +75,9 @@ export type PathMode = 'read' | 'write';
  * honest; it is independent of `lstat`, which has its own guard (D-3195,
  * F12/fix round 1, below).
  *
- * What this function refuses: a live symlink carrying one of the eight names
+ * What this function refuses: a live symlink carrying one of the nine names
  * whose FULLY RESOLVED target — following any chain to its end — lies
- * outside every admitted prefix, or is another of the eight; both fail the
+ * outside every admitted prefix, or is another of the nine; both fail the
  * second condition, and — in the common case, `~/.ccrc` itself not being a
  * symlink into an admitted prefix (N-1, fix round 1 dispatch C re-review) —
  * no other `checkPath` arm admits a `~/.ccrc`-rooted
@@ -84,7 +86,7 @@ export type PathMode = 'read' | 'write';
  * `.cc-sessions/x`, not to `installed`.
  *
  * What this function alone CANNOT refuse: a live symlink carrying one of the
- * eight names whose fully resolved target lies in a *different* admitted
+ * nine names whose fully resolved target lies in a *different* admitted
  * prefix (`.cc-sessions`, `.cc-clips`, a `.claude*` dir, the projects root) —
  * that target is a regular file the OTHER prefix's own arm in `checkPath`
  * admits independently, so the request is granted, just not through this
@@ -94,14 +96,14 @@ export type PathMode = 'read' | 'write';
  * directory entry, never `checkPath`'s canonical (already-resolved) answer
  * (F12/D-3195, fix round 1 dispatch C, `server.ts`'s `lstat` case) — so it
  * still reports `symlink`, which the server's inventory sweep refuses to
- * trust as the node file. A DANGLING symlink carrying one of the eight names
+ * trust as the node file. A DANGLING symlink carrying one of the nine names
  * canonicalises onto its own literal path and IS admitted by this function;
  * `lstat` reports it as `symlink` too, which the sweep also refuses.
  *
  * `canonicalCcrc` is `canonicalize(<home>/.ccrc)`, not `<canonical home>/.ccrc`,
- * so a `~/.ccrc` that is itself a symlink admits its own eight and nothing else —
+ * so a `~/.ccrc` that is itself a symlink admits its own nine and nothing else —
  * in the common case (N-1): if that symlink's target is ITSELF under an
- * admitted prefix, the prefix arm admits all of `~/.ccrc`, not just its eight.
+ * admitted prefix, the prefix arm admits all of `~/.ccrc`, not just its nine.
  */
 function isCcrcNodeFile(canonicalCcrc: string, targetPath: string, canonicalTarget: string): boolean {
   const admitted = new Set(NODE_FILE_BASENAMES.map((b) => path.join(canonicalCcrc, b)));
@@ -112,7 +114,7 @@ function isCcrcNodeFile(canonicalCcrc: string, targetPath: string, canonicalTarg
 /**
  * Whitelist check for ALL file ops. Reads: `.cc-sessions/`, `.cc-limits/`,
  * `.cc-clips/`, `.claude*` (glob) under $HOME, plus the fleet projects root,
- * plus exactly the eight `~/.ccrc` node files by name (`isCcrcNodeFile`).
+ * plus exactly the nine `~/.ccrc` node files by name (`isCcrcNodeFile`).
  * Writes: `.cc-clips/` under $HOME only. Returns the canonical path to operate on when
  * allowed, `null` otherwise — canonicalizing here means every downstream fs
  * call in fileops.ts/tail.ts already has symlink-escapes resolved.
```

- [ ] **Step 6: Run it to verify it passes**

```bash
mkdir -p .tmp-a1 && (cd server && TMPDIR="$PWD/../.tmp-a1" ./node_modules/.bin/vitest run test/token-shared.test.ts)
mkdir -p .tmp-a1 && (cd server && TMPDIR="$PWD/../.tmp-a1" ./node_modules/.bin/vitest run test/update-inventory.test.ts)
```

Expected: `Tests  18 passed (18)`; `update-inventory.test.ts` unchanged and green (`Tests  90 passed (90)` at this task; its seven-key pin is the second witness for D-4389).

- [ ] **Step 7: Move the pinned eight-to-nine tests (red first, then the edit)**

```bash
mkdir -p .tmp-a1 && (cd agent && TMPDIR="$PWD/../.tmp-a1" ./node_modules/.bin/vitest run test/whitelist.test.ts)
mkdir -p .tmp-a1 && (cd server && TMPDIR="$PWD/../.tmp-a1" ./node_modules/.bin/vitest run test/single-definition.test.ts)
```

Expected red before the edit: `whitelist.test.ts` `Tests  1 failed | 24 passed (25)`, "the set is exactly the eight §8 names — a ninth is a design change, not an edit" (`expected [ 'box-token-generation', …(8) ] to deeply equal [ 'build.json', 'ccrc-caps', …(6) ]`); `single-definition.test.ts` `Tests  1 failed | 405 passed (406)`, "no file in agent/src re-lists all eight basenames…" (`NODE_FILE_BASENAMES did not import, or the vocabulary shrank: … to have a length of 8 but got 9`). No other `single-definition` scan reds, which is the check that `shared/box-token.ts` re-spells no shared vocabulary.

Edit `agent/test/whitelist.test.ts` (pin: `NINE` gains `box-token-generation`, sorted first; the lifecycle's server-side files join `REFUSED`, so a value, state or temp file beside the ninth name stays unreadable):

```diff
diff --git a/agent/test/whitelist.test.ts b/agent/test/whitelist.test.ts
--- a/agent/test/whitelist.test.ts
+++ b/agent/test/whitelist.test.ts
@@ -145,15 +145,19 @@ describe('whitelist.checkPath', () => {
     expect(await checkPath(proj, cfg, 'write')).toBeNull();
   });
 
-  // ── design 2026-09-20 §8: the eight ~/.ccrc node files ──────────────────
+  // ── design 2026-09-20 §8: the nine ~/.ccrc node files (the ninth is box-token lifecycle wave 1's) ──
   // D-3176 — the spec put these in whitelist-structural.test.ts,
   // which pins only the EXEC whitelist (tsc-spawned compile errors, no checkPath
   // case at all); every other checkPath case is in this describe, so these are.
   describe('the ~/.ccrc node files — exact basenames, READ mode only', () => {
-    const EIGHT = ['build.json', 'ccrc-caps', 'floor', 'installed', 'node-id', 'previous', 'update-intent', 'update.json'];
+    const NINE = ['box-token-generation', 'build.json', 'ccrc-caps', 'floor', 'installed', 'node-id', 'previous',
+      'update-intent', 'update.json'];
     // Every other name ccd/ccrc writes (or could) beside them — the secrets first.
     const REFUSED = ['agent.env', 'auth.scrypt', 'coord.db', 'deploy.env', 'ccrc.env', 'exposure.env',
-      'mail.token', 'accounts.json', 'accounts.sh', 'build.json.bak', '.build.json.tmp', path.join('logs', 'x')];
+      'mail.token', 'accounts.json', 'accounts.sh', 'build.json.bak', '.build.json.tmp', path.join('logs', 'x'),
+      // The box-token lifecycle's server-side files beside the ninth name: values, state and temps stay refused.
+      'mail-previous.token', 'mail-pending-0123456789abcdef.token', 'box-token.json', 'box-token-retired.json',
+      'token-sync.json', '.box-token-generation.tmp-0123456789abcdef', 'box-token-generation.bak'];
 
     function seedCcrc(): string {
       seed();
@@ -162,17 +166,17 @@ describe('whitelist.checkPath', () => {
       return ccrc;
     }
 
-    it('the set is exactly the eight §8 names — a ninth is a design change, not an edit', () => {
+    it('the set is exactly the nine names (§8 plus box-token-generation) — a tenth is a design change, not an edit', () => {
       // The grant DERIVES from NODE_FILE_BASENAMES, so a name added to
       // NODE_FILES is a read grant; this is the line that makes that visible.
-      expect([...NODE_FILE_BASENAMES].sort()).toEqual(EIGHT);
+      expect([...NODE_FILE_BASENAMES].sort()).toEqual(NINE);
     });
 
-    it('admits each of the eight for read, absent or present, at its canonical path', async () => {
+    it('admits each of the nine for read, absent or present, at its canonical path', async () => {
       const ccrc = seedCcrc();
       const cfg = { home, projectsRoot };
       const canonicalCcrc = await canonicalize(ccrc);
-      for (const b of EIGHT) {
+      for (const b of NINE) {
         const p = path.join(ccrc, b);
         // Absent first: a node whose writer has not run yet must read `absent`
         // over the wire, not `forbidden` → `unreadable`.
@@ -190,7 +194,7 @@ describe('whitelist.checkPath', () => {
         expect(await checkPath(path.join(ccrc, r), cfg, 'read'), `${r} must NOT be readable`).toBeNull();
       }
       // The directory itself: admitting it would let `readdir` list agent.env's
-      // existence and `lstat`'s parent probe widen past the eight.
+      // existence and `lstat`'s parent probe widen past the nine.
       expect(await checkPath(ccrc, cfg, 'read'), '~/.ccrc itself must NOT be readable').toBeNull();
       expect(await checkPath(path.join(ccrc, 'build.json', 'x'), cfg, 'read')).toBeNull();
       mkdirSync(path.join(home, '.ccrc-evil'), { recursive: true });
@@ -199,15 +203,15 @@ describe('whitelist.checkPath', () => {
       expect(await checkPath(path.join(outside, 'build.json'), cfg, 'read')).toBeNull();
     });
 
-    it('write mode admits none of the eight — the agent never writes a node file', async () => {
+    it('write mode admits none of the nine — the agent never writes a node file', async () => {
       const ccrc = seedCcrc();
       const cfg = { home, projectsRoot };
-      for (const b of EIGHT) {
+      for (const b of NINE) {
         expect(await checkPath(path.join(ccrc, b), cfg, 'write'), `${b} must NOT be writable`).toBeNull();
       }
     });
 
-    it('a live SYMLINK carrying a node-file name is refused — at a secret, at another of the eight, or outside', async () => {
+    it('a live SYMLINK carrying a node-file name is refused — at a secret, at another of the nine, or outside', async () => {
       const ccrc = seedCcrc();
       const cfg = { home, projectsRoot };
       writeFileSync(path.join(ccrc, 'agent.env'), 'CCRC_AGENT_TOKEN=x\n');
@@ -225,7 +229,7 @@ describe('whitelist.checkPath', () => {
       expect(await checkPath(path.join(ccrc, 'installed'), cfg, 'read'), 'the real file keeps its own grant').not.toBeNull();
     });
 
-    it('a ~/.ccrc that is itself a symlink admits its own eight and nothing else', async () => {
+    it('a ~/.ccrc that is itself a symlink admits its own nine and nothing else', async () => {
       seed();
       const cfg = { home, projectsRoot };
       const real = mkTmp('ccrc-wl-ccrc-real-');
```

Edit `server/test/single-definition.test.ts`, inside the `one NODE_FILES` describe only (3721-3820; its own header says edits here stay out of the lines `session-hook.test.ts` cites, all of which are above 1310, and nothing in the tree cites a line of this file past 3725). `QUOTED` gains the ninth name, so a second quoted `box-token-generation` in any TS root is a second definition (Task A5's `tokenPaths` builds its generation path from `NODE_FILES.tokenGeneration`):

```diff
diff --git a/server/test/single-definition.test.ts b/server/test/single-definition.test.ts
--- a/server/test/single-definition.test.ts
+++ b/server/test/single-definition.test.ts
@@ -3728,13 +3728,13 @@ describe('one NODE_FILES — the ~/.ccrc node-file basenames', () => {
    *  SILENTLY the moment a NODE_FILES value is renamed (it would simply stop
    *  matching anything, never redding the "declared once" case above, which
    *  scans for a DIFFERENT literal). A DYNAMIC import, not a static
-   *  top-of-file one: this file's own lines above `EIGHT_BASENAMES` are
+   *  top-of-file one: this file's own lines above `NINE_BASENAMES` are
    *  `session-hook.test.ts`'s citation anchors (`:32-37`, `:1274`, `:1303`),
    *  and every edit in this describe stays END-OF-FILE only — a new
    *  top-of-file import line would shift every one of them. */
-  let EIGHT_BASENAMES: readonly string[] = [];
+  let NINE_BASENAMES: readonly string[] = [];
   beforeAll(async () => {
-    ({ NODE_FILE_BASENAMES: EIGHT_BASENAMES } = await import('../../shared/agent-protocol.js'));
+    ({ NODE_FILE_BASENAMES: NINE_BASENAMES } = await import('../../shared/agent-protocol.js'));
   });
 
   it('is declared in exactly one file, and that file is shared/agent-protocol.ts', () => {
@@ -3756,14 +3756,15 @@ describe('one NODE_FILES — the ~/.ccrc node-file basenames', () => {
   // its own CONTROL below — a REDECLARED copy in the CONTROL tested nothing
   // about the case it claimed to control (measured: reverting the real
   // case's regex to single-quote-only stayed green, CONTROL included).
-  const QUOTED = /(['"`])(?:ccrc-caps|update\.json|update-intent)\1/;
+  const QUOTED = /(['"`])(?:ccrc-caps|update\.json|update-intent|box-token-generation)\1/;
 
-  it('the three names no older code spells are quoted nowhere else — every reader goes through NODE_FILES', () => {
+  it('the four names no older code spells are quoted nowhere else — every reader goes through NODE_FILES', () => {
     // `build.json`, `installed`, `floor` and `previous` are ordinary words older
     // code already spells (`config.ts`'s `buildInfoPath`, the agent's own stamp
     // reader), and `node-id` is also a W1 CAP word (`ccd/ccrc`'s
     // `CCRC_CAP_WORDS`) a later task may test for; these three are new with the
-    // control plane, so a second quoted copy is a second definition. F16: a
+    // control plane (and `box-token-generation` with the box-token lifecycle,
+    // wave 1), so a second quoted copy is a second definition. F16: a
     // BACKREFERENCE, not a fixed `'…'` — a double-quoted or backtick re-list
     // is the same second definition, and the un-widened regex missed both.
     const holders = ALL.filter((f) => QUOTED.test(blankComments(readFileSync(f, 'utf8')))).map(rel);
@@ -3774,6 +3775,7 @@ describe('one NODE_FILES — the ~/.ccrc node-file basenames', () => {
     expect(QUOTED.test('const x = "ccrc-caps";'), 'double-quoted went unseen').toBe(true);
     expect(QUOTED.test('const x = `update-intent`;'), 'backtick-quoted went unseen').toBe(true);
     expect(QUOTED.test("const x = 'update.json';"), 'single-quoted (the original case) regressed').toBe(true);
+    expect(QUOTED.test("const x = 'box-token-generation';"), 'the ninth name went unseen').toBe(true);
     expect(QUOTED.test('const x = "update.json`;'), 'mismatched quote characters falsely matched').toBe(false);
   });
 
@@ -3785,32 +3787,32 @@ describe('one NODE_FILES — the ~/.ccrc node-file basenames', () => {
     expect(wl).toMatch(/import\s*\{[^}]*\bNODE_FILE_BASENAMES\b[^}]*\}\s*from\s*'\.\.\/\.\.\/shared\/agent-protocol\.js'/);
   });
 
-  /** Every file under `agent/src` (any depth) that spells ALL EIGHT basenames
+  /** Every file under `agent/src` (any depth) that spells ALL NINE basenames
    *  as string literals (any quote style) — a file that does is a second
    *  list, whether or not it also imports `NODE_FILE_BASENAMES`. Takes
    *  fixture pairs so the CONTROL below can drive it without touching a real
    *  file (F16). */
   const agentBasenameHolders = (files: readonly { path: string; src: string }[]): string[] =>
     files
-      .filter(({ src }) => EIGHT_BASENAMES.every((n) => new RegExp(`(['"\`])${n.replace('.', '\\.')}\\1`).test(src)))
+      .filter(({ src }) => NINE_BASENAMES.every((n) => new RegExp(`(['"\`])${n.replace('.', '\\.')}\\1`).test(src)))
       .map((f) => f.path);
 
-  it('no file in agent/src re-lists all eight basenames beside the NODE_FILE_BASENAMES import (F16)', () => {
-    // Anti-vacuity (F16, m2): the derived list really does carry all eight —
+  it('no file in agent/src re-lists all nine basenames beside the NODE_FILE_BASENAMES import (F16)', () => {
+    // Anti-vacuity (F16, m2): the derived list really does carry all nine —
     // a NODE_FILES shrink or a broken import would otherwise let this
     // describe run over an empty or partial set and pass for the wrong reason.
-    expect(EIGHT_BASENAMES, 'NODE_FILE_BASENAMES did not import, or the vocabulary shrank').toHaveLength(8);
+    expect(NINE_BASENAMES, 'NODE_FILE_BASENAMES did not import, or the vocabulary shrank').toHaveLength(9);
     const files = ALL.filter((f) => rel(f).startsWith('agent/src/'))
       .map((f) => ({ path: rel(f), src: readFileSync(f, 'utf8') }));
     expect(files.length, 'the agent/src scan is over nothing').toBeGreaterThan(3);
     expect(agentBasenameHolders(files)).toEqual([]);
   });
 
-  it('CONTROL: a planted re-list of all eight basenames beside the import reds the check above (F16)', () => {
+  it('CONTROL: a planted re-list of all nine basenames beside the import reds the check above (F16)', () => {
     const real = readFileSync(path.join(ccrcRoot, 'agent', 'src', 'whitelist.ts'), 'utf8');
-    const planted = `${real}\nconst ALSO = ["build.json", 'installed', \`ccrc-caps\`, 'floor', "previous", 'node-id', \`update.json\`, "update-intent"];\n`;
+    const planted = `${real}\nconst ALSO = ["build.json", 'installed', \`ccrc-caps\`, 'floor', "previous", 'node-id', \`update.json\`, "update-intent", 'box-token-generation'];\n`;
     expect(agentBasenameHolders([{ path: 'agent/src/whitelist.ts', src: planted }]),
-      'a planted re-list of all eight went unseen').toEqual(['agent/src/whitelist.ts']);
+      'a planted re-list of all nine went unseen').toEqual(['agent/src/whitelist.ts']);
     expect(agentBasenameHolders([{ path: 'agent/src/whitelist.ts', src: real }]),
       'the real file false-reds with no re-list planted').toEqual([]);
   });
```

- [ ] **Step 8: Run the moved pins to verify they pass**

```bash
mkdir -p .tmp-a1 && (cd agent && TMPDIR="$PWD/../.tmp-a1" ./node_modules/.bin/vitest run test/whitelist.test.ts)
mkdir -p .tmp-a1 && (cd server && TMPDIR="$PWD/../.tmp-a1" ./node_modules/.bin/vitest run test/single-definition.test.ts)
```

Expected: `Tests  25 passed (25)`; `Tests  406 passed (406)`.

- [ ] **Step 9: Mutation check (measure each red, restore, measure green)**

| # | One-line mutation | Named test that goes red (measured) |
|---|---|---|
| M1 | `shared/agent-protocol.ts`: `TOKEN_SYNC_DRAIN_MS = 2_000` -> `9_000` | `token-shared.test.ts`: "are the spec values" and "spawn bound + kill grace + drain < op timeout < code TTL…" (2 failed \| 16 passed) |
| M2 | `server/src/update/inventory.ts`: filter back to `k !== 'projection'` | `token-shared.test.ts`: "the inventory sweep never reads it…" (1 failed \| 17 passed); `update-inventory.test.ts`: "a read that never answers is unreadable inside the budget…" (1 failed \| 89 passed) |
| M3 | `shared/box-token.ts`: a body without the trailing newline accepted as an id | `token-shared.test.ts`: "readGenerationFile: an id, absent, or unreadable…" (1 failed \| 17 passed) |
| M4 | `shared/box-token.ts`: `reason: ReadFailure \| 'too-large'` -> the contract's `reason: 'absent' \| 'unreadable' \| 'too-large'` | `single-definition.test.ts`: "one absent/unreadable read vocabulary" > "is declared in exactly one file…" (1 failed \| 405 passed) |
| M5 | `server/src/update/inventory.ts`: append `export const GEN_FILE = 'box-token-generation';` | `single-definition.test.ts`: "the four names no older code spells are quoted nowhere else…" (1 failed \| 405 passed) |

Restore each file, then re-run Step 6 and Step 8 green.

- [ ] **Step 10: Typecheck**

```bash
(cd server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json)
(cd agent && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json)
```

Expected: no output from any of the four.

- [ ] **Step 11: Commit** (in its own call, after a green foreground read of the four test files above; then `rm -rf .tmp-a1`)

```bash
git add shared/agent-protocol.ts shared/box-token.ts server/src/update/inventory.ts server/src/readiness.ts \
  agent/src/whitelist.ts agent/test/whitelist.test.ts server/test/single-definition.test.ts server/test/token-shared.test.ts
git commit -m "feat(token): L0 token-sync words, bounds and wire; box-token-generation joins NODE_FILES (D-4389)

The token-sync op's word, request, closed error words, exit table 20-26, stderr prefix, synced line,
transport reader, claim-code guard, frozen argv template and its 40/2/2/50/60 s bounds are declared
once in shared/agent-protocol.ts; shared/box-token.ts holds the claim door's path and bodies, the
value and generation shapes, the lifecycle words, BoxTokenView, RotateAnswer, the fleet file's
comment line and readGenerationFile, the one reader of ~/.ccrc/box-token-generation. That ninth
node file is in the agent's read grant and out of the inventory sweep, which the driver replaces
for it. The eight-to-nine pins move with it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A2: The token-sync agent op

(prototype) measured: agent/test/token-sync-op.test.ts: red (suite failed to load: `Cannot find module '../src/tokensync.js'`), then 11 failed | 10 passed with the port and no op case -> green 21 passed; server/test/update-spawn-twin-bodies.test.ts: red (`ENOENT … agent/src/tokensync.ts`) -> green 4 passed; agent/test/update-op.test.ts: red 1 failed | 32 passed -> green 33 passed; server/test/remote-connect.test.ts: red 1 failed | 64 passed -> green 65 passed; server/test/update-inventory.test.ts: red 1 failed | 89 passed -> green 90 passed; box-token-census 23, topology-clean 55, docs-grammar 158 passed unchanged after the README edit; tsc clean for agent/ (src and tests) and server/test/tsconfig.tests.json; 2026-10-07 on main 282e79e44 with Task A1 applied

**Files:**
- Create: `agent/src/tokensync.ts` (the port, D-4390).
- Modify: `agent/src/server.ts` — the type import (27-30) and value import (32-36) blocks; one import line after 56; `AgentOpts.spawnTokenSync` (74); `failTokenSync` after `failUpdate` (211-213); the update port docstring (335-337); `TokenSyncGate` after `UpdateGate` (465); `ConnCtx` (479-481); the update case comment (635-636); the `token-sync` case after the update case (after 705, before `default:`); `ReqRefusal` (736); the `validateReq` case after `update` (after 817); `handleConnection`'s signature (1101-1104) and `ctx` (1113-1114); the ready frame (1156-1160); the refusal send (1187); `startAgent`'s opts (1243) and the gate (1259-1261).
- Modify: `agent/CLAUDE.md` (47-49 the read grant, 54 the update op is one of TWO, a `token-sync` bullet after 64).
- Modify (ADDED, not in the contract's file table): `README.md` (2976-2977 the read grant's count, a "Token-sync op" bullet after 2988). The contract gives README only to A4 (D-4396) and B7; these two lines become false or missing the moment this op ships, and they sit in the agent section, outside the auth paragraph A4 rewrites. Check README's claim holder before the commit.
- Test (create): `agent/test/token-sync-op.test.ts`.
- Test (pins moved): `agent/test/update-op.test.ts` (22, 397, 402: `ops` is `['update', 'token-sync']`); `server/test/update-spawn-twin-bodies.test.ts` (a describe appended after 43, D-4390); `server/test/remote-connect.test.ts` (44-52: whole-`FleetState` equality against a REAL agent, `agentOps: ['update', 'token-sync']`); `server/test/update-inventory.test.ts` (1292-1294: the real agent's row, `agentOps: ['update', 'token-sync']`). The last two are not in the contract's list; both are real-agent pins on the ready frame's `ops` and red the moment the word ships.
- Test (pin added, plan assembly): `server/test/whitelist-subset.test.ts` — the layer-4 comment at :612 (one line reworded in place, no line moves) and a describe APPENDED at the end of the file (Step 8b). Layer 4 rests on the update op being "the ONE wire-triggered spawn outside the exec whitelist"; this op is the second, and nothing else pins that `spawnTokenSync(` has one caller.

**Interfaces:**
- Consumes (A1): `TOKEN_SYNC_OP`, `TokenSyncReq`, `TokenSyncOpError`, `TOKEN_SYNC_EXIT`, `TOKEN_SYNC_STDERR_PREFIX`, `TOKEN_SYNC_SYNCED_RE`, `TokenTransport`, `isClaimCode`, `tokenSyncSpawnArgv`, `TOKEN_SYNC_SPAWN_TIMEOUT_MS`, `TOKEN_SYNC_KILL_GRACE_MS`, `TOKEN_SYNC_DRAIN_MS`, `isTokenVerbMissing` (tests); existing `updateLauncherPath`, `firstStderrLine`, `UPDATE_OP`.
- Produces (`agent/src/tokensync.ts`): `type TokenSyncSpawn = (file: string, args: readonly string[], code: string, timeoutMs: number) => Promise<TokenSyncSpawnResult>`; `interface TokenSyncSpawnResult { code: number; stdout: string | null; stderr: string; killed: boolean; pid: number | null }`; `interface TokenSyncEnv { HOME: string; PATH: string; LANG: string }`; `tokenSyncEnv(home: string, from?: NodeJS.ProcessEnv): TokenSyncEnv`; `makeTokenSyncSpawn(env: TokenSyncEnv): TokenSyncSpawn`; `type TokenSyncAnswer = { ok: true; synced: string; transport: TokenTransport } | { ok: false; err: TokenSyncOpError; detail: string }`; `tokenSyncAnswer(r: TokenSyncSpawnResult): TokenSyncAnswer`. (`TokenSyncSpawnResult`, `TokenSyncEnv`, `tokenSyncEnv`, `TokenSyncAnswer` and `tokenSyncAnswer` are ADDED names; the contract named only `TokenSyncSpawn` and `makeTokenSyncSpawn(env)`.)
- Produces (`agent/src/server.ts`): `AgentOpts.spawnTokenSync?: TokenSyncSpawn` (default `makeTokenSyncSpawn(tokenSyncEnv(home))`); `ReqRefusal.refuse: Extract<UpdateOpError, 'bad-tag' | 'bad-kind'> | Extract<TokenSyncOpError, 'bad-code'>`; on the wire: request `{t:'req', id, op:'token-sync', code}`; success `{t:'res', id, ok:true, synced:'<16 hex>', transport:'http'|'https'}` (this agent always sends `transport`, because success requires the synced line, which carries it; the server still reads an absent field as `unmeasured`); failure `{t:'res', id, ok:false, err:<TokenSyncOpError>, detail}` (`bad-code` alone carries no detail); `ready.ops` `['update', 'token-sync']`.

- [ ] **Step 1: Write the failing tests**

Create `agent/test/token-sync-op.test.ts`:

```ts
// Box-token lifecycle spec 2026-10-07 §4.4: the `token-sync` op, answered by a REAL agent over a real loopback WS
// against a fixture HOME (`update-op.test.ts`'s idiom). Every spawn is the injected `AgentOpts.spawnTokenSync`
// recorder, except the describe at the end, which runs the real port over a fixture launcher UNDER the fixture HOME
// with the process's PATH and HOME contained. No case touches a real `~/.local/bin/ccrc` or the live `$HOME`.
//
// What is pinned (spec §10 "The op's validation and spawn", "Transport field"):
//  - The code is gated in `validateReq` by `isClaimCode`, before any case body: a malformed code answers `bad-code`
//    and spawns nothing. Never `bad-request`, which from this op means "the agent predates it".
//  - The spawn is the absolute launcher with exactly the frozen template; the code reaches stdin, never argv.
//  - The child's environment is exactly {HOME, PATH, LANG}: no CCRC_AGENT_TOKEN, nothing else of the agent's.
//  - At the bound the group gets SIGTERM (the verb's trap runs) before SIGKILL.
//  - The child's answer maps to one closed word, by exit code AND first stderr line; success carries `transport`.
//  - One gate per agent PROCESS: a second op while one runs is `busy`, on any connection.
//  - The ready frame advertises ['update', 'token-sync'].
//  - The op reaches no exec path (a SOURCE scan: no behavioural case sees an extra call whose answer is the same).
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunningAgent } from '../src/server.js';
import {
  makeTokenSyncSpawn, tokenSyncAnswer, tokenSyncEnv, type TokenSyncSpawn, type TokenSyncSpawnResult,
} from '../src/tokensync.js';
import { EXEC_COMMANDS, isExecAllowed } from '../src/whitelist.js';
import {
  TOKEN_SYNC_EXIT, TOKEN_SYNC_KILL_GRACE_MS, TOKEN_SYNC_SPAWN_TIMEOUT_MS, isTokenVerbMissing, tokenSyncSpawnArgv,
  updateLauncherPath, type AgentReady,
} from '../../shared/agent-protocol.js';
import { makeFixture, boot, TestClient, type Fixture } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_TS = path.resolve(here, '..', 'src', 'server.ts');
const TOKENSYNC_TS = path.resolve(here, '..', 'src', 'tokensync.ts');

interface Res { t: 'res'; id: number; ok: boolean; err?: string; detail?: string; synced?: string; transport?: string }
interface SpawnCall { file: string; args: string[]; code: string; timeoutMs: number }

/** A 43-character base64url code, built at runtime (never a literal a scan could match). */
const CODE = `${'Ab0_-'.repeat(8)}xyz`;
const TEMPLATE = ['token', 'sync', '--from', 'agent'];
const SYNCED: TokenSyncSpawnResult = { code: 0, stdout: 'synced 0123456789abcdef https\n', stderr: '', killed: false, pid: 4242 };

/** A recording `spawnTokenSync`. After `park()`, every call waits until `release()`. */
function recorder(answer: TokenSyncSpawnResult = SYNCED) {
  const calls: SpawnCall[] = [];
  let gate: Promise<void> | null = null;
  let open: () => void = () => {};
  const spawn: TokenSyncSpawn = async (file, args, code, timeoutMs) => {
    calls.push({ file, args: [...args], code, timeoutMs });
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

/** The text between `open` and the first `close` match after it, from the real source. */
function slice(src: string, open: string, close: RegExp): string {
  const at = src.indexOf(open);
  expect(at, `${open} not found`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(at + open.length);
  const end = close.exec(rest);
  expect(end, `no end after ${open}`).not.toBeNull();
  return rest.slice(0, end!.index);
}
const EXEC_PATH = /\b(?:isExecAllowed|runExec|resolveSpawnCmd|checkPath)\s*\(|\bEXEC_WHITELIST\b/;
const CASE_END = /\n    (?:case '|default:)/;

describe('the token-sync op', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
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

  async function up(rec = recorder()): Promise<{ c: TestClient; rec: ReturnType<typeof recorder>; home: string }> {
    fixture = makeFixture();
    agent = await boot(fixture, { spawnTokenSync: rec.spawn });
    return { c: await open(agent.port), rec, home: fixture.home };
  }

  describe('validateReq gates the code before any case body runs', () => {
    it('a malformed code is bad-code, never bad-request, and spawns nothing', async () => {
      const { c, rec } = await up();
      const frames: Record<string, unknown>[] = [
        { op: 'token-sync', code: CODE.slice(1) }, { op: 'token-sync', code: `${CODE}x` },
        { op: 'token-sync', code: `${CODE.slice(1)}=` }, { op: 'token-sync', code: `${CODE.slice(1)}+` },
        { op: 'token-sync', code: `${CODE}\n` }, { op: 'token-sync', code: '; rm -rf ~' },
        { op: 'token-sync', code: 43 }, { op: 'token-sync', code: null }, { op: 'token-sync' },
        { op: 'token-sync', code: [CODE] },
      ];
      for (const [i, frame] of frames.entries()) {
        expect(await c.req<Res>(i + 1, frame), JSON.stringify(frame)).toEqual({ t: 'res', id: i + 1, ok: false, err: 'bad-code' });
      }
      // Asserted after every frame was answered: with the guard removed the recorder would hold the spawns.
      expect(rec.calls, 'a malformed code reached the spawn').toEqual([]);
    });

    it('no id is no reply (the envelope rule, unchanged) and the connection keeps serving', async () => {
      const { c, rec } = await up();
      c.send({ t: 'req', op: 'token-sync', code: CODE });
      expect(await c.req<Res>(2, { op: 'token-sync', code: CODE })).toMatchObject({ id: 2, ok: true });
      await expect(c.waitFor((m) => (m as Res).t === 'res' && (m as Res).id === undefined, 300)).rejects.toThrow('timed out');
      expect(rec.calls).toHaveLength(1);
    });
  });

  describe('the spawn — the absolute launcher, one frozen template, the code on stdin', () => {
    it('spawns <home>/.local/bin/ccrc with exactly the template, the code as stdin, at the 40 s bound', async () => {
      const { c, rec, home } = await up();
      const res = await c.req<Res>(1, { op: 'token-sync', code: CODE });
      expect(rec.calls).toEqual([{ file: updateLauncherPath(home), args: TEMPLATE, code: CODE, timeoutMs: TOKEN_SYNC_SPAWN_TIMEOUT_MS }]);
      expect(rec.calls[0]!.args.join(' '), 'the code reached argv').not.toContain(CODE);
      expect(res).toEqual({ t: 'res', id: 1, ok: true, synced: '0123456789abcdef', transport: 'https' });
      expect(JSON.stringify(res), 'the code came back in the result').not.toContain(CODE);
    });

    it('carries the transport the child used: http rotates too (R2), and the field is always sent', async () => {
      const { c } = await up(recorder({ ...SYNCED, stdout: 'synced fedcba9876543210 http\n' }));
      expect(await c.req<Res>(1, { op: 'token-sync', code: CODE }))
        .toEqual({ t: 'res', id: 1, ok: true, synced: 'fedcba9876543210', transport: 'http' });
    });
  });

  describe("the child's answer, mapped by exit code AND first stderr line", () => {
    const base = { stdout: '', killed: false, pid: 4242 };
    it('each verb word, at its own exit code with its own prefix, is that word with its line as detail', async () => {
      for (const [word, code] of Object.entries(TOKEN_SYNC_EXIT)) {
        const line = `ccrc: token sync: ${word}: a sentence`;
        expect(tokenSyncAnswer({ ...base, code, stderr: `${line}\nsecond\n` }), word).toEqual({ ok: false, err: word, detail: line });
      }
    });

    it('an exit code and a line that disagree, or a bare code, are spawn-failed carrying the line', () => {
      expect(tokenSyncAnswer({ ...base, code: TOKEN_SYNC_EXIT['claim-refused'], stderr: 'ccrc: token sync: code-used: x\n' }))
        .toEqual({ ok: false, err: 'spawn-failed', detail: 'ccrc: token sync: code-used: x' });
      expect(tokenSyncAnswer({ ...base, code: TOKEN_SYNC_EXIT['code-used'], stderr: 'Traceback (most recent call last):\n' }))
        .toEqual({ ok: false, err: 'spawn-failed', detail: 'Traceback (most recent call last):' });
      expect(tokenSyncAnswer({ ...base, code: 1, stderr: '' })).toEqual({ ok: false, err: 'spawn-failed', detail: 'no message' });
    });

    it("an older ccrc's usage line is spawn-failed, and the server reads it as verb-missing (D-4395)", () => {
      const a = tokenSyncAnswer({ ...base, code: 2, stderr: 'ccrc: unknown argument: token\nusage: ccrc ...\n' });
      expect(a).toEqual({ ok: false, err: 'spawn-failed', detail: 'ccrc: unknown argument: token' });
      expect(isTokenVerbMissing(a.ok ? null : a.detail)).toBe(true);
    });

    it('exit 0 without exactly the synced line, or with stdout unmeasured, is spawn-failed', () => {
      for (const stdout of ['', 'synced 0123456789abcdef\n', 'synced 0123456789abcdef https\nmore\n', 'ok\n', null]) {
        expect(tokenSyncAnswer({ ...base, code: 0, stdout, stderr: '' }), JSON.stringify(stdout))
          .toMatchObject({ ok: false, err: 'spawn-failed' });
      }
    });

    it('a child stopped at the bound is spawn-failed naming the bound, whatever it printed', () => {
      expect(tokenSyncAnswer({ code: 143, stdout: 'synced 0123456789abcdef https\n', stderr: 'ccrc: token sync: write-failed: x', killed: true, pid: 1 }))
        .toEqual({ ok: false, err: 'spawn-failed', detail: 'stopped at the 40000 ms bound' });
    });

    it('the answers travel: a refusal frame carries the word and the detail', async () => {
      const { c } = await up(recorder({ ...base, code: 21, stderr: 'ccrc: token sync: claim-refused: the server answered 404\n' }));
      expect(await c.req<Res>(1, { op: 'token-sync', code: CODE }))
        .toEqual({ t: 'res', id: 1, ok: false, err: 'claim-refused', detail: 'ccrc: token sync: claim-refused: the server answered 404' });
    });
  });

  describe('one gate per agent process', () => {
    it('a second op while one is spawning is busy, on the same connection and on another, and spawns nothing', async () => {
      const { c, rec } = await up();
      rec.park();
      const DETAIL = 'a token-sync op is already running on this agent';
      // No await between the sends: the gate must be checked and taken in one synchronous stretch.
      c.send({ t: 'req', id: 1, op: 'token-sync', code: CODE });
      c.send({ t: 'req', id: 2, op: 'token-sync', code: CODE });
      expect(await c.waitFor<Res>((m) => (m as Res).t === 'res' && (m as Res).id === 2))
        .toEqual({ t: 'res', id: 2, ok: false, err: 'busy', detail: DETAIL });
      const other = await open(agent!.port);
      expect(await other.req<Res>(3, { op: 'token-sync', code: CODE })).toEqual({ t: 'res', id: 3, ok: false, err: 'busy', detail: DETAIL });
      expect(rec.calls).toHaveLength(1);
      rec.release();
      expect(await c.waitFor<Res>((m) => (m as Res).t === 'res' && (m as Res).id === 1)).toMatchObject({ id: 1, ok: true });
      expect(await c.req<Res>(4, { op: 'token-sync', code: CODE }), 'the gate was not released').toMatchObject({ id: 4, ok: true });
    });
  });

  it("the ready frame advertises exactly ['update', 'token-sync']", async () => {
    fixture = makeFixture();
    agent = await boot(fixture, { spawnTokenSync: recorder().spawn });
    const c = new TestClient(agent.port);
    clients.push(c);
    expect((await c.hello() as AgentReady).ops).toEqual(['update', 'token-sync']);
  });

  describe('the op reaches no exec path — read from the source', () => {
    const src = readFileSync(SERVER_TS, 'utf8');
    const port = readFileSync(TOKENSYNC_TS, 'utf8');

    it("handleReq's token-sync case names no exec-surface call, and spawns only through the port", () => {
      const handle = slice(src, 'async function handleReq(', /\n\}\n/);
      const body = slice(handle, "case 'token-sync': {", CASE_END);
      expect(body).not.toMatch(EXEC_PATH);
      expect(body).toMatch(/const file = updateLauncherPath\(ctx\.cfg\.home\);/);
      expect(body).toMatch(/const argv = tokenSyncSpawnArgv\(\);/);
      expect(body).toMatch(/ctx\.spawnTokenSync\(file, argv, req\.code, TOKEN_SYNC_SPAWN_TIMEOUT_MS\)/);
    });

    it("validateReq's token-sync case calls the one code guard and restates no shape", () => {
      const validate = slice(src, 'function validateReq(', /\n\}\n/);
      const body = slice(validate, "case 'token-sync': {", CASE_END);
      expect(body).toMatch(/isClaimCode\(msg\.code\)/);
      expect(body).toMatch(/refuse: 'bad-code'/);
      expect(body, 'the code shape is restated here').not.toMatch(/\{43\}|A-Za-z0-9_-|CLAIM_CODE_RE/);
    });

    it('the port names no exec path, pipes stdin, and hands the child only its explicit env', () => {
      expect(port).not.toMatch(EXEC_PATH);
      expect(port).toMatch(/spawn\(file, \[\.\.\.args\], \{ detached: true, stdio: \['pipe', 'pipe', 'pipe'\], env: childEnv \}\)/);
      expect(port, 'the port reads the agent environment itself').not.toMatch(/env:\s*process\.env|\.\.\.process\.env/);
      expect(port).toMatch(/child\.stdin\?\.end\(`\$\{code\}\\n`\)/);
      const factory = slice(port, 'export function makeTokenSyncSpawn(', /\n\}\n/);
      expect(factory, 'the factory reads process.env').not.toMatch(/process\.env/);
    });

    it('ccrc stays off the exec surface: the exec op refuses the template', () => {
      expect([...EXEC_COMMANDS]).toEqual(['tmux', 'ccd']);
      expect(isExecAllowed('ccrc', [...tokenSyncSpawnArgv()])).toBe(false);
      expect(isExecAllowed(updateLauncherPath('/h'), [...tokenSyncSpawnArgv()])).toBe(false);
    });
  });

  it('tokenSyncEnv is exactly HOME, PATH and LANG: no CCRC_AGENT_TOKEN, nothing else of the agent', () => {
    expect(tokenSyncEnv('/h', { PATH: '/p', LANG: 'en_US.UTF-8', CCRC_AGENT_TOKEN: 'x', OTHER: 'y', HOME: '/elsewhere' }))
      .toEqual({ HOME: '/h', PATH: '/p', LANG: 'en_US.UTF-8' });
    expect(tokenSyncEnv('/h', {})).toEqual({ HOME: '/h', PATH: '/usr/bin:/bin', LANG: 'C' });
  });

  describe('the real port — one real child, under the fixture HOME', () => {
    // CONTAINMENT: every launcher is the fixture's absolute path, and PATH and HOME are cut to the fixture and the
    // system directories for these cases, restored whether the case passed or threw.
    const saved = { PATH: process.env.PATH, HOME: process.env.HOME, CCRC_AGENT_TOKEN: process.env.CCRC_AGENT_TOKEN };
    function contain(home: string): void {
      process.env.PATH = '/usr/bin:/bin';
      process.env.HOME = home;
      // Planted in the agent's own environment, built from pieces: the child must never see it.
      process.env.CCRC_AGENT_TOKEN = ['planted', 'agent', 'bearer'].join('-');
    }
    afterEach(() => {
      for (const k of ['PATH', 'HOME', 'CCRC_AGENT_TOKEN'] as const) {
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

    it("is the agent's default: exact argv, the code on stdin then EOF, and an environment of exactly three names", async () => {
      fixture = makeFixture();
      contain(fixture.home);
      const h = fixture.home;
      plantLauncher(h, [
        `printf '%s\\n' "$0" "$@" > '${h}/argv'`,
        `IFS= read -r line; printf '%s' "$line" > '${h}/stdin'`,
        `if IFS= read -r more; then echo more > '${h}/stdin-more'; fi`,
        `/usr/bin/env > '${h}/env'`,
        `echo 'synced 0123456789abcdef https'`,
      ].join('\n'));
      agent = await boot(fixture);   // NO spawnTokenSync: startAgent's default is the thing under test
      const c = await open(agent.port);
      expect(await c.req<Res>(1, { op: 'token-sync', code: CODE }))
        .toEqual({ t: 'res', id: 1, ok: true, synced: '0123456789abcdef', transport: 'https' });
      expect(readFileSync(path.join(h, 'argv'), 'utf8')).toBe([path.join(h, '.local', 'bin', 'ccrc'), ...TEMPLATE, ''].join('\n'));
      expect(readFileSync(path.join(h, 'argv'), 'utf8'), 'the code reached argv').not.toContain(CODE);
      expect(readFileSync(path.join(h, 'stdin'), 'utf8')).toBe(CODE);
      expect(existsSync(path.join(h, 'stdin-more')), 'stdin carried more than the code line').toBe(false);
      const env = readFileSync(path.join(h, 'env'), 'utf8');
      expect(env, 'the agent bearer reached the child').not.toContain('CCRC_AGENT_TOKEN');
      expect(env).not.toContain(['planted', 'agent', 'bearer'].join('-'));
      const names = env.split('\n').filter((l) => l.includes('=')).map((l) => l.slice(0, l.indexOf('=')));
      // The shell may add its own bookkeeping names (PWD, OLDPWD, SHLVL, _); nothing else of the agent's.
      expect(names.filter((n) => !['PWD', 'OLDPWD', 'SHLVL', '_'].includes(n)).sort()).toEqual(['HOME', 'LANG', 'PATH']);
      expect(env).toContain(`HOME=${h}\n`);
    });

    it('a launcher that is not there is spawn-failed naming why, which the server reads as verb-missing (D-4395)', async () => {
      fixture = makeFixture();
      contain(fixture.home);
      agent = await boot(fixture);
      const c = await open(agent.port);
      const res = await c.req<Res>(1, { op: 'token-sync', code: CODE });
      expect(res).toEqual({ t: 'res', id: 1, ok: false, err: 'spawn-failed', detail: 'could not start the launcher (ENOENT)' });
      expect(isTokenVerbMissing(res.detail)).toBe(true);
    });

    it('at the bound the group gets SIGTERM first (the trap runs), then SIGKILL after the grace', async () => {
      fixture = makeFixture();
      contain(fixture.home);
      const h = fixture.home;
      // Traps TERM and keeps running, so only the SIGKILL ends it: the trap's record proves TERM came first.
      const file = plantLauncher(h, [
        `touch '${h}/temp'`,
        `trap "echo TERM >> '${h}/sig'; rm -f '${h}/temp'" TERM`,
        'while :; do sleep 0.05; done',
      ].join('\n'));
      const spawnReal = makeTokenSyncSpawn(tokenSyncEnv(h));
      const t0 = Date.now();
      const r = await spawnReal(file, tokenSyncSpawnArgv(), CODE, 300);
      const took = Date.now() - t0;
      expect(r.killed).toBe(true);
      expect(readFileSync(path.join(h, 'sig'), 'utf8')).toBe('TERM\n');
      expect(existsSync(path.join(h, 'temp')), 'the trap did not remove its temp').toBe(false);
      expect(took, 'SIGKILL came before the grace').toBeGreaterThanOrEqual(300 + TOKEN_SYNC_KILL_GRACE_MS - 100);
      expect(took).toBeLessThan(300 + TOKEN_SYNC_KILL_GRACE_MS + 2_500);
      expect(tokenSyncAnswer(r)).toEqual({ ok: false, err: 'spawn-failed', detail: 'stopped at the 40000 ms bound' });
    });

    it('a child whose trap exits on SIGTERM answers at once, without waiting out the grace', async () => {
      fixture = makeFixture();
      contain(fixture.home);
      const h = fixture.home;
      const file = plantLauncher(h, [
        `touch '${h}/temp'`,
        `trap "rm -f '${h}/temp'; exit 143" TERM`,
        'while :; do sleep 0.05; done',
      ].join('\n'));
      const t0 = Date.now();
      const r = await makeTokenSyncSpawn(tokenSyncEnv(h))(file, tokenSyncSpawnArgv(), CODE, 300);
      expect(r.killed).toBe(true);
      expect(existsSync(path.join(h, 'temp'))).toBe(false);
      expect(Date.now() - t0).toBeLessThan(300 + TOKEN_SYNC_KILL_GRACE_MS);
    });
  });
});
```

Append to `server/test/update-spawn-twin-bodies.test.ts` (D-4390: the twins stay two):

```diff
diff --git a/server/test/update-spawn-twin-bodies.test.ts b/server/test/update-spawn-twin-bodies.test.ts
--- a/server/test/update-spawn-twin-bodies.test.ts
+++ b/server/test/update-spawn-twin-bodies.test.ts
@@ -41,3 +41,28 @@ describe('the two bounded-spawn bodies are one text', () => {
     expect(agent).toEqual(server);
   });
 });
+
+// D-4390 (box-token lifecycle wave 1): the `token-sync` op's spawn is its OWN bounded body in `agent/src/tokensync.ts`
+// (stdin piped, an explicit {HOME, PATH, LANG}, SIGTERM then SIGKILL), not a third twin and not the twin with stdin
+// as a parameter. The twins stay two; the third body stays visibly separate, so an edit that copies the twin into it
+// (or folds it into the twin) is a red here rather than a silent fourth way to read the pair above.
+describe('the token-sync spawn is not a third twin (D-4390)', () => {
+  const tokensync = read('../../agent/src/tokensync.ts');
+  const count = (src: string, sentinel: string): number => src.split('\n').filter((l) => l.trim().startsWith(sentinel)).length;
+
+  it('agent/src/tokensync.ts carries no bounded-spawn sentinel, and agent/src/server.ts still carries exactly one pair', () => {
+    expect(count(tokensync, BEGIN), 'a twin sentinel in tokensync.ts').toBe(0);
+    expect(count(tokensync, END), 'a twin sentinel in tokensync.ts').toBe(0);
+    const agentSrc = read('../../agent/src/server.ts');
+    expect(count(agentSrc, BEGIN)).toBe(1);
+    expect(count(agentSrc, END)).toBe(1);
+  });
+
+  it('its body is its own: stdin piped, an explicit env, SIGTERM before SIGKILL; the twins pipe no stdin', () => {
+    expect(tokensync).toContain("stdio: ['pipe', 'pipe', 'pipe'], env: childEnv");
+    expect(tokensync).toContain("signalGroup('SIGTERM')");
+    expect(tokensync).toContain("signalGroup('SIGKILL')");
+    expect(tokensync.indexOf("signalGroup('SIGTERM')")).toBeLessThan(tokensync.indexOf("signalGroup('SIGKILL')"));
+    expect(region(read('../../agent/src/server.ts'), 'agent/src/server.ts').join('\n')).toContain("stdio: ['ignore', 'pipe', 'pipe']");
+  });
+});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
mkdir -p .tmp-a2 && (cd agent && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/token-sync-op.test.ts)
mkdir -p .tmp-a2 && (cd server && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/update-spawn-twin-bodies.test.ts)
```

Expected: `Error: Cannot find module '../src/tokensync.js' imported from …/agent/test/token-sync-op.test.ts`; `Error: ENOENT: no such file or directory, open '…/agent/src/tokensync.ts'`. Both `Tests  no tests`.

- [ ] **Step 3: Write the spawn port**

Create `agent/src/tokensync.ts`:

```ts
import { spawn } from 'node:child_process';
import os from 'node:os';
import {
  TOKEN_SYNC_DRAIN_MS, TOKEN_SYNC_EXIT, TOKEN_SYNC_KILL_GRACE_MS, TOKEN_SYNC_SPAWN_TIMEOUT_MS, TOKEN_SYNC_STDERR_PREFIX,
  TOKEN_SYNC_SYNCED_RE, firstStderrLine, type TokenSyncOpError, type TokenTransport,
} from '../../shared/agent-protocol.js';

/**
 * The `token-sync` op's spawn port (box-token lifecycle spec 2026-10-07 §4.4). It is the second wire-triggered spawn
 * outside the exec whitelist, beside the `update` op's, and like that one it is NOT `runExec`: `ccrc` is on neither
 * exec list, and the argv is one frozen template with no variable token (`tokenSyncSpawnArgv`).
 *
 * D-4390: this is its OWN bounded body, not a third copy of the update op's pinned twin
 * (`agent/src/server.ts`'s `makeUpdateSpawn`, `server/src/update/spawn.ts`) and not that body with stdin as a
 * parameter. Three things differ, each on purpose:
 *  - stdin is a PIPE carrying the claim code and one newline, then EOF. The code never reaches argv, where any
 *    process on the box could read it from `/proc/<pid>/cmdline`.
 *  - the environment is the explicit `{HOME, PATH, LANG}` the factory is given, never `process.env`, which carries
 *    `CCRC_AGENT_TOKEN` into the environ of the verb and of its `curl`.
 *  - the bound sends SIGTERM to the child's process group first and SIGKILL `TOKEN_SYNC_KILL_GRACE_MS` later, so the
 *    verb's trap can remove its temps; SIGKILL runs no trap.
 * `server/test/update-spawn-twin-bodies.test.ts` holds that this file carries no twin sentinel.
 *
 * Production is the port `startAgent` builds from `makeTokenSyncSpawn(tokenSyncEnv(home))`; tests inject a recorder
 * through `AgentOpts.spawnTokenSync`.
 */
export type TokenSyncSpawn = (file: string, args: readonly string[], code: string, timeoutMs: number) => Promise<TokenSyncSpawnResult>;

/** What the bounded token-sync spawner answers. `stdout` is the child's whole stdout read to EOF, or `null` when EOF
 *  was not reached within the drain or the capture cap was hit: `null` is "not measured", never "empty". `killed` is
 *  true when the bound fired (SIGTERM to the group, then SIGKILL if it was still running after the grace). */
export interface TokenSyncSpawnResult { code: number; stdout: string | null; stderr: string; killed: boolean; pid: number | null }

/** The child's whole environment. Nothing else from the agent's own environment reaches it. */
export interface TokenSyncEnv { HOME: string; PATH: string; LANG: string }

/** The explicit environment, from the agent's configured home and two names of its own environment. A PATH the
 *  agent lacks is the system directories (the verb needs `curl` and `python3`; the launcher itself is absolute). */
export function tokenSyncEnv(home: string, from: NodeJS.ProcessEnv = process.env): TokenSyncEnv {
  return { HOME: home, PATH: from.PATH ?? '/usr/bin:/bin', LANG: from.LANG ?? 'C' };
}

/** The verb prints one short line on each stream; past this the capture stops and stdout reads as not measured. */
const TOKEN_SYNC_MAX_BUFFER = 64 * 1024;

/**
 * The verb under a bound. The child is its own PROCESS GROUP (`detached`, pgid = pid), so the bound reaches the
 * `curl` it may be running too. Answers, kept apart:
 *  - `killed` — the child was still running at `timeoutMs`: the group got SIGTERM, and SIGKILL
 *    `TOKEN_SYNC_KILL_GRACE_MS` later unless the child had exited by then.
 *  - A spawn error (`ENOENT`/`EACCES`): code 1, `pid: null`, and the sentence `could not start the launcher (<code>)`,
 *    the update port's own words (D-3393), which `isTokenVerbMissing` reads as the `verb-missing` hold (D-4395).
 *  - Every other exit — the child's code (`128 + signo` for a signal that was not ours), stderr and stdout.
 * The answer comes once the child has exited and both pipes reached EOF, or at ONE drain deadline armed by the exit
 * or by the SIGKILL, whichever comes first, never restarted. So the whole answer arrives within
 * `timeoutMs + TOKEN_SYNC_KILL_GRACE_MS + TOKEN_SYNC_DRAIN_MS` of the spawn. Nothing resolves twice.
 */
export function makeTokenSyncSpawn(env: TokenSyncEnv): TokenSyncSpawn {
  // Copied name by name, so a caller's object with more fields still hands the child exactly three.
  const childEnv: NodeJS.ProcessEnv = { HOME: env.HOME, PATH: env.PATH, LANG: env.LANG };
  return (file, args, code, timeoutMs) => new Promise((resolve) => {
    let settled = false;
    let exited: { code: number } | null = null;
    let killed = false;
    let termTimer: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;
    let drainTimer: NodeJS.Timeout | null = null;
    const out = { chunks: [] as Buffer[], bytes: 0, capped: false, broken: false, eof: false };
    const err = { chunks: [] as Buffer[], bytes: 0, capped: false, broken: false, eof: false };
    const child = spawn(file, [...args], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
    const clear = (): void => {
      for (const t of [termTimer, killTimer, drainTimer]) if (t !== null) clearTimeout(t);
      termTimer = killTimer = drainTimer = null;
    };
    const finish = (r: TokenSyncSpawnResult): void => {
      if (settled) return;
      settled = true;
      clear();
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(r);
    };
    const answer = (): void => {
      if (exited === null) return;
      finish({
        code: exited.code,
        stdout: out.eof && !out.capped && !out.broken ? Buffer.concat(out.chunks).toString('utf8') : null,
        stderr: Buffer.concat(err.chunks).toString('utf8'),
        killed,
        pid: child.pid ?? null,
      });
    };
    const armDrain = (): void => {
      if (drainTimer !== null) return;
      drainTimer = setTimeout(() => { exited ??= { code: 1 }; answer(); }, TOKEN_SYNC_DRAIN_MS);
    };
    const signalGroup = (signal: 'SIGTERM' | 'SIGKILL'): void => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, signal); } catch (e) {
        // ESRCH: the group is already gone. Anything else: fall back to the child alone rather than to nothing.
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal);
      }
    };
    const take = (buf: typeof out) => (chunk: Buffer): void => {
      if (buf.capped) return;
      if (buf.bytes + chunk.length > TOKEN_SYNC_MAX_BUFFER) { buf.capped = true; return; }
      buf.chunks.push(chunk);
      buf.bytes += chunk.length;
    };
    const broke = (buf: typeof out, other: typeof out) => (): void => {
      buf.broken = true;
      buf.eof = true;
      if (other.eof) answer();
    };
    // A child that exits before reading its stdin makes the write fail with EPIPE; an unhandled stream error would
    // kill the agent, and the exit is what answers.
    child.stdin?.on('error', () => {});
    child.stdin?.end(`${code}\n`);
    child.stdout?.on('data', take(out));
    child.stderr?.on('data', take(err));
    child.stdout?.on('end', () => { out.eof = true; if (err.eof) answer(); });
    child.stderr?.on('end', () => { err.eof = true; if (out.eof) answer(); });
    child.stdout?.on('error', broke(out, err));
    child.stderr?.on('error', broke(err, out));
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (child.pid !== undefined) return;
      finish({
        code: 1, stdout: '', killed: false, pid: null,
        stderr: `could not start the launcher (${typeof e.code === 'string' ? e.code : 'unknown'})`,
      });
    });
    child.once('exit', (exitCode, signal) => {
      if (termTimer !== null) { clearTimeout(termTimer); termTimer = null; }
      if (killTimer !== null) { clearTimeout(killTimer); killTimer = null; }
      const signo = signal === null ? undefined : os.constants.signals[signal];
      exited = { code: typeof exitCode === 'number' ? exitCode : signo !== undefined ? 128 + signo : 1 };
      if (out.eof && err.eof) { answer(); return; }
      armDrain();
    });
    termTimer = setTimeout(() => {
      termTimer = null;
      if (exited !== null || child.pid === undefined) return;
      killed = true;
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => {
        killTimer = null;
        if (exited !== null) return;
        signalGroup('SIGKILL');
        // A child that will not die (an uninterruptible wait) must not stop the answer past the drain bound.
        armDrain();
      }, TOKEN_SYNC_KILL_GRACE_MS);
    }, timeoutMs);
  });
}

/** The op's answer, mapped from the child (spec §4.4). No branch carries the code or a value: the verb prints neither,
 *  and the detail is the first stderr line cleaned to printable ASCII and cut to 200 (`firstStderrLine`). */
export type TokenSyncAnswer =
  | { ok: true; synced: string; transport: TokenTransport }
  | { ok: false; err: TokenSyncOpError; detail: string };

/** The ONE mapping. Killed at the bound -> `spawn-failed`, naming the bound. Exit 0 with exactly the synced line ->
 *  success. An exit code equal to `TOKEN_SYNC_EXIT[w]` AND a first stderr line starting `ccrc: token sync: <w>:` ->
 *  `w`; both must agree, so a crash that happens to exit 21 is not read as the server's refusal. Anything else ->
 *  `spawn-failed` with the first stderr line (an older `ccrc`'s `unknown argument: token` included, which the server
 *  reads as the `verb-missing` hold, D-4395). */
export function tokenSyncAnswer(r: TokenSyncSpawnResult): TokenSyncAnswer {
  if (r.killed) return { ok: false, err: 'spawn-failed', detail: `stopped at the ${TOKEN_SYNC_SPAWN_TIMEOUT_MS} ms bound` };
  if (r.code === 0 && r.stdout !== null) {
    const line = r.stdout.endsWith('\n') ? r.stdout.slice(0, -1) : r.stdout;
    const m = TOKEN_SYNC_SYNCED_RE.exec(line);
    if (m !== null) return { ok: true, synced: m[1]!, transport: m[2] as TokenTransport };
  }
  const first = firstStderrLine(r.stderr);
  for (const [word, exit] of Object.entries(TOKEN_SYNC_EXIT) as [keyof typeof TOKEN_SYNC_EXIT, number][]) {
    if (r.code === exit && first.startsWith(`${TOKEN_SYNC_STDERR_PREFIX}${word}:`)) return { ok: false, err: word, detail: first };
  }
  return { ok: false, err: 'spawn-failed', detail: first };
}
```

- [ ] **Step 4: Run them: the port passes, the op is still missing**

```bash
mkdir -p .tmp-a2 && (cd agent && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/token-sync-op.test.ts)
mkdir -p .tmp-a2 && (cd server && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/update-spawn-twin-bodies.test.ts)
```

Expected: `token-sync-op.test.ts` `Tests  11 failed | 10 passed (21)` — every case over the wire fails (a malformed code answers `bad-request`, the ready frame lacks the word, the source scans find no `case 'token-sync'`), while the mapping, `tokenSyncEnv` and the three real-port cases pass; `update-spawn-twin-bodies.test.ts` `Tests  4 passed (4)`.

- [ ] **Step 5: Wire the op into the agent**

Edit `agent/src/server.ts` exactly as below:

```diff
diff --git a/agent/src/server.ts b/agent/src/server.ts
--- a/agent/src/server.ts
+++ b/agent/src/server.ts
@@ -25,14 +25,17 @@ import type {
   TailData,
   TailOpenReq,
   TailReset,
+  TokenSyncOpError,
+  TokenSyncReq,
   UpdateOpError,
   UpdateReq,
   WriteB64Req,
 } from '../../shared/agent-protocol.js';
 import {
-  CCRC_DIR_NAME, NODE_FILE_BASENAMES, NODE_FILES, parseCcdCaps, parseObservedEpochDoc, POOL_EPOCH_FILE_NAME, UPDATE_OP,
-  UPDATE_SPAWN_DRAIN_MS, UPDATE_SPAWN_TIMEOUT_MS, decideKilledSpawn, firstStderrLine, inFlightBusyDetail, isUpdateLockHeldLine,
-  lockHeldBusyDetail, updateLauncherPath, updateSpawnArgv, updateWriterMayLive,
+  CCRC_DIR_NAME, NODE_FILE_BASENAMES, NODE_FILES, parseCcdCaps, parseObservedEpochDoc, POOL_EPOCH_FILE_NAME, TOKEN_SYNC_OP,
+  TOKEN_SYNC_SPAWN_TIMEOUT_MS, UPDATE_OP, UPDATE_SPAWN_DRAIN_MS, UPDATE_SPAWN_TIMEOUT_MS, decideKilledSpawn, firstStderrLine,
+  inFlightBusyDetail, isClaimCode, isUpdateLockHeldLine, lockHeldBusyDetail, tokenSyncSpawnArgv, updateLauncherPath,
+  updateSpawnArgv, updateWriterMayLive,
   type KillProbeOutcome, type UpdateReportRead, type UpdateSpawnResult,
 } from '../../shared/agent-protocol.js';
 import { inFlightReport, isReleaseTag, isRequestKind, type InFlightReport } from '../../shared/api.js';
@@ -54,6 +57,7 @@ import {
 } from './fileops.js';
 import { isSessionIdAllowed, spawnFleetPty, type PtyProcess, type PtySpawn } from './pty.js';
 import { openTail, type TailHandle } from './tail.js';
+import { makeTokenSyncSpawn, tokenSyncAnswer, tokenSyncEnv, type TokenSyncSpawn } from './tokensync.js';
 import { canonicalize, checkPath, isExecAllowed, type WhitelistConfig } from './whitelist.js';
 
 /**
@@ -72,6 +76,7 @@ export interface AgentOpts {
   helloTimeoutMs?: number;  // default 3000 — override for fast tests only
   spawnPty?: PtySpawn;      // default spawnFleetPty (real node-pty) — tests inject a fake spawn
   spawnUpdate?: UpdateSpawn; // default realUpdateSpawn (a process-group spawn) — tests inject a recorder; the `update` op's ONLY spawn
+  spawnTokenSync?: TokenSyncSpawn; // default makeTokenSyncSpawn(tokenSyncEnv(home)) — tests inject a recorder; the `token-sync` op's ONLY spawn
 }
 
 export interface RunningAgent {
@@ -212,6 +217,11 @@ function failUpdate(id: number, err: UpdateOpError, detail?: string): ResErr {
   return fail(id, err, detail);
 }
 
+/** The `token-sync` op's refusals, typed to its closed vocabulary (`TOKEN_SYNC_OP_ERRORS`) the same way. */
+function failTokenSync(id: number, err: TokenSyncOpError, detail?: string): ResErr {
+  return fail(id, err, detail);
+}
+
 /** Builds the `read` op's wire payload from `readWhole`'s result. `data`
  *  keeps its exact pre-existing meaning (null for BOTH absent and
  *  unreadable) so an older server's `typeof data === 'string' ? data : null`
@@ -332,9 +342,10 @@ function runExec(
 }
 
 /**
- * The `update` op's spawn port (design 2026-09-20 §10). It is the ONE place a
- * wire-triggered request reaches a process spawn outside the exec whitelist,
- * and it is deliberately NOT `runExec`: `runExec` is the exec op's executor,
+ * The `update` op's spawn port (design 2026-09-20 §10). It is one of the TWO
+ * places a wire-triggered request reaches a process spawn outside the exec
+ * whitelist (the other is the `token-sync` op's port, `./tokensync.ts`, its
+ * own body by D-4390), and it is deliberately NOT `runExec`: `runExec` is the exec op's executor,
  * and a call to it here would put this op on the exec path in the reader's
  * mind, which is exactly what §18 "the op never execs" forbids. Production is
  * `realUpdateSpawn`; tests inject a recorder through `AgentOpts.spawnUpdate`.
@@ -464,6 +475,11 @@ export const realUpdateSpawn: UpdateSpawn = makeUpdateSpawn(process.env);
  *  (wave 4 Task 3), so both would pass it and write `queued`. */
 interface UpdateGate { spawning: boolean }
 
+/** ONE per agent PROCESS as well, for the `token-sync` op (spec 4.4, "one gate per agent process allows one sync at
+ *  a time"), for UpdateGate's reason: a server that reconnects on a new socket and re-sends the op must not start a
+ *  second verb beside the first. Separate from UpdateGate: the driver itself holds while an update is in flight. */
+interface TokenSyncGate { spawning: boolean }
+
 interface PtyEntry {
   proc: PtyProcess;
   dataSub: { dispose(): void };
@@ -479,6 +495,8 @@ interface ConnCtx {
   spawnPty: PtySpawn;
   spawnUpdate: UpdateSpawn;
   updateGate: UpdateGate;
+  spawnTokenSync: TokenSyncSpawn;
+  tokenSyncGate: TokenSyncGate;
 }
 
 async function handleReq(ws: WebSocket, req: AgentReq, ctx: ConnCtx, verbCache: VerbCache): Promise<void> {
@@ -632,8 +650,8 @@ async function handleReq(ws: WebSocket, req: AgentReq, ctx: ConnCtx, verbCache:
       return;
     }
     case 'update': {
-      // Design 2026-09-20 §10. THE ONE wire-triggered spawn outside the exec
-      // whitelist (agent/CLAUDE.md). `validateReq` has already refused a tag
+      // Design 2026-09-20 §10. One of the TWO wire-triggered spawns outside the
+      // exec whitelist (agent/CLAUDE.md; the other is `token-sync`'s). `validateReq` has already refused a tag
       // that fails `isReleaseTag` and a kind outside `RequestKind`, so this body
       // never sees an unvalidated argument. `updateSpawnArgv` checks both AGAIN
       // and throws on a caller bug, so an edit that lets one through reaches
@@ -703,6 +721,36 @@ async function handleReq(ws: WebSocket, req: AgentReq, ctx: ConnCtx, verbCache:
       send(ws, ok(req.id, { accepted: true }));
       return;
     }
+    case 'token-sync': {
+      // Box-token lifecycle spec 4.4. The second wire-triggered spawn outside the exec whitelist (agent/CLAUDE.md).
+      // `validateReq` has already refused a code that fails `isClaimCode`; it is checked AGAIN here, and a caller bug
+      // that lets one through throws into the envelope's `.catch`, never into a spawn. The argv is one frozen
+      // template with no variable token: the code rides the child's stdin, never argv, and the port hands the child
+      // an explicit {HOME, PATH, LANG}. Nothing here consults the exec whitelist, and nothing may.
+      //
+      // No `await` before the busy decision: the gate is checked and taken in one synchronous stretch.
+      if (ctx.tokenSyncGate.spawning) {
+        send(ws, failTokenSync(req.id, 'busy', 'a token-sync op is already running on this agent'));
+        return;
+      }
+      if (!isClaimCode(req.code)) throw new RangeError('token-sync: the code is not a claim code — a caller bug; nothing was spawned');
+      const file = updateLauncherPath(ctx.cfg.home);
+      const argv = tokenSyncSpawnArgv();
+      ctx.tokenSyncGate.spawning = true;
+      let spawned: Awaited<ReturnType<TokenSyncSpawn>>;
+      try {
+        spawned = await ctx.spawnTokenSync(file, argv, req.code, TOKEN_SYNC_SPAWN_TIMEOUT_MS);
+      } finally {
+        ctx.tokenSyncGate.spawning = false;
+      }
+      // The ONE mapping (`tokenSyncAnswer`): exit code AND first stderr line, or the synced line; neither carries
+      // the code or a value. `transport` is always sent by this build; its one reader is `readTokenTransport`.
+      const answer = tokenSyncAnswer(spawned);
+      send(ws, answer.ok
+        ? ok(req.id, { synced: answer.synced, transport: answer.transport })
+        : failTokenSync(req.id, answer.err, answer.detail));
+      return;
+    }
     default: {
       // Exhaustive today (every `AgentReq` op above), but kept as a
       // defensive fallback rather than removed — a future protocol variant
@@ -733,7 +781,10 @@ function isStringArray(v: unknown): v is string[] {
  *  `failUpdate(id, refuse)` before any case body runs. It is not `null`,
  *  because the handler answers `null` with `bad-request`, which from the
  *  `update` op must mean exactly one thing: this agent predates it. */
-export interface ReqRefusal { refuse: Extract<UpdateOpError, 'bad-tag' | 'bad-kind'>; id: number }
+export interface ReqRefusal {
+  refuse: Extract<UpdateOpError, 'bad-tag' | 'bad-kind'> | Extract<TokenSyncOpError, 'bad-code'>;
+  id: number;
+}
 
 /**
  * Runtime shape/type validation for an already-JSON-parsed `req` frame.
@@ -815,6 +866,12 @@ function validateReq(msg: Record<string, unknown>): AgentReq | ReqRefusal | null
       if (!isRequestKind(kind)) return { refuse: 'bad-kind', id };
       return { t: 'req', id, op: 'update', tag: msg.tag, kind } satisfies UpdateReq;
     }
+    case 'token-sync': {
+      // The ONE code guard (`isClaimCode`, never a regex here). A missing, non-string or malformed code is a
+      // `ReqRefusal` carrying `bad-code`; `bad-request` from this op keeps meaning "this agent predates it".
+      if (!isClaimCode(msg.code)) return { refuse: 'bad-code', id };
+      return { t: 'req', id, op: 'token-sync', code: msg.code } satisfies TokenSyncReq;
+    }
     default:
       return null;
   }
@@ -1100,7 +1157,7 @@ async function refreshVerbs(cache: VerbCache, home: string): Promise<string[]> {
 
 function handleConnection(
   ws: WebSocket, opts: Required<Omit<AgentOpts, 'helloTimeoutMs'>>, helloTimeoutMs: number, verbCache: VerbCache,
-  updateGate: UpdateGate,
+  updateGate: UpdateGate, tokenSyncGate: TokenSyncGate,
 ): void {
   let authed = false;
   const ctx: ConnCtx = {
@@ -1112,6 +1169,8 @@ function handleConnection(
     spawnPty: opts.spawnPty,
     spawnUpdate: opts.spawnUpdate,
     updateGate,
+    spawnTokenSync: opts.spawnTokenSync,
+    tokenSyncGate,
   };
 
   const helloTimer = setTimeout(() => {
@@ -1153,10 +1212,11 @@ function handleConnection(
       // contract is unchanged — a key is written only when there is
       // something to write.
       // `ops` (design 2026-09-20 §10): the request ops this agent answers beyond
-      // the closed set every agent has always had, which is exactly one today.
-      // It is required in `ReadyFrame`, so it cannot be dropped silently.
+      // the closed set every agent has always had: `update`, and `token-sync`
+      // (box-token lifecycle spec 4.4). It is required in `ReadyFrame`, so it
+      // cannot be dropped silently.
       const frame: ReadyFrame = {
-        t: 'ready', v: 1, ccdVerbs: verbCache.verbs, observedEpoch: readObservedEpoch(opts.home), ops: [UPDATE_OP],
+        t: 'ready', v: 1, ccdVerbs: verbCache.verbs, observedEpoch: readObservedEpoch(opts.home), ops: [UPDATE_OP, TOKEN_SYNC_OP],
       };
       const rosterFp = readRosterFp(opts.home);
       if (rosterFp !== undefined) frame.rosterFp = rosterFp;
@@ -1184,7 +1244,7 @@ function handleConnection(
       }
       // A well-shaped op whose ARGUMENT failed its guard (design 2026-09-20
       // §10) is answered with the op's own word, never `bad-request`.
-      if ('refuse' in req) { send(ws, failUpdate(req.id, req.refuse)); return; }
+      if ('refuse' in req) { send(ws, fail(req.id, req.refuse)); return; }
       // Defense in depth: even a validated request could hit an unforeseen
       // rejection downstream — this `.catch` guarantees no rejection from
       // the fire-and-forget dispatch is ever left unhandled.
@@ -1241,6 +1301,9 @@ export async function startAgent(rawOpts: AgentOpts): Promise<RunningAgent> {
     projectsRoot: resolveProjectsRoot(rawOpts.projectsRoot),
     spawnPty: rawOpts.spawnPty ?? spawnFleetPty,
     spawnUpdate: rawOpts.spawnUpdate ?? realUpdateSpawn,
+    // The child's environment is built from the agent's CONFIGURED home, not `process.env.HOME`, so the verb's
+    // `~/.cc-secrets` and `~/.ccrc` are the ones the launcher path (`updateLauncherPath(home)`) belongs to.
+    spawnTokenSync: rawOpts.spawnTokenSync ?? makeTokenSyncSpawn(tokenSyncEnv(rawOpts.home ?? os.homedir())),
   };
   const helloTimeoutMs = rawOpts.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
   const verbCache: VerbCache = {
@@ -1258,7 +1321,9 @@ export async function startAgent(rawOpts: AgentOpts): Promise<RunningAgent> {
   const wss = new WebSocketServer({ server: httpServer });
   // ONE update gate per agent process, shared by every connection (D-3392).
   const updateGate: UpdateGate = { spawning: false };
-  wss.on('connection', (ws) => handleConnection(ws, opts, helloTimeoutMs, verbCache, updateGate));
+  // ONE token-sync gate per agent process, shared by every connection (spec 4.4).
+  const tokenSyncGate: TokenSyncGate = { spawning: false };
+  wss.on('connection', (ws) => handleConnection(ws, opts, helloTimeoutMs, verbCache, updateGate, tokenSyncGate));
 
   await new Promise<void>((resolve, reject) => {
     httpServer.once('error', reject);
```

- [ ] **Step 6: Run it to verify it passes**

```bash
mkdir -p .tmp-a2 && (cd agent && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/token-sync-op.test.ts)
```

Expected: `Tests  21 passed (21)` (the SIGTERM case takes about 2.3 s: a 300 ms bound plus the real 2 s grace).

- [ ] **Step 7: Move the ready-frame pins (red first, then the edit)**

```bash
mkdir -p .tmp-a2 && (cd agent && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/update-op.test.ts)
mkdir -p .tmp-a2 && (cd server && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/remote-connect.test.ts)
mkdir -p .tmp-a2 && (cd server && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/update-inventory.test.ts)
```

Expected red: `update-op.test.ts` `1 failed | 32 passed` ("the ready frame advertises exactly ['update']…", `expected [ 'update', 'token-sync' ] to deeply equal [ 'update' ]`); `remote-connect.test.ts` `1 failed | 64 passed` ("reaches connected:true with downSince:null after a good handshake"); `update-inventory.test.ts` `1 failed | 89 passed` ("a ready frame measures the fleet node inside the same second").

```diff
diff --git a/agent/test/update-op.test.ts b/agent/test/update-op.test.ts
--- a/agent/test/update-op.test.ts
+++ b/agent/test/update-op.test.ts
@@ -19,7 +19,8 @@
 //  - The answer is `accepted` only once the `--detach` parent exited 0.
 //    Anything else is `spawn-failed`, carrying the parent's first stderr line
 //    (D-3372); a parent killed at the bound is decided by re-measurement (D-3413).
-//  - The ready frame advertises exactly `['update']`.
+//  - The ready frame advertises exactly `['update', 'token-sync']` (the second word is box-token lifecycle wave 1's,
+//    pinned with its op in `token-sync-op.test.ts`).
 //  - The op reaches no exec path. This is a SOURCE scan, because no behavioural
 //    case can see an extra call whose answer comes out the same.
 import { describe, it, expect, afterEach, vi } from 'vitest';
@@ -394,12 +395,12 @@ describe('the update op', () => {
     });
   });
 
-  it("the ready frame advertises exactly ['update'] (§18 \"an agent without the op is never sent it\", the agent half)", async () => {
+  it("the ready frame advertises exactly ['update', 'token-sync'] (§18 \"an agent without the op is never sent it\", the agent half)", async () => {
     fixture = makeFixture();
     agent = await boot(fixture, { spawnUpdate: recorder().spawn });
     const c = new TestClient(agent.port);
     clients.push(c);
-    expect((await c.hello() as AgentReady).ops).toEqual(['update']);
+    expect((await c.hello() as AgentReady).ops).toEqual(['update', 'token-sync']);
   });
 
   describe('the op reaches no exec path (§18 "the op never execs") — read from the source', () => {
diff --git a/server/test/remote-connect.test.ts b/server/test/remote-connect.test.ts
--- a/server/test/remote-connect.test.ts
+++ b/server/test/remote-connect.test.ts
@@ -41,15 +41,16 @@ describe('connectFleet — connection lifecycle', () => {
     // `rosterFp`/`build`, a real agent NEVER omits this field — the fixture
     // home has no `~/.cc-sessions/pool-epoch`, so `readObservedEpoch` answers
     // "never synced" (`null`), sent on the wire explicitly, not "no evidence".
-    // `agentOps: ['update']`: the REAL agent advertises the one op it answers
-    // beyond the closed set (design 2026-09-20 §10, programme wave 5 Task 2),
-    // read through `readReadyOps`. This literal read `[]` while the agent sent
+    // `agentOps: ['update', 'token-sync']`: the REAL agent advertises the ops it
+    // answers beyond the closed set (design 2026-09-20 §10, programme wave 5
+    // Task 2; `token-sync` from box-token lifecycle wave 1, spec 4.4), read
+    // through `readReadyOps`. This literal read `[]` while the agent sent
     // no `ops`; a ready frame that stops sending the word reds HERE — §18 "an
     // agent without the op is never sent it", on the agent's side.
     await vi.waitFor(
       () => expect(fleet!.state).toEqual({
         connected: true, downSince: null, ccdVerbs: [], rosterFp: null, build: null, observedEpoch: null,
-        agentOps: ['update'],
+        agentOps: ['update', 'token-sync'],
       }),
       { timeout: 3000 });
   });
diff --git a/server/test/update-inventory.test.ts b/server/test/update-inventory.test.ts
--- a/server/test/update-inventory.test.ts
+++ b/server/test/update-inventory.test.ts
@@ -1289,9 +1289,10 @@ describe('the fleet node over a real agent (the exact-basename read set, and the
     expect(Date.now() - t0).toBeLessThan(1000);
     const row = coord.node(FLEET_LABEL)!;
     expect(buildInfoOfRow(row)).toEqual(parseBuildInfo(stampJson()));
-    // `agentOps: ['update']`: the real agent advertises the update op (programme wave 5 Task 2), and the
-    // inventory stores what the one reader, `readReadyOps`, read off its ready frame.
-    expect(row).toMatchObject({ role: 'fleet', caps: ['verify', 'node-id', 'floor'], os: 'linux', highestVersion: 'v0.0.12', agentOps: ['update'], reachable: true });
+    // `agentOps: ['update', 'token-sync']`: the real agent advertises the update op (programme wave 5 Task 2) and
+    // the token-sync op (box-token lifecycle wave 1), and the inventory stores what the one reader, `readReadyOps`,
+    // read off its ready frame.
+    expect(row).toMatchObject({ role: 'fleet', caps: ['verify', 'node-id', 'floor'], os: 'linux', highestVersion: 'v0.0.12', agentOps: ['update', 'token-sync'], reachable: true });
   });
 
   it('a build.json symlinked onto a secret file is unreadable across the wire, and nothing of the secret arrives', async () => {
```

Run the three again. Expected: `33 passed (33)`, `65 passed (65)`, `90 passed (90)`.

- [ ] **Step 8: The prose that this op makes false**

```diff
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -2973,8 +2973,9 @@ general remote-shell:
   and checks it's still under an allowed canonical prefix — closing the
   classic symlink-escape hole. Reads: `$HOME/.cc-sessions/`,
   `$HOME/.cc-limits/`, `$HOME/.cc-clips/`, `$HOME/.claude*/` (glob), the
-  fleet's projects root, and exactly the eight `$HOME/.ccrc` node files by
-  name (`NODE_FILES`, `shared/agent-protocol.ts`) — a live symlink inside
+  fleet's projects root, and exactly the nine `$HOME/.ccrc` node files by
+  name (`NODE_FILES`, `shared/agent-protocol.ts`; the ninth,
+  `box-token-generation`, holds a generation id, never a token) — a live symlink inside
   `$HOME/.ccrc` carrying one is refused, or admitted through another prefix's own arm with `lstat` reporting `symlink`, which the update inventory refuses to read as that file; never `$HOME/.ccrc` itself. Writes: `$HOME/.cc-clips/` only. **This
   list did not widen for the transcript resolver or the supervisor
   heartbeat**: the resolver's uuid search (rungs 5 and 6 of its ladder)
@@ -2986,6 +2987,11 @@ general remote-shell:
   `--to <tag> --detach --from pwa`, with the tag checked by the one release-tag guard
   first — never through the exec whitelist, never an arbitrary command. The agent
   names it in its ready frame, and the server sends it to no agent that does not.
+- **Token-sync op**: `token-sync` only ever spawns `~/.local/bin/ccrc token sync --from agent`,
+  with the one-time claim code (checked by the one code guard first) on the child's stdin, never
+  argv, and an environment of exactly `HOME`, `PATH` and `LANG`, so the agent's own bearer never
+  reaches the verb. The verb, not the agent, claims and writes the token; the agent reads and
+  writes no secret file. It is named in the ready frame beside `update`.
 
 ### Degraded mode
 
diff --git a/agent/CLAUDE.md b/agent/CLAUDE.md
--- a/agent/CLAUDE.md
+++ b/agent/CLAUDE.md
@@ -44,14 +44,16 @@ get wrong when editing `src/whitelist.ts`.
 - **Write whitelist:** the agent may write files only under `$HOME/.cc-clips/`. Every other fleet mutation crosses
   the WS as a whitelisted `ccd`/`tmux` verb, never a raw file write. Read whitelist is canonical-prefix,
   realpath-resolved (closes symlink escapes): `~/.cc-sessions/`, `~/.cc-limits/`, `~/.cc-clips/`, `~/.claude*`,
-  and the fleet projects root — plus ONE non-prefix grant: exactly the eight `~/.ccrc` node files
+  and the fleet projects root — plus ONE non-prefix grant: exactly the nine `~/.ccrc` node files
   (`NODE_FILES`, `shared/agent-protocol.ts`: `build.json`, `installed`, `ccrc-caps`, `floor`, `previous`,
-  `node-id`, `update.json`, `update-intent`), by canonical-path EQUALITY, a live symlink inside `~/.ccrc`
+  `node-id`, `update.json`, `update-intent`, `box-token-generation` — the last holds a generation id, never a token
+  value), by canonical-path EQUALITY, a live symlink inside `~/.ccrc`
   carrying one of those names is refused, or admitted through another prefix's own arm with `lstat` reporting `symlink`, which the server's update inventory refuses to read as that file (design 2026-09-20 §8). Never `isUnder(~/.ccrc)`: that directory holds `agent.env`,
   `auth.scrypt`, `coord.db` and `deploy.env`, and `test/whitelist.test.ts` reds the moment one becomes readable.
 - `ptyOpen` only ever spawns `tmux attach -t =cc-<sessionId>:` (exact — `tmuxTarget`, D-3525) with `sessionId` sanitized to `[A-Za-z0-9_-]+` —
   never an arbitrary command.
-- The **`update` op** (design 2026-09-20 §10) is the ONE wire-triggered spawn outside the exec whitelist. It spawns
+- The **`update` op** (design 2026-09-20 §10) is one of the TWO wire-triggered spawns outside the exec whitelist (the
+  other is `token-sync`, below). It spawns
   exactly one of two argv templates — `$HOME/.local/bin/ccrc update|rollback --to <tag> --detach --from pwa`, built by
   `updateLauncherPath` + `updateSpawnArgv` (`shared/agent-protocol.ts`), `tag` the only variable token — validated by
   `isReleaseTag` in `validateReq` BEFORE any case body runs (`bad-tag`/`bad-kind`, never `bad-request`, which from this
@@ -62,6 +64,14 @@ get wrong when editing `src/whitelist.ts`.
   member in `shared/agent-protocol.ts`; a `validateReq` case that type-checks every field (an argument failing its
   guard answers a `ReqRefusal` word, a shape failure `null`); a `handleReq` case; and, when the server must know this
   agent answers it, a word in the ready frame's `ops` (`readReadyOps`, `server/src/remote/client.ts`, is its reader).
+- The **`token-sync` op** (box-token lifecycle spec 2026-10-07 §4.4) is the other. It spawns exactly
+  `$HOME/.local/bin/ccrc token sync --from agent` (`updateLauncherPath` + `tokenSyncSpawnArgv`, no variable token) and
+  writes the one-time claim code to the child's STDIN, then EOF — never argv. `validateReq` refuses a code that fails
+  `isClaimCode` with `bad-code` before any case body. Its port (`src/tokensync.ts`) is its OWN bounded body, not a third
+  twin of the update spawn (D-4390): the child gets an explicit `{HOME, PATH, LANG}`, never `process.env` (which carries
+  `CCRC_AGENT_TOKEN`), and at 40 s its process group gets SIGTERM, then SIGKILL 2 s later. One gate per agent process
+  answers a second op `busy`. The agent still reads and writes no secret file: the verb, not the agent, claims and
+  writes the token. `test/token-sync-op.test.ts`'s source scan reds the day the op reaches an exec path.
 - The agent has **no HTTP routes** (its `createServer` carries only a WS upgrade), so the deploy's
   `verify-service.sh` (MainPID stability across a window > `RestartSec`) is its only post-restart check — it
   catches the `refuseToBoot` crash-loop that a `systemctl restart` exit-0 would otherwise hide.
```

```bash
mkdir -p .tmp-a2 && (cd server && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/box-token-census.test.ts)
mkdir -p .tmp-a2 && (cd server && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/topology-clean.test.ts)
mkdir -p .tmp-a2 && (cd server && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/docs-grammar.test.ts)
```

Expected, unchanged: `23 passed (23)`, `55 passed (55)`, `158 passed (158)`. (README line citations in the tree stop at 2250, above the insert.)

- [ ] **Step 8b: Layer 4's second wire-triggered spawn (`server/test/whitelist-subset.test.ts`; added at plan assembly, not prototyped)**

Reword the comment's second sentence at :612 in place (same line, so nothing below moves), old:

```ts
// Spec §10 and its §15 W4 row: "the whitelist pin tests gain a case that the `update` op reaches no exec path". The `update` op is the
// ONE wire-triggered spawn outside the exec whitelist, so its whole safety is that nothing else can reach its spawn port and that it
```

new:

```ts
// Spec §10 and its §15 W4 row: "the whitelist pin tests gain a case that the `update` op reaches no exec path". The `update` op is
// one of TWO wire-triggered spawns outside the exec whitelist (the box token's `token-sync` op is the other, layer 4b below), so the whole safety of each is that nothing else can reach its spawn port and that it
```

Append at the very end of the file (dynamic imports, as layer 4 does, so no line above moves):

```ts
// Layer 4b (box-token lifecycle, Task A2): the `token-sync` op is the SECOND wire-triggered spawn outside the exec
// whitelist. The same two properties as layer 4, for its own port: its case names no exec-surface symbol, and
// `spawnTokenSync(` has exactly one call site, inside `case 'token-sync'` of handleReq.
describe("layer 4b — the token-sync op is not an exec path, and its spawn port has one caller", () => {
  let readFileSync: typeof import('node:fs').readFileSync;
  let readdirSync: typeof import('node:fs').readdirSync;
  let path: typeof import('node:path');
  let SRC_DIR = '';
  let serverSrc = '';
  let handleReq = '';
  const EXEC_PATH = /\b(?:isExecAllowed|runExec|resolveSpawnCmd|checkPath)\s*\(|\bEXEC_WHITELIST\b/;
  const code = (src: string): string => src.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  const CASE_END = /\n    (?:case '|default:)/;
  function caseBody(src: string, word: string): string {
    const open = `case '${word}': {`;
    const at = src.indexOf(open);
    expect(at, `${open} not found`).toBeGreaterThanOrEqual(0);
    const rest = src.slice(at + open.length);
    const end = CASE_END.exec(rest);
    expect(end, `no end after ${open}`).not.toBeNull();
    return rest.slice(0, end!.index);
  }
  beforeAll(async () => {
    ({ readFileSync, readdirSync } = await import('node:fs'));
    path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'agent', 'src');
    serverSrc = readFileSync(path.join(SRC_DIR, 'server.ts'), 'utf8');
    const at = serverSrc.indexOf('async function handleReq(');
    expect(at, 'handleReq not found').toBeGreaterThanOrEqual(0);
    const rest = serverSrc.slice(at);
    const end = /\n\}\n/.exec(rest);
    expect(end, 'no end after handleReq').not.toBeNull();
    handleReq = rest.slice(0, end!.index);
  });

  it("(a) `case 'token-sync'` and agent/src/tokensync.ts name no exec-surface symbol", () => {
    const body = caseBody(handleReq, 'token-sync');
    expect(code(body)).not.toMatch(EXEC_PATH);
    expect(code(body), 'the cut is the token-sync op, not an empty slice').toMatch(/\bspawnTokenSync\s*\(/);
    expect(code(readFileSync(path.join(SRC_DIR, 'tokensync.ts'), 'utf8'))).not.toMatch(EXEC_PATH);
  });

  it("(b) `spawnTokenSync(` is called exactly once in agent/src, inside `case 'token-sync'`, and nowhere outside it", () => {
    const body = caseBody(handleReq, 'token-sync');
    const call = /\bspawnTokenSync\s*\(/g;
    expect(code(body).match(call)?.length ?? 0, "one call inside case 'token-sync'").toBe(1);
    const outside = serverSrc.replace(body, '');
    expect(outside.length, 'the case was cut out of the scan').toBeLessThan(serverSrc.length);
    expect(code(outside).match(call)?.length ?? 0, "call sites outside case 'token-sync' in server.ts").toBe(0);
    for (const f of readdirSync(SRC_DIR).filter((n) => n.endsWith('.ts') && n !== 'server.ts')) {
      expect(code(readFileSync(path.join(SRC_DIR, f), 'utf8')).match(call)?.length ?? 0, `${f} calls spawnTokenSync(`).toBe(0);
    }
  });
});
```

(`spawnTokenSync?:` in `AgentOpts` and `spawnTokenSync: rawOpts.spawnTokenSync ?? …` in `startAgent` are a type member and a property, not calls: neither matches `\bspawnTokenSync\s*\(`.) Run `mkdir -p .tmp-a2 && (cd server && TMPDIR="$PWD/../.tmp-a2" ./node_modules/.bin/vitest run test/whitelist-subset.test.ts)`. Expected: green, two cases more than the file had before (the worker records both counts). Mutation (row M9 below): add a second `await ctx.spawnTokenSync(file, argv, req.code, TOKEN_SYNC_SPAWN_TIMEOUT_MS);` inside `case 'update'` — (b) goes red.

- [ ] **Step 9: Mutation check (measure each red, restore, measure green)**

| # | One-line mutation | Named test that goes red (measured) |
|---|---|---|
| M1 | `agent/src/server.ts`: the `validateReq` case returns the request without `isClaimCode`, and the case body's re-check is deleted | "a malformed code is bad-code, never bad-request, and spawns nothing", "validateReq's token-sync case calls the one code guard…" (2 failed \| 19 passed) |
| M2 | `agent/src/tokensync.ts`: `env: childEnv` -> `env: process.env` | "the port names no exec path, pipes stdin, and hands the child only its explicit env", "is the agent's default: … an environment of exactly three names" (2 failed \| 19 passed) |
| M3 | `agent/src/tokensync.ts`: `spawn(file, [...args], {` -> `spawn(file, [...args, code], {` | the same two cases (2 failed \| 19 passed) |
| M4 | `agent/src/tokensync.ts`: the bound's `signalGroup('SIGTERM')` -> `signalGroup('SIGKILL')` | "at the bound the group gets SIGTERM first (the trap runs), then SIGKILL after the grace", "a child whose trap exits on SIGTERM answers at once…" (2 failed \| 19 passed) |
| M5 | `agent/src/server.ts`: `if (ctx.tokenSyncGate.spawning) {` -> `if (false && ctx.tokenSyncGate.spawning) {` | "a second op while one is spawning is busy, on the same connection and on another…" (1 failed \| 20 passed) |
| M6 | `agent/src/server.ts`: `ops: [UPDATE_OP, TOKEN_SYNC_OP]` -> `ops: [UPDATE_OP]` | "the ready frame advertises exactly ['update', 'token-sync']" (1 failed \| 20 passed) |
| M7 | `agent/src/tokensync.ts`: the word match drops `&& first.startsWith(…)` | "an exit code and a line that disagree, or a bare code, are spawn-failed carrying the line" (1 failed \| 20 passed) |
| M8 | `agent/src/tokensync.ts`: append a `// ── BEGIN bounded-spawn body` / `// ── END bounded-spawn body` pair | `update-spawn-twin-bodies.test.ts`: "agent/src/tokensync.ts carries no bounded-spawn sentinel…" (1 failed \| 3 passed) |
| M9 | `agent/src/server.ts`: a second `await ctx.spawnTokenSync(file, argv, req.code, TOKEN_SYNC_SPAWN_TIMEOUT_MS);` inside `case 'update'` | `whitelist-subset.test.ts`: "(b) `spawnTokenSync(` is called exactly once in agent/src…" (not prototyped: measure it) |

Restore each file, then re-run Steps 6 and 7 green.

- [ ] **Step 10: Typecheck**

```bash
(cd agent && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json)
(cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json)
```

Expected: no output.

- [ ] **Step 11: Commit** (in its own call, after a green foreground read of `token-sync-op`, `update-op`, `update-spawn-twin-bodies`, `whitelist-subset`, `remote-connect` and `update-inventory`; then `rm -rf .tmp-a2`)

```bash
git add agent/src/tokensync.ts agent/src/server.ts agent/CLAUDE.md README.md agent/test/token-sync-op.test.ts \
  agent/test/update-op.test.ts server/test/update-spawn-twin-bodies.test.ts server/test/whitelist-subset.test.ts \
  server/test/remote-connect.test.ts server/test/update-inventory.test.ts
git commit -m "feat(agent): the token-sync op — the code on stdin, an explicit env, SIGTERM then SIGKILL (D-4390)

validateReq refuses a code that fails isClaimCode with bad-code before any case body. The case
spawns ~/.local/bin/ccrc token sync --from agent through its own bounded port (agent/src/tokensync.ts,
not a third twin of the update spawn): the code goes to stdin then EOF, the child gets exactly
HOME, PATH and LANG, and at 40 s its group gets SIGTERM, then SIGKILL 2 s later. The child's exit
code and first stderr line together map to one closed word; success carries synced and transport.
One gate per agent process answers busy. ready.ops is ['update', 'token-sync']; the real-agent
pins move with it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A3: Accept-set check and BoxTokenHolder

(prototype) measured: server/test/coord-token.test.ts: red 13 failed (20 passed) -> green 33 passed, 2026-10-07 on main 282e79e44
(prototype) measured, unchanged neighbours: server/test/box-token-census.test.ts 23 passed; server/test/single-definition.test.ts 406 passed; `tsc --noEmit -p tsconfig.json` clean, 2026-10-07 on main 282e79e44

**Files:**
- Modify: `server/src/coord/token.ts` (imports :1-2; `extractToken` :28-32 gains `export`; insert the holder block after `readMailToken` ends at :157; `checkMailToken`'s last docstring paragraph :217-219 and its signature and body :220-228)
- Modify: `server/src/server.ts` (import :55; `Deps.mailToken` :302-307; the two call sites :1557 `POST /api/notify` and :2804 `GET /api/pools/epoch`)
- Modify: `server/src/coord/routes.ts` (eleven call sites: :553 `requireMailToken`'s own, :675, :997, :2611, :2647, :2696, :2753, :2814, :2889, :3239, :3778)
- Modify: `server/src/update/routes.ts` (one call site, :779)
- Test: `server/test/coord-token.test.ts` (imports :12-20; three new describes appended after :237)

**Interfaces:**
- Consumes: nothing new (`node:crypto`'s `createHash`, `randomBytes`, `timingSafeEqual`).
- Produces (all in `server/src/coord/token.ts`):

```ts
export type TokenSlot = 'current' | 'pending0' | 'pending1' | 'previous';
export const TOKEN_SLOTS: readonly TokenSlot[];
export interface HolderSlots {
  current: string | null;
  pending: readonly { id: string; value: string }[];   // at most 2; a third throws RangeError
  previous: { value: string; until: number } | null;    // until = the hard bound
}
export function matchDigestSlots(presented: Buffer, slots: readonly Buffer[],
  compare?: (a: Buffer, b: Buffer) => boolean): number;  // first matching index or -1
export class BoxTokenHolder {
  constructor(opts?: { now?: () => number; compare?: (a: Buffer, b: Buffer) => boolean });
  setSlots(s: HolderSlots): void;
  setRetired(digestsHex: readonly string[]): void;      // RangeError on anything but lowercase sha256 hex
  hasCurrent(): boolean;
  pendingValue(id: string): string | null;
  currentValue(): string | null;
  match(presented: string): TokenSlot | null;
  isRetired(presented: string): boolean;
  noteRetiredPresented(lane: string): void;
  counters(): { matched: Record<TokenSlot, number>; retired: number; retiredByLane: Readonly<Record<string, number>> };
}
export function extractToken(raw: string): string | null;
export function checkMailToken(expected: string | BoxTokenHolder | null, presented: unknown,
  lane?: string): 'ok' | 'legacy' | 'bad' | 'unconfigured';
```
- `server/src/server.ts`: `Deps.mailToken?: string | BoxTokenHolder | null`.

- [ ] **Step 1: Write the failing test**

In `server/test/coord-token.test.ts`, replace the import block (:12-20 at 282e79e44):

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkMailToken, MailTokenFileUnusable, MailTokenPlaceholderUnedited, PLACEHOLDER_TOKEN, readMailToken,
} from '../src/coord/token.js';
import { mkTmp } from './tmpHelpers.js';
```

with:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BoxTokenHolder, TOKEN_SLOTS, checkMailToken, extractToken, matchDigestSlots,
  MailTokenFileUnusable, MailTokenPlaceholderUnedited, PLACEHOLDER_TOKEN, readMailToken,
} from '../src/coord/token.js';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
```

Then append to the end of the file (after its last line, :237 at 282e79e44):

```ts
// ── the accept-set (box-token lifecycle, spec 4.3) ───────────────────────────
//
// checkMailToken keeps its four words and its literal-string arm; a
// BoxTokenHolder widens what `ok` means to a small FIXED set of slots, every one
// compared on every call. The values below are fixture strings, not tokens.
const sha = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();
const CUR = 'a'.repeat(64);
const P0 = 'b'.repeat(64);
const P1 = 'c'.repeat(64);
const PREV = 'd'.repeat(64);
const RETIRED = 'e'.repeat(64);
const G0 = '0'.repeat(16);
const G1 = '1'.repeat(16);

const fullHolder = (now: () => number = () => 1_000,
  compare?: (a: Buffer, b: Buffer) => boolean): BoxTokenHolder => {
  const h = new BoxTokenHolder({ now, ...(compare ? { compare } : {}) });
  h.setSlots({ current: CUR, pending: [{ id: G0, value: P0 }, { id: G1, value: P1 }],
    previous: { value: PREV, until: 2_000 } });
  return h;
};

describe('BoxTokenHolder: current, two pending and previous, one check', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('accepts every filled slot and names which one matched', () => {
    const h = fullHolder();
    expect(h.match(CUR)).toBe('current');
    expect(h.match(P0)).toBe('pending0');
    expect(h.match(P1)).toBe('pending1');
    expect(h.match(PREV)).toBe('previous');
    expect(h.match('f'.repeat(64))).toBeNull();
    for (const v of [CUR, P0, P1, PREV]) expect(checkMailToken(h, v)).toBe('ok');
    expect(h.counters().matched).toEqual({ current: 2, pending0: 2, pending1: 2, previous: 2 });
  });

  it('refuses the previous value at and after its hard deadline', () => {
    let t = 1_999;
    const h = fullHolder(() => t);
    expect(h.match(PREV)).toBe('previous');
    t = 2_000;
    expect(h.match(PREV)).toBeNull();
    expect(checkMailToken(h, PREV)).toBe('bad');
    expect(h.match(CUR)).toBe('current');
  });

  it('an empty slot holds a random dummy, never the digest of an empty or absent value', () => {
    const h = new BoxTokenHolder();
    h.setSlots({ current: CUR, pending: [], previous: null });
    expect(h.match('')).toBeNull();
    expect(h.match(P0)).toBeNull();
    expect(h.match(CUR)).toBe('current');
  });

  it('keeps the four words: no current is unconfigured, absent is legacy, wrong or non-string is bad', () => {
    const empty = new BoxTokenHolder();
    expect(empty.hasCurrent()).toBe(false);
    expect(checkMailToken(empty, CUR)).toBe('unconfigured');
    expect(checkMailToken(empty, undefined)).toBe('unconfigured');
    const h = fullHolder();
    expect(h.hasCurrent()).toBe(true);
    expect(checkMailToken(h, undefined)).toBe('legacy');
    expect(checkMailToken(h, '')).toBe('legacy');
    expect(checkMailToken(h, null)).toBe('legacy');
    expect(checkMailToken(h, 'wrong')).toBe('bad');
    expect(checkMailToken(h, 123)).toBe('bad');
    expect(checkMailToken(h, [CUR, CUR])).toBe('bad');     // a repeated header arrives as an array
  });

  it('serves the pending and current values from memory, and refuses a third pending generation', () => {
    const h = fullHolder();
    expect(h.pendingValue(G0)).toBe(P0);
    expect(h.pendingValue(G1)).toBe(P1);
    expect(h.pendingValue('2'.repeat(16))).toBeNull();
    expect(h.currentValue()).toBe(CUR);
    expect(() => h.setSlots({ current: CUR, previous: null, pending: [
      { id: G0, value: P0 }, { id: G1, value: P1 }, { id: '2'.repeat(16), value: RETIRED }] }))
      .toThrow(RangeError);
  });

  it('a retired value is bad, counted per lane, and warned at most once a minute without the value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let t = 10_000;
    const h = fullHolder(() => t);
    expect(() => h.setRetired(['ab'])).toThrow(RangeError);
    expect(() => h.setRetired([sha(RETIRED).toString('hex').toUpperCase()])).toThrow(RangeError);
    h.setRetired([sha(RETIRED).toString('hex')]);
    expect(h.isRetired(RETIRED)).toBe(true);
    expect(h.isRetired(CUR)).toBe(false);
    expect(checkMailToken(h, RETIRED, 'GET /api/ledger')).toBe('bad');
    expect(checkMailToken(h, RETIRED, 'GET /api/ledger')).toBe('bad');
    expect(checkMailToken(h, RETIRED, 'POST /api/mail')).toBe('bad');
    expect(checkMailToken(h, RETIRED)).toBe('bad');
    // A wrong value that was never issued is bad too, and counts nothing.
    expect(checkMailToken(h, 'f'.repeat(64), 'GET /api/ledger')).toBe('bad');
    expect(h.counters().retired).toBe(4);
    expect(h.counters().retiredByLane).toEqual({ 'GET /api/ledger': 2, 'POST /api/mail': 1, unnamed: 1 });
    // One warning inside the minute, naming the lane; a second once the minute has passed.
    expect(warn).toHaveBeenCalledTimes(1);
    const first = String(warn.mock.calls[0]![0]);
    expect(first).toMatch(/^ccrc-server: box token: a retired value was presented/);
    expect(first).toContain('GET /api/ledger');
    t += 60_000;
    checkMailToken(h, RETIRED, 'POST /api/mail');
    expect(warn).toHaveBeenCalledTimes(2);
    const all = warn.mock.calls.flat().join('\n');
    expect(all).not.toContain(RETIRED);
    expect(all).not.toContain(sha(RETIRED).toString('hex'));
  });

  it('a literal string still works exactly as before, and ignores the lane', () => {
    expect(checkMailToken(CUR, CUR, 'POST /api/mail')).toBe('ok');
    expect(checkMailToken(CUR, 'wrong', 'POST /api/mail')).toBe('bad');
    expect(checkMailToken(CUR, undefined, 'POST /api/mail')).toBe('legacy');
    expect(checkMailToken(null, CUR, 'POST /api/mail')).toBe('unconfigured');
  });

  it('extractToken is exported with its rule unchanged', () => {
    expect(extractToken('# c\n\n  ab cd \nnext\n')).toBe('abcd');
    expect(extractToken('# only\n')).toBeNull();
  });
});

describe('matchDigestSlots: every slot compared, every time', () => {
  const counting = (): { calls: () => number; compare: (a: Buffer, b: Buffer) => boolean } => {
    let n = 0;
    return { calls: () => n, compare: (a, b) => { n++; return timingSafeEqual(a, b); } };
  };

  it('calls the comparator once per slot whether the first, the last or no slot matches', () => {
    const slots = [sha('x'), sha('y'), sha('z')];
    for (const [presented, want] of [[sha('x'), 0], [sha('z'), 2], [sha('w'), -1]] as const) {
      const c = counting();
      expect(matchDigestSlots(presented, slots, c.compare)).toBe(want);
      expect(c.calls()).toBe(slots.length);
    }
  });

  it('answers the FIRST matching index when two slots hold the same digest', () => {
    expect(matchDigestSlots(sha('x'), [sha('y'), sha('x'), sha('x')])).toBe(1);
    expect(matchDigestSlots(sha('x'), [])).toBe(-1);
  });

  it('the holder compares all four slots on every match, however many are filled', () => {
    for (const fill of ['all', 'current-only'] as const) {
      const c = counting();
      const h = new BoxTokenHolder({ compare: c.compare });
      h.setSlots(fill === 'all'
        ? { current: CUR, pending: [{ id: G0, value: P0 }, { id: G1, value: P1 }], previous: { value: PREV, until: Infinity } }
        : { current: CUR, pending: [], previous: null });
      for (const v of [CUR, PREV, 'f'.repeat(64)]) {
        const before = c.calls();
        h.match(v);
        expect(c.calls() - before, `${fill}: ${v.slice(0, 1)}`).toBe(TOKEN_SLOTS.length);
      }
    }
  });

  it('the combine carries no short-circuit, ternary, early exit, some or find (source scan)', () => {
    const src = readFileSync(path.join(repoRoot, 'server', 'src', 'coord', 'token.ts'), 'utf8');
    const begin = src.split('// combine:' + 'begin').length - 1;
    const end = src.split('// combine:' + 'end').length - 1;
    expect([begin, end], 'exactly one combine region').toEqual([1, 1]);
    const body = src.slice(src.indexOf('// combine:' + 'begin'), src.indexOf('// combine:' + 'end'));
    expect(body).toContain('|=');
    for (const banned of [/\|\|/, /&&/, /\?/, /\breturn\b/, /\bbreak\b/, /\bcontinue\b/, /\.some\(/, /\.find\(/]) {
      expect(body, `the combine carries ${banned}`).not.toMatch(banned);
    }
  });
});

describe('every box-token lane names itself to the check', () => {
  // The 14 call sites (server.ts 2, coord/routes.ts 11, update/routes.ts 1) each
  // pass their route key, so a retired presentation is counted per lane. The
  // one call before the first registration is requireMailToken's own, which
  // passes the `route` its 13 callers name.
  const CALL = /checkMailToken\(deps\.mailToken \?\? null, req\.headers\[MAIL_TOKEN_HEADER\](?:, ([^)]+))?\)/g;
  const sites = (rel: string): { lane: string | null; route: string | null }[] => {
    const src = readFileSync(path.join(repoRoot, 'server', 'src', rel), 'utf8');
    const regs = [...src.matchAll(/app\.(get|post)\('([^']+)'/g)]
      .map((m) => ({ key: `${m[1]!.toUpperCase()} ${m[2]!}`, at: m.index! }));
    return [...src.matchAll(CALL)].map((m) => {
      const owner = regs.filter((r) => r.at < m.index!).pop();
      return { lane: m[1] ?? null, route: owner?.key ?? null };
    });
  };

  it('all fourteen pass a lane, and a literal lane is its own route key', () => {
    const all = ['server.ts', 'coord/routes.ts', 'update/routes.ts'].flatMap(sites);
    expect(all).toHaveLength(14);
    for (const s of all) {
      expect(s.lane, `a call inside ${s.route ?? 'the helper'} names no lane`).not.toBeNull();
      if (s.route === null) expect(s.lane).toBe('route');
      else expect(s.lane).toBe(`'${s.route}'`);
    }
  });

  it('a route counts a retired value against its own lane', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = new BoxTokenHolder();
    h.setSlots({ current: CUR, pending: [], previous: null });
    h.setRetired([sha(RETIRED).toString('hex')]);
    const home = mkTmp('ccrc-token-lane-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const app = await buildServer({ ...testDeps(home), mailToken: h, coord });
    try {
      const ledger = (tok: string) => app.inject({ method: 'GET', url: '/api/ledger', headers: { 'x-ccrc-mail-token': tok } });
      expect((await ledger(RETIRED)).statusCode).toBe(401);
      expect((await ledger(CUR)).statusCode).not.toBe(401);
      const notify = await app.inject({ method: 'POST', url: '/api/notify',
        headers: { 'x-ccrc-mail-token': RETIRED }, payload: { message: 'x' } });
      expect(notify.statusCode).toBe(401);
      expect(h.counters().retiredByLane).toEqual({ 'GET /api/ledger': 1, 'POST /api/notify': 1 });
    } finally { await app.close(); vi.restoreAllMocks(); }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from the repo root): `mkdir -p .tmp-a3 && (cd server && TMPDIR="$PWD/../.tmp-a3" ./node_modules/.bin/vitest run test/coord-token.test.ts)`
Expected: `Tests  13 failed | 20 passed (33)`, the holder cases failing with `TypeError: BoxTokenHolder is not a constructor` and the lane scan with `a call inside POST /api/notify names no lane`. The one new case that passes is "a literal string still works exactly as before, and ignores the lane": today's two-argument function ignores a third argument.

- [ ] **Step 3: Write the minimal implementation**

`server/src/coord/token.ts`, line 2:

```ts
import { timingSafeEqual } from 'node:crypto';
```
becomes
```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
```

`extractToken` (:28-32): append to its docstring, before ` */`,
```ts
 *
 * Exported since the box-token lifecycle (Task A3): `token/files.ts`'s measured
 * read extracts with this same rule rather than spelling it a second time.
```
and change `function extractToken(raw: string): string | null {` to `export function extractToken(raw: string): string | null {`.

Insert after `readMailToken`'s closing `}` (:157), before the `/**` that opens `checkMailToken`'s docstring:

```ts
/** The accept-set's four slots, in the fixed order every match compares them
 *  (box-token lifecycle spec 4.3). */
export type TokenSlot = 'current' | 'pending0' | 'pending1' | 'previous';
export const TOKEN_SLOTS: readonly TokenSlot[] = ['current', 'pending0', 'pending1', 'previous'];

/** What the driver and the boot hand the holder: the values themselves, never
 *  their digests (those are the holder's own, in memory only). */
export interface HolderSlots {
  current: string | null;
  /** At most two (`MAX_PENDING`); a third is a programming error and throws. */
  pending: readonly { id: string; value: string }[];
  /** `until` is the hard bound (ms since the epoch); at and after it the slot
   *  compares a dummy. The driver removes the slot at retirement. */
  previous: { value: string; until: number } | null;
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** One random 32-byte dummy per slot, per process. An empty slot compares one of
 *  these, so an empty slot costs the same compare as a filled one and matches
 *  nothing: never the digest of '' or of any value a caller can send. Never
 *  persisted, never printed. */
const SLOT_DUMMIES: readonly Buffer[] = TOKEN_SLOTS.map(() => randomBytes(32));

/** The retired-presentation warning's cap: at most one line a minute. */
const RETIRED_WARN_EVERY_MS = 60_000;

/**
 * The index of the first slot equal to `presented`, or -1. CONSTANT TIME over
 * the slots: every slot is compared on every call, and each result is folded
 * into numbers with `|=`, so neither which slot matched nor whether any did
 * changes how many compares run. The combine below carries no `||`, `&&`,
 * `||=`, `&&=`, ternary, `return`, `break`, `some` or `find`;
 * `coord-token.test.ts` scans the region between its two markers for each.
 * Every slot and `presented` must be the same length (sha256 digests, 32
 * bytes), which `timingSafeEqual` requires. `compare` is injected by tests to
 * count calls.
 */
export function matchDigestSlots(presented: Buffer, slots: readonly Buffer[],
  compare: (a: Buffer, b: Buffer) => boolean = timingSafeEqual): number {
  let index = 0;
  let found = 0;
  // combine:begin
  for (let i = 0; i < slots.length; i++) {
    const hit = Number(compare(presented, slots[i]!));
    index |= (i + 1) * (hit & (found ^ 1));
    found |= hit;
  }
  // combine:end
  return index - 1;
}

/**
 * The box token's accept-set, held in memory and mutated in place by the boot
 * and the driver, so every lane that reads `deps.mailToken ?? null` at request
 * time sees a rotation with no restart (spec 4.2). It holds the four values and
 * their sha256 digests; the digests are recomputed by {@link setSlots} and never
 * written anywhere. It records which slot matched (for the console's "previous
 * still presented" count and the grace rule); that record never promotes
 * anything. It also holds the retired digests (`box-token-retired.json`), so a
 * value the accept-set refuses can be recognised as retired and counted per lane.
 */
export class BoxTokenHolder {
  private readonly now: () => number;
  private readonly compare: (a: Buffer, b: Buffer) => boolean;
  private slots: HolderSlots = { current: null, pending: [], previous: null };
  private digests: Buffer[] = [...SLOT_DUMMIES];
  private retired: Buffer[] = [];
  private readonly matched: Record<TokenSlot, number> = { current: 0, pending0: 0, pending1: 0, previous: 0 };
  private retiredTotal = 0;
  private readonly retiredLanes: Record<string, number> = {};
  private lastRetiredWarnAt: number | null = null;

  constructor(opts: { now?: () => number; compare?: (a: Buffer, b: Buffer) => boolean } = {}) {
    this.now = opts.now ?? Date.now;
    this.compare = opts.compare ?? timingSafeEqual;
  }

  setSlots(s: HolderSlots): void {
    if (s.pending.length > 2) throw new RangeError('BoxTokenHolder: at most two pending generations');
    this.slots = { current: s.current, pending: [...s.pending], previous: s.previous };
    const p0 = s.pending[0];
    const p1 = s.pending[1];
    this.digests = [
      s.current === null ? SLOT_DUMMIES[0]! : sha256(s.current),
      p0 === undefined ? SLOT_DUMMIES[1]! : sha256(p0.value),
      p1 === undefined ? SLOT_DUMMIES[2]! : sha256(p1.value),
      s.previous === null ? SLOT_DUMMIES[3]! : sha256(s.previous.value),
    ];
  }

  setRetired(digestsHex: readonly string[]): void {
    const bufs = digestsHex.map((d) => Buffer.from(d, 'hex'));
    // A round trip, not a regex: a sha256 digest is 32 bytes whose lowercase hex
    // is exactly the string given (a malformed entry decodes short or differently).
    bufs.forEach((b, i) => {
      if (b.length !== 32 || b.toString('hex') !== digestsHex[i]) {
        throw new RangeError('BoxTokenHolder: a retired digest is not a lowercase sha256 hex digest');
      }
    });
    this.retired = bufs;
  }

  hasCurrent(): boolean { return this.slots.current !== null; }

  /** The claim door's value source: memory, never the pending file. */
  pendingValue(id: string): string | null {
    return this.slots.pending.find((p) => p.id === id)?.value ?? null;
  }

  /** For the both-role writer and the retirement self-check only. */
  currentValue(): string | null { return this.slots.current; }

  /** The slot `presented` matches, or null. All four slots are compared every
   *  time; the previous slot compares its dummy at and after its hard bound. */
  match(presented: string): TokenSlot | null {
    const prev = this.slots.previous;
    const live = prev !== null && this.now() < prev.until
      ? this.digests
      : [this.digests[0]!, this.digests[1]!, this.digests[2]!, SLOT_DUMMIES[3]!];
    const i = matchDigestSlots(sha256(presented), live, this.compare);
    if (i < 0) return null;
    const slot = TOKEN_SLOTS[i]!;
    this.matched[slot]++;
    return slot;
  }

  isRetired(presented: string): boolean {
    return matchDigestSlots(sha256(presented), this.retired, this.compare) >= 0;
  }

  /** Counts one retired presentation against `lane` and warns at most once a
   *  minute, naming the lane and the counts. The value, its digest and the
   *  caller are never printed (proxy trust is none, so every caller has the
   *  proxy's address). */
  noteRetiredPresented(lane: string): void {
    this.retiredTotal++;
    this.retiredLanes[lane] = (this.retiredLanes[lane] ?? 0) + 1;
    const now = this.now();
    if (this.lastRetiredWarnAt !== null && now - this.lastRetiredWarnAt < RETIRED_WARN_EVERY_MS) return;
    this.lastRetiredWarnAt = now;
    console.warn(`ccrc-server: box token: a retired value was presented on ${lane} ` +
      `(${this.retiredLanes[lane]} on this lane, ${this.retiredTotal} in all since boot); it was refused`);
  }

  counters(): { matched: Record<TokenSlot, number>; retired: number; retiredByLane: Readonly<Record<string, number>> } {
    return { matched: { ...this.matched }, retired: this.retiredTotal, retiredByLane: { ...this.retiredLanes } };
  }
}
```

Replace the tail of `checkMailToken`'s docstring and the function (:217-228 at 282e79e44):

```ts
 * `timingSafeEqual` needs equal lengths, so the length check comes first and
 * leaks only the length — which a caller can measure anyway by sending one.
 */
export function checkMailToken(expected: string | null, presented: unknown): 'ok' | 'legacy' | 'bad' | 'unconfigured' {
  if (expected === null) return 'unconfigured';        // the server was never given a token
  if (presented === undefined || presented === null || presented === '') return 'legacy';
  if (typeof presented !== 'string') return 'bad';
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return 'bad';
  return timingSafeEqual(a, b) ? 'ok' : 'bad';
}
```

with:

```ts
 * `timingSafeEqual` needs equal lengths, so the length check comes first and
 * leaks only the length — which a caller can measure anyway by sending one.
 * That is the LITERAL-STRING arm, kept exactly as it was so the many tests that
 * inject a string keep their meaning.
 *
 * A {@link BoxTokenHolder} (box-token lifecycle, spec 4.3) answers the same four
 * words: no current value is `'unconfigured'`; an absent value is `'legacy'`; a
 * value in the accept-set (current, either pending, previous before its hard
 * bound) is `'ok'`, compared over sha256 digests so no length leaks either; any
 * other value is `'bad'`, and one whose digest is retired is also counted
 * against `lane` (the caller's route key, `'unnamed'` when absent), the only
 * signal of an outside holder.
 */
export function checkMailToken(expected: string | BoxTokenHolder | null, presented: unknown,
  lane?: string): 'ok' | 'legacy' | 'bad' | 'unconfigured' {
  if (expected === null) return 'unconfigured';        // the server was never given a token
  if (expected instanceof BoxTokenHolder) {
    if (!expected.hasCurrent()) return 'unconfigured';
    if (presented === undefined || presented === null || presented === '') return 'legacy';
    if (typeof presented !== 'string') return 'bad';
    if (expected.match(presented) !== null) return 'ok';
    if (expected.isRetired(presented)) expected.noteRetiredPresented(lane ?? 'unnamed');
    return 'bad';
  }
  if (presented === undefined || presented === null || presented === '') return 'legacy';
  if (typeof presented !== 'string') return 'bad';
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return 'bad';
  return timingSafeEqual(a, b) ? 'ok' : 'bad';
}
```

`server/src/server.ts`: line 55 `import { MAIL_TOKEN_HEADER, checkMailToken } from './coord/token.js';` becomes `import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from './coord/token.js';`. The `Deps.mailToken` docstring and field (:302-307) end:

```ts
   *  construct a second, different token. A `BoxTokenHolder` since the box-token
   *  lifecycle (spec 4.2): the process's one accept-set, mutated in place by the
   *  driver, so every lane reads it here at request time and a rotation needs no
   *  restart. A literal string is what tests inject, with today's meaning. */
  mailToken?: string | BoxTokenHolder | null;
```

The fourteen call sites each keep `checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]` and gain their lane as a third argument (one `sed -i -e "<line>s/req.headers\[MAIL_TOKEN_HEADER\])/req.headers[MAIL_TOKEN_HEADER], <lane>)/"` per line, or by hand):

| File:line at 282e79e44 | Third argument |
|---|---|
| `server/src/server.ts:1557` | `'POST /api/notify'` |
| `server/src/server.ts:2804` | `'GET /api/pools/epoch'` |
| `server/src/coord/routes.ts:553` (inside `requireMailToken`) | `route` |
| `server/src/coord/routes.ts:675` | `'POST /api/mail'` |
| `server/src/coord/routes.ts:997` | `'POST /api/mail/:id/ack'` |
| `server/src/coord/routes.ts:2611` | `'GET /api/runs'` |
| `server/src/coord/routes.ts:2647` | `'GET /api/runs/:id/signals'` |
| `server/src/coord/routes.ts:2696` | `'GET /api/runs/:id/items'` |
| `server/src/coord/routes.ts:2753` | `'GET /api/feed'` |
| `server/src/coord/routes.ts:2814` | `'GET /api/lifecycle'` |
| `server/src/coord/routes.ts:2889` | `'GET /api/peers'` |
| `server/src/coord/routes.ts:3239` | `'GET /api/claims'` |
| `server/src/coord/routes.ts:3778` | `'GET /api/asks'` |
| `server/src/update/routes.ts:779` | `'GET /api/updates/intent/:nodeId'` |

`requireMailToken`'s thirteen callers already pass their own `'VERB /path'` as `route`, so every lane is named. Measure: `grep -c "checkMailToken(deps.mailToken ?? null, req.headers\[MAIL_TOKEN_HEADER\], " server/src/server.ts server/src/coord/routes.ts server/src/update/routes.ts` answers 2, 11, 1.

- [ ] **Step 4: Run it to verify it passes**

Run (from the repo root): `mkdir -p .tmp-a3 && (cd server && TMPDIR="$PWD/../.tmp-a3" ./node_modules/.bin/vitest run test/coord-token.test.ts)`
Expected: `Tests  33 passed (33)`.

- [ ] **Step 5: Mutation checks (each measured red, then restored)**

| Mutation (one line) | Test that goes red (measured) |
|---|---|
| In `matchDigestSlots`, add `if (hit === 1) return i;` after `const hit = …` | "calls the comparator once per slot…", "the holder compares all four slots…", "the combine carries no short-circuit…" (3 failed) |
| Drop the lane at `coord/routes.ts:2647` | "all fourteen pass a lane, and a literal lane is its own route key" (1 failed) |
| `const live = prev !== null && this.now() < prev.until` loses `&& this.now() < prev.until` | "refuses the previous value at and after its hard deadline" (1 failed) |
| Delete `if (expected.isRetired(presented)) expected.noteRetiredPresented(lane ?? 'unnamed');` | "a retired value is bad, counted per lane…" and "a route counts a retired value against its own lane" (2 failed) |

Restore each and re-run: `Tests  33 passed (33)`.

- [ ] **Step 6: Run the neighbours that read these call sites, unchanged**

From the repo root, one file per call: `mkdir -p .tmp-a3 && (cd server && TMPDIR="$PWD/../.tmp-a3" ./node_modules/.bin/vitest run test/box-token-census.test.ts)` (expected `23 passed`; its `GATE_PATTERNS` `/checkMailToken\(/` still matches a three-argument call, so the 27 lanes stay 27), `mkdir -p .tmp-a3 && (cd server && TMPDIR="$PWD/../.tmp-a3" ./node_modules/.bin/vitest run test/single-definition.test.ts)` (expected `406 passed`), and `./node_modules/.bin/tsc --noEmit -p tsconfig.json` (expected: no output). The setRetired check is a hex round trip rather than a second `/^[0-9a-f]{64}$/`, so it does not re-spell `TOKEN_VALUE_RE`.

- [ ] **Step 7: Commit** (afterwards, from the repo root: `rm -rf .tmp-a3`)

```bash
git add server/src/coord/token.ts server/src/server.ts server/src/coord/routes.ts server/src/update/routes.ts server/test/coord-token.test.ts
git commit -m "feat(token): BoxTokenHolder accept-set and per-lane retired counts in checkMailToken (A3)

checkMailToken keeps its four words and its literal-string arm; a holder
compares current, two pending and previous (to its hard bound) over sha256
digests in one fixed-slot, |=-folded combine, and counts a retired value per
lane. All fourteen call sites name their route key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Pinned tests moved by this task: none. The census (`box-token-census.test.ts`) and `auth-gate.test.ts` read `checkMailToken(` and `checkMailToken(deps.mailToken`; both spellings survive the third argument.

### Task A4: /api/notify fails shut

(prototype) measured: server/test/notify-token.test.ts: red 3 failed (4 passed) -> green 7 passed, 2026-10-07 on main 282e79e44 (after A3)
(prototype) measured: server/test/routes.test.ts (a pin this task moves, not in the contract's file list): red 2 failed (78 passed) -> green 80 passed, 2026-10-07 on main 282e79e44
(prototype) measured, run unchanged: server/test/box-token-census.test.ts 23 passed; server/test/auth-gate.test.ts 158 passed; server/test/mail-routes.test.ts 59 passed; server/test/coord-token.test.ts 33 passed, 2026-10-07 on main 282e79e44

**Files:**
- Modify: `server/src/server.ts` (the notify comment and handler, :1552-1575)
- Modify: `server/src/auth/gate.ts` (reason 2's notify sentences :93-104; the `POST /api/notify` EXEMPT reason :203-205)
- Modify: `server/src/coord/routes.ts` (the legacy detail "(that is /api/notify only)" at :556, :678 and :1000; one history line after the `POST /api/mail` gate comment, :672-673)
- Modify: `server/src/coord/token.ts` (docstrings only: `MailTokenFileUnusable` :47-50; `checkMailToken`'s `'legacy'` paragraph :164-168, `'unconfigured'` paragraph :180-186, and the removal paragraph :207-215)
- Modify: `README.md` (D-4396: the auth paragraph :1186 and the coordination paragraph's tolerance sentences :3962-3970)
- Test: `server/test/notify-token.test.ts` (header :1-6; the absent-token case :61-66 and the no-token-configured case :77-82 flip to 401; one holder case added)
- Test: `server/test/routes.test.ts` (pin moved: `makeApp` :39-41 and :71, and the two notify-ingestion cases :835-865 present a token)

**Interfaces:**
- Consumes: A3's `checkMailToken(expected, presented, lane)` and `BoxTokenHolder`.
- Produces: `POST /api/notify` answering `401 {ok:false,error:'unauthenticated'}` on `legacy`, `unconfigured` and `bad`, each with one `console.warn('ccrc-server: /api/notify refused …')`; `200` only on `ok`.

- [ ] **Step 1: Write the failing test**

`server/test/notify-token.test.ts`, replace the header and imports (:1-6):

```ts
// Three states, and the middle one is the whole operator ruling: a fleet host
// still running yesterday's notify.sh must not go dark the moment the server
// deploys. Absent is ACCEPTED and LOGGED; wrong is 401; right is 200.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
```
with
```ts
// Right is 200; wrong, absent and unconfigured are 401. Absent used to be
// ACCEPTED and LOGGED for a one-deploy-generation rollout window (a fleet host
// still running yesterday's notify.sh); the box-token lifecycle removed that
// tolerance and the unconfigured pass-through with it (spec 4.3), so this
// route fails shut like every other box-token lane.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { BoxTokenHolder } from '../src/coord/token.js';
```

Replace the absent-token case (:61-66):

```ts
  it('accepts an ABSENT token for one deploy generation, and says so in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: TOKEN });
    expect((await post(app)).statusCode).toBe(200);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/legacy/);
  });
```
with
```ts
  it('refuses an ABSENT token — the rollout tolerance is gone (box-token lifecycle, spec 4.3)', async () => {
    // It used to be accepted and logged as `legacy`. The server now mints its own
    // token at boot and the fleet file is written for it, so the state the
    // tolerance bridged no longer exists, and a tokenless notify is a caller
    // with no credential at all.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bus = new Bus();
    const noticed: string[] = [];
    bus.on('notice', (n) => noticed.push(n.message));
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: TOKEN }, bus);
    const res = await post(app);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, error: 'unauthenticated' });
    expect(noticed).toEqual([]);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/NO box token \(401\)/);
  });
```

Replace the no-token-configured case and the closing of the describe (:77-82):

```ts
  it('accepts everything, unauthenticated, when no token is configured', async () => {
    // A box that has never been given a token must not lose its swap notices.
    app = await buildServer(testDeps(mkTmp('ccrc-')));
    expect((await post(app)).statusCode).toBe(200);
  });
});
```
with
```ts

  it('refuses every caller when no token is configured — unconfigured fails shut like every lane', async () => {
    // It used to accept everything here. A server with no current value is now
    // one whose boot mint failed, and every box-token lane answers 401 there.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await buildServer(testDeps(mkTmp('ccrc-')));
    expect((await post(app)).statusCode).toBe(401);
    expect((await post(app, { 'x-ccrc-mail-token': TOKEN })).statusCode).toBe(401);
  });

  it('a holder with no current value refuses the same way as no token', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    app = await buildServer({ ...testDeps(mkTmp('ccrc-')), mailToken: new BoxTokenHolder() });
    expect((await post(app, { 'x-ccrc-mail-token': TOKEN })).statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from the repo root): `mkdir -p .tmp-a4 && (cd server && TMPDIR="$PWD/../.tmp-a4" ./node_modules/.bin/vitest run test/notify-token.test.ts)`
Expected: `Tests  3 failed | 4 passed (7)` — "refuses an ABSENT token…" (`expected 200 to be 401`), "refuses every caller when no token is configured…" and "a holder with no current value refuses…".

- [ ] **Step 3: Write the minimal implementation**

`server/src/server.ts`, the comment above the route and the handler head (:1552-1575 at 282e79e44, shown here as A3 left it):

```ts
  // AUTHENTICATED SINCE BUILD 7 (operator ruling, spec:150-155). This was the
  // one box->server ingress carrying zero identity while the server
  // regex-routed its body INTO a session's chat stream — see `checkMailToken`
  // for the one-deploy-generation tolerance and for when it comes out.
  app.post('/api/notify', async (req, reply) => {
    const verdict = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER], 'POST /api/notify');
    if (verdict === 'bad') {
```
becomes
```ts
  // AUTHENTICATED SINCE BUILD 7 (operator ruling, spec:150-155). This was the
  // one box->server ingress carrying zero identity while the server
  // regex-routed its body INTO a session's chat stream. FAIL-SHUT since the
  // box-token lifecycle (spec 4.3): the one-deploy-generation `legacy`
  // tolerance and the `unconfigured` pass-through are both gone, so every
  // verdict but `'ok'` is a 401 here exactly as on every other box-token lane.
  app.post('/api/notify', async (req, reply) => {
    const verdict = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER], 'POST /api/notify');
    if (verdict === 'legacy' || verdict === 'unconfigured') {
      // Logged for the same reason the wrong-token arm below is: three silent
      // layers (notify.sh's `|| true`, ccd's `/dev/null`, `logger: false`) sit
      // between this refusal and any operator.
      console.warn(verdict === 'legacy'
        ? 'ccrc-server: /api/notify refused a request with NO box token (401) — the fleet box\'s ' +
          'notify.sh has no token file to read'
        : 'ccrc-server: /api/notify refused a request: this server holds no box token (401)');
      return reply.code(401).send({ ok: false, error: 'unauthenticated' });
    }
    if (verdict === 'bad') {
```
and the legacy arm after the `bad` arm's `return` is deleted:
```ts
    if (verdict === 'legacy') {
      console.warn('ccrc-server: /api/notify accepted a request with NO box token (legacy ' +
        'tolerance, one deploy generation) — deploy the agent to ship the new notify.sh');
    }
```
The `bad` arm (its warning text names `deploy/ccrc-mail.token`, which PR B's README work owns) is unchanged.

- [ ] **Step 4: Run it to verify it passes**

Run: `mkdir -p .tmp-a4 && (cd server && TMPDIR="$PWD/../.tmp-a4" ./node_modules/.bin/vitest run test/notify-token.test.ts)`
Expected: `Tests  7 passed (7)`.

- [ ] **Step 5: Move the pin this change reddens in `routes.test.ts`**

Run: `mkdir -p .tmp-a4 && (cd server && TMPDIR="$PWD/../.tmp-a4" ./node_modules/.bin/vitest run test/routes.test.ts)` — expected now: `Tests  2 failed | 78 passed (80)`, the two "notify ingestion" cases (`expected 401 to be 200`): they post with no token to a server with none. Edit:

`makeApp`'s options (:41) `opts: { status?: 'busy' | 'idle'; io?: FleetIO } = {},` becomes `opts: { status?: 'busy' | 'idle'; io?: FleetIO; mailToken?: string } = {},`; its `buildServer` deps line (:71)
```ts
    { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: opts.io ?? localIO, queue: new KeyedQueue() },
```
becomes
```ts
    { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: opts.io ?? localIO, queue: new KeyedQueue(),
      ...(opts.mailToken !== undefined ? { mailToken: opts.mailToken } : {}) },
```
Before `describe('notify ingestion', () => {` (:835) insert:
```ts
// `/api/notify` fails shut since the box-token lifecycle (spec 4.3), so ingestion is
// exercised with the token a fleet box's notify.sh presents.
const NOTIFY_TOKEN = 'f'.repeat(64);

```
and in both of its cases `await makeApp(['❯ \n'])` becomes `await makeApp(['❯ \n'], { mailToken: NOTIFY_TOKEN })` and
```ts
    const res = await app.inject({ method: 'POST', url: '/api/notify', payload: { message } });
```
becomes
```ts
    const res = await app.inject({ method: 'POST', url: '/api/notify', payload: { message },
      headers: { 'x-ccrc-mail-token': NOTIFY_TOKEN } });
```
Re-run: `Tests  80 passed (80)`.

- [ ] **Step 6: Rewrite the prose the removal falsifies**

`server/src/auth/gate.ts`, reason 2 (:93-104). ORDER-PINNED: `box-token-census.test.ts` reads this passage's number words in sequence (`twenty-four`, `twenty-seven`); the new text adds no number word from `two` up. Replace

```ts
 *     And `/api/notify` still passes `'legacy'` (no token
 *     presented) and `'unconfigured'` (this box was never given one) THROUGH, by
 *     the operator's one-deploy-generation rollout ruling — `/api/pools/epoch` and
 *     `/api/updates/intent/:nodeId` do NOT carry this tolerance; each 401s on neither
 *     credential. So `/api/notify`
 *     stays the one exempt route that a caller with no credential at all can still
 *     reach on a box mid-rollout. That tolerance has a scheduled removal —
 *     `coord/token.ts:207`, "REMOVE `/api/notify`'S `'legacy'` TOLERANCE ONE
 *     DEPLOY AFTER THIS SHIPS" — and this exemption inherits its lifetime: the
 *     day the tolerance goes, this entry is a plain box-token lane like the
 *     rest. Session-gating it instead is not the fix, because the caller
 *     genuinely has no cookie; the fix is the removal already scheduled.
```
with
```ts
 *     `/api/notify` is now a plain box-token lane like the rest. It used to pass
 *     `'legacy'` (no token presented) and `'unconfigured'` (this box was never
 *     given one) THROUGH, by the operator's rollout ruling, and this exemption
 *     was said to inherit that tolerance's lifetime. The box-token lifecycle
 *     removed both arms (spec 4.3): the server mints its own token at boot, so
 *     "never given one" is no longer a state a box is left in, and the route
 *     refuses every verdict but `'ok'`. No exempt route in this reason can be
 *     reached by a caller with no credential at all. The entry stays because
 *     its caller still has no cookie; session-gating it was never the fix.
```

The notify EXEMPT reason (:203-205):
```ts
  ['POST /api/notify',
    'ccd notify.sh on the fleet host — checks the box token but still tolerates `legacy`/`unconfigured` ' +
    'for one deploy generation (coord/token.ts:207 schedules the removal); it has no cookie jar either way'],
```
becomes
```ts
  ['POST /api/notify',
    'ccd notify.sh on the fleet host — box-token gated like the mail ingress, every verdict but `ok` ' +
    'refused (the rollout tolerance for an absent or unconfigured token is gone); it has no cookie jar'],
```

`server/src/coord/routes.ts`: the three legacy details lose their parenthetical (the contract names :556 only; :678 and :1000 carry the same false clause):
- :556 `` ? `no box token presented — ${route} grants no legacy tolerance (that is /api/notify only)` `` -> `` ? `no box token presented — ${route} grants no legacy tolerance` ``
- :678 `'no box token presented — /api/mail grants no legacy tolerance (that is /api/notify only)'` -> `'no box token presented — /api/mail grants no legacy tolerance'`
- :1000 `'no box token presented — /api/mail/:id/ack grants no legacy tolerance (that is /api/notify only)'` -> `'no box token presented — /api/mail/:id/ack grants no legacy tolerance'`

(`sed -i 's| grants no legacy tolerance (that is /api/notify only)| grants no legacy tolerance|' server/src/coord/routes.ts`; then `grep -c "that is /api/notify only" server/src/coord/routes.ts` answers 0.) After the `POST /api/mail` gate comment's last line (:673, `// that already ruled out a \`'legacy'\` tolerance here.`) add:
```ts
    //
    // HISTORY since the box-token lifecycle (spec 4.3): `/api/notify` lost both
    // tolerances too and now refuses the same three verdicts; the contrast above
    // records why this route never had either.
```

`server/src/coord/token.ts`, docstrings only. `MailTokenFileUnusable` (:47-50):
```ts
 *  the identical reason — `checkMailToken(null, …)` answers `'unconfigured'`,
 *  which `/api/notify` still treats as a pass-through, so answering `null`
 *  here would disarm THAT gate too on a truncated `openssl rand -hex 32 > …`
 *  redirect, with nothing red anywhere. Deliberately NOT caught anywhere:
```
becomes
```ts
 *  the identical reason — `checkMailToken(null, …)` answers `'unconfigured'`,
 *  which `/api/notify` treated as a pass-through until the box-token lifecycle
 *  removed it, so answering `null` here would have disarmed THAT gate too on a
 *  truncated `openssl rand -hex 32 > …` redirect, with nothing red anywhere.
 *  Deliberately NOT caught anywhere:
```
`checkMailToken`'s `'legacy'` paragraph (:164-168):
```ts
 * NOT, by itself, a license to proceed. It is a state precisely because
 * exactly ONE caller, `/api/notify`, is granted a tolerance for it: the
 * operator ruling's one-deploy-generation window (spec:150-155), because a
 * fleet host still running yesterday's `notify.sh` presents NO token and the
 * hook must not go dark between the server deploy and the agent deploy.
```
becomes
```ts
 * NOT a license to proceed for ANY caller. It became a state because exactly
 * ONE caller, `/api/notify`, was once granted a tolerance for it: the
 * operator ruling's one-deploy-generation window (spec:150-155), because a
 * fleet host still running yesterday's `notify.sh` presented NO token. That
 * tolerance is removed (see REMOVED below); every caller now refuses it.
```
the end of its `'unconfigured'` paragraph (:180-186):
```ts
 * rather than a rollout window. `/api/notify` DOES still treat
 * `'unconfigured'` as pass-through — it has a pre-existing deployed caller
 * (`notify.sh`) that must not go dark before a token is ever minted, the
 * same reason it gets `'legacy'` — so `server.ts`'s `/api/notify` handler is
 * UNCHANGED by this split: neither of its `if (verdict === 'bad' | ===
 * 'legacy')` arms matches `'unconfigured'`, so it falls through to the same
 * silent accept `'ok'` used to give it.
```
becomes
```ts
 * rather than a rollout window. `/api/notify` went on treating
 * `'unconfigured'` as pass-through after this split, for its pre-existing
 * deployed caller (`notify.sh`), until the box-token lifecycle removed that
 * arm too (REMOVED, below).
```
and the removal paragraph (:207-215):
```ts
 * REMOVE `/api/notify`'S `'legacy'` TOLERANCE ONE DEPLOY AFTER THIS SHIPS. It
 * is not a permanent accommodation: while it stands, that one ingress is
 * still open to anything on the tailnet presenting no token, which is the
 * hole this whole task exists to close. The README's coordination section
 * names the deploy that removes it. `/api/notify`'s `'unconfigured'`
 * pass-through has no such removal date — it is the honest "this box has
 * never been told a secret" state, not a rollout artefact — and
 * `/api/mail`/`/api/mail/:id/ack` never had either hole open, so they have
 * nothing to remove.
```
becomes
```ts
 * REMOVED: `/api/notify`'s `'legacy'` tolerance AND its `'unconfigured'`
 * pass-through (box-token lifecycle, spec 4.3 and the decision row "/api/notify
 * tolerance: remove both arms"). This paragraph used to schedule the removal of
 * `'legacy'` one deploy after it shipped, and to say `'unconfigured'` had no
 * removal date because it was the honest "this box has never been told a
 * secret" state. That reason is gone: the server mints its own token at boot,
 * so a server with no current value is one whose mint FAILED, and every lane,
 * `/api/notify` included, answers 401 there until a mint succeeds. No caller
 * of this function grants either tolerance any more; the two words stay
 * distinct so a refusal can say which condition it met.
```

`README.md` (D-4396). The auth paragraph is ORDER-PINNED (`twenty-seven` then `twenty-four`, read from `What is gated, and what is not:` to `Enrolling a passkey`); :1186
```
`/api/notify`, which still tolerates an absent token for one deploy generation,
```
becomes
```
`/api/notify`, which refuses an absent token like every lane,
```
The coordination paragraph (scanned from `` `/api/mail` (and its ack route) `` to `Minting the token file matters`, which must carry NO number word from `two` up), :3962-3970:
```
the party holding the box token.) `/api/notify` alone still accepts a request
with **no** token header, logged as `legacy`
(`ccrc-server: /api/notify accepted a request with NO box token …`) so a
fleet host whose `notify.sh` predates its token read cannot go dark; it was
meant as a one-deploy rollout bridge and has not been removed yet. A request
carrying the WRONG token is refused `401` and logged as such. And on a server
with no token file at all, every token-gated lane above refuses every caller
while `/api/notify` passes everything — the boot line
`ccrc-server: no box token at …` says so.
```
becomes
```
the party holding the box token.) `/api/notify` is no exception any more: it
once accepted a request with **no** token header (logged as `legacy`) and passed
everything on a server with no token, as a rollout bridge for a fleet host whose
`notify.sh` predated its token read, and the box-token lifecycle removed both. A
request with no token, or with the WRONG token, is refused `401` and logged as
such (`ccrc-server: /api/notify refused …`). And on a server that holds no token
value, every token-gated lane above, `/api/notify` included, refuses every
caller, and the server says so at boot.
```
The deploy.sh shipping and hand-mint sentences beside it (:3943-3949) stay for PR B (B7).

- [ ] **Step 7: Mutation check**

Change `if (verdict === 'legacy' || verdict === 'unconfigured') {` to `if (verdict === 'legacy' && Math.random() > 2) {` (the arm deleted in effect). Run `mkdir -p .tmp-a4 && (cd server && TMPDIR="$PWD/../.tmp-a4" ./node_modules/.bin/vitest run test/notify-token.test.ts)`: measured `3 failed | 4 passed (7)`. Restore; `7 passed (7)`.

- [ ] **Step 8: Run the order-pinned and neighbouring files unchanged**

From the repo root, one per call: `mkdir -p .tmp-a4 && (cd server && TMPDIR="$PWD/../.tmp-a4" ./node_modules/.bin/vitest run test/box-token-census.test.ts)` (expected `23 passed`: reason 2's and README's number sequences did not move, and the mail-bus paragraph still states no count), `mkdir -p .tmp-a4 && (cd server && TMPDIR="$PWD/../.tmp-a4" ./node_modules/.bin/vitest run test/auth-gate.test.ts)` (expected `158 passed`: notify answers 401 dark and armed-anonymous alike, so the EXEMPT branch of the property sweep holds), `mkdir -p .tmp-a4 && (cd server && TMPDIR="$PWD/../.tmp-a4" ./node_modules/.bin/vitest run test/mail-routes.test.ts)` (expected `59 passed`), `mkdir -p .tmp-a4 && (cd server && TMPDIR="$PWD/../.tmp-a4" ./node_modules/.bin/vitest run test/coord-token.test.ts)` (expected `33 passed`), `mkdir -p .tmp-a4 && (cd server && TMPDIR="$PWD/../.tmp-a4" ./node_modules/.bin/vitest run test/routes.test.ts)` (expected `80 passed`).

- [ ] **Step 9: Commit** (afterwards, from the repo root: `rm -rf .tmp-a4`)

```bash
git add server/src/server.ts server/src/auth/gate.ts server/src/coord/routes.ts server/src/coord/token.ts README.md server/test/notify-token.test.ts server/test/routes.test.ts
git commit -m "feat(token): /api/notify fails shut on legacy and unconfigured (A4, D-4396)

The rollout tolerance and the unconfigured pass-through are removed, so
notify refuses every verdict but ok like every box-token lane. gate.ts
reason 2 and the notify EXEMPT reason, token.ts's docstrings, the three
'(that is /api/notify only)' details and the README sentences the removal
falsifies are rewritten; the order-pinned numbers are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Pinned tests moved by this task: `server/test/notify-token.test.ts` (absent token 200 -> 401 with a `NO box token (401)` warning; no token configured 200 -> 401; a holder with no current value -> 401) and `server/test/routes.test.ts`'s notify-ingestion pair (now presents `NOTIFY_TOKEN`). `box-token-census.test.ts` and `auth-gate.test.ts` are run unchanged and stay green.

### Task A5: Token file adapter and ports

(prototype) measured: server/test/token-files.test.ts: red 1 failed suite (module missing, no tests) -> green 23 passed, 2026-10-07 on main 282e79e44 (with A1/A3 scaffolds and A6 in place)
(not prototyped, added at plan assembly from review findings: the generation path built from `CCRC_DIR_NAME` and `NODE_FILES.tokenGeneration` under the home; `readAgentEnvMarksFleet` and its case; `isBoxTokenState`'s optional `fileProblem`. The file then has 26 cases; the worker records the measured red and green.)

**Files:**
- Create: `server/src/token/ports.ts` (L2), `server/src/token/files.ts` (L3)
- Test: `server/test/token-files.test.ts` (new)
- Depends on: A6 (types and `mintedState`), A1 (`FLEET_TOKEN_FILE_COMMENT`, `GENERATION_ID_RE`, `TOKEN_VALUE_RE`, `TOKEN_ORIGINS`, `OWED_REASONS`, `TOKEN_HOLDS`, `TOKEN_FILE_PROBLEMS`, `isClaimCode`, `CCRC_DIR_NAME`, `NODE_FILES`), A3 (`extractToken` exported, `PLACEHOLDER_TOKEN`)

**Interfaces:**
- Consumes: `extractToken(raw: string): string | null` and `PLACEHOLDER_TOKEN` (`server/src/coord/token.ts`, A3); `FLEET_TOKEN_FILE_COMMENT`, `GENERATION_ID_RE`, `TOKEN_ORIGINS`, `OWED_REASONS`, `TOKEN_HOLDS` (`shared/box-token.ts`, A1); `BoxTokenState`, `WriteRecord`, `GateNode`, `SyncResult`, `GenerationObservation` (`server/src/token/policy.ts`, A6).
- Produces (`server/src/token/ports.ts`): `TokenPaths`, `FileMeta`, `ValueRead`, `StateRead`, `RetiredRead`, `TokenStore`, `TokenSyncLink`, `GenerationReader`, `GateRowsSource`, `BothRoleWriter`.
- Produces (`server/src/token/files.ts`): `tokenPaths(mailTokenPath: string, home: string): TokenPaths`; `readValueFile(p: string): Promise<ValueRead>`; `writeValueFileAtomic(p: string, text: string): Promise<WriteRecord>`; `renameOverAtomic(from: string, to: string): Promise<void>`; `readState(p): Promise<StateRead>`; `writeState(p, s: BoxTokenState): Promise<void>`; `readRetired(p): Promise<RetiredRead>`; `appendRetired(p, valueDigest: string, at: number): Promise<void>`; `valueDigestHex(value: string): string`; `mintValue(): string`; `mintGenerationId(): string`; `mintClaimCode(): string`; `fleetFileText(existing: string | null, value: string): string`; `writeFleetTokenFile(p, value): Promise<void>`; `writeGenerationFile(p, id): Promise<void>`; `fileExists(p): Promise<boolean>`; `readAgentEnvMarksFleet(p): Promise<boolean>` (D-4399); `fileTokenStore(paths: TokenPaths): TokenStore`; `fileBothRoleWriter(paths: TokenPaths): BothRoleWriter`; and `export type { FileMeta, RetiredRead, StateRead, TokenPaths, ValueRead } from './ports.js'`.
- Contract adjustments (names unchanged): the read vocabularies `ValueRead`/`StateRead`/`RetiredRead`/`FileMeta`/`TokenPaths` are DECLARED in `ports.ts` and re-exported by `files.ts`, so L2 imports no L3 and every name the contract gives still imports from `files.ts`. `TokenStore` gains `renameOver(from, to)` (promotion step (c) is a rename, which the contract's port could not express). `files.ts` adds `renameOverAtomic`, `fileTokenStore` and `fileBothRoleWriter` (the ports' one adapter each). `TokenStore.writeValue(p, value)` writes the one bare value line (`value + "\n"`).
- Judgement recorded in `readValueFile`: an ENOENT from the READ after a successful lstat (a dangling symlink at the path) is `unreadable` with code `ENOENT`, never `absent`: `absent` means a proven ENOENT of the path itself. `readMailToken` used to fold this into `null`; boot now refuses on it as on any read error.

- [ ] **Step 1: Write the failing test**

Create `server/test/token-files.test.ts`:

```ts
// The box-token file adapter (server/src/token/files.ts, spec 4.2): measured
// reads that keep absent, unusable, placeholder and unreadable apart; the one
// atomic, fsynced, 0600-from-birth write; the fleet file's preamble rule; and
// the five readers of a fleet token file agreeing on what the writer wrote.
// Fixture homes only (mkTmp); no secret file outside them is ever read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs, {
  chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendRetired, fileExists, fleetFileText, mintClaimCode, mintGenerationId, mintValue, readAgentEnvMarksFleet, readRetired,
  readState, readValueFile, tokenPaths, valueDigestHex, writeFleetTokenFile, writeGenerationFile, writeState,
  writeValueFileAtomic,
} from '../src/token/files.js';
import { mintedState } from '../src/token/policy.js';
import { extractToken, PLACEHOLDER_TOKEN } from '../src/coord/token.js';
import { FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, TOKEN_VALUE_RE } from '../../shared/box-token.js';
import { isClaimCode } from '../../shared/agent-protocol.js';
import { mkTmp } from './tmpHelpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const V = 'a'.repeat(64);
const W = 'b'.repeat(64);

afterEach(() => { vi.restoreAllMocks(); });

const fixture = (): { home: string; dir: string } => {
  const home = mkTmp('ccrc-token-files-');
  const dir = path.join(home, '.ccrc');
  mkdirSync(dir, { recursive: true });
  return { home, dir };
};
const temps = (dir: string): string[] => readdirSync(dir).filter((n) => n.includes('.tmp-'));

describe('tokenPaths', () => {
  it('derives every server path from dirname(mailTokenPath), and the node and fleet paths from the home', () => {
    // The generation file is a NODE file: the verb, doctor and uninstall name $HOME/.ccrc/box-token-generation, so a
    // moved mail.token (CCRC_MAIL_TOKEN_PATH) never moves it.
    const p = tokenPaths('/x/elsewhere/mail.token', '/h');
    expect(p).toMatchObject({
      dir: '/x/elsewhere', current: '/x/elsewhere/mail.token', previous: '/x/elsewhere/mail-previous.token',
      state: '/x/elsewhere/box-token.json', retired: '/x/elsewhere/box-token-retired.json',
      generation: '/h/.ccrc/box-token-generation', fleetFile: '/h/.cc-secrets/ccrc-mail.token',
      agentEnv: '/h/.ccrc/agent.env',
    });
    expect(p.pending('0123456789abcdef')).toBe('/x/elsewhere/mail-pending-0123456789abcdef.token');
    expect(() => p.pending('../x')).toThrow(RangeError);
  });
});

describe('readValueFile keeps four outcomes apart', () => {
  it('absent only on a proven ENOENT', async () => {
    const { dir } = fixture();
    expect(await readValueFile(path.join(dir, 'mail.token'))).toEqual({ kind: 'absent' });
  });

  it.each([
    ['0 bytes', ''], ['whitespace only', ' \n\t\n'], ['comments only', '# a\n# b\n'],
  ])('unusable, with its lstat meta: %s', async (_n, content) => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    writeFileSync(p, content, { mode: 0o600 });
    const r = await readValueFile(p);
    expect(r.kind).toBe('unusable');
    if (r.kind !== 'unusable') return;
    const st = lstatSync(p);
    expect(r.meta).toEqual({ dev: st.dev, ino: st.ino, mtimeMs: st.mtimeMs, mode: 0o600, kind: 'regular' });
  });

  it('placeholder for the shipped example value', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    writeFileSync(p, `# copied\n${PLACEHOLDER_TOKEN}\n`);
    expect(await readValueFile(p)).toEqual({ kind: 'placeholder' });
  });

  it('a value by extractToken\'s rule, preamble skipped', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    writeFileSync(p, `# preamble\n\n ${V} \n`);
    const r = await readValueFile(p);
    expect(r.kind === 'value' && r.value).toBe(V);
  });

  it('unreadable with the errno word: a directory, a dangling link, and EACCES', async () => {
    const { dir } = fixture();
    mkdirSync(path.join(dir, 'isdir'));
    expect(await readValueFile(path.join(dir, 'isdir'))).toEqual({ kind: 'unreadable', code: 'EISDIR' });
    symlinkSync(path.join(dir, 'gone'), path.join(dir, 'dangling'));
    expect(await readValueFile(path.join(dir, 'dangling'))).toEqual({ kind: 'unreadable', code: 'ENOENT' });
    if (!isRoot) {
      const p = path.join(dir, 'locked');
      writeFileSync(p, `${V}\n`);
      chmodSync(p, 0o000);
      expect(await readValueFile(p)).toEqual({ kind: 'unreadable', code: 'EACCES' });
    }
  });

  it('a symlink reads through and is reported as a symlink', async () => {
    const { dir } = fixture();
    writeFileSync(path.join(dir, 'real'), `${V}\n`);
    symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
    const r = await readValueFile(path.join(dir, 'link'));
    expect(r.kind === 'value' && r.meta.kind).toBe('symlink');
  });
});

describe('writeValueFileAtomic', () => {
  it('opens its temp O_EXCL at 0600 and the file is 0600 even under umask 0', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    const open = vi.spyOn(fs.promises, 'open');
    const old = process.umask(0);
    try { await writeValueFileAtomic(p, `${V}\n`); } finally { process.umask(old); }
    const call = open.mock.calls[0];
    expect(path.basename(String(call[0]))).toMatch(/^\.mail\.token\.tmp-[0-9a-f]{16}$/);
    expect(Number(call[1]) & fs.constants.O_EXCL).toBe(fs.constants.O_EXCL);
    expect(Number(call[1]) & fs.constants.O_CREAT).toBe(fs.constants.O_CREAT);
    expect(call[2]).toBe(0o600);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readFileSync(p, 'utf8')).toBe(`${V}\n`);
    expect(temps(dir)).toEqual([]);
  });

  it('returns the write record of the renamed file: its (dev, ino), and a time no earlier than its mtime', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    const rec = await writeValueFileAtomic(p, `${V}\n`);
    const st = lstatSync(p);
    expect([rec.dev, rec.ino]).toEqual([st.dev, st.ino]);
    expect(st.mtimeMs).toBeLessThanOrEqual(rec.writtenAtMs);
    // A second write is a new inode (the 4.2.1 proof tells a replaced file by exactly this).
    const rec2 = await writeValueFileAtomic(p, `${W}\n`);
    expect(rec2.ino).not.toBe(rec.ino);
  });

  it.each([
    ['the rename', 'rename'], ['the open', 'open'],
  ] as const)('a failure injected at %s leaves the old file byte-equal and no temp behind', async (_n, step) => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    writeFileSync(p, `# keep me\n${V}\n`, { mode: 0o600 });
    const before = readFileSync(p);
    const ino = lstatSync(p).ino;
    vi.spyOn(fs.promises, step).mockRejectedValueOnce(Object.assign(new Error('injected'), { code: 'ENOSPC' }));
    await expect(writeValueFileAtomic(p, `${W}\n`)).rejects.toThrow('injected');
    expect(readFileSync(p).equals(before)).toBe(true);
    expect(lstatSync(p).ino).toBe(ino);
    expect(temps(dir)).toEqual([]);
  });
});

describe('box-token.json and box-token-retired.json', () => {
  it('state round-trips; garbage and a wrong shape read unusable; a missing file reads absent', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token.json');
    expect(await readState(p)).toEqual({ kind: 'absent' });
    const s = mintedState(1000, { dev: 1, ino: 2, writtenAtMs: 1000 }, null, null, '0123456789abcdef');
    await writeState(p, s);
    expect(await readState(p)).toEqual({ kind: 'state', state: s });
    expect(statSync(p).mode & 0o777).toBe(0o600);
    writeFileSync(p, '{not json');
    expect(await readState(p)).toEqual({ kind: 'unusable' });
    writeFileSync(p, JSON.stringify({ ...s, origin: 'stolen' }));
    expect(await readState(p)).toEqual({ kind: 'unusable' });
  });

  it('fileProblem is optional: absent, null or a known finding reads; an unknown word is unusable (plan assembly)', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token.json');
    const s = mintedState(1000, { dev: 1, ino: 2, writtenAtMs: 1000 }, null, null, '0123456789abcdef');
    const withProblem = { ...s, fileProblem: { at: 2000, file: 'current' as const, word: 'changed' as const } };
    await writeState(p, withProblem);
    expect(await readState(p)).toEqual({ kind: 'state', state: withProblem });
    await writeState(p, { ...s, fileProblem: null });
    expect((await readState(p)).kind).toBe('state');
    writeFileSync(p, JSON.stringify({ ...s, fileProblem: { at: 2000, file: 'current', word: 'stolen' } }));
    expect(await readState(p)).toEqual({ kind: 'unusable' });
  });

  it('retired digests append once each, and an unusable file is never rewritten', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token-retired.json');
    expect(await readRetired(p)).toEqual({ kind: 'absent' });
    await appendRetired(p, valueDigestHex(V), 1);
    await appendRetired(p, valueDigestHex(V), 2);
    await appendRetired(p, valueDigestHex(W), 3);
    expect(await readRetired(p)).toEqual({ kind: 'retired', digests: [valueDigestHex(V), valueDigestHex(W)] });
    expect(JSON.parse(readFileSync(p, 'utf8')).retired[0]).toEqual({ len: 64, sha256: valueDigestHex(V), at: 1 });
    writeFileSync(p, '{"v":1,"retired":"no"}');
    const before = readFileSync(p);
    await expect(appendRetired(p, valueDigestHex(V), 4)).rejects.toThrow(/unusable/);
    expect(readFileSync(p).equals(before)).toBe(true);
  });
});

describe('mints', () => {
  it('64 lowercase hex values, 16 hex generation ids and 43-character codes, never repeated', () => {
    const vs = new Set([mintValue(), mintValue()]);
    for (const v of vs) expect(v).toMatch(TOKEN_VALUE_RE);
    expect(vs.size).toBe(2);
    expect(mintGenerationId()).toMatch(GENERATION_ID_RE);
    const c = mintClaimCode();
    expect(c).toHaveLength(43);
    expect(isClaimCode(c)).toBe(true);
  });
});

describe('the fleet token file', () => {
  it('fleetFileText: no file gets the fixed comment line; an existing preamble is kept verbatim and in order', () => {
    expect(fleetFileText(null, V)).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${V}\n`);
    expect(fleetFileText(`# one\n\n#  two  \n${W}\n`, V)).toBe(`# one\n\n#  two  \n${V}\n`);
    expect(fleetFileText(`${W}\n`, V)).toBe(`${V}\n`);
  });

  it('creates ~/.cc-secrets at 0700 only when absent, and the file is 0600', async () => {
    const { home } = fixture();
    const p = path.join(home, '.cc-secrets', 'ccrc-mail.token');
    await writeFleetTokenFile(p, V);
    expect(statSync(path.dirname(p)).mode & 0o777).toBe(0o700);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readFileSync(p, 'utf8')).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${V}\n`);
  });

  it('never chmods an existing ~/.cc-secrets', async () => {
    const { home } = fixture();
    const d = path.join(home, '.cc-secrets');
    mkdirSync(d, { mode: 0o750 });
    chmodSync(d, 0o750);
    await writeFleetTokenFile(path.join(d, 'ccrc-mail.token'), V);
    expect(statSync(d).mode & 0o777).toBe(0o750);
  });

  it('writeGenerationFile writes `<id>\\n` at 0600 and refuses anything else', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token-generation');
    await writeGenerationFile(p, '0123456789abcdef');
    expect(readFileSync(p, 'utf8')).toBe('0123456789abcdef\n');
    expect(statSync(p).mode & 0o777).toBe(0o600);
    await expect(writeGenerationFile(p, 'nope')).rejects.toThrow(RangeError);
  });

  it('fileExists answers by lstat: a dangling link exists', async () => {
    const { dir } = fixture();
    expect(await fileExists(path.join(dir, 'nothing'))).toBe(false);
    symlinkSync(path.join(dir, 'gone'), path.join(dir, 'l'));
    expect(await fileExists(path.join(dir, 'l'))).toBe(true);
  });

  // D-4399 (plan assembly): agent.env marks a fleet box by its CCRC_AGENT_TOKEN key, which every
  // `ccrc install --role fleet` writes and the README's single-box line never does. Values are minted here, never typed.
  it('readAgentEnvMarksFleet: absent and the README single-box file do not mark a fleet box; the agent key or a read failure does', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'agent.env');
    const key = ['CCRC', 'AGENT', 'TOKEN'].join('_');
    expect(await readAgentEnvMarksFleet(p)).toBe(false);
    writeFileSync(p, 'CCRC_SERVER_URL=http://127.0.0.1:7788\n', { mode: 0o600 });
    expect(await readAgentEnvMarksFleet(p)).toBe(false);
    writeFileSync(p, `# ${key}= in a comment is not a key\nCCRC_SERVER_URL=ws://127.0.0.1:1\n`, { mode: 0o600 });
    expect(await readAgentEnvMarksFleet(p)).toBe(false);
    writeFileSync(p, `CCRC_SERVER_URL=ws://127.0.0.1:1\n${key}=${mintValue()}\n`, { mode: 0o600 });
    expect(await readAgentEnvMarksFleet(p)).toBe(true);
    writeFileSync(p, `export ${key}=${mintValue()}\n`, { mode: 0o600 });
    expect(await readAgentEnvMarksFleet(p)).toBe(true);
    rmSync(p);
    mkdirSync(p);                                                  // present but not readable as a file: unknown -> marks
    expect(await readAgentEnvMarksFleet(p)).toBe(true);
  });
});

// Spec 10.1, "Readers agree on the written file": every reader of the fleet file, sliced out of the shipped
// script (never re-typed), run over the bytes writeFleetTokenFile wrote.
describe('the five readers extract the same value from the written fleet file', () => {
  const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
  const oneLine = (rel: string, re: RegExp): string => {
    const hits = read(rel).split('\n').filter((l) => re.test(l));
    if (hits.length !== 1) throw new Error(`${rel}: expected one extraction line, found ${hits.length}`);
    return hits[0].trim();
  };
  const notify = read('deploy/notify.sh');
  const notifySnippet = notify.slice(notify.indexOf('TOKEN_FILE='), notify.indexOf('ADDR="${CCRC_ADDR:-}"'));
  const shellReaders: [string, string, string][] = [
    ['deploy/notify.sh', notifySnippet, 'tok'],
    ['ccd/ccrc-api', oneLine('ccd/ccrc-api', /^\s*t=\$\(grep -v /), 't'],
    ['ccd/ccd-pool-sync', oneLine('ccd/ccd-pool-sync', /^tok=\$\(grep -vE /), 'tok'],
    ['ccd/ccd-update-sync', oneLine('ccd/ccd-update-sync', /^tok=\$\(grep -vE /), 'tok'],
  ];
  const run = (snippet: string, v: string, file: string): string =>
    execFileSync('bash', ['-c', `TOKEN_FILE="$F"\n${snippet}\nprintf '%s' "$${v}"`],
      { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', F: file, CCRC_MAIL_TOKEN_FILE: file } }).toString();

  it.each([
    ['a new file (fixed comment line)', null],
    ['an existing file with a comment preamble', `# hand-made\n#   with spaces\n\n${W}\n`],
  ])('%s', async (_n, existing) => {
    const { home } = fixture();
    const p = path.join(home, '.cc-secrets', 'ccrc-mail.token');
    if (existing !== null) { mkdirSync(path.dirname(p), { mode: 0o700 }); writeFileSync(p, existing, { mode: 0o600 }); }
    await writeFleetTokenFile(p, V);
    const server = extractToken(readFileSync(p, 'utf8'));
    expect(server).toBe(V);
    for (const [name, snippet, v] of shellReaders) expect(run(snippet, v, p), name).toBe(V);
    expect(shellReaders).toHaveLength(4);   // plus the server's own: five
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
mkdir -p .tmp-a5 && (cd server && TMPDIR="$PWD/../.tmp-a5" ./node_modules/.bin/vitest run test/token-files.test.ts)
```

Expected (no `src/token/files.ts` yet):

```text
Error: Cannot find module '../src/token/files.js' imported from …/server/test/token-files.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/token/ports.ts`:

```ts
// Box-token ports, ring L2: interfaces and their failure contracts, declared
// by their consumer, the driver (`token/driver.ts`). The read vocabularies the
// file adapter answers in (`ValueRead`, `StateRead`, `RetiredRead`) are
// declared HERE and re-exported by `token/files.ts`, so this file imports no
// adapter: L2 depends on L1 and L0 only.
import type {
  BoxTokenState, GateNode, GenerationObservation, SyncResult, WriteRecord,
} from './policy.js';

/** Every path derives from `dir = path.dirname(cfg.mailTokenPath)`, so `CCRC_MAIL_TOKEN_PATH` moves them all;
 *  `fleetFile` and `agentEnv` derive from the home. */
export interface TokenPaths {
  dir: string; current: string; previous: string;
  pending(id: string): string;
  state: string; retired: string; generation: string;
  fleetFile: string; agentEnv: string;
}

/** lstat's answer for a value file, never its bytes. */
export interface FileMeta { dev: number; ino: number; mtimeMs: number; mode: number; kind: 'regular' | 'symlink' | 'other' }

/** Four outcomes, never folded (CLAUDE.md "No overloaded null at a seam"). `absent` is a proven ENOENT of the
 *  path itself; `unreadable` carries the errno word (EACCES, EISDIR, ELOOP, EIO, or ENOENT for a link whose
 *  target is gone). */
export type ValueRead =
  | { kind: 'value'; value: string; meta: FileMeta }
  | { kind: 'absent' }
  | { kind: 'unusable'; meta: FileMeta }
  | { kind: 'placeholder' }
  | { kind: 'unreadable'; code: string };
export type StateRead = { kind: 'state'; state: BoxTokenState } | { kind: 'absent' } | { kind: 'unusable' };
export type RetiredRead = { kind: 'retired'; digests: string[] } | { kind: 'absent' } | { kind: 'unusable' };

/** The driver's file store. Every write is the atomic, fsynced, 0600-from-birth write; a rejection means the
 *  target is unchanged. `removeValue` treats ENOENT as success. `renameOver` is one atomic replace followed by a
 *  directory fsync (promotion step (c), spec §5). */
export interface TokenStore {
  readonly paths: TokenPaths;
  readState(): Promise<StateRead>;
  writeState(s: BoxTokenState): Promise<void>;
  readValue(p: string): Promise<ValueRead>;
  writeValue(p: string, value: string): Promise<WriteRecord>;
  removeValue(p: string): Promise<void>;
  renameOver(from: string, to: string): Promise<void>;
  readRetired(): Promise<RetiredRead>;
  appendRetired(digestHex: string, at: number): Promise<void>;
  mintValue(): string; mintGenerationId(): string; mintClaimCode(): string;
}

/** The one op the driver sends. Never rejects: every outcome is a `SyncResult`. */
export interface TokenSyncLink { send(code: string): Promise<SyncResult> }

/** The fleet's `box-token-generation`, with `measuredAt` taken after the read resolved (D-4389). Never rejects. */
export interface GenerationReader { read(): Promise<GenerationObservation> }

/** The gate's node rows (`null` when there is no coord), the link, and the time of the last `ready`. */
export interface GateRowsSource { nodes(): readonly GateNode[] | null; linkUp(): boolean; lastReadyAt(): number | null }

/** A recorded-both box's own write: the fleet file, then the generation file when `generation` is non-null.
 *  A rejection means the fleet file may be unchanged; nothing is promoted on one. */
export interface BothRoleWriter { write(value: string, generation: string | null): Promise<void> }
```

Create `server/src/token/files.ts`:

```ts
// Box-token file adapter, ring L3 (spec 4.2). Measured reads that keep absent,
// unusable, placeholder and unreadable apart; one atomic, fsynced, 0600-from-
// birth write for every file this feature owns; the mints. Every path derives
// from `path.dirname(cfg.mailTokenPath)` (server/src/config.ts), so
// `CCRC_MAIL_TOKEN_PATH` moves them all.
//
// Calls go through the `fsp` object (never destructured) so a test can inject
// a failure at one step with `vi.spyOn(fs.promises, …)`; there is no fault
// seam in the production signature.
import { constants as FS, promises as fsp } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { extractToken, PLACEHOLDER_TOKEN } from '../coord/token.js';
import {
  FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, OWED_REASONS, TOKEN_FILE_PROBLEMS, TOKEN_HOLDS, TOKEN_ORIGINS,
} from '../../../shared/box-token.js';
import { CCRC_DIR_NAME, NODE_FILES } from '../../../shared/agent-protocol.js';
import type { BoxTokenState, WriteRecord } from './policy.js';
import type { FileMeta, RetiredRead, StateRead, TokenPaths, TokenStore, ValueRead } from './ports.js';

export type { FileMeta, RetiredRead, StateRead, TokenPaths, ValueRead } from './ports.js';

const errno = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? 'EIO';

export function tokenPaths(mailTokenPath: string, home: string): TokenPaths {
  const dir = path.dirname(mailTokenPath);
  return {
    dir,
    current: mailTokenPath,
    previous: path.join(dir, 'mail-previous.token'),
    pending: (id: string) => {
      if (!GENERATION_ID_RE.test(id)) throw new RangeError('tokenPaths.pending: not a generation id');
      return path.join(dir, `mail-pending-${id}.token`);
    },
    state: path.join(dir, 'box-token.json'),
    retired: path.join(dir, 'box-token-retired.json'),
    // A node file (verb, doctor, uninstall, the agent's grant): under the HOME, from NODE_FILES, never a quoted literal.
    generation: path.join(home, CCRC_DIR_NAME, NODE_FILES.tokenGeneration),
    fleetFile: path.join(home, '.cc-secrets', 'ccrc-mail.token'),
    agentEnv: path.join(home, '.ccrc', 'agent.env'),
  };
}

const kindOf = (st: { isFile(): boolean; isSymbolicLink(): boolean }): FileMeta['kind'] =>
  st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'regular' : 'other';

/** lstat first (its ENOENT is the only `absent`), then the read, which follows a link exactly as
 *  `readMailToken`'s `readFileSync` does; the value is `extractToken`'s, never re-spelled. */
export async function readValueFile(p: string): Promise<ValueRead> {
  let meta: FileMeta;
  try {
    const st = await fsp.lstat(p);
    meta = { dev: st.dev, ino: st.ino, mtimeMs: st.mtimeMs, mode: st.mode & 0o7777, kind: kindOf(st) };
  } catch (e) {
    return errno(e) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', code: errno(e) };
  }
  let raw: string;
  try {
    raw = await fsp.readFile(p, 'utf8');
  } catch (e) {
    return { kind: 'unreadable', code: errno(e) };   // ENOENT here is a dangling link: present, not absent
  }
  const value = extractToken(raw);
  if (value === null) return { kind: 'unusable', meta };
  if (value === PLACEHOLDER_TOKEN) return { kind: 'placeholder' };
  return { kind: 'value', value, meta };
}

/** Temp `<dir>/.<base>.tmp-<16 hex>` opened O_WRONLY|O_CREAT|O_EXCL at 0600, written, fsynced, fstat'd, closed,
 *  renamed over `p`, then the directory fsynced. A throw before the rename removes the temp and leaves `p`
 *  byte-equal. `writtenAtMs` is never earlier than the file's own mtime (the 4.2.1 proof compares the two). */
export async function writeValueFileAtomic(p: string, text: string): Promise<WriteRecord> {
  const dir = path.dirname(p);
  const tmp = path.join(dir, `.${path.basename(p)}.tmp-${randomBytes(8).toString('hex')}`);
  let rec: WriteRecord;
  try {
    const fh = await fsp.open(tmp, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL, 0o600);
    try {
      await fh.writeFile(text, 'utf8');
      await fh.sync();
      const st = await fh.stat();
      rec = { dev: st.dev, ino: st.ino, writtenAtMs: Math.max(Date.now(), Math.ceil(st.mtimeMs)) };
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, p);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  await syncDir(dir);
  return rec;
}

async function syncDir(dir: string): Promise<void> {
  const dh = await fsp.open(dir, 'r');
  try { await dh.sync(); } finally { await dh.close(); }
}

/** One atomic replace (promotion step (c)), then the directory fsync. */
export async function renameOverAtomic(from: string, to: string): Promise<void> {
  await fsp.rename(from, to);
  await syncDir(path.dirname(to));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);
const isStrOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
const isWrite = (v: unknown): boolean => isObj(v) && isNum(v.dev) && isNum(v.ino) && isNum(v.writtenAtMs);

/** A shape check, not a schema: enough that every reader of a field gets the type the field declares. */
function isBoxTokenState(v: unknown): v is BoxTokenState {
  if (!isObj(v) || v.v !== 1) return false;
  if (!(TOKEN_ORIGINS as readonly unknown[]).includes(v.origin)) return false;
  if (typeof v.rotationOwed !== 'boolean') return false;
  if (v.owedWhy !== null && !(OWED_REASONS as readonly unknown[]).includes(v.owedWhy)) return false;
  const c = v.current;
  if (!isObj(c) || !isStrOrNull(c.id) || !isNum(c.seq) || !isNum(c.since) || !(c.write === null || isWrite(c.write))) return false;
  if (!Array.isArray(v.pending) || !v.pending.every((p) => isObj(p) && typeof p.id === 'string' && GENERATION_ID_RE.test(p.id)
    && isNum(p.seq) && isNum(p.stagedAt) && isNumOrNull(p.handedOutAt) && isNumOrNull(p.confirmBy) && isWrite(p.write))) return false;
  const pr = v.previous;
  if (pr !== null && !(isObj(pr) && isStrOrNull(pr.id) && isNum(pr.seq) && isNum(pr.graceUntil) && isNum(pr.hardUntil)
    && typeof pr.currentPresented === 'boolean' && isWrite(pr.write))) return false;
  if (v.promoting !== null && !(isObj(v.promoting) && typeof v.promoting.id === 'string')) return false;
  if (v.hold !== null && !(TOKEN_HOLDS as readonly unknown[]).includes(v.hold)) return false;
  if (!isStrOrNull(v.fleetConfirmed) || !isNum(v.nextSeq) || !isNumOrNull(v.lastRotationAt) || !isNum(v.failures)) return false;
  if (!isObj(v.counters) || !isNum(v.counters.previousPresented) || !isNum(v.counters.retiredPresented)) return false;
  const fp = v.fileProblem;   // optional (A9's re-read): absent and null both read; anything else must be the shape
  if (fp !== undefined && fp !== null && !(isObj(fp) && isNum(fp.at) && ['current', 'pending', 'previous'].includes(fp.file as string)
    && (TOKEN_FILE_PROBLEMS as readonly unknown[]).includes(fp.word))) return false;
  return true;
}

export async function readState(p: string): Promise<StateRead> {
  let raw: string;
  try { raw = await fsp.readFile(p, 'utf8'); } catch (e) {
    return errno(e) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unusable' };
  }
  try {
    const v: unknown = JSON.parse(raw);
    return isBoxTokenState(v) ? { kind: 'state', state: v } : { kind: 'unusable' };
  } catch { return { kind: 'unusable' }; }
}

export async function writeState(p: string, s: BoxTokenState): Promise<void> {
  await writeValueFileAtomic(p, `${JSON.stringify(s)}\n`);
}

const DIGEST_RE = /^[0-9a-f]{64}$/;

export async function readRetired(p: string): Promise<RetiredRead> {
  let raw: string;
  try { raw = await fsp.readFile(p, 'utf8'); } catch (e) {
    return errno(e) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unusable' };
  }
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObj(v) || v.v !== 1 || !Array.isArray(v.retired)) return { kind: 'unusable' };
    const digests: string[] = [];
    for (const r of v.retired) {
      if (!isObj(r) || typeof r.sha256 !== 'string' || !DIGEST_RE.test(r.sha256)) return { kind: 'unusable' };
      digests.push(r.sha256);
    }
    return { kind: 'retired', digests };
  } catch { return { kind: 'unusable' }; }
}

/** Adds one digest (deduplicated). An unusable file is never overwritten: that would drop digests, so it throws. */
export async function appendRetired(p: string, valueDigest: string, at: number): Promise<void> {
  if (!DIGEST_RE.test(valueDigest)) throw new RangeError('appendRetired: not a sha256 hex digest');
  const cur = await readRetired(p);
  if (cur.kind === 'unusable') throw new Error(`${p} is unusable; refusing to rewrite it`);
  let entries: { len: number; sha256: string; at: number }[] = [];
  if (cur.kind === 'retired') {
    const raw = JSON.parse(await fsp.readFile(p, 'utf8')) as { retired: { len: number; sha256: string; at: number }[] };
    entries = raw.retired;
  }
  if (!entries.some((e) => e.sha256 === valueDigest)) entries.push({ len: 64, sha256: valueDigest, at });
  await writeValueFileAtomic(p, `${JSON.stringify({ v: 1, retired: entries })}\n`);
}

export function valueDigestHex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function mintValue(): string { return randomBytes(32).toString('hex'); }
export function mintGenerationId(): string { return randomBytes(8).toString('hex'); }
export function mintClaimCode(): string { return randomBytes(32).toString('base64url'); }

/** The existing file's `#` and blank lines kept verbatim and in order, then the one value line; no file ->
 *  the fixed comment line, then the value. Every reader takes the first line that is neither blank nor `#`. */
export function fleetFileText(existing: string | null, value: string): string {
  if (existing === null) return `${FLEET_TOKEN_FILE_COMMENT}\n${value}\n`;
  const lines = existing.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const kept = lines.filter((l) => { const t = l.trim(); return t === '' || t.startsWith('#'); });
  return [...kept, value].join('\n') + '\n';
}

/** `<home>/.cc-secrets` is created at 0700 only when absent; an existing directory is never chmodded. */
export async function writeFleetTokenFile(p: string, value: string): Promise<void> {
  const dir = path.dirname(p);
  if (!(await fileExists(dir))) await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  let existing: string | null = null;
  try { existing = await fsp.readFile(p, 'utf8'); } catch (e) {
    if (errno(e) !== 'ENOENT') throw e;
  }
  await writeValueFileAtomic(p, fleetFileText(existing, value));
}

export async function writeGenerationFile(p: string, id: string): Promise<void> {
  if (!GENERATION_ID_RE.test(id)) throw new RangeError('writeGenerationFile: not a generation id');
  await writeValueFileAtomic(p, `${id}\n`);
}

/** lstat, any kind. Anything but a proven ENOENT reads as present: the callers ask "is there a .cc-secrets", and
 *  "present" is the safe answer. */
export async function fileExists(p: string): Promise<boolean> {
  try { await fsp.lstat(p); return true; } catch (e) { return errno(e) !== 'ENOENT'; }
}

/** Whether `~/.ccrc/agent.env` marks a FLEET box, so the both-role writer must not act (spec 4.10 as narrowed by
 *  D-4399). A proven ENOENT: no. A readable file: yes iff a line's KEY is `CCRC_AGENT_TOKEN`
 *  (optionally after `export `), which every `ccrc install --role fleet` writes and the README's single-box file
 *  (`CCRC_SERVER_URL` only) never does. Any other read failure: yes, because unknown is the safe answer. The file
 *  carries the agent bearer: only each line's key is looked at, no value is kept, returned or logged. */
export async function readAgentEnvMarksFleet(p: string): Promise<boolean> {
  let raw: string;
  try { raw = await fsp.readFile(p, 'utf8'); } catch (e) { return errno(e) !== 'ENOENT'; }
  return raw.split('\n').some((line) => /^\s*(?:export\s+)?CCRC_AGENT_TOKEN=/.test(line));
}

/** The `TokenStore` port over these functions (an addition to the contract: its one adapter). */
export function fileTokenStore(paths: TokenPaths): TokenStore {
  return {
    paths,
    readState: () => readState(paths.state),
    writeState: (s) => writeState(paths.state, s),
    readValue: (p) => readValueFile(p),
    writeValue: (p, value) => writeValueFileAtomic(p, `${value}\n`),
    removeValue: async (p) => { await fsp.rm(p, { force: true }); },
    renameOver: (from, to) => renameOverAtomic(from, to),
    readRetired: () => readRetired(paths.retired),
    appendRetired: (d, at) => appendRetired(paths.retired, d, at),
    mintValue, mintGenerationId, mintClaimCode,
  };
}

/** The recorded-both writer (spec 4.10): the fleet file, then the generation file. */
export function fileBothRoleWriter(paths: TokenPaths): { write(value: string, generation: string | null): Promise<void> } {
  return {
    async write(value, generation) {
      await writeFleetTokenFile(paths.fleetFile, value);
      if (generation !== null) await writeGenerationFile(paths.generation, generation);
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
mkdir -p .tmp-a5 && (cd server && TMPDIR="$PWD/../.tmp-a5" ./node_modules/.bin/vitest run test/token-files.test.ts)
```

Expected: `Tests  26 passed (26)` (23 prototyped plus the three cases added at plan assembly; the worker records the measured count).

- [ ] **Step 5: Mutation check.** In `server/src/token/files.ts`, replace

```ts
    const fh = await fsp.open(tmp, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL, 0o600);
```

with

```ts
    const fh = await fsp.open(tmp, FS.O_WRONLY | FS.O_CREAT, 0o600);
```

and run `mkdir -p .tmp-a5 && (cd server && TMPDIR="$PWD/../.tmp-a5" ./node_modules/.bin/vitest run test/token-files.test.ts)` from the repo root. Expected: `× opens its temp O_EXCL at 0600 and the file is 0600 even under umask 0` — `Tests  1 failed | 25 passed (26)` (measured as 1 failed | 22 passed on the 23-case prototype). Restore the line and re-run: all green.

- [ ] **Step 6: Mutation check.** In `server/src/token/files.ts`, replace

```ts
    await fsp.rm(tmp, { force: true }).catch(() => {});
```

with

```ts

```

and run `mkdir -p .tmp-a5 && (cd server && TMPDIR="$PWD/../.tmp-a5" ./node_modules/.bin/vitest run test/token-files.test.ts)` from the repo root. Expected: `× a failure injected at the rename leaves the old file byte-equal and no temp behind` — `1 failed | 25 passed` (measured as 1 failed | 22 passed on the 23-case prototype). Restore the line and re-run: all green.

- [ ] **Step 7: Mutation check.** In `server/src/token/files.ts`, replace

```ts
  if (!(await fileExists(dir))) await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
```

with

```ts
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); await fsp.chmod(dir, 0o700);
```

and run `mkdir -p .tmp-a5 && (cd server && TMPDIR="$PWD/../.tmp-a5" ./node_modules/.bin/vitest run test/token-files.test.ts)` from the repo root. Expected: `× never chmods an existing ~/.cc-secrets` — `1 failed | 25 passed` (measured as 1 failed | 22 passed on the 23-case prototype). Restore the line and re-run: all green.

- [ ] **Step 8: Pins.** No census, route, lane or `NODE_FILES` pin moves (the adapter registers no route, calls no `checkMailToken`, and reads no node file over the agent). Run unchanged, one file per call: `test/single-definition.test.ts`. Expected: `406 passed` with no failure (A1's count). Its `QUOTED` scan (A1 widened it to `box-token-generation`) stays clean only because `tokenPaths` builds the generation path from `NODE_FILES.tokenGeneration`; a quoted `'box-token-generation'` in `files.ts` turns "the four names no older code spells are quoted nowhere else" red. Its "one absent/unreadable read vocabulary" scan is clean for `ports.ts`/`files.ts` because they spell `{ kind: 'absent' }` and `{ kind: 'unreadable' }` as arms, never the quoted pair as a union.

- [ ] **Step 8b: Mutation check (plan assembly).** In `server/src/token/files.ts`, replace `generation: path.join(home, CCRC_DIR_NAME, NODE_FILES.tokenGeneration),` with `generation: path.join(dir, 'box-token-generation'),` and run `token-files.test.ts`, then `single-definition.test.ts`: expected red in both ("derives every server path …"; "the four names … quoted nowhere else"). Then replace `return raw.split('\n').some(` … with `return false;` in `readAgentEnvMarksFleet` and run `token-files.test.ts`: expected `× readAgentEnvMarksFleet: …` red. Restore each and re-run green.

- [ ] **Step 9: Commit** (afterwards, from the repo root: `rm -rf .tmp-a5`)

```bash
git add server/src/token/ports.ts server/src/token/files.ts server/test/token-files.test.ts
git commit -m "feat(token): box-token file adapter and ports (A5)

Measured reads keep absent, unusable, placeholder and unreadable apart;
one atomic, fsynced, 0600-from-birth write with a (dev, ino) write record;
state and retired-digest files; the mints; the fleet file's preamble rule
and its 0700-only-if-created directory; five readers agree on the file.
The generation file is the node file under the home; agent.env marks a
fleet box by its agent-token key only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A6: Rotation policy (L1)

(prototype) measured: server/test/token-policy.test.ts: red 1 failed suite (module missing, no tests) -> green 67 passed, 2026-10-07 on main 282e79e44 (with the A1 scaffold in place)

(not prototyped, added at plan assembly from review findings: `mintedState`'s generation id and the case "a fresh minted current with an absent fleet read stages fleet-behind"; `TOKEN_FILE_REREAD_MS`, `STALL_ALERT_MS`; `BoxTokenState.fileProblem?`. The file then has 68 cases.)

**Files:**
- Create: `server/src/token/policy.ts` (L1: imports `shared/` only, pinned by the test's ring case)
- Test: `server/test/token-policy.test.ts` (new)

**Interfaces:**
- Consumes: `BUSY_UPDATE_STATES`, `IN_FLIGHT_UPDATE_PHASES`, `NodeOs`, `NodeRole`, `UpdatePhase`, `UpdateState` (`shared/api.ts`); `CLAIM_CODE_TTL_MS`, `TOKEN_SYNC_OP`, `isTokenVerbMissing`, `TokenSyncOpError`, `TokenTransport` (`shared/agent-protocol.ts`, A1); `BoxTokenPhase`, `GenerationRead`, `OwedReason`, `TokenHold`, `TokenOrigin` (`shared/box-token.ts`, A1).
- Produces: every timing constant of the contract (`GRACE_MS` … `ROTATE_NOW_MIN_INTERVAL_MS`); `WriteRecord`, `PendingGen`, `BoxTokenState`; `GateNode`, `GateInput`, `GateVerdict`, `rotationGate(i: GateInput): GateVerdict`, `bothRoleWriterArmed(i): boolean`; `CodeSlot`, `BurnedCode`, `ClaimDoorState`, `ClaimMatch`, `ClaimReply`, `ClaimAlert`, `claimVerdict(state, match, nodeId, now)`; `GenerationObservation`, `SyncResult`, `DriverAction`, `nextAction(i)`, `confirmedGeneration(state, obs): string | null`, `applySyncResult(state, sent, r, now)`, `retireDue(prev, now)`, `backoffMs(failures)`, `phaseOf(state, hold, hasCurrent)`; `FileMetaShape`, `FileMetaLike`, `RecoveryPlan`, `recoveryPlan(i)`.
- Contract additions (marked in the code): `GateVerdict`'s open arm carries `nodeId: string | null` (the one measured fleet node a code is bound to, so the driver never picks a row); `DriverAction`'s `stage` carries `why: OwedReason | 'rotate-now'` and `send` carries `nodeId`; `nextAction`'s `state` accepts `null` (a boot whose mint failed with no history) and answers `retry-mint`. Pure state helpers, so the L4 driver changes state only through L1: `mintedState`, `adoptedState`, `owe`, `stagedState`, `handedOutState`, `promotedState`, `extendedGraceState`, `codeExpiresAt` (the door's only TTL arithmetic), `provedWrite` (the 4.2.1 metadata proof, shared by `recoveryPlan` and boot). `FileMetaLike.meta === null` means the file is ABSENT, which is how boot asks `recoveryPlan` about a missing `mail.token` with history (the current-file proof is skipped, the sibling proof kept).
- Judgement recorded in the code: the cap word and the op word are one spelling (`TOKEN_SYNC_CAP = TOKEN_SYNC_OP`, Part B adds `token-sync` to `CCRC_CAP_WORDS`); a hold names the row's `label`; confirmations and retirement proceed while the gate holds (they start nothing); the fleet reads "behind" only from an `absent` read or a different id measured after the last rotation, never from `unreadable`; a lost result, a refusal or `predates-op`/`unsent` drops a generation that was never handed out, and keeps one that was (the fleet may hold it); `code-used` discards even a handed-out value and owes a rotation.

- [ ] **Step 1: Write the failing test**

Create `server/test/token-policy.test.ts`:

```ts
// Every pure decision of the box-token rotation (server/src/token/policy.ts,
// ring L1): the gate of spec 9.2, the claim door's verdict (4.6), one
// rotation's next step and its confirmations (§5), retirement, backoff, the
// phase word, and the boot-recovery proof (4.2.1). No clock, no files.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BURNED_CODES_KEPT, CLAIM_MISS_BUDGET, CLAIM_MISS_WINDOW_MS, CONFIRM_DEADLINE_MS, GRACE_HARD_MS, GRACE_MS,
  HOLD_REPROBE_MS, MAX_PENDING, applySyncResult, backoffMs, bothRoleWriterArmed, claimVerdict, codeExpiresAt,
  confirmedGeneration, extendedGraceState, handedOutState, mintedState, nextAction, phaseOf, promotedState,
  recoveryPlan, retireDue, rotationGate, stagedState,
  type BoxTokenState, type ClaimDoorState, type FileMetaLike, type GateInput, type GateNode, type GateVerdict,
} from '../src/token/policy.js';
import { CLAIM_CODE_TTL_MS } from '../../shared/agent-protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const NODE = '11111111-2222-4333-8444-555555555555';
const W = (ino: number, at = 1000) => ({ dev: 7, ino, writtenAtMs: at });

const fleetRow = (over: Partial<GateNode> = {}): GateNode => ({
  nodeId: NODE, nodeIdMeasured: true, label: 'fleet', role: 'fleet', reachable: true, os: 'linux',
  caps: ['token-sync'], agentOps: ['update', 'token-sync'], updateState: 'idle', reportedPhase: null, ...over,
});
const serverRow = (over: Partial<GateNode> = {}): GateNode => ({
  nodeId: 'server', nodeIdMeasured: false, label: 'server', role: 'server', reachable: true, os: 'linux',
  caps: ['token-sync'], agentOps: null, updateState: 'idle', reportedPhase: null, ...over,
});
const remote = (over: Partial<GateInput> = {}): GateInput => ({
  fleetMode: 'remote', role: 'server', roleSource: 'recorded', agentEnvMarksFleet: false,
  nodes: [serverRow(), fleetRow()], linkUp: true, learned: null, lastReadyAt: 0,
  handedOutUnconfirmed: 0, mintFailed: false, now: 10_000_000, ...over,
});
const bothLocal = (over: Partial<GateInput> = {}): GateInput => ({
  fleetMode: 'local', role: 'both', roleSource: 'recorded', agentEnvMarksFleet: false,
  nodes: [serverRow({ role: 'both', agentOps: null })], linkUp: true, learned: null, lastReadyAt: null,
  handedOutUnconfirmed: 0, mintFailed: false, now: 10_000_000, ...over,
});
const OPEN: GateVerdict = { open: true, mode: 'remote', nodeId: NODE };
const base = (): BoxTokenState => mintedState(1000, W(1), null, null, 'c'.repeat(16));

describe('rotationGate: each mechanical condition alone holds and names itself (spec 9.2)', () => {
  it('opens with everything measured, and binds the code to the one fleet node', () => {
    expect(rotationGate(remote())).toEqual(OPEN);
  });

  it.each<[string, Partial<GateInput>, string, string | null]>([
    ['a failed boot mint', { mintFailed: true }, 'mint-failed', null],
    ['no coord', { nodes: null }, 'no-coord', null],
    ['an update pending on the server row', { nodes: [serverRow({ updateState: 'pending' }), fleetRow()] }, 'update-in-flight', 'server'],
    ['a fleet report phase in flight', { nodes: [serverRow(), fleetRow({ reportedPhase: 'installing' })] }, 'update-in-flight', 'fleet'],
    ['no fleet row', { nodes: [serverRow()] }, 'fleet-rows', null],
    ['two reachable fleet rows', { nodes: [serverRow(), fleetRow(), fleetRow({ nodeId: 'x', label: 'fleet2' })] }, 'fleet-rows', null],
    ['an unmeasured node id', { nodes: [serverRow(), fleetRow({ nodeIdMeasured: false })] }, 'node-id-unmeasured', 'fleet'],
    ['the link down', { linkUp: false }, 'link-down', 'fleet'],
    ['an agent with no op list', { nodes: [serverRow(), fleetRow({ agentOps: null })] }, 'agent-predates-op', 'fleet'],
    ['an agent whose ready lacks the op', { nodes: [serverRow(), fleetRow({ agentOps: ['update'] })] }, 'agent-predates-op', 'fleet'],
    ['caps read without the verb', { nodes: [serverRow(), fleetRow({ caps: ['update'] })] }, 'verb-missing', 'fleet'],
    ['two values handed out and unconfirmed', { handedOutUnconfirmed: MAX_PENDING }, 'pending-cap', 'fleet'],
  ])('%s', (_n, over, hold, node) => {
    expect(rotationGate(remote(over))).toEqual({ open: false, hold, node });
  });

  it('an unreachable second fleet row does not count', () => {
    expect(rotationGate(remote({ nodes: [serverRow(), fleetRow(), fleetRow({ nodeId: 'x', reachable: false })] }))).toEqual(OPEN);
  });

  it('a node with no caps file (os unknown, a deploy.sh box) is not held: the op itself probes', () => {
    expect(rotationGate(remote({ nodes: [serverRow(), fleetRow({ os: 'unknown', caps: [] })] }))).toEqual(OPEN);
  });

  it('a learned hold stands until a fresh ready or the hourly re-probe', () => {
    const learned = { hold: 'stale-client' as const, at: 5_000_000 };
    const now = 5_000_100;
    expect(rotationGate(remote({ learned, lastReadyAt: 4_000_000, now }))).toEqual({ open: false, hold: 'stale-client', node: 'fleet' });
    expect(rotationGate(remote({ learned, lastReadyAt: 5_000_001, now }))).toEqual(OPEN);
    expect(rotationGate(remote({ learned, lastReadyAt: 4_000_000, now: 5_000_000 + HOLD_REPROBE_MS }))).toEqual(OPEN);
    expect(rotationGate(remote({ learned: { hold: 'verb-missing', at: 5_000_000 }, lastReadyAt: null, now })))
      .toEqual({ open: false, hold: 'verb-missing', node: 'fleet' });
  });

  it('a recorded both box opens in local mode with agentOps NULL', () => {
    expect(rotationGate(bothLocal())).toEqual({ open: true, mode: 'both-local', nodeId: null });
  });

  it.each<[string, Partial<GateInput>]>([
    ['the role derived (no CCRC_ROLE)', { roleSource: 'derived-absent' }],
    ['the role derived (invalid CCRC_ROLE)', { roleSource: 'derived-invalid' }],
    ['an agent.env that marks a fleet box', { agentEnvMarksFleet: true }],
    ['a recorded server role', { role: 'server' }],
  ])('local mode holds role-unrecorded with %s', (_n, over) => {
    expect(rotationGate(bothLocal(over))).toEqual({ open: false, hold: 'role-unrecorded', node: null });
  });

  it('a both box holds on its own update in flight and its own missing verb', () => {
    expect(rotationGate(bothLocal({ nodes: [serverRow({ role: 'both', updateState: 'applying' })] })))
      .toEqual({ open: false, hold: 'update-in-flight', node: 'server' });
    expect(rotationGate(bothLocal({ nodes: [serverRow({ role: 'both', caps: [] })] })))
      .toEqual({ open: false, hold: 'verb-missing', node: 'server' });
  });

  it('bothRoleWriterArmed: recorded both, local mode, no fleet-marking agent.env — and nothing else', () => {
    const ok = { role: 'both', roleSource: 'recorded', fleetMode: 'local', agentEnvMarksFleet: false } as const;
    expect(bothRoleWriterArmed(ok)).toBe(true);
    expect(bothRoleWriterArmed({ ...ok, roleSource: 'derived-absent' })).toBe(false);
    expect(bothRoleWriterArmed({ ...ok, fleetMode: 'remote' })).toBe(false);
    expect(bothRoleWriterArmed({ ...ok, agentEnvMarksFleet: true })).toBe(false);
    expect(bothRoleWriterArmed({ ...ok, role: 'fleet' })).toBe(false);
  });
});

describe('the hold rule (R1 as amended by R5): one gate for every trigger, auto never read', () => {
  it('the gate has no trigger, auto or intent input', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'token', 'policy.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function rotationGate('), src.indexOf('// ── the claim door'));
    expect(body).not.toMatch(/\bauto\b|\bintent\b|\btrigger\b|rotateRequested/);
    expect(Object.keys(remote()).sort()).toEqual(['agentEnvMarksFleet', 'fleetMode', 'handedOutUnconfirmed', 'lastReadyAt',
      'learned', 'linkUp', 'mintFailed', 'nodes', 'now', 'role', 'roleSource']);
  });

  it('an owed rotation and "Rotate now" stage on the same open gate, and both hold on the same closed one', () => {
    const owed: BoxTokenState = { ...base(), rotationOwed: true, owedWhy: 'adopted' };
    const held = rotationGate(remote({ nodes: [serverRow(), fleetRow({ updateState: 'applying' })] }));
    for (const [state, rotateRequested] of [[owed, false], [base(), true]] as const) {
      expect(nextAction({ state, gate: OPEN, generation: null, rotateRequested, backoffUntil: null, now: 2000 }).kind).toBe('stage');
      expect(nextAction({ state, gate: held, generation: null, rotateRequested, backoffUntil: null, now: 2000 }))
        .toEqual({ kind: 'hold', hold: 'update-in-flight', node: 'fleet' });
    }
  });
});

describe('claimVerdict (spec 4.6)', () => {
  const door = (over: Partial<ClaimDoorState> = {}): ClaimDoorState => ({
    live: [{ digest: 'd1', generation: 'g1', nodeId: NODE, expiresAt: codeExpiresAt(1000) }],
    burned: [], misses: { windowStart: 0, count: 0 }, ...over,
  });

  it('a live code within its TTL and bound to the node answers 200 once and is burned', () => {
    const r = claimVerdict(door(), { kind: 'live', index: 0 }, NODE, 2000);
    expect(r.reply).toEqual({ status: 200, error: null, generation: 'g1' });
    expect(r.next.live).toEqual([]);
    expect(r.next.burned).toEqual([{ digest: 'd1', generation: 'g1', at: 2000 }]);
    expect(r.alert).toBeNull();
  });

  it('a live code is served even with the miss budget used up, and misses never burn it', () => {
    let s = door();
    for (let i = 0; i < 1000; i++) s = claimVerdict(s, { kind: 'none' }, NODE, 2000).next;
    expect(claimVerdict(s, { kind: 'none' }, NODE, 2000).reply.status).toBe(429);
    expect(s.live).toHaveLength(1);
    expect(claimVerdict(s, { kind: 'live', index: 0 }, NODE, 2000).reply.status).toBe(200);
  });

  it('misses: 404 (or 400 malformed) until the budget, 429 past it, a fresh window resets', () => {
    let s = door();
    for (let i = 0; i < CLAIM_MISS_BUDGET; i++) {
      const r = claimVerdict(s, i % 2 ? { kind: 'none' } : { kind: 'malformed' }, NODE, 2000);
      expect(r.reply.status).toBe(i % 2 ? 404 : 400);
      s = r.next;
    }
    expect(claimVerdict(s, { kind: 'malformed' }, NODE, 2000).reply).toEqual({ status: 429, error: 'rate-limited', generation: null });
    expect(claimVerdict(s, { kind: 'none' }, NODE, CLAIM_MISS_WINDOW_MS + 1).reply.status).toBe(404);
  });

  it('past its TTL (TTL plus one second) a live code is burned as code-expired, with an alert', () => {
    const r = claimVerdict(door(), { kind: 'live', index: 0 }, NODE, 1000 + CLAIM_CODE_TTL_MS + 1000);
    expect(r.reply).toEqual({ status: 410, error: 'code-expired', generation: 'g1' });
    expect(r.next.live).toEqual([]);
    expect(r.alert).toEqual({ kind: 'expired', generation: 'g1' });
  });

  it('a live code presented with another node id is burned as wrong-node (403)', () => {
    const r = claimVerdict(door(), { kind: 'live', index: 0 }, 'other', 2000);
    expect(r.reply).toEqual({ status: 403, error: 'wrong-node', generation: 'g1' });
    expect(r.next.live).toEqual([]);
    expect(r.alert).toEqual({ kind: 'wrong-node', generation: 'g1' });
  });

  it('a replay of a burned code is 410 code-used and changes nothing', () => {
    const s = door({ live: [], burned: [{ digest: 'd1', generation: 'g1', at: 2000 }] });
    const r = claimVerdict(s, { kind: 'burned', index: 0 }, NODE, 3000);
    expect(r.reply).toEqual({ status: 410, error: 'code-used', generation: 'g1' });
    expect(r.next).toBe(s);
    expect(r.alert).toEqual({ kind: 'replay', generation: 'g1' });
  });

  it('keeps at most BURNED_CODES_KEPT burned codes', () => {
    let s = door({ live: Array.from({ length: 12 }, (_, i) => ({ digest: `d${i}`, generation: `g${i}`, nodeId: NODE, expiresAt: 1e12 })) });
    for (let i = 0; i < 12; i++) s = claimVerdict(s, { kind: 'live', index: 0 }, NODE, 2000).next;
    expect(s.burned).toHaveLength(BURNED_CODES_KEPT);
  });
});

describe('one rotation', () => {
  const G = '1'.repeat(16);
  const G2 = '2'.repeat(16);
  const staged = (): BoxTokenState => stagedState({ ...base(), rotationOwed: true, owedWhy: 'adopted' }, G, 2000, W(2));
  const handed = (at = 3000): BoxTokenState => handedOutState(staged(), G, at);

  it('stages, then sends the STAGED generation — never the current one, also for a fleet box that is behind', () => {
    const behind = { read: { kind: 'absent' as const }, measuredAt: 5000 };
    expect(nextAction({ state: base(), gate: OPEN, generation: behind, rotateRequested: false, backoffUntil: null, now: 5000 }))
      .toEqual({ kind: 'stage', why: 'fleet-behind' });
    const other = { read: { kind: 'id' as const, id: 'f'.repeat(16) }, measuredAt: 5000 };
    expect(nextAction({ state: base(), gate: OPEN, generation: other, rotateRequested: false, backoffUntil: null, now: 5000 }).kind).toBe('stage');
    const a = nextAction({ state: staged(), gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now: 5000 });
    expect(a).toEqual({ kind: 'send', generation: G, nodeId: NODE });
    expect(a.kind === 'send' && a.generation).not.toBe(base().current.id);
  });

  it('a fresh minted current with an absent fleet read stages fleet-behind (a new two-box install hands the fleet its first value)', () => {
    // Plan assembly (review, critical): a server-minted value carries a generation id, so a fleet box with no file
    // reads `behind` and the forward rotation hands it a value through the claim door. With `current.id` null this
    // returned `none` and the fleet box never received a token.
    const fresh = mintedState(1000, W(1), null, null, 'd'.repeat(16));
    expect([fresh.current.id, fresh.rotationOwed]).toEqual(['d'.repeat(16), false]);
    const absent = { read: { kind: 'absent' as const }, measuredAt: 5000 };
    expect(nextAction({ state: fresh, gate: OPEN, generation: absent, rotateRequested: false, backoffUntil: null, now: 5000 }))
      .toEqual({ kind: 'stage', why: 'fleet-behind' });
  });

  it('an unreadable generation read is never "behind"', () => {
    const r = { read: { kind: 'unreadable' as const }, measuredAt: 5000 };
    expect(nextAction({ state: base(), gate: OPEN, generation: r, rotateRequested: false, backoffUntil: null, now: 5000 })).toEqual({ kind: 'none' });
  });

  it('promotion only on fleet confirmation: the op result for the outstanding, handed-out request', () => {
    expect(applySyncResult(handed(), G, { kind: 'synced', generation: G, transport: 'https' }, 4000).promote).toBe(G);
    // not outstanding (already discarded), another id, or never handed out: nothing is promoted
    expect(applySyncResult(base(), G, { kind: 'synced', generation: G, transport: 'https' }, 4000).promote).toBeNull();
    expect(applySyncResult(handed(), G, { kind: 'synced', generation: G2, transport: 'https' }, 4000).promote).toBeNull();
    expect(applySyncResult(staged(), G, { kind: 'synced', generation: G, transport: 'https' }, 4000).promote).toBeNull();
  });

  it('promotion only on fleet confirmation: a generation read naming the issued id, measured after the hand-out', () => {
    const at = (id: string, measuredAt: number) => ({ read: { kind: 'id' as const, id }, measuredAt });
    expect(confirmedGeneration(handed(3000), at(G, 3001))).toBe(G);
    expect(confirmedGeneration(handed(3000), at(G, 3000))).toBeNull();
    expect(confirmedGeneration(handed(3000), at(G, 2999))).toBeNull();
    expect(confirmedGeneration(handed(3000), at('9'.repeat(16), 4000))).toBeNull();
    expect(confirmedGeneration(staged(), at(G, 4000))).toBeNull();
    expect(nextAction({ state: handed(3000), gate: OPEN, generation: at(G, 3001), rotateRequested: false, backoffUntil: null, now: 3001 }))
      .toEqual({ kind: 'promote', generation: G, via: 'generation-read' });
  });

  it('a handed-out value waits for its confirmation: no promotion, no second rotation, "Rotate now" joins', () => {
    for (const rotateRequested of [false, true]) {
      expect(nextAction({ state: handed(3000), gate: OPEN, generation: null, rotateRequested, backoffUntil: null, now: 3000 + CONFIRM_DEADLINE_MS }))
        .toEqual({ kind: 'none' });
    }
  });

  it('handed-out deadline without a fleet 401: held past its deadline, still pending; a forward rotation discards it once confirmed', () => {
    const late = 3000 + CONFIRM_DEADLINE_MS + 1;
    const down = rotationGate(remote({ linkUp: false }));
    const s = handed(3000);
    expect(nextAction({ state: s, gate: down, generation: null, rotateRequested: false, backoffUntil: null, now: late }))
      .toEqual({ kind: 'hold', hold: 'link-down', node: 'fleet' });
    expect(s.pending.map((p) => p.id)).toEqual([G]);           // still accepted
    // the forward rotation once the link is back
    const fwd = { ...s, rotationOwed: false, owedWhy: null };
    expect(nextAction({ state: fwd, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now: late }))
      .toEqual({ kind: 'stage', why: 'confirm-deadline' });
    const two = handedOutState(stagedState(fwd, G2, late, W(3)), G2, late + 1);
    expect(two.pending.map((p) => p.id)).toEqual([G, G2]);
    const r = applySyncResult(two, G2, { kind: 'synced', generation: G2, transport: 'https' }, late + 2);
    expect(r.promote).toBe(G2);
    const after = promotedState(r.state, G2, late + 2, W(4));
    expect(after.pending).toEqual([]);                            // G is discarded only now
    expect(after.current.id).toBe(G2);
  });

  it('promotedState: G current, the old current previous with grace and hard bound, the owed flag cleared', () => {
    const p = promotedState(handed(), G, 5000, W(9));
    expect(p.current).toEqual({ id: G, seq: 2, since: 5000, write: W(2) });
    expect(p.previous).toEqual({ id: 'c'.repeat(16), seq: 1, graceUntil: 5000 + GRACE_MS, hardUntil: 5000 + GRACE_HARD_MS, currentPresented: false, write: W(9) });
    expect([p.origin, p.rotationOwed, p.owedWhy, p.fleetConfirmed, p.lastRotationAt, p.promoting]).toEqual(['rotated', false, null, G, 5000, null]);
  });

  it.each<[string, Parameters<typeof applySyncResult>[2], Partial<BoxTokenState>, string | null]>([
    ['stale-client is a learned hold, not a failure', { kind: 'refused', word: 'stale-client', detail: null }, { failures: 0 }, 'stale-client'],
    ['a ccrc without the verb is a learned hold (D-4395)', { kind: 'refused', word: 'spawn-failed', detail: 'ccrc: unknown argument: token' }, { failures: 0 }, 'verb-missing'],
    ['no launcher at all is the same hold (D-4395)', { kind: 'refused', word: 'spawn-failed', detail: 'could not start the launcher: ENOENT' }, { failures: 0 }, 'verb-missing'],
    ['any other spawn-failed is a failure', { kind: 'refused', word: 'spawn-failed', detail: 'boom' }, { failures: 1, lastFailure: 'spawn-failed' }, null],
    ['a lost result is a failure', { kind: 'lost', why: 'timeout' }, { failures: 1, lastFailure: 'timeout' }, null],
    ['an unsent request is not a failure', { kind: 'unsent' }, { failures: 0 }, null],
  ])('%s', (_n, r, expectState, learned) => {
    const out = applySyncResult(staged(), G, r, 4000);
    expect(out.state).toMatchObject(expectState);
    expect(out.learned?.hold ?? null).toBe(learned);
    expect(out.state.pending, 'a value never handed out is dropped').toEqual([]);
  });

  it('a handed-out value survives a lost result and a write or proof failure (the fleet may hold it)', () => {
    for (const r of [{ kind: 'lost', why: 'disconnected' }, { kind: 'refused', word: 'write-failed', detail: null },
      { kind: 'refused', word: 'proof-unmeasured', detail: null }] as const) {
      expect(applySyncResult(handed(), G, r, 4000).state.pending.map((p) => p.id)).toEqual([G]);
    }
  });

  it('code-used discards even a handed-out value and owes a rotation', () => {
    const out = applySyncResult({ ...handed(), rotationOwed: false, owedWhy: null }, G, { kind: 'refused', word: 'code-used', detail: null }, 4000);
    expect(out.state.pending).toEqual([]);
    expect([out.state.rotationOwed, out.state.owedWhy]).toEqual([true, 'code-used']);
  });

  it('a both box promotes a staged value by its own write', () => {
    expect(nextAction({ state: staged(), gate: rotationGate(bothLocal()), generation: null, rotateRequested: false, backoffUntil: null, now: 3000 }))
      .toEqual({ kind: 'promote', generation: G, via: 'own-write' });
  });

  it('backs off after a failure, except for "Rotate now"', () => {
    const owed = { ...base(), rotationOwed: true, owedWhy: 'adopted' as const, failures: 1 };
    expect(nextAction({ state: owed, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: 9000, now: 5000 }))
      .toEqual({ kind: 'backoff', until: 9000 });
    expect(nextAction({ state: base(), gate: OPEN, generation: null, rotateRequested: true, backoffUntil: 9000, now: 5000 }).kind).toBe('stage');
  });
});

describe('retirement needs presentation (spec §5)', () => {
  const prev = (over: Partial<NonNullable<BoxTokenState['previous']>> = {}) =>
    ({ id: 'c'.repeat(16), seq: 1, graceUntil: 10_000, hardUntil: 50_000, currentPresented: false, write: W(9), ...over });

  it('no before grace; grace once passed and presented; extend while not presented; hard-bound at the hard bound', () => {
    expect(retireDue(prev(), 9_999)).toBe('no');
    expect(retireDue(prev({ currentPresented: true }), 9_999)).toBe('no');
    expect(retireDue(prev({ currentPresented: true }), 10_000)).toBe('grace');
    expect(retireDue(prev(), 10_000)).toBe('extend');
    expect(retireDue(prev(), 50_000)).toBe('hard-bound');
  });

  it('an extended grace owes a forward rotation and never passes the hard bound', () => {
    const s = extendedGraceState({ ...base(), previous: prev() }, 48_000);
    expect(s.previous?.graceUntil).toBe(50_000);
    expect([s.rotationOwed, s.owedWhy]).toEqual([true, 'fleet-behind']);
  });

  it('nextAction retires on grace or at the hard bound, and extends otherwise', () => {
    const at = (p: ReturnType<typeof prev>, now: number) =>
      nextAction({ state: { ...base(), previous: p }, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now });
    expect(at(prev({ currentPresented: true }), 10_000)).toEqual({ kind: 'retire', why: 'grace' });
    expect(at(prev(), 10_000)).toEqual({ kind: 'extend-grace' });
    expect(at(prev(), 50_000)).toEqual({ kind: 'retire', why: 'hard-bound' });
  });
});

describe('backoffMs and phaseOf', () => {
  it('60 s doubling, capped at one hour; none without failures', () => {
    expect([0, 1, 2, 3, 7, 40].map(backoffMs)).toEqual([0, 60_000, 120_000, 240_000, 3_600_000, 3_600_000]);
  });

  it('restart from each phase: the persisted state names its phase and its next step', () => {
    const G = '1'.repeat(16);
    const st = stagedState(base(), G, 2000, W(2));
    const ho = handedOutState(st, G, 3000);
    const promoting = { ...ho, promoting: { id: G } };
    const grace = promotedState(ho, G, 4000, W(9));
    const owed = { ...base(), rotationOwed: true, owedWhy: 'recovered' as const };
    const cases: [BoxTokenState, string, string][] = [
      [base(), 'idle', 'none'], [st, 'staged', 'send'], [ho, 'handed-out', 'none'],
      [promoting, 'promoting', 'promote'], [grace, 'grace', 'none'], [owed, 'idle', 'stage'],
      [{ ...owed, failures: 2 }, 'failed', 'stage'],
    ];
    for (const [s, phase, action] of cases) {
      expect(phaseOf(s, null, true)).toBe(phase);
      expect(nextAction({ state: s, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now: 4500 }).kind).toBe(action);
    }
    expect(phaseOf(base(), 'link-down', true)).toBe('held');
    expect(phaseOf(base(), null, false)).toBe('unconfigured');
    expect(nextAction({ state: null, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now: 1 }))
      .toEqual({ kind: 'retry-mint' });
  });
});

describe('recoveryPlan: the 4.2.1 proof, metadata only', () => {
  const meta = (ino: number, mtimeMs = 900, kind: 'regular' | 'symlink' = 'regular') => ({ dev: 7, ino, mtimeMs, mode: 0o600, kind });
  const broken = (ino = 1, mtimeMs = 900, kind: 'regular' | 'symlink' = 'regular'): FileMetaLike =>
    ({ meta: meta(ino, mtimeMs, kind), usable: false, placeholder: false, digest: null });
  const good = (ino: number, digest = 'p'.repeat(64)): FileMetaLike => ({ meta: meta(ino), usable: true, placeholder: false, digest });
  const rotated = (): BoxTokenState => ({ ...base(), origin: 'rotated',
    previous: { id: null, seq: 0, graceUntil: 9e12, hardUntil: 9e12, currentPresented: false, write: W(5) } });

  it('recovers from the previous file when every check holds', () => {
    expect(recoveryPlan({ state: rotated(), current: broken(), pending: null, previous: good(5), retired: [] })).toEqual({ kind: 'from-previous' });
  });

  it('finishes a recorded promotion from its pending file first', () => {
    const G = '1'.repeat(16);
    const s = { ...handedOutState(stagedState(rotated(), G, 2000, W(6)), G, 3000), promoting: { id: G } };
    expect(recoveryPlan({ state: s, current: broken(), pending: good(6), previous: good(5), retired: [] })).toEqual({ kind: 'finish-promotion', id: G });
  });

  it.each<[string, Partial<Parameters<typeof recoveryPlan>[0]>]>([
    ['no state file', { state: null }],
    ['origin adopted', { state: { ...rotated(), origin: 'adopted' } }],
    ['mail.token replaced with a new inode', { current: broken(2) }],
    ['an in-place edit with a later mtime', { current: broken(1, 1001) }],
    ['mail.token a symlink', { current: broken(1, 900, 'symlink') }],
    ['the previous file holding a retired value', { retired: ['p'.repeat(64)] }],
    ['the previous file a new inode', { previous: good(8) }],
    ['the previous file unusable', { previous: { ...good(5), usable: false, digest: null } }],
    ['a handed-out pending file as the only sibling', { previous: null, pending: good(6) }],
  ])('refuses: %s', (_n, over) => {
    const i = { state: rotated(), current: broken(), pending: null, previous: good(5), retired: [] as string[], ...over };
    expect(recoveryPlan(i)).toEqual({ kind: 'refuse' });
  });

  it('an ABSENT mail.token (meta null) skips the current-file proof and keeps the sibling proof', () => {
    const absent: FileMetaLike = { meta: null, usable: false, placeholder: false, digest: null };
    expect(recoveryPlan({ state: rotated(), current: absent, pending: null, previous: good(5), retired: [] })).toEqual({ kind: 'from-previous' });
    expect(recoveryPlan({ state: rotated(), current: absent, pending: null, previous: good(8), retired: [] })).toEqual({ kind: 'refuse' });
  });
});

describe('ring L1', () => {
  it('policy.ts imports nothing but shared/', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'token', 'policy.ts'), 'utf8');
    const froms = [...src.matchAll(/^import[^;]*?from '([^']+)'/gms)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(0);
    for (const f of froms) expect(f, f).toMatch(/^\.\.\/\.\.\/\.\.\/shared\/[a-z-]+\.js$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
mkdir -p .tmp-a6 && (cd server && TMPDIR="$PWD/../.tmp-a6" ./node_modules/.bin/vitest run test/token-policy.test.ts)
```

Expected:

```text
Error: Cannot find module '../src/token/policy.js' imported from …/server/test/token-policy.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/token/policy.ts`:

```ts
// Box-token rotation policy, ring L1: pure decisions over L0 words and plain
// data. It imports nothing but `shared/` (CLAUDE.md "Rings"): no `fs`, no
// Fastify, no clock. The driver (`token/driver.ts`, L4) and the claim door
// (`token/door.ts`, L3) call these and act on the answer; neither decides.
//
// Spec: docs/superpowers/specs/2026-10-07-box-token-lifecycle-design.html,
// §5 (one rotation), §5.1 (timings), §6 (failures), §9.2 (the gate), 4.2.1
// (boot recovery) and 4.6 (the claim door).
import type { NodeOs, NodeRole, UpdatePhase, UpdateState } from '../../../shared/api.js';
import { BUSY_UPDATE_STATES, IN_FLIGHT_UPDATE_PHASES } from '../../../shared/api.js';
import {
  CLAIM_CODE_TTL_MS, TOKEN_SYNC_OP, isTokenVerbMissing,
  type TokenSyncOpError, type TokenTransport,
} from '../../../shared/agent-protocol.js';
import type {
  BoxTokenPhase, GenerationRead, OwedReason, TokenFileProblem, TokenHold, TokenOrigin,
} from '../../../shared/box-token.js';

// ── timings (spec §5.1) ──────────────────────────────────────────────────────
export const GRACE_MS = 5 * 60_000;
export const GRACE_HARD_MS = 60 * 60_000;
export const CONFIRM_DEADLINE_MS = 5 * 60_000;
export const DRIVER_TICK_MS = 60_000;
export const BACKOFF_MIN_MS = 60_000;
export const BACKOFF_MAX_MS = 60 * 60_000;
export const HOLD_REPROBE_MS = 60 * 60_000;
export const FAILURES_FOR_BANNER = 3;
export const MAX_PENDING = 2;
export const CLAIM_MISS_BUDGET = 30;
export const CLAIM_MISS_WINDOW_MS = 60_000;
export const CLAIM_ALERT_EVERY_MS = 60_000;
export const BURNED_CODES_KEPT = 8;
export const BURNED_CODE_KEEP_MS = 10 * 60_000;
export const ROTATE_NOW_MIN_INTERVAL_MS = 60_000;
/** The driver's run-time re-read of the server's token files, at the readiness sweep's cadence (spec 4.2; watch.ts's
 *  READINESS_SWEEP_MS is 600 s, which this ring cannot import). Added at plan assembly. */
export const TOKEN_FILE_REREAD_MS = 10 * 60_000;
/** A rotation owed and not completed this long raises the console's stall alert (BoxTokenView.stalled): wave 1's
 *  doctor reports the state as SKIP, which no exit code counts. Added at plan assembly. */
export const STALL_ALERT_MS = 24 * 60 * 60_000;

// ── persisted state (`<dir>/box-token.json`, 0600, no secret) ────────────────
/** fstat of the temp file before its rename: the rename keeps (dev, ino). */
export interface WriteRecord { dev: number; ino: number; writtenAtMs: number }
export interface PendingGen {
  id: string; seq: number; stagedAt: number;
  handedOutAt: number | null; confirmBy: number | null;   // set together at hand-out
  write: WriteRecord;
}
export interface BoxTokenState {
  v: 1;
  origin: TokenOrigin;
  rotationOwed: boolean; owedWhy: OwedReason | null;
  current: { id: string | null; seq: number; since: number; write: WriteRecord | null };
  pending: PendingGen[];
  previous: { id: string | null; seq: number; graceUntil: number; hardUntil: number;
              currentPresented: boolean; write: WriteRecord } | null;
  promoting: { id: string } | null;
  recovering: { source: 'pending' | 'previous' } | null;
  fleetConfirmed: string | null;
  nextSeq: number;
  lastRotationAt: number | null;
  failures: number; lastFailure: string | null;
  hold: TokenHold | null; holdNode: string | null;
  lastSync: { at: number; word: string; transport: TokenTransport | 'unmeasured' } | null;
  counters: { previousPresented: number; retiredPresented: number };
  retiredRefusedAt: number | null;
  mintFailedAt: number | null;
  lastBootRecovery: { at: number; source: 'pending' | 'previous' } | null;
  /** The driver's last run-time re-read finding (A9). Optional: absent in every state written before it. */
  fileProblem?: { at: number; file: 'current' | 'pending' | 'previous'; word: TokenFileProblem } | null;
}

/** A fresh state for a value this server just minted (boot, or the driver's mint retry). Pending and previous
 *  entries of a prior state are kept: boot re-reads their files, and a value the fleet may hold is not dropped.
 *  `id` is a fresh generation id (`mintGenerationId()`): a minted value the fleet has never confirmed then reads
 *  `behind` against an absent or different fleet generation, so the fleet box is handed a value (plan assembly). */
export function mintedState(now: number, write: WriteRecord, prior: BoxTokenState | null, owed: OwedReason | null, id: string): BoxTokenState {
  const seq = prior?.nextSeq ?? 1;
  return {
    v: 1, origin: 'minted', rotationOwed: owed !== null, owedWhy: owed,
    current: { id, seq, since: now, write },
    pending: prior?.pending ?? [], previous: prior?.previous ?? null, promoting: null, recovering: null,
    fleetConfirmed: null, nextSeq: seq + 1, lastRotationAt: prior?.lastRotationAt ?? null,
    failures: 0, lastFailure: null, hold: null, holdNode: null, lastSync: prior?.lastSync ?? null,
    counters: prior?.counters ?? { previousPresented: 0, retiredPresented: 0 },
    retiredRefusedAt: prior?.retiredRefusedAt ?? null, mintFailedAt: null,
    lastBootRecovery: prior?.lastBootRecovery ?? null,
  };
}

/** The hand-made value: origin adopted, the first rotation owed (spec 4.2 step 6). */
export function adoptedState(now: number, prior: BoxTokenState | null): BoxTokenState {
  const seq = prior?.nextSeq ?? 1;
  return {
    v: 1, origin: 'adopted', rotationOwed: true, owedWhy: 'adopted',
    current: { id: null, seq, since: now, write: null },
    pending: prior?.pending ?? [], previous: prior?.previous ?? null, promoting: null, recovering: null,
    fleetConfirmed: null, nextSeq: seq + 1, lastRotationAt: prior?.lastRotationAt ?? null,
    failures: 0, lastFailure: null, hold: null, holdNode: null, lastSync: prior?.lastSync ?? null,
    counters: prior?.counters ?? { previousPresented: 0, retiredPresented: 0 },
    retiredRefusedAt: prior?.retiredRefusedAt ?? null, mintFailedAt: null,
    lastBootRecovery: prior?.lastBootRecovery ?? null,
  };
}

/** Owe a forward rotation without clearing an earlier, still-standing reason. */
export function owe(s: BoxTokenState, why: OwedReason): BoxTokenState {
  return s.rotationOwed ? s : { ...s, rotationOwed: true, owedWhy: why };
}

// ── the rotation gate (spec §9.2) ────────────────────────────────────────────
export interface GateNode {
  nodeId: string; nodeIdMeasured: boolean; label: string;
  role: NodeRole | null; reachable: boolean; os: NodeOs;
  caps: readonly string[]; agentOps: readonly string[] | null;
  updateState: UpdateState; reportedPhase: UpdatePhase | null;
}
export interface GateInput {
  fleetMode: 'local' | 'remote'; role: NodeRole; roleSource: 'recorded' | 'derived-absent' | 'derived-invalid';
  agentEnvMarksFleet: boolean;
  nodes: readonly GateNode[] | null;
  linkUp: boolean;
  learned: { hold: 'verb-missing' | 'stale-client'; at: number } | null;
  lastReadyAt: number | null;
  handedOutUnconfirmed: number;
  mintFailed: boolean;
  now: number;
}
/** `nodeId` on the open remote verdict is the one measured fleet node a code is bound to (an addition to the
 *  contract's shape: without it the driver would have to pick the row itself, which is a decision). */
export type GateVerdict =
  | { open: true; mode: 'remote' | 'both-local'; nodeId: string | null }
  | { open: false; hold: TokenHold; node: string | null };

/** The cap word and the op word are one spelling: `ccrc`'s `CCRC_CAP_WORDS` gains `token-sync` (Part B). */
const TOKEN_SYNC_CAP = TOKEN_SYNC_OP;

const busy = (n: GateNode): boolean =>
  (BUSY_UPDATE_STATES as readonly string[]).includes(n.updateState)
  || (n.reportedPhase !== null && (IN_FLIGHT_UPDATE_PHASES as readonly string[]).includes(n.reportedPhase));

export function bothRoleWriterArmed(i: { role: NodeRole; roleSource: GateInput['roleSource']; fleetMode: 'local' | 'remote'; agentEnvMarksFleet: boolean }): boolean {
  return i.role === 'both' && i.roleSource === 'recorded' && i.fleetMode === 'local' && !i.agentEnvMarksFleet;
}

/** One verdict for every trigger: there is no trigger kind and no auto input (R1 as amended by R5). */
export function rotationGate(i: GateInput): GateVerdict {
  const held = (hold: TokenHold, node: string | null = null): GateVerdict => ({ open: false, hold, node });
  if (i.mintFailed) return held('mint-failed');
  if (i.nodes === null) return held('no-coord');
  const updating = i.nodes.find(busy);
  if (i.fleetMode === 'local') {
    if (!bothRoleWriterArmed(i)) return held('role-unrecorded');
    if (updating) return held('update-in-flight', updating.label);
    const own = i.nodes.find((n) => n.role === 'both');
    if (own && own.os !== 'unknown' && !own.caps.includes(TOKEN_SYNC_CAP)) return held('verb-missing', own.label);
    return { open: true, mode: 'both-local', nodeId: null };
  }
  if (updating) return held('update-in-flight', updating.label);
  const fleet = i.nodes.filter((n) => n.role === 'fleet' && n.reachable);
  if (fleet.length !== 1) return held('fleet-rows');
  const f = fleet[0];
  if (!f.nodeIdMeasured) return held('node-id-unmeasured', f.label);
  if (!i.linkUp) return held('link-down', f.label);
  if (f.agentOps === null || !f.agentOps.includes(TOKEN_SYNC_OP)) return held('agent-predates-op', f.label);
  if (f.os !== 'unknown' && !f.caps.includes(TOKEN_SYNC_CAP)) return held('verb-missing', f.label);
  if (i.learned !== null) {
    const reprobed = i.lastReadyAt !== null && i.lastReadyAt > i.learned.at;
    if (!reprobed && i.now - i.learned.at < HOLD_REPROBE_MS) return held(i.learned.hold, f.label);
  }
  if (i.handedOutUnconfirmed >= MAX_PENDING) return held('pending-cap', f.label);
  return { open: true, mode: 'remote', nodeId: f.nodeId };
}

// ── the claim door's decision (spec 4.6) ─────────────────────────────────────
export interface CodeSlot { digest: string; generation: string; nodeId: string; expiresAt: number }
export interface BurnedCode { digest: string; generation: string; at: number }
export interface ClaimDoorState { live: readonly CodeSlot[]; burned: readonly BurnedCode[]; misses: { windowStart: number; count: number } }
export type ClaimMatch = { kind: 'malformed' } | { kind: 'live'; index: number } | { kind: 'burned'; index: number } | { kind: 'none' };
export type ClaimReply =
  | { status: 200; error: null; generation: string }
  | { status: 400 | 404 | 429; error: 'bad-request' | 'no-claim' | 'rate-limited'; generation: null }
  | { status: 403 | 410; error: 'wrong-node' | 'code-expired' | 'code-used'; generation: string };
export type ClaimAlert = { kind: 'expired' | 'wrong-node' | 'replay'; generation: string } | { kind: 'misses'; count: number } | null;

/** A code's expiry from its issue time; the door spells TTL nowhere else. */
export function codeExpiresAt(issuedAt: number): number { return issuedAt + CLAIM_CODE_TTL_MS; }

function keepBurned(burned: readonly BurnedCode[], now: number): BurnedCode[] {
  return burned.filter((b) => now - b.at < BURNED_CODE_KEEP_MS).slice(-BURNED_CODES_KEPT);
}

export function claimVerdict(state: ClaimDoorState, match: ClaimMatch, nodeId: string, now: number):
  { reply: ClaimReply; next: ClaimDoorState; alert: ClaimAlert } {
  if (match.kind === 'live') {
    const slot = state.live[match.index];
    const live = state.live.filter((_, i) => i !== match.index);
    const burned = keepBurned([...state.burned, { digest: slot.digest, generation: slot.generation, at: now }], now);
    const next = { ...state, live, burned };
    if (now > slot.expiresAt) {
      return { reply: { status: 410, error: 'code-expired', generation: slot.generation }, next, alert: { kind: 'expired', generation: slot.generation } };
    }
    if (slot.nodeId !== nodeId) {
      return { reply: { status: 403, error: 'wrong-node', generation: slot.generation }, next, alert: { kind: 'wrong-node', generation: slot.generation } };
    }
    return { reply: { status: 200, error: null, generation: slot.generation }, next, alert: null };
  }
  if (match.kind === 'burned') {
    const b = state.burned[match.index];
    return { reply: { status: 410, error: 'code-used', generation: b.generation }, next: state, alert: { kind: 'replay', generation: b.generation } };
  }
  const fresh = now - state.misses.windowStart >= CLAIM_MISS_WINDOW_MS;
  const misses = { windowStart: fresh ? now : state.misses.windowStart, count: (fresh ? 0 : state.misses.count) + 1 };
  const next = { ...state, misses };
  const alert: ClaimAlert = { kind: 'misses', count: misses.count };
  if (misses.count > CLAIM_MISS_BUDGET) return { reply: { status: 429, error: 'rate-limited', generation: null }, next, alert };
  return match.kind === 'malformed'
    ? { reply: { status: 400, error: 'bad-request', generation: null }, next, alert }
    : { reply: { status: 404, error: 'no-claim', generation: null }, next, alert };
}

// ── one rotation (spec §5) ───────────────────────────────────────────────────
export type GenerationObservation = { read: GenerationRead; measuredAt: number };
export type SyncResult =
  | { kind: 'synced'; generation: string; transport: TokenTransport | 'unmeasured' }
  | { kind: 'refused'; word: TokenSyncOpError; detail: string | null }
  | { kind: 'predates-op' } | { kind: 'unsent' } | { kind: 'lost'; why: 'timeout' | 'disconnected' | 'aborted' };
/** `why` on `stage` is an addition to the contract's shape: the driver records it as `owedWhy`, and it must not
 *  derive it itself. */
export type DriverAction =
  | { kind: 'none' }
  | { kind: 'hold'; hold: TokenHold; node: string | null }
  | { kind: 'retry-mint' }
  | { kind: 'stage'; why: OwedReason | 'rotate-now' }
  | { kind: 'send'; generation: string; nodeId: string }
  | { kind: 'promote'; generation: string; via: 'op-result' | 'generation-read' | 'own-write' }
  | { kind: 'retire'; why: 'grace' | 'hard-bound' }
  | { kind: 'extend-grace' }
  | { kind: 'backoff'; until: number };

/** The id of a handed-out pending generation equal to the read's id, read strictly after the hand-out. */
export function confirmedGeneration(state: BoxTokenState, obs: GenerationObservation): string | null {
  if (obs.read.kind !== 'id') return null;
  const id = obs.read.id;
  const g = state.pending.find((p) => p.id === id);
  return g !== undefined && g.handedOutAt !== null && obs.measuredAt > g.handedOutAt ? g.id : null;
}

export function retireDue(prev: NonNullable<BoxTokenState['previous']>, now: number): 'no' | 'grace' | 'hard-bound' | 'extend' {
  if (now >= prev.hardUntil) return prev.currentPresented ? 'grace' : 'hard-bound';
  if (now < prev.graceUntil) return 'no';
  return prev.currentPresented ? 'grace' : 'extend';
}

export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_MIN_MS * 2 ** Math.min(failures - 1, 30), BACKOFF_MAX_MS);
}

/** `state` may be null: a boot whose mint failed with no history has none (an addition to the contract's
 *  non-null parameter). */
export function nextAction(i: { state: BoxTokenState | null; gate: GateVerdict; generation: GenerationObservation | null;
  rotateRequested: boolean; backoffUntil: number | null; now: number }): DriverAction {
  const { state, gate, now } = i;
  if (state === null || (!gate.open && gate.hold === 'mint-failed')) return { kind: 'retry-mint' };
  if (state.promoting !== null) return { kind: 'promote', generation: state.promoting.id, via: 'op-result' };
  if (i.generation !== null) {
    const confirmed = confirmedGeneration(state, i.generation);
    if (confirmed !== null) return { kind: 'promote', generation: confirmed, via: 'generation-read' };
  }
  const staged = state.pending.find((p) => p.handedOutAt === null);
  if (staged && gate.open && gate.mode === 'both-local') return { kind: 'promote', generation: staged.id, via: 'own-write' };
  if (state.previous !== null) {
    const due = retireDue(state.previous, now);
    if (due === 'grace' || due === 'hard-bound') return { kind: 'retire', why: due };
    if (due === 'extend' && !state.rotationOwed) return { kind: 'extend-grace' };
  }
  if (staged) {
    if (!gate.open) return { kind: 'hold', hold: gate.hold, node: gate.node };
    if (gate.mode === 'remote' && gate.nodeId !== null) return { kind: 'send', generation: staged.id, nodeId: gate.nodeId };
  }
  const handedOut = state.pending.filter((p) => p.handedOutAt !== null);
  const waiting = handedOut.some((p) => p.confirmBy !== null && now <= p.confirmBy);
  if (waiting) return { kind: 'none' };   // a rotation is in flight; a second trigger joins it
  const overdue = handedOut.length > 0;
  const behind = i.generation !== null && state.current.id !== null && state.pending.length === 0
    && (state.lastRotationAt === null || i.generation.measuredAt > state.lastRotationAt)
    && (i.generation.read.kind === 'absent' || (i.generation.read.kind === 'id' && i.generation.read.id !== state.current.id));
  const why: OwedReason | 'rotate-now' | null = state.rotationOwed ? (state.owedWhy ?? 'adopted')
    : overdue ? 'confirm-deadline' : behind ? 'fleet-behind' : i.rotateRequested ? 'rotate-now' : null;
  if (why === null) return { kind: 'none' };
  if (!gate.open) return { kind: 'hold', hold: gate.hold, node: gate.node };
  if (i.backoffUntil !== null && now < i.backoffUntil && why !== 'rotate-now') return { kind: 'backoff', until: i.backoffUntil };
  return { kind: 'stage', why };
}

/** Fold one op answer into the state. The generation is promoted only on `synced` naming the sent id, and only
 *  if it is still outstanding and was handed out; anything else confirms nothing. A value never handed out is
 *  dropped from `pending` (the driver removes its file and revokes its code). */
export function applySyncResult(state: BoxTokenState, sent: string, r: SyncResult, now: number):
  { state: BoxTokenState; promote: string | null; learned: { hold: 'verb-missing' | 'stale-client'; at: number } | null } {
  const gen = state.pending.find((p) => p.id === sent);
  if (gen === undefined) return { state, promote: null, learned: null };
  const transportOf = (t: TokenTransport | 'unmeasured' | null): TokenTransport | 'unmeasured' => t ?? state.lastSync?.transport ?? 'unmeasured';
  const dropUnclaimed = (s: BoxTokenState): BoxTokenState =>
    gen.handedOutAt === null ? { ...s, pending: s.pending.filter((p) => p.id !== sent) } : s;
  if (r.kind === 'synced') {
    const lastSync = { at: now, word: 'synced', transport: r.transport };
    if (r.generation === sent && gen.handedOutAt !== null) {
      return { state: { ...state, lastSync, failures: 0, lastFailure: null }, promote: sent, learned: null };
    }
    return { state: dropUnclaimed({ ...state, lastSync }), promote: null, learned: null };
  }
  if (r.kind === 'predates-op' || r.kind === 'unsent') return { state: dropUnclaimed(state), promote: null, learned: null };
  if (r.kind === 'lost') {
    const s = { ...state, failures: state.failures + 1, lastFailure: r.why };
    return { state: dropUnclaimed(s), promote: null, learned: null };
  }
  const lastSync = { at: now, word: r.word, transport: transportOf(null) };
  if (r.word === 'stale-client') {
    return { state: dropUnclaimed({ ...state, lastSync }), promote: null, learned: { hold: 'stale-client', at: now } };
  }
  if (r.word === 'spawn-failed' && isTokenVerbMissing(r.detail)) {
    return { state: dropUnclaimed({ ...state, lastSync }), promote: null, learned: { hold: 'verb-missing', at: now } };
  }
  if (r.word === 'code-used') {
    // Someone else holds this value and it never reached the fleet: discard it even if handed out (spec §6 row 2).
    const s = owe({ ...state, lastSync, failures: state.failures + 1, lastFailure: r.word,
      pending: state.pending.filter((p) => p.id !== sent) }, 'code-used');
    return { state: s, promote: null, learned: null };
  }
  return { state: dropUnclaimed({ ...state, lastSync, failures: state.failures + 1, lastFailure: r.word }), promote: null, learned: null };
}

/** Stage a new generation (its pending file already written). */
export function stagedState(state: BoxTokenState, id: string, now: number, write: WriteRecord): BoxTokenState {
  return { ...state, nextSeq: state.nextSeq + 1,
    pending: [...state.pending, { id, seq: state.nextSeq, stagedAt: now, handedOutAt: null, confirmBy: null, write }] };
}

/** The hand-out, recorded before the claim's 200 (D-4394). */
export function handedOutState(state: BoxTokenState, id: string, at: number): BoxTokenState {
  return { ...state, pending: state.pending.map((p) => (p.id === id ? { ...p, handedOutAt: at, confirmBy: at + CONFIRM_DEADLINE_MS } : p)) };
}

/** Promotion step (d): G is current, the old current is previous with its grace deadline, every other pending
 *  value is discarded and the owed flag clears. `previousWrite` is null only when the old current could not be
 *  copied (a promotion finished at boot over a broken file): then no previous slot is kept. */
export function promotedState(state: BoxTokenState, id: string, now: number, previousWrite: WriteRecord | null): BoxTokenState {
  const g = state.pending.find((p) => p.id === id);
  if (g === undefined) throw new RangeError('promotedState: the generation is not pending');
  return {
    ...state, origin: 'rotated', rotationOwed: false, owedWhy: null,
    current: { id: g.id, seq: g.seq, since: now, write: g.write },
    pending: [],
    previous: previousWrite === null ? null : { id: state.current.id, seq: state.current.seq, graceUntil: now + GRACE_MS,
      hardUntil: now + GRACE_HARD_MS, currentPresented: false, write: previousWrite },
    promoting: null, recovering: null, fleetConfirmed: g.id, lastRotationAt: now,
    failures: 0, lastFailure: null, hold: null, holdNode: null,
  };
}

/** Grace extended because the new current value has not been presented; a forward rotation is owed. */
export function extendedGraceState(state: BoxTokenState, now: number): BoxTokenState {
  if (state.previous === null) return state;
  const graceUntil = Math.min(now + GRACE_MS, state.previous.hardUntil);
  return owe({ ...state, previous: { ...state.previous, graceUntil } }, 'fleet-behind');
}

export function phaseOf(state: BoxTokenState | null, hold: TokenHold | null, hasCurrent: boolean): BoxTokenPhase {
  if (!hasCurrent) return 'unconfigured';
  if (state === null) return 'idle';
  if (state.promoting !== null) return 'promoting';
  if (hold !== null) return 'held';
  if (state.pending.some((p) => p.handedOutAt !== null)) return 'handed-out';
  if (state.pending.length > 0) return 'staged';
  if (state.failures > 0) return 'failed';
  if (state.previous !== null) return 'grace';
  return 'idle';
}

// ── boot recovery (spec 4.2.1) ───────────────────────────────────────────────
/** Structural copy of `token/files.ts`'s `FileMeta` (L1 imports no L3). */
export interface FileMetaShape { dev: number; ino: number; mtimeMs: number; mode: number; kind: 'regular' | 'symlink' | 'other' }
/** `meta: null` means the file is absent. `digest` is the sha256 hex of a usable value, else null. */
export interface FileMetaLike { meta: FileMetaShape | null; usable: boolean; placeholder: boolean; digest: string | null }
export type RecoveryPlan = { kind: 'refuse' } | { kind: 'finish-promotion'; id: string } | { kind: 'from-previous' };

/** Server-written: a regular file whose (dev, ino) is the write record's and whose mtime is no later. */
export function provedWrite(f: FileMetaLike, w: WriteRecord | null): boolean {
  return w !== null && f.meta !== null && f.meta.kind === 'regular'
    && f.meta.dev === w.dev && f.meta.ino === w.ino && f.meta.mtimeMs <= w.writtenAtMs;
}

export function recoveryPlan(i: { state: BoxTokenState | null; current: FileMetaLike; pending: FileMetaLike | null;
  previous: FileMetaLike | null; retired: readonly string[] }): RecoveryPlan {
  const s = i.state;
  if (s === null || s.origin === 'adopted') return { kind: 'refuse' };
  if (i.current.meta !== null && !provedWrite(i.current, s.current.write)) return { kind: 'refuse' };
  const sibling = (f: FileMetaLike | null, w: WriteRecord | null): boolean =>
    f !== null && provedWrite(f, w) && f.usable && !f.placeholder && f.digest !== null && !i.retired.includes(f.digest);
  if (s.promoting !== null) {
    const g = s.pending.find((p) => p.id === s.promoting?.id);
    if (g !== undefined && sibling(i.pending, g.write)) return { kind: 'finish-promotion', id: g.id };
  }
  if (s.previous !== null && sibling(i.previous, s.previous.write)) return { kind: 'from-previous' };
  return { kind: 'refuse' };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
mkdir -p .tmp-a6 && (cd server && TMPDIR="$PWD/../.tmp-a6" ./node_modules/.bin/vitest run test/token-policy.test.ts)
```

Expected: `Tests  68 passed (68)` (67 prototyped plus the fresh-mint case).

- [ ] **Step 5: Mutation check.** In `server/src/token/policy.ts`, replace

```ts
  return g !== undefined && g.handedOutAt !== null && obs.measuredAt > g.handedOutAt ? g.id : null;
```

with

```ts
  return g !== undefined && g.handedOutAt !== null && obs.measuredAt >= g.handedOutAt ? g.id : null;
```

and run `mkdir -p .tmp-a6 && (cd server && TMPDIR="$PWD/../.tmp-a6" ./node_modules/.bin/vitest run test/token-policy.test.ts)` from the repo root. Expected: `× promotion only on fleet confirmation: a generation read naming the issued id, measured after the hand-out` — `1 failed | 67 passed` (measured on the 67-case prototype as 1 failed | 66 passed). Restore the line and re-run: all green.

- [ ] **Step 6: Mutation check.** In `server/src/token/policy.ts`, replace

```ts
  if (f.os !== 'unknown' && !f.caps.includes(TOKEN_SYNC_CAP)) return held('verb-missing', f.label);
```

with

```ts

```

and run `mkdir -p .tmp-a6 && (cd server && TMPDIR="$PWD/../.tmp-a6" ./node_modules/.bin/vitest run test/token-policy.test.ts)` from the repo root. Expected: `× caps read without the verb` — `1 failed | 67 passed` (measured as 1 failed | 66 passed on the 67-case prototype). Restore the line and re-run: all green.

- [ ] **Step 7: Mutation check.** In `server/src/token/policy.ts`, replace

```ts
  return prev.currentPresented ? 'grace' : 'extend';
```

with

```ts
  return 'grace';
```

and run `mkdir -p .tmp-a6 && (cd server && TMPDIR="$PWD/../.tmp-a6" ./node_modules/.bin/vitest run test/token-policy.test.ts)` from the repo root. Expected: two red: `× no before grace; grace once passed and presented; extend while not presented; hard-bound at the hard bound` and `× nextAction retires on grace or at the hard bound, and extends otherwise` (measured). Restore the line and re-run: all green.

- [ ] **Step 8: Mutation check.** In `server/src/token/policy.ts`, replace

```ts
    if (r.generation === sent && gen.handedOutAt !== null) {
```

with

```ts
    if (r.generation === sent) {
```

and run `mkdir -p .tmp-a6 && (cd server && TMPDIR="$PWD/../.tmp-a6" ./node_modules/.bin/vitest run test/token-policy.test.ts)` from the repo root. Expected: `× promotion only on fleet confirmation: the op result for the outstanding, handed-out request` — `1 failed | 67 passed` (measured on the 67-case prototype as 1 failed | 66 passed). Restore the line and re-run: all green.

- [ ] **Step 9: Pins.** None moves. The gate reads no `auto` and no intent: the test's source scan of `rotationGate`'s body is the mechanism (adding `auto`, `intent`, `trigger` or `rotateRequested` to that body turns `× the gate has no trigger, auto or intent input` red), and its `Object.keys` pin fails if `GateInput` gains a field.

- [ ] **Step 10: Commit** (afterwards, from the repo root: `rm -rf .tmp-a6`)

```bash
git add server/src/token/policy.ts server/test/token-policy.test.ts
git commit -m "feat(token): rotation policy, ring L1 (A6)

The mechanical gate of spec 9.2 with one verdict for every trigger, the
claim door's verdict, the next driver step, confirmation only by the op
result or a generation read measured after the hand-out, retirement that
needs presentation, backoff, the phase word, and the 4.2.1 proof. A minted
value carries a generation id, so a fleet box with no file reads behind.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A7: Boot: mint, adopt, recovery, retired refusal, both-role boot write

(prototype) measured: server/test/token-boot.test.ts: red 1 failed suite (module missing, no tests) -> green 27 passed, 2026-10-07 on main 282e79e44 (with A1/A3/A4/A8 scaffolds; A4 is what makes the derived-both notify.sh case refuse)
(not prototyped, added at plan assembly from review findings: the minted value's generation id; `agent.env` read for its fleet-marking key (D-4399), with the case "recorded both with the README's agent.env is armed" and the fleet-box case re-planted with the key; the restart-after-hand-out case (Review Focus 1). The file then has 29 cases.)

**Files:**
- Create: `server/src/token/boot.ts` (L3, D-4388)
- Modify: `server/src/index.ts:16` (the `readMailToken` import) and `server/src/index.ts:47-63` (the D-57 comment, `readMailToken`, and the no-token warning) at main 282e79e44
- Test: `server/test/token-boot.test.ts` (new)

**Interfaces:**
- Consumes: `BoxTokenHolder`, `HolderSlots`, `readMailToken`, `checkMailToken`, `MailTokenFileUnusable`, `MailTokenPlaceholderUnedited` (A3; `readMailToken` stays and is called for the refusal, so boot refuses with today's classes and words); A4's fail-shut `/api/notify` (the derived-both mixed-version case); A5's files; A6's `recoveryPlan`, `provedWrite`, `bothRoleWriterArmed`, `mintedState`, `adoptedState`, `owe`, `promotedState`, `stagedState`/`handedOutState` (test fixture); `FleetMode`, `RoleSource` (`server/src/config.ts`).
- Produces: `BootInput { mailTokenPath; home; role: NodeRole; roleSource: RoleSource; fleetMode: FleetMode; now }`, `BootResult { holder; state; mintFailed; bothWriterArmed; agentEnvMarksFleet; warnings }`, `bootBoxToken(i: BootInput): Promise<BootResult>`; `index.ts` passing the holder as `mailToken`.
- Contract addition: `BootResult.agentEnvMarksFleet` (the driver's gate needs the same answer boot used; without it `index.ts` would read `agent.env` a second time). It is `readAgentEnvMarksFleet(paths.agentEnv)` (A5), not a bare existence check: the README's single-box `agent.env` carries `CCRC_SERVER_URL` only and must not disarm a recorded both box (D-4399).
- The warning words are the contract's, verbatim; two more one-line warnings with paths and words only exist for states the contract's list does not name: an unusable `box-token.json` or `box-token-retired.json`, an unusable auxiliary file, value files with no state record, a promotion that could not be finished, and the "missing with history, no sibling qualifies" mint.
- Boot order as the code runs it: (0) read the retired digests into the holder; (1) finish a recorded promotion (pending file proved and not retired: copy the still-current value to `mail-previous.token` if it is still the recorded current, rename the pending file over `mail.token`, `promotedState`; a rename already done is detected by `mail.token` carrying the pending file's (dev, ino); anything else abandons the promotion and owes `recovered`); (2) read `mail.token`: unreadable or placeholder refuse as today; unusable goes to `recoveryPlan` (from the previous file, else refuse as today); (3) a retired value mints and owes `retired-written-back`; (4) absent with no state mints with no debt; absent with history recovers from the previous file or mints owing `recovered`; (5) a value with no state is adopted (owed `adopted`); a value whose (dev, ino)/mtime fail the write record of a non-adopted state is adopted as today; (6) auxiliary files: staged pending values discarded, handed-out ones re-read (unusable: slot empty, owe `aux-unusable`), the previous file re-read; value files with no state accepted as unverifiable (owe `unverifiable-files`, after `adopted`); (7) on a recorded both box only, the fleet file and the generation file made to agree; on a DERIVED both box with no fleet file and no fleet-marking `agent.env`, the role-unrecorded warning; then `box-token.json` written.

- [ ] **Step 1: Write the failing test**

Create `server/test/token-boot.test.ts`:

```ts
// The box token at boot (server/src/token/boot.ts, spec 4.2, 4.2.1, 4.10; D-4388):
// the mint, the hand-made refusals kept exactly, recovery for server-written
// files only, a retired value never coming back, the auxiliary files, and the
// both-role boot write on a RECORDED both box only. Fixture homes only; every
// value here is random per run and is searched for in everything boot printed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootBoxToken, type BootInput, type BootResult } from '../src/token/boot.js';
import {
  appendRetired, mintGenerationId, mintValue, readState, renameOverAtomic, tokenPaths, valueDigestHex,
  writeState, writeValueFileAtomic,
} from '../src/token/files.js';
import { confirmedGeneration, handedOutState, promotedState, stagedState, type BoxTokenState } from '../src/token/policy.js';
import { checkMailToken, MailTokenFileUnusable, MailTokenPlaceholderUnedited, PLACEHOLDER_TOKEN } from '../src/coord/token.js';
import { FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, TOKEN_VALUE_RE } from '../../shared/box-token.js';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { loopbackCurlFront } from './containedTools.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

afterEach(() => { vi.restoreAllMocks(); });

const mkHome = (): string => {
  const home = mkTmp('ccrc-token-boot-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true, mode: 0o700 });
  return home;
};
const P = (home: string) => tokenPaths(path.join(home, '.ccrc', 'mail.token'), home);
const input = (home: string, over: Partial<BootInput> = {}): BootInput => ({
  mailTokenPath: P(home).current, home, role: 'server', roleSource: 'recorded', fleetMode: 'remote', now: Date.now(), ...over,
});

/** Everything boot could print, captured: console and both std streams, plus its own warnings. */
async function boot(home: string, over: Partial<BootInput> = {}): Promise<BootResult & { printed: string }> {
  const out: string[] = [];
  for (const m of ['warn', 'log', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a) => { out.push(a.join(' ')); });
  const w1 = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
  const w2 = vi.spyOn(process.stderr, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
  try {
    const r = await bootBoxToken(input(home, over));
    return { ...r, printed: [...out, ...r.warnings].join('\n') };
  } finally { w1.mockRestore(); w2.mockRestore(); }
}
const neverPrinted = (printed: string, ...values: string[]): void => {
  for (const v of values) {
    expect(printed.includes(v), 'a value was printed').toBe(false);
    expect(printed.includes(valueDigestHex(v)), 'a value digest was printed').toBe(false);
  }
};

/** One rotation done with the adapter and the policy, exactly as the driver orders it (spec §5). */
async function rotateOnce(home: string, r: BootResult): Promise<{ old: string; next: string; id: string; state: BoxTokenState }> {
  const paths = P(home);
  const old = r.holder.currentValue() as string;
  const id = mintGenerationId();
  const next = mintValue();
  const now = Date.now();
  let s = stagedState(r.state as BoxTokenState, id, now, await writeValueFileAtomic(paths.pending(id), `${next}\n`));
  s = handedOutState(s, id, now);
  const prevW = await writeValueFileAtomic(paths.previous, `${old}\n`);
  await renameOverAtomic(paths.pending(id), paths.current);
  s = promotedState(s, id, now, prevW);
  await writeState(paths.state, s);
  return { old, next, id, state: s };
}
/** Truncate in place and set the mtime back before the record: what a lost data flush leaves. */
const tornWrite = (p: string): void => {
  const before = statSync(p).mtime;
  truncateSync(p, 0);
  utimesSync(p, before, new Date(before.getTime() - 1000));
};

describe('mint, adopt and the hand-made refusals (spec 4.2)', () => {
  it('absent with no history: 64 hex minted at 0600, origin minted, nothing owed, warned once', async () => {
    const home = mkHome();
    const r = await boot(home);
    const v = readFileSync(P(home).current, 'utf8');
    expect(v).toMatch(/^[0-9a-f]{64}\n$/);
    expect(v.trim()).toMatch(TOKEN_VALUE_RE);
    expect(statSync(P(home).current).mode & 0o777).toBe(0o600);
    expect(checkMailToken(r.holder, v.trim())).toBe('ok');
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: false });
    // A minted value carries a generation id (plan assembly): the fleet's absent generation then reads behind.
    expect(r.state?.current.id).toMatch(GENERATION_ID_RE);
    expect(r.warnings).toEqual([`ccrc-server: box token: minted a new value at ${P(home).current} (no token existed)`]);
    expect((await readState(P(home).state)).kind).toBe('state');
    neverPrinted(r.printed, v.trim());
  });

  it('a present, usable value with no state is adopted, and the first rotation is owed', async () => {
    const home = mkHome();
    const v = mintValue();
    writeFileSync(P(home).current, `# hand-made\n${v}\n`, { mode: 0o600 });
    const r = await boot(home);
    expect(r.state).toMatchObject({ origin: 'adopted', rotationOwed: true, owedWhy: 'adopted' });
    expect(checkMailToken(r.holder, v)).toBe('ok');
    const rec = await readState(P(home).state);
    expect(rec.kind === 'state' && rec.state.rotationOwed).toBe(true);
    expect(r.warnings.join('\n')).toContain('adopted the hand-made value');
    neverPrinted(r.printed, v);
  });

  it.each([
    ['0 bytes', '', MailTokenFileUnusable], ['comments only', '# x\n', MailTokenFileUnusable],
    ['the placeholder', `${PLACEHOLDER_TOKEN}\n`, MailTokenPlaceholderUnedited],
  ])('a hand-made file that is %s still refuses boot exactly as today', async (_n, content, cls) => {
    const home = mkHome();
    writeFileSync(P(home).current, content);
    await expect(bootBoxToken(input(home))).rejects.toBeInstanceOf(cls);
  });

  it.skipIf(isRoot)('a read error still refuses boot (EACCES)', async () => {
    const home = mkHome();
    writeFileSync(P(home).current, `${mintValue()}\n`);
    chmodSync(P(home).current, 0o000);
    await expect(bootBoxToken(input(home))).rejects.toMatchObject({ code: 'EACCES' });
  });

  it.skipIf(isRoot)('a failed mint boots with no current value: every lane answers unconfigured, and the mint is retried', async () => {
    const home = mkHome();
    chmodSync(path.join(home, '.ccrc'), 0o500);
    try {
      const r = await boot(home);
      expect(r.mintFailed).toBe(true);
      expect(r.holder.hasCurrent()).toBe(false);
      expect(checkMailToken(r.holder, 'f'.repeat(64))).toBe('unconfigured');
      expect(r.warnings.join('\n')).toMatch(/could not mint at .*\(EACCES\).*the driver retries each minute/);
    } finally { chmodSync(path.join(home, '.ccrc'), 0o700); }
  });
});

describe('boot recovery, server files only (spec 4.2.1)', () => {
  it('a torn mail.token the server wrote is recovered from mail-previous.token, warned, and a rotation owed', async () => {
    const home = mkHome();
    const first = await boot(home);
    const { old, next } = await rotateOnce(home, first);
    tornWrite(P(home).current);
    const r = await boot(home);
    expect(checkMailToken(r.holder, old)).toBe('ok');                 // the previous value, now current
    expect(r.state).toMatchObject({ rotationOwed: true, owedWhy: 'recovered', previous: null });
    expect(r.state?.lastBootRecovery?.source).toBe('previous');
    expect(existsSync(P(home).previous)).toBe(false);
    expect(r.warnings.join('\n')).toContain(`${P(home).current} carries no usable value, but this server wrote it (generation #2); `
      + `recovered from ${P(home).previous}, also written by this server.`);
    neverPrinted(r.printed, old, next);
  });

  it('a recorded promotion finishes at boot with no 401: the pending value becomes current, the old one previous', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    const paths = P(home);
    const old = r0.holder.currentValue() as string;
    const id = mintGenerationId();
    const next = mintValue();
    let s = stagedState(r0.state as BoxTokenState, id, Date.now(), await writeValueFileAtomic(paths.pending(id), `${next}\n`));
    s = { ...handedOutState(s, id, Date.now()), promoting: { id } };   // step (a) recorded, then the process died
    await writeState(paths.state, s);
    const r = await boot(home);
    expect(checkMailToken(r.holder, next)).toBe('ok');
    expect(checkMailToken(r.holder, old)).toBe('ok');                  // previous, in grace
    expect(r.state).toMatchObject({ origin: 'rotated', promoting: null, current: { id } });
    expect(existsSync(paths.pending(id))).toBe(false);
  });

  it('a promotion that died after its rename (step c) is finished from the record', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    const paths = P(home);
    const old = r0.holder.currentValue() as string;
    const id = mintGenerationId();
    const next = mintValue();
    let s = stagedState(r0.state as BoxTokenState, id, Date.now(), await writeValueFileAtomic(paths.pending(id), `${next}\n`));
    s = { ...handedOutState(s, id, Date.now()), promoting: { id } };
    await writeState(paths.state, s);
    await writeValueFileAtomic(paths.previous, `${old}\n`);
    await renameOverAtomic(paths.pending(id), paths.current);
    const r = await boot(home);
    expect(checkMailToken(r.holder, next)).toBe('ok');
    expect(checkMailToken(r.holder, old)).toBe('ok');
    expect(r.state?.current.id).toBe(id);
  });

  it.each<[string, (home: string, rot: Awaited<ReturnType<typeof rotateOnce>>) => Promise<void> | void]>([
    ['origin adopted', async (home, rot) => { await writeState(P(home).state, { ...rot.state, origin: 'adopted' }); }],
    ['no state file', (home) => { rmSync(P(home).state); }],
    ['mail.token replaced with a new inode', (home) => { rmSync(P(home).current); writeFileSync(P(home).current, ''); }],
    ['an in-place edit with a later mtime', (home) => {
      const p = P(home).current; truncateSync(p, 0); const t = new Date(Date.now() + 60_000); utimesSync(p, t, t);
    }],
    ['a previous file holding a retired value', async (home, rot) => { await appendRetired(P(home).retired, valueDigestHex(rot.old), 1); }],
    ['a handed-out pending file as the only sibling', async (home, rot) => {
      const paths = P(home);
      const id = mintGenerationId();
      const s = handedOutState(stagedState({ ...rot.state, previous: null }, id, Date.now(),
        await writeValueFileAtomic(paths.pending(id), `${mintValue()}\n`)), id, Date.now());
      rmSync(paths.previous);
      await writeState(paths.state, s);
    }],
  ])('refuses as today (MailTokenFileUnusable): %s', async (_n, spoil) => {
    const home = mkHome();
    const rot = await rotateOnce(home, await boot(home));
    tornWrite(P(home).current);
    await spoil(home, rot);
    await expect(bootBoxToken(input(home))).rejects.toBeInstanceOf(MailTokenFileUnusable);
  });

  it('mail.token absent on a box with history is recovered, not minted', async () => {
    const home = mkHome();
    const { old } = await rotateOnce(home, await boot(home));
    rmSync(P(home).current);
    const r = await boot(home);
    expect(r.holder.currentValue()).toBe(old);
    expect(r.state).toMatchObject({ rotationOwed: true, owedWhy: 'recovered' });
  });

  it('mail.token absent with history and no qualifying sibling: minted, and a rotation owed', async () => {
    const home = mkHome();
    const { old, next } = await rotateOnce(home, await boot(home));
    rmSync(P(home).current);
    rmSync(P(home).previous);
    const r = await boot(home);
    expect([old, next]).not.toContain(r.holder.currentValue());
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'recovered' });
  });
});

describe('a retired value never returns (spec 4.2 step 3)', () => {
  it('written back after its retirement, it is never adopted: a fresh value is minted, the old one answers bad and is counted', async () => {
    const home = mkHome();
    const paths = P(home);
    const { old, state } = await rotateOnce(home, await boot(home));
    await appendRetired(paths.retired, valueDigestHex(old), Date.now());     // retirement
    rmSync(paths.previous);
    await writeState(paths.state, { ...state, previous: null });
    rmSync(paths.current);
    writeFileSync(paths.current, `# shipped by an older deploy.sh\n${old}\n`, { mode: 0o600 });   // the write-back
    const r = await boot(home);
    expect(r.holder.currentValue()).not.toBe(old);
    expect(r.holder.currentValue()).toMatch(TOKEN_VALUE_RE);
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
    expect(checkMailToken(r.holder, old, 'POST /api/mail')).toBe('bad');
    expect(r.holder.counters().retiredByLane).toEqual({ 'POST /api/mail': 1 });
    expect(r.warnings.join('\n')).toContain('held a retired value; it was not adopted, a fresh value was minted and a rotation is owed');
    neverPrinted(r.printed, old, r.holder.currentValue() as string);
  });
});

describe('auxiliary files', () => {
  it('value files with no state file are accepted as unverifiable and a rotation is owed', async () => {
    const home = mkHome();
    const paths = P(home);
    const [cur, pend, prev] = [mintValue(), mintValue(), mintValue()];
    const id = mintGenerationId();
    writeFileSync(paths.current, `${cur}\n`);
    writeFileSync(paths.pending(id), `${pend}\n`);
    writeFileSync(paths.previous, `${prev}\n`);
    const r = await boot(home);
    for (const v of [cur, pend, prev]) expect(checkMailToken(r.holder, v)).toBe('ok');
    expect(r.state).toMatchObject({ origin: 'adopted', rotationOwed: true, owedWhy: 'adopted' });
    expect(r.state?.pending.map((p) => p.id)).toEqual([id]);
    expect(r.warnings.join('\n')).toContain('stay accepted as unverifiable');
  });

  it('an unusable handed-out pending file empties its slot and owes a rotation; a staged one is discarded', async () => {
    const home = mkHome();
    const paths = P(home);
    const r0 = await boot(home);
    const [a, b] = [mintGenerationId(), mintGenerationId()];
    let s = stagedState(r0.state as BoxTokenState, a, Date.now(), await writeValueFileAtomic(paths.pending(a), `${mintValue()}\n`));
    s = handedOutState(s, a, Date.now());
    s = stagedState(s, b, Date.now(), await writeValueFileAtomic(paths.pending(b), `${mintValue()}\n`));
    await writeState(paths.state, s);
    truncateSync(paths.pending(a), 0);
    const r = await boot(home);
    expect(r.state?.pending).toEqual([]);
    expect(r.state).toMatchObject({ rotationOwed: true, owedWhy: 'aux-unusable' });
    expect(existsSync(paths.pending(b))).toBe(false);
  });

  // Review Focus 1, its restart sub-case (plan assembly): the server restarts between the claim's 200 (the hand-out
  // was persisted first, D-4394) and the promotion. The handed-out value stays accepted with its own deadline, a
  // staged sibling is discarded, and a later generation read naming it confirms it.
  it('a restart after the hand-out keeps the handed-out value accepted, its deadline unchanged, and confirms it by a later generation read', async () => {
    const home = mkHome();
    const paths = P(home);
    const r0 = await boot(home);
    const [a, b] = [mintGenerationId(), mintGenerationId()];
    const va = mintValue();
    const at = Date.now() - 1000;
    let s = stagedState(r0.state as BoxTokenState, a, at, await writeValueFileAtomic(paths.pending(a), `${va}\n`));
    s = handedOutState(s, a, at);
    s = stagedState(s, b, at, await writeValueFileAtomic(paths.pending(b), `${mintValue()}\n`));
    await writeState(paths.state, s);
    const confirmBy = s.pending.find((p) => p.id === a)?.confirmBy;
    const r = await boot(home);
    expect(checkMailToken(r.holder, va)).toBe('ok');
    expect(checkMailToken(r.holder, r0.holder.currentValue() as string)).toBe('ok');   // the current value is unchanged
    expect(r.state?.pending.map((p) => [p.id, p.handedOutAt, p.confirmBy])).toEqual([[a, at, confirmBy]]);
    expect(existsSync(paths.pending(b))).toBe(false);
    expect(confirmedGeneration(r.state as BoxTokenState, { read: { kind: 'id', id: a }, measuredAt: at + 1 })).toBe(a);
    neverPrinted(r.printed, va);
  });
});

describe('the both-role boot write: recorded role only (spec 4.10)', () => {
  const both = { role: 'both', fleetMode: 'local' } as const;

  it('no CCRC_ROLE (derived both) and a planted fleet file: the file is byte-identical after boot', async () => {
    const home = mkHome();
    mkdirSync(path.join(home, '.cc-secrets'), { mode: 0o700 });
    const planted = `# the live fleet copy\n${mintValue()}\n`;
    writeFileSync(P(home).fleetFile, planted, { mode: 0o600 });
    const r = await boot(home, { ...both, roleSource: 'derived-absent' });
    expect(r.bothWriterArmed).toBe(false);
    expect(readFileSync(P(home).fleetFile, 'utf8')).toBe(planted);
    expect(existsSync(P(home).generation)).toBe(false);
  });

  it('a recorded both box whose agent.env carries CCRC_AGENT_TOKEN (a fleet box): the planted file is untouched', async () => {
    const home = mkHome();
    writeFileSync(P(home).agentEnv, `CCRC_SERVER_URL=ws://127.0.0.1:1\n${['CCRC', 'AGENT', 'TOKEN'].join('_')}=${mintValue()}\n`, { mode: 0o600 });
    mkdirSync(path.join(home, '.cc-secrets'), { mode: 0o700 });
    const planted = `${mintValue()}\n`;
    writeFileSync(P(home).fleetFile, planted, { mode: 0o600 });
    const r = await boot(home, { ...both, roleSource: 'recorded' });
    expect(r.bothWriterArmed).toBe(false);
    expect(readFileSync(P(home).fleetFile, 'utf8')).toBe(planted);
  });

  it('derived both with no fleet file warns once, naming the fleet path and the unrecorded role', async () => {
    const home = mkHome();
    const r = await boot(home, { ...both, roleSource: 'derived-absent' });
    expect(existsSync(P(home).fleetFile)).toBe(false);
    expect(r.warnings).toContain(`ccrc-server: box token: this box's role is not recorded as both, so the server will not write `
      + `${P(home).fleetFile}; with no file there, notify.sh is refused (record CCRC_ROLE=both in ~/.ccrc/ccrc.env)`);
  });

  it("recorded both with the README's agent.env (CCRC_SERVER_URL only) is armed, and gets its fleet file and generation file", async () => {
    // D-4399 (plan assembly): the README's single-box block writes this file for ccrc-api.
    const home = mkHome();
    writeFileSync(P(home).agentEnv, 'CCRC_SERVER_URL=http://127.0.0.1:7788\n', { mode: 0o600 });
    const r = await boot(home, { ...both, roleSource: 'recorded' });
    expect([r.bothWriterArmed, r.agentEnvMarksFleet]).toEqual([true, false]);
    expect(readFileSync(P(home).fleetFile, 'utf8')).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${r.holder.currentValue()}\n`);
    expect(readFileSync(P(home).generation, 'utf8')).toBe(`${r.state?.current.id}\n`);
  });

  it('a recorded both box with no fleet file gets one at boot: 0600, the fixed comment line, the current value', async () => {
    const home = mkHome();
    const r = await boot(home, { ...both, roleSource: 'recorded' });
    expect(r.bothWriterArmed).toBe(true);
    expect(readFileSync(P(home).fleetFile, 'utf8')).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${r.holder.currentValue()}\n`);
    expect(statSync(P(home).fleetFile).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(P(home).fleetFile)).mode & 0o777).toBe(0o700);
  });

  // Mixed versions (spec 10.1 "Notify tolerance removed"): the real notify.sh, through the loopback curl front, to
  // a server built with the boot's holder. A recorded both box is accepted; a derived one (no file) is refused.
  const tool = (n: string): string => spawnSync('bash', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
  it.each([
    ['recorded both: notify.sh is accepted', 'recorded', true],
    ['derived both: no fleet file, so notify.sh is refused', 'derived-absent', false],
  ] as const)('%s', async (_n, roleSource, accepted) => {
    const home = mkHome();
    const r = await boot(home, { ...both, roleSource });
    const bus = new Bus();
    const seen: string[] = [];
    bus.on('notice', (n) => seen.push(n.message));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = await buildServer({ ...testDeps(home), mailToken: r.holder }, bus);
    await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const port = (app.server.address() as AddressInfo).port;
      const bin = path.join(home, 'stub-bin');
      mkdirSync(bin);
      writeFileSync(path.join(bin, 'curl'), loopbackCurlFront(tool('curl')), { mode: 0o755 });
      writeFileSync(path.join(home, 'curl-allow-ports'), `${port}\n`);
      for (const t of ['jq', 'grep', 'tail', 'cut', 'tr', 'head', 'cat']) symlinkSync(tool(t), path.join(bin, t));
      const env: NodeJS.ProcessEnv = { HOME: home, PATH: bin, CCRC_ADDR: `http://127.0.0.1:${port}` };
      const code = await new Promise<number>((resolve) => {
        const child = spawn(tool('bash'), [path.join(repoRoot, 'deploy', 'notify.sh'), 'cc swap: x moved a -> b'], { env, stdio: 'ignore' });
        child.on('close', (c) => resolve(c ?? -1));
      });
      expect(code).toBe(0);
      expect(existsSync(path.join(home, 'curl-poison'))).toBe(false);
      expect(seen).toEqual(accepted ? ['cc swap: x moved a -> b'] : []);
      if (!accepted) expect(warn.mock.calls.flat().join(' ')).toMatch(/notify/);
    } finally { await app.close(); }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
mkdir -p .tmp-a7 && (cd server && TMPDIR="$PWD/../.tmp-a7" ./node_modules/.bin/vitest run test/token-boot.test.ts)
```

Expected:

```text
Error: Cannot find module '../src/token/boot.js' imported from …/server/test/token-boot.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/token/boot.ts`:

```ts
// The box token at boot, ring L3 (spec 4.2, 4.2.1 and 4.10; D-4388): an L3
// composition helper that `index.ts` (L5) calls once and whose warnings it
// prints. Order: finish a recorded promotion; read mail.token; recover a proved
// server-written file; refuse a retired value; mint if absent with no history,
// recover if absent with history; adopt a hand-made value; read the auxiliary
// files; then, on a recorded both box only, make the fleet file agree.
//
// Never prints a value, a code or a digest: every warning carries paths,
// display sequence numbers and words only.
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { NodeRole } from '../../../shared/api.js';
import type { FleetMode, RoleSource } from '../config.js';
import { BoxTokenHolder, readMailToken, type HolderSlots } from '../coord/token.js';
import {
  fileExists, mintGenerationId, mintValue, readAgentEnvMarksFleet, readRetired, readState, readValueFile, renameOverAtomic,
  tokenPaths, valueDigestHex, writeFleetTokenFile, writeGenerationFile, writeState, writeValueFileAtomic,
  type TokenPaths, type ValueRead,
} from './files.js';
import {
  CONFIRM_DEADLINE_MS, GRACE_HARD_MS, GRACE_MS, adoptedState, bothRoleWriterArmed, mintedState, owe, promotedState,
  provedWrite, recoveryPlan, type BoxTokenState, type FileMetaLike, type WriteRecord,
} from './policy.js';
import { GENERATION_ID_RE, type OwedReason } from '../../../shared/box-token.js';

export interface BootInput { mailTokenPath: string; home: string; role: NodeRole; roleSource: RoleSource; fleetMode: FleetMode; now: number }
/** `agentEnvMarksFleet` is an addition to the contract's shape: the driver's gate needs the answer boot used. */
export interface BootResult {
  holder: BoxTokenHolder; state: BoxTokenState | null; mintFailed: boolean;
  bothWriterArmed: boolean; agentEnvMarksFleet: boolean; warnings: string[];
}

const W = (line: string): string => `ccrc-server: box token: ${line}`;
const errno = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? 'EIO';
const PENDING_FILE_RE = /^mail-pending-([0-9a-f]{16})\.token$/;

function likeOf(r: ValueRead | null): FileMetaLike | null {
  if (r === null) return null;
  if (r.kind === 'value') return { meta: r.meta, usable: true, placeholder: false, digest: valueDigestHex(r.value) };
  if (r.kind === 'unusable') return { meta: r.meta, usable: false, placeholder: false, digest: null };
  return { meta: null, usable: false, placeholder: r.kind === 'placeholder', digest: null };   // absent: meta null
}
const recOf = (r: ValueRead): WriteRecord | null =>
  r.kind === 'value' ? { dev: r.meta.dev, ino: r.meta.ino, writtenAtMs: Math.ceil(r.meta.mtimeMs) } : null;

/** The refusal for a hand-made mail.token is `readMailToken`'s own throw (its classes and words), so boot
 *  refuses exactly as today. A file that changed between the two reads still refuses. */
function refuseAsToday(p: string, detail: string): never {
  readMailToken(p);
  throw new Error(`${p}: ${detail}`);
}

interface Ctx { state: BoxTokenState | null; current: string | null; mintFailed: boolean; warnings: string[] }

export async function bootBoxToken(i: BootInput): Promise<BootResult> {
  const paths = tokenPaths(i.mailTokenPath, i.home);
  const now = i.now;
  const holder = new BoxTokenHolder();
  const ctx: Ctx = { state: null, current: null, mintFailed: false, warnings: [] };
  const warn = (line: string): void => { ctx.warnings.push(W(line)); };

  const retiredRead = await readRetired(paths.retired);
  if (retiredRead.kind === 'unusable') warn(`${paths.retired} is unusable; a written-back retired value cannot be recognised until it is repaired`);
  const retired = retiredRead.kind === 'retired' ? retiredRead.digests : [];
  holder.setRetired(retired);
  const isRetired = (v: string): boolean => retired.includes(valueDigestHex(v));

  const agentEnvMarksFleet = await readAgentEnvMarksFleet(paths.agentEnv);   // D-4399
  const armed = bothRoleWriterArmed({ role: i.role, roleSource: i.roleSource, fleetMode: i.fleetMode, agentEnvMarksFleet });

  const sr = await readState(paths.state);
  ctx.state = sr.kind === 'state' ? sr.state : null;
  if (sr.kind === 'unusable') warn(`${paths.state} is unusable; value files beside it are treated as unverifiable`);

  // 1. Finish a recorded promotion before anything reads mail.token (spec 4.2 step 1, §5).
  if (ctx.state?.promoting) ctx.state = await finishPromotion(ctx.state, paths, now, isRetired, warn);

  const mint = async (owed: OwedReason | null, line: string | null): Promise<void> => {
    const v = mintValue();
    try {
      const rec = await writeValueFileAtomic(paths.current, `${v}\n`);
      ctx.state = mintedState(now, rec, ctx.state, owed, mintGenerationId());
      ctx.current = v;
      if (line !== null) warn(line);
    } catch (e) {
      ctx.mintFailed = true;
      if (ctx.state !== null) ctx.state = { ...ctx.state, mintFailedAt: now };
      warn(`could not mint at ${paths.current} (${errno(e)}); every box-token lane answers 401 until a mint succeeds — the driver retries each minute`);
    }
  };
  const adopt = (value: string): void => {
    ctx.state = adoptedState(now, ctx.state);
    ctx.current = value;
    warn(`adopted the hand-made value at ${paths.current}; the first rotation is owed`);
  };
  const recover = async (s: BoxTokenState, value: string, already: WriteRecord | null): Promise<void> => {
    ctx.state = await recoverFromPrevious(s, value, paths, now, already, warn);
    ctx.current = value;
  };

  // 2.-6. mail.token and its arms.
  const cur = await readValueFile(paths.current);
  const s0 = ctx.state;
  if (cur.kind === 'unreadable' || cur.kind === 'placeholder') refuseAsToday(paths.current, cur.kind);
  if (cur.kind === 'unusable') {
    const prevRead = s0?.previous ? await readValueFile(paths.previous) : null;
    const plan = recoveryPlan({ state: s0, current: likeOf(cur) as FileMetaLike, pending: null, previous: likeOf(prevRead), retired });
    if (plan.kind !== 'from-previous' || prevRead?.kind !== 'value' || s0 === null) {
      refuseAsToday(paths.current, 'no usable value, and no proved server-written sibling');
    }
    await recover(s0, prevRead.value, null);
  } else if (cur.kind === 'absent') {
    if (s0 === null) {
      await mint(null, `minted a new value at ${paths.current} (no token existed)`);
    } else {
      const prevRead = s0.previous ? await readValueFile(paths.previous) : null;
      const plan = recoveryPlan({ state: s0, current: likeOf(cur) as FileMetaLike, pending: null, previous: likeOf(prevRead), retired });
      if (plan.kind === 'from-previous' && prevRead?.kind === 'value') await recover(s0, prevRead.value, null);
      else await mint('recovered', `${paths.current} is missing on a box with history and no sibling qualifies; minted a new value and a rotation is owed`);
    }
  } else if (isRetired(cur.value)) {
    await mint('retired-written-back', `${paths.current} held a retired value; it was not adopted, a fresh value was minted and a rotation is owed`);
  } else if (s0 === null) {
    adopt(cur.value);
  } else if (s0.recovering !== null && s0.previous !== null) {
    // A recovery that stopped after its write and before its record: mail.token already holds the sibling.
    const prevRead = await readValueFile(paths.previous);
    if (prevRead.kind === 'value' && prevRead.value === cur.value) await recover(s0, cur.value, recOf(cur));
    else adopt(cur.value);
  } else if (s0.origin !== 'adopted' && !provedWrite(likeOf(cur) as FileMetaLike, s0.current.write)) {
    adopt(cur.value);   // something other than the driver changed mail.token: adopted as today (spec 4.2)
  } else {
    ctx.current = cur.value;
  }

  // Auxiliary files: pending and previous through the same measured reads.
  const slots: HolderSlots = { current: ctx.current, pending: [], previous: null };
  let st = ctx.state as BoxTokenState | null;
  if (st !== null && sr.kind === 'state') {
    const keep: BoxTokenState['pending'] = [];
    const pend: { id: string; value: string }[] = [];
    for (const p of st.pending) {
      if (p.handedOutAt === null) { await fsp.rm(paths.pending(p.id), { force: true }); continue; }   // staged: discarded
      const r = await readValueFile(paths.pending(p.id));
      if (r.kind === 'value' && !isRetired(r.value)) { keep.push(p); pend.push({ id: p.id, value: r.value }); continue; }
      warn(`${paths.pending(p.id)} (generation #${p.seq}) carries no usable value; its slot is empty and a rotation is owed`);
      st = owe(st, 'aux-unusable');
    }
    st = { ...st, pending: keep };
    slots.pending = pend;
    if (st.previous !== null) {
      const r = await readValueFile(paths.previous);
      if (r.kind === 'value' && !isRetired(r.value)) slots.previous = { value: r.value, until: st.previous.hardUntil };
      else {
        warn(`${paths.previous} carries no usable value; its slot is empty and a rotation is owed`);
        st = owe({ ...st, previous: null }, 'aux-unusable');
      }
    }
  } else if (st !== null) {
    // Value files with no state file: accepted as unverifiable; a forward rotation's confirmation discards them.
    const found = await unverifiable(paths, now, isRetired);
    if (found.pending.length > 0 || found.previous !== null) {
      st = owe({ ...st, pending: found.pending.map((f) => f.gen), previous: found.previous?.prev ?? null }, 'unverifiable-files');
      slots.pending = found.pending.map((f) => ({ id: f.gen.id, value: f.value }));
      slots.previous = found.previous ? { value: found.previous.value, until: found.previous.prev.hardUntil } : null;
      warn(`value files beside ${paths.current} have no state record; they stay accepted as unverifiable and a rotation is owed`);
    }
  }
  holder.setSlots(slots);

  // 7. The both-role boot write (spec 4.10), recorded role only.
  if (armed && ctx.current !== null && st !== null) {
    try {
      const f = await readValueFile(paths.fleetFile);
      if (f.kind !== 'value' || f.value !== ctx.current) await writeFleetTokenFile(paths.fleetFile, ctx.current);
      if (st.current.id !== null) await writeGenerationFile(paths.generation, st.current.id);
      st = { ...st, fleetConfirmed: st.current.id };
    } catch (e) {
      warn(`could not write ${paths.fleetFile} (${errno(e)}); this box's notify.sh is refused until it is written`);
    }
  } else if (i.role === 'both' && i.roleSource !== 'recorded' && i.fleetMode === 'local' && !agentEnvMarksFleet
    && !(await fileExists(paths.fleetFile))) {
    warn(`this box's role is not recorded as both, so the server will not write ${paths.fleetFile}; with no file there, notify.sh is refused (record CCRC_ROLE=both in ~/.ccrc/ccrc.env)`);
  }

  if (st !== null) {
    try { await writeState(paths.state, st); } catch (e) {
      warn(`could not record ${paths.state} (${errno(e)}); the driver records it on its next tick`);
    }
  }
  return { holder, state: st, mintFailed: ctx.mintFailed, bothWriterArmed: armed, agentEnvMarksFleet, warnings: ctx.warnings };
}

/** Spec 4.2.1's act: (a) record recovering, (b) write the sibling's value into mail.token, (c) record it as
 *  current, owe a rotation, record the recovery, then delete mail-previous.token so its slot empties. */
async function recoverFromPrevious(state: BoxTokenState, value: string, paths: TokenPaths, now: number,
  already: WriteRecord | null, warn: (l: string) => void): Promise<BoxTokenState> {
  const prev = state.previous;
  if (prev === null) throw new Error('recoverFromPrevious: no previous recorded');
  const brokenSeq = state.current.seq;
  let s: BoxTokenState = { ...state, recovering: { source: 'previous' } };
  if (already === null) await writeState(paths.state, s);                       // (a)
  const rec = already ?? await writeValueFileAtomic(paths.current, `${value}\n`); // (b)
  s = owe({ ...s, rotationOwed: false, owedWhy: null }, 'recovered');           // (c)
  s = { ...s, current: { id: prev.id, seq: prev.seq, since: now, write: rec }, previous: null, recovering: null,
    lastBootRecovery: { at: now, source: 'previous' }, fleetConfirmed: null };
  await writeState(paths.state, s);
  await fsp.rm(paths.previous, { force: true });
  warn(`${paths.current} carries no usable value, but this server wrote it (generation #${brokenSeq}); recovered from `
    + `${paths.previous}, also written by this server. A forward rotation is owed now; the fleet box's calls may answer 401 until it confirms one.`);
  return s;
}

/** Spec §5 steps (b)-(d) from the record of (a). The pending file is proved server-written and not retired; a
 *  rename already done (pending gone, mail.token carrying its inode) needs only (d). Anything else abandons the
 *  promotion and owes a rotation (the fleet's confirmed value is lost, which only disk corruption produces). */
async function finishPromotion(state: BoxTokenState, paths: TokenPaths, now: number,
  isRetired: (v: string) => boolean, warn: (l: string) => void): Promise<BoxTokenState> {
  const id = state.promoting?.id ?? '';
  const g = state.pending.find((p) => p.id === id);
  if (g === undefined || !GENERATION_ID_RE.test(id)) {
    warn('a recorded promotion names no pending generation; it was abandoned and a rotation is owed');
    return owe({ ...state, promoting: null }, 'recovered');
  }
  const P = await readValueFile(paths.pending(id));
  const M = await readValueFile(paths.current);
  const prevFile = async (): Promise<WriteRecord | null> => recOf(await readValueFile(paths.previous));
  const like = (r: ValueRead): FileMetaLike => likeOf(r) as FileMetaLike;
  if (P.kind === 'value' && provedWrite(like(P), g.write) && !isRetired(P.value)) {
    const oldStill = M.kind === 'value' && (state.current.write === null || provedWrite(like(M), state.current.write));
    const prevWrite = oldStill && M.kind === 'value'
      ? await writeValueFileAtomic(paths.previous, `${M.value}\n`)   // (b), safe to run again
      : await prevFile();
    await renameOverAtomic(paths.pending(id), paths.current);         // (c)
    return promotedState(state, id, now, prevWrite);                  // (d)
  }
  if (P.kind === 'absent' && M.kind === 'value' && M.meta.dev === g.write.dev && M.meta.ino === g.write.ino) {
    return promotedState(state, id, now, await prevFile());           // (c) was already done
  }
  warn(`the recorded promotion of generation #${g.seq} could not be finished from ${paths.pending(id)}; it was abandoned and a rotation is owed`);
  return owe({ ...state, promoting: null }, 'recovered');
}

/** Pending and previous files found with no state file (a plain uninstall of an earlier build, or lost state).
 *  Each is accepted as handed out, so the forward rotation's confirmation discards it. */
async function unverifiable(paths: TokenPaths, now: number, isRetired: (v: string) => boolean): Promise<{
  pending: { gen: BoxTokenState['pending'][number]; value: string }[];
  previous: { prev: NonNullable<BoxTokenState['previous']>; value: string } | null;
}> {
  let names: string[] = [];
  try { names = await fsp.readdir(paths.dir); } catch { names = []; }
  const pending: { gen: BoxTokenState['pending'][number]; value: string }[] = [];
  for (const n of names.sort()) {
    const m = PENDING_FILE_RE.exec(n);
    if (m === null || pending.length >= 2) continue;
    const r = await readValueFile(path.join(paths.dir, n));
    const rec = recOf(r);
    if (r.kind !== 'value' || rec === null || isRetired(r.value)) continue;
    pending.push({ gen: { id: m[1], seq: 0, stagedAt: now, handedOutAt: now, confirmBy: now + CONFIRM_DEADLINE_MS, write: rec }, value: r.value });
  }
  const pr = await readValueFile(paths.previous);
  const prec = recOf(pr);
  const previous = pr.kind === 'value' && prec !== null && !isRetired(pr.value)
    ? { prev: { id: null, seq: 0, graceUntil: now + GRACE_MS, hardUntil: now + GRACE_HARD_MS, currentPresented: false, write: prec }, value: pr.value }
    : null;
  return { pending, previous };
}
```

In `server/src/index.ts`, replace the import at line 16

```ts
import { readMailToken } from './coord/token.js';
```

with

```ts
import { bootBoxToken } from './token/boot.js';
```

and replace lines 47-63 (from `// D-57 (Task 11 review): this line said /api/notify AND /api/mail "accept` through the closing `}` of the `if (mailToken === null)` warning) with:

```ts
// The box token (spec 4.2, D-4388): minted, adopted or recovered by `bootBoxToken`,
// which refuses a hand-made unusable or placeholder file exactly as
// `readMailToken` did and never adopts a retired value. Every warning it
// returns is one line with paths and words only. The holder replaces the old
// string: every call site still reads `deps.mailToken ?? null` at request time,
// and the driver below mutates the holder in place.
const tokenBoot = await bootBoxToken({
  mailTokenPath: cfg.mailTokenPath, home: cfg.home, role: cfg.role, roleSource: cfg.roleSource,
  fleetMode: cfg.fleetMode, now: Date.now(),
});
for (const line of tokenBoot.warnings) console.warn(line);
const mailToken = tokenBoot.holder;
```

The two `deps = { … }` literals keep `mailToken,` unchanged (A3 widened `Deps.mailToken` to `string | BoxTokenHolder | null`). The old no-token warning is gone: its one remaining case, a failed mint, is boot's `could not mint at <path> (<errno>)` line (spec 4.9, "rewritten to name the failed mint rather than deploy.sh").

- [ ] **Step 4: Run it to verify it passes**

```bash
mkdir -p .tmp-a7 && (cd server && TMPDIR="$PWD/../.tmp-a7" ./node_modules/.bin/vitest run test/token-boot.test.ts)
```

Expected: `Tests  29 passed (29)` (27 prototyped plus the two cases added at plan assembly, the fleet-box case re-planted in place; two cases skip as root: EACCES and the failed mint).

- [ ] **Step 5: Mutation check.** In `server/src/token/boot.ts`, replace

```ts
    await recover(s0, prevRead.value, null);
  } else if (cur.kind === 'absent') {
```

with

```ts
    refuseAsToday(paths.current, 'mutated');
  } else if (cur.kind === 'absent') {
```

and run `mkdir -p .tmp-a7 && (cd server && TMPDIR="$PWD/../.tmp-a7" ./node_modules/.bin/vitest run test/token-boot.test.ts)` from the repo root. Expected: `× a torn mail.token the server wrote is recovered from mail-previous.token, warned, and a rotation owed` — boot throws `MailTokenFileUnusable`; `1 failed | 26 passed` (measured). Restore the line and re-run: all green.

- [ ] **Step 6: Mutation check.** In `server/src/token/boot.ts`, replace

```ts
  if (armed && ctx.current !== null && st !== null) {
```

with

```ts
  if (i.role === 'both' && ctx.current !== null && st !== null) {
```

and run `mkdir -p .tmp-a7 && (cd server && TMPDIR="$PWD/../.tmp-a7" ./node_modules/.bin/vitest run test/token-boot.test.ts)` from the repo root. Expected: four red — `× no CCRC_ROLE (derived both) and a planted fleet file: the file is byte-identical after boot`, `× a recorded both box whose agent.env carries CCRC_AGENT_TOKEN (a fleet box): the planted file is untouched`, `× derived both with no fleet file warns once…`, `× derived both: no fleet file, so notify.sh is refused` (measured, under the case's earlier title). Restore the line and re-run: all green. Then (plan assembly) replace `const agentEnvMarksFleet = await readAgentEnvMarksFleet(paths.agentEnv);` with `const agentEnvMarksFleet = await fileExists(paths.agentEnv);` and run the file: expected `× recorded both with the README's agent.env … is armed` red. Restore and re-run green.

- [ ] **Step 7: Mutation check.** In `server/src/token/boot.ts`, replace

```ts
  } else if (isRetired(cur.value)) {
```

with

```ts
  } else if (false && isRetired(cur.value)) {
```

and run `mkdir -p .tmp-a7 && (cd server && TMPDIR="$PWD/../.tmp-a7" ./node_modules/.bin/vitest run test/token-boot.test.ts)` from the repo root. Expected: `× written back after its retirement, it is never adopted…` — `1 failed | 26 passed` (measured). Restore the line and re-run: all green.

- [ ] **Step 8: Mutation check.** In `server/src/token/policy.ts`, replace

```ts
    && f.meta.dev === w.dev && f.meta.ino === w.ino && f.meta.mtimeMs <= w.writtenAtMs;
```

with

```ts
    && f.meta.dev === w.dev && f.meta.ino === w.ino;
```

and run `mkdir -p .tmp-a7 && (cd server && TMPDIR="$PWD/../.tmp-a7" ./node_modules/.bin/vitest run test/token-boot.test.ts)` from the repo root. Expected: `× refuses as today (MailTokenFileUnusable): an in-place edit with a later mtime` — `1 failed | 26 passed` (measured). Restore the line and re-run: all green.

- [ ] **Step 9: Pins and the composition root.** Run unchanged, one file per call:
  - `test/update-inventory.test.ts -t 'index.ts composes'` (3 passed, measured), `test/update-routes.test.ts -t 'index.ts hands'` (1 passed), `test/update-converge.test.ts -t 'composition root binds'` (2 passed), `test/config.test.ts -t 'index.ts says it once'` (1 passed): the text pins over `index.ts` do not move (the two `deps = {` literals are untouched).
  - `test/boot.test.ts` spawns the real `index.ts` in local mode under a fixture `CCRC_HOME`, so it now mints a token in that fixture. MEASURED on a box at load ~21: its "a hung ccd … does not delay listen" case answered in 3012 ms and 3049 ms against its 3000 ms bound with A7+A9 applied, and passed with `main`'s `index.ts`; `bootBoxToken` itself measured 25-48 ms in process, so the extra time is the transform and import of the new `token/` modules under `tsx`. `boot.test.ts` is NOT one of CLAUDE.md's known load flakes, so this is a GATE before this task's commit, never a CI deferral:
    1. In one load window, back to back, run `mkdir -p .tmp-a7 && (cd server && TMPDIR="$PWD/../.tmp-a7" ./node_modules/.bin/vitest run test/boot.test.ts -t 'does not delay listen')` three times with `main`'s `index.ts` (stash nothing: check out `server/src/index.ts` from `origin/main` into a scratch copy and swap it in) and three times with A7 applied. Record all six durations and the box load in the commit message body.
    2. If A7's median is under 3000 ms, go on. If not, cut the startup cost first: `import()` `./token/boot.js` (and, in A9, `./token/driver.js`, `./token/files.js`, `./token/link.js`) dynamically, after `app.listen` for the driver (its `deps.tokenDriver` is read at request time, so a claim before it is set answers 404 `no-claim`, which is correct: no rotation exists yet). Re-measure.
    3. Only if it is still over: run the full CI mode on the branch (`gh workflow run ci.yml --ref <branch> -f mode=full`) and read `test (server)` for this file. If it is red there too, write a `D-TBD-<slug>` entry (slug `boot-listen-bound`) with the measured delta and report it, so the coordinator assigns the number, and change the bound in the same commit with its mutation note. Never leave it to a later run.
  - `test/typecheck-tests.test.ts` covers the new test file through `test/tsconfig.tests.json` (`./**/*.ts`); measured clean with `tsc -p` over the four new test files and `src/`.

- [ ] **Step 10: Commit** (afterwards, from the repo root: `rm -rf .tmp-a7`)

```bash
git add server/src/token/boot.ts server/src/index.ts server/test/token-boot.test.ts
git commit -m "feat(token): boot mints, adopts, recovers server-written files, refuses retired values (A7, D-4388)

bootBoxToken runs spec 4.2 in order: a recorded promotion finished first,
hand-made unusable and placeholder files still refuse with readMailToken's
own classes, a torn server-written mail.token recovered from a proved
sibling, a written-back retired value never adopted, a failed mint booting
unconfigured, and the fleet file written only on a recorded both box.
index.ts prints its warnings and passes the holder as mailToken.

boot.test.ts 'does not delay listen' (Step 9): <the six measured durations and the load>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A8: Claim door, rotate route and their census

(prototype) measured: server/test/token-claim-route.test.ts: red (file failed to load, `Cannot find module '../src/token/door.js'`, no tests ran) -> green 23 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/auth-gate.test.ts: red 3 failed (157 passed) with the pins moved and gate.ts unchanged -> green 160 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/box-token-census.test.ts: red 2 failed (27 passed) with the census moved and CLAUDE.md unchanged -> green 29 passed, 2026-10-07 on main 282e79e44
(prototype) measured, unchanged neighbours: coord-pause-route.test.ts 20 passed; single-definition.test.ts 406 passed; topology-clean.test.ts 55 passed; module-format.test.ts 4 passed; run-routes.test.ts 230 passed; coord-caps-route.test.ts 26 passed; auth-routes.test.ts 54 passed; auth-passkey.test.ts 154 passed; `tsc --noEmit` clean for `tsconfig.json` and for `test/tsconfig.tests.json` (server and shared), 2026-10-07 on main 282e79e44
(not prototyped as their own tasks: A1's `shared/box-token.ts` and claim-code words, A5's `mintClaimCode`, A6's `claimVerdict` and door constants. This task ran against stand-ins written to the contract's signatures; it executes after A1, A5 and A6, which Part A's task order already gives.)

**Files:**
- Create: `server/src/token/door.ts` (L3)
- Create: `server/src/token/routes.ts` (L4)
- Modify: `server/src/server.ts` (import after :57; `Deps.tokenDriver` after `mailToken`, :307; `registerTokenRoutes(app, deps)` after `registerUpdateRoutes(...)`, :1659)
- Modify: `server/src/auth/gate.ts` (:8 "86" -> "88"; :67 six -> seven; reason 7 and a NOT-EXEMPT bullet at :161-164; the EXEMPT entry after `GET /api/ledger`'s, :328-329)
- Modify: `CLAUDE.md` (the box-token bullet, one sentence after `route's literal.` at :295, which is after the bullet's "What does need saying here" split)
- Modify (plan assembly, review finding): `README.md` — the auth paragraph's exhaustive "everything except" list (:1183-1196 at 282e79e44, as A4 left it) gains the claim door, which would otherwise make the canonical overview false the moment this task merges (D-4396's reason).
- Test: `server/test/token-claim-route.test.ts` (new)
- Test: `server/test/auth-gate.test.ts` (:95-101, :208, :250, :313, :353, :451, :492, :529, :563, :567, :901, :965)
- Test: `server/test/box-token-census.test.ts` (:73-74, :180, :227, :372, a new describe before :818)

**Interfaces:**
- Consumes: A1 `TOKEN_CLAIM_PATH`, `TOKEN_ROTATE_PATH`, `CLAIM_BODY_LIMIT_BYTES`, `ClaimRefusal`, `BoxTokenView`, `RotateAnswer` (`shared/box-token.ts`), `isClaimCode`, `CLAIM_CODE_TTL_MS` (`shared/agent-protocol.ts`); A3 `matchDigestSlots`; A5 `mintClaimCode` (`server/src/token/files.ts`); A6 `claimVerdict`, `ClaimDoorState`, `ClaimMatch`, `MAX_PENDING`, `BURNED_CODES_KEPT`, `BURNED_CODE_KEEP_MS`, `CLAIM_ALERT_EVERY_MS`, `CLAIM_MISS_BUDGET` (`server/src/token/policy.ts`); `NODE_ID_RE` (`server/src/coord/store.ts:1003`).
- Produces:

```ts
// server/src/token/door.ts
export type ClaimStep =
  | { status: 200; generation: string; value: string }
  | { status: 400 | 403 | 404 | 410 | 429; error: ClaimRefusal; generation: string | null };
export class ClaimDoor {
  constructor(opts: { valueOf: (generation: string) => string | null; warn: (line: string) => void;
    compare?: (a: Buffer, b: Buffer) => boolean });   // `compare`: CONTRACT ADDITION, test-only
  issue(generation: string, nodeId: string, now: number): string;   // re-issue for a generation replaces its code; > MAX_PENDING live throws RangeError
  revoke(generation: string): void;
  claimNow(body: unknown, now: number): ClaimStep;                   // synchronous
  readonly alerts: { expired: string[]; wrongNode: string[]; replays: number };
}
// server/src/token/routes.ts
export interface TokenRouteDriver {
  readonly door: ClaimDoor;
  commitHandOut(generation: string, at: number): Promise<void>;
  rotateNow(now: number): Promise<RotateAnswer>;
  view(): BoxTokenView;
}
export function registerTokenRoutes(app: FastifyInstance, deps: Pick<Deps, 'tokenDriver'>): void;
// server/src/server.ts
//   Deps.tokenDriver?: TokenRouteDriver
// server/test/box-token-census.test.ts
//   CODE_DOORS = ['/api/token/claim'], TOKEN_DOORS = ['/api/token/rotate']
```
- Wire: `POST /api/token/claim` body `{code, nodeId}`; 200 `{ok:true,value,generation}`; refusals `{ok:false,error:<ClaimRefusal>}` at 400 (malformed, a JSON-parse error, an unsupported media type), 403 `wrong-node`, 404 `no-claim` (also: no driver), 410 `code-expired`/`code-used`, 413 `bad-request`, 429 `rate-limited`, 503 `unavailable` (the hand-out could not be recorded, D-4394; or an unexpected handler error); `Cache-Control: no-store` on every answer. `POST /api/token/rotate`: the driver's `RotateAnswer` verbatim at 200 / 409 `held` / 429 `rate-limited` with `Retry-After: <retryAfterS>` / 501 `not-configured` (no driver).

- [ ] **Step 1: Write the failing test**

Create `server/test/token-claim-route.test.ts`:

```ts
// The claim door (box-token lifecycle spec 4.6) and the rotate route, through
// the real Fastify app. The door is reachable from the internet with no source
// matcher and no per-source budget, so each guard here is a property an attacker
// can probe: a jam must not stall a live code, a code works once, inside its TTL,
// for the node it was bound to, and every answer — Fastify's own 400 and 413
// included — carries `Cache-Control: no-store`. Values and codes below are
// fixtures minted in the test; none is a real token.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { ClaimDoor } from '../src/token/door.js';
import type { TokenRouteDriver } from '../src/token/routes.js';
import { BURNED_CODES_KEPT, CLAIM_MISS_BUDGET, MAX_PENDING } from '../src/token/policy.js';
import { CLAIM_BODY_LIMIT_BYTES, TOKEN_CLAIM_PATH, TOKEN_ROTATE_PATH, type BoxTokenView, type RotateAnswer } from '../../shared/box-token.js';
import { CLAIM_CODE_TTL_MS, isClaimCode } from '../../shared/agent-protocol.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const NODE = '0e6a6c2e-3b1f-4c55-9a51-2f0f1c9f7d10';
const OTHER = '9b2d7f7e-1c4a-4e8e-8f00-5d6c7b8a9e01';
const GEN = 'a1b2c3d4e5f60718';
const GEN2 = '0f1e2d3c4b5a6978';
const VALUE = 'c'.repeat(64);
const VALUE2 = 'd'.repeat(64);

const VIEW: BoxTokenView = {
  phase: 'idle', origin: 'minted', currentSeq: 1, currentSince: 0, lastRotationAt: null, rotationOwed: false,
  owedWhy: null, hold: null, holdNode: null, failures: 0, lastFailure: null, banner: false, fleetConfirmed: 'unknown',
  fleetTransport: null, lastSync: null, previousPresented: 0, retiredPresented: 0, retiredRefused: false,
  lastBootRecovery: null, role: 'server', stalled: null, fileProblem: null,   // the last two: A1's plan-assembly fields
};

interface FakeDriver extends TokenRouteDriver {
  commits: { generation: string; at: number }[];
  failCommit: boolean;
  rotateAnswer: RotateAnswer;
  warnings: string[];
}

const fakeDriver = (): FakeDriver => {
  const warnings: string[] = [];
  const values = new Map([[GEN, VALUE], [GEN2, VALUE2]]);
  const d: FakeDriver = {
    door: new ClaimDoor({ valueOf: (g) => values.get(g) ?? null, warn: (l) => warnings.push(l) }),
    commits: [], failCommit: false, warnings,
    rotateAnswer: { ok: true, outcome: 'started', view: VIEW },
    async commitHandOut(generation, at) {
      if (d.failCommit) throw new Error('fsync failed');
      d.commits.push({ generation, at });
    },
    async rotateNow() { return d.rotateAnswer; },
    view: () => VIEW,
  };
  return d;
};

const claim = (app: FastifyInstance, body: unknown) =>
  app.inject({ method: 'POST', url: TOKEN_CLAIM_PATH, payload: body as Record<string, unknown> });

const JUNK = (i: number): string => `junk${String(i).padStart(39, '0')}`;   // 43 chars, a well-shaped miss

describe('POST /api/token/claim', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; vi.restoreAllMocks(); });

  const open = async (driver?: TokenRouteDriver): Promise<FastifyInstance> => {
    app = await buildServer({ ...testDeps(mkTmp('ccrc-claim-')), ...(driver ? { tokenDriver: driver } : {}) });
    return app;
  };

  it('hands the value out once for a live code, persisting the hand-out before the 200', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    expect(isClaimCode(code)).toBe(true);
    const a = await open(d);
    const res = await claim(a, { code, nodeId: NODE });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, value: VALUE, generation: GEN });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(d.commits.map((c) => c.generation)).toEqual([GEN]);
  });

  it('single use: the same code again answers 410 code-used and hands nothing out', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    expect((await claim(a, { code, nodeId: NODE })).statusCode).toBe(200);
    const again = await claim(a, { code, nodeId: NODE });
    expect(again.statusCode).toBe(410);
    expect(again.json()).toEqual({ ok: false, error: 'code-used' });
    expect(d.commits).toHaveLength(1);
  });

  it('a replay of a burned code discards nothing: it is counted, never reported as expired or misbound', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    await claim(a, { code, nodeId: NODE });
    for (let i = 0; i < 3; i++) expect((await claim(a, { code, nodeId: NODE })).statusCode).toBe(410);
    expect(d.door.alerts).toEqual({ expired: [], wrongNode: [], replays: 3 });
  });

  it('TTL: a code past CLAIM_CODE_TTL_MS answers 410 code-expired, is burned, and names its generation for discard', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now() - CLAIM_CODE_TTL_MS - 1);
    const a = await open(d);
    const res = await claim(a, { code, nodeId: NODE });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ ok: false, error: 'code-expired' });
    expect(d.door.alerts.expired).toEqual([GEN]);
    expect(d.commits).toEqual([]);
    // Burned: the same code once more is a replay, not a second expiry.
    expect((await claim(a, { code, nodeId: NODE })).json()).toEqual({ ok: false, error: 'code-used' });
    expect(d.door.alerts.expired).toEqual([GEN]);
  });

  it('wrong node: a live code from another node id answers 403, is burned, and the right node cannot use it after', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    const res = await claim(a, { code, nodeId: OTHER });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ ok: false, error: 'wrong-node' });
    expect(d.door.alerts.wrongNode).toEqual([GEN]);
    expect((await claim(a, { code, nodeId: NODE })).statusCode).toBe(410);
    expect(d.commits).toEqual([]);
  });

  it('same tick: two claims with the live code give exactly one 200 and one 410 code-used', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    const [r1, r2] = await Promise.all([claim(a, { code, nodeId: NODE }), claim(a, { code, nodeId: NODE })]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 410]);
    expect(d.commits).toHaveLength(1);
  });

  it('jam: 1000 junk claims exhaust the miss budget and answer 429, yet the live code still answers 200', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    const statuses: number[] = [];
    for (let i = 0; i < 1000; i++) statuses.push((await claim(a, { code: JUNK(i), nodeId: NODE })).statusCode);
    expect(statuses.slice(0, CLAIM_MISS_BUDGET).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(CLAIM_MISS_BUDGET).every((s) => s === 429)).toBe(true);
    const live = await claim(a, { code, nodeId: NODE });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ ok: true, generation: GEN });
    // Miss alerts are capped: one warning inside the minute, carrying a count.
    expect(d.warnings.filter((w) => w.includes('miss'))).toHaveLength(1);
  });

  it('a malformed body is 400 bad-request and charges the miss budget, never burning a live code', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    for (const body of [{}, { code }, { code, nodeId: 'NOT-A-NODE' }, { code: 'short', nodeId: NODE }, { code: 7, nodeId: NODE }]) {
      const res = await claim(a, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect((await claim(a, { code, nodeId: NODE })).statusCode).toBe(200);
  });

  it('size: a 2 KiB body answers 413 with the same small body and no-store', async () => {
    const d = fakeDriver();
    d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    const res = await a.inject({ method: 'POST', url: TOKEN_CLAIM_PATH, headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'x'.repeat(2048), nodeId: NODE }) });
    expect(2048).toBeGreaterThan(CLAIM_BODY_LIMIT_BYTES);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it("headers: Fastify's own JSON-parse 400 and media-type refusal are reshaped and carry no-store too", async () => {
    const a = await open(fakeDriver());
    const bad = await a.inject({ method: 'POST', url: TOKEN_CLAIM_PATH,
      headers: { 'content-type': 'application/json' }, payload: '{"code":' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(bad.headers['cache-control']).toBe('no-store');
    const media = await a.inject({ method: 'POST', url: TOKEN_CLAIM_PATH,
      headers: { 'content-type': 'application/x-unknown' }, payload: 'x' });
    expect(media.statusCode).toBe(400);
    expect(media.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(media.headers['cache-control']).toBe('no-store');
  });

  it('headers: every refusal carries no-store and the same small body', async () => {
    const d = fakeDriver();
    const a = await open(d);
    const res = await claim(a, { code: JUNK(1), nodeId: NODE });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'no-claim' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('a hand-out that cannot be recorded answers 503 unavailable and is never handed out (D-4394)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = fakeDriver();
    d.failCommit = true;
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    const res = await claim(a, { code, nodeId: NODE });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'unavailable' });
    expect(res.body).not.toContain(VALUE);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('with no driver it answers 404 no-claim — the same small body, never "no rotation exists"', async () => {
    const a = await open();
    const res = await claim(a, { code: JUNK(2), nodeId: NODE });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'no-claim' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('ClaimDoor', () => {
  it('keeps only the sha256 of a code: neither the code nor the value is in its state', () => {
    const d = new ClaimDoor({ valueOf: () => VALUE, warn: () => {} });
    const code = d.issue(GEN, NODE, 1_000);
    expect(JSON.stringify(d)).not.toContain(code);
    expect(JSON.stringify(d)).not.toContain(VALUE);
  });

  it('claimNow is ONE synchronous step: it answers a value, not a promise', () => {
    const d = new ClaimDoor({ valueOf: () => VALUE, warn: () => {} });
    const code = d.issue(GEN, NODE, 1_000);
    const step = d.claimNow({ code, nodeId: NODE }, 1_001);
    expect(typeof (step as unknown as { then?: unknown }).then).toBe('undefined');
    expect(step).toEqual({ status: 200, generation: GEN, value: VALUE });
  });

  it(`compares a FIXED ${MAX_PENDING} live + ${BURNED_CODES_KEPT} burned slots on every claim, live, burned or none`, () => {
    // Contract addition (marked): `compare` is injectable for this count only.
    let calls = 0;
    const compare = (a: Buffer, b: Buffer): boolean => { calls++; return timingSafeEqual(a, b); };
    const d = new ClaimDoor({ valueOf: () => VALUE, warn: () => {}, compare });
    const code = d.issue(GEN, NODE, 1_000);
    for (const body of [{ code: JUNK(3), nodeId: NODE }, { code, nodeId: NODE }, { code, nodeId: NODE }]) {
      const before = calls;
      d.claimNow(body, 1_001);
      expect(calls - before).toBe(MAX_PENDING + BURNED_CODES_KEPT);
    }
    // A malformed body never reaches the compare: it is refused on shape alone.
    const before = calls;
    d.claimNow({ code: 'short', nodeId: NODE }, 1_002);
    expect(calls - before).toBe(0);
  });

  it('holds at most two live codes, a re-issue for the same generation replaces its code, and revoke drops one', () => {
    const d = new ClaimDoor({ valueOf: (g) => (g === GEN ? VALUE : VALUE2), warn: () => {} });
    const first = d.issue(GEN, NODE, 1_000);
    const second = d.issue(GEN, NODE, 1_000);
    expect(second).not.toBe(first);
    expect(d.claimNow({ code: first, nodeId: NODE }, 1_001)).toMatchObject({ status: 404 });
    d.issue(GEN2, NODE, 1_000);
    expect(() => d.issue('1122334455667788', NODE, 1_000)).toThrow(RangeError);
    d.revoke(GEN);
    expect(d.claimNow({ code: second, nodeId: NODE }, 1_001)).toMatchObject({ status: 404, error: 'no-claim' });
  });

  it('warns on a miss at most once a minute, with the count, and never prints a code', () => {
    const lines: string[] = [];
    const d = new ClaimDoor({ valueOf: () => VALUE, warn: (l) => lines.push(l) });
    for (let i = 0; i < 5; i++) d.claimNow({ code: JUNK(i), nodeId: NODE }, 1_000 + i);
    expect(lines).toHaveLength(1);
    d.claimNow({ code: JUNK(9), nodeId: NODE }, 1_000 + 60_000);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^ccrc-server: box token: the claim door refused \d+ miss/);
    for (const l of lines) expect(l).not.toContain(JUNK(9));
  });

  it('door.ts imports no file system: codes live in memory only', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'token', 'door.ts'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/from 'node:fs/);
    expect(code, 'the door awaits: its claim step is no longer one synchronous step').not.toMatch(/\bawait\b|\basync\b/);
  });
});

describe('POST /api/token/rotate (session-only)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('with no driver answers 501 not-configured', async () => {
    app = await buildServer(testDeps(mkTmp('ccrc-rotate-')));
    const res = await app.inject({ method: 'POST', url: TOKEN_ROTATE_PATH });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it.each([
    [{ ok: true, outcome: 'joined', view: VIEW }, 200],
    [{ ok: false, error: 'held', hold: 'update-in-flight', node: 'fleet', view: VIEW }, 409],
    [{ ok: false, error: 'rate-limited', retryAfterS: 42 }, 429],
  ] as [RotateAnswer, number][])('answers the driver\'s %o as %i, body verbatim', async (answer, status) => {
    const d = fakeDriver();
    d.rotateAnswer = answer;
    app = await buildServer({ ...testDeps(mkTmp('ccrc-rotate-')), tokenDriver: d });
    const res = await app.inject({ method: 'POST', url: TOKEN_ROTATE_PATH });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual(answer);
    if (status === 429) expect(res.headers['retry-after']).toBe('42');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from the repo root): `mkdir -p .tmp-a8 && (cd server && TMPDIR="$PWD/../.tmp-a8" ./node_modules/.bin/vitest run test/token-claim-route.test.ts)`
Expected: `FAIL test/token-claim-route.test.ts`, `Error: Cannot find module '../src/token/door.js'`, `Tests  no tests`.

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/token/door.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isClaimCode, CLAIM_CODE_TTL_MS } from '../../../shared/agent-protocol.js';
import type { ClaimRefusal } from '../../../shared/box-token.js';
import { matchDigestSlots } from '../coord/token.js';
import { NODE_ID_RE } from '../coord/store.js';
import {
  BURNED_CODES_KEPT, BURNED_CODE_KEEP_MS, CLAIM_ALERT_EVERY_MS, MAX_PENDING, claimVerdict,
  type ClaimDoorState, type ClaimMatch,
} from './policy.js';
import { mintClaimCode } from './files.js';

/** What one claim step answers the route. A 200 carries the value, served from
 *  memory (the holder's pending slot via `valueOf`), never from the pending file. */
export type ClaimStep =
  | { status: 200; generation: string; value: string }
  | { status: 400 | 403 | 404 | 410 | 429; error: ClaimRefusal; generation: string | null };

const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/** The fixed number of slots every claim compares: the live codes, then the burned ones. */
const SLOT_COUNT = MAX_PENDING + BURNED_CODES_KEPT;

/**
 * THE CLAIM DOOR'S STATE AND ITS ONE STEP (box-token lifecycle spec 4.6), an L3
 * adapter: it holds sha256 digests of the codes it issued (never a code, never
 * on disk, so a restart voids them all), a short list of burned digests, and the
 * door-wide miss bucket. Every decision is `claimVerdict`'s (L1); this class
 * shapes the input, compares in constant time, applies the answer, and warns.
 *
 * {@link claimNow} is ONE SYNCHRONOUS STEP with no await: the shape check, the
 * digest, a compare over a FIXED `MAX_PENDING + BURNED_CODES_KEPT` slots (empty
 * ones are per-door random dummies, so the compare count does not say how many
 * codes are live), the verdict, the burn and the next state all happen before
 * the route's first await. That is what gives two claims in one tick exactly
 * one 200.
 */
export class ClaimDoor {
  private state: ClaimDoorState = { live: [], burned: [], misses: { windowStart: 0, count: 0 } };
  private readonly dummies: readonly Buffer[] = Array.from({ length: SLOT_COUNT }, () => randomBytes(32));
  private readonly valueOf: (generation: string) => string | null;
  private readonly warn: (line: string) => void;
  /** CONTRACT ADDITION (marked): injectable so a test can count compares. */
  private readonly compare: (a: Buffer, b: Buffer) => boolean;
  private lastMissWarnAt: number | null = null;
  private lastReplayWarnAt: number | null = null;
  /** Generations the driver must discard (an expired or misbound code burned
   *  them), and how many replays of a burned code were seen. The driver drains
   *  the two lists; a replay discards nothing. */
  readonly alerts: { expired: string[]; wrongNode: string[]; replays: number } = { expired: [], wrongNode: [], replays: 0 };

  constructor(opts: { valueOf: (generation: string) => string | null; warn: (line: string) => void;
    compare?: (a: Buffer, b: Buffer) => boolean }) {
    this.valueOf = opts.valueOf;
    this.warn = opts.warn;
    this.compare = opts.compare ?? timingSafeEqual;
  }

  /** Mints a code for `generation`, bound to the measured fleet `nodeId`, and keeps
   *  only its sha256. A re-issue for the same generation replaces its live code;
   *  more than `MAX_PENDING` live codes is a programming error and throws. */
  issue(generation: string, nodeId: string, now: number): string {
    const live = this.state.live.filter((s) => s.generation !== generation);
    if (live.length >= MAX_PENDING) throw new RangeError(`ClaimDoor: at most ${MAX_PENDING} live codes`);
    const code = mintClaimCode();
    this.state = { ...this.state, live: [...live,
      { digest: sha256(code).toString('hex'), generation, nodeId, expiresAt: now + CLAIM_CODE_TTL_MS }] };
    return code;
  }

  /** Drops `generation`'s live code, if any (the driver discarded the generation). */
  revoke(generation: string): void {
    this.state = { ...this.state, live: this.state.live.filter((s) => s.generation !== generation) };
  }

  claimNow(body: unknown, now: number): ClaimStep {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { code?: unknown; nodeId?: unknown };
    const wellShaped = isClaimCode(b.code) && typeof b.nodeId === 'string' && NODE_ID_RE.test(b.nodeId);
    // Burned digests age out by time alone, which is not a secret.
    const burned = this.state.burned.filter((x) => now - x.at < BURNED_CODE_KEEP_MS);
    this.state = { ...this.state, burned };
    let match: ClaimMatch = { kind: 'malformed' };
    if (wellShaped) {
      const slots = [
        ...Array.from({ length: MAX_PENDING }, (_, i) => this.slotDigest(this.state.live[i]?.digest, i)),
        ...Array.from({ length: BURNED_CODES_KEPT }, (_, i) => this.slotDigest(burned[i]?.digest, MAX_PENDING + i)),
      ];
      const i = matchDigestSlots(sha256(b.code as string), slots, this.compare);
      match = i < 0 ? { kind: 'none' }
        : i < MAX_PENDING ? { kind: 'live', index: i }
          : { kind: 'burned', index: i - MAX_PENDING };
    }
    const { reply, next, alert } = claimVerdict(this.state, match, wellShaped ? (b.nodeId as string) : '', now);
    this.state = next;
    if (alert !== null) this.report(alert, now);
    if (reply.status !== 200) return { status: reply.status, error: reply.error, generation: reply.generation };
    const value = this.valueOf(reply.generation);
    if (value === null) {
      // The code was live but its generation is gone from the holder: the code is
      // burned, nothing is handed out, and the driver is told to discard it.
      this.alerts.expired.push(reply.generation);
      this.warn(`ccrc-server: box token: a live claim code named generation ${reply.generation}, ` +
        'which the server no longer holds; nothing was handed out');
      return { status: 404, error: 'no-claim', generation: reply.generation };
    }
    return { status: 200, generation: reply.generation, value };
  }

  private slotDigest(hex: string | undefined, i: number): Buffer {
    return hex === undefined ? this.dummies[i]! : Buffer.from(hex, 'hex');
  }

  private report(alert: NonNullable<ReturnType<typeof claimVerdict>['alert']>, now: number): void {
    if (alert.kind === 'misses') {
      if (this.lastMissWarnAt !== null && now - this.lastMissWarnAt < CLAIM_ALERT_EVERY_MS) return;
      this.lastMissWarnAt = now;
      this.warn(`ccrc-server: box token: the claim door refused ${alert.count} miss(es) in the current minute ` +
        '(no live code matched; misses never burn a code)');
      return;
    }
    if (alert.kind === 'replay') {
      this.alerts.replays++;
      if (this.lastReplayWarnAt !== null && now - this.lastReplayWarnAt < CLAIM_ALERT_EVERY_MS) return;
      this.lastReplayWarnAt = now;
      this.warn(`ccrc-server: box token: a used claim code for generation ${alert.generation} was presented again ` +
        `(${this.alerts.replays} replay(s) since boot); refused, nothing discarded`);
      return;
    }
    (alert.kind === 'expired' ? this.alerts.expired : this.alerts.wrongNode).push(alert.generation);
    this.warn(`ccrc-server: box token: a claim code for generation ${alert.generation} was presented ` +
      (alert.kind === 'expired' ? 'after its TTL' : 'from a node it was not bound to') +
      '; it was burned and the generation will be discarded');
  }
}
```

Create `server/src/token/routes.ts`. The two paths are spelled as literals because `auth-gate.test.ts`'s `scanRoutes` and the census's `registrationsIn` read registrations by their quoted path; the route test injects at `TOKEN_CLAIM_PATH` and `TOKEN_ROTATE_PATH`, so a literal that drifts from L0 is a red suite. The file must not contain the text `requireMailToken(req` or `checkMailToken(` anywhere, comments included: the census would read it as a lane.

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Deps } from '../server.js';
import type { ClaimDoor } from './door.js';
import { CLAIM_BODY_LIMIT_BYTES, type BoxTokenView, type ClaimRefusal, type RotateAnswer } from '../../../shared/box-token.js';

/**
 * What the token routes need from the driver, declared here by its consumer
 * (the L2 rule, kept in the delivery file because nothing else consumes it).
 * `commitHandOut` persists `handedOutAt`/`confirmBy` (fsynced) for a generation
 * the door just handed out; when it rejects, the route answers 503 and the
 * driver discards that generation, so a value is never handed out without a
 * record of it (D-4394).
 */
export interface TokenRouteDriver {
  readonly door: ClaimDoor;
  commitHandOut(generation: string, at: number): Promise<void>;
  rotateNow(now: number): Promise<RotateAnswer>;
  view(): BoxTokenView;
}

const NO_STORE = 'no-store';

const refuse = (reply: FastifyReply, status: number, error: ClaimRefusal): FastifyReply =>
  reply.code(status).header('cache-control', NO_STORE).send({ ok: false, error });

/**
 * The box-token lifecycle's two routes (spec 4.6), registered from their own
 * file: the FOURTH route-registering file, which `auth-gate.test.ts`'s `ROUTES`
 * and `box-token-census.test.ts`'s lane sources read by name. Neither route
 * consults the box token, and the census holds that (`CODE_DOORS`,
 * `TOKEN_DOORS`, both directions). L4: each handler parses, asks the door or
 * the driver, and replies; neither decides.
 *
 * `POST /api/token/claim` is EXEMPT from the session gate (reason 7, `gate.ts`):
 * it authenticates by a single-use code the server issued itself over the agent
 * link. Its route `bodyLimit` is 1 KiB, because the server's default 1 MiB would
 * let a handler-side check come too late. `Cache-Control: no-store` is set in
 * `onRequest`, so it rides every answer, Fastify's own 413 and JSON-parse 400
 * included, which the route `errorHandler` reshapes into the same small body.
 * Every refusal has that one body shape and none says whether a rotation is
 * under way; with no driver the door answers `no-claim` for the same reason.
 *
 * `POST /api/token/rotate` is session-only (NOT EXEMPT): the console's "Rotate
 * now". It answers the driver's `RotateAnswer` verbatim: 200 started or joined,
 * 409 held, 429 rate-limited (with `Retry-After`), 501 when no driver runs.
 */
export function registerTokenRoutes(app: FastifyInstance, deps: Pick<Deps, 'tokenDriver'>): void {
  app.post('/api/token/claim', {
    bodyLimit: CLAIM_BODY_LIMIT_BYTES,
    onRequest: async (_req, reply) => { reply.header('cache-control', NO_STORE); },
    errorHandler: (err, _req, reply) => {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 413) return refuse(reply, 413, 'bad-request');
      if (status !== undefined && status >= 400 && status < 500) return refuse(reply, 400, 'bad-request');
      console.warn('ccrc-server: box token: the claim door failed unexpectedly; answered 503');
      return refuse(reply, 503, 'unavailable');
    },
  }, async (req, reply) => {
    const driver = deps.tokenDriver;
    if (!driver) return refuse(reply, 404, 'no-claim');
    const now = Date.now();
    const step = driver.door.claimNow(req.body, now);
    if (step.status !== 200) return refuse(reply, step.status, step.error);
    try {
      await driver.commitHandOut(step.generation, now);
    } catch {
      console.warn(`ccrc-server: box token: the hand-out of generation ${step.generation} could not be ` +
        'recorded; answered 503 and the generation is discarded');
      return refuse(reply, 503, 'unavailable');
    }
    return reply.code(200).send({ ok: true, value: step.value, generation: step.generation });
  });

  app.post('/api/token/rotate', async (_req, reply) => {
    const driver = deps.tokenDriver;
    if (!driver) return reply.code(501).send({ ok: false, error: 'not-configured' } satisfies RotateAnswer);
    const answer = await driver.rotateNow(Date.now());
    if (answer.ok) return reply.code(200).send(answer);
    if (answer.error === 'held') return reply.code(409).send(answer);
    if (answer.error === 'rate-limited') {
      return reply.code(429).header('retry-after', String(answer.retryAfterS)).send(answer);
    }
    return reply.code(501).send(answer);
  });
}
```

`server/src/server.ts`: after `import { registerUpdateRoutes } from './update/routes.js';` (:57) add
```ts
import { registerTokenRoutes, type TokenRouteDriver } from './token/routes.js';
```
after the `mailToken?: string | BoxTokenHolder | null;` field (A3) add
```ts
  /** The box-token driver as the token routes see it (`token/routes.ts`): the
   *  claim door, the hand-out commit, "Rotate now" and the view. Read at request
   *  time. Absent (tests, or a box whose driver was not built) means the claim
   *  door answers `404 no-claim` and the rotate route `501 not-configured`. */
  tokenDriver?: TokenRouteDriver;
```
and after `registerUpdateRoutes(app, deps, sessionAuth, watcher);` (:1659) add
```ts

  // The box-token lifecycle's claim door and "Rotate now" (spec 4.6), registered
  // from their own file — the fourth that `auth-gate.test.ts`'s `ROUTES` and
  // `box-token-census.test.ts`'s lane sources read by name. `deps.tokenDriver`
  // is read at request time, so a box with no driver answers `no-claim`/`501`.
  registerTokenRoutes(app, deps);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `mkdir -p .tmp-a8 && (cd server && TMPDIR="$PWD/../.tmp-a8" ./node_modules/.bin/vitest run test/token-claim-route.test.ts)`
Expected: `Tests  23 passed (23)`.

- [ ] **Step 5: Mutation checks (each measured red, then restored)**

| Mutation (one line) | Test that goes red (measured) |
|---|---|
| door.ts: the burned half of `slots` becomes `...burned.map((x) => Buffer.from(x.digest, "hex")),` (no dummies) | "compares a FIXED 2 live + 8 burned slots on every claim…" (1 failed) |
| routes.ts: `await driver.commitHandOut(step.generation, now);` becomes `void driver.commitHandOut(step.generation, now).catch(() => {});` | "a hand-out that cannot be recorded answers 503…" (1 failed) |
| routes.ts: delete `bodyLimit: CLAIM_BODY_LIMIT_BYTES,` | "size: a 2 KiB body answers 413…" (1 failed) |
| routes.ts: delete the `onRequest` line | "hands the value out once…" (1 failed: the 200 loses `no-store`; refusals keep it through `refuse()`, which the errorHandler also uses) |

Restore each; `23 passed (23)`. The live-before-budget order and the no-burn-on-miss rule are `claimVerdict`'s (A6); here "jam" pins them end to end.

- [ ] **Step 6: Move the auth-gate pins (red first)**

Adding the routes alone, before any pin moves, reds `auth-gate.test.ts`'s COMPLETE describe (measured: `2 failed | 156 passed (158)`, "every route the server really registers was found by the source scan" and "the table parser is looking at something"): Fastify serves two routes the scan does not read. Edit `server/test/auth-gate.test.ts`:

- :95-98, the `ROUTES` docstring `/** THREE files register routes since update-management W2 (design 2026-09-20\n *  §12, D-3179): \`server/src/update/routes.ts\` joined the two.` becomes
```ts
/** FOUR files register routes since the box-token lifecycle (spec 4.6):
 *  `server/src/token/routes.ts` joined the three, after update-management W2
 *  (design 2026-09-20 §12, D-3179) had put `server/src/update/routes.ts` beside
 *  the first two.
```
- :100, after `  ...scanRoutes('server.ts'), ...scanRoutes('coord/routes.ts'), ...scanRoutes('update/routes.ts'),` add the line `  ...scanRoutes('token/routes.ts'),`
- :208 `it('found all three files, …` -> `it('found all four files, and EXACTLY the route count the surface has', () => {`
- after :250 `expect(scanRoutes('update/routes.ts').length).toBe(7);` add
```ts
    // 2 in `token/routes.ts` (box-token lifecycle, spec 4.6): `POST /api/token/claim`,
    // EXEMPT by reason 7 (a door that authenticates by a single-use code it issued
    // itself), and `POST /api/token/rotate`, session-only and NOT EXEMPT. Neither
    // consults the box token.
    expect(scanRoutes('token/routes.ts').length).toBe(2);
```
- :313 `expect(ROUTES.length).toBe(89);` becomes
```ts
    //
    // 91 since the box-token lifecycle registered its claim door and "Rotate now"
    // from a FOURTH file, `token/routes.ts`: 51 + 31 + 7 + 2 = 91, the HTTP half
    // 86 -> 88.
    expect(ROUTES.length).toBe(91);
```
- after :353 `'POST /api/updates/apply', 'POST /api/updates/rollback',` add
```ts
      // …and the fourth file's two (box-token lifecycle), lost together if `token/routes.ts` stopped being read.
      'POST /api/token/claim', 'POST /api/token/rotate',
```
- :451 `// 89 scanned + the static wildcard when the bundle is built.` -> `// 91 scanned + the static wildcard when the bundle is built.` (pinned by "the scanner-meta comment names the scanned route count")
- :492 `it('exempts exactly the six classes …` -> `it('exempts exactly the seven classes the plan names — nothing has crept in', () => {`; after :529 `// session-gated when armed, no box token at all (decision 15).` add
```ts
    // 34 since `POST /api/token/claim` (box-token lifecycle, spec 4.6) opened the
    // SEVENTH class: a door that authenticates by a single-use code it issued
    // itself. Its sibling `POST /api/token/rotate` is DELIBERATELY NOT here —
    // session-only, the console's "Rotate now", like every update write.
```
  after :563 `'POST /api/runs/:id/route',` add `      'POST /api/token/claim',`, and after :567 `expect(EXEMPT.has('POST /api/auth/logout')).toBe(false);` add `    expect(EXEMPT.has('POST /api/token/rotate')).toBe(false);`
- :901 `// THE PROPERTY, in one loop over all 86 HTTP routes, with THREE probes each:` -> `… all 88 HTTP routes …` (pinned by "the property loop names the HTTP-route count")
- :965 `… the assertion that covers all 86 HTTP routes, not the 32 exempt.` -> `… covers all 88 HTTP routes, not the 33 exempt.` (pinned by "the third probe names the whole and the exempt part")

Run: `mkdir -p .tmp-a8 && (cd server && TMPDIR="$PWD/../.tmp-a8" ./node_modules/.bin/vitest run test/auth-gate.test.ts)`. Expected with `gate.ts` still unchanged: `Tests  3 failed | 157 passed (160)`: "exempts exactly the seven classes…", "the third probe names the whole and the exempt part" (derived exempt 32, prose 33), "gate.ts's own docstring names the HTTP-route count…" (86, derived 88).

- [ ] **Step 7: The gate's seventh reason, its EXEMPT entry and its count**

`server/src/auth/gate.ts`:
- :8 ` * THE GATE. One \`onRequest\` hook stands in front of all 86 routes, the static` -> `… all 88 routes, the static`
- :67 ` * THE SIX REASONS, and there are only six:` -> ` * THE SEVEN REASONS, and there are only seven:`
- replace the line ` * NOT EXEMPT, and worth saying out loud because their absence is a decision:` (:164, directly after reason 6's last line and its blank ` *` line at :162-163) with reason 7, a blank ` *`, that same line, and the rotate route as the first NOT-EXEMPT bullet (above the `POST /api/coord/pause` bullet, so `coord-pause-route.test.ts`'s NOT-EXEMPT passage, read from that bullet on, is unchanged):
```ts
 *  7. `POST /api/token/claim` — a door that authenticates by a single-use code it
 *     issued itself (box-token lifecycle, spec 4.6). The fleet box's
 *     `ccrc token sync` trades a code the server sent it over the agent link for
 *     the next box-token value; it has no cookie jar, and it must not present the
 *     box token either, because the value being replaced may be the leaked one.
 *     The credential is the code: 32 random bytes, only their sha256 held, in
 *     memory, single use, a short TTL, bound to the measured fleet node id, the
 *     live-code compare running before any budget (`token/door.ts`). Being exempt
 *     it also skips the origin check, which is right for a machine caller.
 *
 * NOT EXEMPT, and worth saying out loud because their absence is a decision:
 *  - `POST /api/token/rotate` — the console's "Rotate now". Session-only, like
 *    every update write (decision 15's reasoning): a holder of the box token must
 *    not be able to drive a rotation, and the operator is the one with a session.
```
- after `GET /api/ledger`'s entry (:327-328), before the blank line and `['POST /api/auth/login',`:
```ts

  ['POST /api/token/claim',
    'a door that authenticates by a single-use code it issued itself: the fleet box trades a code ' +
    'sent over the agent link for the next box-token value, with no cookie jar and deliberately ' +
    'without the box token (token/door.ts: sha256 only, single use, TTL, node-bound, compare before budget)'],
```

Run: `mkdir -p .tmp-a8 && (cd server && TMPDIR="$PWD/../.tmp-a8" ./node_modules/.bin/vitest run test/auth-gate.test.ts)`. Expected: `Tests  160 passed (160)` (158 plus the two new rows the derived sweeps grow by: `POST /api/token/claim is NOT refused by the gate` and `POST /api/token/rotate answers 401 no-session`).

- [ ] **Step 8: The census reads the fourth file (red first)**

`server/test/box-token-census.test.ts`:
- after :73 `const UPDATE_SRC = read('server/src/update/routes.ts');` add
```ts
/** The FOURTH file that registers routes (box-token lifecycle, spec 4.6): the
 *  claim door and "Rotate now". Read as a lane source for the update file's
 *  reason — a box-token call there would BE a lane — and so that "neither route
 *  consults the box token" is a measured zero over a file this census reads. */
const TOKEN_SRC = read('server/src/token/routes.ts');
```
- :180 `const ALL_LANES = [...COORD_LANES, ...lanesIn(SERVER_SRC), ...UPDATE_LANES];` becomes
```ts
const TOKEN_LANES = lanesIn(TOKEN_SRC);
const ALL_LANES = [...COORD_LANES, ...lanesIn(SERVER_SRC), ...UPDATE_LANES, ...TOKEN_LANES];
```
- :226-227 `/** Every session-only route … */\nconst SESSION_ONLY_ALL = [...SESSION_ONLY_DOORS, KICKOFF, ARCHIVE, ...UPDATE_DOORS];` becomes
```ts
/** The box-token lifecycle's two routes (spec 4.6), registered from
 *  `server/src/token/routes.ts`, which no harvest above can see. Hand-kept for the
 *  NAMES only, like `UPDATE_DOORS`: the token-surface describe below derives the
 *  file's registrations and compares in both directions. `CODE_DOORS` authenticate
 *  by a single-use code the server issued itself (EXEMPT, reason 7); `TOKEN_DOORS`
 *  are session-only. Neither consults the box token. */
const CODE_DOORS = ['/api/token/claim'];
const TOKEN_DOORS = ['/api/token/rotate'];

/** Every session-only route the bullet must describe as carrying no box token. */
const SESSION_ONLY_ALL = [...SESSION_ONLY_DOORS, KICKOFF, ARCHIVE, ...UPDATE_DOORS, ...TOKEN_DOORS];
```
- before :372 `expect(ALL_LANES.length).toBe(COORD_LANES.length + 3);` add
```ts
    // STILL THREE since the box-token lifecycle added a fourth lane source,
    // `token/routes.ts`, and only because that file adds no lane — asserted
    // directly, so the arithmetic below cannot stay true for the wrong reason.
    expect(TOKEN_LANES, 'a token route consults the box token — the lane count moved').toEqual([]);
```
- before :818 `// Task 10 (account-pool-membership wave 1): the account side's freshness` insert
```ts
// ── the token surface (box-token lifecycle, spec 4.6) ────────────────────────
//
// `server/src/token/routes.ts` is the FOURTH file that registers routes. Run over
// it by construction, as the update surface is: no handler there consults the
// box token, `CODE_DOORS` and `TOKEN_DOORS` together name exactly what it
// registers, a planted box-token call is SEEN (the control), and CLAUDE.md names
// both routes after its "What does need saying here" split, so the lanes clause
// never reads the claim door as a lane.
describe('the token surface: a code door and a session-only rotate, no box-token lane', () => {
  const REGISTERED = registrationsIn(TOKEN_SRC).map((r) => r.key);

  it('token/routes.ts registers what the checks below reason over', () => {
    expect(REGISTERED, 'the token scan collapsed — this describe is over nothing')
      .toHaveLength(CODE_DOORS.length + TOKEN_DOORS.length);
    expect(new Set(REGISTERED).size, 'a route is registered twice').toBe(REGISTERED.length);
  });

  it('no handler there consults the box token, so the lane count stays where it was', () => {
    expect(TOKEN_LANES).toEqual([]);
    for (const p of [...CODE_DOORS, ...TOKEN_DOORS]) {
      expect(ALL_LANES.map((k) => k.slice(k.indexOf(' ') + 1)), `${p} became a box-token lane`).not.toContain(p);
    }
  });

  it('CODE_DOORS and TOKEN_DOORS are exactly what the file registers, in both directions', () => {
    const paths = REGISTERED.map((k) => k.slice(k.indexOf(' ') + 1));
    expect([...paths].sort(),
      'token/routes.ts and CODE_DOORS/TOKEN_DOORS disagree — a route was added or removed on one side only')
      .toEqual([...CODE_DOORS, ...TOKEN_DOORS].sort());
  });

  it('the code door is EXEMPT and the rotate route is not (gate.ts, read as text)', () => {
    for (const p of CODE_DOORS) expect(GATE_SRC, `${p} has no EXEMPT entry`).toContain(`  ['POST ${p}',`);
    for (const p of TOKEN_DOORS) expect(GATE_SRC, `${p} became EXEMPT`).not.toContain(`  ['POST ${p}',`);
  });

  it('a box-token call planted in token/routes.ts is SEEN — the lane source is live, not decorative', () => {
    const anchor = "app.post('/api/token/rotate', async (_req, reply) => {";
    expect(TOKEN_SRC, 'the rotate registration line moved — re-point this control at it').toContain(anchor);
    for (const call of ['requireMailToken(req, reply);', 'checkMailToken(deps.mailToken ?? null, undefined);']) {
      const planted = TOKEN_SRC.replace(anchor, `${anchor}\n    ${call}`);
      expect(lanesIn(planted), `a planted ${call} went unseen`).toContain('POST /api/token/rotate');
    }
    expect(lanesIn(TOKEN_SRC)).not.toContain('POST /api/token/rotate');
  });

  it("CLAUDE.md's box-token bullet names both routes, after its split, and never as a lane", () => {
    const bullet = passage('CLAUDE.md, the box-token bullet', CLAUDE_MD,
      '- **Box token gates every coordination WRITE**', '\n- **').replace(/\s+/g, ' ');
    const split = bullet.indexOf('What does need saying here');
    expect(split, "the bullet's split anchor moved").toBeGreaterThan(0);
    for (const p of [...CODE_DOORS, ...TOKEN_DOORS]) {
      expect(bullet.slice(split), `the bullet does not name ${p} after its split`).toContain(`\`POST ${p}\``);
      expect(bullet.slice(0, split), `the bullet names ${p} inside its lanes clause`).not.toContain(p);
    }
  });
});

```

Run: `mkdir -p .tmp-a8 && (cd server && TMPDIR="$PWD/../.tmp-a8" ./node_modules/.bin/vitest run test/box-token-census.test.ts)`. Expected with CLAUDE.md unchanged: `Tests  2 failed | 27 passed (29)`: "CLAUDE.md's box-token bullet is TRUE, not merely present" (`does not name /api/token/rotate`, via `SESSION_ONLY_ALL`) and "CLAUDE.md's box-token bullet names both routes, after its split, and never as a lane".

- [ ] **Step 9: The CLAUDE.md sentence**

In the box-token bullet, :295 `  route's literal.` (the archive door's sentence, after the "What does need saying here" split) becomes:
```
  route's literal. The box-token lifecycle's `POST /api/token/claim` (EXEMPT: it authenticates by a single-use code
  the server sent over the agent link, never by the token it hands out) and `POST /api/token/rotate` (session-only,
  the console's "Rotate now") consult no box token either; they register from `server/src/token/routes.ts`, which
  the census reads as a lane source of its own and checks against `CODE_DOORS` and `TOKEN_DOORS` in both directions.
```
The sentence carries no CAPS cardinal (`coord-pause-route.test.ts` reads this bullet's `TWO`..`SEVEN` as the door count, which must stay `FOUR`) and names neither route before the split.

Run: `mkdir -p .tmp-a8 && (cd server && TMPDIR="$PWD/../.tmp-a8" ./node_modules/.bin/vitest run test/box-token-census.test.ts)` -> `Tests  29 passed (29)`; `mkdir -p .tmp-a8 && (cd server && TMPDIR="$PWD/../.tmp-a8" ./node_modules/.bin/vitest run test/coord-pause-route.test.ts)` -> `Tests  20 passed (20)`.

- [ ] **Step 9b: The README's exempt list (plan assembly; not prototyped)**

In `README.md`'s order-pinned auth paragraph ("What is gated, and what is not: **everything except** …"), old:

```markdown
the fleet host), the login and passkey-assertion doors themselves,
```

new:

```markdown
the fleet host), `POST /api/token/claim` (the box token's claim door, which
authenticates by a single-use code the server issued over the agent link), the
login and passkey-assertion doors themselves,
```

No number word is added, so `box-token-census.test.ts`'s order-pinned sequence (`twenty-seven` then `twenty-four`, read from `What is gated, and what is not:` to `Enrolling a passkey`) is unchanged. Re-run `test/box-token-census.test.ts` (expected `29 passed`, as Step 8 left it) and `test/auth-gate.test.ts` (expected `160 passed`) one call each.

- [ ] **Step 10: Mutation checks on the census**

Each measured, then restored:
- `TOKEN_DOORS` emptied (`const TOKEN_DOORS: string[] = [];`) -> census `2 failed | 27 passed (29)`: "token/routes.ts registers what the checks below reason over" and "CODE_DOORS and TOKEN_DOORS are exactly what the file registers, in both directions".
- The four-line `POST /api/token/claim` EXEMPT entry deleted from `gate.ts` -> census `1 failed | 28 passed (29)` ("the code door is EXEMPT and the rotate route is not") and auth-gate `2 failed | 158 passed (160)` ("exempts exactly the seven classes…", "the third probe names the whole and the exempt part").
- `...TOKEN_LANES` in `ALL_LANES` is not a guard on its own (the file has no lane, so removing it changes nothing); the planted control ("a box-token call planted in token/routes.ts is SEEN") is what proves the source is read.

- [ ] **Step 11: Run the neighbours unchanged**

From the repo root, one per call: `single-definition.test.ts` (expected `406 passed`), `topology-clean.test.ts` (`55 passed`), `module-format.test.ts` (`4 passed`), `run-routes.test.ts` (`230 passed`; slow, give it the full 600 s), `coord-caps-route.test.ts` (`26 passed`), `auth-routes.test.ts` (`54 passed`), `auth-passkey.test.ts` (`154 passed`), `notify-token.test.ts` (`7 passed`), `coord-token.test.ts` (`33 passed`); then `./node_modules/.bin/tsc --noEmit -p tsconfig.json` (no output).

- [ ] **Step 12: Commit** (afterwards, from the repo root: `rm -rf .tmp-a8`)

```bash
git add server/src/token/door.ts server/src/token/routes.ts server/src/server.ts server/src/auth/gate.ts CLAUDE.md README.md server/test/token-claim-route.test.ts server/test/auth-gate.test.ts server/test/box-token-census.test.ts
git commit -m "feat(token): the claim door and Rotate now, and their census (A8, D-4394)

POST /api/token/claim (EXEMPT, reason 7) answers a live single-use code
once with the value, persisting the hand-out before the 200 or answering
503; a fixed-slot constant-time compare over live and burned codes runs
before any budget, and every answer carries no-store. POST /api/token/rotate
is session-only. Both register from token/routes.ts, the fourth route file:
auth-gate counts 91 scanned / 88 HTTP / 33 exempt, the census reads it as a
lane source with CODE_DOORS and TOKEN_DOORS in both directions, and the lane
count stays 27.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Pinned tests moved by this task: `server/test/auth-gate.test.ts` — `ROUTES` reads a fourth file; `scanRoutes('token/routes.ts').length` 2; `ROUTES.length` 89 -> 91; the found-registrations list gains both routes; "91 scanned + the static wildcard"; "all 88 HTTP routes" (property loop) and "covers all 88 HTTP routes, not the 33 exempt" (third probe); EXEMPT's sorted list gains `POST /api/token/claim` and its title reads "seven classes"; `EXEMPT.has('POST /api/token/rotate')` is false; `gate.ts`'s "stands in front of all 88 routes". `server/test/box-token-census.test.ts` — `TOKEN_SRC`, `TOKEN_LANES` into `ALL_LANES`, `CODE_DOORS`, `TOKEN_DOORS` into `SESSION_ONLY_ALL`, `TOKEN_LANES` asserted `[]` beside the unchanged `+ 3`, and the token-surface describe (registrations both ways, planted control, EXEMPT presence and absence, the CLAUDE.md sentence after the split). Unchanged and run: `UNGATED`, `SESSION_ONLY`, `UPDATE_DOORS`, the 27 lanes, reason 2's and README's order-pinned numbers, `coord-pause-route.test.ts`'s FOUR. No `ready.ops`, `NODE_FILES`, install, uninstall or doctor census moves.

### Task A9: Driver, link and a whole rotation in process

(prototype) measured: server/test/token-rotation-e2e.test.ts: red 1 failed suite (module missing, no tests) -> green 20 passed, 2026-10-07 on main 282e79e44 (with A1/A3/A4/A8 scaffolds: the claim route, `ClaimDoor` and `Deps.tokenDriver` as the contract declares them)
(not prototyped, added at plan assembly from review findings: `retryMint`'s generation id; the run-time re-read (`reread`); the unaccounted-for alerts (`noteUnaccounted`, the `pending-cap` line in `setHold`); `view().stalled` and `view().fileProblem` (`noteOwed`); and eight e2e cases — fresh server with no fleet file, Rotate now rate-limited, Rotate now held, a failed boot mint retried, a handed-out value unaccounted for, the stall alert, a truncated mail.token on re-read, a retired value written back at run time. The file then has 28 cases; each added guard has a mutation row in Step 8b.)

**Files:**
- Create: `server/src/token/link.ts` (L3), `server/src/token/driver.ts` (L4)
- Modify: `server/src/index.ts` — the import block (after A7's `bootBoxToken` import) and the lines immediately before `const app = await buildServer(deps, bus, watcher);` (line 218 at main 282e79e44), plus one line after `await app.listen(...)` (line 220)
- Test: `server/test/token-rotation-e2e.test.ts` (new)

**Interfaces:**
- Consumes: A5 (`fileTokenStore`, `fileBothRoleWriter`, `tokenPaths`, `valueDigestHex`, the ports), A6 (policy), A7 (`BootResult`, `bootBoxToken` in the test), A8 (`ClaimDoor` with `issue`/`revoke`/`claimNow`/`alerts`, `TokenRouteDriver`, the claim route reading `deps.tokenDriver`), A3 (`BoxTokenHolder.match`/`isRetired`/`counters`/`setSlots`/`setRetired`/`pendingValue`/`currentValue`), A1 (`TOKEN_SYNC_OP`, `TOKEN_SYNC_OP_TIMEOUT_MS`, `isTokenSyncOpError`, `readTokenTransport`, `NODE_FILES.tokenGeneration`, `readGenerationFile`, `GENERATION_ID_RE`); `readNodeFile`, `INVENTORY_BUDGET_MS` (`server/src/update/inventory.ts`), `openPoolReadDeadline` (`server/src/pools.ts`), `FleetClient.request`, `AgentOpError`, `LinkNotSentError` (`server/src/remote/client.ts`), `NODE_ID_RE`, `NodeRow` (`server/src/coord/store.ts`).
- Produces: `tokenSyncLinkOver(client: Pick<FleetClient, 'request'>): TokenSyncLink`; `generationReaderOver(io: FleetIO, ccrcDir: string, now: () => number): GenerationReader`; `gateRowsOver(store: { nodes(): NodeRow[] } | null, linkUp: () => boolean, lastReadyAt: () => number | null): GateRowsSource`; `DriverDeps`; `class BoxTokenDriver implements TokenRouteDriver` with `door`, `start()`, `stop()`, `tick()`, `rotateNow(now)`, `commitHandOut(generation, at)`, `view()`; the driver built and started from `index.ts`.
- Contract addition: `gateRowsOver` in `link.ts` (the contract put the `NodeRow -> GateNode` mapping in `index.ts`; a mapping is adapter work and L5 only composes; `nodeIdMeasured` is the store's own `NODE_ID_RE`).
- Link mapping (as coded): `ResOk` with a `GENERATION_ID_RE` `synced` -> `synced` + `readTokenTransport`; a `ResOk` without one -> `refused spawn-failed` with a fixed detail (a handed-out value survives it, as for a lost result); `AgentOpError('bad-request')` -> `predates-op`; an `isTokenSyncOpError` word -> `refused` with the agent's detail; any other `AgentOpError` -> `refused spawn-failed` (detail = its detail or code); `LinkNotSentError` -> `unsent`; `Error('timeout'|'disconnected'|'aborted')` -> `lost`; any other throw -> `lost disconnected`.
- Driver behaviour (as coded; every decision is `nextAction`'s): one tick reads the fleet's generation (remote, link up) with `measuredAt` after the read, then takes at most eight steps; a `send` or `promote` ends the tick. `stage` writes the pending file, then the holder accepts G (spec §5), then persists. `send` issues the code bound to the gate's node id, awaits the op, revokes the code, folds the answer with `applySyncResult`, removes dropped pending files, backs off on a counted failure (`backoffMs`), and promotes on `synced`. `commitHandOut` persists `handedOutAt`/`confirmBy` through the serialised state writer BEFORE the claim's 200 and, on a failed write, discards the generation (file, slot, code) and rejects so the route answers 503 (D-4394). `promote` writes the both-box files first on a both box (own write), retires a previous value still in grace (the fleet confirmed a later one), records `promoting`, copies the current value to `mail-previous.token`, renames the pending file over `mail.token`, applies `promotedState`, discards the other pending values, and only then swaps the holder's slots. `retire` appends the digest, deletes the file, empties the slot, reloads the retired digests into the holder, and runs the self-check `holder.match(v) === null && holder.isRetired(v)` (not `checkMailToken`, which would count the self-check as an outside presentation), recording `retiredRefusedAt`. A learned hold (`stale-client`, and `verb-missing` from `isTokenVerbMissing`, D-4395) is not a failure; a fresh `ready` (a new `lastReadyAt`) re-probes it and resets the backoff. `rotateNow` joins when a rotation is staged or requested, answers `rate-limited` within a minute of the last start, `held` on a closed gate, else requests one and starts a tick. `view()` derives `phase` with `phaseOf`, `fleetConfirmed` from the recorded confirmation (`own-write` on a both box) or the last generation read, and the counters from the holder.
- Added at plan assembly (review): `retryMint` mints with a generation id, as boot does; once per `TOKEN_FILE_REREAD_MS` a tick re-reads `mail.token`, each pending file and `mail-previous.token`, compares each with the value in memory, keeps memory in every case, warns once per finding (`ccrc-server: box token: <path> <finding> on re-read; the last good value is kept in memory`) and records the last finding as `fileProblem`; a handed-out value past `confirmBy` is warned `a handed-out value is unaccounted for (generation #<seq>)` once per generation, and the `pending-cap` hold is warned `handed-out values unaccounted for`; `view().stalled` is a failed mint, or a rotation owed for `STALL_ALERT_MS` since this process first saw it owed (a restart restarts that clock: recorded limit).
- Known limit (recorded, not fixed here): a claim refused with 503 leaves the op's answer for a generation that is no longer outstanding, which `applySyncResult` folds as "confirms nothing", so that attempt records no failure; the rotation stays owed and the next tick retries.

- [ ] **Step 1: Write the failing test**

Create `server/test/token-rotation-e2e.test.ts`:

```ts
// A whole box-token rotation in process (spec §5, 10.1, 10.2): the real boot,
// holder, driver, claim door and box-token lanes, with a FAKE agent that answers
// `token-sync` by claiming over `app.inject`, writing a fixture fleet home's
// token and generation files, and proving with one `GET /api/ledger`. The real
// verb against loopback is Part B's (token-rotation-real-verb.test.ts). Also the
// link's answer mapping and the generation reader, over fakes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { bootBoxToken, type BootResult } from '../src/token/boot.js';
import { BoxTokenDriver } from '../src/token/driver.js';
import { gateRowsOver, generationReaderOver, tokenSyncLinkOver } from '../src/token/link.js';
import {
  fileTokenStore, readState, tokenPaths, valueDigestHex, writeFleetTokenFile, writeGenerationFile,
} from '../src/token/files.js';
import {
  CONFIRM_DEADLINE_MS, GRACE_MS, STALL_ALERT_MS, TOKEN_FILE_REREAD_MS, type GateNode, type SyncResult,
} from '../src/token/policy.js';
import type { TokenStore, TokenSyncLink } from '../src/token/ports.js';
import { extractToken } from '../src/coord/token.js';
import { AgentOpError, LinkNotSentError } from '../src/remote/client.js';
import { localIO, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { TOKEN_SYNC_OP_TIMEOUT_MS } from '../../shared/agent-protocol.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NODE = '11111111-2222-4333-8444-555555555555';
const HDR = ['x', 'ccrc', 'mail', 'token'].join('-');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

afterEach(() => { vi.restoreAllMocks(); });

const fleetRow = (over: Partial<GateNode> = {}): GateNode => ({
  nodeId: NODE, nodeIdMeasured: true, label: 'fleet', role: 'fleet', reachable: true, os: 'linux',
  caps: ['token-sync'], agentOps: ['update', 'token-sync'], updateState: 'idle', reportedPhase: null, ...over,
});

interface Rig {
  home: string; fleetHome: string; app: FastifyInstance; driver: BoxTokenDriver; boot: BootResult;
  agent: FakeAgent; clock: { offset: number }; rows: { row: GateNode; linkUp: boolean; readyAt: number };
  printed: string[]; lane(value: string): Promise<number>; fleetValue(): string | null;
}
type Mode = 'normal' | 'lose-result' | 'replay' | 'verb-missing' | 'claim-only';
interface FakeAgent extends TokenSyncLink { mode: Mode; calls: number; codes: string[] }

/** The fake agent: claim over inject, write the fleet files, prove once, answer like the verb would. */
function fakeAgent(appRef: () => FastifyInstance, fleetHome: string): FakeAgent {
  const fleetFile = path.join(fleetHome, '.cc-secrets', 'ccrc-mail.token');
  const genFile = path.join(fleetHome, '.ccrc', 'box-token-generation');
  const agent: FakeAgent = {
    mode: 'normal', calls: 0, codes: [],
    async send(code: string): Promise<SyncResult> {
      agent.calls++;
      agent.codes.push(code);
      if (agent.mode === 'verb-missing') return { kind: 'refused', word: 'spawn-failed', detail: 'ccrc: unknown argument: token' };
      const app = appRef();
      const claim = await app.inject({ method: 'POST', url: '/api/token/claim', payload: { code, nodeId: NODE } });
      if (claim.statusCode === 410 && claim.json().error === 'code-used') return { kind: 'refused', word: 'code-used', detail: null };
      if (claim.statusCode !== 200) return { kind: 'refused', word: 'claim-refused', detail: null };
      if (agent.mode === 'replay') {
        const again = await app.inject({ method: 'POST', url: '/api/token/claim', payload: { code, nodeId: NODE } });
        expect([again.statusCode, again.json().error]).toEqual([410, 'code-used']);
      }
      // `claim-only` (plan assembly): someone claims first and the op is lost before the fleet writes anything.
      if (agent.mode === 'claim-only') return { kind: 'lost', why: 'timeout' };
      const { value, generation } = claim.json() as { value: string; generation: string };
      await writeFleetTokenFile(fleetFile, value);
      await writeGenerationFile(genFile, generation);
      const proof = await app.inject({ method: 'GET', url: '/api/ledger', headers: { [HDR]: value } });
      if (proof.statusCode === 401) return { kind: 'refused', word: 'proof-failed', detail: null };
      if (proof.statusCode !== 400) return { kind: 'refused', word: 'proof-unmeasured', detail: null };
      if (agent.mode === 'lose-result') return { kind: 'lost', why: 'timeout' };
      return { kind: 'synced', generation, transport: 'https' };
    },
  };
  return agent;
}

async function rig(opts: { home?: string; fleetHome?: string; handMade?: string | null; wrap?: (s: TokenStore) => TokenStore;
  lockDirForBoot?: boolean } = {}): Promise<Rig> {
  const home = opts.home ?? mkTmp('ccrc-token-e2e-');
  const fleetHome = opts.fleetHome ?? mkTmp('ccrc-token-e2e-fleet-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  mkdirSync(path.join(fleetHome, '.ccrc'), { recursive: true });
  const paths = tokenPaths(path.join(home, '.ccrc', 'mail.token'), home);
  if (opts.handMade) writeFileSync(paths.current, `${opts.handMade}\n`, { mode: 0o600 });
  const printed: string[] = [];
  for (const m of ['warn', 'log', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a) => { printed.push(a.join(' ')); });
  const clock = { offset: 0 };
  const now = (): number => Date.now() + clock.offset;
  // `lockDirForBoot` (plan assembly): the boot mint fails (EACCES), as token-boot.test.ts's failed-mint case; the
  // directory is writable again before the driver's first tick, so its mint retry can succeed.
  if (opts.lockDirForBoot) chmodSync(path.join(home, '.ccrc'), 0o500);
  let boot: BootResult;
  try {
    boot = await bootBoxToken({ mailTokenPath: paths.current, home, role: 'server', roleSource: 'recorded', fleetMode: 'remote', now: now() });
  } finally { if (opts.lockDirForBoot) chmodSync(path.join(home, '.ccrc'), 0o700); }
  printed.push(...boot.warnings);
  const rows = { row: fleetRow(), linkUp: true, readyAt: 1 };
  let app: FastifyInstance | null = null;
  const agent = fakeAgent(() => app as FastifyInstance, fleetHome);
  const driver = new BoxTokenDriver({
    store: (opts.wrap ?? ((x) => x))(fileTokenStore(paths)), holder: boot.holder, link: agent,
    generation: generationReaderOver(localIO, path.join(fleetHome, '.ccrc'), now),
    rows: { nodes: () => [rows.row], linkUp: () => rows.linkUp, lastReadyAt: () => rows.readyAt },
    env: { fleetMode: 'remote', role: 'server', roleSource: 'recorded', agentEnvMarksFleet: false },
    bothWriter: null, now, warn: (l) => printed.push(l),
  }, boot);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  app = await buildServer({ ...testDeps(home), mailToken: boot.holder, coord, tokenDriver: driver }, new Bus());
  const fleetFile = path.join(fleetHome, '.cc-secrets', 'ccrc-mail.token');
  return {
    home, fleetHome, app, driver, boot, agent, clock, rows, printed,
    lane: async (value) => (await app.inject({ method: 'GET', url: '/api/ledger', headers: { [HDR]: value } })).statusCode,
    fleetValue: () => (existsSync(fleetFile) ? extractToken(readFileSync(fleetFile, 'utf8')) : null),
  };
}
const genOf = (fleetHome: string): string => readFileSync(path.join(fleetHome, '.ccrc', 'box-token-generation'), 'utf8').trim();

describe('a whole rotation', () => {
  it('adopted value -> staged, handed out, confirmed by the op result, promoted; grace; retired once presented', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    try {
      expect(r.driver.view()).toMatchObject({ origin: 'adopted', rotationOwed: true, phase: 'idle' });
      await r.driver.tick();
      const fresh = r.fleetValue() as string;
      expect(fresh).not.toBe(leaked);
      expect(r.boot.holder.currentValue()).toBe(fresh);
      expect(await r.lane(fresh)).toBe(400);                          // accepted (400 = query missing)
      expect(await r.lane(leaked)).toBe(400);                         // still accepted: grace
      const s = await readState(tokenPaths(path.join(r.home, '.ccrc', 'mail.token'), r.home).state);
      expect(s.kind === 'state' && [s.state.origin, s.state.rotationOwed, s.state.current.id]).toEqual(['rotated', false, genOf(r.fleetHome)]);
      expect(r.driver.view()).toMatchObject({ phase: 'grace', fleetConfirmed: 'current', fleetTransport: 'https', lastSync: { word: 'synced' } });
      // past grace, after the new value was presented (the lane call above): retired, and refused for good
      r.clock.offset = GRACE_MS + 1000;
      await r.driver.tick();
      expect(await r.lane(leaked)).toBe(401);
      expect(r.driver.view()).toMatchObject({ phase: 'idle', retiredRefused: true, retiredPresented: 1 });
      expect(existsSync(path.join(r.home, '.ccrc', 'mail-previous.token'))).toBe(false);
      expect(await r.lane(fresh)).toBe(400);
      expect(r.agent.calls).toBe(1);
    } finally { await r.app.close(); }
  });

  it('nothing printed: no value, code or digest in any log line across a rotation', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
    try {
      await r.driver.tick();
      r.clock.offset = GRACE_MS + 1000;
      await r.lane(r.fleetValue() as string);
      await r.driver.tick();
    } finally { vi.mocked(process.stdout.write).mockRestore(); vi.mocked(process.stderr.write).mockRestore(); await r.app.close(); }
    const text = [...r.printed, ...out, JSON.stringify(r.driver.view())].join('\n');
    expect(r.printed.length).toBeGreaterThan(0);
    for (const secret of [leaked, r.fleetValue() as string, ...r.agent.codes]) {
      expect(text.includes(secret)).toBe(false);
      expect(text.includes(valueDigestHex(secret))).toBe(false);
    }
  });
});

describe('a lost result after the fleet wrote the file (review focus 1)', () => {
  it('the handed-out value stays accepted, is never promoted on its presentation, and a later generation read confirms it', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    try {
      r.agent.mode = 'lose-result';
      await r.driver.tick();
      const g = r.fleetValue() as string;
      expect(r.driver.view()).toMatchObject({ phase: 'handed-out', lastFailure: 'timeout', failures: 1 });
      expect(r.boot.holder.currentValue()).toBe(leaked);              // not promoted
      expect(await r.lane(g)).toBe(400);                              // the fleet sees no 401
      expect(await r.lane(g)).toBe(400);
      expect(r.boot.holder.currentValue()).toBe(leaked);              // presentation promoted nothing
      r.agent.mode = 'normal';
      await r.driver.tick();                                          // reads box-token-generation, measured after the hand-out
      expect(r.boot.holder.currentValue()).toBe(g);
      expect(r.agent.calls).toBe(1);                                  // confirmed without a second sync
      expect(await r.lane(leaked)).toBe(400);                         // previous, in grace
    } finally { await r.app.close(); }
  });
});

describe('a door-side replay discards nothing', () => {
  it('claim 200, replay 410 code-used, and the value is still promoted', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.agent.mode = 'replay';
      await r.driver.tick();
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
      expect(r.driver.view().origin).toBe('rotated');
    } finally { await r.app.close(); }
  });
});

describe('one rotation at a time', () => {
  it('an owed rotation, "Rotate now" and a second tick at once produce one generation', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      const now = Date.now();
      const [, answer] = await Promise.all([r.driver.tick(), r.driver.rotateNow(now), r.driver.tick()]);
      await r.driver.tick();
      expect(answer.ok && answer.outcome).toMatch(/started|joined/);
      expect(r.agent.calls).toBe(1);
      expect(r.driver.view().currentSeq).toBe(2);
    } finally { await r.app.close(); }
  });
});

describe('mixed versions and named holds', () => {
  it('an agent whose ready lacks token-sync is never sent the op; the old value stays current', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.rows.row = fleetRow({ agentOps: ['update'] });
      await r.driver.tick();
      expect(r.agent.calls).toBe(0);
      expect(r.driver.view()).toMatchObject({ phase: 'held', hold: 'agent-predates-op', holdNode: 'fleet' });
      expect(r.boot.holder.currentValue()).toBe('e'.repeat(64));
    } finally { await r.app.close(); }
  });

  it('a ccrc without the verb is the named hold verb-missing, not a failure, re-probed on a fresh ready (D-4395)', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.agent.mode = 'verb-missing';
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ hold: null, failures: 0 });
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ phase: 'held', hold: 'verb-missing', failures: 0, banner: false });
      expect(r.agent.calls).toBe(1);                                 // held: no second send
      r.agent.mode = 'normal';
      r.rows.readyAt = Date.now() + 10;                              // a fresh ready re-probes at once
      await r.driver.tick();
      expect(r.agent.calls).toBe(2);
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
    } finally { await r.app.close(); }
  });
});

describe('resync after a write-back (review focus 3)', () => {
  it('the written-back value answers 401 and is counted; the fleet is resynced through the code path', async () => {
    const leaked = 'e'.repeat(64);
    const first = await rig({ handMade: leaked });
    await first.driver.tick();
    first.clock.offset = GRACE_MS + 1000;
    await first.lane(first.fleetValue() as string);
    await first.driver.tick();                                       // leaked value retired
    await first.app.close();
    const tok = path.join(first.home, '.ccrc', 'mail.token');
    rmSync(tok);
    writeFileSync(tok, `# an older deploy.sh shipped this\n${leaked}\n`, { mode: 0o600 });
    const r = await rig({ home: first.home, fleetHome: first.fleetHome });
    try {
      expect(r.driver.view()).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
      expect(await r.lane(leaked)).toBe(401);
      expect(r.boot.holder.counters().retired).toBe(1);
      await r.driver.tick();                                         // the claim needs no box token
      expect(r.fleetValue()).toBe(r.boot.holder.currentValue());
      expect(await r.lane(r.fleetValue() as string)).toBe(400);
      expect(await r.lane(leaked)).toBe(401);
    } finally { await r.app.close(); }
  });
});

describe('the hand-out is recorded before the 200 (D-4394)', () => {
  it('a hand-out that cannot be recorded answers 503, is never handed out, and the old value stays current', async () => {
    let failNext = true;
    const r = await rig({ handMade: 'e'.repeat(64), wrap: (st) => ({ ...st, writeState: async (s) => {
      if (failNext && s.pending.some((p) => p.handedOutAt !== null)) { failNext = false; throw Object.assign(new Error('injected'), { code: 'ENOSPC' }); }
      return st.writeState(s);
    } }) });
    try {
      await r.driver.tick();
      expect(r.fleetValue()).toBeNull();                               // the fleet never received a value
      expect(r.driver.view()).toMatchObject({ origin: 'adopted', rotationOwed: true, phase: 'idle' });
      expect(r.boot.holder.currentValue()).toBe('e'.repeat(64));
      const st = await readState(tokenPaths(path.join(r.home, '.ccrc', 'mail.token'), r.home).state);
      expect(st.kind === 'state' && st.state.pending).toEqual([]);
      expect(readdirSync(path.join(r.home, '.ccrc')).filter((n) => n.startsWith('mail-pending-'))).toEqual([]);
    } finally { await r.app.close(); }
  });
});

// ── added at plan assembly (review findings); not prototyped, so each is run red first against its mutation ──

describe('a fresh two-box install (review: critical)', () => {
  it('fresh server, no fleet file: one tick later the fleet file holds an accepted value and the view says fleetConfirmed current', async () => {
    const r = await rig();
    try {
      expect(r.fleetValue()).toBeNull();
      expect(r.driver.view()).toMatchObject({ origin: 'minted', rotationOwed: false });
      await r.driver.tick();                                          // the absent fleet generation reads behind
      const v = r.fleetValue() as string;
      expect(v).toBe(r.boot.holder.currentValue());
      expect(await r.lane(v)).toBe(400);
      expect(r.driver.view()).toMatchObject({ origin: 'rotated', fleetConfirmed: 'current' });
      expect(r.agent.calls).toBe(1);
    } finally { await r.app.close(); }
  });
});

describe('Rotate now: its rate limit and its hold (review: driver guards)', () => {
  it('twice within a minute on an idle state: the second answers rate-limited with a positive retryAfterS', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      const t = Date.now();
      const first = await r.driver.rotateNow(t);
      await r.driver.tick();                                          // joins the tick rotateNow started
      expect(first).toMatchObject({ ok: true, outcome: 'started' });
      expect(r.driver.view().phase).toBe('grace');                   // the rotation completed: nothing pending
      const second = await r.driver.rotateNow(t + 1000);
      expect(second.ok).toBe(false);
      expect(!second.ok && second.error).toBe('rate-limited');
      expect(!second.ok && second.error === 'rate-limited' && second.retryAfterS).toBeGreaterThan(0);
      expect(r.agent.calls).toBe(1);
    } finally { await r.app.close(); }
  });

  it('on a closed gate it answers held with the hold word and its node, and sends nothing', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.rows.row = fleetRow({ agentOps: ['update'] });
      const a = await r.driver.rotateNow(Date.now());
      expect(a).toMatchObject({ ok: false, error: 'held', hold: 'agent-predates-op', node: 'fleet' });
      await r.driver.tick();
      expect(r.agent.calls).toBe(0);
    } finally { await r.app.close(); }
  });
});

describe('a failed boot mint is retried (spec 10.1, review: driver guards)', () => {
  it.skipIf(isRoot)('boot mints nothing, every lane refuses, the stall alert names mint-failed; one tick later a lane answers ok', async () => {
    const r = await rig({ lockDirForBoot: true });
    try {
      expect(r.boot.mintFailed).toBe(true);
      expect(r.boot.holder.hasCurrent()).toBe(false);
      expect(r.driver.view().stalled).toMatchObject({ why: 'mint-failed' });
      await r.driver.tick();
      expect(r.boot.holder.hasCurrent()).toBe(true);
      expect(await r.lane(r.boot.holder.currentValue() as string)).toBe(400);
      expect(r.driver.view()).toMatchObject({ stalled: null, lastFailure: null });
      expect(r.printed.join('\n')).toMatch(/minted a new value at .* after a failed mint/);
    } finally { await r.app.close(); }
  });
});

describe('a handed-out value unaccounted for (spec §5.1, §6 "Someone claims first")', () => {
  it('past confirmBy it is warned once, and the forward rotation that follows discards it', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.agent.mode = 'claim-only';
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ phase: 'handed-out' });
      expect(r.fleetValue()).toBeNull();
      r.agent.mode = 'normal';
      r.clock.offset = CONFIRM_DEADLINE_MS + 1000;
      await r.driver.tick();
      await r.driver.tick();
      const alerts = r.printed.filter((l) => /a handed-out value is unaccounted for \(generation #\d+\)/.test(l));
      expect(alerts).toHaveLength(1);
      expect(r.boot.holder.currentValue()).toBe(r.fleetValue());
      expect(r.driver.view()).toMatchObject({ origin: 'rotated' });
    } finally { await r.app.close(); }
  });
});

describe('the stall alert (review: the downside of doctor arms off)', () => {
  it('a rotation owed and held past STALL_ALERT_MS raises the stall alert; before that it does not', async () => {
    const r = await rig({ handMade: 'e'.repeat(64) });
    try {
      r.rows.row = fleetRow({ agentOps: ['update'] });
      await r.driver.tick();
      expect(r.driver.view()).toMatchObject({ phase: 'held', rotationOwed: true, stalled: null, banner: false });
      r.clock.offset = STALL_ALERT_MS + 1000;
      await r.driver.tick();
      expect(r.driver.view().stalled).toMatchObject({ why: 'owed' });
      expect(r.driver.view().failures).toBe(0);                       // a hold is never a failure: the banner alone would stay dark
    } finally { await r.app.close(); }
  });
});

describe('the run-time re-read (spec 4.2, §6 "A token file broken on re-read")', () => {
  it('mail.token truncated at run time: lanes stay ok, one warning, fileProblem recorded', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    const paths = tokenPaths(path.join(r.home, '.ccrc', 'mail.token'), r.home);
    try {
      r.rows.row = fleetRow({ agentOps: ['update'] });               // held: no rotation rewrites the file
      truncateSync(paths.current, 0);
      await r.driver.tick();
      expect(await r.lane(leaked)).toBe(400);                         // the last good value is kept
      expect(r.driver.view().fileProblem).toMatchObject({ file: 'current', word: 'unusable' });
      r.clock.offset = TOKEN_FILE_REREAD_MS + 1000;
      await r.driver.tick();
      expect(r.printed.filter((l) => l.includes(`${paths.current} carries no usable value on re-read`))).toHaveLength(1);
      const st = await readState(paths.state);
      expect(st.kind === 'state' && st.state.fileProblem?.word).toBe('unusable');
    } finally { await r.app.close(); }
  });

  it('a retired value written into mail.token at run time: still refused, warned, never adopted', async () => {
    const leaked = 'e'.repeat(64);
    const r = await rig({ handMade: leaked });
    const paths = tokenPaths(path.join(r.home, '.ccrc', 'mail.token'), r.home);
    try {
      await r.driver.tick();                                          // rotate
      const fresh = r.fleetValue() as string;
      r.clock.offset = GRACE_MS + 1000;
      await r.lane(fresh);
      await r.driver.tick();                                          // the leaked value retired
      writeFileSync(paths.current, `${leaked}\n`, { mode: 0o600 });  // an older deploy.sh ships it back
      r.clock.offset = TOKEN_FILE_REREAD_MS + 2000;
      await r.driver.tick();
      expect(await r.lane(leaked)).toBe(401);
      expect(r.boot.holder.currentValue()).toBe(fresh);
      expect(await r.lane(fresh)).toBe(400);
      expect(r.driver.view().fileProblem).toMatchObject({ file: 'current', word: 'retired' });
      expect(r.printed.some((l) => l.includes(`${paths.current} holds a retired value on re-read`))).toBe(true);
    } finally { await r.app.close(); }
  });
});

describe('tokenSyncLinkOver maps every answer to one SyncResult', () => {
  const G = '0123456789abcdef';
  const over = (impl: () => Promise<unknown>) => {
    const request = vi.fn(impl);
    return { link: tokenSyncLinkOver({ request } as never), request };
  };
  it('sends only the code, with the op\'s own deadline', async () => {
    const { link, request } = over(async () => ({ t: 'res', id: 1, ok: true, synced: G, transport: 'http' }));
    expect(await link.send('c'.repeat(43))).toEqual({ kind: 'synced', generation: G, transport: 'http' });
    expect(request).toHaveBeenCalledWith({ t: 'req', op: 'token-sync', code: 'c'.repeat(43) }, TOKEN_SYNC_OP_TIMEOUT_MS);
  });
  it.each<[string, () => Promise<unknown>, SyncResult]>([
    ['no transport reads unmeasured', async () => ({ ok: true, synced: G }), { kind: 'synced', generation: G, transport: 'unmeasured' }],
    ['a malformed synced is refused, never synced', async () => ({ ok: true, synced: 'G' }), { kind: 'refused', word: 'spawn-failed', detail: 'the agent answered ok without a generation id' }],
    ['bad-request: the agent predates the op', async () => { throw new AgentOpError('bad-request', null); }, { kind: 'predates-op' }],
    ['a token-sync word', async () => { throw new AgentOpError('stale-client', 'x'); }, { kind: 'refused', word: 'stale-client', detail: 'x' }],
    ['another agent word', async () => { throw new AgentOpError('weird', null); }, { kind: 'refused', word: 'spawn-failed', detail: 'weird' }],
    ['never sent', async () => { throw new LinkNotSentError('disconnected'); }, { kind: 'unsent' }],
    ['timeout after the send', async () => { throw new Error('timeout'); }, { kind: 'lost', why: 'timeout' }],
    ['disconnected after the send', async () => { throw new Error('disconnected'); }, { kind: 'lost', why: 'disconnected' }],
  ])('%s', async (_n, impl, want) => {
    expect(await over(impl).link.send('c'.repeat(43))).toEqual(want);
  });
});

describe('generationReaderOver', () => {
  it('reads absent, an id, and malformed as unreadable; measuredAt is taken after the read resolves', async () => {
    const dir = mkTmp('ccrc-token-gen-');
    let t = 100;
    const order: string[] = [];
    const io: FleetIO = { ...localIO, lstatMeasured: async (p) => { order.push('lstat'); return localIO.lstatMeasured(p); } };
    const reader = generationReaderOver(io, dir, () => { order.push('now'); return ++t; });
    expect((await reader.read()).read).toEqual({ kind: 'absent' });
    writeFileSync(path.join(dir, 'box-token-generation'), '0123456789abcdef\n');
    order.length = 0;
    expect(await reader.read()).toEqual({ read: { kind: 'id', id: '0123456789abcdef' }, measuredAt: 102 });
    expect(order).toEqual(['lstat', 'now']);
    writeFileSync(path.join(dir, 'box-token-generation'), 'nope\n');
    expect((await reader.read()).read).toEqual({ kind: 'unreadable' });
  });
});

describe('gateRowsOver', () => {
  it('maps live node rows to the gate\'s shape, measuring the node id with the store\'s own rule; no coord is null', () => {
    const row = { nodeId: NODE, role: 'fleet', label: 'fleet', reachable: true, os: 'linux', caps: ['token-sync'],
      agentOps: ['update', 'token-sync'], updateState: 'idle', reportedPhase: null } as never;
    const placeholder = { ...(row as object), nodeId: 'fleet' } as never;
    const src = gateRowsOver({ nodes: () => [row, placeholder] }, () => true, () => 7);
    expect(src.nodes()).toEqual([fleetRow(), fleetRow({ nodeId: 'fleet', nodeIdMeasured: false })]);
    expect([src.linkUp(), src.lastReadyAt()]).toEqual([true, 7]);
    expect(gateRowsOver(null, () => false, () => null).nodes()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
mkdir -p .tmp-a9 && (cd server && TMPDIR="$PWD/../.tmp-a9" ./node_modules/.bin/vitest run test/token-rotation-e2e.test.ts)
```

Expected:

```text
Error: Cannot find module '../src/token/driver.js' imported from …/server/test/token-rotation-e2e.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/token/link.ts`:

```ts
// The driver's two fleet adapters, ring L3: the `token-sync` op over the one
// agent connection, and the fleet's `box-token-generation` read through the
// inventory's own `readNodeFile` (lstat-gated, size-capped, deadline-bounded;
// D-4389). Neither narrows what it received: every answer of the op is one
// `SyncResult` arm, and the generation read keeps absent, unreadable and an id
// apart (`readGenerationFile`, the one reader).
import path from 'node:path';
import { AgentOpError, LinkNotSentError, type FleetClient } from '../remote/client.js';
import type { FleetIO } from '../io.js';
import { INVENTORY_BUDGET_MS, readNodeFile } from '../update/inventory.js';
import { openPoolReadDeadline } from '../pools.js';
import {
  NODE_FILES, TOKEN_SYNC_OP, TOKEN_SYNC_OP_TIMEOUT_MS, isTokenSyncOpError, readTokenTransport,
} from '../../../shared/agent-protocol.js';
import { GENERATION_ID_RE, readGenerationFile } from '../../../shared/box-token.js';
import type { GateRowsSource, GenerationReader, TokenSyncLink } from './ports.js';
import type { GateNode, SyncResult } from './policy.js';
import { NODE_ID_RE, type NodeRow } from '../coord/store.js';

const LOST_WORDS = ['timeout', 'disconnected', 'aborted'] as const;

/** `request` with the op's own 50 s deadline (`FleetClient`'s default is 15 s). `bad-request` from this op means
 *  the agent predates it; a `LinkNotSentError` means the frame never left; a plain Error after the send (timeout,
 *  disconnected, aborted) is a LOST result — the fleet may already hold the value. */
export function tokenSyncLinkOver(client: Pick<FleetClient, 'request'>): TokenSyncLink {
  return {
    async send(code: string): Promise<SyncResult> {
      try {
        const res = await client.request({ t: 'req', op: TOKEN_SYNC_OP, code }, TOKEN_SYNC_OP_TIMEOUT_MS);
        const synced = (res as { synced?: unknown }).synced;
        if (typeof synced === 'string' && GENERATION_ID_RE.test(synced)) {
          return { kind: 'synced', generation: synced, transport: readTokenTransport((res as { transport?: unknown }).transport) };
        }
        return { kind: 'refused', word: 'spawn-failed', detail: 'the agent answered ok without a generation id' };
      } catch (e) {
        if (e instanceof AgentOpError) {
          if (e.code === 'bad-request') return { kind: 'predates-op' };
          if (isTokenSyncOpError(e.code)) return { kind: 'refused', word: e.code, detail: e.detail };
          return { kind: 'refused', word: 'spawn-failed', detail: e.detail ?? e.code };
        }
        if (e instanceof LinkNotSentError) return { kind: 'unsent' };
        const m = e instanceof Error ? e.message : '';
        const why = (LOST_WORDS as readonly string[]).includes(m) ? (m as (typeof LOST_WORDS)[number]) : 'disconnected';
        return { kind: 'lost', why };
      }
    },
  };
}

/** One bounded read of `<ccrcDir>/box-token-generation` over the fleet's io; `measuredAt` is taken AFTER the
 *  read resolved, so a confirmation can never predate what it read (D-4389). Never rejects. */
export function generationReaderOver(io: FleetIO, ccrcDir: string, now: () => number): GenerationReader {
  return {
    async read() {
      const deadline = openPoolReadDeadline(INVENTORY_BUDGET_MS);
      try {
        const r = await readNodeFile(io, path.join(ccrcDir, NODE_FILES.tokenGeneration), deadline);
        return { read: readGenerationFile(r), measuredAt: now() };
      } catch {
        return { read: { kind: 'unreadable' }, measuredAt: now() };
      } finally {
        deadline?.close();
      }
    },
  };
}

/** The gate's rows over the inventory's live node rows (an addition to the contract, which placed this mapping in
 *  `index.ts`; a mapping is adapter work, and L5 composes only). `nodeIdMeasured` is the store's own `NODE_ID_RE`,
 *  never re-spelled. A null store is "no coord" (the hold `no-coord`). */
export function gateRowsOver(store: { nodes(): NodeRow[] } | null, linkUp: () => boolean, lastReadyAt: () => number | null): GateRowsSource {
  return {
    nodes: (): readonly GateNode[] | null => store === null ? null : store.nodes().map((n) => ({
      nodeId: n.nodeId, nodeIdMeasured: NODE_ID_RE.test(n.nodeId), label: n.label, role: n.role, reachable: n.reachable,
      os: n.os, caps: n.caps, agentOps: n.agentOps, updateState: n.updateState, reportedPhase: n.reportedPhase,
    })),
    linkUp,
    lastReadyAt,
  };
}
```

Create `server/src/token/driver.ts`:

```ts
// The box-token driver, ring L4 (spec §5): its own unref'd 60 s timer, one
// tick at a time, and nothing decided here — every step is `nextAction`'s
// answer (token/policy.ts, L1), and every state change is a policy function.
// The driver owns the timer, the in-memory values (in the holder), the order of
// the file steps, and the log lines. It is registered from `index.ts`, never a
// lane in `watch.ts`.
//
// Never logs a value, a code or a digest: its lines carry generation sequence
// numbers, words and node labels only.
import { valueDigestHex } from './files.js';
import { ClaimDoor } from './door.js';
import {
  DRIVER_TICK_MS, FAILURES_FOR_BANNER, ROTATE_NOW_MIN_INTERVAL_MS, STALL_ALERT_MS, TOKEN_FILE_REREAD_MS, applySyncResult,
  backoffMs, extendedGraceState, handedOutState, nextAction, owe, mintedState, phaseOf, promotedState, rotationGate,
  stagedState, type BoxTokenState, type GateInput, type GateVerdict, type GenerationObservation,
} from './policy.js';
import type { BothRoleWriter, GateRowsSource, GenerationReader, TokenStore, TokenSyncLink } from './ports.js';
import type { BoxTokenHolder, HolderSlots } from '../coord/token.js';
import type { BootResult } from './boot.js';
import type { TokenRouteDriver } from './routes.js';
import type { BoxTokenView, OwedReason, RotateAnswer, TokenFileProblem, TokenHold } from '../../../shared/box-token.js';

/** The re-read's finding, as a log phrase (plan assembly). Words only: never a value, a digest or a length. */
const FILE_PROBLEM_TEXT: Readonly<Record<TokenFileProblem, string>> = {
  missing: 'is missing', unusable: 'carries no usable value', placeholder: 'holds the shipped placeholder',
  unreadable: 'cannot be read', changed: 'was changed outside the server', retired: 'holds a retired value',
};
type FileProblem = NonNullable<BoxTokenView['fileProblem']>;

export interface DriverDeps {
  store: TokenStore; holder: BoxTokenHolder; door?: ClaimDoor;
  link: TokenSyncLink | null;
  generation: GenerationReader | null;
  rows: GateRowsSource;
  env: Pick<GateInput, 'fleetMode' | 'role' | 'roleSource' | 'agentEnvMarksFleet'>;
  bothWriter: BothRoleWriter | null;
  now?: () => number; warn?: (line: string) => void;
}

const errno = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? (e instanceof Error ? e.message : 'error');
const MAX_STEPS = 8;

export class BoxTokenDriver implements TokenRouteDriver {
  readonly door: ClaimDoor;
  private state: BoxTokenState | null;
  private mintFailed: boolean;
  private hold: { hold: TokenHold; node: string | null } | null = null;
  private learned: GateInput['learned'] = null;
  private backoffUntil: number | null = null;
  private lastReadySeen: number | null = null;
  private rotateRequested = false;
  private lastRotateStart = Number.NEGATIVE_INFINITY;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private presentedBase: number;
  private lastObs: GenerationObservation | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly warn: (line: string) => void;
  /** The values in memory, mirrored into the holder by `pushSlots`. `previous` is loaded once from its file. */
  private cur: string | null;
  private readonly pend = new Map<string, string>();
  private prev: { value: string; until: number } | null | undefined = undefined;
  // Plan assembly (review findings): the re-read's clock and its warned findings, the generations already reported
  // unaccounted for, when this process first saw a rotation owed (the stall alert), and when a failed mint began.
  private lastReread = Number.NEGATIVE_INFINITY;
  private readonly fileWarned = new Set<string>();
  private readonly unaccounted = new Set<string>();
  private owedSince: number | null = null;
  private mintFailedSince: number | null;

  constructor(private readonly deps: DriverDeps, boot: BootResult) {
    this.now = deps.now ?? Date.now;
    this.warn = deps.warn ?? ((l) => console.warn(l));
    this.state = boot.state;
    this.mintFailed = boot.mintFailed;
    this.mintFailedSince = boot.mintFailed ? (boot.state?.mintFailedAt ?? this.now()) : null;
    this.door = deps.door ?? new ClaimDoor({ valueOf: (g) => this.deps.holder.pendingValue(g), warn: this.warn });
    this.cur = deps.holder.currentValue();
    for (const p of boot.state?.pending ?? []) {
      const v = deps.holder.pendingValue(p.id);
      if (v !== null) this.pend.set(p.id, v);
    }
    this.presentedBase = deps.holder.counters().matched.current;
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, DRIVER_TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Single-flight: a tick while one runs joins it. */
  tick(): Promise<void> {
    if (this.running !== null) return this.running;
    this.running = this.runTick()
      .catch((e) => { this.warn(`ccrc-server: box token: a driver tick failed (${errno(e)}); the next tick retries`); })
      .finally(() => { this.running = null; });
    return this.running;
  }

  async rotateNow(now: number): Promise<RotateAnswer> {
    const s = this.state;
    if ((s !== null && s.pending.length > 0) || this.rotateRequested) return { ok: true, outcome: 'joined', view: this.view() };
    const since = now - this.lastRotateStart;
    if (since < ROTATE_NOW_MIN_INTERVAL_MS) {
      return { ok: false, error: 'rate-limited', retryAfterS: Math.ceil((ROTATE_NOW_MIN_INTERVAL_MS - since) / 1000) };
    }
    const gate = this.gate(now);
    if (!gate.open) return { ok: false, error: 'held', hold: gate.hold, node: gate.node, view: this.view() };
    this.rotateRequested = true;
    this.lastRotateStart = now;
    void this.tick();
    return { ok: true, outcome: 'started', view: this.view() };
  }

  /** The claim door's hand-out, persisted (fsynced) BEFORE the 200 (D-4394). A failed write discards the
   *  generation, so it is never handed out, and rejects: the route answers 503. */
  async commitHandOut(generation: string, at: number): Promise<void> {
    const s = this.state;
    if (s === null || !s.pending.some((p) => p.id === generation && p.handedOutAt === null)) {
      throw new Error('commitHandOut: the generation is not staged');
    }
    const next = handedOutState(s, generation, at);
    try {
      await this.persist(next);
      this.state = next;
      const g = next.pending.find((p) => p.id === generation);
      this.warn(`ccrc-server: box token: generation #${g?.seq} handed out`);
    } catch (e) {
      await this.discard([generation]);
      this.warn(`ccrc-server: box token: the hand-out of a generation could not be recorded (${errno(e)}); it was discarded`);
      throw e;
    }
  }

  view(): BoxTokenView {
    const s = this.state;
    const c = this.deps.holder.counters();
    const obs = this.lastObs?.read;
    const fleetConfirmed: BoxTokenView['fleetConfirmed'] =
      s !== null && s.current.id !== null && s.fleetConfirmed === s.current.id ? (this.deps.bothWriter !== null ? 'own-write' : 'current')
        : obs === undefined ? 'unknown' : obs.kind === 'id' ? 'behind' : obs.kind;
    const now = this.now();
    const stalled: BoxTokenView['stalled'] = this.mintFailed && this.mintFailedSince !== null
      ? { why: 'mint-failed', since: this.mintFailedSince }
      : this.owedSince !== null && now - this.owedSince >= STALL_ALERT_MS ? { why: 'owed', since: this.owedSince } : null;
    return {
      phase: phaseOf(s, this.hold?.hold ?? null, this.deps.holder.hasCurrent()),
      origin: s?.origin ?? null,
      currentSeq: s?.current.seq ?? null,
      currentSince: s?.current.since ?? null,
      lastRotationAt: s?.lastRotationAt ?? null,
      rotationOwed: s?.rotationOwed ?? false,
      owedWhy: s?.owedWhy ?? null,
      hold: this.hold?.hold ?? null,
      holdNode: this.hold?.node ?? null,
      failures: s?.failures ?? 0,
      lastFailure: this.mintFailed ? 'mint-failed' : s?.lastFailure ?? null,
      banner: (s?.failures ?? 0) >= FAILURES_FOR_BANNER,
      stalled,
      fileProblem: s?.fileProblem ?? null,
      fleetConfirmed,
      fleetTransport: s?.lastSync?.transport ?? null,
      lastSync: s?.lastSync ? { at: s.lastSync.at, word: s.lastSync.word } : null,
      previousPresented: c.matched.previous,
      retiredPresented: c.retired,
      retiredRefused: s?.retiredRefusedAt != null,
      lastBootRecovery: s?.lastBootRecovery ?? null,
      role: this.deps.env.role,
    };
  }

  // ── one tick ───────────────────────────────────────────────────────────────

  private async runTick(): Promise<void> {
    const ready = this.deps.rows.lastReadyAt();
    if (ready !== null && ready !== this.lastReadySeen) {
      if (this.lastReadySeen !== null) this.backoffUntil = null;   // a fresh ready resets the backoff (spec §5.1)
      this.lastReadySeen = ready;
    }
    await this.loadPrevious();
    this.drainDoorAlerts();
    await this.noteCounters();
    await this.reread(this.now());
    this.noteUnaccounted(this.now());
    this.noteOwed(this.now());
    let obs: GenerationObservation | null = null;
    if (this.deps.generation !== null && this.deps.rows.linkUp() && this.state !== null) {
      obs = await this.deps.generation.read();
      this.lastObs = obs;
    }
    for (let step = 0; step < MAX_STEPS; step++) {
      const now = this.now();
      const a = nextAction({ state: this.state, gate: this.gate(now), generation: obs,
        rotateRequested: this.rotateRequested, backoffUntil: this.backoffUntil, now });
      if (a.kind !== 'hold') this.setHold(null);
      switch (a.kind) {
        case 'none': case 'backoff': return;
        case 'hold': this.setHold({ hold: a.hold, node: a.node }); return;
        case 'retry-mint': if (!(await this.retryMint(now))) return; break;
        case 'stage': if (!(await this.stage(a.why, now))) return; break;
        case 'send': await this.send(a.generation, a.nodeId); return;
        case 'promote': await this.promote(a.generation, a.via); return;
        case 'retire': await this.retire(a.why, now); break;
        case 'extend-grace': await this.commit(extendedGraceState(this.mustState(), now));
          this.warn('ccrc-server: box token: grace extended: the new value has not been presented yet; a forward rotation is owed');
          break;
      }
    }
  }

  private gate(now: number): GateVerdict {
    const handedOut = this.state?.pending.filter((p) => p.handedOutAt !== null).length ?? 0;
    return rotationGate({ ...this.deps.env, nodes: this.deps.rows.nodes(), linkUp: this.deps.rows.linkUp(),
      learned: this.learned, lastReadyAt: this.deps.rows.lastReadyAt(), handedOutUnconfirmed: handedOut,
      mintFailed: this.mintFailed, now });
  }

  private async retryMint(now: number): Promise<boolean> {
    const v = this.deps.store.mintValue();
    try {
      const rec = await this.deps.store.writeValue(this.deps.store.paths.current, v);
      const owed: OwedReason | null = this.state === null ? null : 'recovered';
      this.state = mintedState(now, rec, this.state, owed, this.deps.store.mintGenerationId());
      this.mintFailed = false;
      this.mintFailedSince = null;
      this.cur = v;
      this.pushSlots();
      await this.commit(this.state);
      this.warn(`ccrc-server: box token: minted a new value at ${this.deps.store.paths.current} after a failed mint`);
      return true;
    } catch {
      return false;
    }
  }

  private async stage(why: OwedReason | 'rotate-now', now: number): Promise<boolean> {
    const store = this.deps.store;
    const id = store.mintGenerationId();
    const v = store.mintValue();
    let s = this.mustState();
    try {
      const rec = await store.writeValue(store.paths.pending(id), v);
      s = stagedState(this.mustState(), id, now, rec);
    } catch (e) {
      await this.commit({ ...s, failures: s.failures + 1, lastFailure: 'mint-failed' });
      this.backoffUntil = now + backoffMs(s.failures + 1);
      this.warn(`ccrc-server: box token: could not stage a generation (${errno(e)}); retrying with backoff`);
      return false;
    }
    if (why !== 'rotate-now') s = owe(s, why);
    this.rotateRequested = false;
    this.state = s;
    this.pend.set(id, v);
    this.pushSlots();                 // the check accepts G from staging (spec §5)
    await this.commit(s);
    this.warn(`ccrc-server: box token: rotation started (generation #${s.pending[s.pending.length - 1].seq}, ${why})`);
    return true;
  }

  private async send(id: string, nodeId: string): Promise<void> {
    const link = this.deps.link;
    if (link === null) return;
    const code = this.door.issue(id, nodeId, this.now());
    const r = await link.send(code);
    this.door.revoke(id);
    const before = this.mustState();
    const out = applySyncResult(before, id, r, this.now());
    if (out.learned !== null) {
      this.learned = out.learned;
      this.warn(`ccrc-server: box token: held: ${out.learned.hold} (re-probed on the next ready, or in an hour)`);
    }
    const dropped = before.pending.filter((p) => !out.state.pending.some((q) => q.id === p.id)).map((p) => p.id);
    this.state = out.state;
    await this.discard(dropped);
    if (out.state.failures > before.failures) {
      this.backoffUntil = this.now() + backoffMs(out.state.failures);
      this.warn(`ccrc-server: box token: sync failed (${out.state.lastFailure}); attempt ${out.state.failures}, retrying with backoff`);
    }
    if (r.kind === 'synced') this.backoffUntil = null;
    await this.commit(this.mustState());
    if (out.promote !== null) await this.promote(out.promote, 'op-result');
  }

  /** Spec §5 promotion, in its order; each step is safe to run again. */
  private async promote(id: string, via: 'op-result' | 'generation-read' | 'own-write'): Promise<void> {
    const store = this.deps.store;
    const s0 = this.mustState();
    const g = s0.pending.find((p) => p.id === id);
    const value = this.pend.get(id) ?? null;
    if (g === undefined || value === null) {
      await this.commit(owe({ ...s0, promoting: null }, 'recovered'));
      this.warn('ccrc-server: box token: a promotion named no pending value; it was abandoned and a rotation is owed');
      return;
    }
    if (via === 'own-write') {
      try { await this.deps.bothWriter?.write(value, id); } catch (e) {
        const f = s0.failures + 1;
        await this.commit({ ...s0, failures: f, lastFailure: 'write-failed' });
        this.backoffUntil = this.now() + backoffMs(f);
        this.warn(`ccrc-server: box token: could not write the fleet file on this both box (${errno(e)}); retrying with backoff`);
        return;
      }
    }
    // A previous value still in grace is retired first: the fleet has confirmed a later one.
    if (s0.previous !== null) await this.retireValue(s0);
    await this.commit({ ...this.mustState(), promoting: { id } });                                   // (a)
    const renamed = (await store.readValue(store.paths.pending(id))).kind === 'absent';
    let prevWrite = null;
    if (!renamed) {
      prevWrite = this.cur !== null ? await store.writeValue(store.paths.previous, this.cur) : null; // (b)
      await store.renameOver(store.paths.pending(id), store.paths.current);                         // (c)
    }
    const others = this.mustState().pending.filter((p) => p.id !== id).map((p) => p.id);
    const now = this.now();
    let next = promotedState({ ...this.mustState(), promoting: null }, id, now, prevWrite);           // (d)
    if (via === 'own-write') next = { ...next, fleetConfirmed: id };
    for (const o of others) { this.door.revoke(o); await store.removeValue(store.paths.pending(o)); this.pend.delete(o); }
    this.prev = this.cur !== null && next.previous !== null ? { value: this.cur, until: next.previous.hardUntil } : null;
    this.cur = value;
    this.pend.delete(id);
    this.pushSlots();
    await this.commit(next);
    this.presentedBase = this.deps.holder.counters().matched.current;
    this.warn(`ccrc-server: box token: generation #${g.seq} confirmed (${via}) and promoted; the previous value stays accepted for grace`);
  }

  private async retire(why: 'grace' | 'hard-bound', now: number): Promise<void> {
    await this.retireValue(this.mustState());
    const s = this.mustState();
    this.warn(why === 'hard-bound'
      ? 'ccrc-server: box token: the previous value was retired at the hard bound, before the new value was presented'
      : `ccrc-server: box token: grace ended; the previous value was retired${s.retiredRefusedAt === now ? ' and is refused' : ''}`);
  }

  /** Retirement: the digest is kept, the file deleted, the slot emptied, then the check is run with the retiring
   *  value and "retired value refused" recorded (spec §5, §10.3). */
  private async retireValue(s: BoxTokenState): Promise<void> {
    const store = this.deps.store;
    const now = this.now();
    let v = this.prev?.value ?? null;
    if (v === null) { const r = await store.readValue(store.paths.previous); v = r.kind === 'value' ? r.value : null; }
    if (v !== null) {
      try { await store.appendRetired(valueDigestHex(v), now); } catch (e) {
        this.warn(`ccrc-server: box token: could not record a retired digest (${errno(e)}); the value is still removed`);
      }
    }
    await store.removeValue(store.paths.previous);
    this.prev = null;
    this.pushSlots();
    const rr = await store.readRetired();
    if (rr.kind === 'retired') this.deps.holder.setRetired(rr.digests);
    const refused = v !== null && this.deps.holder.match(v) === null && this.deps.holder.isRetired(v);
    await this.commit({ ...s, previous: null, retiredRefusedAt: refused ? now : s.retiredRefusedAt });
  }

  // ── bookkeeping ────────────────────────────────────────────────────────────

  private mustState(): BoxTokenState {
    if (this.state === null) throw new Error('box token driver: no state');
    return this.state;
  }

  private async loadPrevious(): Promise<void> {
    if (this.prev !== undefined) return;
    const s = this.state;
    if (s?.previous == null) { this.prev = null; return; }
    const r = await this.deps.store.readValue(this.deps.store.paths.previous);
    this.prev = r.kind === 'value' ? { value: r.value, until: s.previous.hardUntil } : null;
  }

  private pushSlots(): void {
    const slots: HolderSlots = {
      current: this.cur,
      pending: (this.state?.pending ?? []).filter((p) => this.pend.has(p.id)).map((p) => ({ id: p.id, value: this.pend.get(p.id) as string })),
      previous: this.prev ?? null,
    };
    this.deps.holder.setSlots(slots);
  }

  private async discard(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    for (const id of ids) {
      this.door.revoke(id);
      this.pend.delete(id);
      await this.deps.store.removeValue(this.deps.store.paths.pending(id));
    }
    if (this.state !== null) this.state = { ...this.state, pending: this.state.pending.filter((p) => !ids.includes(p.id)) };
    this.pushSlots();
  }

  private drainDoorAlerts(): void {
    const a = this.door.alerts;
    if (a.wrongNode.length > 0 && this.state !== null) this.state = owe(this.state, 'claim-misbound');
    a.wrongNode.splice(0);
    a.expired.splice(0);
  }

  private async noteCounters(): Promise<void> {
    const s = this.state;
    if (s === null) return;
    const c = this.deps.holder.counters();
    let next = s;
    if (s.previous !== null && !s.previous.currentPresented && c.matched.current > this.presentedBase) {
      next = { ...next, previous: { ...s.previous, currentPresented: true } };
    }
    if (s.counters.previousPresented !== c.matched.previous || s.counters.retiredPresented !== c.retired) {
      next = { ...next, counters: { previousPresented: c.matched.previous, retiredPresented: c.retired } };
    }
    if (next !== s) await this.commit(next);
  }

  private setHold(h: { hold: TokenHold; node: string | null } | null): void {
    const same = (this.hold?.hold ?? null) === (h?.hold ?? null) && (this.hold?.node ?? null) === (h?.node ?? null);
    this.hold = h;
    if (this.state !== null) this.state = { ...this.state, hold: h?.hold ?? null, holdNode: h?.node ?? null };
    if (!same && h !== null) this.warn(`ccrc-server: box token: held: ${h.hold}${h.node !== null ? ` (${h.node})` : ''}`);
    // Spec §5.1 "Pending values": reaching the cap takes repeated lost hand-outs, which is itself the alert.
    if (!same && h?.hold === 'pending-cap') {
      this.warn('ccrc-server: box token: handed-out values unaccounted for: the pending cap is reached, and no rotation starts until the fleet confirms one');
    }
  }

  /** Spec 4.2's run-time re-read (plan assembly), at the readiness cadence: every server token file this driver holds
   *  a value for is read again and compared with memory. Memory always wins: an out-of-band edit is never adopted at
   *  run time (a restart adopts it, as today), a broken file never empties a slot, and a retired value written back is
   *  never accepted. A finding is warned once while it stands; the first one is recorded for doctor and the card. */
  private async reread(now: number): Promise<void> {
    if (now - this.lastReread < TOKEN_FILE_REREAD_MS) return;
    this.lastReread = now;
    const store = this.deps.store;
    const checks: { file: FileProblem['file']; path: string; want: string }[] = [];
    if (this.cur !== null) checks.push({ file: 'current', path: store.paths.current, want: this.cur });
    for (const [id, v] of this.pend) checks.push({ file: 'pending', path: store.paths.pending(id), want: v });
    if (this.prev) checks.push({ file: 'previous', path: store.paths.previous, want: this.prev.value });
    let found: FileProblem | null = null;
    const standing = new Set<string>();
    for (const c of checks) {
      const r = await store.readValue(c.path);
      const word: TokenFileProblem | null = r.kind === 'value'
        ? (r.value === c.want ? null : this.deps.holder.isRetired(r.value) ? 'retired' : 'changed')
        : r.kind === 'absent' ? 'missing' : r.kind;
      if (word === null) continue;
      found ??= { at: now, file: c.file, word };
      const key = `${c.path} ${word}`;
      standing.add(key);
      if (!this.fileWarned.has(key)) {
        this.warn(`ccrc-server: box token: ${c.path} ${FILE_PROBLEM_TEXT[word]} on re-read; the last good value is kept in memory`);
      }
    }
    this.fileWarned.clear();
    for (const k of standing) this.fileWarned.add(k);
    const s = this.state;
    const was = s?.fileProblem ?? null;
    if (s !== null && (was?.file !== found?.file || was?.word !== found?.word)) await this.commit({ ...s, fileProblem: found });
  }

  /** Spec §6 "Someone claims first": a handed-out value past its deadline is unaccounted for. Once per generation. */
  private noteUnaccounted(now: number): void {
    for (const p of this.state?.pending ?? []) {
      if (p.confirmBy === null || now <= p.confirmBy || this.unaccounted.has(p.id)) continue;
      this.unaccounted.add(p.id);
      this.warn(`ccrc-server: box token: a handed-out value is unaccounted for (generation #${p.seq}); it stays accepted until a later generation is confirmed`);
    }
  }

  /** The stall alert's clock: when this process first saw a rotation owed; cleared once nothing is owed. */
  private noteOwed(now: number): void {
    if (this.state?.rotationOwed !== true) this.owedSince = null;
    else if (this.owedSince === null) this.owedSince = now;
  }

  /** Set and persist the state; writes are serialised so a later write never lands before an earlier one. */
  private async commit(s: BoxTokenState): Promise<void> {
    this.state = s;
    await this.persist(s);
  }

  private persist(s: BoxTokenState): Promise<void> {
    const run = this.persistChain.then(() => this.deps.store.writeState(s));
    this.persistChain = run.catch(() => {});
    return run;
  }
}
```

In `server/src/index.ts`, extend the import A7 added:

```ts
import { bootBoxToken } from './token/boot.js';
```

becomes

```ts
import { bootBoxToken } from './token/boot.js';
import { BoxTokenDriver } from './token/driver.js';
import { fileBothRoleWriter, fileTokenStore, tokenPaths } from './token/files.js';
import { gateRowsOver, generationReaderOver, tokenSyncLinkOver } from './token/link.js';
```

Insert immediately before `const app = await buildServer(deps, bus, watcher);` (after the existing `fleetClient?.onConnected(() => watcher.triggerInventory());`, which `update-inventory.test.ts` pins and which stays exactly as it is):

```ts
// The box-token driver (spec §5): its own unref'd 60 s timer, never a lane in
// watch.ts. Built before buildServer so the claim door and the rotate route read
// it from `deps.tokenDriver`; started after listen. `lastReadyAt` is the time
// of the last agent handshake, which re-probes a learned hold and resets backoff.
let lastReadyAt: number | null = null;
fleetClient?.onConnected(() => { lastReadyAt = Date.now(); });
const tokenStore = fileTokenStore(tokenPaths(cfg.mailTokenPath, cfg.home));
const tokenDriver = new BoxTokenDriver({
  store: tokenStore, holder: tokenBoot.holder,
  link: fleetClient === null ? null : tokenSyncLinkOver(fleetClient),
  generation: fleetClient === null ? null : generationReaderOver(deps.io, cfg.ccrcDir, Date.now),
  rows: gateRowsOver(coord, () => cfg.fleetMode === 'remote' && (deps.fleetState?.connected ?? false), () => lastReadyAt),
  env: { fleetMode: cfg.fleetMode, role: cfg.role, roleSource: cfg.roleSource, agentEnvMarksFleet: tokenBoot.agentEnvMarksFleet },
  bothWriter: tokenBoot.bothWriterArmed ? fileBothRoleWriter(tokenStore.paths) : null,
}, tokenBoot);
deps.tokenDriver = tokenDriver;

```

and after `await app.listen({ host: cfg.host, port: cfg.port });` add the one line

```ts
tokenDriver.start();
```

`deps.io` is `fleet.io` in the remote arm, so the generation read goes over the agent (D-4389); `cfg.ccrcDir` is the same `~/.ccrc` path the inventory sweep reads the fleet node's files under.

- [ ] **Step 4: Run it to verify it passes**

```bash
mkdir -p .tmp-a9 && (cd server && TMPDIR="$PWD/../.tmp-a9" ./node_modules/.bin/vitest run test/token-rotation-e2e.test.ts)
```

Expected: `Tests  28 passed (28)` (20 prototyped plus the eight cases added at plan assembly; one of them skips as root).

- [ ] **Step 5: Mutation check.** In `server/src/token/driver.ts`, replace

```ts
    if (this.running !== null) return this.running;
```

with

```ts

```

and run `mkdir -p .tmp-a9 && (cd server && TMPDIR="$PWD/../.tmp-a9" ./node_modules/.bin/vitest run test/token-rotation-e2e.test.ts)` from the repo root. Expected: `× an owed rotation, "Rotate now" and a second tick at once produce one generation` — `1 failed | 19 passed` (measured on the 19-case file). Restore the line and re-run: all green.

- [ ] **Step 6: Mutation check.** In `server/src/token/driver.ts`, replace

```ts
      await this.persist(next);
      this.state = next;
```

with

```ts
      this.state = next;
```

and run `mkdir -p .tmp-a9 && (cd server && TMPDIR="$PWD/../.tmp-a9" ./node_modules/.bin/vitest run test/token-rotation-e2e.test.ts)` from the repo root. Expected: `× a hand-out that cannot be recorded answers 503, is never handed out, and the old value stays current` (D-4394) — `1 failed` (measured). Restore the line and re-run: all green.

- [ ] **Step 7: Mutation check.** In `server/src/token/driver.ts`, replace

```ts
      prevWrite = this.cur !== null ? await store.writeValue(store.paths.previous, this.cur) : null; // (b)
```

with

```ts
      prevWrite = null;
```

and run `mkdir -p .tmp-a9 && (cd server && TMPDIR="$PWD/../.tmp-a9" ./node_modules/.bin/vitest run test/token-rotation-e2e.test.ts)` from the repo root. Expected: three red — `× adopted value -> staged, handed out, confirmed…`, `× the handed-out value stays accepted…`, `× the written-back value answers 401…` (the old value is dropped at promotion instead of kept for grace; measured). Restore the line and re-run: all green.

- [ ] **Step 8: Mutation check.** In `server/src/token/driver.ts`, replace

```ts
    const refused = v !== null && this.deps.holder.match(v) === null && this.deps.holder.isRetired(v);
```

with

```ts
    const refused = false;
```

and run `mkdir -p .tmp-a9 && (cd server && TMPDIR="$PWD/../.tmp-a9" ./node_modules/.bin/vitest run test/token-rotation-e2e.test.ts)` from the repo root. Expected: `× adopted value -> staged, handed out, confirmed by the op result, promoted; grace; retired once presented` (`retiredRefused` stays false) — `1 failed` (measured). Restore the line and re-run: all green.

- [ ] **Step 8b: Mutation checks for the guards added at plan assembly (not prototyped; measure each red, restore, re-run green).** Each runs `token-rotation-e2e.test.ts`:

| Mutation | Expected red |
|---|---|
| `server/src/token/boot.ts`: `mintedState(now, rec, ctx.state, owed, mintGenerationId())` -> `mintedState(now, rec, ctx.state, owed, null as never)` | "fresh server, no fleet file: …" (the fleet box is never sent the op) |
| `driver.ts`: `if (since < ROTATE_NOW_MIN_INTERVAL_MS) {` -> `if (false) {` | "twice within a minute on an idle state: …" |
| `driver.ts`: `if (!gate.open) return { ok: false, error: 'held', hold: gate.hold, node: gate.node, view: this.view() };` -> deleted | "on a closed gate it answers held …" |
| `driver.ts`: `this.state = mintedState(now, rec, this.state, owed, this.deps.store.mintGenerationId());` in `retryMint` -> `throw new Error('mutated');` | "boot mints nothing, … one tick later a lane answers ok" |
| `driver.ts`: the `noteUnaccounted` `this.warn(...)` line -> deleted | "past confirmBy it is warned once, …" |
| `driver.ts`: `now - this.owedSince >= STALL_ALERT_MS` -> `false` | "a rotation owed and held past STALL_ALERT_MS raises the stall alert …" |
| `driver.ts`: `if (now - this.lastReread < TOKEN_FILE_REREAD_MS) return;` -> `return;` | both re-read cases |
| `driver.ts`: `? (r.value === c.want ? null : this.deps.holder.isRetired(r.value) ? 'retired' : 'changed')` -> `? null` | "a retired value written into mail.token at run time: …" |

- [ ] **Step 9: Pins.** None moves: the driver and link register no route and call no `checkMailToken` (the census reads `COORD_SRC`/`SERVER_SRC`/`UPDATE_SRC`, and A8's `TOKEN_SRC`, by name); `MEASURED_FILE_KEYS` already excludes `tokenGeneration` (A1). Re-run the four `index.ts` text pins named in Task A7 Step 9 and `test/boot.test.ts` (the same load-sensitive 3000 ms bound applies; measured 3012/3049 ms with A7+A9 at load ~21). `test/typecheck-tests.test.ts`: measured clean for `src/` and the four new test files.

- [ ] **Step 10: Commit** (afterwards, from the repo root: `rm -rf .tmp-a9`)

```bash
git add server/src/token/link.ts server/src/token/driver.ts server/src/index.ts server/test/token-rotation-e2e.test.ts
git commit -m "feat(token): the rotation driver on its own timer, its link, and a whole rotation in process (A9, D-4389, D-4394, D-4395)

The driver stages, hands out through the claim door, confirms by the op
result or a generation read measured after the hand-out, promotes in the
spec's order, keeps the old value for grace and retires it once the new one
was presented, with a self-check recorded as retired-value-refused. A lost
result promotes nothing until the fleet's generation file names the issued
id; verb-missing and stale-client are named holds, not failures. The token
files are re-read at the readiness cadence (memory kept, findings warned
and recorded), a handed-out value past its deadline is reported unaccounted
for, and the view carries a stall alert for a failed mint or a rotation
owed for a day.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Part B task sections (the ledger's row 2)

Part B note (B1 to B4): Drafted 2026-10-07 from `main` at 282e79e44 against this plan's contract sections. Tasks B1 to B3 were prototyped in a throwaway worktree: each test file was run red, then green, one file per call, in the foreground. Part A had not merged at 282e79e44, so the prototype ran against a LOCAL STAND-IN of Task A1's L0 names (`TOKEN_SYNC_EXIT`, `TOKEN_SYNC_STDERR_PREFIX`, `TOKEN_SYNC_SYNCED_RE`, `CLAIM_CODE_RE`, `TOKEN_SYNC_FROM`, `tokenSyncSpawnArgv`, `NODE_FILES.tokenGeneration`, and `shared/box-token.ts`'s `TOKEN_CLAIM_PATH`, `TOKEN_VALUE_RE`, `GENERATION_ID_RE`, `FLEET_TOKEN_FILE_COMMENT`), spelled exactly as the contract's Interfaces spell them. Part B is built against Part A as merged, so a worker runs these steps on a branch that already carries Part A. Task B4 drives Part A's server, driver and agent op, and could not be run at 282e79e44. Every command below follows the Global Constraints' test rule: one fenced line is one call, run from the repo root in the FOREGROUND with a timeout of at most 600000 ms, each task with its own `.tmp-<task>` directory (`.tmp-b1` to `.tmp-b4`), removed in that task's commit step.

### Task B1: ccrc token sync

(prototype) measured: server/test/ccrc-token-sync.test.ts: red 25 failed (1 passed: the usage case, because an unknown verb is also exit 2) -> green 26 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/ccrc-containment.test.ts: red 1 failed -> green 95 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/ccrc-cli.test.ts: red 1 failed -> green 36 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/ccrc-install.test.ts -t 'ccrc-caps|cap word': red 4 failed -> green 4 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/ccrc-update.test.ts -t (the four `CAPS_NOW` cases): red 4 failed -> green 4 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/macos-platform.test.ts -t 'ccrc-token-sync|corpus is derived': green 2 passed (the case the scan generates for the new file); topology-clean.test.ts 55 passed, source-bytes.test.ts 2 passed, license.test.ts 15 passed, 2026-10-07 on main 282e79e44
(prototype) measured mutations, each red then restored: `set +x` deleted; the stale-client guard always passing; 501 folded into proof-failed; the strict key check deleted; the sweep deleted; the front's data-line rule absent

**Files:**
- Create: `ccd/ccrc-token-sync` (git mode 100755).
- Create: `server/test/ccrc-token-sync.test.ts`.
- Modify: `ccd/ccrc` at 282e79e44: the cap-word comment and array (1379-1382), the usage verb line (2011), a usage paragraph inserted before `  restamp   re-stamp …` (2229), `cmd_token` inserted after `cmd_adopt`'s closing brace (5235), the dispatch line inserted after `  expose)  cmd_expose "$@" ;;` (23816).
- Modify (CONTRACT ADDITION, test infrastructure): `server/test/containedTools.ts` — the front's docstring (69), `CLAIM_DATA_LINE_ERE` inserted after `plantPoison`'s closing brace (56), `cfg_ok`'s grep (134). `server/test/ccrc-containment.test.ts` — one import after line 26, the claim fixtures after line 249, six refusal rows after line 283, one pass row after line 305.
- Test pins moved: `server/test/ccrc-cli.test.ts` (216, after 232); `server/test/ccrc-install.test.ts` (6362-6367, 6396, 6412, after 6472, after 6489); `server/test/ccrc-update.test.ts` (1097-1103, CONTRACT ADDITION: not in the contract's B1 file list, but `CAPS_NOW` pins the same cap list `update --check` prints).

**Interfaces:**
- Consumes (Task A1, `shared/agent-protocol.ts`): `TOKEN_SYNC_EXIT`, `TOKEN_SYNC_STDERR_PREFIX`, `TOKEN_SYNC_SYNCED_RE`, `CLAIM_CODE_RE`, `TOKEN_SYNC_FROM`, `tokenSyncSpawnArgv()`, `NODE_FILES.tokenGeneration`. (Task A1, `shared/box-token.ts`): `TOKEN_CLAIM_PATH`, `TOKEN_VALUE_RE`, `GENERATION_ID_RE`, `FLEET_TOKEN_FILE_COMMENT`. (Task A8): the claim door's statuses and bodies (`ClaimResponse`; 410 `code-used`).
- Produces: `ccrc token sync --from agent` — stdin one line (the code) then EOF; stdout on success exactly `synced <16 hex> <http|https>`; first stderr line on refusal `ccrc: token sync: <word>: <sentence>`; exit 0, 2 (usage), 1 (environment), or `TOKEN_SYNC_EXIT[word]`. Files: `~/.cc-secrets/ccrc-mail.token` (0600, preamble kept), `~/.ccrc/box-token-generation` (`<16 hex>\n`, 0600), `~/.ccrc/token-sync.json` (0600, `{"v":1,"at":<s>,"result":…,"generation":…,"transport":…,"proof":…}`). The cap word `token-sync`. `cmd_token` in `ccd/ccrc`. `CLAIM_DATA_LINE_ERE` in `server/test/containedTools.ts`.

Design notes the worker must keep (each was measured in the prototype):
- The claim answer is checked AND written by one `python3` process, so the value never enters the shell; the proof re-reads the written file by the extraction rule (it proves the file as every reader reads it). There is therefore no `value` variable to clear; `code` and `tok` are cleared on the line after their curl call and again by the EXIT trap.
- The claim body rides `-K -` as one curl config line, `data = "{\"code\":\"…\",\"nodeId\":\"…\"}"`. Measured with the real curl against a loopback listener: the server receives exactly `{"code":"…","nodeId":"…"}` with `content-type: application/json`.
- Temps carry one prefix, `.ccrc-token-sync.`, in two directories: `~/.cc-secrets` (the claim answer, the new token file) and `~/.ccrc` (the generation file and the report, which must be renamed within their own directory). The sweep removes the prefix in both.
- `ccd/ccrc` dispatches through `cmd_token`, which execs `"$BASH" "$CCRC_HERE/ccrc-token-sync"` exactly as `cmd_adopt` reaches `ccrc-adopt` (no exec-bit dependency, a named refusal when the sibling is missing). The contract's literal `token) exec "$CCRC_HERE/ccrc-token-sync" "$@" ;;` is replaced by `token)   cmd_token "$@" ;;` for that reason.
- The red run measured D-4395's first prefix: `main`'s ccrc answers `ccrc token sync --from agent` with exactly `ccrc: unknown argument: token` on its first stderr line, at exit 2.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccrc-token-sync.test.ts`:

```ts
// ccrc-token-sync.test.ts — the fleet box's half of the box-token lifecycle
// (design 2026-10-07 §4.5, §10.1; plan Tasks B1-B2): `ccrc token sync --from
// agent` and `ccrc token probe`, run FOR REAL through `ccd/ccrc`'s dispatch
// under fixture HOMEs.
//
// Two curls. Most cases plant a RECORDING curl at `<home>/.local/bin/curl`
// (first on PATH; `ccrcContainedEnv` keeps a file already there) that keeps
// each call's argv, stdin and environment in `curl.<n>.*` and answers from
// `fixture-*` files: so "never argv, never environ" is asserted as a negative
// on what curl was really handed. One case runs the REAL curl behind the
// loopback front against an in-process listener, because only a real curl can
// prove the `-K -` data line arrives as the exact JSON body.
//
// Every value and code below is a FIXTURE built from pieces at run time, and so
// are the patterns that prove neither leaks (plan Global Constraints: tests that
// prove "never printed" build their search patterns from pieces).
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { harnessBin } from './ccdWsHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import {
  CLAIM_CODE_RE, NODE_FILES, TOKEN_SYNC_EXIT, TOKEN_SYNC_FROM, TOKEN_SYNC_STDERR_PREFIX, TOKEN_SYNC_SYNCED_RE,
  TOKEN_TRANSPORTS, tokenSyncSpawnArgv,
} from '../../shared/agent-protocol.js';
import {
  FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, TOKEN_CLAIM_PATH, TOKEN_VALUE_RE,
} from '../../shared/box-token.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = join(REPO, 'ccd', 'ccrc');
const VERB = join(REPO, 'ccd', 'ccrc-token-sync');

// ── fixtures, from pieces ──────────────────────────────────────────────────
const VALUE = ['c0ffee', '5eed'].join('').repeat(7).slice(0, 64);     // the NEW value the claim answers
const OLD = ['0d', 'd0'].join('').repeat(16);                         // the value the file held before
const CODE = ['Qx', 'Zk_', '-9'].join('').repeat(7).slice(0, 43);      // the one-time claim code
const GEN = ['0123', '4567', '89ab', 'cdef'].join('');
const NODE_ID = '0123abcd-0000-4000-8000-000000000001';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Everything that must never appear where a person, a log or a process listing can read it. */
const SECRETS = (): string[] => [VALUE, CODE, sha(VALUE), sha(CODE), sha(`${VALUE}\n`), sha(`${CODE}\n`)];
const PREAMBLE = '# ccrc box token — do not commit, do not print.\n#\n# read by coord/token.ts\'s extractToken\n\n';

interface Run { code: number; stdout: string; stderr: string }

/** The recording curl: one numbered set of files per call, the URL its last
 *  argument, the body written to `-o`'s file, the status printed for `-w`.
 *  The claim and the proof answer from separate fixtures. */
const RECORDING_CURL = [
  '#!/usr/bin/env bash',
  'n=0; [ -f "$HOME/curl.count" ] && IFS= read -r n < "$HOME/curl.count"',
  'n=$((n + 1)); printf \'%s\\n\' "$n" > "$HOME/curl.count"',
  'printf \'%s\\n\' "$@" > "$HOME/curl.$n.argv"',
  'cat > "$HOME/curl.$n.stdin"',
  'env > "$HOME/curl.$n.env"',
  'url="${!#}"; out=""; prev=""',
  'for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done',
  'case "$url" in',
  `  *${TOKEN_CLAIM_PATH}) kind=claim ;;`,
  '  */api/ledger) kind=proof ;;',
  '  *) kind=other ;;',
  'esac',
  'if [ -f "$HOME/fixture-$kind-rc" ]; then IFS= read -r rc < "$HOME/fixture-$kind-rc"; exit "$rc"; fi',
  'body=""; [ -f "$HOME/fixture-$kind-body" ] && body="$(cat "$HOME/fixture-$kind-body")"',
  'if [ -n "$out" ] && [ "$out" != - ]; then printf \'%s\' "$body" > "$out"; else printf \'%s\' "$body"; fi',
  'status=000; [ -f "$HOME/fixture-$kind-status" ] && IFS= read -r status < "$HOME/fixture-$kind-status"',
  'printf \'%s\' "$status"',
  '',
].join('\n');

/** A fleet node as `ccrc install --role fleet` leaves one: agent.env, node-id,
 *  the token file wrapped in a comment preamble, and the recording curl. The
 *  claim answers VALUE/GEN and the proof answers 400 unless a case says not. */
function box(prefix: string, o: { url?: string; token?: string | null; secretsDir?: boolean } = {}): string {
  const home = mkTmp(prefix);
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'agent.env'),
    `CCRC_AGENT_TOKEN=agent-bearer-fixture\nCCRC_SERVER_URL=${o.url ?? 'https://example.invalid'}\n`);
  writeFileSync(join(home, '.ccrc', 'node-id'), `${NODE_ID}\n`);
  if (o.secretsDir !== false) {
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    if (o.token !== null) {
      writeFileSync(join(home, '.cc-secrets', 'ccrc-mail.token'), o.token ?? `${PREAMBLE}${OLD}\n`, { mode: 0o600 });
    }
  }
  writeFileSync(join(harnessBin(home), 'curl'), RECORDING_CURL, { mode: 0o755 });
  claimAnswers(home, 200, JSON.stringify({ ok: true, value: VALUE, generation: GEN }));
  proofAnswers(home, 400);
  return home;
}
const claimAnswers = (home: string, status: number, body: string): void => {
  writeFileSync(join(home, 'fixture-claim-status'), `${status}\n`);
  writeFileSync(join(home, 'fixture-claim-body'), body);
};
const proofAnswers = (home: string, status: number): void => {
  writeFileSync(join(home, 'fixture-proof-status'), `${status}\n`);
  writeFileSync(join(home, 'fixture-proof-body'), '{"ok":false,"error":"bad-request"}');
};

/** The real `ccd/ccrc`, as the agent's spawn reaches it, under an explicit
 *  `umask 022` — so a 0600 file can only come from the verb's own `umask 077`. */
function runToken(home: string, args: string[], input: string, extra: NodeJS.ProcessEnv = {}): Run {
  const env = { ...ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }), ...extra };
  assertNoRealTool(env, home);
  const r = spawnSync('bash', ['-c', 'umask 022; exec bash "$0" "$@"', CCRC, 'token', ...args],
    { encoding: 'utf8', env, input });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const sync = (home: string, input = `${CODE}\n`, extra: NodeJS.ProcessEnv = {}): Run =>
  runToken(home, ['sync', '--from', 'agent'], input, extra);

const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const tokenFile = (home: string): string => join(home, '.cc-secrets', 'ccrc-mail.token');
const genFile = (home: string): string => join(home, '.ccrc', NODE_FILES.tokenGeneration);
const reportOf = (home: string): Record<string, unknown> | null => {
  const t = read(join(home, '.ccrc', 'token-sync.json'));
  return t === '' ? null : JSON.parse(t) as Record<string, unknown>;
};
const calls = (home: string): number => Number(read(join(home, 'curl.count')).trim() || '0');
const callArgv = (home: string, n: number): string[] => read(join(home, `curl.${n}.argv`)).split('\n').filter(Boolean);
const callStdin = (home: string, n: number): string => read(join(home, `curl.${n}.stdin`));
const temps = (home: string): string[] => ['.cc-secrets', '.ccrc'].flatMap((d) =>
  existsSync(join(home, d)) ? readdirSync(join(home, d)).filter((n) => n.startsWith('.ccrc-token-sync.')) : []);

/** The agent's mapping (plan Task A2): exit code TOKEN_SYNC_EXIT[w] AND a first
 *  stderr line starting with the prefix, the word and a colon. */
function expectRefusal(r: Run, word: keyof typeof TOKEN_SYNC_EXIT): void {
  expect(r.code, r.stderr).toBe(TOKEN_SYNC_EXIT[word]);
  expect(r.stderr.split('\n')[0]!.startsWith(`${TOKEN_SYNC_STDERR_PREFIX}${word}:`), r.stderr).toBe(true);
  expect(r.stdout).toBe('');
}
/** No secret in any text a person or a process listing can read. */
function expectNoSecret(home: string, r: Run): void {
  const texts: Array<[string, string]> = [['stdout', r.stdout], ['stderr', r.stderr],
    ['token-sync.json', read(join(home, '.ccrc', 'token-sync.json'))]];
  for (let n = 1; n <= calls(home); n++) {
    texts.push([`curl.${n}.argv`, read(join(home, `curl.${n}.argv`))], [`curl.${n}.env`, read(join(home, `curl.${n}.env`))]);
  }
  for (const [where, text] of texts) {
    for (const s of SECRETS()) expect(text.includes(s), `a secret reached ${where}`).toBe(false);
  }
}

describe('ccrc token sync: the synced path (spec §4.5, Figure 4)', () => {
  it('claims, writes the file with its preamble kept, records the generation, proves it, reports, and prints exactly one line', () => {
    const home = box('tok-sync-ok-');
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`synced ${GEN} https\n`);
    expect(TOKEN_SYNC_SYNCED_RE.test(r.stdout.trimEnd())).toBe(true);
    // The token file: the preamble verbatim, then the one new value line, 0600 from birth.
    expect(read(tokenFile(home))).toBe(`${PREAMBLE}${VALUE}\n`);
    expect(statSync(tokenFile(home)).mode & 0o777).toBe(0o600);
    expect(read(genFile(home))).toBe(`${GEN}\n`);
    expect(statSync(genFile(home)).mode & 0o777).toBe(0o600);
    const rep = reportOf(home)!;
    expect(rep).toEqual({ v: 1, at: expect.any(Number), result: 'synced', generation: GEN, transport: 'https', proof: 'proved' });
    expect(statSync(join(home, '.ccrc', 'token-sync.json')).mode & 0o777).toBe(0o600);
    // Two calls: the claim, then the proof.
    expect(calls(home)).toBe(2);
    const claim = callArgv(home, 1);
    expect(claim.at(-1)).toBe(`https://example.invalid${TOKEN_CLAIM_PATH}`);
    expect(claim.join(' ')).toMatch(/-K - /);
    expect(claim.join(' ')).toMatch(/--max-filesize 4096 --max-time 15 /);
    expect(callStdin(home, 1)).toBe(`data = "{\\"code\\":\\"${CODE}\\",\\"nodeId\\":\\"${NODE_ID}\\"}"\n`);
    const proof = callArgv(home, 2);
    expect(proof.at(-1)).toBe('https://example.invalid/api/ledger');
    expect(proof.join(' ')).toMatch(/-K - /);
    expect(callStdin(home, 2)).toBe(`header = "x-ccrc-mail-token: ${VALUE}"\n`);
    expect(temps(home)).toEqual([]);
    expectNoSecret(home, r);
  });

  it('a ws:// address rotates over http:// and the report records transport http — never refused (R2)', () => {
    const home = box('tok-sync-ws-', { url: 'ws://example.invalid:7788/' });
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`synced ${GEN} http\n`);
    expect(callArgv(home, 1).at(-1)).toBe(`http://example.invalid:7788${TOKEN_CLAIM_PATH}`);
    expect(reportOf(home)!['transport']).toBe('http');
  });

  it('a wss:// address becomes https://', () => {
    const home = box('tok-sync-wss-', { url: 'wss://example.invalid' });
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`synced ${GEN} https\n`);
    expect(callArgv(home, 1).at(-1)).toBe(`https://example.invalid${TOKEN_CLAIM_PATH}`);
  });

  it('no token file before: the fixed comment line, then the value; an absent ~/.cc-secrets is made 0700', () => {
    const home = box('tok-sync-fresh-', { secretsDir: false });
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(tokenFile(home))).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${VALUE}\n`);
    expect(statSync(join(home, '.cc-secrets')).mode & 0o777).toBe(0o700);
  });

  it('an existing ~/.cc-secrets keeps its mode, and its other files are untouched', () => {
    const home = box('tok-sync-keepmode-');
    chmodSync(join(home, '.cc-secrets'), 0o750);
    writeFileSync(join(home, '.cc-secrets', 'lane.secret'), 'operator lane secret\n', { mode: 0o600 });
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(statSync(join(home, '.cc-secrets')).mode & 0o777).toBe(0o750);
    expect(read(join(home, '.cc-secrets', 'lane.secret'))).toBe('operator lane secret\n');
  });

  it('a token file of a bare value line keeps no preamble and gains none', () => {
    const home = box('tok-sync-bare-', { token: `${OLD}\n` });
    expect(sync(home).code).toBe(0);
    expect(read(tokenFile(home))).toBe(`${VALUE}\n`);
  });

  it('stale temps a killed run left in ~/.cc-secrets and ~/.ccrc are swept; nothing else is', () => {
    const home = box('tok-sync-sweep-');
    writeFileSync(join(home, '.cc-secrets', '.ccrc-token-sync.AAAAAA'), 'killed run\n', { mode: 0o600 });
    writeFileSync(join(home, '.ccrc', '.ccrc-token-sync.BBBBBB'), 'killed run\n', { mode: 0o600 });
    writeFileSync(join(home, '.cc-secrets', '.other-tool.tmp'), 'not ours\n', { mode: 0o600 });
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(temps(home)).toEqual([]);
    expect(existsSync(join(home, '.cc-secrets', '.other-tool.tmp'))).toBe(true);
  });
});

describe('ccrc token sync: refusals — each word, its exit code, and what it leaves', () => {
  it('bad-code: a code of the wrong shape is refused before any network call, and reported', () => {
    for (const input of ['short\n', `${CODE}=\n`, `${CODE.slice(0, 42)}!\n`, '\n', '']) {
      const home = box('tok-sync-badcode-');
      const r = sync(home, input);
      expectRefusal(r, 'bad-code');
      expect(calls(home), JSON.stringify(input)).toBe(0);
      expect(reportOf(home)!['result']).toBe('bad-code');
      expect(read(tokenFile(home))).toBe(`${PREAMBLE}${OLD}\n`);
    }
  });

  it('bad-code: a second line on stdin is refused — one line, then EOF', () => {
    const home = box('tok-sync-twolines-');
    expectRefusal(sync(home, `${CODE}\n${CODE}\n`), 'bad-code');
    expect(calls(home)).toBe(0);
  });

  it('stale-client: a ccrc-api that puts the token on its argv refuses the sync before the claim', () => {
    const home = box('tok-sync-stale-');
    writeFileSync(join(harnessBin(home), 'ccrc-api'),
      '#!/usr/bin/env bash\ncurl -sS -m 30 -X "$method" -H "x-ccrc-mail-token: $TOKEN" "$url"\n', { mode: 0o755 });
    const r = sync(home);
    expectRefusal(r, 'stale-client');
    expect(calls(home)).toBe(0);
    expect(reportOf(home)!['result']).toBe('stale-client');
  });

  it('stale-client passes: no client, the shipped wave-13 client, and a link to it', () => {
    for (const plant of ['none', 'copy', 'link'] as const) {
      const home = box(`tok-sync-client-${plant}-`);
      const dest = join(harnessBin(home), 'ccrc-api');
      if (plant === 'copy') writeFileSync(dest, readFileSync(join(REPO, 'ccd', 'ccrc-api')), { mode: 0o755 });
      if (plant === 'link') symlinkSync(join(REPO, 'ccd', 'ccrc-api'), dest);
      const r = sync(home);
      expect(r.code, `${plant}: ${r.stderr}`).toBe(0);
    }
  });

  it('code-used: a 410 code-used claim answer; the old file is byte-equal and no generation is recorded', () => {
    const home = box('tok-sync-used-');
    claimAnswers(home, 410, '{"ok":false,"error":"code-used"}');
    expectRefusal(sync(home), 'code-used');
    expect(read(tokenFile(home))).toBe(`${PREAMBLE}${OLD}\n`);
    expect(existsSync(genFile(home))).toBe(false);
    expect(calls(home)).toBe(1);
  });

  it('claim-refused: every other non-200 (410 code-expired, 403, 404, 429, 503) and a claim with no answer', () => {
    const cases: Array<[number, string]> = [[410, 'code-expired'], [403, 'wrong-node'], [404, 'no-claim'],
      [429, 'rate-limited'], [503, 'unavailable']];
    for (const [status, word] of cases) {
      const home = box(`tok-sync-refused-${status}-`);
      claimAnswers(home, status, JSON.stringify({ ok: false, error: word }));
      const r = sync(home);
      expectRefusal(r, 'claim-refused');
      expect(r.stderr).toContain(`answered ${status} ${word}`);
      expect(read(tokenFile(home))).toBe(`${PREAMBLE}${OLD}\n`);
    }
    const home = box('tok-sync-norc-');
    writeFileSync(join(home, 'fixture-claim-rc'), '7\n');
    expectRefusal(sync(home), 'claim-refused');
  });

  it('claim-refused: a 200 whose answer is not exactly {ok, 64-hex value, 16-hex generation} writes nothing', () => {
    const bad = [
      { ok: true, value: VALUE.toUpperCase(), generation: GEN },
      { ok: true, value: VALUE.slice(1), generation: GEN },
      { ok: true, value: VALUE, generation: GEN.slice(1) },
      { ok: true, value: VALUE, generation: GEN, extra: 1 },
      { ok: 'true', value: VALUE, generation: GEN },
      { value: VALUE, generation: GEN },
    ];
    for (const body of [...bad.map((b) => JSON.stringify(b)), 'not json', '']) {
      const home = box('tok-sync-shape-');
      claimAnswers(home, 200, body);
      const r = sync(home);
      expectRefusal(r, 'claim-refused');
      expect(read(tokenFile(home)), body).toBe(`${PREAMBLE}${OLD}\n`);
      expect(existsSync(genFile(home))).toBe(false);
      expect(temps(home)).toEqual([]);
    }
  });

  it('write-failed: a token path that is not a regular file is left as it was, and nothing is renamed', () => {
    const home = box('tok-sync-notfile-', { token: null });
    const elsewhere = join(home, 'elsewhere.token');
    writeFileSync(elsewhere, `${OLD}\n`, { mode: 0o600 });
    symlinkSync(elsewhere, tokenFile(home));
    const r = sync(home);
    expectRefusal(r, 'write-failed');
    expect(lstatSync(tokenFile(home)).isSymbolicLink()).toBe(true);
    expect(read(elsewhere)).toBe(`${OLD}\n`);
    expect(existsSync(genFile(home))).toBe(false);
    expect(temps(home)).toEqual([]);
  });

  it('write-failed: a ~/.cc-secrets the verb cannot write refuses before the claim — nothing is claimed', () => {
    const home = box('tok-sync-ro-');
    chmodSync(join(home, '.cc-secrets'), 0o500);
    try {
      const r = sync(home);
      expectRefusal(r, 'write-failed');
      expect(calls(home)).toBe(0);
    } finally {
      chmodSync(join(home, '.cc-secrets'), 0o700);
    }
    expect(read(tokenFile(home))).toBe(`${PREAMBLE}${OLD}\n`);
  });

  it('proof words: 401 is proof-failed, 501 and a timeout are proof-unmeasured — never folded together', () => {
    const home401 = box('tok-sync-p401-');
    proofAnswers(home401, 401);
    expectRefusal(sync(home401), 'proof-failed');
    expect(reportOf(home401)).toMatchObject({ result: 'proof-failed', generation: GEN, proof: 'proof-failed' });
    // The file already holds the new value: the server accepts it (spec §6).
    expect(read(tokenFile(home401))).toBe(`${PREAMBLE}${VALUE}\n`);

    const home501 = box('tok-sync-p501-');
    proofAnswers(home501, 501);
    expectRefusal(sync(home501), 'proof-unmeasured');
    expect(reportOf(home501)).toMatchObject({ result: 'proof-unmeasured', proof: 'proof-unmeasured' });

    const homeTo = box('tok-sync-ptimeout-');
    writeFileSync(join(homeTo, 'fixture-proof-rc'), '28\n');
    expectRefusal(sync(homeTo), 'proof-unmeasured');
  });

  it('no refusal path prints a secret, and every one leaves no temp', () => {
    const home = box('tok-sync-nosecret-');
    proofAnswers(home, 401);
    const r = sync(home);
    expectRefusal(r, 'proof-failed');
    expectNoSecret(home, r);
    expect(temps(home)).toEqual([]);
  });
});

describe('ccrc token sync: set +x first, umask 077, and the environment exits', () => {
  it('an inherited xtrace (SHELLOPTS=xtrace) prints neither the code nor the value — set +x is the first statement', () => {
    const home = box('tok-sync-xtrace-');
    const r = sync(home, `${CODE}\n`, { SHELLOPTS: 'xtrace' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr, 'xtrace reached the run at all').toMatch(/^\+/m);
    expectNoSecret(home, r);
    const lines = readFileSync(VERB, 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
    expect(lines[0]).toMatch(/^set \+x\b/);
    expect(lines[1]).toBe('umask 077');
  });

  it('exit 1 with no report: no agent.env, no CCRC_SERVER_URL, a non-http address, no node id', () => {
    const plant: Array<[string, (h: string) => void]> = [
      ['no agent.env', (h) => { writeFileSync(join(h, '.ccrc', 'agent.env'), ''); chmodSync(join(h, '.ccrc', 'agent.env'), 0o000); }],
      ['no CCRC_SERVER_URL', (h) => writeFileSync(join(h, '.ccrc', 'agent.env'), 'CCRC_AGENT_TOKEN=x\n')],
      ['an ftp address', (h) => writeFileSync(join(h, '.ccrc', 'agent.env'), 'CCRC_SERVER_URL=ftp://example.invalid\n')],
      ['no node id', (h) => writeFileSync(join(h, '.ccrc', 'node-id'), 'not-a-uuid\n')],
    ];
    for (const [what, f] of plant) {
      const home = box('tok-sync-env-');
      f(home);
      const r = sync(home);
      expect(r.code, `${what}: ${r.stderr}`).toBe(1);
      expect(calls(home), what).toBe(0);
      expect(reportOf(home), what).toBeNull();
    }
  });

  it('usage is exit 2: no subverb, an unknown subverb, no --from, a --from word other than agent', () => {
    for (const args of [[], ['nope'], ['sync'], ['sync', '--from'], ['sync', '--from', 'pwa'], ['sync', '--from', 'agent', 'x']]) {
      const home = box('tok-sync-usage-');
      const r = runToken(home, args, `${CODE}\n`);
      expect(r.code, args.join(' ')).toBe(2);
      expect(calls(home)).toBe(0);
    }
  });
});

describe('ccrc token sync: the real curl, against a listener on loopback', () => {
  it('the claim body arrives as exactly {"code","nodeId"} JSON, and the proof carries the new value as its header', async () => {
    const home = box('tok-sync-real-', { url: 'http://placeholder.invalid' });
    // The real curl behind the loopback front (containedTools.ts), not the recorder.
    rmRecorder(home);
    const seen: Array<{ method: string; url: string; type: string; token: string; body: string }> = [];
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', type: String(req.headers['content-type'] ?? ''),
          token: String(req.headers['x-ccrc-mail-token'] ?? ''), body });
        if (req.url === TOKEN_CLAIM_PATH) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, value: VALUE, generation: GEN }));
        } else {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end('{"ok":false,"error":"bad-request"}');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      writeFileSync(join(home, '.ccrc', 'agent.env'), `CCRC_SERVER_URL=http://127.0.0.1:${port}\n`);
      writeFileSync(join(home, 'curl-allow-ports'), `${port}\n`);
      const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'loopback' });
      assertNoRealTool(env, home);
      // ASYNC: the listener is in this process, and a synchronous spawn would block its event loop.
      const r = await new Promise<Run>((resolve) => {
        const child = spawn('bash', [CCRC, 'token', 'sync', '--from', 'agent'], { env });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
        child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
        child.stdin.end(`${CODE}\n`);
        child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
      });
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe(`synced ${GEN} http\n`);
      expect(read(join(home, 'curl-poison')), 'the loopback front refused a call').toBe('');
      expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([`POST ${TOKEN_CLAIM_PATH}`, 'GET /api/ledger']);
      expect(seen[0]!.type).toBe('application/json');
      expect(JSON.parse(seen[0]!.body)).toEqual({ code: CODE, nodeId: NODE_ID });
      expect(seen[0]!.body).toBe(JSON.stringify({ code: CODE, nodeId: NODE_ID }));
      expect(seen[1]!.token).toBe(VALUE);
      expect(read(tokenFile(home))).toBe(`${PREAMBLE}${VALUE}\n`);
    } finally {
      await new Promise<void>((r) => { server.close(() => r()); });
    }
  });
});

/** The recorder is planted by `box`; the real-curl case wants the loopback front in its place. */
function rmRecorder(home: string): void {
  rmSync(join(harnessBin(home), 'curl'), { force: true });
}

describe('ccrc token sync: the shell spellings agree with L0 (plan Global Constraints, single definition)', () => {
  /** Read per case, never at collection: a missing file reds each case by name instead of the whole file. */
  const verb = (): string => readFileSync(VERB, 'utf8');
  /** The value of a top-level `NAME='…'` or `NAME="…"` assignment, which must appear exactly once. */
  const assigned = (text: string, name: string): string => {
    const all = [...text.matchAll(new RegExp(`^${name}=(?:'([^']*)'|"([^"]*)")$`, 'gm'))];
    expect(all.length, `${name}= is assigned ${all.length} times in ccd/ccrc-token-sync`).toBe(1);
    return all[0]![1] ?? all[0]![2]!;
  };
  /** `_ts_exit`'s case table as word -> code. */
  const exitTable = (text: string): Record<string, number> => {
    const body = /^_ts_exit\(\) \{\n([\s\S]*?)\n\}$/m.exec(text);
    expect(body, 'ccd/ccrc-token-sync has no _ts_exit() { … }').not.toBeNull();
    return Object.fromEntries([...body![1]!.matchAll(/^\s+([a-z-]+)\) echo (\d+) ;;$/gm)].map((m) => [m[1]!, Number(m[2])]));
  };

  it('the exit table is TOKEN_SYNC_EXIT, both directions', () => {
    expect(exitTable(verb())).toEqual({ ...TOKEN_SYNC_EXIT });
  });

  it('CONTROL: the table reader sees a moved code and a missing word', () => {
    const src = verb();
    expect(exitTable(src.replace('code-used) echo 22 ;;', 'code-used) echo 27 ;;'))).not.toEqual({ ...TOKEN_SYNC_EXIT });
    expect(exitTable(src.replace(/^\s+stale-client\) echo 26 ;;\n/m, ''))).not.toEqual({ ...TOKEN_SYNC_EXIT });
  });

  it('the prefix, the three shapes, the claim path, the --from word, the comment line and the generation file', () => {
    const src = verb();
    expect(assigned(src, 'TS_PREFIX')).toBe(TOKEN_SYNC_STDERR_PREFIX);
    expect(assigned(src, 'CODE_RE')).toBe(CLAIM_CODE_RE.source);
    expect(assigned(src, 'GEN_RE')).toBe(GENERATION_ID_RE.source);
    expect(assigned(src, 'VALUE_RE')).toBe(TOKEN_VALUE_RE.source);
    expect(assigned(src, 'CLAIM_PATH')).toBe(TOKEN_CLAIM_PATH);
    expect(assigned(src, 'FROM_WORD')).toBe(TOKEN_SYNC_FROM);
    expect(assigned(src, 'FLEET_COMMENT')).toBe(FLEET_TOKEN_FILE_COMMENT);
    expect(assigned(src, 'GEN_FILE')).toBe(`$HOME/.ccrc/${NODE_FILES.tokenGeneration}`);
  });

  // Plan assembly (review): A1 says this scan holds the verb's synced line to TOKEN_SYNC_SYNCED_RE. One printf, and the
  // shell's own generation shape and transport words rebuild the L0 regex's source exactly.
  it('the one synced line is TOKEN_SYNC_SYNCED_RE, rebuilt from GEN_RE and the transport words', () => {
    const src = verb();
    const printfs = src.split('\n').filter((l) => /printf 'synced /.test(l));
    expect(printfs.map((l) => l.trim())).toEqual([`printf 'synced %s %s\\n' "$R_GEN" "$R_TRANSPORT"`]);
    const gen = assigned(src, 'GEN_RE').replace(/^\^/, '').replace(/\$$/, '');
    const words = [...new Set([...src.matchAll(/\bR_TRANSPORT=(\w+)/g)].map((m) => m[1]))].sort();
    expect(words).toEqual([...TOKEN_TRANSPORTS].sort());
    expect(`^synced (${gen}) (${[...TOKEN_TRANSPORTS].join('|')})$`).toBe(TOKEN_SYNC_SYNCED_RE.source);
  });

  it('the agent\'s frozen argv is the verb this file answers', () => {
    expect([...tokenSyncSpawnArgv()]).toEqual(['token', 'sync', '--from', assigned(verb(), 'FROM_WORD')]);
    expect(readFileSync(CCRC, 'utf8')).toMatch(/^\s+token\)\s+cmd_token "\$@" ;;$/m);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
mkdir -p .tmp-b1 && (cd server && TMPDIR="$PWD/../.tmp-b1" ./node_modules/.bin/vitest run test/ccrc-token-sync.test.ts)
```

Expected: `Tests  26 failed | 1 passed (27)` (measured as 25 failed | 1 passed on the 26-case prototype; the synced-line parity case was added at plan assembly). The failures read `AssertionError: ccrc: unknown argument: token` (the
dispatch does not exist) and, for the parity cases, `ENOENT … ccd/ccrc-token-sync`. The one pass is the usage case.

- [ ] **Step 3: Move the pins the cap word and the usage line hold (red first)**

`server/test/ccrc-cli.test.ts`, line 216, the usage regex gains `token` before `restamp`:

```ts
    expect(r.stdout).toMatch(/usage: ccrc \{doctor\|status\|adopt\|wrappers\|account\|memory\|models\|codex\|install\|update\|rollback\|versions\|channel\|rollout\|uninstall\|backup\|logs\|passwd\|expose\|token\|restamp\|version\|watchdog\}/);
```

and after line 232 (`expect(r.stdout).toMatch(/^ {2}restamp {3}re-stamp one file ccrc generated/m);`) insert:

```ts
    // `token` joined it in the box-token lifecycle's wave 1 (spec 2026-10-07 §4.5) — the fleet side of a
    // rotation, which ccrc-agent's token-sync op spawns. `server/test/ccrc-token-sync.test.ts` owns what it does.
    expect(r.stdout).toMatch(/^ {2}token {5}the box token's fleet side/m);
```

`server/test/ccrc-install.test.ts`, lines 6362-6367 become:

```ts
  // Each wave's spine ADDS its own words (design 2026-09-20 §9): W1's three,
  // W4's four — `detach` on Linux only (decision 17: `--detach` refuses on
  // Darwin) — W6's `versions`, and the box-token lifecycle's `token-sync`
  // (design 2026-10-07 §4.5; every os, because the op runs the verb in the
  // foreground), so a Linux install writes nine words and a Darwin one eight.
  // LITERALS, not a read of ccd/ccrc's arrays: a pin
  // derived from the list it pins could never red on the list being wrong.
  const CAPS_ALL = ['verify', 'node-id', 'floor', 'update-json', 'update-gate', 'rollback', 'versions', 'token-sync'];
```

Line 6396's title becomes `'ccrc-caps: line 1 is the os, then each wave\'s words — W1\'s three, W4\'s four, W6\'s versions, token-sync, detach on Linux only (§18 "_inst_caps writes each wave\'s words")'`;
line 6412's title becomes `'ccrc-caps: nine words on Linux, eight on Darwin, whichever box runs this suite — both arms of the real _inst_caps'`.
After line 6472 (`versions: [/^_upd_restore_arm1\(\) \{/m, /^_ver_flip_back\(\) \{/m],`) insert:

```ts
      // Box-token lifecycle wave 1: the verb ccrc-agent's token-sync op spawns, dispatched to its sibling body.
      'token-sync': [/^cmd_token\(\) \{/m, /^\s*token\)\s+cmd_token "\$@" ;;$/m, /"\$CCRC_HERE\/ccrc-token-sync"/],
```

and after line 6489 (`expect(src).toMatch(/_ccrc_die "--detach is Linux-only \(decision 17\)"/);`) insert:

```ts
    // …and `token-sync`'s body ships beside ccd/ccrc, where `cmd_token` looks for it.
    expect(statSync(join(REPO, 'ccd', 'ccrc-token-sync')).isFile(), 'ccd/ccrc-token-sync does not ship').toBe(true);
```

`server/test/ccrc-update.test.ts`, lines 1097-1103 become:

```ts
/** The words THIS ccrc can do (`_ccrc_cap_words`), as `--check` joins them:
 *  W1's three, W4's four, W6's `versions` and the box-token lifecycle's
 *  `token-sync`, `detach` on Linux only
 *  (decision 17). A literal, not a read of ccd/ccrc — a pin derived from the
 *  list it pins cannot red. */
const CAPS_NOW = process.platform === 'darwin'
  ? 'verify,node-id,floor,update-json,update-gate,rollback,versions,token-sync'
  : 'verify,node-id,floor,update-json,update-gate,rollback,versions,token-sync,detach';
```

- [ ] **Step 4: Run the moved pins to verify they fail**

```bash
mkdir -p .tmp-b1 && (cd server && TMPDIR="$PWD/../.tmp-b1" ./node_modules/.bin/vitest run test/ccrc-cli.test.ts)
mkdir -p .tmp-b1 && (cd server && TMPDIR="$PWD/../.tmp-b1" ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'ccrc-caps|cap word')
mkdir -p .tmp-b1 && (cd server && TMPDIR="$PWD/../.tmp-b1" ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'behind: an older version on the box|unversioned: a deploy.sh stamp|the machine line is box, sha|caps= is what the RUNNING')
```

(one call each). Expected: `1 failed | 35 passed (36)` ("the usage line names every verb this CLI will have");
`4 failed | 312 skipped (316)` (the two `ccrc-caps:` cases above, "every cap word names machinery THIS ccrc ships",
and "ccrc-caps: rewritten on every install", which reads `CAPS_HERE` too); `4 failed | 510 skipped (514)`.

- [ ] **Step 5: Write the failing test for the loopback front's claim line**

The test harness's real-curl front (`loopbackCurlFront`) admits only `header = "…"` lines on `-K -` (wave 13, R16),
so the claim body — the one call that sends a `data` line — would be refused (exit 97) in every test that runs the
real verb behind it (this task's real-curl case and Task B4). The front gains exactly that one line shape, shaped
field by field. In `server/test/ccrc-containment.test.ts`, after line 26 insert:

```ts
import { TOKEN_CLAIM_PATH } from '../../shared/box-token.js';
```

after line 249 (`const HDR = …`) insert:

```ts
  // ccd/ccrc-token-sync's claim body as its printf writes it: fixture code and node id, never a real one.
  const CLAIM_CODE = 'Qx9_-'.repeat(9).slice(0, 43);
  const CLAIM_NODE = '0123abcd-0000-4000-8000-000000000001';
  const CLAIM_LINE = `data = "{\\"code\\":\\"${CLAIM_CODE}\\",\\"nodeId\\":\\"${CLAIM_NODE}\\"}"\n`;
```

after line 283 (`['-X empty', ['-X', '', ok], ''],`) insert:

```ts
    // The claim body (box-token lifecycle wave 1, Task B1): the ONE `data` line shape the front admits. Each row changes
    // one thing in an otherwise-admitted line, so each refuses for its own reason.
    ['a data line naming a file', ['-K', '-', ok], 'data = "@/etc/passwd"\n'],
    ['a data-binary key carrying the claim body', ['-K', '-', ok], CLAIM_LINE.replace(/^data /, 'data-binary ')],
    ['a claim body with a third field', ['-K', '-', ok], CLAIM_LINE.replace('\\"}"', '\\",\\"url\\":\\"x\\"}"')],
    ['a claim code of 42 characters', ['-K', '-', ok], CLAIM_LINE.replace(CLAIM_CODE, CLAIM_CODE.slice(1))],
    ['an uppercase node id', ['-K', '-', ok], CLAIM_LINE.replace(CLAIM_NODE, CLAIM_NODE.toUpperCase())],
    ['an unescaped claim body', ['-K', '-', ok], CLAIM_LINE.replace(/\\"/g, '"')],
```

and after line 305 (`['two header lines', …],`) insert:

```ts
    ['ccrc token sync\'s claim shape (`-K -` data line, the claim body)', ['-sS', '-K', '-', '-H', 'content-type: application/json',
      '-X', 'POST', '-o', '/tmp/x', '-w', '%{http_code}', '--max-filesize', '4096', '--max-time', '15', `${ok}${TOKEN_CLAIM_PATH.slice(1)}`],
      CLAIM_LINE],
```

- [ ] **Step 6: Run it to verify it fails**

```bash
mkdir -p .tmp-b1 && (cd server && TMPDIR="$PWD/../.tmp-b1" ./node_modules/.bin/vitest run test/ccrc-containment.test.ts)
```

Expected: `1 failed | 94 passed (95)` — "passes ccrc token sync's claim shape (`-K -` data line, the claim body), to
the real curl with -q first, and hands it the config on stdin (wave 13, R16)". The six refusal rows already pass.

- [ ] **Step 7: Admit the claim line in the front**

`server/test/containedTools.ts`: after `plantPoison`'s closing brace (line 56) insert:

```ts

/** The one `data` config line the front admits: ccd/ccrc-token-sync's claim body, as a sh-level ERE (grep -E). The
 *  quotes inside the JSON are escaped as curl's config syntax needs (a backslash before
 *  each), and every field is shaped, so the line names no file, no URL and no field beyond the two the claim door
 *  reads. */
export const CLAIM_DATA_LINE_ERE = String.raw`^data = "\{\\"code\\":\\"[A-Za-z0-9_-]{43}\\",\\"nodeId\\":\\"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\"\}"$`;
```

In the front's docstring, line 69 becomes:

```ts
 *    character; an EMPTY config passes too (notify.sh sends one when it has no token). Since the box-token lifecycle
 *    (wave 1, Task B1) ONE more line shape passes: `ccrc token sync`'s claim body, `CLAIM_DATA_LINE_ERE` above — a
 *    `data = "…"` line that is exactly `{"code":<43 base64url>,"nodeId":<lowercase uuid>}` with its quotes escaped,
 *    so it names no file (no leading `@`), no URL and no other field. Any other key (`url`, `proxy`,
```

and `cfg_ok`'s grep line (134) becomes:

```ts
    '  printf \'%s\\n\' "$cfg" | grep -qvE -e \'^header = "[A-Za-z0-9-]+: [^"\\\\[:cntrl:]]*"$\' -e \'' + CLAIM_DATA_LINE_ERE + '\'',
```

Run Step 6's command again. Expected: `95 passed (95)`.
Mutation check: put line 134 back as it was (the header rule alone); the claim-shape pass row reds; restore.

- [ ] **Step 8: Write the minimal implementation**

Create `ccd/ccrc-token-sync` and make it executable (`chmod 755 ccd/ccrc-token-sync`; git records 100755):

```bash
#!/usr/bin/env bash
set +x   # FIRST LINE OF CODE, and it is a SECRETS control: a claim code and a box token pass through this file.
umask 077
# ccrc-token-sync — the fleet box's half of the box-token lifecycle (design
# 2026-10-07, §4.5 and §10.3). `ccd/ccrc` dispatches `ccrc token …` here,
# to the copy beside itself, so the verb runs from the release tree and from
# a deploy.sh-placed tree alike.
#
#   ccrc token sync --from agent
#       The `token-sync` agent op's ONE spawn. The one-time claim code arrives
#       on STDIN (one line, then EOF) — never argv, never the environment. The
#       verb trades it at POST /api/token/claim for the new value, writes
#       ~/.cc-secrets/ccrc-mail.token atomically, records the generation id in
#       ~/.ccrc/box-token-generation, proves the file with one call to
#       GET /api/ledger, and writes a non-secret report to
#       ~/.ccrc/token-sync.json for doctor.
#
# OUTPUT CONTRACT (`sync`), read by the agent (agent/src/tokensync.ts):
#   - success: exit 0, stdout exactly `synced <16 hex> <http|https>`
#     (shared/agent-protocol.ts's TOKEN_SYNC_SYNCED_RE);
#   - a refusal: exit `_ts_exit <word>`, stderr's FIRST line
#     `ccrc: token sync: <word>: <sentence>` (TOKEN_SYNC_STDERR_PREFIX);
#   - 2 a usage error; 1 an environment this verb cannot run in (no curl, no
#     python3, no agent.env, no CCRC_SERVER_URL, no node id). Neither writes
#     the report: neither has a word.
# No sentence carries a value, a code, a hash of either, a URL or an absolute
# home path: the agent relays the first stderr line to the server (at most 200
# characters) and the server relays it to the console.
#
# SINGLE DEFINITION. bash cannot import shared/, so every word, shape and
# path below that L0 also declares is spelled ONCE here, at file scope, and
# server/test/ccrc-token-sync.test.ts's parity scan holds each to its L0
# twin: the exit table (TOKEN_SYNC_EXIT), the stderr prefix, the code,
# generation and value shapes, the claim path, the --from word, the fleet
# file's fixed comment line, and the generation file's basename
# (NODE_FILES.tokenGeneration).
#
# THE FIFTH HAND COPY of ccrc-api's URL and token handling (ccd-account-health,
# ccrc-api, ccd-pool-sync, ccd-update-sync, this file), for the reason
# ccd-update-sync gives where it calls itself the fourth: each is a standalone
# executable, and a sourced helper would be a new file under the same "cannot
# source a sibling" constraint. A fix to one copy's URL or token handling is
# owed to all five. agent.env is GREPPED, never sourced (0600; it carries the
# agent bearer). A token or a code reaches curl only on STDIN through `-K -`.
#
# TEMPS. Every temp this verb makes is named `.ccrc-token-sync.XXXXXX` and
# lives in ~/.cc-secrets (0700: the claim answer, the new token file) or in
# ~/.ccrc (the generation file and the report, both non-secret, renamed
# within their own directory), never in /tmp, which is shared and reaped. A
# run first removes that prefix in both directories: a run killed by the
# agent's SIGKILL leaves its temps behind, and the agent's gate allows one
# sync at a time, so no live run owns one. The EXIT trap removes this run's
# own; TERM, INT and HUP exit through it.
#
# PORTABILITY (server/test/macos-platform.test.ts scans this file whole): no
# bare `timeout` (curl's --max-time is the deadline), no `stat -c`, no
# template-less `mktemp`, no `mv -T`, no GNU `date`. Renames are python3's
# os.rename (one rename(2) on every POSIX platform). Bash has no portable
# directory fsync and macOS's `sync` takes no operand, so the directory fsync
# is python's, where os.open on a directory is allowed.
set -uo pipefail
export LC_ALL=C

# ── the words L0 declares (the parity scan reads these lines) ─────────────
TS_PREFIX='ccrc: token sync: '
FROM_WORD='agent'
CODE_RE='^[A-Za-z0-9_-]{43}$'
GEN_RE='^[0-9a-f]{16}$'
VALUE_RE='^[0-9a-f]{64}$'
CLAIM_PATH='/api/token/claim'
PROOF_PATH='/api/ledger'
FLEET_COMMENT='# ccrc box token: written by ccrc and rotated by the server; do not edit or copy it'
GEN_FILE="$HOME/.ccrc/box-token-generation"

# The verb's refusal words and their exit codes (TOKEN_SYNC_EXIT). `busy` and
# `spawn-failed` are the agent's words, never this file's.
_ts_exit() {
  case "$1" in
    bad-code) echo 20 ;;
    claim-refused) echo 21 ;;
    code-used) echo 22 ;;
    write-failed) echo 23 ;;
    proof-failed) echo 24 ;;
    proof-unmeasured) echo 25 ;;
    stale-client) echo 26 ;;
    *) echo 1 ;;
  esac
}

# ── this box's files ──────────────────────────────────────────────────────
CCRC_DIR="$HOME/.ccrc"
SECRETS="$HOME/.cc-secrets"
TOKEN_FILE="$SECRETS/ccrc-mail.token"
AGENT_ENV="$CCRC_DIR/agent.env"
NODE_ID_FILE="$CCRC_DIR/node-id"
REPORT="$CCRC_DIR/token-sync.json"
API_CLIENT="$HOME/.local/bin/ccrc-api"
TMP_PREFIX='.ccrc-token-sync.'
CLAIM_MAX_BYTES=4096
CALL_MAX_TIME=15

# What a refusal reports beside its word; each is set as soon as it is known.
R_GEN=''        # the generation id the claim answered
R_TRANSPORT=''  # http | https
R_PROOF=''      # proved | proof-failed | proof-unmeasured

# This run's temps, removed on every exit.
T_RESP='' T_TOKEN='' T_GEN='' T_REPORT=''
code='' tok=''
_ts_cleanup() {
  code=''; tok=''
  local f
  for f in "$T_RESP" "$T_TOKEN" "$T_GEN" "$T_REPORT"; do
    [ -n "$f" ] && rm -f -- "$f"
  done
  return 0
}
trap '_ts_cleanup' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

_ts_usage() {
  cat <<'EOF'
usage: ccrc token sync --from agent      (the claim code on stdin; run by ccrc-agent's token-sync op)
EOF
}
_ts_usage_die() { echo "ccrc: token: $1" >&2; _ts_usage >&2; exit 2; }
_ts_env_die() { echo "ccrc: token sync: $1" >&2; exit 1; }

# `_ts_rename <tmp> <dest>` — one rename(2), never `mv`.
_ts_rename() {
  python3 -c 'import os, sys; os.rename(sys.argv[1], sys.argv[2])' "$1" "$2" 2>/dev/null
}

# `_ts_report <result>` — ~/.ccrc/token-sync.json, by temp and rename. Every
# field is a word, an id or a number this file validated, so printf is exact.
# A report that cannot be written is said on stderr AFTER the verb's own line
# and never changes the exit code.
_ts_report() {
  local result="$1" at gen='null' transport='null' proof='null'
  at="$(date +%s)"
  [ -n "$R_GEN" ] && gen="\"$R_GEN\""
  [ -n "$R_TRANSPORT" ] && transport="\"$R_TRANSPORT\""
  [ -n "$R_PROOF" ] && proof="\"$R_PROOF\""
  if [ -d "$CCRC_DIR" ] && T_REPORT="$(mktemp "$CCRC_DIR/${TMP_PREFIX}XXXXXX" 2>/dev/null)" \
    && printf '{"v":1,"at":%s,"result":"%s","generation":%s,"transport":%s,"proof":%s}\n' \
      "$at" "$result" "$gen" "$transport" "$proof" > "$T_REPORT" \
    && _ts_rename "$T_REPORT" "$REPORT"; then
    T_REPORT=''
    return 0
  fi
  echo "ccrc: token sync: the report at ~/.ccrc/token-sync.json could not be written" >&2
  return 0
}

# `_ts_refuse <word> <sentence>` — the one way a sync ends without syncing.
_ts_refuse() {
  local word="$1" sentence="$2" rc
  rc="$(_ts_exit "$word")"
  printf '%s%s: %s\n' "$TS_PREFIX" "$word" "$sentence" >&2
  _ts_report "$word"
  exit "$rc"
}

# `_ts_sweep` — a killed run's temps, in both directories.
_ts_sweep() {
  local d f had_nullglob=0 had_dotglob=0
  shopt -q nullglob && had_nullglob=1
  shopt -q dotglob && had_dotglob=1
  shopt -s nullglob dotglob
  for d in "$SECRETS" "$CCRC_DIR"; do
    [ -d "$d" ] || continue
    for f in "$d/$TMP_PREFIX"*; do
      rm -f -- "$f"
    done
  done
  [ "$had_nullglob" -eq 1 ] || shopt -u nullglob
  [ "$had_dotglob" -eq 1 ] || shopt -u dotglob
  return 0
}

# `_ts_client_ok` — rc 0 when ~/.local/bin/ccrc-api cannot leak a token on
# argv: absent (or a link to nothing: nothing runs), or present in the wave-13
# shape — the header sent through `-K -` and no `-H` naming the token header.
# Judged by CONTENT, so a link into the release tree passes the same test as
# a copy (grep follows the link). A file it cannot read is refused: an
# unreadable client is not a measured one. A session whose PATH finds another
# copy first is not seen (spec §4.5's recorded residual).
_ts_client_ok() {
  [ -e "$API_CLIENT" ] || return 0
  [ -r "$API_CLIENT" ] || return 1
  local rc
  grep -qE -- "-H[[:space:]]+[\"']?x-ccrc-mail-token" "$API_CLIENT"; rc=$?
  [ "$rc" -eq 1 ] || return 1          # 0: the argv header is there; 2: no verdict
  grep -qE -- '(^|[[:space:]])-K[[:space:]]+-([[:space:]]|$)' "$API_CLIENT"; rc=$?
  [ "$rc" -eq 0 ] || return 1          # 1: no `-K -`; 2: no verdict
  return 0
}

# `_ts_server_url` — sets URL and R_TRANSPORT from agent.env, or exits 1.
# ws: and wss: become http: and https:, exactly as ccrc-api does; a plain
# http address goes ahead and is RECORDED, never refused (R2).
URL=''
_ts_server_url() {
  [ -r "$AGENT_ENV" ] || _ts_env_die "cannot read ~/.ccrc/agent.env — nothing was claimed"
  local u
  u="$(grep -E '^[[:space:]]*CCRC_SERVER_URL=' "$AGENT_ENV" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -n "$u" ] || _ts_env_die "CCRC_SERVER_URL is not set in ~/.ccrc/agent.env — nothing was claimed"
  _ts_set_url "$u" || _ts_env_die "CCRC_SERVER_URL in ~/.ccrc/agent.env is not an http, https, ws or wss address — nothing was claimed"
}
_ts_set_url() {
  local u="$1"
  u="${u/#ws:/http:}"; u="${u/#wss:/https:}"
  case "$u" in
    https://?*) R_TRANSPORT=https ;;
    http://?*)  R_TRANSPORT=http ;;
    *) return 1 ;;
  esac
  URL="${u%/}"
}

# `_ts_read_value <file>` — sets tok to the file's value line: the first line
# that is neither blank nor a `#` comment, whitespace stripped — the rule
# every reader of this file applies (coord/token.ts's extractToken).
_ts_read_value() {
  tok="$(grep -vE '^[[:space:]]*(#|$)' "$1" 2>/dev/null | head -n1 | tr -d '[:space:]')"
}

# The claim answer, checked and written in ONE python process, so the value
# never enters this shell: argv is the answer file, the token file, the temp
# beside it, the comment line, and the two shapes. One stdout line:
#   ok <generation>        the token file was renamed into place
#   bad <reason>           the answer is not exactly {ok:true,value,generation}
#   fail <reason>          the write failed; the old file is byte-equal
# Reasons name no path and no value.
_TS_WRITE_PY='
import errno, json, os, re, sys
resp, dest, tmp, comment, value_re, gen_re, cap = sys.argv[1:8]
cap = int(cap)
def out(kind, why):
    sys.stdout.write("%s %s\n" % (kind, why)); sys.exit(0)
def eword(e):
    return errno.errorcode.get(getattr(e, "errno", None) or 0, "error")
try:
    with open(resp, "rb") as f:
        raw = f.read(cap + 1)
except OSError as e:
    out("bad", "the answer could not be read (%s)" % eword(e))
if len(raw) > cap:
    out("bad", "the answer is over %d bytes" % cap)
try:
    doc = json.loads(raw.decode("utf-8"))
except Exception:
    out("bad", "the answer is not JSON")
if not isinstance(doc, dict) or set(doc.keys()) != {"ok", "value", "generation"} or doc.get("ok") is not True:
    out("bad", "the answer is not exactly ok, value and generation")
value, gen = doc["value"], doc["generation"]
if not isinstance(value, str) or re.fullmatch(value_re, value) is None:
    out("bad", "the value is not 64 lowercase hex")
if not isinstance(gen, str) or re.fullmatch(gen_re, gen) is None:
    out("bad", "the generation is not 16 lowercase hex")
preamble = comment + "\n"
try:
    if os.path.lexists(dest):
        if os.path.islink(dest) or not os.path.isfile(dest):
            out("fail", "the token file is not a regular file")
        with open(dest, "r", encoding="utf-8", errors="surrogateescape") as f:
            lines = f.read().splitlines(True)
        kept = [l for l in lines if re.match(r"^\s*(#|$)", l)]
        preamble = "".join(l if l.endswith("\n") else l + "\n" for l in kept)
except OSError as e:
    out("fail", "the token file could not be read (%s)" % eword(e))
try:
    fd = os.open(tmp, os.O_WRONLY | os.O_TRUNC)
    try:
        data = (preamble + value + "\n").encode("utf-8", "surrogateescape")
        n = 0
        while n < len(data):
            n += os.write(fd, data[n:])
        os.fsync(fd)
    finally:
        os.close(fd)
    os.rename(tmp, dest)
except OSError as e:
    out("fail", "writing the token file failed (%s)" % eword(e))
try:
    dfd = os.open(os.path.dirname(dest), os.O_RDONLY)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)
except OSError:
    pass
out("ok", gen)
'

# The error word of a refusal answer, or nothing: `{"ok":false,"error":<w>}`.
_TS_ERROR_PY='
import json, re, sys
try:
    with open(sys.argv[1], "rb") as f:
        doc = json.loads(f.read(4097).decode("utf-8"))
    w = doc.get("error") if isinstance(doc, dict) else None
    if isinstance(w, str) and re.fullmatch(r"[a-z][a-z-]{0,31}", w):
        sys.stdout.write(w)
except Exception:
    pass
'

cmd_sync() {
  [ $# -gt 0 ] || _ts_usage_die "sync needs --from agent"
  [ "$1" = --from ] || _ts_usage_die "unknown argument: $1"
  [ $# -ge 2 ] || _ts_usage_die "--from needs a value"
  [ "$2" = "$FROM_WORD" ] || _ts_usage_die "--from must be $FROM_WORD"
  [ $# -eq 2 ] || _ts_usage_die "unknown argument: $3"

  # The code: one line, then EOF. Never argv, never the environment.
  local extra='' nid status rc verdict word
  IFS= read -r code || :
  if IFS= read -r extra || [ -n "$extra" ]; then
    extra=''
    _ts_refuse bad-code "stdin carried more than one line; nothing was claimed"
  fi
  [[ "$code" =~ $CODE_RE ]] || _ts_refuse bad-code "the code on stdin is not 43 base64url characters; nothing was claimed"

  command -v curl >/dev/null 2>&1 || _ts_env_die "curl is not on PATH — nothing was claimed"
  command -v python3 >/dev/null 2>&1 || _ts_env_die "python3 is not on PATH — nothing was claimed"

  _ts_sweep
  _ts_client_ok || _ts_refuse stale-client "~/.local/bin/ccrc-api sends the box token on its argv (an install before wave 13); replace it before a sync — nothing was claimed"
  _ts_server_url

  [ -e "$NODE_ID_FILE" ] || [ -L "$NODE_ID_FILE" ] || _ts_env_die "no node id at ~/.ccrc/node-id — run ccrc install; nothing was claimed"
  [ -f "$NODE_ID_FILE" ] && [ -r "$NODE_ID_FILE" ] || _ts_env_die "~/.ccrc/node-id is not a readable file — nothing was claimed"
  nid=''
  IFS= read -r nid < "$NODE_ID_FILE" || :
  [[ "$nid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
    || _ts_env_die "~/.ccrc/node-id is not a lowercase uuid — nothing was claimed"

  # ~/.cc-secrets: created 0700 when absent; an existing one keeps its mode.
  if [ ! -d "$SECRETS" ]; then
    mkdir -p -m 0700 -- "$SECRETS" 2>/dev/null \
      || _ts_refuse write-failed "~/.cc-secrets could not be created; nothing was claimed"
  fi
  T_RESP="$(mktemp "$SECRETS/${TMP_PREFIX}XXXXXX" 2>/dev/null)" \
    || _ts_refuse write-failed "no temp file could be made in ~/.cc-secrets; nothing was claimed"
  T_TOKEN="$(mktemp "$SECRETS/${TMP_PREFIX}XXXXXX" 2>/dev/null)" \
    || _ts_refuse write-failed "no temp file could be made in ~/.cc-secrets; nothing was claimed"

  # THE CLAIM. The body is a curl config line on stdin (`-K -`), so the code
  # is on no argv; the answer goes to a 0600 temp, never to stdout.
  status="$(printf 'data = "{\\"code\\":\\"%s\\",\\"nodeId\\":\\"%s\\"}"\n' "$code" "$nid" \
    | curl -sS -K - -H 'content-type: application/json' -X POST -o "$T_RESP" -w '%{http_code}' \
      --max-filesize "$CLAIM_MAX_BYTES" --max-time "$CALL_MAX_TIME" "$URL$CLAIM_PATH" 2>/dev/null)"; rc=$?
  code=''
  if [ "$rc" -ne 0 ] || [ -z "$status" ] || [ "$status" = 000 ]; then
    _ts_refuse claim-refused "the claim door gave no answer (curl rc $rc)"
  fi
  if [ "$status" != 200 ]; then
    word="$(python3 -c "$_TS_ERROR_PY" "$T_RESP" 2>/dev/null)" || word=''
    [ "$status" = 410 ] && [ "$word" = code-used ] \
      && _ts_refuse code-used "the claim door answered 410 code-used: someone claimed this code first"
    _ts_refuse claim-refused "the claim door answered $status${word:+ $word}"
  fi

  verdict="$(python3 -c "$_TS_WRITE_PY" "$T_RESP" "$TOKEN_FILE" "$T_TOKEN" "$FLEET_COMMENT" \
    "$VALUE_RE" "$GEN_RE" "$CLAIM_MAX_BYTES" 2>/dev/null)" || verdict='fail python3 did not finish'
  rm -f -- "$T_RESP"; T_RESP=''
  case "$verdict" in
    'ok '*)
      T_TOKEN=''
      R_GEN="${verdict#ok }"
      [[ "$R_GEN" =~ $GEN_RE ]] || { R_GEN=''; _ts_refuse write-failed "the writer answered no generation"; } ;;
    'bad '*) _ts_refuse claim-refused "${verdict#bad }; nothing was written" ;;
    'fail '*) _ts_refuse write-failed "${verdict#fail }; the old token file is unchanged" ;;
    *) _ts_refuse write-failed "the writer gave no verdict; the old token file is unchanged" ;;
  esac

  # The generation record, after the token file.
  T_GEN="$(mktemp "$CCRC_DIR/${TMP_PREFIX}XXXXXX" 2>/dev/null)" \
    && printf '%s\n' "$R_GEN" > "$T_GEN" \
    && _ts_rename "$T_GEN" "$GEN_FILE" \
    || _ts_refuse write-failed "the token file was written, but ~/.ccrc/box-token-generation could not be"
  T_GEN=''

  # THE PROOF: the file as every reader reads it, presented once to a lane
  # that always checks the token. 400 is proved (accepted, query missing);
  # 401 is proof-failed; anything else is proof-unmeasured, never folded in.
  _ts_read_value "$TOKEN_FILE"
  [ -n "$tok" ] || _ts_refuse write-failed "the token file carries no value line after the write"
  status="$(printf 'header = "x-ccrc-mail-token: %s"\n' "$tok" \
    | curl -sS -K - -o /dev/null -w '%{http_code}' --max-time "$CALL_MAX_TIME" "$URL$PROOF_PATH" 2>/dev/null)"; rc=$?
  tok=''
  if [ "$rc" -eq 0 ] && [ "$status" = 400 ]; then
    R_PROOF=proved
  elif [ "$rc" -eq 0 ] && [ "$status" = 401 ]; then
    R_PROOF=proof-failed
    _ts_refuse proof-failed "the server refused the value it handed out (GET $PROOF_PATH answered 401)"
  else
    R_PROOF=proof-unmeasured
    _ts_refuse proof-unmeasured "the proof call was not measured (GET $PROOF_PATH: ${status:-no status}, curl rc $rc)"
  fi

  _ts_report synced
  printf 'synced %s %s\n' "$R_GEN" "$R_TRANSPORT"
  exit 0
}

[ $# -gt 0 ] || _ts_usage_die "missing subverb"
sub="$1"; shift
case "$sub" in
  sync)  cmd_sync "$@" ;;
  -h|--help) _ts_usage; exit 0 ;;
  *) _ts_usage_die "unknown subverb: $sub" ;;
esac
```

`ccd/ccrc`, lines 1379-1382 become:

```bash
#   W6 — versions (a kept version is a flip: `_upd_restore_arm1`, `_ver_flip_back`).
#   box-token lifecycle wave 1 — token-sync (`cmd_token` and the
#        `ccd/ccrc-token-sync` it runs: the verb ccrc-agent's `token-sync` op
#        spawns). Every os: the op runs it in the foreground, never --detach.
# ccrc-install.test.ts pins every word to the machinery it names, so a word
# cannot ship ahead of its code.
CCRC_CAP_WORDS=(verify node-id floor update-json update-gate rollback versions token-sync)
```

Line 2011 (inside `usage()`) becomes:

```text
usage: $PROG {doctor|status|adopt|wrappers|account|memory|models|codex|install|update|rollback|versions|channel|rollout|uninstall|backup|logs|passwd|expose|token|restamp|version|watchdog}
```

Insert before line 2229 (`  restamp   re-stamp one file ccrc generated …`):

```text
  token     the box token's fleet side. "ccrc token sync --from agent" is
            ccrc-agent's token-sync op: it trades a one-time code (on stdin)
            for the new value, writes ~/.cc-secrets/ccrc-mail.token and
            proves it with one call
```

Insert after `cmd_adopt`'s closing brace (line 5235):

```bash

# ── cmd_token — the box token's fleet side (design 2026-10-07 §4.5) ───────
# The body is the standalone `ccd/ccrc-token-sync`, beside this file, exactly
# as `cmd_adopt` reaches `ccrc-adopt` and for its reasons: `exec "$BASH"`, so
# no PATH lookup and no dependence on the exec bit, and the sibling's own
# usage, exit codes and stdout/stderr split arrive unaltered. That file owns
# every argument; this function parses none. Kept out of this file because
# `ccd/ccrc` is a hot file other runs edit, and the verb's whole contract
# (the claim, the atomic write, the proof) is one reviewable unit there.
cmd_token() {
  local body="$CCRC_HERE/ccrc-token-sync"
  [[ -f "$body" ]] \
    || _ccrc_die "token's script is missing: $body — is this a complete ccrc install?"
  exec "$BASH" "$body" "$@"
}
```

Insert after line 23816 (`  expose)  cmd_expose "$@" ;;`):

```bash
  token)   cmd_token "$@" ;;
```

- [ ] **Step 9: Run it to verify it passes**

```bash
mkdir -p .tmp-b1 && (cd server && TMPDIR="$PWD/../.tmp-b1" ./node_modules/.bin/vitest run test/ccrc-token-sync.test.ts)
```

Expected: `27 passed (27)` (26 prototyped plus the synced-line parity case). Then, one call each, Step 4's three commands: `36 passed (36)`, `4 passed | 312 skipped
(316)`, `4 passed | 510 skipped (514)`; Step 6's command: `95 passed (95)`; and the scans the new shell file enters:

```bash
mkdir -p .tmp-b1 && (cd server && TMPDIR="$PWD/../.tmp-b1" ./node_modules/.bin/vitest run test/macos-platform.test.ts -t 'ccrc-token-sync|corpus is derived')
mkdir -p .tmp-b1 && (cd server && TMPDIR="$PWD/../.tmp-b1" ./node_modules/.bin/vitest run test/topology-clean.test.ts)
mkdir -p .tmp-b1 && (cd server && TMPDIR="$PWD/../.tmp-b1" ./node_modules/.bin/vitest run test/source-bytes.test.ts)
```

Expected: `2 passed | 107 skipped (109)` (the case `macos-platform.test.ts` derives for `ccd/ccrc-token-sync`, which
joins its corpus automatically, and the corpus floor), `55 passed (55)`, `2 passed (2)`.

- [ ] **Step 10: Mutation checks — each guard reds its own test; restore after each**

Run `mkdir -p .tmp-b1 && (cd server && TMPDIR="$PWD/../.tmp-b1" ./node_modules/.bin/vitest run test/ccrc-token-sync.test.ts -t '<filter>')` after each one-line mutation of
`ccd/ccrc-token-sync`, then restore the file (`git checkout -- ccd/ccrc-token-sync` is NOT available before the
commit: keep a copy, `cp ccd/ccrc-token-sync .tmp-b1/verb.bak`, and copy it back):

| Mutation | Filter | Measured red |
|---|---|---|
| `set +x   # FIRST LINE …` -> `:   # FIRST LINE …` | `xtrace` | `a secret reached stderr: expected true to be false` |
| in `_ts_client_ok`, `[ -e "$API_CLIENT" ] \|\| return 0` -> `return 0` | `stale-client` | `expected +0 to be 26` |
| the proof's else arm sets `R_PROOF=proof-failed` and refuses `proof-failed` | `proof words` | `ccrc: token sync: proof-failed: the proof call was not measured (GET /api/ledger: 501, curl rc 0)` |
| delete ` or set(doc.keys()) != {"ok", "value", "generation"}` | `not exactly` | `expected +0 to be 21` |
| delete the `  _ts_sweep` call in `cmd_sync` | `swept` | `expected [ '.ccrc-token-sync.AAAAAA', …(1) ] to deeply equal []` |

- [ ] **Step 11: Commit** (afterwards, from the repo root: `rm -rf .tmp-b1`)

```bash
git add ccd/ccrc-token-sync ccd/ccrc server/test/ccrc-token-sync.test.ts server/test/containedTools.ts \
  server/test/ccrc-containment.test.ts server/test/ccrc-cli.test.ts server/test/ccrc-install.test.ts \
  server/test/ccrc-update.test.ts
git commit -m "feat(token): ccrc token sync — the fleet verb the token-sync op spawns, and its cap word

Claims a one-time code at POST /api/token/claim over curl -K -, writes
~/.cc-secrets/ccrc-mail.token atomically with its preamble kept, records the
generation, proves the file with GET /api/ledger (400/401/other), and reports
to ~/.ccrc/token-sync.json. The shell spellings are pinned to L0. The test
harness's loopback curl front admits the one claim data line.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B2: ccrc token probe

(prototype) measured: server/test/ccrc-token-sync.test.ts -t 'ccrc token probe': red 8 failed -> green 34 passed (the whole file), 2026-10-07 on main 282e79e44
(prototype) measured mutation: the value echoed to stderr before the call -> "never prints the value …" red (`a secret reached stderr`), restored

**Files:**
- Modify: `ccd/ccrc-token-sync` (Task B1's file): the header comment (after the `sync` paragraph), `_ts_usage`, a new `cmd_probe` before the dispatch, the dispatch's `probe)` line.
- Modify: `ccd/ccrc`: the `token` usage paragraph Task B1 inserted (its last line).
- Test: `server/test/ccrc-token-sync.test.ts` (one describe appended).

**Interfaces:**
- Consumes: Task B1's `_ts_set_url`, `_ts_read_value`, `URL`, `PROOF_PATH`, `CALL_MAX_TIME`, `AGENT_ENV`, `_ts_usage_die`.
- Produces: `ccrc token probe --file <path> [--url <base>]` — prints exactly one stdout line `probe: <3-digit status> <accepted|refused|unmeasured>` (400 accepted, 401 refused, anything else or no answer `000 unmeasured`); exit 0 on a measured 400 or 401, 1 otherwise; exit 1 with no call when the file cannot be read or has no value line, or no base can be found; exit 2 on usage. Never prints the value; the value reaches curl only on stdin through `-K -`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccrc-token-sync.test.ts`:

```ts
describe('ccrc token probe --file <path> [--url <base>] (spec §10.3)', () => {
  /** A probe box: the recorder answers the proof call only. */
  const probeBox = (prefix: string, status: number): { home: string; file: string } => {
    const home = box(prefix);
    proofAnswers(home, status);
    const file = join(home, 'probe-me.token');
    writeFileSync(file, `${PREAMBLE}${VALUE}\n`, { mode: 0o600 });
    return { home, file };
  };
  const probe = (home: string, args: string[]): Run => runToken(home, ['probe', ...args], '');

  for (const [status, word, rc] of [[400, 'accepted', 0], [401, 'refused', 0], [501, 'unmeasured', 1], [503, 'unmeasured', 1]] as const) {
    it(`${status}: prints exactly "probe: ${status} ${word}" and exits ${rc}`, () => {
      const { home, file } = probeBox(`tok-probe-${status}-`, status);
      const r = probe(home, ['--file', file]);
      expect(r.code, r.stderr).toBe(rc);
      expect(r.stdout).toBe(`probe: ${status} ${word}\n`);
      expect(calls(home)).toBe(1);
      expect(callArgv(home, 1).at(-1)).toBe('https://example.invalid/api/ledger');
      expect(callArgv(home, 1).join(' ')).toMatch(/-K - /);
      expect(callStdin(home, 1)).toBe(`header = "x-ccrc-mail-token: ${VALUE}"\n`);
    });
  }

  it('no answer at all is "probe: 000 unmeasured", exit 1', () => {
    const { home, file } = probeBox('tok-probe-norc-', 400);
    writeFileSync(join(home, 'fixture-proof-rc'), '7\n');
    const r = probe(home, ['--file', file]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('probe: 000 unmeasured\n');
  });

  it('--url overrides agent.env, and a ws:// base is rewritten as the verb rewrites it', () => {
    const { home, file } = probeBox('tok-probe-url-', 401);
    const r = probe(home, ['--file', file, '--url', 'ws://127.0.0.1:7788/']);
    expect(r.stdout).toBe('probe: 401 refused\n');
    expect(callArgv(home, 1).at(-1)).toBe('http://127.0.0.1:7788/api/ledger');
  });

  it('never prints the value or its sha256 — not on stdout, stderr, curl\'s argv or its environment', () => {
    for (const status of [400, 401, 501]) {
      const { home, file } = probeBox(`tok-probe-secret-${status}-`, status);
      const r = probe(home, ['--file', file]);
      expectNoSecret(home, r);
      // And the hunt is not vacuous: the value really was sent, on stdin.
      expect(callStdin(home, 1)).toContain(VALUE);
    }
  });

  it('a file with no value line, or that cannot be read, exits 1 with no call; a missing --file is usage, exit 2', () => {
    const { home, file } = probeBox('tok-probe-empty-', 400);
    writeFileSync(file, '# only a comment\n\n');
    let r = probe(home, ['--file', file]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    r = probe(home, ['--file', join(home, 'absent.token')]);
    expect(r.code).toBe(1);
    expect(calls(home)).toBe(0);
    expect(probe(home, []).code).toBe(2);
    expect(probe(home, ['--file']).code).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
mkdir -p .tmp-b2 && (cd server && TMPDIR="$PWD/../.tmp-b2" ./node_modules/.bin/vitest run test/ccrc-token-sync.test.ts -t 'ccrc token probe')
```

Expected: `8 failed | 26 skipped (34)`; each run answers `ccrc: token: unknown subverb: probe` at exit 2.

- [ ] **Step 3: Write the minimal implementation**

In `ccd/ccrc-token-sync`'s header, after the `sync` paragraph (the line `#       ~/.ccrc/token-sync.json for doctor.`) insert:

```bash
#   ccrc token probe --file <path> [--url <base>]
#       Presents the value line of <path> to GET <base>/api/ledger and prints
#       `probe: <status> <accepted|refused|unmeasured>`. Never prints the value.
```

In `_ts_usage`, after the `usage: ccrc token sync --from agent …` line insert:

```text
       ccrc token probe --file <path> [--url <base>]
```

Insert before the dispatch (the line `[ $# -gt 0 ] || _ts_usage_die "missing subverb"`):

```bash
cmd_probe() {
  local file='' base='' status rc word
  while [ $# -gt 0 ]; do
    case "$1" in
      --file) [ $# -ge 2 ] || _ts_usage_die "--file needs a path"; file="$2"; shift 2 ;;
      --url)  [ $# -ge 2 ] || _ts_usage_die "--url needs a base address"; base="$2"; shift 2 ;;
      *) _ts_usage_die "unknown argument: $1" ;;
    esac
  done
  [ -n "$file" ] || _ts_usage_die "probe needs --file <path>"
  command -v curl >/dev/null 2>&1 || { echo "ccrc: token probe: curl is not on PATH" >&2; exit 1; }
  if [ -n "$base" ]; then
    _ts_set_url "$base" || { echo "ccrc: token probe: --url is not an http, https, ws or wss address" >&2; exit 1; }
  else
    [ -r "$AGENT_ENV" ] || { echo "ccrc: token probe: no --url, and ~/.ccrc/agent.env cannot be read" >&2; exit 1; }
    base="$(grep -E '^[[:space:]]*CCRC_SERVER_URL=' "$AGENT_ENV" | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
    _ts_set_url "$base" || { echo "ccrc: token probe: no --url, and no usable CCRC_SERVER_URL in ~/.ccrc/agent.env" >&2; exit 1; }
  fi
  [ -f "$file" ] && [ -r "$file" ] || { echo "ccrc: token probe: the file cannot be read" >&2; exit 1; }
  _ts_read_value "$file"
  [ -n "$tok" ] || { echo "ccrc: token probe: the file carries no value line" >&2; exit 1; }
  status="$(printf 'header = "x-ccrc-mail-token: %s"\n' "$tok" \
    | curl -sS -K - -o /dev/null -w '%{http_code}' --max-time "$CALL_MAX_TIME" "$URL$PROOF_PATH" 2>/dev/null)"; rc=$?
  tok=''
  [ "$rc" -eq 0 ] && [[ "$status" =~ ^[0-9]{3}$ ]] || status=000
  case "$status" in
    400) word=accepted ;;
    401) word=refused ;;
    *)   word=unmeasured ;;
  esac
  printf 'probe: %s %s\n' "$status" "$word"
  [ "$word" != unmeasured ]
}

```

In the dispatch, after `  sync)  cmd_sync "$@" ;;` insert:

```bash
  probe) cmd_probe "$@" ;;
```

In `ccd/ccrc`'s `token` usage paragraph, the last line `            proves it with one call` becomes:

```text
            proves it with one call. "ccrc token probe --file <path>
            [--url <base>]" presents a file's value once and prints only the
            HTTP status and accepted, refused or unmeasured
```

- [ ] **Step 4: Run it to verify it passes**

```bash
mkdir -p .tmp-b2 && (cd server && TMPDIR="$PWD/../.tmp-b2" ./node_modules/.bin/vitest run test/ccrc-token-sync.test.ts)
mkdir -p .tmp-b2 && (cd server && TMPDIR="$PWD/../.tmp-b2" ./node_modules/.bin/vitest run test/ccrc-cli.test.ts)
```

Expected: `34 passed (34)`; `36 passed (36)` (the paragraph's first line, which the usage pin reads, is unchanged).

- [ ] **Step 5: Mutation check**

After `[ -n "$tok" ] || { echo "ccrc: token probe: the file carries no value line" >&2; exit 1; }` insert
`  echo "probing with $tok" >&2`; run with `-t 'never prints the value'`. Measured: `1 failed | 33 skipped (34)`,
`a secret reached stderr: expected true to be false`. Restore.

- [ ] **Step 6: Commit** (afterwards, from the repo root: `rm -rf .tmp-b2`)

```bash
git add ccd/ccrc-token-sync ccd/ccrc server/test/ccrc-token-sync.test.ts
git commit -m "feat(token): ccrc token probe — present one file's value, print only the status and its word

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B3: Uninstall and purge rules for the new files

(prototype) measured: server/test/ccrc-uninstall.test.ts -t "box token's files": red 1 failed | 1 passed (the purge case is a standing pin: `--purge` already takes `~/.ccrc` whole and never touches `~/.cc-secrets`) -> green 2 passed; with the line pins: -t "box token's files|PRESERVED without --purge|the versions root and a stray migration|--purge" green 15 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/install-census.test.ts: red 1 failed | 24 passed -> green 25 passed, 2026-10-07 on main 282e79e44
(prototype) measured mutation: `"$HOME/.cc-secrets/ccrc-mail.token"` added to the new `rm -f` -> the FORBIDDEN scan reds (`expected [ Array(1) ] to deeply equal []`), restored

**Files:**
- Modify: `ccd/ccrc` at 282e79e44: two file-scope globals inserted after `BOX_FLOOR_FILE="$HOME/.ccrc/floor"` (1371); one `rm -f` inserted in `_uninst_tree_bins` after the node update-state `rm` (after 23506); one `echo` inserted after the tree line (after 23562).
- Test: `server/test/ccrc-uninstall.test.ts` (one describe appended at end of file, 2388 lines at 282e79e44); `server/test/install-census.test.ts` (one describe appended at end of file, 1945 lines at 282e79e44). Both import `NODE_FILES` DYNAMICALLY inside the case, so neither file gains a top-of-file import line (no line anchor above moves).
- No existing pin moves: the uninstall's long `uninstall: tree: ~/ccrc removed; …` line is unchanged (four regexes in `ccrc-uninstall.test.ts` at 781, 1166, 1190 and 1222 read it), and the new sentence is its own line.

**Interfaces:**
- Consumes: `NODE_FILES.tokenGeneration` (Task A1); the report name `token-sync.json` (Task B1).
- Produces: `BOX_TOKEN_GENERATION_FILE`, `BOX_TOKEN_SYNC_REPORT` (file-scope in `ccd/ccrc`); uninstall removes both; `box-token.json`, `box-token-retired.json`, `mail.token`, `mail-previous.token`, `mail-pending-<id>.token` stay; `--purge` takes `~/.ccrc` whole; neither touches `~/.cc-secrets/ccrc-mail.token`. One stdout line: `uninstall: tree: the box token's node records (~/.ccrc/box-token-generation, token-sync.json) removed; its value and state files stay with ~/.ccrc/mail.token, and ~/.cc-secrets/ccrc-mail.token is not touched`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccrc-uninstall.test.ts`:

```ts
// ── the box token's files (box-token lifecycle wave 1, Task B3; spec 2026-10-07 §8) ──
// Uninstall removes the two NODE-SCOPED, non-secret records `ccrc token sync`
// writes, with the node files; the value and state files stay with mail.token
// (a reinstall never finds value files without their state); `--purge` takes
// `~/.ccrc` whole; and neither ever touches `~/.cc-secrets/ccrc-mail.token`,
// because that directory also holds operator lane secrets. Every value below is
// a fixture.
describe('ccrc uninstall: the box token\'s files (box-token lifecycle wave 1, Task B3)', () => {
  const GEN = '0123456789abcdef';
  const V = (c: string): string => `${c.repeat(64)}\n`;
  /** The files that must survive a plain uninstall, byte for byte, as name -> bytes. */
  const KEPT: Record<string, string> = {
    'mail.token': V('a'),
    'mail-previous.token': V('b'),
    [`mail-pending-${GEN}.token`]: V('c'),
    'box-token.json': '{"v":1,"origin":"rotated"}\n',
    'box-token-retired.json': '{"v":1,"retired":[]}\n',
  };
  const plantTokenFiles = (home: string, generationName: string): void => {
    writeFileSync(join(home, '.ccrc', generationName), `${GEN}\n`, { mode: 0o600 });
    writeFileSync(join(home, '.ccrc', 'token-sync.json'),
      `{"v":1,"at":1,"result":"synced","generation":"${GEN}","transport":"https","proof":"proved"}\n`, { mode: 0o600 });
    for (const [n, b] of Object.entries(KEPT)) writeFileSync(join(home, '.ccrc', n), b, { mode: 0o600 });
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, '.cc-secrets', 'ccrc-mail.token'), `# fleet copy\n${V('d')}`, { mode: 0o600 });
    writeFileSync(join(home, '.cc-secrets', 'lane.secret'), 'operator lane secret\n', { mode: 0o600 });
  };

  it('a plain uninstall removes box-token-generation and token-sync.json, and keeps every value and state file and ~/.cc-secrets', async () => {
    const { NODE_FILES } = await import('../../shared/agent-protocol.js');
    const home = mkTmp('ccrc-uninst-token-');
    plantInstalledBox(home);
    plantTokenFiles(home, NODE_FILES.tokenGeneration);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.ccrc', NODE_FILES.tokenGeneration)), 'the generation record survived').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'token-sync.json')), 'the sync report survived').toBe(false);
    for (const [n, b] of Object.entries(KEPT)) {
      expect(readFileSync(join(home, '.ccrc', n), 'utf8'), `${n} was not kept byte for byte`).toBe(b);
    }
    expect(readFileSync(join(home, '.cc-secrets', 'ccrc-mail.token'), 'utf8')).toBe(`# fleet copy\n${V('d')}`);
    expect(readFileSync(join(home, '.cc-secrets', 'lane.secret'), 'utf8')).toBe('operator lane secret\n');
    expect(r.stdout).toMatch(/^uninstall: tree: the box token's node records \(~\/\.ccrc\/box-token-generation, token-sync\.json\) removed; its value and state files stay with ~\/\.ccrc\/mail\.token, and ~\/\.cc-secrets\/ccrc-mail\.token is not touched$/m);
  });

  it('--purge takes ~/.ccrc whole, value and state files included, and still never touches ~/.cc-secrets', async () => {
    const { NODE_FILES } = await import('../../shared/agent-protocol.js');
    const home = mkTmp('ccrc-uninst-token-purge-');
    plantInstalledBox(home);
    plantTokenFiles(home, NODE_FILES.tokenGeneration);
    const r = runVerb(home, 'uninstall', ['--purge']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
    expect(readFileSync(join(home, '.cc-secrets', 'ccrc-mail.token'), 'utf8')).toBe(`# fleet copy\n${V('d')}`);
    expect(readFileSync(join(home, '.cc-secrets', 'lane.secret'), 'utf8')).toBe('operator lane secret\n');
  });
});
```

Append to `server/test/install-census.test.ts`:

```ts
// ── the box token's files (box-token lifecycle wave 1, Task B3; spec 2026-10-07 §8) ──
// The static half of `ccrc-uninstall.test.ts`'s behavioural case: the two
// node records are `rm -f` operands of `_uninst_tree_bins`, spelled through
// file-scope globals whose values are pinned to L0's `NODE_FILES.tokenGeneration`
// and the report's name; and no `rm` in any uninstall function names a box-token
// value or state file or anything under `~/.cc-secrets`. `--purge`'s `rm -rf`
// of `~/.ccrc` names none of them, so it stays legal.
describe('the box token\'s files: uninstall removes the two node records and names no value, state or fleet token file (Task B3)', () => {
  /** A file-scope `NAME="…"` assignment in ccd/ccrc, which must appear exactly once. */
  const fileScope = (name: string): string => {
    const all = [...CCRC.matchAll(new RegExp(`^${name}="([^"]*)"$`, 'gm'))];
    expect(all.length, `${name}= is assigned ${all.length} times at file scope in ccd/ccrc`).toBe(1);
    return all[0]![1]!;
  };

  it('_uninst_tree_bins removes both node records, through globals that name NODE_FILES.tokenGeneration and token-sync.json', async () => {
    const { NODE_FILES } = await import('../../shared/agent-protocol.js');
    expect(fileScope('BOX_TOKEN_GENERATION_FILE')).toBe(`$HOME/.ccrc/${NODE_FILES.tokenGeneration}`);
    expect(fileScope('BOX_TOKEN_SYNC_REPORT')).toBe('$HOME/.ccrc/token-sync.json');
    expect(rmFOperands(fnBody('_uninst_tree_bins')))
      .toEqual(expect.arrayContaining(['$BOX_TOKEN_GENERATION_FILE', '$BOX_TOKEN_SYNC_REPORT']));
  });

  it('no rm in cmd_uninstall or an _uninst_ function names a box-token value or state file, or ~/.cc-secrets', () => {
    const fns = [...CCRC.matchAll(/^(cmd_uninstall|_uninst_[a-z_]+)\(\) \{/gm)].map((m) => m[1]!);
    expect(fns.length, 'the uninstall function scan is over nothing').toBeGreaterThan(8);
    const FORBIDDEN = /mail\.token|mail-previous|mail-pending|box-token\.json|box-token-retired|\.cc-secrets/;
    const hits = fns.flatMap((fn) => calls(fnBody(fn), 'rm').flat()
      .filter((w) => FORBIDDEN.test(w)).map((w) => `${fn}: rm … ${w}`));
    expect(hits).toEqual([]);
  });

  it('CONTROL: the FORBIDDEN scan sees a planted removal of the fleet token file', () => {
    const planted = '\n  rm -f -- "$HOME/.cc-secrets/ccrc-mail.token"\n';
    const FORBIDDEN = /mail\.token|mail-previous|mail-pending|box-token\.json|box-token-retired|\.cc-secrets/;
    expect(calls(planted, 'rm').flat().filter((w) => FORBIDDEN.test(w))).toEqual(['$HOME/.cc-secrets/ccrc-mail.token']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
mkdir -p .tmp-b3 && (cd server && TMPDIR="$PWD/../.tmp-b3" ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts -t "box token's files")
mkdir -p .tmp-b3 && (cd server && TMPDIR="$PWD/../.tmp-b3" ./node_modules/.bin/vitest run test/install-census.test.ts)
```

Expected: `1 failed | 1 passed | 84 skipped (86)` — `the generation record survived: expected true to be false`;
and `1 failed | 24 passed (25)` — `BOX_TOKEN_GENERATION_FILE= is assigned 0 times at file scope in ccd/ccrc`.

- [ ] **Step 3: Write the minimal implementation**

`ccd/ccrc`, after line 1371 (`BOX_FLOOR_FILE="$HOME/.ccrc/floor"`) insert:

```bash

# ── THE BOX TOKEN'S TWO NODE-SCOPED, NON-SECRET FILES (design 2026-10-07 §4.5, §8)
#   box-token-generation — the generation id the last `ccrc token sync` wrote
#                          (NODE_FILES.tokenGeneration; the server reads it
#                          over the agent's node-file grant);
#   token-sync.json      — that run's report, which doctor reads.
# Both are written by `ccd/ccrc-token-sync`, which spells its own copies (it
# is a standalone file and sources nothing); uninstall removes them with the
# node files. The box token's VALUE and STATE files — mail.token, its
# pending and previous siblings, box-token.json, box-token-retired.json —
# are not node files: they stay with mail.token, so a reinstall never finds
# value files without their state, and only --purge takes them (with
# ~/.ccrc whole). ~/.cc-secrets/ccrc-mail.token is never this verb's: that
# directory also holds operator lane secrets.
BOX_TOKEN_GENERATION_FILE="$HOME/.ccrc/box-token-generation"
BOX_TOKEN_SYNC_REPORT="$HOME/.ccrc/token-sync.json"
```

In `_uninst_tree_bins`, after the node update-state removal (lines 23504-23506, ending
`|| _ccrc_die "removing the node's update state files failed"`) insert:

```bash
  # The box token's two node-scoped records go with them (design 2026-10-07
  # §8): an uninstalled box confirms no generation and has no sync to report.
  # The value and state files are NOT here, on purpose (see their
  # declaration): they stay with mail.token.
  rm -f -- "$BOX_TOKEN_GENERATION_FILE" "$BOX_TOKEN_SYNC_REPORT" \
    || _ccrc_die "removing the box token's generation record and sync report failed"
```

After line 23562 (the `echo "uninstall: tree: ~/ccrc removed; …$vsaid$msaid$nsaid"` line) insert:

```bash
  echo "uninstall: tree: the box token's node records (~/.ccrc/box-token-generation, token-sync.json) removed; its value and state files stay with ~/.ccrc/mail.token, and ~/.cc-secrets/ccrc-mail.token is not touched"
```

- [ ] **Step 4: Run them to verify they pass**

```bash
mkdir -p .tmp-b3 && (cd server && TMPDIR="$PWD/../.tmp-b3" ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts -t "box token's files|PRESERVED without --purge|the versions root and a stray migration|--purge")
mkdir -p .tmp-b3 && (cd server && TMPDIR="$PWD/../.tmp-b3" ./node_modules/.bin/vitest run test/install-census.test.ts)
```

Expected: `15 passed | 71 skipped (86)` (the two new cases, plus the existing cases whose regexes read the uninstall's
lines, unmoved); `25 passed (25)`.

- [ ] **Step 5: Mutation check**

Add `"$HOME/.cc-secrets/ccrc-mail.token"` as a third operand of the new `rm -f`; run
`mkdir -p .tmp-b3 && (cd server && TMPDIR="$PWD/../.tmp-b3" ./node_modules/.bin/vitest run test/install-census.test.ts -t "names a box-token value")`. Measured:
`1 failed | 24 skipped (25)`, `expected [ Array(1) ] to deeply equal []`. Restore. (Deleting the new `rm -f` line
instead reds `ccrc-uninstall.test.ts`'s first new case: `the generation record survived`.)

- [ ] **Step 6: Commit** (afterwards, from the repo root: `rm -rf .tmp-b3`)

```bash
git add ccd/ccrc server/test/ccrc-uninstall.test.ts server/test/install-census.test.ts
git commit -m "feat(token): uninstall removes the box token's two node records and nothing secret

box-token-generation and token-sync.json go with the node files; the value
and state files stay with mail.token; --purge takes ~/.ccrc whole; neither
touches ~/.cc-secrets/ccrc-mail.token.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B4: A rotation through the real verb

(measured) First green run 2026-10-09: `4 passed (4)` in 7.48 s (the four cases below, after the first departure); the file as committed adds a release-lane case and runs `5 passed (5)` in about 9 s. Three departures from the text below, all Part A decisions: the verb's own proof in a pending slot counts as a presentation of the new current (D-4409 item 6), so grace ends on time instead of extending; `view()`'s presentation counters are the holder's live counts, not copied on the last tick; and mutation row 3 (the agent maps exit 0 to `spawn-failed`) does not stop the driver reaching `grace` (the generation read confirms the real sync), it reds on the view's `failures` and `lastSync`.

(not prototyped: the file imports Part A's merged modules — `server/src/token/{boot,driver,link,files,policy,ports}.ts`, `Deps.tokenDriver` and `registerTokenRoutes` (A8), and `agent/src/tokensync.ts` (A2) — none of which exist at 282e79e44. The verb half it drives was prototyped in Task B1's real-curl case, which ran the real `ccd/ccrc-token-sync` and the real curl behind the loopback front against a listener on loopback: green, 2026-10-07)

**Files:**
- Create: `server/test/token-rotation-real-verb.test.ts`.
- No production code. No pin moves.

**Interfaces:**
- Consumes (Part A as merged, by the contract's names): `bootBoxToken`, `BootResult` (A7); `BoxTokenDriver`, `DriverDeps` (A9); `tokenSyncLinkOver`, `generationReaderOver` (A9); `tokenPaths` (A5); `GRACE_MS`, `GateNode` (A6); `TokenSyncLink`, `GenerationReader` (A5 ports); `BoxTokenHolder.match` (A3); `Deps.mailToken`, `Deps.tokenDriver` (A3, A8); `makeTokenSyncSpawn`, `TokenSyncSpawn`, `AgentOpts.spawnTokenSync` (A2); `NODE_FILES.tokenGeneration` (A1); Tasks B1-B3.
- `fileTokenStore(paths: TokenPaths): TokenStore` from `server/src/token/files.ts` (A5).
- A2's real signature: `makeTokenSyncSpawn(env: TokenSyncEnv): TokenSyncSpawn`, where `TokenSyncEnv` is `{ HOME: string; PATH: string; LANG: string }`, built by `tokenSyncEnv(home, from?: NodeJS.ProcessEnv)` (`agent/src/tokensync.ts`); `AgentOpts.spawnTokenSync?: TokenSyncSpawn`. `ccrcContainedEnv` answers `NodeJS.ProcessEnv`, whose `PATH` is `string | undefined`, so the env is built through `tokenSyncEnv`, never as a literal (TS2322 under `typecheck-tests.test.ts` otherwise).
- Behaviour it pins that Part A decides (if A6 or A9 decided otherwise, the case says so by name): `previous.currentPresented` is set only by a `'current'`-slot match after the promotion, so the verb's own proof (a `pending0` match) does not count, and grace extends until the new current value is presented once; `view()`'s presentation counters are the holder's as copied on the last tick.

- [ ] **Step 1: Write the test**

Create `server/test/token-rotation-real-verb.test.ts`:

```ts
// token-rotation-real-verb.test.ts — one rotation through the REAL fleet verb
// (design 2026-10-07 §10.2, Figure 4; plan Task B4). Everything is real and in
// this process except the two boxes' homes, which are fixtures:
//   - the server: `buildServer` with the real holder (`bootBoxToken`), the real
//     claim door and rotate route (`registerTokenRoutes` via `deps.tokenDriver`),
//     a real coord store (so `GET /api/ledger` answers 400, not 501), on loopback;
//   - the driver: `BoxTokenDriver` with the real link (`tokenSyncLinkOver`) and
//     the real generation reader (`generationReaderOver`) over a real
//     `connectFleet` client;
//   - the agent: `startAgent` with `spawnTokenSync: makeTokenSyncSpawn(...)`,
//     which spawns `<fleet home>/.local/bin/ccrc token sync --from agent` — a
//     launcher into THIS checkout's `ccd/ccrc`, which runs the real
//     `ccd/ccrc-token-sync` with the real curl behind the loopback front.
// Only the gate's rows are a literal (a `GateRowsSource` is a port; index.ts
// maps coord's node rows, which this file has no inventory sweep to fill), and
// a case that needs a lost result or a blind read wraps the real link or reader.
//
// The values are FIXTURES: OLD is planted, the new value is whatever the server
// minted, read back from the fixture files only to compare them.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { bootBoxToken } from '../src/token/boot.js';
import { BoxTokenDriver } from '../src/token/driver.js';
import { tokenSyncLinkOver, generationReaderOver } from '../src/token/link.js';
import { fileTokenStore, tokenPaths } from '../src/token/files.js';
import { GRACE_MS, type GateNode } from '../src/token/policy.js';
import type { GenerationReader, TokenSyncLink } from '../src/token/ports.js';
import { makeTokenSyncSpawn, tokenSyncEnv, type TokenSyncSpawn } from '../../agent/src/tokensync.js';
import { bootAgent, connectToAgent } from './remoteHelpers.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import type { RunningAgent } from '../../agent/src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { harnessBin } from './ccdWsHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import type { NodeOs } from '../../shared/api.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = join(REPO, 'ccd', 'ccrc');
const OLD = ['0d', 'd0'].join('').repeat(16);
const NODE_ID = '0123abcd-0000-4000-8000-000000000001';
const PREAMBLE = '# ccrc box token — fixture preamble\n\n';
const CAPS = ['verify', 'node-id', 'floor', 'update-json', 'update-gate', 'rollback', 'versions', 'token-sync', 'detach'];
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');
/** The extraction rule every reader applies: the first non-blank, non-`#` line. */
const valueOf = (p: string): string =>
  read(p).split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#')) ?? '';

interface Opts {
  link?: (real: TokenSyncLink) => TokenSyncLink;
  generation?: (real: GenerationReader) => GenerationReader;
  agentOps?: readonly string[];        // the fleet row's ops, instead of the live ready frame's
  caps?: readonly string[];
  os?: NodeOs;
  launcher?: 'real' | 'no-verb';
}
interface Harness {
  serverHome: string; fleetHome: string; port: number;
  driver: BoxTokenDriver; holder: Awaited<ReturnType<typeof bootBoxToken>>['holder'];
  spawned: () => number; advance: (ms: number) => void; warnings: string[];
  fleetToken: string; serverToken: string;
  probe: (file: string) => Promise<string>;
  tickUntil: (pred: () => boolean, max?: number) => Promise<void>;
  close: () => Promise<void>;
}

const open: Harness[] = [];
afterEach(async () => { while (open.length > 0) await open.pop()!.close(); });

async function waitFor(pred: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error('waitFor: condition never held');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function harness(o: Opts = {}): Promise<Harness> {
  let offset = 0;
  const clock = (): number => Date.now() + offset;
  const warnings: string[] = [];

  // ── the server box ──
  const serverHome = mkTmp('tok-real-server-');
  const base = testDeps(serverHome);
  mkdirSync(path.dirname(base.cfg.mailTokenPath), { recursive: true });
  writeFileSync(base.cfg.mailTokenPath, `${OLD}\n`, { mode: 0o600 });   // hand-made: adopted, rotation owed
  const db = openCoordDb(join(serverHome, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const boot = await bootBoxToken({ mailTokenPath: base.cfg.mailTokenPath, home: serverHome,
    role: 'server', roleSource: 'recorded', fleetMode: 'remote', now: clock() });
  warnings.push(...boot.warnings);

  // ── the fleet box ──
  const fleetHome = mkTmp('tok-real-fleet-');
  for (const d of ['.cc-sessions', '.cc-limits', '.cc-clips', '.claude', '.ccrc']) mkdirSync(join(fleetHome, d), { recursive: true });
  mkdirSync(join(fleetHome, '.cc-secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(fleetHome, '.ccrc', 'node-id'), `${NODE_ID}\n`);
  const fleetToken = join(fleetHome, '.cc-secrets', 'ccrc-mail.token');
  writeFileSync(fleetToken, `${PREAMBLE}${OLD}\n`, { mode: 0o600 });
  let target = CCRC;
  if (o.launcher === 'no-verb') {
    // A ccrc from before the verb: this checkout's ccrc with its `token)` dispatch line removed, so
    // `ccrc token …` is `_ccrc_usage_die`'s "unknown argument: token" (D-4395's first prefix).
    const old = join(fleetHome, 'old-tree', 'ccd');
    mkdirSync(old, { recursive: true });
    const src = readFileSync(CCRC, 'utf8');
    const line = '  token)   cmd_token "$@" ;;\n';
    expect(src.split(line).length - 1, 'the token dispatch line moved — re-point this fixture').toBe(1);
    target = join(old, 'ccrc');
    writeFileSync(target, src.replace(line, ''), { mode: 0o755 });
  }
  // The launcher the agent's frozen argv names (updateLauncherPath): <home>/.local/bin/ccrc.
  writeFileSync(join(harnessBin(fleetHome), 'ccrc'), `#!/usr/bin/env bash\nexec bash ${JSON.stringify(target)} "$@"\n`, { mode: 0o755 });
  const env = ccrcContainedEnv(fleetHome, process.env, { managers: true, curl: 'loopback' });
  assertNoRealTool(env, fleetHome);
  const real = makeTokenSyncSpawn(tokenSyncEnv(fleetHome, { PATH: env['PATH'], LANG: 'C' }));
  let spawned = 0;
  const counted = ((...a: Parameters<TokenSyncSpawn>) => { spawned += 1; return real(...a); }) as TokenSyncSpawn;
  const agent: RunningAgent = await bootAgent({ home: fleetHome, projectsRoot: mkTmp('tok-real-projects-') },
    { spawnTokenSync: counted });
  const fleet: ConnectedFleet = connectToAgent(agent.port, { requestTimeoutMs: 60_000 });
  await waitFor(() => fleet.state.connected && fleet.state.agentOps !== undefined);

  // ── the driver ──
  const realLink = tokenSyncLinkOver(fleet.client);
  const realGen = generationReaderOver(fleet.io, join(fleetHome, '.ccrc'), clock);
  const fleetRow = (): GateNode => ({
    nodeId: NODE_ID, nodeIdMeasured: true, label: 'fleet', role: 'fleet', reachable: true,
    os: o.os ?? 'linux', caps: o.caps ?? CAPS, agentOps: o.agentOps ?? fleet.state.agentOps ?? null,
    updateState: 'idle', reportedPhase: null,
  });
  const serverRow: GateNode = {
    nodeId: '0123abcd-0000-4000-8000-000000000002', nodeIdMeasured: true, label: 'server', role: 'server',
    reachable: true, os: 'linux', caps: CAPS, agentOps: null, updateState: 'idle', reportedPhase: null,
  };
  const driver = new BoxTokenDriver({
    store: fileTokenStore(tokenPaths(base.cfg.mailTokenPath, serverHome)),
    holder: boot.holder,
    link: o.link ? o.link(realLink) : realLink,
    generation: o.generation ? o.generation(realGen) : realGen,
    rows: { nodes: () => [serverRow, fleetRow()], linkUp: () => fleet.state.connected, lastReadyAt: () => null },
    env: { fleetMode: 'remote', role: 'server', roleSource: 'recorded', agentEnvMarksFleet: false },
    bothWriter: null,
    now: clock,
    warn: (l) => { warnings.push(l); },
  }, boot);

  // ── the server, on loopback, and the fleet pointed at it ──
  const app: FastifyInstance = await buildServer({ ...base, mailToken: boot.holder, coord, tokenDriver: driver });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  writeFileSync(join(fleetHome, '.ccrc', 'agent.env'), `CCRC_AGENT_TOKEN=irrelevant\nCCRC_SERVER_URL=http://127.0.0.1:${port}\n`);
  writeFileSync(join(fleetHome, 'curl-allow-ports'), `${port}\n`);

  /** The real `ccrc token probe`, ASYNC (the server is in this process). One line back. */
  const probe = (file: string): Promise<string> => new Promise((resolve) => {
    const child = spawn('bash', [CCRC, 'token', 'probe', '--file', file, '--url', `http://127.0.0.1:${port}`], { env });
    let out = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.stdin.end();
    child.on('close', () => resolve(out.trim()));
  });
  const tickUntil = async (pred: () => boolean, max = 8): Promise<void> => {
    for (let i = 0; i < max && !pred(); i++) await driver.tick();
    expect(pred(), `the driver never reached the state; view: ${JSON.stringify(driver.view())}`).toBe(true);
  };

  const h: Harness = {
    serverHome, fleetHome, port, driver, holder: boot.holder,
    spawned: () => spawned, advance: (ms) => { offset += ms; }, warnings,
    fleetToken, serverToken: base.cfg.mailTokenPath, probe, tickUntil,
    close: async () => {
      driver.stop();
      await fleet.close();
      await agent.close();
      await app.close();
      db.close();
    },
  };
  open.push(h);
  return h;
}

describe('one rotation through the real ccrc token sync (spec §10.2, Figure 4)', () => {
  it('stages, hands out, syncs, promotes on the op result; the old value is accepted through grace and refused after', async () => {
    const h = await harness();
    const before = h.driver.view();
    expect(before.origin).toBe('adopted');
    expect(before.rotationOwed).toBe(true);
    expect(h.holder.match(OLD)).toBe('current');

    // Figure 4, steps 1-13: one rotation, ending in grace.
    await h.tickUntil(() => h.driver.view().phase === 'grace');
    expect(h.spawned()).toBe(1);
    const fresh = valueOf(h.fleetToken);
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(fresh).not.toBe(OLD);
    expect(read(h.fleetToken), 'the fleet file kept its preamble').toBe(`${PREAMBLE}${fresh}\n`);
    expect(read(h.serverToken), 'mail.token is the promoted value, one bare line').toBe(`${fresh}\n`);
    const report = JSON.parse(read(join(h.fleetHome, '.ccrc', 'token-sync.json'))) as Record<string, unknown>;
    expect(report).toMatchObject({ v: 1, result: 'synced', transport: 'http', proof: 'proved' });
    const state = JSON.parse(read(join(h.serverHome, '.ccrc', 'box-token.json'))) as { current: { id: string } };
    expect(read(join(h.fleetHome, '.ccrc', NODE_FILES.tokenGeneration))).toBe(`${state.current.id}\n`);
    expect(report['generation']).toBe(state.current.id);
    const v = h.driver.view();
    expect(v).toMatchObject({ origin: 'rotated', rotationOwed: false, fleetConfirmed: 'current', fleetTransport: 'http', failures: 0 });
    expect(v.lastSync?.word).toBe('synced');
    expect(v.currentSeq).toBeGreaterThan(before.currentSeq ?? 0);
    expect(h.holder.match(fresh)).toBe('current');
    expect(h.holder.match(OLD)).toBe('previous');

    // Grace: the old value still works over HTTP, through the real probe.
    const oldFile = join(h.fleetHome, 'old.token');
    writeFileSync(oldFile, `${OLD}\n`, { mode: 0o600 });
    expect(await h.probe(oldFile)).toBe('probe: 400 accepted');

    // The presentation rule: past grace with the new value never presented AS CURRENT, grace extends.
    h.advance(GRACE_MS + 1_000);
    await h.driver.tick();
    expect(h.driver.view().phase).toBe('grace');
    expect(h.holder.match(OLD)).toBe('previous');
    // The fleet presents the new value once (the real probe over its own file); the next tick retires.
    expect(await h.probe(h.fleetToken)).toBe('probe: 400 accepted');
    await h.tickUntil(() => h.driver.view().phase === 'idle');
    expect(h.driver.view().retiredRefused).toBe(true);
    expect(existsSync(join(h.serverHome, '.ccrc', 'mail-previous.token'))).toBe(false);
    expect(read(join(h.serverHome, '.ccrc', 'box-token-retired.json'))).toContain(sha(OLD));

    // Afterwards the old value is refused, and counted as a retired presentation.
    expect(h.holder.match(OLD)).toBeNull();
    expect(await h.probe(oldFile)).toBe('probe: 401 refused');
    await h.driver.tick();   // the view's counters are the holder's, copied each tick
    expect(h.driver.view().retiredPresented).toBeGreaterThanOrEqual(1);
    expect(await h.probe(h.fleetToken)).toBe('probe: 400 accepted');

    // Nothing printed a value, or its hash.
    const texts = [...h.warnings, JSON.stringify(h.driver.view()), read(join(h.serverHome, '.ccrc', 'box-token.json')),
      read(join(h.fleetHome, '.ccrc', 'token-sync.json'))];
    for (const s of [fresh, sha(fresh), OLD]) {
      for (const t of texts) expect(t.includes(s), 'a value reached a log, the view or a report').toBe(false);
    }
  }, 120_000);

  it('a lost result: the fleet wrote the file, an HTTP presentation never promotes, and a generation read measured after the hand-out does', async () => {
    let blind = true;
    const h = await harness({
      // The result frame is lost AFTER the fleet box really synced (spec §6, "The op result is lost after the fleet wrote the file").
      link: (real) => ({ send: async (code) => { await real.send(code); return { kind: 'lost', why: 'timeout' }; } }),
      generation: (real) => ({ read: async () => (blind ? { read: { kind: 'unreadable' }, measuredAt: Date.now() } : real.read()) }),
    });
    await h.tickUntil(() => h.driver.view().phase === 'handed-out');
    const fresh = valueOf(h.fleetToken);
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(h.holder.match(OLD)).toBe('current');
    expect(h.holder.match(fresh)).toBe('pending0');
    // The fleet's own proof was accepted: no 401 at any point (G3).
    expect(JSON.parse(read(join(h.fleetHome, '.ccrc', 'token-sync.json')))).toMatchObject({ result: 'synced', proof: 'proved' });

    // An HTTP presentation of the handed-out value is not a confirmation.
    expect(await h.probe(h.fleetToken)).toBe('probe: 400 accepted');
    await h.driver.tick();
    expect(h.driver.view().phase).toBe('handed-out');
    expect(h.holder.match(OLD)).toBe('current');

    // The generation read, measured after the hand-out, confirms it.
    blind = false;
    await h.tickUntil(() => h.driver.view().phase === 'grace');
    expect(h.holder.match(fresh)).toBe('current');
    expect(h.holder.match(OLD)).toBe('previous');
    expect(h.spawned()).toBe(1);
    expect(h.driver.view().fleetConfirmed).toBe('current');
  }, 120_000);
});

describe('mixed versions, with the real verb (spec §10.2)', () => {
  it('an agent whose ready lacks token-sync is never sent the op, and the old value stays current', async () => {
    const h = await harness({ agentOps: ['update'] });
    const fleetBefore = read(h.fleetToken);
    const serverBefore = read(h.serverToken);
    await h.driver.tick();
    await h.driver.tick();
    expect(h.spawned()).toBe(0);
    expect(h.driver.view()).toMatchObject({ hold: 'agent-predates-op', failures: 0 });
    expect(h.holder.match(OLD)).toBe('current');
    expect(read(h.fleetToken)).toBe(fleetBefore);
    expect(read(h.serverToken)).toBe(serverBefore);
    expect(existsSync(join(h.fleetHome, '.ccrc', NODE_FILES.tokenGeneration))).toBe(false);
  }, 120_000);

  it('an agent with the op whose ccrc lacks the verb answers spawn-failed: the verb-missing hold, never a failure, nothing changed', async () => {
    // A deploy.sh-placed node: no caps file read (os unknown, no caps), so the op itself probes (spec §9.2).
    const h = await harness({ launcher: 'no-verb', caps: [], os: 'unknown' });
    const fleetBefore = read(h.fleetToken);
    const serverBefore = read(h.serverToken);
    await h.tickUntil(() => h.driver.view().hold === 'verb-missing');
    expect(h.spawned()).toBe(1);
    expect(h.driver.view()).toMatchObject({ failures: 0, lastFailure: null, banner: false });
    expect(h.holder.match(OLD)).toBe('current');
    expect(read(h.fleetToken)).toBe(fleetBefore);
    expect(read(h.serverToken)).toBe(serverBefore);
    expect(existsSync(join(h.fleetHome, '.ccrc', NODE_FILES.tokenGeneration))).toBe(false);
    expect(existsSync(join(h.fleetHome, '.ccrc', 'token-sync.json'))).toBe(false);
    // The hold is re-probed on a fresh ready or hourly, not on the next tick.
    await h.driver.tick();
    expect(h.spawned()).toBe(1);
  }, 120_000);
});
```

- [ ] **Step 2: Typecheck it, then run it**

```bash
(cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json)
mkdir -p .tmp-b4 && (cd server && TMPDIR="$PWD/../.tmp-b4" ./node_modules/.bin/vitest run test/token-rotation-real-verb.test.ts)
```

The typecheck must print nothing: vitest strips types, so a wrong signature here passes the run and reds only `typecheck-tests.test.ts` (run that file too, one call). This task was not prototyped, so its first green run IS its measurement: record the count, the duration and the date as a `(measured)` line under the task heading before the commit.

This task adds no production code, so on a branch carrying Part A and Tasks B1-B3 the expected result is
`4 passed (4)` on the first run (its duration was not measured; each case is bounded by its own 120 s timeout).
A failure here is a real defect in Part A or B1, not a missing step: read the case's name and the view printed in
`tickUntil`'s message. Before Part A has merged the file fails to import (`Cannot find module '../src/token/boot.js'`).

- [ ] **Step 3: Mutation checks — the real verb is what the cases measure**

| Mutation | Measured red |
|---|---|
| delete `ccd/ccrc`'s `  token)   cmd_token "$@" ;;` line | the first case: the driver never reaches `grace` (its view shows `hold: 'verb-missing'`) |
| in `ccd/ccrc-token-sync`, replace `_ts_rename "$T_GEN" "$GEN_FILE"` with `:` (the generation is never recorded, and the verb still exits 0) | the first case: the generation file does not equal `box-token.json`'s `current.id`; the lost-result case: the driver never reaches `grace` |
| in `agent/src/tokensync.ts`'s child mapping, map exit 0 to `spawn-failed` (the agent never reports a sync) | the first case: the driver never reaches `grace`; the fleet file nevertheless holds the new value, which stays accepted (`pending0`) |

Each is measured red, then restored (keep a copy before mutating; nothing is committed between).

- [ ] **Step 4: Commit** (afterwards, from the repo root: `rm -rf .tmp-b4`)

```bash
git add server/test/token-rotation-real-verb.test.ts
git commit -m "test(token): one rotation through the real ccrc token sync, and the mixed-version holds

An in-process server with the real driver, claim door and coord, a real agent
whose token-sync spawn runs this checkout's ccd/ccrc-token-sync under a fixture
HOME against the server on loopback: Figure 4 end to end, grace and the
presentation rule, the old value refused after, a lost result confirmed by a
generation read, an agent without the op never sent it, and a ccrc without the
verb answering the verb-missing hold with nothing changed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Part B notes (B1 to B4): contract names changed or added, and pins moved

Contract changes B1 to B4 need (each marked where it is used above; all are now folded into the contract's Part B interfaces):
- Dispatch spelling (B1): the contract's `token) exec "$CCRC_HERE/ccrc-token-sync" "$@" ;;` becomes `token)   cmd_token "$@" ;;` plus a `cmd_token` that runs `exec "$BASH" "$CCRC_HERE/ccrc-token-sync" "$@"` after a missing-file refusal, `cmd_adopt`'s precedent (no exec-bit dependency).
- `CLAIM_DATA_LINE_ERE` (B1, new, `server/test/containedTools.ts`): the loopback curl front admits only `header` lines on `-K -`, so the claim body's `data` line needs one admitted shape; `server/test/containedTools.ts` and `server/test/ccrc-containment.test.ts` join Part B's file list.
- `server/test/ccrc-update.test.ts` joins B1's file list: its `CAPS_NOW` literal pins the cap list.
- Temps (B1): one prefix, `.ccrc-token-sync.`, in BOTH `~/.cc-secrets` and `~/.ccrc` (the generation file and the report are renamed within `~/.ccrc`); the sweep covers both. The contract names only `~/.cc-secrets/.ccrc-token-sync.*`.
- No `value` variable (B1): one python3 process checks the claim answer and writes the file; the proof re-reads the file. The contract's "clear `code`, `tok`, `value`" becomes "clear `code` and `tok`".
- A generation-file write failure AFTER the token file was renamed answers `write-failed` with its own sentence ("the token file was written, but ~/.ccrc/box-token-generation could not be"); the handed-out generation must stay accepted on the server (spec §6's lost-result row covers it).
- `fileTokenStore(paths: TokenPaths): TokenStore` (B4): now in the contract's files.ts block (A5 ships it).
- `makeTokenSyncSpawn(env: TokenSyncEnv)` with `tokenSyncEnv(home, from)` (B4): A2's real signature, now in the contract's agent block; B4 builds its env through `tokenSyncEnv`.

Pinned tests moved by this group:
- `server/test/ccrc-cli.test.ts:216` (the usage verb list gains `token`), and one new line pin for the `token` paragraph (B1).
- `server/test/ccrc-install.test.ts`: `CAPS_ALL` gains `token-sync` (moves four cases: both `ccrc-caps:` cases, "every cap word names machinery", "ccrc-caps: rewritten on every install"); two titles' counts become nine and eight; `BACKING` gains `token-sync`; a ship check for `ccd/ccrc-token-sync` (B1).
- `server/test/ccrc-update.test.ts`: `CAPS_NOW` gains `token-sync` before `detach` (moves four cases) (B1).
- `server/test/ccrc-containment.test.ts`: six refusal rows and one pass row (88 cases become 95) (B1).
- `server/test/macos-platform.test.ts`: no edit; it generates one more case for `ccd/ccrc-token-sync` (B1).
- `server/test/install-census.test.ts` (+3 cases) and `server/test/ccrc-uninstall.test.ts` (+2 cases), both appended at end of file with dynamic imports; the uninstall's existing line pins (781, 1166, 1190, 1222) do not move, because the new sentence is its own line (B3).

### Task B5: Doctor box-token, PASS or SKIP only

(prototype) measured: server/test/doctor-box-token.test.ts: red 68 failed -> green 68 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/ccrc-doctor.test.ts (`-t` subset, Step 5): red 11 failed | 19 passed (no table entry) -> 8 failed | 22 passed (table entry, pin unmoved) -> green 30 passed | 746 skipped, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/ccrc-install.test.ts (`-t "the cutover rehearsal"`): red 3 failed | 3 passed -> green 6 passed | 310 skipped, 2026-10-07 on main 282e79e44
(prototype) measured, unchanged by this task and green with it: macos-platform.test.ts 97 passed | 11 skipped; pool-name-parity.test.ts 21; pools-existence-pairing.test.ts 20; runbook-holds.test.ts 23; ccrc-doctor-graphify.test.ts 30; source-bytes.test.ts 2; single-definition.test.ts 404 passed | 2 failed, both the F16 eight-basenames pins that the prototype's stand-in for A1's `NODE_FILES.tokenGeneration` moved (Task A1 moves them; nothing in B5 touches them)
(not prototyped: the whole of `server/test/ccrc-doctor.test.ts` in one run — it did not finish inside 600 s on this box at load ~23; Step 5 runs the cases this task can move, and the worker runs the whole file once on a quieter box or reads CI's `test (server)` for it)
(not prototyped, added at plan assembly from review findings: "fleet confirmed" only on a measured confirmation (a new `fleet-unconfirmed` word), the `, retired value refused` PASS tail (spec 10.3), the `file:<word>` finding from A9's re-read, `_BT_FILE_PROBLEMS` and its parity pin, and the own-write box read from `agent.env`'s key (D-4399). `doctor-box-token.test.ts` then has 76 cases; the worker records the measured red and green.)
(not prototyped against Part A as merged: the prototype ran against stand-ins for A1's `TOKEN_HOLDS`, `OWED_REASONS`, `TOKEN_ORIGINS`, `GENERATION_ID_RE`, `TOKEN_SYNC_OP_ERRORS`, `TOKEN_TRANSPORTS`, `NODE_FILES.tokenGeneration` and A6's `FAILURES_FOR_BANNER` and `BoxTokenState`, spelled exactly as the contract declares them; B5 is built after Part A merges, so those imports resolve to the real files)

**Files:**
- Modify `ccd/ccrc-doctor-checks`: the table line `  auth` (line 190 at 282e79e44) gains the entry; the check block is APPENDED after the last line (7227 at 282e79e44, the closing `}` of `_check_scope-sweep`). Nothing above line 7227 moves except line 190's text, because lines in this file are cited by number from `ccrc`, the tests and the docs (the file's own rule, `_check_timeout`'s header).
- Create `server/test/doctor-box-token.test.ts`.
- Modify `server/test/ccrc-doctor.test.ts`: `HEALTHY_SKIPS` and its docstring (lines 1475-1481 at 282e79e44); a new `describe('ccrc doctor: box-token')` appended after the last line (13013 at 282e79e44).
- Modify `server/test/ccrc-install.test.ts` (PINNED, not in the contract's B5 file list; see "Pinned tests this task moves"): `BASE_LIVE_SHAPE`'s docstring (line 8232 at 282e79e44) and its three class maps (after lines 8251, 8300 and 8419 at 282e79e44).

**Interfaces:**
- Consumes (Part A, merged): `TOKEN_HOLDS`, `OWED_REASONS`, `TOKEN_ORIGINS`, `TOKEN_FILE_PROBLEMS` from `shared/box-token.ts` (A1); `TOKEN_SYNC_OP_ERRORS`, `TOKEN_TRANSPORTS`, `NODE_FILES.tokenGeneration` from `shared/agent-protocol.ts` (A1); `FAILURES_FOR_BANNER` and `type BoxTokenState` from `server/src/token/policy.ts` (A6); the field names of `BoxTokenState` as written to `box-token.json` (A6/A9); `~/.ccrc/token-sync.json`'s shape from B1 (`{"v":1,"at":<unix s>,"result":"synced"|<word>,"generation":<16 hex>|null,"transport":"http"|"https"|null,"proof":"proved"|"proof-failed"|"proof-unmeasured"|null}`). From `ccd/ccrc` (sourced before this file): `BOX_ENV_FILE`, `_box_env_value`, `_plat_mode`; from this file: `_dr_pass`, `_dr_warn`, `_dr_fail`, `_dr_skip`, `_dr_join`.
- Produces (shell, `ccd/ccrc-doctor-checks`):
  - table entry `box-token`; `_check_box-token()` -> rc 0 PASS, 3 SKIP (wave 1: every armed-later state, and `no-role`), and, only with `_BT_ARMS_ON=1`, rc 1 FAIL or 2 WARN with one `  remedy:` line.
  - file-level constants: `_BT_ARMS_ON=0`, `_BT_HOLDS`, `_BT_OWED`, `_BT_ORIGINS`, `_BT_SYNC_ERRORS`, `_BT_TRANSPORTS`, `_BT_FILE_PROBLEMS` (`TOKEN_FILE_PROBLEMS`, plan assembly), `_BT_LOST_WORDS=(disconnected mint-failed timeout)`, `_BT_FAIL_AT=3`, `_BT_SKIP_TAIL`, `_BT_PY_STATE`, `_BT_PY_FLEET`.
  - helpers: `_bt_num <s>`, `_bt_member <x> <set...>`, `_bt_age <seconds>`, `_bt_value_file <path>` (sets `BT_TF` in `ok|absent|not-regular|unreadable|no-value` and `BT_TF_MODE`), `_bt_find <arm> <word> [<a>] [<b>]`, `_bt_server_arm <token path> <state path>`, `_bt_fleet_arm <own-write 0|1>`.
  - Lines (each one verdict line; a non-PASS armed line is followed by one remedy line):
    - `PASS box-token: server: generation #<seq>, rotated <age> ago, fleet confirmed[, retired value refused]` ("fleet confirmed" only when `fleetConfirmed` equals a non-null `current.id`; the tail once `retiredRefusedAt` is set; plus `, a rotation in progress` while a generation is pending or promoting, `, the previous value in grace` while a previous value is kept; `minted <age> ago (no rotation yet)` in place of `rotated …` for a minted value that has not rotated).
    - `PASS box-token: fleet: token file 0600, generation recorded, last sync proved, transport <http|https>`; on the both-role writer's own box (role `both` recorded, `CCRC_FLEET` not `remote`, and no `~/.ccrc/agent.env` that marks a fleet box: absent, or readable with no `CCRC_AGENT_TOKEN` key line; D-4399): `PASS box-token: fleet: token file 0600, generation recorded, written by this box's server`.
    - Both arms: one line, parts joined by `; `, the worse verdict wins (PASS < SKIP in wave 1; armed PASS < WARN < FAIL).
    - Every armed-later state: `SKIP box-token: <arm>: <word> — <sentence>[; <arm>: <word> — <sentence>…]; reported as SKIP until the FAIL and WARN arms ship`. Server words: `token-absent`, `token-mode`, `token-unusable`, `state-absent`, `state-unreadable`, `mint-failed`, `held:<TokenHold>`, `failed:<word>`, `pending-overdue`, `rotation-owed:<OwedReason>`, `proof-unmeasured`, `recovered`, `retired-presented`, `fleet-behind`, `fleet-unconfirmed` and `file:<TokenFileProblem>` (both added at plan assembly). Fleet words: `fleet-token-absent`, `fleet-token-mode`, `fleet-token-unusable`, `no-generation`, `generation-malformed`, `never-synced`, `sync:<word>`, `proof-unmeasured`, `sync-unreadable` (added by the B5 draft: a report this check cannot read).
    - `SKIP box-token: no-role — …` (no role recorded and no subject for either arm); it stays SKIP when armed and carries no tail.
  - Armed classes (`_BT_ARMS_ON=1`): FAIL for `token-absent`, `token-mode`, `token-unusable`, `state-unreadable`, `mint-failed`, `failed:*` with failures >= `_BT_FAIL_AT`, `retired-presented`, `file:*`, `fleet-token-absent`, `fleet-token-mode`, `fleet-token-unusable`; WARN for every other word (`failed:*` below the threshold and `fleet-unconfirmed` included). `transport http` is never a finding.

- [ ] **Step 1: Write the failing test**

Create `server/test/doctor-box-token.test.ts`:

```ts
// `ccrc doctor`'s `box-token` check (box-token lifecycle, wave 1, Task B5; spec 4.8; D-4391).
//
// WAVE 1 PRINTS PASS OR SKIP ONLY. Every state that will be a FAIL or a WARN once the arms ship (held, failed,
// a pending value past its deadline, an owed rotation, proof-unmeasured, a failed boot mint, a boot recovery not
// yet followed by a rotation, a retired value presented, a broken file) prints `SKIP box-token: …` with its
// reason word, never PASS: a PASS there is the one way an operator reads a stalled first retirement as healthy
// (Review Focus 4). The FAIL and WARN arms are compiled in behind the file-level constant `_BT_ARMS_ON=0`; this
// file proves they are reachable by running the same fixtures against a COPY of the checks file with the
// constant flipped, so the follow-up PR that flips it ships arms that already ran.
//
// HOW THE CHECK IS RUN. `ccd/ccrc` is sourced (it is source-able: its dispatch sits under the `BASH_SOURCE`
// guard), then the checks file, then `_check_box-token` alone, under a fixture HOME and a PATH holding only
// links to the real `python3` and `stat`. Nothing reaches the live `$HOME`, `gh` is unreachable by
// construction, and no network, tmux or unit is touched. The end-to-end census (the check in the table,
// counted as a skip by `cmd_doctor`) is `ccrc-doctor.test.ts`'s.
//
// NEVER A VALUE. Every fixture value is minted here at runtime (`randomBytes`), and every run's stdout and
// stderr is searched for it and for its sha256 hex.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { TOKEN_HOLDS, OWED_REASONS, TOKEN_ORIGINS } from '../../shared/box-token.js';
import { NODE_FILES, TOKEN_SYNC_OP_ERRORS, TOKEN_TRANSPORTS } from '../../shared/agent-protocol.js';
import { TOKEN_FILE_PROBLEMS } from '../../shared/box-token.js';
import { FAILURES_FOR_BANNER, type BoxTokenState } from '../src/token/policy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const CHECKS_SRC = join(REPO, 'ccd', 'ccrc-doctor-checks');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const realBin = (name: string): string => {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (!p) throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};

const SKIP_TAIL = '; reported as SKIP until the FAIL and WARN arms ship';
const ID_OLD = 'a1b2c3d4e5f60718';
const ID_CUR = '0123456789abcdef';
const MIN = 60_000;

interface Box { home: string; value: string; fleetValue: string }
interface Run { code: number; stdout: string; stderr: string }

/** The shipped checks file, or a copy of it with `_BT_ARMS_ON=0` flipped to 1 (exactly one line moves). */
function armedCopy(): string {
  const src = readFileSync(CHECKS_SRC, 'utf8');
  const flipped = src.replace(/^_BT_ARMS_ON=0$/m, '_BT_ARMS_ON=1');
  if (flipped === src) throw new Error('the checks file carries no `_BT_ARMS_ON=0` line to flip');
  const d = mkTmp('ccrc-bt-armed-');
  writeFileSync(join(d, 'ccrc-doctor-checks'), flipped);
  return join(d, 'ccrc-doctor-checks');
}
let ARMED: string | null = null;
const armed = (): string => (ARMED ??= armedCopy());

function runCheck(b: Box, checks = CHECKS_SRC): Run {
  const bin = join(b.home, 'bt-bin');
  mkdirSync(bin, { recursive: true });
  for (const n of ['python3', 'stat']) {
    try { symlinkSync(realBin(n), join(bin, n)); } catch { /* already linked by an earlier run on this box */ }
  }
  const script = ['set -uo pipefail', `. ${shq(CCRC_SRC)}`, `. ${shq(checks)}`, '_check_box-token'].join('\n');
  const r = spawnSync(BASH, ['-c', script], {
    encoding: 'utf8', env: { HOME: b.home, PATH: bin, LC_ALL: 'C', TMPDIR: join(b.home, 'tmp') },
  });
  const out = { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  // Never a value, nor its sha256 — on any path, armed or not.
  for (const v of [b.value, b.fleetValue]) {
    const hash = createHash('sha256').update(v).digest('hex');
    for (const s of [out.stdout, out.stderr]) {
      expect(s.includes(v), 'a token value reached doctor output').toBe(false);
      expect(s.includes(hash), 'a token value\'s sha256 reached doctor output').toBe(false);
    }
  }
  return out;
}

const dot = (b: Box, ...p: string[]): string => join(b.home, '.ccrc', ...p);
const fleetFile = (b: Box): string => join(b.home, '.cc-secrets', 'ccrc-mail.token');

function healthyState(now = Date.now()): BoxTokenState {
  const w = { dev: 1, ino: 2, writtenAtMs: now - 60 * MIN };
  return {
    v: 1, origin: 'rotated', rotationOwed: false, owedWhy: null,
    current: { id: ID_CUR, seq: 2, since: now - 60 * MIN, write: w },
    pending: [], previous: null, promoting: null, recovering: null,
    fleetConfirmed: ID_CUR, nextSeq: 3, lastRotationAt: now - 60 * MIN,
    failures: 0, lastFailure: null, hold: null, holdNode: null,
    lastSync: { at: now - 60 * MIN, word: 'synced', transport: 'https' },
    counters: { previousPresented: 0, retiredPresented: 0 },
    retiredRefusedAt: now - 50 * MIN, mintFailedAt: null, lastBootRecovery: null,
  };
}

/** `role` null writes no ccrc.env. The server side is mail.token (0600, one bare value line) and box-token.json;
 *  the fleet side is the fleet file (comment line, then the value), the generation file and token-sync.json. */
function box(o: { role: 'server' | 'fleet' | 'both' | null; fleet?: 'local' | 'remote'; server?: boolean; fleetSide?: boolean; agentEnv?: boolean }): Box {
  const home = mkTmp('ccrc-bt-');
  mkdirSync(join(home, '.ccrc'), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const b: Box = { home, value: randomBytes(32).toString('hex'), fleetValue: randomBytes(32).toString('hex') };
  if (o.role !== null || o.fleet !== undefined) {
    const lines = [o.role === null ? '' : `CCRC_ROLE=${o.role}`, `CCRC_FLEET=${o.fleet ?? 'local'}`, ''];
    writeFileSync(dot(b, 'ccrc.env'), lines.join('\n'), { mode: 0o600 });
  }
  const server = o.server ?? (o.role === 'server' || o.role === 'both');
  const fleetSide = o.fleetSide ?? (o.role === 'fleet' || o.role === 'both');
  if (server) {
    writeFileSync(dot(b, 'mail.token'), `${b.value}\n`, { mode: 0o600 });
    plantState(b, healthyState());
  }
  if (fleetSide) {
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(fleetFile(b), `# ccrc box token: written by ccrc and rotated by the server; do not edit or copy it\n${b.fleetValue}\n`, { mode: 0o600 });
    writeFileSync(dot(b, NODE_FILES.tokenGeneration), `${ID_CUR}\n`, { mode: 0o600 });
    plantReport(b, {});
  }
  if (o.agentEnv ?? o.role === 'fleet') {
    writeFileSync(dot(b, 'agent.env'), 'CCRC_SERVER_URL=ws://127.0.0.1:7788\n', { mode: 0o600 });
  }
  return b;
}
function plantState(b: Box, s: BoxTokenState | string): void {
  writeFileSync(dot(b, 'box-token.json'), typeof s === 'string' ? s : JSON.stringify(s), { mode: 0o600 });
}
const editState = (b: Box, f: (s: BoxTokenState) => void): void => {
  const s = healthyState(); f(s); plantState(b, s);
};
function plantReport(b: Box, over: Record<string, unknown> | string): void {
  const base = { v: 1, at: Math.floor(Date.now() / 1000) - 3600, result: 'synced', generation: ID_CUR, transport: 'https', proof: 'proved' };
  writeFileSync(dot(b, 'token-sync.json'), typeof over === 'string' ? over : JSON.stringify({ ...base, ...over }), { mode: 0o600 });
}

const SERVER_PASS = 'server: generation #2, rotated 60 min ago, fleet confirmed, retired value refused';
const FLEET_PASS = 'fleet: token file 0600, generation recorded, last sync proved, transport https';

// ── PASS ──────────────────────────────────────────────────────────────────

describe('doctor box-token: PASS, and only on a measured healthy box', () => {
  it('server role: the generation, the age of the last rotation, and the fleet\'s confirmation', () => {
    const r = runCheck(box({ role: 'server' }));
    expect(r.stdout).toBe(`PASS box-token: ${SERVER_PASS}\n`);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('fleet role: the file, the generation, the proof and the transport', () => {
    const r = runCheck(box({ role: 'fleet' }));
    expect(r.stdout).toBe(`PASS box-token: ${FLEET_PASS}\n`);
    expect(r.code).toBe(0);
  });

  it('both role, remote: both arms on one line, joined by "; "', () => {
    const r = runCheck(box({ role: 'both', fleet: 'remote', agentEnv: true }));
    expect(r.stdout).toBe(`PASS box-token: ${SERVER_PASS}; ${FLEET_PASS}\n`);
    expect(r.code).toBe(0);
  });

  it('both role, local, no agent.env: the fleet file is the server\'s own write and needs no sync report', () => {
    const b = box({ role: 'both' });
    rmSync(dot(b, 'token-sync.json'));
    const r = runCheck(b);
    expect(r.stdout).toBe(`PASS box-token: ${SERVER_PASS}; fleet: token file 0600, generation recorded, written by this box's server\n`);
  });

  // D-4399 (plan assembly): the README's single-box agent.env (CCRC_SERVER_URL only) does not
  // make a fleet box; a CCRC_AGENT_TOKEN key does, and then the fleet arm reads the sync report.
  it("both role, local, the README's agent.env (CCRC_SERVER_URL only): still the server's own write", () => {
    const b = box({ role: 'both', agentEnv: true });
    rmSync(dot(b, 'token-sync.json'));
    expect(runCheck(b).stdout).toBe(`PASS box-token: ${SERVER_PASS}; fleet: token file 0600, generation recorded, written by this box's server\n`);
  });

  it('both role, local, an agent.env carrying CCRC_AGENT_TOKEN: the fleet arm reads the sync report, and the key\'s value is never printed', () => {
    const b = box({ role: 'both' });
    const agentTok = randomBytes(32).toString('hex');
    writeFileSync(dot(b, 'agent.env'), `CCRC_SERVER_URL=ws://127.0.0.1:7788\n${['CCRC', 'AGENT', 'TOKEN'].join('_')}=${agentTok}\n`, { mode: 0o600 });
    const r = runCheck(b);
    expect(r.stdout).toBe(`PASS box-token: ${SERVER_PASS}; ${FLEET_PASS}\n`);
    expect(r.stdout.includes(agentTok) || r.stderr.includes(agentTok)).toBe(false);
  });

  it('a minted value that has not rotated yet says so rather than naming a rotation', () => {
    const b = box({ role: 'server' });
    editState(b, (s) => { s.origin = 'minted'; s.lastRotationAt = null; s.current.seq = 1; s.retiredRefusedAt = null; });
    // No `, retired value refused` tail before the first retirement (spec 10.3; plan assembly).
    expect(runCheck(b).stdout).toBe('PASS box-token: server: generation #1, minted 60 min ago (no rotation yet), fleet confirmed\n');
  });

  it('transport http is printed on the PASS line and never changes the verdict, armed or not', () => {
    const b = box({ role: 'fleet' });
    plantReport(b, { transport: 'http' });
    const want = 'PASS box-token: fleet: token file 0600, generation recorded, last sync proved, transport http\n';
    for (const checks of [CHECKS_SRC, armed()]) {
      const r = runCheck(b, checks);
      expect(r.stdout).toBe(want);
      expect(r.code).toBe(0);
    }
  });
});

// ── every armed-later state: SKIP now, FAIL or WARN once armed ─────────────

interface Row { word: string; arm: 'server' | 'fleet'; armedClass: 'FAIL' | 'WARN'; plant: (b: Box) => void }
const now = (): number => Date.now();
const ROWS: Row[] = [
  { arm: 'server', word: 'token-absent', armedClass: 'FAIL', plant: (b) => rmSync(dot(b, 'mail.token')) },
  { arm: 'server', word: 'token-mode', armedClass: 'FAIL', plant: (b) => chmodSync(dot(b, 'mail.token'), 0o644) },
  { arm: 'server', word: 'token-unusable', armedClass: 'FAIL', plant: (b) => writeFileSync(dot(b, 'mail.token'), '# no value line\n\n', { mode: 0o600 }) },
  { arm: 'server', word: 'state-absent', armedClass: 'WARN', plant: (b) => rmSync(dot(b, 'box-token.json')) },
  { arm: 'server', word: 'state-unreadable', armedClass: 'FAIL', plant: (b) => plantState(b, '{"v":1,') },
  { arm: 'server', word: 'mint-failed', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.mintFailedAt = now(); s.hold = 'mint-failed'; }) },
  { arm: 'server', word: 'held:update-in-flight', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.hold = 'update-in-flight'; s.holdNode = 'node-fleet-1'; }) },
  { arm: 'server', word: 'held:verb-missing', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.hold = 'verb-missing'; }) },
  { arm: 'server', word: 'failed:claim-refused', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.failures = FAILURES_FOR_BANNER - 1; s.lastFailure = 'claim-refused'; }) },
  { arm: 'server', word: 'failed:timeout', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.failures = FAILURES_FOR_BANNER; s.lastFailure = 'timeout'; }) },
  { arm: 'server', word: 'pending-overdue', armedClass: 'WARN', plant: (b) => editState(b, (s) => {
    s.pending = [{ id: ID_OLD, seq: 3, stagedAt: now() - 12 * MIN, handedOutAt: now() - 10 * MIN, confirmBy: now() - 5 * MIN, write: { dev: 1, ino: 3, writtenAtMs: now() - 12 * MIN } }];
  }) },
  // The leaked value's own state after Part A boots: adopted, owed, never rotated.
  { arm: 'server', word: 'rotation-owed:adopted', armedClass: 'WARN', plant: (b) => editState(b, (s) => {
    s.origin = 'adopted'; s.rotationOwed = true; s.owedWhy = 'adopted'; s.current = { id: null, seq: 1, since: now() - 60 * MIN, write: null };
    s.lastRotationAt = null; s.fleetConfirmed = null; s.lastSync = null; s.retiredRefusedAt = null;
  }) },
  { arm: 'server', word: 'rotation-owed:retired-written-back', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.rotationOwed = true; s.owedWhy = 'retired-written-back'; }) },
  { arm: 'server', word: 'proof-unmeasured', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.lastSync = { at: now() - MIN, word: 'proof-unmeasured', transport: 'https' }; }) },
  { arm: 'server', word: 'recovered', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.lastBootRecovery = { at: now() - MIN, source: 'previous' }; }) },
  { arm: 'server', word: 'retired-presented', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.counters.retiredPresented = 2; }) },
  { arm: 'server', word: 'fleet-behind', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.fleetConfirmed = ID_OLD; }) },
  // Added at plan assembly (review findings):
  { arm: 'server', word: 'fleet-unconfirmed', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.current.id = null; s.fleetConfirmed = null; }) },
  { arm: 'server', word: 'file:changed', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.fileProblem = { at: now() - MIN, file: 'current', word: 'changed' }; }) },
  { arm: 'server', word: 'file:retired', armedClass: 'FAIL', plant: (b) => editState(b, (s) => { s.fileProblem = { at: now() - MIN, file: 'current', word: 'retired' }; }) },
  { arm: 'fleet', word: 'fleet-token-absent', armedClass: 'FAIL', plant: (b) => rmSync(fleetFile(b)) },
  { arm: 'fleet', word: 'fleet-token-mode', armedClass: 'FAIL', plant: (b) => chmodSync(fleetFile(b), 0o640) },
  { arm: 'fleet', word: 'fleet-token-unusable', armedClass: 'FAIL', plant: (b) => writeFileSync(fleetFile(b), '# comment only\n', { mode: 0o600 }) },
  { arm: 'fleet', word: 'no-generation', armedClass: 'WARN', plant: (b) => rmSync(dot(b, NODE_FILES.tokenGeneration)) },
  { arm: 'fleet', word: 'generation-malformed', armedClass: 'WARN', plant: (b) => writeFileSync(dot(b, NODE_FILES.tokenGeneration), 'not-an-id\n') },
  { arm: 'fleet', word: 'never-synced', armedClass: 'WARN', plant: (b) => rmSync(dot(b, 'token-sync.json')) },
  { arm: 'fleet', word: 'sync:claim-refused', armedClass: 'WARN', plant: (b) => plantReport(b, { result: 'claim-refused', generation: null, transport: 'https', proof: null }) },
  { arm: 'fleet', word: 'sync:stale-client', armedClass: 'WARN', plant: (b) => plantReport(b, { result: 'stale-client', generation: null, transport: null, proof: null }) },
  { arm: 'fleet', word: 'proof-unmeasured', armedClass: 'WARN', plant: (b) => plantReport(b, { result: 'proof-unmeasured', proof: 'proof-unmeasured' }) },
  { arm: 'fleet', word: 'sync-unreadable', armedClass: 'WARN', plant: (b) => plantReport(b, '{"v":2}') },
];

describe('doctor box-token: every armed-later state is SKIP with its reason word, never PASS (D-4391)', () => {
  for (const row of ROWS) {
    it(`${row.arm}: ${row.word}`, () => {
      const b = box({ role: row.arm });
      row.plant(b);
      const r = runCheck(b);
      const lines = r.stdout.split('\n').filter(Boolean);
      expect(lines, r.stdout).toHaveLength(1);
      expect(lines[0]).toMatch(/^SKIP box-token: /);
      expect(lines[0]).toContain(`${row.arm}: ${row.word} — `);
      expect(lines[0]!.endsWith(SKIP_TAIL), lines[0]).toBe(true);
      expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) /m);
      expect(r.stdout).not.toMatch(/remedy:/);
      expect(r.code).toBe(3);
      expect(r.stderr).toBe('');
    });
  }
});

describe('doctor box-token: the FAIL and WARN arms are compiled in (the constant flipped in a copy)', () => {
  for (const row of ROWS) {
    it(`${row.arm}: ${row.word} -> ${row.armedClass}`, () => {
      const b = box({ role: row.arm });
      row.plant(b);
      const r = runCheck(b, armed());
      const lines = r.stdout.split('\n').filter(Boolean);
      expect(lines, r.stdout).toHaveLength(2);
      expect(lines[0]).toMatch(new RegExp(`^${row.armedClass} box-token: `));
      expect(lines[0]).toContain(`${row.arm}: ${row.word} — `);
      expect(lines[0]).not.toContain(SKIP_TAIL);
      expect(lines[1]).toMatch(/^ {2}remedy: \S/);
      expect(r.code).toBe(row.armedClass === 'FAIL' ? 1 : 2);
    });
  }

  it('the shipped file carries the constant once, off', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    expect(src.match(/^_BT_ARMS_ON=.*$/gm)).toEqual(['_BT_ARMS_ON=0']);
  });
});

// ── arms by role ──────────────────────────────────────────────────────────

describe('doctor box-token: which arm runs', () => {
  it('a CCRC_ROLE=server box runs the server arm: D-3111\'s server-role skip never covers this check', () => {
    const r = runCheck(box({ role: 'server' }));
    expect(r.stdout).toMatch(/^PASS box-token: server: /);
    expect(r.stdout).not.toMatch(/hosts no sessions/);
  });

  it('both arms on one line, the worse verdict wins: a healthy server and a never-synced fleet is SKIP, armed WARN', () => {
    const b = box({ role: 'both', fleet: 'remote', agentEnv: true });
    rmSync(dot(b, 'token-sync.json'));
    const r = runCheck(b);
    expect(r.stdout).toMatch(new RegExp(`^SKIP box-token: ${SERVER_PASS}; fleet: never-synced — .*${SKIP_TAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n$`));
    expect(r.code).toBe(3);
    const a = runCheck(b, armed());
    expect(a.stdout).toMatch(/^WARN box-token: server: generation #2.*; fleet: never-synced — /);
    expect(a.code).toBe(2);
  });

  it('no role recorded: the server arm when a server-side file exists, the fleet arm when agent.env does', () => {
    const s = box({ role: null, server: true });
    expect(runCheck(s).stdout).toBe(`PASS box-token: ${SERVER_PASS}\n`);
    const f = box({ role: null, fleetSide: true, agentEnv: true });
    expect(runCheck(f).stdout).toBe(`PASS box-token: ${FLEET_PASS}\n`);
  });

  it('no role recorded and nothing of either side: SKIP no-role, and it stays SKIP when armed', () => {
    for (const checks of [CHECKS_SRC, armed()]) {
      const r = runCheck(box({ role: null }), checks);
      expect(r.stdout).toMatch(/^SKIP box-token: no-role — /);
      expect(r.stdout).not.toContain(SKIP_TAIL);
      expect(r.code).toBe(3);
    }
  });
});

// ── the shell's words are L0's ─────────────────────────────────────────────

describe('doctor box-token: the shell spellings are pinned to L0', () => {
  const arr = (name: string): string[] => {
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; printf '%s\\n' "\${${name}[@]}"`], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const words = r.stdout.split('\n').filter(Boolean);
    expect(words.length, `${name} is empty: a scan over an empty list passes everything`).toBeGreaterThan(0);
    return words;
  };
  it('holds, owed reasons, origins, sync errors and transports', () => {
    expect(arr('_BT_HOLDS')).toEqual([...TOKEN_HOLDS]);
    expect(arr('_BT_OWED')).toEqual([...OWED_REASONS]);
    expect(arr('_BT_ORIGINS')).toEqual([...TOKEN_ORIGINS]);
    expect(arr('_BT_SYNC_ERRORS')).toEqual([...TOKEN_SYNC_OP_ERRORS]);
    expect(arr('_BT_TRANSPORTS')).toEqual([...TOKEN_TRANSPORTS]);
    expect(arr('_BT_FILE_PROBLEMS')).toEqual([...TOKEN_FILE_PROBLEMS]);
  });
  it('the failure count that turns failed:* FAIL is the banner threshold', () => {
    expect(arr('_BT_FAIL_AT')).toEqual([String(FAILURES_FOR_BANNER)]);
  });
  it('the generation file and the fleet file are the names the writers use', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    expect(src.includes(`/.ccrc/${NODE_FILES.tokenGeneration}"`), 'the generation file').toBe(true);
    expect(src.includes('/.cc-secrets/ccrc-mail.token"'), 'the fleet token file').toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
mkdir -p .tmp-b5 && (cd server && TMPDIR="$PWD/../.tmp-b5" ./node_modules/.bin/vitest run test/doctor-box-token.test.ts)
```

Expected: `Tests  68 failed (68)`. The `armedCopy()` rows fail with `Error: the checks file carries no `_BT_ARMS_ON=0` line to flip`, the constant case with `expected null to deeply equal [ '_BT_ARMS_ON=0' ]`, the parity cases with `_BT_HOLDS is empty: a scan over an empty list passes everything`, and every `runCheck` row because `_check_box-token` does not exist (exit 127, empty stdout).

- [ ] **Step 3: Write the minimal implementation**

3a. In `ccd/ccrc-doctor-checks`, the table (line 190 at 282e79e44). Old:

```bash
  config
  auth
  rc
```

New:

```bash
  config
  auth box-token   # one line, as `flock timeout`: _check_box-token is at the END of this file
  rc
```

3b. APPEND to the end of `ccd/ccrc-doctor-checks` (after line 7227 at 282e79e44, the `}` that closes `_check_scope-sweep`), exactly:

```bash
# ── box-token: the box token's lifecycle, on each box ─────────────────────
# APPENDED HERE, with its table entry on `auth`'s line, for `_check_timeout`'s reason: lines in this file are
# cited by number from `ccrc`, the tests and the docs, and a function inserted mid-file would move every one.
#
# WHAT IS MEASURED (box-token lifecycle spec 4.8). The SERVER arm, on a `server` or `both` box: `mail.token`
# (present, a regular file, mode 0600, a value line by the extraction rule) and `box-token.json`, the server's
# state record (generation, last rotation, owed, hold, failures, a pending value past its deadline, the
# fleet's confirmed generation, retired values presented, the last boot recovery). The FLEET arm, on a `fleet`
# or `both` box: `~/.cc-secrets/ccrc-mail.token` the same way, the generation file, and `ccrc token sync`'s
# last report with its proof word and transport. D-3111's server-role skip NEVER covers this check: a server
# box is where the server arm's subject lives. No role recorded: the server arm when the server's token or
# state file exists, the fleet arm when `~/.ccrc/agent.env` does, else SKIP `no-role`.
#
# NEVER A VALUE, A CODE OR A HASH OF EITHER. The token files are read in THIS process, line by line, by the
# extraction rule every reader shares (`extractToken`: the first line that is neither blank nor a `#` comment,
# all whitespace removed), only to learn whether a value line exists; the value is never echoed, passed to a
# child, hashed or kept. The two JSON files hold no secret and are read by `python3 -c`, whose output is
# words and numbers this function validates again before any of it reaches a line.
#
# WAVE 1 PRINTS PASS OR SKIP ONLY (D-4391; the operator's ruling of 2026-10-07, 15:30). Every state that will
# be a FAIL or a WARN prints `SKIP box-token: <arm>: <word> — <sentence>; reported as SKIP until the FAIL and
# WARN arms ship`, never PASS: a PASS there is the one way an operator reads a stalled first retirement as
# healthy. The arms are compiled in behind `_BT_ARMS_ON` and proven by `doctor-box-token.test.ts`, which flips
# it in a copy of this file; the follow-up PR flips it here, before the weekly schedule ships. There is no
# flag file, because a flag nobody writes is a hand step. `transport http` is printed on a PASS line and is
# never a verdict.
#
# THE WORDS ARE L0's, pinned by `doctor-box-token.test.ts`: `_BT_HOLDS` is `TOKEN_HOLDS`, `_BT_OWED` is
# `OWED_REASONS`, `_BT_ORIGINS` is `TOKEN_ORIGINS` (`shared/box-token.ts`); `_BT_SYNC_ERRORS` is
# `TOKEN_SYNC_OP_ERRORS` and `_BT_TRANSPORTS` is `TOKEN_TRANSPORTS` (`shared/agent-protocol.ts`); `_BT_FAIL_AT`
# is `FAILURES_FOR_BANNER` (`server/src/token/policy.ts`). `_BT_LOST_WORDS` are the rest of
# `BoxTokenView.lastFailure`'s vocabulary, which has no L0 list of its own.
#
# `set +x` is the function's first statement, not the file's: this file is sourced into `ccrc`, and doctor runs
# each check in its own `$( … )`, so it cannot leak; it writes nothing, so it sets no umask (a file-level
# `umask 077` would reach every `--fix` writer).
_BT_ARMS_ON=0
_BT_HOLDS=(update-in-flight agent-predates-op verb-missing stale-client fleet-rows node-id-unmeasured link-down pending-cap no-coord role-unrecorded mint-failed)
_BT_OWED=(adopted fleet-behind confirm-deadline retired-written-back recovered aux-unusable unverifiable-files code-used claim-misbound)
_BT_ORIGINS=(adopted minted rotated)
_BT_SYNC_ERRORS=(bad-code busy spawn-failed claim-refused code-used write-failed proof-failed proof-unmeasured stale-client)
_BT_TRANSPORTS=(http https)
_BT_FILE_PROBLEMS=(missing unusable placeholder unreadable changed retired)
_BT_LOST_WORDS=(disconnected mint-failed timeout)
_BT_FAIL_AT=3
_BT_SKIP_TAIL='; reported as SKIP until the FAIL and WARN arms ship'

# The server's state record, read strictly: any field missing or of the wrong kind is `unreadable`, never a
# default. Prints `absent`, `unreadable`, or `ok` then `<key> <value>` lines and `finding <word> [<n>] [<node>]`.
# argv: path, origins, holds, owed reasons, last-failure words, transports, file-problem words (each space-joined). Times are ms.
_BT_PY_STATE='
import json, os, re, stat, sys, time
def say(*a):
    print(" ".join(str(x) for x in a))
def bad():
    say("unreadable")
    sys.exit(0)
p = sys.argv[1]
origins, holds, owed, fails, transports, fileprobs = (set(a.split()) for a in sys.argv[2:8])
now = int(time.time() * 1000)
H16 = re.compile(r"[0-9a-f]{16}\Z")
NODE = re.compile(r"[A-Za-z0-9._:-]{1,64}\Z")
try:
    st = os.lstat(p)
except FileNotFoundError:
    say("absent")
    sys.exit(0)
except OSError:
    bad()
if not stat.S_ISREG(st.st_mode) or st.st_size > 65536:
    bad()
try:
    with open(p, "rb") as f:
        s = json.loads(f.read().decode("utf-8"))
except Exception:
    bad()
def n(v): return type(v) is int and v >= 0
def on(v): return v is None or n(v)
def d(v): return type(v) is dict
def hid(v): return type(v) is str and H16.match(v) is not None
def opt(v, f): return v is None or f(v)
try:
    c = s["current"]; ls = s["lastSync"]; br = s["lastBootRecovery"]; pv = s["previous"]; k = s["counters"]
    fp = s.get("fileProblem")   # optional: absent in a state written before A9's re-read
    ok = (d(s) and s["v"] == 1 and s["origin"] in origins and type(s["rotationOwed"]) is bool
        and opt(s["owedWhy"], lambda w: w in owed) and (not s["rotationOwed"] or s["owedWhy"] in owed)
        and d(c) and n(c["seq"]) and n(c["since"]) and opt(c["id"], hid)
        and type(s["pending"]) is list and len(s["pending"]) <= 2
        and all(d(g) and hid(g["id"]) and n(g["seq"]) and on(g["handedOutAt"]) and on(g["confirmBy"]) for g in s["pending"])
        and opt(pv, lambda x: d(x) and n(x["graceUntil"]) and n(x["hardUntil"]))
        and opt(s["promoting"], d) and opt(s["fleetConfirmed"], hid)
        and on(s["lastRotationAt"]) and n(s["failures"]) and opt(s["lastFailure"], lambda w: type(w) is str)
        and opt(s["hold"], lambda w: w in holds) and opt(s["holdNode"], lambda w: type(w) is str)
        and opt(ls, lambda x: d(x) and n(x["at"]) and type(x["word"]) is str)
        and d(k) and n(k["previousPresented"]) and n(k["retiredPresented"])
        and on(s["mintFailedAt"]) and opt(br, lambda x: d(x) and n(x["at"]))
        and on(s["retiredRefusedAt"])
        and opt(fp, lambda x: d(x) and n(x["at"]) and x["file"] in ("current", "pending", "previous") and x["word"] in fileprobs))
except (KeyError, TypeError, IndexError, AttributeError):
    ok = False
if not ok:
    bad()
def age(t): return max(0, (now - t) // 1000)
say("ok")
say("seq", c["seq"])
say("since", age(c["since"]))
lr = s["lastRotationAt"]
say("rotated", "never" if lr is None else age(lr))
say("rotating", 1 if (s["pending"] or s["promoting"] is not None) else 0)
say("grace", 0 if pv is None else 1)
say("refused", 0 if s["retiredRefusedAt"] is None else 1)
if s["mintFailedAt"] is not None:
    say("finding", "mint-failed", age(s["mintFailedAt"]))
if s["hold"] is not None and not (s["hold"] == "mint-failed" and s["mintFailedAt"] is not None):
    hn = s["holdNode"]
    say("finding", "held:" + s["hold"], 0, hn if hn is not None and NODE.match(hn) else "-")
f = s["failures"]; lf = s["lastFailure"]
if f > 0:
    say("finding", "failed:" + (lf if lf in fails else "other"), f)
over = [now - g["confirmBy"] for g in s["pending"] if g["confirmBy"] is not None and now > g["confirmBy"]]
if over:
    say("finding", "pending-overdue", max(over) // 1000)
if s["rotationOwed"]:
    say("finding", "rotation-owed:" + s["owedWhy"])
if ls is not None and ls["word"] == "proof-unmeasured" and not (f > 0 and lf == "proof-unmeasured"):
    say("finding", "proof-unmeasured", age(ls["at"]))
if br is not None and (lr is None or lr < br["at"]):
    say("finding", "recovered", age(br["at"]))
if k["retiredPresented"] > 0:
    say("finding", "retired-presented", k["retiredPresented"])
if fp is not None:
    say("finding", "file:" + fp["word"], age(fp["at"]), fp["file"])
if c["id"] is not None and s["fleetConfirmed"] != c["id"]:
    say("finding", "fleet-behind")
elif c["id"] is None and not s["rotationOwed"]:
    say("finding", "fleet-unconfirmed")
'

# The fleet's generation file and `ccrc token sync`'s report. Prints `finding <word> [<age s>]` lines, `own`
# (own-write box: no report is read) or `synced <transport> <age s>`. argv: generation path, report path,
# own-write 0|1, sync error words, transports. The report's `at` is unix seconds.
_BT_PY_FLEET='
import json, os, re, stat, sys, time
def say(*a):
    print(" ".join(str(x) for x in a))
gp, rp, own = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
errs, transports = set(sys.argv[4].split()), set(sys.argv[5].split())
now = int(time.time())
def regular(p):
    try:
        st = os.lstat(p)
    except FileNotFoundError:
        return "absent"
    except OSError:
        return "bad"
    return "ok" if stat.S_ISREG(st.st_mode) and st.st_size <= 65536 else "bad"
g = regular(gp)
if g == "absent":
    say("finding", "no-generation")
else:
    try:
        with open(gp, "rb") as f:
            b = f.read()
    except OSError:
        b = b""
    if g != "ok" or re.fullmatch(rb"[0-9a-f]{16}\n", b) is None:
        say("finding", "generation-malformed")
if own:
    say("own")
    sys.exit(0)
r = regular(rp)
if r == "absent":
    say("finding", "never-synced")
    sys.exit(0)
def unreadable():
    say("finding", "sync-unreadable")
    sys.exit(0)
if r != "ok":
    unreadable()
try:
    with open(rp, "rb") as f:
        j = json.loads(f.read().decode("utf-8"))
    res, at, gen, tr, pf = j["result"], j["at"], j["generation"], j["transport"], j["proof"]
    ok = (type(j) is dict and j["v"] == 1 and type(at) is int and at >= 0 and (res == "synced" or res in errs)
        and (gen is None or (type(gen) is str and re.fullmatch(r"[0-9a-f]{16}", gen) is not None))
        and (tr is None or tr in transports) and pf in (None, "proved", "proof-failed", "proof-unmeasured"))
except Exception:
    ok = False
if not ok:
    unreadable()
age = max(0, now - at)
if res == "synced":
    if pf != "proved" or tr is None:
        unreadable()
    say("synced", tr, age)
elif res == "proof-unmeasured":
    say("finding", "proof-unmeasured", age)
else:
    say("finding", "sync:" + res, age)
'

_bt_num() { [[ "$1" =~ ^(0|[1-9][0-9]{0,15})$ ]]; }
_bt_member() { local x="$1" y; shift; for y in "$@"; do [ "$y" = "$x" ] && return 0; done; return 1; }
_bt_age() {   # <seconds> -> "45 s", "12 min", "3 h", "2 d"
  local s="$1"
  if [ "$s" -lt 120 ]; then printf '%s s' "$s"
  elif [ "$s" -lt 7200 ]; then printf '%s min' "$((s / 60))"
  elif [ "$s" -lt 172800 ]; then printf '%s h' "$((s / 3600))"
  else printf '%s d' "$((s / 86400))"; fi
}

# <path> -> BT_TF: ok | absent | not-regular | unreadable | no-value, and BT_TF_MODE (octal, empty if unread).
# Absent is `! -e` AND `! -L`: a dangling link is present and not a regular file, never absent.
_bt_value_file() {
  local p="$1" line="" t=""
  BT_TF=""; BT_TF_MODE=""
  if [ ! -e "$p" ] && [ ! -L "$p" ]; then BT_TF=absent; return 0; fi
  if [ -L "$p" ] || [ ! -f "$p" ]; then BT_TF=not-regular; return 0; fi
  BT_TF_MODE="$(_plat_mode -- "$p" 2>/dev/null)" || BT_TF_MODE=""
  if [ ! -r "$p" ]; then BT_TF=unreadable; return 0; fi
  BT_TF=no-value
  while IFS= read -r line || [ -n "$line" ]; do
    t="${line//[[:space:]]/}"
    [ -n "$t" ] || continue
    case "$t" in \#*) continue ;; esac
    BT_TF=ok; break
  done < "$p" 2>/dev/null || BT_TF=unreadable
  line=""; t=""
  return 0
}

# One finding: <arm> <word> [<a>] [<b>]. Appends its line part, its armed class and its remedy to the caller's
# BT_PART, BT_CLASS and BT_FIX (dynamic scope: `_check_box-token` declares them).
_bt_find() {
  local arm="$1" word="$2" a="${3:-}" b="${4:-}" say="" cls=WARN fix=""
  local card="Rotate now on the console's Box token card"
  case "$arm:$word" in
    server:token-absent) cls=FAIL
      say="$a does not exist, so every box-token lane on this server answers 401"
      fix="restart the server (ccrc.service), which mints a value at boot; if it still has none, its log names the failed mint" ;;
    server:token-mode|fleet:fleet-token-mode) cls=FAIL
      say="$a is mode $b, not 0600"; fix="chmod 600 $a" ;;
    server:token-unusable|fleet:fleet-token-unusable) cls=FAIL
      case "$b" in
        not-regular) say="$a is not a regular file" ;;
        unreadable) say="$a cannot be read" ;;
        *) say="$a carries no value line" ;;
      esac
      fix="look at what is there without printing it (ls -l $a); a file the server wrote is rewritten by its next rotation ($card)" ;;
    server:state-absent)
      say="$a does not exist, so this server has not run the token lifecycle (a build before it, or not restarted since)"
      fix="update this box (ccrc update), which restarts the server; it writes the file at boot" ;;
    server:state-unreadable|fleet:sync-unreadable)
      [ "$arm" = server ] && cls=FAIL
      if [ "$b" = no-python ]; then say="python3 is not on PATH, so $a was not read (the python3 check says so too)"
      else say="$a is not a record this check can read"; fi
      fix="look at what is there (ls -l $a); its writer rewrites it whole on its next run" ;;
    server:mint-failed) cls=FAIL
      say="the server could not mint a value ($(_bt_age "$a") ago), so every box-token lane answers 401 until a mint succeeds"
      fix="read the server's log for the errno, then free disk or repair the directory's mode; the driver retries each minute" ;;
    server:held:*)
      say="a rotation is held: ${word#held:}${b:+ on $b}"
      fix="the hold clears when its condition does (an update in flight ends, the fleet installs the release); the console's Box token card names it" ;;
    server:failed:*)
      [ "$a" -ge "$_BT_FAIL_AT" ] && cls=FAIL
      say="$a consecutive failed rotation attempt(s), the last ${word#failed:}"
      fix="read the console's Box token card and the server's log; the driver retries with backoff" ;;
    server:pending-overdue)
      say="a handed-out generation is $(_bt_age "$a") past its confirmation deadline"
      fix="the driver starts a forward rotation itself; if none starts, read the server's log" ;;
    server:rotation-owed:*)
      say="a rotation is owed (${word#rotation-owed:}) and has not completed"
      fix="$card, or let the driver's next tick start it" ;;
    server:proof-unmeasured)
      say="the fleet's last sync ($(_bt_age "$a") ago) wrote the value but could not prove it against this server"
      fix="run ccrc doctor on the fleet box: its box-token line names the sync's own result" ;;
    server:recovered)
      say="the server recovered its token from a sibling file at boot ($(_bt_age "$a") ago), and no rotation has followed"
      fix="$card" ;;
    server:retired-presented) cls=FAIL
      say="a retired value was presented $a time(s) since the server started"
      fix="something still holds a retired value: read the server's log for the lane that presented it, then resync that box ($card)" ;;
    server:fleet-behind)
      say="the fleet has not confirmed the current generation"
      fix="run ccrc doctor on the fleet box; $card resyncs it" ;;
    server:fleet-unconfirmed)
      say="the current value carries no generation id and no rotation is owed, so the fleet's confirmation cannot be measured"
      fix="$card: a rotation gives the value an id the fleet confirms" ;;
    server:file:*) cls=FAIL
      say="on re-read ($(_bt_age "$a") ago) the server's $b token file was found ${word#file:}; the last good value is kept in memory"
      fix="look at the file without printing it (ls -l); the next rotation rewrites the server's token files ($card), and a restart re-reads them" ;;
    fleet:fleet-token-absent) cls=FAIL
      say="$a does not exist, so this box's calls to the server carry no box token"
      fix="the server writes it at its next rotation ($card); a single box records CCRC_ROLE=both in ~/.ccrc/ccrc.env and restarts the server, which writes it at boot" ;;
    fleet:no-generation)
      say="$a does not exist, so this box has recorded no synced generation"; fix="$card" ;;
    fleet:generation-malformed)
      say="$a is not one line of 16 lowercase hex"; fix="$card; the next sync rewrites it" ;;
    fleet:never-synced)
      say="$a does not exist, so ccrc token sync has never run here"; fix="$card" ;;
    fleet:proof-unmeasured)
      say="the last ccrc token sync ($(_bt_age "$a") ago) wrote the value but could not prove it"
      fix="ccrc token probe --file ~/.cc-secrets/ccrc-mail.token measures it again" ;;
    fleet:sync:*)
      say="the last ccrc token sync ($(_bt_age "$a") ago) refused: ${word#sync:}"
      fix="read the console's Box token card and the server's log; ccrc token probe --file ~/.cc-secrets/ccrc-mail.token says whether the server accepts this box's value" ;;
    *) cls=FAIL; say="this check has no sentence for this finding"; fix="this is a bug in ccrc, not a fact about your box — see _bt_find in this file" ;;
  esac
  BT_PART+=("$arm: $word — $say"); BT_CLASS+=("$cls"); BT_FIX+=("$fix")
}

_bt_server_arm() {   # <token path> <state path>
  local tok="$1" state="$2" before="${#BT_CLASS[@]}" out="" kw w n node seq="" since="" rot="" rotating=0 grace=0 refused=0 bad=0
  _bt_value_file "$tok"
  case "$BT_TF" in
    absent) _bt_find server token-absent "$tok" ;;
    ok) [ "$BT_TF_MODE" = 600 ] || _bt_find server token-mode "$tok" "${BT_TF_MODE:-unreadable}" ;;
    *) _bt_find server token-unusable "$tok" "$BT_TF" ;;
  esac
  if ! command -v python3 >/dev/null 2>&1; then _bt_find server state-unreadable "$state" no-python; return 0; fi
  out="$(python3 -c "$_BT_PY_STATE" "$state" "${_BT_ORIGINS[*]}" "${_BT_HOLDS[*]}" "${_BT_OWED[*]}" \
    "${_BT_SYNC_ERRORS[*]} ${_BT_LOST_WORDS[*]}" "${_BT_TRANSPORTS[*]}" "${_BT_FILE_PROBLEMS[*]}" 2>/dev/null)" || out=""
  case "${out%%$'\n'*}" in
    absent) _bt_find server state-absent "$state"; return 0 ;;
    ok) ;;
    *) _bt_find server state-unreadable "$state"; return 0 ;;
  esac
  while IFS=' ' read -r kw w n node; do
    case "$kw" in
      ok) ;;
      seq) _bt_num "$w" && seq="$w" ;;
      since) _bt_num "$w" && since="$w" ;;
      rotated) { [ "$w" = never ] || _bt_num "$w"; } && rot="$w" ;;
      rotating) [ "$w" = 1 ] && rotating=1 ;;
      grace) [ "$w" = 1 ] && grace=1 ;;
      refused) [ "$w" = 1 ] && refused=1 ;;
      finding)
        case "$w" in
          mint-failed|pending-overdue|proof-unmeasured|recovered|retired-presented) _bt_num "$n" && _bt_find server "$w" "$n" || bad=1 ;;
          fleet-behind|fleet-unconfirmed) _bt_find server "$w" ;;
          file:*) if _bt_member "${w#file:}" "${_BT_FILE_PROBLEMS[@]}" && _bt_num "$n" && [[ "$node" =~ ^(current|pending|previous)$ ]]; then
                    _bt_find server "$w" "$n" "$node"; else bad=1; fi ;;
          held:*) if _bt_member "${w#held:}" "${_BT_HOLDS[@]}" && [[ "$node" =~ ^[A-Za-z0-9._:-]{1,64}$ ]]; then
                    [ "$node" = - ] && node=""; _bt_find server "$w" 0 "$node"; else bad=1; fi ;;
          failed:*) if { [ "${w#failed:}" = other ] || _bt_member "${w#failed:}" "${_BT_SYNC_ERRORS[@]}" "${_BT_LOST_WORDS[@]}"; } && _bt_num "$n"; then
                      _bt_find server "$w" "$n"; else bad=1; fi ;;
          rotation-owed:*) if _bt_member "${w#rotation-owed:}" "${_BT_OWED[@]}"; then _bt_find server "$w"; else bad=1; fi ;;
          *) bad=1 ;;
        esac ;;
      '') ;;
      *) bad=1 ;;
    esac
  done <<< "$out"
  if [ "$bad" -eq 1 ] || [ -z "$seq" ] || [ -z "$since" ] || [ -z "$rot" ]; then
    _bt_find server state-unreadable "$state"; return 0
  fi
  [ "${#BT_CLASS[@]}" -eq "$before" ] || return 0
  local how extra=""
  if [ "$rot" = never ]; then how="minted $(_bt_age "$since") ago (no rotation yet)"; else how="rotated $(_bt_age "$rot") ago"; fi
  [ "$refused" -eq 1 ] && extra=", retired value refused"      # spec 10.3's proof, once the server recorded it
  [ "$rotating" -eq 1 ] && extra="$extra, a rotation in progress"
  [ "$grace" -eq 1 ] && extra="$extra, the previous value in grace"
  BT_PART+=("server: generation #$seq, $how, fleet confirmed$extra"); BT_CLASS+=(PASS); BT_FIX+=("")
}

_bt_fleet_arm() {   # <own-write: 0|1>
  local own="$1" ff="$HOME/.cc-secrets/ccrc-mail.token" gen="$HOME/.ccrc/box-token-generation" rep="$HOME/.ccrc/token-sync.json"
  local before="${#BT_CLASS[@]}" out="" kw w n x bad=0 tr="" ownseen=0
  _bt_value_file "$ff"
  case "$BT_TF" in
    absent) _bt_find fleet fleet-token-absent "$ff" ;;
    ok) [ "$BT_TF_MODE" = 600 ] || _bt_find fleet fleet-token-mode "$ff" "${BT_TF_MODE:-unreadable}" ;;
    *) _bt_find fleet fleet-token-unusable "$ff" "$BT_TF" ;;
  esac
  if ! command -v python3 >/dev/null 2>&1; then _bt_find fleet sync-unreadable "$rep" no-python; return 0; fi
  out="$(python3 -c "$_BT_PY_FLEET" "$gen" "$rep" "$own" "${_BT_SYNC_ERRORS[*]}" "${_BT_TRANSPORTS[*]}" 2>/dev/null)" || out=""
  [ -n "$out" ] || bad=1
  while IFS=' ' read -r kw w n x; do
    case "$kw" in
      own) ownseen=1 ;;
      synced) if _bt_member "$w" "${_BT_TRANSPORTS[@]}" && _bt_num "$n"; then tr="$w"; else bad=1; fi ;;
      finding)
        case "$w" in
          no-generation|generation-malformed) _bt_find fleet "$w" "$gen" ;;
          never-synced|sync-unreadable) _bt_find fleet "$w" "$rep" ;;
          proof-unmeasured) _bt_num "$n" && _bt_find fleet "$w" "$n" || bad=1 ;;
          sync:*) if _bt_member "${w#sync:}" "${_BT_SYNC_ERRORS[@]}" && _bt_num "$n"; then _bt_find fleet "$w" "$n"; else bad=1; fi ;;
          *) bad=1 ;;
        esac ;;
      '') ;;
      *) bad=1 ;;
    esac
  done <<< "$out"
  if [ "$bad" -eq 1 ]; then _bt_find fleet sync-unreadable "$rep"; return 0; fi
  [ "${#BT_CLASS[@]}" -eq "$before" ] || return 0
  if [ "$ownseen" -eq 1 ]; then
    BT_PART+=("fleet: token file 0600, generation recorded, written by this box's server")
  elif [ -n "$tr" ]; then
    BT_PART+=("fleet: token file 0600, generation recorded, last sync proved, transport $tr")
  else
    _bt_find fleet sync-unreadable "$rep"; return 0
  fi
  BT_CLASS+=(PASS); BT_FIX+=("")
}

# rc 0 when ~/.ccrc/agent.env marks a FLEET box (server/src/token/files.ts's readAgentEnvMarksFleet, the same rule;
# D-4399): present but not a readable regular file, or a line whose key is CCRC_AGENT_TOKEN
# (optionally after `export `). rc 1 when absent, or readable with no such key (the README's single-box file). The
# file carries the agent bearer: each line is matched by its key alone inside this process and cleared at once.
_bt_agent_env_marks_fleet() {
  local p="$HOME/.ccrc/agent.env" line="" t="" hit=1
  if [ ! -e "$p" ] && [ ! -L "$p" ]; then return 1; fi
  { [ -f "$p" ] && [ -r "$p" ]; } || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    t="${line#"${line%%[![:space:]]*}"}"; line=""
    case "$t" in CCRC_AGENT_TOKEN=*|export[[:space:]]*CCRC_AGENT_TOKEN=*) hit=0; t=""; break ;; esac
    t=""
  done < "$p" 2>/dev/null || hit=0
  line=""; t=""
  return "$hit"
}

_check_box-token() {
  { set +x; } 2>/dev/null
  local role="" fmode="" tok="" dir state arms="" own=0 c worst=PASS detail fix="" x
  local -a BT_PART=() BT_CLASS=() BT_FIX=()
  # The role, the fleet mode and the token path, read as `_check_timeout` reads the role: `ccrc`'s one reader,
  # only when it is loaded and the file is there. Anything else is "not recorded", which picks arms by presence.
  if [ -n "${BOX_ENV_FILE:-}" ] && [ -f "$BOX_ENV_FILE" ] && [ -r "$BOX_ENV_FILE" ] && declare -F _box_env_value >/dev/null 2>&1; then
    role="$(_box_env_value "$BOX_ENV_FILE" CCRC_ROLE)"
    fmode="$(_box_env_value "$BOX_ENV_FILE" CCRC_FLEET)"
    tok="$(_box_env_value "$BOX_ENV_FILE" CCRC_MAIL_TOKEN_PATH)"   # README's override; the state files sit beside it
  fi
  tok="${tok:-$HOME/.ccrc/mail.token}"
  dir="${tok%/*}"; [ "$dir" != "$tok" ] || dir=.
  state="$dir/box-token.json"
  case "$role" in
    server) arms=server ;;
    fleet) arms=fleet ;;
    both) arms="server fleet"
      # The both-role writer's box (bothRoleWriterArmed): the server writes the fleet file itself, so no sync runs.
      [ "$fmode" != remote ] && ! _bt_agent_env_marks_fleet && own=1 ;;
    *)
      { [ -e "$state" ] || [ -L "$state" ] || [ -e "$tok" ] || [ -L "$tok" ]; } && arms=server
      { [ -e "$HOME/.ccrc/agent.env" ] || [ -L "$HOME/.ccrc/agent.env" ]; } && arms="${arms:+$arms }fleet" ;;
  esac
  if [ -z "$arms" ]; then
    _dr_skip box-token "no-role — this box records no CCRC_ROLE and holds neither the server's token files ($tok, $state) nor a fleet agent's $HOME/.ccrc/agent.env, so neither arm has a subject"
    return 3
  fi
  case " $arms " in *" server "*) _bt_server_arm "$tok" "$state" ;; esac
  case " $arms " in *" fleet "*) _bt_fleet_arm "$own" ;; esac
  for c in ${BT_CLASS[@]+"${BT_CLASS[@]}"}; do
    case "$c" in FAIL) worst=FAIL ;; WARN) [ "$worst" = FAIL ] || worst=WARN ;; esac
  done
  detail="$(_dr_join ${BT_PART[@]+"${BT_PART[@]}"})"
  if [ "$worst" = PASS ]; then _dr_pass box-token "$detail"; return 0; fi
  if [ "$_BT_ARMS_ON" != 1 ]; then _dr_skip box-token "$detail$_BT_SKIP_TAIL"; return 3; fi
  for x in ${BT_FIX[@]+"${BT_FIX[@]}"}; do
    [ -n "$x" ] || continue
    case "; $fix; " in *"; $x; "*) ;; *) fix="${fix:+$fix; }$x" ;; esac
  done
  if [ "$worst" = FAIL ]; then _dr_fail box-token "$detail" "$fix"; return 1; fi
  _dr_warn box-token "$detail" "$fix"
  return 2
}
```

Notes the code relies on (do not "simplify" them away):
- The extraction loop's `done < "$p" 2>/dev/null` and the `line=""; t=""` reset keep the value out of every stream; the value is never passed to a child, hashed or kept.
- `[ ! -e ] && [ ! -L ]` is absence: a dangling link is `not-regular`, never `absent` (the `pools-existence-pairing.test.ts` lesson).
- python3 validates the whole state record strictly (a missing key or a wrong kind is `unreadable`, never a default), and bash re-validates every word python prints against the same arrays before it reaches a line.
- No `stat -c`, no bare `timeout`, no GNU `date`: the mode is `_plat_mode`, the clock is python's (`macos-platform.test.ts`).
- `set +x` is the function's first statement, not the file's, and the file sets no umask (a file-level `umask 077` would reach every `--fix` writer in the same process).

- [ ] **Step 4: Run it to verify it passes**

```bash
mkdir -p .tmp-b5 && (cd server && TMPDIR="$PWD/../.tmp-b5" ./node_modules/.bin/vitest run test/doctor-box-token.test.ts)
```

Expected: `Tests  76 passed (76)` (68 prototyped plus the eight cases added at plan assembly).

- [ ] **Step 5: Move the pinned doctor census and add the end-to-end case (`server/test/ccrc-doctor.test.ts`)**

5a. `HEALTHY_SKIPS` (lines 1475-1481 at 282e79e44). Old:

```ts
 *  RAISED BY ONE ON macOS ONLY (session-continuity wave 4): `scope-sweep` SKIPs
 *  there, as `scopes` does — pane scopes are a Linux mechanism. On Linux
 *  `healthy()` plants a fresh verdict record, so it PASSes and this count is
 *  unchanged there. */
const HEALTHY_SKIPS = (process.platform === 'darwin' ? 2 : 0) + 4;
```

New:

```ts
 *  RAISED BY ONE ON macOS ONLY (session-continuity wave 4): `scope-sweep` SKIPs
 *  there, as `scopes` does — pane scopes are a Linux mechanism. On Linux
 *  `healthy()` plants a fresh verdict record, so it PASSes and this count is
 *  unchanged there.
 *
 *  RAISED BY ONE AGAIN (box-token lifecycle Task B5): `box-token` SKIPs
 *  `no-role` on every platform — `healthy()`'s ccrc.env records no CCRC_ROLE,
 *  and the box holds neither the server's `mail.token`/`box-token.json` nor a
 *  fleet agent's `agent.env`, so neither arm has a subject. Measured the same
 *  way: with the check in the table and this `+ 1` absent, "every line is
 *  exactly PASS|WARN|FAIL|SKIP" and "prints a summary count LAST" red, and so
 *  does every `(N skipped)` pin that reads this constant. */
const HEALTHY_SKIPS = (process.platform === 'darwin' ? 2 : 0) + 5;
```

5b. APPEND after the last line (13013 at 282e79e44):

```ts
// ── box-token, through `ccrc doctor` (box-token lifecycle Task B5) ────────
// The check's states are `doctor-box-token.test.ts`'s; these two pin what only the real runner can: that the
// check is in the table, that its SKIP is counted as a skip (exactly one SKIP line, rc 3), and that a
// `CCRC_ROLE=server` box runs the server arm rather than the D-3111 "hosts no sessions" skip.
describe('ccrc doctor: box-token', () => {
  it('healthy() records no role and holds no token file: one SKIP no-role line, counted as a skip, rc 0', () => {
    const r = runDoctor(healthy('ccrc-doctor-bt-norole-'));
    const lines = r.stdout.split('\n').filter((l) => / box-token: /.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^SKIP box-token: no-role — /);
    expect(r.stdout).not.toMatch(/^FAIL box-token: /m);
    expect(r.code).toBe(0);
  });

  it('a CCRC_ROLE=server box with no mail.token runs the server arm: token-absent, reported as SKIP in wave 1', () => {
    const home = healthy('ccrc-doctor-bt-server-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    const line = anyVerdictFor(runDoctor(home).stdout, 'box-token');
    expect(line).toMatch(/^SKIP box-token: server: token-absent — .*; reported as SKIP until the FAIL and WARN arms ship$/);
    expect(line).not.toMatch(/hosts no sessions/);
  });
});
```

5c. Run the cases this task can move (one file, foreground; the whole file did not finish within 600 s on a box at load ~23):

```bash
mkdir -p .tmp-b5 && (cd server && TMPDIR="$PWD/../.tmp-b5" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t "the check list is data|the output contract|ccrc doctor: box-token|SKIPS when no server is running|reports a dead service and a dead timer|SKIPS an env-less FLEET-ROLE|counts BOTH lines in the summary|SKIPS in local mode|SKIPs a box with no completed-install")
```

Expected: `Tests  30 passed | 746 skipped (776)`. Measured reds on the way: with 5a/5b applied and 3a reverted (no table entry), `11 failed | 19 passed` (the table-agree case, the two new cases, and the eight `HEALTHY_SKIPS` readers); with 3a applied and 5a's `+ 5` back at `+ 4`, `8 failed | 22 passed` (exactly the eight `HEALTHY_SKIPS` readers: tmux_skew's, services', config's fleet-role, wrappers' summary, fleet's local, provenance's, "every line is exactly …", "prints a summary count LAST"). On a quiet box run the whole file once as well: `mkdir -p .tmp-b5 && (cd server && TMPDIR="$PWD/../.tmp-b5" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts)`.

- [ ] **Step 6: Re-measure the live-shape golden (`server/test/ccrc-install.test.ts`)**

`BASE_LIVE_SHAPE` is a MEASURED golden of every doctor check's class on the fleet-box live shape, and its first case requires each map to name every table entry but `codex`. Run the case first, unchanged, and read the measurement off the failure:

```bash
mkdir -p .tmp-b5 && (cd server && TMPDIR="$PWD/../.tmp-b5" ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t "the cutover rehearsal")
```

Expected red: `Tests  3 failed | 3 passed | 310 skipped (316)` — "the base tree", "live shape: two installs" and "the flip, in Plan 3b's order", each diff showing only `"box-token"` / `"box-token": "SKIP"`. Then, in each of the three maps (after lines 8251, 8300 and 8419 at 282e79e44), old:

```ts
        "auth": "SKIP",
        "build": "PASS",
```

new (the third map is indented two spaces less):

```ts
        "auth": "SKIP",
        "box-token": "SKIP",
        "build": "PASS",
```

and the docstring (line 8232 at 282e79e44), old:

```ts
 *  runtime dir holds no verdict record) and nothing else moved.
 *  It is a golden: nothing re-measures
```

new:

```ts
 *  runtime dir holds no verdict record) and nothing else moved. RE-MEASURED once more
 *  when doctor gained `box-token` (box-token lifecycle Task B5), by the same case: the
 *  three maps each gained `"box-token": "SKIP"` (the live shape is a `--role fleet`
 *  box with no `~/.cc-secrets/ccrc-mail.token`, so the fleet arm finds
 *  `fleet-token-absent`, which wave 1 reports as SKIP) and nothing else moved.
 *  It is a golden: nothing re-measures
```

Re-run the same command. Expected: `Tests  6 passed | 310 skipped (316)`.

- [ ] **Step 7: Mutation checks (each: apply, run `test/doctor-box-token.test.ts`, see red, restore; the file must be byte-identical afterwards)**

| Mutation in `ccd/ccrc-doctor-checks` | Measured |
|---|---|
| M1 `_BT_ARMS_ON=0` -> `_BT_ARMS_ON=1` (the arms switched on in the shipped file) | 58 failed / 10 passed |
| M2 `_dr_skip box-token "$detail$_BT_SKIP_TAIL"; return 3` -> `_dr_pass box-token "$detail"; return 0` (an armed-later state printed PASS: Review Focus 4) | 28 failed / 40 passed |
| M3 the python line `say("finding", "rotation-owed:" + s["owedWhy"])` -> `pass` (an owed rotation, the leaked value's own state, unreported) | 4 failed / 64 passed |
| M4 `_BT_HOLDS=(update-in-flight agent-predates-op …` loses `agent-predates-op` (shell drifts from L0) | 1 failed / 67 passed (the parity case) |
| M5 a D-3111-style `CCRC_ROLE=server` SKIP added as the check's second statement | 37 failed / 31 passed |
| M6 `    BT_TF=ok; break` -> `    printf "%s\n" "$t"; BT_TF=ok; break` (the value echoed) | 55 failed / 13 passed |
| M7 the python line `say("finding", "pending-overdue", max(over) // 1000)` -> `pass` | 2 failed / 66 passed |
| M8 a WARN finding appended when the fleet PASS line's transport is `http` | 1 failed / 67 passed |
| M9 3a reverted (the table entry removed, the function kept), run against `ccrc-doctor.test.ts` with Step 5c's filter | 11 failed / 19 passed; "every name in the table has a _check_<name> function, and vice versa" is among the reds (the function with no entry is an orphan) |

Added at plan assembly (not prototyped; measure each):

| Mutation in `ccd/ccrc-doctor-checks` | Expected red |
|---|---|
| M10 the python line `say("refused", 0 if s["retiredRefusedAt"] is None else 1)` -> `say("refused", 0)` | every case whose expected line is `SERVER_PASS` |
| M11 the python `elif c["id"] is None and not s["rotationOwed"]:` arm deleted | `server: fleet-unconfirmed` (SKIP and armed) |
| M12 `[ "$fmode" != remote ] && ! _bt_agent_env_marks_fleet && own=1` -> `[ "$fmode" != remote ] && [ ! -e "$HOME/.ccrc/agent.env" ] && own=1` | "both role, local, the README's agent.env …" |
| M13 `_BT_FILE_PROBLEMS` loses `retired` | the parity case and `server: file:retired` |

A note measured on the way: printing the value to STDERR from inside the extraction loop is swallowed by the loop's own `2>/dev/null` and does not red (only a stdout or out-of-loop leak can reach a line). The redirection is part of the guard; keep it.

- [ ] **Step 8: Commit**

Run in its own call, after a green foreground read of Steps 4, 5c and 6:

```bash
git add ccd/ccrc-doctor-checks server/test/doctor-box-token.test.ts server/test/ccrc-doctor.test.ts server/test/ccrc-install.test.ts
git commit -m "feat(doctor): box-token check, PASS or SKIP only in wave 1 (D-4391)

One table entry and _check_box-token with a server arm and a fleet arm by
recorded role (D-3111's server skip never covers it). Every armed-later state
prints SKIP with its reason word; the FAIL and WARN arms are compiled in
behind _BT_ARMS_ON=0 and proven by flipping it in a copy. Never prints a
value, a code or a hash. PASS says fleet confirmed only on a measured
confirmation and names the retired value refused. HEALTHY_SKIPS and
BASE_LIVE_SHAPE re-measured.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then, from the repo root, `rm -rf .tmp-b5`.

**Pinned tests this task moves:**
- `server/test/ccrc-doctor.test.ts` `HEALTHY_SKIPS`: `(darwin ? 2 : 0) + 4` -> `(darwin ? 2 : 0) + 5`, with the "RAISED BY ONE AGAIN (box-token lifecycle Task B5)" paragraph. It moves the eight count pins that read it (Step 5c) without editing them.
- `server/test/ccrc-doctor.test.ts`'s first case ("every name in the table has a _check_<name> function, and vice versa") and "runs every check in the table": unchanged code, now covering `box-token` (the table is read from the file).
- `server/test/ccrc-install.test.ts` `BASE_LIVE_SHAPE`: each of the three maps gains `"box-token": "SKIP"`; the docstring gains its RE-MEASURED sentence. Not in the contract's B5 file list.
- Not moved, checked green: `macos-platform.test.ts`, `pool-name-parity.test.ts`, `pools-existence-pairing.test.ts`, `runbook-holds.test.ts`, `ccrc-doctor-graphify.test.ts`, `source-bytes.test.ts`, `codexLaneFixture.ts`'s `doctorTable` (it strips the `#` comment on line 190 and splits two entries, as it does for `flock timeout`).

### Task B6: Console card and Rotate now

(prototype) measured: server/test/update-routes.test.ts: red 2 failed | 39 passed (41) -> green 41 passed, 2026-10-07 on main 282e79e44
(prototype) measured: pwa/test/box-token-card.test.tsx: red 40 failed (40) -> green 40 passed, 2026-10-07 on main 282e79e44
(not prototyped, added at plan assembly from review findings: the "retired value refused" line (spec 10.3), the re-read's file line, the stall alert, and their reader checks; the card file then has 45 cases)
(prototype) measured, unchanged files re-run green: pwa/test/settings-screen.test.tsx 132 passed; pwa/test/use-updates-view.test.tsx 38 passed; pwa/test/api.test.ts 102 passed; server/test/auth-gate.test.ts 158 passed; server/test/box-token-census.test.ts 23 passed; `tsc --noEmit -p .` clean in pwa/ (its project includes test/) and in server/, 2026-10-07 on main 282e79e44
(prototype note: Part A is not on main at 282e79e44, so the prototype ran against stand-ins spelled exactly as the contract's Interfaces: `shared/box-token.ts` (the B6-consumed L0 names), `TOKEN_TRANSPORTS`/`TokenTransport` appended to `shared/agent-protocol.ts`, and a `server/src/token/routes.ts` holding only `TokenRouteDriver` with `Deps.tokenDriver?` on `server/src/server.ts`. In the real run those are Part A's merged files and B6 does not touch them.)
(prototype note: `server/test/single-definition.test.ts` ran 405 passed | 1 failed over the stand-ins; the one red is "one absent/unreadable read vocabulary" (:2742-2745 at 282e79e44), tripped by the CONTRACT's own `BoxTokenView.fleetConfirmed` spelling `'absent' | 'unreadable'` in `shared/box-token.ts`. That is Task A1's file, and A1 now derives the two words from `ReadFailure`, so B6 runs it green.)

**Files:**
- Modify: `shared/api.ts:8793-8794` (the `UpdatesView` docstring and interface, rewritten IN PLACE on the same two lines so no later line of this file moves)
- Modify: `server/src/update/routes.ts:583-589` (the `GET /api/updates` view literal; one spread after `:587`)
- Modify: `pwa/src/lib/api.ts:7` (imports, after), `:464` (insert the reader before `/** Injectable for tests`), `:701-702` (insert `rotateBoxToken` after `rollbackUpdate`)
- Modify: `pwa/src/fleet/useUpdatesView.ts:160-162` (the rebuild arm of `asUpdatesView` carries `boxToken`; contract addition, see Interfaces)
- Modify: `pwa/src/screens/SettingsScreen.tsx:1-5` (header comment), `:26` (imports), `:666` (insert the card before `export function SettingsScreen`), `:680-681` (mount it between Updates and Notifications)
- Modify: `README.md:967` (one sentence in the "Settings, the update banner and release pushes" paragraph; contract addition)
- Create: `pwa/test/box-token-card.test.tsx`
- Test: `server/test/update-routes.test.ts:41` (imports), `:145` (an `open()` option), `:167` (its deps spread), `:309` (a new describe before `POST /api/updates/intent`)

**Interfaces:**
- Consumes (Part A, merged): `BoxTokenView`, `RotateAnswer`, `TokenHold`, `TOKEN_ROTATE_PATH`, `BOX_TOKEN_PHASES`, `TOKEN_HOLDS`, `TOKEN_ORIGINS`, `OWED_REASONS` from `shared/box-token.ts` (A1); `TOKEN_TRANSPORTS` from `shared/agent-protocol.ts` (A1); `isNodeRole` from `shared/api.ts`; `Deps.tokenDriver?: TokenRouteDriver` and `TokenRouteDriver.view(): BoxTokenView` (A8, `server/src/token/routes.ts`; A9's `BoxTokenDriver` implements it); the session-only `POST /api/token/rotate` answering `RotateAnswer` with 200, 409, 429 or 501 (A8).
- Produces:
  - `shared/api.ts`: `interface UpdatesView { catalogue; releases; nodes; intent; boxToken?: import('./box-token.js').BoxTokenView }` (additive; D-4392).
  - `server/src/update/routes.ts`: `GET /api/updates` carries `boxToken: deps.tokenDriver.view()` iff `deps.tokenDriver` is set, read at request time; no driver, no field.
  - `pwa/src/lib/api.ts`: `export function readBoxTokenView(raw: unknown): BoxTokenView | null` (the ONE reader; malformed or absent -> null); `api.rotateBoxToken(): Promise<RotateAnswer | 'unreadable'>` (CONTRACT CORRECTION: the contract says `Promise<RotateAnswer>`; a 2xx whose body will not parse may still have started a rotation, so it resolves `'unreadable'` under D-1150's `postJsonOr` rule, exactly as `setUpdateIntent`, `applyUpdate` and `rollbackUpdate` do; its 409/429/501 refusals resolve as the `RotateAnswer` they carry, any other failure rejects with its `ApiError`).
  - `pwa/src/screens/SettingsScreen.tsx`: exported `boxTokenHoldText(hold: TokenHold, node: string | null): string`, `boxTokenStateText(v: BoxTokenView): string`, `boxTokenTransportText(t: BoxTokenView['fleetTransport']): string`; the "Box token" `<section>` (a region named "Box token") with its "Rotate now" button.
  - `pwa/src/fleet/useUpdatesView.ts`: `asUpdatesView`'s rebuild (a dropped malformed element) keeps `boxToken` as it came (CONTRACT ADDITION: without it, one bad node row blanks the card, measured red by the "survives asUpdatesView's rebuild" case).

- [ ] **Step 1: Write the failing server test**

In `server/test/update-routes.test.ts`, after the import at `:41` (`import type { CatalogueState, NodeWire, UpdatesView } from '../../shared/api.js';`) add:

```ts
import type { BoxTokenView } from '../../shared/box-token.js';
import type { TokenRouteDriver } from '../src/token/routes.js';
```

In `open()`'s option type, after `updateRunner?: LocalUpdateSpawn;` (`:145`) add `tokenDriver?: TokenRouteDriver;`, and in its `deps` literal, after `...(o.updateRunner ? { updateRunner: o.updateRunner } : {}),` (`:167`) add:

```ts
    ...(o.tokenDriver ? { tokenDriver: o.tokenDriver } : {}),
```

Insert before `describe('POST /api/updates/intent', () => {` (`:309`):

```ts
// Box-token lifecycle wave 1, Task B6 (D-4392): the console's box-token card
// rides `GET /api/updates` as ONE optional fleet-wide object, produced by the
// driver's `view()` and nothing else. The driver here is a fake: the route only
// reads `view()`, at request time, and never decides what it says.
const BT_VIEW: BoxTokenView = {
  phase: 'idle', origin: 'rotated', currentSeq: 3, currentSince: 5_000, lastRotationAt: 5_000,
  rotationOwed: false, owedWhy: null, hold: null, holdNode: null, failures: 0, lastFailure: null, banner: false,
  fleetConfirmed: 'current', fleetTransport: 'https', lastSync: { at: 5_000, word: 'synced' },
  previousPresented: 0, retiredPresented: 0, retiredRefused: true, lastBootRecovery: null, role: 'server',
  stalled: null, fileProblem: null,
};
const fakeTokenDriver = (views: BoxTokenView[]): TokenRouteDriver & { calls: () => number } => {
  let n = 0;
  return {
    door: null as never,
    commitHandOut: async () => { throw new Error('the update route must never hand out'); },
    rotateNow: async () => { throw new Error('the update route must never rotate'); },
    view: () => views[Math.min(n++, views.length - 1)]!,
    calls: () => n,
  };
};

describe('GET /api/updates carries the box-token view (Task B6, D-4392)', () => {
  it('a server with a driver answers its view() as `boxToken`, beside the four fields that were there', async () => {
    const driver = fakeTokenDriver([BT_VIEW]);
    const f = await open({ tokenDriver: driver });
    const r = await f.app.inject({ method: 'GET', url: '/api/updates' });
    expect(r.statusCode, r.body).toBe(200);
    const view = r.json() as UpdatesView;
    expect(view.boxToken).toEqual(BT_VIEW);
    expect(Object.keys(view).sort()).toEqual(['boxToken', 'catalogue', 'intent', 'nodes', 'releases']);
  });

  it('reads view() at REQUEST time, once per request — a later answer shows the later state', async () => {
    const later: BoxTokenView = { ...BT_VIEW, phase: 'held', hold: 'update-in-flight', holdNode: 'fleet' };
    const driver = fakeTokenDriver([BT_VIEW, later]);
    const f = await open({ tokenDriver: driver });
    const first = (await f.app.inject({ method: 'GET', url: '/api/updates' })).json() as UpdatesView;
    const second = (await f.app.inject({ method: 'GET', url: '/api/updates' })).json() as UpdatesView;
    expect(first.boxToken?.phase).toBe('idle');
    expect(second.boxToken).toMatchObject({ phase: 'held', hold: 'update-in-flight', holdNode: 'fleet' });
    expect(driver.calls()).toBe(2);
  });

  it('a server with no driver OMITS the field — never null, never a made-up idle (absence permits)', async () => {
    const f = await open();
    const r = await f.app.inject({ method: 'GET', url: '/api/updates' });
    expect(r.statusCode, r.body).toBe(200);
    expect(Object.keys(r.json() as object)).not.toContain('boxToken');
  });
});
```

(`door: null as never` satisfies A8's `readonly door: ClaimDoor`; the route never touches it.)

- [ ] **Step 2: Run it to verify it fails**

```bash
mkdir -p .tmp-b6 && (cd server && TMPDIR="$PWD/../.tmp-b6" ./node_modules/.bin/vitest run test/update-routes.test.ts)
```

Expected: `Tests  2 failed | 39 passed (41)`; the two driver cases fail with `AssertionError: expected undefined to deeply equal { phase: 'idle', …(19) }` and `expected undefined to be 'idle'`. The no-driver case already passes (it pins absence).

- [ ] **Step 3: Write the minimal server implementation**

`shared/api.ts:8793-8794`, old:

```ts
/** `GET /api/updates` (§12). */
export interface UpdatesView { catalogue: CatalogueState; releases: ReleaseWire[]; nodes: NodeWire[]; intent: UpdateIntentWire[] }
```

new (the same two lines; an inline type import instead of a new import line at the top, so no line of `shared/api.ts` moves; README and code comments cite this file by line number, and its own end-of-file blocks say "so no line README cites by number moves"):

```ts
/** `GET /api/updates` (§12); `boxToken` is ADDITIVE (D-4392): the driver's `view()`, absent from a server with none or an older one, read in the PWA through `readBoxTokenView` alone. */
export interface UpdatesView { catalogue: CatalogueState; releases: ReleaseWire[]; nodes: NodeWire[]; intent: UpdateIntentWire[]; boxToken?: import('./box-token.js').BoxTokenView }
```

`server/src/update/routes.ts`, in `app.get('/api/updates', …)`, old (`:587-588`):

```ts
      intent: deps.coord.intents().map(toIntentWire),
    };
```

new:

```ts
      intent: deps.coord.intents().map(toIntentWire),
      // Box-token lifecycle wave 1 (D-4392): the console card's one object, the driver's own view, read at
      // request time. No driver, no field — an absent `boxToken` is how an older server already answers.
      ...(deps.tokenDriver ? { boxToken: deps.tokenDriver.view() } : {}),
    };
```

The slice names neither box-token function, so `box-token-census.test.ts`'s `GATE_PATTERNS` (`requireMailToken(req`, `checkMailToken(`) see no lane here and `UPDATE_DOORS` is unchanged; `auth-gate.test.ts`'s `scanRoutes('update/routes.ts')` stays 7.

- [ ] **Step 4: Run it to verify it passes**

```bash
mkdir -p .tmp-b6 && (cd server && TMPDIR="$PWD/../.tmp-b6" ./node_modules/.bin/vitest run test/update-routes.test.ts)
```

Expected: `Tests  41 passed (41)`.

- [ ] **Step 5: Mutation check (server)**

Delete the one spread line `...(deps.tokenDriver ? { boxToken: deps.tokenDriver.view() } : {}),` and re-run Step 4's command: expected `Tests  2 failed | 39 passed (41)` (the two driver cases). Restore the line, re-run: `41 passed`.

- [ ] **Step 6: Write the failing PWA test**

Create `pwa/test/box-token-card.test.tsx`:

```tsx
// Box-token lifecycle wave 1, Task B6 (spec 4.7, D-4392): the Settings "Box
// token" card and its "Rotate now" button. The card reads ONE object, the
// `boxToken` field of `GET /api/updates`, through ONE reader (`readBoxTokenView`),
// and renders the server's own words: it decides nothing about the rotation.
//
// The idiom is settings-screen.test.tsx's: the full afterEach (cleanup,
// restoreAllMocks, the route back to '/', the fleet store reset), `api` spied,
// never a live fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { NodeWire, UpdatesView } from '../../shared/api';
import type { BoxTokenView, RotateAnswer } from '../../shared/box-token';
import { BOX_TOKEN_PHASES, TOKEN_HOLDS } from '../../shared/box-token';
import { SettingsScreen, boxTokenHoldText, boxTokenStateText, boxTokenTransportText } from '../src/screens/SettingsScreen';
import { asUpdatesView } from '../src/fleet/useUpdatesView';
import { ApiError, api, createApi, readBoxTokenView } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { ToastHost } from '../src/components/Toast';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

const MIN = 60_000;
const BT = (over: Partial<BoxTokenView> = {}): BoxTokenView => ({
  phase: 'idle', origin: 'rotated', currentSeq: 4, currentSince: Date.now() - 90 * MIN,
  lastRotationAt: Date.now() - 90 * MIN, rotationOwed: false, owedWhy: null, hold: null, holdNode: null,
  failures: 0, lastFailure: null, banner: false, fleetConfirmed: 'current', fleetTransport: 'https',
  lastSync: { at: Date.now() - 90 * MIN, word: 'synced' }, previousPresented: 0, retiredPresented: 0,
  retiredRefused: true, lastBootRecovery: null, role: 'server', stalled: null, fileProblem: null,
  ...over,
});
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: '0f0e0d0c-0b0a-4908-8706-050403020100', role: 'fleet', label: 'fleet', os: 'linux',
  current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-10-07T12:00:00Z', dirty: false, version: 'v0.0.9' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent', measuredAt: 1_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const view = (boxToken: unknown, over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: null, lastError: null }, releases: [], nodes: [node()], intent: [],
  ...(boxToken === undefined ? {} : { boxToken: boxToken as BoxTokenView }),
  ...over,
});
/** Mount the screen over one answer; resolves with the card's region once it has rendered. */
const mount = async (v: UpdatesView): Promise<HTMLElement> => {
  vi.spyOn(api, 'updates').mockResolvedValue(v);
  render(<><ToastHost /><SettingsScreen /></>);
  return screen.findByRole('region', { name: 'Box token' });
};

describe('readBoxTokenView — the ONE reader of UpdatesView.boxToken', () => {
  it('hands back a well-formed view unchanged', () => {
    const v = BT();
    expect(readBoxTokenView(v)).toEqual(v);
    expect(readBoxTokenView(BT({ phase: 'held', hold: 'update-in-flight', holdNode: 'fleet', fleetTransport: null,
      lastSync: null, lastBootRecovery: { at: 5, source: 'previous' }, origin: null, currentSeq: null, currentSince: null })))
      .not.toBeNull();
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['an array', []],
    ['a phase this build does not know', { ...BT(), phase: 'rotating' }],
    ['a hold this build does not know', { ...BT(), hold: 'window' }],
    ['an owed reason this build does not know', { ...BT(), rotationOwed: true, owedWhy: 'weekly' }],
    ['a transport that is neither http, https, unmeasured nor null', { ...BT(), fleetTransport: 'ws' }],
    ['a fleet word this build does not know', { ...BT(), fleetConfirmed: 'maybe' }],
    ['a count that is not a non-negative integer', { ...BT(), retiredPresented: -1 }],
    ['failures as a string', { ...BT(), failures: '3' }],
    ['banner missing', (() => { const { banner: _b, ...rest } = BT(); return rest; })()],
    ['a lastSync with no word', { ...BT(), lastSync: { at: 5 } }],
    ['a boot recovery from a third source', { ...BT(), lastBootRecovery: { at: 5, source: 'current' } }],
    ['a role this build does not know', { ...BT(), role: 'edge' }],
    ['a stall with a reason this build does not know', { ...BT(), stalled: { why: 'weekly', since: 5 } }],
    ['a file finding this build does not know', { ...BT(), fileProblem: { at: 5, file: 'current', word: 'stolen' } }],
  ])('%s reads as null — "not reported", never a made-up idle', (_w, raw) => {
    expect(readBoxTokenView(raw)).toBeNull();
  });
});

describe('the card words (spec 4.7)', () => {
  it('names every phase and every hold the server can send, in words', () => {
    for (const phase of BOX_TOKEN_PHASES) expect(boxTokenStateText(BT({ phase })), phase).not.toBe('');
    for (const hold of TOKEN_HOLDS) expect(boxTokenHoldText(hold, null), hold).toMatch(/^held: /);
    expect(boxTokenHoldText('update-in-flight', 'fleet')).toBe('held: an update is in flight on fleet');
    expect(boxTokenHoldText('agent-predates-op', null)).toBe('held: fleet agent predates token-sync');
  });

  it('says plain http is unencrypted, and never folds an unmeasured transport into https', () => {
    expect(boxTokenTransportText('http')).toBe('transport: http (unencrypted)');
    expect(boxTokenTransportText('https')).toBe('transport: https');
    expect(boxTokenTransportText('unmeasured')).toBe('transport: not measured');
    expect(boxTokenTransportText(null)).toBe('transport: no sync yet');
  });

  it('renders age, last rotation, state, fleet confirmation, transport and both presented counts', async () => {
    const card = await mount(view(BT({ previousPresented: 2, retiredPresented: 1, fleetTransport: 'http' })));
    expect(within(card).getByText('state: idle')).toBeInTheDocument();
    expect(within(card).getByText('current value: generation #4, 1h 30m old')).toBeInTheDocument();
    expect(within(card).getByText('last rotation: 1h 30m ago')).toBeInTheDocument();
    expect(within(card).getByText('fleet: confirmed the current generation')).toBeInTheDocument();
    expect(within(card).getByText('transport: http (unencrypted)')).toBeInTheDocument();
    expect(within(card).getByText('previous still presented: 2 · retired value presented: 1')).toBeInTheDocument();
    expect(within(card).getByText('retired value refused: yes')).toBeInTheDocument();     // spec 10.3, plan assembly
    expect(within(card).queryByRole('alert'), 'no banner below three failures').toBeNull();
  });

  // ── added at plan assembly (review findings) ──
  it('before the first retirement the proof line says not yet', async () => {
    const card = await mount(view(BT({ retiredRefused: false })));
    expect(within(card).getByText('retired value refused: not yet')).toBeInTheDocument();
  });

  it('a stalled rotation raises the alert although no attempt failed; a failed mint does too', async () => {
    const owed = await mount(view(BT({ phase: 'held', hold: 'agent-predates-op', holdNode: 'fleet', rotationOwed: true,
      owedWhy: 'adopted', stalled: { why: 'owed', since: Date.now() - 25 * 60 * MIN } })));
    expect(within(owed).getByRole('alert')).toHaveTextContent('A box-token rotation has been owed for 1d 1h and has not completed (held: fleet agent predates token-sync).');
    cleanup();
    const mint = await mount(view(BT({ phase: 'unconfigured', currentSeq: null, currentSince: null,
      stalled: { why: 'mint-failed', since: Date.now() - 5 * MIN } })));
    expect(within(mint).getByRole('alert')).toHaveTextContent('The server could not mint a box token; every box-token call is refused until a mint succeeds.');
  });

  it('a file finding from the re-read is shown with its file and word', async () => {
    const card = await mount(view(BT({ fileProblem: { at: Date.now() - 5 * MIN, file: 'current', word: 'changed' } })));
    expect(within(card).getByText(/^server token file: current changed on re-read \(the last good value is kept\), /)).toBeInTheDocument();
  });

  it('a held rotation renders the server\'s hold word with its node; an owed one says why', async () => {
    const card = await mount(view(BT({ phase: 'held', hold: 'update-in-flight', holdNode: 'fleet',
      rotationOwed: true, owedWhy: 'adopted', origin: 'adopted' })));
    expect(within(card).getByText('state: held: an update is in flight on fleet')).toBeInTheDocument();
    expect(within(card).getByText('rotation owed: adopted')).toBeInTheDocument();
    expect(within(card).getByText('current value: generation #4, 1h 30m old (hand-made, adopted)')).toBeInTheDocument();
  });

  it('a failed rotation names its word; three in a row raise the banner', async () => {
    const card = await mount(view(BT({ phase: 'failed', failures: 3, lastFailure: 'proof-failed', banner: true })));
    expect(within(card).getByText('state: failed (proof-failed)')).toBeInTheDocument();
    expect(within(card).getByRole('alert')).toHaveTextContent('Box-token rotation has failed 3 times in a row (last: proof-failed).');
  });

  it('a boot recovery is shown with its source', async () => {
    const card = await mount(view(BT({ lastBootRecovery: { at: Date.now() - 5 * MIN, source: 'pending' } })));
    expect(within(card).getByText(/^recovered at boot from the pending file, /)).toBeInTheDocument();
  });

  it('an older server (no field) and a malformed field are two sentences, and neither shows a button', async () => {
    const absent = await mount(view(undefined));
    expect(within(absent).getByText('This server reports no box-token state.')).toBeInTheDocument();
    expect(within(absent).queryByRole('button', { name: 'Rotate now' })).toBeNull();
    cleanup();
    const bad = await mount(view({ phase: 'rotating' }));
    expect(within(bad).getByText('Box-token state: not reported (the server\'s answer could not be read).')).toBeInTheDocument();
    expect(within(bad).queryByRole('button', { name: 'Rotate now' })).toBeNull();
  });

  it('survives asUpdatesView\'s rebuild: a dropped malformed node does not drop the box-token field', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const raw = { ...view(BT()), nodes: [node(), null] };
    expect(asUpdatesView(raw)?.boxToken).toEqual(BT());
  });

  it('the card puts no value, code or hash on the page: no 43- or 64-character secret shape anywhere', async () => {
    const card = await mount(view(BT({ lastSync: { at: Date.now(), word: 'synced' } })));
    expect(card.textContent ?? '').not.toMatch(/[0-9a-f]{64}|[A-Za-z0-9_-]{43}/);
  });
});

describe('Rotate now', () => {
  it('posts the rotate route once, says what the server answered, and re-polls', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(view(BT()));
    const rotate = vi.spyOn(api, 'rotateBoxToken')
      .mockResolvedValue({ ok: true, outcome: 'started', view: BT({ phase: 'staged' }) } satisfies RotateAnswer);
    render(<><ToastHost /><SettingsScreen /></>);
    const card = await screen.findByRole('region', { name: 'Box token' });
    fireEvent.click(within(card).getByRole('button', { name: 'Rotate now' }));
    await within(card).findByText('Rotation started.');
    expect(rotate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['joined', { ok: true, outcome: 'joined', view: BT() }, 'Joined the rotation already running.'],
    ['held', { ok: false, error: 'held', hold: 'stale-client', node: 'fleet', view: BT() },
      'Not started — held: a stale ccrc-api on fleet'],
    ['rate-limited', { ok: false, error: 'rate-limited', retryAfterS: 42 }, 'At most one Rotate now a minute — try again in 42 s.'],
    ['not-configured', { ok: false, error: 'not-configured' }, 'This server runs no box-token driver.'],
    ['unreadable', 'unreadable', "Asked — the server's answer could not be read; the card will re-check."],
  ] as const)('%s: the card says the answer in place', async (_w, answer, said) => {
    vi.spyOn(api, 'updates').mockResolvedValue(view(BT()));
    vi.spyOn(api, 'rotateBoxToken').mockResolvedValue(answer as RotateAnswer | 'unreadable');
    const card = await mount(view(BT()));
    fireEvent.click(within(card).getByRole('button', { name: 'Rotate now' }));
    await within(card).findByText(said);
  });

  it('the button is disabled while a tap is in flight, so a second tap sends nothing', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(view(BT()));
    const rotate = vi.spyOn(api, 'rotateBoxToken').mockReturnValue(new Promise(() => {}));
    const card = await mount(view(BT()));
    const button = within(card).getByRole('button', { name: 'Rotate now' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(rotate).toHaveBeenCalledTimes(1);
  });
});

describe('api.rotateBoxToken — the route\'s refusals come back as answers, anything else rejects', () => {
  const answer = (status: number, body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  it('POSTs /api/token/rotate with no body', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ok: true, outcome: 'started', view: BT() }), { status: 200 });
    }) as typeof fetch;
    await expect(createApi(f).rotateBoxToken()).resolves.toMatchObject({ ok: true, outcome: 'started' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('/api/token/rotate');
    expect(seen[0]!.init?.method).toBe('POST');
    expect(seen[0]!.init?.body).toBeUndefined();
  });

  it.each([
    [409, { ok: false, error: 'held', hold: 'link-down', node: null, view: BT() }],
    [429, { ok: false, error: 'rate-limited', retryAfterS: 30 }],
    [501, { ok: false, error: 'not-configured' }],
  ])('%i resolves as the RotateAnswer it carries', async (status, body) => {
    await expect(createApi(answer(status, body)).rotateBoxToken()).resolves.toEqual(body);
  });

  it.each([
    ['a 409 whose hold word this build does not know', 409, { ok: false, error: 'held', hold: 'window', node: null, view: BT() }],
    ['a 409 whose view is malformed', 409, { ok: false, error: 'held', hold: 'link-down', node: null, view: {} }],
    ['a 500', 500, { ok: false, error: 'internal' }],
    ['a 404', 404, { ok: false, error: 'not-found' }],
  ])('%s rejects with its ApiError', async (_w, status, body) => {
    await expect(createApi(answer(status, body)).rotateBoxToken()).rejects.toBeInstanceOf(ApiError);
  });

  it('a 200 whose body will not parse resolves to unreadable (it may have started)', async () => {
    const f = (async () => new Response('<html>', { status: 200 })) as typeof fetch;
    await expect(createApi(f).rotateBoxToken()).resolves.toBe('unreadable');
  });
});
```

(No 401 case: `request` raises the login screen through `raiseAuthLostFrom`, a module-level side effect `restoreAllMocks` does not undo; the 404 case proves the same reject arm.)

- [ ] **Step 7: Run it to verify it fails**

```bash
mkdir -p .tmp-b6 && (cd pwa && TMPDIR="$PWD/../.tmp-b6" ./node_modules/.bin/vitest run test/box-token-card.test.tsx)
```

Expected: `Tests  45 failed (45)` (measured as 40 failed on the 40-case prototype): `readBoxTokenView`, `api.rotateBoxToken`, `boxTokenStateText`, `boxTokenHoldText` and `boxTokenTransportText` do not exist yet, and no region named "Box token" renders.

- [ ] **Step 8: Write the minimal PWA implementation**

`pwa/src/lib/api.ts`, after the import at `:7` (`import { ARCHIVE_REFUSALS, … } from '../../../shared/api';`) add:

```ts
import { isNodeRole } from '../../../shared/api';
import { TOKEN_TRANSPORTS } from '../../../shared/agent-protocol';
import {
  BOX_TOKEN_PHASES, OWED_REASONS, TOKEN_FILE_PROBLEMS, TOKEN_HOLDS, TOKEN_ORIGINS, TOKEN_ROTATE_PATH, type BoxTokenView,
  type RotateAnswer,
} from '../../../shared/box-token';
```

Insert before `/** Injectable for tests; defaults to the real global fetch. */` (`:464`):

```ts
// ── The box-token card's wire (box-token lifecycle wave 1, Task B6, D-4392) ──
// `UpdatesView.boxToken` is ADDITIVE: absent from an older server and from one
// that runs no driver. `readBoxTokenView` is its ONE reader, and every enumerated
// field is checked against the L0 list that declares it (`shared/box-token.ts`,
// `shared/agent-protocol.ts`, `shared/api.ts`), never a list spelled here, so a
// word a newer server adds reads as "not reported" rather than as a state this
// build would have to guess at. Malformed is null; the card says "not reported".

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isWord = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isInstant = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const orNull = (v: unknown, ok: (x: unknown) => boolean): boolean => v === null || ok(v);
/** `BoxTokenView['fleetConfirmed']` keyed once, so a word added to the type is a compile error here. */
const FLEET_CONFIRMED_WORDS: Record<BoxTokenView['fleetConfirmed'], true> = {
  current: true, behind: true, absent: true, unreadable: true, 'own-write': true, unknown: true,
};
const BOOT_RECOVERY_SOURCES: Record<NonNullable<BoxTokenView['lastBootRecovery']>['source'], true> = { pending: true, previous: true };
/** Plan assembly: the two additive fields, keyed once. Absent (an older server) reads as null, never as a refusal. */
const STALL_WHYS: Record<NonNullable<BoxTokenView['stalled']>['why'], true> = { 'mint-failed': true, owed: true };
const FILE_SLOTS: Record<NonNullable<BoxTokenView['fileProblem']>['file'], true> = { current: true, pending: true, previous: true };

export function readBoxTokenView(raw: unknown): BoxTokenView | null {
  if (!isRecord(raw)) return null;
  const v = raw;
  const ok = isWord(BOX_TOKEN_PHASES, v.phase)
    && orNull(v.origin, (x) => isWord(TOKEN_ORIGINS, x))
    && orNull(v.currentSeq, isCount) && orNull(v.currentSince, isInstant) && orNull(v.lastRotationAt, isInstant)
    && typeof v.rotationOwed === 'boolean' && orNull(v.owedWhy, (x) => isWord(OWED_REASONS, x))
    && orNull(v.hold, (x) => isWord(TOKEN_HOLDS, x)) && orNull(v.holdNode, (x) => typeof x === 'string')
    && isCount(v.failures) && orNull(v.lastFailure, (x) => typeof x === 'string') && typeof v.banner === 'boolean'
    && typeof v.fleetConfirmed === 'string' && Object.hasOwn(FLEET_CONFIRMED_WORDS, v.fleetConfirmed)
    && orNull(v.fleetTransport, (x) => x === 'unmeasured' || isWord(TOKEN_TRANSPORTS, x))
    && orNull(v.lastSync, (x) => isRecord(x) && isInstant(x.at) && typeof x.word === 'string')
    && isCount(v.previousPresented) && isCount(v.retiredPresented) && typeof v.retiredRefused === 'boolean'
    && orNull(v.lastBootRecovery, (x) => isRecord(x) && isInstant(x.at)
      && typeof x.source === 'string' && Object.hasOwn(BOOT_RECOVERY_SOURCES, x.source))
    && (v.stalled === undefined || orNull(v.stalled, (x) => isRecord(x) && isInstant(x.since)
      && typeof x.why === 'string' && Object.hasOwn(STALL_WHYS, x.why)))
    && (v.fileProblem === undefined || orNull(v.fileProblem, (x) => isRecord(x) && isInstant(x.at)
      && typeof x.file === 'string' && Object.hasOwn(FILE_SLOTS, x.file) && isWord(TOKEN_FILE_PROBLEMS, x.word)))
    && isNodeRole(v.role);
  return ok ? { ...(v as unknown as BoxTokenView), stalled: (v.stalled ?? null) as BoxTokenView['stalled'],
    fileProblem: (v.fileProblem ?? null) as BoxTokenView['fileProblem'] } : null;
}

/** A refusal `POST /api/token/rotate` answers (409, 429, 501) read back as the `RotateAnswer` it is, or null for
 *  anything else — the caller then rethrows the `ApiError` it caught. */
function rotateRefusalOf(err: unknown): RotateAnswer | null {
  if (!(err instanceof ApiError) || !isRecord(err.body) || err.body.ok !== false) return null;
  const b = err.body;
  if (err.status === 409 && b.error === 'held' && isWord(TOKEN_HOLDS, b.hold)
    && orNull(b.node, (x) => typeof x === 'string')) {
    const view = readBoxTokenView(b.view);
    return view === null ? null : { ok: false, error: 'held', hold: b.hold, node: (b.node as string | null), view };
  }
  if (err.status === 429 && b.error === 'rate-limited' && isCount(b.retryAfterS)) {
    return { ok: false, error: 'rate-limited', retryAfterS: b.retryAfterS };
  }
  if (err.status === 501 && b.error === 'not-configured') return { ok: false, error: 'not-configured' };
  return null;
}
```

(`FLEET_CONFIRMED_WORDS` writes `absent: true, unreadable: true` as object keys, not as the `'absent' | 'unreadable'` type pair `single-definition.test.ts` scans for; measured green on that scan's PWA side.)

In the `api` object, after `rollbackUpdate` (`:701-702`) add:

```ts
    /** `POST /api/token/rotate` — the card's "Rotate now" (box-token lifecycle wave 1, Task B6). Session-only
     *  route, no body. Its three refusals (409 `held`, 429 `rate-limited`, 501 `not-configured`) are ANSWERS the
     *  card renders in place, so they resolve as the `RotateAnswer` they carry; any other failure (a 401 included,
     *  which still raises the one login screen through `request`) rejects with its `ApiError`. `postJsonOr` for
     *  `setUpdateIntent`'s reason (D-1150): a 2xx that cannot be read may still have started a rotation. */
    rotateBoxToken: async (): Promise<RotateAnswer | 'unreadable'> => {
      let answer: unknown;
      try {
        answer = await postJsonOr<unknown>(TOKEN_ROTATE_PATH, 'unreadable');
      } catch (err) {
        const refusal = rotateRefusalOf(err);
        if (refusal !== null) return refusal;
        throw err;
      }
      if (!isRecord(answer) || answer.ok !== true || (answer.outcome !== 'started' && answer.outcome !== 'joined')) {
        return 'unreadable';
      }
      const view = readBoxTokenView(answer.view);
      return view === null ? 'unreadable' : { ok: true, outcome: answer.outcome, view };
    },
```

`pwa/src/fleet/useUpdatesView.ts:160-162`, old:

```ts
  return {
    catalogue: catalogue as unknown as UpdatesView['catalogue'], releases: okReleases, nodes: okNodes, intent: okIntent,
  };
```

new:

```ts
  return {
    catalogue: catalogue as unknown as UpdatesView['catalogue'], releases: okReleases, nodes: okNodes, intent: okIntent,
    // The box-token card's field (D-4392) rides through untouched: this guard does not judge it, its ONE reader
    // (`readBoxTokenView`, lib/api.ts) does, and a rebuild that dropped it would blank the card for a bad node row.
    ...(raw.boxToken !== undefined ? { boxToken: raw.boxToken as UpdatesView['boxToken'] } : {}),
  };
```

(The identity arm `return raw as unknown as UpdatesView` above it already carries the field; `use-updates-view.test.tsx`'s `toBe(v)` identity pins are untouched.)

`pwa/src/screens/SettingsScreen.tsx:1-5`, old:

```ts
// Settings screen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Two sections and no more — Updates (the channel,
// auto-install, *Check now*, the catalogue line, the release list, the node
// inventory) and Notifications (the bell, release notifications, the
// unarmed-exposure banner) — both shipped in this file, below the header
```

new:

```ts
// Settings screen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Updates (the channel, auto-install, *Check now*, the
// catalogue line, the release list, the node inventory), the Box token card
// (box-token lifecycle wave 1, Task B6: age, state, fleet confirmation,
// transport, *Rotate now*) and Notifications (the bell, release notifications,
// the unarmed-exposure banner) — all shipped in this file, below the header
```

`:26`, old: `import { ApiError, api, moveSkipText, noBundleRollbackText, updateErrorText } from '../lib/api';` new:

```ts
import { ApiError, api, apiErrorText, moveSkipText, noBundleRollbackText, readBoxTokenView, updateErrorText } from '../lib/api';
import type { BoxTokenView, RotateAnswer, TokenHold } from '../../../shared/box-token';
```

Insert before `export function SettingsScreen(): ReactNode {` (`:666`):

```tsx
// ── The box-token card (box-token lifecycle wave 1, Task B6; spec 4.7, D-4392) ──
// A THIRD section, over the same one /api/updates poll: `view.boxToken`, read
// through `readBoxTokenView` (lib/api.ts) and nothing else. Three rules it keeps,
// each pinned in box-token-card.test.tsx:
//   * THE SERVER'S WORDS ARE WHAT IS SHOWN. Phase, hold, owed reason, failure
//     word and fleet word are the driver's; this block only puts them into
//     sentences, keyed by the L0 types so a new word is a compile error here.
//   * ABSENT AND MALFORMED ARE TWO SENTENCES. An older server sends no field; a
//     field this build cannot read is "not reported". Neither offers the button.
//   * NO VALUE, CODE OR HASH. The view carries none, and nothing here derives one.
// "Rotate now" is the session-only `POST /api/token/rotate`; its refusals are
// answers said in place, and the card re-polls after every tap.

const BOX_TOKEN_HOLD_TEXT: Record<TokenHold, (node: string | null) => string> = {
  'update-in-flight': (n) => `an update is in flight on ${n ?? 'a node'}`,
  'agent-predates-op': () => 'fleet agent predates token-sync',
  'verb-missing': (n) => `release not yet on ${n ?? 'the fleet box'} (its ccrc has no token verb)`,
  'stale-client': (n) => `a stale ccrc-api on ${n ?? 'the fleet box'}`,
  'fleet-rows': () => 'not exactly one reachable fleet node',
  'node-id-unmeasured': (n) => `the node id of ${n ?? 'the fleet box'} is not measured`,
  'link-down': () => 'the agent link is down',
  'pending-cap': () => 'two handed-out values still await confirmation',
  'no-coord': () => 'no coordination database',
  'role-unrecorded': () => "this box's role is not recorded as both (CCRC_ROLE in ~/.ccrc/ccrc.env)",
  'mint-failed': () => 'the server could not mint a value',
};

/** "held: …", the card's spelling of the server's hold word (spec 4.7's own examples). */
export function boxTokenHoldText(hold: TokenHold, node: string | null): string {
  return `held: ${BOX_TOKEN_HOLD_TEXT[hold](node)}`;
}

export function boxTokenStateText(v: BoxTokenView): string {
  switch (v.phase) {
    case 'unconfigured': return 'no current value';
    case 'idle': return 'idle';
    case 'staged': return 'rotating (a new value is staged)';
    case 'handed-out': return 'rotating (handed out, awaiting the fleet box)';
    case 'promoting': return 'rotating (promoting)';
    case 'grace': return 'grace (the previous value is still accepted)';
    case 'held': return v.hold !== null ? boxTokenHoldText(v.hold, v.holdNode) : 'held';
    case 'failed': return `failed (${v.lastFailure ?? 'unknown'})`;
  }
}

/** Plain http is said as unencrypted and still rotates (R2); `unmeasured` is never folded into https. */
export function boxTokenTransportText(t: BoxTokenView['fleetTransport']): string {
  if (t === null) return 'transport: no sync yet';
  if (t === 'unmeasured') return 'transport: not measured';
  return t === 'http' ? 'transport: http (unencrypted)' : 'transport: https';
}

const BOX_TOKEN_FLEET_TEXT: Record<BoxTokenView['fleetConfirmed'], string> = {
  current: 'confirmed the current generation',
  behind: 'behind (it holds an older generation)',
  absent: 'no generation recorded on the fleet box',
  unreadable: "the fleet box's generation file could not be read",
  'own-write': 'this box writes the fleet copy itself',
  unknown: 'not yet measured',
};

const BOX_TOKEN_ABSENT_TEXT = 'This server reports no box-token state.';
const BOX_TOKEN_UNREADABLE_TEXT = "Box-token state: not reported (the server's answer could not be read).";
const ROTATE_UNREADABLE_TEXT = "Asked — the server's answer could not be read; the card will re-check.";

function rotateAnswerText(a: RotateAnswer | 'unreadable'): string {
  if (a === 'unreadable') return ROTATE_UNREADABLE_TEXT;
  if (a.ok) return a.outcome === 'started' ? 'Rotation started.' : 'Joined the rotation already running.';
  if (a.error === 'held') return `Not started — ${boxTokenHoldText(a.hold, a.node)}`;
  if (a.error === 'rate-limited') return `At most one Rotate now a minute — try again in ${a.retryAfterS} s.`;
  return 'This server runs no box-token driver.';
}

function BoxTokenSection({ view, now, reload }: { view: UpdatesView; now: number; reload: () => void }): ReactNode {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const v = view.boxToken === undefined ? undefined : readBoxTokenView(view.boxToken);

  const rotate = (): void => {
    setBusy(true);
    setNote(null);
    void api.rotateBoxToken()
      .then((a) => setNote(rotateAnswerText(a)), (err: unknown) => toast(apiErrorText(err), 'error'))
      .finally(() => { setBusy(false); reload(); });
  };

  let body: ReactNode;
  if (v === undefined) body = <p className="settings-note">{BOX_TOKEN_ABSENT_TEXT}</p>;
  else if (v === null) body = <p className="settings-note">{BOX_TOKEN_UNREADABLE_TEXT}</p>;
  else {
    const lines: string[] = [`state: ${boxTokenStateText(v)}`];
    lines.push(v.currentSeq !== null && v.currentSince !== null && isPlaceableInstant(v.currentSince)
      ? `current value: generation #${v.currentSeq}, ${elapsedWords(now - v.currentSince)} old${v.origin === 'adopted' ? ' (hand-made, adopted)' : ''}`
      : 'current value: none');
    lines.push(v.lastRotationAt !== null && isPlaceableInstant(v.lastRotationAt)
      ? `last rotation: ${elapsedWords(now - v.lastRotationAt)} ago` : 'last rotation: never');
    if (v.rotationOwed) lines.push(`rotation owed: ${v.owedWhy ?? 'unspecified'}`);
    lines.push(`fleet: ${BOX_TOKEN_FLEET_TEXT[v.fleetConfirmed]}`);
    lines.push(boxTokenTransportText(v.fleetTransport));
    if (v.lastSync !== null) lines.push(`last sync: ${v.lastSync.word} · ${dayClock(v.lastSync.at, now)}`);
    lines.push(`previous still presented: ${v.previousPresented} · retired value presented: ${v.retiredPresented}`);
    // Spec 10.3's proof that the leak is retired, shown where the coordinator reads it (plan assembly).
    lines.push(`retired value refused: ${v.retiredRefused ? 'yes' : 'not yet'}`);
    if (v.lastBootRecovery !== null) {
      lines.push(`recovered at boot from the ${v.lastBootRecovery.source} file, ${dayClock(v.lastBootRecovery.at, now)}`);
    }
    if (v.fileProblem !== null) {
      lines.push(`server token file: ${v.fileProblem.file} ${v.fileProblem.word} on re-read (the last good value is kept), ${dayClock(v.fileProblem.at, now)}`);
    }
    // One alert: three failures, or a stall that no failure counts (a hold standing for a day, a failed mint). Wave 1's
    // doctor reports these as SKIP, which no exit code sees (plan assembly, review: the downside of the arms off).
    const alert = v.banner
      ? `Box-token rotation has failed ${v.failures} times in a row (last: ${v.lastFailure ?? 'unknown'}).`
      : v.stalled?.why === 'mint-failed'
        ? 'The server could not mint a box token; every box-token call is refused until a mint succeeds.'
        : v.stalled?.why === 'owed'
          ? `A box-token rotation has been owed for ${elapsedWords(now - v.stalled.since)} and has not completed${v.hold !== null ? ` (${boxTokenHoldText(v.hold, v.holdNode)})` : ''}.`
          : null;
    body = (
      <>
        {alert !== null && (
          <div className="settings-unarmed" role="alert">{alert}</div>
        )}
        {lines.map((l) => <p key={l} className="settings-note">{l}</p>)}
        <button type="button" className="btn-ghost settings-check" disabled={busy} onClick={rotate}>Rotate now</button>
        {note !== null && <p className="settings-note" aria-live="polite">{note}</p>}
      </>
    );
  }
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">Box token</h2>
      {body}
    </section>
  );
}
```

Why `failed (<word>)` and not `failed: <word>`: `single-definition.test.ts`'s "the self-wake prefixes are spelled once" scan (:4278-4280 at 282e79e44) pins any `'failed:'`/`` `failed: `` literal head to `server/src/coord/stall.ts` alone, and the prototype's first spelling, `` `failed: ${…}` ``, turned it red with this file as the second holder. The banner reuses `.settings-unarmed` (the screen's one red `role="alert"` style) and the button `.settings-section .settings-check` (its tap-target rule), so `fleet.css` gains nothing.

`:680-681`, old:

```tsx
      <UpdatesSection poll={poll} now={now} />
      <NotificationsSection view={poll.view} reload={poll.reload} />
```

new:

```tsx
      <UpdatesSection poll={poll} now={now} />
      {poll.view !== null && <BoxTokenSection view={poll.view} now={now} reload={poll.reload} />}
      <NotificationsSection view={poll.view} reload={poll.reload} />
```

(No view yet, no card: the Updates section above already says why — loading, `not-configured`, or a failed first read — and the card has nothing of its own to add to that.)

`README.md`, in the "Settings, the update banner and release pushes" paragraph, old (`:967`): `address. Settings has a second section, **Notifications**: the phone-push bell for this browser (the same` new:

```markdown
address. A **Box token** card follows, read from the same answer's `boxToken` field: the current value's
generation and age, the last rotation, the state (idle, rotating, grace, held with the server's reason,
failed with its word), whether a rotation is owed and why, the fleet's confirmed generation, its transport
(`http` said as unencrypted), the previous and retired values still presented, a boot recovery, a banner
after three failures in a row, and **Rotate now** (`POST /api/token/rotate`, session-only). Settings then has
a further section, **Notifications**: the phone-push bell for this browser (the same
```

(Outside both census passages `box-token-census.test.ts` slices, `'What is gated, and what is not:'`…`'Enrolling a passkey'` and `` '`/api/mail` (and its ack route)' ``…`'Minting the token file matters'`; measured 23 passed after it.)

- [ ] **Step 9: Run it to verify it passes**

```bash
mkdir -p .tmp-b6 && (cd pwa && TMPDIR="$PWD/../.tmp-b6" ./node_modules/.bin/vitest run test/box-token-card.test.tsx)
```

Expected: `Tests  45 passed (45)` (40 prototyped plus the five added at plan assembly).

- [ ] **Step 10: Mutation checks (PWA)**

(a) Delete the `...(raw.boxToken !== undefined ? { boxToken: … } : {}),` line in `pwa/src/fleet/useUpdatesView.ts`; Step 9's command: expected `Tests  1 failed | 39 passed (40)` ("survives asUpdatesView's rebuild"). Restore.
(b) In `readBoxTokenView`, replace `isWord(BOX_TOKEN_PHASES, v.phase)` with `typeof v.phase === "string"`; expected `Tests  1 failed | 39 passed (40)` ("a phase this build does not know reads as null"). Restore.
(c) After both restores, Step 9's command: `45 passed`.
(d) Plan assembly, not prototyped: replace `lines.push(\`retired value refused: ${v.retiredRefused ? 'yes' : 'not yet'}\`);` with nothing: expected red "renders age, …" and "before the first retirement …". Replace `: v.stalled?.why === 'mint-failed'` with `: false` and the `owed` arm likewise: expected red "a stalled rotation raises the alert …". Restore each.

- [ ] **Step 11: Re-run the pinned neighbours this task touches, one file per call, foreground**

```bash
mkdir -p .tmp-b6 && (cd pwa && TMPDIR="$PWD/../.tmp-b6" ./node_modules/.bin/vitest run test/settings-screen.test.tsx)     # 132 passed
mkdir -p .tmp-b6 && (cd pwa && TMPDIR="$PWD/../.tmp-b6" ./node_modules/.bin/vitest run test/use-updates-view.test.tsx)   # 38 passed
mkdir -p .tmp-b6 && (cd pwa && TMPDIR="$PWD/../.tmp-b6" ./node_modules/.bin/vitest run test/api.test.ts)                 # 102 passed
(cd pwa && ./node_modules/.bin/tsc --noEmit -p .)                                                     # no output
mkdir -p .tmp-b6 && (cd server && TMPDIR="$PWD/../.tmp-b6" ./node_modules/.bin/vitest run test/auth-gate.test.ts)        # 158 passed (update/routes.ts still 7 routes)
mkdir -p .tmp-b6 && (cd server && TMPDIR="$PWD/../.tmp-b6" ./node_modules/.bin/vitest run test/box-token-census.test.ts)   # 29 passed (Part A's A8 count; this task adds no case)
mkdir -p .tmp-b6 && (cd server && TMPDIR="$PWD/../.tmp-b6" ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit -p .)
rm -rf .tmp-b6
```

No census count moves in this task: `UPDATE_DOORS`, `SESSION_ONLY`, `UNGATED`, the 27 lanes, the EXEMPT reasons and `scanRoutes('update/routes.ts') === 7` are all unchanged (no route is added; `POST /api/token/rotate` and its `TOKEN_DOORS` entry are A8's). `single-definition.test.ts` must be fully green over Part A's merged `shared/box-token.ts`; if "one absent/unreadable read vocabulary" is red there, that is A1's `BoxTokenView.fleetConfirmed` spelling (A1 derives it from `ReadFailure`), not this task's.

- [ ] **Step 12: Commit**

```bash
git add shared/api.ts server/src/update/routes.ts server/test/update-routes.test.ts \
  pwa/src/lib/api.ts pwa/src/fleet/useUpdatesView.ts pwa/src/screens/SettingsScreen.tsx \
  pwa/test/box-token-card.test.tsx README.md
git commit -m "feat(pwa,server): the Box token card and Rotate now on /settings (box-token lifecycle B6, D-4392)

GET /api/updates carries the driver's view() as an optional boxToken field,
read at request time and omitted with no driver. The PWA reads it through one
reader, readBoxTokenView, checked against the L0 word lists, and renders the
server's own words: age, last rotation, state and hold, owed reason, fleet
confirmation, transport (http said as unencrypted), presented counts, boot
recovery, retired value refused, a re-read file finding, and one alert for
three failures or a stall. Rotate now posts the session-only rotate route;
its 409/429/501 refusals are said in place and a 2xx that will not parse is
'unreadable' (D-1150). asUpdatesView's rebuild keeps the field.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B7: deploy.sh stops shipping the token; notify.sh hardening; example and README

(prototype) measured: server/test/install-coordinator-skill.test.ts: red 1 failed | 15 passed (16) -> green 16 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/notify-addr.test.ts: red 6 failed | 18 passed (24) -> green 24 passed, 2026-10-07 on main 282e79e44
(prototype) measured: server/test/coord-token.test.ts: red 2 failed | 18 passed (20) after its notify pins, then red 1 failed | 20 passed (21) after the example pin (written second) -> green 21 passed, 2026-10-07 on main 282e79e44; written together, as Step 1 below has them, the red is 3 failed | 18 passed (21)
(prototype) measured, unchanged files re-run green over the edited deploy.sh, notify.sh, example, README and CLAUDE.md: server/test/box-token-census.test.ts 23 passed; server/test/crossrepo-prose.test.ts 17 passed; server/test/gitignore-secrets.test.ts 68 passed; server/test/deploy-env-guard.test.ts 27 passed; server/test/deploy-coordinates.test.ts 13 passed; server/test/usage-sweep-deploy-ship.test.ts 10 passed; server/test/auth-passkey.test.ts 154 passed (its curl-consumer scan still finds notify.sh's `/api/notify`), 2026-10-07 on main 282e79e44
(prototype note: notify-addr's no-token cases are measured against main's notify.sh, which still posts tokenless; with Part A merged the server answers that POST 401, but these cases record curl's argv and never reach a server, so their red and green are the same with or without Part A.)

**Files:**
- Modify: `deploy/deploy.sh:394-415` (the `ship_secret` comment and function, replaced by a note), `:591-598` (the agent rsync's exclude comment), `:619` (delete the agent-arm call), `:1213-1214` (the server rsync's exclude comment), `:1226` (delete the server-arm call); both `--exclude 'ccrc-mail.token' \` argument lines (`:616`, `:1223`) stay
- Modify: `deploy/notify.sh:1-13` (`set +x`, `umask 077`, the absent-token comment), `:89-96` (the guard and the unconditional config line)
- Modify: `deploy/ccrc-mail.token.example:1-23` (the comment; the placeholder line `:24` stays, last, with its newline)
- Modify: `README.md:521-548` (the install section's box-token bullet and hand-mint block), `:551-552` (the `~/.cc-secrets` side-effect sentence), `:773-775` (the remote-mode hand placement), `:3104-3107` (`ccrc-api`'s "ships the token"), `:3941-3949` (the mail-bus shipping lines), `:3971-3975` (the "Minting the token file matters" sentence, anchor phrase kept), `:5080-5081` (the deploy/ file tour)
- Modify: `CLAUDE.md:69-71` (the SAFETY bullet's "from one gitignored `deploy/ccrc-mail.token`"; CONTRACT ADDITION: the sentence is false once this task merges)
- Test: `server/test/install-coordinator-skill.test.ts:237-244`, `server/test/notify-addr.test.ts:133-143, 304-308, 339-346, 351-364, 369-403`, `server/test/coord-token.test.ts:129-135 (insert after), 151-164`
- Test (plan assembly, review finding): `server/test/token-boot.test.ts` (Task A7's file) — the derived-both arm of the mixed-version notify case. After D-4393 `notify.sh` sends nothing without a token, so the server never logs a refused notify; A7's `expect(warn…).toMatch(/notify/)` would go red here.

**Interfaces:**
- Consumes: A4's fail-shut `/api/notify` (`legacy` and `unconfigured` answer 401); A7's boot mint and both-role writer (the README now says the server mints and places the token); A9's driver and B1's `ccrc token sync` (the fleet copy arrives by the code path); B5's doctor `box-token` check (named by notify.sh's comment and the README); `PLACEHOLDER_TOKEN` and `MailTokenPlaceholderUnedited` (`server/src/coord/token.ts`, unchanged).
- Produces: no `ship_secret` anywhere in `deploy/deploy.sh`; both rsync excludes kept; `deploy/notify.sh` whose first two statements are `set +x` then `umask 077`, which exits 0 before curl when it extracted no token value (D-4393) and otherwise always sends the header line on stdin through `-K -`; an example whose comment says the server mints the value and no copy is needed, with the placeholder line unchanged; README and CLAUDE.md lines that no longer tell anyone to mint, copy or ship the token.

- [ ] **Step 1: Write the failing tests**

`server/test/token-boot.test.ts` (Task A7's mixed-version case), old:

```ts
      expect(seen).toEqual(accepted ? ['cc swap: x moved a -> b'] : []);
      if (!accepted) expect(warn.mock.calls.flat().join(' ')).toMatch(/notify/);
```

new:

```ts
      expect(seen).toEqual(accepted ? ['cc swap: x moved a -> b'] : []);
      // D-4393: with no fleet file notify.sh sends NOTHING, so no request reaches the server: it logs no refused
      // notify (every refusal there warns), and the loopback front recorded no refusal either (checked above).
      if (!accepted) expect(warn.mock.calls.flat().join(' ')).not.toMatch(/notify/);
```

Before the notify.sh edit this case is red on the derived arm (the tokenless POST still reaches the server and is refused with a warning); after it, green.

`server/test/install-coordinator-skill.test.ts:237-244`, old:

```ts
  // The three below are assertions about PR I's work, deliberately. The skill
  // is useless without the token, and a silently absent lane would surface as a
  // coordinator that cannot authenticate — a long way from here. They check
  // SHAPE and EXISTENCE only: no test in this repo reads a token, and a token
  // in a fixture is a token in a CI log.
  it('the agent arm ships the fleet host’s copy of the box token', () => {
    expect(agentArm).toContain("ship_secret ccrc-mail.token '~/.cc-secrets' ccrc-mail.token");
  });
```

new:

```ts
  // The three below are assertions about PR I's token lane, deliberately. They
  // check SHAPE and EXISTENCE only: no test in this repo reads a token, and a
  // token in a fixture is a token in a CI log.
  //
  // Box-token lifecycle wave 1 (spec 4.9): deploy.sh no longer ships the token
  // at all. The server mints its own at boot and hands the fleet box its copy
  // over the agent link, so after the first rotation the gitignored
  // `deploy/ccrc-mail.token` holds the retired value, and shipping it would put
  // the leaked value back on both boxes. The pin that the agent arm ships it is
  // flipped to ABSENCE, over the whole file: the function and both of its calls.
  // The rsync excludes stay, so a stale source file left in a checkout never
  // rides `deploy/` to either box.
  it('deploy.sh ships no box token: no ship_secret function and no call, in either arm', () => {
    expect(deploy, 'deploy.sh still ships the box token').not.toMatch(/\bship_secret\b/);
    // The two rsync argument lines (one per arm), not the comment that explains them.
    expect(deploy.match(/^\s+--exclude 'ccrc-mail\.token' \\$/gm) ?? [],
      'an rsync lost its token exclude: a stale source file would ride deploy/ to the box').toHaveLength(2);
  });
```

(The exclude count is anchored on the argument lines: a plain substring count reads 3 at 282e79e44, because the agent arm's comment quotes the flag.)

`server/test/notify-addr.test.ts`, `runNotify` (`:133-143`), old:

```ts
function runNotify(home: string, extraEnv: NodeJS.ProcessEnv = {}, input?: string): SpawnSyncReturns<string> {
  const bin = stubBinDir(home);
  for (const name of REAL_TOOLS) {
    if (!existsSync(path.join(bin, name))) symlinkSync(realPath(name), path.join(bin, name));
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
```

new:

```ts
function runNotify(home: string, extraEnv: NodeJS.ProcessEnv = {}, input?: string): SpawnSyncReturns<string> {
  const bin = stubBinDir(home);
  // `head` reads the token's value line (the R16 cases below plant it themselves).
  for (const name of [...REAL_TOOLS, 'head']) {
    if (!existsSync(path.join(bin, name))) symlinkSync(realPath(name), path.join(bin, name));
  }
  // D-4393: notify.sh posts nothing without a token, so an address case that
  // names no token file gets a fixture one at the default fleet path. A case
  // that passes `CCRC_MAIL_TOKEN_FILE` (even an absent one) gets exactly that.
  if (!('CCRC_MAIL_TOKEN_FILE' in extraEnv)) {
    mkdirSync(path.join(home, '.cc-secrets'), { recursive: true });
    const p = path.join(home, '.cc-secrets', 'ccrc-mail.token');
    if (!existsSync(p)) writeFileSync(p, `${'y'.repeat(64)}\n`, { mode: 0o600 });
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
```

(`recordingCurl` symlinks `head` itself before `runNotify` runs, so the `existsSync` guard keeps the two from colliding; the front test at `:390` links its own and never calls `runNotify`.)

The R16 describe's header comment (`:307-308`): replace `takes \`head\`, which the address cases above never reach.` with `takes \`head\`, which \`runNotify\` now links for every case (D-4393).`

Replace the no-token case (`:339-346`) with:

```ts
  // D-4393: with `/api/notify`'s `legacy` and `unconfigured` tolerance gone
  // (box-token lifecycle Part A), a tokenless POST is a guaranteed 401 that the
  // curl's `|| true` swallows. So the hook sends nothing at all and exits 0, as it
  // does with no address: notify is best-effort, and the missing token file is
  // what doctor's fleet arm reports. Three ways to have no value, one answer.
  it.each([
    ['the token file is absent', null],
    ['the token file is all preamble', '# only a comment\n\n'],
    ['the token file is empty', ''],
  ])('with no token (%s): curl never runs, and the hook exits 0 (D-4393)', (_w, content) => {
    const home = mkTmp('ccrc-notify-notok-');
    recordingCurl(home);
    const f = path.join(home, 'no-value.token');
    if (content !== null) writeFileSync(f, content, { mode: 0o600 });
    const r = runNotify(home, { CCRC_ADDR: 'http://127.0.0.1:9', CCRC_MAIL_TOKEN_FILE: f });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(path.join(home, 'curl.argv')), 'a tokenless notify still dialled the server').toBe(false);
  });

  // `set +x` FIRST (spec 4.9): an inherited xtrace (`bash -x`, or an exported
  // SHELLOPTS=xtrace) would trace the token read and the printf line to stderr.
  // ccd discards this hook's stderr today, but a hand run or a future caller
  // would not, and the other three clients already carry the line.
  it('an inherited xtrace prints no token: SHELLOPTS=xtrace leaves stderr clean, and the call still goes out', () => {
    const home = mkTmp('ccrc-notify-xtrace-');
    recordingCurl(home);
    const r = runNotify(home, {
      CCRC_ADDR: 'http://127.0.0.1:9', CCRC_MAIL_TOKEN_FILE: tokenFile(home), SHELLOPTS: 'xtrace',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr, 'an inherited xtrace printed the token').not.toContain(TOKEN);
    expect(fed(home)).toBe(CONFIG);
  });
```

In the stdin `it.each` (`:351-364`), old (`:363`):

```ts
    expect(fed(home), 'curl was handed the hook\'s stdin as config').toBe(withToken ? CONFIG : '');
```

new:

```ts
    if (withToken) expect(fed(home), 'curl was handed the hook\'s stdin as config').toBe(CONFIG);
    else expect(existsSync(path.join(home, 'curl.stdin')), 'a tokenless notify still ran curl (D-4393)').toBe(false);
```

In the loopback-front `it.each` (`:369-403`): its title becomes `'%s, through the loopback curl front to a listener: with a token the body and header arrive, with none nothing does (D-4393)'`, and `:403`, old `expect(got).toEqual([{ auth: withToken ? TOKEN : undefined, body: '{"message":"test message"}' }]);` new:

```ts
      expect(got).toEqual(withToken ? [{ auth: TOKEN, body: '{"message":"test message"}' }] : []);
```

`server/test/coord-token.test.ts`, after the "the placeholder constant IS the example file's one value line" case (`:129-135`) add:

```ts
  it('the example no longer tells anyone to copy it: the server mints the value (spec 4.9)', () => {
    // The file stays for its placeholder line (the refusal above is pinned to
    // it); its comment used to say "Copy to deploy/ccrc-mail.token … and
    // deploy.sh ships it to BOTH boxes", which after the first rotation would
    // put the retired value back.
    const comment = EXAMPLE.split(/\r?\n/).filter((l) => l.trim().startsWith('#')).join('\n');
    expect(comment).toContain('You do not need a copy of this file.');
    expect(comment).toContain('The server mints the box token itself');
    expect(comment, 'the example still tells the operator to copy and ship it').not.toMatch(/Copy to|ships it to/);
  });
```

and replace the notify.sh pin (`:151-164`) with:

```ts
  it('sends nothing without a token, and the header on every POST it does send (D-4393)', () => {
    // Fix-round finding 4(c) named the header line as a mutant no suite saw
    // while the server accepted a tokenless POST as `legacy`. Box-token
    // lifecycle Part A removed that tolerance, so a tokenless POST is now a
    // guaranteed 401: the hook exits before the curl instead (D-4393), and the
    // header line no longer needs its own `[ -n "$tok" ]` guard.
    //
    // R16 (centralised-update wave 13): the header rides curl's STDIN as a
    // `-K -` config line, never argv, so the pin is on the guard, the config
    // line and the `-K -` beside the curl it feeds. `notify-addr.test.ts` RUNS
    // the script and pins the same thing by what curl was handed.
    expect(notifySh).toContain('[ -n "$tok" ] || exit 0\n'
      + `printf 'header = "x-ccrc-mail-token: %s"\\n' "$tok" |\n`
      + 'curl -fsS -m 5 -X POST "$BASE/api/notify" -K - \\\n');
    expect(notifySh, 'the token is back on curl\'s argv').not.toMatch(/-H\s+"x-ccrc-mail-token/);
  });

  it('starts with set +x, then umask 077, before any other statement (spec 4.9)', () => {
    // The first two lines of code after the shebang and before the first
    // comment, the shape ccd-pool-sync and ccd-update-sync carry: a token
    // client whose xtrace could be inherited turns it off before it reads one.
    const code = notifySh.split('\n').slice(1).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    expect(code.slice(0, 2).map((l) => l.replace(/\s+#.*$/, ''))).toEqual(['set +x', 'umask 077']);
  });
```

The extraction-agreement describe below it (slice from `TOKEN_FILE=` to `ADDR="${CCRC_ADDR:-}"`) is untouched: the new guard sits after the address block, outside that slice, precisely so the slice still runs on its own (its own comment records the D-199 trap of an `exit` inside it).

- [ ] **Step 2: Run them to verify they fail (one file per call, foreground)**

```bash
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/install-coordinator-skill.test.ts)
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/notify-addr.test.ts)
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/coord-token.test.ts)
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/token-boot.test.ts)
```

Expected:
- token-boot (plan assembly, not prototyped): exactly one failure, `× derived both: no fleet file, so notify.sh is refused`.
- install-coordinator-skill: `Tests  1 failed | 15 passed (16)` — `deploy.sh still ships the box token`.
- notify-addr: `Tests  6 failed | 18 passed (24)` — the three "with no token (…)" cases, the xtrace case, and the no-token arms of the stdin and loopback-front cases. The address cases stay green because `runNotify` now plants a token.
- coord-token: `Tests  3 failed | 18 passed (21)` — the guard pin, the `set +x`/`umask 077` pin, the example-comment pin.

- [ ] **Step 3: Write the minimal implementation**

`deploy/deploy.sh:394-415`, delete the comment block that opens `# One local, gitignored token file -> BOTH boxes, …` through the end of `ship_secret() { … }`, and put in its place:

```bash
# THE BOX TOKEN IS NOT SHIPPED (box-token lifecycle wave 1, spec 4.9). The
# server mints `~/.ccrc/mail.token` at boot and rotates it, and hands the fleet
# box its copy at `~/.cc-secrets/ccrc-mail.token` over the agent link (`ccrc
# token sync`). A gitignored `deploy/ccrc-mail.token` left in a checkout holds
# the hand-made value the first rotation retired: copying it to either box
# would put that value back, which the server now refuses at boot by its
# retired digest. Both rsyncs below still exclude the file, so it never rides
# `deploy/` to a box either.
```

`:591-598`, old:

```bash
  # `--exclude 'ccrc-mail.token'`: the token lives at `deploy/ccrc-mail.token`
  # (gitignored) exactly when `ship_secret` below is about to fire, and this
  # rsync ships the whole `deploy/` directory. `--exclude '*.env'` is here for
  # the identical reason on `ship_env`'s secrets — without a matching
  # exclude, `-a` would carry the file over at whatever mode it has on THIS
  # machine (0644 under a plain umask), a second, unmanaged copy sitting
  # right next to the one `ship_secret` deliberately lands at 0600 under a
  # 0700 directory three lines down, re-shipped on every `--delete` run.
```

new:

```bash
  # `--exclude 'ccrc-mail.token'`: a checkout may still hold a gitignored
  # `deploy/ccrc-mail.token` (the hand-made value, retired by the first
  # rotation; "THE BOX TOKEN IS NOT SHIPPED", above), and this rsync ships the
  # whole `deploy/` directory.
  # `--exclude '*.env'` is here for `ship_env`'s secrets — without a matching
  # exclude, `-a` would carry the file over at whatever mode it has on THIS
  # machine (0644 under a plain umask), a second, unmanaged copy beside the one
  # `ship_env` lands, re-shipped on every `--delete` run.
```

(Neither comment may spell the skill directory with a trailing slash: `install-coordinator-skill.test.ts` finds its rsync by the first line carrying that spelling, as the comment right below says.)

`:619`, delete the line `  ship_secret ccrc-mail.token '~/.cc-secrets' ccrc-mail.token` (the `ship_env ccrc-agent.env .ccrc/agent.env` line above it stays).

`:1213-1214`, old:

```bash
  # ships `deploy/` whole, and without the exclude the token rides along a
  # second time, unhardened, next to `ship_secret`'s 0600 copy three lines down.
```

new:

```bash
  # ships `deploy/` whole, and without the exclude a stale, retired token left
  # in the checkout would ride along to the box, unhardened.
```

`:1226`, delete the line `  ship_secret ccrc-mail.token '~/.ccrc' mail.token` (the `ship_env ccrc.env .ccrc/ccrc.env` line above it stays). Then `bash -n deploy/deploy.sh` prints nothing.

`deploy/notify.sh:1-13`, old:

```bash
#!/usr/bin/env bash
# ccd swap hook -> ccrc. $1 = human-readable message.
#
# The token authenticates THE BOX, which is the honest unit: every fleet session
# runs as one UNIX user and can read this file, so it proves "a process on the
# fleet host", never "this session" (spec:26-30, and the spec's own sentence
# about freshness rather than forgery-proofness). It closes the tailnet, not
# the box.
#
# An ABSENT token still sends: the server tolerates it for one deploy
# generation so a hook shipped before the token cannot go dark. Do not make
# this hard-fail — that turns a rollout ordering detail into a silent loss of
# every swap notice.
```

new:

```bash
#!/usr/bin/env bash
set +x   # FIRST LINE OF CODE, and it is a SECRETS control — the box token below.
umask 077
# ccd swap hook -> ccrc. $1 = human-readable message.
#
# The token authenticates THE BOX, which is the honest unit: every fleet session
# runs as one UNIX user and can read this file, so it proves "a process on the
# fleet host", never "this session" (spec:26-30, and the spec's own sentence
# about freshness rather than forgery-proofness). It closes the tailnet, not
# the box.
#
# An ABSENT token sends NOTHING and exits 0 (D-4393), exactly as an absent
# address does below. The server no longer accepts a tokenless `/api/notify`
# (box-token lifecycle Part A removed the one-deploy `legacy` tolerance), so a
# POST without the header is a guaranteed 401 that the curl's `|| true` would
# swallow. Still never a hard failure: ccd runs this hook `>/dev/null 2>&1`, and
# a nonzero exit would make an unprovisioned box look like a broken one. The
# missing file is what `ccrc doctor`'s `box-token` check reports.
```

`:92-96`, old:

```bash
# ccd-update-sync ship. The header is still sent only for a non-empty token: an
# absent one leaves the config empty, so the POST goes out without it (the
# tolerance above). curl's stdin is always this pipe, never the stdin ccd hands
# the hook.
{ [ -n "$tok" ] && printf 'header = "x-ccrc-mail-token: %s"\n' "$tok"; } |
```

new:

```bash
# ccd-update-sync ship. No token, no POST (D-4393, the header note above): the
# guard sits here, after the address, so the token-extraction lines above stay
# one slice `coord-token.test.ts` can run on their own. curl's stdin is always
# this pipe, never the stdin ccd hands the hook.
[ -n "$tok" ] || exit 0
printf 'header = "x-ccrc-mail-token: %s"\n' "$tok" |
```

The `curl -fsS -m 5 -X POST "$BASE/api/notify" -K - \` line and the two after it are unchanged. `bash -n deploy/notify.sh` prints nothing. (No macOS-portability scan covers `deploy/`; the edit adds no `timeout`, `stat -c`, `mv -T`, bare `mktemp` or GNU `date` anyway.)

`deploy/ccrc-mail.token.example`, replace lines 1-23 (the whole comment) so the file reads, in full:

```
# The box token's placeholder. You do not need a copy of this file.
#
# The server mints the box token itself at its first boot (`~/.ccrc/mail.token`,
# mode 0600) and rotates it. On a two-box fleet it hands the fleet box its copy
# (`~/.cc-secrets/ccrc-mail.token`) over the agent link (`ccrc token sync`); on
# a single box recorded as `CCRC_ROLE=both` it writes that copy itself.
# `deploy.sh` ships no token, and a hand-made value found at boot is adopted
# once and retired by the first rotation. Never copy either file by hand, and
# check them with `ls -l`, never `cat`.
#
# This file stays because its one value line below is the placeholder the
# server refuses BY NAME: a token file whose value is that line throws
# `MailTokenPlaceholderUnedited` at boot, because the line is committed to this
# public repo and authenticates nobody.
#
# The token authenticates THE BOX, not a session: every fleet session runs as
# one UNIX user and can read the file. Per-session identity is attribution
# (`{fromId, fromUuid}` checked against the registry), and the spec says so.
#
# Every reader (coord/token.ts, notify.sh, ccrc-api and the two sync timers)
# takes the first line that is neither blank nor a `#`-comment as THE TOKEN,
# whitespace stripped from it everywhere. A present file with no such line is
# refused at boot rather than read as "unconfigured" (fix-round finding 4):
# "no token" and "an empty one" are different mistakes and must not read the
# same.
REPLACE-THIS-LINE-WITH-THE-OUTPUT-OF-openssl-rand--hex-32
```

The value line is byte-identical and still last with its trailing newline, so `coord-token.test.ts`'s `EXAMPLE.split('\n').slice(0, -2)` fixture, `PLACEHOLDER_TOKEN`'s tie to the file, and `gitignore-secrets.test.ts`'s tracked/not-ignored pins keep their anchor.

`README.md:521-548`, old (from `**What the install does not place.**` through the closing fence of the bash block, which ends with `systemctl --user restart ccrc.service                     # the server reads the token once, at boot`):

````markdown
**What the install does not place.** Coordination — runs, mail, claims, asks, and a fleet box's pool
and update pulls — needs three things the install leaves to you, once per box; without them the
console still drives sessions, but the box-token routes answer `401` and the clients refuse before
they call:

- **The box token**, one shared secret: `~/.ccrc/mail.token` for the server (`CCRC_MAIL_TOKEN_PATH`
  overrides) and the same value at `~/.cc-secrets/ccrc-mail.token` for the fleet side — both files
  on a single box, one on each of two. Only `deploy.sh`'s secret lane ships it. What the server does
  without it: "The mail bus and its token", under "Fleet coordination" below.
- **`CCRC_SERVER_URL`** … (unchanged bullet)
- **`~/.local/bin/ccrc-api`**, … (unchanged bullet)

The block below is the single-box form: it mints the token on this box and puts it at both paths. On
two boxes mint the value once (`openssl rand -hex 32`) and place that same value at
`~/.ccrc/mail.token` on the server box and at `~/.cc-secrets/ccrc-mail.token` on the fleet box;
minted separately the two disagree and every box-token call answers `401` (`wrong box token`).

```bash
( umask 077; mkdir -p ~/.cc-secrets
  openssl rand -hex 32 > ~/.ccrc/mail.token            # never print it: ls -l, not cat
  cp ~/.ccrc/mail.token ~/.cc-secrets/ccrc-mail.token  # two boxes: this value, at this path, on the fleet box
  # single box only (a fleet box's install wrote its agent.env):
  [ -e ~/.ccrc/agent.env ] || echo 'CCRC_SERVER_URL=http://127.0.0.1:7788' > ~/.ccrc/agent.env )
ln -sfn ~/ccrc/ccd/ccrc-api ~/.local/bin/ccrc-api        # on the box the sessions run on; a link follows every update
systemctl --user restart ccrc.service                     # the server reads the token once, at boot
```
````

new (the two unchanged bullets kept verbatim):

````markdown
**What the install does not place.** Coordination — runs, mail, claims, asks, and a fleet box's pool
and update pulls — needs two things the install leaves to you, once per box; without them the
console still drives sessions, but the clients refuse before they call:

- **`CCRC_SERVER_URL`** … (unchanged bullet)
- **`~/.local/bin/ccrc-api`**, … (unchanged bullet)

**The box token needs nothing from you.** The server mints `~/.ccrc/mail.token` (mode `0600`;
`CCRC_MAIL_TOKEN_PATH` moves it) at its first boot and rotates it. On two boxes it hands the fleet
box its copy at `~/.cc-secrets/ccrc-mail.token` over the agent link (`ccrc token sync`, run by the
agent); on a single box whose role is recorded as `CCRC_ROLE=both` in `~/.ccrc/ccrc.env` it writes
that copy itself. Never mint, copy or edit either file by hand: a value found at boot is adopted
once and retired by the first rotation. Check them with `ls -l`, never `cat`; `ccrc doctor`'s
`box-token` check and the console's Settings card report both. What the server does when a mint
fails: "The mail bus and its token", under "Fleet coordination" below.

The block below is the single-box form of the two steps:

```bash
# single box only (a fleet box's install wrote its agent.env):
( umask 077; [ -e ~/.ccrc/agent.env ] || echo 'CCRC_SERVER_URL=http://127.0.0.1:7788' > ~/.ccrc/agent.env )
ln -sfn ~/ccrc/ccd/ccrc-api ~/.local/bin/ccrc-api        # on the box the sessions run on; a link follows every update
```
````

This block is true under D-4399 (Part A arms a recorded `both` box whose `agent.env` carries `CCRC_SERVER_URL` only; `token-boot.test.ts` pins it). If the operator rules that marker's alternative instead, this block changes with it: it stops writing `agent.env`, and the paragraph above names the both box's other address source.

`:551-552`, old:

```markdown
Creating `~/.cc-secrets` has one side effect on `ccrc doctor`: its `credentials` check SKIPs while
that directory is absent, and once it exists FAILs for the seeded account — the roster marks it
```

new:

```markdown
`~/.cc-secrets` has one side effect on `ccrc doctor`: its `credentials` check SKIPs while that
directory is absent, and once it exists (the box token's first write creates it) FAILs for the
seeded account — the roster marks it
```

`:773-775`, old:

```markdown
`~/.ccrc/agent.env` and restart `ccrc-agent.service` ("Config", under "Remote fleet mode", below), and place
the box token and `ccrc-api` by hand as "What the install does not place" (under "Install", above) shows — the
token is the SAME value on both boxes. Finally set `CCRC_FLEET=remote`,
```

new:

```markdown
`~/.ccrc/agent.env` and restart `ccrc-agent.service` ("Config", under "Remote fleet mode", below), and place
`ccrc-api` by hand as "What the install does not place" (under "Install", above) shows; the box token
needs no hand step, because the server hands the fleet box its copy over the agent link once the link is up.
Finally set `CCRC_FLEET=remote`,
```

`:3104-3107`, old:

```markdown
`deploy/deploy.sh`'s agent arm installs it beside `ccd` and ships the token
when `deploy/ccrc-mail.token` exists; `ccrc install` and `ccrc update` place
neither. On a box placed by the release lane, neither is there until you place
them ("What the install does not place", under Install).
```

new:

```markdown
`deploy/deploy.sh`'s agent arm installs it beside `ccd`; `ccrc install` and
`ccrc update` do not, so on a box placed by the release lane it is not there
until you place it ("What the install does not place", under Install). The
token it reads is the server's to place: minted at boot, handed to the fleet
box over the agent link, never shipped by `deploy.sh`.
```

`:3941-3949`, old:

```markdown
(`CCRC_MAIL_TOKEN_PATH` moves the file; it never carries the value); both are
shipped from one locally-gitignored `deploy/ccrc-mail.token`
(`openssl rand -hex 32` to mint it, or
`cp deploy/ccrc-mail.token.example deploy/ccrc-mail.token && edit`) by
`deploy/deploy.sh`'s secret-shipping lane. `ccrc install` and `ccrc update`
write neither file: on a box placed by the release lane, place the secret by
hand — the server path on the server box, the fleet path on the fleet host,
both on a single box — mode `0600`, as "What the install does not place"
(under "Install", above) shows, and check it with `ls -l`, never `cat`.
```

new:

```markdown
(`CCRC_MAIL_TOKEN_PATH` moves the file; it never carries the value). The
server mints its file at boot and rotates it, and writes the fleet copy too:
over the agent link in remote fleet mode (`ccrc token sync`), itself on a
single box recorded as `CCRC_ROLE=both`. Nothing ships it: `deploy/deploy.sh`
no longer copies a gitignored `deploy/ccrc-mail.token` to either box, and
`ccrc install` and `ccrc update` place neither file, as "What the install does
not place" (under "Install", above) says. Check both with `ls -l`, never `cat`.
```

(This sits inside the mail-bus passage `box-token-census.test.ts` slices and bans numerals in ("the mail-bus paragraph grew a hand-kept count again"). The prototype's first wording, "over the agent link on two boxes", went red there on `two`; "in remote fleet mode" is the measured-green spelling. `single` passes.)

`:3971-3975`, old:

```markdown
**Minting the token file matters as much as having one:**
`deploy/ccrc-mail.token.example`'s own placeholder value line
must actually be replaced — copying the example verbatim is refused loudly
at server boot (`MailTokenPlaceholderUnedited`), not silently accepted,
because that exact placeholder is committed to this public repo.
```

new (the phrase `Minting the token file matters` is KEPT: it is the end anchor of the mail-bus passage in both `box-token-census.test.ts` and `crossrepo-prose.test.ts`):

```markdown
**Minting the token file matters as much as having one,** which is why the
server does it. A hand-made value it finds at boot is adopted once and retired
by the first rotation, and a retired value written back (an older checkout's
`deploy.sh` copying a stale `deploy/ccrc-mail.token`) is never adopted again.
`deploy/ccrc-mail.token.example` stays only for its placeholder value line: a
token file holding that line is refused loudly at server boot
(`MailTokenPlaceholderUnedited`), not silently accepted, because that exact
placeholder is committed to this public repo.
```

`:5080-5081`, old:

```markdown
  `ccrc-mail.token.example` (the box token's placeholder, copied the same way
  to `deploy/ccrc-mail.token`), `ccclip.env.example` (the Mac helper's config,
```

new:

```markdown
  `ccrc-mail.token.example` (the box token's placeholder, which the server
  refuses at boot by name; never copied, because the server mints the token),
  `ccclip.env.example` (the Mac helper's config,
```

`CLAUDE.md:69-71`, old:

```markdown
- **NEVER print secret file CONTENTS.** The box/mail token is one shared secret per box
  (`~/.cc-secrets/ccrc-mail.token` on fleet host, `~/.ccrc/mail.token` on server), from one gitignored
  `deploy/ccrc-mail.token`. Existence checks by `ls` only. The committed `.example` placeholder is refused at boot
```

new:

```markdown
- **NEVER print secret file CONTENTS.** The box/mail token is one shared secret per box
  (`~/.cc-secrets/ccrc-mail.token` on fleet host, `~/.ccrc/mail.token` on server), minted and rotated by
  the server, never shipped by `deploy.sh`. Existence checks by `ls` only. The committed `.example` placeholder is refused at boot
```

(Part A's README edits (D-4396, the notify-tolerance sentences between these two README hunks) and A8's CLAUDE.md coordination sentence are already merged when this runs; every anchor above is quoted text, not a line number, so match by text.)

- [ ] **Step 4: Run them to verify they pass**

```bash
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/install-coordinator-skill.test.ts)   # 16 passed
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/notify-addr.test.ts)                 # 24 passed
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/coord-token.test.ts)                 # 21 passed at 282e79e44 (Part A's A3 adds cases to this file; the count rises, all green)
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/token-boot.test.ts)                  # all green (A7's count)
```

- [ ] **Step 5: Mutation checks**

(a) Delete `[ -n "$tok" ] || exit 0` from `deploy/notify.sh`; notify-addr: expected `Tests  5 failed | 19 passed (24)` (the three no-token cases and both no-token arms); token-boot: expected `× derived both: no fleet file, so notify.sh is refused` red too. Restore.
(b) Delete the `set +x` line (line 2) from `deploy/notify.sh`; notify-addr: expected `Tests  1 failed | 23 passed (24)` ("an inherited xtrace prints no token"). Restore. (coord-token's `set +x, then umask 077` pin also goes red on this mutant.)
(c) Put `  ship_secret ccrc-mail.token '~/.ccrc' mail.token` back after `  ship_env ccrc.env .ccrc/ccrc.env`; install-coordinator-skill: expected `Tests  1 failed | 15 passed (16)`. Restore.
(d) After all three restores, Step 4's three commands are green again; `grep -c ship_secret deploy/deploy.sh` prints `0`.

- [ ] **Step 6: Re-run the pinned neighbours this task's text touches, one file per call, foreground**

```bash
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/box-token-census.test.ts)     # README mail-bus passage: anchor kept, no numeral
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts)      # 17 passed at 282e79e44
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/gitignore-secrets.test.ts)    # 68 passed
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/deploy-env-guard.test.ts)     # 27 passed
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/deploy-coordinates.test.ts)   # 13 passed
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/usage-sweep-deploy-ship.test.ts)   # 10 passed
mkdir -p .tmp-b7 && (cd server && TMPDIR="$PWD/../.tmp-b7" ./node_modules/.bin/vitest run test/auth-passkey.test.ts)         # 154 passed (curl-consumer scan still sees notify.sh's /api/notify)
rm -rf .tmp-b7
```

No census count moves in this task. Pins moved, all in Step 1: `install-coordinator-skill.test.ts`'s "ships the fleet host's copy" (flipped to absence plus the two exclude lines), `coord-token.test.ts`'s notify.sh guard-line pin (new text) plus two new pins (the first two statements; the example comment), and `notify-addr.test.ts`'s `runNotify` (a default token) and its four no-token assertions (now: no curl at all) plus one new xtrace case.

- [ ] **Step 7: Commit**

```bash
git add deploy/deploy.sh deploy/notify.sh deploy/ccrc-mail.token.example README.md CLAUDE.md \
  server/test/install-coordinator-skill.test.ts server/test/notify-addr.test.ts server/test/coord-token.test.ts \
  server/test/token-boot.test.ts
git commit -m "chore(deploy): deploy.sh stops shipping the box token; notify.sh set +x and no tokenless POST (box-token lifecycle B7, D-4393)

ship_secret and both of its calls are gone (the rsync excludes stay): after the
first rotation the gitignored deploy/ccrc-mail.token holds the retired value,
and the server now mints and hands out its own. notify.sh turns xtrace off and
sets umask 077 first, and exits 0 before curl when it has no token value,
since Part A answers a tokenless /api/notify 401 (D-4393). The example's
comment says the server mints the token and no copy is needed (its
placeholder line, which boot refuses by name, is unchanged); the README and
CLAUDE.md lines that taught minting, copying and shipping it are rewritten.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Design

**Posture:** none

Server-side minting, staging and rotation. The Settings screen is named as a reader of the result.

Declared retrospectively: this plan shipped before the posture convention
reached its programme (`server/test/design-declaration.test.ts`). The guard
asks that the question be answered, never which answer is given.
