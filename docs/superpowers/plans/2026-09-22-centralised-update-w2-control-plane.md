# Centralised update management — W2: the control plane, read-only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `coord.db` learns the release catalogue, a node inventory re-measured every minute, and a desired-state intent per scope; the server resolves each node's desired tag, writes its own `~/.ccrc/update-intent` projection, and serves `GET /api/updates`, `POST /api/updates/{intent,refresh,ack}` and the projection read `GET /api/updates/intent/:nodeId` — and nothing in this wave moves a node.

**Architecture:** One migration (`MIGRATIONS[13]`) adds five tables whose columns are split into named writer groups, each group written by exactly one `CoordStore` method family and pinned by a scan over `store.ts`'s SQL. Three sweeps feed them from `FleetWatcher.tick()` on the file's own sub-cadence idiom: the catalogue poller (`update/catalogue.ts`, a GitHub listing every 30 minutes), the inventory sweep (`update/inventory.ts`, seven `~/.ccrc` files per node every 60 seconds, each read lstat-gated, size-capped and validated — the fleet node's through a new exact-basename read set on the agent), and after each sweep the pure resolver (`update/resolve.ts`, L1) whose answer `update/project.ts` stores and renders into the server's own projection file. The routes (`update/routes.ts`) are session-only writes plus one dual-credential read, censused by all three route scanners; `FleetHealth.builds` becomes a view derived from the inventory rows, so an older PWA keeps its answer.

**Tech Stack:** TypeScript on node `>=22.13.0` (`node:sqlite` `DatabaseSync`, synchronous, under `tx()`); Fastify 5; the global `fetch` with an `AbortController` deadline (no new dependency); vitest in `server/`, `agent/`; a loopback `node:http` fixture standing in for GitHub; one embedded `python3` validator and one `bash` run of `ccd/ccrc`'s `_ver_newer` plus `sort -V` inside tests.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` — §2 decisions 2, 5, 6, 7, 11, 13, 15, 16; §6; §7; §8 (incl. the read allowlist and validation); §9 (resolution, the projection's ROUTE and the SERVER-ROLE writer only); §12 (the W2 rows, the census); §14 first bullet; §15 row W2; §18 rows "one writer per column group", "vocabularies are declared once", "every `UpdateState` classified once", "`unknown` is busy", "a refusing write never returns void", "the ring scan covers `update/`", "the read allowlist is exact basenames", "reads refuse a non-regular file", "reads are bounded and validated", "a yanked release is kept", "notes are capped and plain" (the cap), "errors never move `lastOkAt`", "`refresh` is rate-limited", "`stampRead` keeps EACCES from unversioned", "a full `BuildInfo` round-trips", "measurement is a sweep", "the phase table is applied", "a stale report never moves the lease", "a label row re-keys", "a superseded row is invisible", "unreachable is written on the sweep it happens", "a provenance failure refuses the release FOR THAT NODE", "`ack` clears the node's refusals and its request", "the resolver skips unlisted/yanked/refused-by-this-node", "the resolver never goes below the floor, pinned or not", "a NULL floor is unconstrained", "the two floor sentences", "a pinned ineligible tag resolves NULL", "an unknown channel token resolves nothing", "the projection is seconds", "the projection carries both desireds", "six session doors, one dual-credential read" (the four W2 registers — wave 5 appends `apply` and `rollback`), "no write route takes the box token", "the projection read takes the box token".

**Out of scope, said once:** no node moves — no `dispatchNode`/`requestNode`, no `update` agent op, no agent SENDING `ops` (W2 ships the field's type and the server's one reader), no `apply`/`rollback` routes, no `markReleaseNotified`/notifier/push (W3), no PWA change (W3), no edit to `ccd/ccrc` or `ccd/ccd`, no `ccd-update-sync`, no doctor check, no systemd unit; `deploy/deploy.sh` and `deploy/build-release.sh` untouched.

## Global Constraints

- **The canonical form of a version is the tag** (`vX.Y.Z`, the one guard `isReleaseTag`) in every column (`releases.tag`/`version`, `nodes.currentVersion`/`highestVersion`/`previousVersion`/`reportedTarget`/`updateTarget`/`desiredTag`, `update_intent.pinnedTag`), every message and every comparison; the `v` is stripped only inside `shared/semver.ts`'s comparator (decision 2).
- **No node moves in this wave** — nothing written in W2 acquires a lease, so outside fixtures that plant a busy row every `nodes.updateState` stays `idle`; the sweep's release/settle arms ship and are pinned on fixtures, for W4's dispatcher to reach.
- **The exec surface is untouched** — `EXEC_COMMANDS`, `FORBIDDEN_COMMANDS`, `EXEC_WHITELIST` in `agent/src/whitelist.ts`; the only agent-side change is a READ-mode admission and an optional field's type.
- **L0 `shared/*.ts` imports nothing at runtime**; `shared/api.ts` keeps exactly its three `import type` lines (`peers-claims-l0.test.ts:157-167`) — add none; `shared/semver.ts` imports nothing at all. Every W2 addition to `shared/api.ts` lives in ONE end-of-file update block (Task 1 opens it after `READER_MIN_COLS`; Tasks 4–6 and 13 append inside it), never above the README-cited `:7526` (D-3188).
- **L1 is `server/src/update/resolve.ts`**: pure decisions, imports only `'../../../shared/*.js'`, no `fs`, no store, no fastify; routes decide nothing the resolver does not (the `409` predicates are resolver functions the route calls).
- **Every file under `server/src/update/` imports shared modules as `'../../../shared/<x>.js'`** — three levels, as `server/src/coord/store.ts:54` and `coord/routes.ts:15` do; `'../../shared/…'` does not resolve.
- **Declared once, imported everywhere else**: `FLEET_SCOPE = '*'` in `shared/api.ts`'s end-of-file block (Task 1; Task 6's store and Task 12's `resolve.ts`/`project.ts` import it, and no other file declares it); `NODE_ID_RE` exported from `server/src/coord/store.ts` beside `rekeyNode` (Task 5; Task 11's `inventory.ts` imports it from `'../coord/store.js'`); the store's refusal words in ONE `UPDATE_STORE_REFUSE_CODES` (Task 4 declares it, Tasks 5 and 6 append — D-3192); the eight `~/.ccrc` basenames in `NODE_FILES` (Task 8) — no TS root quotes `'ccrc-caps'`, `'update.json'` or `'update-intent'` outside it, so every name, the projection's tmp name included, is built from `NODE_FILES.*`.
- **No TS root spells the org** (`single-definition.test.ts`'s "the four TS roots never name the org", `:2793`); the release source reaches the server at runtime only (Task 9), and fixtures use an invented owner/repo.
- **`coord.db` stays synchronous** (`tx()`, `db.ts:245`, `BEGIN IMMEDIATE`); every new `CoordStore` writer has a ONE-LINE signature with a return type (`mail-hardening.test.ts`'s `SIG`, `:310`; the D-2338 precedent), puts its guard in the `WHERE`, and returns a result union — never `void`.
- **Box token never writes intent** (decision 15): no route in `update/routes.ts` except the one projection read calls `requireMailToken`/`checkMailToken`; no update route is added to `gate.ts`'s `EXEMPT` except that read.
- **Wire discipline**: every new field and route is additive, `FLEET_PROTO`/`FLEET_PROTO_MIN` stay 1, one reader per field, absence permits.
- **Timestamps**: every `coord.db` column is epoch **ms**. `~/.ccrc/update.json`'s `startedAt`/`updatedAt` are unix **seconds** — the W4 writer's `date +%s`, portable to macOS — converted to ms ONCE, at Task 11's validator, which reads a value above `UNIX_SECONDS_MAX` (a ms value; CORRECTION, fix round 2, C6 nit — the final fix wave's C5 deleted `inventory.ts`'s own `REPORT_TIME_MAX_S`, named here originally, in favour of this ONE `shared/api.ts` declaration Task 11 imports) as `null` rather than multiplying it. A report's second covers `[s*1000, s*1000+999]`, so report precedence is `startedAt*1000 + 999 >= updateStartedAt` (D-3199). The projection document is **seconds** (`server.ts:2679-2688`'s C1 lesson).
- **`update.json` is read by name**: the validator reads the report's five fields (`phase`, `target`, `startedAt`, `updatedAt`, `detail`) by name and IGNORES every other key (additive discipline — a newer writer may add keys, as wave 4's `pid` does); a Task 11 case pins that an extra key changes nothing.
- **The projection**: the file is `~/.ccrc/update-intent` (`NODE_FILES.projection`), mode 0600, written tmp-then-rename; its route answers `200` with `content-type: text/plain; charset=utf-8` and the spec §9 document; a `node-id` is a lowercase UUID (`NODE_ID_RE`).
- **Both update lanes sit above `tick()`'s registry fail-shut return** — the catalogue gate (Task 10) and the inventory gate (Task 11); neither reads the registry, so neither stops when the fleet registry cannot be listed (D-3198).
- **Remote paths**: a fleet node's files are read at `cfg.ccrcDir` over the agent — the same same-absolute-path assumption every existing remote read (`cfg.registryDir`) already makes; nothing here adds a translation layer.
- **Tests use fixture HOMEs only** (`mkTmp`/`removeTmpFixtures`, `tmpHelpers.ts`) — never the live `$HOME`, never a live `coord.db`, never a real GitHub request (a loopback `listen(0)` server).
- **`MIGRATIONS[13]` is a cross-branch namespace**: re-measure `git fetch origin main && git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` (expect 13) immediately before the PR and again before merge — PR #40 is open and stale and will renumber into slot 14.
- **Suites run in the foreground, one file at a time, inside the package**: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts` (agent likewise) — never bare `npx vitest`; Task 15 runs each package's whole suite unsharded, as CI does.
- **Cited files move no cited line**: `session-hook.test.ts`'s citation audit cites `single-definition.test.ts` (`:32-37`, `:1274`, `:1303`; census 8), `shared/api.ts` (`:7465-7467`, `:7505`, `:7513`, `:7526`, through `README.md:2560`) and README's own anchors by line number. Every edit to one of those files is line-neutral above the cited lines or appended after them — each task says which — and that task's green run includes `session-hook.test.ts`.
- **No residue in tracked text**: no hostname, username, absolute home path, docserver URL or the org name; run `test/topology-clean.test.ts` before every commit that adds a file (it scans the staged tree for the residue classes by pattern — the classes are never spelled outside that file).
- **Deviation numbers are issued by the allocator** (`POST /api/ledger/deviations`) and defined in the same act. This plan's departures carry the numbers the coordinator minted for run 128 on 2026-09-23 (the section below). A departure found while executing takes the next unspent number of the run's RESERVE block, which the coordinator minted beside it and names in the wave brief; it is defined in `## Deviations found` in the same commit that first cites it, and an unspent reserve number is never written as a `D-` token anywhere (`deviation-refs.test.ts` holds the highest cited number equal to the highest defined one). Never a concrete `D-TBD-` spelling (`dtbd.test.ts`).
- **Mutation-table discipline**: every guard ships with a test that goes red when the guard is removed or mutated, measured before/after; each task names the §18 rows it pins.
- **Commit on the workspace branch only** — one commit per task at least, `feat(update): …` / `test(update): …`, never a separate feature branch.

## Review Focus

Input classes and failure modes the spec implies but no §18 row exercises, most likely first:

1. **The listing is a window, not the catalogue.** `per_page=30` means the 31st release falls off page 1 and a literal "absent now → yanked" marks it yanked on every poll; a transient `[]` would yank everything. Task 4 adds the 31-release, deleted-in-window and empty-listing store cases; Task 10 adds the poller's `coverage` derivation from the RAW element count (a malformed element skipped from a full page must not make the page look complete) — D-3185.
2. **A standing report re-applies itself.** `~/.ccrc/update.json` persists; after `ack` deletes a node's provenance refusal, the unchanged `failed` / `provenance:` report must not re-insert it on the next sweep, and a `failed`/`reverted` report must not re-release a lease every minute. Task 11's `sweepPlanFor` acts only on a CHANGED report (`reportedUpdatedAt` differs from the row's before the upsert) and adds "ack, then sweep again with the same report → refusal stays cleared".
3. **Units and clocks across two boxes.** `update.json` seconds vs `coord.db` ms (a 13-digit value must be refused, not multiplied); projection seconds; `reportedStartedAt` is the fleet box's clock while `updateStartedAt` is the server's, and either may be NULL. Task 11 adds the seconds→ms and out-of-range cases; Task 5 adds the precedence guard with NULL on each side; Task 12 adds seconds-not-ms on the rendered document.
4. **Same-user-writable content beyond §8's list.** The stamp's `ref`/`builtAt` are unbounded strings inside the 64 KiB cap and reach `NodeWire.current`; `version` may be present but not a tag; `caps`/`floor`/`node-id` may carry CRLF, a NUL, trailing spaces or an uppercase UUID; a file may grow between `stat` and `read`. Task 11 adds a case per shape (printable-ASCII bound on `ref`/`builtAt`, a non-tag `version` → `malformed`, CRLF tolerated only as a line terminator, uppercase UUID refused).
5. **Identity and first-read races.** A `ready`-triggered sweep concurrent with the tick sweep, a label placeholder written while disconnected and then re-keyed, a `node-id` that vanishes after a re-key, and `GET /api/updates` in local mode before the first sweep (spec: never an empty list); plus the projection read answering `401` before revealing whether a node exists. Task 11 adds single-flight `inventoryNow()` and the placeholder→re-key case; Task 13 adds the before-first-sweep and credential-order cases.

## Deviations found

Plan-level departures from the spec's literal text, each carrying the number the allocator issued for it (run 128, minted 2026-09-23). The first eleven were found while planning against the measured tree; the next three while writing the task interfaces; the last nineteen while writing (and, where a case was run, measuring) the task bodies. Each of the last twenty-two says which task found it.

- **D-3174** — Spec §9 says "on a server-role or `both` node the server process is the writer" and §6's `nodes.role` needs the server row's role, but `server/src` has no role: `loadConfig` (`config.ts:251`) reads only `fleetMode` from `CCRC_FLEET` (`:333`), and `CCRC_ROLE` is a bash-side fact written into `~/.ccrc/ccrc.env` by `cmd_install` (`ccd/ccrc:9377`) and read only through `_box_env_value`. Because `ccrc.service`'s first `EnvironmentFile` is `%h/.ccrc/ccrc.env` (`deploy/ccrc.service`), the recorded role already reaches `process.env`; Task 9's `deriveRole` reads `env.CCRC_ROLE` through `isNodeRole` and, when it is absent or out of vocabulary, derives the role from `fleetMode` (`remote` → `server`, `local` → `both`), carrying `roleSource: 'recorded' | 'derived-absent' | 'derived-invalid'` beside it — so a `deploy.sh` box that never recorded a role (D-3106) reads as derived, and an invalid token is never folded into absence. `roleSource` has one reader: when the role was derived, `index.ts` logs once at boot `ccrc-server: CCRC_ROLE is <absent|invalid> in the environment — this box's role reads <role> (derived from CCRC_FLEET=<mode>)` (Task 9). Pinned by `config.test.ts` (recorded; absent in each mode; a bare line; invalid never folded into absent), by that boot line's case, and by the inventory's server row carrying `cfg.role`. Cost if wrong: a box whose role is misderived writes (or skips) its own projection — visible on `GET /api/updates` as the row's role and in the boot line, fixed by recording `CCRC_ROLE`.
- **D-3175** — Spec §7 issues `GET {api}/repos/{owner}/{repo}/releases` without saying how `owner`/`repo` reach the server; no `CCRC_RELEASE_OWNER`/`CCRC_RELEASE_REPO` is in the server's environment (`deploy/ccrc.env.example` has none) and a TS default is refused by `single-definition.test.ts`'s TS-roots scan (`:2793`). Task 9's `readReleaseSource` reads the INSTALLED tree's `ccd/ccrc` — `$HOME/ccrc/ccd/ccrc`, the tree `ccrc.service`'s `ExecStart` runs from — for the two release-source lines (`ccd/ccrc:1335-1336`, matched `^CCRC_RELEASE_OWNER="([^"]+)"$` / `^CCRC_RELEASE_REPO="([^"]+)"$` against each `\n`-split line, without the `m` flag, so a CRLF line refuses), and `env.CCRC_RELEASE_OWNER`/`env.CCRC_RELEASE_REPO` override only when BOTH are set; every value, tree or env, must match `^(?!\.+$)[A-Za-z0-9._-]{1,100}$`; a failed tree read is one of three `why` words (`tree-absent`, `tree-unreadable`, `tree-malformed`) and a malformed env pair a fourth, `env-malformed` (D-3196), each logged once at boot and reported by the poller as `no-release-source` with no request sent. Pinned by `config.test.ts` (fixture tree; both-env override; half-set env ignored; each `why`) and by the TS-roots scan staying green. Cost if wrong: a box whose tree is elsewhere shows `no-release-source` until the two env keys are set.
- **D-3176** — Spec §8 puts the basename cases in `agent/test/whitelist-structural.test.ts`, but that file pins only the EXEC whitelist through tsc-spawned compile errors and holds no `checkPath` case (its describes at `:125-515`); `checkPath`'s readable/refused cases live in `agent/test/whitelist.test.ts`'s `describe('whitelist.checkPath')` (`:30-144`). Task 8's cases go there and `whitelist-structural.test.ts` is untouched (agent/CLAUDE.md calls it safety hardware). Pinned by the new cases and by the prefix mutation (§18 "the read allowlist is exact basenames"). Cost if wrong: none — the cases are where the function's other cases are.
- **D-3177** — Spec §8: "every read is capped at 65536 bytes", but the agent's text read (`readWhole`, `agent/src/fileops.ts:68-76`) has no cap — only the b64 op has one (`MAX_READ_B64_BYTES`, `:92`) — so the cap cannot be enforced before the bytes cross the wire. Task 11 enforces it server-side: `lstatMeasured` → only `regular` proceeds; `statMeasured` size ≤ 65536; `readFileMeasured`; the content's UTF-8 length re-checked ≤ 65536, else `too-large`. The residual is named, not hidden: a same-user writer that grows the file between the `stat` and the `read` gets it across the wire once, bounded by the WS frame limit, and it still reads `too-large`; the proper fix is an agent-side cap on the text read, which changes that op for every caller and is left out of W2. Pinned by a 70 KiB stamp → `malformed` and by a fixture io whose `stat` says small and whose read returns 70 KiB → `too-large`. Cost if wrong: one oversized frame per sweep from a hostile same-user writer, which already owns the box.
- **D-3178** — `MeasuredPathKind`'s failure reason has a third word, `unmeasured` (`io.ts:70-77`), which has no slot in the four-word `StampRead` or in §8's absent/unreadable pair. It has two sources: an agent too old for the `lstat` op, and — once Task 8 lands — a W2 agent refusing the `lstat` of a live symlink that carries a node-file name (`forbidden`, D-3195), which `remote/io.ts`'s `lstatMeasured` maps to `unmeasured` like any refused request. Task 11 reads it as `unreadable` for that one file — honest for both: an agent that old predates the basename set and refuses every `~/.ccrc` read anyway, and a symlinked node file is exactly what §8 says reads `unreadable` — and says so at the fold; `io.ts`'s "never fold" rule governs adapters, and this is the consumer deciding. Pinned by a fixture io answering `unmeasured` → `stampRead = 'unreadable'`, never `absent`, and by Task 8's real-agent case, where the lstat of a live symlinked member answers `unmeasured`. Cost if wrong: an ancient agent's node, or a node with a symlinked node file, reads `unreadable` instead of a word that does not exist.
- **D-3179** — Spec §12's census names two scanners blind to `update/routes.ts` (`coord-pause-route.test.ts`'s `SESSION_ONLY` harvest and `box-token-census.test.ts`'s `ALL_LANES`, `:97-98`); there is a third: `auth-gate.test.ts`'s `scanRoutes` reads `server.ts` and `coord/routes.ts` only (`ROUTES`, `:95`), and its "the scanner is COMPLETE" describe (`:383`) reds the moment a route registers from any other file. Task 13 adds `update/routes.ts` as its third file with its own length pin (5) and moves every numeral it states (`:545`'s lane title included). Pinned by that describe. Cost if wrong: none — the scanner would have gone red anyway.
- **D-3180** — Spec §6 names the catalogue writer `upsertRelease`, one row per call, while §7 requires marking a release that vanished `yanked = 1` — a statement about the whole listing that a per-row upsert cannot make without a second writer on the catalogue group, which "one writer per column group" forbids. Task 4's ONE catalogue writer is `applyReleaseListing(listing, now, coverage)`: in one `tx`, upsert every listed row and mark the absent ones yanked; never `DELETE`. Task 7's writer-group scan names it the only writer of the catalogue columns. Pinned by the vanish → `yanked` case and a planted `DELETE FROM releases` → red. Cost if wrong: none beyond a method name.
- **D-3181** — Spec §6 spells `StampRead` (`'ok' | 'absent' | 'unreadable' | 'malformed'`), `NodeRole` (`'server' | 'fleet' | 'both'`) and `NodeOs` (`'linux' | 'darwin' | 'unknown'`) only inline in DDL comments; Task 1 declares each once in `shared/api.ts` with its runtime array and guard, like every other enum column. The read side follows §6's own stances for tokens outside a vocabulary: `nodes.role` and `releases.channel` read `null` (the ClaimState stance spec §6 takes for `nodes.channel`), so `NodeWire.role` is `NodeRole | null` and `ReleaseWire.channel` widens to `UpdateChannel | null`; `stampRead` reads `unreadable`; `update_intent.auto` reads `off` (nothing unattended) and `notify` reads `channel` (the operator hears of more, never of nothing). Pinned by `update-states.test.ts`'s array/guard agreement per vocabulary, one single-holder case per type, and a planted out-of-vocabulary row per column in Tasks 4–6. Cost if wrong: a newer build's token renders as the named fallback instead of as nothing.
- **D-3182** — Spec §7/§12 define `catalogueState` and the `If-None-Match` ETag but not where they live; W2 keeps both in the poller's process memory (§6 forbids a second migration slot, and a column would be a table for two numbers). After a restart the first tick polls at once (`lastCatalogueAt = 0`) and `GET /api/updates` answers `{lastOkAt: null, lastError: null}` — "never checked", never "up to date" — until it answers; the catalogue rows themselves survive in `coord.db`. Pinned by a fresh poller's state and by the first tick issuing one request. Cost if wrong: one unconditional GET per restart against a 60/hour budget.
- **D-3183** — Spec §6 lists "the `ack` path" only in the request group, while §12 says ack returns the row to `idle`, clears the request AND clears this node's refusals — three groups. Task 5's `ackNode` writes lease + request columns and deletes this node's `node_release_refusals` rows in ONE `tx`; its lease guard is `updateState IN SETTLED` — the complement of `releaseLease`'s busy guard — so an ack on a busy row refuses `busy` and never kills a live lease. Task 7 names `ackNode` in the lease, request and refusal groups. Pinned by ack on `failed` → `idle` + request cleared + zero refusals, ack on `applying` → `busy` and nothing written, and each clear removed → red (§18 "`ack` clears the node's refusals and its request"). Cost if wrong: a wedged `unknown` row cannot be acked until W4's deadline turns it `failed`.
- **D-3184** — Spec §8 keys a pre-W1 node "by its connection label", but no label exists: the server holds one `FleetClient` (`connectFleet`, `index.ts:84-87`). The server's own row is labelled `server` (role `cfg.role`, `both` in local mode) and the one agent connection `fleet` (role `fleet`), as `SERVER_LABEL`/`FLEET_LABEL` in `update/inventory.ts`; a second agent connection is future work and would need its own label then. Pinned by Task 13's two `GET /api/updates` cases before the first sweep: one node labelled `server` with role `both` in local mode, and two in remote mode (`fleet`/`fleet` and `server`/`server`). Task 11's sweep cases pin the same two rows at the store (`a missing connection is unreachable on THAT sweep…`). Cost if wrong: a rename of two constants.
- **D-3185** — Found writing Task 4's interface. Spec §7: "a release present last time and absent now is marked `yanked = 1`", with `per_page=30`. After the 31st release the oldest known one falls off page 1 and would be marked yanked on every poll though nothing was yanked, and an empty `[]` (a transient answer) would yank the whole catalogue. `applyReleaseListing` takes `coverage: 'complete' | 'newest-page'` from the poller (`complete` iff the RAW array held fewer than `RELEASES_PER_PAGE` elements); under `newest-page` only known rows published at or after the oldest listed `publishedAt` are yank candidates; an empty listing while rows are known is refused `empty-listing` and writes nothing. A yank older than the window is therefore not observed in W2 — named, not hidden. Pinned by a 31-release fixture (the oldest stays `yanked = 0`), a release deleted inside the window (`yanked = 1`) and an empty listing (refused; `lastError.reason = 'malformed'`, prior rows intact). Cost if wrong: an old yank goes unmarked, and the resolver never picks an old release anyway (the floor).
- **D-3186** — Found writing Task 3's and Task 5's interfaces. Spec §6's DDL declares `updateState TEXT NOT NULL` with no default, while its own pin says `upsertNodeMeasurement` names no column outside the measurement and report groups; the first `INSERT` of a node row would have to name the lease column. The migration declares `updateState TEXT NOT NULL DEFAULT 'idle'` — a never-dispatched node IS idle — and neither measurement writer names it. Pinned by the migration test (`PRAGMA table_info` `dflt_value = "'idle'"`) and Task 7's scan. Cost if wrong: none; the value every first insert would have written.
- **D-3187** — Found writing Task 12's interface. Spec §19 lists `server/src/update/{catalogue,inventory,resolve,dispatch,routes}.ts` and puts the server-role projection writer beside the resolver, but the resolver is L1 (no `fs`) and ring membership is a property of a file's imports, so a writer in `resolve.ts` would make the resolver L3. The writer (`node:fs`) and the store-reading orchestration live in a sixth file, `server/src/update/project.ts` (L3); `resolve.ts` imports only `'../../../shared/*.js'`. Pinned by Task 7's update-ring scan (with `project.ts` in its file list) and an import-block assertion on `resolve.ts`. Cost if wrong: one more file in the directory.
- **D-3188** — Found writing Task 1. Spec §6's placement and this plan's first draft put the new vocabularies beside `BuildAgreement` (`shared/api.ts:3237`), but `README.md:2560` cites `shared/api.ts:7465-7467`, `:7505`, `:7513` and `:7526` by line, and `session-hook.test.ts`'s citation audit (`describe` at `:7061`) holds README's census entry empty and `shared/api.ts`'s at exactly 1, so any line inserted above `:7526` moves those anchors and reds the audit — measured: a ten-line insert at `:3237` reds "THE CITATION DEBT…" (`:7602`, `shared/api.ts` 1 → 5) and "README HAS ITS OWN CENSUS ENTRY, and it is EMPTY" (`:8433`). The W2 block is APPENDED after `READER_MIN_COLS` (`:8138`, the file's last line), which moves no cited line, and every later W2 addition to `shared/api.ts` joins that block (Tasks 4–6's `UPDATE_STORE_REFUSE_CODES`, Task 13's `verdict?`); a W2 edit above `:7526` (Task 14's `FleetHealth.builds` docstring, `:3183-3192`) is line-neutral. The same rule binds `single-definition.test.ts`, cited at `:32-37`, `:1274` and `:1303` (census 8): Task 1's import edit is line-neutral (names added to `:23` itself), and every new describe there is appended after the file's last line or is line-neutral. Pinned by the audit staying green (13 passed, measured) in every task that edits either file. Cost if wrong: none; only where the block sits in the file.
- **D-3189** — Found writing Task 1. Spec §6 spells `StampRead` as the union `'ok' | 'absent' | 'unreadable' | 'malformed'`, whose two failure words are `ReadFailure`'s (`shared/agent-protocol.ts:313`). `shared/api.ts` cannot import that type — its three type-only imports are pinned (`peers-claims-l0.test.ts:157-167`) — and spelling the pair as a union makes `api.ts` a second holder of `'absent' | 'unreadable'`, which reds "one absent/unreadable read vocabulary" (`single-definition.test.ts:2566-2588`) and "does not respell io.ts read-failure pair as the skill vocabulary" (`:2395`) — measured. The type is therefore DERIVED — `export const STAMP_READS = ['ok', 'absent', 'unreadable', 'malformed'] as const; export type StampRead = (typeof STAMP_READS)[number];` — and `update-states.test.ts` holds `Exclude<StampRead, 'ok' | 'malformed'>` EQUAL to `ReadFailure` in both directions at compile time, so a failure word added to either side alone is a type error. Pinned by those two type lines, a single-definition case over the derived form, and the hand-written-union mutation, which reds three cases (measured). Cost if wrong: none; consumers see the same type.
- **D-3190** — Found writing Task 2. `shared/semver.ts` imports nothing, so it cannot call `isReleaseTag`, yet its precondition must throw `RangeError` on a non-tag. It restates the tag grammar by STRUCTURE — a `v`, then three non-empty runs of ASCII digits, compared as digit strings (exact past 2^53) — and carries no copy of the `RELEASE_TAG` regex, so Task 1's "spells the tag shape once" scan (one holder of the regex source, `shared/api.ts`) stays green. `update-semver.test.ts` holds the parse's accept set EQUAL to `isReleaseTag`'s on a 32-shape fixture list, in both argument positions. Callers still validate with `isReleaseTag`; the parse is only a loud precondition check. Pinned by that equality case (a loosened or tightened parse reds it). Cost if wrong: one more statement of the grammar, held equal to the guard by a test.
- **D-3191** — Found writing Task 3. Spec §6: "No test detects a double slot; the entry's own closing paragraph carries the re-measurement." Task 3 adds a `coord-db.test.ts` case that reads `schema.ts`, collects every `  // ── N: user_version A -> B ─` banner, and asserts that their count equals `MIGRATIONS.length` and that banner i reads `[i, i-1, i]` — catching a textual double slot left in THIS tree, such as a rebase of PR #40 that keeps its own `14: user_version 13 -> 14` banner beside this entry. Measured: the rebased-double-slot mutation reds it together with the two literal pins, and a banner renumbered while the array length holds reds it alone. It cannot see a slot another branch holds, so the `origin/main` banner count stays the required check (Task 3's slot step and Task 15). Cost if wrong: one more case to keep green; it departs from the spec's sentence only in the direction of detecting more.
- **D-3192** — Found writing Task 4, and independently writing Task 6. Spec §6 lists the update vocabularies but not the store's refusal words, and neither it nor this plan's first draft names `mail-routes.test.ts`'s `it('every quoted kebab token in server/src/coord that looks like a code is declared')` (`:569-778`): it reads every `.ts` file directly under `server/src/coord` and reds on any single-quoted hyphenated word (`'([a-z]+(?:-[a-z]+)+)'`) that is neither in `NOT_CODES` nor admitted by an exported guard. The W2 store's result unions put exactly such words into `store.ts` — Task 4's `bad-tag`, `duplicate-tag`, `bad-row`, `empty-listing`, `unknown-node`; Task 5's `bad-node-id`, `label-key-taken`, `not-busy`, `stale-report`; Task 6's `empty-patch`, `bad-field`, `unknown-scope`, `no-channel`, `journal-unreadable`, `journal-unwritable` — and each one is a red. W2 declares ONE vocabulary, `UPDATE_STORE_REFUSE_CODES` / `UpdateStoreRefuseCode` / `isUpdateStoreRefuseCode`, in the shape of `SET_ACCOUNT_POOLS_REFUSE_CODES` (`api.ts:6064-6090`, admitted at `mail-routes.test.ts:775`) but in the END-OF-FILE update block, not beside it (D-3188): Task 4 creates it, Tasks 5 and 6 append to it, and there is no separate `SET_INTENT_REFUSE_CODES`. The scanner admits it through ONE `|| isUpdateStoreRefuseCode(tok)`, added by Task 4 (line-neutral if the file is audit-cited); the two non-refusal words go in `NOT_CODES` with their reasons — `newest-page` (a coverage word, Task 4) and `no-label-row` (an ok arm, Task 5). `server/src/coord/updateintentlog.ts` sits under the same scan and spells no single-quoted kebab word outside the vocabulary. Pinned by the scanner itself: each task runs it red on its new words before appending them and green after, and deleting the guard reds it naming `bad-tag`. Cost if wrong: none; one array, and the scanner reds either way.
- **D-3193** — Found writing Task 5. Spec §8 covers a label-keyed row meeting a node-id — re-key it, or supersede it when a UUID row already exists — but not a box that is uninstalled and re-installed: `_inst_node_id` then mints a NEW UUID and the old UUID row stays live beside the new one under the same label, so `GET /api/updates` would show two fleet nodes and the derived `builds` view ("the first live fleet-role row", Task 14) could read the stale one. `rekeyNode(label, nodeId)` therefore also marks every OTHER live row carrying that label under a different id `supersededBy = nodeId`, in the same `tx`, and returns the count as `retired` (`RekeyNodeResult`'s ok arm). Pinned by the re-install case — `nodeByLabel` answering the new id, one live row — and by deleting the retire step, which reds it. Cost if wrong: an old identity's intent and refusals become invisible, which is correct for a re-minted node.
- **D-3194** — Found writing Task 5; applied in Task 6. Spec §8 says `rekeyNode` re-keys a label-keyed row to its UUID "carrying its history", and §9 resolves a node's channel from `update_intent[nodeId]`, but `update_intent`'s one writer is `setIntent` (Task 7's writer groups), so `rekeyNode` carries the `nodes` row and its refusal rows and never an intent row. An intent written under a label (a pre-W1 `fleet`, which is a live `nodes` row) would be orphaned at the re-key: Task 12's `resolveInputFor` reads `intentFor(node.nodeId)` = the UUID, finds nothing and falls back to `'*'` in silence, and the dead `'fleet'` row stays in `GET /api/updates`' `intent[]`. `setIntent` therefore answers `unknown-scope` for any scope that is neither `FLEET_SCOPE` nor a live row whose `nodeId` passes `NODE_ID_RE` (Task 5's one declaration, same `store.ts`); the route answers that as `404 unknown-scope` (Task 13). Pinned by Task 6's label-keyed case (refused, nothing journalled, and the re-keyed UUID accepted), by Task 6's mutation 11 (dropping the `NODE_ID_RE` clause reds it, with the live-row case as its control), and by Task 13's route case. Cost if wrong: an operator cannot give a pre-W1 node its own intent until its first W1 install mints an id; until then it follows `'*'`.
- **D-3195** — Found writing Task 8. Spec §8 asks for an exact-basename read set by canonical path, but canonical-path membership admits a LIVE symlink that carries one of the eight names and points at another of them (`~/.ccrc/floor` → `~/.ccrc/installed`), and the agent's `lstat` op — whose subject falls back to the canonical path when the parent, `~/.ccrc` itself, is refused (`agent/src/server.ts:353-381`) — would then answer `regular` for a link, defeating §8's "a symlinked `build.json` → `unreadable`". `isCcrcNodeFile` also requires canonical target === `<canonical
~/.ccrc>/<literal basename of the path asked for>`, so a live symlink
carrying a node-file name whose **fully resolved** target lies outside
every admitted prefix, or is another of the eight, is refused by
`checkPath` (`forbidden`, which the server's remote io reads as
`unreadable` / `unmeasured`, D-3178) — a chain still classifies by where it
finally lands, so `previous → installed → .cc-sessions/x` resolves past
the member it names first and is NOT refused by this rule. A live symlink
whose fully resolved target lies in a **different** admitted prefix
(`.cc-sessions`, `.cc-clips`, a `.claude*` dir, the projects root) is
instead admitted through that OTHER prefix's own arm — nothing is
disclosed (the target was already readable on its own path) — and the
integrity guarantee shifts to the `lstat` op itself: fix round 1 (F12)
scopes its subject to the literal `~/.ccrc` directory entry whenever the
request's literal parent canonicalises onto `<canonical ~/.ccrc>` and its
literal basename is one of the eight, rather than falling back to
`checkPath`'s already-resolved canonical answer, so `lstat` still reports
it `symlink` and the inventory sweep still refuses to trust it. A dangling
symlink is admitted and lstats honestly as `symlink` too. `checkPath`'s signature is unchanged. Pinned by the `floor` → `installed` case in `agent/test/whitelist.test.ts`, by `agent/test/fileops.test.ts`'s four into-another-prefix `lstat` cases (fix round 1, F12) and four controls (a regular node file; a dangling link; a node-basename file under another prefix with the `~/.ccrc` entry absent; a non-node `~/.ccrc` name linked elsewhere, fix round 1 I-1), and over a real agent in `remote-connect.test.ts` (Task 8's mutation 2). Cost if wrong: none; the refused files are ones the sweep must not trust anyway.
- **D-3196** — Found writing Task 9. D-3175 says only "env overrides when both are set". When both are set but a value is not a plain GitHub name, `readReleaseSource` answers `{ ok: false, why: 'env-malformed', path: null }` and the poller reports `no-release-source`: it neither falls back to the tree's pair — which would poll a repository the operator overrode — nor builds a URL from an unvalidated value, which is interpolated into `{api}/repos/{owner}/{repo}/releases`. The value pattern, for the tree's lines as for the env, is `^(?!\.+$)[A-Za-z0-9._-]{1,100}$`: the first draft's `[A-Za-z0-9._-]{1,100}` accepted `..`, which walks the request path up a segment. Pinned by the `env-malformed` case and Task 9's mutations 5 and 7. Cost if wrong: an operator's typo shows `no-release-source` until fixed.
- **D-3197** — Found writing Task 10. Spec §7 and §12 define `catalogueState` as `{lastOkAt, lastError}` and §18 says an error never moves `lastOkAt`; neither says whether a later success clears `lastError`. W2 makes `lastError` the CURRENT failure: an answer — a 200 the store accepted, or a 304 to a request that sent an `If-None-Match` — sets `lastOkAt = now` AND `lastError = null`; an error sets `lastError` and leaves `lastOkAt` alone. So `lastError !== null` means the latest poll failed, and `lastOkAt` is when the catalogue was last known good. Pinned by "an answer after an error clears lastError" in `update-catalogue.test.ts`. Cost if wrong: after a recovery the record of the last failure is gone, so a consumer shows no stale error — the honest display — and "never render a failed poll as up to date" still holds because errors never move `lastOkAt`.
- **D-3198** — Found writing Task 11; it covers Task 10's gate as well. `tick()` returns early when `readRegistryMeasured` answers `listed: false` (the fail-shut return, `watch.ts:828`, below the registry read at `:811`), which is exactly what happens when the fleet link is down. A lane gated below that return never runs then: the inventory would never write `reachable = 0` on the sweep the link drops, breaking §18 "unreachable is written on the sweep it happens", and the catalogue — which reads no registry — would stop polling for the length of every registry outage. Both gates therefore sit at the top of `tick()`'s `try` (after `watch.ts:787-788`), ABOVE the registry read: the inventory gate (Task 11) and the catalogue gate (Task 10, moved there from beside the caps block, `:879-886`). Pinned by "sweeps on the first tick even when the registry will not list" (Task 11), by a catalogue twin that polls under an unlistable registry (Task 10), and by the mutation that moves either block below the return, which reds its case. Cost if wrong: none; neither lane reads the registry.
- **D-3199** — Found writing Task 11. `update.json`'s `startedAt` is whole unix seconds (bash `date +%s`); `updateStartedAt` is the server's ms. A node that writes `startedAt = s` for a run dispatched at `s*1000 + 500` would read as a PREVIOUS run under the literal `startedAt*1000 >= updateStartedAt`, so the store's precedence guard would refuse every real settle and release. Precedence therefore compares the latest instant the report's run could have started: `startedAt*1000 + 999 >= updateStartedAt`. The sweep passes `reportStartedAt = startedAt*1000 + REPORT_TIME_RESOLUTION_MS - 1` (`REPORT_TIME_RESOLUTION_MS = 1000`, `inventory.ts`); the store's `WHERE` is unchanged. Clock skew between the two boxes beyond one second is named as not covered. Pinned by a same-second case (it settles) and a previous-second case (`stale-report`), and by the mutation that drops the `+ 999`, which reds both the same-second case and "done at the stamped version → idle via settleNode". Cost if wrong: a previous run that started within the same second as the current lease reads as the current one.
- **D-3200** — Found writing Task 11. Spec §8 reads `provenance` from `~/.ccrc/installed`'s line 2 without conditioning it on line 1. After a `deploy.sh` over an installed box the marker names the OLD tree, and its "verified" would describe a tree that is not running. `installFrom` reads provenance only when `installState = 'complete'` (line 1 equals the stamp's sha); otherwise it is `'unknown'`. Pinned by `installFrom`'s "only a complete install has one" case (an other-sha marker and an absent marker both → `provenance: 'unknown'`). Cost if wrong: a box with a stale marker shows provenance `unknown` instead of an old tree's verdict.
- **D-3201** — Found writing Task 11. Spec §8 does not say what happens when a node-id disappears after its row was re-keyed. When no node-id is measured but the live row carrying the connection's label already has a UUID key, the sweep keeps measuring INTO that row (its `nodeId`, with `installState = 'unknown'`) rather than keying the measurement by the label, which would open a second live row for the same connection. Pinned by "a node-id that vanishes after a re-key keeps measuring into the UUID row, never a second live row" and by deleting that step, which reds it with two live rows. Cost if wrong: a box whose `node-id` was deleted keeps its old identity until a new one is minted — which then retires it (D-3193).
- **D-3202** — Found writing Task 12. Spec §9: a node's floor is `highestVersion`, or `currentVersion` only when that is NULL. But `~/.ccrc/floor` is raised only by the install spine (`_inst_installed`), and a tree placed by `deploy.sh` never raises it, so a node can run v0.0.12 over a stale floor of v0.0.9 and the literal rule would resolve v0.0.11 — a downgrade from what is running. `floorOf` takes the HIGHER of the two when both are valid tags; when the current version is at or below `highestVersion` the answer is `highestVersion` exactly, so a rollback stays sticky and both floor sentences are unchanged; a NULL `highestVersion` is still unconstrained — the current version stands in, never v0.0.0 and never a refusal. Pinned by the `floorOf` table and "a version above a stale floor is the floor", and by the mutation that returns `highestVersion` alone, which reds them. Cost if wrong: a node with a stale floor is told it is at its floor instead of being moved down.
- **D-3203** — Found writing Task 13. Spec §7 rate-limits `refresh` "to one call per minute in the route". The route measures the minute against the poller's `lastRequestAt()`, which the scheduled 30-minute poll also sets, so a refresh within a minute of a scheduled poll answers `429` though the operator never tapped twice — stricter than the spec's wording, protecting the same 60-per-hour budget. A `lastRequestAt` in the future (the clock stepped back) does not refuse; only an elapsed time in `[0, 60 s)` does. Pinned by the refresh `429` case and Task 13's mutation 1. Cost if wrong: an occasional `429` on a first tap, answered with its `retryAfterS`.
- **D-3204** — Found writing Task 14. `CoordStore.nodes()` is a synchronous `node:sqlite` read that throws on a corrupt or locked `coord.db`, and before W2 nothing in `GET /api/fleet/health`'s remote arm touched `coord.db`; deriving `builds` there would add a new way for the route the PWA polls for its banners to answer `500` — a case neither the spec nor this plan's first draft covers. A module-level `inventoryBuilds(coord)` in `server.ts` answers `{own: null, fleet: null}` on a throw (so `build` reads `'unknown'`), the `readPoolEpoch` degrade (`pools.ts:367-374`); it deliberately does NOT fall back to `fleetState.build`, because spec §8 says the design "never reads `fleetState.build` as the current build". "Inventory unreadable" and "no rows yet" therefore both reach this field as `null` on each side — acceptable because its only readers (`BuildLine`, `FleetHostBanner`) render both as a dash, and `GET /api/updates` is where the two are told apart. Pinned by a `fleet-health.test.ts` case — a planted `nodes()` throw plus a planted handshake stamp still answers `200` with `builds` null on both sides — and removing the try/catch reds it with a `500`. Cost if wrong: a box with a broken `coord.db` shows "—" on both sides instead of its boot and handshake stamps.
- **D-3205** — Found writing Task 15. Spec §15's W2 exit criterion asks for "a `desiredTag` per node", but §9's own rule resolves `desiredTag` NULL on a converged node: the desired tag must be strictly newer than the floor, and a node already on the newest eligible release resolves NULL with the at-floor sentence ("newest eligible … is not newer than this node's floor …"). Right after the coordinator's `ccrc rollout --to` the W2 tag, both nodes ARE on it — and on the migration's default channel, `stable`, nothing newer can exist, because the W2 tag is a prerelease above every stable release — so the literal criterion would fail on exactly the state it is meant to prove. The live criterion (Task 15 Step 11) therefore accepts, per node, a non-null `desiredTag` OR `desiredTag` NULL with the at-floor sentence in `resolveDetail`; NULL in both fields, and any other sentence (below-floor, no-floor, a pinned-tag refusal), fail it. Pinned by `update-resolve.test.ts`'s at-floor cases (Task 12) and read live by the coordinator. Cost if wrong: none to the code; a criterion read literally would send a correct wave back.
- **D-3206** — Found reviewing Task 4's seam with Task 10. spec §7 says "a release present last time and absent now is marked `yanked = 1`". GitHub may still list a release whose element Task 10's `parseReleaseListing` skips on one poll (no `ccrc-<tag>.tar.gz` asset, a download URL off `DOWNLOAD_URL`, an unparseable `published_at`, a non-boolean `prerelease`). The skipped element never reaches this writer, so under `complete`, or inside the `newest-page` window, the known row is marked `yanked = 1` for that poll. The next poll that parses the element unyanks it (this task's "a yanked release listed again comes back" case). The reading is deliberate, and it fails closed. A skipped element is not upserted, so its stored columns are the LAST poll's. Leaving the row at `yanked = 0` would keep a release eligible (spec §9: `bundleListed = 1`, `yanked = 0`) on a `tarballUrl` or `channel` that GitHub is not listing right now. Marking it yanked only stops forward movement for one 30-minute cycle, and §9 already says a yank never moves a node backwards. The rejected alternative threads the skipped tags across the seam: a `skippedTags` field on `ParsedListing` and a fourth `present` parameter here that `AND tag NOT IN (…)` excludes from the yank. That would change this signature for every caller (the `CatalogueStore` port and Tasks 10, 12 and 13) and keep a stale row eligible. Pinned end to end by Task 10's poller case "a known release whose element is skipped is yanked for that poll, and comes back when it parses again". Cost if wrong: a pinned tag that is transiently malformed resolves NULL with its reason for one cycle, and the PWA shows that release as yanked for up to 30 minutes.
- **D-3207** — Found in the executor's pre-flight scan, before Task 1; applied in Task 5. Spec §6 names ONE writer for the `nodes` measurement columns, `upsertNodeMeasurement` ("one writer per COLUMN GROUP"), but §18 "unreachable is written on the sweep it happens" needs a write on the sweep where NOTHING was measured: a dropped connection has no stamp, no report and no node-id to upsert, and folding that case into `upsertNodeMeasurement` would make its every column nullable-by-argument and let a partial call overwrite a real measurement with NULLs. Task 5 therefore ships a second measurement-group writer, `markUnreachable(label, role, at)`: it writes only `reachable = 0` and `unreachableSince = COALESCE(unreachableSince, at)` on the live row(s) carrying the label, and — when no live row carries it — inserts a label-keyed placeholder (`measuredAt` NULL, `stampRead` `unreadable`, `installState`/`provenance`/`os` `unknown`), so the node is listed as unreachable rather than absent. It names no lease, request, resolved or identity column. The same task's `rekeyNode` moves the label-keyed row's `node_release_refusals` rows to the new key; that is spec §8's "carrying its history" (a refusal is this node's history), not a further departure, and is named here only so Task 7's writer groups read as intended. Task 7's `WRITER_GROUPS` names both writers of the measurement group. Pinned by Task 5's `markUnreachable` cases (first `since` kept; the placeholder created) and mutation 7, and by Task 7's writer-group scan. Cost if wrong: two writers on one column group, each confined by the scan to the columns it names.
- **D-3208** — Found reviewing Task 5; applied in Task 5's fix round. D-3193's retire step marks every other live row carrying the label `supersededBy = nodeId` without asking whether the `nodeId` row is itself superseded. A node-id that comes back after it was retired — a `~/.ccrc` restored from a backup or snapshot after a re-install minted a newer id — then closes a cycle (A superseded by B, B by A): `upsertNodeMeasurement(A)` answers `superseded`, `nodes()` lists nothing for that connection, and every later sweep repeats it, so a reachable node vanishes from `GET /api/updates` and from the derived `builds` view for good, with no path out. Spec §8 says a superseded row is invisible and says nothing about a retired identity returning. The node-id measured NOW is the node's identity, so `rekeyNode(label, nodeId)`, when the `nodeId` row exists with `supersededBy IS NOT NULL`, REVIVES it (`supersededBy = NULL`) in the same `tx` before retiring every other live row carrying the label toward it; the ok arm reports `revived: true`. `supersededBy` is still named only inside `rekeyNode` (spec §6's identity group). Refusing instead was rejected: a refusal leaves the reachable node invisible, which is the defect. Pinned by Task 5's "a node-id that returns after it was retired is revived, never a cycle" case — A, then B, then A again: one live row, A, `supersededBy` NULL, B superseded by A — and by deleting the revive step, which reds it with `nodes()` empty. Cost if wrong: a stale snapshot's id displaces a newer one until the next re-mint retires it again.
- **D-3209** — Found reviewing Task 10; applied in Task 10's fix round. Spec §7 asks for a "defensive parse" of the release listing but bounds neither the body nor the element count, and this plan's poller read `res.text()` unbounded and handed an array of any length to `applyReleaseListing`, whose `tag NOT IN (?,…)` takes one SQL parameter per row and whose `Math.min(...)` spreads the listing — measured on this box: ~40,000 elements throws "too many SQL variables" and ~200,000 overflows the stack. The throw rejected `pollOnce`, the watcher's `.catch(() => {})` dropped it, and `catalogueState` kept `{lastOkAt: T, lastError: null}` — reading "up to date" after a failed poll, against §18 "errors never move `lastOkAt`"'s intent and D-3197's "`lastError !== null` means the latest poll failed". The poller therefore (1) refuses a body whose `content-length` exceeds `CATALOGUE_BODY_MAX_BYTES` (8 MiB) without reading it, and reads the stream with a running byte count that stops at the same cap — either answers `malformed`; (2) answers `malformed` for a raw array longer than `RELEASES_PER_PAGE`, which the request's `per_page` makes out of contract; (3) catches a throw from `applyReleaseListing` and answers `malformed` rather than rejecting, so every failure arm sets `lastError`; (4) refuses an API base that does not parse as a URL, carries userinfo, a query or fragment, or is neither `https:` nor `http:` to a loopback host (`127.0.0.1`, `::1`, `localhost` — the fixture's shape, which never leaves the box) — reported as `no-release-source` with no request sent, and logged once at boot naming ONLY the refusal word and, when the value parses at all with a real host, its scheme and host — never any userinfo, query, fragment or path, and never merely a "redacted" copy of the raw base (amended fix round 1, F3: review run 134 found the boot line still printed the raw base, unredacted, on every input `redactUserinfo`'s `://[^/?#]*@` regex failed to MATCH — which is exactly the unparseable shapes a malformed userinfo produces, since the userinfo's own `/`, `?` or `#` terminates the authority before an `@` is found and `new URL` throws before the regex is ever reached as a safety net; `apiBaseProblem` now re-parses the base itself, inside a `try`, and prints nothing when it does not parse or names no real host); amended AGAIN, fix round 1 review round 2, I1: F3's fix still printed the HOST for a base whose `'@'` sits past a `/`, `?` or `#` — such a base parses FINE, with the credential's own head landing in `u.hostname` (not `u.username`/`u.password`, which `BASE_URL_OK`'s own credential check reads, so it never saw the problem at all), and printing "the host" then printed that head; it also failed to refuse `https://ghp_TOKEN/@api.github.com`, which `BASE_URL_OK` ACCEPTS outright (an `https:` base needs no loopback check). `apiBaseProblem` now refuses ANY raw base containing `'@'` ANYWHERE, before `BASE_URL_OK` even runs, with its own word (`base-url-has-at`) and no scheme/host suffix at all — closing both gaps without touching `shared/base-url.ts`; the base is trimmed before use, and every request is built from that SAME trimmed, validated base, never the raw configured value; (5) skips an element whose `publishedAt` is before the epoch, and every later element repeating a tag already parsed, so the parser never hands the store a listing it would refuse whole; and (6) sends `redirect: 'error'` on the listing fetch (amended fix round 1, F9: review run 134 found the fetch call carried no `redirect` option at all, so a redirecting endpoint would be silently FOLLOWED to an arbitrary host under the same fetch call this module's own comments call fail-soft) — a 3xx throws a `TypeError` the module recognises by its `cause` and answers as its own `CatalogueErrorReason` word, `'redirect'`, never folded into the generic `no-egress` a genuine network failure gets. Pinned by an over-cap `content-length` case, an over-cap streamed body without `content-length`, a 31-element page, a planted throwing store (`lastError.reason = 'malformed'`, `lastOkAt` unchanged), a non-https / query-carrying base, a pre-epoch and a duplicate-tag element, the F3/I1 boot-line cases (ten inputs across both rounds, every one answering `base-url-has-at` with no scheme, host or secret fragment in the message, including the `ghp_TOKEN` case `BASE_URL_OK` alone accepts), and a 302 fixture answering `lastError.reason = 'redirect'` with no row written, each with its mutation. Cost if wrong: a legitimate listing over 8 MiB — about sixty times the largest page GitHub returns for thirty releases — reads `malformed` until the cap is raised.
- **D-3210** — Found reviewing Task 11; applied in Task 11's fix round. Spec §8 maps `~/.ccrc/update.json` to the five report columns and a file that is read but bad (over the cap, unparseable) to phase `unknown`; it does not say what a read that measured NOTHING writes — an `EACCES`, an agent refusal read as `unmeasured` (D-3178), or the per-read budget expiring over the agent. This plan's sweep folded all of those into `{phase: 'unknown'}` and upserted it, so the report columns changed, and `sweepPlanFor`'s changed-report gate (Review Focus 2) then read the NEXT readable sweep of the same standing report as a change: measured on a fixture, a `failed`/`provenance:` report acked to zero refusals came back as one refusal after a single `chmod 000` sweep, undoing the operator's `ack`, and the same path fed `leaseActionFor`. The sweep therefore tells an UNMEASURED report read from a measured one: when the report read fails with `unreadable` (including the D-3178 fold and a budget timeout), `upsertNodeMeasurement` is passed the row's PREVIOUS five report columns unchanged, and the changed-report gate sees no change; `absent` still writes NULLs (the file is gone — a real change), and a file that was read but is bad still writes `unknown` exactly as §8 says. The measurement columns of the same sweep are written as measured. Pinned by "ack, an unreadable sweep, then the same standing report → the refusal stays cleared" and by the mutation that writes `unknown` on an unreadable read again, which reds it. Cost if wrong: a node whose `update.json` stays unreadable keeps showing its last readable report — with `measuredAt` still advancing — until it is readable again.
- **D-3211** — Found reviewing Task 11; applied in Task 11's fix round. Spec §8 keys a node by its `~/.ccrc/node-id` and re-keys a label row onto it, and assumes a node-id names one box. Nothing checks that: a `~/.ccrc` cloned or restored onto the other box, a same-user write of `node-id`, or remote mode against an agent on the server's own box makes both connections measure the same UUID, and this plan's sweep then let `rekeyNode('fleet', U)` take a row live under the label `server` and `upsertNodeMeasurement` rewrite its `role` and `label` — measured on a fixture: after two sweeps one row, labelled `fleet`, the server's row gone, both outcomes `measured`, and every later sweep flipping the row between the two boxes' reports. The sweep therefore treats a measured node-id that is already the key of a live row carrying a DIFFERENT connection label as not measured for this connection: it keys the measurement exactly as a missing node-id does (by label, or into the label's existing UUID row per D-3201), leaves the other connection's row untouched, and reports the outcome `node-id-collision` instead of `measured`, so `GET /api/updates` shows two rows and the collision is named. The server row is swept first, so on a first sweep the server's connection keeps the id. Pinned by "two connections measuring one node-id keep two rows and name the collision" and by deleting the check, which reds it with one row. Cost if wrong: a node-id that legitimately moves from one connection label to the other reads as a collision until the old row is superseded by a re-mint.
- **D-3212** — Found in the whole-branch review; applied in the final fix wave. Spec §6's DDL declares `releases.tag`, `nodes.nodeId` and `update_intent.scope` as `TEXT PRIMARY KEY` with no `NOT NULL`, and SQLite's legacy rule for a non-`INTEGER` primary key on a rowid table admits NULL — more than one of them — so only the store writers' guards (`isReleaseTag`, `NODE_ID_RE`, `FLEET_SCOPE`) stand between a NULL key and a duplicate "row per key", and a NULL `nodeId` would also empty every `NOT IN (SELECT nodeId …)` roll-up in silence. The `programs.slug` precedent carries the same gap. `MIGRATIONS[13]` declares all three `TEXT NOT NULL PRIMARY KEY`: nothing any writer does changes, a NULL key becomes a constraint failure instead of a row, and the slot — frozen once merged and deployed — never needs a three-table rebuild to add it later. `node_release_refusals`' composite key already names both columns `NOT NULL`. Pinned by the migration test's `PRAGMA table_info` shape (`notnull = 1` on the three keys) and by a planted `INSERT` of a NULL key into each table, which must throw. Cost if wrong: none a writer can reach; a hand-written NULL-key row is refused rather than stored.
- **D-3213** — Found by review run 134 (F1, F8); applied in the coordinator's fix round 1, and CORRECTED by that same fix round's own review (I-1, I-2, I-3, m-1, m-2, m-3, m-5, m-6 — read together with this entry, not as a separate one, since nothing here merged before the correction landed). Spec §8/§9 says a NULL `highestVersion`/`previousVersion` is unconstrained (no floor file), but `tagLineFrom` folded absent, unreadable (EACCES, the D-3178 unmeasured fold, a refused symlink), too-large and garbled into one NULL, so `measurementFrom`/`upsertNodeMeasurement` overwrote a previously measured floor with NULL on every sweep whose floor file merely failed to read — a rolled-back node's sticky floor (decision 8) vanished on one EACCES, and a first-ever unreadable floor resolved as if the node had none at all, falling back to `currentVersion` (§9's unconstrained branch) rather than refusing to resolve. The fix ships a THIRD read-state, `TagFileRead` (`'measured' | 'absent' | 'unmeasured'`, declared once in `shared/api.ts`'s end-of-file update block, D-3188's block), and two new NOT NULL columns in the still-unmerged `MIGRATIONS[13]` `nodes` DDL, `floorRead`/`previousRead`, in the measurement writer group (`upsertNodeMeasurement`; `markUnreachable`'s placeholder INSERT writes both `'unmeasured'`, since nothing was ever measured for a connection that never answered). `tagStateFrom` (`inventory.ts`) reads absent-or-garbled as `'absent'` and unreadable/too-large/the shared per-node deadline as `'unmeasured'` — for THIS raw read only. **I-1's correction:** `floorRead`/`previousRead` describe the STORED value, not the raw read — `measured` and `absent` both mean "something WAS measured, this sweep or carried"; `unmeasured` means NOTHING has EVER been measured for this row, so it always pairs with a NULL value — with one named exception (re-review N-2, safe in direction, reachable only after a ROLLBACK from a newer build): an out-of-vocabulary stored `floorRead` token (one this build does not know, written by a newer build) folds to `'unmeasured'` on read while `highestVersion` stays whatever that newer build last wrote — a non-NULL value paired with `'unmeasured'`. The row still resolves normally off that value (the short-circuit only fires when `highestVersion` is ALSO NULL), so the fold alone loses nothing; the loss comes one sweep later, if the floor file then reads unmeasured too: the carry guard sees a row already labelled `'unmeasured'` and has nothing it will carry, so the value is dropped to NULL and the row genuinely becomes "never measured" — at which point the resolver correctly REFUSES to resolve rather than wrongly falling back to `currentVersion` as unconstrained, which is the safe failure. On an unmeasured raw read, `applyMeasurement` carries the row's own previous (VALUE, STATE) pair forward unchanged when the row's own prior state was itself not `unmeasured` — never just the value, which was the original defect: a previously-absent floor (a real, measured "no floor") would relabel itself `unmeasured` on the next EACCES and the resolver would wrongly refuse to resolve an always-unconstrained node. Only a row with no prior measurement at all reads `unmeasured` here. The resolver (`resolve.ts`) refuses to treat a NULL `highestVersion` as unconstrained when `floorRead === 'unmeasured'`: it resolves `desiredTag: null` with `RESOLVE_DETAIL.floorUnmeasured()` — reworded by m-2 to "this node's floor has not been measured — nothing resolves until it is", so it also holds for `markUnreachable`'s never-reached placeholder, not only a floor file that failed to read — rather than falling back to `currentVersion`; a carried floor still constrains normally regardless of `floorRead`'s label. F8's companion defect was in the SAME fold, on the report side: `applyMeasurement`'s D-3210 override stored NULL — "no report file" (§6) — for a first sweep, or a row whose `reportedPhase` was already NULL, whose `update.json` merely failed to read; the fix falls back to the report `reportFrom` already computed (`unknown`, never NULL, for a file that exists but could not be read) instead of nulling it out: `report: previousReportOf(preRow) ?? m.report`. **m-5:** `tagLineFrom` had no non-test caller once `tagStateFrom` replaced it and is deleted; its tests moved onto `tagStateFrom` directly. **m-6 (a deliberate asymmetry, not a defect):** `too-large` reads `unmeasured` for floor/previous, but `stampFrom` reads the same condition `malformed` (measured-bad) and D-3210 reads a too-large report `unknown` (measured-bad) — so a garbled SMALL floor is unconstrained while a garbled 70 KiB floor with no previous value blocks resolution forever. This follows directly from the ruling that only `absent`/garbled-but-small is a real "no floor" measurement; a body too large to validate was never actually read as a tag one way or the other, so it cannot be measured-absent either. Pinned by: a measured floor surviving an unreadable sweep with BOTH the value and the `'measured'` state carried; an absent floor ALSO surviving an unreadable sweep, carried as `'absent'`, still unconstrained (I-1's own regression case); a first-ever unreadable floor (`highestVersion` stays NULL, `floorRead: 'unmeasured'`, never resolves as unconstrained); an absent floor determined fresh (unconstrained exactly as before, `floorRead: 'absent'`); a too-large floor (`unmeasured`, never folded into absent); the shared per-node deadline expiring on the floor read alone, isolated from every other file (m-3); an end-to-end first-sweep-unreadable-floor case from a real sweep through `resolveInputFor`/`resolveNodeIntent` to the stored `floorUnmeasured` sentence (m-3); the same carry-forward AND a first-sweep-unmeasured case for `previousVersion`/`previousRead` (m-3); the resolver's `floorUnmeasured` sentence, bare, pinned, and on `markUnreachable`'s placeholder row through a real `resolveAndProject` (m-2); a carried floor STILL constraining a ROLLED-BACK node exactly as a fresh floor would, with `currentVersion` and `highestVersion` deliberately DIFFERENT so an unconstrained answer and a constrained one diverge (I-3 — the original pin used `currentVersion === highestVersion`, so the two answers coincided and a broken resolver passed it); and F8's first-sweep and NULL-phase-row unreadable-report cases reading `reportedPhase: 'unknown'`, never NULL, plus a `reportedPhase !== null` pin after D-3214's own stamp-unmeasured sweep (I-2, cross-referenced there). Mutations, each measured red: folding `'unmeasured'` back into `'absent'` inside `tagStateFrom`; deleting the resolver's `floorRead === 'unmeasured'` branch; reverting the F8 report override to write NULL unconditionally; and (I-3) treating any carried/unmeasured-sweep floor as unconstrained inside `floorOf`'s call, which the corrected rolled-back pin now catches (it did not, against the original pin). Cost if wrong: a node with a stale-but-known floor or a real `update.json` shows as unconstrained or report-less for as long as the file underneath happens to be unreadable — silently loosening or hiding exactly the state D-3202's sticky floor and §8's report semantics exist to keep; before the I-1 correction, a previously-absent floor would have gone the OTHER way and refused to resolve a node that was always unconstrained. **R4's extension (fix round 2, review run 143):** the store and the resolver drew this distinction, but `NodeWire` (`shared/api.ts`) carried only `highestVersion`/`previousVersion`, so `GET /api/updates` gave the same `null` for "no floor, unconstrained" (`floorRead: 'absent'`) and "floor never measured, nothing resolves" (`floorRead: 'unmeasured'`) — an adapter (`toNodeWire`, `server/src/update/routes.ts`) narrowing a distinction it received, one seam past where D-3213 drew it. `NodeWire` now carries `floorRead?`/`previousRead?: TagFileRead`, additively and OPTIONAL (an older fixture or consumer omits them; the wire's own reader must treat absence as "not reported", never as `'measured'` — no `FLEET_PROTO` bump); `toNodeWire` always sends both, since the row always has them. No reader exists in `pwa/src` yet (W2 ships no PWA change) — the first one W3 adds must read this field rather than re-derive the distinction from `highestVersion` alone. Pinned by `update-routes.test.ts`: the same NULL `highestVersion` on two rows, one `floorRead: 'absent'` and one `floorRead: 'unmeasured'`, read apart off `GET /api/updates`; and `toNodeWire` never omitting either key. Mutation, measured red: deleting the `floorRead`/`previousRead` assignment in `toNodeWire` reds both the new pins and the pre-existing full-wire-shape case.
- **D-3214** — Found by review run 134 (F2, item 12); applied in the coordinator's fix round 1, after D-3213, and CORRECTED by that same fix round's own review (I-2, m-1 — read together with this entry). Spec §8's phase table settles a `done` report by comparing `m.currentVersion` to the report's `target`, but `currentVersion` reads NULL both for a genuinely unversioned build and for `stampRead !== 'ok'` (an unreadable or malformed `build.json`) — so a `done` report seen while the stamp merely failed to read was answered `release: failed, stamp-mismatch`, releasing a real lease on no evidence at all. `leaseActionFor`'s `'done'` arm — INSIDE the phase `switch`'s own `case 'done':`, not ahead of it (m-1: an earlier version of this entry used to claim otherwise) — now checks `m.stampRead === 'ok'` first and, when it is not, gives NO verdict: `{kind: 'none', why: 'stamp-unmeasured'}`, leaving the lease pending. Because `sweepPlanFor` acts only on a CHANGED report (Review Focus 2, D-3210's own gate), a `done` report evaluated once while pending must not be "seen" in a way the changed-report gate later treats as unchanged once the stamp reads fine: `applyMeasurement`, after computing the plan, restores the row's own previous report before the upsert whenever the verdict was `stamp-unmeasured` — so the NEXT sweep's identical report reads as CHANGED against what is actually stored, and `leaseActionFor` runs again once the stamp is readable. **I-2's correction:** the restore's fallback for "no previous report to carry" was `previousReportOf(preRow)` alone, which stores NULL — "no report file" (§6) — for a busy row's FIRST `update.json`, finishing inside one sweep while the stamp happens to be bad; that update.json WAS read fine (only the stamp is unmeasured), so NULL there is exactly the shape F8 (D-3213) was ruled against, on the report side, and was not applied here. The fallback is now a shared, guaranteed-non-NULL sentinel, `UNKNOWN_REPORT` (the same shape `reportFrom`'s own `unknown` fold produces, now a named constant both functions share) — never `m.report` itself, because storing the REAL unchanged `done` report would make the very next identical sweep read as unchanged too, wedging the gate exactly like the bug this override exists to fix. Item 12, found and fixed alongside it: a report naming no `startedAt` at all (`latestStartOf` returns NULL) skipped the whole precedence guard and fell through to settle/release a lease it never announced starting to; `leaseActionFor` now treats a NULL `r.startedAt` as `{kind: 'none', why: 'stale-report'}` unconditionally, placed right after the BUSY proof and ahead of the numeric precedence check, reusing the existing `stale-report` word rather than minting a new one for the same practical meaning ("this report cannot be shown to belong to any run of this lease"). `failed`/`reverted` — which never read `currentVersion` — are untouched by the stamp gate regardless of its placement, and a report WITH a start is untouched by the item-12 guard. Pinned by: a `done` report with `stampRead` `'unreadable'`/`'malformed'`/`'absent'` giving `stamp-unmeasured` while `failed`/`reverted` under the same unmeasured stamp are unaffected; a `stampRead: 'ok'` twin beside the existing stamp-mismatch case (still releases `failed: stamp-mismatch`); a two-sweep store-level case — stamp unreadable + `done` stays pending (`updateState` unchanged, `reportedPhase` NOT null, I-2) — then stamp readable + the SAME report settles it; and a report with `startedAt: null` on a busy row (with a null or non-null `row.updateStartedAt`) always reading `stale-report`. Mutations, each measured red: removing the `stampRead === 'ok'` gate from the `'done'` arm; removing the report-restore override on a `stamp-unmeasured` verdict (the two-sweep case would then settle on sweep 1 or never settle on sweep 2); and removing the unconditional `startedAt === null` branch. Cost if wrong: a `done` report racing an unreadable stamp fails a real in-flight update with no evidence, or (item 12) a malformed report with no start time settles or fails a lease it says nothing about; before the I-2 correction, a node's very first reported update racing a bad stamp would show as "no report file" on the wire for as long as the stamp stayed bad. **Fix round 2 (R11):** the restore's OTHER branch — a busy row that already carries a real previous report (`reportedPhase` non-null) when the stamp-unmeasured verdict fires — had no case distinguishing `previousReportOf(preRow) ?? UNKNOWN_REPORT` from a bare `UNKNOWN_REPORT`: every existing case reached this line with `preRow.reportedPhase === null` (the row's first-ever report), so collapsing the expression to the placeholder alone left `update-inventory.test.ts` fully green. Added: a case that first lets a real 'installing' report land on the row (in-flight, so the lease is untouched), THEN sends a 'done' report while the stamp is unreadable — pinning that the restore recovers the row's own prior report ('installing'), never `UNKNOWN_REPORT`'s bare 'unknown' phase, which would erase a real, already-stored verdict. Mutation, measured red on a scratch copy: replacing the line with `m = { ...m, report: UNKNOWN_REPORT }` reds only the new case (80/81 → the new case fails; the other 80 stay green, confirming no prior case told the two apart). The same-shaped `??` at `inventory.ts:542` (D-3213/F8's report override) is already told apart by the pre-existing "ack, an unreadable sweep, then the same standing report" case, which plants a non-null `reportedPhase` ('failed') before the unreadable sweep — that instance of the class was already covered. One further instance was examined and left unaddressed: `unreachable()`'s `r.supersededBy ?? 'held by a live row under another label'` (`inventory.ts:501`) has only its non-null (`supersededBy` set) arm pinned; the null arm requires a live, non-superseded row keyed by `nodeId = label` whose own `.label` column differs from `label` — a state the schema's own invariants (a placeholder's `nodeId` and `label` are always written equal, D-3184) appear to make unreachable through any writer this wave ships, so a test for it would either be dead code or would have to violate that invariant directly via raw SQL to force a state no writer produces. Left to wave 5's judgment rather than added speculatively.
- **D-3215** — Found by review run 134 (the worker's W3/W4 prerequisite, ruled into fix round 1). Spec §7 issues one `GET {api}/repos/{owner}/{repo}/releases?per_page=30` per poll and marks a known release absent from that window `yanked` (D-3185's `newest-page`/`complete` split); the coordinator measured the live fleet's real catalogue — 18 releases published, the current STABLE release is the 8th newest (seven dev prereleases sit above it) — and found that within days of continued dev-channel publishing the stable release falls off page 1 entirely, at which point a fresh `coord.db` resolves `'*'` on the `stable` channel to "no eligible release": the resolver's `eligibleTags` never sees a row for it at all, not even a yanked one. The poller therefore ALSO issues a second, independent conditional GET every poll, `GET {api}/repos/{owner}/{repo}/releases/latest` — GitHub's own answer to "the current stable release", which is not a function of any page window — with its OWN `If-None-Match` ETag (never the listing's), the same base gate, `redirect: 'error'`, the same 10 s deadline and the same `CATALOGUE_BODY_MAX_BYTES` cap, parsed by the SAME per-element parser (`parseReleaseElement`) the listing uses. Its answer is upserted through the one catalogue writer, `applyReleaseListing` (D-3180) — never a second writer — under a THIRD `ListingCoverage` value this deviation adds, `'single'`: one release, no absence judgment at all (the yank `UPDATE` does not run under it), because the latest probe proves nothing about any OTHER release's presence and running the existing `'newest-page'`/`'complete'` yank logic over a listing of exactly one row would mark every other known release yanked. A 404 (no stable release exists yet) and a 304 (unchanged) are both ANSWERS, never failures. `catalogueState` (`lastOkAt`/`lastError`) follows the LISTING alone, unchanged by this deviation (D-3197's rule): a failed latest fetch (network, a non-2xx status other than 304/404, a parse failure, or an over-cap body) never sets `lastError` and never blocks `lastOkAt` — it only `console.warn`s once per distinct cause, deduped on the message and re-armed the next time the latest probe answers (200 applied, 304, or 404). This doubles the poller's request rate — at most 6 requests an hour at the 30-minute cadence (the probe, the listing, and — only on a poll where the probe moved away from the kept stable (ruling A) — one tag fetch), well under the unauthenticated 60/hour budget (§7). R1 (fix round 2, review 143) CORRECTS what this sentence implied: that figure holds only for the SCHEDULED 30-minute cadence — the operator's on-demand `POST /api/updates/refresh` was rate-limited independently, at one POLL a MINUTE (`routes.ts`), and since an admitted poll can itself cost up to three requests, a thumb refreshing once a minute could add up to 180 more requests an hour on top of the scheduled cadence, three times the whole budget. D-3218 corrects the door's own interval.

  Amended, fix round 1 review round 2 (I2): `poll()` originally returned a `CatalogueState` snapshot captured BEFORE `pollLatest` ran, though it fully awaited `pollLatest` before resolving — so a bug that made `pollLatest` touch `lastOkAt`/`lastError` would have been unobservable through `poll()`'s own return value; the reviewer measured three such mutations (`warnLatest` also setting `lastError`; a 404 answered as a failure; `latestEtag` advanced on a failure) staying green. `poll()` now resolves with `snapshot()` taken AFTER both requests settle, and the test suite additionally asserts `state()` after each `poll()` rather than only its return value, so any future violation of "the latest probe never touches catalogueState" is observable.

  Amended, fix round 1 review round 2 (I3): the LISTING's own absence judgment could still yank the tag the latest probe just confirmed, and then never recover it, because a 304 on the latest probe (the common case) writes nothing — the reviewer measured the exact sequence: a release published INSIDE the listing's window but not itself listed (it sorts off page 1) is yanked by the next `complete`/`newest-page` listing, the latest probe's next 200 un-yanks it, but the FOLLOWING 304 leaves it yanked again with nothing to reverse it — reintroducing D-3215's own failure one layer down. The poller remembers `lastLatestTag`, the tag of the latest probe's own last SUCCESSFUL upsert (process memory, like the ETags, D-3182), and passes it to `applyReleaseListing` as a NEW fourth parameter, `keepTags` — tags the yank statement excludes from `tag NOT IN (…)` without themselves being upserted or counted. This is still the ONE catalogue writer (D-3180): `keepTags` is an exclusion list on the SAME statement, not a second writer, and `update-writer-groups.test.ts` stays green.

  Amended, fix round 2 (N1): the version of I3 above ran `pollListing` BEFORE `pollLatest`, so the keep it read was the PREVIOUS poll's answer — a re-review measured this as a NEW regression: the listing's own ETag advances on the poll that applies a stale keep, so a LATER listing answers 304 and writes nothing, and a 404 never released the kept tag, so a genuinely WITHDRAWN stable release could stay `yanked = false` — and keep resolving as the fleet's desired stable — until the next real release or, in the 404 case, forever. Fixed by running the latest probe FIRST every poll (`pollOnce`), so `pollListing` always reads THIS poll's answer: a 200 sets the kept tag to the one just confirmed; a 304 leaves it unchanged; a 404 CLEARS it (`lastLatestTag = null`, `latestEtag = null` alongside it); any other probe failure (network, an over-cap or malformed body, a redirect, a draft-or-prerelease rejection, a non-2xx status) leaves it unchanged too — a TRANSIENT failure must not yank the previous stable on a guess. Whenever the kept tag CHANGES this poll, the listing's own ETag is dropped (`etag = null`) before the listing request, forcing a full 200 that re-judges absence against the NEW keep set — without this, a listing that would otherwise answer 304 to its old ETag writes nothing, and the withdrawn release is never re-observed as absent.

  Amended, fix round 1 review round 2 (item 4): `/releases/latest` never legally answers a `draft` or a `prerelease` element (GitHub's own contract for the endpoint); such an answer is now treated as a FAILED latest — warned, deduped, neither `latestEtag` nor `lastLatestTag` advanced — never written, so it can neither yank nor un-yank nor alter an existing row.

  Also amended (minors): `applyReleaseListing` under `'single'` coverage now refuses outright (`single-not-one`, a new `UpdateStoreRefuseCode`) a listing whose length is not exactly 1, rather than silently upserting every row with no yank judgment at all — the coverage name is a promise about its own argument, not just about what happens next; the F9 redirect fixture's `Location` is a loopback address, so the reviewer's own mutation (removing `redirect: 'error'`) cannot make a test process actually dial out; `DOWNLOAD_URL_MAX` (D-3216/F10) gained its own pin (a URL at exactly the cap kept, one byte over refused). Fix round 1's minor "skip the latest probe entirely when the listing itself answered rate-limited" is RETIRED by fix round 2's reordering: it depended on the listing running first, and running the listing first is exactly what produced N1 — both requests are now sent every poll regardless of either one's status. Also amended (N2, fix round 2): the `'@'`-refusal's "no request sent" claim (I1) had no pin that could go red, because the only poller-level no-request test used a base `BASE_URL_OK` ALSO refuses on its own (a non-loopback `http:`); a new case builds the bad base from the loopback fixture itself (which `BASE_URL_OK` alone WOULD accept) and asserts zero requests, so the `'@'` check's OWN gate is what the pin now exercises. Also amended (N3, fix round 2): the draft/prerelease pin (item 4) named its draft/prerelease answers under tags that were never existing rows, so "does not touch an existing row" was unexercised; it now names the ONE existing listed row in both the draft and the prerelease answer and asserts that row's own `yanked` stays `false`.

  Amended, fix round 1, item 5 (ruling A): even after N1, an off-page stable that is WITHDRAWN or DEMOTED while it sits outside the listing's own window (D-3215's own shape) was never re-judged — the listing's absence judgment only covers `publishedAt >= min(listed)`, and `keepTags`/`lastLatestTag` only ever GRANT immunity from that judgment, never withdraw it, so a withdrawn or demoted stable stayed resolvable for the life of `coord.db`. The poller now detects the moment `/releases/latest` moves AWAY from the kept tag K — a 404, or a 200 naming a tag OLDER than K by `compareReleaseTags` (a NEWER tag implies nothing about K, and is adopted as the new K normally, with no extra request) — and issues ONE further request, `GET {api}/repos/{owner}/{repo}/releases/tags/{K}`, with the same base gate, deadline, body cap, element parse and `redirect: 'error'` the other two requests use. A 200 upserts K through the SAME one writer under `'single'` coverage (a demotion to prerelease flips K's channel to `dev` via the ordinary upsert; a demotion to draft yanks it via the ordinary birth rule) — never a second writer. A 404 yanks K through a FOURTH `ListingCoverage` value, `'withdrawn'`: an empty listing that marks EXACTLY the one tag its new `withdrawTag` argument names, never the general `since`/window judgment (D-3185), so it can never touch any other row. Any failure of this check (no-egress, over-cap, a redirect, a non-2xx status, a malformed body) changes nothing: K stays exactly what it was, `latestEtag` is not advanced to the newer `/latest` answer's own etag either, so the NEXT poll's `/latest` request cannot get a cheap 304 in its place and is forced to re-answer in full, and the check is retried against the SAME K. K is never a stored column — the poller derives it on demand, whenever its own remembered tag has gone null (poller creation, or once this mechanism's own resolution clears it in the pure-404-on-`/latest` case), as `CoordStore.newestUnyankedStable()`: the newest un-yanked `channel = 'stable'` release BY TAG (`newestTag`/`compareReleaseTags`, never `publishedAt`) — so a restart re-derives the same pending check from the store alone, with no new column and no new process-memory slot beyond the existing ETag/tag variables (D-3182). Named, not closed: an OLDER off-page stable that is demoted or withdrawn while a DIFFERENT, newer stable sits at `/latest` is invisible to this mechanism too — it only ever inspects K, the ONE tag `/latest` most recently confirmed, never any other off-page row — which matters only for a rollback TARGET below the current stable, carried by programme wave 5.

  Amended, fix round 2 (R2, review 143, coordinator's ruling): ruling A's tag-check 404 arm acted on the evidence of `GET /releases/tags/{k}` alone, with no correlation to whether the REPOSITORY was answering anything at all — an unauthenticated client gets 404 on every endpoint when the owner/repo is misconfigured, private or deleted, and the mechanism as shipped would yank one known stable release per poll (each poll re-deriving K as the next-newest un-yanked stable) until the whole catalogue was gone, on no evidence any SPECIFIC release had actually vanished — measured by the reviewer with fetch stubbed to 404 everywhere and three known stables, yanked one per poll across three polls. The ruling: a moved-away judgment may act on the store ONLY once THIS SAME POLL's listing has itself answered with a fresh 200 body. `measureWithdrawn` (renamed from `checkWithdrawn`, which now only measures — it never writes) still fetches K's own tag exactly as before and returns what it would do as a `PendingWithdrawal`; `pollLatest` returns that value rather than applying it; `pollOnce` calls `applyWithdrawn` only when `pollListing`'s own `freshOk` (a fresh 200 the store accepted — never a 304, which carries no body at all) is true for the SAME poll. A poll whose listing never gets a fresh 200 (a repository-wide outage, or a run of 304s) defers forever, harmlessly: nothing changes, and the very next poll re-measures the same confirming fetch against the SAME K (N1's ordering and the `etag = null` reset on a pending withdrawal, not only an immediate identity change, keep the listing's own request fresh enough for the gate to fire the moment real evidence exists; since fix round 3, B2, reshaped fix round 4, F1/F6 — CORRECTED: that reset is skipped ONLY when the REMEMBERED last fresh listing's own per-tag facts already CONTRADICT the pending — a non-draft row for a yank, a non-draft STABLE row for a demote — never merely because a remembered listing once named K at all. A remembered listing drops nothing by itself: only THIS SAME POLL's own fresh listing can drop a pending action; with the ETag kept, a 304 carries no fresh body, so the pending is simply DEFERRED, exactly as it would be with no listing evidence at all, never dropped by a stale memory). `measureWithdrawn`'s own request cadence is unchanged — one confirming fetch per poll while a transition is pending, never a loop — so this does not touch the quota (D-3218's derivation is unaffected). Pinned by: a fixture where every endpoint 404s for three whole polls — nothing is yanked, and the SAME newest known stable's tag is re-confirmed every poll, never advancing to the next-newest (which the ungated mechanism would have reached by poll 2). Mutation, measured red: reverting `pollOnce`'s `pendingWithdrawal !== null && listing.freshOk` gate to an unconditional apply reproduces the reviewer's three-releases-in-three-polls yank.

  Amended, fix round 3 (B1, coordinator's ruling, review 146): fix round 2 (S1) had added `measuredCurrentK()` — `currentK()`'s only caller-visible read that can throw (a SQLite error, or a `RangeError` from `newestTag` over a non-tag `releases.tag` row) wrapped so a throw cannot reject `poll()` itself — but its 200 arm (a `/latest` 200 confirming a newer-or-equal tag) folded a throw into `k: null`, the SAME branch a legitimate "no K yet" takes, and then advanced `lastLatestTag`/`latestEtag` to the tag it had just confirmed exactly as that legitimate case does. That fold is PERMANENT: `currentK()` never reads the store again once `lastLatestTag` is non-null, so one transient store throw could leave a genuinely withdrawn stable release un-yanked until a restart — the "this poll" language the docstring used for the effect was true only of the 404 arm, which already refused this same fold on purpose. K's failure arm is now uniform across both arms: a throwing store read is "K unknown" — on the 404 arm nothing moves (unchanged since fix round 2); on the 200 arm it is now ALSO read as a FAILED PROBE, advancing neither `lastLatestTag` nor `latestEtag` (T's own unconditional `'single'` upsert still runs and is harmless), so the very next poll re-reads the store instead of trusting a stale memory. Pinned by: a restart (a fresh poller, `lastLatestTag` null), a store holding a stable K published OFF the listing's window, `newestUnyankedStable()` throwing on its first call only, and `/latest` answering 200 naming an older tag T on both polls — poll 1 sends no tag-check request at all (the throw is read as "K unknown", never "no K"); poll 2, the store healthy again, tag-checks K for real and yanks it once `tags/K` answers 404. Mutation, measured red: restoring the fold (`const k = measured.threw ? null : measured.k;` with the old unconditional advance) reproduces the un-yanked-forever result; replacing `measuredCurrentK()` with a bare `currentK()` on this SAME arm (c6) rejects `poll()` on the throw, breaking its own "Never rejects" contract.

  Amended, fix round 3 (B2, coordinator's ruling, review 146): fix round 2 (R2)'s evidence gate above read only WHETHER this poll's listing answered fresh — never WHAT it said. A source whose listing endpoint alone stays live (a partial mirror, spec §7's own example) could apply a stale pending yank or demote against a K the SAME poll's own listing had just named as a live release, flipping the resolved stable tag every poll (measured by three lenses: two known stables alternating yanked/un-yanked poll to poll, every poll costing the maximum three requests, `etag` dropped each time so the listing never earned a 304). The ruling (round 3 shape — CORRECTED below, fix round 4, F1): THE LISTING WINS. When this SAME poll's fresh parsed listing names K at all — stable or prerelease, whatever the confirming tag check itself answered — the pending withdrawal is DROPPED, never applied: a pending `'yank'` is dropped because the listing just showed K is still there; a pending `'demote'` is dropped too, uniformly (when the listing names K stable, the tag check's own verdict is stale next to it; when the listing names it dev, the listing's own upsert already wrote that same fact, so applying the pending demote as well would be harmless but redundant — dropping it either way is simpler and costs nothing). Dropped = not applied: `lastLatestTag`/`latestEtag` stay exactly where they were, as for any deferred check. A second ruling covers the door's own cost: the poller now remembers what the last fresh, ACCEPTED listing named (`lastAcceptedListingTags`, process memory like the ETags, set only where `etag` itself is), and the pending-driven `etag = null` reset is skipped when that remembered content already vouches for the pending's K — a later poll's listing may then answer a cheap 304 that carries no fresh evidence either way, and the poll simply settles; the OTHER trigger (`lastLatestTag` itself changed this poll) is unchanged. Pinned by: a listing-only source (every other endpoint 404s) naming two stables, over four polls — neither is ever yanked, `lastError` stays null throughout, and from the poll after the first vouching listing on, the listing request carries `If-None-Match` and is answered 304; a pending demote dropped when the listing still names K stable, with the tag check retried against the SAME K (never the older `/latest` answer) on the next poll; the prerelease variant, where the listing's own upsert already demoted K. Mutation, measured red: dropping the `listing.tags!.has(pendingK!)` check (applying every pending withdrawal unconditionally on a fresh listing, the fix round 2 shape) reproduces the alternation and overwrites the dropped demote; reverting the ETag drop to unconditional-on-any-pending reds the settles/304 assertion.

  **CORRECTED, fix round 4 (F1, coordinator's reshaped ruling, review 149):** the round-3 shape above dropped a `'demote'` UNIFORMLY whenever the listing named K at all, including when the listing named K as DEV — which is the ordinary case an operator's own `gh release edit K --prerelease` produces, and is exactly what the check's own answer AGREES with. Dropping an agreeing demote is not "harmless but redundant": `applyWithdrawn` is the ONLY code that ever moves `lastLatestTag`/`latestEtag` to T, so dropping it left the kept tag pinned to K — now a dev release — forever, with `tags/K` re-asked and re-agreed-with on every subsequent poll, and a genuinely deleted OFF-PAGE T (never itself listed, so the listing's own absence judgment can't reach it) staying resolvable indefinitely. The reshaped rule: THE LISTING WINS ONLY WHEN IT DISAGREES. A pending `'yank'` disagrees with (and is dropped by) a listing naming K as any NON-DRAFT release. A pending `'demote'` disagrees with (and is dropped by) a listing naming K as a non-draft STABLE release, and — corrected by the round's own task review (I1), applying the ruling's headline where its list assumed a `'demote'` always carries a dev answer — by a non-draft DEV listing row whenever the check's OWN row (`measureWithdrawn` returns `'demote'` for every 200) is still stable or a draft: that check and the listing disagree, so the listing wins, and a stale "still stable" answer can never re-promote a demoted K nor a mirror's draft answer yank a live one. Only when BOTH say non-draft dev do they AGREE, and `applyWithdrawn` runs exactly as it would with no listing at all, moving the kept tag to T; the listing's own upsert having already written that channel is still harmless, just never a reason to ALSO drop the pending. A row present only as a DRAFT gives NO VERDICT either way (a draft never vouches) and is treated exactly like an absent row — the pending proceeds to `applyWithdrawn`. `pollListing` therefore returns per-tag FACTS (draft?, channel?), not a bare tag set, and the remembered listing memory (`lastAcceptedListingFacts`, widened from a Set to a `Map`) carries the same facts; ONE helper, `listingContradictsPending`, applies this exact predicate at BOTH the apply-decision site (this poll's own fresh facts) and the ETag-keep decision (the remembered facts) — so a remembered listing that would NOT contradict a pending (would let it apply) never suppresses the ETag reset that gets it a fresh answer: an AGREEING pending needs a fresh listing THIS poll to actually settle, or it would sit deferred forever behind a 304 that never carries the evidence `applyWithdrawn` requires (F1's own defect). The failed check's warning text also changes: `warnWithdrawn('listing-names-k')`, which read "moved-away tag check FAILED" for a check that SUCCEEDED and agreed with the listing, is replaced by a separate, correctly-worded, K-keyed warning (`ccrc-server: update catalogue listing contradicts the moved-away tag check for <K> (listing wins)`), deduped on K and re-armed by the next successful `applyWithdrawn` (`withdrawnAnswered()`). **F6 (prose, same finding):** the sentence above claiming the ETag reset "is skipped when the last fresh listing already names K, which would drop the pending action anyway" is corrected in place, above — a REMEMBERED listing drops nothing by itself (only THIS poll's own fresh listing can), and with the ETag kept a 304 DEFERS the pending rather than dropping it. **F7 (prose, same finding):** "the poll simply settles" is corrected too — vouching saves only the LISTING's own body (a cheap 304 instead of a full re-answer); it does NOT shrink the per-poll REQUEST COUNT. `/latest` and, while a check is pending, `tags/K` are still asked every poll regardless, so a vouched poll still spends the maximum `CATALOGUE_MAX_REQUESTS_PER_POLL` (3) requests — a 304 spends budget too (spec §7). The round removes the FLIP (a stale yank/demote re-applying against a K the listing just re-confirmed), never the COST. Pinned by (fix round 4): the reviewer's own demotion case (K demoted and listed as dev, `/latest` naming an older stable T — from poll 3 on `/latest` carries T's ETag, and `tags/K` is asked at most once across 5 polls); the reviewer's own deleted-T case (a full page of 29 newer dev releases plus K; K demotes so the older, off-page T becomes the kept tag; T is later deleted for real — T ends `yanked: true`, and `newestUnyankedStable()` answers `null`); a pending `'yank'` meeting a listing that names K only as a DRAFT still applying (observed via the NEXT poll's own `/latest` ETag, since the store's ordinary birth rule yanks a draft row either way and cannot itself distinguish drop from apply). Each reds under the round-3 uniform-drop mutant (`facts.has(k)` alone, ignoring `draft`/`channel`); the draft case ALSO reds under a narrower mutant that lets a draft row vouch (`fact === undefined` alone, dropping the `|| fact.draft` half). I1 (task review), each measured red: the round-4 list's predicate (`fact.channel === 'stable'` alone) reds a stale-stable `tags/K` meeting a dev listing (K would end stable and `newestUnyankedStable()` would answer the demoted K) and a draft `tags/K` meeting it (K would end yanked); dropping the check-stable term alone reds the first; dropping the check-draft term alone reds its draft-prerelease variant; and the ETag-keep site alone reverted to "the remembered listing names K" reds a remembered listing that AGREES with a pending demote (its listing request would carry the old ETag).

  **Added, fix round 4 (F3, coordinator's ruling, review 149):** fix round 3's B1 (above) refused to advance `lastLatestTag`/`latestEtag` on a `measuredCurrentK()` throw on the `/latest` 200 arm — correct for a TRANSIENT throw, but a PERSISTENT one (a store that never recovers) then left `lastLatestTag` null (or a stale pre-throw value) FOREVER: `keepTags` never protects the tag `/latest` just confirmed, so the listing's own absence judgment could yank it, and `latestEtag` never advances, so `/latest` never earns a cheap 304. The fix adds ONE flag, `kNeedsReread` (the coordinator's own suggested representation), beside `lastLatestTag`. On a throw: `lastLatestTag = row.tag` (T, THIS poll's confirmed `/latest` answer) — so `keepTags` protects it THIS poll and every later one — `latestEtag` is left untouched (never advanced, so the next `/latest` request cannot get a cheap 304 in T's place and must re-answer in full), and `kNeedsReread = true`. `currentK()` reads the store fresh whenever `lastLatestTag === null || kNeedsReread` — so a value a throw borrowed for `keepTags`' sake is never mistaken for a measured K. A clean adopt (no move-away) clears the flag alongside the ordinary `lastLatestTag`/`latestEtag` advance; a confirmed move-away's own `applyWithdrawn` success clears it too (`lastLatestTag = pending.t`, `latestEtag = pending.tEtag`); a DROPPED, DEFERRED or FAILED check leaves it set, so the very next poll re-reads K from the store again rather than silently trusting the borrowed value — never falling back to treating T as K. The 404 arm is unchanged in shape; its own "no K" branch (`measured.k === null`) clears the flag alongside `lastLatestTag`/`latestEtag`, since there is then nothing left to re-read. Pinned by: an always-throwing store with `/latest` naming T every poll, over 3 polls — every poll resolves, T is passed in `keepTags` every time (asserted via the store double's own received `keepTags`), and T stays un-yanked against a `'complete'`-coverage listing that never lists it; B1's own existing case (one throw, then a healthy store) still passing unmodified; a throw, then a healthy read that finds a move-away whose OWN tag check then fails (500) — the poll AFTER re-reads K from the store again and re-checks the SAME tag, proving the flag was not cleared by the failed check. Mutations, each measured red: not setting `lastLatestTag = row.tag` on a throw (reds the always-throwing case); clearing the flag on the read instead of on `applyWithdrawn`'s own success (reds the throw-then-fails case); `currentK()` ignoring the flag entirely (reds B1's own case, since the borrowed value would then be trusted as K on the poll it should have re-read).

  Pinned by: an off-page stable (a full 30-element listing of newer dev prereleases that never names it; the latest probe answers it) becoming a listed, un-yanked row, and `resolveNodeIntent` giving `desiredStable` that tag on a fresh store with a floor below it, INCLUDING an assertion that every one of the 30 dev releases the listing wrote in the SAME poll stays un-yanked (the pin that actually reds the `'single'`→`'complete'`/`'newest-page'` mutation at the real call site — the store-level control case shows the mechanism in isolation but does not itself exercise `pollLatest`); a 304 on the latest probe writing nothing (store call count and rows unchanged) while carrying its own ETag on the second poll, independent of the listing's; a 404 on the latest probe leaving `lastError` null, `lastOkAt` moving with the listing, and warning NOTHING (the assertion that actually reds a 404-treated-as-failure mutation, since lastError/lastOkAt cannot see it either way); a failed latest fetch alongside an OK listing moving `lastOkAt`, leaving `lastError` null (checked via `state()` after `poll()`, not just its return), and warning once — re-armed by the next latest success; a failure answer that itself carries an `etag` not advancing `latestEtag` (the next request still carries no `if-none-match`, never the failure's own etag); the later full-coverage-window listing that still omits the off-page stable NOT yanking it, both via the window mechanism alone (`since` sits above the stable's older `publishedAt`) and, separately, via `keepTags` across a run where the stable DOES sit inside the window (the pre-existing I3 sequence, unmodified — see (d) below); a draft or prerelease answer from `/releases/latest`, EACH NAMING THE ONE EXISTING LISTED ROW, never being applied and never touching that row's own `yanked` (N3); a rate-limited listing no longer skipping the latest probe (the retired minor, re-pinned to the new behaviour); `'single'` coverage refusing a 0- or 2-row listing outright; and four N1 cases: (a) a stable release DELETED with `/latest` moving to an older one — the deleted one is yanked that poll, verified by `store.releases()` (fix round 3, B2: the listing's second request now carries poll 1's ETag, because poll 1's listing named the tag the pending action is about — these two cases now pin B2's ETag keep, not the drop), with `resolveNodeIntent` following the survivor; (b) the same shape for a release WITHDRAWN TO DRAFT (absent from the listing); (c) the ONLY stable release deleted with `/latest` answering 404 — yanked (fix round 3, B2: its second listing request likewise keeps poll 1's ETag); (d) the original I3 sequence (a release inside the listing's window but never listed, `/latest` answering 200 then 304 then 304) STILL staying un-yanked on every poll, proving this fix does not reintroduce the failure it sits on top of; and five more cases (fix round 1, item 5, ruling A): (a) a full page of 30 newer dev prereleases, `/latest` answering 200 K then 404 — K ends yanked; (b) `/latest` moving to an older stable S (a demotion) — K ends `channel: 'dev'`, not yanked, and `'*'` on `stable` resolves to S; (c) a newer `/latest` answer leaving K untouched, with NO tag-fetch request sent at all; (d) a failed tag fetch (a 500) leaving K untouched, and the very next poll retrying it; (e) after a restart, a fresh poller over a store already holding K as its newest un-yanked stable, `/latest` answering 404 — the tag fetch fires anyway, derived from the store, not from any surviving process memory. Mutations, each measured red: dropping the `pollLatest` call entirely; passing `'complete'`/`'newest-page'` instead of `'single'` for the latest upsert; `warnLatest` also setting `lastError`; a 404 answered as `warnLatest('http-404')` instead of `latestAnswered()`; advancing `latestEtag` before the status checks; dropping the `keepTags` exclusion or the `lastLatestTag` update; dropping the draft/prerelease guard (N3: now that it names an existing row, this also proves the row is left untouched); dropping the `single-not-one` length check; dropping the `'@'` refusal at `pollOnce`'s early return (N2: the request is then actually sent); reverting to the pre-N1 call order (reds N1(a)/(b)/(c)); not clearing the kept tag on a 404 (reds N1(c)); not dropping the listing's ETag when the kept tag changes (reds ruling A (c); fix round 3 moved N1(a)/(c) to pinning B2's keep); passing a NEWER `/latest` tag through the moved-away check (reds (c) — a tag-fetch request is sent where none should be); the check's 200 arm passing `'complete'`/`'newest-page'` instead of `'single'` (reds (b) — every other known release ends yanked); the check's 404 arm passing `'newest-page'`/`'complete'` instead of `'withdrawn'`, or naming any tag but K (reds (a), and a planted second stable row stays wrongly yanked); advancing `latestEtag`/K on a failed check (reds (d) — the retry never fires, since the next poll's `/latest` request would get a 304 in T's place instead of re-answering in full). Cost if wrong: an off-page stable release is invisible to every node on the `stable` channel until either it falls back onto page 1 (never, once the dev channel outpaces it) or a human pins the exact tag by hand; a residual named by the N1 fix rather than eliminated by it — a TRANSIENT latest-probe failure (a timeout, a 5xx, a malformed body) leaves the previous stable KEPT and listed un-yanked until the probe next answers, which is correct for a genuinely transient failure but means a run of failures delays a real withdrawal's yank for exactly as long as the probe stays unable to answer; and the residual ruling A itself does not reach — an OLDER off-page stable that is withdrawn or demoted while a DIFFERENT, newer stable sits at `/latest` stays invisible, since this mechanism only ever inspects the ONE tag `/latest` most recently confirmed — matters only for a rollback target below the current stable, carried by programme wave 5. R2's own cost, corrected here: before fix round 2, a repository that stopped answering at all — never a real withdrawal — would have its known stable releases yanked one per poll until none were left; the evidence gate above closes that.
- **D-3216** — Found by review run 134 (F10, F11; ruled into fix round 1, same dispatch as D-3215, cited after it). Two untrusted-listing-field bounds, one number because both are "what a node may safely be handed off an unauthenticated GitHub listing" (spec §7's "defensive parse", extended past D-3209's body/element-count bounds to the FIELDS themselves). **F10 — the download URL:** the poller's `DOWNLOAD_URL = /^https?:\/\/\S+$/` accepted plain `http:`, control bytes, non-ASCII bytes and userinfo, and a review finding treated any failure as grounds to SKIP THE WHOLE ELEMENT — but the release itself (its tag, channel, publication date, notes) is real and useful even when its one download link is not; withholding the release along with the link punished every OTHER reader of the catalogue for one bad field. `safeDownloadUrl` replaces the regex with a parsed check — `new URL` succeeds, `protocol === 'https:'` exactly, the raw string is printable ASCII only (`/^[\x21-\x7e]+$/`), no userinfo, and the existing `DOWNLOAD_URL_MAX` (2048) length, checked on the raw string AND on the stored, normalised `u.href` (fix round 2, R7/S2: the stored form is `u.href`, and a raw `\` is refused) — and a row that fails it stores `tarballUrl: NULL` while the release stays listed. `ReleaseListingRow.tarballUrl` and `ReleaseRow.tarballUrl` widen to `string | null` accordingly; the `releases` table's own `tarballUrl TEXT NOT NULL` column is UNTOUCHED this wave (no new migration slot, and `MIGRATIONS[13]` is a cross-branch namespace no fix round may spend) — `''` is the one on-disk sentinel for "no url", written and read back at the SINGLE seam that already owned this column (`applyReleaseListing`'s `INSERT` and `releases()`'s mapping in `server/src/coord/store.ts`), so no other reader of a `ReleaseRow` ever sees the sentinel, only `null`. **F11 — the tag bound, INGRESS ONLY.** GitHub's `tag_name` is untrusted text, and `shared/api.ts`'s `RELEASE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/` admits a leading zero in any component (`v0.0.010`) that `shared/semver.ts`'s `compareReleaseTags` would then treat as a SECOND spelling of `v0.0.10` rather than recognising the same release — `RELEASE_TAG`/`isReleaseTag` are deliberately UNTOUCHED (`update-states.test.ts` pins `RELEASE_TAG.source` byte-equal to `deploy/release-main.sh`'s `SHAPE`, and `deploy/` is out of scope this round). `isIngestibleReleaseTag` (`server/src/update/resolve.ts` — L1, since it is a pure decision over a value the catalogue's own ingress and the intent route's ingress both need, never a second copy) calls `isReleaseTag` first, then refuses a tag over `RELEASE_TAG_INGRESS_MAX_BYTES` (64) bytes or carrying a leading zero in any component that is not itself the bare digit `0`, checked structurally (a `.split('.')` and a per-part scan) rather than by a second copy of the tag-shape regex `single-definition.test.ts` polices ("spells the tag shape once — every other reader calls isReleaseTag"). The catalogue's element parse (`parseReleaseElement`) SKIPS a tag this refuses exactly like any other malformed element (D-3206's rule: not upserted, counted in `skipped`, and the raw element count still drives `coverage` per D-3185), so `compareReleaseTags` never has to arbitrate two spellings of one version from the catalogue. **The coordinator's ruling (mail 2210, "F11 ingress ok") extends the SAME bound to `POST /api/updates/intent`'s `pinnedTag`:** neither `parseIntentBody` nor `setIntent` checks catalogue membership before accepting a pin — a pin need not already be a listed release — so the catalogue's own ingress bound does NOT cover it, and `isIngestibleReleaseTag` (imported from `resolve.ts`, never a second copy) is applied at `parseIntentBody`'s existing `pinnedTag` guard, answered with the route's EXISTING `bad-tag` word (the same one a non-tag-shaped pin already gets) — no new HTTP vocabulary. This is the case the coordinator asked to be told which applies (the route accepts an unlisted pinnedTag; there was no "already covered, add a pin only" branch to take). **F11's tightening of the SHARED tag shape itself — closing the gap for `deploy/release-main.sh`, `release-stable.sh`, `build-release.sh`, `deploy.sh` and the `ccd/ccrc` copies of the SHAPE pattern — is explicitly a LATER `deploy/` + `ccd/ccrc` change, out of scope this wave and this fix round**, because those files are excluded from this dispatch's file list and from `deploy/`'s "untouched" rule; `isIngestibleReleaseTag` is an ingress-only second gate on TOP of the existing, wider grammar, not a replacement for it. Also amended (minor, fix round 1 review round 2): `DOWNLOAD_URL_MAX` gained its own pin (a URL at exactly the cap kept, one byte over refused to `NULL`), and `routes.ts`'s `parseIntentBody` guard was simplified from `!isReleaseTag(pinnedTag) || !isIngestibleReleaseTag(pinnedTag)` to the latter alone (`isIngestibleReleaseTag` already calls `isReleaseTag`). Pinned by: an http download URL storing `tarballUrl: NULL` with the release still listed; a URL carrying a C0 control character, a non-ASCII byte, or userinfo each storing `NULL`; a URL at exactly `DOWNLOAD_URL_MAX` kept, one byte over refused; a well-formed https URL kept; `v0.0.010` and `v01.2.3` skipped at the catalogue parse (and a listing carrying both `v0.0.10` and `v0.0.010` storing exactly one row, `v0.0.10`); a grossly oversized single component skipped and the effective maximum under BOTH caps (three components at RELEASE_TAG_COMPONENT_MAX_DIGITS digits each, 57 bytes) kept — R9 (fix round 2) corrects this: a single-component 64-byte tag is no longer the kept boundary, since a component alone over 18 digits is refused before the byte cap is ever the binding constraint; `v0.0.0` and `v10.20.30` kept; and `POST /api/updates/intent` answering `400 bad-tag` for `v0.0.010` while accepting `v0.0.10` for a scope with no catalogue row at all. Mutations, each measured red: reverting `safeDownloadUrl` to accept `http:` again; removing the leading-zero rule from `isIngestibleReleaseTag`. CORRECTED (fix round 2, C4 nit): this entry originally also claimed "removing its byte-length bound" reds — false as of R9 (below): `RELEASE_TAG_INGRESS_MAX_BYTES` (64) is now UNREACHABLE on its own for `v`'s fixed three-component grammar, since `RELEASE_TAG_COMPONENT_MAX_DIGITS` (18) caps every component first (three components at 18 digits each is only 57 bytes) — measured: deleting the byte check alone leaves `update-resolve`, `update-catalogue` and `update-routes` fully green. It is kept anyway as a defensive backstop against a future grammar change (e.g. a fourth component), not because a mutation currently catches its removal.

  Amended, fix round 2 (R7 and R9, review 143, both fall under this entry): **R7 — the download URL was validated but not normalised.** `safeDownloadUrl` parsed `raw` with `new URL` but returned `raw` itself on success — a measured parser differential means a DIFFERENT client can read the SAME raw text differently than this process's own WHATWG parse did: `https://github.com\@evil.example/x` parses here with hostname `github.com` and empty username/password (WHATWG folds `\` to `/` on a special scheme, so the whole `\@evil.example/x` lands in the PATH), while curl 8.5.0 given the identical raw text connects to the host AFTER the `@`. Fixed two ways: a raw string containing `\` is refused outright, and the function now returns `u.href` — the PARSED, NORMALISED form — never the raw string. **R9 — the byte cap did not bound a SINGLE component's digit count.** `v9999999999999999999.0.0` is 25 bytes, well under `RELEASE_TAG_INGRESS_MAX_BYTES` (64), but its first component is a 20-digit number `ccd/ccrc`'s bash twin (`_ver_newer`'s `10#` arithmetic, 64-bit signed) overflows SILENTLY — measured by the reviewer: `isIngestibleReleaseTag` admitted both `v0.0.9223372036854775808` and `v0.0.18446744073709551617`, and `compareReleaseTags` (arbitrary-precision) would order a tag above either of them opposite to what the twin's overflowed arithmetic computes. `isIngestibleReleaseTag` now also refuses any component over `RELEASE_TAG_COMPONENT_MAX_DIGITS` (18) digits — safely under a 64-bit signed integer's range, with margin — a NEW named constant beside `RELEASE_TAG_INGRESS_MAX_BYTES`, which this bound now makes unreachable on its own for `v`'s fixed three-component grammar (three components at 18 digits each is only 57 bytes), kept anyway as a defensive backstop against a future grammar change. Pinned by: `https://github.com\@evil.example/x` storing `tarballUrl: NULL`; a default-port URL storing the normalised form, never the raw string with the port; the reviewer's two overflow tags refused; a component at exactly 18 digits kept, one at 19 refused; the byte-cap pin corrected above. Mutations, each measured red: removing the `\` refusal from `safeDownloadUrl`; reverting `return u.href` to `return raw`; removing the per-component digit-length check from `isIngestibleReleaseTag`. Cost if wrong: R7 wrong — a node's download URL round-trips through a client that reads it differently than this process validated it, defeating the validation entirely; R9 wrong — the server and a node can order the same catalogue tag oppositely, so a node could refuse to install what the server considers an older release, or vice versa.

  Cost if wrong: F10 wrong — a node could be handed a plaintext or credentialed download URL to fetch a "verified" tarball over; F11 wrong — two rows for one release split eligibility and floor comparisons in a way `compareReleaseTags` cannot see through.
- **D-3217** — Found by review run 134 (item 14: the plan's own Interfaces blocks no longer matched what two earlier fix waves had already shipped); applied in fix round 1, dispatch D. `SweepOutcome`'s `error` arm — isolating one connection's own measurement-and-apply throw so a lock or corruption on ONE row's write still lets the OTHER connection's measurement, and the resolve/project that follows both, run (added by the final fix wave, C1) — and `WriteProjectionResult`'s failure arm's `code: string | null` field — the fs errno when the failure carries one, `null` for a thrown value that is not a `NodeJS.ErrnoException`, so a caller can dedupe repeated warnings on `why` + `code` without matching on `detail`'s embedded, per-attempt tmp path (added by fix round 1, finding 1) — both shipped in `server/src/update/inventory.ts` and `server/src/update/project.ts` without Task 11's and Task 12's own Interfaces blocks (`SweepOutcome`, `WriteProjectionResult`) being corrected to match; `RekeyNodeResult`'s `revived: boolean` (D-3208) was similarly missing from Task 5's and Task 14's Interfaces text. A departure from what THIS DOCUMENT states as the contract, not from the spec or the shipped code. Pinned by nothing new — the arm and the two fields are already pinned by Task 11's and Task 5's own suites (`update-inventory.test.ts`'s per-connection isolation case, `update-store-nodes.test.ts`'s revive case); this entry brings the Interfaces text into agreement with them. **Corrected (fix round 2, R5):** `WriteProjectionResult.code` is NOT pinned by any `.code` assertion — `update-projection.test.ts` never reads that property. Its one related case ("a directory at the path → unwritable, the directory untouched, no tmp left") and the dedupe describe ("the projection warning dedupes on a stable key, never the message", `:446-480`) exercise the code path that PRODUCES `code` and pin the console.warn COUNT that `code`'s presence in the dedupe key causes, but neither asserts the field's own value. The field itself is carried, correctly, by the shipped type; what is false is only the claim that a test reads it by name. This is a coverage gap, not a shipped-behaviour defect (ruling run 128, fix round 2, item 8) — carried to programme wave 5, which edits `server/src/update/project.ts`. Cost if wrong: a reader trusting the plan's Interfaces blocks over the shipped types writes a consumer with a three-arm `switch` over `SweepOutcome`, a two-field failure branch on `WriteProjectionResult`, or a `RekeyNodeResult.ok` arm with no `revived`, and mishandles the case it does not expect.

- **D-3218** — Found by the coordinator, fix round 2, ruling on R1 (review run 143); corrected fix round 2, C3 (review 143). Spec §7 rate-limits `POST /api/updates/refresh` "to one call per minute in the route" (D-3203's own reading), and D-3215's text called the poller's request rate safe at that cadence — but D-3215 (fix round 1, item 5, ruling A) had by then made a single `poll()` cost up to THREE requests (the latest-release probe, the listing, and the rare moved-away tag check), so a refresh door admitting one poll a MINUTE could spend up to 180 requests an hour against spec §7's unauthenticated 60/hour budget — three times over, and neither D-3203 nor D-3215 was amended to say so when the tag check was added. `routes.ts`'s `REFRESH_MIN_INTERVAL_MS` is now DERIVED, never hand-typed — but R1's OWN derivation (two named constants declared once in `catalogue.ts` — `CATALOGUE_MAX_REQUESTS_PER_POLL` (3) and `UNAUTHENTICATED_HOURLY_REQUEST_BUDGET` (60) — giving `(CATALOGUE_MAX_REQUESTS_PER_POLL / UNAUTHENTICATED_HOURLY_REQUEST_BUDGET) * 60 * 60_000` = 180,000 ms) sized the door as if it were the ONLY source of requests against the budget. **CORRECTED (C3, ruled by the coordinator):** the SCHEDULED poll runs on its own clock (`watch.ts`'s `tick()`, `CATALOGUE_POLL_INTERVAL_MS`, independent of the door's own `lastRequestAt()` clock), so the door's worst case is `(door polls + scheduled polls) × CATALOGUE_MAX_REQUESTS_PER_POLL` against the SAME hourly budget, not the door's polls alone — the R1 derivation therefore did NOT "land exactly on the budget" once the scheduled lane's own share is counted (worst case 20 door polls + 2 scheduled polls × 3 requests = 66 against 60, as review 143 measured). The interval is now `HOUR_MS · CATALOGUE_MAX_REQUESTS_PER_POLL / (UNAUTHENTICATED_HOURLY_REQUEST_BUDGET − SCHEDULED_POLLS_PER_HOUR · CATALOGUE_MAX_REQUESTS_PER_POLL)`, where `SCHEDULED_POLLS_PER_HOUR` is derived from `CATALOGUE_POLL_INTERVAL_MS` (never hand-typed) — with today's values, `3600000·3 / (60 − 2·3)` = 200,000 ms (200 s), the gap that now sizes the two lanes TOGETHER to fit the budget. The route's own gate logic (measured against `lastRequestAt()`, a future timestamp never refusing) is unchanged; only the interval's VALUE and its derivation change. The `429` answer shape is unchanged. Pinned by: `REFRESH_MIN_INTERVAL_MS` equal to the (corrected) derivation formula and to 200,000 exactly; three refreshes a minute apart admitting only the first poll, not three, across two full minutes; the door opening again only once the full derived interval has elapsed. Mutation, measured red: hand-typing `REFRESH_MIN_INTERVAL_MS = 60_000` back reds both the exact-value assertion and the door-behaviour assertions (a refresh one minute after the first would then be admitted); reverting the formula to R1's door-alone shape (180,000) also reds the exact-value assertion. Cost if wrong: an operator (or a monitoring script) hitting refresh once a minute spends up to three times the unauthenticated budget, and GitHub answers `403`/`429` (`rate-limited`) for the rest of the hour — the catalogue then goes stale for everyone on that IP, not just the caller who over-spent it; under-correcting (R1's own fix) still lets the scheduled lane push the true worst case over budget on a box with many door refreshes.

  Amended, fix round 3 (B3, coordinator's ruling, review 146): the C3 derivation above still left ZERO headroom — 18 door polls plus 2 scheduled polls, times 3 requests, lands EXACTLY on 60 — so two real shapes still exceeded spec §7's 60/hour: (a) a RESTART, where `requestedAt` (the door's own clock) and `lastCatalogueAt` (`watch.ts`'s scheduled clock) both live only in process memory and both reset to nothing, so the scheduled lane's first tick polls immediately (D-3182) on top of whatever the door had already spent that hour; (b) STAMP TIMING, where all three `stampRequest(now)` calls stamped the poll's shared START `now` rather than each request's own send time, so a poll whose tag check or listing goes out one or two 10 s deadlines later than the probe was undercounted against the hour it actually landed in — the security lens built a timeline fitting 61 requests into one 3600 s window. Both fixed together: each `stampRequest` call now stamps `now` PLUS how far an injectable `elapsedMs()` (default `performance.now()`, read once at the poll's own start and again immediately before each of the three fetch sites) has moved since that baseline — floored at 0, since `routes.ts`'s door treats a `lastRequestAt` in the FUTURE as "the clock stepped back" and ADMITS, so a stamp must never land ahead of a later caller's own `now`. The derivation gains ONE named term, `MARGIN_POLLS_PER_HOUR` (=1) — covering exactly one extra poll inside the hour, which is what shape (a)'s restart costs — added to `SCHEDULED_POLLS_PER_HOUR` before the door's own share is subtracted from the budget, and the whole result rounded UP (`Math.ceil`) so a fractional remainder never under-shoots and re-opens the door early: `HOUR_MS · CATALOGUE_MAX_REQUESTS_PER_POLL / (UNAUTHENTICATED_HOURLY_REQUEST_BUDGET − (SCHEDULED_POLLS_PER_HOUR + MARGIN_POLLS_PER_HOUR) · CATALOGUE_MAX_REQUESTS_PER_POLL)` — with today's values, `3600000·3 / (60 − (2+1)·3)` = 211,764.7… ms, rounded up to 211,765 ms, SUPERSEDING the 200,000 ms value above. Pinned by: a controllable elapsed source the fixture itself advances as each request actually reaches it, proving `lastRequestAt()` reads the LAST request's own send time (not the poll's shared start) across a poll issuing more than one request; `REFRESH_MIN_INTERVAL_MS` equal to the (twice-corrected) formula INCLUDING the margin term, and to 211,765 exactly, with the existing door-behaviour assertions re-measured against it. Mutation, measured red: stamping with the poll's shared start `now` again (dropping the `elapsedMs()`/baseline offset) reds the send-time pin; dropping the margin term (or setting it to 0) reds the exact-value pin, reverting to 200,000.

## File structure

**New**
- `shared/semver.ts` — L0. The tag comparator (`compareReleaseTags`, `isNewerTag`, `newestTag`); imports nothing; strips the `v` inside, nowhere else.
- `server/src/coord/updateintentlog.ts` — L3. `UpdateIntentLog`, the NDJSON journal under `update_intent`/`update_epoch`, `PoolEdgeLog`'s twin (synchronous; `maxEpoch()` null only on ENOENT).
- `server/src/update/catalogue.ts` — L3. The GitHub listing poller: one conditional GET, defensive parse, one call to the store's catalogue writer; `CatalogueState` and the ETag in memory.
- `server/src/update/inventory.ts` — L3. The seven-file node measurement (lstat-gated, capped, validated), the pure §8 phase-table plan, and the sweep that visits the server's own row and the fleet connection.
- `server/src/update/resolve.ts` — L1. The pure resolver (channel, eligibility, floor, pin, the resolve-detail sentences, both `desired-*`), the projection renderer, the auto-gate predicate.
- `server/src/update/project.ts` — L3. Assembles resolver input from store reads, stores each resolution, writes the server's own `~/.ccrc/update-intent` by tmp-then-rename (0600).
- `server/src/update/routes.ts` — L4. `registerUpdateRoutes`: `GET /api/updates`, `POST /api/updates/{intent,refresh,ack}`, `GET /api/updates/intent/:nodeId`; the row→wire mappers.
- `server/test/update-states.test.ts` — the busy/settled/unknown pins and per-vocabulary array/guard agreement.
- `server/test/update-semver.test.ts` — the comparator against `sort -V` and against `_ver_newer`.
- `server/test/update-store-catalogue.test.ts` — Task 4's store cases.
- `server/test/update-store-nodes.test.ts` — Task 5's store cases.
- `server/test/update-store-intent.test.ts` — Task 6's store and journal cases.
- `server/test/update-writer-groups.test.ts` — the writer-group scan over `store.ts`'s SQL.
- `server/test/update-catalogue.test.ts` — the poller against a loopback fixture server.
- `server/test/update-inventory.test.ts` — every §8 Pins bullet on fixture HOMEs.
- `server/test/update-resolve.test.ts` — the §9 resolver table and the sentences.
- `server/test/update-projection.test.ts` — rendering, seconds, the embedded python validator, the server-role writer.
- `server/test/update-routes.test.ts` — the W2 route rows, credential order, local mode's one node.

**Changed**
- `shared/api.ts` — L0. One end-of-file update block (D-3188): the eleven vocabularies (unions, arrays, guards), `FLEET_SCOPE`, `RELEASE_TAG`/`isReleaseTag`, `CAP_WORD`/`MAX_CAP_WORDS`/`validCapWords`, the §12 wire interfaces and the route answers, and `UPDATE_STORE_REFUSE_CODES`; one line-neutral docstring edit on `FleetHealth.builds` (Task 14).
- `shared/agent-protocol.ts` — L0. `CCRC_DIR_NAME`/`NODE_FILES`/`NodeFileKey`/`NODE_FILE_BASENAMES`; `AgentReady.ops?`.
- `server/src/coord/schema.ts` — L3 (data). `MIGRATIONS[13]`, banner `14: user_version 13 -> 14`.
- `server/src/coord/store.ts` — L3. The catalogue, refusal, node, intent and epoch methods and their result types; `NODE_ID_RE`, its one declaration.
- `server/src/config.ts` — L3. `role`/`roleSource`, `ccrcDir`, `installedCcrcPath`, `releaseSource`, `releaseApiUrl`, `updateDeadlineMs`.
- `server/src/fleetstate.ts` — L3. `FleetState.agentOps?`; `derivedBuilds`.
- `server/src/remote/client.ts` — L3. `readReadyOps`, the one reader of `frame.ops` in `onReady`.
- `server/src/pools.ts` — L3. Exports `openPoolReadDeadline` and `PoolReadDeadline` unchanged, for the poller and the sweep.
- `server/src/watch.ts` — L4. `UPDATE_CATALOGUE_MS`/`UPDATE_INVENTORY_MS` sub-cadences, both gated ABOVE `tick()`'s registry fail-shut return (D-3198); `inventoryNow()`/`triggerInventory()`; private `runInventory()`, `sweepThenProject()`, `lastProjectionWhy`.
- `server/src/server.ts` — L4. `Deps.catalogue?`/`Deps.updateIntentLog?`; route registration; `FleetHealth.builds` derived through `inventoryBuilds` (D-3204).
- `server/src/auth/gate.ts` — L4. One `EXEMPT` entry for the projection read; the header's route count, reason 2's numerals and lists, the CSRF note's numerals.
- `server/src/index.ts` — L5. Constructs the poller and the journal, hoists the fleet client (`let fleetClient`) and wires `onConnected` → `triggerInventory`, logs a derived role once (Task 9) and a failed release-source read once (Task 10).
- `agent/src/whitelist.ts` — agent L3. `checkPath`'s read arm admits the eight `~/.ccrc` basenames by canonical-path equality AND the literal basename asked for (`isCcrcNodeFile`, D-3195); nothing else changes.
- `agent/CLAUDE.md` — the read-whitelist sentence.
- `deploy/ccrc.env.example` — the `CCRC_ROLE=` paragraph rewritten (the server now reads it); the four new keys, commented.
- `server/test/coord-db.test.ts`, `server/test/asks-store.test.ts` — the two `COORD_SCHEMA_VERSION` literals; a `migration 14` describe; the banner-sequence case (D-3191).
- `server/test/single-definition.test.ts` — one holder per new type, one SQL-tuple scan per vocabulary, the update-ring scan, the `NODE_FILES` describe; every edit line-neutral above `:1303` or appended after the file's last line (its lines are audit-cited).
- `server/test/mail-routes.test.ts` — the coord kebab-token scan admits `isUpdateStoreRefuseCode` and two `NOT_CODES` words (Tasks 4–5, D-3192).
- `server/test/config.test.ts`, `server/test/remote-connect.test.ts`, `agent/test/whitelist.test.ts`, `server/test/fleet-build-skew.test.ts`, `server/test/fleet-health.test.ts` — the per-task pins.
- `server/src/readiness.ts`, `server/test/readiness.test.ts`, `server/test/readiness-sweep.test.ts` — comment-only, line-neutral: each says the agent's whitelist has no `.ccrc` arm, false after Task 8.
- `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts` — the third scanned file, `UPDATE_SRC`, `UPDATE_DOORS`, the moved numerals.
- `CLAUDE.md` — the box-token bullet (four doors, one dual read), one Deploy-bullet sentence, and the README size claim (`:10`) if Task 15's measurement moves it.
- `README.md` — the auth paragraph (the projection read, the lane numerals), a "Control plane" paragraph in the Releases section.

## Tasks

### Task 1: L0 vocabularies and wire types

**Files:**
- Modify: `shared/api.ts` — a new block APPENDED after `READER_MIN_COLS` (`shared/api.ts:8138`, the file's last line); no new import line. CORRECTED from "after `BuildAgreement` (`:3237`)": `README.md:2560` cites `shared/api.ts:7465-7467` (the purge refusal words) and `:7505`/`:7513`/`:7526` by line, and `session-hook.test.ts`'s citation audit (`describe('the compaction card — every line citation is anchored (spec §3.4)'`, `:7061`) reds on any line inserted above them — measured on a scratch copy of d759c914: a ten-line insert after `:3237` reds "THE CITATION DEBT this task creates is measured" (`:7602`, `shared/api.ts` 1 → 5) and "README HAS ITS OWN CENSUS ENTRY, and it is EMPTY" (`:8433`, four README anchors) — D-3188
- Test: `server/test/update-states.test.ts` (create)
- Test: `server/test/single-definition.test.ts` — ONE line-neutral edit to the `shared/api.js` import (`:23`, names appended to the existing line, never a new line) and one describe APPENDED after the file's last line (`:3302`); nothing inserted above — the same audit cites this file at `:32-37`, `:1274`, `:1303` (its census entry `'server/test/single-definition.test.ts': 8`, `session-hook.test.ts:8098`). The describe carries one `it()` per new exported type (the `RunState` shape, `describe('Build 7 nouns')`'s first case, `:402-405`) and one hand-typed-SQL-tuple scan per vocabulary (the `TERMINAL_ITEM_STATES` shape, `:561-583`)

**Interfaces:**
- Consumes: `BuildInfo` (already imported type-only, `shared/api.ts:13`); the `RunState`/`RUN_STATES`/`isRunState` idiom (`shared/api.ts:4017`, `:4027`, `:4035`) and `ACTIVE_RUN_STATES`'s `as const satisfies` idiom (`:4145-4149`); `ReadFailure` (`shared/agent-protocol.ts:313`), type-only, in the TEST alone.
- Produces (all in `shared/api.ts`) — exactly the skeleton's block, with ONE correction: `StampRead` is DERIVED from its array rather than written as a union beside it, because the union spelling `'ok' | 'absent' | 'unreadable' | 'malformed'` makes `shared/api.ts` a second holder of `'absent' | 'unreadable'` and reds `describe('one absent/unreadable read vocabulary')` (`single-definition.test.ts:2566-2588`, `PAIR` at `:2573`) and "does not respell io.ts read-failure pair as the skill vocabulary" (`:2395`) — measured; `api.ts` cannot import `ReadFailure` (its three type-only imports are pinned, `peers-claims-l0.test.ts:157-167`). The type a consumer sees is identical — D-3189:

```ts
export type UpdateChannel = 'stable' | 'dev';
export const UPDATE_CHANNELS = ['stable', 'dev'] as const satisfies readonly UpdateChannel[];
export function isUpdateChannel(v: unknown): v is UpdateChannel;

export type UpdateState = 'idle' | 'pending' | 'applying' | 'reverted' | 'failed' | 'unknown';
export const UPDATE_STATES = ['idle', 'pending', 'applying', 'reverted', 'failed', 'unknown'] as const satisfies readonly UpdateState[];
export function isUpdateState(v: unknown): v is UpdateState;
export const BUSY_UPDATE_STATES = ['pending', 'applying', 'unknown'] as const satisfies readonly UpdateState[];   // unknown is BUSY
export const SETTLED_UPDATE_STATES = ['idle', 'reverted', 'failed'] as const satisfies readonly UpdateState[];
export type BusyUpdateState = (typeof BUSY_UPDATE_STATES)[number];
export type SettledUpdateState = (typeof SETTLED_UPDATE_STATES)[number];

export type UpdatePhase = 'queued' | 'resolving' | 'fetching' | 'verifying' | 'backing-up' | 'installing'
  | 'restarting' | 'checking' | 'restoring' | 'done' | 'reverted' | 'failed' | 'unknown';
export const UPDATE_PHASES = [/* the thirteen, in that order */] as const satisfies readonly UpdatePhase[];
export function isUpdatePhase(v: unknown): v is UpdatePhase;
export const IN_FLIGHT_UPDATE_PHASES = ['queued', 'resolving', 'fetching', 'verifying', 'backing-up', 'installing',
  'restarting', 'checking', 'restoring'] as const satisfies readonly UpdatePhase[];   // §8's `applying` row

export type InstallState = 'complete' | 'incomplete' | 'unknown';
export const INSTALL_STATES = ['complete', 'incomplete', 'unknown'] as const satisfies readonly InstallState[];
export function isInstallState(v: unknown): v is InstallState;

export type ProvenanceState = 'verified' | 'unverified' | 'unknown';
export const PROVENANCE_STATES = ['verified', 'unverified', 'unknown'] as const satisfies readonly ProvenanceState[];
export function isProvenanceState(v: unknown): v is ProvenanceState;

export type AutoMode = 'off' | 'stable' | 'channel';
export const AUTO_MODES = ['off', 'stable', 'channel'] as const satisfies readonly AutoMode[];
export function isAutoMode(v: unknown): v is AutoMode;

export type NotifyMode = 'channel' | 'stable' | 'off';
export const NOTIFY_MODES = ['channel', 'stable', 'off'] as const satisfies readonly NotifyMode[];
export function isNotifyMode(v: unknown): v is NotifyMode;

export type RequestKind = 'update' | 'rollback';
export const REQUEST_KINDS = ['update', 'rollback'] as const satisfies readonly RequestKind[];
export function isRequestKind(v: unknown): v is RequestKind;

// D-3181 — the three §6 spelled only in DDL comments
export const STAMP_READS = ['ok', 'absent', 'unreadable', 'malformed'] as const;   // D-3189
export type StampRead = (typeof STAMP_READS)[number];                              // = 'ok' | 'absent' | 'unreadable' | 'malformed'
export function isStampRead(v: unknown): v is StampRead;
export type NodeRole = 'server' | 'fleet' | 'both';
export const NODE_ROLES = ['server', 'fleet', 'both'] as const satisfies readonly NodeRole[];
export function isNodeRole(v: unknown): v is NodeRole;
export type NodeOs = 'linux' | 'darwin' | 'unknown';
export const NODE_OSES = ['linux', 'darwin', 'unknown'] as const satisfies readonly NodeOs[];
export function isNodeOs(v: unknown): v is NodeOs;

// CORRECTION (fix round 2, R5/C1): missing from this block though shipped —
// D-3213 (fix round 1)'s third read-state, distinguishing "measured" from
// "never measured" for a floor/previous-version file, distinct from the
// StampRead/absent-unreadable pair above (a DIFFERENT axis: whether a value
// was ever carried, not why today's raw read failed).
export const TAG_FILE_READS = ['measured', 'absent', 'unmeasured'] as const;
export type TagFileRead = (typeof TAG_FILE_READS)[number];
export function isTagFileRead(v: unknown): v is TagFileRead;

// CORRECTION (fix round 2, R5/C1; C6 nit): missing from this block though
// shipped — the final fix wave's C5 deleted `inventory.ts`'s own
// REPORT_TIME_MAX_S and `resolve.ts`'s own MAX_UNIX_S in favour of this ONE
// declaration, so a unix-seconds bound is spelled once, not restated per file.
export const UNIX_SECONDS_MAX = 99_999_999_999;

export const RELEASE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
export function isReleaseTag(v: unknown): v is string;       // the ONE tag-shape guard
export const CAP_WORD = /^[a-z][a-z0-9-]{0,31}$/;             // ccrc-caps and ready.ops words
export const MAX_CAP_WORDS = 32;
/** null = REFUSED (any element not a string matching CAP_WORD, or more than MAX_CAP_WORDS);
 *  [] = a valid empty list. Callers store both as '' (§8: one bad word drops the whole file). */
export function validCapWords(words: readonly unknown[]): string[] | null;

export type CatalogueErrorReason = 'no-egress' | 'rate-limited' | `http-${number}` | 'malformed' | 'no-release-source' | 'redirect'; // 'redirect': fix round 1, F9 (D-3209)

export interface ReleaseRefusalWire { by: string; at: number }            // by = nodeId
export interface ReleaseWire {
  tag: string; version: string; channel: UpdateChannel | null; publishedAt: number; commitSha: string | null;
  bundleListed: boolean; yanked: boolean;
  refused: ReleaseRefusalWire[];                                            // display roll-up — never a predicate
  notes: string | null;
}
export interface NodeRequestWire { tag: string; kind: RequestKind; at: number }
export interface NodeReportWire { phase: UpdatePhase; target: string | null; startedAt: number | null; updatedAt: number | null; detail: string | null }
export interface NodeUpdateWire { state: UpdateState; target: string | null; startedAt: number | null; detail: string | null }
// CORRECTION (fix round 2, R4/R5/C1): `floorRead?`/`previousRead?` (both
// `TagFileRead`) were added by fix round 2's R4 and are ALWAYS sent by
// `toNodeWire` (never actually omitted) — optional only so an older
// build's fixture/consumer still type-checks (wire discipline: additive,
// absence permits, no FLEET_PROTO bump; the only `shared/api.ts` hunk this
// round touches).
export interface NodeWire {
  nodeId: string; role: NodeRole | null; label: string; os: NodeOs;
  current: BuildInfo | null; stampRead: StampRead; installState: InstallState; provenance: ProvenanceState;
  caps: string[]; agentOps: string[] | null; highestVersion: string | null; previousVersion: string | null;
  floorRead?: TagFileRead; previousRead?: TagFileRead;
  measuredAt: number | null; reachable: boolean; unreachableSince: number | null;
  channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null;
  request: NodeRequestWire | null;
  report: NodeReportWire | null;
  update: NodeUpdateWire;
}
export interface UpdateIntentWire {
  scope: string; channel: UpdateChannel | null; pinnedTag: string | null; auto: AutoMode; notify: NotifyMode;
  setAt: number; setBy: string;
}
export const FLEET_SCOPE = '*';                                            // the fleet-default intent scope — declared HERE only (ruling R4)
export interface CatalogueState { lastOkAt: number | null; lastError: { at: number; reason: string } | null }
export interface UpdatesView { catalogue: CatalogueState; releases: ReleaseWire[]; nodes: NodeWire[]; intent: UpdateIntentWire[] }

export type UpdateRouteError =
  | 'unauthenticated' | 'not-configured' | 'bad-tag' | 'bad-request' | 'unknown-scope' | 'unknown-node'
  | 'superseded' | 'busy' | 'auto-needs-rollback-gate' | 'rate-limited' | 'no-channel'
  | 'journal-unreadable' | 'journal-unwritable';
export interface UpdateRouteRefusal {
  ok: false; error: UpdateRouteError;
  field?: string; nodes?: string[]; detail?: string; retryAfterS?: number;
}
export interface IntentWriteAnswer { ok: true; intent: UpdateIntentWire; epoch: number }
export interface AckAnswer { ok: true; node: NodeWire }
```

- Ruling R4 (binding over the skeleton, which put `FLEET_SCOPE` in `server/src/coord/store.ts`): `FLEET_SCOPE = '*'` is declared ONCE, in this block. Task 6's `server/src/coord/store.ts` IMPORTS it from `'../../../shared/api.js'` (its existing import, `store.ts:54`), Task 12's L1 resolver (`server/src/update/resolve.ts`) and `project.ts` import it from `'../../../shared/api.js'` (R7), and tests from `'../../shared/api.js'`; no other file declares it. Pinned here by the single-definition `VALUES` scan (Step 2), so a Task 6 body that still declares its own copy reds this suite.
- Ruling R5: the store refusal vocabulary (`UPDATE_STORE_REFUSE_CODES`/`UpdateStoreRefuseCode`/`isUpdateStoreRefuseCode`, Task 4, appended to by Tasks 5 and 6) is appended AFTER this block's last line (`AckAnswer`), in the same end-of-file update region — never beside `SET_ACCOUNT_POOLS_REFUSE_CODES`. This task declares none of it; it only fixes the region's start.
- Rulings R1 and R13: `NodeReportWire`'s times are epoch MS on the wire; `~/.ccrc/update.json` carries unix SECONDS, converted once by Task 11's reader. Every edit here is appended or line-neutral (Files above), and Step 5's green run includes `session-hook.test.ts`.
- Pins `update-states.test.ts` carries: every `UpdateState` in exactly one of busy/settled, their union equal to `UPDATE_STATES`, `unknown` busy and not settled (`run-states.test.ts:20-39`'s three assertions); per vocabulary, `isX(v)` ⇔ `ARRAY.includes(v)` over the members plus `''`, an upper-cased member, a space-padded member, `null`, `1`; one type-level exhaustiveness line per array (`const _x: never = null as unknown as Exclude<X, (typeof X_ARRAY)[number]>`, checked by `typecheck-tests.test.ts`) — for `StampRead`, the two lines that hold its failure half EQUAL to `ReadFailure` instead; `IN_FLIGHT_UPDATE_PHASES` ∪ `{done, reverted, failed, unknown}` equals `UPDATE_PHASES`; `validCapWords` refuses 33 words, one bad word, a non-string and answers `[]` for `[]`; `isReleaseTag` refuses `'0.0.9'`, `'v0.0.9 '`, `'v0.0.9\n'`, `'v0.0'`, `'V0.0.9'` and the same shape as `deploy/release-main.sh`'s `SHAPE` (`:52`) on a shared fixture list.
- Spec §18 rows pinned: "vocabularies are declared once" (a second `export type UpdateState` appears; a hand-typed SQL tuple appears), "every `UpdateState` classified once" (a state is added to the union and not to busy/settled), "`unknown` is busy" (it is moved to settled — here the list itself; the fixture-row half, a busy `unknown` row refusing a dispatch, lands with W4's `dispatchNode`, and Task 5's lease guards build their SQL from these two lists). Also the "regex is duplicated" half of W4's "the op validates the tag with the one guard", ahead of its op: the tag shape's regex source has one holder in the four TS roots.

- [ ] **Step 1: Write the failing vocabulary test**

Create `server/test/update-states.test.ts`:

```ts
// Design 2026-09-20 §6: the update control plane's vocabularies, declared once
// in `shared/api.ts`. Two things are pinned here and nowhere else:
//
//  1. Every `UpdateState` is classified ONCE — busy or settled — and `unknown`
//     is BUSY. `run-states.test.ts`'s three partition assertions, for the same
//     reason: the dangerous direction for a lease is a node wrongly read as
//     settled, which lets a second dispatch through.
//  2. Each array IS its union and each guard IS its array. `as const satisfies`
//     proves array ⊆ union at compile time; the `Missing<…>` lines at the foot
//     of this file prove union ⊆ array (typecheck-tests.test.ts compiles this
//     directory), and the runtime cases prove the guard answers exactly the
//     array — no trimming, no case folding, nothing that is not a string.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UPDATE_CHANNELS, isUpdateChannel, UPDATE_STATES, isUpdateState,
  BUSY_UPDATE_STATES, SETTLED_UPDATE_STATES, UPDATE_PHASES, isUpdatePhase, IN_FLIGHT_UPDATE_PHASES,
  INSTALL_STATES, isInstallState, PROVENANCE_STATES, isProvenanceState, AUTO_MODES, isAutoMode,
  NOTIFY_MODES, isNotifyMode, REQUEST_KINDS, isRequestKind, STAMP_READS, isStampRead,
  NODE_ROLES, isNodeRole, NODE_OSES, isNodeOs, RELEASE_TAG, isReleaseTag, CAP_WORD, MAX_CAP_WORDS,
  validCapWords,
  type UpdateChannel, type UpdateState, type BusyUpdateState, type SettledUpdateState, type UpdatePhase,
  type InstallState, type ProvenanceState, type AutoMode, type NotifyMode, type RequestKind,
  type StampRead, type NodeRole, type NodeOs,
} from '../../shared/api.js';
import type { ReadFailure } from '../../shared/agent-protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

describe('update-state classification (design 2026-09-20 §6)', () => {
  const lists: Record<string, readonly UpdateState[]> = { BUSY_UPDATE_STATES, SETTLED_UPDATE_STATES };

  it('places every UpdateState in exactly one list', () => {
    for (const s of UPDATE_STATES) {
      const homes = Object.entries(lists).filter(([, l]) => l.includes(s)).map(([n]) => n);
      expect(homes, `${s} is classified ${homes.length} times: ${homes.join(', ')}`).toHaveLength(1);
    }
  });

  it('classifies nothing that is not an UpdateState, and covers all of them', () => {
    const union = [...BUSY_UPDATE_STATES, ...SETTLED_UPDATE_STATES].sort();
    expect(union).toEqual([...UPDATE_STATES].sort());
  });

  it('counts `unknown` as BUSY — the safe direction for a lease', () => {
    expect(BUSY_UPDATE_STATES).toContain('unknown');
    expect(SETTLED_UPDATE_STATES).not.toContain('unknown');
  });

  it('the in-flight phases plus the four named rows are every UpdatePhase, each once (§8 phase table)', () => {
    const rows = [...IN_FLIGHT_UPDATE_PHASES, 'done', 'reverted', 'failed', 'unknown'];
    expect(new Set(rows).size, 'a phase sits in two rows of the table').toBe(rows.length);
    expect([...rows].sort()).toEqual([...UPDATE_PHASES].sort());
  });
});

describe('each vocabulary: the array is the union, the guard is the array', () => {
  // The spec's own lists, as LITERALS — a second statement of each vocabulary,
  // on purpose: this is the pin that reds when a member is added, dropped or
  // reordered without the spec (§6's code block) being consulted.
  const VOCABS: ReadonlyArray<{ name: string; members: readonly string[]; guard: (v: unknown) => boolean; spec: string[] }> = [
    { name: 'UpdateChannel', members: UPDATE_CHANNELS, guard: isUpdateChannel, spec: ['stable', 'dev'] },
    { name: 'UpdateState', members: UPDATE_STATES, guard: isUpdateState,
      spec: ['idle', 'pending', 'applying', 'reverted', 'failed', 'unknown'] },
    { name: 'UpdatePhase', members: UPDATE_PHASES, guard: isUpdatePhase,
      spec: ['queued', 'resolving', 'fetching', 'verifying', 'backing-up', 'installing', 'restarting',
        'checking', 'restoring', 'done', 'reverted', 'failed', 'unknown'] },
    { name: 'InstallState', members: INSTALL_STATES, guard: isInstallState, spec: ['complete', 'incomplete', 'unknown'] },
    { name: 'ProvenanceState', members: PROVENANCE_STATES, guard: isProvenanceState,
      spec: ['verified', 'unverified', 'unknown'] },
    { name: 'AutoMode', members: AUTO_MODES, guard: isAutoMode, spec: ['off', 'stable', 'channel'] },
    { name: 'NotifyMode', members: NOTIFY_MODES, guard: isNotifyMode, spec: ['channel', 'stable', 'off'] },
    { name: 'RequestKind', members: REQUEST_KINDS, guard: isRequestKind, spec: ['update', 'rollback'] },
    { name: 'StampRead', members: STAMP_READS, guard: isStampRead, spec: ['ok', 'absent', 'unreadable', 'malformed'] },
    { name: 'NodeRole', members: NODE_ROLES, guard: isNodeRole, spec: ['server', 'fleet', 'both'] },
    { name: 'NodeOs', members: NODE_OSES, guard: isNodeOs, spec: ['linux', 'darwin', 'unknown'] },
  ];

  for (const { name, members, guard, spec } of VOCABS) {
    it(`${name}: the array is the spec's list, in order, with no duplicate`, () => {
      expect([...members]).toEqual(spec);
      expect(new Set(members).size).toBe(members.length);
    });

    it(`${name}: the guard admits every member and nothing else`, () => {
      for (const m of members) expect(guard(m), m).toBe(true);
      const probes: unknown[] = [
        '', null, undefined, 1, true, {}, [], 'toString', 'constructor',
        ...members.flatMap((m) => [m.toUpperCase(), ` ${m}`, `${m} `, `${m}\n`, [m], { [m]: true }]),
      ];
      for (const p of probes) {
        const inArray = typeof p === 'string' && members.includes(p);
        expect(guard(p), `${name} guard on ${JSON.stringify(p)}`).toBe(inArray);
      }
    });
  }
});

describe('the release tag (decision 2): one shape, the same as the bash twin', () => {
  // The shared fixture list: the shapes a same-user writer, a hand-typed
  // `--to` or a mis-cut release could present.
  const FIXTURES = [
    'v0.0.9', 'v0.0.10', 'v1.2.3', 'v10.20.30', 'v0.0.010', 'v0.0.0',
    '0.0.9', 'v0.0.9 ', ' v0.0.9', 'v0.0.9\n', 'v0.0', 'v0.0.9.1', 'V0.0.9', 'v0..9', 'v.0.0.9',
    'v0.0.9-rc1', 'v0.0.9+meta', 'vv0.0.9', 'v-1.0.0', 'v1e3.0.0', 'v0x1.0.0', 'v\u0661.0.0', '',
  ];

  it('refuses the five shapes the plan names', () => {
    for (const bad of ['0.0.9', 'v0.0.9 ', 'v0.0.9\n', 'v0.0', 'V0.0.9']) {
      expect(isReleaseTag(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isReleaseTag('v0.0.9')).toBe(true);
    for (const v of [null, undefined, 9, ['v0.0.9'], { tag: 'v0.0.9' }]) expect(isReleaseTag(v)).toBe(false);
  });

  it('has no flags — a `g` would make every second `.test` of the same string answer false', () => {
    expect(RELEASE_TAG.flags).toBe('');
    expect([isReleaseTag('v0.0.9'), isReleaseTag('v0.0.9'), isReleaseTag('v0.0.9')]).toEqual([true, true, true]);
  });

  it('is byte-for-byte deploy/release-main.sh\'s SHAPE, and agrees with it on every fixture under bash', () => {
    const src = readFileSync(path.join(REPO, 'deploy', 'release-main.sh'), 'utf8');
    const m = /^SHAPE='([^']+)'$/m.exec(src);
    expect(m, 'deploy/release-main.sh no longer assigns SHAPE on one line').not.toBeNull();
    const shape = m![1]!;
    expect(RELEASE_TAG.source).toBe(shape);
    // LC_ALL=C: bash's `=~` follows the locale, and `[0-9]` is only ASCII
    // digits in C — the JS class is ASCII-only unconditionally.
    for (const f of FIXTURES) {
      const r = spawnSync('bash', ['-c', '[[ $1 =~ $2 ]]', '--', f, shape],
        { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
      expect(r.status === 0, `bash SHAPE on ${JSON.stringify(f)}`).toBe(isReleaseTag(f));
    }
  });
});

describe('caps and ops words (§8, decision 13)', () => {
  it('CAP_WORD is pool-epoch\'s NAME grammar: 1–32 chars, lowercase first', () => {
    for (const ok of ['verify', 'node-id', 'floor', 'update-gate', 'a', 'a'.repeat(32), 'x9-']) {
      expect(CAP_WORD.test(ok), ok).toBe(true);
    }
    for (const bad of ['', 'a'.repeat(33), 'Verify', '9lives', '-x', 'node_id', 'verify\n', 'verify ', 'os linux']) {
      expect(CAP_WORD.test(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(CAP_WORD.flags).toBe('');
  });

  it('validCapWords: [] is a valid empty list, and null is a REFUSAL — two answers, never one', () => {
    expect(validCapWords([])).toEqual([]);
    expect(validCapWords(['verify', 'node-id', 'floor'])).toEqual(['verify', 'node-id', 'floor']);
    const full = Array.from({ length: MAX_CAP_WORDS }, (_, i) => `w${i}`);
    expect(validCapWords(full)).toEqual(full);
    expect(validCapWords([...full, 'w32']), '33 words').toBeNull();
    expect(validCapWords(['verify', 'Bad', 'floor']), 'one bad word drops the whole list').toBeNull();
    expect(validCapWords(['verify', 7]), 'a non-string').toBeNull();
    expect(validCapWords(['verify', null]), 'a null element').toBeNull();
    expect(validCapWords('verify' as unknown as unknown[]), 'not an array').toBeNull();
    expect(MAX_CAP_WORDS).toBe(32);
  });

  it('returns a copy, never the caller\'s array', () => {
    const input = ['verify'];
    const out = validCapWords(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});

// ── The compile-time half: every union is covered by its array ──────────────
// `as const satisfies readonly X[]` refuses an array member the union lacks;
// these lines refuse a union member the array lacks. Each is `never` exactly
// when the array names every member — otherwise TS2322 in the tests project,
// which `typecheck-tests.test.ts` ("server/test/ is clean") compiles.
type Missing<T, A extends readonly unknown[]> = Exclude<T, A[number]>;
const _channels: never = null as unknown as Missing<UpdateChannel, typeof UPDATE_CHANNELS>;
const _states: never = null as unknown as Missing<UpdateState, typeof UPDATE_STATES>;
const _classified: never = null as unknown as Exclude<UpdateState, BusyUpdateState | SettledUpdateState>;
const _overlap: never = null as unknown as Extract<BusyUpdateState, SettledUpdateState>;
const _phases: never = null as unknown as Missing<UpdatePhase, typeof UPDATE_PHASES>;
const _installs: never = null as unknown as Missing<InstallState, typeof INSTALL_STATES>;
const _provenance: never = null as unknown as Missing<ProvenanceState, typeof PROVENANCE_STATES>;
const _autos: never = null as unknown as Missing<AutoMode, typeof AUTO_MODES>;
const _notifies: never = null as unknown as Missing<NotifyMode, typeof NOTIFY_MODES>;
const _kinds: never = null as unknown as Missing<RequestKind, typeof REQUEST_KINDS>;
const _roles: never = null as unknown as Missing<NodeRole, typeof NODE_ROLES>;
const _oses: never = null as unknown as Missing<NodeOs, typeof NODE_OSES>;
// StampRead's failure half IS ReadFailure, in both directions: a word added to
// either side alone is a type error here (`shared/api.ts`'s StampRead docstring).
const _stampFailuresCovered: never = null as unknown as Exclude<ReadFailure, StampRead>;
const _stampFailuresOnly: never = null as unknown as Exclude<Exclude<StampRead, 'ok' | 'malformed'>, ReadFailure>;
void [_channels, _states, _classified, _overlap, _phases, _installs, _provenance, _autos, _notifies, _kinds,
  _roles, _oses, _stampFailuresCovered, _stampFailuresOnly];
```

- [ ] **Step 2: Write the failing single-definition cases (line-neutral above, appended below)**

In `server/test/single-definition.test.ts`, extend line 23 IN PLACE — the same line, no wrap, because a new line here shifts the three citations `session-hook.test.ts`'s audit holds into this file. Replace

```ts
  ASK_STATES, isAskState, ASK_REFUSE_CODES, isAskRefuseCode, ROUTE_WRITABLE_FIELDS,
```

with

```ts
  ASK_STATES, isAskState, ASK_REFUSE_CODES, isAskRefuseCode, ROUTE_WRITABLE_FIELDS, UPDATE_CHANNELS, UPDATE_STATES, UPDATE_PHASES, INSTALL_STATES, PROVENANCE_STATES, AUTO_MODES, NOTIFY_MODES, REQUEST_KINDS, STAMP_READS, NODE_ROLES, NODE_OSES,
```

Then append after the file's last line (`:3302`, the closing `});` of `describe('the pane read is declared once, in L0')`):

```ts

// ── Design 2026-09-20 §6: the update control plane's vocabularies ──────────
// APPENDED, never inserted: `session-hook.test.ts`'s citation audit cites
// this file by line (its census carries a `server/test/single-definition.
// test.ts` entry), so an insert above a cited line moves the census.
describe('the update control plane — one definition per vocabulary and wire type (design 2026-09-20 §6)', () => {
  // The `RunState` shape (`Build 7 nouns`): one declaring file, and it is
  // shared/api.ts. A local, un-exported redeclaration counts too — it is the
  // same second copy with one fewer keyword.
  const TYPES = [
    'UpdateChannel', 'UpdateState', 'BusyUpdateState', 'SettledUpdateState', 'UpdatePhase', 'InstallState',
    'ProvenanceState', 'AutoMode', 'NotifyMode', 'RequestKind', 'StampRead', 'NodeRole', 'NodeOs',
    'CatalogueErrorReason', 'ReleaseRefusalWire', 'ReleaseWire', 'NodeRequestWire', 'NodeReportWire',
    'NodeUpdateWire', 'NodeWire', 'UpdateIntentWire', 'CatalogueState', 'UpdatesView', 'UpdateRouteError',
    'UpdateRouteRefusal', 'IntentWriteAnswer', 'AckAnswer',
  ] as const;
  // The DECLARATION shape, not the bare keyword: `type <Name> [<…>] =` or
  // `interface <Name>`, `export`/`declare` optional. The bare `(?:type|
  // interface)\s+<Name>\b` form also matches an inline-type import specifier
  // that happens to open its line (`  type UpdateChannel,` inside a multi-line
  // `import { … }`), which is exactly how store.ts, update/inventory.ts and
  // update/routes.ts import these names in later tasks — every such file would
  // score as a second holder. `Build 7 nouns`' `export type RunState\b` avoids
  // it by requiring `export`; this scan keeps `export` optional (a local
  // un-exported copy is still a copy), so it requires the `=` instead.
  const DEF_OF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  for (const name of TYPES) {
    it(`declares ${name} exactly once, in shared/api.ts`, () => {
      const DEF = DEF_OF(name);
      // Controls, per name, so a later loosening of DEF_OF reds every case:
      // an import specifier is not a declaration; an un-exported one is.
      expect(DEF.test(`import {\n  type ${name},\n} from '../../../shared/api.js';`), 'import specifier').toBe(false);
      expect(DEF.test(`type ${name} = 'a';`), 'un-exported local declaration').toBe(true);
      expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
    });
  }

  const VALUES = [
    'UPDATE_CHANNELS', 'UPDATE_STATES', 'BUSY_UPDATE_STATES', 'SETTLED_UPDATE_STATES', 'UPDATE_PHASES',
    'IN_FLIGHT_UPDATE_PHASES', 'INSTALL_STATES', 'PROVENANCE_STATES', 'AUTO_MODES', 'NOTIFY_MODES',
    'REQUEST_KINDS', 'STAMP_READS', 'NODE_ROLES', 'NODE_OSES', 'RELEASE_TAG', 'CAP_WORD', 'MAX_CAP_WORDS',
    'FLEET_SCOPE',   // ruling R4: shared/api.ts only — store.ts (Task 6) and resolve.ts/project.ts (Task 12) import it
  ] as const;
  const GUARDS = [
    'isUpdateChannel', 'isUpdateState', 'isUpdatePhase', 'isInstallState', 'isProvenanceState', 'isAutoMode',
    'isNotifyMode', 'isRequestKind', 'isStampRead', 'isNodeRole', 'isNodeOs', 'isReleaseTag', 'validCapWords',
  ] as const;
  it('defines every array, pattern and guard exactly once, in shared/api.ts', () => {
    for (const name of VALUES) {
      const DEF = new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
      expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
    for (const name of GUARDS) {
      const DEF = new RegExp(`^\\s*(?:export\\s+)?function\\s+${name}\\b`, 'm');
      expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
  });

  it('StampRead is DERIVED from its array — a hand-written union restates ReadFailure\'s pair', () => {
    // `'absent' | 'unreadable'` spelled in shared/api.ts would make it a second
    // holder in "one absent/unreadable read vocabulary" above, and this file
    // cannot import ReadFailure (peers-claims-l0.test.ts pins its three type
    // imports). So the union comes from STAMP_READS, and update-states.test.ts
    // holds its failure half equal to ReadFailure at compile time.
    const api = readFileSync(path.join(ccrcRoot, 'shared', 'api.ts'), 'utf8');
    expect(api).toMatch(/^export const STAMP_READS = \['ok', 'absent', 'unreadable', 'malformed'\] as const;$/m);
    expect(api).toMatch(/^export type StampRead = \(typeof STAMP_READS\)\[number\];$/m);
  });

  it('spells the tag shape once — every other reader calls isReleaseTag', () => {
    // The literal regex SOURCE, however delimited. `shared/semver.ts` checks
    // its precondition structurally and is held to agree with isReleaseTag by
    // `update-semver.test.ts`, so it is not a holder here either.
    const SHAPE_TEXT = 'v[0-9]+\\.[0-9]+\\.[0-9]+';
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes(SHAPE_TEXT)).map(rel);
    expect(holders).toEqual(['shared/api.ts']);
  });

  // THE SQL-TUPLE SCANS — the `TERMINAL_ITEM_STATES` shape. Store code that
  // needs one of these sets in a `WHERE` builds it from the array by `.join`
  // (the `TERMINAL_DELIVERY_SQL` idiom), so the shipped source holds no
  // literal tuple at all; a hand-written `IN ('pending','applying','unknown')`
  // is a second definition of busy that nothing forces to agree.
  //
  // THE FINGERPRINT: a parenthesised list of TWO OR MORE quoted words, every
  // one of them a member, in any order — a copy from memory is as likely in
  // any order. Two or more, because a single `('stable')` states no set; a
  // whole list, because the §6 seed row `('*', 'stable', NULL, 'off',
  // 'channel', 0, 'migration')` carries members beside non-members and is not
  // a copy of any vocabulary (asserted below, since Task 3 ships it).
  // KNOWN WIDTH: a tuple of another vocabulary made only of words it shares
  // with one of these (`('done','failed')` is RunState's and UpdatePhase's)
  // also scores. Measured zero holders for every vocabulary at d759c914; if
  // such a tuple ever lands legitimately it is a hand-typed SQL list of THAT
  // vocabulary, which its own scan should be refusing.
  const esc = (w: string): string => w.replace(/[-]/g, '\\-');
  const tupleOf = (members: readonly string[]): RegExp => {
    const alt = `(?:${members.map(esc).join('|')})`;
    return new RegExp(`\\(\\s*['"]${alt}['"]\\s*(?:,\\s*['"]${alt}['"]\\s*)+\\)`);
  };
  const SQL_VOCABS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['UpdateChannel', UPDATE_CHANNELS], ['UpdateState', UPDATE_STATES], ['UpdatePhase', UPDATE_PHASES],
    ['InstallState', INSTALL_STATES], ['ProvenanceState', PROVENANCE_STATES], ['AutoMode', AUTO_MODES],
    ['NotifyMode', NOTIFY_MODES], ['RequestKind', REQUEST_KINDS], ['StampRead', STAMP_READS],
    ['NodeRole', NODE_ROLES], ['NodeOs', NODE_OSES],
  ];

  it('the tuple fingerprint catches a copy in any order and leaves non-copies alone', () => {
    const busy = tupleOf(UPDATE_STATES);
    expect(busy.test("WHERE updateState IN ('pending','applying','unknown')")).toBe(true);
    expect(busy.test("WHERE updateState IN ( 'unknown', \"pending\" )")).toBe(true);
    expect(busy.test("WHERE updateState IN ('idle')"), 'one word is not a set').toBe(false);
    expect(busy.test("WHERE updateState IN ('idle', 'paused')"), 'a non-member breaks the list').toBe(false);
    expect(busy.test("['pending', 'applying', 'unknown'] as const"), 'a TS array is the definition').toBe(false);
    const seed = "INSERT INTO update_intent VALUES ('*', 'stable', NULL, 'off', 'channel', 0, 'migration');";
    expect(tupleOf(AUTO_MODES).test(seed), 'the §6 seed row is not an AutoMode tuple').toBe(false);
    expect(tupleOf(NOTIFY_MODES).test(seed), 'the §6 seed row is not a NotifyMode tuple').toBe(false);
    expect(tupleOf(UPDATE_CHANNELS).test(seed), 'the §6 seed row is not an UpdateChannel tuple').toBe(false);
    expect(tupleOf(UPDATE_PHASES).test("('backing-up', 'installing')"), 'hyphenated members').toBe(true);
  });

  for (const [name, members] of SQL_VOCABS) {
    it(`no source hand-types an SQL tuple of ${name}`, () => {
      const TUPLE = tupleOf(members);
      expect(ALL.filter((f) => TUPLE.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
    });
  }
});
```

- [ ] **Step 3: Run the new cases to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/update-states.test.ts`
Expected: FAIL — `Tests  32 failed (32)`, with `TypeError: BUSY_UPDATE_STATES is not iterable`, `TypeError: members is not iterable`, `TypeError: isReleaseTag is not a function` and `Cannot read properties of undefined (reading 'flags')` among the causes (the names import as `undefined`; nothing is exported yet).

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'update control plane'`
Expected: FAIL — `Tests  42 failed | 160 skipped (202)`: each `declares <Name> exactly once` answers `expected [] to deeply equal [ 'shared/api.ts' ]`, the value/guard case answers `UPDATE_CHANNELS: expected [] to deeply equal [ 'shared/api.ts' ]`, the `StampRead` form case fails its `toMatch`, and every tuple scan throws `Cannot read properties of undefined (reading 'map')`.

- [ ] **Step 4: Append the vocabularies and wire types to `shared/api.ts`**

Append after `export const READER_MIN_COLS = 120;` (`shared/api.ts:8138`, the last line). The block starts with a blank line; no line above `:8138` changes, and no `import` is added:

```ts

/* ---------------------------------------------------------------------------
 * CENTRALISED UPDATE MANAGEMENT — the control plane's vocabularies and wire
 * (design 2026-09-20 §6, §8, §12; W2 plan Task 1).
 *
 * AT THE END OF THE FILE, deliberately, and not beside `BuildAgreement` where
 * the topic would put it: `README.md` cites this file BY LINE
 * (`lcRefusalWord`'s purge refusals), and `session-hook.test.ts`'s citation
 * audit reds on any line inserted above them — measured, a ten-line insert
 * after `BuildAgreement` reds two of its cases. An append moves no cited line.
 *
 * Every vocabulary below is ONE union, ONE runtime array checked against it
 * with `as const satisfies` (a member the union lacks is a compile error), and
 * ONE guard that casts the constant, never the input — `isRunState`'s idiom.
 * `server/test/update-states.test.ts` holds each array equal to its union in
 * the other direction and each guard equal to its array. SQL that needs a set
 * builds it from the array by `.join`; `single-definition.test.ts` refuses a
 * hand-typed SQL tuple of any of these words.
 * ------------------------------------------------------------------------- */

/** A release channel (decision 2): `dev` is every merge, `stable` a promotion
 *  of an existing release. No we-do-not-know member, on purpose: a channel
 *  token this build cannot name reads `null` (the ClaimState stance, §6) and
 *  the resolver resolves NOTHING for that node — never the fleet default,
 *  which would be fail-open. */
export type UpdateChannel = 'stable' | 'dev';
export const UPDATE_CHANNELS = ['stable', 'dev'] as const satisfies readonly UpdateChannel[];
/** Use THIS, never `UPDATE_CHANNELS.includes(x as UpdateChannel)` — `isRunState`'s rule. */
export function isUpdateChannel(v: unknown): v is UpdateChannel {
  return typeof v === 'string' && (UPDATE_CHANNELS as readonly string[]).includes(v);
}

/** A node's LEASE state (`nodes.updateState`, §6). `unknown` is the designated
 *  we-do-not-know member: never written by a settled path, it is what a token
 *  from a newer build reads as — and it counts as BUSY below. */
export type UpdateState = 'idle' | 'pending' | 'applying' | 'reverted' | 'failed' | 'unknown';
export const UPDATE_STATES = ['idle', 'pending', 'applying', 'reverted', 'failed', 'unknown'] as const satisfies
  readonly UpdateState[];
/** Use THIS, never `UPDATE_STATES.includes(x as UpdateState)` — `isRunState`'s rule. */
export function isUpdateState(v: unknown): v is UpdateState {
  return typeof v === 'string' && (UPDATE_STATES as readonly string[]).includes(v);
}
/** BUSY = a lease is held, or might be: nothing may be dispatched to the node.
 *  `unknown` is here for the reason `RunState`'s `unknown` is ACTIVE for the
 *  cap (`ACTIVE_RUN_STATES`): a node whose state cannot be read must not be
 *  dispatched to, and §10's deadline turns a stale `unknown` into `failed`.
 *  SETTLED = the complement; a dispatch acquires only from one of these.
 *  Every `UpdateState` is in exactly one list (`update-states.test.ts`). */
export const BUSY_UPDATE_STATES = ['pending', 'applying', 'unknown'] as const satisfies readonly UpdateState[];
export const SETTLED_UPDATE_STATES = ['idle', 'reverted', 'failed'] as const satisfies readonly UpdateState[];
export type BusyUpdateState = (typeof BUSY_UPDATE_STATES)[number];
export type SettledUpdateState = (typeof SETTLED_UPDATE_STATES)[number];

/** The phase a node's own updater REPORTS in `~/.ccrc/update.json` (§8). `unknown`
 *  is what a phase token outside this list reads as — distinct from a NULL
 *  `reportedPhase`, which means there is no report file at all. */
export type UpdatePhase = 'queued' | 'resolving' | 'fetching' | 'verifying' | 'backing-up' | 'installing'
  | 'restarting' | 'checking' | 'restoring' | 'done' | 'reverted' | 'failed' | 'unknown';
export const UPDATE_PHASES = [
  'queued', 'resolving', 'fetching', 'verifying', 'backing-up', 'installing',
  'restarting', 'checking', 'restoring', 'done', 'reverted', 'failed', 'unknown',
] as const satisfies readonly UpdatePhase[];
/** Use THIS, never `UPDATE_PHASES.includes(x as UpdatePhase)` — `isRunState`'s rule. */
export function isUpdatePhase(v: unknown): v is UpdatePhase {
  return typeof v === 'string' && (UPDATE_PHASES as readonly string[]).includes(v);
}
/** §8's phase table, first row: every phase here derives `updateState =
 *  'applying'`. The other four (`done`, `reverted`, `failed`, `unknown`) each
 *  have a row of their own and are deliberately NOT a list — each is decided
 *  by name. */
export const IN_FLIGHT_UPDATE_PHASES = [
  'queued', 'resolving', 'fetching', 'verifying', 'backing-up', 'installing',
  'restarting', 'checking', 'restoring',
] as const satisfies readonly UpdatePhase[];

/** Whether the node's completed-install marker names its stamp (§8, `~/.ccrc/installed`
 *  line 1). `unknown` = the stamp could not be read, so nothing can be compared. */
export type InstallState = 'complete' | 'incomplete' | 'unknown';
export const INSTALL_STATES = ['complete', 'incomplete', 'unknown'] as const satisfies readonly InstallState[];
/** Use THIS, never `INSTALL_STATES.includes(x as InstallState)` — `isRunState`'s rule. */
export function isInstallState(v: unknown): v is InstallState {
  return typeof v === 'string' && (INSTALL_STATES as readonly string[]).includes(v);
}

/** A MEASUREMENT of the node's marker line 2 (§8), and the only word on the
 *  wire ever spelled "verified" (§13) — `ReleaseWire.bundleListed` is a claim
 *  about a filename, not this. */
export type ProvenanceState = 'verified' | 'unverified' | 'unknown';
export const PROVENANCE_STATES = ['verified', 'unverified', 'unknown'] as const satisfies
  readonly ProvenanceState[];
/** Use THIS, never `PROVENANCE_STATES.includes(x as ProvenanceState)` — `isRunState`'s rule. */
export function isProvenanceState(v: unknown): v is ProvenanceState {
  return typeof v === 'string' && (PROVENANCE_STATES as readonly string[]).includes(v);
}

/** Unattended updating, per intent scope (§6 `update_intent.auto`). No
 *  we-do-not-know member: an out-of-vocabulary token READS as `off` — the
 *  direction in which nothing moves unattended. */
export type AutoMode = 'off' | 'stable' | 'channel';
export const AUTO_MODES = ['off', 'stable', 'channel'] as const satisfies readonly AutoMode[];
/** Use THIS, never `AUTO_MODES.includes(x as AutoMode)` — `isRunState`'s rule. */
export function isAutoMode(v: unknown): v is AutoMode {
  return typeof v === 'string' && (AUTO_MODES as readonly string[]).includes(v);
}

/** Which releases the operator is told about (§6 `update_intent.notify`, read
 *  by W3). An out-of-vocabulary token READS as `channel` — the operator hears
 *  of more, never of nothing. */
export type NotifyMode = 'channel' | 'stable' | 'off';
export const NOTIFY_MODES = ['channel', 'stable', 'off'] as const satisfies readonly NotifyMode[];
/** Use THIS, never `NOTIFY_MODES.includes(x as NotifyMode)` — `isRunState`'s rule. */
export function isNotifyMode(v: unknown): v is NotifyMode {
  return typeof v === 'string' && (NOTIFY_MODES as readonly string[]).includes(v);
}

/** What an operator request asks a node to do (§6 request columns; written by
 *  W4's `requestNode`). */
export type RequestKind = 'update' | 'rollback';
export const REQUEST_KINDS = ['update', 'rollback'] as const satisfies readonly RequestKind[];
/** Use THIS, never `REQUEST_KINDS.includes(x as RequestKind)` — `isRunState`'s rule. */
export function isRequestKind(v: unknown): v is RequestKind {
  return typeof v === 'string' && (REQUEST_KINDS as readonly string[]).includes(v);
}

/** How the read of a node's `~/.ccrc/build.json` went (§6 `nodes.stampRead`,
 *  §8). `ok` with a NULL `currentVersion` is an unversioned build (a
 *  `deploy.sh` push); `unreadable` is NEVER "unversioned" (D-1396's lesson at
 *  a new seam). A token outside the list reads `unreadable`.
 *
 *  ITS TWO FAILURE WORDS ARE `ReadFailure`'s (`shared/agent-protocol.ts`),
 *  widened by `ok` and `malformed`. This file cannot import that type (its
 *  three type-only imports are pinned, `peers-claims-l0.test.ts`), so the
 *  union is DERIVED from the array rather than restated beside it, and
 *  `update-states.test.ts` holds `Exclude<StampRead, 'ok' | 'malformed'>`
 *  EQUAL to `ReadFailure` at compile time: a third read-failure word added
 *  there is a type error here until this list names it too. */
export const STAMP_READS = ['ok', 'absent', 'unreadable', 'malformed'] as const;
export type StampRead = (typeof STAMP_READS)[number];
/** Use THIS, never `STAMP_READS.includes(x as StampRead)` — `isRunState`'s rule. */
export function isStampRead(v: unknown): v is StampRead {
  return typeof v === 'string' && (STAMP_READS as readonly string[]).includes(v);
}

/** A node's role (§6 `nodes.role`): the bash spine's `CCRC_ROLE` words. A
 *  token outside the list reads `null` on the wire. */
export type NodeRole = 'server' | 'fleet' | 'both';
export const NODE_ROLES = ['server', 'fleet', 'both'] as const satisfies readonly NodeRole[];
/** Use THIS, never `NODE_ROLES.includes(x as NodeRole)` — `isRunState`'s rule. */
export function isNodeRole(v: unknown): v is NodeRole {
  return typeof v === 'string' && (NODE_ROLES as readonly string[]).includes(v);
}

/** A node's OS, from `~/.ccrc/ccrc-caps` line 1 (`os linux|darwin`, §8).
 *  `unknown` = no caps file, or one that failed validation. */
export type NodeOs = 'linux' | 'darwin' | 'unknown';
export const NODE_OSES = ['linux', 'darwin', 'unknown'] as const satisfies readonly NodeOs[];
/** Use THIS, never `NODE_OSES.includes(x as NodeOs)` — `isRunState`'s rule. */
export function isNodeOs(v: unknown): v is NodeOs {
  return typeof v === 'string' && (NODE_OSES as readonly string[]).includes(v);
}

/** The canonical form of a version everywhere (decision 2): the TAG, `vX.Y.Z`.
 *  No flags — a `g` would make `.test` stateful through `lastIndex`. JS `$`
 *  without `m` matches only at the end of the input, so `'v0.0.9\n'` is
 *  refused. `deploy/release-main.sh`'s `SHAPE` is the bash twin, held equal
 *  by `update-states.test.ts`. */
export const RELEASE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
/** The ONE tag-shape guard: the routes, the resolver, the inventory's
 *  validators and the agent all call this, never the regex. */
export function isReleaseTag(v: unknown): v is string {
  return typeof v === 'string' && RELEASE_TAG.test(v);
}

/** One word of `~/.ccrc/ccrc-caps` or of `AgentReady.ops` (§8, decision 13) —
 *  pool-epoch's NAME grammar. */
export const CAP_WORD = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_CAP_WORDS = 32;
/** The ONE validator for a caps or ops word list. `null` = REFUSED: an element
 *  that is not a string matching `CAP_WORD`, more than `MAX_CAP_WORDS`
 *  elements, or not an array at all. `[]` = a valid EMPTY list. The two are
 *  kept apart here so a caller can say which it saw; §8's storage rule then
 *  writes both as `''` — one bad word drops the whole file, never just that
 *  word. */
export function validCapWords(words: readonly unknown[]): string[] | null {
  if (!Array.isArray(words) || words.length > MAX_CAP_WORDS) return null;
  const out: string[] = [];
  for (const w of words) {
    if (typeof w !== 'string' || !CAP_WORD.test(w)) return null;
    out.push(w);
  }
  return out;
}

/** Why the last catalogue poll did not land (§7). `http-<status>` carries the
 *  status the listing answered with. */
export type CatalogueErrorReason = 'no-egress' | 'rate-limited' | `http-${number}` | 'malformed' | 'no-release-source';

/** One node's refusal of one release, rolled up for DISPLAY (`node_release_refusals`).
 *  `by` is the refusing node's id. Never a predicate: eligibility reads the
 *  table for THIS node (decision 16), not this roll-up. */
export interface ReleaseRefusalWire { by: string; at: number }
/** One row of the release catalogue (§6 `releases`, §12). `channel` is `null`
 *  for a token this build cannot name (the ClaimState stance, §6). */
export interface ReleaseWire {
  tag: string; version: string; channel: UpdateChannel | null; publishedAt: number; commitSha: string | null;
  bundleListed: boolean; yanked: boolean;
  refused: ReleaseRefusalWire[];
  notes: string | null;
}
/** An operator request standing on a node (§6 request columns). */
export interface NodeRequestWire { tag: string; kind: RequestKind; at: number }
/** The node's own report, validated (§8). Times are epoch ms on the wire;
 *  `~/.ccrc/update.json` carries unix SECONDS, converted once by the reader. */
export interface NodeReportWire {
  phase: UpdatePhase; target: string | null; startedAt: number | null; updatedAt: number | null;
  detail: string | null;
}
/** The lease (§6 lease columns). `target` outlives `state` returning to `idle`. */
export interface NodeUpdateWire { state: UpdateState; target: string | null; startedAt: number | null; detail: string | null }
/** One node of the inventory (§6 `nodes`, §12). `agentOps` NULL = no agent by
 *  construction (the server's own row); `[]` = an agent too old to say.
 *  CORRECTION (fix round 2, R4/C1): `floorRead?`/`previousRead?` (`TagFileRead`)
 *  are ALWAYS sent by `toNodeWire`; optional only for an older
 *  fixture/consumer (additive wire discipline, no FLEET_PROTO bump). */
export interface NodeWire {
  nodeId: string; role: NodeRole | null; label: string; os: NodeOs;
  current: BuildInfo | null; stampRead: StampRead; installState: InstallState; provenance: ProvenanceState;
  caps: string[]; agentOps: string[] | null; highestVersion: string | null; previousVersion: string | null;
  floorRead?: TagFileRead; previousRead?: TagFileRead;
  measuredAt: number | null; reachable: boolean; unreachableSince: number | null;
  channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null;
  request: NodeRequestWire | null;
  report: NodeReportWire | null;
  update: NodeUpdateWire;
}
/** One intent row (§6 `update_intent`); `scope` is `FLEET_SCOPE` or a node id. */
export interface UpdateIntentWire {
  scope: string; channel: UpdateChannel | null; pinnedTag: string | null; auto: AutoMode; notify: NotifyMode;
  setAt: number; setBy: string;
}
/** The fleet-default intent scope (§6 `update_intent.scope`, the migration's
 *  seed row). Declared HERE and nowhere else: the store (`coord/store.ts`) and
 *  the L1 resolver (`update/resolve.ts`, which may import only `shared/`) both
 *  import it, so the scope the store writes and the scope the resolver falls
 *  back to cannot be two spellings. */
export const FLEET_SCOPE = '*';
/** The poller's own state (§7). `{lastOkAt: null, lastError: null}` = never
 *  checked since this process started — never "up to date". */
export interface CatalogueState { lastOkAt: number | null; lastError: { at: number; reason: string } | null }
/** `GET /api/updates` (§12). */
export interface UpdatesView { catalogue: CatalogueState; releases: ReleaseWire[]; nodes: NodeWire[]; intent: UpdateIntentWire[] }

/** Every refusal word an update route answers with (§12). */
export type UpdateRouteError =
  | 'unauthenticated' | 'not-configured' | 'bad-tag' | 'bad-request' | 'unknown-scope' | 'unknown-node'
  | 'superseded' | 'busy' | 'auto-needs-rollback-gate' | 'rate-limited' | 'no-channel'
  | 'journal-unreadable' | 'journal-unwritable';
export interface UpdateRouteRefusal {
  ok: false; error: UpdateRouteError;
  field?: string; nodes?: string[]; detail?: string; retryAfterS?: number;
}
export interface IntentWriteAnswer { ok: true; intent: UpdateIntentWire; epoch: number }
export interface AckAnswer { ok: true; node: NodeWire }
```

- [ ] **Step 5: Run green — the new cases, the L0 pins, and the citation audit that fixed the placement**

Run, one at a time, foreground, from `server/`. (The counts below were measured before ruling R4 added `FLEET_SCOPE` and R1 widened `NodeReportWire`'s docstring; neither adds a test case — `FLEET_SCOPE` joins the one existing `VALUES` case — so the counts are expected to hold, but re-measure them rather than copy them. Nor does the declaration-shape `DEF_OF` fix: its two controls are `expect`s inside each existing `declares <Name>` case, not new cases.)
`./node_modules/.bin/vitest run test/update-states.test.ts` → `Tests  32 passed (32)`
`./node_modules/.bin/vitest run test/single-definition.test.ts` → `Tests  202 passed (202)` (160 existing + 42 new)
`./node_modules/.bin/vitest run test/peers-claims-l0.test.ts test/run-states.test.ts test/module-format.test.ts test/reader-min-cols.test.ts` → PASS (the three-import pin is untouched; `READER_MIN_COLS`' derivation window is the lines ABOVE it, which an append does not move)
`./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` → `Tests  13 passed | 320 skipped (333)` — the census (`'shared/api.ts': 1`, `'server/test/single-definition.test.ts': 8`) and the README's empty entry unchanged
Compile-time half: `node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit` → no error in `test/update-states.test.ts` or `shared/api.ts` (on a worktree with `server/` modules only, the four `../agent/src/server.ts` errors about `ws` are the missing agent install, not this task; `./node_modules/.bin/vitest run test/typecheck-tests.test.ts -t 'server/test/ is clean'` is the gate CI runs, with agent/pwa installed). The PWA bundles this file under `noUnusedLocals`: `cd ../pwa && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` → no output.

- [ ] **Step 6: Mutation measurements (restore after each; the sentinel is `git diff --stat shared/api.ts` showing only this task's append)**

Each was measured on a scratch copy of d759c914 carrying exactly the code above.

1. §18 "every `UpdateState` classified once", compile half — add `| 'paused'` to the end of the `UpdateState` union ONLY. `node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit` → `test/update-states.test.ts(…): error TS2322: Type '"paused"' is not assignable to type 'never'.` twice (the `_states` and `_classified` lines). Restore.
2. Same row, runtime half — add `'paused'` to the union AND to `UPDATE_STATES` (not to busy/settled). `./node_modules/.bin/vitest run test/update-states.test.ts` → 3 red: "places every UpdateState in exactly one list", "classifies nothing that is not an UpdateState, and covers all of them", "UpdateState: the array is the spec's list, in order, with no duplicate". Restore.
3. §18 "`unknown` is busy" — move `'unknown'` from `BUSY_UPDATE_STATES` to `SETTLED_UPDATE_STATES`. → 1 red: "counts `unknown` as BUSY — the safe direction for a lease". Restore.
4. §18 "vocabularies are declared once" — create `pwa/src/mut-update-state.ts` containing `export type UpdateState = 'idle';` and `server/src/mut-sql-tuple.ts` containing `export const Q = "WHERE updateState IN ('pending','applying','unknown')";` (names WITHOUT a `__` prefix: `sources()` skips `__`-prefixed files, so a `__mutant` would measure nothing). `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'update control plane'` → 2 red: "declares UpdateState exactly once, in shared/api.ts" and "no source hand-types an SQL tuple of UpdateState". `rm` both files; re-run → `41 passed | 160 skipped`.
5. D-3189 — replace `export type StampRead = (typeof STAMP_READS)[number];` with `export type StampRead = 'ok' | 'absent' | 'unreadable' | 'malformed';`. `./node_modules/.bin/vitest run test/single-definition.test.ts` → 3 red: "does not respell io.ts read-failure pair as the skill vocabulary", "is declared in exactly one file, and that file is shared/agent-protocol.ts", "StampRead is DERIVED from its array — a hand-written union restates ReadFailure's pair". Restore.
6. The tag shape — drop the `$` from `RELEASE_TAG`. `./node_modules/.bin/vitest run test/update-states.test.ts` → 2 red: "refuses the five shapes the plan names", "is byte-for-byte deploy/release-main.sh's SHAPE, and agrees with it on every fixture under bash". Restore.
7. Ruling R4 (NOT measured by the plan's writer — added with the ruling; measure it) — create `server/src/mut-fleet-scope.ts` containing `export const FLEET_SCOPE = '*';` (no `__` prefix, for mutation 4's reason). `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'update control plane'` → expected 1 red: "defines every array, pattern and guard exactly once, in shared/api.ts", message `FLEET_SCOPE: expected [ 'server/src/mut-fleet-scope.ts', 'shared/api.ts' ] to deeply equal [ 'shared/api.ts' ]` (or that pair in the scan's order). `rm` the file; re-run → `42 passed | 160 skipped`. This is the red Task 6 would hit if its body still declared its own `FLEET_SCOPE` in `store.ts`.
8. The declaration shape (NOT measured by the plan's writer — added with the iface-a review fix; measure it). (a) Hole closed — create `server/src/mut-import-line.ts` containing `import {\n  type UpdateChannel,\n  type AutoMode,\n} from '../../shared/api.js';\nexport const m: [UpdateChannel, AutoMode] = ['dev', 'off'];` (the multi-line inline-type import Tasks 4, 5, 6, 11 and 13 put in `store.ts`, `update/inventory.ts` and `update/routes.ts`). `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'update control plane'` → `42 passed | 160 skipped` — no red; under the bare `(?:type|interface)\s+<Name>\b` form this file scored as a second holder of `UpdateChannel` and `AutoMode`. `rm` it. (b) Still catches an un-exported copy — create `server/src/mut-local-decl.ts` containing `type UpdateChannel = 'dev';\nexport const n: UpdateChannel = 'dev';` → 1 red: "declares UpdateChannel exactly once, in shared/api.ts". `rm` it. (c) The controls bind the regex — put back the pre-fix pattern as `DEF_OF`'s body (the bare `(?:type|interface)\s+<Name>\b` form with `export` optional, exactly as this step's first draft had it) → 27 red, every "declares <Name> exactly once" case failing on its `import specifier` control (`expected true to be false`). Restore; re-run → `42 passed | 160 skipped`.

- [ ] **Step 7: Residue check and commit**

Run: `cd server && git fetch origin main && ./node_modules/.bin/vitest run test/topology-clean.test.ts` → PASS (the new file and the two edits carry no residue class).

```bash
git add shared/api.ts server/test/update-states.test.ts server/test/single-definition.test.ts
git commit -m "feat(update): L0 vocabularies and wire types for the control plane — eleven vocabularies (array + guard each, unknown busy), RELEASE_TAG/isReleaseTag, CAP_WORD/validCapWords, FLEET_SCOPE, the §12 wire; appended at the end of shared/api.ts so no cited line moves"
```

### Task 2: `shared/semver.ts` — the tag comparator

**Files:**
- Create: `shared/semver.ts`
- Test: `server/test/update-semver.test.ts` (create)
- No other file is edited. In particular this task touches no file that `session-hook.test.ts`'s citation audit cites (`shared/api.ts`, `single-definition.test.ts`, README), so R13's line-neutral rule has nothing to govern here. The repo-wide guards that walk `shared/` (`single-definition.test.ts`, `module-format.test.ts`, `topology-clean.test.ts`) are run in Steps 4 and 6 but not edited.

**Interfaces:**
- Consumes: nothing at runtime (imports nothing). The bash twin `_ver_newer` (`ccd/ccrc:1636`) and `sort -V`, both run in a subshell by the test only; the test also imports `isReleaseTag` (Task 1) to hold this file's precondition parse equal to the one guard.
- Produces:

```ts
/** Precondition: both arguments pass `isReleaseTag` (shared/api.ts) — the caller validates with the one guard.
 *  A non-tag argument throws RangeError('compareReleaseTags: not a release tag: <value>'); it is never ordered. */
export function compareReleaseTags(a: string, b: string): -1 | 0 | 1;
export function isNewerTag(a: string, b: string): boolean;          // compareReleaseTags(a, b) === 1
export function newestTag(tags: readonly string[]): string | null;   // null = the list is empty
```

  `<value>` is rendered with `JSON.stringify`, so a trailing space or newline is visible in the message. `newestTag` keeps the FIRST of equal versions (`v0.0.10` before `v0.0.010`) and throws the same RangeError on any non-tag element, the first included.
- Pins `update-semver.test.ts` carries: a fixture list of distinct-valued tags (`v0.0.9`, `v0.0.10`, `v0.1.0`, `v0.10.0`, `v1.0.0`, `v2.0.0`, `v10.0.0`, plus `v1.9.9`/`v1.9.10`, shuffled) sorted by `compareReleaseTags` equals `printf '%s\n' … | sort -V`; for every ordered pair, including the numerically-equal pair `v0.0.10`/`v0.0.010`, `isNewerTag(a, b)` equals `_ver_newer a b`'s exit status (`_ver_newer` extracted from `ccd/ccrc` by regex and run in `bash`, the W1 Task 10 shape — `ccrc-install.test.ts:3967`) and `compareReleaseTags` answers `0` exactly when neither direction is newer; a non-tag throws `RangeError`; `semver.ts`'s source has no `import` line. Added: the parse's accept set equals `isReleaseTag`'s on a 32-shape fixture list (D-3190), exactness past 2^53, antisymmetry.
- Spec pins: §9 "the comparator against a shell `sort -V` of the same list" and decision 2 ("strips the `v` inside the comparator and nowhere else"). No §18 row names the comparator alone; its §18 consumers ("the resolver never goes below the floor, pinned or not", "the two floor sentences") are Task 12's, and each of those mutations reaches this file only through them. This task's own mutations are Step 5's.

- [ ] **Step 1: Write the failing test**

Create `server/test/update-semver.test.ts`:

```ts
// Design 2026-09-20 decision 2 and §9: `shared/semver.ts` is the one TS
// comparator over the tag form, "pinned to agree with `sort -V` on a fixture
// list run through a shell". It also has a bash twin that shipped first —
// `_ver_newer` in `ccd/ccrc`, which `cmd_update`'s floor check runs on every
// box — so it is pinned to BOTH: two comparators that disagree on one pair
// would let the server resolve a tag the node's own updater then refuses as
// below its floor, or the reverse.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareReleaseTags, isNewerTag, newestTag } from '../../shared/semver.js';
import { isReleaseTag } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SEMVER = path.join(REPO, 'shared', 'semver.ts');

// Distinct VALUES only: `sort -V` has no notion of two spellings of one version
// and would order `v0.0.10`/`v0.0.010` by some tie-break of its own. Shuffled
// on purpose — an input already in order proves nothing about a sort.
const DISTINCT = ['v1.0.0', 'v0.0.10', 'v10.0.0', 'v0.1.0', 'v0.0.9', 'v2.0.0', 'v0.10.0', 'v1.9.10', 'v1.9.9'];

const sortV = (list: readonly string[]): string[] =>
  spawnSync('bash', ['-c', 'printf "%s\\n" "$@" | sort -V', '--', ...list],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).stdout.trim().split('\n');

/** `_ver_newer`, extracted from the shipped `ccd/ccrc` by regex — the W1 Task
 *  10 shape (`ccrc-install.test.ts`, "_ver_newer agrees with sort -V") — so a
 *  change to the bash function is a change to what this pins. */
const verNewerSrc = (): string => {
  const src = readFileSync(path.join(REPO, 'ccd', 'ccrc'), 'utf8');
  const fn = /^_ver_newer\(\) \{[\s\S]*?\n\}/m.exec(src);
  expect(fn, 'ccd/ccrc has no _ver_newer').not.toBeNull();
  return fn![0];
};

describe('compareReleaseTags agrees with sort -V (design §9)', () => {
  it('sorts the fixture list exactly as sort -V does', () => {
    const expected = sortV(DISTINCT);
    expect(expected, 'sort -V answered nothing — no bash or no sort on this box').toHaveLength(DISTINCT.length);
    expect([...DISTINCT].sort(compareReleaseTags)).toEqual(expected);
  });

  it('is not the lexical order — the case plain sort gets wrong', () => {
    expect(isNewerTag('v1.9.10', 'v1.9.9')).toBe(true);
    expect(isNewerTag('v0.10.0', 'v0.9.0')).toBe(true);
    expect(isNewerTag('v10.0.0', 'v9.99.99')).toBe(true);
  });
});

describe('compareReleaseTags agrees with ccd/ccrc\'s _ver_newer on every ordered pair', () => {
  const PAIRS = [...DISTINCT, 'v0.0.010'];

  it('isNewerTag(a, b) is exactly _ver_newer a b exiting 0, and 0 means neither is newer', () => {
    const fn = verNewerSrc();
    for (const a of PAIRS) {
      for (const b of PAIRS) {
        const r = spawnSync('bash', ['-c', `${fn}\n_ver_newer "$1" "$2"`, '--', a, b], { encoding: 'utf8' });
        expect(r.status === 0 || r.status === 1, `_ver_newer ${a} ${b} exited ${r.status}: ${r.stderr}`).toBe(true);
        expect(isNewerTag(a, b), `${a} newer than ${b}?`).toBe(r.status === 0);
        const back = spawnSync('bash', ['-c', `${fn}\n_ver_newer "$1" "$2"`, '--', b, a], { encoding: 'utf8' });
        const neither = r.status !== 0 && back.status !== 0;
        expect(compareReleaseTags(a, b) === 0, `${a} vs ${b}: equal iff neither is newer`).toBe(neither);
      }
    }
  });

  it('v0.0.10 and v0.0.010 are one version to both comparators', () => {
    expect(compareReleaseTags('v0.0.10', 'v0.0.010')).toBe(0);
    expect(compareReleaseTags('v0.0.010', 'v0.0.10')).toBe(0);
    expect(isNewerTag('v0.0.10', 'v0.0.010')).toBe(false);
  });

  it('is antisymmetric and answers only -1, 0 or 1', () => {
    for (const a of PAIRS) {
      for (const b of PAIRS) {
        const c = compareReleaseTags(a, b);
        expect([-1, 0, 1]).toContain(c);
        expect(compareReleaseTags(b, a)).toBe(-c === 0 ? 0 : -c);
      }
    }
  });

  it('is exact past 2^53 — digit strings, never Number()', () => {
    // 9007199254740993 === 9007199254740992 as a Number; as digits it is one more.
    expect(compareReleaseTags('v9007199254740993.0.0', 'v9007199254740992.0.0')).toBe(1);
    expect(compareReleaseTags('v0.0.00000000000000000000001', 'v0.0.1')).toBe(0);
  });
});

describe('newestTag', () => {
  it('answers null for an empty list and the newest otherwise', () => {
    expect(newestTag([])).toBeNull();
    expect(newestTag(['v0.0.9'])).toBe('v0.0.9');
    expect(newestTag(DISTINCT)).toBe('v10.0.0');
    expect(newestTag(['v0.0.9', 'v0.0.10', 'v0.0.8'])).toBe('v0.0.10');
  });

  it('keeps the FIRST of two spellings of one version — a stable answer', () => {
    expect(newestTag(['v0.0.10', 'v0.0.010'])).toBe('v0.0.10');
    expect(newestTag(['v0.0.010', 'v0.0.10'])).toBe('v0.0.010');
  });

  it('refuses a list with a non-tag in it, first element included', () => {
    expect(() => newestTag(['0.0.9'])).toThrow(RangeError);
    expect(() => newestTag(['v0.0.9', 'v0.0.10 '])).toThrow(RangeError);
  });
});

describe('a non-tag is refused, never ordered — and the parse is isReleaseTag\'s', () => {
  // The fixture list `update-states.test.ts` holds RELEASE_TAG to bash's SHAPE
  // on, widened by the shapes a structural parse gets wrong first.
  const SHAPES = [
    'v0.0.9', 'v0.0.10', 'v1.2.3', 'v10.20.30', 'v0.0.010', 'v0.0.0',
    '0.0.9', 'v0.0.9 ', ' v0.0.9', 'v0.0.9\n', 'v0.0', 'v0.0.9.1', 'V0.0.9', 'v0..9', 'v.0.0.9',
    'v0.0.9-rc1', 'v0.0.9+meta', 'vv0.0.9', 'v-1.0.0', 'v1e3.0.0', 'v0x1.0.0', 'v\u0661.0.0', '',
    'v', 'v..', 'v1.2.', 'v.1.2', 'v1.2.3.', 'v 1.2.3', 'v1.2.3\u0000', 'v\uff11.0.0', 'v1.0.0\r',
  ];

  it('throws RangeError on exactly the shapes isReleaseTag refuses', () => {
    for (const s of SHAPES) {
      let threw: unknown = null;
      try { compareReleaseTags(s, 'v0.0.1'); } catch (e) { threw = e; }
      expect(threw === null, `${JSON.stringify(s)}: parse accepts iff isReleaseTag does`).toBe(isReleaseTag(s));
      if (threw !== null) {
        expect(threw).toBeInstanceOf(RangeError);
        expect((threw as Error).message).toMatch(/^compareReleaseTags: not a release tag: /);
      }
      // …in either argument position.
      let threwRight = false;
      try { compareReleaseTags('v0.0.1', s); } catch { threwRight = true; }
      expect(threwRight, `${JSON.stringify(s)} as the second argument`).toBe(!isReleaseTag(s));
    }
  });

  it('refuses a non-string at runtime too — a JS caller or a JSON value', () => {
    for (const v of [null, undefined, 9, ['v0.0.9'], { tag: 'v0.0.9' }]) {
      expect(() => compareReleaseTags(v as unknown as string, 'v0.0.1')).toThrow(RangeError);
      expect(() => isNewerTag('v0.0.1', v as unknown as string)).toThrow(RangeError);
    }
  });
});

describe('shared/semver.ts is L0 and imports nothing', () => {
  it('has no import line, static or dynamic, and no require', () => {
    const src = readFileSync(SEMVER, 'utf8');
    expect(src.split('\n').filter((l) => /^\s*import\b/.test(l))).toEqual([]);
    expect(src).not.toMatch(/\bimport\s*\(/);
    expect(src).not.toMatch(/\brequire\s*\(/);
  });

  it('strips the v in exactly one place — the parse', () => {
    const src = readFileSync(SEMVER, 'utf8');
    expect((src.match(/\.slice\(1\)/g) ?? []).length).toBe(1);
    expect(src).not.toMatch(/replace\(\s*\/\^v\//);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/update-semver.test.ts`
Expected: FAIL — `Error: Cannot find module '../../shared/semver.js' imported from …/server/test/update-semver.test.ts`, `Test Files  1 failed (1)`, `Tests  no tests`.

- [ ] **Step 3: Create `shared/semver.ts`**

```ts
// The release-tag comparator — design 2026-09-20 decision 2 and §9.
//
// L0, and it imports NOTHING, not even a type: the PWA bundles `shared/`, and
// this file's one job is arithmetic over three digit strings. The canonical
// form of a version everywhere is the TAG (`vX.Y.Z`); the `v` is stripped
// HERE, inside the comparator, and nowhere else — every column, message and
// argument keeps it.
//
// PRECONDITION, not validation: callers validate with `isReleaseTag`
// (`shared/api.ts`), the ONE tag-shape guard. This file cannot import it, so
// `digitsOf` below restates the grammar STRUCTURALLY, only to refuse loudly
// what a caller forgot to validate — a non-tag is a RangeError, never ordered,
// because ordering one silently is how "v0.0.9 " would outrank "v0.0.10".
// `update-semver.test.ts` holds this parse's accept set equal to
// `isReleaseTag`'s on a fixture list, so the two statements cannot drift.
//
// Digit strings, not numbers: a component is compared by length after its
// leading zeros are stripped, then lexically — exact at any length, where
// `Number()` loses precision past 2^53. `v0.0.010` and `v0.0.10` therefore
// compare EQUAL, as they do under `ccd/ccrc`'s `_ver_newer` (`10#` arithmetic),
// the bash twin this is pinned to agree with, alongside `sort -V`.

const ZERO = 48; // '0'
const NINE = 57; // '9'

function refuse(v: unknown): never {
  throw new RangeError(`compareReleaseTags: not a release tag: ${JSON.stringify(v)}`);
}

/** The three components of a tag with their leading zeros stripped (`'000'`
 *  → `'0'`), or a RangeError. */
function digitsOf(v: unknown): readonly [string, string, string] {
  if (typeof v !== 'string' || v.charCodeAt(0) !== 0x76 /* v */) refuse(v);
  const parts = v.slice(1).split('.');
  if (parts.length !== 3) refuse(v);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length === 0) refuse(v);
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i);
      if (c < ZERO || c > NINE) refuse(v);
    }
    let z = 0;
    while (z < p.length - 1 && p.charCodeAt(z) === ZERO) z++;
    out.push(p.slice(z));
  }
  return [out[0]!, out[1]!, out[2]!];
}

/** -1 when `a` is older than `b`, 1 when newer, 0 when the same version.
 *  Throws RangeError when either argument is not a release tag. */
export function compareReleaseTags(a: string, b: string): -1 | 0 | 1 {
  const x = digitsOf(a);
  const y = digitsOf(b);
  for (let i = 0; i < 3; i++) {
    const p = x[i]!;
    const q = y[i]!;
    if (p.length !== q.length) return p.length > q.length ? 1 : -1;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

/** Whether `a` is STRICTLY newer than `b` — `_ver_newer a b`'s exit status 0. */
export function isNewerTag(a: string, b: string): boolean {
  return compareReleaseTags(a, b) === 1;
}

/** The newest tag of the list, or `null` for an empty list. Among tags of
 *  equal version the FIRST in the list wins, so the answer is stable. Throws
 *  RangeError when any element is not a release tag. */
export function newestTag(tags: readonly string[]): string | null {
  let best: string | null = null;
  for (const t of tags) {
    if (best === null) { digitsOf(t); best = t; continue; }
    if (compareReleaseTags(t, best) === 1) best = t;
  }
  return best;
}
```

- [ ] **Step 4: Run green, plus the guards that walk `shared/`**

Run, one at a time, foreground, from `server/`:
`./node_modules/.bin/vitest run test/update-semver.test.ts` → `Tests  13 passed (13)`
`./node_modules/.bin/vitest run test/single-definition.test.ts -t 'update control plane'` → PASS — in particular "spells the tag shape once — every other reader calls isReleaseTag" stays `['shared/api.ts']`: the parse above is structural and carries no copy of the regex source
`./node_modules/.bin/vitest run test/module-format.test.ts` → PASS (it walks `shared/`; the new file is ESM like its siblings)
Compile: `node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit` → no error in `shared/semver.ts` or `test/update-semver.test.ts` (the `../agent/src/server.ts` `ws` errors on a server-modules-only worktree are the missing agent install); `cd ../pwa && node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` → no output (the PWA bundles `shared/` under `noUnusedLocals`).

- [ ] **Step 5: Mutation measurements (restore after each; `git diff --stat shared/semver.ts` is empty against the Step 3 content)**

Each was measured on a scratch copy of d759c914 carrying exactly the code above.

1. The comparator is numeric, not lexical — delete the line `    if (p.length !== q.length) return p.length > q.length ? 1 : -1;` in `compareReleaseTags`. `./node_modules/.bin/vitest run test/update-semver.test.ts` → 4 red: "sorts the fixture list exactly as sort -V does", "is not the lexical order — the case plain sort gets wrong", "isNewerTag(a, b) is exactly _ver_newer a b exiting 0, and 0 means neither is newer", "answers null for an empty list and the newest otherwise". Restore.
2. A non-tag is refused, never ordered — delete the line `      if (c < ZERO || c > NINE) refuse(v);` in `digitsOf`. → 2 red: "refuses a list with a non-tag in it, first element included", "throws RangeError on exactly the shapes isReleaseTag refuses". Restore.
3. The parse agrees with the one guard — drop the `$` from `RELEASE_TAG` in `shared/api.ts` (Task 1's block). → "throws RangeError on exactly the shapes isReleaseTag refuses" reds here (with Task 1's two shape cases in `update-states.test.ts`). Restore.
4. L0 — add `import type { UpdateChannel } from './api.js';` as the first line of `shared/semver.ts`. → "has no import line, static or dynamic, and no require" reds. Restore.

- [ ] **Step 6: Residue check and commit**

Run: `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` → PASS.

```bash
git add shared/semver.ts server/test/update-semver.test.ts
git commit -m "feat(update): shared/semver.ts — the one tag comparator, v stripped inside it only, pinned to sort -V and to ccd/ccrc's _ver_newer on every ordered pair"
```

### Task 3: `MIGRATIONS[13]` — five tables, two seed rows

**Files:**
- Modify: `server/src/coord/schema.ts` — append entry 14 after entry 13 (banner `schema.ts:928`, entry `:928-973`; the array closes at `:974`), before `COORD_SCHEMA_VERSION` (`:979`); banner `// ── 14: user_version 13 -> 14 ──…`; a closing paragraph carrying the cross-branch re-measurement instruction (PR #40)
- Test: `server/test/coord-db.test.ts` — the literal pin (`:660-666`, inside `describe('coord.db: migration 4 — runs.dispatchStartedAt')` at `:513`; and `:721`) to 14 with its attribution comment; a new `describe('coord.db: migration 14 — the update control plane (design 2026-09-20 §6)', …)` appended after the migration-12 describe (the file ends at `:951`)
- Test: `server/test/asks-store.test.ts` — the literal pin (`:25`, its attribution comment `:18-24`; `:17` is `const db = openCoordDb(…)` and stays) to 14 with its attribution comment
- No other file is edited. Repo-wide guards that READ these files, run in Step 4 and not edited:
  - `server/test/session-hook.test.ts`'s citation audit — its corpus (the compaction-card spec and plan-a, and `README.md`) holds ZERO `schema.ts:`, `coord-db.test.ts:` or `asks-store.test.ts:` references (measured at `d759c914`), so none of the three files is cited and ruling R13's line-neutral rule has nothing to govern here; the audit is run to show it.
  - `server/test/mail-routes.test.ts`'s "every quoted kebab token in server/src/coord that looks like a code is declared" (`:569`) reads every `.ts` under `server/src/coord`, `schema.ts` included. The new entry holds no single-quoted kebab-case token (its quoted words are `'*'`, `'stable'`, `'off'`, `'channel'`, `'migration'`, `'idle'`, `'ok'`, `'unknown'` and `''`), so it needs neither `NOT_CODES` nor a guard — ruling R5's vocabulary is Tasks 4–6's.
  - `server/test/single-definition.test.ts` — Task 1's per-vocabulary SQL-tuple scans and its `TYPES`/`VALUES` definition scans read `ALL`, which includes `schema.ts` and this task's test file; neither declares an update type or constant, and the seed row is not a tuple (Step 3's note).

**Interfaces:**
- Consumes: `MIGRATIONS`, `COORD_SCHEMA_VERSION = MIGRATIONS.length` (`schema.ts:979`); `openCoordDb`'s loop (`db.ts:182-188`); `tx` (`db.ts:245`). By NAME only, in comments (nothing is imported): the writer methods exactly as Task 7's `WRITER_GROUPS` spells them — `applyReleaseListing` (Task 4), `markReleaseNotified` (W3), `refuseRelease`/`clearRefusals` (Task 4), `upsertNodeMeasurement`/`markUnreachable`/`rekeyNode`/`releaseLease`/`settleNode`/`ackNode` (Task 5), `resolveNode` (Task 5), `setIntent` (Task 6, writer of BOTH `update_intent` and `update_epoch`), `dispatchNode`/`requestNode` (W4); `isReleaseTag` (Task 1); `poolEdgeDigest` (`store.ts:5400`, its docstring `:5383-5399`); the out-of-vocabulary fallbacks exactly as Tasks 4–6's readers define them (`releases.channel` → null, Task 4; `nodes.role`/`nodes.channel`/`nodes.requestedKind` → null and `stampRead` → `unreadable`, Task 5; `update_intent.auto` → `off`, `notify` → `channel`, `channel` → null, Task 6).
- Produces: `COORD_SCHEMA_VERSION === 14` and exactly this DDL (spec §6 verbatim except the writer names in comments and `updateState`'s default — D-3180, D-3186):

```sql
CREATE TABLE releases (
  -- catalogue columns: writer = the poller (§7), method applyReleaseListing
  tag TEXT PRIMARY KEY, version TEXT NOT NULL, channel TEXT NOT NULL, publishedAt INTEGER NOT NULL,
  commitSha TEXT, tarballUrl TEXT NOT NULL, bundleListed INTEGER NOT NULL, notes TEXT,
  yanked INTEGER NOT NULL DEFAULT 0, observedAt INTEGER NOT NULL,
  -- notification columns: writer = the notifier (W3), method markReleaseNotified
  notifiedAt INTEGER
);
CREATE TABLE node_release_refusals (
  -- writer = the inventory sweep, method refuseRelease; cleared by clearRefusals / ackNode; re-keyed by rekeyNode
  nodeId TEXT NOT NULL, tag TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT NOT NULL,
  PRIMARY KEY (nodeId, tag)
);
CREATE TABLE nodes (
  nodeId TEXT PRIMARY KEY, role TEXT NOT NULL, label TEXT NOT NULL,
  -- measurement columns: upsertNodeMeasurement, markUnreachable
  currentVersion TEXT, currentSha TEXT, currentRef TEXT, currentBuiltAt TEXT, currentDirty INTEGER,
  stampRead TEXT NOT NULL, installState TEXT NOT NULL, provenance TEXT NOT NULL, caps TEXT NOT NULL,
  agentOps TEXT, highestVersion TEXT, previousVersion TEXT, os TEXT NOT NULL, measuredAt INTEGER,
  reachable INTEGER NOT NULL, unreachableSince INTEGER,
  -- report columns: upsertNodeMeasurement
  reportedPhase TEXT, reportedTarget TEXT, reportedStartedAt INTEGER, reportedUpdatedAt INTEGER, reportedDetail TEXT,
  -- lease columns: dispatchNode (W4), releaseLease, settleNode, ackNode
  updateState TEXT NOT NULL DEFAULT 'idle', updateTarget TEXT, updateStartedAt INTEGER, updateDetail TEXT,
  -- resolved columns: resolveNode
  channel TEXT, desiredTag TEXT, resolveDetail TEXT,
  -- request columns: requestNode (W4) sets; settleNode and ackNode clear
  requestedTag TEXT, requestedKind TEXT, requestedAt INTEGER,
  -- identity column: rekeyNode
  supersededBy TEXT
);
CREATE TABLE update_intent (
  -- writer = the intent route (§12), method setIntent
  scope TEXT PRIMARY KEY, channel TEXT NOT NULL, pinnedTag TEXT, auto TEXT NOT NULL, notify TEXT NOT NULL,
  setAt INTEGER NOT NULL, setBy TEXT NOT NULL
);
INSERT INTO update_intent VALUES ('*', 'stable', NULL, 'off', 'channel', 0, 'migration');
-- writer = setIntent, in the same transaction as the intent row and the journal append
CREATE TABLE update_epoch (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL, issuedAt INTEGER NOT NULL);
INSERT INTO update_epoch (id, epoch, issuedAt) VALUES (1, 0, 0);
```

- `update_epoch` has NO `digest` column (do not copy `pool_epoch`'s, `schema.ts:964-971`). The describe plants a DB at 13 (`MIGRATIONS[0..12]` + `PRAGMA user_version = 13`), opens it, and asserts `user_version === COORD_SCHEMA_VERSION`, each table's `PRAGMA table_info` column list and nullability, `updateState`'s `dflt_value`, the two seed rows, and that a second `update_epoch` row (`id = 2`) is refused.

**What this task pins.** Spec §18 has no row for the migration itself; the pins are §6's own "Schema test" line (the five `CREATE TABLE`s at `MIGRATIONS[13]`, the two seed rows, `COORD_SCHEMA_VERSION === 14`), plus D-3186 (`PRAGMA table_info` `dflt_value = "'idle'"`, and an `INSERT` naming no lease column reading `idle`) and D-3191 (one banner per entry, numbered in order). It supports §18 "a yanked release is kept" at the column level only (`yanked … DEFAULT 0`, and the entry's comment saying `releases` is never deleted from) — the delete mutation that row names is Task 4's case and Task 7's scan. No vocabulary is spelled as a bracketed list anywhere in the new entry, so Task 1's per-vocabulary SQL-tuple scans find nothing here (see the note in Step 3).

- [ ] **Step 1: Write the failing tests**

In `server/test/coord-db.test.ts`, replace the literal-pin case (`:660-666`) — its title, its attribution comment and both assertions:

```ts
  it('COORD_SCHEMA_VERSION derives to 14 — never hand-edited beside a growing array', () => {
    // Bumped to 14 by four migrations: MIGRATIONS[10] (runs.kind/runs.reviews,
    // design 2026-09-14 §5.1), MIGRATIONS[11] (runs.coordProject, board
    // placement wave 1 Task 1), MIGRATIONS[12] (pool_edges/pool_epoch,
    // account-pool membership wave 1 Task 6) and MIGRATIONS[13] (releases,
    // node_release_refusals, nodes, update_intent, update_epoch — centralised
    // update management W2 Task 3).
    expect(COORD_SCHEMA_VERSION).toBe(14);
    expect(MIGRATIONS.length).toBe(14);
```

In the same file, in `describe('coord.db: migration 11 — runs.kind and runs.reviews …')`'s second case, replace the `:721` literal (the two lines above it are shown for position and are unchanged):

```ts
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    // 14 since MIGRATIONS[13] (the update control plane, centralised update
    // management W2 Task 3); the migration above is still entry 11.
    expect(COORD_SCHEMA_VERSION).toBe(14);
    const row = db.prepare('SELECT kind, reviews FROM runs').get() as { kind: string; reviews: number | null };
```

Append this describe at the end of the file, after the migration-12 describe's closing `});`. Everything it needs is already imported at the top of the file (`DatabaseSync`, `mkdirSync`, `readFileSync`, `path`, `COORD_SCHEMA_VERSION`, `openCoordDb`, `tx`, `MIGRATIONS`, `mkTmp`) and `dbPathIn`/`root` are the file's own helpers (`:15-16`):

```ts
describe('coord.db: migration 14 — the update control plane (design 2026-09-20 §6)', () => {
  // [name, type, notnull, dflt_value, pk] — PRAGMA table_info's own fields, in
  // declaration order. The WHOLE list per table, never arrayContaining: the
  // writer-group scan (`update-writer-groups.test.ts`) binds each store method
  // to a named column group, so a column that lands here without being placed
  // in a group is a column no scan knows about — and a column dropped by a
  // later edit to this entry would be a frozen migration changing under a box
  // that already ran it.
  //
  // `notnull: 0` on the three TEXT PRIMARY KEYs (`releases.tag`,
  // `nodes.nodeId`, `update_intent.scope`) is SQLite's rowid-table rule, the
  // same shape `programs.slug` has had since entry 1: the store writers are
  // the guard (every tag passes `isReleaseTag`, every nodeId is measured),
  // not the column.
  type Col = [name: string, type: string, notnull: number, dflt: string | null, pk: number];
  const cols = (db: DatabaseSync, table: string): Col[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as
      { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[])
      .map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]);
  const tableNames = (db: DatabaseSync): string[] =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map((r) => r.name);
  const UPDATE_TABLES = ['node_release_refusals', 'nodes', 'releases', 'update_epoch', 'update_intent'];

  /** A database at EXACTLY user_version 13 — the version just before this
   *  one — carrying one pool edge and a raised pool epoch, so a case can show
   *  this migration touched neither. Isolates THIS entry, not a chain. */
  const plantedAt13 = (prefix: string): string => {
    const p = dbPathIn(mkTmp(prefix));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < 13; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec('PRAGMA user_version = 13');
      raw.exec('INSERT INTO pool_edges (subjectKind, subjectId, pool, addedAt, addedBy) ' +
               "VALUES ('account', 'a', 'pool-a', 5, 'op')");
      raw.exec("UPDATE pool_epoch SET epoch = 3, issuedAt = 7, digest = 'd' WHERE id = 1");
    });
    raw.close();
    return p;
  };

  it('reaches a database ALREADY at user_version 13 and adds exactly the five tables', () => {
    const p = plantedAt13('ccrc-mig14-');
    const before = new DatabaseSync(p);
    const had = tableNames(before);
    before.close();
    expect(had.filter((t) => UPDATE_TABLES.includes(t)), 'the plant already has an update table').toEqual([]);

    const db = openCoordDb(p);                    // must migrate 13 -> current
    // The reached version is COORD_SCHEMA_VERSION, never a hardcoded 14: the
    // next entry appended after this one must not have to edit this case.
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    const added = tableNames(db).filter((t) => !had.includes(t)).sort();
    expect(added).toEqual(UPDATE_TABLES);
    db.close();
  });

  it('gives each table exactly the columns §6 names, with their nullability, defaults and keys', () => {
    const db = openCoordDb(plantedAt13('ccrc-mig14-cols-'));
    expect(cols(db, 'releases')).toEqual([
      ['tag', 'TEXT', 0, null, 1], ['version', 'TEXT', 1, null, 0], ['channel', 'TEXT', 1, null, 0],
      ['publishedAt', 'INTEGER', 1, null, 0], ['commitSha', 'TEXT', 0, null, 0],
      ['tarballUrl', 'TEXT', 1, null, 0], ['bundleListed', 'INTEGER', 1, null, 0], ['notes', 'TEXT', 0, null, 0],
      // A yanked release is KEPT (§7) — the column defaults to 0 and nothing deletes.
      ['yanked', 'INTEGER', 1, '0', 0], ['observedAt', 'INTEGER', 1, null, 0],
      ['notifiedAt', 'INTEGER', 0, null, 0],
    ]);
    expect(cols(db, 'node_release_refusals')).toEqual([
      ['nodeId', 'TEXT', 1, null, 1], ['tag', 'TEXT', 1, null, 2],
      ['at', 'INTEGER', 1, null, 0], ['detail', 'TEXT', 1, null, 0],
    ]);
    expect(cols(db, 'nodes')).toEqual([
      // the row key, then role and label — which are the measurement group's
      ['nodeId', 'TEXT', 0, null, 1], ['role', 'TEXT', 1, null, 0], ['label', 'TEXT', 1, null, 0],
      // measurement group, continued
      ['currentVersion', 'TEXT', 0, null, 0], ['currentSha', 'TEXT', 0, null, 0],
      ['currentRef', 'TEXT', 0, null, 0], ['currentBuiltAt', 'TEXT', 0, null, 0],
      ['currentDirty', 'INTEGER', 0, null, 0],
      ['stampRead', 'TEXT', 1, null, 0], ['installState', 'TEXT', 1, null, 0],
      ['provenance', 'TEXT', 1, null, 0], ['caps', 'TEXT', 1, null, 0],
      ['agentOps', 'TEXT', 0, null, 0], ['highestVersion', 'TEXT', 0, null, 0],
      ['previousVersion', 'TEXT', 0, null, 0], ['os', 'TEXT', 1, null, 0], ['measuredAt', 'INTEGER', 0, null, 0],
      ['reachable', 'INTEGER', 1, null, 0], ['unreachableSince', 'INTEGER', 0, null, 0],
      // report group
      ['reportedPhase', 'TEXT', 0, null, 0], ['reportedTarget', 'TEXT', 0, null, 0],
      ['reportedStartedAt', 'INTEGER', 0, null, 0], ['reportedUpdatedAt', 'INTEGER', 0, null, 0],
      ['reportedDetail', 'TEXT', 0, null, 0],
      // lease group — updateState's default is D-3186
      ['updateState', 'TEXT', 1, "'idle'", 0], ['updateTarget', 'TEXT', 0, null, 0],
      ['updateStartedAt', 'INTEGER', 0, null, 0], ['updateDetail', 'TEXT', 0, null, 0],
      // resolved group
      ['channel', 'TEXT', 0, null, 0], ['desiredTag', 'TEXT', 0, null, 0], ['resolveDetail', 'TEXT', 0, null, 0],
      // request group
      ['requestedTag', 'TEXT', 0, null, 0], ['requestedKind', 'TEXT', 0, null, 0],
      ['requestedAt', 'INTEGER', 0, null, 0],
      // identity group
      ['supersededBy', 'TEXT', 0, null, 0],
    ]);
    expect(cols(db, 'update_intent')).toEqual([
      ['scope', 'TEXT', 0, null, 1], ['channel', 'TEXT', 1, null, 0], ['pinnedTag', 'TEXT', 0, null, 0],
      ['auto', 'TEXT', 1, null, 0], ['notify', 'TEXT', 1, null, 0],
      ['setAt', 'INTEGER', 1, null, 0], ['setBy', 'TEXT', 1, null, 0],
    ]);
    // pool_epoch's single-row idiom WITHOUT its digest column (§6): nothing
    // computes a digest for the projection — its torn-write detectors are the
    // `end` terminator and the 65536-byte cap (§9).
    expect(cols(db, 'update_epoch').map((c) => c[0]), 'update_epoch copied pool_epoch\'s digest').not.toContain('digest');
    expect(cols(db, 'update_epoch')).toEqual([
      ['id', 'INTEGER', 0, null, 1], ['epoch', 'INTEGER', 1, null, 0], ['issuedAt', 'INTEGER', 1, null, 0],
    ]);
    db.close();
  });

  it('seeds exactly two rows — the fleet-default intent and epoch 0 — so no reader handles absence', () => {
    const db = openCoordDb(plantedAt13('ccrc-mig14-seed-'));
    expect(db.prepare('SELECT scope, channel, pinnedTag, auto, notify, setAt, setBy FROM update_intent').all())
      .toEqual([{ scope: '*', channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: 0, setBy: 'migration' }]);
    expect(db.prepare('SELECT id, epoch, issuedAt FROM update_epoch').all())
      .toEqual([{ id: 1, epoch: 0, issuedAt: 0 }]);
    for (const t of ['releases', 'node_release_refusals', 'nodes']) {
      expect(db.prepare(`SELECT count(*) AS c FROM ${t}`).get(), `${t} is seeded`).toEqual({ c: 0 });
    }
    db.close();
  });

  it('a FRESH database reaches the same five tables and the same two seed rows', () => {
    // The ordinary boot of a new box: migrations 0 -> current in one open.
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-mig14-fresh-')));
    expect(tableNames(db).filter((t) => UPDATE_TABLES.includes(t)).sort()).toEqual(UPDATE_TABLES);
    expect(db.prepare('SELECT count(*) AS c FROM update_intent').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT epoch FROM update_epoch WHERE id = 1').get()).toEqual({ epoch: 0 });
    db.close();
  });

  it('update_epoch is a singleton — a second row is refused by the CHECK and by nothing else', () => {
    const db = openCoordDb(plantedAt13('ccrc-mig14-single-'));
    // Every value well-typed and every NOT NULL satisfied, so the ONLY thing
    // that can refuse this insert is `CHECK (id = 1)` — the message is
    // asserted, not just the throw (pool-edges-store.test.ts's "pool_epoch
    // refuses a second row" passed with its CHECK deleted until it did).
    expect(() => db.exec('INSERT INTO update_epoch (id, epoch, issuedAt) VALUES (2, 1, 1)'))
      .toThrow(/CHECK constraint failed/);
    expect(db.prepare('SELECT count(*) AS c FROM update_epoch').get()).toEqual({ c: 1 });
    db.close();
  });

  it('a node row whose INSERT names no lease column reads idle — the measurement writer never names updateState', () => {
    // D-3186. `upsertNodeMeasurement` (Task 5) names only
    // identity, measurement and report columns; without the DEFAULT this
    // INSERT fails NOT NULL and the writer would have to name the lease column
    // the writer-group scan forbids it.
    const db = openCoordDb(plantedAt13('ccrc-mig14-idle-'));
    db.exec(
      'INSERT INTO nodes (nodeId, role, label, stampRead, installState, provenance, caps, os, reachable) ' +
      "VALUES ('01234567-89ab-cdef-0123-456789abcdef', 'fleet', 'fleet', 'ok', 'complete', 'unverified', '', 'linux', 1)",
    );
    expect(db.prepare('SELECT updateState, updateTarget, measuredAt, requestedTag, supersededBy FROM nodes').get())
      .toEqual({ updateState: 'idle', updateTarget: null, measuredAt: null, requestedTag: null, supersededBy: null });
    db.close();
  });

  it('node_release_refusals holds one row per (node, tag) — a node\'s verdict, never fleet-wide', () => {
    const db = openCoordDb(plantedAt13('ccrc-mig14-refusal-'));
    const ins = db.prepare('INSERT INTO node_release_refusals (nodeId, tag, at, detail) VALUES (?, ?, ?, ?)');
    ins.run('n1', 'v0.0.9', 1, 'provenance: bundle absent');
    ins.run('n2', 'v0.0.9', 2, 'provenance: bundle absent');   // the same tag, another node: its own row
    expect(() => ins.run('n1', 'v0.0.9', 3, 'again')).toThrow(/UNIQUE constraint failed/);
    expect(db.prepare('SELECT count(*) AS c FROM node_release_refusals').get()).toEqual({ c: 2 });
    db.close();
  });

  it('is ADDITIVE: migration 13\'s pool edge and pool epoch come through untouched', () => {
    const db = openCoordDb(plantedAt13('ccrc-mig14-add-'));
    expect(db.prepare('SELECT subjectKind, subjectId, pool, addedAt, addedBy FROM pool_edges').all())
      .toEqual([{ subjectKind: 'account', subjectId: 'a', pool: 'pool-a', addedAt: 5, addedBy: 'op' }]);
    expect(db.prepare('SELECT epoch, issuedAt, digest FROM pool_epoch WHERE id = 1').get())
      .toEqual({ epoch: 3, issuedAt: 7, digest: 'd' });
    db.close();
  });

  it('every entry carries its own banner, numbered 1..N in order — a textual double slot reds here', () => {
    // `db.ts`'s loop keys on the ARRAY INDEX alone, so two entries both
    // bannered `14: user_version 13 -> 14` (the shape a rebase of PR #40 onto
    // this entry would leave if both kept their text) would run as 14 and 15
    // while every comment in the file said otherwise. This counts the
    // banners against MIGRATIONS.length and checks the numbering. It cannot
    // see a slot another BRANCH holds — schema.ts's closing paragraph on
    // entry 14 carries that re-measurement.
    const src = readFileSync(path.join(root, 'server/src/coord/schema.ts'), 'utf8');
    const banners = [...src.matchAll(/^ {2}\/\/ ── (\d+): user_version (\d+) -> (\d+) ─/gm)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(banners.length, 'one banner per MIGRATIONS entry').toBe(MIGRATIONS.length);
    banners.forEach(([n, from, to], i) => {
      expect([n, from, to], `banner ${i + 1}`).toEqual([i + 1, i, i + 1]);
    });
  });
});
```

In `server/test/asks-store.test.ts`, replace the attribution comment and the literal (`:18-25` — line `:17`, `const db = openCoordDb(dbPathIn(home));`, is unchanged and stays above the new comment):

```ts
    // FOUR migrations have landed since this test's own version: MIGRATIONS[10]
    // (`runs.kind`/`runs.reviews`, review runs, design 2026-09-14 §5.1),
    // MIGRATIONS[11] (`runs.coordProject`, board placement wave 1 Task 1),
    // MIGRATIONS[12] (`pool_edges`/`pool_epoch`, account-pool membership wave 1
    // Task 6) and MIGRATIONS[13] (the update control plane's five tables,
    // centralised update management W2 Task 3). None touches the asks table.
    // This pin only needs the CURRENT total — it asserts "no migration after
    // the one this test knows about has changed the asks table's columns", not
    // anything about any of the four.
    expect(COORD_SCHEMA_VERSION).toBe(14);
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts test/asks-store.test.ts` (foreground, timeout ≥ 600000 ms)
Expected: FAIL — `Tests  10 failed | 75 passed (85)`:
- the three literal pins, each `AssertionError: expected 13 to be 14 // Object.is equality` (`asks-store.test.ts` "the cross-repo columns…", `coord-db.test.ts` "COORD_SCHEMA_VERSION derives to 14…" and migration 11's "reaches a database ALREADY at user_version 10…");
- "reaches a database ALREADY at user_version 13…" and "a FRESH database…" — `expected [] to deeply equal [ 'node_release_refusals', …(4) ]`;
- "gives each table exactly the columns…" — `expected [] to deeply equal [ …(11) ]`;
- "seeds exactly two rows…" — `Error: no such table: update_intent`;
- "update_epoch is a singleton…" — `expected [Function] to throw error matching /CHECK constraint failed/ but got 'no such table: update_epoch'`;
- "a node row whose INSERT names no lease column…" — `Error: no such table: nodes`;
- "node_release_refusals holds one row per (node, tag)…" — `Error: no such table: node_release_refusals`.

Two new cases are GREEN here, and that is expected: "is ADDITIVE…" (nothing has touched migration 13's rows yet) and "every entry carries its own banner…" (thirteen banners, thirteen entries). Both are guards whose red is measured in Step 5, not red-first cases.

- [ ] **Step 3: Implement — append entry 14 to `MIGRATIONS`**

In `server/src/coord/schema.ts`, between entry 13's closing `` `, `` (the line after `INSERT INTO pool_epoch (id, epoch, issuedAt, digest) VALUES (1, 0, 0, '');`) and the array's closing `];` (`:974`), insert — after one blank line, the file's separator between entries:

```ts
  // ── 14: user_version 13 -> 14 ───────────────────────────────────────────
  // The update control plane (design 2026-09-20 §6): the release CATALOGUE,
  // each node's verdict on a release, the node INVENTORY, the DESIRED STATE
  // per scope, and the projection's epoch. Every column the whole design
  // needs — `notify`, which W3 reads; the lease and request columns, which
  // W4's dispatcher writes — ships in THIS ONE slot, so no later wave of that
  // design claims a second.
  //
  // ONE WRITER PER COLUMN GROUP. Each group's comment below names the METHOD
  // that writes it, because `update-writer-groups.test.ts` scans `store.ts`'s
  // SQL and binds method names to these column lists; a comment naming
  // something other than the method would be a second, unpinned claim. The
  // spec's per-row `upsertRelease` does not appear: the yank mark is a
  // statement about a whole listing, so the ONE catalogue writer is
  // `applyReleaseListing` (D-3180). `nodes.role` and
  // `nodes.label` sit on the key line but belong to the measurement group;
  // `nodes.nodeId` is the row KEY — the measurement writers' INSERT creates a
  // row under it and only `rekeyNode` changes it. `update_intent` and
  // `update_epoch` are one group each, and their one writer is `setIntent`.
  //
  // Enumerated columns are TEXT with no SQL CHECK — this file's header idiom:
  // each vocabulary lives ONCE in `shared/api.ts` (union + runtime array +
  // guard) and its store reader maps an out-of-vocabulary token to a stated
  // fallback, never a cast. The ones whose fallback is NOT a we-do-not-know
  // member (D-3181): `releases.channel` and `nodes.role`
  // read NULL, as `nodes.channel` and `nodes.requestedKind` do;
  // `nodes.stampRead` reads `unreadable`; `update_intent.auto`
  // reads `off` (nothing unattended); `update_intent.notify` reads `channel`
  // (the operator hears of more, never of nothing). An out-of-vocabulary
  // `update_intent.channel` resolves the node's `nodes.channel` to NULL with
  // the reason in `resolveDetail` — never the fleet default, which would be
  // fail-open.
  //
  // Every version-bearing column holds the TAG form (`vX.Y.Z`, decision 2).
  // Every time column is epoch MS — `reportedStartedAt`/`reportedUpdatedAt`
  // included: the report file carries unix SECONDS and the inventory sweep
  // converts them at its one validator, so no reader here ever sees seconds.
  //
  // `releases` is NEVER DELETED FROM. A draft, or a release absent from a
  // later listing, is `yanked = 1` (§7); the row stays, so a node running a
  // yanked tag still has a catalogue row that says so.
  //
  // `nodes.updateState` is `NOT NULL DEFAULT 'idle'`
  // (D-3186): a never-dispatched node IS idle, and the
  // measurement writer's first INSERT must be able to name only identity,
  // measurement and report columns — without a default it would have to name
  // the lease column the writer-group scan forbids it. Like `runs.kind`'s
  // default (entry 11), this asserts something true of every row; it is not
  // an overloaded null.
  //
  // The NULLs are real answers, one meaning each (§6 "Null discipline"):
  // `commitSha NULL` = `target_commitish` was a branch name; `notifiedAt NULL`
  // = no release push sent; `currentVersion NULL` with `stampRead = 'ok'` = an
  // unversioned build; `measuredAt NULL` = never measured; `highestVersion
  // NULL` = no floor file = UNCONSTRAINED; `previousVersion NULL` = nothing to
  // roll back to; `agentOps NULL` = no agent by construction (a server-role
  // row) while `''` = an agent too old to say; `unreachableSince NULL` iff
  // reachable; `reportedPhase NULL` = no report file, distinct from
  // `'unknown'`, a phase outside the vocabulary; `desiredTag NULL` carries
  // its reason in `resolveDetail`; `requestedTag NULL` = no operator request
  // outstanding; `supersededBy NULL` = live.
  //
  // `update_intent` is SEEDED with the fleet default (`scope = '*'`) and
  // `update_epoch` with epoch 0, so no reader handles either's absence.
  // `update_epoch` takes `pool_epoch`'s single-row idiom (entry 13) but NOT
  // its `digest` column: `pool_epoch.digest` is provenance that nothing
  // reads (`poolEdgeDigest`'s docstring in `store.ts`), and the projection's
  // torn-write detectors are its `end` terminator and its 65536-byte cap
  // (§9) — a digest here would be a column with no reader.
  //
  // MIGRATIONS[0..12] are frozen: `db.ts:182` iterates from the live
  // `user_version`, so an edit to an applied entry never runs.
  //
  // THIS ENTRY IS SLOT 14 AS WRITTEN. PR #40 (automation-runner) is open and
  // stale: its tree predates entries 12 and 13 and still spells its own
  // migration slot 11, so its next rebase renumbers it into THIS slot. Two
  // entries at one `user_version` is a migration that never runs on a db
  // already past it (entry 12's paragraph records the last branch that lost
  // this race); whichever merges second moves up. RE-MEASURE against
  // origin/main immediately before the PR and again before merge — the
  // banner count on main must still be 13:
  //     git fetch origin main
  //     git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'
  // `coord-db.test.ts`'s banner-sequence case reds a textual double slot left
  // in THIS tree; a slot another branch holds is visible only to that
  // measurement.
  `
  CREATE TABLE releases (
    -- catalogue columns: writer = the poller (§7), method applyReleaseListing
    tag TEXT PRIMARY KEY, version TEXT NOT NULL, channel TEXT NOT NULL, publishedAt INTEGER NOT NULL,
    commitSha TEXT, tarballUrl TEXT NOT NULL, bundleListed INTEGER NOT NULL, notes TEXT,
    yanked INTEGER NOT NULL DEFAULT 0, observedAt INTEGER NOT NULL,
    -- notification columns: writer = the notifier (W3), method markReleaseNotified
    notifiedAt INTEGER
  );
  CREATE TABLE node_release_refusals (
    -- writer = the inventory sweep, method refuseRelease; cleared by clearRefusals / ackNode; re-keyed by rekeyNode
    nodeId TEXT NOT NULL, tag TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT NOT NULL,
    PRIMARY KEY (nodeId, tag)
  );
  CREATE TABLE nodes (
    nodeId TEXT PRIMARY KEY, role TEXT NOT NULL, label TEXT NOT NULL,
    -- measurement columns: upsertNodeMeasurement, markUnreachable
    currentVersion TEXT, currentSha TEXT, currentRef TEXT, currentBuiltAt TEXT, currentDirty INTEGER,
    stampRead TEXT NOT NULL, installState TEXT NOT NULL, provenance TEXT NOT NULL, caps TEXT NOT NULL,
    agentOps TEXT, highestVersion TEXT, previousVersion TEXT, os TEXT NOT NULL, measuredAt INTEGER,
    reachable INTEGER NOT NULL, unreachableSince INTEGER,
    -- report columns: upsertNodeMeasurement
    reportedPhase TEXT, reportedTarget TEXT, reportedStartedAt INTEGER, reportedUpdatedAt INTEGER, reportedDetail TEXT,
    -- lease columns: dispatchNode (W4), releaseLease, settleNode, ackNode
    updateState TEXT NOT NULL DEFAULT 'idle', updateTarget TEXT, updateStartedAt INTEGER, updateDetail TEXT,
    -- resolved columns: resolveNode
    channel TEXT, desiredTag TEXT, resolveDetail TEXT,
    -- request columns: requestNode (W4) sets; settleNode and ackNode clear
    requestedTag TEXT, requestedKind TEXT, requestedAt INTEGER,
    -- identity column: rekeyNode
    supersededBy TEXT
  );
  CREATE TABLE update_intent (
    -- writer = the intent route (§12), method setIntent
    scope TEXT PRIMARY KEY, channel TEXT NOT NULL, pinnedTag TEXT, auto TEXT NOT NULL, notify TEXT NOT NULL,
    setAt INTEGER NOT NULL, setBy TEXT NOT NULL
  );
  INSERT INTO update_intent VALUES ('*', 'stable', NULL, 'off', 'channel', 0, 'migration');
  -- writer = setIntent, in the same transaction as the intent row and the journal append
  CREATE TABLE update_epoch (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL, issuedAt INTEGER NOT NULL);
  INSERT INTO update_epoch (id, epoch, issuedAt) VALUES (1, 0, 0);
  `,
```

The banner is entry 13's banner line with the three numbers changed, so the dash run keeps the file's width (77 columns) — copy line `:928` and edit the numbers; do not retype the dashes. `COORD_SCHEMA_VERSION` (`:979`) is untouched: it derives from `MIGRATIONS.length`.

Nothing in this entry spells a vocabulary as a bracketed list — the comments name types (`UpdateState`), never member lists — so Task 1's per-vocabulary SQL-tuple scans over `ALL` (which includes `schema.ts`) have nothing to find. Task 1's fingerprint (`tupleOf`) is a parenthesised list of two or more quoted words EVERY one of which is a member, bracket to bracket. The one place members sit side by side is the seed row, `('*', 'stable', NULL, 'off', 'channel', 0, 'migration')`: its first element is `'*'` and `NULL` separates `'stable'` from `'off', 'channel'`, so no vocabulary's whole-list fingerprint matches it — and Task 1 asserts exactly that, on this seed row's text, in "the tuple fingerprint catches a copy in any order and leaves non-copies alone" (AutoMode, NotifyMode, UpdateChannel). The two writer comments added to the §6 DDL (`-- writer = … setIntent`) hold no quoted word at all. If Task 1's scan is ever loosened to an unanchored pair, it must take `schema.ts`'s frozen-migration exemption, as the run-state scan does (`single-definition.test.ts:711-713`).

- [ ] **Step 4: Run green, then the neighbours**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts test/asks-store.test.ts`
Expected: PASS — `Tests  85 passed (85)`.

Then, one at a time, foreground:
`./node_modules/.bin/vitest run test/pool-edges-store.test.ts` (19 passed — migration 13's own store cases, unchanged),
`./node_modules/.bin/vitest run test/single-definition.test.ts` (202 passed — 160 at `d759c914` plus Task 1's 42; the tuple scans, Task 1's definition scans and the run-state scan read `schema.ts`),
`./node_modules/.bin/vitest run test/mail-routes.test.ts` (59 passed — the coord kebab scanner reads `schema.ts`; Tasks 1–2 do not touch this file, so the count is `d759c914`'s),
`./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` (`13 passed | 320 skipped (333)` — the citation audit, run although none of this task's files is cited, per ruling R13),
`./node_modules/.bin/vitest run test/ledger-sweep.test.ts` (20 passed — it reads a `schema.ts` passage by content),
`./node_modules/.bin/vitest run test/coord-store.test.ts` (169 passed — every store case opens a db through the new entry),
`./node_modules/.bin/vitest run test/typecheck-tests.test.ts` (the new describe's labelled-tuple `Col` type and the `matchAll` destructure compile under the tests-inclusive project).
Expected: PASS each. The counts are measured at `d759c914` plus this task, except `single-definition.test.ts`'s, which carries Task 1's 42 new cases (Task 1 lands first; Task 2 adds none there); a smaller count is a skipped file, not a green one.

- [ ] **Step 5: Mutation measurement**

Each mutation is applied to `server/src/coord/schema.ts` alone, `test/coord-db.test.ts` is run, and the file is restored from a saved copy — NOT `git checkout --`, which would also discard this task's uncommitted entry. From the repo root:

```bash
G="$(mktemp -d)/schema.green.ts"; cp server/src/coord/schema.ts "$G"
mut() {  # mut <label> <exact old text> <new text>
  python3 - "$G" "$2" "$3" <<'PY'
import sys, pathlib
g, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = pathlib.Path(g).read_text()
assert s.count(a) == 1, f'mutation anchor not unique: {a!r}'
pathlib.Path('server/src/coord/schema.ts').write_text(s.replace(a, b))
PY
  echo "== $1"; (cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts 2>&1 | grep -E '^ +×|Tests ')
  cp "$G" server/src/coord/schema.ts
}
mut M1-no-epoch-seed $'  INSERT INTO update_epoch (id, epoch, issuedAt) VALUES (1, 0, 0);\n' ''
mut M2-digest-copied $'issuedAt INTEGER NOT NULL);\n  INSERT INTO update_epoch' $'issuedAt INTEGER NOT NULL, digest TEXT NOT NULL DEFAULT \'\');\n  INSERT INTO update_epoch'
mut M3-no-idle-default "updateState TEXT NOT NULL DEFAULT 'idle'" 'updateState TEXT NOT NULL'
mut M4-no-singleton-check 'id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL, issuedAt' 'id INTEGER PRIMARY KEY, epoch INTEGER NOT NULL, issuedAt'
mut M5-rebased-double-slot $'  INSERT INTO update_epoch (id, epoch, issuedAt) VALUES (1, 0, 0);\n  `,\n' $'  INSERT INTO update_epoch (id, epoch, issuedAt) VALUES (1, 0, 0);\n  `,\n\n  // ── 14: user_version 13 -> 14 ───────────────────────────────────────────\n  `\n  SELECT 1;\n  `,\n'
mut M5b-banner-renumbered '  // ── 14: user_version 13 -> 14 ─' '  // ── 13: user_version 12 -> 13 ─'
mut M6-no-yanked-default 'yanked INTEGER NOT NULL DEFAULT 0' 'yanked INTEGER NOT NULL'
mut M7-no-refusal-key $',\n    PRIMARY KEY (nodeId, tag)\n' $'\n'
mut M8-no-intent-seed $'  INSERT INTO update_intent VALUES (\'*\', \'stable\', NULL, \'off\', \'channel\', 0, \'migration\');\n' ''
cmp "$G" server/src/coord/schema.ts && echo restored
(cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts 2>&1 | grep -E 'Tests ')
```

Expected (measured on a copy of `d759c914` with this task applied; `coord-db.test.ts` holds 57 cases after Step 1):

| Mutation | Reds | Tests line |
|---|---|---|
| M1 — the epoch seed row removed | "seeds exactly two rows…", "a FRESH database…", "update_epoch is a singleton…" (its count-is-1 read) | `3 failed \| 54 passed (57)` |
| M2 — `pool_epoch`'s `digest` copied onto `update_epoch` | "gives each table exactly the columns…" (message: `update_epoch copied pool_epoch's digest`) | `1 failed \| 56 passed (57)` |
| M3 — `updateState`'s `DEFAULT 'idle'` removed (D-3186) | the columns case; "a node row whose INSERT names no lease column…" (`NOT NULL constraint failed: nodes.updateState`) | `2 failed \| 55 passed (57)` |
| M4 — `CHECK (id = 1)` removed | "update_epoch is a singleton…" | `1 failed \| 56 passed (57)` |
| M5 — a rebased second entry bannered `14: user_version 13 -> 14` appended | "every entry carries its own banner…", plus the two literal pins (the array is now 15 long) | `3 failed \| 54 passed (57)` |
| M5b — this entry's banner renumbered to `13: user_version 12 -> 13` (array length unchanged) | "every entry carries its own banner…" ALONE (`banner 14: expected [ 13, 12, 13 ] to deeply equal [ 14, 13, 14 ]`) | `1 failed \| 56 passed (57)` |
| M6 — `yanked`'s `DEFAULT 0` removed | the columns case | `1 failed \| 56 passed (57)` |
| M7 — `PRIMARY KEY (nodeId, tag)` removed | the columns case; "node_release_refusals holds one row per (node, tag)…" | `2 failed \| 55 passed (57)` |
| M8 — the fleet-default intent seed removed | "seeds exactly two rows…", "a FRESH database…" | `2 failed \| 55 passed (57)` |

Then `restored` and `Tests  57 passed (57)`. A mutation that stays green is a finding: stop and report it, do not re-word the case until it reds.

- [ ] **Step 6: Measure the slot on `origin/main` (the cross-branch namespace)**

Run: `git fetch origin main && git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`
Expected: `13`. Any other number means another branch (PR #40, or anything else) has taken slot 14 since `d759c914`: stop, do not commit, and report it to the coordinator — this entry moves up a slot and its banner, its closing paragraph and the three literal pins move with it. The same command is re-run in Task 15 before the PR and again before merge (Global Constraints).

- [ ] **Step 7: Residue check and commit**

Run: `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` after `git add` (it scans the tracked tree and the range this branch introduces).
Expected: PASS.

```bash
git add server/src/coord/schema.ts server/test/coord-db.test.ts server/test/asks-store.test.ts
git commit -m "feat(update): MIGRATIONS[13] — releases, node_release_refusals, nodes, update_intent, update_epoch; the fleet-default intent and epoch 0 seeded; updateState defaults to idle; one banner per entry, pinned in order"
```

### Task 4: Store — the catalogue group and node refusals

**Files:**
- Modify: `server/src/coord/store.ts` — two names added to the `shared/api.js` import block (`:22-54`: after `isWorkItemState,`, `:27`, and after `type WorkItemState,`, `:53`); result types beside `SetAccountPoolsResult` (`:150-152`); a `// ── update catalogue ──` section after the pool-edges section (`setAccountPools`, `:5332`; `poolEpoch`, `:5378`; `poolEdgeDigest`, `:5400`), before the class's closing brace (`:5407`)
- Modify: `shared/api.ts` — `UPDATE_STORE_REFUSE_CODES` / `UpdateStoreRefuseCode` / `isUpdateStoreRefuseCode` APPENDED at the end of the file, after the last line of Task 1's end-of-file update block (`export interface AckAnswer { ok: true; node: NodeWire }`) — NOT next to `SET_ACCOUNT_POOLS_REFUSE_CODES` (`:6064-6090`), where the topic would put it: `README.md:2560` cites `shared/api.ts:7465-7467`/`:7505`/`:7513`/`:7526` by line, and any line inserted above `:7526` moves `session-hook.test.ts`'s citation audit (ruling R5, D-3188). Nothing above the end of the file changes *(correction: not in the skeleton — see Step 5; D-3192)*
- Modify: `server/test/mail-routes.test.ts` — the kebab-token scan (`it('every quoted kebab token in server/src/coord that looks like a code is declared')`, `:569`): one `NOT_CODES` entry before the Set's close (`:709`), one admitted guard after `isSetAccountPoolsRefuseCode(tok)` (`:775`), the guard's import (`:9`, names appended to the existing line) *(correction: not in the skeleton — see Step 5)*. This file is NOT cited by line by the citation audit's corpus (measured at d759c914: `grep -no 'mail-routes\.test\.ts:[0-9]'` over `README.md`, `specs/2026-09-09-graphify-compaction-card-design.md` and `plans/2026-09-10-graphify-compaction-card-plan-a.md` prints nothing, and neither does the same grep for `store\.ts:[0-9]`), so the `NOT_CODES` insert and the admission's added comment lines need not be line-neutral (ruling R5's "line-neutral if that file is cited")
- Test: `server/test/update-store-catalogue.test.ts` (create)
- Run (not modified): `server/test/session-hook.test.ts`'s citation audit (`describe('the compaction card — every line citation is anchored (spec §3.4)')`, `:7061`) — `shared/api.ts` is a cited file, so Step 6's green run includes it (ruling R13)

**Interfaces:**
- Consumes: `tx` (`db.ts:245`); `UpdateChannel`, `isUpdateChannel`, `isReleaseTag` (Task 1); the `releases`, `node_release_refusals` and `nodes` tables (Task 3).
- Produces (in `store.ts`):

```ts
// CORRECTION (fix round 2, R5/D-3217's class): brought into agreement with
// the shipped store.ts — `tarballUrl` widened to `string | null` (D-3216,
// F10: the on-disk '' sentinel folds to null at this one seam, never handed
// out as ''); `ListingCoverage` gained 'single' (fix round 1, D-3215) and
// 'withdrawn' (fix round 1, item 5, ruling A); `ApplyReleaseListingResult`
// gained the two refusal arms those coverages need; `applyReleaseListing`
// gained `keepTags`/`withdrawTag`, both optional so an old 3-argument test
// double still type-checks; `newestUnyankedStable` (ruling A, a READ, never
// a writer) is new.
export interface ReleaseListingRow {
  tag: string; channel: UpdateChannel; publishedAt: number; commitSha: string | null;
  tarballUrl: string | null; bundleListed: boolean; notes: string | null; draft: boolean;
}
export type ListingCoverage = 'complete' | 'newest-page' | 'single' | 'withdrawn';   // D-3185; 'single'/'withdrawn' added fix round 1, D-3215
export type ApplyReleaseListingResult =
  | { ok: true; upserted: number; yanked: number; unyanked: number }
  | { ok: false; why: 'bad-tag'; tag: string }
  | { ok: false; why: 'duplicate-tag'; tag: string }
  | { ok: false; why: 'bad-row'; tag: string; field: 'channel' | 'publishedAt' | 'tarballUrl' }   // CORRECTION: added arm
  | { ok: false; why: 'empty-listing'; known: number }
  | { ok: false; why: 'single-not-one'; count: number }        // ADDED fix round 1, D-3215: 'single' handed a listing whose length isn't 1
  | { ok: false; why: 'withdrawn-not-empty'; count: number };  // ADDED fix round 1, item 5, ruling A: 'withdrawn' handed a non-empty listing
export interface ReleaseRow {
  tag: string; version: string; channel: UpdateChannel | null; publishedAt: number; commitSha: string | null;
  tarballUrl: string | null; bundleListed: boolean; notes: string | null; yanked: boolean; observedAt: number;
  notifiedAt: number | null;
  refused: { by: string; at: number }[];                             // display roll-up of node_release_refusals
}
export interface RefusalRow { nodeId: string; tag: string; at: number; detail: string }
export type RefuseReleaseResult =
  | { ok: true; inserted: boolean }                                  // false = this (node, tag) was already refused
  | { ok: false; why: 'bad-tag' }
  | { ok: false; why: 'unknown-node' };
export type ClearRefusalsResult =
  | { ok: true; cleared: number }
  | { ok: false; why: 'unknown-node' };

// CoordStore methods — every signature ONE line
applyReleaseListing(listing: readonly ReleaseListingRow[], now: number, coverage: ListingCoverage, keepTags?: readonly string[], withdrawTag?: string | null): ApplyReleaseListingResult   // CORRECTION: +keepTags, +withdrawTag (fix round 1, ruling A)
refuseRelease(nodeId: string, tag: string, at: number, detail: string): RefuseReleaseResult
clearRefusals(nodeId: string): ClearRefusalsResult
releases(): ReleaseRow[]                                             // ORDER BY publishedAt DESC, tag
refusalsFor(nodeId: string): RefusalRow[]
newestUnyankedStable(): string | null                                // ADDED fix round 1, ruling A: the newest un-yanked stable release BY TAG (newestTag/compareReleaseTags, never publishedAt); a READ, not a writer
```

- Produces (in `shared/api.ts`, at the END of the file after Task 1's block — CORRECTION, the skeleton did not name it):

```ts
// CORRECTION (fix round 2, R5/C1): this task's own `ApplyReleaseListingResult`
// arms above (`'single-not-one'`, `'withdrawn-not-empty'`, fix round 1)
// belong in this SAME array — they were missing here though shipped.
export const UPDATE_STORE_REFUSE_CODES = [
  'bad-tag', 'duplicate-tag', 'bad-row', 'empty-listing', 'unknown-node',
  'single-not-one', 'withdrawn-not-empty',
] as const;
export type UpdateStoreRefuseCode = (typeof UPDATE_STORE_REFUSE_CODES)[number];
export function isUpdateStoreRefuseCode(v: unknown): v is UpdateStoreRefuseCode;
// Tasks 5 and 6 APPEND their own store words to this ONE array (ruling R5) — Task 6 declares no
// SET_INTENT_REFUSE_CODES of its own. The scanner admits all of them through ONE
// `|| isUpdateStoreRefuseCode(tok)`, added here; `newest-page` (this task) and `no-label-row` (Task 5) go in NOT_CODES.
```

- Departure D-3192 (found by this task; accepted, ruling R11 — it ABSORBS the text of the retired the retired kebab-scanner name, ruling R5): spec §6 lists the update vocabularies but not the store's refusal words, and the skeleton and facts file did not know that `mail-routes.test.ts`'s `it('every quoted kebab token in server/src/coord that looks like a code is declared')` (`:569-777`) reads every `.ts` directly under `server/src/coord` (`sources()`, `:520-523`, comments included) and fails on any single-quoted kebab-case literal (`/'([a-z]+(?:-[a-z]+)+)'/`) that is neither a declared code admitted by an exported guard nor a `NOT_CODES` entry. Every W2 store word in `store.ts` (Tasks 4–6: `bad-tag`, `duplicate-tag`, `bad-row`, `empty-listing`, `unknown-node`, `newest-page`, `no-label-row`, `bad-node-id`, `label-key-taken`, `not-busy`, `stale-report`, and Task 6's intent words) reds it. W2 declares the refusal words ONCE, in `shared/api.ts`, as `UPDATE_STORE_REFUSE_CODES` — the tenth union, on `SET_ACCOUNT_POOLS_REFUSE_CODES`'s pattern (`api.ts:6064-6090`, admitted at `mail-routes.test.ts:775`) but placed at the end of the file (D-3188) — admitted by one guard; the two non-refusal words (`newest-page`, `no-label-row`) go in `NOT_CODES` with their reasons. Pinned by the scan itself: removing the guard reds it naming `bad-tag`, removing the `NOT_CODES` entry reds it naming `newest-page` (Step 7, mutation 6). Cost if wrong: none; one array.

- `applyReleaseListing`: refusals decided BEFORE the `tx` opens; inside one `tx` it upserts every listed row (`version = tag`, `yanked = draft ? 1 : 0`, `observedAt = now`, `notifiedAt` untouched) and marks `yanked = 1` every known, un-yanked row absent from the listing — all of them under `complete`, only those with `publishedAt >=` the oldest listed `publishedAt` under `newest-page`; never `DELETE`. "Absent" means absent from the `listing` ARGUMENT — the rows the poller could parse — so a known release whose GitHub element Task 10's parser skipped on this poll is marked too (D-3206, below). `refuseRelease` is `INSERT … SELECT … WHERE EXISTS (SELECT 1 FROM nodes WHERE nodeId = ?) ON CONFLICT DO NOTHING`. A `releases.channel` outside the vocabulary reads `null`.
- Departure D-3206 (found by review of this task's seam with Task 10; NOT in ruling R11's accepted list — for the coordinator's ruling): spec §7 says "a release present last time and absent now is marked `yanked = 1`". GitHub may still list a release whose element Task 10's `parseReleaseListing` skips on one poll (no `ccrc-<tag>.tar.gz` asset, a download URL off `DOWNLOAD_URL`, an unparseable `published_at`, a non-boolean `prerelease`). The skipped element never reaches this writer, so under `complete`, or inside the `newest-page` window, the known row is marked `yanked = 1` for that poll. The next poll that parses the element unyanks it (this task's "a yanked release listed again comes back" case). The reading is deliberate, and it fails closed. A skipped element is not upserted, so its stored columns are the LAST poll's. Leaving the row at `yanked = 0` would keep a release eligible (spec §9: `bundleListed = 1`, `yanked = 0`) on a `tarballUrl` or `channel` that GitHub is not listing right now. Marking it yanked only stops forward movement for one 30-minute cycle, and §9 already says a yank never moves a node backwards. The rejected alternative threads the skipped tags across the seam: a `skippedTags` field on `ParsedListing` and a fourth `present` parameter here that `AND tag NOT IN (…)` excludes from the yank. That would change this signature for every caller (the `CatalogueStore` port and Tasks 10, 12 and 13) and keep a stale row eligible. Pinned end to end by Task 10's poller case "a known release whose element is skipped is yanked for that poll, and comes back when it parses again". Cost if wrong: a pinned tag that is transiently malformed resolves NULL with its reason for one cycle, and the PWA shows that release as yanked for up to 30 minutes.
- Spec §18 rows this task pins: "a yanked release is kept"; "a provenance failure refuses the release FOR THAT NODE" (the store half: the refusal row is keyed by node, a second node's rows and the catalogue row are untouched); "a superseded row is invisible" (the roll-up half); D-3185's three cases.
- Rulings applied: R5 (one store vocabulary, declared here, at the END of `shared/api.ts` after Task 1's block; one scanner admission; `newest-page` in `NOT_CODES`; the retired kebab-scanner name folded into D-3192); R11 (D-3185, D-3192, D-3188 accepted); R12 (every departure left in placeholder form for the coordinator's single numbering pass, which has since run); R13 (the `shared/api.ts` edit is a pure append; `store.ts` and `mail-routes.test.ts` are not cited by line; Step 6 runs the citation audit).

- [ ] **Step 1: Write the failing test**

Create `server/test/update-store-catalogue.test.ts`:

```ts
// Design 2026-09-20 §6/§7, W2 Task 4 — the release catalogue's ONE writer
// (`applyReleaseListing`, D-3180) and a node's
// refusal rows (decision 16). Store-level only: no poller, no GitHub, no
// clock — every `now` is a literal so each case reads as the rule it pins.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type ReleaseListingRow } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const NODE_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const NODE_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const NODE_C = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';

const fresh = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('update-store-catalogue-'), 'coord.db')));

const url = (tag: string): string => `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`;

/** One listing element in the shape the poller (Task 10) hands over. */
const rel = (tag: string, publishedAt: number, over: Partial<ReleaseListingRow> = {}): ReleaseListingRow => ({
  tag, channel: 'stable', publishedAt, commitSha: null, tarballUrl: url(tag),
  bundleListed: true, notes: null, draft: false, ...over,
});

/** A `nodes` row planted directly: Task 5's writers do not exist yet, and a
 *  refusal's only precondition is that its node IS a row. */
const plantNode = (store: CoordStore, nodeId: string, supersededBy: string | null = null): void => {
  store.db.prepare(
    'INSERT INTO nodes (nodeId, role, label, stampRead, installState, provenance, caps, os, reachable, supersededBy) ' +
    "VALUES (?, 'fleet', 'fleet', 'ok', 'complete', 'verified', '', 'linux', 1, ?)",
  ).run(nodeId, supersededBy);
};

const yankedOf = (store: CoordStore, tag: string): boolean | undefined =>
  store.releases().find((r) => r.tag === tag)?.yanked;

const refusalCount = (store: CoordStore): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM node_release_refusals').get() as { n: number }).n;

describe('applyReleaseListing — the one writer of the catalogue columns', () => {
  it('upserts every listed row: version is the tag, a draft is yanked, observedAt is this listing, newest first', () => {
    const store = fresh();
    const r = store.applyReleaseListing([
      rel('v0.0.10', T0 + 2000, { channel: 'dev', commitSha: 'c'.repeat(40), notes: 'two fixes' }),
      rel('v0.0.9', T0 + 1000, { bundleListed: false }),
      rel('v0.0.11', T0 + 3000, { draft: true }),
    ], T0 + 5000, 'complete');
    expect(r).toEqual({ ok: true, upserted: 3, yanked: 0, unyanked: 0 });
    expect(store.releases()).toEqual([
      { tag: 'v0.0.11', version: 'v0.0.11', channel: 'stable', publishedAt: T0 + 3000, commitSha: null,
        tarballUrl: url('v0.0.11'), bundleListed: true, notes: null, yanked: true, observedAt: T0 + 5000,
        notifiedAt: null, refused: [] },
      { tag: 'v0.0.10', version: 'v0.0.10', channel: 'dev', publishedAt: T0 + 2000, commitSha: 'c'.repeat(40),
        tarballUrl: url('v0.0.10'), bundleListed: true, notes: 'two fixes', yanked: false, observedAt: T0 + 5000,
        notifiedAt: null, refused: [] },
      { tag: 'v0.0.9', version: 'v0.0.9', channel: 'stable', publishedAt: T0 + 1000, commitSha: null,
        tarballUrl: url('v0.0.9'), bundleListed: false, notes: null, yanked: false, observedAt: T0 + 5000,
        notifiedAt: null, refused: [] },
    ]);
  });

  it('never touches notifiedAt — the notifier\'s column (W3) survives a re-listing', () => {
    const store = fresh();
    expect(store.applyReleaseListing([rel('v0.0.9', T0)], T0 + 1, 'complete').ok).toBe(true);
    store.db.prepare('UPDATE releases SET notifiedAt = ? WHERE tag = ?').run(T0 + 2, 'v0.0.9');
    expect(store.applyReleaseListing([rel('v0.0.9', T0, { notes: 'edited' })], T0 + 3, 'complete').ok).toBe(true);
    expect(store.releases()[0]).toMatchObject({ notes: 'edited', observedAt: T0 + 3, notifiedAt: T0 + 2 });
  });

  it('a release that vanishes from a complete listing is yanked and KEPT, never deleted (§18 "a yanked release is kept")', () => {
    const store = fresh();
    store.applyReleaseListing([rel('v0.0.10', T0 + 2000), rel('v0.0.9', T0 + 1000)], T0 + 5000, 'complete');
    expect(store.applyReleaseListing([rel('v0.0.10', T0 + 2000)], T0 + 6000, 'complete'))
      .toEqual({ ok: true, upserted: 1, yanked: 1, unyanked: 0 });
    // Still a row — a node may be running it — and its observedAt is the last
    // listing that CONFIRMED it, not the one that missed it.
    expect(store.releases().map((x) => x.tag)).toEqual(['v0.0.10', 'v0.0.9']);
    expect(store.releases()[1]).toMatchObject({ tag: 'v0.0.9', yanked: true, observedAt: T0 + 5000 });
    // The mark is idempotent: the same listing again yanks nothing more.
    expect(store.applyReleaseListing([rel('v0.0.10', T0 + 2000)], T0 + 7000, 'complete'))
      .toEqual({ ok: true, upserted: 1, yanked: 0, unyanked: 0 });
  });

  it('a yanked release listed again comes back, and so does a draft that is published', () => {
    const store = fresh();
    store.applyReleaseListing([rel('v0.0.10', T0 + 2000), rel('v0.0.9', T0 + 1000, { draft: true })], T0 + 5000, 'complete');
    store.applyReleaseListing([rel('v0.0.10', T0 + 2000)], T0 + 6000, 'complete');
    expect(yankedOf(store, 'v0.0.9')).toBe(true);
    expect(store.applyReleaseListing([rel('v0.0.10', T0 + 2000), rel('v0.0.9', T0 + 1000)], T0 + 7000, 'complete'))
      .toEqual({ ok: true, upserted: 2, yanked: 0, unyanked: 1 });
    expect(yankedOf(store, 'v0.0.9')).toBe(false);
  });

  it('under newest-page only rows inside the listed window are yank candidates (D-3185)', () => {
    const tags = Array.from({ length: 32 }, (_, i) => `v0.0.${i + 1}`);   // v0.0.1 is the oldest
    const at = (tag: string): number => T0 + Number(tag.split('.')[2]) * 1000;
    const seed = (s: CoordStore): void => {
      expect(s.applyReleaseListing(tags.map((t) => rel(t, at(t))), T0, 'complete').ok).toBe(true);
    };
    // The next poll: GitHub's newest page of 30, with v0.0.20 deleted upstream,
    // so the page now reaches down to v0.0.2 and v0.0.1 has fallen off it.
    const page = tags.filter((t) => t !== 'v0.0.1' && t !== 'v0.0.20').map((t) => rel(t, at(t)));
    expect(page).toHaveLength(30);

    const windowed = fresh();
    seed(windowed);
    expect(windowed.applyReleaseListing(page, T0 + 1, 'newest-page'))
      .toEqual({ ok: true, upserted: 30, yanked: 1, unyanked: 0 });
    expect(yankedOf(windowed, 'v0.0.20')).toBe(true);    // deleted INSIDE the window: observed, marked
    expect(yankedOf(windowed, 'v0.0.1')).toBe(false);    // older than the window: not observed, not marked

    // The control: the SAME page read as complete yanks both — so the case
    // above is green because of the coverage argument, not because v0.0.1
    // was never a candidate.
    const complete = fresh();
    seed(complete);
    expect(complete.applyReleaseListing(page, T0 + 1, 'complete'))
      .toEqual({ ok: true, upserted: 30, yanked: 2, unyanked: 0 });
    expect(yankedOf(complete, 'v0.0.1')).toBe(true);
  });

  it('an empty listing while releases are known is refused and writes nothing — a transient [] never yanks the catalogue', () => {
    const store = fresh();
    store.applyReleaseListing([rel('v0.0.10', T0 + 2), rel('v0.0.9', T0 + 1)], T0 + 5, 'complete');
    expect(store.applyReleaseListing([], T0 + 6, 'complete')).toEqual({ ok: false, why: 'empty-listing', known: 2 });
    expect(store.applyReleaseListing([], T0 + 6, 'newest-page')).toEqual({ ok: false, why: 'empty-listing', known: 2 });
    expect(store.releases().map((r) => [r.tag, r.yanked, r.observedAt]))
      .toEqual([['v0.0.10', false, T0 + 5], ['v0.0.9', false, T0 + 5]]);
    // …and on an empty catalogue there is simply nothing to do.
    expect(fresh().applyReleaseListing([], T0, 'complete')).toEqual({ ok: true, upserted: 0, yanked: 0, unyanked: 0 });
  });

  it('refuses a whole listing over one bad tag, a duplicate, or a row the table cannot store — before the transaction', () => {
    const store = fresh();
    expect(store.applyReleaseListing([rel('v0.0.9', T0), rel('0.0.10', T0 + 1)], T0 + 5, 'complete'))
      .toEqual({ ok: false, why: 'bad-tag', tag: '0.0.10' });
    expect(store.applyReleaseListing([rel('v0.0.9', T0), rel('v0.0.9', T0 + 1)], T0 + 5, 'complete'))
      .toEqual({ ok: false, why: 'duplicate-tag', tag: 'v0.0.9' });
    expect(store.applyReleaseListing([rel('v0.0.9', Number.NaN)], T0 + 5, 'complete'))
      .toEqual({ ok: false, why: 'bad-row', tag: 'v0.0.9', field: 'publishedAt' });
    expect(store.applyReleaseListing([rel('v0.0.9', T0, { tarballUrl: '' })], T0 + 5, 'complete'))
      .toEqual({ ok: false, why: 'bad-row', tag: 'v0.0.9', field: 'tarballUrl' });
    expect(store.applyReleaseListing([rel('v0.0.9', T0, { channel: 'nightly' as unknown as 'dev' })], T0 + 5, 'complete'))
      .toEqual({ ok: false, why: 'bad-row', tag: 'v0.0.9', field: 'channel' });
    // The valid FIRST row of each refused listing was not written either.
    expect(store.releases()).toEqual([]);
  });

  it('a stored channel outside the vocabulary reads null, never the fleet default (D-3181)', () => {
    const store = fresh();
    store.applyReleaseListing([rel('v0.0.9', T0)], T0 + 1, 'complete');
    store.db.prepare("UPDATE releases SET channel = 'nightly' WHERE tag = 'v0.0.9'").run();
    expect(store.releases()[0]!.channel).toBeNull();
  });
});

describe('node_release_refusals — a node\'s verdict on a release, never fleet-wide (decision 16)', () => {
  it('one row per (node, tag); a second verdict keeps the first; another node and the catalogue row are untouched', () => {
    const store = fresh();
    plantNode(store, NODE_A);
    plantNode(store, NODE_B);
    store.applyReleaseListing([rel('v0.0.9', T0)], T0 + 1, 'complete');
    expect(store.refuseRelease(NODE_A, 'v0.0.9', T0 + 10, 'provenance: signature does not verify'))
      .toEqual({ ok: true, inserted: true });
    expect(store.refuseRelease(NODE_A, 'v0.0.9', T0 + 20, 'provenance: a second attempt'))
      .toEqual({ ok: true, inserted: false });
    expect(store.refusalsFor(NODE_A))
      .toEqual([{ nodeId: NODE_A, tag: 'v0.0.9', at: T0 + 10, detail: 'provenance: signature does not verify' }]);
    // §18 "a provenance failure refuses the release FOR THAT NODE": node B's
    // eligibility inputs are unchanged — no row of its own, the release not yanked.
    expect(store.refusalsFor(NODE_B)).toEqual([]);
    expect(store.releases()[0]).toMatchObject({ yanked: false, refused: [{ by: NODE_A, at: T0 + 10 }] });
  });

  it('refuses a bad tag and an unknown node, writing nothing', () => {
    const store = fresh();
    plantNode(store, NODE_A);
    expect(store.refuseRelease(NODE_A, 'v0.0', T0, 'provenance: x')).toEqual({ ok: false, why: 'bad-tag' });
    expect(store.refuseRelease(NODE_C, 'v0.0.9', T0, 'provenance: x')).toEqual({ ok: false, why: 'unknown-node' });
    expect(refusalCount(store)).toBe(0);
  });

  it('clearRefusals clears this node\'s rows only, and says how many', () => {
    const store = fresh();
    plantNode(store, NODE_A);
    plantNode(store, NODE_B);
    store.refuseRelease(NODE_A, 'v0.0.9', T0, 'provenance: x');
    store.refuseRelease(NODE_A, 'v0.0.10', T0 + 1, 'provenance: y');
    store.refuseRelease(NODE_B, 'v0.0.9', T0 + 2, 'provenance: z');
    expect(store.clearRefusals(NODE_A)).toEqual({ ok: true, cleared: 2 });
    expect(store.refusalsFor(NODE_A)).toEqual([]);
    expect(store.refusalsFor(NODE_B)).toHaveLength(1);
    expect(store.clearRefusals(NODE_A)).toEqual({ ok: true, cleared: 0 });
    expect(store.clearRefusals(NODE_C)).toEqual({ ok: false, why: 'unknown-node' });
  });

  it('the roll-up on releases() leaves out a superseded node\'s verdicts; refusalsFor still names them', () => {
    const store = fresh();
    plantNode(store, NODE_A);
    plantNode(store, 'fleet', NODE_A);                 // a label row a node-id row replaced
    store.applyReleaseListing([rel('v0.0.9', T0)], T0 + 1, 'complete');
    store.refuseRelease('fleet', 'v0.0.9', T0 + 5, 'provenance: before the re-key');
    store.refuseRelease(NODE_A, 'v0.0.9', T0 + 9, 'provenance: after it');
    expect(store.releases()[0]!.refused).toEqual([{ by: NODE_A, at: T0 + 9 }]);
    expect(store.refusalsFor('fleet')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/update-store-catalogue.test.ts`
Expected: FAIL — every case, `TypeError: store.applyReleaseListing is not a function` (and `store.refuseRelease is not a function` for the refusal cases that plant first).

- [ ] **Step 3: Implement the store section**

In `server/src/coord/store.ts`'s import block from `'../../../shared/api.js'`, after the line `  isWorkItemState,` add:

```ts
  // design 2026-09-20 §6/§7 (W2): the release catalogue's tag guard and channel vocabulary.
  isReleaseTag, isUpdateChannel,
```

and after the line `  type WorkItemState,` add:

```ts
  type UpdateChannel,
```

Right after `SetAccountPoolsResult` (ending `| { ok: false; error: SetAccountPoolsRefuseCode; pools: readonly string[] };`, `:152`) add:

```ts

/** Design 2026-09-20 §7 (W2). One element of a release listing, in the shape
 *  the catalogue poller (`update/catalogue.ts`) has already parsed and
 *  defensively validated; `applyReleaseListing` re-checks what the TABLE needs
 *  (a tag, a channel, an integer `publishedAt`, a non-empty `tarballUrl`) and
 *  refuses the whole listing otherwise. `draft` is GitHub's own flag: a draft
 *  is stored `yanked = 1`, never offered. */
export interface ReleaseListingRow {
  tag: string; channel: UpdateChannel; publishedAt: number; commitSha: string | null;
  tarballUrl: string; bundleListed: boolean; notes: string | null; draft: boolean;
}

/** What the listing COVERS (D-3185). `complete` = the listing is
 *  the whole catalogue (GitHub answered fewer elements than a page), so
 *  every known row missing from it was yanked. `newest-page` = a full page:
 *  only a known row published at or after the oldest LISTED one can have been
 *  observed missing; an older row fell off the page, it was not yanked. */
export type ListingCoverage = 'complete' | 'newest-page';

/** `applyReleaseListing`'s answers. `yanked` counts rows THIS listing newly
 *  marked absent; `unyanked` counts rows that were yanked and are listed again,
 *  not as drafts. Every refusal is decided before the transaction opens, so a
 *  refused listing writes nothing at all — not even its valid rows. */
export type ApplyReleaseListingResult =
  | { ok: true; upserted: number; yanked: number; unyanked: number }
  | { ok: false; why: 'bad-tag'; tag: string }
  | { ok: false; why: 'duplicate-tag'; tag: string }
  | { ok: false; why: 'bad-row'; tag: string; field: 'channel' | 'publishedAt' | 'tarballUrl' }
  | { ok: false; why: 'empty-listing'; known: number };

/** One `releases` row on the way OUT. `channel` is `null` for a stored token
 *  outside `UpdateChannel` — the ClaimState stance (`ClaimEndResult`, below):
 *  no we-do-not-know member, so nothing, never the fleet default
 *  (D-3181). `refused` is a DISPLAY roll-up of
 *  `node_release_refusals` for live nodes — never an eligibility predicate;
 *  the resolver asks `refusalsFor(nodeId)` about the one node it resolves. */
export interface ReleaseRow {
  tag: string; version: string; channel: UpdateChannel | null; publishedAt: number; commitSha: string | null;
  tarballUrl: string; bundleListed: boolean; notes: string | null; yanked: boolean; observedAt: number;
  notifiedAt: number | null;
  refused: { by: string; at: number }[];
}

export interface RefusalRow { nodeId: string; tag: string; at: number; detail: string }

/** `inserted: false` = this node had already refused this tag: its FIRST
 *  verdict (time and detail) stands. */
export type RefuseReleaseResult =
  | { ok: true; inserted: boolean }
  | { ok: false; why: 'bad-tag' }
  | { ok: false; why: 'unknown-node' };

export type ClearRefusalsResult =
  | { ok: true; cleared: number }
  | { ok: false; why: 'unknown-node' };

/** The columns `releases()` reads, as SQLite hands them back. */
interface RawReleaseRow {
  tag: string; version: string; channel: string; publishedAt: number; commitSha: string | null;
  tarballUrl: string; bundleListed: number; notes: string | null; yanked: number; observedAt: number;
  notifiedAt: number | null;
}
```

At the end of the class — after `poolEdgeDigest`'s closing `  }` and before the class's own closing `}` — add:

```ts

  // ── update catalogue (design 2026-09-20 §6, §7; W2) ────────────────────
  //
  // `releases`' catalogue columns have ONE writer, `applyReleaseListing`
  // (D-3180): the yank mark is a statement about the
  // whole listing, which a per-row upsert cannot make without a second writer
  // on the group. `notifiedAt` is W3's `markReleaseNotified`, and nothing here
  // names it. A node's verdict on a release is a `node_release_refusals` row,
  // keyed by node — never a column on `releases` (decision 16). Every
  // signature below is ONE line: Task 7's writer-group scan walks back from
  // each statement to its method the way `mail-hardening.test.ts`'s `SIG`
  // does (the D-2338 precedent).

  /** The one catalogue writer. Upserts every listed row and marks `yanked = 1`
   *  every known, un-yanked row absent from the listing — all of them under
   *  `complete`, only those inside the listed window under `newest-page`
   *  (D-3185). NEVER deletes: a node may be running a yanked
   *  release, and rollback may target one. An empty listing while rows are
   *  known is refused rather than read as "everything was yanked". "Absent"
   *  is absent from THIS argument: an element the poller could not parse is
   *  not here, so its known row is marked too, and it unyanks on the next
   *  poll that parses it (D-3206). */
  applyReleaseListing(listing: readonly ReleaseListingRow[], now: number, coverage: ListingCoverage): ApplyReleaseListingResult {
    const seen = new Set<string>();
    for (const r of listing) {
      if (!isReleaseTag(r.tag)) return { ok: false, why: 'bad-tag', tag: r.tag };
      if (seen.has(r.tag)) return { ok: false, why: 'duplicate-tag', tag: r.tag };
      if (!isUpdateChannel(r.channel)) return { ok: false, why: 'bad-row', tag: r.tag, field: 'channel' };
      if (!Number.isSafeInteger(r.publishedAt) || r.publishedAt < 0) {
        return { ok: false, why: 'bad-row', tag: r.tag, field: 'publishedAt' };
      }
      if (typeof r.tarballUrl !== 'string' || r.tarballUrl === '') {
        return { ok: false, why: 'bad-row', tag: r.tag, field: 'tarballUrl' };
      }
      seen.add(r.tag);
    }
    if (listing.length === 0) {
      const known = (this.db.prepare('SELECT COUNT(*) AS n FROM releases').get() as { n: number }).n;
      return known > 0 ? { ok: false, why: 'empty-listing', known } : { ok: true, upserted: 0, yanked: 0, unyanked: 0 };
    }
    const since = coverage === 'complete' ? Number.MIN_SAFE_INTEGER : Math.min(...listing.map((r) => r.publishedAt));
    const marks = listing.map(() => '?').join(', ');
    return tx(this.db, (): ApplyReleaseListingResult => {
      const wasYanked = new Set((this.db.prepare('SELECT tag FROM releases WHERE yanked = 1')
        .all() as { tag: string }[]).map((r) => r.tag));
      let unyanked = 0;
      for (const r of listing) {
        this.db.prepare(
          'INSERT INTO releases (tag, version, channel, publishedAt, commitSha, tarballUrl, bundleListed, notes, ' +
          'yanked, observedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tag) DO UPDATE SET ' +
          'version = excluded.version, channel = excluded.channel, publishedAt = excluded.publishedAt, ' +
          'commitSha = excluded.commitSha, tarballUrl = excluded.tarballUrl, bundleListed = excluded.bundleListed, ' +
          'notes = excluded.notes, yanked = excluded.yanked, observedAt = excluded.observedAt',
        ).run(r.tag, r.tag, r.channel, r.publishedAt, r.commitSha, r.tarballUrl, r.bundleListed ? 1 : 0,
          r.notes, r.draft ? 1 : 0, now);
        if (wasYanked.has(r.tag) && !r.draft) unyanked += 1;
      }
      const res = this.db.prepare(
        `UPDATE releases SET yanked = 1 WHERE yanked = 0 AND publishedAt >= ? AND tag NOT IN (${marks})`,
      ).run(since, ...listing.map((r) => r.tag));
      return { ok: true, upserted: listing.length, yanked: Number(res.changes), unyanked };
    });
  }

  /** A node's verdict on a release (§8: a changed `failed` report whose detail
   *  begins `provenance:`). The guard is the statement's own `WHERE EXISTS` —
   *  a refusal for a node that is not a row is never written — and a second
   *  verdict on the same (node, tag) keeps the first. */
  refuseRelease(nodeId: string, tag: string, at: number, detail: string): RefuseReleaseResult {
    if (!isReleaseTag(tag)) return { ok: false, why: 'bad-tag' };
    const res = this.db.prepare(
      'INSERT INTO node_release_refusals (nodeId, tag, at, detail) ' +
      'SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM nodes WHERE nodeId = ?) ON CONFLICT DO NOTHING',
    ).run(nodeId, tag, at, detail, nodeId);
    if (Number(res.changes) > 0) return { ok: true, inserted: true };
    return this.nodeRowExists(nodeId) ? { ok: true, inserted: false } : { ok: false, why: 'unknown-node' };
  }

  /** This node's verdicts, all of them — `ack` (Task 5's `ackNode`) is the
   *  operator's door; this is the store's. Another node's rows are untouched. */
  clearRefusals(nodeId: string): ClearRefusalsResult {
    const res = this.db.prepare(
      'DELETE FROM node_release_refusals WHERE nodeId = ? AND EXISTS (SELECT 1 FROM nodes WHERE nodeId = ?)',
    ).run(nodeId, nodeId);
    if (Number(res.changes) > 0) return { ok: true, cleared: Number(res.changes) };
    return this.nodeRowExists(nodeId) ? { ok: true, cleared: 0 } : { ok: false, why: 'unknown-node' };
  }

  /** The catalogue, newest first. A superseded node's verdicts are left out of
   *  the roll-up (§8: every reader excludes superseded rows); `refusalsFor`
   *  still names them, keyed by the id they were written under. */
  releases(): ReleaseRow[] {
    const refused = new Map<string, { by: string; at: number }[]>();
    const verdicts = this.db.prepare(
      'SELECT nodeId, tag, at FROM node_release_refusals ' +
      'WHERE nodeId NOT IN (SELECT nodeId FROM nodes WHERE supersededBy IS NOT NULL) ORDER BY at, nodeId',
    ).all() as { nodeId: string; tag: string; at: number }[];
    for (const v of verdicts) {
      const cur = refused.get(v.tag);
      if (cur === undefined) refused.set(v.tag, [{ by: v.nodeId, at: v.at }]);
      else cur.push({ by: v.nodeId, at: v.at });
    }
    const rows = this.db.prepare(
      'SELECT tag, version, channel, publishedAt, commitSha, tarballUrl, bundleListed, notes, yanked, observedAt, ' +
      'notifiedAt FROM releases ORDER BY publishedAt DESC, tag',
    ).all() as unknown as RawReleaseRow[];   // an interface has no index signature — `RunRowDb`'s cast (`:2121`)
    return rows.map((r) => ({
      tag: r.tag, version: r.version, channel: isUpdateChannel(r.channel) ? r.channel : null,
      publishedAt: r.publishedAt, commitSha: r.commitSha, tarballUrl: r.tarballUrl,
      bundleListed: r.bundleListed === 1, notes: r.notes, yanked: r.yanked === 1, observedAt: r.observedAt,
      notifiedAt: r.notifiedAt, refused: refused.get(r.tag) ?? [],
    }));
  }

  refusalsFor(nodeId: string): RefusalRow[] {
    return this.db.prepare(
      'SELECT nodeId, tag, at, detail FROM node_release_refusals WHERE nodeId = ? ORDER BY at, tag',
    ).all(nodeId) as unknown as RefusalRow[];
  }

  /** Any `nodes` row with this id, superseded included — the read a
   *  zero-change refusal write takes its `why` from, AFTER the write. */
  private nodeRowExists(nodeId: string): boolean {
    return this.db.prepare('SELECT 1 AS one FROM nodes WHERE nodeId = ?').get(nodeId) !== undefined;
  }
```

- [ ] **Step 4: Run the store test green, and watch the kebab scanner go red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-store-catalogue.test.ts`
Expected: PASS (12 cases).

Run: `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'`
Expected: FAIL — `newest-page is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode or SetAccountPoolsRefuseCode`. That scan (`:569-777`) reads every `.ts` under `server/src/coord` (`sources()`, `:520-523`) and demands every single-quoted kebab-case literal be a declared code or a named non-code; this task's store words are neither yet. This red is the measurement that the scanner sees the new section — it is expected, and Step 5 is its fix.

- [ ] **Step 5: Declare the store's refusal words once, and admit them**

In `shared/api.ts`, at the END of the file — after the last line of Task 1's appended update block, `export interface AckAnswer { ok: true; node: NodeWire }` — append (the block starts with a blank line; no line above it changes). NOT beside `isSetAccountPoolsRefuseCode` (`:6088-6090`): that insert would sit above README's cited `shared/api.ts:7465-7526` anchors and red the citation audit (ruling R5, D-3188):

```ts

/** Design 2026-09-20 §6 (W2) — the TENTH refusal vocabulary
 *  `mail-routes.test.ts`'s kebab-token scanner checks together and never
 *  merges into a sibling, on the standing rule `SET_ACCOUNT_POOLS_REFUSE_CODES`
 *  states (far above — this block sits at the END of the file with the rest
 *  of the update control plane's L0, so no line README cites by number moves;
 *  D-3188, D-3192): the update control plane's `CoordStore` writers
 *  (`server/src/coord/store.ts`) refuse synchronously to an in-process caller
 *  — the catalogue poller, the inventory sweep, a route — and nothing is
 *  recorded or replayed. Store-local words: an update route that answers one
 *  maps it onto `UpdateRouteError` (above) before any client sees it. ONE array
 *  for the whole update store, appended to by each task that adds a writer
 *  (W2 Tasks 4, 5 and 6 — no second store vocabulary beside it), so the
 *  scanner admits a later member through the same guard and still rejects a typo.
 *
 *    bad-tag       — a tag that fails `isReleaseTag`, the one tag-shape guard.
 *    duplicate-tag — one listing named a tag twice; the whole listing is refused.
 *    bad-row       — a listed row the table cannot store: a channel outside
 *                    `UpdateChannel`, a non-integer `publishedAt`, an empty
 *                    `tarballUrl`. Refused before the transaction opens.
 *    empty-listing — `[]` while releases are known: a transient answer must
 *                    not yank the catalogue.
 *    unknown-node  — no `nodes` row carries this id. */
export const UPDATE_STORE_REFUSE_CODES = [
  'bad-tag', 'duplicate-tag', 'bad-row', 'empty-listing', 'unknown-node',
] as const;
export type UpdateStoreRefuseCode = (typeof UPDATE_STORE_REFUSE_CODES)[number];
export function isUpdateStoreRefuseCode(v: unknown): v is UpdateStoreRefuseCode {
  return typeof v === 'string' && (UPDATE_STORE_REFUSE_CODES as readonly string[]).includes(v);
}
```

In `server/test/mail-routes.test.ts`:

- the import on `:9` gains `isUpdateStoreRefuseCode` after `isSetAccountPoolsRefuseCode`:

```ts
import { MAIL_REJECT_CODES, RUN_REFUSE_CODES, ASK_REFUSE_CODES, isRunRefuseCode, isLifecycleGapReason, isClaimRefuseCode, isSessionLifecycle, isReclaimRefuseCode, isAskRefuseCode, isRunRouteRefuseCode, isSetAccountPoolsRefuseCode, isUpdateStoreRefuseCode } from '../../shared/api.js';
```

- in `NOT_CODES`, after the `'reverse-demotion'` entry's last comment line and before the Set's closing `    ]);` (`:709`), add:

```ts
      'newest-page',             // design 2026-09-20 §7 (W2 Task 4) — one of
                                  // `ListingCoverage`'s two words (store.ts): what a
                                  // release listing COVERS, passed by the catalogue
                                  // poller to `applyReleaseListing`. A description of
                                  // an input, never a refusal: nothing answers it,
                                  // nothing switches on it over the wire. Its sibling
                                  // `complete` is one word and never reaches this scan.
```

- replace the admission's last line and its message (`:775-776`):

```ts
        || isSetAccountPoolsRefuseCode(tok)
        // DESIGN 2026-09-20 §6 (W2) — the TENTH union, checked together and
        // never merged, on the standing rule `enter-ignored` above states. The
        // update control plane's `CoordStore` writers refuse synchronously to
        // an in-process caller (the catalogue poller, the inventory sweep, a
        // route) — nothing is recorded, nothing replays — so their words are
        // neither mail rejections nor run refusals. Admitted through their own
        // exported guard, for the reason every union above gives.
        || isUpdateStoreRefuseCode(tok),
        `${tok} is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode, SetAccountPoolsRefuseCode or UpdateStoreRefuseCode`).toBe(true);
```

- [ ] **Step 6: Run green**

Run, one at a time, foreground (timeout ≥ 600000 ms):
- `cd server && ./node_modules/.bin/vitest run test/update-store-catalogue.test.ts` — Expected: PASS.
- `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts` — Expected: PASS (the whole file: the new guard admits the five refusal words, `NOT_CODES` names the coverage word).
- `cd server && ./node_modules/.bin/vitest run test/pool-edges-store.test.ts test/coord-db.test.ts` — Expected: PASS (the section sits beside theirs and changes nothing they read).
- `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — Expected: PASS (the new test file compiles under `test/tsconfig.tests.json`; a known load flake — re-run in isolation before calling a red real).
- `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` — Expected: PASS, the same count Task 1's Step 5 measured (`Tests  13 passed | 320 skipped (333)` at Task 1's tree): the census (`'shared/api.ts': 1`) and README's empty census entry unchanged, because this task's `shared/api.ts` edit is a pure append after Task 1's block (ruling R13). A red here means the block landed above a cited line — move it, do not re-measure the census. (`session-hook` is a known load flake; re-run in isolation before calling a red real.)
- `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'update control plane'` — Expected: PASS (Task 1's scans over the block this one follows).
- `cd server && ./node_modules/.bin/vitest run test/update-states.test.ts test/peers-claims-l0.test.ts test/reader-min-cols.test.ts` — Expected: PASS (the append adds no import to `shared/api.ts` and moves nothing above `READER_MIN_COLS`).

- [ ] **Step 7: Mutation measurement**

Each edit is made, the named case run and seen red, then the edit is REVERSED BY HAND — never `git checkout -- <file>`, which would discard this task's uncommitted work. Run each with `cd server && ./node_modules/.bin/vitest run test/update-store-catalogue.test.ts` unless another file is named.
1. §18 "a yanked release is kept" — in `applyReleaseListing`, change `` `UPDATE releases SET yanked = 1 WHERE yanked = 0 AND publishedAt >= ? AND tag NOT IN (${marks})` `` to `` `DELETE FROM releases WHERE yanked = 0 AND publishedAt >= ? AND tag NOT IN (${marks})` `` → RED: "a release that vanishes … KEPT, never deleted" (`releases()` lists one tag). Reverse.
2. D-3185 — replace `const since = coverage === 'complete' ? Number.MIN_SAFE_INTEGER : Math.min(...listing.map((r) => r.publishedAt));` with `const since = Number.MIN_SAFE_INTEGER;` → RED: "under newest-page only rows inside the listed window …" (`yanked: 2`, `v0.0.1` yanked). The control case in the same test stays green, which is what makes the red about coverage. Reverse.
3. The empty-listing refusal — delete the whole `if (listing.length === 0) { … }` block → RED: "an empty listing while releases are known is refused …" (the `complete` call answers `ok: true` and yanks both rows). Reverse.
4. §18 "a provenance failure refuses the release FOR THAT NODE" (store half) — in `refuseRelease`, change `'SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM nodes WHERE nodeId = ?) ON CONFLICT DO NOTHING'` to `'SELECT nodeId, ?, ?, ? FROM nodes WHERE EXISTS (SELECT 1 FROM nodes WHERE nodeId = ?) ON CONFLICT DO NOTHING'` and its `.run(nodeId, tag, at, detail, nodeId)` to `.run(tag, at, detail, nodeId)` (a fleet-wide write) → RED: "one row per (node, tag) …" at `refusalsFor(NODE_B)`. Reverse.
5. §18 "a superseded row is invisible" (the roll-up) — in `releases()`, delete `'WHERE nodeId NOT IN (SELECT nodeId FROM nodes WHERE supersededBy IS NOT NULL) '` from the verdicts query (keep `ORDER BY at, nodeId`) → RED: "the roll-up on releases() leaves out a superseded node's verdicts …". Reverse.
6. The scanner admission — in `mail-routes.test.ts`, delete `|| isUpdateStoreRefuseCode(tok)` → `./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'` RED naming `bad-tag` (the first refusal word the scan reaches in `store.ts`). Reverse; then delete the `'newest-page'` `NOT_CODES` entry → RED naming `newest-page`. Reverse.

After the last reversal, re-run Step 6's first two commands: PASS.

- [ ] **Step 8: Commit**

Run first: `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` (a new file is added) — Expected: PASS.

```bash
git add server/src/coord/store.ts shared/api.ts server/test/update-store-catalogue.test.ts server/test/mail-routes.test.ts
git commit -m "feat(update): the release catalogue's one writer and per-node refusals — applyReleaseListing yanks by coverage and never deletes, refuseRelease/clearRefusals keyed by node (W2 Task 4)"
```

### Task 5: Store — the node groups

**Files:**
- Modify: `server/src/coord/store.ts` — names added to the `shared/api.js` import block (`:22-54`, after Task 4's two lines); module constants after `TERMINAL_RUN_STATES_SQL` (`:489`, the `OUTSTANDING_STATES_SQL` cluster that starts at `:462`); result types after Task 4's (after `RawReleaseRow`); a `// ── update inventory ──` section after Task 4's section (after `nodeRowExists`)
- Modify: `shared/api.ts` — four words appended to Task 4's `UPDATE_STORE_REFUSE_CODES`, which lives in the END-OF-FILE update block after Task 1's (coordinator ruling R5), never beside `SET_ACCOUNT_POOLS_REFUSE_CODES`; the edit is therefore APPENDED after every line the session-hook citation audit cites (`shared/api.ts` above `:7526`, README's four anchors) and moves none of them (R13, D-3188) *(correction: not in the skeleton — the kebab-token scan, Task 4 Step 4; D-3192)*
- Modify: `server/test/mail-routes.test.ts` — one `NOT_CODES` entry (`no-label-row`, R5), after Task 4's `'newest-page'`; no second admission (`|| isUpdateStoreRefuseCode(tok)` is Task 4's one line, R5). This file is not cited by the session-hook audit's corpus (measured at d759c914: no `mail-routes` and no `store.ts` reference in README or the two compaction-card documents), so the seven-line insert moves no citation *(correction: same reason)*
- Test: `server/test/update-store-nodes.test.ts` (create)
- Run, not edited (repo-wide guards this task's edits could red): `server/test/session-hook.test.ts` (R13 — `shared/api.ts` is a cited file), `server/test/single-definition.test.ts` (the SQL-tuple scans over `store.ts`), `server/test/mail-hardening.test.ts` (`SIG`), `server/test/mail-routes.test.ts` (the kebab scan). No route, README, CLAUDE.md or readiness text changes, so `auth-gate.test.ts`, `box-token-census.test.ts` and `pools-prose.test.ts` are untouched by this task

**Interfaces:**
- Consumes: `tx`; Task 1's vocabularies and guards, `BUSY_UPDATE_STATES`, `SETTLED_UPDATE_STATES`, `SettledUpdateState`, `BusyUpdateState`, `validCapWords`; Task 4's refusal table (written by `ackNode` and `rekeyNode`), `refuseRelease`/`refusalsFor` (the tests), its `isReleaseTag, isUpdateChannel,` / `type UpdateChannel,` import lines, `RawReleaseRow` and `nodeRowExists` (placement anchors), and its `UPDATE_STORE_REFUSE_CODES` array in `shared/api.ts`'s end-of-file update block (R5), whose five members this task extends to nine. The `reportStartedAt` both report-driven writers take is what Task 11's `latestStartOf` passes: the LATEST ms instant the report's whole-second `startedAt` covers, `startedAt*1000 + 999` (R1, D-3199).
- Produces (in `store.ts`; CORRECTIONS against the skeleton are marked):

```ts
// CORRECTION: no BUSY_UPDATE_SQL — "busy" is `NOT IN ${SETTLED_UPDATE_SQL}` (the INACTIVE_RUN_STATES_SQL stance,
// D-2803), so a stored token this build cannot name is busy on the write side exactly as it is on the read side.
const SETTLED_UPDATE_SQL = `('${SETTLED_UPDATE_STATES.join("','")}')`;            // module-private
const HALTED_UPDATE_STATES = SETTLED_UPDATE_STATES.filter((s): s is Exclude<SettledUpdateState, 'idle'> => s !== 'idle');
const HALTED_UPDATE_SQL = `('${HALTED_UPDATE_STATES.join("','")}')`;              // settleNode refuses these
// CORRECTION: NODE_ID_RE is declared HERE, beside the one writer that re-keys by it; Task 11 imports it from
// '../coord/store.js' instead of declaring a second copy in update/inventory.ts.
export const NODE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface NodeReport {
  phase: UpdatePhase; target: string | null; startedAt: number | null; updatedAt: number | null; detail: string | null;
}
/** The measurement + report groups — and nothing else (§6's writer groups).
 *  CORRECTION (fix round 2, R5/D-3217's class): `floorRead`/`previousRead`
 *  (fix round 1, D-3213) added, brought into agreement with the shipped
 *  `store.ts` — the STORED read state of the floor/previous files, a fact
 *  about the ROW, not just about the sweep that last touched it; see D-3213. */
export interface NodeMeasurement {
  nodeId: string;                        // a measured node-id UUID, or the label when none was measured
  role: NodeRole; label: string;
  currentVersion: string | null; currentSha: string | null; currentRef: string | null;
  currentBuiltAt: string | null; currentDirty: boolean | null;
  stampRead: StampRead; installState: InstallState; provenance: ProvenanceState;
  caps: readonly string[];               // validated; [] is stored as ''
  agentOps: readonly string[] | null;    // null = no agent by construction (the server row); [] is stored as ''
  highestVersion: string | null; previousVersion: string | null;
  floorRead: TagFileRead; previousRead: TagFileRead;   // ADDED, D-3213
  os: NodeOs;
  measuredAt: number;
  report: NodeReport | null;             // null = no update.json
}
export interface NodeRow {
  nodeId: string; role: NodeRole | null; label: string;
  currentVersion: string | null; currentSha: string | null; currentRef: string | null;
  currentBuiltAt: string | null; currentDirty: boolean | null;
  stampRead: StampRead; installState: InstallState; provenance: ProvenanceState;
  caps: string[]; agentOps: string[] | null; highestVersion: string | null; previousVersion: string | null;
  floorRead: TagFileRead; previousRead: TagFileRead;   // ADDED, D-3213
  os: NodeOs;
  measuredAt: number | null; reachable: boolean; unreachableSince: number | null;
  reportedPhase: UpdatePhase | null; reportedTarget: string | null; reportedStartedAt: number | null;
  reportedUpdatedAt: number | null; reportedDetail: string | null;
  updateState: UpdateState; updateTarget: string | null; updateStartedAt: number | null; updateDetail: string | null;
  channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null;
  requestedTag: string | null; requestedKind: RequestKind | null; requestedAt: number | null;
  supersededBy: string | null;
}
export interface NodeResolvedColumns { channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null }

export type UpsertNodeResult =
  | { ok: true; created: boolean }
  | { ok: false; why: 'superseded'; supersededBy: string };
export type RekeyNodeResult =
  | { ok: true; how: 'rekeyed' | 'superseded' | 'no-label-row'; retired: number; revived: boolean }      // CORRECTION: + retired; D-3208: + revived (true only when the nodeId row itself was superseded and this call cleared it)
  | { ok: false; why: 'bad-node-id' };
export type MarkUnreachableResult =
  | { ok: true; nodeId: string; created: boolean; since: number }
  | { ok: false; why: 'label-key-taken'; supersededBy: string | null };                   // CORRECTION: added arm
export type ReleaseLeaseResult =
  | { ok: true; state: SettledUpdateState }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'not-busy'; state: UpdateState }
  | { ok: false; why: 'stale-report'; updateStartedAt: number };
export type SettleNodeResult =
  | { ok: true; clearedRequest: boolean }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'halted'; state: 'failed' | 'reverted' }
  | { ok: false; why: 'stale-report'; updateStartedAt: number };
export type ResolveNodeResult =
  | { ok: true; changed: boolean }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string };
export type AckNodeResult =
  | { ok: true; clearedRequest: boolean; clearedRefusals: number }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'busy'; state: BusyUpdateState };

// CoordStore methods — every signature ONE line
upsertNodeMeasurement(m: NodeMeasurement): UpsertNodeResult          // measurement+report columns, role, label; reachable = 1, unreachableSince = NULL
markUnreachable(label: string, role: NodeRole, at: number): MarkUnreachableResult   // reachable = 0, unreachableSince = COALESCE(unreachableSince, at) on the live row(s) carrying the label; else a label-keyed placeholder: measuredAt NULL, stampRead 'unreadable', installState/provenance/os 'unknown', caps '', agentOps '' for role fleet and NULL otherwise (created: true)
rekeyNode(label: string, nodeId: string): RekeyNodeResult            // one tx: re-key the live label-keyed row (and its refusal rows) to nodeId, or mark it supersededBy when a nodeId row exists; then supersede every OTHER live row carrying the label (retired)
releaseLease(nodeId: string, to: SettledUpdateState, detail: string, reportStartedAt: number | null): ReleaseLeaseResult   // WHERE updateState NOT IN settled; request columns untouched; reportStartedAt = the report's latest start instant in ms (startedAt*1000 + 999, R1), null = not report-driven (no precedence)
settleNode(nodeId: string, detail: string, reportStartedAt: number | null): SettleNodeResult   // WHERE updateState NOT IN halted: idle, request columns cleared
resolveNode(nodeId: string, r: NodeResolvedColumns): ResolveNodeResult   // resolved columns only; changed = the three differed (NULL-safe)
ackNode(nodeId: string): AckNodeResult                               // one tx, WHERE updateState IN settled: idle + request cleared + this node's refusals deleted (D-3183)
nodes(): NodeRow[]                                                   // live rows only (supersededBy IS NULL), ORDER BY label, nodeId
node(nodeId: string): NodeRow | null                                 // any row, superseded included; null = no such row
nodeByLabel(label: string): NodeRow | null                           // the live row carrying the label, latest measurement first; null = none
```

- Precedence in the `WHERE` of both report-driven writers: `(? IS NULL OR updateStartedAt IS NULL OR ? >= updateStartedAt)`, where `?` is the caller's `reportStartedAt` — already widened to the second's last ms by the sweep, so the rule as ruled (R1: `startedAt*1000 + 999 >= updateStartedAt`) is the store's comparison with no second copy of the 999 here; the `why` of a zero-change write is read back after the write, never before it. `caps`/`agentOps` are stored as the words joined by one space. Out-of-vocabulary tokens read: `role` → `null`, `stampRead` → `'unreadable'`, `installState`/`provenance`/`os`/`updateState`/`reportedPhase` → `'unknown'`, `channel`/`requestedKind` → `null`.
- Spec §18 rows this task pins: "a stale report never moves the lease"; "a label row re-keys"; "a superseded row is invisible" (the store's four readers); "`ack` clears the node's refusals and its request"; "`unknown` is busy" (the store's half — release and ack); "a refusal does not consume the request" (`releaseLease` leaves the request); "unreachable is written on the sweep it happens" (the store's half); "`stampRead` keeps EACCES from unversioned" (the column keeps `unreadable` beside NULL `current*`); "a full `BuildInfo` round-trips" (all five `current*` columns). The writer-group scan over this SQL is Task 7's.

- [ ] **Step 1: Write the failing test**

Create `server/test/update-store-nodes.test.ts`:

```ts
// Design 2026-09-20 §6/§8/§10, W2 Task 5 — the `nodes` row's writer groups,
// one method family each: measurement + report (`upsertNodeMeasurement`,
// `markUnreachable`), identity (`rekeyNode`), lease (`releaseLease`,
// `settleNode`, `ackNode`), resolved (`resolveNode`). Nothing in W2 acquires
// a lease, so every busy row below is PLANTED by raw SQL — the fixture W4's
// `dispatchNode` will produce for real.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, NODE_ID_RE, type NodeMeasurement, type NodeRow } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const UUID_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const UUID_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const UUID_S = '05050505-0505-4505-8505-050505050505';

const fresh = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('update-store-nodes-'), 'coord.db')));

/** A clean fleet-node measurement; each case overrides what it is about. */
const meas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: 'fleet', role: 'fleet', label: 'fleet',
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null, os: 'linux',
  measuredAt: T0, report: null, ...over,
});

/** The lease W4's dispatcher would acquire, planted. `state` is a raw string
 *  so a token outside `UpdateState` can be planted too. */
const plantLease = (store: CoordStore, nodeId: string, state: string, startedAt: number | null,
  target = 'v0.0.10'): void => {
  store.db.prepare(
    'UPDATE nodes SET updateState = ?, updateTarget = ?, updateStartedAt = ?, updateDetail = ? WHERE nodeId = ?',
  ).run(state, target, startedAt, 'planted', nodeId);
};
/** The request W4's apply route would write, planted. */
const plantRequest = (store: CoordStore, nodeId: string, tag = 'v0.0.10'): void => {
  store.db.prepare("UPDATE nodes SET requestedTag = ?, requestedKind = 'update', requestedAt = ? WHERE nodeId = ?")
    .run(tag, T0, nodeId);
};
const plantResolved = (store: CoordStore, nodeId: string): void => {
  store.db.prepare("UPDATE nodes SET channel = 'stable', desiredTag = 'v0.0.10', resolveDetail = NULL WHERE nodeId = ?")
    .run(nodeId);
};
/** One column exactly as stored — for the NULL-versus-'' distinctions the
 *  row reader is not allowed to hide. */
const raw = (store: CoordStore, nodeId: string, col: string): unknown =>
  (store.db.prepare(`SELECT ${col} AS v FROM nodes WHERE nodeId = ?`).get(nodeId) as { v: unknown }).v;
/** A fresh store holding one measured node with a planted lease. */
const leased = (state: string, startedAt: number | null, nodeId = UUID_A): CoordStore => {
  const s = fresh();
  expect(s.upsertNodeMeasurement(meas({ nodeId })).ok).toBe(true);
  plantLease(s, nodeId, state, startedAt);
  return s;
};

describe('upsertNodeMeasurement — the measurement and report groups only', () => {
  it('creates, then updates, and every measurement and report column round-trips (§18 "a full BuildInfo round-trips")', () => {
    const store = fresh();
    expect(store.upsertNodeMeasurement(meas())).toEqual({ ok: true, created: true });
    const expected: NodeRow = {
      nodeId: 'fleet', role: 'fleet', label: 'fleet',
      currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
      currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
      caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null, os: 'linux',
      measuredAt: T0, reachable: true, unreachableSince: null,
      reportedPhase: null, reportedTarget: null, reportedStartedAt: null, reportedUpdatedAt: null, reportedDetail: null,
      updateState: 'idle', updateTarget: null, updateStartedAt: null, updateDetail: null,
      channel: null, desiredTag: null, resolveDetail: null,
      requestedTag: null, requestedKind: null, requestedAt: null, supersededBy: null,
    };
    expect(store.node('fleet')).toEqual(expected);
    const report = { phase: 'installing', target: 'v0.0.10', startedAt: T0 + 1000, updatedAt: T0 + 2000,
      detail: 'placing the tree' } as const;
    expect(store.upsertNodeMeasurement(meas({ currentDirty: true, previousVersion: 'v0.0.8',
      measuredAt: T0 + 60_000, report }))).toEqual({ ok: true, created: false });
    expect(store.node('fleet')).toEqual({ ...expected, currentDirty: true, previousVersion: 'v0.0.8',
      measuredAt: T0 + 60_000, reportedPhase: 'installing', reportedTarget: 'v0.0.10',
      reportedStartedAt: T0 + 1000, reportedUpdatedAt: T0 + 2000, reportedDetail: 'placing the tree' });
    // A report file that is gone again is five NULLs, not the last one's values.
    store.upsertNodeMeasurement(meas({ measuredAt: T0 + 120_000 }));
    expect(store.node('fleet')).toMatchObject({ reportedPhase: null, reportedTarget: null, reportedStartedAt: null,
      reportedUpdatedAt: null, reportedDetail: null });
  });

  it('an unreadable stamp keeps its read word beside NULL current* columns (§18 "stampRead keeps EACCES from unversioned")', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ stampRead: 'unreadable', currentVersion: null, currentSha: null,
      currentRef: null, currentBuiltAt: null, currentDirty: null, installState: 'unknown', provenance: 'unknown' }));
    expect(store.node('fleet')).toMatchObject({ stampRead: 'unreadable', currentVersion: null, currentSha: null,
      currentRef: null, currentBuiltAt: null, currentDirty: null, installState: 'unknown', measuredAt: T0 });
    expect(raw(store, 'fleet', 'currentDirty')).toBeNull();
  });

  it('keeps agentOps NULL (no agent by construction) apart from \'\' (an agent too old to say); caps [] is stored as \'\'', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null, caps: [] }));
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A, agentOps: [] }));
    store.upsertNodeMeasurement(meas({ nodeId: UUID_B, label: 'other', agentOps: ['update'] }));
    expect(raw(store, UUID_S, 'agentOps')).toBeNull();
    expect(raw(store, UUID_S, 'caps')).toBe('');
    expect(raw(store, UUID_A, 'agentOps')).toBe('');
    expect(raw(store, UUID_A, 'caps')).toBe('verify node-id floor');
    expect(store.node(UUID_S)).toMatchObject({ agentOps: null, caps: [] });
    expect(store.node(UUID_A)!.agentOps).toEqual([]);
    expect(store.node(UUID_B)!.agentOps).toEqual(['update']);
  });

  it('names no lease, resolved, request or identity column — a measurement never moves any of them (§6 writer groups)', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas());
    plantLease(store, 'fleet', 'failed', T0);
    plantRequest(store, 'fleet');
    plantResolved(store, 'fleet');
    const before = store.node('fleet')!;
    store.upsertNodeMeasurement(meas({ measuredAt: T0 + 60_000,
      report: { phase: 'done', target: 'v0.0.10', startedAt: T0, updatedAt: T0 + 1, detail: null } }));
    const after = store.node('fleet')!;
    for (const k of ['updateState', 'updateTarget', 'updateStartedAt', 'updateDetail', 'channel', 'desiredTag',
      'resolveDetail', 'requestedTag', 'requestedKind', 'requestedAt', 'supersededBy'] as const) {
      expect(after[k], k).toEqual(before[k]);
    }
    expect(after.reportedPhase).toBe('done');
  });

  it('a stored token outside each vocabulary reads the named fallback (D-3181)', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas());
    store.db.prepare(
      "UPDATE nodes SET role = 'router', stampRead = 'partial', installState = 'half', provenance = 'maybe', " +
      "os = 'plan9', updateState = 'paused', reportedPhase = 'downloading', channel = 'nightly', " +
      "requestedKind = 'reinstall' WHERE nodeId = 'fleet'",
    ).run();
    expect(store.node('fleet')).toMatchObject({ role: null, stampRead: 'unreadable', installState: 'unknown',
      provenance: 'unknown', os: 'unknown', updateState: 'unknown', reportedPhase: 'unknown', channel: null,
      requestedKind: null });
  });
});

describe('markUnreachable — written on the sweep it happens', () => {
  it('writes reachable = 0 with the FIRST since, and the next measurement clears both (§18 "unreachable is written on the sweep it happens")', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A }));
    expect(store.markUnreachable('fleet', 'fleet', T0 + 100)).toEqual({ ok: true, nodeId: UUID_A, created: false, since: T0 + 100 });
    expect(store.markUnreachable('fleet', 'fleet', T0 + 200)).toEqual({ ok: true, nodeId: UUID_A, created: false, since: T0 + 100 });
    // The measurement columns keep the last measured values: unreachable is not "never seen".
    expect(store.node(UUID_A)).toMatchObject({ reachable: false, unreachableSince: T0 + 100, measuredAt: T0, stampRead: 'ok' });
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A, measuredAt: T0 + 300 }));
    expect(store.node(UUID_A)).toMatchObject({ reachable: true, unreachableSince: null, measuredAt: T0 + 300 });
  });

  it('with no live row for the label, writes a never-measured placeholder keyed by the label — shown, never dropped', () => {
    const store = fresh();
    expect(store.markUnreachable('fleet', 'fleet', T0)).toEqual({ ok: true, nodeId: 'fleet', created: true, since: T0 });
    expect(store.node('fleet')).toMatchObject({ role: 'fleet', label: 'fleet', measuredAt: null, reachable: false,
      unreachableSince: T0, stampRead: 'unreadable', installState: 'unknown', provenance: 'unknown', os: 'unknown',
      caps: [], agentOps: [], updateState: 'idle' });
    expect(store.nodes().map((n) => n.nodeId)).toEqual(['fleet']);
  });

  it('refuses when a superseded row holds the label key and no live row carries the label', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas());                          // the label-keyed row
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A }));
    expect(store.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'superseded', retired: 0 });
    expect(store.rekeyNode('fleet', UUID_B)).toEqual({ ok: true, how: 'no-label-row', retired: 1 });   // UUID_A retired
    expect(store.markUnreachable('fleet', 'fleet', T0 + 5))
      .toEqual({ ok: false, why: 'label-key-taken', supersededBy: UUID_A });
  });
});

describe('rekeyNode — the identity group', () => {
  it('refuses anything but the lowercase uuid _inst_node_id mints', () => {
    const store = fresh();
    for (const bad of ['fleet', '', UUID_A.toUpperCase(), `${UUID_A}\n`, `${UUID_A}\r`, ` ${UUID_A}`]) {
      expect(store.rekeyNode('fleet', bad), JSON.stringify(bad)).toEqual({ ok: false, why: 'bad-node-id' });
    }
    expect(NODE_ID_RE.test(UUID_A)).toBe(true);
  });

  it('re-keys the label row in place, carrying its history and its refusals (§18 "a label row re-keys")', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ installState: 'unknown' }));   // a pre-W1 node: no node-id yet
    plantLease(store, 'fleet', 'failed', T0);
    plantRequest(store, 'fleet');
    expect(store.refuseRelease('fleet', 'v0.0.10', T0 + 1, 'provenance: x')).toEqual({ ok: true, inserted: true });
    expect(store.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'rekeyed', retired: 0 });
    expect(store.node('fleet')).toBeNull();
    expect(store.node(UUID_A)).toMatchObject({ label: 'fleet', measuredAt: T0, updateState: 'failed',
      updateTarget: 'v0.0.10', requestedTag: 'v0.0.10', supersededBy: null });
    expect(store.refusalsFor(UUID_A).map((r) => r.tag)).toEqual(['v0.0.10']);
    expect(store.refusalsFor('fleet')).toEqual([]);
    expect(store.nodes().map((n) => n.nodeId)).toEqual([UUID_A]);   // one node, not two
    // The next sweep's re-key finds no label row and changes nothing.
    expect(store.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'no-label-row', retired: 0 });
  });

  it('with a uuid row already present the label row is superseded, and every reader but node() excludes it (§18 "a superseded row is invisible")', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ measuredAt: T0 }));
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A, measuredAt: T0 + 10 }));
    expect(store.rekeyNode('fleet', UUID_A)).toEqual({ ok: true, how: 'superseded', retired: 0 });
    expect(store.node('fleet')!.supersededBy).toBe(UUID_A);
    expect(store.nodes().map((n) => n.nodeId)).toEqual([UUID_A]);
    expect(store.nodeByLabel('fleet')!.nodeId).toBe(UUID_A);
    const sup = { ok: false, why: 'superseded', supersededBy: UUID_A };
    expect(store.upsertNodeMeasurement(meas())).toEqual(sup);
    expect(store.releaseLease('fleet', 'failed', 'x', null)).toEqual(sup);
    expect(store.settleNode('fleet', 'x', null)).toEqual(sup);
    expect(store.resolveNode('fleet', { channel: 'stable', desiredTag: null, resolveDetail: 'x' })).toEqual(sup);
    expect(store.ackNode('fleet')).toEqual(sup);
  });

  it('a box re-installed under a NEW node-id retires its old identity on the same connection (D-3193)', () => {
    const store = fresh();
    store.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null }));
    store.upsertNodeMeasurement(meas({ nodeId: UUID_A }));
    expect(store.rekeyNode('fleet', UUID_B)).toEqual({ ok: true, how: 'no-label-row', retired: 1 });
    expect(store.node(UUID_A)!.supersededBy).toBe(UUID_B);
    expect(store.upsertNodeMeasurement(meas({ nodeId: UUID_B }))).toEqual({ ok: true, created: true });
    expect(store.nodes().map((n) => n.nodeId)).toEqual([UUID_B, UUID_S]);
    // Both fleet rows carry measuredAt T0, so only the superseded filter keeps
    // the retired identity (the lower id) from answering for the label.
    expect(store.nodeByLabel('fleet')!.nodeId).toBe(UUID_B);
    expect(store.node(UUID_S)!.supersededBy).toBeNull();   // another connection's row is not this label's
  });
});

describe('the lease group — releaseLease, settleNode, ackNode', () => {
  it('releaseLease moves a busy lease to the named settled state and leaves the request standing (§18 "a refusal does not consume the request")', () => {
    const s = leased('applying', T0);
    plantRequest(s, UUID_A);
    expect(s.releaseLease(UUID_A, 'idle', 'disconnected during dispatch', null)).toEqual({ ok: true, state: 'idle' });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', updateDetail: 'disconnected during dispatch',
      updateTarget: 'v0.0.10', updateStartedAt: T0, requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: T0 });
  });

  it('counts pending, applying, unknown AND a token this build cannot name as busy (§18 "unknown is busy")', () => {
    for (const state of ['pending', 'applying', 'unknown', 'paused']) {
      expect(leased(state, T0).releaseLease(UUID_A, 'failed', 'deadline', null), state)
        .toEqual({ ok: true, state: 'failed' });
    }
  });

  it('releaseLease refuses a settled row as not-busy, and an absent one as unknown-node, writing nothing', () => {
    for (const state of ['idle', 'failed', 'reverted'] as const) {
      const s = leased(state, T0);
      expect(s.releaseLease(UUID_A, 'failed', 'x', null), state).toEqual({ ok: false, why: 'not-busy', state });
      expect(s.node(UUID_A)!.updateDetail).toBe('planted');
    }
    expect(fresh().releaseLease(UUID_A, 'failed', 'x', null)).toEqual({ ok: false, why: 'unknown-node' });
  });

  it('a report older than the lease never moves it; NULL on either side is no precedence (§18 "a stale report never moves the lease")', () => {
    const s = leased('applying', T0 + 5000);
    expect(s.releaseLease(UUID_A, 'failed', 'stamp-mismatch', T0 + 4000))
      .toEqual({ ok: false, why: 'stale-report', updateStartedAt: T0 + 5000 });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'applying', updateDetail: 'planted' });
    // The same run's report — started at the lease's own instant — does move it.
    expect(s.releaseLease(UUID_A, 'failed', 'stamp-mismatch', T0 + 5000)).toEqual({ ok: true, state: 'failed' });
    // Not report-driven (a refusal, a drop, the deadline): no precedence at all.
    expect(leased('applying', T0 + 5000).releaseLease(UUID_A, 'failed', 'deadline', null))
      .toEqual({ ok: true, state: 'failed' });
    // A lease with no recorded start cannot be predated.
    expect(leased('applying', null).releaseLease(UUID_A, 'reverted', 'x', T0)).toEqual({ ok: true, state: 'reverted' });
  });

  it('settleNode returns a busy or idle row to idle and clears the request — convergence', () => {
    const s = leased('applying', T0);
    plantRequest(s, UUID_A);
    expect(s.settleNode(UUID_A, 'converged at v0.0.10', T0)).toEqual({ ok: true, clearedRequest: true });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', updateDetail: 'converged at v0.0.10',
      updateTarget: 'v0.0.10', requestedTag: null, requestedKind: null, requestedAt: null });
    expect(s.settleNode(UUID_A, 'converged at v0.0.10', null)).toEqual({ ok: true, clearedRequest: false });
  });

  it('settleNode refuses a halted row — failed and reverted wait for ack — and keeps its request', () => {
    for (const state of ['failed', 'reverted'] as const) {
      const s = leased(state, T0);
      plantRequest(s, UUID_A);
      expect(s.settleNode(UUID_A, 'x', null), state).toEqual({ ok: false, why: 'halted', state });
      expect(s.node(UUID_A)).toMatchObject({ updateState: state, requestedTag: 'v0.0.10' });
    }
    expect(fresh().settleNode(UUID_A, 'x', null)).toEqual({ ok: false, why: 'unknown-node' });
  });

  it('settleNode takes the same precedence as releaseLease', () => {
    const s = leased('applying', T0 + 5000);
    plantRequest(s, UUID_A);
    expect(s.settleNode(UUID_A, 'converged', T0 + 4000))
      .toEqual({ ok: false, why: 'stale-report', updateStartedAt: T0 + 5000 });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'applying', requestedTag: 'v0.0.10' });
  });

  it('ackNode returns a failed row to idle and clears its request and THIS node\'s refusals only (§18 "ack clears the node\'s refusals and its request")', () => {
    const s = leased('failed', T0);
    s.upsertNodeMeasurement(meas({ nodeId: UUID_B, label: 'other' }));
    plantRequest(s, UUID_A);
    s.refuseRelease(UUID_A, 'v0.0.10', T0, 'provenance: x');
    s.refuseRelease(UUID_A, 'v0.0.11', T0, 'provenance: y');
    s.refuseRelease(UUID_B, 'v0.0.10', T0, 'provenance: z');
    expect(s.ackNode(UUID_A)).toEqual({ ok: true, clearedRequest: true, clearedRefusals: 2 });
    expect(s.node(UUID_A)).toMatchObject({ updateState: 'idle', updateTarget: 'v0.0.10', requestedTag: null,
      requestedKind: null, requestedAt: null });
    expect(s.refusalsFor(UUID_A)).toEqual([]);
    expect(s.refusalsFor(UUID_B)).toHaveLength(1);
    expect(s.ackNode(UUID_A)).toEqual({ ok: true, clearedRequest: false, clearedRefusals: 0 });
  });

  it('ackNode refuses a busy row — unknown and an unnamed token included — and writes nothing (D-3183)', () => {
    for (const [stored, read] of [['pending', 'pending'], ['applying', 'applying'], ['unknown', 'unknown'],
      ['paused', 'unknown']] as const) {
      const s = leased(stored, T0);
      plantRequest(s, UUID_A);
      s.refuseRelease(UUID_A, 'v0.0.10', T0, 'provenance: x');
      expect(s.ackNode(UUID_A), stored).toEqual({ ok: false, why: 'busy', state: read });
      expect(raw(s, UUID_A, 'updateState')).toBe(stored);
      expect(s.node(UUID_A)!.requestedTag).toBe('v0.0.10');
      expect(s.refusalsFor(UUID_A)).toHaveLength(1);
    }
    expect(fresh().ackNode(UUID_A)).toEqual({ ok: false, why: 'unknown-node' });
  });
});

describe('resolveNode — the resolved group', () => {
  it('writes the three resolved columns only and says whether they changed; NULL compares equal to NULL', () => {
    const s = leased('failed', T0);
    const r1 = { channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null } as const;
    expect(s.resolveNode(UUID_A, r1)).toEqual({ ok: true, changed: true });
    expect(s.resolveNode(UUID_A, r1)).toEqual({ ok: true, changed: false });
    const r2 = { channel: null, desiredTag: null, resolveDetail: 'the intent row names no channel this build knows' };
    expect(s.resolveNode(UUID_A, r2)).toEqual({ ok: true, changed: true });
    expect(s.resolveNode(UUID_A, r2)).toEqual({ ok: true, changed: false });
    expect(s.node(UUID_A)).toMatchObject({ ...r2, updateState: 'failed', updateDetail: 'planted', measuredAt: T0 });
    expect(fresh().resolveNode(UUID_A, r1)).toEqual({ ok: false, why: 'unknown-node' });
  });
});

describe('the readers', () => {
  it('nodes() is live rows by label then id; node() sees every row; nodeByLabel prefers the latest measurement', () => {
    const s = fresh();
    s.upsertNodeMeasurement(meas({ nodeId: UUID_S, label: 'server', role: 'both', agentOps: null }));
    s.upsertNodeMeasurement(meas({ nodeId: UUID_A, measuredAt: T0 }));
    s.upsertNodeMeasurement(meas({ nodeId: UUID_B, measuredAt: T0 + 10 }));   // two live rows labelled fleet, before any re-key
    expect(s.nodes().map((n) => n.nodeId)).toEqual([UUID_A, UUID_B, UUID_S]);
    expect(s.nodeByLabel('fleet')!.nodeId).toBe(UUID_B);
    expect(s.nodeByLabel('nobody')).toBeNull();
    expect(s.node('nobody')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/update-store-nodes.test.ts`
Expected: FAIL — `TypeError: store.upsertNodeMeasurement is not a function` (or `s.upsertNodeMeasurement`, from `leased`) in every case; the `NODE_ID_RE` case fails first on `store.rekeyNode is not a function`.

- [ ] **Step 3: Implement**

In `server/src/coord/store.ts`'s `shared/api.js` import block, after Task 4's line `  isReleaseTag, isUpdateChannel,` add:

```ts
  // design 2026-09-20 §6/§8/§10 (W2): the node inventory's vocabularies and the lease's two lists.
  BUSY_UPDATE_STATES, isInstallState, isNodeOs, isNodeRole, isProvenanceState, isRequestKind, isStampRead,
  isUpdatePhase, isUpdateState, SETTLED_UPDATE_STATES, validCapWords,
```

and after Task 4's `  type UpdateChannel,` add:

```ts
  type BusyUpdateState, type InstallState, type NodeOs, type NodeRole, type ProvenanceState, type RequestKind,
  type SettledUpdateState, type StampRead, type UpdatePhase, type UpdateState,
```

After `const TERMINAL_RUN_STATES_SQL = …;` (`:489`) add:

```ts

/** Design 2026-09-20 §6/§10 (W2): the node lease's predicates, built from L0's
 *  `SETTLED_UPDATE_STATES` by the `.join` `TERMINAL_DELIVERY_SQL` uses — never
 *  a hand-typed tuple. There is deliberately NO busy fragment: busy is spelled
 *  `NOT IN` this one, the `INACTIVE_RUN_STATES_SQL` stance above (D-2803). A
 *  stored `updateState` this build cannot name reads `unknown` on the read
 *  side, and `unknown` is busy, so the write side counts it busy too — an
 *  `IN (busy)` fragment would call that row settled for an `ack` and not-busy
 *  for a release, the one direction that is not safe. */
const SETTLED_UPDATE_SQL = `('${SETTLED_UPDATE_STATES.join("','")}')`;

/** The settled states that HALT dispatch until `ack` (design §10): every
 *  settled state but `idle`. `settleNode` refuses a row in one of them, so
 *  convergence can never silently clear a failure the operator has not seen. */
const HALTED_UPDATE_STATES = SETTLED_UPDATE_STATES.filter(
  (s): s is Exclude<SettledUpdateState, 'idle'> => s !== 'idle');
const HALTED_UPDATE_SQL = `('${HALTED_UPDATE_STATES.join("','")}')`;

/** The shape of a node id: the lowercase uuid `_inst_node_id` mints
 *  (`ccd/ccrc:9494-9513`) and nothing else, so an uppercase, padded or
 *  CR-terminated `~/.ccrc/node-id` never becomes a row key. Declared ONCE,
 *  here, beside the one writer that re-keys by it; the inventory's validator
 *  (`update/inventory.ts`, Task 11) imports it. */
export const NODE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `ackNode`'s `updateDetail`: the row went back to idle because a person
 *  said so, not because anything converged. */
const ACK_DETAIL = 'acknowledged by the operator';

/** The columns every `nodes` read names — explicitly, never `SELECT *` (this
 *  file's rule, stated above `CoordStore`). */
const NODE_COLUMNS =
  'nodeId, role, label, currentVersion, currentSha, currentRef, currentBuiltAt, currentDirty, stampRead, ' +
  'installState, provenance, caps, agentOps, highestVersion, previousVersion, os, measuredAt, reachable, ' +
  'unreachableSince, reportedPhase, reportedTarget, reportedStartedAt, reportedUpdatedAt, reportedDetail, ' +
  'updateState, updateTarget, updateStartedAt, updateDetail, channel, desiredTag, resolveDetail, ' +
  'requestedTag, requestedKind, requestedAt, supersededBy';
```

After Task 4's `interface RawReleaseRow { … }` add:

```ts

/** Design 2026-09-20 §8 (W2). A node's `~/.ccrc/update.json`, validated by the
 *  inventory sweep. Times are epoch MS here — the sweep converts the file's
 *  unix seconds (×1000, the second's FIRST ms) at its one validator, so this
 *  store holds ms in every column. */
export interface NodeReport {
  phase: UpdatePhase; target: string | null; startedAt: number | null; updatedAt: number | null; detail: string | null;
}

/** One sweep's measurement of one node: the MEASUREMENT and REPORT column
 *  groups (§6) and nothing else — which is what makes `upsertNodeMeasurement`
 *  the writer that can never move a lease, a resolution, a request or an
 *  identity. `nodeId` is a measured node-id (`NODE_ID_RE`), or the connection
 *  label when none was measured (a pre-W1 node, keyed by label, §8). */
export interface NodeMeasurement {
  nodeId: string;
  role: NodeRole; label: string;
  currentVersion: string | null; currentSha: string | null; currentRef: string | null;
  currentBuiltAt: string | null; currentDirty: boolean | null;
  stampRead: StampRead; installState: InstallState; provenance: ProvenanceState;
  /** Validated words (`validCapWords`); `[]` is stored as `''`. */
  caps: readonly string[];
  /** `null` = no agent by construction (the server's own row, decision 11);
   *  `[]` = an agent too old to say. Stored NULL and `''` — never folded. */
  agentOps: readonly string[] | null;
  highestVersion: string | null; previousVersion: string | null; os: NodeOs;
  measuredAt: number;
  /** `null` = no `update.json` on the node. */
  report: NodeReport | null;
}

/** One `nodes` row on the way OUT. Every enum column reads through its L0 guard
 *  to the fallback §6 names (D-3181): `role`, `channel`,
 *  `requestedKind` → `null`; `stampRead` → `unreadable`; `installState`,
 *  `provenance`, `os`, `updateState` and a non-NULL `reportedPhase` →
 *  `unknown`. `measuredAt: null` = never measured; `reportedPhase: null` = no
 *  report file, distinct from `unknown` = a phase this build cannot name. */
export interface NodeRow {
  nodeId: string; role: NodeRole | null; label: string;
  currentVersion: string | null; currentSha: string | null; currentRef: string | null;
  currentBuiltAt: string | null; currentDirty: boolean | null;
  stampRead: StampRead; installState: InstallState; provenance: ProvenanceState;
  caps: string[]; agentOps: string[] | null; highestVersion: string | null; previousVersion: string | null; os: NodeOs;
  measuredAt: number | null; reachable: boolean; unreachableSince: number | null;
  reportedPhase: UpdatePhase | null; reportedTarget: string | null; reportedStartedAt: number | null;
  reportedUpdatedAt: number | null; reportedDetail: string | null;
  updateState: UpdateState; updateTarget: string | null; updateStartedAt: number | null; updateDetail: string | null;
  channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null;
  requestedTag: string | null; requestedKind: RequestKind | null; requestedAt: number | null;
  supersededBy: string | null;
}

/** The resolved group (§6) — the resolver's answer for one node, and
 *  `Resolution`'s first three fields structurally (Task 12). */
export interface NodeResolvedColumns { channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null }

export type UpsertNodeResult =
  | { ok: true; created: boolean }
  | { ok: false; why: 'superseded'; supersededBy: string };

/** `how` says what happened to the LABEL-keyed row; `retired` counts OTHER live
 *  rows carrying the same label under a different node id, now superseded by
 *  this one — a box uninstalled and re-installed mints a new id, and its old
 *  identity must not stay live beside the new one for ever
 *  (D-3193). */
export type RekeyNodeResult =
  | { ok: true; how: 'rekeyed' | 'superseded' | 'no-label-row'; retired: number }
  | { ok: false; why: 'bad-node-id' };

/** `label-key-taken` = no live row carries the label AND the label-keyed
 *  placeholder cannot be written, because a row already holds that key —
 *  superseded (`supersededBy` names its heir) or, `null`, live under another
 *  label. Never folded into success: the caller would report a row that is
 *  not there. */
export type MarkUnreachableResult =
  | { ok: true; nodeId: string; created: boolean; since: number }
  | { ok: false; why: 'label-key-taken'; supersededBy: string | null };

export type ReleaseLeaseResult =
  | { ok: true; state: SettledUpdateState }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'not-busy'; state: UpdateState }
  | { ok: false; why: 'stale-report'; updateStartedAt: number };

export type SettleNodeResult =
  | { ok: true; clearedRequest: boolean }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'halted'; state: 'failed' | 'reverted' }
  | { ok: false; why: 'stale-report'; updateStartedAt: number };

export type ResolveNodeResult =
  | { ok: true; changed: boolean }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string };

export type AckNodeResult =
  | { ok: true; clearedRequest: boolean; clearedRefusals: number }
  | { ok: false; why: 'unknown-node' }
  | { ok: false; why: 'superseded'; supersededBy: string }
  | { ok: false; why: 'busy'; state: BusyUpdateState };

/** The columns `NODE_COLUMNS` names, as SQLite hands them back. */
interface RawNodeRow {
  nodeId: string; role: string; label: string;
  currentVersion: string | null; currentSha: string | null; currentRef: string | null;
  currentBuiltAt: string | null; currentDirty: number | null;
  stampRead: string; installState: string; provenance: string; caps: string; agentOps: string | null;
  highestVersion: string | null; previousVersion: string | null; os: string;
  measuredAt: number | null; reachable: number; unreachableSince: number | null;
  reportedPhase: string | null; reportedTarget: string | null; reportedStartedAt: number | null;
  reportedUpdatedAt: number | null; reportedDetail: string | null;
  updateState: string; updateTarget: string | null; updateStartedAt: number | null; updateDetail: string | null;
  channel: string | null; desiredTag: string | null; resolveDetail: string | null;
  requestedTag: string | null; requestedKind: string | null; requestedAt: number | null;
  supersededBy: string | null;
}

/** A stored word list back to words: `null` stays `null` (agentOps: no agent),
 *  `''` is `[]`, and anything that no longer passes `validCapWords` reads `[]`
 *  — §8's one-bad-word-drops-the-file rule, applied again on the way out. */
function wordsOf(text: string | null): string[] | null {
  if (text === null) return null;
  return validCapWords(text === '' ? [] : text.split(' ')) ?? [];
}

function nodeRowOf(r: RawNodeRow): NodeRow {
  return {
    nodeId: r.nodeId, role: isNodeRole(r.role) ? r.role : null, label: r.label,
    currentVersion: r.currentVersion, currentSha: r.currentSha, currentRef: r.currentRef,
    currentBuiltAt: r.currentBuiltAt, currentDirty: r.currentDirty === null ? null : r.currentDirty === 1,
    stampRead: isStampRead(r.stampRead) ? r.stampRead : 'unreadable',
    installState: isInstallState(r.installState) ? r.installState : 'unknown',
    provenance: isProvenanceState(r.provenance) ? r.provenance : 'unknown',
    caps: wordsOf(r.caps) ?? [], agentOps: wordsOf(r.agentOps),
    highestVersion: r.highestVersion, previousVersion: r.previousVersion,
    os: isNodeOs(r.os) ? r.os : 'unknown',
    measuredAt: r.measuredAt, reachable: r.reachable === 1, unreachableSince: r.unreachableSince,
    reportedPhase: r.reportedPhase === null ? null : (isUpdatePhase(r.reportedPhase) ? r.reportedPhase : 'unknown'),
    reportedTarget: r.reportedTarget, reportedStartedAt: r.reportedStartedAt,
    reportedUpdatedAt: r.reportedUpdatedAt, reportedDetail: r.reportedDetail,
    updateState: isUpdateState(r.updateState) ? r.updateState : 'unknown',
    updateTarget: r.updateTarget, updateStartedAt: r.updateStartedAt, updateDetail: r.updateDetail,
    channel: isUpdateChannel(r.channel) ? r.channel : null, desiredTag: r.desiredTag, resolveDetail: r.resolveDetail,
    requestedTag: r.requestedTag, requestedKind: isRequestKind(r.requestedKind) ? r.requestedKind : null,
    requestedAt: r.requestedAt, supersededBy: r.supersededBy,
  };
}

/** A read-back state that halts (`settleNode`'s refusal arm), or `null`. */
function haltedOf(s: UpdateState): Exclude<SettledUpdateState, 'idle'> | null {
  return (HALTED_UPDATE_STATES as readonly string[]).includes(s) ? (s as Exclude<SettledUpdateState, 'idle'>) : null;
}

/** A read-back state that is busy (`ackNode`'s refusal arm), or `null`. */
function busyOf(s: UpdateState): BusyUpdateState | null {
  return (BUSY_UPDATE_STATES as readonly string[]).includes(s) ? (s as BusyUpdateState) : null;
}
```

At the end of the class, after Task 4's `nodeRowExists` and before the class's closing `}`, add:

```ts

  // ── update inventory (design 2026-09-20 §6, §8, §10; W2) ───────────────
  //
  // The node row's writer groups, one method family each (§6): measurement +
  // report (`upsertNodeMeasurement`, `markUnreachable`), identity
  // (`rekeyNode`), lease (`releaseLease`, `settleNode`, `ackNode`; W4 adds
  // `dispatchNode`), resolved (`resolveNode`), request (`settleNode` and
  // `ackNode` clear it; W4's `requestNode` sets it). Every guard is in the
  // `WHERE`; a zero-change write reads its `why` back AFTER the write; every
  // signature is ONE line, so Task 7's writer-group scan can attribute each
  // statement to its method (`mail-hardening.test.ts`'s `SIG`, the D-2338
  // precedent). Nothing in W2 calls a lease writer on a real row — no W2 code
  // acquires a lease — so the release and settle arms are pinned on planted
  // fixtures for W4's dispatcher to reach.

  /** The measurement and report groups, plus `role` and `label`, and nothing
   *  else. A row whose id was superseded is never written again: the heir is
   *  the node now. `reachable = 1` on every measurement — the sweep measured
   *  it, so it was reachable on this sweep. */
  upsertNodeMeasurement(m: NodeMeasurement): UpsertNodeResult {
    const r = m.report;
    const vals: (string | number | null)[] = [
      m.role, m.label, m.currentVersion, m.currentSha, m.currentRef, m.currentBuiltAt,
      m.currentDirty === null ? null : (m.currentDirty ? 1 : 0), m.stampRead, m.installState, m.provenance,
      m.caps.join(' '), m.agentOps === null ? null : m.agentOps.join(' '), m.highestVersion, m.previousVersion,
      m.os, m.measuredAt,
      r === null ? null : r.phase, r === null ? null : r.target, r === null ? null : r.startedAt,
      r === null ? null : r.updatedAt, r === null ? null : r.detail,
    ];
    return tx(this.db, (): UpsertNodeResult => {
      const ins = this.db.prepare(
        'INSERT INTO nodes (nodeId, role, label, currentVersion, currentSha, currentRef, currentBuiltAt, ' +
        'currentDirty, stampRead, installState, provenance, caps, agentOps, highestVersion, previousVersion, os, ' +
        'measuredAt, reachable, unreachableSince, reportedPhase, reportedTarget, reportedStartedAt, ' +
        'reportedUpdatedAt, reportedDetail) VALUES (' +
        '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, ?, ?) ON CONFLICT(nodeId) DO NOTHING',
      ).run(m.nodeId, ...vals);
      if (Number(ins.changes) > 0) return { ok: true, created: true };
      const upd = this.db.prepare(
        'UPDATE nodes SET role = ?, label = ?, currentVersion = ?, currentSha = ?, currentRef = ?, ' +
        'currentBuiltAt = ?, currentDirty = ?, stampRead = ?, installState = ?, provenance = ?, caps = ?, ' +
        'agentOps = ?, highestVersion = ?, previousVersion = ?, os = ?, measuredAt = ?, reachable = 1, ' +
        'unreachableSince = NULL, reportedPhase = ?, reportedTarget = ?, reportedStartedAt = ?, ' +
        'reportedUpdatedAt = ?, reportedDetail = ? WHERE nodeId = ? AND supersededBy IS NULL',
      ).run(...vals, m.nodeId);
      if (Number(upd.changes) > 0) return { ok: true, created: false };
      // The INSERT conflicted, so the row exists; the UPDATE's only other
      // predicate is `supersededBy IS NULL`, so the row names its heir.
      return { ok: false, why: 'superseded', supersededBy: this.nodeLeaseRow(m.nodeId)!.supersededBy! };
    });
  }

  /** A connection absent on this sweep (§8): `reachable = 0` on the live row(s)
   *  carrying its label, `unreachableSince` the FIRST sweep it was missing on.
   *  With no live row, a never-measured placeholder keyed by the label — shown,
   *  never dropped. The placeholder's `agentOps` is `''` for a fleet row (an
   *  agent connection whose ops are not yet known) and NULL for any other role
   *  (no agent by construction). */
  markUnreachable(label: string, role: NodeRole, at: number): MarkUnreachableResult {
    return tx(this.db, (): MarkUnreachableResult => {
      const upd = this.db.prepare(
        'UPDATE nodes SET reachable = 0, unreachableSince = COALESCE(unreachableSince, ?) ' +
        'WHERE label = ? AND supersededBy IS NULL',
      ).run(at, label);
      if (Number(upd.changes) > 0) {
        const row = this.nodeByLabel(label)!;
        return { ok: true, nodeId: row.nodeId, created: false, since: row.unreachableSince! };
      }
      const ins = this.db.prepare(
        'INSERT INTO nodes (nodeId, role, label, stampRead, installState, provenance, caps, agentOps, os, ' +
        "reachable, unreachableSince) VALUES (?, ?, ?, 'unreadable', 'unknown', 'unknown', '', ?, 'unknown', 0, ?) " +
        'ON CONFLICT(nodeId) DO NOTHING',
      ).run(label, role, label, role === 'fleet' ? '' : null, at);
      if (Number(ins.changes) > 0) return { ok: true, nodeId: label, created: true, since: at };
      return { ok: false, why: 'label-key-taken', supersededBy: this.nodeLeaseRow(label)!.supersededBy };
    });
  }

  /** The identity group (§8). A measured node-id on a connection whose label
   *  keys a row re-keys that row IN PLACE — history, lease, request and its
   *  refusal rows carried — unless a row with that id already exists, when the
   *  label row is superseded by it instead. Then every OTHER live row carrying
   *  the label under a different id is superseded too: the same connection
   *  answering a new id is a re-installed box, and its old identity is retired
   *  (D-3193). One transaction; idempotent. */
  rekeyNode(label: string, nodeId: string): RekeyNodeResult {
    if (!NODE_ID_RE.test(nodeId)) return { ok: false, why: 'bad-node-id' };
    return tx(this.db, (): RekeyNodeResult => {
      let how: 'rekeyed' | 'superseded' | 'no-label-row' = 'no-label-row';
      const sup = this.db.prepare(
        'UPDATE nodes SET supersededBy = ? WHERE nodeId = ? AND supersededBy IS NULL ' +
        'AND EXISTS (SELECT 1 FROM nodes WHERE nodeId = ?)',
      ).run(nodeId, label, nodeId);
      if (Number(sup.changes) > 0) {
        how = 'superseded';
      } else {
        const moved = this.db.prepare('UPDATE nodes SET nodeId = ? WHERE nodeId = ? AND supersededBy IS NULL')
          .run(nodeId, label);
        if (Number(moved.changes) > 0) {
          this.db.prepare('UPDATE node_release_refusals SET nodeId = ? WHERE nodeId = ?').run(nodeId, label);
          how = 'rekeyed';
        }
      }
      const retired = this.db.prepare(
        'UPDATE nodes SET supersededBy = ? WHERE label = ? AND supersededBy IS NULL AND nodeId <> ? AND nodeId <> ?',
      ).run(nodeId, label, nodeId, label);
      return { ok: true, how, retired: Number(retired.changes) };
    });
  }

  /** A refusal, a drop, a deadline, or a `failed`/`reverted`/stamp-mismatch
   *  report (§8, §10): a BUSY lease back to a settled state. The request
   *  columns are untouched — a refusal does not consume the request (decision
   *  7). `reportStartedAt` is the report's own start when the release is
   *  report-driven — the LATEST ms its whole-second stamp covers,
   *  `startedAt*1000 + 999`, which the sweep computes
   *  (D-3199) — and `null` otherwise; a report whose
   *  run began before the lease belongs to a previous run and never moves it. */
  releaseLease(nodeId: string, to: SettledUpdateState, detail: string, reportStartedAt: number | null): ReleaseLeaseResult {
    const res = this.db.prepare(
      'UPDATE nodes SET updateState = ?, updateDetail = ? WHERE nodeId = ? AND supersededBy IS NULL ' +
      `AND updateState NOT IN ${SETTLED_UPDATE_SQL} ` +
      'AND (? IS NULL OR updateStartedAt IS NULL OR ? >= updateStartedAt)',
    ).run(to, detail, nodeId, reportStartedAt, reportStartedAt);
    if (Number(res.changes) > 0) return { ok: true, state: to };
    const row = this.nodeLeaseRow(nodeId);
    if (row === null) return { ok: false, why: 'unknown-node' };
    if (row.supersededBy !== null) return { ok: false, why: 'superseded', supersededBy: row.supersededBy };
    if ((SETTLED_UPDATE_STATES as readonly string[]).includes(row.updateState)) {
      return { ok: false, why: 'not-busy', state: row.updateState };
    }
    // Live and busy, and still refused: the precedence clause is the only
    // predicate left, and it fails only when `updateStartedAt` is set.
    return { ok: false, why: 'stale-report', updateStartedAt: row.updateStartedAt! };
  }

  /** Convergence (§10): the row back to `idle` and its request cleared — the
   *  only path besides `ack` that clears one. Refused on a HALTED row
   *  (`failed`/`reverted` wait for the operator's `ack`); takes the same
   *  precedence as `releaseLease`. */
  settleNode(nodeId: string, detail: string, reportStartedAt: number | null): SettleNodeResult {
    return tx(this.db, (): SettleNodeResult => {
      const had = this.requestedTagOf(nodeId) !== null;
      const res = this.db.prepare(
        "UPDATE nodes SET updateState = 'idle', updateDetail = ?, requestedTag = NULL, requestedKind = NULL, " +
        'requestedAt = NULL WHERE nodeId = ? AND supersededBy IS NULL ' +
        `AND updateState NOT IN ${HALTED_UPDATE_SQL} ` +
        'AND (? IS NULL OR updateStartedAt IS NULL OR ? >= updateStartedAt)',
      ).run(detail, nodeId, reportStartedAt, reportStartedAt);
      if (Number(res.changes) > 0) return { ok: true, clearedRequest: had };
      const row = this.nodeLeaseRow(nodeId);
      if (row === null) return { ok: false, why: 'unknown-node' };
      if (row.supersededBy !== null) return { ok: false, why: 'superseded', supersededBy: row.supersededBy };
      const halted = haltedOf(row.updateState);
      if (halted !== null) return { ok: false, why: 'halted', state: halted };
      return { ok: false, why: 'stale-report', updateStartedAt: row.updateStartedAt! };
    });
  }

  /** The resolved group (§9): the resolver's three columns and nothing else.
   *  `changed` is decided in the `WHERE` (NULL-safe `IS`), so a resolution that
   *  says what the row already says writes nothing. */
  resolveNode(nodeId: string, r: NodeResolvedColumns): ResolveNodeResult {
    const res = this.db.prepare(
      'UPDATE nodes SET channel = ?, desiredTag = ?, resolveDetail = ? WHERE nodeId = ? AND supersededBy IS NULL ' +
      'AND NOT (channel IS ? AND desiredTag IS ? AND resolveDetail IS ?)',
    ).run(r.channel, r.desiredTag, r.resolveDetail, nodeId, r.channel, r.desiredTag, r.resolveDetail);
    if (Number(res.changes) > 0) return { ok: true, changed: true };
    const row = this.nodeLeaseRow(nodeId);
    if (row === null) return { ok: false, why: 'unknown-node' };
    if (row.supersededBy !== null) return { ok: false, why: 'superseded', supersededBy: row.supersededBy };
    return { ok: true, changed: false };
  }

  /** `POST /api/updates/ack` (§12; D-3183): in ONE transaction, a
   *  SETTLED row back to `idle`, its request cleared, and this node's refusals
   *  deleted. A busy row is refused and nothing is written — an ack never
   *  kills a live lease; `unknown` and a token this build cannot name are
   *  busy. `updateTarget` survives, so "last tried v0.0.10" stays readable. */
  ackNode(nodeId: string): AckNodeResult {
    return tx(this.db, (): AckNodeResult => {
      const had = this.requestedTagOf(nodeId) !== null;
      const res = this.db.prepare(
        "UPDATE nodes SET updateState = 'idle', updateDetail = ?, requestedTag = NULL, requestedKind = NULL, " +
        `requestedAt = NULL WHERE nodeId = ? AND supersededBy IS NULL AND updateState IN ${SETTLED_UPDATE_SQL}`,
      ).run(ACK_DETAIL, nodeId);
      if (Number(res.changes) > 0) {
        const cleared = this.db.prepare('DELETE FROM node_release_refusals WHERE nodeId = ?').run(nodeId);
        return { ok: true, clearedRequest: had, clearedRefusals: Number(cleared.changes) };
      }
      const row = this.nodeLeaseRow(nodeId);
      if (row === null) return { ok: false, why: 'unknown-node' };
      if (row.supersededBy !== null) return { ok: false, why: 'superseded', supersededBy: row.supersededBy };
      return { ok: false, why: 'busy', state: busyOf(row.updateState) ?? 'unknown' };
    });
  }

  /** Every LIVE node — the inventory every reader starts from; a superseded row
   *  is invisible here (§8). */
  nodes(): NodeRow[] {
    return (this.db.prepare(`SELECT ${NODE_COLUMNS} FROM nodes WHERE supersededBy IS NULL ORDER BY label, nodeId`)
      .all() as unknown as RawNodeRow[]).map(nodeRowOf);
  }

  /** Any row by id, superseded included — so a caller holding an old id can
   *  learn its heir. `null` = no such row. */
  node(nodeId: string): NodeRow | null {
    const r = this.db.prepare(`SELECT ${NODE_COLUMNS} FROM nodes WHERE nodeId = ?`)
      .get(nodeId) as unknown as RawNodeRow | undefined;
    return r === undefined ? null : nodeRowOf(r);
  }

  /** The live row carrying this connection label, the latest measurement
   *  first (a never-measured placeholder last). `null` = none. */
  nodeByLabel(label: string): NodeRow | null {
    const r = this.db.prepare(
      `SELECT ${NODE_COLUMNS} FROM nodes WHERE label = ? AND supersededBy IS NULL ` +
      'ORDER BY measuredAt IS NULL, measuredAt DESC, nodeId LIMIT 1',
    ).get(label) as unknown as RawNodeRow | undefined;
    return r === undefined ? null : nodeRowOf(r);
  }

  /** The lease-state read a zero-change node write takes its `why` from —
   *  AFTER the write, never before it. `null` = no row with this id. */
  private nodeLeaseRow(nodeId: string): { updateState: UpdateState; updateStartedAt: number | null; supersededBy: string | null } | null {
    const r = this.db.prepare('SELECT updateState, updateStartedAt, supersededBy FROM nodes WHERE nodeId = ?')
      .get(nodeId) as { updateState: string; updateStartedAt: number | null; supersededBy: string | null } | undefined;
    if (r === undefined) return null;
    return { updateState: isUpdateState(r.updateState) ? r.updateState : 'unknown',
             updateStartedAt: r.updateStartedAt, supersededBy: r.supersededBy };
  }

  /** Whether a request was outstanding, for `clearedRequest` — a report,
   *  never a guard; the writes' own `WHERE`s are the guards. */
  private requestedTagOf(nodeId: string): string | null {
    const r = this.db.prepare('SELECT requestedTag FROM nodes WHERE nodeId = ?')
      .get(nodeId) as { requestedTag: string | null } | undefined;
    return r === undefined ? null : r.requestedTag;
  }
```

- [ ] **Step 4: Run the store test green, and the kebab scanner red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-store-nodes.test.ts`
Expected: PASS (23 cases).

Run: `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'`
Expected: FAIL — `no-label-row is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode, SetAccountPoolsRefuseCode or UpdateStoreRefuseCode` (the first of this task's kebab words the scan reaches in `store.ts`, `RekeyNodeResult`'s). Step 5 fixes it.

- [ ] **Step 5: Admit this task's words**

In `shared/api.ts`, Task 4's `UPDATE_STORE_REFUSE_CODES` docstring — in the END-OF-FILE update block, after Task 1's vocabularies (R5), so both replacements below are below every cited line and move none (R13) — replace its last member line

```ts
 *    unknown-node  — no `nodes` row carries this id. */
```

with

```ts
 *    unknown-node  — no `nodes` row carries this id.
 *    bad-node-id   — a node id that is not the lowercase uuid `_inst_node_id`
 *                    mints (`NODE_ID_RE`, store.ts); `rekeyNode` refuses it.
 *    label-key-taken — `markUnreachable` found no live row for the label and
 *                    could not write the label-keyed placeholder: a row
 *                    already holds that key.
 *    not-busy      — `releaseLease` on a settled row: there is no lease.
 *    stale-report  — a report whose run began before the lease (even the
 *                    last ms its whole-second `startedAt` covers,
 *                    `startedAt*1000 + 999`, is before `updateStartedAt`)
 *                    belongs to a previous run and never moves it (design
 *                    §8's precedence). */
```

and its array

```ts
export const UPDATE_STORE_REFUSE_CODES = [
  'bad-tag', 'duplicate-tag', 'bad-row', 'empty-listing', 'unknown-node',
] as const;
```

with

```ts
export const UPDATE_STORE_REFUSE_CODES = [
  'bad-tag', 'duplicate-tag', 'bad-row', 'empty-listing', 'unknown-node',
  'bad-node-id', 'label-key-taken', 'not-busy', 'stale-report',
] as const;
```

In `server/test/mail-routes.test.ts`'s `NOT_CODES`, after Task 4's `'newest-page'` entry, add:

```ts
      'no-label-row',            // design 2026-09-20 §8 (W2 Task 5) — one of
                                  // `RekeyNodeResult`'s three `how` words (store.ts):
                                  // an ANSWER, not a refusal — the sweep's re-key found
                                  // no label-keyed row, which is the ordinary case on
                                  // every sweep after the first. Nothing is declined,
                                  // nothing switches on it over the wire. Its siblings
                                  // `rekeyed` and `superseded` are one word each.
```

- [ ] **Step 6: Run green**

Run, one at a time, foreground (timeout ≥ 600000 ms):
- `cd server && ./node_modules/.bin/vitest run test/update-store-nodes.test.ts` — Expected: PASS.
- `cd server && ./node_modules/.bin/vitest run test/update-store-catalogue.test.ts` — Expected: PASS (Task 4 unchanged by this section).
- `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts` — Expected: PASS.
- `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts` — Expected: PASS (the settled and halted fragments are `.join`-built from L0; no hand-typed tuple of any vocabulary's members).
- `cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts` — Expected: PASS (its writer scan keys on `UPDATE mail_deliveries` only; this section adds none).
- `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — Expected: PASS (a known load flake — re-run in isolation before calling a red real).
- `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts` — Expected: PASS (R13: this task's `shared/api.ts` edit is APPENDED inside the end-of-file update block, after every cited line, so the citation audit's census is unchanged; a known load flake — re-run in isolation before calling a red real).

- [ ] **Step 7: Mutation measurement**

Each edit is made, the named case run and seen red, then REVERSED BY HAND — never `git checkout -- <file>`, which would discard this task's uncommitted work. Run with `cd server && ./node_modules/.bin/vitest run test/update-store-nodes.test.ts`.
1. §18 "a stale report never moves the lease" — in `releaseLease`, delete `'AND (? IS NULL OR updateStartedAt IS NULL OR ? >= updateStartedAt)'` (and the `+` before it) and change `.run(to, detail, nodeId, reportStartedAt, reportStartedAt)` to `.run(to, detail, nodeId)` → RED: "a report older than the lease never moves it …" (`ok: true, state: 'failed'`). Reverse. The same edit in `settleNode` (`.run(detail, nodeId)`) → RED: "settleNode takes the same precedence as releaseLease". Reverse.
2. §18 "a label row re-keys" — in `rekeyNode`, replace `const moved = this.db.prepare('UPDATE nodes SET nodeId = ? WHERE nodeId = ? AND supersededBy IS NULL')\n          .run(nodeId, label);` with `const moved = { changes: 0 };` → RED: "re-keys the label row in place …" (`how: 'no-label-row'`, `node('fleet')` still present). Reverse.
3. §18 "a superseded row is invisible" — in `nodes()`, delete `WHERE supersededBy IS NULL ` → RED: "with a uuid row already present the label row is superseded …" (`nodes()` answers two ids). Reverse. In `nodeByLabel`, delete `AND supersededBy IS NULL ` → RED: "a box re-installed under a NEW node-id retires its old identity …" at `nodeByLabel('fleet')` (the retired `UUID_A` row ties on `measuredAt` and wins on id). Reverse.
4. §18 "`ack` clears the node's refusals and its request" — in `ackNode`, replace `const cleared = this.db.prepare('DELETE FROM node_release_refusals WHERE nodeId = ?').run(nodeId);` with `const cleared = { changes: 0 };` → RED: "ackNode returns a failed row to idle …" (`clearedRefusals: 0`, `refusalsFor(UUID_A)` non-empty). Reverse. Then, in `ackNode`'s SET, change `"UPDATE nodes SET updateState = 'idle', updateDetail = ?, requestedTag = NULL, requestedKind = NULL, " +` to `"UPDATE nodes SET updateState = 'idle', updateDetail = ? " +` and the next line's leading `` `requestedAt = NULL WHERE `` to `` `WHERE `` → RED: the same case (`requestedTag: 'v0.0.10'`). Reverse.
5. §18 "`unknown` is busy" (the store's half) — in `ackNode`, replace `AND updateState IN ${SETTLED_UPDATE_SQL}` with `AND updateState NOT IN ('pending','applying')` → RED: "ackNode refuses a busy row — unknown and an unnamed token included …" at `unknown` (`ok: true`). Reverse. In `releaseLease`, replace `` `AND updateState NOT IN ${SETTLED_UPDATE_SQL} ` `` with `"AND updateState IN ('pending','applying','unknown') "` → RED: "counts pending, applying, unknown AND a token this build cannot name as busy" at `paused`. Reverse.
6. "a refusal does not consume the request" (§18 row of that name, the store half) — in `releaseLease`, change `'UPDATE nodes SET updateState = ?, updateDetail = ? WHERE …'` to `'UPDATE nodes SET updateState = ?, updateDetail = ?, requestedTag = NULL WHERE …'` → RED: "releaseLease moves a busy lease … leaves the request standing". Reverse.
7. §18 "unreachable is written on the sweep it happens" (the store half) — in `markUnreachable`, replace `unreachableSince = COALESCE(unreachableSince, ?)` with `unreachableSince = ?` → RED: "writes reachable = 0 with the FIRST since …" (`since: T0 + 200`). Reverse.
8. D-3193 — replace the `retired` statement's `.run(nodeId, label, nodeId, label)` result with `const retired = { changes: 0 };` (delete the prepare) → RED: "a box re-installed under a NEW node-id retires its old identity …" and "refuses when a superseded row holds the label key …". Reverse.

After the last reversal, re-run Step 6's first three commands: PASS.

- [ ] **Step 8: Commit**

Run first: `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` (a new file is added) — Expected: PASS.

```bash
git add server/src/coord/store.ts shared/api.ts server/test/update-store-nodes.test.ts server/test/mail-routes.test.ts
git commit -m "feat(update): the node row's writer groups — measurement, identity, lease, resolved; guards in the WHERE, a stale report never moves the lease, ack clears request and refusals (W2 Task 5)"
```

### Task 6: Store — intent, epoch and the intent journal

**Files:**
- Create: `server/src/coord/updateintentlog.ts` — `PoolEdgeLog`'s twin (`pooledgelog.ts:38-128`)
- Modify: `server/src/coord/store.ts` — names added to the `'../../../shared/api.js'` import block (`:22-54`, after Task 5's two lines); `import type { UpdateIntentLog }` after the `PoolEdgeLog` import (`:11`); result types after Task 5's `AckNodeResult`; module helpers after `jsonOrNull` (`:792-795`); a `// ── update intent ──` section after Task 5's `// ── update inventory ──` section, before the class's closing `}`
- Modify: `shared/api.ts` — six words APPENDED to Task 4's `UPDATE_STORE_REFUSE_CODES` and its docstring, in the END-OF-FILE update block (after Task 1's block, below every line `session-hook.test.ts`'s citation audit or README cites — ruling R5/R13, D-3188); no new declaration, no line inserted above `:8138` (D-3192; correction — the skeleton did not list this file)
- Test: `server/test/update-store-intent.test.ts` (create)
- Gates run, NOT edited: `server/test/mail-routes.test.ts` (the kebab-token scanner, `:569-778`, admits this task's words through Task 4's ONE `|| isUpdateStoreRefuseCode(tok)` once they are in the array — ruling R5), `server/test/session-hook.test.ts` (ruling R13: this task edits `shared/api.ts`, a cited file), `server/test/single-definition.test.ts` (Task 1's one-holder scan for `FLEET_SCOPE`, ruling R4)

**Interfaces:**
- Consumes: `tx`; `setAccountPools`'s journal sequence (`store.ts:5332-5364`: refuse outside the `tx`; inside it `max(db, journal) + 1`, append FIRST, rows, epoch row LAST); Task 1's `isUpdateChannel`, `isAutoMode`, `isNotifyMode`, `isReleaseTag`, `AutoMode`, `NotifyMode`, `UpdateChannel` and `FLEET_SCOPE` (`shared/api.ts`, ruling R4 — imported, never declared here); Task 4's `UPDATE_STORE_REFUSE_CODES` / `UpdateStoreRefuseCode` / `isUpdateStoreRefuseCode` (ruling R5 — appended to, never a second vocabulary); Task 4's import-block lines `isReleaseTag, isUpdateChannel,` and `type UpdateChannel,`; Task 5's `nodes` table (scope check: `nodeId`, `supersededBy`), Task 5's `NODE_ID_RE` (declared in this same `store.ts` beside `rekeyNode`, ruling R6 — referenced, never imported or re-declared; the scope check's shape clause, D-3194), `NodeMeasurement` and `upsertNodeMeasurement(m): UpsertNodeResult` (the tests), `AckNodeResult` (placement anchor).
- Produces:

```ts
// server/src/coord/updateintentlog.ts
export function defaultUpdateIntentLogPath(ccrcDir: string): string;   // path.join(ccrcDir, 'update-intent.log')
export interface UpdateIntentLogEntry {
  epoch: number; scope: string; channel: UpdateChannel; pinnedTag: string | null; auto: AutoMode; notify: NotifyMode;
  setBy: string; at: number;
}
export class UpdateIntentLog {
  constructor(readonly logPath: string);
  append(entry: UpdateIntentLogEntry): void;   // synchronous, one NDJSON line; throws on a write failure
  maxEpoch(): number | null;                   // null ONLY on ENOENT; unreadable or epoch-less file THROWS
}

// shared/api.ts — ruling R5 (D-3192): NO new vocabulary; six words APPENDED to Task 4's
// one array (after Task 5's four), so Task 4's one `|| isUpdateStoreRefuseCode(tok)` admits them
export const UPDATE_STORE_REFUSE_CODES = [
  /* Task 4's five, Task 5's four, then: */ 'empty-patch', 'bad-field', 'unknown-scope', 'no-channel',
  'journal-unreadable', 'journal-unwritable',
] as const;

// server/src/coord/store.ts — `FLEET_SCOPE` is NOT declared here (ruling R4: `shared/api.ts`, Task 1); imported
export interface UpdateIntentPatch { channel?: UpdateChannel; pinnedTag?: string | null; auto?: AutoMode; notify?: NotifyMode }
export interface UpdateIntentRow {
  scope: string; channel: UpdateChannel | null; pinnedTag: string | null; auto: AutoMode; notify: NotifyMode;
  setAt: number; setBy: string;
}
export type SetIntentResult =
  | { ok: true; row: UpdateIntentRow; epoch: number }
  | { ok: false; why: 'empty-patch' }
  | { ok: false; why: 'bad-field'; field: keyof UpdateIntentPatch }
  | { ok: false; why: 'unknown-scope'; scope: string }
  | { ok: false; why: 'no-channel'; scope: string; base: string }        // CORRECTION — see the note below
  | { ok: false; why: 'journal-unreadable'; detail: string }
  | { ok: false; why: 'journal-unwritable'; detail: string };

// CoordStore methods — every signature ONE line
setIntent(scope: string, patch: UpdateIntentPatch, log: UpdateIntentLog, now: number): SetIntentResult   // setBy = 'pwa'; a new node scope takes its absent fields from the '*' row at write time
intents(): UpdateIntentRow[]                                         // ORDER BY scope
intentFor(scope: string): UpdateIntentRow | null                     // null = no row for that scope
updateEpoch(): { epoch: number; issuedAt: number }
```

- `setIntent` refuses `empty-patch`/`bad-field`/`unknown-scope` (a scope that is neither `'*'` nor a live `nodes` row whose `nodeId` passes `NODE_ID_RE` — a live LABEL-keyed row, a pre-W1 `fleet`, is `unknown-scope` too, D-3194) — and `no-channel` — before the `tx` and before any journal call; a throw from `maxEpoch()`/`append()` inside the `tx` rolls it back and is returned as `journal-unreadable`/`journal-unwritable` with the error's message, never thrown past the method. `update_intent.auto` out of vocabulary reads `'off'`, `notify` reads `'channel'`, `channel` reads `null` (D-3181).
- **Departure, D-3194** (found writing Task 5; applied here): a label-keyed row is a live `nodes` row until its `node-id` is first measured, and then Task 5's `rekeyNode` re-keys the `nodes` row and its refusal rows — never `update_intent`, whose one writer is `setIntent` (Task 7's writer groups). An intent written under the label would be orphaned by that re-key: Task 12's `resolveInputFor` reads `intentFor(node.nodeId)` = the UUID, finds nothing, and the node silently falls back to `'*'` — an operator's pin or channel lost, and a dead `'fleet'` row left in `GET /api/updates`' `intent[]`. So a node scope must be a measured node-id: `unknown-scope` unless `scope === FLEET_SCOPE` or `NODE_ID_RE.test(scope)` AND the row is live. `update_intent` stays single-writer. Cost: an operator cannot give a pre-W1 node its own intent until its first W1 install mints an id; until then it follows `'*'`, which is what it would have fallen back to anyway.
- **Correction, `no-channel`:** the merged row's `channel` column is `NOT NULL` and the journal entry's `channel` is an `UpdateChannel`, but the merge base's `channel` can read `null` (a newer build's token, D-3181) while the patch names none. Writing the fleet default there would be the fail-open §6 forbids, and folding it into `bad-field` would overload one arm with "your value is bad" and "the stored value is unreadable". It is its own arm: `scope` is the scope written, `base` the scope whose row carried the unreadable channel (`scope` itself, or `'*'` for a node's first write). Task 13 maps it to `409 no-channel` (the word `UpdateRouteError` already carries).

- [ ] **Step 1: Write the failing test**

Create `server/test/update-store-intent.test.ts`:

```ts
// Centralised update management W2 (design 2026-09-20 §6 "Journal", §9, §12),
// the intent store: `update_intent` + `update_epoch` and the flat-file journal
// under them. `pool-edges-store.test.ts`'s doctrine, applied to intent: the
// journal is appended INSIDE the transaction, BEFORE the commit, and the next
// epoch is MAX(file, db) + 1 — so an epoch is SKIPPED, NEVER REISSUED. Every
// refusal is a distinct return arm decided before the transaction opens (§18 "a
// refusing write never returns void"), and a journal that cannot be read or
// written is a result arm, never a throw past the method.
import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  FLEET_SCOPE, UPDATE_STORE_REFUSE_CODES, isUpdateStoreRefuseCode, type UpdateStoreRefuseCode,
} from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type SetIntentResult, type UpdateIntentPatch } from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath, type UpdateIntentLogEntry } from '../src/coord/updateintentlog.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_000_000_000_000;
const NODE_A = '01234567-89ab-cdef-0123-456789abcdef';
const NODE_B = 'fedcba98-7654-3210-fedc-ba9876543210';
const SEED = { scope: '*', channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: 0, setBy: 'migration' };

const fresh = () => {
  const d = mkTmp('ccrc-update-intent-');
  return { store: new CoordStore(openCoordDb(path.join(d, 'coord.db'))),
           log: new UpdateIntentLog(path.join(d, 'update-intent.log')), dir: d };
};

/** A live node row, written by the store's own measurement writer (Task 5), so
 *  a node scope is real in the way the intent route will find it. */
const measured = (nodeId: string, label: string): NodeMeasurement => ({
  nodeId, role: 'fleet', label,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main',
  currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  os: 'linux', measuredAt: NOW, report: null,
});
const withNode = (store: CoordStore, nodeId: string, label = 'fleet'): void => {
  expect(store.upsertNodeMeasurement(measured(nodeId, label)).ok).toBe(true);
};
/** Fixture-only raw SQL — a token a newer build wrote, a restored snapshot. */
const raw = (store: CoordStore, sql: string): void => { store.db.prepare(sql).run(); };
const journal = (log: UpdateIntentLog): unknown[] =>
  readFileSync(log.logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as unknown);
const entry = (epoch: number): UpdateIntentLogEntry => ({
  epoch, scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setBy: 'pwa', at: epoch,
});

// `setIntent`'s refusal words live in the ONE update-store vocabulary (ruling
// R5: `UPDATE_STORE_REFUSE_CODES`, Task 4's array, appended to by Tasks 5 and
// 6) — so the check runs ONE way: every arm is declared there. The reverse
// ("every code is emitted by setIntent") is false by design, the array holding
// Tasks 4's and 5's words too. `SET_INTENT_WHYS` is this test's own list of the
// six arms, held equal to the union BOTH ways at compile time, so the runtime
// case below checks every arm and not a subset. Compile-checked by
// `typecheck-tests.test.ts`; asserted below so the lines are read.
type SetIntentWhy = Extract<SetIntentResult, { ok: false }>['why'];
const SET_INTENT_WHYS = ['empty-patch', 'bad-field', 'unknown-scope', 'no-channel',
  'journal-unreadable', 'journal-unwritable'] as const satisfies readonly SetIntentWhy[];
const everyWhyListed: [Exclude<SetIntentWhy, (typeof SET_INTENT_WHYS)[number]>] extends [never] ? true : never = true;
const everyWhyDeclared: [Exclude<SetIntentWhy, UpdateStoreRefuseCode>] extends [never] ? true : never = true;

describe('UpdateIntentLog — the journal on its own', () => {
  it('defaultUpdateIntentLogPath is <ccrcDir>/update-intent.log', () => {
    const ccrcDir = path.join('fixture-home', '.ccrc');
    expect(defaultUpdateIntentLogPath(ccrcDir)).toBe(path.join(ccrcDir, 'update-intent.log'));
  });

  it('a missing file is null — no intent was ever journalled', () => {
    expect(fresh().log.maxEpoch()).toBeNull();
  });

  it('append creates the parent, writes one NDJSON line per entry, and maxEpoch reads the max across every line', () => {
    const log = new UpdateIntentLog(path.join(mkTmp('ccrc-update-intent-'), 'nested', '.ccrc', 'update-intent.log'));
    log.append(entry(1));
    log.append(entry(4));
    log.append(entry(2));
    expect(log.maxEpoch()).toBe(4);
    expect(journal(log)).toEqual([entry(1), entry(4), entry(2)]);
  });

  it('A TORN FINAL LINE STILL COUNTS — a crash mid-append must not resurrect its epoch', () => {
    const { log } = fresh();
    log.append(entry(1));
    appendFileSync(log.logPath, '{"epoch":7,"scope":"*","chan');   // no newline, no close
    expect(log.maxEpoch()).toBe(7);
  });

  it('an UNREADABLE log throws — it must fail the write, never read as empty', () => {
    const dir = mkTmp('ccrc-update-intent-');
    mkdirSync(path.join(dir, 'update-intent.log'));                 // a DIRECTORY at the path: EISDIR
    expect(() => new UpdateIntentLog(path.join(dir, 'update-intent.log')).maxEpoch()).toThrow();
  });

  it('an EXISTING zero-length file THROWS rather than answering null', () => {
    const { log } = fresh();
    writeFileSync(log.logPath, '');
    expect(() => log.maxEpoch()).toThrow(/yields no epoch/);
  });

  it('EXISTING content with no "epoch":<digits> anywhere THROWS, same as zero-length', () => {
    const { log } = fresh();
    writeFileSync(log.logPath, 'not json, no epoch key here\n');
    expect(() => log.maxEpoch()).toThrow(/yields no epoch/);
  });
});

describe('setIntent — accepted writes', () => {
  it('the seed row is the fleet default and the epoch starts at 0', () => {
    const { store } = fresh();
    expect(store.intents()).toEqual([SEED]);
    expect(store.updateEpoch()).toEqual({ epoch: 0, issuedAt: 0 });
  });

  it('a patch changes only the fields it names, stamps setAt/setBy, and bumps the epoch once per write', () => {
    const { store, log } = fresh();
    const want = { scope: '*', channel: 'dev', pinnedTag: null, auto: 'off', notify: 'channel', setAt: NOW, setBy: 'pwa' };
    expect(store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW)).toEqual({ ok: true, epoch: 1, row: want });
    expect(store.intentFor(FLEET_SCOPE)).toEqual(want);
    expect(store.updateEpoch()).toEqual({ epoch: 1, issuedAt: NOW });
    expect(store.setIntent(FLEET_SCOPE, { notify: 'stable' }, log, NOW + 5)).toMatchObject({ ok: true, epoch: 2 });
    expect(store.intentFor(FLEET_SCOPE)).toEqual({ ...want, notify: 'stable', setAt: NOW + 5 });
    expect(store.updateEpoch()).toEqual({ epoch: 2, issuedAt: NOW + 5 });
  });

  it('APPENDS THE JOURNAL — one line per write, carrying the whole resulting row under its epoch', () => {
    const { store, log } = fresh();
    store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW);
    store.setIntent(FLEET_SCOPE, { auto: 'channel' }, log, NOW + 1);
    expect(journal(log)).toEqual([
      { epoch: 1, scope: '*', channel: 'dev', pinnedTag: null, auto: 'off', notify: 'channel', setBy: 'pwa', at: NOW },
      { epoch: 2, scope: '*', channel: 'dev', pinnedTag: null, auto: 'channel', notify: 'channel', setBy: 'pwa', at: NOW + 1 },
    ]);
  });

  it('pinnedTag: a tag pins, an absent field leaves the pin standing, and null clears it', () => {
    const { store, log } = fresh();
    store.setIntent(FLEET_SCOPE, { pinnedTag: 'v0.0.9' }, log, NOW);
    expect(store.intentFor(FLEET_SCOPE)?.pinnedTag).toBe('v0.0.9');
    store.setIntent(FLEET_SCOPE, { auto: 'off' }, log, NOW + 1);
    expect(store.intentFor(FLEET_SCOPE)?.pinnedTag).toBe('v0.0.9');
    store.setIntent(FLEET_SCOPE, { pinnedTag: null }, log, NOW + 2);
    expect(store.intentFor(FLEET_SCOPE)?.pinnedTag).toBeNull();
  });

  it("a node scope's first write takes its absent fields from '*' AS IT STANDS THEN — and does not follow '*' afterwards", () => {
    const { store, log } = fresh();
    withNode(store, NODE_A);
    store.setIntent(FLEET_SCOPE, { channel: 'dev', notify: 'stable', pinnedTag: 'v0.0.9' }, log, NOW);
    expect(store.setIntent(NODE_A, { auto: 'off' }, log, NOW + 1)).toEqual({
      ok: true, epoch: 2,
      row: { scope: NODE_A, channel: 'dev', pinnedTag: 'v0.0.9', auto: 'off', notify: 'stable', setAt: NOW + 1, setBy: 'pwa' },
    });
    store.setIntent(FLEET_SCOPE, { channel: 'stable', pinnedTag: null }, log, NOW + 2);
    expect(store.intentFor(NODE_A)).toMatchObject({ channel: 'dev', pinnedTag: 'v0.0.9' });
    expect(store.intents().map((i) => i.scope)).toEqual(['*', NODE_A]);   // '*' (0x2A) sorts first
  });

  it("an existing node row is patched in place — it does not re-inherit from '*'", () => {
    const { store, log } = fresh();
    withNode(store, NODE_A);
    store.setIntent(NODE_A, { channel: 'dev' }, log, NOW);                // inherits notify 'channel'
    store.setIntent(FLEET_SCOPE, { notify: 'off' }, log, NOW + 1);
    store.setIntent(NODE_A, { auto: 'off' }, log, NOW + 2);
    expect(store.intentFor(NODE_A)).toMatchObject({ channel: 'dev', notify: 'channel', setAt: NOW + 2 });
  });

  it('recovery takes MAX(journal, db): a journal ahead of the db SKIPS its epochs, never reissues them', () => {
    const { store, log } = fresh();
    // A crash between append and commit: the journal is ahead.
    writeFileSync(log.logPath, JSON.stringify(entry(9)) + '\n');
    expect(store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW)).toMatchObject({ ok: true, epoch: 10 });
    expect(store.updateEpoch()).toEqual({ epoch: 10, issuedAt: NOW });
  });

  it('a db ahead of an ABSENT journal moves forward from the db', () => {
    const { store, log } = fresh();
    raw(store, 'UPDATE update_epoch SET epoch = 5, issuedAt = 1 WHERE id = 1');
    expect(existsSync(log.logPath)).toBe(false);
    expect(store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW)).toMatchObject({ ok: true, epoch: 6 });
  });
});

describe('setIntent — every refusal is its own arm, decided before the transaction, and leaves no journal line', () => {
  const untouched = (store: CoordStore, log: UpdateIntentLog): void => {
    expect(existsSync(log.logPath), 'a refused write journalled a line').toBe(false);
    expect(store.updateEpoch()).toEqual({ epoch: 0, issuedAt: 0 });
    expect(store.intents()).toEqual([SEED]);
  };

  it('an empty patch — no field, or every field undefined — is empty-patch', () => {
    const { store, log } = fresh();
    expect(store.setIntent(FLEET_SCOPE, {}, log, NOW)).toEqual({ ok: false, why: 'empty-patch' });
    expect(store.setIntent(FLEET_SCOPE, { channel: undefined, pinnedTag: undefined }, log, NOW))
      .toEqual({ ok: false, why: 'empty-patch' });
    untouched(store, log);
  });

  // The route hands the store parsed JSON; the patch's type is a claim about the
  // caller, not a measurement of it — so each value is checked as `unknown`.
  const BAD: [keyof UpdateIntentPatch, Record<string, unknown>][] = [
    ['channel', { channel: 'nightly' }],
    ['channel', { channel: 'Stable' }],
    ['pinnedTag', { pinnedTag: '0.0.9' }],
    ['pinnedTag', { pinnedTag: 'v0.0.9 ' }],
    ['pinnedTag', { pinnedTag: '' }],
    ['auto', { auto: 'always' }],
    ['auto', { channel: 'dev', auto: 1 }],
    ['notify', { notify: 'loud' }],
  ];
  it.each(BAD)('an out-of-vocabulary %s is bad-field naming it — %j', (field, patch) => {
    const { store, log } = fresh();
    expect(store.setIntent(FLEET_SCOPE, patch as unknown as UpdateIntentPatch, log, NOW))
      .toEqual({ ok: false, why: 'bad-field', field });
    untouched(store, log);
  });

  it("a scope that is neither '*' nor a LIVE node row is unknown-scope — a superseded row included", () => {
    const { store, log } = fresh();
    expect(store.setIntent(NODE_A, { channel: 'dev' }, log, NOW))
      .toEqual({ ok: false, why: 'unknown-scope', scope: NODE_A });
    withNode(store, NODE_B, 'fleet-b');
    raw(store, `UPDATE nodes SET supersededBy = '${NODE_A}' WHERE nodeId = '${NODE_B}'`);
    expect(store.setIntent(NODE_B, { channel: 'dev' }, log, NOW))
      .toEqual({ ok: false, why: 'unknown-scope', scope: NODE_B });
    untouched(store, log);
  });

  // D-3194: `rekeyNode` carries the `nodes` row and its
  // refusals to the UUID, never an `update_intent` row (setIntent is its one
  // writer) — so intent under a label would be orphaned by the re-key and the
  // node would silently fall back to '*'. A node scope must be a measured id.
  it('a LIVE label-keyed row is unknown-scope — a node scope must be a measured node-id, and the re-keyed id is accepted', () => {
    const { store, log } = fresh();
    withNode(store, 'fleet', 'fleet');                                // a pre-W1 node, keyed by its label
    expect(store.db.prepare("SELECT 1 AS one FROM nodes WHERE nodeId = 'fleet' AND supersededBy IS NULL").get(),
      'the fixture must plant a LIVE label-keyed row').toEqual({ one: 1 });
    expect(store.setIntent('fleet', { channel: 'dev' }, log, NOW))
      .toEqual({ ok: false, why: 'unknown-scope', scope: 'fleet' });
    untouched(store, log);
    // The way out: the first measured node-id re-keys the row, and that id is a scope.
    expect(store.rekeyNode('fleet', NODE_A)).toEqual({ ok: true, how: 'rekeyed', retired: 0 });
    expect(store.setIntent(NODE_A, { channel: 'dev' }, log, NOW)).toMatchObject({ ok: true, epoch: 1 });
  });

  it("a merge whose channel reads null is no-channel — never the fleet default, which would be fail-open", () => {
    const { store, log } = fresh();
    raw(store, "UPDATE update_intent SET channel = 'nightly' WHERE scope = '*'");   // a newer build's token
    expect(store.setIntent(FLEET_SCOPE, { auto: 'off' }, log, NOW))
      .toEqual({ ok: false, why: 'no-channel', scope: '*', base: '*' });
    withNode(store, NODE_A);
    expect(store.setIntent(NODE_A, { notify: 'off' }, log, NOW))
      .toEqual({ ok: false, why: 'no-channel', scope: NODE_A, base: '*' });
    expect(existsSync(log.logPath), 'a refused write journalled a line').toBe(false);
    // Naming a channel is the way out, and it writes a token the vocabulary knows.
    expect(store.setIntent(FLEET_SCOPE, { channel: 'stable' }, log, NOW)).toMatchObject({ ok: true, epoch: 1 });
    expect(store.intentFor(FLEET_SCOPE)?.channel).toBe('stable');
  });

  it("a node row's OWN unreadable channel is no-channel with that row as the base — '*' is never consulted", () => {
    const { store, log } = fresh();
    withNode(store, NODE_A);
    expect(store.setIntent(NODE_A, { channel: 'dev' }, log, NOW)).toMatchObject({ ok: true, epoch: 1 });
    raw(store, `UPDATE update_intent SET channel = 'nightly' WHERE scope = '${NODE_A}'`);
    expect(store.setIntent(NODE_A, { auto: 'off' }, log, NOW + 1))
      .toEqual({ ok: false, why: 'no-channel', scope: NODE_A, base: NODE_A });
    expect(store.updateEpoch().epoch).toBe(1);
  });
});

// A journal fake that WRITES inside the still-open transaction and then fails:
// the probe row must be gone afterwards, which is what proves the transaction
// rolled back rather than merely "nothing had been written yet".
class WritingThenThrowingLog {
  readonly logPath = path.join('never-written', 'update-intent.log');
  constructor(private readonly db: DatabaseSync) {}
  maxEpoch(): number | null { return null; }
  append(): void {
    this.db.prepare(
      "INSERT INTO update_intent (scope, channel, pinnedTag, auto, notify, setAt, setBy) " +
      "VALUES ('rollback-probe', 'stable', NULL, 'off', 'channel', 0, 'migration')",
    ).run();
    throw new Error('disk full');
  }
}

describe('setIntent — a journal that cannot be read or written is a result arm, and the transaction rolls back', () => {
  it('an UNREADABLE journal is journal-unreadable — never read as empty, never thrown past the method', () => {
    const { store, log } = fresh();
    writeFileSync(log.logPath, JSON.stringify(entry(3)) + '\n');
    // 0o200 (write-only), not 0o000 — `pool-edges-store.test.ts`'s measured
    // reason: only `maxEpoch`'s own read can fail here, so a mutated reader that
    // swallows the error is not rescued by `append` failing one line later.
    chmodSync(log.logPath, 0o200);
    const r = store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW);
    if (r.ok || r.why !== 'journal-unreadable') throw new Error(`expected journal-unreadable, got ${JSON.stringify(r)}`);
    expect(r.detail).toMatch(/EACCES/);
    expect(store.updateEpoch()).toEqual({ epoch: 0, issuedAt: 0 });
    expect(store.intentFor(FLEET_SCOPE)?.channel).toBe('stable');
  });

  it('a zero-length journal is journal-unreadable — existing-but-empty is not absent', () => {
    const { store, log } = fresh();
    writeFileSync(log.logPath, '');
    const r = store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW);
    if (r.ok || r.why !== 'journal-unreadable') throw new Error(`expected journal-unreadable, got ${JSON.stringify(r)}`);
    expect(r.detail).toMatch(/yields no epoch/);
    expect(store.updateEpoch().epoch).toBe(0);
  });

  it('an UNWRITABLE journal is journal-unwritable and commits nothing', () => {
    const { store, log } = fresh();
    writeFileSync(log.logPath, JSON.stringify(entry(3)) + '\n');
    chmodSync(log.logPath, 0o400);                                   // readable: maxEpoch answers 3; append is refused
    const r = store.setIntent(FLEET_SCOPE, { channel: 'dev' }, log, NOW);
    if (r.ok || r.why !== 'journal-unwritable') throw new Error(`expected journal-unwritable, got ${JSON.stringify(r)}`);
    expect(r.detail).toMatch(/EACCES/);
    expect(store.updateEpoch()).toEqual({ epoch: 0, issuedAt: 0 });
    expect(store.intents()).toEqual([SEED]);
  });

  it('a throw from append after a write inside the transaction is a result — and the write is rolled back', () => {
    const { store } = fresh();
    expect(store.setIntent(FLEET_SCOPE, { channel: 'dev' }, new WritingThenThrowingLog(store.db), NOW))
      .toEqual({ ok: false, why: 'journal-unwritable', detail: 'disk full' });
    expect(store.intents()).toEqual([SEED]);                          // the probe row is gone
    expect(store.updateEpoch()).toEqual({ epoch: 0, issuedAt: 0 });
  });
});

// `pool-edges-store.test.ts`'s F1 fakes, re-aimed: `setIntent` takes the log as
// a parameter, so a fake whose `append()` reads the SAME db observes the world
// from INSIDE the still-open transaction.
class ObservingLog {
  readonly logPath = path.join('never-written', 'update-intent.log');
  seen: { channel: string; epoch: number; entry: UpdateIntentLogEntry } | null = null;
  constructor(private readonly db: DatabaseSync) {}
  maxEpoch(): number | null { return null; }
  append(e: UpdateIntentLogEntry): void {
    const channel = (this.db.prepare("SELECT channel FROM update_intent WHERE scope = '*'").get() as { channel: string }).channel;
    const epoch = (this.db.prepare('SELECT epoch FROM update_epoch WHERE id = 1').get() as { epoch: number }).epoch;
    this.seen = { channel, epoch, entry: e };
  }
}
// The CONTROL: the same connection DOES see a row written inside the
// transaction — without it, `channel: 'stable'` above could mean "uncommitted
// rows are invisible here" rather than "append ran before the upsert".
class InsertingControlLog {
  readonly logPath = path.join('never-written', 'update-intent.log');
  before: number | null = null;
  after: number | null = null;
  constructor(private readonly db: DatabaseSync) {}
  maxEpoch(): number | null { return null; }
  append(): void {
    const count = (): number => (this.db.prepare('SELECT COUNT(*) AS n FROM update_intent').get() as { n: number }).n;
    this.before = count();
    this.db.prepare(
      "INSERT INTO update_intent (scope, channel, pinnedTag, auto, notify, setAt, setBy) " +
      "VALUES ('control-probe', 'stable', NULL, 'off', 'channel', 0, 'migration')",
    ).run();
    this.after = count();
  }
}

describe('journal-before-commit is OBSERVABLE, not just orderable', () => {
  it('append sees the row and the epoch as they were — before the upsert and before the epoch row', () => {
    const { store } = fresh();
    const observer = new ObservingLog(store.db);
    expect(store.setIntent(FLEET_SCOPE, { channel: 'dev' }, observer, NOW)).toMatchObject({ ok: true, epoch: 1 });
    expect(observer.seen).toEqual({
      channel: 'stable', epoch: 0,
      entry: { epoch: 1, scope: '*', channel: 'dev', pinnedTag: null, auto: 'off', notify: 'channel', setBy: 'pwa', at: NOW },
    });
    expect(store.intentFor(FLEET_SCOPE)?.channel).toBe('dev');
    expect(store.updateEpoch().epoch).toBe(1);
  });

  it('CONTROL: the same connection DOES see a row inserted inside the transaction', () => {
    const { store } = fresh();
    const control = new InsertingControlLog(store.db);
    store.setIntent(FLEET_SCOPE, { channel: 'dev' }, control, NOW);
    expect([control.before, control.after]).toEqual([1, 2]);
  });
});

describe('intent reads', () => {
  it('out-of-vocabulary tokens read through the named fallbacks (D-3181)', () => {
    const { store } = fresh();
    raw(store, "UPDATE update_intent SET channel = 'nightly', auto = 'sometimes', notify = 'loud', pinnedTag = '0.0.9' WHERE scope = '*'");
    // channel → null (never the fleet default); auto → off (nothing unattended);
    // notify → channel (hear of more, never of nothing); a malformed pin is still
    // a pin — the resolver finds it ineligible rather than reading "unpinned".
    const want = { scope: '*', channel: null, pinnedTag: '0.0.9', auto: 'off', notify: 'channel', setAt: 0, setBy: 'migration' };
    expect(store.intentFor(FLEET_SCOPE)).toEqual(want);
    expect(store.intents()).toEqual([want]);
  });

  it('intentFor answers null for a scope with no row — a different answer from a row whose channel reads null', () => {
    const { store } = fresh();
    expect(store.intentFor(NODE_A)).toBeNull();
  });

  it("setIntent's refusal words are declared, once each, in the ONE update-store vocabulary (ruling R5)", () => {
    expect([everyWhyListed, everyWhyDeclared]).toEqual([true, true]);
    for (const c of SET_INTENT_WHYS) expect(isUpdateStoreRefuseCode(c), c).toBe(true);
    // Appended once — a second copy of a word (or a sibling task's word
    // re-appended) is a duplicate the guard alone would never notice.
    expect(new Set(UPDATE_STORE_REFUSE_CODES).size, 'a word is declared twice').toBe(UPDATE_STORE_REFUSE_CODES.length);
    expect(isUpdateStoreRefuseCode('journal-missing')).toBe(false);
    expect(isUpdateStoreRefuseCode(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/update-store-intent.test.ts`
Expected: FAIL — the file cannot load: `Error: Failed to load url ../src/coord/updateintentlog.js (resolved id: …) … Does the file exist?`; no case runs.

- [ ] **Step 3: Create `server/src/coord/updateintentlog.ts`**

```ts
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AutoMode, NotifyMode, UpdateChannel } from '../../../shared/api.js';

/**
 * The flat-file floor under `update_epoch` (design 2026-09-20 §6 "Journal"):
 * `PoolEdgeLog`'s twin (`pooledgelog.ts`), for its reason. Every intent write
 * is appended HERE first and committed to coord.db second, and the next epoch
 * is MAX(file, db) + 1 — so an epoch is SKIPPED, NEVER REISSUED. A fleet node's
 * projection reader compares epochs; an epoch it has already seen must never
 * come back carrying different intent, which is exactly what a coord.db
 * restored from a snapshot would otherwise hand out.
 *
 * WHAT THIS FILE DOES NOT DO, said up front because `pooledgelog.ts` once
 * claimed otherwise about itself: nothing replays these lines into
 * `update_intent`. {@link UpdateIntentLog.maxEpoch} is the only reader, and it
 * extracts the maximum `epoch` NUMBER and nothing else. A lost coord.db comes
 * back with the migration's seed row (`'*'` → `stable`, `auto` off) — the safe
 * direction — and re-establishing a node's own scope is an operator act, read
 * from these lines by hand.
 *
 * `~/.ccrc/update-intent.log` on the SERVER box, beside `coord.db`: local-box
 * housekeeping, never proxied through FleetIO, and not in the agent's
 * exact-basename read set (design 2026-09-20 §8 — `update-intent`, the
 * projection, is; this `.log` is not). NDJSON, one line per epoch. Synchronous
 * on purpose: `CoordStore.setIntent` calls it INSIDE a `tx()`, and
 * `DatabaseSync`'s no-async invariant is the whole correctness argument.
 */
export function defaultUpdateIntentLogPath(ccrcDir: string): string {
  return path.join(ccrcDir, 'update-intent.log');
}

/** One epoch's line: the whole intent row as it stands AFTER the write, so a
 *  line read by hand says what the scope was set to, not only what changed. */
export interface UpdateIntentLogEntry {
  epoch: number; scope: string; channel: UpdateChannel; pinnedTag: string | null; auto: AutoMode; notify: NotifyMode;
  setBy: string; at: number;
}

export class UpdateIntentLog {
  constructor(readonly logPath: string) {}

  /** One entry per call, so the empty-batch hazard `PoolEdgeLog.append`
   *  refuses cannot arise here. Throws on a write failure — `setIntent` turns
   *  that into `journal-unwritable`, and its transaction rolls back. */
  append(entry: UpdateIntentLogEntry): void {
    mkdirSync(path.dirname(this.logPath), { recursive: true });
    appendFileSync(this.logPath, JSON.stringify({
      epoch: entry.epoch, scope: entry.scope, channel: entry.channel, pinnedTag: entry.pinnedTag,
      auto: entry.auto, notify: entry.notify, setBy: entry.setBy, at: entry.at,
    }) + '\n', 'utf8');
  }

  /**
   * The file's half of MAX(file, db). A missing file is `null` — no intent was
   * ever journalled. An UNREADABLE file THROWS, and so does an EXISTING file
   * that yields no epoch (zero-length — the ext4 delayed-allocation crash shape
   * — or content with no `"epoch":<digits>` anywhere): reading either as
   * "nothing issued" is the reissue this file exists to prevent, measured for
   * the pool journal in `pooledgelog.ts`'s own docstring and identical here.
   * ONLY `ENOENT` may answer `null`.
   *
   * NO AUTOMATIC REPAIR: the throw refuses every intent write (`setIntent`
   * answers `journal-unreadable`, the route 503) until an operator acts — by
   * RECONSTRUCTING the journal from `coord.db`'s `update_epoch` row, one line
   * carrying its epoch, rather than deleting the file.
   *
   * Regex-only, as `PoolEdgeLog.maxEpoch` is: it wants the max epoch across
   * every line, full stop, and a torn final append still counts when an
   * `"epoch":<digits>` can be read out of the fragment — over-counting is the
   * safe direction.
   */
  maxEpoch(): number | null {
    let text: string;
    try {
      text = readFileSync(this.logPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    let max: number | null = null;
    for (const line of text.split('\n')) {
      if (line === '') continue;
      const m = /"epoch":(\d+)/.exec(line);
      if (m === null) continue;
      const n = Number(m[1]);
      if (max === null || n > max) max = n;
    }
    if (max === null) {
      throw new Error(
        `update-intent journal exists at ${this.logPath} but yields no epoch — ` +
        'zero-length or unparseable is not the same as absent; answering ' +
        'null here would be the reissue this file exists to prevent',
      );
    }
    return max;
  }
}
```

- [ ] **Step 4: Run the journal cases**

Run: `cd server && ./node_modules/.bin/vitest run test/update-store-intent.test.ts -t 'UpdateIntentLog'`
Expected: the seven `UpdateIntentLog — the journal on its own` cases PASS. (`FLEET_SCOPE` and `UPDATE_STORE_REFUSE_CODES`/`isUpdateStoreRefuseCode` already exist — Tasks 1 and 4; only `store.js`'s intent exports are missing, and nothing in this describe calls them. If this vitest refuses a missing named export at import time, the file stays red until Step 5; carry on.)

- [ ] **Step 5: Implement the intent group in `server/src/coord/store.ts`**

(a) Imports. After `import type { PoolEdgeLog } from './pooledgelog.js';` (`store.ts:11`):

```ts
import type { UpdateIntentLog } from './updateintentlog.js';
```

In the `'../../../shared/api.js'` import block (`store.ts:22-54`; this file is `server/src/coord/`, three levels below the root — ruling R7's spelling), Task 4 already names `isReleaseTag, isUpdateChannel,` and `type UpdateChannel,`, and Task 5 adds its two lines after them. After Task 5's value line `  isUpdatePhase, isUpdateState, SETTLED_UPDATE_STATES, validCapWords,` add:

```ts
  // design 2026-09-20 §6/§9 (W2): the intent row's vocabularies, and the fleet-default scope — declared ONCE in
  // shared/api.ts (ruling R4), imported here and never spelled.
  FLEET_SCOPE, isAutoMode, isNotifyMode,
```

and after Task 5's type line `  type SettledUpdateState, type StampRead, type UpdatePhase, type UpdateState,` add:

```ts
  type AutoMode, type NotifyMode,
```

Nothing else is added to that block: `isReleaseTag`, `isUpdateChannel` and `type UpdateChannel` are Task 4's and are named once. `FLEET_SCOPE` is NOT declared anywhere in `store.ts` — Task 1's `single-definition.test.ts` case "defines every array, pattern and guard exactly once, in shared/api.ts" lists it and reds on a second `const FLEET_SCOPE`.

(b) Result types, directly after Task 5's `AckNodeResult` (before its `interface RawNodeRow`):

```ts
/** A partial intent write. `undefined` = leave the field as it stands;
 *  `pinnedTag: null` = CLEAR the pin — two different requests, never folded. */
export interface UpdateIntentPatch { channel?: UpdateChannel; pinnedTag?: string | null; auto?: AutoMode; notify?: NotifyMode }

/** One `update_intent` row as the READ side sees it (D-3181):
 *  an out-of-vocabulary `channel` reads `null` (spec §6's ClaimState stance —
 *  never the fleet default, which would be fail-open), `auto` reads `'off'`
 *  (nothing unattended), `notify` reads `'channel'` (the operator hears of more,
 *  never of nothing). `pinnedTag` is returned as stored: a malformed pin is
 *  still a pin, and the resolver finds it ineligible rather than reading it as
 *  "unpinned, so newest". */
export interface UpdateIntentRow {
  scope: string; channel: UpdateChannel | null; pinnedTag: string | null; auto: AutoMode; notify: NotifyMode;
  setAt: number; setBy: string;
}

/** `setIntent`'s answer. Every refusal is its own arm, each word a member of
 *  the ONE update-store vocabulary (`UpdateStoreRefuseCode`, `shared/api.ts`,
 *  ruling R5), and every one but the two journal arms is decided before the
 *  transaction opens, so a refused write leaves no journal line.
 *
 *  `setAccountPools`'s C2 warning applies verbatim: the type system will NOT
 *  stop a caller discarding this value — `store.setIntent(…);` unbound compiles
 *  clean — so THE RESULT MUST BE BOUND AND ITS `.ok` DISCRIMINATED before any
 *  effect is drawn from the call. */
export type SetIntentResult =
  | { ok: true; row: UpdateIntentRow; epoch: number }
  | { ok: false; why: 'empty-patch' }
  | { ok: false; why: 'bad-field'; field: keyof UpdateIntentPatch }
  | { ok: false; why: 'unknown-scope'; scope: string }
  | { ok: false; why: 'no-channel'; scope: string; base: string }
  | { ok: false; why: 'journal-unreadable'; detail: string }
  | { ok: false; why: 'journal-unwritable'; detail: string };
```

(c) Module helpers, directly after `jsonOrNull` (`store.ts:792-795`), before the `CoordStore` docstring:

```ts
/** `update_intent`'s read-side fallbacks (D-3181), ONCE: the
 *  row reader and `setIntent`'s merge base both name them. */
const INTENT_AUTO_FALLBACK: AutoMode = 'off';
const INTENT_NOTIFY_FALLBACK: NotifyMode = 'channel';
/** Who `setIntent` records (spec §6 DDL: `'pwa' | 'migration'`). Its one caller
 *  is the PWA's intent route; the migration writes the other word. */
const INTENT_SET_BY = 'pwa';
const INTENT_COLUMNS_SQL = 'scope, channel, pinnedTag, auto, notify, setAt, setBy';

interface IntentRowDb {
  scope: string; channel: string; pinnedTag: string | null; auto: string; notify: string; setAt: number; setBy: string;
}

const intentOfDb = (r: IntentRowDb): UpdateIntentRow => ({
  scope: r.scope,
  channel: isUpdateChannel(r.channel) ? r.channel : null,
  pinnedTag: r.pinnedTag,
  auto: isAutoMode(r.auto) ? r.auto : INTENT_AUTO_FALLBACK,
  notify: isNotifyMode(r.notify) ? r.notify : INTENT_NOTIFY_FALLBACK,
  setAt: r.setAt,
  setBy: r.setBy,
});

/** The first named patch field whose value is outside its vocabulary, in a
 *  fixed order, or null. Reads the values as `unknown`: the route hands over
 *  parsed JSON, and `UpdateIntentPatch` is a claim about the caller, not a
 *  measurement of it. `pinnedTag: null` is a valid value (clear the pin). */
const badIntentField = (patch: UpdateIntentPatch): keyof UpdateIntentPatch | null => {
  const p: { [K in keyof UpdateIntentPatch]?: unknown } = patch;
  if (p.channel !== undefined && !isUpdateChannel(p.channel)) return 'channel';
  if (p.pinnedTag !== undefined && p.pinnedTag !== null && !isReleaseTag(p.pinnedTag)) return 'pinnedTag';
  if (p.auto !== undefined && !isAutoMode(p.auto)) return 'auto';
  if (p.notify !== undefined && !isNotifyMode(p.notify)) return 'notify';
  return null;
};

/** A journal failure inside `setIntent`'s transaction, carried OUT of `tx()` as
 *  a throw — so `tx` rolls the transaction back — and turned into a result arm
 *  at the method's edge. Module-private: nothing but `setIntent` throws or
 *  catches it, and any other error still propagates as itself. */
class IntentJournalFault extends Error {
  constructor(readonly why: 'journal-unreadable' | 'journal-unwritable', cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}
```

(d) Methods, a new section after Task 5's `// ── update inventory (design 2026-09-20 §6, §8, §10; W2) ──` section (after its last method), immediately before the class's closing `}` (`store.ts:5407` at d759c914). Every signature is ONE line (`mail-hardening.test.ts`'s `SIG`, `:310`; Task 7's scan attributes by it):

```ts
  // ── update intent ─────────────────────────────────────────────────────
  //
  // Desired state (design 2026-09-20 §6, §9). `setIntent` copies
  // `setAccountPools`'s journal sequence above: every refusal is decided
  // BEFORE the transaction and before either journal call; inside one `tx`
  // the epoch is MAX(db, journal) + 1, the journal line is appended FIRST,
  // the intent row second and the epoch row LAST — so a crash between append
  // and commit SKIPS an epoch and never reissues one. `update_intent` and
  // `update_epoch` have no other writer (Task 7's writer-group scan).

  /** Writes one scope's intent. The merge base is the scope's own row, else —
   *  a node scope written for the first time — the `'*'` row AS IT STANDS NOW:
   *  spec §9 makes `'*'` the fallback for a node with no row, and copying it at
   *  this moment freezes what the operator saw when they made the node its own
   *  scope. A later `'*'` write does not reach a node that has a row. */
  setIntent(scope: string, patch: UpdateIntentPatch, log: UpdateIntentLog, now: number): SetIntentResult {
    // Refused HERE — before `tx()` opens and before `log.maxEpoch()`/
    // `log.append()` run — so a refused write leaves no journal line and opens
    // no transaction it would only roll back. These reads and the transaction
    // below run in one synchronous call on `DatabaseSync`: nothing interleaves.
    if (patch.channel === undefined && patch.pinnedTag === undefined
        && patch.auto === undefined && patch.notify === undefined) {
      return { ok: false, why: 'empty-patch' };
    }
    const bad = badIntentField(patch);
    if (bad !== null) return { ok: false, why: 'bad-field', field: bad };
    // A node scope is a MEASURED node-id (`NODE_ID_RE`, Task 5's one
    // declaration, above in this file) on a live row. A live label-keyed row is
    // refused: `rekeyNode` never carries an `update_intent` row, so intent under
    // a label would be orphaned when the node-id is first measured
    // (D-3194).
    if (scope !== FLEET_SCOPE && (!NODE_ID_RE.test(scope) || this.db.prepare(
      'SELECT 1 AS one FROM nodes WHERE nodeId = ? AND supersededBy IS NULL',
    ).get(scope) === undefined)) {
      return { ok: false, why: 'unknown-scope', scope };
    }
    const own = this.intentFor(scope);
    const base = own ?? this.intentFor(FLEET_SCOPE);
    const channel = patch.channel ?? base?.channel ?? null;
    if (channel === null) {
      return { ok: false, why: 'no-channel', scope, base: own !== null ? scope : FLEET_SCOPE };
    }
    const row: UpdateIntentRow = {
      scope, channel,
      pinnedTag: patch.pinnedTag !== undefined ? patch.pinnedTag : (base?.pinnedTag ?? null),
      auto: patch.auto ?? base?.auto ?? INTENT_AUTO_FALLBACK,
      notify: patch.notify ?? base?.notify ?? INTENT_NOTIFY_FALLBACK,
      setAt: now,
      setBy: INTENT_SET_BY,
    };
    try {
      return tx(this.db, () => {
        const dbMax = (this.db.prepare('SELECT epoch AS e FROM update_epoch WHERE id = 1')
          .get() as { e: number }).e;
        let fileMax: number | null;
        try { fileMax = log.maxEpoch(); } catch (err) { throw new IntentJournalFault('journal-unreadable', err); }
        const epoch = (fileMax === null ? dbMax : Math.max(dbMax, fileMax)) + 1;
        try {
          log.append({ epoch, scope, channel, pinnedTag: row.pinnedTag, auto: row.auto,
                       notify: row.notify, setBy: row.setBy, at: now });
        } catch (err) { throw new IntentJournalFault('journal-unwritable', err); }
        this.db.prepare(
          'INSERT INTO update_intent (scope, channel, pinnedTag, auto, notify, setAt, setBy) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (scope) DO UPDATE SET channel = excluded.channel, ' +
          'pinnedTag = excluded.pinnedTag, auto = excluded.auto, notify = excluded.notify, ' +
          'setAt = excluded.setAt, setBy = excluded.setBy',
        ).run(scope, channel, row.pinnedTag, row.auto, row.notify, now, row.setBy);
        this.db.prepare('UPDATE update_epoch SET epoch = ?, issuedAt = ? WHERE id = 1').run(epoch, now);
        return { ok: true as const, row, epoch };
      });
    } catch (err) {
      if (!(err instanceof IntentJournalFault)) throw err;
      return err.why === 'journal-unreadable'
        ? { ok: false, why: 'journal-unreadable', detail: err.message }
        : { ok: false, why: 'journal-unwritable', detail: err.message };
    }
  }

  /** Every intent row, `'*'` first (`ORDER BY scope`: `'*'` is 0x2A, below
   *  every character a nodeId starts with). */
  intents(): UpdateIntentRow[] {
    return (this.db.prepare(`SELECT ${INTENT_COLUMNS_SQL} FROM update_intent ORDER BY scope`)
      .all() as unknown as IntentRowDb[]).map(intentOfDb);
  }

  /** One scope's row. `null` = no row for that scope — for a node, "the fleet
   *  default applies" (spec §9) — which is a different answer from a row whose
   *  `channel` reads null. */
  intentFor(scope: string): UpdateIntentRow | null {
    const r = this.db.prepare(`SELECT ${INTENT_COLUMNS_SQL} FROM update_intent WHERE scope = ?`)
      .get(scope) as unknown as IntentRowDb | undefined;
    return r === undefined ? null : intentOfDb(r);
  }

  /** The projection's epoch — the migration seeds the one row, so no reader
   *  handles absence. */
  updateEpoch(): { epoch: number; issuedAt: number } {
    return this.db.prepare('SELECT epoch, issuedAt FROM update_epoch WHERE id = 1')
      .get() as { epoch: number; issuedAt: number };
  }
```

- [ ] **Step 6: Run the store cases, and watch the vocabulary case and the kebab scanner go red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-store-intent.test.ts`
Expected: FAIL — 36 of 37 PASS; the one red is "setIntent's refusal words are declared, once each, in the ONE update-store vocabulary (ruling R5)", at `empty-patch` (`expected false to be true`). The store is complete; its words are not yet declared.

Run: `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'`
Expected: FAIL — `empty-patch is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode, SetAccountPoolsRefuseCode or UpdateStoreRefuseCode` (Task 4's message tail). The scanner (`mail-routes.test.ts:569-778`) reads every `.ts` directly under `server/src/coord` for a single-quoted kebab token and admits only declared vocabularies; `store.ts` now spells six new ones, and `SetIntentResult` — placed after Task 5's types — holds the first. `updateintentlog.ts` spells none (`'update-intent.log'` carries a dot, which the scanner's `'([a-z]+(?:-[a-z]+)+)'` does not match). These two reds are the measurement that both readers see this task's words; Step 7 is their fix, and it touches neither test file.

- [ ] **Step 7: Append the six words to the ONE update-store vocabulary in `shared/api.ts`** (ruling R5, D-3192)

The array and its docstring are Task 4's, in the END-OF-FILE update block (after Task 1's block, which follows `READER_MIN_COLS`, `shared/api.ts:8138` at d759c914). Both edits are in place inside that block — below every line `session-hook.test.ts`'s citation audit and README cite (`:7465-7467`, `:7505`, `:7513`, `:7526`), so no cited line moves (ruling R13, D-3188). No new declaration: this task does NOT create a `SET_INTENT_REFUSE_CODES`, and `mail-routes.test.ts` is NOT edited — Task 4's one `|| isUpdateStoreRefuseCode(tok)` admits a member added later, which is why the scanner carries a guard rather than an allowlist.

In the docstring, replace the closing line of Task 5's last member entry (`stale-report`, whose prose — R1's whole-second `startedAt*1000 + 999` precedence — stays exactly as Task 5 wrote it; only its `*/` moves)

```ts
 *                    §8's precedence). */
```

with

```ts
 *                    §8's precedence).
 *    empty-patch   — `setIntent`'s patch names none of channel/pinnedTag/
 *                    auto/notify.
 *    bad-field     — a named patch field's value is outside its vocabulary
 *                    (`pinnedTag` must be null or pass `isReleaseTag`).
 *    unknown-scope — the intent scope is neither `FLEET_SCOPE` nor a live
 *                    `nodes` row keyed by a measured node-id (`NODE_ID_RE`):
 *                    a label-keyed row is refused, because `rekeyNode` never
 *                    carries an intent row to the UUID.
 *    no-channel    — the merge base's channel reads null (a token this build
 *                    does not know) and the patch names none; the fleet
 *                    default is never substituted — fail-open.
 *    journal-unreadable — `UpdateIntentLog.maxEpoch()` threw; nothing written.
 *    journal-unwritable — `UpdateIntentLog.append()` threw; the transaction
 *                    rolled back. */
```

and Task 5's array

```ts
export const UPDATE_STORE_REFUSE_CODES = [
  'bad-tag', 'duplicate-tag', 'bad-row', 'empty-listing', 'unknown-node',
  'bad-node-id', 'label-key-taken', 'not-busy', 'stale-report',
] as const;
```

with

```ts
export const UPDATE_STORE_REFUSE_CODES = [
  'bad-tag', 'duplicate-tag', 'bad-row', 'empty-listing', 'unknown-node',
  'bad-node-id', 'label-key-taken', 'not-busy', 'stale-report',
  'empty-patch', 'bad-field', 'unknown-scope', 'no-channel', 'journal-unreadable', 'journal-unwritable',
] as const;
```

(The intent route maps each of these to its wire word, `UpdateRouteError` — a second, deliberately separate vocabulary; Task 13.)

- [ ] **Step 8: Run the gates this task can move**

Run, one at a time, foreground (timeout ≥ 600000 ms), from `server/`:
- `./node_modules/.bin/vitest run test/update-store-intent.test.ts` — PASS, 37 cases across the six describes (7 + 8 + 13 + 4 + 2 + 3, the `it.each` counting its 8 rows)
- `./node_modules/.bin/vitest run test/mail-routes.test.ts` — PASS, the whole file (the kebab scanner admits the six words through Task 4's guard; nothing else in the file reads them)
- `./node_modules/.bin/vitest run test/session-hook.test.ts` — PASS (ruling R13: `shared/api.ts` is a cited file, and this task's two edits sit in the end-of-file block below every cited line; a red here means a line landed above one — move it, never re-point the census)
- `./node_modules/.bin/vitest run test/update-store-catalogue.test.ts` and `test/update-store-nodes.test.ts` — PASS (Tasks 4 and 5 unchanged by this section)
- `./node_modules/.bin/vitest run test/pooledgelog.test.ts` and `test/pool-edges-store.test.ts` — PASS (untouched twin)
- `./node_modules/.bin/vitest run test/mail-hardening.test.ts` — PASS (no `mail_deliveries` write added; `setIntent`'s signature is one line)
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — PASS (the coord ring: `updateintentlog.ts` imports neither `./db.js` nor `node:sqlite`; `FLEET_SCOPE` still has one holder, `shared/api.ts` — ruling R4; no bracket tuple of a Task 1 vocabulary is spelled here)
- `./node_modules/.bin/vitest run test/coord-db.test.ts` — PASS
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — PASS (the `SET_INTENT_WHYS`/`everyWhyListed`/`everyWhyDeclared` lines compile only while `SetIntentResult`'s arms equal the list and each is an `UpdateStoreRefuseCode`; a known load flake — re-run in isolation before calling a red real)
- `./node_modules/.bin/vitest run test/topology-clean.test.ts` — PASS (two new files)

- [ ] **Step 9: Mutation measurements** (each edit → run `test/update-store-intent.test.ts` unless named → expect the named case RED → restore → green)

1. Move `setIntent`'s `try { log.append(…) }` block below the `INSERT INTO update_intent` statement → red: "append sees the row and the epoch as they were" (`channel: 'dev'` observed). Spec §6 "Journal".
2. Replace `const epoch = (fileMax === null ? dbMax : Math.max(dbMax, fileMax)) + 1;` with `const epoch = dbMax + 1;` → red: "recovery takes MAX(journal, db)" (epoch 1, not 10). Spec §6 "Journal".
3. In `UpdateIntentLog.maxEpoch`, replace the non-ENOENT `throw err;` with `return null;` → red: "an UNREADABLE journal is journal-unreadable" (the write commits) and "an UNREADABLE log throws". §18 "a refusing write never returns void" (the refusal becomes a silent success).
4. Delete the `empty-patch` `if` block → red: "an empty patch … is empty-patch" (epoch 1 is issued for a write that changed nothing). §18 "a refusing write never returns void".
5. Delete `if (p.pinnedTag !== undefined && p.pinnedTag !== null && !isReleaseTag(p.pinnedTag)) return 'pinnedTag';` → red: the three `pinnedTag` rows of "an out-of-vocabulary %s is bad-field naming it". Decision 2 (the one tag guard).
6. Replace the outer `catch (err) { … }` with `catch (err) { throw err; }` → red: every case in "a journal that cannot be read or written is a result arm" (the method throws). §18 "a refusing write never returns void".
7. Replace `const channel = patch.channel ?? base?.channel ?? null;` with `const channel = patch.channel ?? base?.channel ?? this.intentFor(FLEET_SCOPE)?.channel ?? 'stable';` → red: both `no-channel` cases. §18 "an unknown channel token resolves nothing" — its write-side twin (never fall back to `'*'`, never fail open).
8. Replace `const base = own ?? this.intentFor(FLEET_SCOPE);` with `const base = own;` → red: "a node scope's first write takes its absent fields from '*'" (it answers `no-channel`).
9. In `shared/api.ts`, delete this task's line `  'empty-patch', 'bad-field', 'unknown-scope', 'no-channel', 'journal-unreadable', 'journal-unwritable',` from `UPDATE_STORE_REFUSE_CODES` → `./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'` red on `empty-patch` (the scanner's control: it does read this task's words, and Task 4's guard is what admits them), and `test/update-store-intent.test.ts` red at "setIntent's refusal words are declared, once each …". Reverse; then append `'bad-tag',` to that line (a duplicate of Task 4's word) → red: the same case, `a word is declared twice`. Reverse.
10. Ruling R4 — add `export const FLEET_SCOPE = '*';` to `store.ts` beside `INTENT_SET_BY` (and drop `FLEET_SCOPE, ` from the import) → `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'defines every array, pattern and guard exactly once'` red, `FLEET_SCOPE: expected [ 'server/src/coord/store.ts', 'shared/api.ts' ] …`. Reverse.
11. D-3194 — in `setIntent`'s scope guard, replace `(!NODE_ID_RE.test(scope) || this.db.prepare(` with `(this.db.prepare(` → red: "a LIVE label-keyed row is unknown-scope …" (`setIntent('fleet', …)` answers `ok: true`, epoch 1, and a journal line is written). CONTROL, same mutation: "a scope that is neither '*' nor a LIVE node row is unknown-scope — a superseded row included" stays GREEN (the live-row clause alone still refuses an absent and a superseded UUID), so the red is the shape clause's and no other. Reverse.

Each edit is reversed BY HAND — never `git checkout -- <file>`, which would discard this task's uncommitted work.

- [ ] **Step 10: Commit**

Run first: `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` (two new files are added) — Expected: PASS.

```bash
git add server/src/coord/updateintentlog.ts server/src/coord/store.ts shared/api.ts \
        server/test/update-store-intent.test.ts
git commit -m "feat(update): intent, epoch and the intent journal — setIntent refuses before the tx, journals first, bumps update_epoch last, and returns every journal failure as a result arm (W2 Task 6)"
```

### Task 7: The guards over the new store code

**Files:**
- Create: `server/test/update-writer-groups.test.ts`
- Modify: `server/test/single-definition.test.ts` — an update-ring scan over `server/src/update` with an EMPTY allowlist, beside the coord ring (`describe` at `:738`, `coordFiles` `:741`, floor `:746-750`). CORRECTED against the skeleton's "gains an update-ring half" (coordinator ruling R13): `session-hook.test.ts`'s citation audit cites this file at `:32-37`, `:1274`, `:1303-1304`/`:1304` and `:1319-1320` (census `'server/test/single-definition.test.ts': 8`, `session-hook.test.ts:8304` — a count of references that already FAIL, so a shift can move it either way), so every edit above `:1320` is LINE-NEUTRAL — exactly two single-line replacements, `:767` (the coord ring's `const REACH = …;` becomes a comment line) and `:777` (the blank line after the coord ring's outer `});` becomes the module-scope `const REACH`) — and the update ring is a top-level describe APPENDED after the file's last line (after the describe Task 1 appended after `:3302`). No import line is added or changed: the ring's CONTROL plants its shapes as in-memory text, so it needs neither `writeFileSync` nor `mkTmp`.
- Run, not modified (repo-wide guards this task's edits could red): `server/test/session-hook.test.ts` (the citation audit, `-t 'every line citation is anchored'`), `server/test/typecheck-tests.test.ts`, `server/test/topology-clean.test.ts`. The other guards the brief lists do not read either file this task touches: `mail-routes.test.ts`'s kebab scanner reads `server/src/coord` only; `auth-gate.test.ts`, `box-token-census.test.ts`, `pools-prose.test.ts` and the readiness tests read routes and prose this task does not edit.

**Interfaces:**
- Consumes: `server/src/coord/store.ts`'s source text as Tasks 4–6 leave it — the eleven writers `applyReleaseListing`, `refuseRelease`, `clearRefusals` (Task 4), `upsertNodeMeasurement`, `markUnreachable`, `rekeyNode`, `releaseLease`, `settleNode`, `resolveNode`, `ackNode` (Task 5), `setIntent` (Task 6), each with a ONE-line signature, and Task 6's `INTENT_COLUMNS_SQL` const (Step 5's mutation 6 plants a second const beside it); Task 3's `MIGRATIONS[13]` DDL (the five tables and every column named in `WRITER_GROUPS` below, `nodes.updateState … DEFAULT 'idle'`); `openCoordDb` (`server/src/coord/db.ts:114`); `mkTmp` (`server/test/tmpHelpers.ts:38`); `single-definition.test.ts`'s module-scope `sources` (`:41`), `rel` (`:61`), `ccrcRoot` (`:29`); `mail-hardening.test.ts`'s window + `SIG` walk-back shape (`:310`, `:323-345`), re-implemented locally (a test file does not import another test file's internals). The analyser in Step 1 was run (plain node, type-stripped) against a scratch `store.ts` assembled from d759c914 plus Tasks 4–6's code blocks verbatim: 19 update-table statements, every one of the eleven writers found, zero problems, zero violations; and against the CONTROL fixture: exactly the five violations and two problems the CONTROL cases assert.
- Produces (test-local constants, the contract later waves extend):

```ts
// update-writer-groups.test.ts
const WRITER_GROUPS: readonly { table: 'releases' | 'node_release_refusals' | 'nodes' | 'update_intent' | 'update_epoch';
  group: string; columns: readonly string[]; writers: readonly string[] }[] = [
  { table: 'releases', group: 'catalogue', columns: ['tag', 'version', 'channel', 'publishedAt', 'commitSha', 'tarballUrl',
      'bundleListed', 'notes', 'yanked', 'observedAt'], writers: ['applyReleaseListing'] },
  { table: 'releases', group: 'notification', columns: ['notifiedAt'], writers: ['markReleaseNotified'] },
  { table: 'node_release_refusals', group: 'refusal', columns: ['*'], writers: ['refuseRelease', 'clearRefusals', 'ackNode', 'rekeyNode'] },
  { table: 'nodes', group: 'measurement', columns: ['role', 'label', 'currentVersion', 'currentSha', 'currentRef',
      'currentBuiltAt', 'currentDirty', 'stampRead', 'installState', 'provenance', 'caps', 'agentOps', 'highestVersion',
      'previousVersion', 'os', 'measuredAt', 'reachable', 'unreachableSince'], writers: ['upsertNodeMeasurement', 'markUnreachable'] },
  { table: 'nodes', group: 'report', columns: ['reportedPhase', 'reportedTarget', 'reportedStartedAt', 'reportedUpdatedAt',
      'reportedDetail'], writers: ['upsertNodeMeasurement'] },
  { table: 'nodes', group: 'lease', columns: ['updateState', 'updateTarget', 'updateStartedAt', 'updateDetail'],
      writers: ['dispatchNode', 'releaseLease', 'settleNode', 'ackNode'] },
  { table: 'nodes', group: 'resolved', columns: ['channel', 'desiredTag', 'resolveDetail'], writers: ['resolveNode'] },
  { table: 'nodes', group: 'request', columns: ['requestedTag', 'requestedKind', 'requestedAt'],
      writers: ['requestNode', 'settleNode', 'ackNode'] },
  { table: 'nodes', group: 'identity', columns: ['supersededBy', 'nodeId'], writers: ['rekeyNode'] },
  { table: 'update_intent', group: 'intent', columns: ['*'], writers: ['setIntent'] },
  { table: 'update_epoch', group: 'epoch', columns: ['*'], writers: ['setIntent'] },
];
// the attribution: every this.db.prepare(…) window whose SQL is INSERT INTO / UPDATE / DELETE FROM one of the five
// tables → the method whose single-line SIG precedes it (red "not single-line" when the walk-back crosses `^  }`);
// the assertion: every column the statement names is in a group whose writers include that method.

// ADDED while writing the body (not in the skeleton; additions, nothing above changes):
/** The key a row is created UNDER — excluded from an INSERT's column list only (an INSERT of a node row must name
 *  nodeId; that is the row's creation, not an identity write). A SET of the key is still the identity write it is. */
const ROW_KEYS: Readonly<Record<Table, readonly string[]>> = {
  releases: ['tag'], node_release_refusals: ['nodeId', 'tag'], nodes: ['nodeId'], update_intent: ['scope'], update_epoch: ['id'],
};
/** The W2 writers the scan must FIND writing (the floor): a renamed table reds, and so does rewriting a required
 *  writer's ONLY write into an invisible shape (fix round 1, F15/I-1: narrowed — four shapes, ${…} table
 *  interpolation, prepare(q), a mid-token split, and a plain-literal outside a prepare( window whose verb and table
 *  sit on different lines, escape this scan; for a writer with more than one statement in the scan, rewriting just
 *  one of them still leaves it "found"; a NEW illegitimate write built the same way would not red either). */
const W2_WRITERS = ['applyReleaseListing', 'refuseRelease', 'clearRefusals', 'upsertNodeMeasurement', 'markUnreachable',
  'rekeyNode', 'releaseLease', 'settleNode', 'resolveNode', 'ackNode', 'setIntent'] as const;

// single-definition.test.ts — a top-level describe APPENDED at end of file (R13), reading a module-scope REACH
const UPDATE_RING_FILES: readonly string[] = [];   // Tasks 10–13 append 'catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts'
// while server/src/update is absent: assert UPDATE_RING_FILES is empty AND no server/src file imports './update/' —
// never a skip; once present: every file listed exists, sources(updateDir).length >= UPDATE_RING_FILES.length, and no
// file there imports node:sqlite or a './db.js'/'../coord/db.js' path or matches REACH (/\b(?:coord|store)\.db\s*[.,)]/).
// (Body: the db-path match is widened to any `(./|../)+(coord/)?db.js` spelling, and a bare `import 'node:sqlite'`
//  and a dynamic `import('node:sqlite')` count — the coord ring's `from\s+'node:sqlite'` sees neither.)
```

- Mutations measured: a lease column planted in `upsertNodeMeasurement`'s SQL → red; a catalogue column in a non-`applyReleaseListing` `UPDATE releases` → red; `resolveDetail` written outside `resolveNode` → red; `ackNode`'s signature split across lines → red "not single-line"; a planted `import 'node:sqlite'` → red, in the update ring's in-memory CONTROL and again as a real `server/src/update/planted.ts` (Step 6) (§18 "one writer per column group", "the ring scan covers `update/`").

This task writes guards over code Tasks 4–6 already landed, so its tests are GREEN on first run by design; the red half of TDD here is the mutation table — measured in-suite by a CONTROL describe that runs the same analyser over a planted fixture (a green scan over a real file proves nothing until the analyser is shown to red on each shape), and measured again against the real `store.ts` in Step 5.

- [ ] **Step 1: Write the writer-group scan**

Create `server/test/update-writer-groups.test.ts`:

```ts
// Design 2026-09-20 §6 "Writer groups, as a scan over store.ts's SQL" and §18
// "one writer per column group" — with D-3183,
// D-3180 and D-3186, which each
// lean on this scan.
//
// Every prepared statement in server/src/coord/store.ts that WRITES one of the
// five update tables is sliced from `this.db.prepare(` to the call that runs it
// and attributed to the method it lives in by `mail-hardening.test.ts`'s
// single-line SIG walk-back (re-implemented here — a test file does not import
// another test file's internals). Every column the statement writes must
// belong to a group whose writers include that method.
//
// It scans TEXT, and says what that costs. A column list built at runtime
// (`${COLS.join(', ')}`) is unreadable to it and reds as an unowned column —
// the remedy is to spell the list in the statement, which is also what keeps
// "no SELECT *" true in this file. A write whose literal SQL text sits
// outside any `this.db.prepare(` window (a plain-literal `const`, an `exec`)
// reds as a stray line only when its verb and table sit on ONE line — split
// across lines, it is invisible to TABLE_WRITE_LINE too. A table name reached
// through `${…}` interpolation, a `prepare(q)` built from such a `const`, a
// verb/table token split mid-word across concatenated fragments, or that
// same outside-window plain-literal split across lines are each invisible to
// this scan (fix round 1, F15/I-1; nothing here closes them — a reviewer
// reading the diff does; none of the four defeats "finds every W2 writer
// writing" for a writer with more than one statement in the scan). A
// trailing `// …` comment on a CODE line that names a
// write (`UPDATE nodes …`) also reds as a stray: move that prose onto a
// comment line of its own.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';

const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE_SRC = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');

/** The column groups of spec §6's DDL comments, and the ONE method family that
 *  writes each. W4 adds `dispatchNode`/`requestNode` and W3
 *  `markReleaseNotified` to groups already named here — the contract those
 *  waves extend, not a list they re-derive. `'*'` = every column of the table. */
const WRITER_GROUPS: readonly { table: 'releases' | 'node_release_refusals' | 'nodes' | 'update_intent' | 'update_epoch';
  group: string; columns: readonly string[]; writers: readonly string[] }[] = [
  { table: 'releases', group: 'catalogue', columns: ['tag', 'version', 'channel', 'publishedAt', 'commitSha', 'tarballUrl',
      'bundleListed', 'notes', 'yanked', 'observedAt'], writers: ['applyReleaseListing'] },
  { table: 'releases', group: 'notification', columns: ['notifiedAt'], writers: ['markReleaseNotified'] },
  { table: 'node_release_refusals', group: 'refusal', columns: ['*'], writers: ['refuseRelease', 'clearRefusals', 'ackNode', 'rekeyNode'] },
  { table: 'nodes', group: 'measurement', columns: ['role', 'label', 'currentVersion', 'currentSha', 'currentRef',
      'currentBuiltAt', 'currentDirty', 'stampRead', 'installState', 'provenance', 'caps', 'agentOps', 'highestVersion',
      'previousVersion', 'os', 'measuredAt', 'reachable', 'unreachableSince'], writers: ['upsertNodeMeasurement', 'markUnreachable'] },
  { table: 'nodes', group: 'report', columns: ['reportedPhase', 'reportedTarget', 'reportedStartedAt', 'reportedUpdatedAt',
      'reportedDetail'], writers: ['upsertNodeMeasurement'] },
  { table: 'nodes', group: 'lease', columns: ['updateState', 'updateTarget', 'updateStartedAt', 'updateDetail'],
      writers: ['dispatchNode', 'releaseLease', 'settleNode', 'ackNode'] },
  { table: 'nodes', group: 'resolved', columns: ['channel', 'desiredTag', 'resolveDetail'], writers: ['resolveNode'] },
  { table: 'nodes', group: 'request', columns: ['requestedTag', 'requestedKind', 'requestedAt'],
      writers: ['requestNode', 'settleNode', 'ackNode'] },
  { table: 'nodes', group: 'identity', columns: ['supersededBy', 'nodeId'], writers: ['rekeyNode'] },
  { table: 'update_intent', group: 'intent', columns: ['*'], writers: ['setIntent'] },
  { table: 'update_epoch', group: 'epoch', columns: ['*'], writers: ['setIntent'] },
];
type Table = (typeof WRITER_GROUPS)[number]['table'];
const TABLES: readonly Table[] = ['releases', 'node_release_refusals', 'nodes', 'update_intent', 'update_epoch'];
const isTable = (t: string): t is Table => (TABLES as readonly string[]).includes(t);

/** The key a row is created UNDER. Naming it in an INSERT's column list is the
 *  row's creation, not a write to the identity group — an INSERT of a node row
 *  must name `nodeId` — so it is excluded from INSERT column lists ONLY. A SET
 *  of the key (`UPDATE nodes SET nodeId = ?`, an upsert's `DO UPDATE SET`) is
 *  still the identity write it is. */
const ROW_KEYS: Readonly<Record<Table, readonly string[]>> = {
  releases: ['tag'], node_release_refusals: ['nodeId', 'tag'], nodes: ['nodeId'], update_intent: ['scope'], update_epoch: ['id'],
};

/** The W2 writers the scan must FIND writing — the floor. Without it, every
 *  assertion below is satisfied by an extractor that found nothing. */
const W2_WRITERS = ['applyReleaseListing', 'refuseRelease', 'clearRefusals', 'upsertNodeMeasurement', 'markUnreachable',
  'rekeyNode', 'releaseLease', 'settleNode', 'resolveNode', 'ackNode', 'setIntent'] as const;

// ── the analyser ─────────────────────────────────────────────────────────────

/** Comment LINES blanked, not removed, so a line index still names the real
 *  line — `mail-hardening.test.ts`'s `blankComments`, for its reason. */
const blankComments = (src: string): string[] =>
  src.split('\n').map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l));
/** A single-line method signature at class-member indent. Single-line ON
 *  PURPOSE: a signature split across lines would attribute a statement to the
 *  PREVIOUS method; the `^  }` check below turns that into a named red. */
const SIG = /^ {2}(?:private |public |static |readonly )*([A-Za-z_$][\w$]*)\(.*\)\s*:\s*(.+?)\s*\{\s*$/;
const EXEC = /\.(?:run|get|all|iterate)\(/;
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const WRITE_VERB = String.raw`(INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+[A-Z]+)?|DELETE\s+FROM)\s+([A-Za-z_]\w*)`;
const TABLE_WRITE_LINE = new RegExp(
  String.raw`\b(?:INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+[A-Z]+)?|DELETE\s+FROM)\s+(?:${TABLES.join('|')})\b`);

type Verb = 'INSERT' | 'UPDATE' | 'DELETE';
interface Write { table: Table; verb: Verb; columns: string[] }
interface Stmt extends Write { line: number; method: string }
interface Scan { stmts: Stmt[]; problems: string[] }

/** The SQL a window builds: every string literal's content, in order, a
 *  template's `${…}` read as a placeholder. */
const sqlOf = (code: string): string =>
  [...code.matchAll(LITERAL)]
    .map((m) => m[1] ?? m[2] ?? (m[3] ?? '').replace(/\$\{[^}]*\}/g, '?'))
    .join(' ');

/** Commas at paren depth 0 and outside a quoted SQL literal. */
const splitTopLevel = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0; let quoted = false; let cur = '';
  for (const ch of s) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
};

/** The columns a SET clause assigns (the text after `SET`, up to `WHERE`/
 *  `RETURNING`/the end). An item that is not `<ident> = …` is reported as an
 *  unparsed pseudo-column, which no group owns — a loud red, never a pass. */
const setColumns = (afterSet: string): string[] => {
  const body = /^([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/.exec(afterSet)![1]!;
  return splitTopLevel(body).map((item) => /^\s*([A-Za-z_]\w*)\s*=/.exec(item)?.[1] ?? `<unparsed: ${item.trim()}>`);
};

/** What one statement writes, or null when it writes none of the five tables. */
const writeOf = (sql: string): Write | null => {
  for (const m of sql.matchAll(new RegExp(String.raw`\b${WRITE_VERB}`, 'g'))) {
    const table = m[2]!;
    if (!isTable(table)) continue;                        // `DO UPDATE SET` reads its "table" as SET
    const verbText = m[1]!;
    const after = sql.slice(m.index! + m[0].length);
    if (verbText.startsWith('DELETE')) return { table, verb: 'DELETE', columns: ['*'] };
    if (verbText.includes('REPLACE')) return { table, verb: 'INSERT', columns: ['*'] };   // a REPLACE deletes the row
    if (verbText.startsWith('UPDATE')) {
      const set = /^\s*SET\b/.exec(after);
      return { table, verb: 'UPDATE', columns: set === null ? ['<no SET clause>'] : setColumns(after.slice(set[0].length)) };
    }
    const list = /^\s*\(([^)]*)\)/.exec(after);
    const inserted = list === null ? ['*']
      : list[1]!.split(',').map((c) => c.trim()).filter((c) => !ROW_KEYS[table].includes(c));
    const upsert = /\bDO\s+UPDATE\s+SET\b/.exec(after);
    const updated = upsert === null ? [] : setColumns(after.slice(upsert.index + upsert[0].length));
    return { table, verb: 'INSERT', columns: [...inserted, ...updated] };
  }
  return null;
};

/** Every write to the five tables in `src`, attributed; plus every shape the
 *  attribution cannot vouch for. */
const scan = (src: string): Scan => {
  const rawLines = src.split('\n');
  const lines = blankComments(src);
  const code = lines.join('\n');
  const stmts: Stmt[] = [];
  const problems: string[] = [];
  const covered = new Set<number>();
  for (const m of code.matchAll(/this\.db\.prepare\(/g)) {
    const at = m.index!;
    const line = code.slice(0, at).split('\n').length;
    const e = EXEC.exec(code.slice(at));
    if (e === null) { problems.push(`store.ts:${line}: a prepare( never reaches an execution call`); continue; }
    const text = code.slice(at, at + e.index);
    const endLine = line + (text.match(/\n/g) ?? []).length;
    for (let l = line; l <= endLine; l += 1) covered.add(l);
    const w = writeOf(sqlOf(text));
    if (w === null) continue;
    if (rawLines.slice(line - 1, endLine).join('\n').includes('*/')) {
      problems.push(`store.ts:${line}: the ${w.table} window swallowed a docstring`);
    }
    let sigLine = 0;
    for (let i = line - 1; i > 0; i -= 1) { if (SIG.test(lines[i - 1]!)) { sigLine = i; break; } }
    if (sigLine === 0) { problems.push(`store.ts:${line}: no method signature above this ${w.table} write`); continue; }
    if (/^ {2}\}/m.test(lines.slice(sigLine, line - 1).join('\n'))) {
      problems.push(`store.ts:${line}: the walk-back crossed a method close — the signature of the method writing ${w.table} is not single-line`);
      continue;
    }
    stmts.push({ ...w, line, method: SIG.exec(lines[sigLine - 1]!)![1]! });
  }
  lines.forEach((l, i) => {
    if (TABLE_WRITE_LINE.test(l) && !covered.has(i + 1)) {
      problems.push(`store.ts:${i + 1}: writes an update table outside a this.db.prepare( window — spell the statement inline in the method that owns it`);
    }
  });
  return { stmts, problems };
};

/** Every column `s` writes that no group its method writes owns. */
const violations = (s: Stmt): string[] => {
  const groups = WRITER_GROUPS.filter((g) => g.table === s.table);
  const out: string[] = [];
  if (s.columns.includes('*')) {
    for (const g of groups) {
      if (!g.writers.includes(s.method)) {
        out.push(`${s.method} (store.ts:${s.line}) writes every column of ${s.table} (a ${s.verb} with no column list) — the ${g.group} group's writers are ${g.writers.join(', ')}`);
      }
    }
    return out;
  }
  for (const c of s.columns) {
    const owners = groups.filter((g) => g.columns.includes(c) || g.columns.includes('*'));
    if (owners.length === 0) {
      out.push(`${s.method} (store.ts:${s.line}) writes ${s.table}.${c}, which no writer group owns`);
    } else if (!owners.some((g) => g.writers.includes(s.method))) {
      out.push(`${s.method} (store.ts:${s.line}) writes ${s.table}.${c} — the ${owners.map((g) => g.group).join('/')} group's writers are ${owners.flatMap((g) => g.writers).join(', ')}`);
    }
  }
  return out;
};

const groupColumns = (table: Table, group: string): readonly string[] =>
  WRITER_GROUPS.find((g) => g.table === table && g.group === group)!.columns;

// ── the real store ───────────────────────────────────────────────────────────

describe('update writer groups — one writer per column group (design 2026-09-20 §6, §18)', () => {
  const { stmts, problems } = scan(STORE_SRC);
  const written = (method: string, table: Table): Set<string> =>
    new Set(stmts.filter((s) => s.method === method && s.table === table).flatMap((s) => s.columns));

  it('the groups partition every column of the five tables — a new column needs a group before it gets a writer', () => {
    const db = openCoordDb(path.join(mkTmp('ccrc-writer-groups-'), 'coord.db'));
    for (const t of TABLES) {
      const onDisk = (db.prepare(`PRAGMA table_info(${t})`).all() as unknown as { name: string }[])
        .map((r) => r.name).sort();
      expect(onDisk.length, `${t} is not in the migrated schema`).toBeGreaterThan(0);
      const groups = WRITER_GROUPS.filter((g) => g.table === t);
      if (groups.some((g) => g.columns.includes('*'))) {
        expect(groups, `${t}: a '*' group must be the table's only group`).toHaveLength(1);
        continue;
      }
      const named = groups.flatMap((g) => g.columns);
      expect(new Set(named).size, `${t}: a column sits in two groups`).toBe(named.length);
      expect([...named].sort(), `${t}: the writer groups and MIGRATIONS[13] disagree`).toEqual(onDisk);
    }
    db.close();
  });

  it('finds every W2 writer writing — a renamed table reds this, and so does rewriting a required writer\'s ONLY write into one of the header\'s four invisible shapes (a writer with more than one statement in the scan is unaffected, and a NEW illegitimate write built the same way would not red either — see header)', () => {
    const found = new Set(stmts.map((s) => s.method));
    for (const w of W2_WRITERS) {
      expect(WRITER_GROUPS.some((g) => g.writers.includes(w)), `${w} is in no writer group`).toBe(true);
      expect(found.has(w), `the scan found no statement of ${w} writing an update table`).toBe(true);
    }
  });

  it('store.ts carries no write the scan cannot attribute', () => {
    expect(problems).toEqual([]);
  });

  it('every column a statement writes is owned by a group its method writes', () => {
    expect(stmts.flatMap(violations)).toEqual([]);
  });

  it('upsertNodeMeasurement names no column outside the measurement and report groups (spec §6 Pins, verbatim)', () => {
    const allowed = new Set([...groupColumns('nodes', 'measurement'), ...groupColumns('nodes', 'report')]);
    const mine = stmts.filter((s) => s.method === 'upsertNodeMeasurement');
    expect(mine.length).toBeGreaterThan(0);
    for (const s of mine) {
      expect(s.table, `store.ts:${s.line}`).toBe('nodes');
      expect(s.columns.filter((c) => !allowed.has(c)), `store.ts:${s.line}`).toEqual([]);
    }
  });

  it('the ack path writes all three of its groups; settleNode clears the request; releaseLease never touches it (D-3183, spec §6 Pins)', () => {
    const request = groupColumns('nodes', 'request');
    const ack = written('ackNode', 'nodes');
    expect(ack.has('updateState'), 'ackNode never returns the lease to idle').toBe(true);
    expect(request.filter((c) => !ack.has(c)), 'ackNode leaves a request column standing').toEqual([]);
    expect(stmts.some((s) => s.method === 'ackNode' && s.table === 'node_release_refusals'),
      "ackNode never clears this node's refusals").toBe(true);
    const settle = written('settleNode', 'nodes');
    expect(settle.has('updateState'), 'settleNode never writes the lease').toBe(true);
    expect(request.filter((c) => !settle.has(c)), 'settleNode leaves a request column standing').toEqual([]);
    expect(request.filter((c) => written('releaseLease', 'nodes').has(c)),
      'releaseLease clears the request — a refusal or a drop must leave it standing (decision 7)').toEqual([]);
  });
});

// ── the analyser's CONTROL — each planted shape reds, and a clean one does not ─

// A fixture class in the store's own shape. Each method but `resolveNode` plants
// exactly one mutation-table shape; `resolveNode` is the clean control.
const FIXTURE = `export class CoordStore {
  constructor(readonly db: DatabaseSync) {}

  resolveNode(nodeId: string, r: NodeResolvedColumns): ResolveNodeResult {
    const res = this.db.prepare('UPDATE nodes SET channel = ?, desiredTag = ?, resolveDetail = ? WHERE nodeId = ?')
      .run(r.channel, r.desiredTag, r.resolveDetail, nodeId);
    return { ok: true, changed: Number(res.changes) > 0 };
  }

  upsertNodeMeasurement(m: NodeMeasurement): UpsertNodeResult {
    this.db.prepare(
      'INSERT INTO nodes (nodeId, role, label, stampRead) VALUES (?, ?, ?, ?) ' +
      "ON CONFLICT (nodeId) DO UPDATE SET role = excluded.role, updateState = 'idle'",
    ).run(m.nodeId, m.role, m.label, m.stampRead);
    return { ok: true, created: true };
  }

  refuseRelease(nodeId: string, tag: string, at: number, detail: string): RefuseReleaseResult {
    this.db.prepare('UPDATE releases SET yanked = 0 WHERE tag = ?').run(tag);
    return { ok: true, inserted: true };
  }

  settleNode(nodeId: string, detail: string, reportStartedAt: number | null): SettleNodeResult {
    this.db.prepare('UPDATE nodes SET updateState = ?, requestedTag = NULL, resolveDetail = NULL WHERE nodeId = ?')
      .run('idle', nodeId);
    return { ok: true, clearedRequest: true };
  }

  clearRefusals(nodeId: string): ClearRefusalsResult {
    this.db.prepare('DELETE FROM releases WHERE tag = ?').run(nodeId);
    return { ok: true, cleared: 0 };
  }

  ackNode(
    nodeId: string,
  ): AckNodeResult {
    this.db.prepare('UPDATE nodes SET requestedTag = NULL WHERE nodeId = ?').run(nodeId);
    return { ok: true, clearedRequest: true, clearedRefusals: 0 };
  }

  private stray(): void {
    const sql = 'UPDATE nodes SET desiredTag = NULL';
    this.db.exec(sql);
  }
}
`;

describe('CONTROL: the analyser reports each planted shape (the mutation table, measured in-suite)', () => {
  const { stmts, problems } = scan(FIXTURE);
  const v = stmts.flatMap(violations);

  it('a clean resolveNode statement is attributed and passes — the analyser is not red on everything', () => {
    const mine = stmts.filter((s) => s.method === 'resolveNode');
    expect(mine.map((s) => s.columns)).toEqual([['channel', 'desiredTag', 'resolveDetail']]);
    expect(mine.flatMap(violations)).toEqual([]);
  });

  it('a lease column in upsertNodeMeasurement reds (§18 "one writer per column group")', () => {
    expect(stmts.find((s) => s.method === 'upsertNodeMeasurement')?.columns)
      .toEqual(['role', 'label', 'stampRead', 'role', 'updateState']);            // nodeId excluded: the row's key
    expect(v).toContainEqual(expect.stringMatching(/^upsertNodeMeasurement \(store\.ts:\d+\) writes nodes\.updateState — the lease group's writers are /));
  });

  it('a catalogue column in an UPDATE releases outside applyReleaseListing reds', () => {
    expect(v).toContainEqual(expect.stringMatching(/^refuseRelease \(store\.ts:\d+\) writes releases\.yanked — the catalogue group's writers are applyReleaseListing$/));
  });

  it('resolveDetail written outside resolveNode reds', () => {
    expect(v).toContainEqual(expect.stringMatching(/^settleNode \(store\.ts:\d+\) writes nodes\.resolveDetail — the resolved group's writers are resolveNode$/));
  });

  it('a DELETE FROM releases reds against both release groups (D-3180: a yank is a mark, never a delete)', () => {
    expect(v).toContainEqual(expect.stringMatching(/^clearRefusals .* writes every column of releases \(a DELETE with no column list\) — the catalogue group's/));
    expect(v).toContainEqual(expect.stringMatching(/^clearRefusals .* writes every column of releases \(a DELETE with no column list\) — the notification group's/));
  });

  it('nothing else in the fixture is a violation — exactly the five above', () => {
    expect(v).toHaveLength(5);
  });

  it("a signature split across lines reds as 'not single-line', never as a silent misattribution", () => {
    expect(stmts.some((s) => s.method === 'ackNode')).toBe(false);
    expect(problems).toContainEqual(expect.stringMatching(/crossed a method close — the signature of the method writing nodes is not single-line/));
  });

  it('a write outside any this.db.prepare( window reds as a stray line', () => {
    expect(problems).toContainEqual(expect.stringMatching(/writes an update table outside a this\.db\.prepare\( window/));
    expect(problems).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd server && ./node_modules/.bin/vitest run test/update-writer-groups.test.ts`
Expected: PASS — 14 cases (6 over the real `store.ts`, 8 CONTROL). A red in the first describe on this tree is a FINDING against Tasks 4–6, not against this scan: the scan is spec §6's sentence made executable. Read the message — an unowned column (`<unparsed: …>`, `?`) means a statement's text is not literal SQL (spell its column list inline); a stray line means a write outside a `this.db.prepare(` window or a trailing comment naming one on a code line; a group violation means a writer crossed its group — and fix it in `store.ts`, in a commit of its own naming the task it corrects.

- [ ] **Step 3: Add the update ring to `server/test/single-definition.test.ts` — line-neutral above `:1320`, appended below**

Coordinator ruling R13: `session-hook.test.ts`'s citation audit cites this file by line (`:32-37`, `:1274`, `:1303-1304`, `:1304`, `:1319-1320`; census `'server/test/single-definition.test.ts': 8` at `session-hook.test.ts:8304`), so nothing above `:1320` may gain or lose a line. The skeleton's shape — a nested describe inside the coord ring at `:774`, `REACH` hoisted with eight new lines, two new import lines — would insert ~70 lines above every cited line — measured on a scratch copy of d759c914: 70 lines inserted at `:775` reds "THE CITATION DEBT this task creates is measured, per cited file", and 23 lines there reds "THE `|`-ROW PASS: the exact set a joined row still fails on" (a shift that slides content back under a stale anchor is a coincidental PASS, which that exact list reds too); a 1- or 2-line shift happened to stay green, which is luck, not a licence. Instead: two ONE-FOR-ONE line replacements up there, one describe appended at the end, and no import edit at all.

(a) `REACH`, declared ONCE, at module scope, so both rings read one copy (this file's own rule: a helper written twice here is the second copy it exists to forbid). Two single-line replacements, each one line for one line:

`:767`, inside `it('never reaches around the store for its handle — no `coord.db`/`store.db` receiver', …)` — replace

```ts
      const REACH = /\b(?:coord|store)\.db\s*[.,)]/;
```

with

```ts
      // `REACH` itself is module-scope, just below this describe: the update ring at the end of this file reads it too.
```

(the five comment lines above it, `:762-766`, stay as they are — they still describe the pattern, and they are what the reader of this case needs). And `:777`, the blank line between the coord ring's outer `});` (`:776`) and `// ── program-leverage wave 8 ──` (`:778`) — replace that empty line with

```ts
const REACH = /\b(?:coord|store)\.db\s*[.,)]/;
```

The `for` loop at `:768` now reads the module-scope `REACH`. It is used inside an `it` body, which runs after the module has finished evaluating, so declaring it ten lines below that use is not a TDZ read (and `tsc` raises no TS2448 for a use inside a deferred closure).

(b) The update ring — append after the file's last line (the closing `});` of the describe Task 1 appended after `:3302`):

```ts

// ── Design 2026-09-20 §6: the update ring ─────────────────────────────────
// "W2 extends that describe to scan server/src/update with an EMPTY
// allowlist" — and D-3187 leans on it: the resolver stays
// L1 and the projection writer L3 BY THEIR IMPORTS, and no file there holds
// the handle. The coord ring (`describe('the coord ring — …')` above)
// allowlists five holders; this one allowlists NONE, so every read and write
// the update modules make goes through a `CoordStore` method.
// APPENDED, not nested inside the coord ring as the spec's sentence reads:
// `session-hook.test.ts`'s citation audit cites this file by line, so an
// insert above a cited line moves its census. It reads the coord ring's
// `REACH` — module-scope, declared under that describe — not a copy.
describe('the update ring — nothing under server/src/update holds the handle (design 2026-09-20 §6)', () => {
  const updateDir = path.join(ccrcRoot, 'server/src/update');
  /** Every file the ring is known to hold, appended by the task that
   *  creates it (W2: catalogue.ts, inventory.ts, resolve.ts, project.ts,
   *  routes.ts). A FLOOR, not a count: a new file raises it rather than
   *  breaking it, and a listed file that is gone — a moved or renamed
   *  directory — reds instead of disarming the scan. */
  const UPDATE_RING_FILES: readonly string[] = [];
  // A bare `import 'node:sqlite'` and a dynamic `import('node:sqlite')` count
  // too — the coord ring's `from\s+'node:sqlite'` sees neither.
  const IMPORTS_SQLITE = /(?:\bfrom\s+|\bimport\s*\(?\s*)'node:sqlite'/;
  const IMPORTS_DB = /(?:\bfrom\s+|\bimport\s*\(?\s*)'(?:\.{1,2}\/)+(?:coord\/)?db\.js'/;
  const IMPORTS_UPDATE = /\bfrom\s+'(?:\.\/|(?:\.\.\/)+)update\//;
  /** Over `[name, source]` pairs, so the CONTROL below plants its shapes as
   *  text — no fixture directory, and so no new import line in this file. */
  const ringViolations = (files: readonly (readonly [string, string])[]): string[] =>
    files.flatMap(([name, src]) => [
      ...(IMPORTS_SQLITE.test(src) ? [`${name} imports node:sqlite`] : []),
      ...(IMPORTS_DB.test(src) ? [`${name} imports a coord db module`] : []),
      ...(REACH.test(src) ? [`${name} names a database handle on a coord/store receiver`] : []),
    ]);
  const onDisk = (dir: string): (readonly [string, string])[] =>
    sources(dir).map((f) => [path.relative(dir, f), readFileSync(f, 'utf8')] as const);

  it('covers the directory — absent means nothing expects it, present means every listed file is visited (never a skip)', () => {
    if (!existsSync(updateDir)) {
      expect(UPDATE_RING_FILES,
        'files are listed for an update ring that is not on disk — was the directory moved?').toEqual([]);
      const importers = sources(path.join(ccrcRoot, 'server/src'))
        .filter((f) => IMPORTS_UPDATE.test(readFileSync(f, 'utf8'))).map(rel);
      expect(importers, 'a server/src file imports from an update directory this scan cannot see').toEqual([]);
      return;
    }
    const names = sources(updateDir).map((p) => path.relative(updateDir, p));
    for (const f of UPDATE_RING_FILES) expect(names, `${f} is listed but not on disk`).toContain(f);
    expect(names.length).toBeGreaterThanOrEqual(UPDATE_RING_FILES.length);
  });

  it('no file there imports node:sqlite or a coord db module, or reaches for a handle — an EMPTY allowlist', () => {
    expect(existsSync(updateDir) ? ringViolations(onDisk(updateDir)) : []).toEqual([]);
  });

  it('CONTROL: each forbidden shape is caught on planted text, and a store import is not', () => {
    expect(ringViolations([
      ['a.ts', "import 'node:sqlite';\n"],
      ['b.ts', "import type { DatabaseSync } from 'node:sqlite';\n"],
      ['c.ts', "import { tx } from '../coord/db.js';\n"],
      ['d.ts', 'export const n = (coord: { db: unknown }) => tx(coord.db, () => 1);\n'],
      ['e.ts', "import type { CoordStore } from '../coord/store.js';\nexport const f = (s: CoordStore) => s.intents();\n"],
    ]).sort()).toEqual([
      'a.ts imports node:sqlite',
      'b.ts imports node:sqlite',
      'c.ts imports a coord db module',
      'd.ts names a database handle on a coord/store receiver',
    ]);
  });
});
```

(`e.ts` is the negative control: `'../coord/store.js'` is the import every update module makes, and `intents()` is Task 6's reader, so a ring that flagged it would red on every correct file Tasks 10–13 add.)

Check the placement before running anything — the only hunks above the append must be one-for-one:

```bash
git diff -U0 server/test/single-definition.test.ts | grep '^@@'
```

Expected: exactly three hunks — `@@ -767 +767 @@`, `@@ -777 +777 @@`, and one `@@ -N,0 +N+1,… @@` whose `N` is the file's last line before this step. Any other hunk header, or a first two whose counts differ, is an insert above a cited line: undo it.

- [ ] **Step 4: Run the ring scans and the citation audit**

Run, from `server/`, one at a time, foreground:
- `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the coord ring'` — PASS, the coord ring's three cases (the third reads the module-scope `REACH`).
- `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the update ring'` — PASS, three cases; `server/src/update` does not exist yet, so the first takes its absent branch (`UPDATE_RING_FILES` empty, no importer) and the second scans nothing.
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — PASS, 205 (Task 1's 202 + these 3; Tasks 2–6 add no case to this file). Measured on a scratch copy of d759c914 carrying only this step's edits: `163 passed (163)` = 160 + 3, the coord ring and the update ring 3 each, and the citation audit below `13 passed | 320 skipped (333)`.
- `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` — PASS, `Tests  13 passed | 320 skipped (333)` (Task 1's measured count): the census entry `'server/test/single-definition.test.ts': 8` and every failure list in that describe unchanged. A red here means Step 3 moved a cited line — re-run Step 3's `git diff -U0` check; never edit `session-hook.test.ts` to match.
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — PASS (both test files compile under the tests project; a known load flake — re-run in isolation before calling a red real).

- [ ] **Step 5: Mutation measurements against the real `store.ts`** (each edit → `cd server && ./node_modules/.bin/vitest run test/update-writer-groups.test.ts` → the named case RED with the named message → restore with `git checkout -- server/src/coord/store.ts` ONLY after confirming `git diff --stat` shows `store.ts` as the sole change → green)

1. §18 "one writer per column group" — in `upsertNodeMeasurement`'s `UPDATE nodes SET` list add `updateState = updateState, ` as its first item (no quote: that statement is a single-quoted JS literal, so `'idle'` would end the string; Task 5's writer is an `INSERT … ON CONFLICT(nodeId) DO NOTHING` followed by a separate `UPDATE nodes SET role = ?, …` — it has no `DO UPDATE SET` list) → red: "every column a statement writes…" with `upsertNodeMeasurement (store.ts:N) writes nodes.updateState — the lease group's writers are dispatchNode, releaseLease, settleNode, ackNode`, and "upsertNodeMeasurement names no column outside…".
2. Same row — as the first statement of `refuseRelease`'s body add `this.db.prepare('UPDATE releases SET notes = NULL WHERE tag = ?').run(tag);` → red: `refuseRelease (store.ts:N) writes releases.notes — the catalogue group's writers are applyReleaseListing`.
3. Same row — in `settleNode`'s `UPDATE nodes SET` list add `resolveDetail = NULL, ` → red: `settleNode (store.ts:N) writes nodes.resolveDetail — the resolved group's writers are resolveNode`.
4. The attribution — rewrite `ackNode`'s one-line signature as three lines (`  ackNode(` / `    nodeId: string,` / `  ): AckNodeResult {`) → red: "store.ts carries no write the scan cannot attribute" (`… crossed a method close — the signature of the method writing nodes is not single-line` and `… writing node_release_refusals is not single-line`, one per `ackNode` statement), "finds every W2 writer writing" (`the scan found no statement of ackNode writing an update table`), and "the ack path writes all three of its groups…" (`ackNode never returns the lease to idle` — its statements are attributed to nobody).
5. D-3180 — as the first statement of `clearRefusals`'s body add `this.db.prepare('DELETE FROM releases WHERE yanked = 1').run();` → red: two messages, `clearRefusals … writes every column of releases (a DELETE with no column list) — the catalogue group's writers are applyReleaseListing` and `… the notification group's writers are markReleaseNotified`.
6. The stray-line guard — move `setIntent`'s `'UPDATE update_epoch SET epoch = ?, issuedAt = ? WHERE id = 1'` into a module constant `const UPDATE_EPOCH_SQL = 'UPDATE update_epoch SET epoch = ?, issuedAt = ? WHERE id = 1';` beside `INTENT_COLUMNS_SQL` and prepare it as `this.db.prepare(UPDATE_EPOCH_SQL)` → red: `store.ts:N: writes an update table outside a this.db.prepare( window — …`.
7. D-3183 — replace `ackNode`'s `const cleared = this.db.prepare('DELETE FROM node_release_refusals WHERE nodeId = ?').run(nodeId);` with `const cleared = { changes: 0 };` (Task 5's own mutation 4, so the method still compiles) → red: "the ack path writes all three of its groups…" (`ackNode never clears this node's refusals`); and delete `requestedAt = NULL` from `ackNode`'s `UPDATE nodes` → red, `ackNode leaves a request column standing`.
8. Decision 7 — add `requestedTag = NULL, ` to `releaseLease`'s `UPDATE nodes SET` list → red twice: the group violation (`releaseLease … writes nodes.requestedTag — the request group's writers are requestNode, settleNode, ackNode`) and `releaseLease clears the request …`.

- [ ] **Step 6: Mutation measurement against the update ring**

§18 "the ring scan covers `update/`". Plant: `mkdir server/src/update && printf "import 'node:sqlite';\n" > server/src/update/planted.ts`. Run `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'update ring'` → red: `no file there imports node:sqlite …` with `['planted.ts imports node:sqlite']`. Remove: `rm -r server/src/update` (the directory holds only the planted file in this task — check with `ls server/src/update` first) → green. The row's other half — "the directory is dropped from the scan" — is not measurable yet (nothing is listed and nothing imports the directory, so an edited `updateDir` still takes a correct absent branch); it becomes measurable in Task 10, when `UPDATE_RING_FILES` gains `'catalogue.ts'` and `watch.ts` imports it: from then on an `updateDir` pointed elsewhere reds the absent branch twice (a listed file, an importer). Task 10's executor measures it there by editing `updateDir` to `'server/src/updates'`.

- [ ] **Step 7: Commit**

Run `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` (a new file) — PASS; and re-run `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` on the tree being committed — PASS, `13 passed | 320 skipped (333)` (R13: the green run includes it). Then:

```bash
git add server/test/update-writer-groups.test.ts server/test/single-definition.test.ts
git commit -m "test(update): the writer-group scan over store.ts's SQL and the update ring with an empty allowlist — each shape measured red on a planted fixture"
```

### Task 8: Agent — the exact-basename read set, and `ops` on ready

**Files:**
- Modify: `shared/agent-protocol.ts` — `CCRC_DIR_NAME`/`NODE_FILES`/`NodeFileKey`/`NODE_FILE_BASENAMES` right after `POOL_EPOCH_FILE_NAME` (`:116`); `AgentReady` (`:85-88`) gains `ops?: string[]`, and its JSDoc (`:64-84`) a D-1396-style paragraph
- Modify: `agent/src/whitelist.ts` — one import; `isCcrcNodeFile` after `underClaudeGlob` (`:48-53`); `checkPath` (`:64-91`) canonicalises `~/.ccrc` in its `Promise.all` and ORs the grant into `readAllowed` (`:83-88`); nothing on the exec surface
- Modify: `agent/CLAUDE.md` — the read-whitelist sentence ("Agent runtime facts", `:43-45`)
- Modify: `README.md` — the "Agent security model" section's `- **Path whitelist**:` bullet (`README.md:1509-1519` at d759c914 — locate it by that marker, since Tasks 1/13/15 may land README edits first), whose Reads list names only the prefix roots and goes false after Step 4 with no red: `readme-holds.test.ts:183` uses `- **Path whitelist**:` only as the END marker of the Exec-whitelist slice and asserts nothing about this bullet. LINE-NEUTRAL (eleven lines replace eleven), so Task 15's README line-count arithmetic (3279 → 3301) and `pools-prose.test.ts`'s size ratchet do not move; the new text carries no `:<digits>` token, and README is a CITING document only in `session-hook.test.ts`'s audit (its `FILE_RE` has no `.md` arm), so no anchor moves
- Modify: `server/src/fleetstate.ts` — `FleetState` (`:25-117`) gains `agentOps?: readonly string[]` after `observedEpoch` (`:116`)
- Modify: `server/src/remote/client.ts` — one import; `readReadyOps` above `class FleetClient`; `FleetClient.state`'s initialiser (`:85-88`); `onReady` (`:314`), one line before the `frame.build` block (`:384-402`)
- Modify (comment-only, line-neutral): `server/src/readiness.ts` (`:52`), `server/test/readiness.test.ts` (`:224`), `server/test/readiness-sweep.test.ts` (`:200`, `:202`) — each says "the agent's whitelist has no `.ccrc` arm", false after this task
- Test: `agent/test/whitelist.test.ts` — a nested describe inside `describe('whitelist.checkPath')` (`:30-146`) (D-3176)
- Test: `server/test/remote-connect.test.ts` — the whole-object `toEqual` (`:44-47`) gains `agentOps: []`; a pre-handshake case beside `:114-123`; a `readReadyOps` table; an `ops` describe on `fakeReadyAgent` (`:136-162`); a real-agent describe over the node files
- Test: `server/test/single-definition.test.ts` — a `describe('one NODE_FILES …')` APPENDED after the file's last line (after Task 1's appended `describe('the update control plane — …')`, itself appended after the original `:3302`); nothing inserted above — `session-hook.test.ts`'s citation audit cites this file at `:32-37`, `:1274`, `:1303` (census entry `'server/test/single-definition.test.ts': 8`), so a describe inserted after `parseCcdCaps` (`:1228`) would move two cited lines (ruling R13)
- Not modified, but run green (ruling R13): `server/test/session-hook.test.ts -t 'every line citation is anchored'`. Measured: the audit's corpus (the compaction-card spec, its plan A, `README.md`) cites no line of `shared/agent-protocol.ts`, `agent/src/whitelist.ts`, `server/src/fleetstate.ts`, `server/src/remote/client.ts`, `server/src/readiness.ts` or any other test file this task edits, so the inserts there move no anchor; `single-definition.test.ts` is the one cited file, and it is appended to

**Interfaces:**
- Consumes: `canonicalize`/`isUnder` (`whitelist.ts:18-44`); the `lstat` op's parent-probe fallback (`agent/src/server.ts:353-381`: subject = `<checkPath(dirname)>/<basename>`, else the canonical path); Task 1's `validCapWords(words: readonly unknown[]): string[] | null` (`null` = refused, `[]` = a valid empty list) and `MAX_CAP_WORDS` (= 32), both from `shared/api.ts`'s end-of-file update block (imported as `'../../../shared/api.js'` from `server/src/remote/`, `'../../shared/api.js'` from `server/test/`), and `CAP_WORD` (named in prose only); `FleetIO.readFileMeasured`/`statMeasured`/`lstatMeasured`/`readdir` over the agent (`server/src/remote/io.ts:46-160`).
- Produces:

```ts
// shared/agent-protocol.ts
export const CCRC_DIR_NAME = '.ccrc';
export const NODE_FILES = {
  stamp: 'build.json', installed: 'installed', caps: 'ccrc-caps', floor: 'floor', previous: 'previous',
  nodeId: 'node-id', report: 'update.json', projection: 'update-intent',
} as const;
export type NodeFileKey = keyof typeof NODE_FILES;
export const NODE_FILE_BASENAMES: readonly string[] = Object.values(NODE_FILES);
export interface AgentReady {
  t: 'ready'; v: 1; ccdVerbs?: string[]; rosterFp?: string; build?: BuildInfo;
  observedEpoch?: number | null;
  ops?: string[];   // ADDITIVE (design 2026-09-20 §8/§10): the ops this agent answers; absent from every agent before W4
}

// agent/src/whitelist.ts — checkPath's signature is unchanged:
export async function checkPath(targetPath: string, cfg: WhitelistConfig, mode: PathMode): Promise<string | null>;
// read mode additionally admits canonicalTarget iff
//   canonicalTarget ∈ { canonicalize(join(cfg.home, CCRC_DIR_NAME)) + sep + b | b ∈ NODE_FILE_BASENAMES }
//   (a Set built once per call; never isUnder(…/.ccrc))
//   AND canonicalTarget === <that canonical dir> + sep + basename(resolve(targetPath))
//   (the literal-basename rule, D-3195, found writing this task: without it a live
//   symlink named `floor` pointing at `installed` canonicalises onto a member and `lstat` answers
//   `regular` for a link);
// write mode admits none of them.

// server/src/fleetstate.ts — FleetState gains:
agentOps?: readonly string[];   // undefined = no ready yet / local mode; [] = ready arrived with ops absent or refused

// server/src/remote/client.ts
export function readReadyOps(raw: unknown): string[];   // absent/non-array → []; validCapWords(raw) ?? []
// onReady: this.state.agentOps = readReadyOps(frame.ops) — THE SINGLE READER of the ready frame's ops, reset on every ready
```

- Pins (§18 "the read allowlist is exact basenames", "reads refuse a non-regular file" — the agent half, "reads are bounded and validated" — the `agentOps` word rule, "vocabularies are declared once" — the basename set): each of the eight readable, present or absent; `agent.env`, `auth.scrypt`, `coord.db`, `deploy.env`, `ccrc.env`, `exposure.env`, `mail.token`, `accounts.json`, `accounts.sh`, `build.json.bak`, `.build.json.tmp`, `logs/x`, `~/.ccrc` itself, a path below a node file, `~/.ccrc-evil/build.json` refused; write mode refuses all eight; a live symlink carrying a node-file name refused wherever it points (a secret, another member, outside); `~/.ccrc` as a symlink admits its eight and nothing else; over a REAL agent the server's remote io reads/stats/lstats `build.json`, answers `absent` for an unwritten member, `unreadable` for `agent.env`, `null` for `readdir(~/.ccrc)`, `unmeasured` for an lstat of a live symlinked member, `symlink` for a dangling one. Ready: absent → `[]`; `['update']` → `['update']`; one bad word, 33 words, a non-string, a non-array → `[]`; 32 words pass; a reconnect to a peer that stops sending it drops back to `[]`; pre-handshake `undefined`; the real W2 agent sends none (`agentOps: []` in the whole-object `toEqual`).

- [ ] **Step 1: Declare the L0 vocabulary the tests import (no behaviour yet)**

In `shared/agent-protocol.ts`, directly after `export const POOL_EPOCH_FILE_NAME = 'pool-epoch';` (`:116`), insert:

```ts

/**
 * The `~/.ccrc` NODE FILES — design 2026-09-20 §8's EXACT-BASENAME set, the
 * one agent read grant that is not a directory prefix. Declared here, and not
 * in either package's `src/`, for `POOL_EPOCH_FILE_NAME`'s reason above: the
 * agent's `checkPath` (`agent/src/whitelist.ts`) admits exactly these names
 * and the server's inventory sweep (`server/src/update/inventory.ts`) reads
 * exactly these names, and a name spelled twice is a sweep that reads a file
 * the agent refuses — `unreadable` forever, with no red anywhere.
 *
 * `~/.ccrc` ALSO holds `agent.env` (this agent's own bearer), `auth.scrypt`,
 * `coord.db`, `deploy.env` and every other secret-bearing file `ccd/ccrc`
 * writes. Nothing may ever be added to this object that names one of them —
 * the grant derives from it, so an entry here IS a read grant.
 * `projection` (`update-intent`) is in the set so the server can SHOW what a
 * fleet node last received; it is never read back as authority (§8).
 *
 * Writers: `ccd/ccrc` writes `build.json`, `installed`, `ccrc-caps`, `floor`
 * and `node-id` today (its `BOX_*_FILE` constants — bash cannot import this,
 * so those spellings are its own); `previous` and `update.json` are W4's; the
 * server process writes its OWN box's `update-intent` from W2, and W4's
 * `ccd-update-sync` writes a fleet node's. A name read before its writer
 * exists answers `absent`, which is the truth about that node.
 */
export const CCRC_DIR_NAME = '.ccrc';
export const NODE_FILES = {
  stamp: 'build.json', installed: 'installed', caps: 'ccrc-caps', floor: 'floor', previous: 'previous',
  nodeId: 'node-id', report: 'update.json', projection: 'update-intent',
} as const;
export type NodeFileKey = keyof typeof NODE_FILES;
/** The eight names as one list, DERIVED — the agent's admission set and every
 *  scan over it read this, never a restatement. */
export const NODE_FILE_BASENAMES: readonly string[] = Object.values(NODE_FILES);
```

In the same file, replace the `AgentReady` interface (`:85-88`) with:

```ts
export interface AgentReady {
  t: 'ready'; v: 1; ccdVerbs?: string[]; rosterFp?: string; build?: BuildInfo;
  observedEpoch?: number | null;
  ops?: string[];   // ADDITIVE (design 2026-09-20 §8/§10): the ops this agent answers; absent from every agent before W4
}
```

and extend the JSDoc directly above it. Its last line (`:84`) is ` *  still reads it. */`. Replace that line with ` *  still reads it.` followed by these lines, the last of which closes the comment:

```ts
 *
 *  `ops` names the request ops this agent answers beyond the closed set every
 *  agent has always had (design 2026-09-20 §8/§10) — `['update']` from W4's
 *  agent. ABSENT from every agent before that, and absence is tolerated and
 *  grants nothing: the server's one reader (`remote/client.ts`'s
 *  `readReadyOps`) reads an absent field, a non-array, and a list with any
 *  word off `CAP_WORD` or more than `MAX_CAP_WORDS` words as the same `[]` —
 *  "this link named no op I may send" — which the inventory stores as `''`
 *  and which is NOT the server row's `NULL` ("no agent at all", decision 11).
 *  Unlike `observedEpoch` above, handshake cadence is the RIGHT cadence for
 *  this field: the ops an agent process answers cannot change without that
 *  process restarting, and a restart is a new `ready`. */
```

- [ ] **Step 2: Write the failing tests**

`agent/test/whitelist.test.ts` — add to the imports:

```ts
import { NODE_FILE_BASENAMES } from '../../shared/agent-protocol.js';
```

and, inside `describe('whitelist.checkPath', …)`, after the pool-projection case (`:135-145`), before the describe's closing `});`:

```ts

  // ── design 2026-09-20 §8: the eight ~/.ccrc node files ──────────────────
  // D-3176 — the spec put these in whitelist-structural.test.ts,
  // which pins only the EXEC whitelist (tsc-spawned compile errors, no checkPath
  // case at all); every other checkPath case is in this describe, so these are.
  describe('the ~/.ccrc node files — exact basenames, READ mode only', () => {
    const EIGHT = ['build.json', 'ccrc-caps', 'floor', 'installed', 'node-id', 'previous', 'update-intent', 'update.json'];
    // Every other name ccd/ccrc writes (or could) beside them — the secrets first.
    const REFUSED = ['agent.env', 'auth.scrypt', 'coord.db', 'deploy.env', 'ccrc.env', 'exposure.env',
      'mail.token', 'accounts.json', 'accounts.sh', 'build.json.bak', '.build.json.tmp', path.join('logs', 'x')];

    function seedCcrc(): string {
      seed();
      const ccrc = path.join(home, '.ccrc');
      mkdirSync(path.join(ccrc, 'logs'), { recursive: true });
      return ccrc;
    }

    it('the set is exactly the eight §8 names — a ninth is a design change, not an edit', () => {
      // The grant DERIVES from NODE_FILE_BASENAMES, so a name added to
      // NODE_FILES is a read grant; this is the line that makes that visible.
      expect([...NODE_FILE_BASENAMES].sort()).toEqual(EIGHT);
    });

    it('admits each of the eight for read, absent or present, at its canonical path', async () => {
      const ccrc = seedCcrc();
      const cfg = { home, projectsRoot };
      const canonicalCcrc = await canonicalize(ccrc);
      for (const b of EIGHT) {
        const p = path.join(ccrc, b);
        // Absent first: a node whose writer has not run yet must read `absent`
        // over the wire, not `forbidden` → `unreadable`.
        expect(await checkPath(p, cfg, 'read'), `${b} (absent) must be readable`).toBe(path.join(canonicalCcrc, b));
        writeFileSync(p, 'x\n');
        expect(await checkPath(p, cfg, 'read'), `${b} (present) must be readable`).toBe(path.join(canonicalCcrc, b));
      }
    });

    it('refuses every other name in ~/.ccrc, ~/.ccrc itself, a path below a node file, and look-alikes elsewhere', async () => {
      const ccrc = seedCcrc();
      const cfg = { home, projectsRoot };
      for (const r of REFUSED) {
        writeFileSync(path.join(ccrc, r), 'secret\n');
        expect(await checkPath(path.join(ccrc, r), cfg, 'read'), `${r} must NOT be readable`).toBeNull();
      }
      // The directory itself: admitting it would let `readdir` list agent.env's
      // existence and `lstat`'s parent probe widen past the eight.
      expect(await checkPath(ccrc, cfg, 'read'), '~/.ccrc itself must NOT be readable').toBeNull();
      expect(await checkPath(path.join(ccrc, 'build.json', 'x'), cfg, 'read')).toBeNull();
      mkdirSync(path.join(home, '.ccrc-evil'), { recursive: true });
      expect(await checkPath(path.join(home, '.ccrc-evil', 'build.json'), cfg, 'read')).toBeNull();
      expect(await checkPath(path.join(home, 'build.json'), cfg, 'read')).toBeNull();
      expect(await checkPath(path.join(outside, 'build.json'), cfg, 'read')).toBeNull();
    });

    it('write mode admits none of the eight — the agent never writes a node file', async () => {
      const ccrc = seedCcrc();
      const cfg = { home, projectsRoot };
      for (const b of EIGHT) {
        expect(await checkPath(path.join(ccrc, b), cfg, 'write'), `${b} must NOT be writable`).toBeNull();
      }
    });

    it('a live SYMLINK carrying a node-file name is refused — at a secret, at another of the eight, or outside', async () => {
      const ccrc = seedCcrc();
      const cfg = { home, projectsRoot };
      writeFileSync(path.join(ccrc, 'agent.env'), 'CCRC_AGENT_TOKEN=x\n');
      writeFileSync(path.join(ccrc, 'installed'), 'abc\n');
      writeFileSync(path.join(outside, 'node-id'), 'x\n');
      symlinkSync(path.join(ccrc, 'agent.env'), path.join(ccrc, 'build.json'));
      // The case canonical-path membership ALONE admits: `floor` resolves onto
      // `installed`, a member — only the literal-basename rule refuses it
      // (D-3195).
      symlinkSync(path.join(ccrc, 'installed'), path.join(ccrc, 'floor'));
      symlinkSync(path.join(outside, 'node-id'), path.join(ccrc, 'node-id'));
      for (const b of ['build.json', 'floor', 'node-id']) {
        expect(await checkPath(path.join(ccrc, b), cfg, 'read'), `${b} (a symlink) must NOT be readable`).toBeNull();
      }
      expect(await checkPath(path.join(ccrc, 'installed'), cfg, 'read'), 'the real file keeps its own grant').not.toBeNull();
    });

    it("lstat's parent probe finds ~/.ccrc refused, so its subject for a node file is the admitted path itself", async () => {
      // agent/src/server.ts's `lstat` arm answers about `<checkPath(dirname)>/<basename>`
      // and falls back to the CANONICAL path when the parent is refused.
      // `~/.ccrc` IS refused (above), so for the eight the subject is the
      // canonical path — and the literal-basename rule is what makes that the
      // path the caller named rather than a link's target.
      const ccrc = seedCcrc();
      const cfg = { home, projectsRoot };
      expect(await checkPath(path.dirname(path.join(ccrc, 'build.json')), cfg, 'read')).toBeNull();
    });

    it('a ~/.ccrc that is itself a symlink admits its own eight and nothing else', async () => {
      seed();
      const cfg = { home, projectsRoot };
      const real = mkTmp('ccrc-wl-ccrc-real-');
      symlinkSync(real, path.join(home, '.ccrc'));
      writeFileSync(path.join(real, 'build.json'), '{}\n');
      writeFileSync(path.join(real, 'agent.env'), 'CCRC_AGENT_TOKEN=x\n');
      const canonicalReal = await canonicalize(real);
      expect(await checkPath(path.join(home, '.ccrc', 'build.json'), cfg, 'read'))
        .toBe(path.join(canonicalReal, 'build.json'));
      expect(await checkPath(path.join(home, '.ccrc', 'update-intent'), cfg, 'read'))
        .toBe(path.join(canonicalReal, 'update-intent'));
      expect(await checkPath(path.join(home, '.ccrc', 'agent.env'), cfg, 'read')).toBeNull();
    });
  });
```

`server/test/remote-connect.test.ts` — change the imports (`:2`, `:6`) and add one:

```ts
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
```
```ts
import { connectFleet, FleetClient, readReadyOps, type ConnectedFleet } from '../src/remote/client.js';
import { MAX_CAP_WORDS } from '../../shared/api.js';
```

In `'reaches connected:true with downSince:null after a good handshake'` replace the expected literal (`:44-46`) and add the comment above it:

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
      { timeout: 3000 });
```

After `'starts with observedEpoch:undefined before any handshake — never null'` (`:114-123`), inside the same describe:

```ts

  it('starts with agentOps:undefined before any handshake — "no evidence", not "no ops"', () => {
    // `[]` would claim a ready frame arrived and named nothing; before any
    // handshake nothing arrived at all (design 2026-09-20 §8, decision 11).
    const client = new FleetClient({ url: 'ws://127.0.0.1:1', token: 'unused' });
    expect(client.state.agentOps).toBeUndefined();
  });
```

At the end of the file:

```ts

describe('readReadyOps — the ONE validator of AgentReady.ops (design 2026-09-20 §8)', () => {
  // §8: "`caps` and `agentOps` words must match `CAP_WORD` with at most 32
  // words, and one bad word drops the whole file to ''". The inventory stores
  // `[]` as `''`; the server row's NULL is the sweep's, never this reader's.
  it.each<[string, unknown, string[]]>([
    ['absent (every agent before W4)', undefined, []],
    ['null', null, []],
    ['a bare string', 'update', []],
    ['an object', { update: true }, []],
    ['an empty list', [], []],
    ['one valid word', ['update'], ['update']],
    ['two valid words', ['update', 'rollback'], ['update', 'rollback']],
    ['one word off CAP_WORD drops the whole list', ['update', 'Update'], []],
    ['a word with a space', ['update now'], []],
    ['a non-string element', ['update', 1], []],
    ['a 33-character word', ['a'.repeat(33)], []],
  ])('%s', (_label, raw, want) => {
    expect(readReadyOps(raw)).toEqual(want);
  });

  it('exactly MAX_CAP_WORDS words pass; one more drops them all', () => {
    const words = (n: number): string[] => Array.from({ length: n }, (_, i) => `op-${i}`);
    expect(readReadyOps(words(MAX_CAP_WORDS))).toEqual(words(MAX_CAP_WORDS));
    expect(readReadyOps(words(MAX_CAP_WORDS + 1))).toEqual([]);
  });
});

describe('FleetClient.onReady — ops is read through readReadyOps, on every ready', () => {
  let server: { port: number; close(): Promise<void> } | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (server) await server.close();
    server = undefined;
  });

  const connect = async (extra: Record<string, unknown>): Promise<ConnectedFleet> => {
    server = await fakeReadyAgent(extra);
    const f = connectFleet({ url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(f.state.connected).toBe(true), { timeout: 3000 });
    return f;
  };

  it('an absent ops (every agent before W4) is [] — connected, no op named', async () => {
    fleet = await connect({});
    expect(fleet.state.agentOps).toEqual([]);
  });

  it('a valid list is recorded verbatim', async () => {
    fleet = await connect({ ops: ['update'] });
    expect(fleet.state.agentOps).toEqual(['update']);
  });

  it('one bad word off the wire drops the whole list — never a partial', async () => {
    fleet = await connect({ ops: ['update', 'RM -RF'] });
    expect(fleet.state.agentOps).toEqual([]);
  });

  it('a peer that stops sending ops on RECONNECT drops what it had, not keeps it', async () => {
    // The reset-on-every-ready guard, on the branch a fresh connection cannot
    // reach: a W4 agent downgraded to a W2 one must not keep being sent an op
    // it no longer answers.
    let extra: Record<string, unknown> = { ops: ['update'] };
    server = await fakeReadyAgent(() => extra);
    fleet = connectFleet({
      url: `ws://127.0.0.1:${server.port}`, token: TOKEN, heartbeatMs: 60_000,
      reconnectMinMs: 30, reconnectMaxMs: 100,
    });
    await vi.waitFor(() => expect(fleet!.state.agentOps).toEqual(['update']), { timeout: 3000 });
    extra = {};
    fleet.client.ws?.close();
    await vi.waitFor(() => expect(fleet!.state.agentOps).toEqual([]), { timeout: 3000 });
  });
});

describe('the ~/.ccrc node files over a REAL agent — what the inventory sweep reads (design 2026-09-20 §8)', () => {
  // The server's remote FleetIO against the real agent's checkPath, over a real
  // loopback WS: the path Task 11's sweep takes for the fleet node. Fixture
  // HOMEs only.
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  let fleet: ConnectedFleet | undefined;

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
    }
    fixture = undefined;
  });

  const open = async (): Promise<string> => {
    fixture = makeFixture();
    const ccrc = path.join(fixture.home, '.ccrc');
    mkdirSync(ccrc, { recursive: true });
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port, { heartbeatMs: 60_000 });
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
    return ccrc;
  };

  it('a node file reads, stats and lstats; an unwritten one is ABSENT; the secret beside them is refused', async () => {
    const ccrc = await open();
    writeFileSync(path.join(ccrc, 'build.json'), '{"sha":"abc"}\n');
    writeFileSync(path.join(ccrc, 'agent.env'), 'CCRC_AGENT_TOKEN=not-for-the-wire\n');
    const stamp = path.join(ccrc, 'build.json');
    expect(await fleet!.io.readFileMeasured(stamp)).toEqual({ ok: true, content: '{"sha":"abc"}\n' });
    expect(await fleet!.io.statMeasured(stamp)).toMatchObject({ ok: true, size: 14 });
    expect(await fleet!.io.lstatMeasured(stamp)).toEqual({ ok: true, kind: 'regular' });
    expect(await fleet!.io.readFileMeasured(path.join(ccrc, 'node-id'))).toEqual({ ok: false, reason: 'absent' });
    expect(await fleet!.io.readFileMeasured(path.join(ccrc, 'agent.env'))).toEqual({ ok: false, reason: 'unreadable' });
    expect(await fleet!.io.readdir(ccrc)).toBeNull();
  });

  it('a live symlink carrying a node-file name is never followed — refused over read and lstat alike', async () => {
    const ccrc = await open();
    writeFileSync(path.join(ccrc, 'agent.env'), 'CCRC_AGENT_TOKEN=not-for-the-wire\n');
    writeFileSync(path.join(ccrc, 'installed'), 'abc\n');
    symlinkSync(path.join(ccrc, 'agent.env'), path.join(ccrc, 'build.json'));
    symlinkSync(path.join(ccrc, 'installed'), path.join(ccrc, 'floor'));
    for (const name of ['build.json', 'floor']) {
      const p = path.join(ccrc, name);
      expect(await fleet!.io.readFileMeasured(p), name).toEqual({ ok: false, reason: 'unreadable' });
      // `unmeasured`, never `regular`: the agent refuses the lstat outright
      // (`forbidden`) and the remote io reports a refused lstat as `unmeasured`
      // (`remote/io.ts`'s `lstatMeasured`), which the sweep folds to
      // `unreadable` (D-3178). `regular` for `floor` is the
      // regression the literal-basename rule exists to stop.
      expect(await fleet!.io.lstatMeasured(p), name).toEqual({ ok: false, reason: 'unmeasured' });
    }
  });

  it('a DANGLING symlink carrying a node-file name lstats as `symlink` — the kind the sweep refuses', async () => {
    const ccrc = await open();
    symlinkSync(path.join(ccrc, 'no-such-target'), path.join(ccrc, 'update.json'));
    expect(await fleet!.io.lstatMeasured(path.join(ccrc, 'update.json'))).toEqual({ ok: true, kind: 'symlink' });
  });
});
```

`server/test/single-definition.test.ts` — APPEND after the file's last line: the closing `});` of Task 1's `describe('the update control plane — one definition per vocabulary and wire type (design 2026-09-20 §6)', …)`, which Task 1 appended after the original `:3302`. Never insert it beside `describe('one parseCcdCaps …')` (`:1213-1228`), where it would sit above two cited lines (`:1274`, `:1303`) and red `session-hook.test.ts`'s citation audit (ruling R13):

```ts

// — design 2026-09-20 §8: the ~/.ccrc node-file names, declared once —
// APPENDED, never inserted: `session-hook.test.ts`'s citation audit cites this
// file by line (`:32-37`, `:1274`, `:1303`), so an insert above those moves them.
describe('one NODE_FILES — the ~/.ccrc node-file basenames', () => {
  it('is declared in exactly one file, and that file is shared/agent-protocol.ts', () => {
    const holders = ALL.filter((f) => /^\s*export const NODE_FILES\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it('the three names no older code spells are quoted nowhere else — every reader goes through NODE_FILES', () => {
    // `build.json`, `installed`, `floor` and `previous` are ordinary words older
    // code already spells (`config.ts`'s `buildInfoPath`, the agent's own stamp
    // reader), and `node-id` is also a W1 CAP word (`ccd/ccrc`'s
    // `CCRC_CAP_WORDS`) a later task may test for; these three are new with the
    // control plane, so a second quoted copy is a second definition.
    const QUOTED = /'(?:ccrc-caps|update\.json|update-intent)'/;
    const holders = ALL.filter((f) => QUOTED.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/agent-protocol.ts']);
  });

  it("the agent's read grant derives from it, never re-lists it", () => {
    const wl = readFileSync(path.join(ccrcRoot, 'agent', 'src', 'whitelist.ts'), 'utf8');
    expect(wl).toMatch(/import\s*\{[^}]*\bNODE_FILE_BASENAMES\b[^}]*\}\s*from\s*'\.\.\/\.\.\/shared\/agent-protocol\.js'/);
  });

  it("the ready frame's ops field has ONE reader in server/src", () => {
    const hits = ALL.filter((f) => rel(f).startsWith('server/src/'))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bframe\.ops\b/g)].map(() => rel(f)));
    expect(hits).toEqual(['server/src/remote/client.ts']);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd agent && ./node_modules/.bin/vitest run test/whitelist.test.ts`
Expected: FAIL — `admits each of the eight …` with `build.json (absent) must be readable: expected null to be '<tmp>/.ccrc/build.json'`, `a ~/.ccrc that is itself a symlink …` (`expected null to be '<real>/build.json'`), and `a live SYMLINK carrying a node-file name is refused …` — its three refusals pass, but its last assertion fails with `the real file keeps its own grant: expected null not to be null`, because nothing under `~/.ccrc` is admitted yet. Three reds. The three pure-refusal cases (`refuses every other name …`, `write mode admits none …`, `lstat's parent probe …`) PASS already: nothing under `~/.ccrc` is admitted today, so they only start guarding once the grant exists (Step 8 measures that they do). The set-is-eight case passes from Step 1. Four green, three red, seven cases.

Run: `cd server && ./node_modules/.bin/vitest run test/remote-connect.test.ts`
Expected: FAIL — `readReadyOps is not a function` (every `readReadyOps` case), the whole-object `toEqual` (received has no `agentOps: []`), the four `FleetClient.onReady` `ops` cases (the absent and bad-word cases with `expected undefined to deeply equal []`, the valid-list case with `expected undefined to deeply equal [ 'update' ]`, and the reconnect case as a `vi.waitFor` timeout whose last error is `expected undefined to deeply equal [ 'update' ]`), the real-agent node-file case (`{ ok: false, reason: 'unreadable' }` for `build.json`), and the dangling case (`{ ok: false, reason: 'unmeasured' }`, not `symlink`: today the whole directory is refused). The live-symlink case passes already, because every `~/.ccrc` read and lstat is refused today; Step 8's mutation 2 is what shows it guarding anything. The pre-handshake case passes.

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'one NODE_FILES'`
Expected: FAIL — `the agent's read grant derives from it` (no import in `whitelist.ts`) and `ONE reader in server/src` (`expected [] to deeply equal ['server/src/remote/client.ts']`); the two holder cases pass from Step 1.

- [ ] **Step 4: Implement the read grant in `agent/src/whitelist.ts`**

Add the import after `import path from 'node:path';` (`:2`):

```ts
import { CCRC_DIR_NAME, NODE_FILE_BASENAMES } from '../../shared/agent-protocol.js';
```

Insert after `underClaudeGlob` (`:48-53`):

```ts

/**
 * The eight `~/.ccrc` NODE FILES (design 2026-09-20 §8) — the one read grant
 * in this file that is not a prefix. `~/.ccrc` also holds `agent.env` (this
 * agent's own bearer), `auth.scrypt`, `coord.db`, `deploy.env` and every other
 * secret-bearing file `ccd/ccrc` writes, so an `isUnder(…/.ccrc)` arm would
 * hand every one of them to the wire. The grant is canonical-path EQUALITY
 * against the names `NODE_FILES` declares (`shared/agent-protocol.ts`), in a
 * Set built once per check.
 *
 * TWO conditions, and the second is what keeps the `lstat` op honest
 * (D-3195).
 * `canonicalTarget` must BE one of the eight, AND it must be the path the
 * caller literally named. `~/.ccrc/floor` as a live symlink to
 * `~/.ccrc/installed` canonicalises onto a member; admitting it would let
 * `lstat` answer `regular` for a link, because `lstat`'s subject falls back
 * to the canonical path when the parent is not itself readable (the `lstat`
 * arm in `server.ts`) — and `~/.ccrc` is not. Requiring
 * canonical === `<canonical ~/.ccrc>/<the literal basename>` refuses every
 * live symlink carrying one of the eight names, wherever it points. A
 * DANGLING one canonicalises onto its own literal path and is admitted;
 * `lstat` then reports it as `symlink`, which the server's sweep refuses.
 *
 * `canonicalCcrc` is `canonicalize(<home>/.ccrc)`, not `<canonical home>/.ccrc`,
 * so a `~/.ccrc` that is itself a symlink admits its own eight and nothing else.
 */
function isCcrcNodeFile(canonicalCcrc: string, targetPath: string, canonicalTarget: string): boolean {
  const admitted = new Set(NODE_FILE_BASENAMES.map((b) => path.join(canonicalCcrc, b)));
  return admitted.has(canonicalTarget)
    && canonicalTarget === path.join(canonicalCcrc, path.basename(path.resolve(targetPath)));
}
```

Replace `checkPath`'s docstring and body (`:57-91`) with:

```ts
/**
 * Whitelist check for ALL file ops. Reads: `.cc-sessions/`, `.cc-limits/`,
 * `.cc-clips/`, `.claude*` (glob) under $HOME, plus the fleet projects root,
 * plus exactly the eight `~/.ccrc` node files by name (`isCcrcNodeFile`).
 * Writes: `.cc-clips/` under $HOME only. Returns the canonical path to operate on when
 * allowed, `null` otherwise — canonicalizing here means every downstream fs
 * call in fileops.ts/tail.ts already has symlink-escapes resolved.
 */
export async function checkPath(
  targetPath: string,
  cfg: WhitelistConfig,
  mode: PathMode,
): Promise<string | null> {
  // Same defense-in-depth guard as `canonicalize`: never let a
  // missing/wrong-typed `path` field reach a node:path call unchecked.
  if (typeof targetPath !== 'string' || targetPath.length === 0) return null;

  const [canonicalHome, canonicalRoot, canonicalTarget, canonicalCcrc] = await Promise.all([
    canonicalize(cfg.home),
    canonicalize(cfg.projectsRoot),
    canonicalize(targetPath),
    canonicalize(path.join(cfg.home, CCRC_DIR_NAME)),
  ]);

  if (mode === 'write') {
    return isUnder(canonicalTarget, path.join(canonicalHome, '.cc-clips')) ? canonicalTarget : null;
  }

  const readAllowed =
    isUnder(canonicalTarget, path.join(canonicalHome, '.cc-sessions')) ||
    isUnder(canonicalTarget, path.join(canonicalHome, '.cc-limits')) ||
    isUnder(canonicalTarget, path.join(canonicalHome, '.cc-clips')) ||
    isUnder(canonicalTarget, canonicalRoot) ||
    underClaudeGlob(canonicalHome, canonicalTarget) ||
    isCcrcNodeFile(canonicalCcrc, targetPath, canonicalTarget);

  return readAllowed ? canonicalTarget : null;
}
```

Constraints this keeps, each read by an existing test: exactly one `mode === 'write'` in the file (`ccd-lifecycle-contain.test.ts:128-132`); `.cc-clips` still inside `const readAllowed` before its first `;` (`reviewer-skill.test.ts:181-186`); `EXEC_COMMANDS`, `FORBIDDEN_COMMANDS`, `EXEC_WHITELIST` and `auditExecWhitelist` untouched (`ccrc-api-closed.test.ts:288-292`, `whitelist-structural.test.ts`).

- [ ] **Step 5: Implement the ops reader on the server**

`server/src/fleetstate.ts` — after `observedEpoch?: number | null;` (`:116`), before the interface's closing `}`:

```ts
  /** The ops the fleet host's agent says it answers (`AgentReady.ops`, design
   *  2026-09-20 §8/§10), validated by `remote/client.ts`'s `readReadyOps` —
   *  the one reader. THREE answers, and the inventory keeps two of them apart:
   *  `undefined` = no evidence gathered (local mode, or no `ready` yet — the
   *  server row's `NULL` is the sweep's decision, never read from here); `[]`
   *  = a `ready` arrived and named no op this server may send (an older agent
   *  that omits the field — every agent before W4 — or a list `validCapWords`
   *  refused whole), stored as `''`; a non-empty list = the words.
   *
   *  Handshake cadence is correct for THIS field, unlike `build` and
   *  `observedEpoch` above: the ops a process answers cannot change without
   *  that process restarting, which produces a new `ready` (spec §8). It keeps
   *  the last `ready`'s answer across a drop, so read it only while
   *  `connected`.
   *
   *  OPTIONAL for `observedEpoch`'s measured reason: required would break every
   *  `FleetState` fixture in server/test with no relation to ops, and an
   *  omitted key reads `undefined` — the honest "no evidence" for each of them.
   *  The runtime substitute for the compile error is the same whole-object
   *  `toEqual` in `remote-connect.test.ts`. */
  agentOps?: readonly string[];
```

`server/src/remote/client.ts` — after `import { parseBuildInfo } from '../../../shared/buildinfo.js';` (`:13`):

```ts
import { validCapWords } from '../../../shared/api.js';
```

Directly above the JSDoc of `export class FleetClient` (the block beginning "Owns exactly one logical connection", `:74`):

```ts
/**
 * THE ONE VALIDATOR of `AgentReady.ops` (design 2026-09-20 §8, §10), called
 * once per `ready` by `onReady`. The peer may be older, newer or broken, so
 * the list is validated, not trusted: absent, not an array, or refused by
 * `validCapWords` (a word off `CAP_WORD`, a non-string, more than
 * `MAX_CAP_WORDS` words — one bad word drops the whole list, §8) → `[]`.
 *
 * `[]` folds "an agent too old to say" with "an agent that said something
 * unusable", and that fold is deliberate rather than a narrowing: every
 * consumer treats both the same — the dispatcher never sends an op the link
 * did not validly name. The distinction that DOES survive is the one
 * decision 11 names: this reader never answers `undefined`/`null`, which are
 * "no ready yet" and "no agent at all", so a connected fleet row stores `''`
 * and the server row `NULL`, and the two never meet.
 */
export function readReadyOps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return validCapWords(raw) ?? [];
}

```

In `FleetClient.state`'s initialiser (`:85-88`), replace:

```ts
  readonly state: FleetState = {
    connected: false, downSince: null, ccdVerbs: null, rosterFp: null, build: null,
    observedEpoch: undefined,
  };
```
with:
```ts
  readonly state: FleetState = {
    connected: false, downSince: null, ccdVerbs: null, rosterFp: null, build: null,
    observedEpoch: undefined, agentOps: undefined,
  };
```

In `onReady`, directly before the comment `// THE SINGLE READER of \`frame.build\`` (`:384`), insert:

```ts
    // THE SINGLE READER of the ready frame's `ops` (design 2026-09-20 §8) —
    // `readReadyOps` above is its one validator. Reset on EVERY ready, the
    // `rosterFp`/`build` reason: a reconnect to a downgraded agent must not
    // keep advertising an op the new process no longer answers.
    this.state.agentOps = readReadyOps(frame.ops);
```

(`frame.ops` appears in `server/src` on that one line only; the comment spells it "the ready frame's `ops`", so the single-definition scan counts one.)

- [ ] **Step 6: Correct the prose this task falsifies**

`agent/CLAUDE.md` (`:43-45`) — replace:

```
  the WS as a whitelisted `ccd`/`tmux` verb, never a raw file write. Read whitelist is canonical-prefix,
  realpath-resolved (closes symlink escapes): `~/.cc-sessions/`, `~/.cc-limits/`, `~/.cc-clips/`, `~/.claude*`,
  and the fleet projects root.
```
with:
```
  the WS as a whitelisted `ccd`/`tmux` verb, never a raw file write. Read whitelist is canonical-prefix,
  realpath-resolved (closes symlink escapes): `~/.cc-sessions/`, `~/.cc-limits/`, `~/.cc-clips/`, `~/.claude*`,
  and the fleet projects root — plus ONE non-prefix grant: exactly the eight `~/.ccrc` node files
  (`NODE_FILES`, `shared/agent-protocol.ts`: `build.json`, `installed`, `ccrc-caps`, `floor`, `previous`,
  `node-id`, `update.json`, `update-intent`), by canonical-path EQUALITY, a live symlink carrying one of those
  names refused (design 2026-09-20 §8). Never `isUnder(~/.ccrc)`: that directory holds `agent.env`,
  `auth.scrypt`, `coord.db` and `deploy.env`, and `test/whitelist.test.ts` reds the moment one becomes readable.
```

`README.md` — the `- **Path whitelist**:` bullet (`:1509-1519` at d759c914; find it by the marker). Replace the whole bullet, eleven lines for eleven — count them after pasting, because Task 15's README line-count figure assumes this edit moves nothing. Keep the `- **Path whitelist**:` marker byte-identical: `readme-holds.test.ts:183` ends the Exec-whitelist slice on it. Replace:

```
- **Path whitelist**: every file op resolves the target through `realpath`
  and checks it's still under an allowed canonical prefix — closing the
  classic symlink-escape hole. Reads: `$HOME/.cc-sessions/`,
  `$HOME/.cc-limits/`, `$HOME/.cc-clips/`, `$HOME/.claude*/` (glob), and the
  fleet's projects root. Writes: `$HOME/.cc-clips/` only. **This list did not
  widen for the transcript resolver or the supervisor heartbeat**, and both
  are worth saying out loud: the resolver's uuid search (rungs 5 and 6 of
  its ladder) rides the existing `$HOME/.claude*` grant — no new read
  permission — and the supervisor heartbeat exists specifically so the
  server never has to ask systemd anything; nothing under
  `~/.config/systemd` was added to reach it.
```
with:
```
- **Path whitelist**: every file op resolves the target through `realpath`
  and checks it's still under an allowed canonical prefix — closing the
  classic symlink-escape hole. Reads: `$HOME/.cc-sessions/`,
  `$HOME/.cc-limits/`, `$HOME/.cc-clips/`, `$HOME/.claude*/` (glob), the
  fleet's projects root, and exactly the eight `$HOME/.ccrc` node files by
  name (`NODE_FILES`, `shared/agent-protocol.ts`) — never a symlink carrying
  one, never `$HOME/.ccrc` itself. Writes: `$HOME/.cc-clips/` only. **This
  list did not widen for the transcript resolver or the supervisor
  heartbeat**: the resolver's uuid search (rungs 5 and 6 of its ladder)
  rides the existing `$HOME/.claude*` grant, and the heartbeat exists so the
  server never asks systemd anything — nothing under `~/.config/systemd`.
```

Three comments that say "the agent's whitelist has no `.ccrc` arm". The argument each makes (the fleet agent refuses `mail.token`) still holds, but the premise is false after Step 4. Replace each line in place, so line counts stay the same:

`server/src/readiness.ts:52`
```
   * about a server-box file. The agent's whitelist has no `.ccrc` arm, the
```
→
```
   * about a server-box file. The agent admits only eight `.ccrc` node files, never `mail.token`, the
```

`server/test/readiness.test.ts:224`
```
// whitelist has no `.ccrc` arm, so the refusal arrives as `unreadable` ->
```
→
```
// whitelist admits only eight `.ccrc` node files, never `mail.token`, so the refusal arrives as `unreadable` ->
```

`server/test/readiness-sweep.test.ts:200` and `:202`
```
   *  FleetIO — and the agent's read whitelist has no `.ccrc` arm
```
→
```
   *  FleetIO — and the agent's read whitelist admits no `.ccrc` name but its eight node files
```
```
   *  projects root, underClaudeGlob). This io refuses `.ccrc` exactly as that
```
→
```
   *  projects root, underClaudeGlob). This io refuses `.ccrc` whole — exact for `mail.token`, as that
```

- [ ] **Step 7: Run to verify they pass**

Run (foreground, one file at a time, timeout ≥ 600000 ms):
- `cd agent && ./node_modules/.bin/vitest run test/whitelist.test.ts`, then `test/fileops.test.ts`, then `test/whitelist-structural.test.ts`
- `cd server && ./node_modules/.bin/vitest run test/remote-connect.test.ts`, then `test/single-definition.test.ts`, `test/session-hook.test.ts -t 'every line citation is anchored'`, `test/reviewer-skill.test.ts`, `test/ccd-lifecycle-contain.test.ts`, `test/ccrc-api-closed.test.ts`, `test/readiness.test.ts`, `test/readiness-sweep.test.ts`, `test/typecheck-tests.test.ts`, `test/readme-holds.test.ts`, `test/pools-prose.test.ts` (the README size ratchet — green because the README edit is line-neutral; `wc -l < README.md` must read what it read before this task)

Expected: PASS. The citation audit's census entry (`'server/test/single-definition.test.ts': 8`) is unchanged, because the one cited file this task edits was appended to, never inserted into (ruling R13); `session-hook` is a known load flake, so a red there is re-run in isolation before it is called a break. `typecheck-tests` compiles both test projects with the widened `FleetState` and the new imports. It is a known load flake, so if it reds, re-run it in isolation before calling it a break. `fileops.test.ts` and `whitelist-structural.test.ts` must stay green unchanged: the first proves the other roots' lstat and escape behaviour survived the new `Promise.all` member, the second that the exec surface did not move.

- [ ] **Step 8: Mutation measurement**

Make each edit, run the named file, see it red, restore by editing, then re-run green:

1. §18 "the read allowlist is exact basenames": in `checkPath`, replace `isCcrcNodeFile(canonicalCcrc, targetPath, canonicalTarget)` with `isUnder(canonicalTarget, canonicalCcrc)`. `agent/test/whitelist.test.ts` reds on `agent.env must NOT be readable` (and `~/.ccrc itself`). `server/test/remote-connect.test.ts` reds on `agent.env`, which now answers `{ ok: true, … }`.
2. §18 "reads refuse a non-regular file" (agent half), D-3195: in `isCcrcNodeFile`, delete `&& canonicalTarget === path.join(canonicalCcrc, path.basename(path.resolve(targetPath)))`. `whitelist.test.ts` reds on `floor (a symlink) must NOT be readable`. `remote-connect.test.ts` reds on `floor`: read `ok` with `abc\n`, lstat `{ ok: true, kind: 'regular' }`.
3. Build `canonicalCcrc` as `path.join(canonicalHome, CCRC_DIR_NAME)` instead of `canonicalize(path.join(cfg.home, CCRC_DIR_NAME))`. `whitelist.test.ts` reds on `a ~/.ccrc that is itself a symlink …`.
4. In the write arm, append `|| isCcrcNodeFile(canonicalCcrc, targetPath, canonicalTarget)` inside the ternary's condition. `whitelist.test.ts` reds on `build.json must NOT be writable`.
5. §18 "reads are bounded and validated" (the `agentOps` rule): make `readReadyOps` `return Array.isArray(raw) ? (raw as string[]) : [];`. `remote-connect.test.ts` reds on `one word off CAP_WORD …`, `a non-string element`, `one more drops them all`, `one bad word off the wire …`.
6. Guard the `onReady` line as `if (frame.ops !== undefined) this.state.agentOps = readReadyOps(frame.ops);`. `remote-connect.test.ts` reds on `a peer that stops sending ops on RECONNECT …` (still `['update']`) and on the whole-object `toEqual` (`agentOps` missing).
7. §18 "vocabularies are declared once": add `const PROJECTION = 'update-intent';` to `agent/src/whitelist.ts`. `single-definition.test.ts` reds on `the three names … quoted nowhere else`.

Case counts before/after (vitest's summary line): `agent/test/whitelist.test.ts` +7, `server/test/remote-connect.test.ts` +20 (11 table rows, the 32/33 case, 4 onReady ops cases, 3 real-agent cases, the pre-handshake case), `server/test/single-definition.test.ts` +4. The same number green before and after every restore.

- [ ] **Step 9: Commit**

```bash
git add shared/agent-protocol.ts agent/src/whitelist.ts agent/CLAUDE.md agent/test/whitelist.test.ts README.md \
  server/src/fleetstate.ts server/src/remote/client.ts server/src/readiness.ts \
  server/test/remote-connect.test.ts server/test/single-definition.test.ts \
  server/test/readiness.test.ts server/test/readiness-sweep.test.ts
git commit -m "feat(update): the agent reads exactly eight ~/.ccrc node files by name, never a symlink carrying one; the server reads ready.ops through one validator"
```

### Task 9: Config — role, release source, knobs, `ccrcDir`

**Files:**
- Modify: `server/src/config.ts` — one import; the new types, constants and four functions (`deriveRole`, `derivedRoleNote`, `parseReleaseSource`, `readReleaseSource`) after `export type FleetMode` (`:9`); `CcrcConfig` (`:11-163`) gains seven fields after `fleetMode` (`:34`) and after `buildInfoPath` (`:51`); `loadConfig` (`:251`) hoists `fleetMode` above its `return {` (`:313`) and fills the fields (`:333`, `:349`)
- Modify: `deploy/ccrc.env.example` — the `CCRC_ROLE=` paragraph (its "the SERVER never reads" sentence is false after this task); a commented `CCRC_RELEASE_OWNER`, `CCRC_RELEASE_REPO`, `CCRC_RELEASE_API_URL`, `CCRC_UPDATE_DEADLINE_MS` section at the end
- Modify: `server/src/index.ts` — `roleSource`'s reader (coordinator ruling, 2026-09-23): the import on `:2` gains `derivedRoleNote` IN PLACE, and two statements plus their comment are APPENDED after the file's last line, the `ccrc-server on …` boot `console.log` (`:169`). Appending is deliberate: it is line-neutral for every `index.ts` anchor a later task quotes (Task 10 `:20`/`:73`/`:94-95`/`:146-147`, Task 11 `:10`/`:81`/`:87`/`:164`, Task 13 `:73`/`:94`/`:146`, Task 14 `:27`), all measured at `d759c914`.
- Test: `server/test/config.test.ts` — the imports (`:1-8`) replaced; three describes appended after `describe('mungePath')` (`:396-402`)
- No repo-wide guard file needs an edit (measured at `d759c914`). None of the four files above is in `session-hook.test.ts`'s citation corpus (the graphify-card spec, its plan-a, and `README.md` cite no `config.ts`/`index.ts`/`config.test.ts`/`ccrc.env.example` line), so the line-neutral rule for cited files does not bind them. `mail-routes.test.ts`'s kebab scanner reads `server/src/coord` only, so `config.ts`'s kebab words (`derived-absent`, `tree-absent`, `env-malformed`, …) are outside it. `pools-prose.test.ts` quotes `config.ts`'s `loadRoster` docstring by content; nothing is inserted inside it. Task 8's `'update-intent'` single-quote scan is not tripped, because `config.ts` names that file in backticks only. Task 1's SQL-tuple scan matches parenthesised lists only, so `it.each(['server', 'fleet', 'both'] …)` is not a `NodeRole` tuple. `agent/test/deploy-verify.test.ts` needs seven keys in `ccrc.env.example`, and all seven survive Step 4. No route is added, so `auth-gate`, `box-token-census` and the readiness tests are unaffected.

**Interfaces:**
- Consumes: `isNodeRole`, `NodeRole` (Task 1, `shared/api.ts`); `FleetMode` (`config.ts:9`); the two release-source lines of the installed tree's `ccd/ccrc` (`CCRC_RELEASE_OWNER=`/`CCRC_RELEASE_REPO=`, `ccd/ccrc:1335-1336`; `install.sh:23-24` spells the same pair, held equal by `ccrc-update.test.ts`); `ccrc.service`'s first `EnvironmentFile=-%h/.ccrc/ccrc.env` (`deploy/ccrc.service`), into which `_inst_env` writes `CCRC_ROLE=$INST_ROLE` (`ccd/ccrc:9377`).
- Produces:

```ts
export type RoleSource = 'recorded' | 'derived-absent' | 'derived-invalid';          // D-3174
export interface ReleaseSource { owner: string; repo: string }
export type ReleaseSourceRead =                                                   // D-3175
  | { ok: true; owner: string; repo: string; from: 'env' | 'tree' }
  | { ok: false; why: 'tree-absent' | 'tree-unreadable' | 'tree-malformed'; path: string }
  | { ok: false; why: 'env-malformed'; path: null };                             // D-3196: both env keys set, one not a plain name
export const DEFAULT_RELEASE_API_URL = 'https://api.github.com';
export const DEFAULT_UPDATE_DEADLINE_MS = 15 * 60_000;
export function deriveRole(env: NodeJS.ProcessEnv, fleetMode: FleetMode): { role: NodeRole; roleSource: RoleSource };
export function derivedRoleNote(c: Pick<CcrcConfig, 'role' | 'roleSource' | 'fleetMode'>): string | null;   // null when roleSource is 'recorded'
export function parseReleaseSource(ccrcText: string): ReleaseSource | null;       // both lines, each exactly once; values ^(?!\.+$)[A-Za-z0-9._-]{1,100}$
export function readReleaseSource(env: NodeJS.ProcessEnv, installedCcrcPath: string): ReleaseSourceRead;

// CcrcConfig gains:
role: NodeRole;
roleSource: RoleSource;
ccrcDir: string;              // path.join(home, '.ccrc') — ONLY the new W2 paths route through it
installedCcrcPath: string;    // path.join(home, 'ccrc', 'ccd', 'ccrc') — the tree ccrc.service runs
releaseSource: ReleaseSourceRead;
releaseApiUrl: string;        // env.CCRC_RELEASE_API_URL || DEFAULT_RELEASE_API_URL, trailing '/' trimmed
updateDeadlineMs: number;     // env.CCRC_UPDATE_DEADLINE_MS as a positive integer, else the default; read by W4
```

- Two changes from the skeleton's interface, both found writing this task and both carried by D-3196. (1) `ReleaseSourceRead` gains an `env-malformed` arm. Both env keys set with a value that is not a plain name must not fall back silently to the tree's pair, which would poll a repository the operator overrode. Nor may it build a URL from it: the value is interpolated into `{api}/repos/{owner}/{repo}/releases`. (2) The value pattern refuses a name made only of dots (`(?!\.+$)`), because `..` matches `[A-Za-z0-9._-]{1,100}` and would walk the request path up a segment.
- Every new key reads with `||`, never `??`: a bare `KEY=` line in the EnvironmentFile is unset (`loadConfig`'s `accountsPath` lesson, `:252-258`). Fixtures spell an invented owner/repo only (`example-owner`/`example-repo`). No TS root may name the org (`single-definition.test.ts`'s "the four TS roots never name the org", `:2793-2796`). `loadConfig` stays synchronous (`readFileSync`, the `loadRoster` reason) and never throws for a release-source failure: that is a `why`, reported by the poller (Task 10) as `no-release-source`.
- `roleSource` has ONE reader (coordinator ruling, 2026-09-23): `index.ts` logs once at boot, when the role was DERIVED, `ccrc-server: CCRC_ROLE is <absent|invalid> in the environment — this box's role reads <role> (derived from CCRC_FLEET=<mode>)`. The sentence is built by `derivedRoleNote` in `config.ts`, so it is pinned word for word by a unit case, not by booting a process. `<mode>` is `cfg.fleetMode`, the value the role was derived from. `index.ts` only calls `console.warn` on a non-null note. A recorded role prints nothing.
- Pins no §18 row directly. It pins the three departures its fields carry. D-3174: recorded; absent in each mode; a bare line; invalid never folded into absent; the derived-role boot line and its one call. D-3175: tree; both-env override; half-set env ignored; each tree `why`; the real `ccd/ccrc` parses and agrees with `install.sh`. D-3196: `env-malformed`; the dot-only refusal. The TS-roots org scan stays green.

- [ ] **Step 1: Write the failing tests**

`server/test/config.test.ts` — replace the imports (`:1-8`) with:

```ts
import { describe, it, expect, vi } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configDirFor, deriveRole, derivedRoleNote, loadConfig, parseReleaseSource, readReleaseSource,
  DEFAULT_RELEASE_API_URL, DEFAULT_UPDATE_DEADLINE_MS,
} from '../src/config.js';
import { mungePath } from '../src/munge.js';
import { RosterError } from '../../shared/roster.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster, DEFAULT_TEST_ROSTER } from './helpers.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
```

and append at the end of the file:

```ts

// ── design 2026-09-20 (W2): what the update control plane reads from config ──

/** A fixture INSTALLED tree — `<home>/ccrc/ccd/ccrc`, the path `ccrc.service`'s
 *  ExecStart runs from — carrying the two release-source lines the real one
 *  carries, with an INVENTED owner/repo: no TS root may name the real org, and
 *  this suite only needs the shape. */
function plantTree(home: string, body: string): string {
  const p = path.join(home, 'ccrc', 'ccd', 'ccrc');
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
  return p;
}
const TREE_BODY = [
  '#!/usr/bin/env bash',
  '# a fixture ccrc — the release source, as ccd/ccrc spells it',
  'CCRC_RELEASE_OWNER="example-owner"',
  'CCRC_RELEASE_REPO="example-repo"',
  'base="https://github.com/$CCRC_RELEASE_OWNER/$CCRC_RELEASE_REPO/releases"',
  '',
].join('\n');

describe('deriveRole — the server\'s own role (D-3174)', () => {
  // `ccrc.service` reads `~/.ccrc/ccrc.env` as its first EnvironmentFile, and
  // `_inst_env` writes `CCRC_ROLE=<role>` into that file's first write — so a
  // recorded role is already in process.env. A box `deploy.sh` seeded (the
  // example file's bare `CCRC_ROLE=` line) records none, and derives.
  it.each(['server', 'fleet', 'both'] as const)('a recorded %s wins in either fleet mode', (r) => {
    expect(deriveRole({ CCRC_ROLE: r }, 'remote')).toEqual({ role: r, roleSource: 'recorded' });
    expect(deriveRole({ CCRC_ROLE: r }, 'local')).toEqual({ role: r, roleSource: 'recorded' });
  });

  it('absent: remote mode is the server box, local mode is the single box', () => {
    expect(deriveRole({}, 'remote')).toEqual({ role: 'server', roleSource: 'derived-absent' });
    expect(deriveRole({}, 'local')).toEqual({ role: 'both', roleSource: 'derived-absent' });
  });

  it('a BARE `CCRC_ROLE=` line is absent, not a role named the empty string', () => {
    expect(deriveRole({ CCRC_ROLE: '' }, 'remote')).toEqual({ role: 'server', roleSource: 'derived-absent' });
  });

  it.each(['SERVER', 'server ', 'agent', 'both,server'])('an out-of-vocabulary %j derives — and says INVALID, never absent', (raw) => {
    // The two are different remedies: absent = record a role; invalid = fix a typo.
    expect(deriveRole({ CCRC_ROLE: raw }, 'remote')).toEqual({ role: 'server', roleSource: 'derived-invalid' });
    expect(deriveRole({ CCRC_ROLE: raw }, 'local')).toEqual({ role: 'both', roleSource: 'derived-invalid' });
  });

  it('loadConfig carries both, from CCRC_ROLE and CCRC_FLEET', () => {
    const derived = loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_FLEET: 'remote' });
    expect([derived.role, derived.roleSource]).toEqual(['server', 'derived-absent']);
    const recorded = loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_FLEET: 'remote', CCRC_ROLE: 'both' });
    expect([recorded.role, recorded.roleSource]).toEqual(['both', 'recorded']);
    expect(loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH }).role).toBe('both');
  });

  // `roleSource`'s one reader: without it a derived role is visible nowhere —
  // `NodeWire` carries the role, never where it came from.
  it('derivedRoleNote: a recorded role says nothing; a derived one names absent or invalid, the role and the mode', () => {
    expect(derivedRoleNote({ role: 'fleet', roleSource: 'recorded', fleetMode: 'remote' })).toBeNull();
    expect(derivedRoleNote({ role: 'server', roleSource: 'derived-absent', fleetMode: 'remote' })).toBe(
      'ccrc-server: CCRC_ROLE is absent in the environment — this box\'s role reads server (derived from CCRC_FLEET=remote)');
    expect(derivedRoleNote({ role: 'both', roleSource: 'derived-invalid', fleetMode: 'local' })).toBe(
      'ccrc-server: CCRC_ROLE is invalid in the environment — this box\'s role reads both (derived from CCRC_FLEET=local)');
    expect(derivedRoleNote(loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_ROLE: 'both' }))).toBeNull();
    expect(derivedRoleNote(loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_ROLE: 'agent' })))
      .toBe('ccrc-server: CCRC_ROLE is invalid in the environment — this box\'s role reads both (derived from CCRC_FLEET=local)');
  });

  it('index.ts says it once at boot, on the booted config — the note has a reader', () => {
    const src = readFileSync(path.join(REPO, 'server', 'src', 'index.ts'), 'utf8');
    expect(src).toMatch(/^import \{ derivedRoleNote, loadConfig \} from '\.\/config\.js';$/m);
    expect(src.match(/\bderivedRoleNote\(/g) ?? [], 'called exactly once').toHaveLength(1);
    expect(src).toMatch(/^const roleNote = derivedRoleNote\(cfg\);\nif \(roleNote !== null\) console\.warn\(roleNote\);$/m);
  });
});

describe('the release source — read from the INSTALLED tree, env override when both are set (D-3175)', () => {
  it('parses the two lines, each exactly once', () => {
    expect(parseReleaseSource(TREE_BODY)).toEqual({ owner: 'example-owner', repo: 'example-repo' });
    expect(parseReleaseSource(TREE_BODY.replace('example-repo', 'my.repo_2'))).toEqual({ owner: 'example-owner', repo: 'my.repo_2' });
  });

  it.each([
    ['no repo line', TREE_BODY.replace(/^CCRC_RELEASE_REPO=.*$/m, '')],
    ['no owner line', TREE_BODY.replace(/^CCRC_RELEASE_OWNER=.*$/m, '')],
    ['the owner twice', `${TREE_BODY}CCRC_RELEASE_OWNER="other-owner"\n`],
    ['an indented assignment only', TREE_BODY.replace(/^CCRC_RELEASE_OWNER=/m, '  CCRC_RELEASE_OWNER=')],
    ['an unquoted value', TREE_BODY.replace('"example-owner"', 'example-owner')],
    ['a slash in a value', TREE_BODY.replace('example-repo', 'a/b')],
    ['a value of two dots', TREE_BODY.replace('example-repo', '..')],
    ['a value of one dot', TREE_BODY.replace('example-owner', '.')],
    ['a 101-character value', TREE_BODY.replace('example-repo', 'r'.repeat(101))],
    ['a CRLF line', TREE_BODY.replace('"example-owner"\n', '"example-owner"\r\n')],
    ['an empty file', ''],
  ])('refuses %s — null, never a guess', (_label, body) => {
    expect(parseReleaseSource(body)).toBeNull();
  });

  it('the REAL ccd/ccrc parses, and agrees with install.sh — without this file spelling the org', () => {
    const real = parseReleaseSource(readFileSync(path.join(REPO, 'ccd', 'ccrc'), 'utf8'));
    expect(real, 'ccd/ccrc no longer carries exactly one release-source pair this parser accepts').not.toBeNull();
    expect(real).toEqual(parseReleaseSource(readFileSync(path.join(REPO, 'install.sh'), 'utf8')));
  });

  it('reads the installed tree by default', () => {
    const home = mkTmp('cfg-release-');
    const p = plantTree(home, TREE_BODY);
    expect(readReleaseSource({}, p)).toEqual({ ok: true, owner: 'example-owner', repo: 'example-repo', from: 'tree' });
  });

  it('BOTH env keys override the tree — and need no tree at all', () => {
    const home = mkTmp('cfg-release-');
    const p = plantTree(home, TREE_BODY);
    const env = { CCRC_RELEASE_OWNER: 'fork-owner', CCRC_RELEASE_REPO: 'fork-repo' };
    expect(readReleaseSource(env, p)).toEqual({ ok: true, owner: 'fork-owner', repo: 'fork-repo', from: 'env' });
    expect(readReleaseSource(env, path.join(home, 'nope', 'ccrc'))).toEqual({ ok: true, owner: 'fork-owner', repo: 'fork-repo', from: 'env' });
  });

  it('ONE env key set is ignored — the tree decides, including its failure', () => {
    const home = mkTmp('cfg-release-');
    const p = plantTree(home, TREE_BODY);
    expect(readReleaseSource({ CCRC_RELEASE_OWNER: 'fork-owner' }, p))
      .toEqual({ ok: true, owner: 'example-owner', repo: 'example-repo', from: 'tree' });
    expect(readReleaseSource({ CCRC_RELEASE_REPO: 'fork-repo', CCRC_RELEASE_OWNER: '' }, p))
      .toEqual({ ok: true, owner: 'example-owner', repo: 'example-repo', from: 'tree' });
    const missing = path.join(home, 'nope', 'ccrc');
    expect(readReleaseSource({ CCRC_RELEASE_OWNER: 'fork-owner' }, missing)).toEqual({ ok: false, why: 'tree-absent', path: missing });
  });

  it('both env keys set with a value that is not a plain name REFUSES — never silently falls back to the tree', () => {
    const home = mkTmp('cfg-release-');
    const p = plantTree(home, TREE_BODY);
    expect(readReleaseSource({ CCRC_RELEASE_OWNER: 'fork-owner', CCRC_RELEASE_REPO: '../x' }, p))
      .toEqual({ ok: false, why: 'env-malformed', path: null });
    expect(readReleaseSource({ CCRC_RELEASE_OWNER: '..', CCRC_RELEASE_REPO: 'fork-repo' }, p))
      .toEqual({ ok: false, why: 'env-malformed', path: null });
  });

  it('keeps ABSENT, UNREADABLE and MALFORMED apart — three remedies, three words', () => {
    const home = mkTmp('cfg-release-');
    const missing = path.join(home, 'ccrc', 'ccd', 'ccrc');
    expect(readReleaseSource({}, missing)).toEqual({ ok: false, why: 'tree-absent', path: missing });
    const dir = path.join(home, 'as-a-dir');
    mkdirSync(dir, { recursive: true });
    expect(readReleaseSource({}, dir)).toEqual({ ok: false, why: 'tree-unreadable', path: dir });
    const p = plantTree(home, '#!/usr/bin/env bash\necho no release source here\n');
    expect(readReleaseSource({}, p)).toEqual({ ok: false, why: 'tree-malformed', path: p });
  });

  // Root reads through any mode bit — `accounts.json`'s identical guard above.
  it.skipIf(process.getuid?.() === 0)('a tree that exists but cannot be read is UNREADABLE, never absent', () => {
    const home = mkTmp('cfg-release-');
    const p = plantTree(home, TREE_BODY);
    chmodSync(p, 0o000);
    try {
      expect(readReleaseSource({}, p)).toEqual({ ok: false, why: 'tree-unreadable', path: p });
    } finally {
      chmodSync(p, 0o644);
    }
  });

  it('loadConfig reads <home>/ccrc/ccd/ccrc, and a box with no tree still boots', () => {
    const home = mkTmp('cfg-release-');
    seedRoster(home);
    plantTree(home, TREE_BODY);
    const cfg = loadConfig({ CCRC_HOME: home });
    expect(cfg.installedCcrcPath).toBe(path.join(home, 'ccrc', 'ccd', 'ccrc'));
    expect(cfg.releaseSource).toEqual({ ok: true, owner: 'example-owner', repo: 'example-repo', from: 'tree' });
    expect(loadConfig({ CCRC_HOME: '/fake/home', CCRC_ACCOUNTS: ROSTER_PATH }).releaseSource)
      .toEqual({ ok: false, why: 'tree-absent', path: '/fake/home/ccrc/ccd/ccrc' });
  });
});

describe('ccrcDir and the two update knobs', () => {
  it('derive from CCRC_HOME, with the documented defaults', () => {
    const cfg = loadConfig({ CCRC_HOME: '/fake/home', CCRC_ACCOUNTS: ROSTER_PATH });
    expect(cfg.ccrcDir).toBe('/fake/home/.ccrc');
    expect(cfg.releaseApiUrl).toBe(DEFAULT_RELEASE_API_URL);
    expect(DEFAULT_RELEASE_API_URL).toBe('https://api.github.com');
    expect(cfg.updateDeadlineMs).toBe(DEFAULT_UPDATE_DEADLINE_MS);
    expect(DEFAULT_UPDATE_DEADLINE_MS).toBe(15 * 60_000);
  });

  it('CCRC_RELEASE_API_URL overrides, a trailing slash trimmed; a bare line or bare slashes is unset', () => {
    const at = (v: string): string =>
      loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_RELEASE_API_URL: v }).releaseApiUrl;
    expect(at('http://127.0.0.1:9999')).toBe('http://127.0.0.1:9999');
    expect(at('http://127.0.0.1:9999/')).toBe('http://127.0.0.1:9999');
    expect(at('https://mirror.example.com/api//')).toBe('https://mirror.example.com/api');
    expect(at('')).toBe(DEFAULT_RELEASE_API_URL);
    expect(at('///')).toBe(DEFAULT_RELEASE_API_URL);
  });

  it('CCRC_UPDATE_DEADLINE_MS takes a positive integer; anything else is the default', () => {
    const at = (v: string): number =>
      loadConfig({ CCRC_HOME: '/h', CCRC_ACCOUNTS: ROSTER_PATH, CCRC_UPDATE_DEADLINE_MS: v }).updateDeadlineMs;
    expect(at('60000')).toBe(60_000);
    for (const bad of ['', 'abc', '0', '-1', '1.5', 'Infinity']) {
      expect(at(bad), JSON.stringify(bad)).toBe(DEFAULT_UPDATE_DEADLINE_MS);
    }
  });
});
```

(`vi` stays imported for the existing cases that use it.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/config.test.ts`
Expected: FAIL. Every new case fails with `deriveRole is not a function` / `derivedRoleNote is not a function` / `parseReleaseSource is not a function` / `readReleaseSource is not a function`, or, for `index.ts says it once at boot …`, a `toMatch` failure on the import line (`index.ts` has no `derivedRoleNote` yet), or, for the `loadConfig` field cases, `expected undefined to be '/fake/home/.ccrc'` (and likewise for `role`, `releaseSource`, `releaseApiUrl`, `updateDeadlineMs`). `DEFAULT_RELEASE_API_URL` reads `undefined`. Every pre-existing case stays green.

- [ ] **Step 3: Implement in `server/src/config.ts`**

Add after `import { parseRoster, RosterError, type Roster } from '../../shared/roster.js';` (`:7`):

```ts
import { isNodeRole, type NodeRole } from '../../shared/api.js';
```

After `export type FleetMode = 'local' | 'remote';` (`:9`), insert:

```ts

/**
 * Where `CcrcConfig.role` came from (D-3174). The server had no
 * role before the update control plane (design 2026-09-20 §6, §9); the box's
 * recorded one is `CCRC_ROLE` in `~/.ccrc/ccrc.env`, written by `ccrc install`'s
 * first write of that file and handed to this process by `ccrc.service`'s
 * EnvironmentFile. THREE words, never two: `derived-absent` (nothing recorded
 * — every box `deploy.sh` seeded, D-3106) and `derived-invalid` (a token
 * outside `NodeRole`) have different remedies, so one never stands for the other.
 */
export type RoleSource = 'recorded' | 'derived-absent' | 'derived-invalid';

/** The GitHub owner/repo the catalogue poller lists (design 2026-09-20 §7). */
export interface ReleaseSource { owner: string; repo: string }

/**
 * The release source as READ (D-3175), failure included. No TS
 * root may spell the org (`single-definition.test.ts`), so the pair reaches
 * this process at runtime only: from the INSTALLED tree's `ccd/ccrc` — its two
 * release-source lines, the same pair `ccrc update` downloads from — or from
 * `CCRC_RELEASE_OWNER` + `CCRC_RELEASE_REPO` when BOTH are set. Every failure is a
 * `why`, never a throw: `loadConfig` must boot a box whose tree is elsewhere,
 * and the poller reports the failure as `no-release-source` and sends nothing.
 * `tree-absent` (ENOENT) and `tree-unreadable` (any other errno — EACCES,
 * EISDIR) are kept apart for `loadRoster`'s reason: a file that plainly exists
 * is not fixed by reinstalling. `env-malformed` (D-3196)
 * is an override the operator set and this process cannot use; it refuses
 * rather than quietly polling the tree's pair instead.
 */
export type ReleaseSourceRead =
  | { ok: true; owner: string; repo: string; from: 'env' | 'tree' }
  | { ok: false; why: 'tree-absent' | 'tree-unreadable' | 'tree-malformed'; path: string }
  | { ok: false; why: 'env-malformed'; path: null };

/** The releases API root (design 2026-09-20 §7) — the sibling of `ccd/ccrc`'s
 *  `CCRC_RELEASE_BASE_URL`, so a fixture server stands in for GitHub in tests. */
export const DEFAULT_RELEASE_API_URL = 'https://api.github.com';
/** How long an update may run before the server calls it failed (§10). Stored
 *  from W2; nothing reads it until W4's dispatcher. */
export const DEFAULT_UPDATE_DEADLINE_MS = 15 * 60_000;

/** One owner or repo name: GitHub's own character set, at most 100, and never
 *  a name made only of dots — `..` matches the character class and would walk
 *  `/repos/{owner}/{repo}/releases` up a segment (D-3196). */
const RELEASE_SOURCE_VALUE = /^(?!\.+$)[A-Za-z0-9._-]{1,100}$/;

/**
 * This box's role: the recorded `CCRC_ROLE` when it is a `NodeRole`, else
 * DERIVED from the fleet mode — `remote` is the server box of a two-box
 * fleet, `local` is the single box that is both. A bare `CCRC_ROLE=` line is
 * absent (the house `||` rule); any other non-member is invalid, and says so.
 */
export function deriveRole(env: NodeJS.ProcessEnv, fleetMode: FleetMode): { role: NodeRole; roleSource: RoleSource } {
  const raw = env.CCRC_ROLE;
  if (isNodeRole(raw)) return { role: raw, roleSource: 'recorded' };
  const role: NodeRole = fleetMode === 'remote' ? 'server' : 'both';
  return { role, roleSource: raw === undefined || raw === '' ? 'derived-absent' : 'derived-invalid' };
}

/**
 * `roleSource`'s reader (D-3174): the one boot line that says a role
 * was DERIVED, and why. `NodeWire` carries the role and never where it came
 * from, so without this line a `deploy.sh` box that never recorded one (D-3106)
 * reads exactly like a box that did. `null` for a recorded role, which is not
 * news. `index.ts` warns it once; the words are pinned here, not by a boot.
 */
export function derivedRoleNote(c: Pick<CcrcConfig, 'role' | 'roleSource' | 'fleetMode'>): string | null {
  if (c.roleSource === 'recorded') return null;
  const why = c.roleSource === 'derived-absent' ? 'absent' : 'invalid';
  return `ccrc-server: CCRC_ROLE is ${why} in the environment — this box's role reads ${c.role} ` +
    `(derived from CCRC_FLEET=${c.fleetMode})`;
}

/**
 * The pair from a `ccd/ccrc` text: `CCRC_RELEASE_OWNER="…"` and
 * `CCRC_RELEASE_REPO="…"` at the START of a line, each EXACTLY once (a second
 * assignment is two answers, and this parser does not pick one), each value a
 * plain name. `null` on anything else. The URL lines that READ the variables
 * (`…/$CCRC_RELEASE_OWNER/…`) never match: they do not start with the name.
 * Split on `\n` and anchored per line WITHOUT the `m` flag, so `$` is the end
 * of the line: under `m`, `$` also matches before a bare `\r`, and a CRLF line
 * would parse (measured with node, 2026-09-23).
 */
export function parseReleaseSource(ccrcText: string): ReleaseSource | null {
  const lines = ccrcText.split('\n');
  const pick = (re: RegExp): RegExpExecArray[] =>
    lines.map((l) => re.exec(l)).filter((m): m is RegExpExecArray => m !== null);
  const owners = pick(/^CCRC_RELEASE_OWNER="([^"]+)"$/);
  const repos = pick(/^CCRC_RELEASE_REPO="([^"]+)"$/);
  if (owners.length !== 1 || repos.length !== 1) return null;
  const owner = owners[0]![1]!;
  const repo = repos[0]![1]!;
  return RELEASE_SOURCE_VALUE.test(owner) && RELEASE_SOURCE_VALUE.test(repo) ? { owner, repo } : null;
}

/**
 * Synchronous, for `loadRoster`'s reason: `index.ts` calls `loadConfig()` at
 * module top level with no `await`. BOTH env keys set → they decide, valid or
 * refused; one set without the other is ignored (a half-written override is
 * not an override) and the tree decides.
 */
export function readReleaseSource(env: NodeJS.ProcessEnv, installedCcrcPath: string): ReleaseSourceRead {
  const envOwner = env.CCRC_RELEASE_OWNER;
  const envRepo = env.CCRC_RELEASE_REPO;
  if (envOwner && envRepo) {
    return RELEASE_SOURCE_VALUE.test(envOwner) && RELEASE_SOURCE_VALUE.test(envRepo)
      ? { ok: true, owner: envOwner, repo: envRepo, from: 'env' }
      : { ok: false, why: 'env-malformed', path: null };
  }
  let text: string;
  try {
    text = readFileSync(installedCcrcPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      why: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'tree-absent' : 'tree-unreadable',
      path: installedCcrcPath,
    };
  }
  const src = parseReleaseSource(text);
  return src ? { ok: true, ...src, from: 'tree' } : { ok: false, why: 'tree-malformed', path: installedCcrcPath };
}
```

In `CcrcConfig`, directly after `fleetMode: FleetMode;` (`:34`):

```ts
  /** This box's role in the update control plane (design 2026-09-20 §6, §9):
   *  the role of its own `nodes` row, and whether this process writes its own
   *  `~/.ccrc/update-intent` (`server`/`both` do). `deriveRole` decides it. */
  role: NodeRole;
  /** Where `role` came from — recorded, or derived because the record was
   *  absent or invalid (D-3174). */
  roleSource: RoleSource;
```

and directly after `buildInfoPath: string;` (`:51`):

```ts
  /** `<home>/.ccrc` — the directory the update control plane's node files live
   *  in (`NODE_FILES`, `shared/agent-protocol.ts`). ONLY the W2 paths route
   *  through it; the older `.ccrc` paths above keep their own spellings. In
   *  remote mode the fleet node's files are read at this same absolute path
   *  over the agent, the same-path assumption `registryDir` already makes. */
  ccrcDir: string;
  /** `<home>/ccrc/ccd/ccrc` — the INSTALLED tree's `ccrc`, the tree
   *  `ccrc.service`'s ExecStart runs from; `releaseSource` is read from it. */
  installedCcrcPath: string;
  /** The catalogue's owner/repo, or why there is none (`readReleaseSource`). */
  releaseSource: ReleaseSourceRead;
  /** `CCRC_RELEASE_API_URL`, trailing slashes trimmed; `DEFAULT_RELEASE_API_URL`
   *  when unset, a bare line, or nothing but slashes. */
  releaseApiUrl: string;
  /** `CCRC_UPDATE_DEADLINE_MS` as a positive safe integer, else
   *  `DEFAULT_UPDATE_DEADLINE_MS`. Read by W4; carried from W2. */
  updateDeadlineMs: number;
```

In `loadConfig`, directly after `const port = portOk ? portNum : 7788;` (`:312`):

```ts
  // Hoisted for the `port`/`origin` reason above: `role` is derived FROM the
  // fleet mode, and one expression read twice is how the two come to disagree.
  const fleetMode: FleetMode = env.CCRC_FLEET === 'remote' ? 'remote' : 'local';
  const { role, roleSource } = deriveRole(env, fleetMode);
  const installedCcrcPath = path.join(home, 'ccrc', 'ccd', 'ccrc');
  const releaseApiUrl = (env.CCRC_RELEASE_API_URL || '').replace(/\/+$/, '');
  const deadlineNum = Number(env.CCRC_UPDATE_DEADLINE_MS);
```

In the returned literal, replace `fleetMode: env.CCRC_FLEET === 'remote' ? 'remote' : 'local',` (`:333`) with:

```ts
    fleetMode,
    role,
    roleSource,
```

and directly after `buildInfoPath: path.join(home, '.ccrc', 'build.json'),` (`:349`):

```ts
    ccrcDir: path.join(home, '.ccrc'),
    installedCcrcPath,
    releaseSource: readReleaseSource(env, installedCcrcPath),
    // `||` in effect for both knobs: '' trims to '' and falls to the default,
    // and `Number('')` is 0, which the positive test refuses.
    releaseApiUrl: releaseApiUrl || DEFAULT_RELEASE_API_URL,
    updateDeadlineMs: Number.isSafeInteger(deadlineNum) && deadlineNum > 0 ? deadlineNum : DEFAULT_UPDATE_DEADLINE_MS,
```

In `server/src/index.ts`, change the import on `:2` in place (line-neutral):

```ts
import { derivedRoleNote, loadConfig } from './config.js';
```

and append after the file's last line, `` console.log(`ccrc-server on ${cfg.host}:${cfg.port} (fleet=${cfg.fleetMode})`); `` (`:169`):

```ts

// Said once at boot, beside the line above: a role DERIVED because CCRC_ROLE
// is absent or invalid (D-3174) is visible nowhere else — the
// inventory's server row carries the role, never where it came from.
const roleNote = derivedRoleNote(cfg);
if (roleNote !== null) console.warn(roleNote);
```

It is appended, and not placed under `const cfg = loadConfig();` (`:23`), so that no `index.ts` line a later task anchors on moves (the Files block lists them). The cost is that a boot which dies inside `app.listen` never prints it. That boot prints its own error instead.

- [ ] **Step 4: Document the keys in `deploy/ccrc.env.example`**

Replace the `CCRC_ROLE` paragraph (the ten comment lines above `CCRC_ROLE=`, from `# The ROLE this box was installed as` through `# ~/.ccrc/agent.env (see ccrc-agent.env.example), never here.`) with:

```
# The ROLE this box was installed as — 'server', 'fleet' or 'both' — written
# once by `ccrc install --role …` (default: both, the single-box shape) into
# this file's first-write template. Its readers are the ccrc CLI's stage-4
# verbs — `ccrc update` re-runs the install spine with this role, and
# `ccrc logs`/`ccrc uninstall` pick the unit it names (fleet ->
# ccrc-agent.service) — and, since the update control plane (design
# 2026-09-20, W2), the SERVER: it is the role of this box's own row on
# GET /api/updates, and a 'server' or 'both' box writes its own
# ~/.ccrc/update-intent. Absent (a box whose env file predates the key, or
# this bare line) or unrecognisable, the CLI verbs fall back to the default
# 'both' behaviour and the server DERIVES a role from CCRC_FLEET instead
# (remote -> server, local -> both), so leaving it empty changes nothing
# today. A fleet box's server connection lives in ~/.ccrc/agent.env (see
# ccrc-agent.env.example), never here.
```

(the `CCRC_ROLE=` line itself is unchanged), and append at the end of the file:

```

# ── THE UPDATE CONTROL PLANE (design 2026-09-20, W2) — ALL OPTIONAL ───────
#
# Where the release catalogue is listed from. Default if unset: the owner/repo
# pair on the CCRC_RELEASE_OWNER= / CCRC_RELEASE_REPO= lines of the INSTALLED
# tree's ccd/ccrc (~/ccrc/ccd/ccrc — the tree ccrc.service runs), the same pair
# `ccrc update` downloads from. Set BOTH to override (a fork's listing, a
# mirror's); one set without the other is ignored. A value that is not a plain
# GitHub name ([A-Za-z0-9._-], at most 100, not only dots) leaves the catalogue
# unpolled — GET /api/updates reports `no-release-source` — rather than falling
# back to the tree's pair. The override is the SERVER's alone: `ccrc update`
# keeps downloading from its own pair.
# CCRC_RELEASE_OWNER=
# CCRC_RELEASE_REPO=
#
# The releases API root. Default if unset: https://api.github.com — the sibling
# of ccd/ccrc's CCRC_RELEASE_BASE_URL, so a fixture server stands in for GitHub
# in tests and a mirror can in life. Trailing slashes are trimmed.
# CCRC_RELEASE_API_URL=
#
# How long an update may run before the server calls it failed, in ms. Default
# if unset or not a positive integer: 900000 (15 minutes). Stored from W2;
# nothing reads it until the dispatcher lands (W4).
# CCRC_UPDATE_DEADLINE_MS=
```

- [ ] **Step 5: Run to verify they pass**

Run (foreground, one at a time, timeout ≥ 600000 ms): `cd server && ./node_modules/.bin/vitest run test/config.test.ts`, then `test/single-definition.test.ts -t 'never name the org'`, then `test/gitignore-secrets.test.ts`, then `test/boot.test.ts`, then `test/typecheck-tests.test.ts`; and `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts -t 'bakes NOTHING'`
Expected: PASS. `boot.test.ts` boots the real `index.ts` with no `CCRC_ROLE`, so the derived-role line goes to its drained stderr, and `/health` still answers. `deploy-verify` still finds its seven documented keys in `ccrc.env.example`. The org scan stays green: `config.ts` spells the two variable NAMES and never a value. `gitignore-secrets` keeps `deploy/ccrc.env.example` tracked. `typecheck-tests` compiles every test that builds a config through `loadConfig` (all of them — no test types a `CcrcConfig` literal, measured: `grep -rn ': CcrcConfig = {' server/test` is empty). It is a known load flake, so if it reds, re-run it in isolation before calling it a break.

- [ ] **Step 6: Mutation measurement**

Make each edit, run `test/config.test.ts`, see the named case red, restore by editing, re-run green:

1. D-3174, invalid never folded: in `deriveRole`, return `roleSource: 'derived-absent'` unconditionally. Reds `an out-of-vocabulary …` (4 rows).
2. D-3174, the vocabulary gate: replace `if (isNodeRole(raw))` with `if (raw) return { role: raw as NodeRole, roleSource: 'recorded' };` and delete the original line. Reds `an out-of-vocabulary …`.
3. D-3175, both-or-neither: in `readReleaseSource`, `envOwner && envRepo` → `envOwner || envRepo`. Reds `ONE env key set is ignored …`.
4. Absent vs unreadable: map every errno to `'tree-unreadable'`. Reds `keeps ABSENT, UNREADABLE and MALFORMED apart …` and `loadConfig reads <home>/ccrc/ccd/ccrc …`.
5. D-3196, the dot-only guard: delete `(?!\.+$)` from `RELEASE_SOURCE_VALUE`. Reds `refuses a value of two dots`, `refuses a value of one dot` and the `env-malformed` case's second assertion.
6. Exactly once: `owners.length !== 1 || repos.length !== 1` → `owners.length === 0 || repos.length === 0`. Reds `refuses the owner twice`.
7. D-3196, the env override's silent fallback: replace the `env-malformed` arm with falling through to the tree read. Reds `both env keys set with a value that is not a plain name REFUSES …`.
8. The house `||` rule: `(env.CCRC_RELEASE_API_URL || '')` → `(env.CCRC_RELEASE_API_URL ?? DEFAULT_RELEASE_API_URL)` and `releaseApiUrl || DEFAULT_RELEASE_API_URL` → `releaseApiUrl`. Reds `… a bare line or bare slashes is unset`.
9. The org scan, against this task's own seam: paste the value of `ccd/ccrc`'s `CCRC_RELEASE_OWNER` line as a string default into `readReleaseSource` (for example `?? '<that value>'` after `envOwner`), then run `test/single-definition.test.ts -t 'never name the org'`. It reds naming `server/src/config.ts`. Restore before anything else; that value must never be committed from a TS root.
10. D-3174, the reader's words: in `derivedRoleNote`, map both derived sources to `'absent'`. Reds `derivedRoleNote: a recorded role says nothing …` (its invalid assertions).
11. D-3174, the reader exists: delete the two appended statements from `index.ts` (keep the import). Reds `index.ts says it once at boot …` (its `toHaveLength(1)` and its statement match). The compiler catches none of this: vitest does not typecheck, and an unused import is not an error here (no `server` tsconfig sets `noUnusedLocals`, measured).
12. The reader is quiet for a recorded role: in `derivedRoleNote`, delete `if (c.roleSource === 'recorded') return null;`. Reds `derivedRoleNote: a recorded role says nothing …` (its two `toBeNull` assertions).
13. The line anchor: in `parseReleaseSource`, replace the two `pick(...)` calls with `[...ccrcText.matchAll(/^CCRC_RELEASE_OWNER="([^"]+)"$/gm)]` and `[...ccrcText.matchAll(/^CCRC_RELEASE_REPO="([^"]+)"$/gm)]`. Reds `refuses a CRLF line …` and nothing else (measured with node against the eleven refusal rows: only the CRLF row changes answer).

Case counts before/after (vitest's summary line): `config.test.ts` gains 35 cases. That is 12 for `deriveRole` (recorded ×3, absent, bare line, invalid ×4, loadConfig, the note's words, the note's one call), 20 for the release source (parses, refusals ×11, the real tree, tree, both-env, half-env, env-malformed, three words, unreadable, loadConfig) and 3 for the knobs. The same number must be green before and after every restore.

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/index.ts server/test/config.test.ts deploy/ccrc.env.example
git commit -m "feat(update): config carries the box's role (recorded or derived, and says which at boot), the release source read from the installed tree, ccrcDir, and the two update knobs"
```

### Task 10: The catalogue poller

**Files:**
- Create: `server/src/update/catalogue.ts`
- Modify: `server/src/pools.ts` — `export` on `openPoolReadDeadline` (`:37`) and `PoolReadDeadline` (`:27`), bodies unchanged
- Modify: `server/src/watch.ts` — `const UPDATE_CATALOGUE_MS = 30 * 60_000;` beside `CAPS_REFRESH_MS` (`:191`), `private lastCatalogueAt = 0;` beside `lastCapsAt` (`:471`), the gated `void … .catch` dispatch at the TOP of `tick()`'s `try` (directly after `this.ticking = true;` / `try {`, `:787-788`), ABOVE the registry read (`:811`) and its fail-shut return (`:828`) — not beside the caps block (ruling R8, D-3198)
- Modify: `server/src/server.ts` — `Deps` (`:227-296`) gains `catalogue?: CataloguePoller`
- Modify: `server/src/index.ts` — construct the poller beside `coord` (`:67`) and put it in both `deps` arms; one `console.warn` when `cfg.releaseSource.ok === false` (every line number here is `d759c914`'s; Task 9's R9 boot line may land in this file first, so each edit is anchored by its quoted text)
- Modify: `server/test/single-definition.test.ts` — append `'catalogue.ts'` to `UPDATE_RING_FILES` — ONE line replaced in place, so LINE-NEUTRAL (ruling R13: the session-hook citation audit cites this file at `:32-37`, `:1274`, `:1303`); Step 7's green run includes `session-hook.test.ts`
- Test: `server/test/update-catalogue.test.ts` (create) — a loopback `node:http` server on `listen(0, '127.0.0.1')` (the `ccrc-api.test.ts:52-65` shape), never `vi.stubGlobal('fetch')`

**Interfaces:**
- Consumes: `ReleaseSourceRead` (all three arms: `{ok: true; owner; repo; from}`, `{ok: false; why: 'tree-absent' | 'tree-unreadable' | 'tree-malformed'; path: string}`, `{ok: false; why: 'env-malformed'; path: null}`), `cfg.releaseSource`, `cfg.releaseApiUrl` (Task 9); `applyReleaseListing`, `ReleaseListingRow`, `ListingCoverage`, `ApplyReleaseListingResult` (Task 4); `CatalogueState`, `CatalogueErrorReason`, `isReleaseTag` (Task 1); `openPoolReadDeadline` (`pools.ts`). `update/catalogue.ts` imports `shared/api.ts` as `'../../../shared/api.js'` — three levels (ruling R7).
- Produces:

```ts
export const RELEASES_PER_PAGE = 30;
// CORRECTION (fix round 2, R5/C1): these five were shipped by R1/R9/F10 but
// never added here. `CATALOGUE_MAX_REQUESTS_PER_POLL` and
// `UNAUTHENTICATED_HOURLY_REQUEST_BUDGET` are the two constants
// `routes.ts`'s refresh door derives its interval from (D-3218; corrected
// C3, `CATALOGUE_POLL_INTERVAL_MS` joins them); `apiBaseProblem` is
// exported so the base is validated once at poller creation.
export const CATALOGUE_MAX_REQUESTS_PER_POLL = 3;
export const UNAUTHENTICATED_HOURLY_REQUEST_BUDGET = 60;
export const CATALOGUE_POLL_INTERVAL_MS = 30 * 60_000;   // corrected C3: catalogue.ts owns the scheduled cadence, watch.ts imports it
export const CATALOGUE_TIMEOUT_MS = 10_000;
export const NOTES_CAP_BYTES = 4096;
export const NOTES_MARKER = '…';
export const CATALOGUE_BODY_MAX_BYTES = 8 * 1024 * 1024;
export const DOWNLOAD_URL_MAX = 2048;
export function apiBaseProblem(apiUrl: string): string | null;
/** The port this module needs, declared by the consumer (L2). CORRECTION
 *  (fix round 2, R5/D-3217's class): `keepTags`/`withdrawTag` (fix round 1,
 *  ruling A) are optional so an older test double written against the
 *  three-argument shape still type-checks — the real store always accepts
 *  them; `newestUnyankedStable` is ALSO optional for the same reason, and
 *  `currentK` reads it through `?.() ?? null`. */
export interface CatalogueStore {
  applyReleaseListing(
    listing: readonly ReleaseListingRow[], now: number, coverage: ListingCoverage,
    keepTags?: readonly string[], withdrawTag?: string | null,
  ): ApplyReleaseListingResult;
  newestUnyankedStable?(): string | null;
}
export interface CatalogueDeps { source: ReleaseSourceRead; apiUrl: string; store: CatalogueStore; timeoutMs?: number }
export interface CataloguePoller {
  poll(now: number): Promise<CatalogueState>;   // single-flight: a poll during a poll returns the in-flight promise
  state(): CatalogueState;                      // {lastOkAt: null, lastError: null} until the first answer
  // null = never requested. CORRECTION (fix round 2, R5/C1; value corrected
  // fix round 3, B3, D-3218 amended): the refresh route's guard is not a
  // bare minute — it is REFRESH_MIN_INTERVAL_MS, derived (D-3218) from
  // CATALOGUE_MAX_REQUESTS_PER_POLL, UNAUTHENTICATED_HOURLY_REQUEST_BUDGET,
  // CATALOGUE_POLL_INTERVAL_MS and a one-poll margin — 211,765 ms with
  // today's values, never a hand-typed one.
  lastRequestAt(): number | null;
}
export function createCataloguePoller(deps: CatalogueDeps): CataloguePoller;
export interface ParsedListing { rows: ReleaseListingRow[]; skipped: number; coverage: ListingCoverage }
/** null = the body is not an array (→ 'malformed'); a malformed element is skipped, never thrown;
 *  coverage is 'complete' iff the RAW array length < RELEASES_PER_PAGE. */
export function parseReleaseListing(body: unknown): ParsedListing | null;
/** null = no body; otherwise at most NOTES_CAP_BYTES UTF-8 bytes cut on a code-point boundary, plus NOTES_MARKER when cut. */
export function capNotes(body: unknown): string | null;
```

- Request: `GET {apiUrl}/repos/{owner}/{repo}/releases?per_page=30`, `Accept: application/vnd.github+json`, `If-None-Match: <etag>` when one is held, no token, `signal` from the deadline. CORRECTION (fix round 2, R5/C1): this is one of up to THREE requests a poll may send (fix round 1, ruling A / D-3215 / D-3218) — the latest-release probe (`GET .../releases/latest`) always, the listing always, and — only when `/latest` has moved away from the kept stable tag and the check has not yet resolved — one further `GET .../releases/tags/{k}`, never a loop within one poll. Answers: 304 → nothing written, `lastOkAt = now`; 200 → parse, `applyReleaseListing`, ETag kept only when the store accepted; 403/429 → `'rate-limited'`; other non-2xx → `` `http-${status}` ``; a 3xx (the fetch runs with `redirect: 'error'`, D-3209) → `'redirect'`; a throw or deadline → `'no-egress'`; unparseable body or a store refusal → `'malformed'`; `source.ok === false` → `'no-release-source'` with NO request. Every error arm sets `lastError` and leaves `lastOkAt` untouched. A row: `tag` = `tag_name` (must pass `isIngestibleReleaseTag`, D-3216 — a byte-length cap, an 18-digit-per-component cap and a same-value-twice leading-zero guard, on top of `isReleaseTag`), `channel` = `prerelease ? 'dev' : 'stable'`, `draft` = `draft === true`, `publishedAt` = `Date.parse(published_at)`, `commitSha` = `target_commitish` iff `/^[0-9a-f]{40}$/`, `tarballUrl` = `safeDownloadUrl` of the `browser_download_url` of the asset named `ccrc-<tag>.tar.gz` — `null` on no matching asset OR any of `safeDownloadUrl`'s own refusals (non-https, non-ASCII, userinfo, any `\` at all, over `DOWNLOAD_URL_MAX` either raw OR as the stored, percent-encoded `u.href`) — the element itself is KEPT either way (D-3216; F10 corrects the plan's original "absent → element skipped"), `bundleListed` = an asset named `ccrc-<tag>.tar.gz.sigstore.json` exists.
- Refinements of the skeleton's answer table this body writes (no interface change): a 304 answered to a request that sent NO `If-None-Match` is `'http-304'`, not success (nothing was held to be "not modified"); a 2xx other than 200 is `` `http-${status}` ``; a successful answer (200 accepted, or 304 to a sent ETag) sets `lastError = null` (D-3197); the request also sends `User-Agent: ccrc-server` (GitHub's REST API requires one; the global `fetch` would otherwise send its runtime default); an element whose `prerelease` is not a boolean is skipped rather than defaulted to `stable`.

Spec §18 rows this task pins: "a yanked release is kept" (end to end through Task 4's writer), "notes are capped and plain" (the cap — the plain renderer is W3's), "errors never move `lastOkAt`"; plus D-3185's raw-count coverage, D-3206's transient yank of a known release whose element is skipped (Task 4's departure; this task's case pins it end to end), D-3182's first-tick poll, and D-3198's catalogue half (the lane polls on a tick whose registry will not list — ruling R8). "`refresh` is rate-limited" is Task 13's route guard; this task ships the `lastRequestAt()` it reads.

- [ ] **Step 1: Write the failing test**

Create `server/test/update-catalogue.test.ts`:

```ts
// The release-catalogue poller (design 2026-09-20 §7; plan W2 Task 10).
//
// A REAL loopback HTTP server stands in for GitHub, never
// `vi.stubGlobal('fetch')`: the pins below are about a conditional GET — the
// second poll must SEND `If-None-Match` and a 304 must write nothing — and a
// stubbed global cannot read the request's headers to decide whether to answer
// 304. Same fixture shape as `ccrc-api.test.ts:52-65` (`listen(0,
// '127.0.0.1')`, the port read back off `server.address()`).
//
// The store behind the poller is the REAL `CoordStore` on a fixture
// `coord.db` (Task 4's `applyReleaseListing`), wrapped in a recorder so a
// case can say both "the store was not called" and "the rows are what they
// were". Owner/repo are invented; no TS root may spell the real org
// (`single-definition.test.ts`, "the four TS roots never name the org").
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type ListingCoverage, type ReleaseListingRow } from '../src/coord/store.js';
import type { ReleaseSourceRead } from '../src/config.js';
import {
  NOTES_CAP_BYTES, NOTES_MARKER, RELEASES_PER_PAGE, capNotes, createCataloguePoller, parseReleaseListing,
  type CatalogueStore, type CataloguePoller,
} from '../src/update/catalogue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const SOURCE: ReleaseSourceRead = { ok: true, owner: 'fixture-owner', repo: 'fixture-repo', from: 'env' };

/** One element of GitHub's `GET /repos/{o}/{r}/releases` answer, in the
 *  documented shape, carrying the three artifacts `deploy/release-main.sh`
 *  publishes (`:128`: `ccrc-$tag.tar.gz`, `SHA256SUMS`,
 *  `ccrc-$tag.tar.gz.sigstore.json`). */
function rel(tag: string, publishedAt: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const dl = (name: string) => ({ name, browser_download_url: `https://example.invalid/releases/download/${tag}/${name}` });
  return {
    tag_name: tag, name: tag, draft: false, prerelease: false, published_at: publishedAt,
    target_commitish: SHA, body: `notes for ${tag}`,
    assets: [dl(`ccrc-${tag}.tar.gz`), dl('SHA256SUMS'), dl(`ccrc-${tag}.tar.gz.sigstore.json`)],
    ...over,
  };
}

/** `n` well-formed releases v0.0.1..v0.0.n, each published a minute after the last. */
function page(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) =>
    rel(`v0.0.${i + 1}`, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()));
}

describe('parseReleaseListing — one GitHub element, one row (design §7)', () => {
  it('maps the documented fields onto the catalogue columns', () => {
    const p = parseReleaseListing([rel('v0.0.9', '2026-09-20T10:00:00Z')]);
    expect(p).not.toBeNull();
    expect(p!.skipped).toBe(0);
    expect(p!.rows).toEqual([{
      tag: 'v0.0.9', channel: 'stable', publishedAt: Date.parse('2026-09-20T10:00:00Z'), commitSha: SHA,
      tarballUrl: 'https://example.invalid/releases/download/v0.0.9/ccrc-v0.0.9.tar.gz', bundleListed: true,
      notes: 'notes for v0.0.9', draft: false,
    }]);
  });

  it('prerelease: true is the dev channel; a draft is carried for the store to mark', () => {
    const p = parseReleaseListing([
      rel('v0.0.10', '2026-09-21T10:00:00Z', { prerelease: true }),
      rel('v0.0.11', '2026-09-22T10:00:00Z', { draft: true }),
    ]);
    expect(p!.rows.map((r) => [r.tag, r.channel, r.draft])).toEqual([
      ['v0.0.10', 'dev', false],
      ['v0.0.11', 'stable', true],
    ]);
  });

  it('bundleListed is the presence of the .sigstore.json asset — a filename, never a verification', () => {
    const noBundle = rel('v0.0.9', '2026-09-20T10:00:00Z', {
      assets: [{ name: 'ccrc-v0.0.9.tar.gz', browser_download_url: 'https://example.invalid/t.tar.gz' }],
    });
    // A bundle for ANOTHER tag does not list this one's.
    const otherBundle = rel('v0.0.8', '2026-09-19T10:00:00Z', {
      assets: [
        { name: 'ccrc-v0.0.8.tar.gz', browser_download_url: 'https://example.invalid/t8.tar.gz' },
        { name: 'ccrc-v0.0.7.tar.gz.sigstore.json', browser_download_url: 'https://example.invalid/b7' },
      ],
    });
    expect(parseReleaseListing([noBundle, otherBundle])!.rows.map((r) => r.bundleListed)).toEqual([false, false]);
  });

  it('commitSha is target_commitish only when it is 40 lowercase hex', () => {
    const rows = parseReleaseListing([
      rel('v0.0.1', '2026-09-01T00:00:00Z', { target_commitish: 'main' }),
      rel('v0.0.2', '2026-09-02T00:00:00Z', { target_commitish: SHA.toUpperCase() }),
      rel('v0.0.3', '2026-09-03T00:00:00Z', { target_commitish: 42 }),
      rel('v0.0.4', '2026-09-04T00:00:00Z'),
    ])!.rows;
    expect(rows.map((r) => r.commitSha)).toEqual([null, null, null, SHA]);
  });

  it('a malformed element is SKIPPED and counted, never thrown', () => {
    const good = rel('v0.0.9', '2026-09-20T10:00:00Z');
    const p = parseReleaseListing([
      null, 'v0.0.1', 7, [], {},
      rel('v0.0', '2026-09-20T10:00:00Z'),                        // not the tag shape
      rel('0.0.2', '2026-09-20T10:00:00Z'),                       // no v
      rel('v0.0.3', '2026-09-20T10:00:00Z', { prerelease: 'yes' }), // never defaulted to stable
      rel('v0.0.4', 'not a date'),
      rel('v0.0.5', '2026-09-20T10:00:00Z', { assets: 'none' }),
      rel('v0.0.6', '2026-09-20T10:00:00Z', { assets: [] }),       // no tarball asset
      rel('v0.0.7', '2026-09-20T10:00:00Z', {
        assets: [{ name: 'ccrc-v0.0.7.tar.gz', browser_download_url: 'javascript:alert(1)' }],
      }),
      good,
    ]);
    expect(p!.rows.map((r) => r.tag)).toEqual(['v0.0.9']);
    expect(p!.skipped).toBe(12);
  });

  it('a body that is not an array is null — the poll reads it as malformed', () => {
    for (const body of [null, {}, 'releases', 3, { releases: [] }]) {
      expect(parseReleaseListing(body), JSON.stringify(body)).toBeNull();
    }
  });

  // D-3185: the store may mark "absent now" as yanked only across
  // the whole catalogue when the listing IS the whole catalogue. The page is
  // full at RELEASES_PER_PAGE elements, and that is a fact about the RAW
  // array: a malformed element skipped from a full page must not make the
  // page look complete, or the 31st release would be yanked on that poll.
  it('coverage comes from the RAW element count, not the parsed rows', () => {
    expect(RELEASES_PER_PAGE).toBe(30);
    expect(parseReleaseListing(page(29))!.coverage).toBe('complete');
    expect(parseReleaseListing(page(30))!.coverage).toBe('newest-page');
    const fullWithOneBad = [...page(29), { tag_name: 'garbage' }];
    const p = parseReleaseListing(fullWithOneBad)!;
    expect(p.rows).toHaveLength(29);
    expect(p.skipped).toBe(1);
    expect(p.coverage).toBe('newest-page');
    expect(parseReleaseListing([])!.coverage).toBe('complete');
  });
});

describe('capNotes — plain text, 4096 UTF-8 bytes, then the marker (§7, §18 "notes are capped and plain")', () => {
  it('a 5000-byte body is 4096 bytes plus the marker', () => {
    expect(NOTES_CAP_BYTES).toBe(4096);
    expect(NOTES_MARKER).toBe('…');
    expect(capNotes('a'.repeat(5000))).toBe(`${'a'.repeat(4096)}…`);
  });

  it('a body of exactly the cap is kept whole, with no marker', () => {
    expect(capNotes('a'.repeat(4096))).toBe('a'.repeat(4096));
  });

  it('the cut never splits a code point', () => {
    // '€' is three UTF-8 bytes: 1365 of them are 4095 bytes, the 1366th would cross 4096.
    const out = capNotes('€'.repeat(2000))!;
    expect(out).toBe(`${'€'.repeat(1365)}…`);
    expect(Buffer.byteLength(out.slice(0, -1), 'utf8')).toBe(4095);
    // A four-byte code point (a surrogate pair in JS) lands exactly on the cap.
    expect(capNotes('😀'.repeat(1100))).toBe(`${'😀'.repeat(1024)}…`);
  });

  it('no body is null — an empty string, a null, a non-string', () => {
    for (const b of ['', null, undefined, 12, { text: 'x' }]) expect(capNotes(b)).toBeNull();
  });
});

describe('the poller against a loopback fixture (design §7 Pins)', () => {
  type Answer = { status: number; etag?: string; body?: unknown } | 'hang';
  let server: Server;
  let base: string;
  let seen: { method: string; url: string; headers: IncomingMessage['headers'] }[];
  /** What the fixture answers, one entry per request, in order. */
  let script: Answer[];

  beforeEach(async () => {
    seen = [];
    script = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      const a = script.shift() ?? { status: 500, body: 'fixture: no answer scripted' };
      if (a === 'hang') return;   // never answered — the deadline's case
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (a.etag !== undefined) headers.etag = a.etag;
      res.writeHead(a.status, headers);
      res.end(a.body === undefined ? '' : typeof a.body === 'string' ? a.body : JSON.stringify(a.body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();   // a 'hang' request would otherwise hold close() open
    await new Promise<void>((r) => { server.close(() => r()); });
  });

  function fixture(): { store: CoordStore; port: CatalogueStore; calls: { listing: readonly ReleaseListingRow[]; now: number; coverage: ListingCoverage }[] } {
    const store = new CoordStore(openCoordDb(path.join(mkTmp('update-catalogue-'), 'coord.db')));
    const calls: { listing: readonly ReleaseListingRow[]; now: number; coverage: ListingCoverage }[] = [];
    const port: CatalogueStore = {
      applyReleaseListing(listing, now, coverage) {
        calls.push({ listing, now, coverage });
        return store.applyReleaseListing(listing, now, coverage);
      },
    };
    return { store, port, calls };
  }

  function poller(port: CatalogueStore, over: Partial<{ source: ReleaseSourceRead; apiUrl: string; timeoutMs: number }> = {}): CataloguePoller {
    return createCataloguePoller({ source: SOURCE, apiUrl: base, store: port, ...over });
  }

  // D-3182: a fresh process says "never checked"
  // until its first answer — never "up to date", never an error it did not see.
  it('a fresh poller has never checked and has sent nothing', () => {
    const p = poller(fixture().port);
    expect(p.state()).toEqual({ lastOkAt: null, lastError: null });
    expect(p.lastRequestAt()).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('asks GitHub the documented question: one page of 30, the v3 media type, no token, no ETag yet', async () => {
    const { port } = fixture();
    script = [{ status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
    await poller(port).poll(1000);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe('GET');
    expect(seen[0]!.url).toBe('/repos/fixture-owner/fixture-repo/releases?per_page=30');
    expect(seen[0]!.headers.accept).toBe('application/vnd.github+json');
    expect(seen[0]!.headers['user-agent']).toBe('ccrc-server');
    expect(seen[0]!.headers.authorization).toBeUndefined();
    expect(seen[0]!.headers['if-none-match']).toBeUndefined();
  });

  it('a second poll sends If-None-Match, and a 304 writes no rows but is an answer', async () => {
    const { store, port, calls } = fixture();
    const p = poller(port);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z'), rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 304, etag: '"e1"' },
    ];
    const first = await p.poll(1000);
    expect(first).toEqual({ lastOkAt: 1000, lastError: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.coverage).toBe('complete');
    const rowsAfterFirst = store.releases();
    expect(rowsAfterFirst.map((r) => [r.tag, r.observedAt])).toEqual([['v0.0.2', 1000], ['v0.0.1', 1000]]);

    const second = await p.poll(2000);
    expect(seen[1]!.headers['if-none-match']).toBe('"e1"');
    expect(calls).toHaveLength(1);                     // the store was not asked
    expect(store.releases()).toEqual(rowsAfterFirst);  // observedAt did not move either
    expect(second).toEqual({ lastOkAt: 2000, lastError: null });
    expect(p.state()).toEqual(second);
    expect(p.lastRequestAt()).toBe(2000);
  });

  it('a 304 to a request that sent no ETag is not "not modified" — it is http-304', async () => {
    const { port } = fixture();
    const p = poller(port);
    script = [{ status: 304 }];
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'http-304' } });
  });

  it('a release that vanishes from a complete listing is yanked, never deleted (§18 "a yanked release is kept")', async () => {
    const { store, port } = fixture();
    const p = poller(port);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z'), rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 200, etag: '"e2"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z')] },
    ];
    await p.poll(1000);
    await p.poll(2000);
    expect(store.releases().map((r) => [r.tag, r.yanked])).toEqual([['v0.0.2', false], ['v0.0.1', true]]);
  });

  // D-3206: GitHub still LISTS v0.0.1 on the
  // second poll, but its element has lost its tarball asset, so the parser
  // skips it and the store never sees it. The row reads absent for that poll
  // and is yanked, which is fail-closed: it was not upserted, so its columns
  // are the first poll's. It is kept, not rewritten, and it comes back on the
  // first poll that parses it.
  it('a known release whose element is skipped is yanked for that poll, and comes back when it parses again', async () => {
    const { store, port, calls } = fixture();
    const p = poller(port);
    const v1 = rel('v0.0.1', '2026-09-01T00:00:00Z');
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z'), v1] },
      { status: 200, etag: '"e2"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z'), { ...v1, assets: [] }] },
      { status: 200, etag: '"e3"', body: [rel('v0.0.2', '2026-09-02T00:00:00Z'), v1] },
    ];
    await p.poll(1000);
    expect((await p.poll(2000)).lastError).toBeNull();
    expect(calls[1]!.listing.map((r) => r.tag)).toEqual(['v0.0.2']);   // the skip happened in the parser
    expect(calls[1]!.coverage).toBe('complete');                          // the RAW body held 2 elements
    expect(store.releases().map((r) => [r.tag, r.yanked, r.observedAt, r.tarballUrl])).toEqual([
      ['v0.0.2', false, 2000, 'https://example.invalid/releases/download/v0.0.2/ccrc-v0.0.2.tar.gz'],
      ['v0.0.1', true, 1000, 'https://example.invalid/releases/download/v0.0.1/ccrc-v0.0.1.tar.gz'],
    ]);
    await p.poll(3000);
    expect(store.releases().map((r) => [r.tag, r.yanked, r.observedAt])).toEqual([
      ['v0.0.2', false, 3000],
      ['v0.0.1', false, 3000],
    ]);
  });

  it('prerelease: true reaches the store as dev, and the .sigstore.json asset as bundleListed', async () => {
    const { store, port } = fixture();
    script = [{ status: 200, etag: '"e1"', body: [
      rel('v0.0.2', '2026-09-02T00:00:00Z', { prerelease: true }),
      rel('v0.0.1', '2026-09-01T00:00:00Z', {
        assets: [{ name: 'ccrc-v0.0.1.tar.gz', browser_download_url: 'https://example.invalid/t1.tar.gz' }],
      }),
    ] }];
    await poller(port).poll(1000);
    expect(store.releases().map((r) => [r.tag, r.channel, r.bundleListed])).toEqual([
      ['v0.0.2', 'dev', true],
      ['v0.0.1', 'stable', false],
    ]);
  });

  it('a 403 is rate-limited: every prior row intact, lastOkAt unchanged (§18 "errors never move lastOkAt")', async () => {
    const { store, port, calls } = fixture();
    const p = poller(port);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 403, body: { message: 'API rate limit exceeded' } },
      { status: 429, body: { message: 'slow down' } },
    ];
    await p.poll(1000);
    const before = store.releases();
    expect(await p.poll(2000)).toEqual({ lastOkAt: 1000, lastError: { at: 2000, reason: 'rate-limited' } });
    expect(await p.poll(3000)).toEqual({ lastOkAt: 1000, lastError: { at: 3000, reason: 'rate-limited' } });
    expect(store.releases()).toEqual(before);
    expect(calls).toHaveLength(1);
  });

  it('any other status is http-<status>, and lastOkAt stays null on a catalogue that never answered', async () => {
    const { port } = fixture();
    const p = poller(port);
    script = [{ status: 500 }, { status: 404, body: { message: 'Not Found' } }, { status: 204 }];
    expect((await p.poll(1000)).lastError).toEqual({ at: 1000, reason: 'http-500' });
    expect((await p.poll(2000)).lastError).toEqual({ at: 2000, reason: 'http-404' });
    expect(await p.poll(3000)).toEqual({ lastOkAt: null, lastError: { at: 3000, reason: 'http-204' } });
  });

  // D-3197: lastError is the CURRENT failure, so a recovery
  // clears it; lastOkAt is when the catalogue was last known good.
  it('an answer after an error clears lastError', async () => {
    const { port } = fixture();
    const p = poller(port);
    script = [{ status: 502 }, { status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
    expect((await p.poll(1000)).lastError).toEqual({ at: 1000, reason: 'http-502' });
    expect(await p.poll(2000)).toEqual({ lastOkAt: 2000, lastError: null });
  });

  it('a refused connection is no-egress', async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const deadPort = (dead.address() as AddressInfo).port;
    await new Promise<void>((r) => { dead.close(() => r()); });
    const p = poller(fixture().port, { apiUrl: `http://127.0.0.1:${deadPort}` });
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'no-egress' } });
    expect(p.lastRequestAt()).toBe(1000);   // a request was attempted, and it counts against the minute
  });

  it('a server that never answers is no-egress at the deadline, and the poll resolves', async () => {
    const p = poller(fixture().port, { timeoutMs: 200 });
    script = ['hang'];
    const t0 = Date.now();
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'no-egress' } });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(seen).toHaveLength(1);
  }, 10_000);

  it('an unparseable or non-array body is malformed, and the ETag of the last ACCEPTED listing is kept', async () => {
    const { store, port } = fixture();
    const p = poller(port);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 200, etag: '"e2"', body: 'not json at all' },
      { status: 200, etag: '"e3"', body: { releases: [] } },
      { status: 304, etag: '"e1"' },
    ];
    await p.poll(1000);
    const before = store.releases();
    expect(await p.poll(2000)).toEqual({ lastOkAt: 1000, lastError: { at: 2000, reason: 'malformed' } });
    expect(await p.poll(3000)).toEqual({ lastOkAt: 1000, lastError: { at: 3000, reason: 'malformed' } });
    expect(store.releases()).toEqual(before);
    await p.poll(4000);
    expect(seen.map((s) => s.headers['if-none-match'])).toEqual([undefined, '"e1"', '"e1"', '"e1"']);
  });

  it('a store refusal is malformed: an empty listing while rows are known writes nothing (Task 4, D-3185)', async () => {
    const { store, port, calls } = fixture();
    const p = poller(port);
    script = [
      { status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] },
      { status: 200, etag: '"e2"', body: [] },
      { status: 304, etag: '"e1"' },
    ];
    await p.poll(1000);
    const before = store.releases();
    expect(await p.poll(2000)).toEqual({ lastOkAt: 1000, lastError: { at: 2000, reason: 'malformed' } });
    expect(calls).toHaveLength(2);                     // the store WAS asked, and refused
    expect(store.releases()).toEqual(before);          // nothing yanked by a transient []
    await p.poll(3000);
    expect(seen[2]!.headers['if-none-match']).toBe('"e1"');   // e2 was never accepted
  });

  it('a full page reaches the store as newest-page even when an element was skipped', async () => {
    const { port, calls } = fixture();
    script = [{ status: 200, etag: '"e1"', body: [...page(29), { tag_name: 'garbage' }] }];
    expect((await poller(port).poll(1000)).lastError).toBeNull();
    expect(calls[0]!.listing).toHaveLength(29);
    expect(calls[0]!.coverage).toBe('newest-page');
  });

  it('no release source: no request at all, and the reason says why', async () => {
    const { port, calls } = fixture();
    const p = poller(port, { source: { ok: false, why: 'tree-absent', path: '/nonexistent/ccrc/ccd/ccrc' } });
    expect(await p.poll(1000)).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'no-release-source' } });
    expect(seen).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(p.lastRequestAt()).toBeNull();   // nothing was spent against the hour's budget
  });

  it('single-flight: a poll during a poll returns the in-flight promise — one request', async () => {
    const { port } = fixture();
    const p = poller(port);
    script = [{ status: 200, etag: '"e1"', body: [rel('v0.0.1', '2026-09-01T00:00:00Z')] }];
    const a = p.poll(1000);
    const b = p.poll(1001);
    expect(b).toBe(a);
    expect(await a).toEqual({ lastOkAt: 1000, lastError: null });
    expect(seen).toHaveLength(1);
    // Once settled, the next poll is a new request.
    script = [{ status: 304, etag: '"e1"' }];
    await p.poll(2000);
    expect(seen).toHaveLength(2);
  });

  it('state() is a copy — a caller cannot edit the poller\'s memory', async () => {
    const { port } = fixture();
    const p = poller(port);
    script = [{ status: 500 }];
    await p.poll(1000);
    const s = p.state();
    s.lastError!.reason = 'edited';
    s.lastOkAt = 99;
    expect(p.state()).toEqual({ lastOkAt: null, lastError: { at: 1000, reason: 'http-500' } });
  });
});

describe('the catalogue lane — FleetWatcher.tick() (design §7: the CAPS_REFRESH_MS shape)', () => {
  afterEach(() => { vi.useRealTimers(); });

  function counting(): { polls: number[]; poller: CataloguePoller } {
    const polls: number[] = [];
    return {
      polls,
      poller: {
        poll: async (now: number) => { polls.push(now); return { lastOkAt: null, lastError: null }; },
        state: () => ({ lastOkAt: null, lastError: null }),
        lastRequestAt: () => null,
      },
    };
  }

  // The snapshot cache is the fixture home's, never `defaultCachePath()`
  // (the real `~/.ccrc`): a listable empty registry reaches `saveSnapshot`.
  function watcher(home: string, poller?: CataloguePoller): { w: FleetWatcher; registryDir: string } {
    const deps = { ...testDeps(home), ...(poller ? { catalogue: poller } : {}) };
    return { w: new FleetWatcher(deps, new Bus(), 2000, path.join(home, 'state-cache.json')), registryDir: deps.cfg.registryDir };
  }

  it('polls on the FIRST tick after start, then once per 30 minutes — never once a tick', async () => {
    const { polls, poller } = counting();
    const home = mkTmp('update-catalogue-lane-');
    const { w, registryDir } = watcher(home, poller);
    // Empty but LISTABLE, so the cadence is measured on ticks that run every
    // lane (the note in caps-refresh.test.ts's "asks once a minute, not once
    // a tick"); the unlistable case is the next one.
    mkdirSync(registryDir, { recursive: true });

    vi.useFakeTimers();
    await w.tick(); await w.tick(); await w.tick();
    expect(polls).toHaveLength(1);     // D-3182: lastCatalogueAt starts at 0

    // 29 minutes: a mutant that shrinks the cadence fires here.
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    await w.tick();
    expect(polls).toHaveLength(1);

    // Exactly 30 minutes since the first poll: the gate is `>=`, so it fires.
    await vi.advanceTimersByTimeAsync(60_000);
    await w.tick();
    expect(polls).toHaveLength(2);
    expect(polls[1]! - polls[0]!).toBe(30 * 60_000);
  });

  // D-3198 (ruling R8): the lane reads nothing from
  // the registry, so the registry's fail-shut return must not stop it.
  it('polls on a tick whose registry will not list — the gate sits above the fail-shut return', async () => {
    const { polls, poller } = counting();
    const home = mkTmp('update-catalogue-unlistable-');
    const { w } = watcher(home, poller);   // no .cc-sessions: tick() fails shut on the registry read
    await w.tick();
    expect(polls).toHaveLength(1);
  });

  it('a watcher with no catalogue ticks without one', async () => {
    const home = mkTmp('update-catalogue-none-');
    const { w, registryDir } = watcher(home);
    mkdirSync(registryDir, { recursive: true });
    await expect(w.tick()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/update-catalogue.test.ts` (foreground)
Expected: FAIL — the file does not load: `Error: Failed to load url ../src/update/catalogue.js (resolved id: ../src/update/catalogue.js) in …/server/test/update-catalogue.test.ts. Does the file exist?`

- [ ] **Step 3: Export the deadline from `pools.ts`**

In `server/src/pools.ts`, change the two declarations only — bodies byte-identical:

```ts
export interface PoolReadDeadline {
```

(was `interface PoolReadDeadline {`, `pools.ts:27`) and replace the one-line docstring and signature of `openPoolReadDeadline` (`pools.ts:36-37`) with:

```ts
/** One monotonic, aborting aggregate deadline for the complete pool read.
 *  Exported unchanged for `update/catalogue.ts`'s listing fetch and
 *  `update/inventory.ts`'s sweep: `signal` aborts the fetch, `race` turns a
 *  throw or the deadline into `null`, `close` clears the timer. */
export function openPoolReadDeadline(budgetMs: number): PoolReadDeadline | null {
```

- [ ] **Step 4: Create `server/src/update/catalogue.ts`**

```ts
import { isReleaseTag, type CatalogueErrorReason, type CatalogueState } from '../../../shared/api.js';
import type { ReleaseSourceRead } from '../config.js';
import type { ApplyReleaseListingResult, ListingCoverage, ReleaseListingRow } from '../coord/store.js';
import { openPoolReadDeadline } from '../pools.js';

/**
 * L3 — the release-catalogue poller (design 2026-09-20 §7).
 *
 * One conditional GET of GitHub's release listing, a defensive parse, and ONE
 * call to the store's one catalogue writer (`applyReleaseListing`, plan
 * D-3180). Nothing else here writes anything: the
 * port below has no delete and no per-row upsert, so "a yanked release is
 * kept" (§18) is a property of the only door this module holds.
 *
 * Quota (§7, measured): unauthenticated, 60 requests an hour per IP, and a
 * 304 still counts — the ETag saves bytes, not budget. The watcher polls every
 * 30 minutes; `POST /api/updates/refresh` reads `lastRequestAt()` for its
 * one-a-minute guard. No token is ever sent (decision 4: the repo carries no
 * secrets, and the server holds none for GitHub).
 *
 * Fail-soft, and the failure is an answer: every error arm sets `lastError`
 * and never `lastOkAt`, so no consumer can render a failed poll as "up to
 * date". `lastError` is the CURRENT failure — an answer clears it
 * (D-3197). The state and the ETag are this process's memory
 * (D-3182): a restarted server polls on its first
 * tick and says "never checked" until then; the rows themselves persist in
 * the store.
 *
 * `bundleListed` is a FILENAME in an unauthenticated listing, not a
 * verification — the node verifies (§5) and reports `provenance` (§8).
 */
export const RELEASES_PER_PAGE = 30;
/** A GitHub listing that has not answered in 10 s is not going to; the lane
 *  is void-dispatched, so this bounds a request, not the tick. */
export const CATALOGUE_TIMEOUT_MS = 10_000;
export const NOTES_CAP_BYTES = 4096;
export const NOTES_MARKER = '…';

/** GitHub's REST API refuses a request with no User-Agent; say who asks
 *  rather than send the runtime's default. */
const USER_AGENT = 'ccrc-server';
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DOWNLOAD_URL = /^https?:\/\/\S+$/;
const DOWNLOAD_URL_MAX = 2048;

/** The port this module needs, declared by the consumer (L2). */
export interface CatalogueStore {
  applyReleaseListing(listing: readonly ReleaseListingRow[], now: number, coverage: ListingCoverage): ApplyReleaseListingResult;
}

export interface CatalogueDeps { source: ReleaseSourceRead; apiUrl: string; store: CatalogueStore; timeoutMs?: number }

export interface CataloguePoller {
  /** Single-flight: a poll during a poll returns the in-flight promise. Resolves
   *  with the state after this poll; rejects only if the store's writer throws. */
  poll(now: number): Promise<CatalogueState>;
  /** `{lastOkAt: null, lastError: null}` until the first answer — "never checked". A copy. */
  state(): CatalogueState;
  /** The `now` of the last poll that SENT a request; `null` = never requested.
   *  A poll with no release source sends nothing and does not move it. */
  lastRequestAt(): number | null;
}

export interface ParsedListing { rows: ReleaseListingRow[]; skipped: number; coverage: ListingCoverage }

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const httpReason = (status: number): CatalogueErrorReason => `http-${status}` as const;

/** null = no body (absent, empty, not a string); otherwise at most
 *  NOTES_CAP_BYTES UTF-8 bytes, cut on a code-point boundary, plus
 *  NOTES_MARKER when cut. Stored as text; rendering it as plain text, never
 *  markdown or HTML, is the PWA's half of §18 "notes are capped and plain". */
export function capNotes(body: unknown): string | null {
  if (typeof body !== 'string' || body === '') return null;
  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length <= NOTES_CAP_BYTES) return body;
  // bytes[end] is the first byte NOT kept. A continuation byte (10xxxxxx)
  // there means a code point straddles the cap: back up to its lead byte and
  // cut before it.
  let end = NOTES_CAP_BYTES;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8') + NOTES_MARKER;
}

function assetNamed(assets: readonly unknown[], name: string): Json | null {
  for (const a of assets) if (isObject(a) && a.name === name) return a;
  return null;
}

/** One listing element → one row, or null when any field this module relies on
 *  is missing or out of shape. A `prerelease` that is not a boolean is refused,
 *  never defaulted: `stable` is the channel a dev build must not reach. */
function parseReleaseElement(el: unknown): ReleaseListingRow | null {
  if (!isObject(el)) return null;
  const { tag_name: tag, prerelease, draft, published_at: published, target_commitish: commitish, assets, body } = el;
  if (!isReleaseTag(tag)) return null;
  if (typeof prerelease !== 'boolean') return null;
  if (typeof published !== 'string') return null;
  const publishedAt = Date.parse(published);
  if (!Number.isFinite(publishedAt)) return null;
  if (!Array.isArray(assets)) return null;
  const url = assetNamed(assets, `ccrc-${tag}.tar.gz`)?.browser_download_url;
  if (typeof url !== 'string' || url.length > DOWNLOAD_URL_MAX || !DOWNLOAD_URL.test(url)) return null;
  return {
    tag,
    channel: prerelease ? 'dev' : 'stable',
    publishedAt,
    commitSha: typeof commitish === 'string' && COMMIT_SHA.test(commitish) ? commitish : null,
    tarballUrl: url,
    bundleListed: assetNamed(assets, `ccrc-${tag}.tar.gz.sigstore.json`) !== null,
    notes: capNotes(body),
    draft: draft === true,
  };
}

/** null = the body is not an array (the poll reads it as 'malformed'); a
 *  malformed element is skipped and counted, never thrown. `coverage` is
 *  'complete' iff the RAW array held fewer than RELEASES_PER_PAGE elements —
 *  a skipped element on a full page must not make the page look like the
 *  whole catalogue (D-3185). A skipped element is NOT in `rows`,
 *  so the store reads a known release skipped here as absent and yanks it
 *  until a poll parses it again (D-3206). */
export function parseReleaseListing(body: unknown): ParsedListing | null {
  if (!Array.isArray(body)) return null;
  const rows: ReleaseListingRow[] = [];
  let skipped = 0;
  for (const el of body) {
    const row = parseReleaseElement(el);
    if (row === null) skipped += 1;
    else rows.push(row);
  }
  return { rows, skipped, coverage: body.length < RELEASES_PER_PAGE ? 'complete' : 'newest-page' };
}

export function createCataloguePoller(deps: CatalogueDeps): CataloguePoller {
  const timeoutMs = deps.timeoutMs !== undefined && deps.timeoutMs > 0 ? deps.timeoutMs : CATALOGUE_TIMEOUT_MS;
  let lastOkAt: number | null = null;
  let lastError: { at: number; reason: CatalogueErrorReason } | null = null;
  /** The ETag of the last listing the store ACCEPTED — never of one it refused,
   *  or a 304 would pin the catalogue to a listing that was never written. */
  let etag: string | null = null;
  let requestedAt: number | null = null;
  let inflight: Promise<CatalogueState> | null = null;

  const snapshot = (): CatalogueState => ({ lastOkAt, lastError: lastError === null ? null : { ...lastError } });
  /** Every error arm: `lastOkAt` is untouched (§18 "errors never move lastOkAt"). */
  const failed = (now: number, reason: CatalogueErrorReason): CatalogueState => {
    lastError = { at: now, reason };
    return snapshot();
  };
  const answered = (now: number): CatalogueState => {
    lastOkAt = now;
    lastError = null;
    return snapshot();
  };

  async function pollOnce(now: number): Promise<CatalogueState> {
    const source = deps.source;
    if (!source.ok) return failed(now, 'no-release-source');
    const url = `${deps.apiUrl}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`
      + `/releases?per_page=${RELEASES_PER_PAGE}`;
    const sentEtag = etag;
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT };
    if (sentEtag !== null) headers['if-none-match'] = sentEtag;
    const deadline = openPoolReadDeadline(timeoutMs);
    if (deadline === null) return failed(now, 'no-egress');   // unreachable: timeoutMs > 0
    requestedAt = now;
    let answer: { status: number; etag: string | null; text: string } | null;
    try {
      // The body is read INSIDE the race: `close()` aborts the controller, and
      // a body still streaming after it would be cut. A throw (refused, reset,
      // DNS) and the deadline both arrive as null — both are no egress.
      answer = await deadline.race((async () => {
        const res = await fetch(url, { headers, signal: deadline.signal });
        const text = res.status === 200 ? await res.text() : '';
        return { status: res.status, etag: res.headers.get('etag'), text };
      })());
    } finally {
      deadline.close();
    }
    if (answer === null) return failed(now, 'no-egress');
    // A 304 is an answer only to a question that carried an ETag; unsolicited,
    // nothing was held to be "not modified".
    if (answer.status === 304) return sentEtag === null ? failed(now, httpReason(304)) : answered(now);
    if (answer.status === 403 || answer.status === 429) return failed(now, 'rate-limited');
    if (answer.status !== 200) return failed(now, httpReason(answer.status));
    let body: unknown;
    try {
      body = JSON.parse(answer.text);
    } catch {
      return failed(now, 'malformed');
    }
    const parsed = parseReleaseListing(body);
    if (parsed === null) return failed(now, 'malformed');
    const applied = deps.store.applyReleaseListing(parsed.rows, now, parsed.coverage);
    if (!applied.ok) return failed(now, 'malformed');
    etag = answer.etag;
    return answered(now);
  }

  return {
    poll(now: number): Promise<CatalogueState> {
      if (inflight !== null) return inflight;
      const run = pollOnce(now).finally(() => { inflight = null; });
      inflight = run;
      return run;
    },
    state: snapshot,
    lastRequestAt: () => requestedAt,
  };
}
```

This file names no `node:sqlite`, no `db.js` path and no `<coord|store>` `.db` reach — Task 7's update-ring scan reads it once Step 6 lists it.

- [ ] **Step 5: Run the pure and poller cases**

Run: `cd server && ./node_modules/.bin/vitest run test/update-catalogue.test.ts` (foreground)
Expected: every case in `parseReleaseListing`, `capNotes` and `the poller against a loopback fixture` PASSES; `the catalogue lane` FAILS on its first two cases, each with `AssertionError: expected [] to have a length of 1 but got +0` (the watcher has no lane yet); its third case passes.

- [ ] **Step 6: Wire the lane, the dependency and the composition root**

`server/src/watch.ts` — after `const CAPS_REFRESH_MS = 60_000;` (`watch.ts:191`):

```ts

/** The catalogue lane (design 2026-09-20 §7). GitHub's unauthenticated
 *  listing budget is 60 requests an hour per IP and a 304 still spends one,
 *  so every 30 minutes is 2 an hour, leaving the rest to
 *  `POST /api/updates/refresh` (one a minute at most). */
const UPDATE_CATALOGUE_MS = 30 * 60_000;
```

After `private lastCapsAt = 0;` (`watch.ts:471`):

```ts
  /** The catalogue lane's clock. Starts at 0, like `lastCapsAt`, so the first
   *  tick after a start polls: the catalogue's state is process memory
   *  (D-3182), and a restarted server should read
   *  "never checked" for one tick, not for half an hour. */
  private lastCatalogueAt = 0;
```

In `tick()`, directly after `this.ticking = true;` and the `try {` that follows it (`watch.ts:787-788`), BEFORE the `// Read once, share with the two lanes …` comment and the `readRegistryMeasured` call (`:811`) — NOT beside the caps block (ruling R8). Task 11 later puts its inventory gate at this same spot, above this block or below it; both stay above the registry read:

```ts
      // The catalogue lane (design 2026-09-20 §7) is gated HERE, above the
      // registry read and its fail-shut return (`if (!registryRead.listed)`
      // below), because it reads nothing from the registry: a GitHub listing
      // is as answerable while `io.readdir` fails as while it succeeds, and
      // that return skips every lane below it (D-3198).
      // NEVER awaited, the caps refresh's reasoning further down: a GitHub
      // listing behind a 10 s deadline must not stall the dialog detector or
      // assembleFleet. `poll` records its own failures as `lastError` and does
      // not reject; the `.catch` covers the one thing it does not catch — a
      // throw from the store's writer — which must not become an unhandled
      // rejection via start()'s `void this.tick()`.
      if (this.deps.catalogue && Date.now() - this.lastCatalogueAt >= UPDATE_CATALOGUE_MS) {
        this.lastCatalogueAt = Date.now();
        void this.deps.catalogue.poll(Date.now()).catch(() => { /* one bad poll must not kill the tick */ });
      }
```

`server/src/server.ts` — after `import type { PoolEdgeLog } from './coord/pooledgelog.js';` (`server.ts:57`):

```ts
import type { CataloguePoller } from './update/catalogue.js';
```

and in `Deps`, after `poolEdgeLog?: PoolEdgeLog;` (the last field, `server.ts:289`):

```ts
  /** The release-catalogue poller (design 2026-09-20 §7, `update/catalogue.ts`).
   *  Constructed in `index.ts` beside `coord`, whose one catalogue writer it
   *  calls; `FleetWatcher` polls it on its own 30-minute clock and
   *  `POST /api/updates/refresh` on demand. Optional the way `coord` is:
   *  absent, the lane never runs and the update routes read "never checked". */
  catalogue?: CataloguePoller;
```

`server/src/index.ts` — add the import after `import { readLocalCcdCaps } from './localcaps.js';` (`index.ts:20`):

```ts
import { createCataloguePoller } from './update/catalogue.js';
```

after the `poolEdgeLog` construction (`index.ts:73`):

```ts

// The process's ONE catalogue poller (design 2026-09-20 §7), beside `coord`
// because its only write is `coord.applyReleaseListing`. Its state and ETag
// are memory (D-3182). A box whose release source
// could not be read (Task 9, D-3175) still builds one: every poll
// then answers `no-release-source` and sends nothing — said once, here.
const catalogue = createCataloguePoller({ source: cfg.releaseSource, apiUrl: cfg.releaseApiUrl, store: coord });
if (cfg.releaseSource.ok === false) {
  // `env-malformed` carries `path: null` (Task 9): the fault is the env pair, not a file.
  const where = cfg.releaseSource.why === 'env-malformed'
    ? 'CCRC_RELEASE_OWNER/CCRC_RELEASE_REPO are both set and one is not a plain GitHub name'
    : cfg.releaseSource.path;
  console.warn(`ccrc-server: no release source (${cfg.releaseSource.why}: ${where}) — the update ` +
    'catalogue will not poll. Set BOTH CCRC_RELEASE_OWNER and CCRC_RELEASE_REPO in ~/.ccrc/ccrc.env, or run the ' +
    'server from an installed tree whose ccd/ccrc carries its release-source lines.');
}
```

and in BOTH `deps` arms add `catalogue,` after `poolEdgeLog,` — the two lines are byte-identical, so edit each with its following line as context. Remote arm (`index.ts:94-95`):

```ts
    poolEdgeLog,
    catalogue,
    refreshCaps: makeRefreshCaps(fleet.client, fleet.state),
```

Local arm (`index.ts:146-147`):

```ts
    poolEdgeLog,
    catalogue,
    // `connected`/`downSince` are inert for local mode — every reader of
```

`server/test/single-definition.test.ts` — the `UPDATE_RING_FILES` declaration Task 7 added inside `describe('the update ring — …')` (`  const UPDATE_RING_FILES: readonly string[] = [];`, two-space indent — the describe is appended at top level — no trailing comment) becomes this ONE line — replaced in place, so no line of the file moves (ruling R13; the citation audit's anchors `:32-37`, `:1274`, `:1303` stay put). The trailing comment is the one Tasks 11 and 12 replace the whole line over. Match the line by its CONTENT, not by a typed indent: read the file, take the declaration as it stands, and keep its leading whitespace.

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts'];   // Tasks 11–13 append 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts'
```

- [ ] **Step 7: Run green, and the guards the wiring touches**

Run each in the foreground from `server/`, timeout ≥ 600000 ms:
- `./node_modules/.bin/vitest run test/update-catalogue.test.ts` — Expected: PASS, every case.
- `./node_modules/.bin/vitest run test/caps-refresh.test.ts` — Expected: PASS (the caps lane's cadence is unchanged by the new block at the top of `tick()`'s `try`; its cases build a watcher with no `catalogue`, so the gate is inert there).
- `./node_modules/.bin/vitest run test/project-pools-read.test.ts` — Expected: PASS (the deadline's body is unchanged; only `export` was added).
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — Expected: PASS: the update-ring scan now reads `catalogue.ts` and finds no `node:sqlite`, no `db.js` import and no store-db reach; the present branch of "covers the directory" finds `catalogue.ts` on disk; "the four TS roots never name the org" stays green (the fixtures say `fixture-owner`); "spells the tag shape once" stays green (`catalogue.ts` calls `isReleaseTag`, never the regex).
- `./node_modules/.bin/vitest run test/session-hook.test.ts` — Expected: PASS (ruling R13: the `single-definition.test.ts` edit replaced one line in place, so the citation audit's census is unchanged). A known load flake: on a red, re-run it in isolation before calling a break.
- `./node_modules/.bin/vitest run test/boot.test.ts` — Expected: PASS. The real composition root now builds the poller; its fixture home has no installed tree, so `releaseSource` is `tree-absent`, the warning goes to stderr (drained), and no request is sent.
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — Expected: PASS (`{ ...testDeps(), catalogue: poller }` type-checks against the widened `Deps`). A known load flake: on a red, re-run it in isolation before calling a break.
- `./node_modules/.bin/vitest run test/topology-clean.test.ts` after `git add` of the new files — Expected: PASS (the fixtures use `example.invalid`, `127.0.0.1` and invented owner/repo names only).

- [ ] **Step 8: Mutation measurements (each red, then restored and green; 9b and 9c are the two marked green by design)**

Run `./node_modules/.bin/vitest run test/update-catalogue.test.ts` after each edit; restore by reverting the one edit and re-run to green.
1. §18 "errors never move `lastOkAt`": in `failed`, add `lastOkAt = now;` as its first line → red: "a 403 is rate-limited…" (`expected { lastOkAt: 2000, … } to deeply equal { lastOkAt: 1000, … }`), plus the malformed and store-refusal cases.
2. §18 "notes are capped and plain" (the cap): in `capNotes`, replace `if (bytes.length <= NOTES_CAP_BYTES) return body;` with `return body;` → red: "a 5000-byte body is 4096 bytes plus the marker" and "the cut never splits a code point".
3. D-3185: in `parseReleaseListing`'s return, change `body.length < RELEASES_PER_PAGE` to `rows.length < RELEASES_PER_PAGE` → red: "coverage comes from the RAW element count" and "a full page reaches the store as newest-page".
4. §18 "a yanked release is kept", end to end: in Task 4's `applyReleaseListing` (`server/src/coord/store.ts`), change `` `UPDATE releases SET yanked = 1 WHERE yanked = 0 AND publishedAt >= ? AND tag NOT IN (${marks})` `` to `` `DELETE FROM releases WHERE yanked = 0 AND publishedAt >= ? AND tag NOT IN (${marks})` `` → red: "a release that vanishes from a complete listing is yanked, never deleted" and "a known release whose element is skipped is yanked for that poll…" (`v0.0.1` missing in both). Restore `store.ts`.
5. The ETag is the last ACCEPTED listing's: move `etag = answer.etag;` to just above `const parsed = parseReleaseListing(body);` → red: "an unparseable or non-array body is malformed…" (the 4th request's If-None-Match is `'"e3"'` where `'"e1"'` was expected — `'not json at all'` returns from the `JSON.parse` catch BEFORE the moved line, so e2 is never stored, while `{ releases: [] }` parses and reaches it) and "a store refusal is malformed…" (`'"e2"'` where `'"e1"'` was expected — `[]` parses, so e2 is stored before the store refuses).
6. The conditional GET: delete `if (sentEtag !== null) headers['if-none-match'] = sentEtag;` → red: "a second poll sends If-None-Match…" (`undefined` for `'"e1"'`).
7. No request without a source: delete `if (!source.ok) return failed(now, 'no-release-source');` → red: "no release source: no request at all…" (`seen` has length 1, the URL reads `/repos/undefined/undefined/…`).
8. Single-flight: delete `if (inflight !== null) return inflight;` → red: "single-flight…" (`b` is not `a`; two requests).
9. The deadline has TWO bounds, so measure the pair and each half: `openPoolReadDeadline`'s timer calls `controller.abort()` at the budget whether or not `race` is ever called (`pools.ts:46-50` at d759c914), and the IIFE's `fetch` carries that `signal`; the `race` is the second bound.
   - 9a, both removed: replace `answer = await deadline.race((async () => {` … `})());` with the same async IIFE awaited directly, wrapped in `try { … } catch { answer = null; }`, AND drop `signal: deadline.signal` from its options (`fetch(url, { headers })`) → red: "a server that never answers is no-egress at the deadline" (the case times out at 10000 ms; nothing bounds the wait for headers).
   - 9b, the race alone removed (the IIFE awaited bare in the try/catch, `signal` kept) → GREEN by design: the 'hang' fixture never sends headers, so the aborted signal rejects `fetch` with an AbortError at ~200 ms and the catch folds it to `null`. Record it green with that reason, not as an untested guard.
   - 9c, the signal alone removed (`race` kept) → GREEN by design: the race resolves `null` at the budget, and the un-aborted request is cut by `afterEach`'s `closeAllConnections()`. The signal is what cancels the request; the race is what bounds the poll if a body read or an io step ignores the signal. Record it green with that reason.
10. The lane's cadence: in `watch.ts` change `>= UPDATE_CATALOGUE_MS` to `> UPDATE_CATALOGUE_MS` → red at the 30-minute assertion (`expected [ … ] to have a length of 2 but got 1`); then set `UPDATE_CATALOGUE_MS = 29 * 60_000` → red at the 29-minute assertion; then delete `this.lastCatalogueAt = Date.now();` → red at the three-tick assertion (3 polls).
11. D-3198 (ruling R8): in `watch.ts` move the whole catalogue block (its comment and the `if`) to just after the caps block's closing brace (below the `if (!registryRead.listed) { … return; }` block) → red: "polls on a tick whose registry will not list" (`expected [] to have a length of 1 but got +0`); the cadence case stays green (its registry lists) — the control that the move, not a broken lane, is what reds.
12. Task 7's hand-off, §18 "the ring scan covers `update/`" (the "directory dropped from the scan" half, measurable from this task on): in `single-definition.test.ts` change the update ring's `path.join(ccrcRoot, 'server/src/update')` to `path.join(ccrcRoot, 'server/src/updates')` and run `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'update ring'` → red: "covers the directory" takes its absent branch and fails on `files are listed for an update ring that is not on disk — was the directory moved?` (`['catalogue.ts']` for `[]`; with that assertion satisfied, the importer assertion would red next on `server/src/index.ts` and `server/src/server.ts`). Restore → green.

- [ ] **Step 9: Commit**

```bash
git add server/src/update/catalogue.ts server/src/pools.ts server/src/watch.ts server/src/server.ts server/src/index.ts server/test/single-definition.test.ts server/test/update-catalogue.test.ts
git commit -m "feat(update): the catalogue poller — one conditional GET of the release listing every 30 minutes, a defensive parse into the one catalogue writer, capped notes, and a fail-soft state that never moves lastOkAt on an error"
```

### Task 11: The inventory sweep

**Files:**
- Create: `server/src/update/inventory.ts`
- Modify: `server/src/watch.ts` — `const UPDATE_INVENTORY_MS = 60_000;`, `private lastInventoryAt = 0;`, `private inventoryRun: Promise<SweepOutcome[]> | null = null;`, public `inventoryNow()`/`triggerInventory()`, the gated dispatch in `tick()` (`:782`) — placed at the TOP of `tick()`'s `try`, above the registry read and its fail-shut return, directly below Task 10's catalogue gate, which the coordinator's ruling moves to the same place (both update lanes sit above the fail-shut return — D-3198 covers both)
- Modify: `server/src/index.ts` — remote arm: `fleet.client.onConnected(() => watcher.triggerInventory())` after `watcher` exists (`:164`); the client is hoisted out of the remote arm as `let fleetClient: FleetClient | null` so that line can reach it
- Modify: `server/test/single-definition.test.ts` — append `'inventory.ts'` to `UPDATE_RING_FILES`, as a ONE-line-for-one-line replacement of that declaration: this file is cited by line in the session-hook citation audit (`:32-37`, `:1274`, `:1303`), so the edit is line-neutral and Step 7's green run includes `session-hook.test.ts`
- Test: `server/test/update-inventory.test.ts` (create) — fixture HOMEs for the local io; a scripted `FleetIO` for the remote arm and for `unmeasured`/grow-between-stat-and-read; a real in-process agent (`remoteHelpers.ts`) for the wire and the `ready` trigger's behaviour; and text pins over `server/src/index.ts` for the two remote-arm lines no test can otherwise reach — the `ready` trigger and Task 10's `catalogue,` in both `deps` arms (no test imports `index.ts`, and `boot.test.ts` spawns it in local mode only; the `readme-holds.test.ts:290-318` precedent)

**Interfaces:**
- Consumes: `FleetIO`, `localIO`, `MeasuredPathKind` (`io.ts:71`, `:101-141`, `:173`); `ReadFailure` (re-exported by `io.ts:35` from `shared/agent-protocol.ts` — `NodeFileRead`'s failure words derive from it, see Step 7's single-definition note); `openPoolReadDeadline`, `PoolReadDeadline` (Task 10); `parseBuildInfo` (`buildinfo.ts:86`); `NODE_FILES`, `NodeFileKey` (Task 8; `CCRC_DIR_NAME` is not needed — the directory arrives whole as `cfg.ccrcDir`); `NODE_ID_RE` (Task 5, exported from `server/src/coord/store.ts` beside `rekeyNode` — imported from `'../coord/store.js'`, never declared here); `FleetState.connected`/`agentOps` (Task 8); `validCapWords`, `isReleaseTag`, `isUpdatePhase`, `BUSY_UPDATE_STATES`, `IN_FLIGHT_UPDATE_PHASES`, `SettledUpdateState`, `TagFileRead`, `UNIX_SECONDS_MAX` (Task 1, the latter C5-final-fix-wave: this file imports it rather than declaring its own `REPORT_TIME_MAX_S`); `NodeMeasurement`, `NodeReport`, `NodeRow`, and the Task 4/5 writers' result types (`RefuseReleaseResult` from Task 4; `UpsertNodeResult`, `RekeyNodeResult` — its ok arm carries `retired` — `MarkUnreachableResult` — with its `{ ok: false; why: 'label-key-taken'; supersededBy: string | null }` arm, which the sweep reports as `refused` — `ReleaseLeaseResult`, `SettleNodeResult` from Task 5); `cfg.ccrcDir`, `cfg.role`, `cfg.fleetMode` (Task 9); `FleetClient.onConnected` (`client.ts:145`, fired at `:411` after `onReady` has set `connected` and — Task 8 — `agentOps`).
- Produces:

```ts
export const NODE_FILE_CAP_BYTES = 65536;
export const REPORT_DETAIL_MAX = 200;
// CORRECTION (fix round 2, R5/D-3217's class, C5 final fix wave): no local
// REPORT_TIME_MAX_S — this file imports UNIX_SECONDS_MAX from shared/api.ts
// (Task 1) instead, so the bound is declared once, not restated here and in
// resolve.ts's renderer (which used to carry its own MAX_UNIX_S).
export const REPORT_TIME_RESOLUTION_MS = 1000;         // ADDED (D-3199): a seconds stamp covers [s*1000, s*1000+999]
export const INVENTORY_BUDGET_MS = 10_000;
export const SERVER_LABEL = 'server';                  // D-3184
export const FLEET_LABEL = 'fleet';
// NODE_ID_RE is NOT declared here: it is Task 5's, exported from server/src/coord/store.ts beside rekeyNode, and imported.

export type NodeFileRead =
  | { ok: true; content: string }
  | { ok: false; reason: ReadFailure | 'too-large' };   // ReadFailure imported from '../io.js' (io.ts:35), never restated; unmeasured lstat → 'unreadable' (D-3178)
export type NodeFileReads = Record<Exclude<NodeFileKey, 'projection'>, NodeFileRead>;   // stamp, installed, caps, floor, previous, nodeId, report
export interface NodeConnection { label: string; role: NodeRole; agentOps: readonly string[] | null }

/** lstatMeasured → only 'regular' proceeds; statMeasured size ≤ cap; readFileMeasured; UTF-8 length ≤ cap (D-3177).
 *  deadline null = unbounded (a caller that bounds nothing, e.g. a test); a race lost to a deadline reads 'unreadable'. */
export async function readNodeFile(io: FleetIO, filePath: string, deadline: PoolReadDeadline | null): Promise<NodeFileRead>;
/** One deadline over all seven reads; budgetMs ≤ 0 → every file 'unreadable' and no io call (no budget, no measurement). */
export async function readNodeFiles(io: FleetIO, ccrcDir: string, budgetMs: number): Promise<NodeFileReads>;

// the validators — pure, one per file, every §8 rule
export function stampFrom(read: NodeFileRead): { stampRead: StampRead; build: BuildInfo | null };   // too-large, parseBuildInfo null, a non-tag version, or a non-printable/over-200 sha|ref|builtAt → 'malformed' (sha added — see return notes)
export function capsFrom(read: NodeFileRead): { os: NodeOs; caps: string[] };                      // line 1 'os linux|darwin', then validCapWords; any failure → {os:'unknown', caps:[]}
export function installFrom(read: NodeFileRead, stamp: { stampRead: StampRead; build: BuildInfo | null }, caps: readonly string[]): { installState: InstallState; provenance: ProvenanceState };   // provenance is 'unknown' unless installState is 'complete' (D-3200)
// CORRECTION (fix round 2, R5/D-3217's class, m-5): `tagLineFrom` had no
// non-test caller once `tagStateFrom` replaced it (fix round 1, D-3213) and
// was deleted; its tests moved onto `tagStateFrom` directly.
export function tagStateFrom(read: NodeFileRead): { tag: string | null; state: TagFileRead };   // floor / previous line 1 through isReleaseTag, PLUS this sweep's raw read state (D-3213)
export function nodeIdFrom(read: NodeFileRead): string | null;        // line 1 through NODE_ID_RE (imported from '../coord/store.js')
export function reportFrom(read: NodeFileRead): NodeReport | null;    // null = absent; any other failure → {phase:'unknown', …null}; times ×1000; fields read BY NAME, unknown keys ignored (a newer writer may add keys — W4's `pid`)
export function printableDetail(raw: string): string;                 // printable ASCII only, cut to REPORT_DETAIL_MAX
export function measurementFrom(reads: NodeFileReads, conn: NodeConnection, now: number): NodeMeasurement;   // no node-id → nodeId = label, installState 'unknown'
export async function measureNode(io: FleetIO, ccrcDir: string, budgetMs: number, conn: NodeConnection, now: number): Promise<NodeMeasurement>;
/** The five current* columns back to one BuildInfo; null unless stampRead === 'ok' and all four required fields are set. */
export function buildInfoOfRow(row: Pick<NodeRow, 'stampRead' | 'currentSha' | 'currentRef' | 'currentBuiltAt' | 'currentDirty' | 'currentVersion'>): BuildInfo | null;

// the §8 phase table + precedence — pure; acts only on a CHANGED report (any of the five report fields differs from the pre-upsert row's)
// CORRECTION (fix round 2, R5/D-3217's class): `why` gained 'stamp-unmeasured'
// (fix round 1, D-3214/F2) — a 'done' report whose stamp could not be read
// gives NO verdict; the lease stays pending until a later sweep reads the
// stamp fine.
export type LeaseAction =
  | { kind: 'none'; why: 'no-report' | 'unchanged-report' | 'not-busy' | 'in-flight' | 'stale-report' | 'unknown-phase' | 'stamp-unmeasured' }
  | { kind: 'settle'; detail: string }
  | { kind: 'release'; to: SettledUpdateState; detail: string };      // 'done' with stamp ≠ target → {to:'failed', detail:'stamp-mismatch'}
export interface SweepPlan { lease: LeaseAction; refuse: { tag: string; detail: string } | null }   // refuse: a changed 'failed' report whose detail begins 'provenance:'
export function sweepPlanFor(row: NodeRow | null, m: NodeMeasurement): SweepPlan;

/** The port this module needs, declared by the consumer (L2). */
export interface InventoryStore {
  upsertNodeMeasurement(m: NodeMeasurement): UpsertNodeResult;
  markUnreachable(label: string, role: NodeRole, at: number): MarkUnreachableResult;
  rekeyNode(label: string, nodeId: string): RekeyNodeResult;
  releaseLease(nodeId: string, to: SettledUpdateState, detail: string, reportStartedAt: number | null): ReleaseLeaseResult;
  settleNode(nodeId: string, detail: string, reportStartedAt: number | null): SettleNodeResult;
  refuseRelease(nodeId: string, tag: string, at: number, detail: string): RefuseReleaseResult;
  node(nodeId: string): NodeRow | null;
  nodeByLabel(label: string): NodeRow | null;
}
export interface InventoryDeps {
  store: InventoryStore; localIo: FleetIO; ccrcDir: string; role: NodeRole;
  fleet: { io: FleetIO; state: FleetState } | null;   // null in local mode
  budgetMs?: number;
}
export type SweepOutcome =
  | { label: string; result: 'measured'; nodeId: string; lease: LeaseAction['kind']; refused: boolean }   // lease = what the STORE accepted ('none' when it refused the planned write)
  | { label: string; result: 'node-id-collision'; nodeId: string; lease: LeaseAction['kind']; refused: boolean }   // D-3211: this node-id already keys a LIVE row under another label — keyed as if unread, reported distinctly
  | { label: string; result: 'unreachable'; nodeId: string }
  | { label: string; result: 'refused'; why: string }                // a store refusal: rekeyNode's bad-node-id, upsert's superseded, markUnreachable's label-key-taken
  | { label: string; result: 'error'; message: string };             // D-3217: this connection's own measurement+apply threw — isolated per connection (final fix wave, C1), never overloaded onto 'refused'
/** Server row: localIo + ccrcDir, label SERVER_LABEL, role deps.role, agentOps null. Remote: the fleet connection, label
 *  FLEET_LABEL, role 'fleet', agentOps state.agentOps ?? [] (read only while connected: the field keeps the last `ready`'s answer across a drop); not connected (before OR after the reads) → markUnreachable, whose `label-key-taken` refusal is reported as `refused`, never as `unreachable`.
 *  Order per node: read → rekeyNode (when a node-id was measured; else the live row carrying the label keeps its key,
 *  D-3201) → sweepPlanFor(pre-upsert row) → upsertNodeMeasurement → refuse → lease. */
export async function sweepInventory(deps: InventoryDeps, now: number): Promise<SweepOutcome[]>;

// server/src/watch.ts — FleetWatcher gains:
inventoryNow(): Promise<SweepOutcome[]>;   // single-flight: joins the run in flight, else starts one; [] without deps.coord
triggerInventory(): void;                  // fire-and-forget dispatchInventorySweep() (warns rejects, deduped, C2); a caller that JOINS a run already in flight sets a one-shot rerun flag rather than trusting the join alone (C4, final fix wave)
private async runInventory(): Promise<SweepOutcome[]>;   // builds the InventoryDeps and holds the file's ONE sweepInventory( call — Task 12 swaps that callee
```

§18 rows this task pins: "reads refuse a non-regular file", "reads are bounded and validated", "`stampRead` keeps EACCES from unversioned", "a full `BuildInfo` round-trips", "measurement is a sweep", "the phase table is applied", "a stale report never moves the lease" (the planner's half — the store's `WHERE` half is Task 5's), "a label row re-keys", "a superseded row is invisible" (the sweep's supersede path — the readers' filter is Task 5's), "unreachable is written on the sweep it happens", "a provenance failure refuses the release FOR THAT NODE"; plus Review Focus 2 (a standing report never re-applies), 3 (seconds, and the report's second), 4 (same-user content shapes) and 5 (single flight, placeholder → re-key).

- [ ] **Step 1: Write the failing test**

Create `server/test/update-inventory.test.ts`:

```ts
// The inventory sweep (design 2026-09-20 §8) on FIXTURE HOMEs only: every
// ~/.ccrc file this module reads is planted under an `mkTmp` home, every
// coord.db is that home's own, and the fleet node is either `localIO` over the
// fixture, a scripted io spread over `localIO` (the `limits.test.ts:311`
// idiom), or a real in-process agent (`remoteHelpers.ts`) over a real
// loopback WS. Nothing here reads the live $HOME.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { RunningAgent } from '../../agent/src/server.js';
import { NODE_FILES, type NodeFileKey } from '../../shared/agent-protocol.js';
import { IN_FLIGHT_UPDATE_PHASES } from '../../shared/api.js';
import { parseBuildInfo } from '../../shared/buildinfo.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type NodeReport, type NodeRow } from '../src/coord/store.js';
import type { FleetState } from '../src/fleetstate.js';
import { localIO, type FleetIO, type MeasuredRead } from '../src/io.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import type { Deps } from '../src/server.js';
import {
  FLEET_LABEL, NODE_FILE_CAP_BYTES, REPORT_DETAIL_MAX, SERVER_LABEL,
  buildInfoOfRow, capsFrom, installFrom, measurementFrom, nodeIdFrom, printableDetail, readNodeFile, readNodeFiles,
  reportFrom, stampFrom, sweepInventory, sweepPlanFor, tagLineFrom,
  type InventoryDeps, type NodeFileRead, type NodeFileReads,
} from '../src/update/inventory.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { bootAgent, connectToAgent, makeFixture } from './remoteHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const BUILT = '2026-09-22T10:00:00Z';
const U1 = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
const U2 = '11111111-2222-4333-8444-555555555555';
const T_S = 1_758_500_000;          // the node's clock: update.json speaks unix SECONDS
const NOW = (T_S + 120) * 1000;     // the sweep's clock: every coord column is ms

type Measured = Exclude<NodeFileKey, 'projection'>;
const ok = (content: string): NodeFileRead => ({ ok: true, content });
const ABSENT: NodeFileRead = { ok: false, reason: 'absent' };
const UNREADABLE: NodeFileRead = { ok: false, reason: 'unreadable' };
const TOO_LARGE: NodeFileRead = { ok: false, reason: 'too-large' };

const stampJson = (over: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ sha: SHA, ref: 'main', builtAt: BUILT, dirty: false, version: 'v0.0.12', ...over })}\n`;
const reportJson = (over: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ target: 'v0.0.12', phase: 'done', startedAt: T_S, updatedAt: T_S + 90, detail: 'converged', from: 'pwa', ...over })}\n`;
const NO_ID: Partial<Record<Measured, string>> = {
  stamp: stampJson(), installed: `${SHA}\n`, caps: 'os linux\nverify\nnode-id\nfloor\n',
  floor: 'v0.0.12\n', previous: 'v0.0.11\n',
};
const FULL: Partial<Record<Measured, string>> = { ...NO_ID, nodeId: `${U1}\n` };

function plant(ccrcDir: string, files: Partial<Record<Measured, string>>): void {
  mkdirSync(ccrcDir, { recursive: true });
  for (const [key, body] of Object.entries(files) as [Measured, string][]) {
    writeFileSync(path.join(ccrcDir, NODE_FILES[key]), body);
  }
}
const unplant = (ccrcDir: string, key: Measured): void => rmSync(path.join(ccrcDir, NODE_FILES[key]), { force: true });

/** A fixture HOME with its own coord database — never the live one. */
function box(prefix: string): { ccrcDir: string; db: DatabaseSync; store: CoordStore } {
  const ccrcDir = path.join(mkTmp(prefix), '.ccrc');
  const db = openCoordDb(path.join(ccrcDir, 'coord.db'));
  return { ccrcDir, db, store: new CoordStore(db) };
}
const localDeps = (b: { ccrcDir: string; store: CoordStore }): InventoryDeps =>
  ({ store: b.store, localIo: localIO, ccrcDir: b.ccrcDir, role: 'both', fleet: null });
/** The server row's io in the remote-arm cases: it has none of the files, so
 *  the fleet row alone reads the fixture (both rows share one ccrcDir — the
 *  same-absolute-path assumption every remote read makes). */
const NOTHING_IO: FleetIO = { ...localIO, lstatMeasured: async () => ({ ok: false as const, reason: 'absent' as const }) };
const fleetState = (over: Partial<FleetState> = {}): FleetState =>
  ({ connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, ...over });
const remoteDeps = (store: CoordStore, ccrcDir: string, state: FleetState, io: FleetIO = localIO): InventoryDeps =>
  ({ store, localIo: NOTHING_IO, ccrcDir, role: 'server', fleet: { io, state } });
/** W4's dispatchNode, planted: nothing in W2 acquires a lease (Global Constraints). */
const plantLease = (db: DatabaseSync, nodeId: string, state: string, target: string, startedAt: number): void => {
  db.prepare('UPDATE nodes SET updateState = ?, updateTarget = ?, updateStartedAt = ? WHERE nodeId = ?')
    .run(state, target, startedAt, nodeId);
};

const ROW: NodeRow = {
  nodeId: U1, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.12', currentSha: SHA, currentRef: 'main', currentBuiltAt: BUILT, currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.12', previousVersion: 'v0.0.11', os: 'linux',
  measuredAt: NOW - 60_000, reachable: true, unreachableSince: null,
  reportedPhase: null, reportedTarget: null, reportedStartedAt: null, reportedUpdatedAt: null, reportedDetail: null,
  updateState: 'idle', updateTarget: null, updateStartedAt: null, updateDetail: null,
  channel: null, desiredTag: null, resolveDetail: null,
  requestedTag: null, requestedKind: null, requestedAt: null,
  supersededBy: null,
};
const meas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: U1, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.12', currentSha: SHA, currentRef: 'main', currentBuiltAt: BUILT, currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified', caps: ['verify', 'node-id', 'floor'], agentOps: [],
  highestVersion: 'v0.0.12', previousVersion: 'v0.0.11', os: 'linux', measuredAt: NOW, report: null, ...over,
});
const rep = (over: Partial<NodeReport> = {}): NodeReport => ({
  phase: 'done', target: 'v0.0.12', startedAt: T_S * 1000, updatedAt: (T_S + 90) * 1000, detail: 'converged', ...over,
});

describe('readNodeFile — lstat-gated, size-capped, bounded (§18 "reads refuse a non-regular file", "reads are bounded")', () => {
  it('a regular file reads; a missing one is absent', async () => {
    const b = box('ccrc-inv-read-');
    plant(b.ccrcDir, { floor: 'v0.0.12\n' });
    expect(await readNodeFile(localIO, path.join(b.ccrcDir, 'floor'), null)).toEqual(ok('v0.0.12\n'));
    expect(await readNodeFile(localIO, path.join(b.ccrcDir, 'previous'), null)).toEqual(ABSENT);
  });

  it('a symlinked build.json is unreadable and NEVER followed — even onto a perfectly good stamp', async () => {
    const b = box('ccrc-inv-symlink-');
    mkdirSync(b.ccrcDir, { recursive: true });
    // The target is a VALID stamp, so a reader that follows the link answers `ok`
    // — the one outcome that tells a removed lstat gate from a kept one.
    writeFileSync(path.join(b.ccrcDir, 'stamp-elsewhere.json'), stampJson());
    symlinkSync(path.join(b.ccrcDir, 'stamp-elsewhere.json'), path.join(b.ccrcDir, 'build.json'));
    const read = await readNodeFile(localIO, path.join(b.ccrcDir, 'build.json'), null);
    expect(read).toEqual(UNREADABLE);
    expect(stampFrom(read)).toEqual({ stampRead: 'unreadable', build: null });
  });

  it('a directory named build.json is unreadable, not absent', async () => {
    const b = box('ccrc-inv-dir-');
    mkdirSync(path.join(b.ccrcDir, 'build.json'), { recursive: true });
    expect(await readNodeFile(localIO, path.join(b.ccrcDir, 'build.json'), null)).toEqual(UNREADABLE);
  });

  it('a 70 KiB stamp is refused by its size before a byte is read, and reads malformed', async () => {
    const b = box('ccrc-inv-big-');
    plant(b.ccrcDir, { stamp: stampJson({ ref: 'x'.repeat(70 * 1024) }) });
    let reads = 0;
    const counting: FleetIO = {
      ...localIO,
      readFileMeasured: async (p: string, t?: number, s?: AbortSignal): Promise<MeasuredRead> => {
        reads += 1;
        return localIO.readFileMeasured(p, t, s);
      },
    };
    const read = await readNodeFile(counting, path.join(b.ccrcDir, 'build.json'), null);
    expect(read).toEqual(TOO_LARGE);
    expect(reads).toBe(0);
    expect(stampFrom(read).stampRead).toBe('malformed');
  });

  it('a file that grows between the stat and the read is still too-large — UTF-8 bytes, not string length (D-3177)', async () => {
    const b = box('ccrc-inv-grow-');
    plant(b.ccrcDir, { caps: 'os linux\n' });
    const grown = (content: string): FleetIO => ({ ...localIO, readFileMeasured: async () => ({ ok: true as const, content }) });
    const p = path.join(b.ccrcDir, 'ccrc-caps');
    expect(await readNodeFile(grown('x'.repeat(70 * 1024)), p, null)).toEqual(TOO_LARGE);
    expect(await readNodeFile(grown('x'.repeat(NODE_FILE_CAP_BYTES)), p, null)).toEqual(ok('x'.repeat(NODE_FILE_CAP_BYTES)));
    // 32769 characters, 65538 bytes: a `.length` check would admit it.
    expect(await readNodeFile(grown('é'.repeat(32_769)), p, null)).toEqual(TOO_LARGE);
  });

  it('an lstat this io cannot answer (an agent too old for the op) reads unreadable, never absent, and reads nothing (D-3178)', async () => {
    const b = box('ccrc-inv-unmeasured-');
    plant(b.ccrcDir, FULL);
    let reads = 0;
    const old: FleetIO = {
      ...localIO,
      lstatMeasured: async () => ({ ok: false as const, reason: 'unmeasured' as const }),
      readFileMeasured: async (p: string, t?: number, s?: AbortSignal): Promise<MeasuredRead> => {
        reads += 1;
        return localIO.readFileMeasured(p, t, s);
      },
    };
    const read = await readNodeFile(old, path.join(b.ccrcDir, 'build.json'), null);
    expect(read).toEqual(UNREADABLE);
    expect(reads).toBe(0);
    expect(stampFrom(read).stampRead).toBe('unreadable');
  });

  it('EACCES through a scripted io reads unreadable (the case that runs as root too)', async () => {
    const b = box('ccrc-inv-eacces-io-');
    plant(b.ccrcDir, FULL);
    const denied: FleetIO = { ...localIO, readFileMeasured: async () => ({ ok: false as const, reason: 'unreadable' as const }) };
    expect(await readNodeFile(denied, path.join(b.ccrcDir, 'build.json'), null)).toEqual(UNREADABLE);
  });

  it('a read that never answers is unreadable inside the budget; no budget means no measurement', async () => {
    const b = box('ccrc-inv-hang-');
    plant(b.ccrcDir, FULL);
    const hung: FleetIO = { ...localIO, readFileMeasured: (): Promise<MeasuredRead> => new Promise(() => {}) };
    const t0 = Date.now();
    const reads = await readNodeFiles(hung, b.ccrcDir, 50);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(Object.keys(reads).sort()).toEqual(['caps', 'floor', 'installed', 'nodeId', 'previous', 'report', 'stamp']);
    expect(reads.stamp).toEqual(UNREADABLE);
    let calls = 0;
    const counting: FleetIO = { ...localIO, lstatMeasured: async (p: string) => { calls += 1; return localIO.lstatMeasured(p); } };
    const none = await readNodeFiles(counting, b.ccrcDir, 0);
    expect(Object.values(none).every((r) => !r.ok && r.reason === 'unreadable')).toBe(true);
    expect(calls).toBe(0);
  });
});

describe('the validators (§8 "Validation", §18 "reads are bounded and validated")', () => {
  it('stampFrom: ok with the whole BuildInfo; no version is still ok; every other failure is its own word', () => {
    expect(stampFrom(ok(stampJson()))).toEqual({ stampRead: 'ok', build: parseBuildInfo(stampJson()) });
    const unversioned = stampFrom(ok(stampJson({ version: undefined })));
    expect(unversioned.stampRead).toBe('ok');
    expect(unversioned.build?.version).toBeUndefined();
    expect(stampFrom(ok('not json at all'))).toEqual({ stampRead: 'malformed', build: null });
    expect(stampFrom(ok(stampJson({ version: '0.0.12' }))).stampRead).toBe('malformed');
    expect(stampFrom(ok(stampJson({ version: 'v0.0.12 ' }))).stampRead).toBe('malformed');
    expect(stampFrom(ok(stampJson({ ref: 'main\u0007' }))).stampRead).toBe('malformed');
    expect(stampFrom(ok(stampJson({ ref: 'r'.repeat(201) }))).stampRead).toBe('malformed');
    expect(stampFrom(ok(stampJson({ builtAt: '2026-09-22\n10:00' }))).stampRead).toBe('malformed');
    expect(stampFrom(ok(stampJson({ sha: 'é'.repeat(40) }))).stampRead).toBe('malformed');
    expect(stampFrom(ABSENT)).toEqual({ stampRead: 'absent', build: null });
    expect(stampFrom(UNREADABLE)).toEqual({ stampRead: 'unreadable', build: null });
    expect(stampFrom(TOO_LARGE)).toEqual({ stampRead: 'malformed', build: null });
  });

  it('capsFrom: os then words; CRLF only as a terminator; one bad word drops the whole file', () => {
    expect(capsFrom(ok('os linux\nverify\nnode-id\nfloor\n'))).toEqual({ os: 'linux', caps: ['verify', 'node-id', 'floor'] });
    expect(capsFrom(ok('os darwin\r\nverify\r\n'))).toEqual({ os: 'darwin', caps: ['verify'] });
    expect(capsFrom(ok('os linux\n'))).toEqual({ os: 'linux', caps: [] });
    const refused = { os: 'unknown', caps: [] };
    expect(capsFrom(ABSENT)).toEqual(refused);
    expect(capsFrom(UNREADABLE)).toEqual(refused);
    expect(capsFrom(TOO_LARGE)).toEqual(refused);
    expect(capsFrom(ok('CCRC_AGENT_TOKEN=not-a-real-token\n'))).toEqual(refused);   // agent.env's shape
    expect(capsFrom(ok('os linux\nverify\nBAD\n'))).toEqual(refused);
    expect(capsFrom(ok('os linux\nverify \n'))).toEqual(refused);
    expect(capsFrom(ok('os linux\nver\rify\n'))).toEqual(refused);
    expect(capsFrom(ok('os linux\nver\u0000ify\n'))).toEqual(refused);
    expect(capsFrom(ok('os linux\n\nverify\n'))).toEqual(refused);
    expect(capsFrom(ok('os windows\nverify\n'))).toEqual(refused);
    const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join('\n');
    expect(capsFrom(ok(`os linux\n${words(32)}\n`)).caps).toHaveLength(32);
    expect(capsFrom(ok(`os linux\n${words(33)}\n`))).toEqual(refused);
  });

  it('tagLineFrom and nodeIdFrom: line 1 through the one guard, or null', () => {
    expect(tagLineFrom(ok('v0.0.12\n'))).toBe('v0.0.12');
    expect(tagLineFrom(ok('v0.0.12\r\n'))).toBe('v0.0.12');
    for (const bad of ['0.0.12\n', 'v0.0.12 \n', 'latest\n', '', 'v0.0\n']) expect(tagLineFrom(ok(bad)), bad).toBeNull();
    expect(tagLineFrom(ABSENT)).toBeNull();
    expect(tagLineFrom(UNREADABLE)).toBeNull();
    expect(nodeIdFrom(ok(`${U1}\n`))).toBe(U1);
    expect(nodeIdFrom(ok(`${U1.toUpperCase()}\n`))).toBeNull();
    expect(nodeIdFrom(ok(`${U1} \n`))).toBeNull();
    expect(nodeIdFrom(ok('not-a-uuid\n'))).toBeNull();
    expect(nodeIdFrom(ABSENT)).toBeNull();
  });

  it('installFrom: line 1 against the stamp sha; line 2 is provenance, and only a complete install has one', () => {
    const stamp = stampFrom(ok(stampJson()));
    expect(installFrom(ok(`${SHA}\nunsigned\n`), stamp, ['verify'])).toEqual({ installState: 'complete', provenance: 'unverified' });
    expect(installFrom(ok(`${SHA}\n`), stamp, ['verify', 'node-id', 'floor'])).toEqual({ installState: 'complete', provenance: 'verified' });
    expect(installFrom(ok(`${SHA}\n`), stamp, [])).toEqual({ installState: 'complete', provenance: 'unknown' });
    expect(installFrom(ok(`${SHA}\nsomething\n`), stamp, ['verify'])).toEqual({ installState: 'complete', provenance: 'unknown' });
    // A deploy.sh over an installed box: the marker names the OLD tree — its line 2 says nothing about this one.
    expect(installFrom(ok(`${OTHER_SHA}\n`), stamp, ['verify'])).toEqual({ installState: 'incomplete', provenance: 'unknown' });
    expect(installFrom(ABSENT, stamp, ['verify'])).toEqual({ installState: 'incomplete', provenance: 'unknown' });
    expect(installFrom(UNREADABLE, stamp, ['verify'])).toEqual({ installState: 'unknown', provenance: 'unknown' });
    expect(installFrom(ok(`${SHA}\n`), stampFrom(UNREADABLE), ['verify'])).toEqual({ installState: 'unknown', provenance: 'unknown' });
    expect(installFrom(ok(`${SHA}\n`), stampFrom(ABSENT), ['verify'])).toEqual({ installState: 'unknown', provenance: 'unknown' });
  });

  it('reportFrom: SECONDS in, ms out; a ms value is refused, not multiplied; everything else validated', () => {
    expect(reportFrom(ABSENT)).toBeNull();
    expect(reportFrom(ok(reportJson({ phase: 'installing' })))).toEqual({
      phase: 'installing', target: 'v0.0.12', startedAt: T_S * 1000, updatedAt: (T_S + 90) * 1000, detail: 'converged',
    });
    expect(reportFrom(ok(reportJson({ startedAt: T_S * 1000 })))?.startedAt).toBeNull();   // 13 digits: a ms value
    expect(reportFrom(ok(reportJson({ startedAt: -1 })))?.startedAt).toBeNull();
    expect(reportFrom(ok(reportJson({ startedAt: 1.5 })))?.startedAt).toBeNull();
    expect(reportFrom(ok(reportJson({ startedAt: String(T_S) })))?.startedAt).toBeNull();
    expect(reportFrom(ok(reportJson({ phase: 'exploding' })))?.phase).toBe('unknown');
    expect(reportFrom(ok(reportJson({ target: '0.0.12' })))?.target).toBeNull();
    expect(reportFrom(ok(reportJson({ detail: `\u001b[31m${'y'.repeat(500)}` })))?.detail).toHaveLength(REPORT_DETAIL_MAX);
    expect(reportFrom(ok(reportJson({ detail: 7 })))?.detail).toBeNull();
    // Additive discipline: the reader reads its five fields BY NAME, so a key a
    // newer writer adds (wave 4's `pid`, a departure of wave 4's plan) is ignored —
    // never a reason to read the report as `unknown`.
    expect(reportFrom(ok(reportJson({ pid: 4242, note: 'from a newer writer' })))).toEqual(reportFrom(ok(reportJson())));
    expect(reportFrom(ok(reportJson({ pid: 4242 })))?.phase).toBe('done');
    const unknown = { phase: 'unknown', target: null, startedAt: null, updatedAt: null, detail: null };
    expect(reportFrom(ok('{ torn'))).toEqual(unknown);
    expect(reportFrom(ok('[]'))).toEqual(unknown);
    expect(reportFrom(UNREADABLE)).toEqual(unknown);
    expect(reportFrom(TOO_LARGE)).toEqual(unknown);
  });

  it('printableDetail keeps printable ASCII only, bounded', () => {
    expect(printableDetail('a\u0000b\ncéd')).toBe('a b c d');
    expect(printableDetail('  spaced  ')).toBe('spaced');
    expect(printableDetail('z'.repeat(500))).toHaveLength(REPORT_DETAIL_MAX);
  });
});

describe('measurementFrom and buildInfoOfRow (§18 "a full BuildInfo round-trips")', () => {
  const reads = (over: Partial<NodeFileReads> = {}): NodeFileReads => ({
    stamp: ok(stampJson()), installed: ok(`${SHA}\n`), caps: ok('os linux\nverify\nnode-id\nfloor\n'),
    floor: ok('v0.0.12\n'), previous: ok('v0.0.11\n'), nodeId: ok(`${U1}\n`), report: ABSENT, ...over,
  });

  it('a full node maps every column, whole-object', () => {
    expect(measurementFrom(reads(), { label: SERVER_LABEL, role: 'both', agentOps: null }, NOW)).toEqual({
      nodeId: U1, role: 'both', label: SERVER_LABEL,
      currentVersion: 'v0.0.12', currentSha: SHA, currentRef: 'main', currentBuiltAt: BUILT, currentDirty: false,
      stampRead: 'ok', installState: 'complete', provenance: 'verified', caps: ['verify', 'node-id', 'floor'],
      agentOps: null, highestVersion: 'v0.0.12', previousVersion: 'v0.0.11', os: 'linux', measuredAt: NOW, report: null,
    });
  });

  it('no node-id keys by label with installState unknown; agentOps is validated again and [] when refused', () => {
    const m = measurementFrom(reads({ nodeId: ABSENT }), { label: FLEET_LABEL, role: 'fleet', agentOps: ['update'] }, NOW);
    expect(m).toMatchObject({ nodeId: FLEET_LABEL, installState: 'unknown', agentOps: ['update'] });
    expect(measurementFrom(reads(), { label: FLEET_LABEL, role: 'fleet', agentOps: ['Bad Word'] }, NOW).agentOps).toEqual([]);
    expect(measurementFrom(reads(), { label: FLEET_LABEL, role: 'fleet', agentOps: [] }, NOW).agentOps).toEqual([]);
  });

  it('a caps file carrying a secret file\'s bytes leaves nothing of them in the measurement', () => {
    const m = measurementFrom(reads({ caps: ok('CCRC_AGENT_TOKEN=not-a-real-token\n') }), { label: SERVER_LABEL, role: 'both', agentOps: null }, NOW);
    expect(m).toMatchObject({ caps: [], os: 'unknown' });
    expect(JSON.stringify(m)).not.toContain('not-a-real-token');
  });

  it('buildInfoOfRow returns the parser\'s own shape, and null for anything not ok', () => {
    expect(buildInfoOfRow({ ...ROW, currentDirty: true })).toEqual(parseBuildInfo(stampJson({ dirty: true })));
    expect(Object.keys(buildInfoOfRow({ ...ROW, currentVersion: null })!)).toEqual(['sha', 'ref', 'builtAt', 'dirty']);
    expect(buildInfoOfRow({ ...ROW, stampRead: 'unreadable' })).toBeNull();
    expect(buildInfoOfRow({ ...ROW, currentDirty: null })).toBeNull();
    expect(buildInfoOfRow({ ...ROW, currentSha: null })).toBeNull();
  });
});

describe('sweepPlanFor — the §8 phase table, the precedence, and only a changed report acts', () => {
  const T0 = T_S * 1000 + 500;   // the lease was taken half a second into the report's own second
  const busy = (over: Partial<NodeRow> = {}): NodeRow =>
    ({ ...ROW, updateState: 'applying', updateTarget: 'v0.0.12', updateStartedAt: T0, ...over });
  const withReport = (r: Partial<NodeReport>, over: Partial<NodeMeasurement> = {}): NodeMeasurement => meas({ report: rep(r), ...over });
  const seen = (r: NodeReport): Partial<NodeRow> => ({
    reportedPhase: r.phase, reportedTarget: r.target, reportedStartedAt: r.startedAt,
    reportedUpdatedAt: r.updatedAt, reportedDetail: r.detail,
  });

  it('no report, an unchanged report, a settled row: nothing moves', () => {
    expect(sweepPlanFor(busy(), meas())).toEqual({ lease: { kind: 'none', why: 'no-report' }, refuse: null });
    expect(sweepPlanFor(busy(seen(rep())), withReport({}))).toEqual({ lease: { kind: 'none', why: 'unchanged-report' }, refuse: null });
    expect(sweepPlanFor(ROW, withReport({})).lease).toEqual({ kind: 'none', why: 'not-busy' });
    expect(sweepPlanFor(null, withReport({})).lease).toEqual({ kind: 'none', why: 'not-busy' });
  });

  it.each([...IN_FLIGHT_UPDATE_PHASES])('%s leaves a busy lease busy (pending → applying is the dispatcher\'s write)', (phase) => {
    expect(sweepPlanFor(busy(), withReport({ phase })).lease).toEqual({ kind: 'none', why: 'in-flight' });
  });

  it('done at the measured version settles; done at any other version is failed: stamp-mismatch', () => {
    expect(sweepPlanFor(busy(), withReport({})).lease).toEqual({ kind: 'settle', detail: 'done: v0.0.12' });
    expect(sweepPlanFor(busy(), withReport({}, { currentVersion: 'v0.0.11' })).lease)
      .toEqual({ kind: 'release', to: 'failed', detail: 'stamp-mismatch' });
    expect(sweepPlanFor(busy(), withReport({}, { currentVersion: null })).lease)
      .toEqual({ kind: 'release', to: 'failed', detail: 'stamp-mismatch' });
    expect(sweepPlanFor(busy(), withReport({ target: null }, { currentVersion: null })).lease)
      .toEqual({ kind: 'release', to: 'failed', detail: 'stamp-mismatch' });
  });

  it('failed and reverted release to the same word, carrying the report\'s detail (or the word)', () => {
    expect(sweepPlanFor(busy(), withReport({ phase: 'failed', detail: 'spine died at _inst_skills' })).lease)
      .toEqual({ kind: 'release', to: 'failed', detail: 'spine died at _inst_skills' });
    expect(sweepPlanFor(busy(), withReport({ phase: 'reverted', detail: null })).lease)
      .toEqual({ kind: 'release', to: 'reverted', detail: 'reverted' });
  });

  it('an out-of-vocabulary phase leaves the lease alone (the deadline that ends it is W4\'s)', () => {
    expect(sweepPlanFor(busy(), withReport({ phase: 'unknown' })).lease).toEqual({ kind: 'none', why: 'unknown-phase' });
  });

  it('a previous run\'s report never moves the lease — and the lease\'s own second is not a previous run', () => {
    expect(sweepPlanFor(busy(), withReport({ startedAt: (T_S - 3600) * 1000 })).lease).toEqual({ kind: 'none', why: 'stale-report' });
    expect(sweepPlanFor(busy(), withReport({ startedAt: (T_S - 1) * 1000 })).lease).toEqual({ kind: 'none', why: 'stale-report' });
    // D-3199: the report says T_S seconds, the lease was taken at T_S*1000+500 ms.
    expect(sweepPlanFor(busy(), withReport({ startedAt: T_S * 1000 })).lease).toEqual({ kind: 'settle', detail: 'done: v0.0.12' });
  });

  it('a NULL on either side of the precedence is not stale', () => {
    expect(sweepPlanFor(busy({ updateStartedAt: null }), withReport({ startedAt: (T_S - 3600) * 1000 })).lease.kind).toBe('settle');
    expect(sweepPlanFor(busy(), withReport({ startedAt: null })).lease.kind).toBe('settle');
  });

  it('a changed failed report whose detail begins provenance: refuses (node, target), busy or not — once', () => {
    const r = { phase: 'failed' as const, detail: 'provenance: the bundle names another workflow' };
    expect(sweepPlanFor(null, withReport(r)).refuse).toEqual({ tag: 'v0.0.12', detail: r.detail });
    expect(sweepPlanFor(ROW, withReport(r)).refuse).toEqual({ tag: 'v0.0.12', detail: r.detail });
    expect(sweepPlanFor(busy(), withReport(r))).toEqual({
      lease: { kind: 'release', to: 'failed', detail: r.detail }, refuse: { tag: 'v0.0.12', detail: r.detail },
    });
    expect(sweepPlanFor({ ...ROW, ...seen(rep(r)) }, withReport(r)).refuse).toBeNull();   // the standing report
    expect(sweepPlanFor(null, withReport({ ...r, target: null })).refuse).toBeNull();
    expect(sweepPlanFor(null, withReport({ phase: 'failed', detail: 'spine died' })).refuse).toBeNull();
    expect(sweepPlanFor(null, withReport({ phase: 'reverted', detail: 'provenance: x' })).refuse).toBeNull();
  });
});

describe('sweepInventory — the server row, rows and keys (§8 "Row identity, re-keying, freshness")', () => {
  it('a full stamp fills all five current* columns and round-trips — dirty included', async () => {
    const b = box('ccrc-inv-full-');
    plant(b.ccrcDir, { ...FULL, stamp: stampJson({ dirty: true }) });
    expect(await sweepInventory(localDeps(b), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'none', refused: false },
    ]);
    const row = b.store.node(U1)!;
    expect(row).toMatchObject({
      role: 'both', label: SERVER_LABEL, currentVersion: 'v0.0.12', currentSha: SHA, currentRef: 'main',
      currentBuiltAt: BUILT, currentDirty: true, stampRead: 'ok', installState: 'complete', provenance: 'verified',
      caps: ['verify', 'node-id', 'floor'], agentOps: null, highestVersion: 'v0.0.12', previousVersion: 'v0.0.11',
      os: 'linux', measuredAt: NOW, reachable: true, unreachableSince: null, updateState: 'idle',
    });
    expect(buildInfoOfRow(row)).toEqual(parseBuildInfo(stampJson({ dirty: true })));
  });

  it.skipIf(process.getuid?.() === 0)('EACCES on the stamp is unreadable, never ok and never absent — and measuredAt is set', async () => {
    const b = box('ccrc-inv-eacces-');
    plant(b.ccrcDir, FULL);
    chmodSync(path.join(b.ccrcDir, 'build.json'), 0o000);
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.node(U1)).toMatchObject({
      stampRead: 'unreadable', currentSha: null, currentVersion: null, currentDirty: null,
      installState: 'unknown', provenance: 'unknown', measuredAt: NOW,
    });
  });

  it('a parseable stamp with no version is ok with currentVersion NULL; a floor that is not a tag is NULL', async () => {
    const b = box('ccrc-inv-unversioned-');
    plant(b.ccrcDir, { ...FULL, stamp: stampJson({ version: undefined }), floor: 'latest\n' });
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.node(U1)).toMatchObject({ stampRead: 'ok', currentVersion: null, currentSha: SHA, highestVersion: null });
  });

  it('missing node-id → keyed by label, installState unknown; absent ccrc-caps → [] and os unknown', async () => {
    const b = box('ccrc-inv-noid-');
    plant(b.ccrcDir, { stamp: stampJson(), installed: `${SHA}\n` });
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.nodes().map((n) => n.nodeId)).toEqual([SERVER_LABEL]);
    expect(b.store.node(SERVER_LABEL)).toMatchObject({ installState: 'unknown', caps: [], os: 'unknown', highestVersion: null });
  });

  it('a node-id appearing on a labelled row re-keys it in place: one row, its history carried (§18 "a label row re-keys")', async () => {
    const b = box('ccrc-inv-rekey-');
    plant(b.ccrcDir, NO_ID);
    await sweepInventory(localDeps(b), NOW - 60_000);
    expect(b.store.refuseRelease(SERVER_LABEL, 'v0.0.9', NOW - 30_000, 'provenance: earlier')).toMatchObject({ ok: true, inserted: true });
    plant(b.ccrcDir, { nodeId: `${U1}\n` });
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.nodes().map((n) => [n.nodeId, n.label])).toEqual([[U1, SERVER_LABEL]]);
    expect(b.store.node(SERVER_LABEL)).toBeNull();
    expect(b.store.node(U1)).toMatchObject({ installState: 'complete', measuredAt: NOW });
    expect(b.store.refusalsFor(U1).map((r) => r.tag)).toEqual(['v0.0.9']);
  });

  it('a UUID row already present supersedes the label row, which no live reader sees', async () => {
    const b = box('ccrc-inv-supersede-');
    plant(b.ccrcDir, NO_ID);
    await sweepInventory(localDeps(b), NOW - 60_000);
    // The node was re-installed elsewhere and its own row already exists.
    expect(b.store.upsertNodeMeasurement(meas({ nodeId: U1, label: 'reinstalled', role: 'both' }))).toMatchObject({ ok: true });
    plant(b.ccrcDir, { nodeId: `${U1}\n` });
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.node(SERVER_LABEL)?.supersededBy).toBe(U1);
    expect(b.store.nodes().map((n) => [n.nodeId, n.label])).toEqual([[U1, SERVER_LABEL]]);
  });

  it('a node-id that vanishes after a re-key keeps measuring into the UUID row, never a second live row (D-3201)', async () => {
    const b = box('ccrc-inv-vanish-');
    plant(b.ccrcDir, FULL);
    await sweepInventory(localDeps(b), NOW - 60_000);
    unplant(b.ccrcDir, 'nodeId');
    expect(await sweepInventory(localDeps(b), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'none', refused: false },
    ]);
    expect(b.store.nodes().map((n) => n.nodeId)).toEqual([U1]);
    expect(b.store.node(U1)).toMatchObject({ installState: 'unknown', measuredAt: NOW });
  });
});

describe('sweepInventory — the fleet connection (§18 "unreachable is written on the sweep it happens")', () => {
  it('a missing connection is unreachable on THAT sweep; since stays the first; the placeholder re-keys on return', async () => {
    const b = box('ccrc-inv-unreach-');
    plant(b.ccrcDir, { ...NO_ID, nodeId: `${U2}\n` });
    const state = fleetState({ connected: false, downSince: NOW - 5000 });
    expect(await sweepInventory(remoteDeps(b.store, b.ccrcDir, state), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: SERVER_LABEL, lease: 'none', refused: false },
      { label: FLEET_LABEL, result: 'unreachable', nodeId: FLEET_LABEL },
    ]);
    expect(b.store.node(FLEET_LABEL)).toMatchObject({
      role: 'fleet', reachable: false, unreachableSince: NOW, measuredAt: null, stampRead: 'unreadable', agentOps: [],
    });
    await sweepInventory(remoteDeps(b.store, b.ccrcDir, state), NOW + 60_000);
    expect(b.store.node(FLEET_LABEL)?.unreachableSince).toBe(NOW);
    state.connected = true;
    state.downSince = null;
    state.agentOps = ['update'];
    await sweepInventory(remoteDeps(b.store, b.ccrcDir, state), NOW + 120_000);
    expect(b.store.nodes().map((n) => [n.label, n.nodeId])).toEqual([[FLEET_LABEL, U2], [SERVER_LABEL, SERVER_LABEL]]);
    expect(b.store.node(U2)).toMatchObject({
      role: 'fleet', reachable: true, unreachableSince: null, stampRead: 'ok', agentOps: ['update'], measuredAt: NOW + 120_000,
    });
    expect(b.store.node(SERVER_LABEL)).toMatchObject({ role: 'server', agentOps: null, stampRead: 'absent' });
  });

  it('an agent that sent no ops reads [] (present, empty); the server row reads NULL (no agent by construction)', async () => {
    const b = box('ccrc-inv-ops-');
    plant(b.ccrcDir, FULL);
    await sweepInventory(remoteDeps(b.store, b.ccrcDir, fleetState()), NOW);
    expect(b.store.node(U1)?.agentOps).toEqual([]);
    expect(b.store.node(SERVER_LABEL)?.agentOps).toBeNull();
  });

  it('a link that drops while the reads are in flight is written unreachable, not as seven unreadables', async () => {
    const b = box('ccrc-inv-drop-');
    plant(b.ccrcDir, FULL);
    const state = fleetState();
    const dropping: FleetIO = {
      ...localIO,
      lstatMeasured: async () => { state.connected = false; return { ok: false as const, reason: 'unmeasured' as const }; },
    };
    const out = await sweepInventory(remoteDeps(b.store, b.ccrcDir, state, dropping), NOW);
    expect(out[1]).toEqual({ label: FLEET_LABEL, result: 'unreachable', nodeId: FLEET_LABEL });
    expect(b.store.node(FLEET_LABEL)).toMatchObject({ reachable: false, measuredAt: null });
  });

  it('an unreachable fleet whose label key a superseded row holds is reported refused, never as a row written', async () => {
    const b = box('ccrc-inv-keytaken-');
    // Task 5's own `label-key-taken` fixture: the label-keyed row is superseded
    // by a UUID row living under ANOTHER label, so no live row carries `fleet`
    // and the placeholder's key is taken.
    expect(b.store.upsertNodeMeasurement(meas({ nodeId: FLEET_LABEL }))).toMatchObject({ ok: true });
    expect(b.store.upsertNodeMeasurement(meas({ nodeId: U1, label: 'elsewhere' }))).toMatchObject({ ok: true });
    expect(b.store.rekeyNode(FLEET_LABEL, U1)).toMatchObject({ ok: true, how: 'superseded' });
    const out = await sweepInventory(remoteDeps(b.store, b.ccrcDir, fleetState({ connected: false, downSince: NOW - 5000 })), NOW);
    expect(out[1]).toEqual({ label: FLEET_LABEL, result: 'refused', why: `label-key-taken: ${U1}` });
    expect(b.store.node(U1)).toMatchObject({ label: 'elsewhere', reachable: true });
  });
});

describe('sweepInventory — the phase table through the store (§18 "the phase table is applied", "a stale report never moves the lease")', () => {
  const T0 = T_S * 1000 + 500;
  async function busyBox(stampVersion = 'v0.0.12'): Promise<ReturnType<typeof box>> {
    const b = box('ccrc-inv-lease-');
    plant(b.ccrcDir, { ...FULL, stamp: stampJson({ version: stampVersion }) });
    await sweepInventory(localDeps(b), NOW - 60_000);   // the row exists; no report yet
    plantLease(b.db, U1, 'applying', 'v0.0.12', T0);
    return b;
  }

  it('done at the stamped version → idle via settleNode', async () => {
    const b = await busyBox();
    plant(b.ccrcDir, { report: reportJson() });
    expect(await sweepInventory(localDeps(b), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'settle', refused: false },
    ]);
    expect(b.store.node(U1)).toMatchObject({
      updateState: 'idle', updateDetail: 'done: v0.0.12', reportedPhase: 'done', reportedStartedAt: T_S * 1000,
    });
  });

  it('done at another version → failed: stamp-mismatch via releaseLease', async () => {
    const b = await busyBox('v0.0.11');
    plant(b.ccrcDir, { report: reportJson() });
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.node(U1)).toMatchObject({ updateState: 'failed', updateDetail: 'stamp-mismatch' });
  });

  it('a previous run\'s done leaves a fresh lease busy', async () => {
    const b = await busyBox();
    plant(b.ccrcDir, { report: reportJson({ startedAt: T_S - 3600 }) });
    const [out] = await sweepInventory(localDeps(b), NOW);
    expect(out).toMatchObject({ result: 'measured', lease: 'none' });
    expect(b.store.node(U1)).toMatchObject({ updateState: 'applying', updateStartedAt: T0, reportedStartedAt: (T_S - 3600) * 1000 });
  });

  it('installing leaves it applying; failed and reverted release to their own word', async () => {
    const inflight = await busyBox();
    plant(inflight.ccrcDir, { report: reportJson({ phase: 'installing', detail: null }) });
    await sweepInventory(localDeps(inflight), NOW);
    expect(inflight.store.node(U1)?.updateState).toBe('applying');
    for (const phase of ['failed', 'reverted'] as const) {
      const b = await busyBox();
      plant(b.ccrcDir, { report: reportJson({ phase, detail: `${phase} at checking` }) });
      await sweepInventory(localDeps(b), NOW);
      expect(b.store.node(U1)).toMatchObject({ updateState: phase, updateDetail: `${phase} at checking` });
    }
  });

  it('a provenance failure refuses (node, target) once, for THIS node only; ack clears it and the standing report does not re-insert it', async () => {
    const b = await busyBox();
    expect(b.store.upsertNodeMeasurement(meas({ nodeId: U2, label: 'other' }))).toMatchObject({ ok: true });
    const detail = 'provenance: the bundle names another workflow';
    plant(b.ccrcDir, { report: reportJson({ phase: 'failed', detail }) });
    expect(await sweepInventory(localDeps(b), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'release', refused: true },
    ]);
    expect(b.store.refusalsFor(U1)).toEqual([{ nodeId: U1, tag: 'v0.0.12', at: NOW, detail }]);
    expect(b.store.refusalsFor(U2)).toEqual([]);
    // update.json persists: the same report on the next sweep inserts nothing and releases nothing.
    expect(await sweepInventory(localDeps(b), NOW + 60_000)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'none', refused: false },
    ]);
    expect(b.store.ackNode(U1)).toMatchObject({ ok: true, clearedRefusals: 1 });
    await sweepInventory(localDeps(b), NOW + 120_000);
    expect(b.store.refusalsFor(U1)).toEqual([]);
    expect(b.store.node(U1)?.updateState).toBe('idle');
  });
});

describe('the inventory lane in FleetWatcher (§18 "measurement is a sweep")', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('sweeps on the first tick even when the registry will not list, then once a minute', async () => {
    const home = mkTmp('ccrc-inv-tick-');
    const base = testDeps(home);   // no .cc-sessions: tick() fails shut on the registry read
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    plant(base.cfg.ccrcDir, FULL);
    const w = new FleetWatcher({ ...base, coord }, new Bus(), 2000, path.join(home, 'state-cache.json'));
    const spy = vi.spyOn(w, 'inventoryNow');
    vi.useFakeTimers();
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    await spy.mock.results[0]!.value;
    expect(coord.nodes().map((n) => [n.label, n.nodeId])).toEqual([[SERVER_LABEL, U1]]);
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a disconnected fleet is written unreachable by the tick that sees it — the registry read that fails with it does not stop the lane', async () => {
    const home = mkTmp('ccrc-inv-tick-remote-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    const deps: Deps = {
      ...base, coord, cfg: { ...base.cfg, fleetMode: 'remote' },
      fleetState: fleetState({ connected: false, downSince: Date.now() }),
    };
    const w = new FleetWatcher(deps, new Bus(), 2000, path.join(home, 'state-cache.json'));
    const spy = vi.spyOn(w, 'inventoryNow');
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    await spy.mock.results[0]!.value;
    expect(coord.node(FLEET_LABEL)).toMatchObject({ reachable: false, role: 'fleet' });
  });

  it('inventoryNow is single-flight: a second call joins the run in flight', async () => {
    const home = mkTmp('ccrc-inv-flight-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    plant(base.cfg.ccrcDir, FULL);
    const w = new FleetWatcher({ ...base, coord }, new Bus(), 60_000, path.join(home, 'state-cache.json'));
    const a = w.inventoryNow();
    const b = w.inventoryNow();
    expect(b).toBe(a);
    expect(await a).toEqual([{ label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'none', refused: false }]);
    const c = w.inventoryNow();
    expect(c).not.toBe(a);
    await c;
  });

  it('a server with no coord store sweeps nothing and does not throw', async () => {
    const home = mkTmp('ccrc-inv-nocoord-');
    const w = new FleetWatcher(testDeps(home), new Bus(), 60_000, path.join(home, 'state-cache.json'));
    await expect(w.inventoryNow()).resolves.toEqual([]);
  });
});

describe('the fleet node over a real agent (the exact-basename read set, and the ready trigger)', () => {
  let agent: RunningAgent | undefined;
  let fleet: ConnectedFleet | undefined;
  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
  });

  it('a ready frame measures the fleet node inside the same second', async () => {
    const fixture = makeFixture();
    const ccrcDir = path.join(fixture.home, '.ccrc');
    // No node-id: the server row reads the same directory through localIO, and
    // two rows keyed by the same UUID would be one row flipping labels.
    plant(ccrcDir, { stamp: stampJson(), installed: `${SHA}\nunsigned\n`, caps: 'os linux\nverify\nnode-id\nfloor\n', floor: 'v0.0.12\n' });
    agent = await bootAgent(fixture);
    const serverHome = mkTmp('ccrc-inv-agent-server-');
    const base = testDeps(serverHome);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    fleet = connectToAgent(agent.port);
    const deps: Deps = {
      ...base, coord, io: fleet.io, fleetState: fleet.state, cfg: { ...base.cfg, fleetMode: 'remote', ccrcDir },
    };
    const w = new FleetWatcher(deps, new Bus(), 60_000, path.join(serverHome, 'state-cache.json'));
    // index.ts's own line. The composition root is never imported by a test
    // (`refreshcaps.test.ts` says why); this is the seam it wires. That the
    // REAL line exists in index.ts is the text pin in the describe below.
    fleet.client.onConnected(() => w.triggerInventory());
    const t0 = Date.now();
    await vi.waitFor(() => { expect(coord.node(FLEET_LABEL)?.stampRead).toBe('ok'); }, { timeout: 1000, interval: 20 });
    expect(Date.now() - t0).toBeLessThan(1000);
    const row = coord.node(FLEET_LABEL)!;
    expect(buildInfoOfRow(row)).toEqual(parseBuildInfo(stampJson()));
    expect(row).toMatchObject({ role: 'fleet', caps: ['verify', 'node-id', 'floor'], os: 'linux', highestVersion: 'v0.0.12', agentOps: [], reachable: true });
  });

  it('a build.json symlinked onto a secret file is unreadable across the wire, and nothing of the secret arrives', async () => {
    const fixture = makeFixture();
    const ccrcDir = path.join(fixture.home, '.ccrc');
    plant(ccrcDir, { caps: 'os linux\nverify\n' });
    // A VALID stamp inside the secret-named file: following the link would answer `ok`.
    writeFileSync(path.join(ccrcDir, 'agent.env'), stampJson({ ref: 'not-a-real-secret' }));
    symlinkSync(path.join(ccrcDir, 'agent.env'), path.join(ccrcDir, 'build.json'));
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => { expect(fleet!.state.connected).toBe(true); }, { timeout: 3000 });
    const b = box('ccrc-inv-agent-symlink-');
    await sweepInventory(remoteDeps(b.store, ccrcDir, fleet.state, fleet.io), NOW);
    expect(b.store.node(FLEET_LABEL)).toMatchObject({ stampRead: 'unreadable', currentSha: null, caps: ['verify'], os: 'linux' });
    expect(JSON.stringify(b.store.nodes())).not.toContain('not-a-real-secret');
  });
});

describe('index.ts composes the update lanes (text pins over the composition root)', () => {
  // No test imports `index.ts`, and `boot.test.ts` spawns it in LOCAL mode
  // only, so a deleted REMOTE-arm line leaves every behavioural case green:
  // the real-agent case above runs over its own copy of the trigger, and a
  // missing `catalogue,` is no type error (`Deps.catalogue` is optional) —
  // production would then measure a reconnected agent only on the next
  // minute tick, or never poll the catalogue, with nothing red. These pins
  // read the one file, as `readme-holds.test.ts:290-318` does for
  // `readLocalCcdCaps`: a text pin proves the source, the case above proves
  // the behaviour.
  const indexTs = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  // The two `deps = { … };` object literals, remote arm first (the `if`).
  const depsLiterals = indexTs.match(/^  deps = \{\n[\s\S]*?^  \};$/gm) ?? [];

  it('splits into exactly the remote and the local deps literal (the control for the arm pins)', () => {
    expect(depsLiterals).toHaveLength(2);
    expect(depsLiterals[0]).toContain('io: fleet.io');
    expect(depsLiterals[1]).toContain('io: localIO');
  });

  it('wires the ready trigger exactly once, below the watcher, over the hoisted client', () => {
    const lines = indexTs.split('\n');
    const trigger = lines.flatMap((l, i) => (l.trim() === 'fleetClient?.onConnected(() => watcher.triggerInventory());' ? [i] : []));
    expect(trigger, 'index.ts must carry the one ready trigger').toHaveLength(1);
    const watcherAt = lines.findIndex((l) => l.startsWith('const watcher = new FleetWatcher('));
    expect(watcherAt).toBeGreaterThanOrEqual(0);
    expect(trigger[0]).toBeGreaterThan(watcherAt);
    expect(indexTs).toMatch(/^  fleetClient = fleet\.client;$/m);
  });

  it('hands Task 10\'s catalogue poller to BOTH deps arms', () => {
    expect(depsLiterals).toHaveLength(2);
    for (const lit of depsLiterals) expect(lit).toMatch(/^\s+catalogue,$/m);
  });
});
```

`server/test/single-definition.test.ts` — the `UPDATE_RING_FILES` declaration Task 10 left (`['catalogue.ts']` with its trailing comment, at Task 7's two-space indent) becomes this one line, replaced in place. Match the line by its CONTENT, not by a typed indent: read the file, take the declaration as it stands, and keep its leading whitespace.

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts'];   // Tasks 12–13 append 'resolve.ts', 'project.ts', 'routes.ts'
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/update-inventory.test.ts` (foreground, timeout ≥ 600000 ms)
Expected: FAIL — `Error: Failed to load url ../src/update/inventory.js (resolved id: ../src/update/inventory.js) in …/server/test/update-inventory.test.ts. Does the file exist?`, zero tests run.

Run: `./node_modules/.bin/vitest run test/single-definition.test.ts`
Expected: FAIL in exactly the update-ring case Task 7 wrote (every file `UPDATE_RING_FILES` lists must exist — `inventory.ts` does not yet); every other case passes.

- [ ] **Step 3: Create `server/src/update/inventory.ts`**

```ts
// L3 — the node inventory (design 2026-09-20 §8): seven small files under a
// node's ~/.ccrc, read every minute and after every `ready`, validated, and
// written into the measurement and report columns of the node's row; then
// the §8 phase table, applied to the lease columns through releaseLease /
// settleNode and never by a direct write.
//
// EVERY READ IS lstat-GATED, SIZE-CAPPED AND BUDGET-BOUNDED, because these
// files are same-user-writable by every session on the box (decision 13):
// `lstatMeasured` first and only `regular` proceeds (`limits.ts:430-431`'s
// authDead gate is the precedent — a symlink is what bash refuses), then
// `statMeasured`'s size against NODE_FILE_CAP_BYTES, then the read, then the
// content's UTF-8 length again. The agent's text read has no cap of its own
// (`readWhole`, `agent/src/fileops.ts:75`), so a file that grows between the
// stat and the read crosses the wire once, bounded by the WS frame limit, and
// still reads `too-large` here (D-3177). One `openPoolReadDeadline`
// bounds all seven reads of a node, exactly as `readObservedEpochFromRegistry`
// (`pools.ts:415-430`) bounds its one.
//
// NOTHING READ FROM A NODE REACHES A ROW UN-VALIDATED: each file has one pure
// validator below, and a value that fails it becomes the column's named
// fallback (§8 "Validation"), never a partial.
//
// THE SWEEP IS THE ONLY WRITER OF MEASUREMENT (§18 "measurement is a sweep"):
// `fleetState.build` is a handshake-time sample and is never read here as the
// current build; the row is re-measured every sweep, and `measuredAt` is the
// sweep's own clock.
import path from 'node:path';
import {
  BUSY_UPDATE_STATES, IN_FLIGHT_UPDATE_PHASES, isReleaseTag, isUpdatePhase, validCapWords,
  type InstallState, type NodeOs, type NodeRole, type ProvenanceState, type SettledUpdateState, type StampRead,
} from '../../../shared/api.js';
import { NODE_FILES, type NodeFileKey } from '../../../shared/agent-protocol.js';
import { parseBuildInfo, type BuildInfo } from '../../../shared/buildinfo.js';
// NODE_ID_RE is the store's (Task 5): declared once beside `rekeyNode`, the one
// writer that refuses a key outside it, so this reader and that writer cannot
// disagree about what `_inst_node_id` (`ccd/ccrc:9494-9513`) mints — a
// lowercase uuid. An uppercase one was not written by the installer and keys nothing.
import {
  NODE_ID_RE,
  type MarkUnreachableResult, type NodeMeasurement, type NodeReport, type NodeRow, type RefuseReleaseResult,
  type RekeyNodeResult, type ReleaseLeaseResult, type SettleNodeResult, type UpsertNodeResult,
} from '../coord/store.js';
import type { FleetState } from '../fleetstate.js';
import type { FleetIO, ReadFailure } from '../io.js';
import { openPoolReadDeadline, type PoolReadDeadline } from '../pools.js';

/** §8: "every read is capped at 65536 bytes". */
export const NODE_FILE_CAP_BYTES = 65536;
/** §8: "`reportedDetail` is cut to 200 printable-ASCII characters". */
export const REPORT_DETAIL_MAX = 200;
/** update.json's times are unix SECONDS (bash-native — the W4 writer's
 *  contract). Eleven digits reach the year 5138; a thirteen-digit value is a
 *  millisecond stamp written by mistake, and it is REFUSED (null), never
 *  divided — a guess about units is the C1 defect `server.ts`'s pool-epoch
 *  route records, the other way round. */
export const REPORT_TIME_MAX_S = 99_999_999_999;
/** A seconds stamp names a whole second: `startedAt = s` covers
 *  [s*1000, s*1000 + 999] ms. The precedence below compares the LATEST instant
 *  the report's run could have started with the lease's ms stamp, so a run
 *  dispatched at s*1000 + 500 whose node wrote `startedAt = s` is the current
 *  run, not a previous one (D-3199). Skew between the
 *  two boxes' clocks beyond this second is not covered, and not claimed. */
export const REPORT_TIME_RESOLUTION_MS = 1000;
/** One node's seven reads, in total. Over the agent each read is three round
 *  trips (lstat, stat, read), all seven in parallel. */
export const INVENTORY_BUDGET_MS = 10_000;
/** D-3184: the server's own row and the one agent connection. A
 *  second agent connection would need a label of its own. */
export const SERVER_LABEL = 'server';
export const FLEET_LABEL = 'fleet';

/** A stamp's three strings reach `NodeWire.current` and the screen: printable
 *  ASCII, at most 200. `stamp_build` writes a git sha, a ref name and a
 *  `date -u`, none of which is longer or anything else. */
const STAMP_FIELD = /^[\x20-\x7e]{1,200}$/;
const OS_LINE = /^os (linux|darwin)$/;

/** The two failure words are `ReadFailure`'s, DERIVED, never restated: the
 *  spelled pair `'absent' | 'unreadable'` in this file would make it a second
 *  holder of that vocabulary and red single-definition.test.ts's "one
 *  absent/unreadable read vocabulary" (its `PAIR` scan covers `server/src`) —
 *  the trap Task 1 avoided for `StampRead` (D-3189). */
export type NodeFileRead =
  | { ok: true; content: string }
  | { ok: false; reason: ReadFailure | 'too-large' };
type MeasuredFileKey = Exclude<NodeFileKey, 'projection'>;
export type NodeFileReads = Record<MeasuredFileKey, NodeFileRead>;
export interface NodeConnection { label: string; role: NodeRole; agentOps: readonly string[] | null }

/** Derived from `NODE_FILES`, never hand-listed. `update-intent` is in the
 *  agent's read set so a later screen can SHOW what a fleet node last
 *  received; it is never read back as authority (§8), so the measurement does
 *  not read it at all. */
const MEASURED_FILE_KEYS: readonly MeasuredFileKey[] =
  (Object.keys(NODE_FILES) as NodeFileKey[]).filter((k): k is MeasuredFileKey => k !== 'projection');

const ABSENT: NodeFileRead = { ok: false, reason: 'absent' };
const UNREADABLE: NodeFileRead = { ok: false, reason: 'unreadable' };
const TOO_LARGE: NodeFileRead = { ok: false, reason: 'too-large' };

/**
 * One file: lstat → regular only → stat size → read → length. `absent` only
 * on a proven ENOENT from the io (its one errno mapping, `io.ts:169-170`).
 *
 * `unmeasured` — an lstat this io cannot answer — reads `unreadable`
 * (D-3178). It has TWO sources: an agent too old for the op,
 * and a W2 agent REFUSING the lstat of a live symlink that carries a node-file
 * name (Task 8's literal-basename rule, D-3195), which
 * `remote/io.ts`'s `lstatMeasured` maps to `unmeasured` like any refused
 * request. `io.ts`'s never-fold rule governs ADAPTERS; this is the consumer
 * deciding, for a vocabulary (`StampRead`, §8's absent/unreadable pair) that
 * has no third slot, and the fold is honest for both: an agent that old
 * predates the ~/.ccrc read set and refuses every one of these paths anyway,
 * and a symlinked node file is exactly what §8 reads as `unreadable`.
 */
export async function readNodeFile(io: FleetIO, filePath: string, deadline: PoolReadDeadline | null): Promise<NodeFileRead> {
  const within = <T>(op: Promise<T>): Promise<T | null> => (deadline === null ? op.catch(() => null) : deadline.race(op));
  const kind = await within(io.lstatMeasured(filePath));
  if (kind === null || deadline?.expired()) return UNREADABLE;
  if (!kind.ok) return kind.reason === 'absent' ? ABSENT : UNREADABLE;
  if (kind.kind !== 'regular') return UNREADABLE;
  const size = await within(io.statMeasured(filePath));
  if (size === null || deadline?.expired()) return UNREADABLE;
  if (!size.ok) return size.reason === 'absent' ? ABSENT : UNREADABLE;
  if (size.size > NODE_FILE_CAP_BYTES) return TOO_LARGE;
  const read = await within(io.readFileMeasured(filePath, deadline?.budgetMs, deadline?.signal));
  if (read === null || deadline?.expired()) return UNREADABLE;
  if (!read.ok) return read.reason === 'absent' ? ABSENT : UNREADABLE;
  if (Buffer.byteLength(read.content, 'utf8') > NODE_FILE_CAP_BYTES) return TOO_LARGE;
  return { ok: true, content: read.content };
}

/** A node's seven files under one deadline. No usable budget is no
 *  measurement: every file `unreadable`, and not one io call is made. */
export async function readNodeFiles(io: FleetIO, ccrcDir: string, budgetMs: number): Promise<NodeFileReads> {
  const deadline = openPoolReadDeadline(budgetMs);
  const assemble = (reads: readonly NodeFileRead[]): NodeFileReads =>
    Object.fromEntries(MEASURED_FILE_KEYS.map((k, i) => [k, reads[i]])) as NodeFileReads;
  if (deadline === null) return assemble(MEASURED_FILE_KEYS.map(() => UNREADABLE));
  try {
    return assemble(await Promise.all(
      MEASURED_FILE_KEYS.map((k) => readNodeFile(io, path.join(ccrcDir, NODE_FILES[k]), deadline)),
    ));
  } finally {
    deadline.close();
  }
}

/** Lines of a small text file: `\n`-split, one trailing empty element dropped,
 *  and a `\r` stripped only where it ends a line — anywhere else it stays, and
 *  the line's own grammar refuses it. */
function linesOf(content: string): string[] {
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}
const firstLine = (read: NodeFileRead): string | null => (read.ok ? linesOf(read.content)[0] ?? null : null);

/** build.json → the four-word read and the whole stamp. `parseBuildInfo`
 *  (`buildinfo.ts:86`) is the one validator; the read above it is what keeps
 *  absent and unreadable apart (§8), and a stamp is accepted whole or not at
 *  all — a `version` that is present but not a tag, or a string field outside
 *  printable ASCII / 200 characters, makes the stamp `malformed`. */
export function stampFrom(read: NodeFileRead): { stampRead: StampRead; build: BuildInfo | null } {
  if (!read.ok) {
    if (read.reason === 'too-large') return { stampRead: 'malformed', build: null };
    return { stampRead: read.reason, build: null };
  }
  const build = parseBuildInfo(read.content);
  if (build === null) return { stampRead: 'malformed', build: null };
  if (build.version !== undefined && !isReleaseTag(build.version)) return { stampRead: 'malformed', build: null };
  if (!STAMP_FIELD.test(build.sha) || !STAMP_FIELD.test(build.ref) || !STAMP_FIELD.test(build.builtAt)) {
    return { stampRead: 'malformed', build: null };
  }
  return { stampRead: 'ok', build };
}

/** ccrc-caps → line 1 `os linux|darwin`, then one CAP_WORD per line, at most
 *  MAX_CAP_WORDS (`validCapWords`). ONE bad line drops the whole file (§8):
 *  a file that carries anything else was not written by `_inst_caps`, and
 *  keeping the good half of it would put a stranger's words on the wire. */
export function capsFrom(read: NodeFileRead): { os: NodeOs; caps: string[] } {
  if (!read.ok) return { os: 'unknown', caps: [] };
  const lines = linesOf(read.content);
  const os = OS_LINE.exec(lines[0] ?? '');
  if (os === null) return { os: 'unknown', caps: [] };
  const caps = validCapWords(lines.slice(1));
  if (caps === null) return { os: 'unknown', caps: [] };
  return { os: os[1] === 'darwin' ? 'darwin' : 'linux', caps };
}

/** installed → installState and provenance (§8). `complete` iff line 1 is the
 *  stamp's sha; `incomplete` when it differs or the marker is absent under a
 *  readable stamp; `unknown` when either cannot be read. Provenance is line 2
 *  (`unsigned` → unverified; none, on a node whose caps say `verify` →
 *  verified) and is read ONLY from a complete marker: a marker naming another
 *  tree says nothing about the one running (D-3200). */
export function installFrom(read: NodeFileRead, stamp: { stampRead: StampRead; build: BuildInfo | null }, caps: readonly string[]): { installState: InstallState; provenance: ProvenanceState } {
  if (stamp.build === null) return { installState: 'unknown', provenance: 'unknown' };
  if (!read.ok) return { installState: read.reason === 'absent' ? 'incomplete' : 'unknown', provenance: 'unknown' };
  const lines = linesOf(read.content);
  if (lines[0] !== stamp.build.sha) return { installState: 'incomplete', provenance: 'unknown' };
  const provenance: ProvenanceState = lines.length === 2 && lines[1] === 'unsigned' ? 'unverified'
    : lines.length === 1 && caps.includes('verify') ? 'verified'
      : 'unknown';
  return { installState: 'complete', provenance };
}

/** floor / previous → line 1 through the one tag guard, else NULL (§8). A
 *  NULL floor is UNCONSTRAINED to the resolver (§9), so a garbled floor file
 *  reads as the absence it is, never as `v0.0.0`. */
export function tagLineFrom(read: NodeFileRead): string | null {
  const line = firstLine(read);
  return isReleaseTag(line) ? line : null;
}

/** node-id → line 1 through NODE_ID_RE, else NULL (the row keys by label). */
export function nodeIdFrom(read: NodeFileRead): string | null {
  const line = firstLine(read);
  return line !== null && NODE_ID_RE.test(line) ? line : null;
}

/** Printable ASCII only — every run of anything else becomes one space — trimmed, cut to REPORT_DETAIL_MAX. */
export function printableDetail(raw: string): string {
  return raw.replace(/[^\x20-\x7e]+/g, ' ').trim().slice(0, REPORT_DETAIL_MAX);
}

function secondsToMs(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= REPORT_TIME_MAX_S ? v * 1000 : null;
}

/** update.json `{target, phase, startedAt, updatedAt, detail, from}` → the
 *  five report columns (§8, §10). NULL = no report file. Any other failure is
 *  a report whose phase is `unknown` — a node that wrote SOMETHING, which the
 *  phase table treats as "leave the lease alone" rather than as silence.
 *  Fields are read BY NAME and every other key is ignored: the file is
 *  additive, and a newer writer's extra key (wave 4's `pid`) is not a
 *  malformed report. */
export function reportFrom(read: NodeFileRead): NodeReport | null {
  const unknown: NodeReport = { phase: 'unknown', target: null, startedAt: null, updatedAt: null, detail: null };
  if (!read.ok) return read.reason === 'absent' ? null : unknown;
  let parsed: unknown;
  try { parsed = JSON.parse(read.content); } catch { return unknown; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return unknown;
  const o = parsed as Record<string, unknown>;
  const detail = typeof o.detail === 'string' ? printableDetail(o.detail) : '';
  return {
    phase: isUpdatePhase(o.phase) ? o.phase : 'unknown',
    target: isReleaseTag(o.target) ? o.target : null,
    startedAt: secondsToMs(o.startedAt),
    updatedAt: secondsToMs(o.updatedAt),
    detail: detail === '' ? null : detail,
  };
}

/** The seven reads → one row's measurement and report groups (§6's writer
 *  groups: nothing else). No node-id keys the row by its label with
 *  installState `unknown` (§8, a pre-W1 node). `agentOps` is validated again
 *  here — the ready reader validated it once (`readReadyOps`), and this is the
 *  last step before a row, so a caller that skipped that reader still cannot
 *  put an unvalidated word on the wire. */
export function measurementFrom(reads: NodeFileReads, conn: NodeConnection, now: number): NodeMeasurement {
  const stamp = stampFrom(reads.stamp);
  const { os, caps } = capsFrom(reads.caps);
  const nodeId = nodeIdFrom(reads.nodeId);
  const install = installFrom(reads.installed, stamp, caps);
  const build = stamp.build;
  return {
    nodeId: nodeId ?? conn.label,
    role: conn.role,
    label: conn.label,
    currentVersion: build?.version ?? null,
    currentSha: build?.sha ?? null,
    currentRef: build?.ref ?? null,
    currentBuiltAt: build?.builtAt ?? null,
    currentDirty: build === null ? null : build.dirty,
    stampRead: stamp.stampRead,
    installState: nodeId === null ? 'unknown' : install.installState,
    provenance: install.provenance,
    caps,
    agentOps: conn.agentOps === null ? null : (validCapWords(conn.agentOps) ?? []),
    highestVersion: tagLineFrom(reads.floor),
    previousVersion: tagLineFrom(reads.previous),
    os,
    measuredAt: now,
    report: reportFrom(reads.report),
  };
}

export async function measureNode(io: FleetIO, ccrcDir: string, budgetMs: number, conn: NodeConnection, now: number): Promise<NodeMeasurement> {
  return measurementFrom(await readNodeFiles(io, ccrcDir, budgetMs), conn, now);
}

/** The five current* columns back to the parser's own shape — no `version`
 *  key when the column is NULL, exactly as `parseBuildInfo` returns an
 *  unversioned stamp — so `buildAgreement` keeps its sha+dirty inputs (§14).
 *  NULL unless the stamp read `ok`: a row whose stamp could not be read has no
 *  build, whatever its columns last held. */
export function buildInfoOfRow(row: Pick<NodeRow, 'stampRead' | 'currentSha' | 'currentRef' | 'currentBuiltAt' | 'currentDirty' | 'currentVersion'>): BuildInfo | null {
  if (row.stampRead !== 'ok' || row.currentSha === null || row.currentRef === null
    || row.currentBuiltAt === null || row.currentDirty === null) return null;
  const base = { sha: row.currentSha, ref: row.currentRef, builtAt: row.currentBuiltAt, dirty: row.currentDirty };
  return row.currentVersion === null ? base : { ...base, version: row.currentVersion };
}

export type LeaseAction =
  | { kind: 'none'; why: 'no-report' | 'unchanged-report' | 'not-busy' | 'in-flight' | 'stale-report' | 'unknown-phase' }
  | { kind: 'settle'; detail: string }
  | { kind: 'release'; to: SettledUpdateState; detail: string };
export interface SweepPlan { lease: LeaseAction; refuse: { tag: string; detail: string } | null }

const BUSY: ReadonlySet<string> = new Set<string>(BUSY_UPDATE_STATES);
const IN_FLIGHT: ReadonlySet<string> = new Set<string>(IN_FLIGHT_UPDATE_PHASES);

function sameReport(row: NodeRow, r: NodeReport): boolean {
  return row.reportedPhase === r.phase && row.reportedTarget === r.target && row.reportedStartedAt === r.startedAt
    && row.reportedUpdatedAt === r.updatedAt && row.reportedDetail === r.detail;
}

/** The latest ms instant the report's run could have started (see
 *  REPORT_TIME_RESOLUTION_MS); NULL when the report carries no start. */
function latestStartOf(r: NodeReport): number | null {
  return r.startedAt === null ? null : r.startedAt + REPORT_TIME_RESOLUTION_MS - 1;
}

function leaseActionFor(row: NodeRow | null, m: NodeMeasurement, r: NodeReport): LeaseAction {
  if (row === null || !BUSY.has(row.updateState)) return { kind: 'none', why: 'not-busy' };
  // PRECEDENCE (§8): a report whose run started before this lease belongs to
  // a previous run and never moves it — the round-2 race, where a stale
  // `done` released a lease acquired seconds earlier. The store's WHERE
  // carries the same guard (Task 5); this plan never asks it to be tested.
  const latest = latestStartOf(r);
  if (latest !== null && row.updateStartedAt !== null && latest < row.updateStartedAt) return { kind: 'none', why: 'stale-report' };
  if (IN_FLIGHT.has(r.phase)) return { kind: 'none', why: 'in-flight' };
  switch (r.phase) {
    case 'done':
      return r.target !== null && m.currentVersion === r.target
        ? { kind: 'settle', detail: `done: ${r.target}` }
        : { kind: 'release', to: 'failed', detail: 'stamp-mismatch' };
    case 'failed':
    case 'reverted':
      return { kind: 'release', to: r.phase, detail: r.detail ?? r.phase };
    default:
      // `unknown` (a token outside UpdatePhase, or an unreadable report):
      // untouched inside the deadline, which W4's dispatcher enforces.
      return { kind: 'none', why: 'unknown-phase' };
  }
}

/**
 * The §8 phase table as a plan, pure. ACTS ONLY ON A CHANGED REPORT: update.json
 * persists, so a report the row already holds is one the sweep already acted
 * on — without this, a `failed` report would re-release a lease every minute
 * and re-insert a provenance refusal that `ack` just cleared (Review Focus 2).
 * The refusal is THIS node's verdict on THIS tag (§8), recorded whether or not
 * this server holds a lease — a CLI-driven update reports the same file.
 */
export function sweepPlanFor(row: NodeRow | null, m: NodeMeasurement): SweepPlan {
  const r = m.report;
  if (r === null) return { lease: { kind: 'none', why: 'no-report' }, refuse: null };
  if (row !== null && sameReport(row, r)) return { lease: { kind: 'none', why: 'unchanged-report' }, refuse: null };
  const refuse = r.phase === 'failed' && r.target !== null && r.detail !== null && r.detail.startsWith('provenance:')
    ? { tag: r.target, detail: r.detail }
    : null;
  return { lease: leaseActionFor(row, m, r), refuse };
}

/** The port this module needs, declared by the consumer (L2). `CoordStore` satisfies it structurally. */
export interface InventoryStore {
  upsertNodeMeasurement(m: NodeMeasurement): UpsertNodeResult;
  markUnreachable(label: string, role: NodeRole, at: number): MarkUnreachableResult;
  rekeyNode(label: string, nodeId: string): RekeyNodeResult;
  releaseLease(nodeId: string, to: SettledUpdateState, detail: string, reportStartedAt: number | null): ReleaseLeaseResult;
  settleNode(nodeId: string, detail: string, reportStartedAt: number | null): SettleNodeResult;
  refuseRelease(nodeId: string, tag: string, at: number, detail: string): RefuseReleaseResult;
  node(nodeId: string): NodeRow | null;
  nodeByLabel(label: string): NodeRow | null;
}
export interface InventoryDeps {
  store: InventoryStore; localIo: FleetIO; ccrcDir: string; role: NodeRole;
  fleet: { io: FleetIO; state: FleetState } | null;
  budgetMs?: number;
}
export type SweepOutcome =
  | { label: string; result: 'measured'; nodeId: string; lease: LeaseAction['kind']; refused: boolean }
  | { label: string; result: 'unreachable'; nodeId: string }
  | { label: string; result: 'refused'; why: string };

/** Read through a function so a check after an `await` reads the live field. */
const linkUp = (state: FleetState): boolean => state.connected;

/** `label-key-taken` (Task 5): no live row carries the label AND a row
 *  already holds the label-keyed placeholder's key — superseded (its heir
 *  named) or live under another label (null). Nothing was written, so it is
 *  reported as a refusal, never as the `unreachable` row it is not. */
function unreachable(store: InventoryStore, now: number): SweepOutcome {
  const r = store.markUnreachable(FLEET_LABEL, 'fleet', now);
  if (!r.ok) return { label: FLEET_LABEL, result: 'refused', why: `${r.why}: ${r.supersededBy ?? 'held by a live row under another label'}` };
  return { label: FLEET_LABEL, result: 'unreachable', nodeId: r.nodeId };
}

/** One measurement into the store, in the order §8 fixes: re-key, plan
 *  against the pre-upsert row, upsert, refuse, lease. */
function applyMeasurement(store: InventoryStore, measured: NodeMeasurement, now: number): SweepOutcome {
  const label = measured.label;
  let m = measured;
  if (m.nodeId !== label) {
    const rekeyed = store.rekeyNode(label, m.nodeId);
    if (!rekeyed.ok) return { label, result: 'refused', why: rekeyed.why };
  } else {
    // D-3201: no node-id this sweep, but the live row carrying
    // this label was already re-keyed to one — keep measuring into it rather
    // than open a second live row for the same connection.
    const live = store.nodeByLabel(label);
    if (live !== null && live.nodeId !== label) m = { ...m, nodeId: live.nodeId };
  }
  const plan = sweepPlanFor(store.node(m.nodeId), m);
  const upserted = store.upsertNodeMeasurement(m);
  if (!upserted.ok) return { label, result: 'refused', why: `${upserted.why}: ${upserted.supersededBy}` };
  let refused = false;
  if (plan.refuse !== null) {
    const r = store.refuseRelease(m.nodeId, plan.refuse.tag, now, plan.refuse.detail);
    refused = r.ok && r.inserted;
  }
  const latest = m.report === null ? null : latestStartOf(m.report);
  let lease: LeaseAction['kind'] = 'none';
  if (plan.lease.kind === 'settle') {
    if (store.settleNode(m.nodeId, plan.lease.detail, latest).ok) lease = 'settle';
  } else if (plan.lease.kind === 'release') {
    if (store.releaseLease(m.nodeId, plan.lease.to, plan.lease.detail, latest).ok) lease = 'release';
  }
  return { label, result: 'measured', nodeId: m.nodeId, lease, refused };
}

/**
 * One sweep over every node this server can name: its own row through the
 * local io, and — in remote mode — the one agent connection. A connection that
 * is down on this sweep is written unreachable ON THIS SWEEP (§8), never left
 * at its last value; one that drops while its reads are in flight is too,
 * because seven `unreadable`s across a drop describe the link, not the node.
 */
export async function sweepInventory(deps: InventoryDeps, now: number): Promise<SweepOutcome[]> {
  const budget = deps.budgetMs ?? INVENTORY_BUDGET_MS;
  const out: SweepOutcome[] = [];
  const own = await measureNode(deps.localIo, deps.ccrcDir, budget, { label: SERVER_LABEL, role: deps.role, agentOps: null }, now);
  out.push(applyMeasurement(deps.store, own, now));
  if (deps.fleet !== null) {
    const { io, state } = deps.fleet;
    if (!linkUp(state)) {
      out.push(unreachable(deps.store, now));
    } else {
      // `agentOps` is read inside the connected arm only: the field keeps the
      // last `ready`'s answer across a drop (Task 8).
      const m = await measureNode(io, deps.ccrcDir, budget, { label: FLEET_LABEL, role: 'fleet', agentOps: state.agentOps ?? [] }, now);
      out.push(linkUp(state) ? applyMeasurement(deps.store, m, now) : unreachable(deps.store, now));
    }
  }
  return out;
}
```

This file names no `node:sqlite`, no `db.js` path and no `<coord|store>` `.db` reach. It imports `../coord/store.js` for types and for ONE value, `NODE_ID_RE` (Task 5's single declaration) — a store import is exactly what Task 7's update-ring CONTROL case holds legal (`e.ts`); only `node:sqlite`, a coord `db.js` and a handle reach are forbidden. Task 7's update-ring scan reads it once Step 1's list names it.

- [ ] **Step 4: Run the module's cases**

Run: `cd server && ./node_modules/.bin/vitest run test/update-inventory.test.ts` (foreground)
Expected: every case in `readNodeFile`, `the validators`, `measurementFrom and buildInfoOfRow`, `sweepPlanFor` and the three `sweepInventory` describes PASSES; every case in `the inventory lane in FleetWatcher` and the first case of `the fleet node over a real agent` FAIL, each on the missing method (`inventoryNow` / `triggerInventory` is not a function — the watcher has no lane yet); the real-agent symlink case passes; in `index.ts composes the update lanes`, `wires the ready trigger exactly once …` FAILS (`index.ts must carry the one ready trigger`, length 0 — Step 6 has not run) while the literal-split control and the catalogue case PASS (Task 10 wired both arms).

- [ ] **Step 5: Wire the lane in `server/src/watch.ts`**

Beside the other lane imports (after `import { measureFleetReadiness, type FleetReadiness } from './readiness.js';`, `watch.ts:61`, and beside Task 10's import if it added one):

```ts
import { sweepInventory, type InventoryDeps, type SweepOutcome } from './update/inventory.js';
```

After Task 10's `UPDATE_CATALOGUE_MS` (itself directly after `const CAPS_REFRESH_MS = 60_000;`, `watch.ts:191`):

```ts

/** The inventory lane (design 2026-09-20 §8): seven small ~/.ccrc reads per
 *  node, lstat-gated and budget-bounded, once a minute — and at once after a
 *  `ready` frame (`triggerInventory`, wired in `index.ts`). */
const UPDATE_INVENTORY_MS = 60_000;
```

After Task 10's `private lastCatalogueAt = 0;` (itself after `private lastCapsAt = 0;`, `watch.ts:471`):

```ts
  /** The inventory lane's clock, and its ONE run in flight. Starts at 0 so
   *  the first tick after a start sweeps. `inventoryNow()` sets the clock, so
   *  a `ready`-triggered sweep also defers the minute gate's next one. */
  private lastInventoryAt = 0;
  private inventoryRun: Promise<SweepOutcome[]> | null = null;
```

After `stop()`'s closing brace (`watch.ts:703-708`):

```ts

  /**
   * The inventory lane's ONE run (design 2026-09-20 §8). The minute gate in
   * `tick()`, the `ready` trigger in `index.ts` and `GET /api/updates`
   * (Task 13, before the first sweep) all JOIN the run in flight rather than
   * start a second: at boot the first tick and the first `ready` routinely
   * coincide, and a second sweep would re-read fourteen files to learn
   * nothing. Resolves `[]` on a server with no coord store.
   */
  inventoryNow(): Promise<SweepOutcome[]> {
    if (this.inventoryRun !== null) return this.inventoryRun;
    this.lastInventoryAt = Date.now();
    const run = this.runInventory().finally(() => { this.inventoryRun = null; });
    this.inventoryRun = run;
    return run;
  }

  /** For a caller that must not wait: the `ready` hook runs inside the
   *  client's handshake handler. */
  triggerInventory(): void {
    void this.inventoryNow().catch(() => { /* one bad sweep must not kill the caller */ });
  }

  /** Builds the sweep's deps and holds this file's one call to sweepInventory
   *  (Task 12 swaps that callee for the sweep-then-project step). The server's
   *  own row is read through `localIO` in both modes — `deps.io` is the FLEET
   *  box's io in remote mode. */
  private async runInventory(): Promise<SweepOutcome[]> {
    const coord = this.deps.coord;
    if (coord === undefined) return [];
    const { cfg, fleetState } = this.deps;
    const inv: InventoryDeps = {
      store: coord, localIo: localIO, ccrcDir: cfg.ccrcDir, role: cfg.role,
      fleet: cfg.fleetMode === 'remote' && fleetState !== undefined ? { io: this.deps.io, state: fleetState } : null,
    };
    return sweepInventory(inv, Date.now());
  }
```

In `tick()`, at the top of the `try {` that follows `this.ticking = true;` (`watch.ts:787-788`), BEFORE the `// Read once, share with the two lanes …` comment and the `readRegistryMeasured` call (`:811`). Task 10 lands first and — by the coordinator's ruling that BOTH update lanes sit above the fail-shut return (D-3198) — its catalogue gate is already the first block of that `try`; insert this block directly below the catalogue block's closing brace, so the order is `try {`, the catalogue gate, the inventory gate, then the `// Read once …` comment. (If the catalogue gate is not at the top of the `try`, Task 10 was not applied per that ruling: stop and report, rather than place this block relative to it.)

```ts
      // The inventory lane (design 2026-09-20 §8) is gated HERE, beside the
      // catalogue lane and above the registry read and its fail-shut return
      // (`:828`), because it is not registry-sourced — it reads ~/.ccrc — and
      // the one state it exists to record on the sweep it happens, a fleet
      // link that is down, is exactly the state in which
      // `readRegistryMeasured` answers `listed: false` and that return skips
      // every lane below it (D-3198, which covers
      // both update lanes).
      // NEVER awaited: seven reads per node over the agent must not stall the
      // dialog detector or the busy->idle push.
      if (this.deps.coord && Date.now() - this.lastInventoryAt >= UPDATE_INVENTORY_MS) {
        void this.inventoryNow().catch(() => { /* one bad sweep must not kill the poll */ });
      }
```

Check the one call: `grep -n 'sweepInventory(' server/src/watch.ts` — Expected: exactly ONE hit, inside `runInventory` (the import line has no `(`, and `runInventory`'s docstring names the function without one — a comment spelling the call token would be a second hit).

- [ ] **Step 6: Wire the `ready` trigger in `server/src/index.ts`**

Change the import (`index.ts:10`):

```ts
import { connectFleet, type FleetClient } from './remote/client.js';
```

Replace `let deps: Deps;` (`index.ts:81`) with:

```ts
// The one agent connection, hoisted out of the remote arm so the `ready`
// hook below can reach it once the watcher exists. Null in local mode.
let fleetClient: FleetClient | null = null;
let deps: Deps;
```

In the remote arm, directly after `const fleet = connectFleet({ url: cfg.agentUrl, token: cfg.agentToken });` (`index.ts:87`):

```ts
  fleetClient = fleet.client;
```

Directly after `const watcher = new FleetWatcher(deps, bus);` (`index.ts:164`):

```ts
// Design 2026-09-20 §8: a `ready` frame measures the fleet node at once. The
// handshake is when an agent that just restarted — a self-update among the
// reasons — becomes measurable, and a minute is too long to show the old
// build. A `ready` that fired before this line (the client connects while
// `notifyLog.load()` is awaited above) is covered by the first tick: the
// inventory lane's clock starts at 0.
fleetClient?.onConnected(() => watcher.triggerInventory());
```

- [ ] **Step 7: Run green, and the neighbours the wiring touches**

Run, each in the foreground from `server/` (timeout ≥ 600000 ms):
- `./node_modules/.bin/vitest run test/update-inventory.test.ts` — Expected: PASS, every case (the EACCES case skips only under uid 0; its scripted twin in `readNodeFile` runs everywhere).
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — Expected: PASS; the update-ring scan now reads `inventory.ts` and finds no `node:sqlite`, no `db.js` import, no store-db reach; and "one absent/unreadable read vocabulary" › "is declared in exactly one file, and that file is shared/agent-protocol.ts" (`:2566-2588`, `PAIR` at `:2573`) stays green because `NodeFileRead` spells `ReadFailure | 'too-large'` — that scan is WHY the union is derived: the spelled `'absent' | 'unreadable' | 'too-large'` matches `PAIR` and makes `server/src/update/inventory.ts` a second holder. Confirm: `grep -nE "'absent'\s*\|\s*'unreadable'|'unreadable'\s*\|\s*'absent'" server/src/update/inventory.ts` — Expected: no output.
- `./node_modules/.bin/vitest run test/caps-refresh.test.ts` — Expected: PASS (the caps lane's counts are unchanged: `testDeps()` has no `coord`, so the new gate is inert there).
- `./node_modules/.bin/vitest run test/boot.test.ts` — Expected: PASS (it spawns the real `index.ts` in local mode; `fleetClient` is null there).
- `./node_modules/.bin/vitest run test/remote-connect.test.ts` — Expected: PASS (nothing in the client changed; Task 8's `agentOps` case still holds).
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — Expected: PASS (the new test file typechecks under the tests' tsconfig).
- `./node_modules/.bin/tsc --noEmit -p .` — Expected: exit 0.
- `./node_modules/.bin/vitest run test/topology-clean.test.ts` after `git add` of the new files (Step 9's paths) — Expected: PASS (fixture uuids, an invented sha, no hostname, no home path).
- `./node_modules/.bin/vitest run test/session-hook.test.ts` — Expected: PASS. `single-definition.test.ts` is cited by line in this suite's citation audit (`:32-37`, `:1274`, `:1303`); Step 1's edit replaces the `UPDATE_RING_FILES` line with exactly one line, so no cited line moves and the per-file census is unchanged. Confirm it is line-neutral first: `git diff HEAD --numstat -- server/test/single-definition.test.ts` — Expected: `1	1	server/test/single-definition.test.ts`. `session-hook` is a named load flake — a red is re-run in isolation before it is read. None of `watch.ts`, `index.ts` or `inventory.ts` is cited by line in the audited documents.

- [ ] **Step 8: Mutation measurements (each red, then restored and green)**

Stage first (`git add` Step 9's paths), so each restore comes from the INDEX: make the edit, run `./node_modules/.bin/vitest run test/update-inventory.test.ts`, see the named case red, then `git checkout -- <file>` and `git diff --exit-code -- <file>` (exit 0 = restored). Finish with one green run of the file.

| §18 row | Edit (in `server/src/update/inventory.ts` unless named) | Must red |
|---|---|---|
| reads refuse a non-regular file | delete `if (kind.kind !== 'regular') return UNREADABLE;` | `a symlinked build.json is unreadable and NEVER followed` (reads `ok`) and the real-agent symlink case is unchanged-green (the agent refuses the canonical path itself — a second, independent wall; note it) |
| reads are bounded (the stat gate) | delete `if (size.size > NODE_FILE_CAP_BYTES) return TOO_LARGE;` | `a 70 KiB stamp is refused by its size before a byte is read` (`expected 1 to be +0` — the read happened) |
| reads are bounded (the length re-check) | delete the `Buffer.byteLength(…) > NODE_FILE_CAP_BYTES` line | `a file that grows between the stat and the read` |
| reads are bounded (bytes, not characters) | change `Buffer.byteLength(read.content, 'utf8')` to `read.content.length` | `a file that grows …` on the `'é'.repeat(32_769)` assertion |
| reads are validated (caps) | in `capsFrom` change `if (caps === null) return { os: 'unknown', caps: [] };` to `if (caps === null) return { os: os[1] === 'darwin' ? 'darwin' : 'linux', caps: lines.slice(1) };` | `capsFrom: os then words …` (a bad word survives) |
| reads are validated (detail) | in `printableDetail` delete `.slice(0, REPORT_DETAIL_MAX)` | `printableDetail keeps printable ASCII only, bounded` and `reportFrom: …` |
| reads are validated (units) | in `secondsToMs` delete `&& v <= UNIX_SECONDS_MAX` (was `REPORT_TIME_MAX_S`, deleted C5, final fix wave — the bound now lives in `shared/api.ts`) | `reportFrom: SECONDS in, ms out; a ms value is refused` |
| the report reader ignores unknown keys | in `reportFrom`, directly after `const o = parsed as Record<string, unknown>;`, add `if (Object.keys(o).some((k) => !['target', 'phase', 'startedAt', 'updatedAt', 'detail', 'from'].includes(k))) return unknown;` | `reportFrom: SECONDS in, ms out …` on the extra-key assertion (`pid` reads `unknown`) |
| `stampRead` keeps EACCES from unversioned | in `stampFrom` change `return { stampRead: read.reason, build: null };` to `return { stampRead: read.reason === 'absent' ? 'absent' : 'ok', build: null };` | `stampFrom: …` (`UNREADABLE` → `ok`), the scripted-EACCES case via `stampFrom`, and (non-root) the EACCES sweep case |
| unmeasured never reads absent | in `readNodeFile` change `return kind.reason === 'absent' ? ABSENT : UNREADABLE;` (the lstat line) to `return ABSENT;` | `an lstat this io cannot answer … reads unreadable, never absent`, and the real-agent `a build.json symlinked onto a secret file …` (the agent refuses that lstat, the remote io answers `unmeasured`, and the row would read `absent`) |
| the failure words are derived, not restated | in `NodeFileRead`'s failure arm replace the word `ReadFailure` with the two quoted words it stands for, joined by the union bar (the Step 7 grep's pattern), and run `./node_modules/.bin/vitest run test/single-definition.test.ts` instead | `is declared in exactly one file, and that file is shared/agent-protocol.ts` (`holders` gains `server/src/update/inventory.ts`) |
| a full `BuildInfo` round-trips | in `measurementFrom` change `currentDirty: build === null ? null : build.dirty,` to `currentDirty: build === null ? null : false,` | `a full stamp fills all five current* columns and round-trips — dirty included` |
| the phase table is applied | in `leaseActionFor`'s `case 'done':`, replace the mismatch branch `{ kind: 'release', to: 'failed', detail: 'stamp-mismatch' }` with the settle object on the line above it | `done at the measured version settles; done at any other version is failed` and `done at another version → failed: stamp-mismatch via releaseLease` |
| a stale report never moves the lease (the planner's half) | delete the `if (latest !== null && row.updateStartedAt !== null && latest < row.updateStartedAt) …` line | `a previous run's report never moves the lease` (the store's own WHERE still holds the through-store case green — Task 5 measures that half) |
| the report's second is the current run | change `r.startedAt + REPORT_TIME_RESOLUTION_MS - 1` to `r.startedAt` | `a previous run's report …` on the same-second assertion (`stale-report` instead of `settle`), and `done at the stamped version → idle via settleNode` (the planner now reads the lease's own second as a previous run) |
| only a changed report acts | delete `if (row !== null && sameReport(row, r)) return …;` in `sweepPlanFor` | `a provenance failure refuses … ack clears it and the standing report does not re-insert it` (a second refusal after ack) |
| a label row re-keys | in `applyMeasurement` delete the `const rekeyed = …` line and the `if (!rekeyed.ok) …` line after it (keep the empty `if` block) | `a node-id appearing on a labelled row re-keys it in place` (two rows) and `a node-id already keyed to a live row under a DIFFERENT label is a collision, never a merge` (renamed and reversed by D-3211: the row is now KEPT as two, never superseded) |
| a vanished node-id keeps its row | delete the `if (live !== null && live.nodeId !== label) m = …;` line | `a node-id that vanishes after a re-key …` (two live rows) |
| unreachable is written on the sweep it happens | in `sweepInventory` replace `out.push(unreachable(deps.store, now));` (the first, disconnected arm) with nothing | `a missing connection is unreachable on THAT sweep` |
| unreachable across a drop | change `out.push(linkUp(state) ? applyMeasurement(deps.store, m, now) : unreachable(deps.store, now));` to `out.push(applyMeasurement(deps.store, m, now));` | `a link that drops while the reads are in flight …` |
| a refused placeholder is not reported written | in `unreachable` delete the `if (!r.ok) return { … };` line | `an unreachable fleet whose label key a superseded row holds is reported refused` (`result: 'unreachable'` with `nodeId: undefined`) |
| a provenance failure refuses FOR THAT NODE | in `applyMeasurement` delete the `if (plan.refuse !== null) { … }` block | `a provenance failure refuses (node, target) once, for THIS node only` and `sweepPlanFor`'s case stays green (the plan is intact) |
| measurement is a sweep | in `server/src/watch.ts` delete the `if (this.deps.coord && Date.now() - this.lastInventoryAt >= UPDATE_INVENTORY_MS) { … }` block | `sweeps on the first tick even when the registry will not list` (`expected spy to be called 1 times, but got 0 times`) |
| the lane is above the fail-shut return | in `server/src/watch.ts` move that same block to just after the `if (!registryRead.listed) { … return; }` block's closing brace | both `the inventory lane in FleetWatcher` tick cases |
| the minute cadence | in `server/src/watch.ts` delete `this.lastInventoryAt = Date.now();` in `inventoryNow` | `sweeps on the first tick …` at the second tick (2 calls) |
| single flight | in `server/src/watch.ts` delete `if (this.inventoryRun !== null) return this.inventoryRun;` | `inventoryNow is single-flight` (`expected b to be a`) |
| the ready trigger (behaviour) | (a test-local seam — `index.ts` is never imported by a test) in the test, delete `fleet.client.onConnected(() => w.triggerInventory());` | `a ready frame measures the fleet node inside the same second` (times out at 1000 ms); restore the test from the index as above |
| the ready trigger (the real line) | in `server/src/index.ts` delete `fleetClient?.onConnected(() => watcher.triggerInventory());` | `wires the ready trigger exactly once …` (`index.ts must carry the one ready trigger`, length 0); every other case stays green — the gap this pin exists for |
| the catalogue in the remote arm | in `server/src/index.ts` delete the remote arm's `catalogue,` line (the one followed by `refreshCaps: makeRefreshCaps(`) | `hands Task 10's catalogue poller to BOTH deps arms`; `tsc --noEmit` stays exit 0 (`Deps.catalogue` is optional) — note it |
| the arm split is not vacuous | in the test change `'io: localIO'` to `'io: nowhere'` | `splits into exactly the remote and the local deps literal …`; restore the test from the index |

- [ ] **Step 9: Commit**

```bash
git add server/src/update/inventory.ts server/src/watch.ts server/src/index.ts \
  server/test/single-definition.test.ts server/test/update-inventory.test.ts
git commit -m "feat(update): the inventory sweep — seven ~/.ccrc files per node, lstat-gated, capped and validated; re-key, supersede, unreachable on the sweep it happens; the §8 phase table through releaseLease/settleNode; a minute sub-cadence above the fail-shut return and a ready trigger"
```

### Task 12: Resolver and projection

**Files:**
- Create: `server/src/update/resolve.ts` — L1, imports only `../../../shared/api.js` and `../../../shared/semver.js` (ruling R7: every file under `server/src/update/` imports shared modules at three levels; the skeleton's Global Constraints line `../../shared/*` is one level short — `server/src/coord/store.ts:54`'s `'../../../shared/api.js'` shows the depth)
- Create: `server/src/update/project.ts` — L3 (D-3187); imports `../../../shared/api.js` and `../../../shared/agent-protocol.js` (R7)
- Modify: `server/src/watch.ts` — one import line beside Task 11's `./update/inventory.js` import; a module-level `projectionWhy` helper after Task 10/11's two update cadences; one field after Task 11's `private inventoryRun`; one private method `sweepThenProject` after Task 11's `runInventory()`; and inside Task 11's `runInventory()` its ONE `sweepInventory(` call becomes `this.sweepThenProject(` with the same arguments, so the resolve runs inside `inventoryNow()`'s single-flight promise, and the first two lines of `runInventory`'s docstring are replaced line-for-line to say it now calls `sweepThenProject`. (`watch.ts` is cited by no document in the session-hook citation audit's corpus — measured: zero `watch.ts:<n>` anchors in the compaction-card spec, its plan-a or README — so these inserts move no census.)
- Modify: `server/test/single-definition.test.ts` — the ONE `UPDATE_RING_FILES` line inside Task 7's update-ring describe (appended at top level after the file's last line, so the declaration sits at a two-space indent) gains `'resolve.ts'`, `'project.ts'`: one line replaced by one line, so the edit is line-neutral against the citation audit's anchors into this file (`:32-37`, `:1274`, `:1303`, census 8) — ruling R13; Step 11's green run includes `session-hook.test.ts`
- Test: `server/test/update-resolve.test.ts` (create), `server/test/update-projection.test.ts` (create) — the embedded python validator implements the `ccd-pool-sync` grammar discipline (whole-document pass, `end` terminator, 65536 cap); its comment says W4's real `ccd-update-sync` renderer takes this pin over
- Guard files checked and NOT touched: `mail-routes.test.ts`'s kebab scanner reads `server/src/coord` only, and this task adds no file there (the new words `not-server-role`, `no-server-row`, `no-channel`, `unwritable`, `unknown-release-channel`, `not-in-catalogue`, `no-bundle-listed`, `refused-by-this-node`, `not-on-stable` live in `server/src/update`), so no `UPDATE_STORE_REFUSE_CODES` append (R5) is owed; `auth-gate.test.ts`, `box-token-census.test.ts` and `coord-pause-route.test.ts` scan routes and this task registers none; `pools-prose.test.ts`'s never-writes scan matches a write call with a `pools` path literal within 200 characters, and `project.ts`'s `writeFile`/`rename` name `NODE_FILES.projection` only; readiness tests exercise `tick()`, which this task does not edit

**Interfaces:**
- Consumes: `compareReleaseTags`, `isNewerTag` (Task 2, `shared/semver.ts`; `newestTag` is not needed — `eligibleTags` sorts once and the resolver reads its head); Task 1's `UpdateChannel`, `AutoMode`, `NodeRole`, `isReleaseTag`, `TagFileRead`, and `FLEET_SCOPE` — ruling R4: `FLEET_SCOPE = '*'` is declared ONCE in `shared/api.ts`'s end-of-file update block (Task 1); this L1 resolver imports it from there, and so do `project.ts` and `update-resolve.test.ts`; no file here declares it and none imports it from `store.ts`. Task 4's `releases(): ReleaseRow[]` (`tag`, `channel: UpdateChannel | null`, `bundleListed`, `yanked`), `refusalsFor(nodeId): RefusalRow[]` (`tag`), `type ReleaseListingRow`, `applyReleaseListing(listing, now, coverage: ListingCoverage, keepTags?, withdrawTag?)` (CORRECTION, fix round 2, R5/C1: two more, both optional, call-compatible with the three-argument shape — fix round 1, ruling A) and `refuseRelease(nodeId, tag, at, detail)` (the last three in the tests only); Task 5's `nodes(): NodeRow[]`, `node(nodeId)`, `nodeByLabel(label)`, `resolveNode(nodeId, r: NodeResolvedColumns): ResolveNodeResult`, `type NodeRow`/`NodeResolvedColumns`/`ResolveNodeResult`/`NodeMeasurement` and `upsertNodeMeasurement` (tests); Task 6's `intentFor(scope): UpdateIntentRow | null` (`channel: UpdateChannel | null`, `pinnedTag`, `auto`), `updateEpoch(): { epoch; issuedAt }`, and — tests only — `setIntent(scope, patch, log, now)`, `UpdateIntentLog`, `defaultUpdateIntentLogPath` (`server/src/coord/updateintentlog.ts`); all store reads reach `project.ts` through its `ProjectStore` port only; `NODE_FILES.projection` (= `'update-intent'`) and `NODE_FILES.floor` (Task 8, `shared/agent-protocol.ts`); `cfg.role`, `cfg.ccrcDir` (Task 9); `SERVER_LABEL`, `FLEET_LABEL`, `sweepInventory`, `InventoryDeps`, `SweepOutcome`, `FleetWatcher.inventoryNow()` and the private `FleetWatcher.runInventory()` that holds `watch.ts`'s one `sweepInventory(` call (Task 11).
- Produces:

```ts
// server/src/update/resolve.ts — PURE
export const UPDATE_GATE_CAP = 'update-gate';
export const PROJECTION_LEASE_S = 15 * 60;
export interface EligibilityRow { tag: string; channel: UpdateChannel | null; bundleListed: boolean; yanked: boolean }
export interface IntentView { channel: UpdateChannel | null; pinnedTag: string | null; auto: AutoMode }
// CORRECTION (fix round 2, R5/D-3217's class): `floorRead` (fix round 1,
// D-3213) added — how the STORED `highestVersion` was arrived at; `absent` =
// a real, measured "no floor" (unconstrained); `unmeasured` = NOTHING has
// ever been measured for this node, so nothing resolves, never the
// `currentVersion` fallback an absent floor would license.
export interface ResolveInput {
  currentVersion: string | null; highestVersion: string | null;
  floorRead: TagFileRead;                 // ADDED, D-3213
  nodeIntent: IntentView | null;          // update_intent[nodeId]; null = no row → the fleet row decides
  fleetIntent: IntentView | null;         // update_intent['*']; null = the seed row is gone → nothing resolves
  releases: readonly EligibilityRow[];    // never the refusal roll-up
  refusedByThisNode: ReadonlySet<string>;
}
export interface Resolution {
  channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null;   // = NodeResolvedColumns, structurally
  desiredStable: string | null; desiredDev: string | null; auto: AutoMode;
}
// corrected: the skeleton's why-union had no word for a release whose channel token is outside the vocabulary
// (it reads null, D-3181) — such a release is on neither channel, and 'not-on-stable' would
// be false on a dev node. Declared as a type plus a derived list (the PR_REASONS idiom).
export type PinnedIneligibleWhy =
  | 'not-in-catalogue' | 'no-bundle-listed' | 'yanked' | 'refused-by-this-node' | 'not-on-stable' | 'unknown-release-channel';
export const PINNED_INELIGIBLE_WHYS: readonly PinnedIneligibleWhy[];   // Object.keys of the reason-text record
export const RESOLVE_DETAIL: {
  pinnedAtOrBelowFloor(pin: string, floor: string): string;     // "pinned v0.0.5 is at or below this node's floor v0.0.9 — pin a newer tag, or use rollback"
  notNewerThanFloor(newest: string, floor: string): string;     // "newest eligible v0.0.5 is not newer than this node's floor v0.0.9 — a yank or demotion cannot move a node down; a newer release will"
  rolledBack(current: string, floor: string): string;           // "this node was rolled back to v0.0.8 and its floor is v0.0.9 — auto stays off this tag until a release above v0.0.9 exists (decision 8)"
  noFloor(): string;                                             // "no floor and no measured version — nothing to compare against"
  // ADDED (fix round 2, R5/D-3217's class; fix round 1, D-3213, m-2): worded
  // to hold for a node that was never reached at all (markUnreachable's
  // placeholder), not only one whose floor file failed to read.
  floorUnmeasured(): string;                                     // "this node's floor has not been measured — nothing resolves until it is"
  pinnedIneligible(pin: string, why: PinnedIneligibleWhy): string;
  noEligible(channel: UpdateChannel): string;
  unknownChannel(): string;
  noIntent(): string;                                            // corrected: added — no node row AND no '*' row is not an unknown token
};
/** D-3202: the higher of the two tags; a NULL highestVersion is unconstrained (current stands in). */
export function floorOf(highestVersion: string | null, currentVersion: string | null): string | null;
// ADDED (fix round 2, R5/D-3217's class; fix round 1, D-3216, F11): ingress-only,
// on top of isReleaseTag — refuses a tag over RELEASE_TAG_INGRESS_MAX_BYTES bytes,
// carrying a leading zero in any component that is not itself the bare digit
// '0', OR (fix round 2, R9, D-3216) carrying any component over
// RELEASE_TAG_COMPONENT_MAX_DIGITS digits — safely under a 64-bit signed
// integer's range, which `ccd/ccrc`'s bash twin (`_ver_newer`'s `10#`
// arithmetic) would otherwise silently overflow on. This digit cap makes the
// byte cap UNREACHABLE on its own for `v`'s fixed three-component grammar
// (three components at 18 digits each is only 57 bytes), kept anyway as a
// defensive backstop against a future grammar change. Gates both the
// catalogue's element parse (Task 10) and the intent route's pinnedTag
// (Task 13) — one predicate, never a second copy.
export const RELEASE_TAG_INGRESS_MAX_BYTES = 64;
export const RELEASE_TAG_COMPONENT_MAX_DIGITS = 18;
export function isIngestibleReleaseTag(v: unknown): v is string;
export function eligibleTags(releases: readonly EligibilityRow[], channel: UpdateChannel, refused: ReadonlySet<string>): string[];   // newest first
export function resolveNodeIntent(input: ResolveInput): Resolution;
export function autoGateBlockers(scope: string, nodes: readonly { nodeId: string; caps: readonly string[] }[]): string[];   // FLEET_SCOPE = every node given
export interface ProjectionDoc {
  epoch: number; issued: number; lease: number;               // unix SECONDS; lease = issued + PROJECTION_LEASE_S
  channel: UpdateChannel; desired: string | null; desiredStable: string | null; desiredDev: string | null; auto: AutoMode;
}
export type RenderedProjection =
  | { ok: true; doc: ProjectionDoc; text: string }            // "epoch N\nissued S\nlease S\nchannel C\ndesired T|none\ndesired-stable …\ndesired-dev …\nauto A\nend\n"
  | { ok: false; why: 'no-channel'; detail: string };
/** Throws RangeError on a caller bug — epoch not a non-negative integer, issuedAtS not unix SECONDS (> 99_999_999_999
 *  is a ms value), a desired* that is not a tag — the compareReleaseTags precondition stance; never renders one. */
export function renderProjection(r: Resolution, epoch: number, issuedAtS: number): RenderedProjection;

// server/src/update/project.ts — L3
export const PROJECTION_FILE_MODE = 0o600;
export interface ProjectStore {
  nodes(): NodeRow[]; releases(): ReleaseRow[]; refusalsFor(nodeId: string): RefusalRow[];
  intentFor(scope: string): UpdateIntentRow | null; updateEpoch(): { epoch: number; issuedAt: number };
  resolveNode(nodeId: string, r: NodeResolvedColumns): ResolveNodeResult;
}
export function resolveInputFor(store: Omit<ProjectStore, 'resolveNode' | 'nodes'>, node: NodeRow): ResolveInput;
export type WriteProjectionResult = { ok: true; path: string } | { ok: false; why: 'unwritable'; detail: string; code: string | null };   // D-3217: code is the fs errno, null for a thrown non-ErrnoException
export async function writeOwnProjection(ccrcDir: string, text: string): Promise<WriteProjectionResult>;   // .update-intent.<pid>.<ms>.tmp → rename, mode 0600
export type ProjectionOutcome =
  | WriteProjectionResult
  | { ok: false; why: 'no-channel'; detail: string }
  | { ok: false; why: 'not-server-role' }
  | { ok: false; why: 'no-server-row' };
export interface ResolveRunResult { resolved: number; refused: { nodeId: string; why: string }[]; projection: ProjectionOutcome }
export interface ProjectDeps { store: ProjectStore; role: NodeRole; ccrcDir: string }
/** Resolve + store every live node; then render and write the SERVER_LABEL row's document when role is 'server' | 'both'.
 *  Queued per ccrcDir: a run takes its snapshot only after the previous run for the same directory settled, so the
 *  inventory run and the routes' reproject (Task 13) never interleave two writers, and the file's epoch never goes down. */
export async function resolveAndProject(deps: ProjectDeps, now: number): Promise<ResolveRunResult>;

// server/src/watch.ts — FleetWatcher gains (private; corrected: the skeleton named only the behaviour)
private lastProjectionWhy: string | null;                                              // warn once per change of reason
private async sweepThenProject(inv: InventoryDeps, now: number): Promise<SweepOutcome[]>; // the ONE place sweepInventory is called
```

§18 rows this task pins: "the resolver skips unlisted/yanked/refused-by-this-node", "the resolver never goes below the floor, pinned or not", "a NULL floor is unconstrained", "the two floor sentences", "a pinned ineligible tag resolves NULL", "an unknown channel token resolves nothing", "the projection is seconds", "the projection carries both desireds", "the ring scan covers `update/`" (the two new files join it); plus the whole-or-nothing half of "the projection is whole-or-nothing" for the server-role writer (a refused render writes nothing; the renderer's second-pass row itself is W4's `ccd-update-sync`).

- [ ] **Step 1: Write the failing resolver test**

Create `server/test/update-resolve.test.ts`:

```ts
// The §9 resolver table (design 2026-09-20): channel resolution, eligibility,
// the floor, the pin, the sentences, both desireds, the auto-gate predicate —
// and the import block that keeps this file's subject L1. Every case is a
// value in, a value out: resolve.ts touches no fs and no store, so nothing
// here needs a fixture home.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PINNED_INELIGIBLE_WHYS, RESOLVE_DETAIL, UPDATE_GATE_CAP, autoGateBlockers, eligibleTags, floorOf, resolveNodeIntent,
  type EligibilityRow, type IntentView, type PinnedIneligibleWhy, type ResolveInput,
} from '../src/update/resolve.js';
import { FLEET_SCOPE, type UpdateChannel } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const rel = (tag: string, channel: UpdateChannel | null = 'stable', o: Partial<EligibilityRow> = {}): EligibilityRow =>
  ({ tag, channel, bundleListed: true, yanked: false, ...o });
const intent = (channel: UpdateChannel | null, pinnedTag: string | null = null, auto: IntentView['auto'] = 'off'): IntentView =>
  ({ channel, pinnedTag, auto });
/** A node at v0.0.9 with floor v0.0.9, following the fleet row on stable, no releases, no refusals. */
const input = (o: Partial<ResolveInput> = {}): ResolveInput => ({
  currentVersion: 'v0.0.9', highestVersion: 'v0.0.9', nodeIntent: null, fleetIntent: intent('stable'),
  releases: [], refusedByThisNode: new Set<string>(), ...o,
});

describe('the four floor sentences are §9\'s, verbatim', () => {
  it('pinned at or below the floor', () => {
    expect(RESOLVE_DETAIL.pinnedAtOrBelowFloor('v0.0.5', 'v0.0.9'))
      .toBe("pinned v0.0.5 is at or below this node's floor v0.0.9 — pin a newer tag, or use rollback");
  });
  it('newest eligible not newer than the floor (the yank/demotion sentence)', () => {
    expect(RESOLVE_DETAIL.notNewerThanFloor('v0.0.5', 'v0.0.9'))
      .toBe("newest eligible v0.0.5 is not newer than this node's floor v0.0.9 — a yank or demotion cannot move a node down; a newer release will");
  });
  it('rolled back below the floor (the sticky-rollback sentence)', () => {
    expect(RESOLVE_DETAIL.rolledBack('v0.0.8', 'v0.0.9'))
      .toBe('this node was rolled back to v0.0.8 and its floor is v0.0.9 — auto stays off this tag until a release above v0.0.9 exists (decision 8)');
  });
  it('no floor and no measured version', () => {
    expect(RESOLVE_DETAIL.noFloor()).toBe('no floor and no measured version — nothing to compare against');
  });
});

describe('channel resolution', () => {
  const releases = [rel('v0.0.10'), rel('v0.0.11', 'dev')];

  it('the node\'s own row decides when it exists', () => {
    const r = resolveNodeIntent(input({ nodeIntent: intent('dev'), fleetIntent: intent('stable'), releases }));
    expect(r.channel).toBe('dev');
    expect(r.desiredTag).toBe('v0.0.11');
  });

  it('with no node row the fleet row decides', () => {
    const r = resolveNodeIntent(input({ releases }));
    expect(r.channel).toBe('stable');
    expect(r.desiredTag).toBe('v0.0.10');
  });

  it('an unknown channel token on the node row resolves NOTHING — it never falls back to the fleet row (§18)', () => {
    const r = resolveNodeIntent(input({ nodeIntent: intent(null, null, 'stable'), fleetIntent: intent('stable'), releases }));
    expect(r).toEqual({
      channel: null, desiredTag: null, resolveDetail: RESOLVE_DETAIL.unknownChannel(),
      desiredStable: null, desiredDev: null, auto: 'stable',
    });
  });

  it('an unknown channel token on the fleet row resolves nothing for a node without its own row', () => {
    const r = resolveNodeIntent(input({ fleetIntent: intent(null), releases }));
    expect(r.channel).toBeNull();
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.unknownChannel());
  });

  it('no intent row at all resolves nothing, with its own sentence (not the unknown-token one)', () => {
    const r = resolveNodeIntent(input({ nodeIntent: null, fleetIntent: null, releases }));
    expect(r).toEqual({
      channel: null, desiredTag: null, resolveDetail: RESOLVE_DETAIL.noIntent(),
      desiredStable: null, desiredDev: null, auto: 'off',
    });
    expect(RESOLVE_DETAIL.noIntent()).not.toBe(RESOLVE_DETAIL.unknownChannel());
  });

  it('auto comes from the deciding row', () => {
    expect(resolveNodeIntent(input({ nodeIntent: intent('stable', null, 'channel'), fleetIntent: intent('stable', null, 'off'), releases })).auto)
      .toBe('channel');
    expect(resolveNodeIntent(input({ fleetIntent: intent('stable', null, 'stable'), releases })).auto).toBe('stable');
  });
});

describe('eligibility (§9, decision 16)', () => {
  it('stable takes only stable releases; dev takes either channel', () => {
    const releases = [rel('v0.0.10'), rel('v0.0.11', 'dev')];
    expect(resolveNodeIntent(input({ releases })).desiredTag).toBe('v0.0.10');
    expect(resolveNodeIntent(input({ fleetIntent: intent('dev'), releases })).desiredTag).toBe('v0.0.11');
    // A stable release is also the newest thing on dev until the next merge.
    expect(resolveNodeIntent(input({ fleetIntent: intent('dev'), releases: [rel('v0.0.12'), rel('v0.0.11', 'dev')] })).desiredTag)
      .toBe('v0.0.12');
  });

  it('skips an unlisted, a yanked, a refused-by-this-node and an unknown-channel release — each alone (§18)', () => {
    const variants: { name: string; o: Partial<ResolveInput> }[] = [
      { name: 'unlisted', o: { releases: [rel('v0.0.11', 'stable', { bundleListed: false }), rel('v0.0.10')] } },
      { name: 'yanked', o: { releases: [rel('v0.0.11', 'stable', { yanked: true }), rel('v0.0.10')] } },
      { name: 'refused by this node', o: { releases: [rel('v0.0.11'), rel('v0.0.10')], refusedByThisNode: new Set(['v0.0.11']) } },
      { name: 'unknown channel', o: { releases: [rel('v0.0.11', null), rel('v0.0.10')] } },
    ];
    for (const v of variants) {
      expect(resolveNodeIntent(input(v.o)).desiredTag, v.name).toBe('v0.0.10');
      expect(resolveNodeIntent(input({ fleetIntent: intent('dev'), ...v.o })).desiredTag, `${v.name} on dev`).toBe('v0.0.10');
    }
  });

  it('only THIS node\'s refusals are an input — the same listing with an empty set resolves the newest', () => {
    // The refusal by ANOTHER node never reaches this input at all: resolveInputFor
    // builds the set from refusalsFor(this node) — update-projection.test.ts pins that half.
    expect(resolveNodeIntent(input({ releases: [rel('v0.0.11'), rel('v0.0.10')] })).desiredTag).toBe('v0.0.11');
  });

  it('eligibleTags orders newest first, agreeing with `sort -V -r` (the comparator, not string order)', () => {
    const tags = ['v0.0.10', 'v0.1.0', 'v0.0.9', 'v1.0.0', 'v0.0.100', 'v0.10.0', 'v0.2.0'];
    const sortV = spawnSync('bash', ['-c', 'printf "%s\\n" "$@" | sort -V -r', '--', ...tags], { encoding: 'utf8' });
    expect(sortV.status, sortV.stderr).toBe(0);
    expect(eligibleTags(tags.map((t) => rel(t)), 'stable', new Set())).toEqual(sortV.stdout.trim().split('\n'));
    // And the resolver reads that head: v0.0.10 beats v0.0.9, which a string sort gets backwards.
    expect(resolveNodeIntent(input({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.8', releases: [rel('v0.0.9'), rel('v0.0.10')] })).desiredTag)
      .toBe('v0.0.10');
  });

  it('nothing eligible → NULL with the no-eligible sentence', () => {
    const r = resolveNodeIntent(input({ releases: [rel('v0.0.11', 'dev')] }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.noEligible('stable'));
  });
});

describe('the floor (§9, decision 8)', () => {
  it('floorOf: highest, else current, else nothing — and the higher of the two when both are tags', () => {
    expect(floorOf(null, null)).toBeNull();
    expect(floorOf('v0.0.9', null)).toBe('v0.0.9');
    expect(floorOf(null, 'v0.0.5')).toBe('v0.0.5');
    expect(floorOf('v0.0.9', 'v0.0.8')).toBe('v0.0.9');
    // D-3202: a stale floor (a deploy.sh placement never raises it) cannot license a downgrade.
    expect(floorOf('v0.0.9', 'v0.0.12')).toBe('v0.0.12');
    // A value that is not a tag is no floor at all.
    expect(floorOf('0.0.9', 'v0.0.5')).toBe('v0.0.5');
  });

  it('below / at / above: only a release strictly newer than the floor resolves', () => {
    const releases = [rel('v0.0.8'), rel('v0.0.9'), rel('v0.0.10')];
    expect(resolveNodeIntent(input({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.8', releases })).desiredTag).toBe('v0.0.10');
    const at = resolveNodeIntent(input({ currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', releases }));
    expect(at.desiredTag).toBeNull();
    expect(at.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.10', 'v0.0.10'));
    const above = resolveNodeIntent(input({ currentVersion: 'v0.0.11', highestVersion: 'v0.0.11', releases }));
    expect(above.desiredTag).toBeNull();
    expect(above.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.10', 'v0.0.11'));
  });

  it('a demoted newest never moves the node down — NULL with the at-floor sentence (§18 "never goes below the floor")', () => {
    // v0.0.10 was demoted back to a prerelease; the newest stable is now v0.0.9.
    const r = resolveNodeIntent(input({
      currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', releases: [rel('v0.0.10', 'dev'), rel('v0.0.9')],
    }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.9', 'v0.0.10'));
  });

  it('a yanked newest never moves the node down either', () => {
    const r = resolveNodeIntent(input({
      currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', releases: [rel('v0.0.10', 'stable', { yanked: true }), rel('v0.0.9')],
    }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.9', 'v0.0.10'));
  });

  it('a rolled-back node gets the below-floor sentence, never the yank one (§18 "the two floor sentences")', () => {
    const r = resolveNodeIntent(input({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.9', releases: [rel('v0.0.9'), rel('v0.0.8')] }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.rolledBack('v0.0.8', 'v0.0.9'));
  });

  it('a NULL highestVersion is unconstrained: the measured version stands in — never v0.0.0, never a refusal (§18)', () => {
    // Not a refusal: a newer release resolves.
    expect(resolveNodeIntent(input({ highestVersion: null, currentVersion: 'v0.0.5', releases: [rel('v0.0.7')] })).desiredTag)
      .toBe('v0.0.7');
    // Not v0.0.0: an older release does not.
    const r = resolveNodeIntent(input({ highestVersion: null, currentVersion: 'v0.0.9', releases: [rel('v0.0.5')] }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.5', 'v0.0.9'));
  });

  it('no floor and no measured version → NULL, pinned or not', () => {
    const releases = [rel('v0.0.7')];
    const unpinned = resolveNodeIntent(input({ highestVersion: null, currentVersion: null, releases }));
    expect(unpinned.desiredTag).toBeNull();
    expect(unpinned.resolveDetail).toBe(RESOLVE_DETAIL.noFloor());
    const pinned = resolveNodeIntent(input({ highestVersion: null, currentVersion: null, fleetIntent: intent('stable', 'v0.0.7'), releases }));
    expect(pinned.desiredTag).toBeNull();
    expect(pinned.resolveDetail).toBe(RESOLVE_DETAIL.noFloor());
  });

  it('a version above a stale floor is the floor (D-3202)', () => {
    const r = resolveNodeIntent(input({ highestVersion: 'v0.0.9', currentVersion: 'v0.0.12', releases: [rel('v0.0.11')] }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.notNewerThanFloor('v0.0.11', 'v0.0.12'));
  });
});

describe('a pin', () => {
  it('an eligible pin above the floor wins over a newer release', () => {
    const r = resolveNodeIntent(input({ fleetIntent: intent('stable', 'v0.0.10'), releases: [rel('v0.0.10'), rel('v0.0.11')] }));
    expect(r.desiredTag).toBe('v0.0.10');
    expect(r.resolveDetail).toBeNull();
  });

  it('a pin at or below the floor resolves NULL with its sentence, never the newer release (§18)', () => {
    const releases = [rel('v0.0.5'), rel('v0.0.9'), rel('v0.0.11')];
    const at = resolveNodeIntent(input({ fleetIntent: intent('stable', 'v0.0.9'), releases }));
    expect(at.desiredTag).toBeNull();
    expect(at.resolveDetail).toBe(RESOLVE_DETAIL.pinnedAtOrBelowFloor('v0.0.9', 'v0.0.9'));
    const below = resolveNodeIntent(input({ fleetIntent: intent('stable', 'v0.0.5'), releases }));
    expect(below.desiredTag).toBeNull();
    expect(below.resolveDetail).toBe(RESOLVE_DETAIL.pinnedAtOrBelowFloor('v0.0.5', 'v0.0.9'));
  });

  it('an ineligible pin resolves NULL with its reason and never falls through to the newest (§18)', () => {
    const cases: { why: PinnedIneligibleWhy; o: Partial<ResolveInput> }[] = [
      { why: 'not-in-catalogue', o: { releases: [rel('v0.0.13')] } },
      { why: 'no-bundle-listed', o: { releases: [rel('v0.0.12', 'stable', { bundleListed: false }), rel('v0.0.13')] } },
      { why: 'yanked', o: { releases: [rel('v0.0.12', 'stable', { yanked: true }), rel('v0.0.13')] } },
      { why: 'refused-by-this-node', o: { releases: [rel('v0.0.12'), rel('v0.0.13')], refusedByThisNode: new Set(['v0.0.12']) } },
      { why: 'not-on-stable', o: { releases: [rel('v0.0.12', 'dev'), rel('v0.0.13')] } },
      { why: 'unknown-release-channel', o: { releases: [rel('v0.0.12', null), rel('v0.0.13')] } },
    ];
    // Every reason the resolver can give has a case here.
    expect(cases.map((c) => c.why).sort()).toEqual([...PINNED_INELIGIBLE_WHYS].sort());
    for (const c of cases) {
      const r = resolveNodeIntent(input({ fleetIntent: intent('stable', 'v0.0.12'), ...c.o }));
      expect(r.desiredTag, c.why).toBeNull();
      expect(r.resolveDetail, c.why).toBe(RESOLVE_DETAIL.pinnedIneligible('v0.0.12', c.why));
      expect(r.resolveDetail, c.why).toMatch(/^pinned v0\.0\.12 is not eligible on this node — /);
    }
  });

  it('a prerelease pin is eligible on dev', () => {
    const r = resolveNodeIntent(input({ fleetIntent: intent('dev', 'v0.0.12'), releases: [rel('v0.0.12', 'dev'), rel('v0.0.13')] }));
    expect(r.desiredTag).toBe('v0.0.12');
  });
});

describe('both desireds (§9: --channel selects the other one without a local resolution)', () => {
  const releases = [rel('v0.0.10'), rel('v0.0.11', 'dev')];

  it('on stable: desired = desired-stable, and desired-dev is the dev resolution of the same row', () => {
    expect(resolveNodeIntent(input({ fleetIntent: intent('stable', null, 'stable'), releases }))).toEqual({
      channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null, desiredStable: 'v0.0.10', desiredDev: 'v0.0.11', auto: 'stable',
    });
  });

  it('on dev: desired = desired-dev', () => {
    const r = resolveNodeIntent(input({ fleetIntent: intent('dev'), releases }));
    expect(r.desiredTag).toBe('v0.0.11');
    expect(r.desiredDev).toBe('v0.0.11');
    expect(r.desiredStable).toBe('v0.0.10');
  });

  it('a pin runs in both resolutions: a prerelease pin is NULL on stable and resolves on dev', () => {
    const r = resolveNodeIntent(input({ fleetIntent: intent('stable', 'v0.0.11'), releases }));
    expect(r.desiredTag).toBeNull();
    expect(r.resolveDetail).toBe(RESOLVE_DETAIL.pinnedIneligible('v0.0.11', 'not-on-stable'));
    expect(r.desiredStable).toBeNull();
    expect(r.desiredDev).toBe('v0.0.11');
  });
});

describe('autoGateBlockers (§9: the intent route\'s advisory 409)', () => {
  const nodes = [
    { nodeId: 'a', caps: ['verify', 'node-id', 'floor'] },
    { nodeId: 'b', caps: ['verify', UPDATE_GATE_CAP] },
    { nodeId: 'c', caps: [] },   // never measured: no caps is no gate
  ];

  it('the fleet scope names every node lacking update-gate, reachable or not', () => {
    expect(autoGateBlockers(FLEET_SCOPE, nodes)).toEqual(['a', 'c']);
  });

  it('a node scope names only that node, and only when it lacks the word', () => {
    expect(autoGateBlockers('a', nodes)).toEqual(['a']);
    expect(autoGateBlockers('b', nodes)).toEqual([]);
  });
});

describe('the ring (design 2026-09-20 D-3187)', () => {
  it('resolve.ts imports only shared/api and shared/semver — no fs, no store, no fastify', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'update', 'resolve.ts'), 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)]
      .map((m) => m[1] ?? m[2]);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs)).toEqual(new Set(['../../../shared/api.js', '../../../shared/semver.js']));
    expect(/\brequire\(|import\(/.test(src)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-resolve.test.ts`
Expected: FAIL — `Error: Failed to load url ../src/update/resolve.js (resolved id: ../src/update/resolve.js) in …/server/test/update-resolve.test.ts. Does the file exist?`, zero tests run.

- [ ] **Step 3: Write `server/src/update/resolve.ts`**

```ts
// L1 — THE RESOLVER (design 2026-09-20 §9). Pure decisions over values the
// caller measured: no fs, no store, no fastify, no clock. `project.ts` (L3,
// D-3187) reads the store, calls these and writes the one
// file; the update routes (Task 13) call the same functions and decide
// nothing these do not. Ring membership is a property of the import block
// below — two shared/ modules and nothing else — and update-resolve.test.ts
// pins it by reading it.
//
// THE CANONICAL FORM IS THE TAG (decision 2). Every value in and out is
// `vX.Y.Z`; the `v` is stripped only inside shared/semver.ts. A value that
// fails `isReleaseTag` is never ordered: it is not a floor, not a
// catalogue entry and not a pin that can resolve.
import { FLEET_SCOPE, isReleaseTag, type AutoMode, type UpdateChannel } from '../../../shared/api.js';
import { compareReleaseTags, isNewerTag } from '../../../shared/semver.js';

/** The ccrc-caps word a node needs before `auto ≠ off` may reach it (§9; written by W4's spine). */
export const UPDATE_GATE_CAP = 'update-gate';
/** pool_epoch's lease, in SECONDS: the projection is re-rendered every sweep, so a live server keeps it fresh. */
export const PROJECTION_LEASE_S = 15 * 60;
/** Unix SECONDS stay below this until the year 5138; a 13-digit ms value never does. The same bound as
 *  inventory.ts's REPORT_TIME_MAX_S, restated because this L1 file may not import an L3 one. */
const MAX_UNIX_S = 99_999_999_999;

export interface EligibilityRow { tag: string; channel: UpdateChannel | null; bundleListed: boolean; yanked: boolean }
export interface IntentView { channel: UpdateChannel | null; pinnedTag: string | null; auto: AutoMode }
export interface ResolveInput {
  currentVersion: string | null; highestVersion: string | null;
  /** update_intent[nodeId]; null = no row → the fleet row decides. */
  nodeIntent: IntentView | null;
  /** update_intent['*']; null = the seed row is gone → nothing resolves. */
  fleetIntent: IntentView | null;
  /** The eligibility columns only — never the refusal roll-up, which is display. */
  releases: readonly EligibilityRow[];
  /** node_release_refusals for THIS node (decision 16); another node's refusal is not an input. */
  refusedByThisNode: ReadonlySet<string>;
}
export interface Resolution {
  /** The first three are NodeResolvedColumns, structurally — what resolveNode stores. */
  channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null;
  desiredStable: string | null; desiredDev: string | null; auto: AutoMode;
}

export type PinnedIneligibleWhy =
  | 'not-in-catalogue' | 'no-bundle-listed' | 'yanked' | 'refused-by-this-node' | 'not-on-stable' | 'unknown-release-channel';
const PINNED_WHY_TEXT: Record<PinnedIneligibleWhy, string> = {
  'not-in-catalogue': 'it is not in the release catalogue',
  'no-bundle-listed': 'it lists no provenance bundle, so no node could verify it',
  yanked: 'it was yanked from the catalogue',
  'refused-by-this-node': 'it failed provenance verification on this node; ack the node to clear the refusal',
  'not-on-stable': 'it is a prerelease and this node follows stable',
  'unknown-release-channel': 'its release channel is one this build does not know',
};
/** Derived from the record, never hand-kept (the PR_REASONS idiom). */
export const PINNED_INELIGIBLE_WHYS = Object.keys(PINNED_WHY_TEXT) as readonly PinnedIneligibleWhy[];

/** Every resolveDetail sentence, in one place. The first four are §9's text verbatim. */
export const RESOLVE_DETAIL = {
  pinnedAtOrBelowFloor: (pin: string, floor: string): string =>
    `pinned ${pin} is at or below this node's floor ${floor} — pin a newer tag, or use rollback`,
  notNewerThanFloor: (newest: string, floor: string): string =>
    `newest eligible ${newest} is not newer than this node's floor ${floor} — a yank or demotion cannot move a node down; a newer release will`,
  rolledBack: (current: string, floor: string): string =>
    `this node was rolled back to ${current} and its floor is ${floor} — auto stays off this tag until a release above ${floor} exists (decision 8)`,
  noFloor: (): string => 'no floor and no measured version — nothing to compare against',
  pinnedIneligible: (pin: string, why: PinnedIneligibleWhy): string =>
    `pinned ${pin} is not eligible on this node — ${PINNED_WHY_TEXT[why]}`,
  noEligible: (channel: UpdateChannel): string =>
    `no eligible release on ${channel} — nothing is listed with a bundle, un-yanked and unrefused by this node`,
  unknownChannel: (): string =>
    "this node's intent names a channel this build does not know — nothing resolves until it is set again",
  noIntent: (): string => "no intent row for this node and none for the fleet ('*') — nothing resolves",
};

/** The floor (§9): highestVersion, or currentVersion when that is NULL (unconstrained, never v0.0.0), or
 *  nothing when both are. D-3202: when both are tags the HIGHER one — `~/.ccrc/floor` is
 *  raised only by the install spine, so a tree placed by deploy.sh sits above a stale floor, and a floor below
 *  the running version would license a downgrade from it. When current ≤ highest this is highestVersion
 *  exactly, which is what keeps a rollback sticky. */
export function floorOf(highestVersion: string | null, currentVersion: string | null): string | null {
  const highest = isReleaseTag(highestVersion) ? highestVersion : null;
  const current = isReleaseTag(currentVersion) ? currentVersion : null;
  if (highest === null) return current;
  if (current === null) return highest;
  return isNewerTag(current, highest) ? current : highest;
}

/** THE eligibility predicate — the unpinned list and the pin's reason are both this function, so the two can
 *  never disagree about what is eligible. null = eligible on `channel`. */
function ineligibleWhy(row: EligibilityRow | undefined, channel: UpdateChannel, refused: ReadonlySet<string>): PinnedIneligibleWhy | null {
  if (row === undefined || !isReleaseTag(row.tag)) return 'not-in-catalogue';
  if (row.yanked) return 'yanked';
  if (!row.bundleListed) return 'no-bundle-listed';
  if (refused.has(row.tag)) return 'refused-by-this-node';
  if (row.channel === null) return 'unknown-release-channel';
  // stable: stable releases only; dev: either channel — a stable release is also the newest thing on dev.
  if (channel === 'stable' && row.channel !== 'stable') return 'not-on-stable';
  return null;
}

export function eligibleTags(releases: readonly EligibilityRow[], channel: UpdateChannel, refused: ReadonlySet<string>): string[] {
  return releases
    .filter((r) => ineligibleWhy(r, channel, refused) === null)
    .map((r) => r.tag)
    .sort((a, b) => compareReleaseTags(b, a));
}

interface ChannelAnswer { desiredTag: string | null; resolveDetail: string | null }

function resolveOnChannel(channel: UpdateChannel, pin: string | null, input: ResolveInput): ChannelAnswer {
  const floor = floorOf(input.highestVersion, input.currentVersion);
  if (floor === null) return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.noFloor() };
  if (pin !== null) {
    const why = ineligibleWhy(input.releases.find((r) => r.tag === pin), channel, input.refusedByThisNode);
    if (why !== null) return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.pinnedIneligible(pin, why) };
    // Strictly newer than the floor, pinned or not (§18): a pin never walks a node down — rollback does.
    if (!isNewerTag(pin, floor)) return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.pinnedAtOrBelowFloor(pin, floor) };
    return { desiredTag: pin, resolveDetail: null };
  }
  const newest = eligibleTags(input.releases, channel, input.refusedByThisNode)[0];
  if (newest === undefined) return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.noEligible(channel) };
  if (isNewerTag(newest, floor)) return { desiredTag: newest, resolveDetail: null };
  // Nothing above the floor. Which sentence is decided by whether the node runs BELOW its own floor: a
  // rolled-back node is told why auto leaves it alone; a node at its floor is told a yank cannot move it.
  const current = isReleaseTag(input.currentVersion) ? input.currentVersion : null;
  if (current !== null && isNewerTag(floor, current)) {
    return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.rolledBack(current, floor) };
  }
  return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.notNewerThanFloor(newest, floor) };
}

function nothing(resolveDetail: string, auto: AutoMode): Resolution {
  return { channel: null, desiredTag: null, resolveDetail, desiredStable: null, desiredDev: null, auto };
}

export function resolveNodeIntent(input: ResolveInput): Resolution {
  // The node's own row decides whenever it EXISTS — its channel included. A token outside the vocabulary on
  // that row reads null (the store's stance, D-3181) and resolves NOTHING: falling back to
  // '*' would move a node the operator scoped away from the fleet (§18 "an unknown channel token resolves
  // nothing").
  const row = input.nodeIntent ?? input.fleetIntent;
  if (row === null) return nothing(RESOLVE_DETAIL.noIntent(), 'off');
  if (row.channel === null) return nothing(RESOLVE_DETAIL.unknownChannel(), row.auto);
  const mine = resolveOnChannel(row.channel, row.pinnedTag, input);
  return {
    channel: row.channel,
    desiredTag: mine.desiredTag,
    resolveDetail: mine.resolveDetail,
    // The same resolution run per channel, pin included (§9), so `ccrc update --channel` selects the other
    // one with no local network resolution.
    desiredStable: resolveOnChannel('stable', row.pinnedTag, input).desiredTag,
    desiredDev: resolveOnChannel('dev', row.pinnedTag, input).desiredTag,
    auto: row.auto,
  };
}

/** §9's advisory refusal: the nodes in `scope` whose measured caps lack UPDATE_GATE_CAP — reachable or not,
 *  measured or not (no caps is no gate). The dispatcher (W4) is the enforcement; this is the route's 409. */
export function autoGateBlockers(scope: string, nodes: readonly { nodeId: string; caps: readonly string[] }[]): string[] {
  return nodes
    .filter((n) => (scope === FLEET_SCOPE || n.nodeId === scope) && !n.caps.includes(UPDATE_GATE_CAP))
    .map((n) => n.nodeId);
}

export interface ProjectionDoc {
  /** unix SECONDS; lease = issued + PROJECTION_LEASE_S. */
  epoch: number; issued: number; lease: number;
  channel: UpdateChannel; desired: string | null; desiredStable: string | null; desiredDev: string | null; auto: AutoMode;
}
export type RenderedProjection =
  | { ok: true; doc: ProjectionDoc; text: string }
  | { ok: false; why: 'no-channel'; detail: string };

/** The §9 document, `$REG/pool-epoch`'s grammar discipline: one field per line, `end` last. SECONDS, not ms —
 *  server.ts's GET /api/pools/epoch comment records the C1 defect where a ms lease made ccd's `stale` arm
 *  unreachable for ~56,700 years; a ms `issuedAtS` is a caller bug and throws here rather than render. A
 *  resolution with no channel has no document: the caller writes NOTHING (a stale document inside its lease
 *  is better than none, ccd-pool-sync's rule). */
export function renderProjection(r: Resolution, epoch: number, issuedAtS: number): RenderedProjection {
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new RangeError(`renderProjection: epoch must be a non-negative integer, got ${epoch}`);
  }
  if (!Number.isSafeInteger(issuedAtS) || issuedAtS < 0 || issuedAtS > MAX_UNIX_S) {
    throw new RangeError(`renderProjection: issuedAtS must be unix SECONDS, got ${issuedAtS}`);
  }
  for (const t of [r.desiredTag, r.desiredStable, r.desiredDev]) {
    if (t !== null && !isReleaseTag(t)) throw new RangeError(`renderProjection: not a release tag: ${t}`);
  }
  if (r.channel === null) return { ok: false, why: 'no-channel', detail: r.resolveDetail ?? RESOLVE_DETAIL.unknownChannel() };
  const doc: ProjectionDoc = {
    epoch, issued: issuedAtS, lease: issuedAtS + PROJECTION_LEASE_S,
    channel: r.channel, desired: r.desiredTag, desiredStable: r.desiredStable, desiredDev: r.desiredDev, auto: r.auto,
  };
  const tag = (t: string | null): string => t ?? 'none';
  const text = [
    `epoch ${doc.epoch}`,
    `issued ${doc.issued}`,
    `lease ${doc.lease}`,
    `channel ${doc.channel}`,
    `desired ${tag(doc.desired)}`,
    `desired-stable ${tag(doc.desiredStable)}`,
    `desired-dev ${tag(doc.desiredDev)}`,
    `auto ${doc.auto}`,
    'end',
  ].join('\n') + '\n';
  return { ok: true, doc, text };
}
```

- [ ] **Step 4: Run it green**

Run: `cd server && ./node_modules/.bin/vitest run test/update-resolve.test.ts`
Expected: PASS — every case in the seven describes.

- [ ] **Step 5: Write the failing projection test**

Create `server/test/update-projection.test.ts`:

```ts
// The projection (design 2026-09-20 §9): the rendered document, its SECONDS,
// both desireds, the server-role writer (tmp-then-rename, 0600, whole or
// nothing), resolveAndProject over a real coord.db on a fixture home, and the
// inventory run that calls it. Fixture HOMEs only (mkTmp); nothing here reads
// the live $HOME.
import { describe, it, expect } from 'vitest';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import {
  CoordStore, type NodeMeasurement, type ReleaseListingRow,
} from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { PROJECTION_LEASE_S, RESOLVE_DETAIL, renderProjection, type Resolution } from '../src/update/resolve.js';
import {
  PROJECTION_FILE_MODE, resolveAndProject, resolveInputFor, writeOwnProjection, type ProjectStore,
} from '../src/update/project.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import type { NodeRole, UpdateChannel } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { testDeps } from './helpers.js';

// THE PROJECTION'S GRAMMAR, restated in python on purpose: the reader that will
// consume this file on a node is not TypeScript, so the pin must not be either.
// It copies `ccd/ccd-pool-sync`'s discipline — a WHOLE-DOCUMENT pass over the
// exact bytes, with the 65536-byte cap and the `end` terminator as the
// torn-write detectors — and adds the two facts this document carries that
// pool-epoch's does not: lease = issued + 900 s, and `issued` is unix SECONDS
// near python's own clock (the C1 lesson recorded at GET /api/pools/epoch in
// server.ts). W4's real `ccd/ccd-update-sync` renderer TAKES THIS PIN OVER when
// it lands: the cross-side test then feeds GET /api/updates/intent/:nodeId
// through that file (the pool-accounts-route.test.ts shape) and this embedded
// copy is deleted with it.
const VALIDATOR = String.raw`
import re, sys, time
NUM = r"(?:0|[1-9][0-9]*)"
TAG = r"v[0-9]+\.[0-9]+\.[0-9]+"
GRAMMAR = [
    ("epoch", re.compile(r"epoch (%s)" % NUM)),
    ("issued", re.compile(r"issued (%s)" % NUM)),
    ("lease", re.compile(r"lease (%s)" % NUM)),
    ("channel", re.compile(r"channel (stable|dev)")),
    ("desired", re.compile(r"desired (%s|none)" % TAG)),
    ("desired-stable", re.compile(r"desired-stable (%s|none)" % TAG)),
    ("desired-dev", re.compile(r"desired-dev (%s|none)" % TAG)),
    ("auto", re.compile(r"auto (off|stable|channel)")),
]
def check(raw):
    if len(raw) >= 65536:
        raise ValueError("document is %d bytes, at or over the 65536-byte cap" % len(raw))
    doc = raw.decode("utf-8")
    if not doc.endswith("\n"):
        raise ValueError("document does not end in a newline")
    lines = doc[:-1].split("\n")
    if lines[-1] != "end":
        raise ValueError("last line is not exactly end")
    body = lines[:-1]
    if len(body) != len(GRAMMAR):
        raise ValueError("expected %d lines before end, got %d" % (len(GRAMMAR), len(body)))
    v = {}
    for (name, rx), ln in zip(GRAMMAR, body):
        m = rx.fullmatch(ln)
        if not m:
            raise ValueError("off-grammar line for %s: %r" % (name, ln[:200]))
        v[name] = m.group(1)
    issued, lease = int(v["issued"]), int(v["lease"])
    if lease - issued != 900:
        raise ValueError("lease is not issued + 900 s")
    if abs(issued - int(time.time())) > 86400:
        raise ValueError("issued %d is not unix seconds near now" % issued)
    want = v["desired-stable"] if v["channel"] == "stable" else v["desired-dev"]
    if v["desired"] != want:
        raise ValueError("desired disagrees with desired-%s" % v["channel"])
try:
    check(sys.stdin.buffer.read())
    sys.stdout.write("ok\n")
except Exception as ex:
    sys.stderr.write(str(ex) + "\n")
    sys.exit(1)
`;

function validate(doc: string): { ok: boolean; err: string } {
  const r = spawnSync('python3', ['-c', VALIDATOR], { input: doc, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  return { ok: r.status === 0 && r.stdout === 'ok\n', err: r.stderr };
}

const FLEET_ID = '0123abcd-0000-4000-8000-000000000001';
const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const NOW_S = Math.floor(NOW / 1000);

const resolution = (o: Partial<Resolution> = {}): Resolution => ({
  channel: 'stable', desiredTag: 'v0.0.11', resolveDetail: null, desiredStable: 'v0.0.11', desiredDev: 'v0.0.12', auto: 'off', ...o,
});
const listed = (tag: string, channel: UpdateChannel = 'stable'): ReleaseListingRow => ({
  tag, channel, publishedAt: NOW, commitSha: null, tarballUrl: `https://releases.example/ccrc-${tag}.tar.gz`,
  bundleListed: true, notes: null, draft: false,
});
const meas = (o: Partial<NodeMeasurement> & Pick<NodeMeasurement, 'nodeId' | 'label' | 'role'>): NodeMeasurement => ({
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-22T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified', caps: ['verify', 'node-id', 'floor'],
  agentOps: null, highestVersion: 'v0.0.9', previousVersion: null, os: 'linux', measuredAt: NOW, report: null, ...o,
});

/** A coord.db on a fixture home holding the server row (floor v0.0.9), the fleet row (floor v0.0.10) and
 *  a catalogue of v0.0.10 + v0.0.11 on stable and v0.0.12 on dev. */
function fixture(role: NodeRole = 'both', rows: 'both' | 'fleet-only' = 'both') {
  const home = mkTmp('ccrc-update-projection-');
  const ccrcDir = path.join(home, '.ccrc');
  const db = openCoordDb(path.join(ccrcDir, 'coord.db'));
  const store = new CoordStore(db);
  const log = new UpdateIntentLog(defaultUpdateIntentLogPath(ccrcDir));
  if (rows === 'both') {
    expect(store.upsertNodeMeasurement(meas({ nodeId: SERVER_LABEL, label: SERVER_LABEL, role }))).toMatchObject({ ok: true });
  }
  expect(store.upsertNodeMeasurement(meas({
    nodeId: FLEET_ID, label: FLEET_LABEL, role: 'fleet', currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', agentOps: [],
  }))).toMatchObject({ ok: true });
  expect(store.applyReleaseListing([listed('v0.0.12', 'dev'), listed('v0.0.11'), listed('v0.0.10')], NOW, 'complete'))
    .toMatchObject({ ok: true });
  return { home, ccrcDir, db, store, log, deps: { store, role, ccrcDir } };
}
const projectionPath = (ccrcDir: string): string => path.join(ccrcDir, NODE_FILES.projection);
const tmpResidue = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith('.tmp'));

describe('renderProjection — the §9 document', () => {
  it('renders the nine lines in order, seconds, both desireds, `end` last', () => {
    const r = renderProjection(resolution({ auto: 'stable' }), 7, NOW_S);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe(
      `epoch 7\nissued ${NOW_S}\nlease ${NOW_S + 900}\nchannel stable\ndesired v0.0.11\n`
      + 'desired-stable v0.0.11\ndesired-dev v0.0.12\nauto stable\nend\n',
    );
    expect(r.doc).toEqual({
      epoch: 7, issued: NOW_S, lease: NOW_S + PROJECTION_LEASE_S, channel: 'stable',
      desired: 'v0.0.11', desiredStable: 'v0.0.11', desiredDev: 'v0.0.12', auto: 'stable',
    });
    expect(PROJECTION_LEASE_S).toBe(900);
  });

  it('a NULL desired renders `none`', () => {
    const r = renderProjection(resolution({ desiredTag: null, desiredStable: null, desiredDev: null, resolveDetail: RESOLVE_DETAIL.noFloor() }), 0, NOW_S);
    expect(r.ok && r.text).toContain('desired none\ndesired-stable none\ndesired-dev none\n');
  });

  it('a ms issuedAt is refused, never rendered (§18 "the projection is seconds")', () => {
    expect(() => renderProjection(resolution(), 1, NOW)).toThrow(RangeError);
    expect(() => renderProjection(resolution(), 1, -1)).toThrow(RangeError);
    expect(() => renderProjection(resolution(), 1.5, NOW_S)).toThrow(RangeError);
    expect(() => renderProjection(resolution({ desiredDev: '0.0.12' }), 1, NOW_S)).toThrow(RangeError);
  });

  it('no channel → no document, with the resolver\'s reason', () => {
    const r = renderProjection(resolution({ channel: null, desiredTag: null, resolveDetail: RESOLVE_DETAIL.unknownChannel() }), 1, NOW_S);
    expect(r).toEqual({ ok: false, why: 'no-channel', detail: RESOLVE_DETAIL.unknownChannel() });
  });
});

describe('the embedded validator (W4\'s ccd-update-sync takes this pin over)', () => {
  const nowS = (): number => Math.floor(Date.now() / 1000);
  const good = (): string => {
    const r = renderProjection(resolution(), 3, nowS());
    if (!r.ok) throw new Error('fixture render refused');
    return r.text;
  };

  it('accepts the renderer\'s own output', () => {
    const v = validate(good());
    expect(v.ok, v.err).toBe(true);
  });

  it('refuses a document with no `end` (a torn write)', () => {
    const v = validate(good().replace(/end\n$/, ''));
    expect(v.ok).toBe(false);
    expect(v.err).toMatch(/end/);
  });

  it('refuses a document at the 65536-byte cap', () => {
    const v = validate(good().replace('end\n', `${'x'.repeat(65536)}\nend\n`));
    expect(v.ok).toBe(false);
    expect(v.err).toMatch(/65536/);
  });

  it('refuses ms in issued/lease', () => {
    const s = nowS();
    const doc = good().replace(/^issued \d+$/m, `issued ${s * 1000}`).replace(/^lease \d+$/m, `lease ${s * 1000 + 900}`);
    const v = validate(doc);
    expect(v.ok).toBe(false);
    expect(v.err).toMatch(/unix seconds/);
  });

  it('refuses a desired that disagrees with its channel\'s desired-* line', () => {
    const v = validate(good().replace('desired v0.0.11\n', 'desired v0.0.12\n'));
    expect(v.ok).toBe(false);
    expect(v.err).toMatch(/disagrees/);
  });
});

describe('writeOwnProjection — tmp then rename, 0600, whole or nothing', () => {
  it('writes the text at ~/.ccrc/update-intent with mode 0600 and leaves no tmp behind', async () => {
    const ccrcDir = path.join(mkTmp('ccrc-update-write-'), '.ccrc');
    const r = await writeOwnProjection(ccrcDir, 'epoch 1\nend\n');
    expect(r).toEqual({ ok: true, path: projectionPath(ccrcDir) });
    expect(readFileSync(projectionPath(ccrcDir), 'utf8')).toBe('epoch 1\nend\n');
    expect(statSync(projectionPath(ccrcDir)).mode & 0o777).toBe(PROJECTION_FILE_MODE);
    expect(tmpResidue(ccrcDir)).toEqual([]);
  });

  it('replaces an existing file whole, and a 0644 predecessor becomes 0600', async () => {
    const ccrcDir = path.join(mkTmp('ccrc-update-write-'), '.ccrc');
    mkdirSync(ccrcDir, { recursive: true });
    writeFileSync(projectionPath(ccrcDir), 'old\n', { mode: 0o644 });
    expect((await writeOwnProjection(ccrcDir, 'new\n')).ok).toBe(true);
    expect(readFileSync(projectionPath(ccrcDir), 'utf8')).toBe('new\n');
    expect(statSync(projectionPath(ccrcDir)).mode & 0o777).toBe(0o600);
  });

  it('replaces a symlink at the path — never writes through it', async () => {
    const home = mkTmp('ccrc-update-write-');
    const ccrcDir = path.join(home, '.ccrc');
    mkdirSync(ccrcDir, { recursive: true });
    const elsewhere = path.join(home, 'elsewhere');
    writeFileSync(elsewhere, 'keep\n');
    symlinkSync(elsewhere, projectionPath(ccrcDir));
    expect((await writeOwnProjection(ccrcDir, 'new\n')).ok).toBe(true);
    expect(lstatSync(projectionPath(ccrcDir)).isFile()).toBe(true);
    expect(readFileSync(elsewhere, 'utf8')).toBe('keep\n');
  });

  it('a directory at the path → unwritable, the directory untouched, no tmp left', async () => {
    const ccrcDir = path.join(mkTmp('ccrc-update-write-'), '.ccrc');
    mkdirSync(projectionPath(ccrcDir), { recursive: true });
    const r = await writeOwnProjection(ccrcDir, 'new\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toBe('unwritable');
    expect(statSync(projectionPath(ccrcDir)).isDirectory()).toBe(true);
    expect(tmpResidue(ccrcDir)).toEqual([]);
  });
});

describe('resolveAndProject — every live node resolved and stored; the server row projected', () => {
  it('stores each node\'s resolution and writes the server row\'s document, which the validator accepts', async () => {
    const f = fixture('both');
    const now = Date.now();
    const run = await resolveAndProject(f.deps, now);
    expect(run.resolved).toBe(2);
    expect(run.refused).toEqual([]);
    expect(run.projection).toEqual({ ok: true, path: projectionPath(f.ccrcDir) });
    expect(f.store.node(SERVER_LABEL)).toMatchObject({ channel: 'stable', desiredTag: 'v0.0.11', resolveDetail: null });
    expect(f.store.node(FLEET_ID)).toMatchObject({ channel: 'stable', desiredTag: 'v0.0.11', resolveDetail: null });
    const text = readFileSync(projectionPath(f.ccrcDir), 'utf8');
    expect(text).toContain('channel stable\ndesired v0.0.11\ndesired-stable v0.0.11\ndesired-dev v0.0.12\nauto off\nend\n');
    // SECONDS: the file's issued is the call's own clock in seconds, and its lease is 900 s later.
    const issued = Math.floor(now / 1000);
    expect(text).toMatch(new RegExp(`^issued ${issued}\\nlease ${issued + 900}$`, 'm'));
    expect(text).toMatch(new RegExp(`^epoch ${f.store.updateEpoch().epoch}$`, 'm'));
    expect(statSync(projectionPath(f.ccrcDir)).mode & 0o777).toBe(0o600);
    const v = validate(text);
    expect(v.ok, v.err).toBe(true);
  });

  it('a refusal by ANOTHER node never blocks this one; this node\'s own does (decision 16)', async () => {
    const f = fixture('both');
    expect(f.store.refuseRelease(FLEET_ID, 'v0.0.11', NOW, 'provenance: fixture')).toMatchObject({ ok: true });
    expect(resolveInputFor(f.store, f.store.node(SERVER_LABEL)!).refusedByThisNode.size).toBe(0);
    expect([...resolveInputFor(f.store, f.store.node(FLEET_ID)!).refusedByThisNode]).toEqual(['v0.0.11']);
    await resolveAndProject(f.deps, Date.now());
    expect(f.store.node(SERVER_LABEL)!.desiredTag).toBe('v0.0.11');
    expect(f.store.node(FLEET_ID)).toMatchObject({
      desiredTag: null, resolveDetail: RESOLVE_DETAIL.notNewerThanFloor('v0.0.10', 'v0.0.10'),
    });
  });

  it('a node-scope intent decides for that node only', async () => {
    const f = fixture('both');
    expect(f.store.setIntent(FLEET_ID, { channel: 'dev' }, f.log, NOW)).toMatchObject({ ok: true });
    await resolveAndProject(f.deps, Date.now());
    expect(f.store.node(FLEET_ID)).toMatchObject({ channel: 'dev', desiredTag: 'v0.0.12' });
    expect(f.store.node(SERVER_LABEL)).toMatchObject({ channel: 'stable', desiredTag: 'v0.0.11' });
  });

  it('a stale stamp is not a version: currentVersion reads only from an ok stamp', async () => {
    const f = fixture('both');
    expect(f.store.upsertNodeMeasurement(meas({
      nodeId: SERVER_LABEL, label: SERVER_LABEL, role: 'both', stampRead: 'malformed', highestVersion: null, currentVersion: 'v0.0.9',
    }))).toMatchObject({ ok: true });
    expect(resolveInputFor(f.store, f.store.node(SERVER_LABEL)!).currentVersion).toBeNull();
    await resolveAndProject(f.deps, Date.now());
    expect(f.store.node(SERVER_LABEL)).toMatchObject({ desiredTag: null, resolveDetail: RESOLVE_DETAIL.noFloor() });
  });

  it('a fleet-role server resolves every node and writes no file', async () => {
    const f = fixture('fleet');
    const run = await resolveAndProject(f.deps, Date.now());
    expect(run.resolved).toBe(2);
    expect(run.projection).toEqual({ ok: false, why: 'not-server-role' });
    expect(existsSync(projectionPath(f.ccrcDir))).toBe(false);
  });

  it('no server row → no-server-row, no file', async () => {
    const f = fixture('both', 'fleet-only');
    const run = await resolveAndProject(f.deps, Date.now());
    expect(run.resolved).toBe(1);
    expect(run.projection).toEqual({ ok: false, why: 'no-server-row' });
    expect(existsSync(projectionPath(f.ccrcDir))).toBe(false);
  });

  it('an unknown channel token writes NOTHING — the previous document stays byte-identical', async () => {
    const f = fixture('both');
    expect((await resolveAndProject(f.deps, Date.now())).projection.ok).toBe(true);
    const before = readFileSync(projectionPath(f.ccrcDir), 'utf8');
    // A newer build's token, planted the only way one can arrive: a row this build did not write.
    f.db.prepare("UPDATE update_intent SET channel = 'nightly' WHERE scope = '*'").run();
    const run = await resolveAndProject(f.deps, Date.now() + 60_000);
    expect(run.projection).toEqual({ ok: false, why: 'no-channel', detail: RESOLVE_DETAIL.unknownChannel() });
    expect(readFileSync(projectionPath(f.ccrcDir), 'utf8')).toBe(before);
    expect(f.store.node(SERVER_LABEL)).toMatchObject({ channel: null, desiredTag: null, resolveDetail: RESOLVE_DETAIL.unknownChannel() });
  });

  it('one run at a time per ~/.ccrc: a run called while another is writing reads the store only after that write landed', async () => {
    // The inventory run and the routes' reproject (Task 13) both call resolveAndProject, with no lock
    // between them. Unqueued, B's first store read would run synchronously, while A's mkdir/write/rename is
    // still in flight, so B would see NO file here. Queued, B starts after A has renamed, so it sees A's
    // whole document. That ordering is what keeps the file from stepping back to an older epoch.
    const f = fixture('both');
    const dest = projectionPath(f.ccrcDir);
    expect(existsSync(dest), 'the fixture must start with no projection').toBe(false);
    let seenByB: string | null = null;
    const s = f.store;
    const observing: ProjectStore = {
      nodes: () => {
        if (seenByB === null) seenByB = existsSync(dest) ? readFileSync(dest, 'utf8') : '(absent)';
        return s.nodes();
      },
      releases: () => s.releases(), refusalsFor: (id) => s.refusalsFor(id), intentFor: (scope) => s.intentFor(scope),
      updateEpoch: () => s.updateEpoch(), resolveNode: (id, r) => s.resolveNode(id, r),
    };
    const a = resolveAndProject(f.deps, Date.now());
    // An intent write between the two calls, as a route's POST lands during a sweep's run.
    expect(s.setIntent('*', { channel: 'dev' }, f.log, NOW)).toMatchObject({ ok: true });
    const b = resolveAndProject({ ...f.deps, store: observing }, Date.now());
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.projection.ok && rb.projection.ok, JSON.stringify([ra.projection, rb.projection])).toBe(true);
    expect(seenByB, 'B read the store while A was still writing — the runs interleaved').toMatch(/^epoch \d+\n[\s\S]*\nend\n$/);
    const text = readFileSync(dest, 'utf8');
    expect(text).toMatch(new RegExp(`^epoch ${s.updateEpoch().epoch}$`, 'm'));
    expect(text).toContain('channel dev\n');
    expect(tmpResidue(f.ccrcDir)).toEqual([]);
  });
});

describe('the inventory run resolves and projects (§9: "at every resolution AND on every inventory sweep")', () => {
  it('inventoryNow() on a local-mode server leaves the server row resolved and its projection written', async () => {
    const home = mkTmp('ccrc-update-watch-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    expect(coord.applyReleaseListing([listed('v0.0.10')], NOW, 'complete')).toMatchObject({ ok: true });
    mkdirSync(base.cfg.ccrcDir, { recursive: true });
    writeFileSync(path.join(base.cfg.ccrcDir, NODE_FILES.floor), 'v0.0.9\n');
    // The fourth argument keeps the watcher's state cache on the fixture home — the constructor's
    // default is the live one (`defaultCachePath()`), Task 11's watcher cases pass it the same way.
    const w = new FleetWatcher({ ...base, coord }, new Bus(), 2000, path.join(home, 'state-cache.json'));
    await w.inventoryNow();
    expect(coord.nodeByLabel(SERVER_LABEL)).toMatchObject({ channel: 'stable', desiredTag: 'v0.0.10' });
    const text = readFileSync(projectionPath(base.cfg.ccrcDir), 'utf8');
    expect(text).toContain('channel stable\ndesired v0.0.10\n');
    const v = validate(text);
    expect(v.ok, v.err).toBe(true);
  });
});
```

- [ ] **Step 6: Run it red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-projection.test.ts`
Expected: FAIL — `Error: Failed to load url ../src/update/project.js (resolved id: ../src/update/project.js) in …/server/test/update-projection.test.ts. Does the file exist?`, zero tests run.

- [ ] **Step 7: Write `server/src/update/project.ts`**

```ts
// L3 — the resolver's store-facing half and the server-role projection writer
// (design 2026-09-20 §9; D-3187: the resolver is L1, so the
// fs write and the store reads live here, beside it, not in it).
//
// ON A SERVER-ROLE OR `both` NODE THE SERVER PROCESS IS THE WRITER of
// ~/.ccrc/update-intent (§9): the same document a fleet node will pull in W4,
// the same grammar, tmp-then-rename, rewritten at every resolution and on
// every inventory sweep so its `lease` is refreshed on the timer's cadence.
// WRITE NOTHING UNLESS THE WHOLE ANSWER ARRIVED (ccd/ccd-pool-sync's header):
// a resolution with no channel writes nothing, and the previous document
// ages out through its own lease rather than being replaced by a guess.
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FLEET_SCOPE, type NodeRole } from '../../../shared/api.js';
import { NODE_FILES } from '../../../shared/agent-protocol.js';
import type {
  NodeResolvedColumns, NodeRow, RefusalRow, ReleaseRow, ResolveNodeResult, UpdateIntentRow,
} from '../coord/store.js';
import { SERVER_LABEL } from './inventory.js';
import {
  renderProjection, resolveNodeIntent, type IntentView, type Resolution, type ResolveInput,
} from './resolve.js';

export const PROJECTION_FILE_MODE = 0o600;

/** The port this module needs, declared by the consumer (L2). CoordStore satisfies it structurally. */
export interface ProjectStore {
  nodes(): NodeRow[];
  releases(): ReleaseRow[];
  refusalsFor(nodeId: string): RefusalRow[];
  intentFor(scope: string): UpdateIntentRow | null;
  updateEpoch(): { epoch: number; issuedAt: number };
  resolveNode(nodeId: string, r: NodeResolvedColumns): ResolveNodeResult;
}

function intentView(row: UpdateIntentRow | null): IntentView | null {
  return row === null ? null : { channel: row.channel, pinnedTag: row.pinnedTag, auto: row.auto };
}

/** The resolver's input for one node, from store reads only. `currentVersion` is a version only when the
 *  stamp read `ok` — a malformed or unreadable stamp's columns say nothing about what runs. The refusal set
 *  is THIS node's (decision 16); `releases()`'s `refused` roll-up is display and never read here. */
export function resolveInputFor(store: Omit<ProjectStore, 'resolveNode' | 'nodes'>, node: NodeRow): ResolveInput {
  return {
    currentVersion: node.stampRead === 'ok' ? node.currentVersion : null,
    highestVersion: node.highestVersion,
    nodeIntent: intentView(store.intentFor(node.nodeId)),
    fleetIntent: intentView(store.intentFor(FLEET_SCOPE)),
    releases: store.releases().map((r) => ({ tag: r.tag, channel: r.channel, bundleListed: r.bundleListed, yanked: r.yanked })),
    refusedByThisNode: new Set(store.refusalsFor(node.nodeId).map((f) => f.tag)),
  };
}

export type WriteProjectionResult = { ok: true; path: string } | { ok: false; why: 'unwritable'; detail: string };

/** tmp then ONE rename(2) — a symlink at the path is replaced, never followed; a directory there refuses.
 *  The tmp is dot-leading (every reader skips it) and removed on every failure arm. Never throws. */
export async function writeOwnProjection(ccrcDir: string, text: string): Promise<WriteProjectionResult> {
  const dest = path.join(ccrcDir, NODE_FILES.projection);
  const tmp = path.join(ccrcDir, `.${NODE_FILES.projection}.${process.pid}.${Date.now()}.tmp`);
  try {
    await mkdir(ccrcDir, { recursive: true });
    await writeFile(tmp, text, { mode: PROJECTION_FILE_MODE, flag: 'wx' });
    // Explicit, so a permissive umask cannot widen it and a narrow one cannot make it unreadable to us.
    await chmod(tmp, PROJECTION_FILE_MODE);
    await rename(tmp, dest);
    return { ok: true, path: dest };
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => { /* the refusal below is the answer */ });
    return { ok: false, why: 'unwritable', detail: e instanceof Error ? e.message : String(e) };
  }
}

export type ProjectionOutcome =
  | WriteProjectionResult
  | { ok: false; why: 'no-channel'; detail: string }
  | { ok: false; why: 'not-server-role' }
  | { ok: false; why: 'no-server-row' };
export interface ResolveRunResult { resolved: number; refused: { nodeId: string; why: string }[]; projection: ProjectionOutcome }
export interface ProjectDeps { store: ProjectStore; role: NodeRole; ccrcDir: string }

async function projectOwn(deps: ProjectDeps, own: Resolution | null, now: number): Promise<ProjectionOutcome> {
  // A fleet-role server has no own projection: the fleet box's timer writes that one (W4).
  if (deps.role !== 'server' && deps.role !== 'both') return { ok: false, why: 'not-server-role' };
  if (own === null) return { ok: false, why: 'no-server-row' };
  // SECONDS (§9, the C1 lesson): the render time, floored — not the epoch row's ms issuedAt.
  const rendered = renderProjection(own, deps.store.updateEpoch().epoch, Math.floor(now / 1000));
  if (!rendered.ok) return { ok: false, why: 'no-channel', detail: rendered.detail };
  return writeOwnProjection(deps.ccrcDir, rendered.text);
}

/**
 * ONE RUN AT A TIME PER ~/.ccrc. Two callers reach this function with no lock between them: the inventory
 * run (`sweepThenProject`, inside `inventoryNow()`'s single-flight) and the update routes' `reproject`
 * (Task 13), which runs in the request that changed an input and never goes through the watcher. The
 * store half of a run is synchronous (`DatabaseSync`), but the file half is four awaited steps. So without
 * a queue, a sweep that snapshotted epoch E0 could finish its `rename` AFTER a route run that snapshotted
 * E1: the file would step back to the old epoch and channel until the next sweep, up to 60 s later. And two
 * writes in the same millisecond share a tmp name, so the `wx` loser's cleanup would delete the winner's tmp.
 * Every call therefore joins a per-directory chain. A run TAKES ITS SNAPSHOT only when the run before it has
 * renamed (or failed), so the document on disk is always the one taken last, and its epoch never goes down.
 * (An epoch re-check before the rename would not be enough: an ack or a catalogue change moves the desired
 * tags without bumping the epoch.) `now` is still the caller's, so a queued run renders its caller's clock.
 * A rejected run never wedges the chain: the next run starts on either settlement.
 */
const projectionRuns = new Map<string, Promise<ResolveRunResult>>();

/** Resolve + store every live node; then render and write the SERVER_LABEL row's document when role is
 *  'server' | 'both' — queued behind any run in flight for the same `ccrcDir` (see `projectionRuns`).
 *  The enqueue is synchronous, on the call, so call order is write order. */
export async function resolveAndProject(deps: ProjectDeps, now: number): Promise<ResolveRunResult> {
  const key = path.resolve(deps.ccrcDir);
  const prev = projectionRuns.get(key);
  const once = (): Promise<ResolveRunResult> => resolveAndProjectOnce(deps, now);
  const run = prev === undefined ? Promise.resolve().then(once) : prev.then(once, once);
  projectionRuns.set(key, run);
  const clear = (): void => { if (projectionRuns.get(key) === run) projectionRuns.delete(key); };
  void run.then(clear, clear);
  return run;
}

/** One run: a store refusal for one node (superseded between the read and the write) is reported in
 *  `refused` and never stops the others. Called only through `resolveAndProject`'s queue. */
async function resolveAndProjectOnce(deps: ProjectDeps, now: number): Promise<ResolveRunResult> {
  let resolved = 0;
  const refused: { nodeId: string; why: string }[] = [];
  let own: Resolution | null = null;
  for (const node of deps.store.nodes()) {
    const r = resolveNodeIntent(resolveInputFor(deps.store, node));
    const w = deps.store.resolveNode(node.nodeId, { channel: r.channel, desiredTag: r.desiredTag, resolveDetail: r.resolveDetail });
    if (w.ok) resolved += 1;
    else refused.push({ nodeId: node.nodeId, why: w.why });
    if (own === null && node.label === SERVER_LABEL) own = r;
  }
  return { resolved, refused, projection: await projectOwn(deps, own, now) };
}
```

- [ ] **Step 8: Run it — only the inventory-run case is red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-projection.test.ts`
Expected: FAIL in exactly one case, `inventoryNow() on a local-mode server leaves the server row resolved and its projection written` — Task 11's run sweeps but does not resolve yet, so the row's `desiredTag` is `null` (`expected { …, desiredTag: null, … } to match object { channel: 'stable', desiredTag: 'v0.0.10' }`). Every other case passes.

- [ ] **Step 9: Wire the inventory run in `server/src/watch.ts`**

Add the import directly after Task 11's `import { sweepInventory, type InventoryDeps, type SweepOutcome } from './update/inventory.js';` (it already carries every inventory name this step uses):

```ts
import { resolveAndProject, type ProjectionOutcome } from './update/project.js';
```

Add a module-level helper after the `CAPS_REFRESH_MS` constant (`watch.ts:191`) and Task 10/11's two update cadences:

```ts
/** null = written, or nothing to write by construction (a fleet-role server has no own projection). */
function projectionWhy(p: ProjectionOutcome): string | null {
  if (p.ok || p.why === 'not-server-role') return null;
  return p.why === 'unwritable' || p.why === 'no-channel' ? `${p.why}: ${p.detail}` : p.why;
}
```

Add the field directly after Task 11's `private inventoryRun: Promise<SweepOutcome[]> | null = null;` (itself after Task 10's `lastCatalogueAt` and `lastCapsAt`, `watch.ts:471`):

```ts
  /** Task 12: the last reason the server's own projection was not written, so a box whose ~/.ccrc cannot
   *  take the file warns once per change of reason, not once a minute. */
  private lastProjectionWhy: string | null = null;
```

Add the method to `FleetWatcher`, directly after Task 11's `private async runInventory()` (which follows `triggerInventory()`):

```ts
  /** One inventory run (design 2026-09-20 §9): the sweep, then the resolver over every live row and the
   *  server-role projection — so the file's `lease` is refreshed on the sweep's 60 s beat. Called ONLY from
   *  `runInventory()`, i.e. inside `inventoryNow()`'s single-flight promise, so a ready-triggered run and the
   *  tick's are ONE sweep. The single-flight is not what orders the writers, though: the update routes'
   *  `reproject` (Task 13) calls `resolveAndProject` without the watcher, and it is `resolveAndProject`'s own
   *  per-directory queue that keeps this run and a route's from interleaving two writers of the resolved
   *  columns or of the file. A resolve failure is warned and never loses the sweep's outcomes. */
  private async sweepThenProject(inv: InventoryDeps, now: number): Promise<SweepOutcome[]> {
    const outcomes = await sweepInventory(inv, now);
    const coord = this.deps.coord;
    if (!coord) return outcomes;
    let why: string | null;
    try {
      const run = await resolveAndProject({ store: coord, role: this.deps.cfg.role, ccrcDir: this.deps.cfg.ccrcDir }, now);
      why = projectionWhy(run.projection);
    } catch (e) {
      why = `the resolve run threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (why !== null && why !== this.lastProjectionWhy) {
      console.warn(`update: this server's own ~/.ccrc/update-intent was not written (${why})`);
    }
    this.lastProjectionWhy = why;
    return outcomes;
  }
```

Then, inside Task 11's `private async runInventory()` — the method that builds the `InventoryDeps` and holds this file's one call (`inventoryNow()` only wraps it in the single-flight promise) — replace

```ts
    return sweepInventory(inv, Date.now());
```

with

```ts
    return this.sweepThenProject(inv, Date.now());
```

— the arguments unchanged, only the callee. And replace `runInventory`'s docstring's first two lines, which Task 11 wrote as

```ts
  /** Builds the sweep's deps and holds this file's one call to sweepInventory
   *  (Task 12 swaps that callee for the sweep-then-project step). The server's
```

with (line-for-line; the rest of that docstring is unchanged)

```ts
  /** Builds the sweep's deps and calls sweepThenProject, the file's one caller
   *  of sweepInventory, inside inventoryNow()'s single flight. The server's
```

— neither version spells the call token, so the grep below counts calls only. Check it:

Run: `grep -n 'sweepInventory(' server/src/watch.ts`
Expected: exactly ONE hit, inside `sweepThenProject` (the `import` line does not match — it has no `(`; neither does `runInventory`'s docstring, nor `sweepThenProject`'s). And `grep -n 'sweepThenProject(' server/src/watch.ts` — Expected: two hits, the method's declaration and `runInventory`'s call.

- [ ] **Step 10: Add the two files to the update-ring scan**

In `server/test/single-definition.test.ts`, Task 7's declaration inside its top-level `describe('the update ring — …')` (appended after the file's last line, so a two-space indent), as Task 11 left it, reads

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts'];   // Tasks 12–13 append 'resolve.ts', 'project.ts', 'routes.ts'
```

Replace that one line with this one line — line-neutral (R13), so no citation anchor into this file moves. Match the line by its CONTENT, not by a typed indent: read the file, take the declaration as it stands, and keep its leading whitespace.

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts'];   // Task 13 appends 'routes.ts'
```

Check it: `git diff --numstat -- server/test/single-definition.test.ts` — Expected: `1	1	server/test/single-definition.test.ts`.

- [ ] **Step 11: Run green**

Run, one file at a time, foreground, timeout ≥ 600000 ms, from `server/`:
`./node_modules/.bin/vitest run test/update-resolve.test.ts`
`./node_modules/.bin/vitest run test/update-projection.test.ts`
`./node_modules/.bin/vitest run test/update-inventory.test.ts`
`./node_modules/.bin/vitest run test/single-definition.test.ts`
`./node_modules/.bin/vitest run test/session-hook.test.ts`
`./node_modules/.bin/vitest run test/caps-refresh.test.ts`
`./node_modules/.bin/vitest run test/typecheck-tests.test.ts`
Expected: PASS on all seven. `update-inventory.test.ts` stays green because `sweepThenProject` returns the sweep's outcomes unchanged; `session-hook.test.ts` is the citation audit (`'THE CITATION DEBT …'`, `single-definition.test.ts: 8`) that R13 requires beside any edit to a file it cites — green because Step 10 replaced one line with one; `caps-refresh.test.ts` is the watcher's tick with no `coord` (the run returns before resolving); `typecheck-tests` compiles both new test files against the real exports. `typecheck-tests` and `session-hook` are named load flakes — a red there is re-run in isolation before it is read.

- [ ] **Step 12: Measure the mutations**

Stage first, so each restore comes from the INDEX (a `checkout --` restores from the index, which holds the green version — never a mutation of an unstaged file): `git add server/src/update/resolve.ts server/src/update/project.ts server/src/watch.ts server/test/update-resolve.test.ts server/test/update-projection.test.ts server/test/single-definition.test.ts`. For each row: make the edit, run the named file, see the named case red, then `git checkout -- <file>` and `git diff --exit-code -- <file>` (exit 0 = restored).

| §18 row | Edit | Red case (file) |
|---|---|---|
| the resolver skips unlisted/yanked/refused-by-this-node | in `ineligibleWhy`, delete the line `if (!row.bundleListed) return 'no-bundle-listed';` | `skips an unlisted, …` and `an ineligible pin resolves NULL …` (`update-resolve`) |
| the same, the yanked predicate | in `ineligibleWhy`, delete the line `if (row.yanked) return 'yanked';` | `skips an unlisted, a yanked, …` (its `yanked` variant), `a yanked newest never moves the node down either`, and the `yanked` case of `an ineligible pin resolves NULL …` (`update-resolve`) |
| the same, the refused predicate | delete `if (refused.has(row.tag)) return 'refused-by-this-node';` | `skips an unlisted, …` and `an ineligible pin resolves NULL …` (`update-resolve`), and `a refusal by ANOTHER node never blocks this one` (`update-projection`) |
| the resolver never goes below the floor — pinned | in `resolveOnChannel`, delete the line `if (!isNewerTag(pin, floor)) return …pinnedAtOrBelowFloor…;` | `a pin at or below the floor resolves NULL …` (`update-resolve`) |
| the resolver never goes below the floor — unpinned | change `if (isNewerTag(newest, floor)) return { desiredTag: newest, …` to `return { desiredTag: newest, resolveDetail: null };` (unconditional) | `a demoted newest never moves the node down …`, `below / at / above …` (`update-resolve`) |
| a NULL floor is unconstrained | in `floorOf`, change `if (highest === null) return current;` to `if (highest === null) return current === null ? null : 'v0.0.0';` | `a NULL highestVersion is unconstrained …` (the not-v0.0.0 half) |
| the two floor sentences | in `resolveOnChannel`, change `if (current !== null && isNewerTag(floor, current))` to `if (false)` | `a rolled-back node gets the below-floor sentence …` |
| a pinned ineligible tag resolves NULL | change `if (why !== null) return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.pinnedIneligible(pin, why) };` to `if (why !== null) return resolveOnChannel(channel, null, input);` | `an ineligible pin resolves NULL …` |
| an unknown channel token resolves nothing | insert, directly above `if (row.channel === null) return nothing(RESOLVE_DETAIL.unknownChannel(), row.auto);`, the line `if (row.channel === null && input.nodeIntent !== null) return resolveNodeIntent({ ...input, nodeIntent: null });` (the fall-back-to-`*` mutant; the recursion ends because the second call has no node row) | `an unknown channel token on the node row resolves NOTHING …` |
| D-3202 | in `floorOf`, change `return isNewerTag(current, highest) ? current : highest;` to `return highest;` | `floorOf: …` and `a version above a stale floor is the floor …` |
| the comparator, not string order | in `eligibleTags`, change `.sort((a, b) => compareReleaseTags(b, a))` to `.sort((a, b) => b.localeCompare(a))` | `eligibleTags orders newest first, agreeing with sort -V -r …` |
| the projection is seconds (renderer guard) | in `renderProjection`, delete `|| issuedAtS > UNIX_SECONDS_MAX` (was `MAX_UNIX_S`, deleted C5, final fix wave — the bound now lives in `shared/api.ts`) | `a ms issuedAt is refused, never rendered` (`update-projection`) |
| the projection is seconds (the caller) | in `project.ts`'s `projectOwn`, change `Math.floor(now / 1000)` to `now` | `stores each node's resolution …` rejects with `RangeError: renderProjection: issuedAtS must be unix SECONDS` (`update-projection`) |
| the projection is seconds (both guards gone) | both edits above together — the renderer no longer refuses and the caller hands it ms | `stores each node's resolution …` reds on its `^issued <seconds>$` assertion (the python pass's own seconds check is pinned separately by the `refuses ms in issued/lease` control) |
| the projection carries both desireds | in `renderProjection`'s `text` array, delete the `` `desired-dev ${tag(doc.desiredDev)}` `` element | `renders the nine lines in order …`, `accepts the renderer's own output` (the validator's line count) and `stores each node's resolution …` |
| whole or nothing (server-role writer) | in `projectOwn`, change `if (!rendered.ok) return { ok: false, why: 'no-channel', detail: rendered.detail };` to `if (!rendered.ok) return writeOwnProjection(deps.ccrcDir, 'channel none\nend\n');` | `an unknown channel token writes NOTHING …` |
| the inventory run projects | in `sweepThenProject`, delete the `try { … } catch { … }` block (keep `let why: string \| null = null;`) | `inventoryNow() on a local-mode server …` |
| one run at a time per ~/.ccrc | in `project.ts`'s `resolveAndProject`, replace the body with `return resolveAndProjectOnce(deps, now);` (no queue) | `one run at a time per ~/.ccrc …` (`update-projection`), on `seenByB`: `expected '(absent)' to match …` |
| the ring scan covers `update/` | in `resolve.ts`, add `import { readFileSync } from 'node:fs';` under the two imports | `resolve.ts imports only shared/api and shared/semver …` (`update-resolve`) |
| the ring scan covers `update/` (Task 7's scan sees the new files) | in `project.ts`, add `import { DatabaseSync } from 'node:sqlite';` under the imports (Task 7's `IMPORTS_SQLITE`, `/(?:\bfrom\s+\|\bimport\s*\(?\s*)'node:sqlite'/`, matches the `from` form) | `no file there imports node:sqlite or a coord db module, or reaches for a handle — an EMPTY allowlist` (`single-definition`), naming `project.ts imports node:sqlite` |

After the last row: `git diff --exit-code` over the six paths exits 0.

- [ ] **Step 13: Residue check and commit**

Run: `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts`
Expected: PASS (the new files name only invented hosts — `releases.example` — and fixture paths from `mkTmp`).

```bash
git add server/src/update/resolve.ts server/src/update/project.ts server/src/watch.ts \
  server/test/update-resolve.test.ts server/test/update-projection.test.ts server/test/single-definition.test.ts
git commit -F - <<'EOF'
feat(update): the pure resolver, the projection renderer and the server-role projection writer

resolve.ts (L1) decides each node's desired tag: channel from the node's own
intent row else the fleet row (an unknown token resolves nothing), eligibility
by one predicate (bundle listed, not yanked, not refused by THIS node, channel
rule), strictly above the floor pinned or not, the four section-9 sentences,
and the same resolution per channel for desired-stable/desired-dev.
renderProjection emits the section-9 document in SECONDS and throws on ms.
project.ts (L3) stores every live node's resolution and writes the server
row's ~/.ccrc/update-intent by tmp-then-rename at 0600, whole or nothing; the
inventory run calls it inside its single-flight promise.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 13: Routes and the census

**Files:**
- Create: `server/src/update/routes.ts`
- Modify: `server/src/server.ts` — the import block (`registerUpdateRoutes` beside `registerCoordRoutes`, `:54`; the `UpdateIntentLog` type after Task 10's `CataloguePoller` type import, which follows `PoolEdgeLog`'s, `:57`); `Deps` gains `updateIntentLog?: UpdateIntentLog` after Task 10's `catalogue?: CataloguePoller;` (which follows `poolEdgeLog?: PoolEdgeLog;`, `server.ts:295` at d759c914); `registerUpdateRoutes(app, deps, sessionAuth, watcher)` right after `registerCoordRoutes(app, deps, bus, sessionAuth, askDeps, watcher);` (`:1552`)
- Modify: `server/src/index.ts` — `new UpdateIntentLog(defaultUpdateIntentLogPath(cfg.ccrcDir))` after Task 10's catalogue-poller block (which follows `const poolEdgeLog = …`, `index.ts:73`), into both `deps` arms on the line after Task 10's `catalogue,` (which follows `poolEdgeLog,`, `:94` and `:146` at d759c914)
- Modify: `server/src/auth/gate.ts` — one `EXEMPT` entry after `GET /api/pools/epoch` (`:226-231`) for `GET /api/updates/intent/:nodeId` with its reason; the header's route count (`:8`, a DIGIT claim pinned by `auth-gate.test.ts`'s "gate.ts's own docstring names the HTTP-route count"); reason 2 (`:75-94`: both lane numerals, the exempt-but-authenticated list, the tolerance sentence); the CSRF note's numerals (`:730-731`)
- Modify: `server/test/auth-gate.test.ts` — `ROUTES` (`:95`) gains `scanRoutes('update/routes.ts')` with a length pin of 5 and the total 81 → 86; the hand-kept `EXEMPT_BUT_AUTHENTICATED` (`:63-66`); the `EXEMPT` key list (`:486-519`); the census title (`:545`) and its body; the three digit comments the D-1223 describe pins (`:850`, `:914`, `:413`) (D-3179)
- Modify: `server/test/box-token-census.test.ts` — `UPDATE_SRC` beside `SERVER_SRC` (`:67`) folded into `ALL_LANES` (`:98`); `UPDATE_DOORS` beside `KICKOFF` (`:125`) folded into `SESSION_ONLY_ALL` (`:128`); the anti-vacuity arithmetic (`:268`, `+ 2` → `+ 3`); a new describe over the update surface (the planted-call control, the doors in both directions, the bullet names)
- Modify: `shared/api.ts` — Task 1's `UpdateRouteRefusal` gains `verdict?: AuthVerdict` (the correction in Interfaces). That interface sits in Task 1's END-OF-FILE update block, after `READER_MIN_COLS` (`shared/api.ts:8138` at d759c914), so the one added line moves no line `README.md:2560` cites (`:7465-7467`, `:7505`, `:7513`, `:7526`) and `session-hook.test.ts`'s citation audit keeps `'shared/api.ts': 1` (D-3188)
- Modify: `server/test/single-definition.test.ts` — append `'routes.ts'` to `UPDATE_RING_FILES`: the ONE line Task 12 left is replaced IN PLACE (line-neutral), so none of this file's cited lines (`:32-37`, `:1274`, `:1303`; census `'server/test/single-definition.test.ts': 8`) moves
- Modify: `CLAUDE.md` — the box-token bullet (`:214-236`) names the one dual read in its lanes clause and the four W2 session doors in its no-box-token clause (spec §12's six doors span W2 and wave 5; W2 registers its four)
- Modify: `README.md` — "The session gate" auth paragraph (`:568-578`) names the projection read; the ORDER-PINNED lane numerals move (twenty-six → twenty-seven); line-neutral (eight lines replace eight), and the new text carries no `file:line` token, so the README's own citation-census entry in `session-hook.test.ts` stays empty
- NOT edited, and why (each is run in Step 11): `server/test/mail-routes.test.ts`'s kebab scan reads the `.ts` files DIRECTLY under `server/src/coord` only, so `update/routes.ts`'s refusal words need no admission (the STORE's words are admitted there through `isUpdateStoreRefuseCode`, Tasks 4–6; the routes' words are outside that scan's reach); `server/test/session-hook.test.ts` (the three edits above are line-neutral or below every cited line); `server/test/coord-pause-route.test.ts` (reads the CLAUDE.md bullet for its `FOUR`, unchanged); `server/test/pools-prose.test.ts` (README's line count is unchanged); `server/test/coord-routes-single-file.test.ts` (`/api/updates` matches none of its `COORD_PREFIXES`)
- Test: `server/test/update-routes.test.ts` (create) — including one text pin over `server/src/index.ts` that both `deps` arms carry `updateIntentLog,` (no test imports `index.ts` and `boot.test.ts` boots it in local mode only; Task 11's `index.ts composes the update lanes` describe is the same idiom for the ready trigger and `catalogue,`)

**Interfaces:**
- Consumes: `GateDecision` (`gate.ts:463`); `checkMailToken`, `MAIL_TOKEN_HEADER` (`coord/token.ts:220`, `:7`); `GET /api/pools/epoch`'s credential ORDER (`server.ts:2689-2701`: auth before `501`); `FleetWatcher.inventoryNow()` (Task 11); `CataloguePoller` (Task 10, on `Deps.catalogue`); `setIntent`, `ackNode`, `nodes`, `node`, `nodeByLabel`, `releases`, `intents`, `intentFor`, `updateEpoch` and the row/result types (Tasks 4–6) — `SetIntentResult` with ALL SEVEN arms, including Task 6's `{ ok: false; why: 'no-channel'; scope: string; base: string }`, and `AckNodeResult`'s `busy` arm carrying `state: BusyUpdateState` (Task 5); `UpdateIntentLog`, `defaultUpdateIntentLogPath` (`server/src/coord/updateintentlog.ts`, Task 6); `resolveNodeIntent`, `renderProjection`, `autoGateBlockers`, `UPDATE_GATE_CAP` (Task 12); `resolveInputFor`, `resolveAndProject` (Task 12); `buildInfoOfRow`, `SERVER_LABEL`, `FLEET_LABEL` (Task 11); `cfg.role`, `cfg.ccrcDir` (Task 9); Task 1's wire types and guards.
- Produces:

```ts
// CORRECTION (fix round 2, R5/C1; value corrected fix round 3, B3, D-3218
// amended): DERIVED, never the hand-typed 60_000 shown here originally — see
// D-3218. With today's values (CATALOGUE_MAX_REQUESTS_PER_POLL = 3,
// UNAUTHENTICATED_HOURLY_REQUEST_BUDGET = 60, CATALOGUE_POLL_INTERVAL_MS =
// 1_800_000, MARGIN_POLLS_PER_HOUR = 1) this is 211_765 (Math.ceil of
// 211,764.7… ms), sized so the refresh door, the scheduled poll's own
// cadence AND one restart's margin poll together fit the hourly budget,
// never the door alone.
export const REFRESH_MIN_INTERVAL_MS = Math.ceil(
  (3_600_000 * CATALOGUE_MAX_REQUESTS_PER_POLL) /
  (UNAUTHENTICATED_HOURLY_REQUEST_BUDGET -
    (3_600_000 / CATALOGUE_POLL_INTERVAL_MS + MARGIN_POLLS_PER_HOUR) * CATALOGUE_MAX_REQUESTS_PER_POLL),
);
export const INTENT_BODY_KEYS = ['scope', 'channel', 'pinnedTag', 'auto', 'notify'] as const;
export function toReleaseWire(row: ReleaseRow): ReleaseWire;
export function toNodeWire(row: NodeRow): NodeWire;          // current = buildInfoOfRow(row); request null unless tag AND kind AND at; report null iff reportedPhase null; floorRead/previousRead ALWAYS sent (fix round 2, R4)
export function toIntentWire(row: UpdateIntentRow): UpdateIntentWire;
export type ParsedIntentBody =
  | { ok: true; scope: string; patch: UpdateIntentPatch }
  | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };
export function parseIntentBody(body: unknown): ParsedIntentBody;   // an unknown key, a non-string scope or an out-of-vocabulary value → bad-request; a string pinnedTag off isIngestibleReleaseTag (fix round 2, D-3216) → bad-tag; a non-object body → bad-request field 'body'
export function registerUpdateRoutes(app: FastifyInstance, deps: Deps, sessionAuth: (req: FastifyRequest) => GateDecision, watcher?: FleetWatcher): void;
```

- **Correction to Task 1's `UpdateRouteRefusal`:** it gains `verdict?: AuthVerdict` (`AuthVerdict` is already declared in `shared/api.ts:6448`). The projection read's `401` carries the gate-shaped `verdict` exactly as `GET /api/pools/epoch`'s does (`server.ts:2697`), because the PWA's one login screen reads it; without the field the route's refusal body cannot be typed as the union it belongs to.
- **Correction to `toNodeWire`'s request rule:** the wire's `NodeRequestWire.at` is a `number`, so `request` is non-null only when `requestedTag`, `requestedKind` AND `requestedAt` are all non-null (the skeleton said "tag AND kind").

- The route contract (every refusal body is `UpdateRouteRefusal`):

  | Route | Answers | Credential |
  |---|---|---|
  | `GET /api/updates` | `200 UpdatesView` (superseded excluded; awaits `watcher.inventoryNow()` when no live `server` row exists — never an empty list) · `501 not-configured` | session (the gate; no `EXEMPT` entry) |
  | `POST /api/updates/intent` | `200 IntentWriteAnswer` · `400 bad-tag` / `bad-request {field}` · `404 unknown-scope` · `409 auto-needs-rollback-gate {nodes}` (when `auto ≠ off` and `autoGateBlockers` is non-empty — every W2 node, since no W2 spine writes `update-gate`) · `409 no-channel {detail}` (Task 6's arm: the merge base's stored channel reads null; `detail` is the `base` scope whose row holds it) · `503 journal-unreadable` / `journal-unwritable {detail}` · `501` — then `resolveAndProject` in the same request | session |
  | `POST /api/updates/refresh` | `200 CatalogueState` · `429 rate-limited {retryAfterS}` (and a `Retry-After` header) inside `REFRESH_MIN_INTERVAL_MS` of `lastRequestAt()` — which the scheduled 30-minute poll also sets (D-3203) · `501` — then `resolveAndProject` | session |
  | `POST /api/updates/ack` | `200 AckAnswer` · `400 bad-request {field}` · `404 unknown-node` · `409 superseded` / `busy {detail}` · `501` — then `resolveAndProject` | session |
  | `GET /api/updates/intent/:nodeId` | `200`, `content-type: text/plain; charset=utf-8`, the §9 document · `401 unauthenticated {verdict}` (armed, neither credential — checked BEFORE every other answer) · `404 unknown-node` · `409 superseded` / `no-channel {detail}` · `501` | session, else box token (`EXEMPT`) |

- The census constants:

```ts
// box-token-census.test.ts
const UPDATE_SRC = read('server/src/update/routes.ts');
const UPDATE_LANES = lanesIn(UPDATE_SRC);
const ALL_LANES = [...COORD_LANES, ...lanesIn(SERVER_SRC), ...UPDATE_LANES];
const UPDATE_DOORS = ['/api/updates', '/api/updates/intent', '/api/updates/refresh', '/api/updates/ack'];   // hand-kept, the KICKOFF reason; the FOUR W2 session doors — wave 5 appends apply and rollback
const SESSION_ONLY_ALL = [...SESSION_ONLY_DOORS, KICKOFF, ...UPDATE_DOORS];
```

- **Three scanner facts every edit in this task obeys.** (1) `lanesIn` (`box-token-census.test.ts:86-95`) and `scanRoutes` (`auth-gate.test.ts:89-93`) slice a file from each `app.get('`/`app.post('` to the next and match `requireMailToken\(req` / `checkMailToken\(` anywhere in the slice, COMMENTS INCLUDED — so no comment in `update/routes.ts` may spell either call with its parenthesis, no comment may spell `app.get('…` / `app.post('…`, the four session-only handlers come first, and the projection read is registered LAST (its slice runs to end of file, and it is the one lane anyway). (2) The update-ring scan (Task 7) forbids `node:sqlite`, `./db.js`/`../coord/db.js` and the `REACH` pattern `/\b(?:coord|store)\.db\s*[.,)]/` in `server/src/update/` — so `routes.ts` reaches the database only through `CoordStore` methods, and no comment there writes the database file's name followed by `.`, `,` or `)`. (3) `mail-routes.test.ts`'s kebab-token scan reads only the files directly under `server/src/coord`, so the refusal words `routes.ts` spells (`'not-configured'`, `'rate-limited'`, …) need no admission; moving the file under `coord/` would change that.

- [ ] **Step 1: Write the failing route test**

Create `server/test/update-routes.test.ts`:

```ts
// Update-management W2, Task 13 (design 2026-09-20 §12): the routes over the
// control plane — `GET /api/updates` and `POST /api/updates/{intent,refresh,ack}`,
// all session-only, and the one dual-credential read, the projection
// `GET /api/updates/intent/:nodeId`.
//
// Every row a test needs is PLANTED through the store's own writers (Tasks 4–6),
// except the two states no W2 writer can reach — a busy or failed lease (W4's
// dispatcher writes those) and a superseded row planted without its re-key — and
// those are planted by one `UPDATE` each, named where they happen. Nothing here
// reads the live `$HOME`: every box is a `mkTmp` fixture home, and the two sweeps
// tests trigger (the local-mode and remote-mode reads) run against that home.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import type { CataloguePoller } from '../src/update/catalogue.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { UPDATE_GATE_CAP } from '../src/update/resolve.js';
import { REFRESH_MIN_INTERVAL_MS, parseIntentBody, toNodeWire } from '../src/update/routes.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { CatalogueState, NodeWire, UpdatesView } from '../../shared/api.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
/** Cheap-cost scrypt, the `pool-accounts-route.test.ts` ARMED fixture: an armed
 *  gate with no readable secret fails SHUT whatever the box token says, so the
 *  box-token arm is only measurable with a real, readable secret behind it. */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
/** Two node-ids in `_inst_node_id`'s lowercase shape (`NODE_ID_RE`). */
const FLEET_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const OTHER_ID = '1f1e1d1c-1b1a-4918-9716-151413121110';

const failingRunner: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

const measured = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main',
  currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  os: 'linux', measuredAt: 1_000, report: null,
  ...over,
});

const plant = (coord: CoordStore, m: NodeMeasurement): void => {
  const r = coord.upsertNodeMeasurement(m);
  expect(r.ok, `planting ${m.nodeId}: ${JSON.stringify(r)}`).toBe(true);
};

/** One stable and one dev release, both with a bundle listed. */
const LISTING: readonly ReleaseListingRow[] = [
  { tag: 'v0.0.10', channel: 'stable', publishedAt: 2_000, commitSha: null,
    tarballUrl: 'https://example.invalid/ccrc-v0.0.10.tar.gz', bundleListed: true, notes: null, draft: false },
  { tag: 'v0.0.11', channel: 'dev', publishedAt: 3_000, commitSha: null,
    tarballUrl: 'https://example.invalid/ccrc-v0.0.11.tar.gz', bundleListed: true, notes: null, draft: false },
];
const catalogue = (coord: CoordStore): void => {
  const r = coord.applyReleaseListing(LISTING, 4_000, 'complete');
  expect(r.ok, JSON.stringify(r)).toBe(true);
};

/** A superseded row, planted by hand: `rekeyNode` is what writes one, and its
 *  semantics are Task 5's pins; these tests need only that such a row EXISTS. */
const supersede = (coord: CoordStore, nodeId: string, by: string): void => {
  coord.db.prepare('UPDATE nodes SET supersededBy = ? WHERE nodeId = ?').run(by, nodeId);
};

/** A lease state no W2 writer reaches (W4's `dispatchNode` is the only one that
 *  acquires a lease), planted with the request that would have come with it. */
const setLease = (coord: CoordStore, nodeId: string, state: 'applying' | 'failed'): void => {
  coord.db.prepare(
    'UPDATE nodes SET updateState = ?, updateTarget = ?, updateStartedAt = ?, updateDetail = ?, ' +
    'requestedTag = ?, requestedKind = ?, requestedAt = ? WHERE nodeId = ?',
  ).run(state, 'v0.0.10', 5, state === 'failed' ? 'provenance: bundle absent' : null,
    'v0.0.10', 'update', 5, nodeId);
};

/** A `CataloguePoller` that records instead of requesting — the poller's own
 *  behaviour is Task 10's; this file measures only what the ROUTE does with it. */
const scriptedPoller = () => {
  let last: number | null = null;
  const at: number[] = [];
  const state: CatalogueState = { lastOkAt: null, lastError: null };
  const poller: CataloguePoller = {
    poll: async (now) => { at.push(now); last = now; state.lastOkAt = now; return { ...state }; },
    state: () => ({ ...state }),
    lastRequestAt: () => last,
  };
  return { poller, polls: () => at.length, polledAt: () => [...at], setLast: (t: number | null) => { last = t; } };
};

interface Opened { app: FastifyInstance; coord: CoordStore; home: string; ccrcDir: string }
const opened: { app: FastifyInstance; coord: CoordStore | null }[] = [];

afterEach(async () => {
  for (const o of opened.splice(0)) {
    await o.app.close();
    // `store.db.close()` — `pool-accounts-route.test.ts`'s convention.
    o.coord?.db.close();
  }
});

const writeSecret = async (home: string): Promise<void> => {
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
    `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
};

const open = async (
  o: { auth?: boolean; watcher?: boolean; catalogue?: CataloguePoller; remote?: boolean } = {},
): Promise<Opened> => {
  const home = mkTmp('ccrc-update-routes-');
  seedRoster(home);
  const loaded = loadConfig({ CCRC_HOME: home });
  // `remote`: the server box of a two-box fleet, its agent link DOWN. Set on the
  // loaded config rather than through `CCRC_FLEET`, so no agent URL or token is
  // needed. The role is what `deriveRole` gives remote mode (Task 9).
  const cfg = {
    ...loaded, authEnabled: o.auth ?? false,
    ...(o.remote ? { fleetMode: 'remote' as const, role: 'server' as const } : {}),
  };
  if (o.auth) await writeSecret(home);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: Deps = {
    cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner), io: localIO,
    queue: new KeyedQueue(), mailToken: TOKEN, coord,
    updateIntentLog: new UpdateIntentLog(defaultUpdateIntentLogPath(cfg.ccrcDir)),
    ...(o.catalogue ? { catalogue: o.catalogue } : {}),
    // Task 11's `fleetState` fixture shape, disconnected: the sweep writes the
    // agent connection's row as unreachable on the sweep that sees it.
    ...(o.remote
      ? { fleetState: { connected: false, downSince: 1_000, ccdVerbs: null, rosterFp: null, build: null } }
      : {}),
  };
  const bus = new Bus();
  // A REAL watcher, never started: the route calls its `inventoryNow()` and
  // nothing else. The cache path is the fixture's, never the default.
  const watcher = o.watcher
    ? new FleetWatcher(deps, bus, 10_000, path.join(cfg.ccrcDir, 'state-cache.json'))
    : undefined;
  const app = await buildServer(deps, bus, watcher);
  await app.ready();
  opened.push({ app, coord });
  return { app, coord, home, ccrcDir: cfg.ccrcDir };
};

/** A box with no coordination database at all. */
const openBare = async (auth: boolean): Promise<FastifyInstance> => {
  const home = mkTmp('ccrc-update-routes-bare-');
  seedRoster(home);
  const cfg = { ...loadConfig({ CCRC_HOME: home }), authEnabled: auth };
  if (auth) await writeSecret(home);
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

/** A live session cookie, minted through the real login route — `auth-gate.test.ts`'s `login`. */
const login = async (app: FastifyInstance): Promise<string> => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};

describe('GET /api/updates', () => {
  it('501 not-configured on a box with no coordination database', async () => {
    const app = await openBare(false);
    const r = await app.inject({ method: 'GET', url: '/api/updates' });
    expect(r.statusCode).toBe(501);
    expect(r.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('local mode, before the first sweep: one node, the box itself — never an empty list (spec §12 Pins)', async () => {
    const f = await open({ watcher: true });
    expect(f.coord.nodes(), 'the fixture must start with no inventory at all').toEqual([]);
    const r = await f.app.inject({ method: 'GET', url: '/api/updates' });
    expect(r.statusCode, r.body).toBe(200);
    const view = r.json() as UpdatesView;
    expect(view.nodes).toHaveLength(1);
    // D-3184: the server's own row, role from config (`both` in local
    // mode, D-3174), no agent by construction.
    expect(view.nodes[0]).toMatchObject({
      label: SERVER_LABEL, role: 'both', stampRead: 'absent', current: null, agentOps: null,
    });
  });

  it('remote mode, before the first sweep: two nodes — this box as `server`, the agent connection as `fleet` (D-3184)', async () => {
    const f = await open({ watcher: true, remote: true });
    expect(f.coord.nodes(), 'the fixture must start with no inventory at all').toEqual([]);
    const r = await f.app.inject({ method: 'GET', url: '/api/updates' });
    expect(r.statusCode, r.body).toBe(200);
    const view = r.json() as UpdatesView;
    // `nodes()` orders by label, so `fleet` comes before `server`. The link is
    // down in this fixture, so the fleet row is the label-keyed placeholder the
    // sweep writes. It is shown, never dropped (§18 "unreachable is written on
    // the sweep it happens").
    expect(view.nodes.map((n) => [n.label, n.role])).toEqual([[FLEET_LABEL, 'fleet'], [SERVER_LABEL, 'server']]);
    expect(view.nodes[0]).toMatchObject({ nodeId: FLEET_LABEL, reachable: false, measuredAt: null });
    expect(view.nodes[1]).toMatchObject({ nodeId: SERVER_LABEL, agentOps: null });
  });

  it('answers the stored surface: releases with their refusal roll-up, live nodes only, the seed intent, a never-checked catalogue', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    expect(f.coord.refuseRelease(FLEET_ID, 'v0.0.10', 7, 'provenance: signature mismatch'))
      .toEqual({ ok: true, inserted: true });
    // The label-keyed placeholder the same box left before its node-id was
    // measured, superseded by the UUID row (§18 "a superseded row is invisible").
    plant(f.coord, measured({ nodeId: FLEET_LABEL }));
    supersede(f.coord, FLEET_LABEL, FLEET_ID);

    const r = await f.app.inject({ method: 'GET', url: '/api/updates' });
    expect(r.statusCode, r.body).toBe(200);
    const view = r.json() as UpdatesView;
    expect(view.catalogue, 'no poller has answered: "never checked", never "up to date"')
      .toEqual({ lastOkAt: null, lastError: null });
    expect(view.releases).toEqual([
      { tag: 'v0.0.11', version: 'v0.0.11', channel: 'dev', publishedAt: 3_000, commitSha: null,
        bundleListed: true, yanked: false, refused: [], notes: null },
      { tag: 'v0.0.10', version: 'v0.0.10', channel: 'stable', publishedAt: 2_000, commitSha: null,
        bundleListed: true, yanked: false, refused: [{ by: FLEET_ID, at: 7 }], notes: null },
    ]);
    const want: NodeWire = {
      nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL, os: 'linux',
      // §18 "a full BuildInfo round-trips": all five current* columns, dirty included.
      current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-22T00:00:00Z', dirty: false, version: 'v0.0.9' },
      stampRead: 'ok', installState: 'complete', provenance: 'verified',
      caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
      measuredAt: 1_000, reachable: true, unreachableSince: null,
      channel: null, desiredTag: null, resolveDetail: null,
      request: null, report: null,
      update: { state: 'idle', target: null, startedAt: null, detail: null },
    };
    expect(view.nodes, 'the superseded placeholder leaked onto the wire').toEqual([want]);
    expect(view.intent).toEqual([
      { scope: '*', channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: 0, setBy: 'migration' },
    ]);
  });

  it('toNodeWire: a request only when tag, kind and time are all set; a report iff a phase; no BuildInfo off a stamp that did not read ok', async () => {
    const f = await open();
    plant(f.coord, measured());
    const row = f.coord.node(FLEET_ID)!;
    expect(toNodeWire({ ...row, requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: 9 }).request)
      .toEqual({ tag: 'v0.0.10', kind: 'update', at: 9 });
    expect(toNodeWire({ ...row, requestedTag: 'v0.0.10', requestedKind: null, requestedAt: 9 }).request).toBeNull();
    expect(toNodeWire({ ...row, requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: null }).request).toBeNull();
    expect(toNodeWire({
      ...row, reportedPhase: 'installing', reportedTarget: 'v0.0.10', reportedStartedAt: 1_000,
      reportedUpdatedAt: 2_000, reportedDetail: null,
    }).report).toEqual({ phase: 'installing', target: 'v0.0.10', startedAt: 1_000, updatedAt: 2_000, detail: null });
    expect(toNodeWire({ ...row, reportedPhase: null, reportedTarget: 'v0.0.10' }).report).toBeNull();
    // §18 "stampRead keeps EACCES from unversioned": the columns may still hold
    // an old stamp, and the wire must not present it as this node's build.
    expect(toNodeWire({ ...row, stampRead: 'unreadable' }).current).toBeNull();
  });
});

describe('POST /api/updates/intent', () => {
  it('writes the intent, bumps the epoch, journals it, and re-resolves AND re-projects in the same request', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    plant(f.coord, measured({ nodeId: SERVER_LABEL, label: SERVER_LABEL, role: 'both' }));

    const r = await post(f.app, '/api/updates/intent', { scope: '*', channel: 'dev' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      ok: true, epoch: 1,
      intent: { scope: '*', channel: 'dev', pinnedTag: null, auto: 'off', notify: 'channel', setBy: 'pwa' },
    });
    expect(f.coord.updateEpoch().epoch).toBe(1);
    const journal = readFileSync(defaultUpdateIntentLogPath(f.ccrcDir), 'utf8').trim().split('\n');
    expect(journal).toHaveLength(1);
    expect(JSON.parse(journal[0]!)).toMatchObject({ epoch: 1, scope: '*', channel: 'dev' });
    // The resolver ran IN THIS REQUEST — nothing else in this fixture resolves.
    expect(f.coord.node(FLEET_ID)).toMatchObject({ channel: 'dev', desiredTag: 'v0.0.11' });
    // …and so did the server-role projection writer (spec §9: "at every
    // resolution"), in seconds, carrying both desireds.
    const doc = path.join(f.ccrcDir, 'update-intent');
    expect(existsSync(doc), 'the server-role projection was not written').toBe(true);
    expect(statSync(doc).mode & 0o777, 'the projection is 0600 (tmp-then-rename)').toBe(0o600);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /^epoch 1\nissued \d{10}\nlease \d{10}\nchannel dev\ndesired v0\.0\.11\ndesired-stable v0\.0\.10\ndesired-dev v0\.0\.11\nauto off\nend\n$/);
  });

  it('400 bad-tag for a pinnedTag off the tag shape, and nothing is written', async () => {
    const f = await open();
    for (const pinnedTag of ['0.0.9', 'v0.0.9 ', 'V0.0.9', 'v0.0', 'v0.0.9\n']) {
      const r = await post(f.app, '/api/updates/intent', { scope: '*', pinnedTag });
      expect(r.statusCode, JSON.stringify(pinnedTag)).toBe(400);
      expect(r.json()).toEqual({ ok: false, error: 'bad-tag', field: 'pinnedTag' });
    }
    expect(f.coord.updateEpoch().epoch).toBe(0);
    expect(f.coord.intentFor('*')!.pinnedTag).toBeNull();
  });

  it('400 bad-request naming the field for an unknown key or an out-of-vocabulary value', async () => {
    const f = await open();
    const cases: [unknown, string][] = [
      [{ scope: '*', colour: 'red' }, 'colour'],
      [{ scope: '*', channel: 'nightly' }, 'channel'],
      [{ scope: '*', auto: 'always' }, 'auto'],
      [{ scope: '*', notify: 'loud' }, 'notify'],
      [{ scope: '*', pinnedTag: 9 }, 'pinnedTag'],
      [{ scope: 7, channel: 'dev' }, 'scope'],
      [{ channel: 'dev' }, 'scope'],
      [['*'], 'body'],
    ];
    for (const [body, field] of cases) {
      expect(parseIntentBody(body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad-request', field });
      const r = await post(f.app, '/api/updates/intent', body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json()).toEqual({ ok: false, error: 'bad-request', field });
    }
    expect(parseIntentBody({ scope: '*', pinnedTag: null, auto: 'off' }))
      .toEqual({ ok: true, scope: '*', patch: { pinnedTag: null, auto: 'off' } });
    expect(f.coord.updateEpoch().epoch).toBe(0);
  });

  it('400 bad-request for a body that names nothing to change — the store refuses it and the route says so', async () => {
    const f = await open();
    const r = await post(f.app, '/api/updates/intent', { scope: '*' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ ok: false, error: 'bad-request', field: 'body', detail: 'empty-patch' });
    expect(f.coord.updateEpoch().epoch).toBe(0);
  });

  it('404 unknown-scope for a scope that is neither * nor a live node', async () => {
    const f = await open();
    const r = await post(f.app, '/api/updates/intent', { scope: 'no-such-node', channel: 'dev' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ ok: false, error: 'unknown-scope', detail: 'no-such-node' });
    expect(f.coord.intentFor('no-such-node')).toBeNull();
  });

  it('404 unknown-scope for a LIVE label-keyed row — a node scope must be a measured node-id (D-3194)', async () => {
    const f = await open();
    plant(f.coord, measured({ nodeId: FLEET_LABEL }));                // a pre-W1 node: live, keyed by its label
    const r = await post(f.app, '/api/updates/intent', { scope: FLEET_LABEL, channel: 'dev' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ ok: false, error: 'unknown-scope', detail: FLEET_LABEL });
    expect(f.coord.intentFor(FLEET_LABEL)).toBeNull();
    expect(f.coord.updateEpoch().epoch).toBe(0);
  });

  it('409 auto-needs-rollback-gate while any node in scope lacks update-gate — every W2 node', async () => {
    const f = await open();
    plant(f.coord, measured());
    plant(f.coord, measured({ nodeId: OTHER_ID, label: 'other' }));
    const all = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'stable' });
    expect(all.statusCode, all.body).toBe(409);
    expect(all.json()).toMatchObject({ ok: false, error: 'auto-needs-rollback-gate' });
    expect([...(all.json().nodes as string[])].sort()).toEqual([FLEET_ID, OTHER_ID].sort());
    // A node scope names only its own node.
    const one = await post(f.app, '/api/updates/intent', { scope: OTHER_ID, auto: 'channel' });
    expect(one.statusCode).toBe(409);
    expect(one.json().nodes).toEqual([OTHER_ID]);
    expect(f.coord.updateEpoch().epoch, 'a refused intent moved the epoch').toBe(0);
    expect(f.coord.intentFor('*')!.auto).toBe('off');
    expect(f.coord.intentFor(OTHER_ID)).toBeNull();
    // `auto: 'off'` is never gated — notify-only needs no rollback.
    const off = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'off' });
    expect(off.statusCode, off.body).toBe(200);
  });

  it('auto is written once every node in scope lists update-gate — the route asks the predicate, it does not always refuse', async () => {
    const f = await open();
    const gated = ['verify', 'node-id', 'floor', UPDATE_GATE_CAP];
    plant(f.coord, measured({ caps: gated }));
    plant(f.coord, measured({ nodeId: OTHER_ID, label: 'other', caps: gated }));
    const r = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'stable' });
    expect(r.statusCode, r.body).toBe(200);
    expect(f.coord.intentFor('*')!.auto).toBe('stable');
  });

  it('an unreachable node blocks auto too — a never-measured placeholder has no caps (§9 "reachable or not, including one with measuredAt NULL")', async () => {
    const f = await open();
    plant(f.coord, measured({ nodeId: OTHER_ID, label: 'other', caps: ['verify', 'node-id', 'floor', UPDATE_GATE_CAP] }));
    // The fleet link was down on the sweep that would have measured it:
    // `markUnreachable` leaves the label-keyed placeholder (measuredAt NULL,
    // caps '', reachable false). §9 is written about exactly this node: one
    // that was offline when `auto` was set.
    expect(f.coord.markUnreachable(FLEET_LABEL, 'fleet', 9)).toMatchObject({ ok: true, nodeId: FLEET_LABEL, created: true });
    expect(f.coord.node(FLEET_LABEL)).toMatchObject({ reachable: false, measuredAt: null, caps: [] });
    const r = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'stable' });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'auto-needs-rollback-gate', nodes: [FLEET_LABEL] });
    expect(f.coord.updateEpoch().epoch, 'a refused intent moved the epoch').toBe(0);
    expect(f.coord.intentFor('*')!.auto).toBe('off');
  });

  it('503 journal-unreadable, and the intent row and the epoch are untouched', async () => {
    const f = await open();
    // A DIRECTORY where the journal file belongs: `maxEpoch()` cannot read it,
    // and "cannot read the journal" must never be taken as "the journal is empty".
    mkdirSync(defaultUpdateIntentLogPath(f.ccrcDir));
    const r = await post(f.app, '/api/updates/intent', { scope: '*', channel: 'dev' });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false, error: 'journal-unreadable' });
    expect(typeof r.json().detail).toBe('string');
    expect(f.coord.updateEpoch().epoch).toBe(0);
    expect(f.coord.intentFor('*')!.channel).toBe('stable');
  });

  it('409 no-channel when the stored channel under the patch cannot be read — never the fleet default (Task 6\'s arm)', async () => {
    const f = await open();
    // A newer build's channel token in the fleet row: a patch that names no
    // channel has nothing honest to merge onto, and the store refuses rather
    // than writing `stable` in its place. `detail` is the scope whose row
    // holds the unreadable channel (`SetIntentResult`'s `base`).
    f.coord.db.prepare("UPDATE update_intent SET channel = 'nightly' WHERE scope = '*'").run();
    const r = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'off' });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'no-channel', detail: '*' });
    expect(f.coord.updateEpoch().epoch, 'a refused intent moved the epoch').toBe(0);
  });
});

describe('POST /api/updates/refresh', () => {
  it('polls once and answers the catalogue state; a second call inside the minute is 429 and sends nothing (§18 "refresh is rate-limited")', async () => {
    const p = scriptedPoller();
    const f = await open({ catalogue: p.poller });
    const a = await post(f.app, '/api/updates/refresh', {});
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json()).toEqual({ lastOkAt: p.polledAt()[0], lastError: null });
    const b = await post(f.app, '/api/updates/refresh', {});
    expect(b.statusCode).toBe(429);
    expect(b.json()).toMatchObject({ ok: false, error: 'rate-limited' });
    const retry = b.json().retryAfterS as number;
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(REFRESH_MIN_INTERVAL_MS / 1000);
    expect(b.headers['retry-after']).toBe(String(retry));
    expect(p.polls(), 'the refused refresh reached the poller').toBe(1);
    // A minute on, the door opens again — a minute, not a latch.
    p.setLast(Date.now() - REFRESH_MIN_INTERVAL_MS - 1);
    const c = await post(f.app, '/api/updates/refresh', {});
    expect(c.statusCode).toBe(200);
    expect(p.polls()).toBe(2);
  });

  it('501 not-configured with no poller', async () => {
    const f = await open();
    const r = await post(f.app, '/api/updates/refresh', {});
    expect(r.statusCode).toBe(501);
  });
});

describe('POST /api/updates/ack', () => {
  it('failed → idle, request cleared, THIS node\'s refusals cleared — and the release resolves again in the same request (§18 "ack clears the node\'s refusals and its request")', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    plant(f.coord, measured({ nodeId: OTHER_ID, label: 'other' }));
    setLease(f.coord, FLEET_ID, 'failed');
    expect(f.coord.refuseRelease(FLEET_ID, 'v0.0.10', 6, 'provenance: bundle absent').ok).toBe(true);
    expect(f.coord.refuseRelease(OTHER_ID, 'v0.0.10', 6, 'provenance: bundle absent').ok).toBe(true);

    const r = await post(f.app, '/api/updates/ack', { nodeId: FLEET_ID });
    expect(r.statusCode, r.body).toBe(200);
    const node = r.json().node as NodeWire;
    expect(node.update.state).toBe('idle');
    expect(node.request).toBeNull();
    expect(f.coord.refusalsFor(FLEET_ID)).toEqual([]);
    expect(f.coord.refusalsFor(OTHER_ID), 'ack cleared ANOTHER node\'s refusal').toHaveLength(1);
    // The refusal made v0.0.10 ineligible for this node; with it cleared, the
    // resolution that ran inside the ack request finds it again.
    expect(f.coord.node(FLEET_ID)!.desiredTag).toBe('v0.0.10');
    expect(node.desiredTag).toBe('v0.0.10');
  });

  it('refuses a busy row, a superseded row, an unknown node and a malformed body — writing nothing', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    setLease(f.coord, FLEET_ID, 'applying');
    expect(f.coord.refuseRelease(FLEET_ID, 'v0.0.10', 6, 'provenance: bundle absent').ok).toBe(true);
    plant(f.coord, measured({ nodeId: FLEET_LABEL }));
    supersede(f.coord, FLEET_LABEL, FLEET_ID);

    const busy = await post(f.app, '/api/updates/ack', { nodeId: FLEET_ID });
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toEqual({ ok: false, error: 'busy', detail: 'applying' });
    expect(f.coord.node(FLEET_ID)!.updateState, 'an ack killed a live lease').toBe('applying');
    expect(f.coord.refusalsFor(FLEET_ID)).toHaveLength(1);

    const sup = await post(f.app, '/api/updates/ack', { nodeId: FLEET_LABEL });
    expect(sup.statusCode).toBe(409);
    expect(sup.json()).toEqual({ ok: false, error: 'superseded', detail: FLEET_ID });

    const unknown = await post(f.app, '/api/updates/ack', { nodeId: 'no-such-node' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ ok: false, error: 'unknown-node' });

    for (const [body, field] of [[{}, 'nodeId'], [{ nodeId: 7 }, 'nodeId'], [{ nodeId: FLEET_ID, force: true }, 'force'], [[FLEET_ID], 'body']] as const) {
      const r = await post(f.app, '/api/updates/ack', body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json()).toEqual({ ok: false, error: 'bad-request', field });
    }
  });
});

describe('GET /api/updates/intent/:nodeId — the projection', () => {
  it('answers the §9 document, resolved live, in SECONDS, with both desireds (§18 "the projection is seconds", "…carries both desireds")', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    const r = await f.app.inject({ method: 'GET', url: `/api/updates/intent/${FLEET_ID}` });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-type']).toBe('text/plain; charset=utf-8');
    const m = /^epoch 0\nissued (\d{10})\nlease (\d{10})\nchannel stable\ndesired v0\.0\.10\ndesired-stable v0\.0\.10\ndesired-dev v0\.0\.11\nauto off\nend\n$/
      .exec(r.body);
    expect(m, r.body).not.toBeNull();
    expect(Number(m![2]) - Number(m![1]), 'the lease is issued + 15 minutes, in seconds').toBe(15 * 60);
    // Resolved on the read, not copied from the stored columns: nothing has run
    // `resolveNode` in this fixture, so the stored desiredTag is still NULL.
    expect(f.coord.node(FLEET_ID)!.desiredTag).toBeNull();
  });

  it('404 unknown-node, 409 superseded, 409 no-channel for a channel token outside the vocabulary', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    plant(f.coord, measured({ nodeId: FLEET_LABEL }));
    supersede(f.coord, FLEET_LABEL, FLEET_ID);

    const unknown = await f.app.inject({ method: 'GET', url: '/api/updates/intent/no-such-node' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ ok: false, error: 'unknown-node' });

    const sup = await f.app.inject({ method: 'GET', url: `/api/updates/intent/${FLEET_LABEL}` });
    expect(sup.statusCode).toBe(409);
    expect(sup.json()).toEqual({ ok: false, error: 'superseded', detail: FLEET_ID });

    // A newer build's channel token in the fleet row (a rollback past a
    // migration): §18 "an unknown channel token resolves nothing" — never a
    // fallback, and the projection says so rather than rendering a guess.
    f.coord.db.prepare("UPDATE update_intent SET channel = 'nightly' WHERE scope = '*'").run();
    const none = await f.app.inject({ method: 'GET', url: `/api/updates/intent/${FLEET_ID}` });
    expect(none.statusCode).toBe(409);
    expect(none.json()).toMatchObject({ ok: false, error: 'no-channel' });
    expect(typeof none.json().detail).toBe('string');
  });
});

describe('credentials, armed (spec §12 Pins, decision 15)', () => {
  it('the projection read: 401 with neither credential — before revealing whether the node exists', async () => {
    const f = await open({ auth: true });
    catalogue(f.coord);
    plant(f.coord, measured());
    for (const id of [FLEET_ID, 'no-such-node']) {
      const r = await f.app.inject({ method: 'GET', url: `/api/updates/intent/${id}` });
      expect(r.statusCode, id).toBe(401);
      expect(r.json()).toEqual({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
    }
  });

  it('the projection read: the box token alone suffices, and so does a session (§18 "the projection read takes the box token")', async () => {
    const f = await open({ auth: true });
    catalogue(f.coord);
    plant(f.coord, measured());
    const url = `/api/updates/intent/${FLEET_ID}`;
    const token = await f.app.inject({ method: 'GET', url, headers: { 'x-ccrc-mail-token': TOKEN } });
    expect(token.statusCode, token.body).toBe(200);
    expect(token.body).toMatch(/\nend\n$/);
    const cookie = await f.app.inject({ method: 'GET', url, headers: { cookie: await login(f.app) } });
    expect(cookie.statusCode, cookie.body).toBe(200);
  });

  it('the projection read on a box with no coordination database: 401 before 501 — the pools/epoch order', async () => {
    const app = await openBare(true);
    const neither = await app.inject({ method: 'GET', url: `/api/updates/intent/${FLEET_ID}` });
    expect(neither.statusCode).toBe(401);
    const token = await app.inject({
      method: 'GET', url: `/api/updates/intent/${FLEET_ID}`, headers: { 'x-ccrc-mail-token': TOKEN },
    });
    expect(token.statusCode).toBe(501);
    expect(token.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('POST /api/updates/intent with the box token alone is the gate\'s 401 — the box token never writes intent', async () => {
    const f = await open({ auth: true });
    const tokenOnly = await post(f.app, '/api/updates/intent', { scope: '*', channel: 'dev' },
      { 'x-ccrc-mail-token': TOKEN });
    expect(tokenOnly.statusCode).toBe(401);
    expect(tokenOnly.json()).toMatchObject({ verdict: 'no-session' });
    expect(f.coord.updateEpoch().epoch).toBe(0);
    // …and the route is reachable armed, with the credential it does take.
    const session = await post(f.app, '/api/updates/intent', { scope: '*', channel: 'dev' },
      { cookie: await login(f.app) });
    expect(session.statusCode, session.body).toBe(200);
    expect(f.coord.updateEpoch().epoch).toBe(1);
  });
});

describe('index.ts hands the one journal to BOTH deps arms (a text pin over the composition root)', () => {
  // `Deps.updateIntentLog` is optional, so a remote arm without it is no type
  // error, and no suite boots `index.ts` in remote mode — production's
  // `POST /api/updates/intent` would answer 501 with nothing red. Same idiom,
  // same literal split, as Task 11's `index.ts composes the update lanes`.
  it('constructs one UpdateIntentLog and names it in the remote and the local deps literal', () => {
    const indexTs = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(indexTs.match(/new UpdateIntentLog\(/g) ?? []).toHaveLength(1);
    const depsLiterals = indexTs.match(/^  deps = \{\n[\s\S]*?^  \};$/gm) ?? [];
    expect(depsLiterals).toHaveLength(2);
    expect(depsLiterals[0]).toContain('io: fleet.io');
    expect(depsLiterals[1]).toContain('io: localIO');
    for (const lit of depsLiterals) expect(lit).toMatch(/^\s+updateIntentLog,$/m);
  });
});
```

- [ ] **Step 2: Run it red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-routes.test.ts`
Expected: FAIL at import — vite reports it cannot load `../src/update/routes.js` (`Failed to load url … Does the file exist?`). This red proves only that the module is absent; every behavioural assertion is proved able to go red in Step 12's mutations, never by this import-time crash.

- [ ] **Step 3: Implement `server/src/update/routes.ts`**

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../server.js';
import type { FleetWatcher } from '../watch.js';
import type { GateDecision } from '../auth/gate.js';
import { MAIL_TOKEN_HEADER, checkMailToken } from '../coord/token.js';
import type { NodeRow, ReleaseRow, SetIntentResult, UpdateIntentPatch, UpdateIntentRow } from '../coord/store.js';
import { autoGateBlockers, renderProjection, resolveNodeIntent } from './resolve.js';
import { resolveAndProject, resolveInputFor } from './project.js';
import { SERVER_LABEL, buildInfoOfRow } from './inventory.js';
import {
  isAutoMode, isNotifyMode, isReleaseTag, isUpdateChannel,
  type AckAnswer, type CatalogueState, type IntentWriteAnswer, type NodeWire, type ReleaseWire,
  type UpdateIntentWire, type UpdateRouteRefusal, type UpdatesView,
} from '../../../shared/api.js';

/**
 * THE UPDATE CONTROL PLANE'S ROUTES (design 2026-09-20 §12, update-management W2).
 * L4: it owns fastify and the clock and DECIDES NOTHING the resolver does not —
 * the auto-gate predicate is `autoGateBlockers`, the desired tag and every
 * resolve sentence are `resolveNodeIntent`'s, the projection's grammar is
 * `renderProjection`'s. What is decided here is only HTTP: which refusal maps to
 * which status.
 *
 * THE CREDENTIALS. Four routes are session-only and carry NO box-token check at
 * all (decision 15: the box token is one shared secret every fleet session
 * holds, so a box-token write would let any session on the box steer the
 * fleet's updates). They need no gate code: `installGate` fronts every route and
 * none of the four is named in `auth/gate.ts`'s EXEMPT table, so armed they sit
 * behind the passkey and, being non-GET, the origin check; dark they are open,
 * as every route is (`gate.ts`'s unarmed-exposure note). The fifth, the
 * projection read, is EXEMPT-BUT-AUTHENTICATED in `GET /api/pools/epoch`'s exact
 * shape — session first, the box token as the fallback, and BEFORE
 * `not-configured` or `unknown-node`, so an anonymous caller learns nothing —
 * because its caller from W4 is a fleet node's timer holding the box token and
 * no cookie jar.
 *
 * THE FILE'S ORDER IS PART OF ITS CENSUS. `box-token-census.test.ts` and
 * `auth-gate.test.ts` read this file as a third route source, slicing it from
 * one registration to the next and counting a box-token call anywhere in a
 * slice — prose included. So the session-only handlers come first and never
 * name the box-token functions, and the projection read is registered LAST.
 */

/** A refusal, typed as the one union every update route answers with. */
const refuse = (reply: FastifyReply, code: number, body: Omit<UpdateRouteRefusal, 'ok'>): FastifyReply =>
  reply.code(code).send({ ok: false, ...body } satisfies UpdateRouteRefusal);

export const REFRESH_MIN_INTERVAL_MS = 60_000;
export const INTENT_BODY_KEYS = ['scope', 'channel', 'pinnedTag', 'auto', 'notify'] as const;

export function toReleaseWire(row: ReleaseRow): ReleaseWire {
  return {
    tag: row.tag, version: row.version, channel: row.channel, publishedAt: row.publishedAt,
    commitSha: row.commitSha, bundleListed: row.bundleListed, yanked: row.yanked,
    refused: row.refused.map((r) => ({ by: r.by, at: r.at })), notes: row.notes,
  };
}

/** One live `nodes` row on the wire. `current` is the five `current*` columns
 *  through `buildInfoOfRow` — null unless the stamp read `ok`, so an EACCES never
 *  presents an old stamp as this node's build. `request` needs all three request
 *  columns (the wire's `at` is a number); `report` exists iff a phase was read. */
export function toNodeWire(row: NodeRow): NodeWire {
  return {
    nodeId: row.nodeId, role: row.role, label: row.label, os: row.os,
    current: buildInfoOfRow(row), stampRead: row.stampRead, installState: row.installState,
    provenance: row.provenance, caps: [...row.caps], agentOps: row.agentOps === null ? null : [...row.agentOps],
    highestVersion: row.highestVersion, previousVersion: row.previousVersion,
    measuredAt: row.measuredAt, reachable: row.reachable, unreachableSince: row.unreachableSince,
    channel: row.channel, desiredTag: row.desiredTag, resolveDetail: row.resolveDetail,
    request: row.requestedTag !== null && row.requestedKind !== null && row.requestedAt !== null
      ? { tag: row.requestedTag, kind: row.requestedKind, at: row.requestedAt }
      : null,
    report: row.reportedPhase === null ? null : {
      phase: row.reportedPhase, target: row.reportedTarget, startedAt: row.reportedStartedAt,
      updatedAt: row.reportedUpdatedAt, detail: row.reportedDetail,
    },
    update: { state: row.updateState, target: row.updateTarget, startedAt: row.updateStartedAt, detail: row.updateDetail },
  };
}

export function toIntentWire(row: UpdateIntentRow): UpdateIntentWire {
  return {
    scope: row.scope, channel: row.channel, pinnedTag: row.pinnedTag, auto: row.auto, notify: row.notify,
    setAt: row.setAt, setBy: row.setBy,
  };
}

export type ParsedIntentBody =
  | { ok: true; scope: string; patch: UpdateIntentPatch }
  | { ok: false; error: 'bad-tag' | 'bad-request'; field: string };

/** The intent body, through the one guard per field. A string `pinnedTag` off
 *  the tag shape is `bad-tag` (§12's own answer for it); every other malformed
 *  input — an unknown key, a non-string scope, a value outside its vocabulary,
 *  a body that is not an object — is `bad-request` naming the field. An EMPTY
 *  patch is not refused here: `setIntent` refuses it, and one refusal is enough. */
export function parseIntentBody(body: unknown): ParsedIntentBody {
  const bad = (field: string): ParsedIntentBody => ({ ok: false, error: 'bad-request', field });
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad('body');
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(INTENT_BODY_KEYS as readonly string[]).includes(k)) return bad(k);
  }
  const scope = o.scope;
  if (typeof scope !== 'string' || scope === '') return bad('scope');
  const patch: UpdateIntentPatch = {};
  if ('channel' in o) {
    const channel = o.channel;
    if (!isUpdateChannel(channel)) return bad('channel');
    patch.channel = channel;
  }
  if ('pinnedTag' in o) {
    const pinnedTag = o.pinnedTag;
    if (pinnedTag === null) patch.pinnedTag = null;
    else if (typeof pinnedTag !== 'string') return bad('pinnedTag');
    else if (!isReleaseTag(pinnedTag)) return { ok: false, error: 'bad-tag', field: 'pinnedTag' };
    else patch.pinnedTag = pinnedTag;
  }
  if ('auto' in o) {
    const auto = o.auto;
    if (!isAutoMode(auto)) return bad('auto');
    patch.auto = auto;
  }
  if ('notify' in o) {
    const notify = o.notify;
    if (!isNotifyMode(notify)) return bad('notify');
    patch.notify = notify;
  }
  return { ok: true, scope, patch };
}

/** `setIntent`'s refusals as HTTP. `bad-field` cannot arrive past `parseIntentBody`
 *  and is mapped anyway, so a store that learns a new field refusal answers 400
 *  rather than 500. */
function intentRefusal(r: Exclude<SetIntentResult, { ok: true }>): { code: number; body: Omit<UpdateRouteRefusal, 'ok'> } {
  switch (r.why) {
    case 'empty-patch': return { code: 400, body: { error: 'bad-request', field: 'body', detail: 'empty-patch' } };
    case 'bad-field': return { code: 400, body: { error: r.field === 'pinnedTag' ? 'bad-tag' : 'bad-request', field: r.field } };
    case 'unknown-scope': return { code: 404, body: { error: 'unknown-scope', detail: r.scope } };
    // The merge base's stored channel reads null (a token this build cannot
    // name) and the patch names none: a state of the stored row, not of the
    // request — so 409, naming the scope whose row holds it.
    case 'no-channel': return { code: 409, body: { error: 'no-channel', detail: r.base } };
    case 'journal-unreadable': return { code: 503, body: { error: 'journal-unreadable', detail: r.detail } };
    case 'journal-unwritable': return { code: 503, body: { error: 'journal-unwritable', detail: r.detail } };
  }
}

/** `{nodeId}` and nothing else. */
function parseAckBody(body: unknown): { ok: true; nodeId: string } | { ok: false; field: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, field: 'body' };
  for (const k of Object.keys(body)) if (k !== 'nodeId') return { ok: false, field: k };
  const nodeId = (body as { nodeId?: unknown }).nodeId;
  return typeof nodeId === 'string' && nodeId !== '' ? { ok: true, nodeId } : { ok: false, field: 'nodeId' };
}

export function registerUpdateRoutes(
  app: FastifyInstance, deps: Deps,
  /** `buildServer`'s `sessionAuth` — read by the projection read alone; the four
   *  session-only routes leave the session to the gate. */
  sessionAuth: (req: FastifyRequest) => GateDecision,
  watcher?: FleetWatcher,
): void {
  /**
   * BEFORE THE FIRST SWEEP THERE IS NO ROW FOR THIS BOX, and an empty node list
   * reads as "no box" — spec §12's pin is "never an empty list". So a read that
   * finds no live `server` row joins the watcher's single-flight inventory run
   * once (`inventoryNow()`, which also resolves and projects). With no watcher —
   * `index.ts` always passes one; a test may not — it answers what is stored. A
   * failed sweep is logged and the stored rows answered: the read must not 500
   * on a measurement that has its own error columns.
   */
  const ensureInventory = async (req: FastifyRequest): Promise<void> => {
    if (!deps.coord || !watcher || deps.coord.nodeByLabel(SERVER_LABEL) !== null) return;
    try {
      await watcher.inventoryNow();
    } catch (err) {
      req.log.warn({ err }, 'update: the on-demand inventory sweep failed; answering the stored rows');
    }
  };

  /**
   * RESOLVE EVERY LIVE NODE AND WRITE THIS BOX'S OWN PROJECTION, in the request
   * that changed an input — spec §9: the server-role writer runs "at every
   * resolution AND on every inventory sweep". Its outcome is logged, never the
   * request's answer: the write it follows has already happened, and a
   * projection that could not be written is re-attempted by the next sweep.
   * It does NOT go through the watcher's single-flight: a write route must not
   * wait out a whole sweep's agent reads. What keeps this run and a sweep's run
   * from interleaving two writers of the file is `resolveAndProject`'s own
   * per-directory queue (Task 12). It snapshots only after the run ahead of it
   * has renamed, so a sweep that read epoch E0 before this request's write can
   * never land its document after this one's E1.
   */
  const reproject = async (req: FastifyRequest): Promise<void> => {
    if (!deps.coord) return;
    try {
      const run = await resolveAndProject({ store: deps.coord, role: deps.cfg.role, ccrcDir: deps.cfg.ccrcDir }, Date.now());
      if (!run.projection.ok && run.projection.why === 'unwritable') {
        req.log.warn({ detail: run.projection.detail }, 'update: the server-role projection could not be written');
      }
      for (const r of run.refused) req.log.warn({ nodeId: r.nodeId, why: r.why }, 'update: a node resolution was refused');
    } catch (err) {
      req.log.warn({ err }, 'update: resolution after a write failed; the next inventory sweep retries it');
    }
  };

  /** The whole surface the PWA's /settings reads (W3). Superseded rows are
   *  excluded by `nodes()` itself. Session-only: not in EXEMPT. */
  app.get('/api/updates', async (req, reply) => {
    if (!deps.coord) return refuse(reply, 501, { error: 'not-configured' });
    await ensureInventory(req);
    const view: UpdatesView = {
      catalogue: deps.catalogue?.state() ?? { lastOkAt: null, lastError: null },
      releases: deps.coord.releases().map(toReleaseWire),
      nodes: deps.coord.nodes().map(toNodeWire),
      intent: deps.coord.intents().map(toIntentWire),
    };
    return view;
  });

  /**
   * The operator's desired state. The auto gate is ADVISORY (spec §9 — the
   * dispatcher is the enforcement, W4): `auto ≠ off` is refused while any node
   * in scope, reachable or not, lacks `update-gate` in its measured caps —
   * which in W2 is every node, since no W2 spine writes the word. The node list
   * is made non-empty first, so "no node lacks it" is never an empty-set answer.
   */
  app.post('/api/updates/intent', async (req, reply) => {
    if (!deps.coord || !deps.updateIntentLog) return refuse(reply, 501, { error: 'not-configured' });
    const parsed = parseIntentBody(req.body);
    if (!parsed.ok) return refuse(reply, 400, { error: parsed.error, field: parsed.field });
    if (parsed.patch.auto !== undefined && parsed.patch.auto !== 'off') {
      await ensureInventory(req);
      const blockers = autoGateBlockers(parsed.scope,
        deps.coord.nodes().map((n) => ({ nodeId: n.nodeId, caps: n.caps })));
      if (blockers.length > 0) return refuse(reply, 409, { error: 'auto-needs-rollback-gate', nodes: blockers });
    }
    const written = deps.coord.setIntent(parsed.scope, parsed.patch, deps.updateIntentLog, Date.now());
    if (!written.ok) {
      const { code, body } = intentRefusal(written);
      return refuse(reply, code, body);
    }
    await reproject(req);
    // The epoch RE-MEASURED after the write, the `POST /api/pools/accounts/:id`
    // idiom: the answer reports the store, not the write's own return value.
    const answer: IntentWriteAnswer = { ok: true, intent: toIntentWire(written.row), epoch: deps.coord.updateEpoch().epoch };
    return answer;
  });

  /**
   * An on-demand catalogue poll. RATE-LIMITED to one request a minute (spec §7:
   * the unauthenticated budget is 60/hour and a 304 still spends one), measured
   * against the poller's own `lastRequestAt()` — so the scheduled 30-minute
   * poll counts too, and a refresh inside a minute of it answers 429
   * (D-3203). A
   * `lastRequestAt` in the FUTURE (the clock stepped back) does not lock the
   * door: only an elapsed time in `[0, REFRESH_MIN_INTERVAL_MS)` refuses.
   */
  app.post('/api/updates/refresh', async (req, reply) => {
    if (!deps.coord || !deps.catalogue) return refuse(reply, 501, { error: 'not-configured' });
    const now = Date.now();
    const last = deps.catalogue.lastRequestAt();
    if (last !== null) {
      const since = now - last;
      if (since >= 0 && since < REFRESH_MIN_INTERVAL_MS) {
        const retryAfterS = Math.max(1, Math.ceil((REFRESH_MIN_INTERVAL_MS - since) / 1000));
        reply.header('retry-after', String(retryAfterS));
        return refuse(reply, 429, { error: 'rate-limited', retryAfterS });
      }
    }
    const state: CatalogueState = await deps.catalogue.poll(now);
    await reproject(req);
    return state;
  });

  /**
   * The operator acknowledges a halted node (spec §12): back to `idle`, the
   * request cleared and THIS node's refusals cleared, in `ackNode`'s one
   * transaction (D-3183) — then re-resolved in this request, so a
   * release the node had refused is eligible again on the answer itself.
   */
  app.post('/api/updates/ack', async (req, reply) => {
    if (!deps.coord) return refuse(reply, 501, { error: 'not-configured' });
    const body = parseAckBody(req.body);
    if (!body.ok) return refuse(reply, 400, { error: 'bad-request', field: body.field });
    const acked = deps.coord.ackNode(body.nodeId);
    if (!acked.ok) {
      if (acked.why === 'unknown-node') return refuse(reply, 404, { error: 'unknown-node' });
      if (acked.why === 'superseded') return refuse(reply, 409, { error: 'superseded', detail: acked.supersededBy });
      return refuse(reply, 409, { error: 'busy', detail: acked.state });
    }
    await reproject(req);
    const row = deps.coord.node(body.nodeId);
    if (row === null) return refuse(reply, 404, { error: 'unknown-node' });
    const answer: AckAnswer = { ok: true, node: toNodeWire(row) };
    return answer;
  });

  /**
   * THE PROJECTION READ — the §9 document for one node, resolved on the read
   * (the stored columns hold no `desired-stable`/`desired-dev`), in unix SECONDS
   * (`server.ts`'s C1 lesson on `GET /api/pools/epoch`). EXEMPT-BUT-AUTHENTICATED:
   * `GET /api/pools/epoch`'s guard copied shape for shape — session FIRST, the
   * box token as the fallback, 401 only when both fail, and BEFORE
   * `not-configured` and before the node lookup, so an anonymous caller learns
   * neither whether this box has a control plane nor whether a node-id exists.
   * Registered LAST in this file (see the module docstring).
   */
  app.get('/api/updates/intent/:nodeId', async (req, reply) => {
    if (deps.cfg.authEnabled) {
      const session = sessionAuth(req);
      if (session.reason !== 'session') {
        const token = checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]);
        if (token !== 'ok') {
          return refuse(reply, 401, { error: 'unauthenticated', verdict: session.verdict });
        }
      }
    }
    if (!deps.coord) return refuse(reply, 501, { error: 'not-configured' });
    const { nodeId } = req.params as { nodeId: string };
    const row = deps.coord.node(nodeId);
    if (row === null) return refuse(reply, 404, { error: 'unknown-node' });
    if (row.supersededBy !== null) return refuse(reply, 409, { error: 'superseded', detail: row.supersededBy });
    const resolution = resolveNodeIntent(resolveInputFor(deps.coord, row));
    const rendered = renderProjection(resolution, deps.coord.updateEpoch().epoch, Math.floor(Date.now() / 1000));
    if (!rendered.ok) return refuse(reply, 409, { error: 'no-channel', detail: rendered.detail });
    return reply.type('text/plain; charset=utf-8').send(rendered.text);
  });
}
```

In `shared/api.ts`, apply the Task 1 correction named in the Interfaces block — `UpdateRouteRefusal` gains one optional field. The interface is in Task 1's END-OF-FILE block (after `READER_MIN_COLS`), so the added line sits below every line the README's citation census reads (D-3188); `AuthVerdict` is declared higher in the same file (`shared/api.ts:6448`) and needs no import:

```ts
export interface UpdateRouteRefusal {
  ok: false; error: UpdateRouteError;
  field?: string; nodes?: string[]; detail?: string; retryAfterS?: number;
  verdict?: AuthVerdict;   // the 401 only — the gate-shaped verdict the PWA's login screen reads (`GET /api/pools/epoch`'s body)
}
```

- [ ] **Step 4: Wire the routes, the journal and the one exemption**

`server/src/server.ts` — beside `import { registerCoordRoutes } from './coord/routes.js';` (`:54`):

```ts
import { registerUpdateRoutes } from './update/routes.js';
```

and directly after Task 10's `import type { CataloguePoller } from './update/catalogue.js';` (which follows `import type { PoolEdgeLog } from './coord/pooledgelog.js';`, `:57`):

```ts
import type { UpdateIntentLog } from './coord/updateintentlog.js';
```

In `Deps`, after Task 10's `catalogue?: CataloguePoller;` field (which follows `poolEdgeLog?: PoolEdgeLog;`, `server.ts:295` at d759c914), as the new last field:

```ts
  /** The flat-file journal under `update_intent`/`update_epoch` (design
   *  2026-09-20 §6), `poolEdgeLog`'s twin and for its reason:
   *  `CoordStore.setIntent` appends to it INSIDE its transaction, so
   *  `POST /api/updates/intent` needs the process's one instance, built in
   *  `index.ts` beside `coord`. Optional the same way `coord` is: absent, the
   *  intent route answers `501 not-configured`. */
  updateIntentLog?: UpdateIntentLog;
```

Immediately after `registerCoordRoutes(app, deps, bus, sessionAuth, askDeps, watcher);` (`:1552`):

```ts

  // The update control plane (design 2026-09-20 §12, update-management W2),
  // registered from its own file — which is why `auth-gate.test.ts`'s `ROUTES`
  // and `box-token-census.test.ts`'s lane sources both read `update/routes.ts` by
  // name. `sessionAuth` for its one dual-credential read; `watcher` so a read
  // that finds no row for this box yet measures once instead of answering an
  // empty node list.
  registerUpdateRoutes(app, deps, sessionAuth, watcher);
```

`server/src/index.ts` — beside the `PoolEdgeLog` import:

```ts
import { UpdateIntentLog, defaultUpdateIntentLogPath } from './coord/updateintentlog.js';
```

after Task 10's catalogue-poller block — the `const catalogue = createCataloguePoller(…)` line and the `if (cfg.releaseSource.ok === false) { … }` warning that follows it — which itself follows `const poolEdgeLog = new PoolEdgeLog(defaultPoolEdgeLogPath(cfg.home));` (`index.ts:73`):

```ts

// The process's ONE `UpdateIntentLog`, beside `poolEdgeLog` and for its reason:
// `CoordStore.setIntent` appends to it INSIDE its transaction, so the intent
// route must share this instance rather than construct its own (design
// 2026-09-20 §6).
const updateIntentLog = new UpdateIntentLog(defaultUpdateIntentLogPath(cfg.ccrcDir));
```

and in BOTH `deps` object literals, on the line after Task 10's `catalogue,` (which follows `poolEdgeLog,`, `index.ts:94` and `:146` at d759c914). The two `catalogue,` lines are byte-identical, so edit each with its FOLLOWING line as context — the remote arm's `refreshCaps: makeRefreshCaps(…),` and the local arm's comment line that begins "`connected`/`downSince` are inert for local mode":

```ts
    updateIntentLog,
```

`server/src/auth/gate.ts` — in `EXEMPT`, immediately after the `['GET /api/pools/epoch', …],` entry (`:226-231`):

```ts
  ['GET /api/updates/intent/:nodeId',
    'EXEMPT-BUT-AUTHENTICATED (update-management W2, design 2026-09-20 §9/§12), the same ' +
    'dual-credential arrangement as `GET /api/pools/epoch`: from W4 a fleet node\'s ' +
    '`ccd-update-sync.timer` pulls its own update projection cookieless every minute, and the PWA ' +
    'reads the same document with a session. The handler requires one of those credentials before ' +
    'revealing even `501 not-configured` or whether the node exists, so this entry makes the machine ' +
    'pull possible without making the projection anonymous. It is the ONLY update route here: every ' +
    'update WRITE takes a session and never the box token (decision 15), so none of them is exempt'],
```

`server/test/single-definition.test.ts` — the ONE `UPDATE_RING_FILES` line Task 12 left (`  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts'];   // Task 13 appends 'routes.ts'`, at Task 7's two-space indent) is replaced IN PLACE, at its own indentation (match it by content and keep its leading whitespace), trailing comment dropped (nothing is left to append). One line for one line: the file's cited lines (`:32-37`, `:1274`, `:1303`) do not move, whichever describe Task 7 placed the literal in:

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts'];
```

- [ ] **Step 5: Run the route test, the type check and the ring scan green**

Run, one at a time, foreground, from `server/`:
- `./node_modules/.bin/vitest run test/update-routes.test.ts` — Expected: PASS (every case above).
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json` — Expected: no output, exit 0 (the exhaustive `switch` in `intentRefusal` type-checks without a trailing return; `refuse`'s body satisfies `UpdateRouteRefusal` with its new `verdict`).
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — Expected: PASS (the update ring now lists five files; `routes.ts` imports no `node:sqlite`, no `db.js` and never names a handle on a `coord`/`store` receiver).

- [ ] **Step 6: Run the three route scanners and read their reds — they are this task's next failing tests**

Run: `cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts` then `./node_modules/.bin/vitest run test/box-token-census.test.ts`.
Expected, exactly these FAILs and no others:
- `auth-gate.test.ts` › "every route the server really registers was found by the source scan" — `unscanned` is `['GET /api/updates', 'GET /api/updates/intent/:nodeId', 'POST /api/updates/ack', 'POST /api/updates/intent', 'POST /api/updates/refresh']` (D-3179: the scanner reads two files).
- `auth-gate.test.ts` › "sweeps EXACTLY the routes that are neither websockets nor exempt" — the unscanned EXEMPT keys read `['GET /*', 'GET /api/updates/intent/:nodeId']`.
- `auth-gate.test.ts` › "exempts exactly the six classes the plan names" and "EXEMPT_BUT_AUTHENTICATED (the property sweep's hand-kept set) equals what gate.ts actually declares" — the new key.
- `auth-gate.test.ts` › "the table parser is looking at something" — `real.size` is five above `ROUTES.length`.
- `auth-gate.test.ts` › "GET /api/updates/intent/:nodeId is NOT refused by the gate" (the `it.each` over `EXEMPT.keys()`, `:694-710`) — `GET /api/updates/intent/:nodeId was refused by the session gate`. The cause is the same as the `EXEMPT_BUT_AUTHENTICATED` set-equality red above. The hand-kept set does not have the key yet, so the probe sends no box token. The projection read's own handler then answers `401 { error: 'unauthenticated', verdict }`, and `gateRefused` cannot tell that apart from the gate's refusal. Step 7's set edit clears both.
- `box-token-census.test.ts` › "README names every exempt-but-authenticated GET, derived from the EXEMPT table" — README does not name `/api/updates/intent/:nodeId`.

If anything else reds, stop: the implementation disagrees with the scanners in a way this plan did not predict.

- [ ] **Step 7: Extend `server/test/auth-gate.test.ts` — a third scanned file, and every count it states**

Replace `const ROUTES: ScannedRoute[] = [...scanRoutes('server.ts'), ...scanRoutes('coord/routes.ts')];` (`:95`) with:

```ts
/** THREE files register routes since update-management W2 (design 2026-09-20
 *  §12, D-3179): `server/src/update/routes.ts` joined the two.
 *  The COMPLETE describe below is what says so — it reds the moment a route
 *  registers from a file this list does not read. */
const ROUTES: ScannedRoute[] = [
  ...scanRoutes('server.ts'), ...scanRoutes('coord/routes.ts'), ...scanRoutes('update/routes.ts'),
];
```

Replace the hand-kept set (`:63-66`):

```ts
const EXEMPT_BUT_AUTHENTICATED = new Set(
  ['GET /api/feed', 'GET /api/lifecycle', 'GET /api/runs', 'GET /api/runs/:id/items',
   'GET /api/runs/:id/signals', 'GET /api/peers', 'GET /api/claims', 'GET /api/asks',
   'GET /api/pools/epoch', 'GET /api/updates/intent/:nodeId']);
```

In `describe('the scanner is looking at something')`: rename the first case to `'found all three files, and EXACTLY the route count the surface has'`; after `expect(scanRoutes('coord/routes.ts').length).toBe(30);` insert:

```ts
    // 5 in `update/routes.ts` (update-management W2, design 2026-09-20 §12):
    // `GET /api/updates`, `POST /api/updates/intent`, `POST /api/updates/refresh`
    // and `POST /api/updates/ack`, session-only and NOT EXEMPT, plus the
    // projection read `GET /api/updates/intent/:nodeId`, EXEMPT-BUT-AUTHENTICATED.
    expect(scanRoutes('update/routes.ts').length).toBe(5);
```

and replace `expect(ROUTES.length).toBe(81);` with:

```ts
    // 86 since update-management W2 put the third file's five beside the two
    // files' 51 + 30: 81 -> 86.
    expect(ROUTES.length).toBe(86);
```

In "found the specific registrations this file reasons about", append to the key array (after `'GET /api/auth/passkeys', 'DELETE /api/auth/passkey/:id',`):

```ts
      // The third file's five (update-management W2): a scanner that stopped
      // reading `update/routes.ts` would lose all of them at once.
      'GET /api/updates', 'POST /api/updates/intent', 'POST /api/updates/refresh',
      'POST /api/updates/ack', 'GET /api/updates/intent/:nodeId',
```

In "the table parser is looking at something", replace the comment line (`:413`) `    // 81 scanned + the static wildcard when the bundle is built.` with `    // 86 scanned + the static wildcard when the bundle is built.`

In "exempts exactly the six classes the plan names — nothing has crept in", after the paragraph ending "than a coordination write." add:

```ts
    // 33 since `GET /api/updates/intent/:nodeId` (update-management W2, design
    // 2026-09-20 §12) joined the exempt-but-authenticated class, the tenth
    // member and the `GET /api/pools/epoch` shape again: from W4 a fleet node's
    // `ccd-update-sync.timer` pulls it cookieless, the PWA reads it with a
    // session. The four other update routes are DELIBERATELY NOT here —
    // session-gated when armed, no box token at all (decision 15).
```

and insert `'GET /api/updates/intent/:nodeId',` into the `toEqual([...])` list between `'GET /api/runs/:id/signals',` and `'GET /health',` (the list is `.sort()`ed: `/api/r…` < `/api/u…` < `/h…`).

Replace the census title (`:545`) with (ORDER-PINNED: lanes first, total second — the census reads this one line):

```ts
  it('the twenty-four box-token lanes in EXEMPT are those coord routes, and twenty-seven with notify, pools/epoch and updates/intent', () => {
```

and at the end of that case, after `expect(EXEMPT.has('POST /api/notify')).toBe(true);`:

```ts
    // …and the update projection read, which lives in `update/routes.ts` — the
    // third file this sweep reads since update-management W2: session first, the
    // box token as the fallback, exactly the `GET /api/pools/epoch` shape.
    const update = readFileSync(path.join(srcRoot, 'update/routes.ts'), 'utf8');
    expect(update).toContain('checkMailToken(deps.mailToken');
    expect(EXEMPT.has('GET /api/updates/intent/:nodeId')).toBe(true);
```

The two digit comments the D-1223 describe pins against the derived counts (`httpCount` = 86 − 3 sockets = 83; `exemptHttp` = 33 keys − `GET /*` = 32):
- `:850`: `    // THE PROPERTY, in one loop over all 83 HTTP routes, with THREE probes each:`
- `:914`: `          //    is not itself flag-aware — the assertion that covers all 83 HTTP routes, not the 32 exempt.`

- [ ] **Step 8: Extend `server/test/box-token-census.test.ts` — the third lane source, the doors, and the control**

Replace the two source reads (`:66-67`):

```ts
const COORD_SRC = read('server/src/coord/routes.ts');
const SERVER_SRC = read('server/src/server.ts');
/** The THIRD file that registers routes (update-management W2, design 2026-09-20
 *  §12 census step (a)). Without it, "the update routes are absent from every
 *  box-token lane" would be a measured zero over an empty set — this file is
 *  where a box-token call on the update surface would BE, so it is read like
 *  the two above. */
const UPDATE_SRC = read('server/src/update/routes.ts');
```

Replace `const ALL_LANES = [...COORD_LANES, ...lanesIn(SERVER_SRC)];` (`:98`):

```ts
const UPDATE_LANES = lanesIn(UPDATE_SRC);
const ALL_LANES = [...COORD_LANES, ...lanesIn(SERVER_SRC), ...UPDATE_LANES];
```

Replace the `SESSION_ONLY_ALL` block (`:127-128`):

```ts
/** The update control plane's session-only routes (design 2026-09-20 §12 census
 *  step (b): the FOUR the W2 wave registers of §12's six). Registered from `server/src/update/routes.ts`,
 *  which `coord-pause-route.test.ts`'s `SESSION_ONLY` harvest cannot see for the
 *  kickoff route's reason. Hand-kept for the NAMES only: the update-surface
 *  describe below derives the same set from the file and compares in both
 *  directions, so a route there cannot join or leave without this literal
 *  moving. Wave 5 appends `/api/updates/apply` and `/api/updates/rollback` with
 *  their routes. */
const UPDATE_DOORS = ['/api/updates', '/api/updates/intent', '/api/updates/refresh', '/api/updates/ack'];

/** Every session-only route the bullet must describe as carrying no box token. */
const SESSION_ONLY_ALL = [...SESSION_ONLY_DOORS, KICKOFF, ...UPDATE_DOORS];
```

In "the scan finds what it claims to scan", replace `expect(ALL_LANES.length).toBe(COORD_LANES.length + 2);` with:

```ts
    expect(ALL_LANES, 'the update projection read is missing — update/routes.ts is not being read')
      .toContain('GET /api/updates/intent/:nodeId');
    // THREE since update-management W2: `server.ts`'s pair plus the update
    // projection read, the one handler in `update/routes.ts` that consults the
    // box token (design 2026-09-20 §12, decision 15).
    expect(ALL_LANES.length).toBe(COORD_LANES.length + 3);
```

Insert a new top-level describe immediately after the closing `});` of `describe('the box-token surface is derived, and no prose site under-claims it', …)` (before the `// Task 10 (account-pool-membership wave 1)` comment):

```ts
// ── the update surface (update-management W2, design 2026-09-20 §12) ─────────
//
// `server/src/update/routes.ts` is the THIRD file that registers routes and the
// first whose routes neither harvest above can see. So the census is run over it
// by construction: which of its handlers consult the box token (exactly one, the
// projection read), which do not (the rest, and `UPDATE_DOORS` must name exactly
// them), whether a box-token call planted there would be SEEN (the control that
// makes the first two assertions mean something), and whether CLAUDE.md's bullet
// names every one of them.
describe('the update surface: one dual-credential read, every other route session-only (decision 15)', () => {
  const REGISTERED = [...UPDATE_SRC.matchAll(/app\.(get|post)\('([^']+)'/g)]
    .map((m) => `${m[1]!.toUpperCase()} ${m[2]!}`);

  it('update/routes.ts registers what the checks below reason over', () => {
    // Anti-vacuity: every loop below is over REGISTERED or a filter of it.
    expect(REGISTERED.length, 'the update scan collapsed — this describe is over nothing')
      .toBeGreaterThan(UPDATE_DOORS.length);
    expect(new Set(REGISTERED).size, 'a route is registered twice').toBe(REGISTERED.length);
  });

  it('exactly one handler there consults the box token — the projection read (§18 "no write route takes the box token")', () => {
    expect(UPDATE_LANES).toEqual(['GET /api/updates/intent/:nodeId']);
  });

  it('UPDATE_DOORS is exactly the rest of what the file registers, in both directions', () => {
    const rest = REGISTERED.filter((k) => !UPDATE_LANES.includes(k)).map((k) => k.slice(k.indexOf(' ') + 1));
    expect([...rest].sort(),
      'update/routes.ts and UPDATE_DOORS disagree — a route was added or removed on one side only')
      .toEqual([...UPDATE_DOORS].sort());
  });

  it('a box-token call planted in update/routes.ts is SEEN — the lane source is live, not decorative', () => {
    // The control for the two cases above: they would pass just as green over a
    // scanner that could not see this file at all.
    const anchor = "app.post('/api/updates/ack', async (req, reply) => {";
    expect(UPDATE_SRC, 'the ack registration line moved — re-point this control at it').toContain(anchor);
    for (const call of ['requireMailToken(req, reply);', 'checkMailToken(deps.mailToken ?? null, undefined);']) {
      const planted = UPDATE_SRC.replace(anchor, `${anchor}\n    ${call}`);
      expect(lanesIn(planted), `a planted ${call} went unseen`).toContain('POST /api/updates/ack');
    }
    expect(lanesIn(UPDATE_SRC)).not.toContain('POST /api/updates/ack');
  });

  it("CLAUDE.md's box-token bullet names every update route by its backticked verb and path", () => {
    // Anchored on the backticked VERB + path, because a bare `/api/updates` is a
    // substring of every sibling and would be satisfied by any of them.
    const bullet = passage('CLAUDE.md, the box-token bullet', CLAUDE_MD,
      '- **Box token gates every coordination WRITE**', '\n- **').replace(/\s+/g, ' ');
    for (const key of REGISTERED) {
      expect(bullet, `the bullet does not name \`${key}\` — the update surface grew and the sentence did not`)
        .toContain(`\`${key}\``);
    }
  });
});
```

Also correct the file header's "across both files that register one" (`:19-20`) to "across the three files that register one".

- [ ] **Step 9: Run both scanners and read the prose reds**

Run: `cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts` then `./node_modules/.bin/vitest run test/box-token-census.test.ts`.
Expected FAILs, all prose, none structural:
- `auth-gate.test.ts` › "gate.ts's own docstring names the HTTP-route count it stands in front of" — `expected [ 78 ] to deeply equal [ 83 ]`.
- `box-token-census.test.ts` › "README names every exempt-but-authenticated GET" (still), "README states the DERIVED lane counts" (`twenty-six` where `twenty-seven` is derived), "auth/gate.ts states the derived lane counts wherever it states one" (both passages), "CLAUDE.md's box-token bullet is TRUE, not merely present" (`does not name /api/updates`), and "CLAUDE.md's box-token bullet names every update route".
Every structural case passes: the scan finds the third file, the doors agree in both directions, and the planted control is seen.

- [ ] **Step 10: The prose — `gate.ts`, README, CLAUDE.md**

`server/src/auth/gate.ts:8` — the digit claim becomes ` * THE GATE. One `onRequest` hook stands in front of all 83 routes, the static`.

`gate.ts` reason 2 — replace its first five lines (`:75-79`):

```ts
 *  2. The twenty-four box-token machine lanes plus `/api/notify`, `/api/pools/epoch`
 *     and `/api/updates/intent/:nodeId` — the fleet host's ingress. These callers
 *     are `curl` inside a Claude Code session, ccd's `notify.sh`, `ccd-pool-sync.timer`
 *     (account-pool-membership wave 1, T7, D-3084) and, from update-management W4,
 *     `ccd-update-sync.timer`; none of them has a cookie jar and never
 *     will. All twenty-seven CHECK the box token (`checkMailToken`), and the mail pair
```

and the lines from `` *     `/api/lifecycle`, `/api/peers`, `/api/claims`, `/api/asks`, `/api/pools/epoch`) `` through `` *     does NOT carry this tolerance; it 401s on neither credential. So `/api/notify` `` (`:86-94`):

```ts
 *     `/api/lifecycle`, `/api/peers`, `/api/claims`, `/api/asks`, `/api/pools/epoch`,
 *     `/api/updates/intent/:nodeId`) do NOT: they take a live session cookie OR the token
 *     (D-149), which is why the coordinator can read its own wave ledger
 *     cookieless from the fleet host — and, for the newest members, why
 *     `ccd-pool-sync.timer` can pull the account-pool projection cookieless too, and
 *     why a fleet node's timer will pull its own update projection the same way.
 *     And `/api/notify` still passes `'legacy'` (no token
 *     presented) and `'unconfigured'` (this box was never given one) THROUGH, by
 *     the operator's one-deploy-generation rollout ruling — `/api/pools/epoch` and
 *     `/api/updates/intent/:nodeId` do NOT carry this tolerance; each 401s on neither
 *     credential. So `/api/notify`
```

(The scanned passage may hold no other number word from `two` up — "the newest members", never "the two newest".) The CSRF note (`:730-731`):

```ts
 * EXEMPT ROUTES ARE SKIPPED, and it costs nothing: the twenty-four box-token machine
 * lanes plus `/api/notify`, `/api/pools/epoch` and `/api/updates/intent/:nodeId` — twenty-seven in all — are `curl` inside a Claude Code session (no `Origin`
```

`README.md` — in the ORDER-PINNED paragraph (total first, breakdown second), replace the eight lines `:569-576` (from "liveness gate reads the shipped sha" through "`/api/asks`, `/api/pools/epoch`) take a live session") with exactly eight lines, so the file's length does not move:

```markdown
liveness gate reads the shipped sha out of it), the twenty-seven machine lanes the
fleet host reaches (twenty-four box-token-consulting coordination routes plus
`/api/notify`, which still tolerates an absent token for one deploy generation,
`/api/pools/epoch` and `/api/updates/intent/:nodeId` — the callers are `curl` inside a
Claude Code session, `ccd-pool-sync.timer` and, from W4, `ccd-update-sync.timer`, none with a cookie jar, though the
exempt-but-authenticated GETs among them (`/api/runs`, `/api/runs/:id/items`,
`/api/runs/:id/signals`, `/api/feed`, `/api/lifecycle`, `/api/peers`, `/api/claims`,
`/api/asks`, `/api/pools/epoch`, `/api/updates/intent/:nodeId`) take a live session
```

`CLAUDE.md` — in the box-token bullet, replace:

```markdown
  `GET /api/ledger` all call `requireMailToken` outside both. The dual-credential reads, including `GET /api/feed`,
  call `checkMailToken` only after a session check; `auth/gate.ts`'s EXEMPT reasons — route by route, each with
  its own argument — are the census, not this bullet. What does need saying here are the
```

(`CLAUDE.md:227-229` — the third line runs on past "not this bullet." to the next clause's opening words, and is replaced WHOLE so those words stay) with (the dual read goes in the LANES clause, before "What does need saying here", where the census's over-claim check requires every named route to be a real lane — `box-token-census.test.ts` splits the bullet at that phrase):

```markdown
  `GET /api/ledger` all call `requireMailToken` outside both. The dual-credential reads, including `GET /api/feed`
  and the update projection read `GET /api/updates/intent/:nodeId` (a fleet node's timer pulls it cookieless from
  W4), call `checkMailToken` only after a session check; `auth/gate.ts`'s EXEMPT reasons — route by route, each
  with its own argument — are the census, not this bullet. What does need saying here are the
```

and replace:

```markdown
  set, and `box-token-census.test.ts` now checks this sentence against it in both directions (D-1231).
  Don't assume — read the guards.
```

with (the session doors go in the NO-box-token clause; no capitalised number word — `coord-pause-route.test.ts`'s `CARD_RE` reads this bullet and must still find only `FOUR`):

```markdown
  set, and `box-token-census.test.ts` now checks this sentence against it in both directions (D-1231). The update
  control plane's routes are session-only by design (the box token never writes intent — design 2026-09-20,
  decision 15): `GET /api/updates`, `POST /api/updates/intent`, `POST /api/updates/refresh` and `POST
  /api/updates/ack` consult no box token. They are registered from `server/src/update/routes.ts`, a file neither
  `SESSION_ONLY` nor the kickoff literal can see, so `box-token-census.test.ts` reads it as a lane source of its
  own and keeps their names in a hand-kept `UPDATE_DOORS`, checked against that file in both directions (wave 5
  adds `apply` and `rollback` there with their routes).
  Don't assume — read the guards.
```

- [ ] **Step 11: Run green — every file this task touched or that reads what it touched**

Run each, foreground, from `server/`, timeout ≥ 600000 ms:
- `./node_modules/.bin/vitest run test/update-routes.test.ts`
- `./node_modules/.bin/vitest run test/auth-gate.test.ts`
- `./node_modules/.bin/vitest run test/box-token-census.test.ts`
- `./node_modules/.bin/vitest run test/coord-pause-route.test.ts` (reads the same CLAUDE.md bullet for its `FOUR`)
- `./node_modules/.bin/vitest run test/pools-prose.test.ts` (README's size claim; the README edit is line-neutral — `wc -l README.md` unchanged from before this task)
- `./node_modules/.bin/vitest run test/single-definition.test.ts`
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` (the new test file type-checks; a known load flake — re-run in isolation before calling a red real)
- `git fetch origin main && ./node_modules/.bin/vitest run test/topology-clean.test.ts` (a new file: the fixtures spell `example.invalid` and invented UUIDs only)
- `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` — the citation audit over the three edits this task makes to files it cites or reads: `shared/api.ts` (one line, below `:7526`), `single-definition.test.ts` (one line replaced in place) and README (eight lines for eight, no `file:line` token added). Expected: its 13 cases pass (Task 1 measured `Tests  13 passed | 320 skipped (333)`; only the skip count may differ by then); the census (`'shared/api.ts': 1`, `'server/test/single-definition.test.ts': 8`) and README's empty entry unchanged
- `./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'` (no edit — its scan does not reach `server/src/update/`; a red here means `routes.ts` landed under `coord/`)

Expected: PASS for all ten.

- [ ] **Step 12: Mutation measurements — each guard reds when removed, and is restored byte-for-byte**

Before each mutation copy the file: `B=$(mktemp -d); cp <file> "$B/orig"`; after the run restore with `cp "$B/orig" <file> && cmp "$B/orig" <file>` (never `git checkout --`: `routes.ts` is uncommitted and a checkout would eat it). Each row: the edit, the run, the red that must appear.

1. §18 "`refresh` is rate-limited" — in `server/src/update/routes.ts` delete the whole `if (last !== null) { … }` block in the refresh handler. Run `test/update-routes.test.ts -t 'inside the minute'` → FAIL `expected 200 to be 429`. Restore.
2. §18 "no write route takes the box token" — insert `if (checkMailToken(deps.mailToken ?? null, req.headers[MAIL_TOKEN_HEADER]) !== 'ok') return refuse(reply, 401, { error: 'unauthenticated' });` as the first line of the `POST /api/updates/intent` handler. Run `test/box-token-census.test.ts` → FAIL "exactly one handler there consults the box token" (`UPDATE_LANES` gains `POST /api/updates/intent`) and "UPDATE_DOORS is exactly the rest" and the bullet's "`/api/updates/intent` acquired a box-token gate". Restore.
3. §18 "the projection read takes the box token" — delete the `['GET /api/updates/intent/:nodeId', …]` entry from `EXEMPT` in `gate.ts`. Run `test/update-routes.test.ts -t 'box token alone suffices'` → FAIL `expected 401 to be 200` (the gate refuses the timer's credential). Restore.
4. §18 "six session doors, one dual-credential read" (the four W2 registers; wave 5 appends the other two) — (a) delete `'/api/updates/ack'` from `UPDATE_DOORS` → `test/box-token-census.test.ts` FAIL "UPDATE_DOORS is exactly the rest…"; restore. (b) delete `` and `POST /api/updates/ack` `` wording from the CLAUDE.md bullet (leave the sentence grammatical) → FAIL "CLAUDE.md's box-token bullet is TRUE" (`does not name /api/updates/ack`) and "…names every update route"; restore.
5. D-3179 — remove `...scanRoutes('update/routes.ts')` from `ROUTES` in `auth-gate.test.ts` → FAIL "every route the server really registers was found by the source scan", naming the five. Restore.
6. Credential ORDER (the `GET /api/pools/epoch` rule) — in the projection read move `if (!deps.coord) return refuse(reply, 501, …);` above the `if (deps.cfg.authEnabled)` block. Run `test/update-routes.test.ts -t '401 before 501'` → FAIL `expected 501 to be 401`. Restore.
7. §18 "a superseded row is invisible" (the projection read's own filter) — delete the `row.supersededBy !== null` line in the projection read. Run `-t '404 unknown-node, 409 superseded'` → FAIL `expected 200 to be 409`. Restore.
8. Spec §12 Pin "`GET /api/updates` in local mode answers one node — never an empty list" — delete `await ensureInventory(req);` from the `GET /api/updates` handler. Run `-t 'before the first sweep'` → FAIL `expected [] to have a length of 1`. Restore.
9. §18 "`ack` clears the node's refusals and its request" (the route's half: the re-resolution in the same request) — delete `await reproject(req);` from the ack handler. Run `-t 'failed → idle'` → FAIL on `desiredTag` (`expected null to be 'v0.0.10'`). Restore. Then delete it from the intent handler → `-t 'writes the intent'` FAIL on `desiredTag` and `the server-role projection was not written`. Restore.
10. Spec §9 "the intent route refuses `auto ≠ off`" — delete the `if (blockers.length > 0) return refuse(…)` line. Run `-t 'auto-needs-rollback-gate'` → FAIL `expected 200 to be 409`. Restore.
    Then the "reachable or not" half. `autoGateBlockers` takes no reachability input, so only the route can narrow it. In the intent handler change `deps.coord.nodes().map((n) => ({ nodeId: n.nodeId, caps: n.caps }))` to `deps.coord.nodes().filter((n) => n.reachable).map((n) => ({ nodeId: n.nodeId, caps: n.caps }))`. Run `-t 'an unreachable node blocks auto too'` → FAIL `expected 200 to be 409` (the only reachable node is gated, so nothing blocks). Restore.
11. The census's own control is live — in the new describe's planted case, change `anchor` to a string that is not in the file → FAIL "the ack registration line moved"; restore. (A green planted case over an absent anchor would be vacuous; this shows it cannot be.)

12. Task 6's `no-channel` arm reaches the operator as a 409 — in `intentRefusal` change the `no-channel` case's `code: 409` to `code: 400`. Run `test/update-routes.test.ts -t '409 no-channel when the stored channel'` → FAIL `expected 400 to be 409`. Restore. (Deleting the case instead is a COMPILE error — the switch is exhaustive over `SetIntentResult` — so `tsc --noEmit` reds with `TS2366: Function lacks ending return statement`; measure that too, then restore.)

13. The journal reaches the REMOTE arm — in `server/src/index.ts` delete the remote arm's `updateIntentLog,` line (the one followed by `refreshCaps: makeRefreshCaps(`). Run `test/update-routes.test.ts -t 'hands the one journal'` → FAIL on `/^\s+updateIntentLog,$/m` for the first literal; `./node_modules/.bin/tsc --noEmit -p tsconfig.json` stays exit 0 (`Deps.updateIntentLog` is optional — the gap this pin exists for). Restore.

After the last restore: `git diff --stat` shows only this task's intended edits, and Step 11's ten runs are green again (re-run `update-routes`, `auth-gate`, `box-token-census`).

- [ ] **Step 13: Commit**

```bash
git add server/src/update/routes.ts server/src/server.ts server/src/index.ts server/src/auth/gate.ts \
  shared/api.ts \
  server/test/update-routes.test.ts server/test/auth-gate.test.ts server/test/box-token-census.test.ts \
  server/test/single-definition.test.ts CLAUDE.md README.md
git commit -m "feat(update): the update routes — GET /api/updates and POST intent/refresh/ack, session-only; the projection read GET /api/updates/intent/:nodeId, session else box token; all route scanners and the box-token census read update/routes.ts"
```

### Task 14: The derived `builds`

**Files:**
- Modify: `server/src/fleetstate.ts` — `derivedBuilds` and `BuildSource` right after `buildAgreement` (`fleetstate.ts:208-215`); `NodeRole` added to the `import type` list of `../../shared/api.js` (`fleetstate.ts:4`); one paragraph on `FleetState.build`'s docstring (`fleetstate.ts:45-61`) saying it is no longer the `builds` source when a coordination database is wired
- Modify: `server/src/server.ts` — `GET /api/fleet/health`'s remote arm (`server.ts:1168-1184`: `build:` `:1180`, `builds:` `:1181`); a module-level `inventoryBuilds` just above `buildServer` (`server.ts:314`); `Deps.build`'s docstring (`server.ts:229-235`) names which side it still feeds
- Modify: `shared/api.ts` — COMMENT ONLY and LINE-NEUTRAL: three lines of `FleetHealth.builds`'s docstring (`shared/api.ts:3184-3186`) replaced by exactly three, saying where the two stamps now come from; the type on `:3192` is unchanged (correction: the skeleton did not list this file; the docstring says "what the fleet host's stamp said on its last `ready`", which is false after this task). Line-neutral per coordinator ruling R13 / D-3188: `README.md:2560` cites `shared/api.ts:7465-7467`, `:7505`, `:7513`, `:7526` and plan-a (`docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md:3396`) cites `shared/api.ts:5644`, all below this edit, so one added line reds `session-hook.test.ts`'s citation audit
- Test: `server/test/fleet-build-skew.test.ts`, `server/test/fleet-health.test.ts`
- Guard files — none needs an edit (measured at `d759c914`), and the green run in Step 6 includes `session-hook.test.ts` (R13): the audit's corpus (the graphify-card spec, its plan-a, `README.md`) cites no `fleetstate.ts`, `server.ts`, `fleet-build-skew.test.ts` or `fleet-health.test.ts` line, and its `shared/api.ts` anchors are held by the line-neutral edit above. No route is added, so `auth-gate.test.ts`'s `scanRoutes('server.ts').length` (`:210`) is unmoved; no comment added to `server.ts` spells `app.get('`, `app.post('`, `requireMailToken(req` or `checkMailToken(`, so `auth-gate.test.ts`'s `scanRoutes` and `box-token-census.test.ts`'s `lanesIn` slices are unchanged in what they match; `mail-routes.test.ts`'s kebab scanner reads `server/src/coord` only; `single-definition.test.ts`'s update-ring scan reads `server/src/update` only, and `server.ts` importing `./update/inventory.js` is outside it (the scan's "no importer" arm applies only while that directory is absent, and Task 10 created it).
- Anchors are at `d759c914`. Tasks 8 (`FleetState.agentOps`, above `buildAgreement`), 10 and 13 (`server.ts` imports and `Deps` fields, above `buildServer`) shift the `fleetstate.ts`/`server.ts` line numbers before this task runs, so every edit below is located by its QUOTED text, never by the number.

**Interfaces:**
- Consumes: `buildAgreement` (unchanged, `fleetstate.ts:208-215`); from Task 11 (`server/src/update/inventory.ts`): `buildInfoOfRow(row: Pick<NodeRow, 'stampRead' | 'currentSha' | 'currentRef' | 'currentBuiltAt' | 'currentDirty' | 'currentVersion'>): BuildInfo | null`, `sweepInventory(deps: InventoryDeps, now: number): Promise<SweepOutcome[]>` with `InventoryDeps = { store; localIo; ccrcDir; role; fleet: { io; state } | null; budgetMs? }` and the `{ label; result: 'measured'; … }` outcome arm, `FLEET_LABEL = 'fleet'`; from Task 5 (`server/src/coord/store.ts`): `nodes()` (live rows, `ORDER BY label, nodeId`), `nodeByLabel()`, `upsertNodeMeasurement()` → `{ ok: true; created }`, `rekeyNode()` → `{ ok: true; how: 'rekeyed' | 'superseded' | 'no-label-row'; retired: number; revived: boolean }` (D-3208), `markUnreachable(label, role, at)` → `{ ok: true; nodeId; created; since }`, `NodeMeasurement`, `NodeRow` (`role: NodeRole | null`); `NodeRole` (Task 1, `shared/api.ts`); `cfg.coordDbPath` (`config.ts:44`), `cfg.ccrcDir`, `cfg.role` (Task 9 — `CCRC_FLEET=remote` with no `CCRC_ROLE` derives `'server'`); `ConnectedFleet.io`/`.state` (`remote/client.ts:498-506`).
- Produces:

```ts
// server/src/fleetstate.ts
export interface BuildSource { role: NodeRole | null; build: BuildInfo | null }
/** own = the first source whose role is 'server' | 'both'; fleet = the first whose role is 'fleet'; null where absent
 *  (a row whose stampRead ≠ 'ok' arrives with build null). Sources arrive in nodes()' order, superseded rows excluded. */
export function derivedBuilds(sources: readonly BuildSource[]): { own: BuildInfo | null; fleet: BuildInfo | null };
```

- The route: with `deps.coord`, `const builds = derivedBuilds(deps.coord.nodes().map((r) => ({ role: r.role, build: buildInfoOfRow(r) })))`, `build: buildAgreement(builds.fleet, builds.own)`, `builds`; without `deps.coord` (no inventory to derive from) it keeps today's `deps.build`/`deps.fleetState.build` source. `FleetHealth` (`shared/api.ts:3192`) is unchanged.
- Correction (additive, found writing this body): `nodes()` is a synchronous `node:sqlite` read that can throw (a corrupt or locked `coord.db`), and before this task nothing in the remote arm touched `coord.db`, so a throw would turn `/api/fleet/health` — the route the PWA polls for its banners — into a `500`. The composition lives in a module-level `inventoryBuilds(coord)` in `server.ts` that answers `{own: null, fleet: null}` on a throw (the `readPoolEpoch` degrade, `pools.ts:367-374`), so the route still answers and `build` reads `'unknown'`. It does NOT fall back to `fleetState.build`: spec §8 ("never reads `fleetState.build` as the current build") forbids reading the handshake sample as current wherever an inventory is wired — D-3204.

What this task changes in meaning, said once so the reviewer does not have to rediscover it: the OWN side was `deps.build` (read once at boot, `index.ts:27`) and is now the server row's per-minute measurement of the same file (`cfg.buildInfoPath` and `cfg.ccrcDir`'s `build.json` are one path); the FLEET side was the last `ready` frame's stamp and is now the fleet row's per-minute measurement through the agent. They differ from the old sources only (a) in the seconds between a boot and the first inventory sweep (both sides `null`, `build: 'unknown'` — the first tick sweeps at once, `lastInventoryAt = 0`), (b) between a stamp write and the restart that follows it, and (c) where Task 11's stricter validator refuses a stamp `parseBuildInfo` alone would accept (a non-tag `version`, a non-printable or over-long `ref`/`builtAt` — Review Focus 4), which now reads `null` rather than a stamp. A fleet row the sweep marks unreachable keeps its last measured `current*` columns (`markUnreachable` writes only `reachable`/`unreachableSince`), exactly as `fleetState.build` kept its last value across a disconnect. Spec §8 ("`deps.build` stays read-once at boot … the inventory row is the per-tick measurement") and §14 choose this; `deps.build` itself is untouched and still feeds `/health`.

§18 rows pinned: "a full `BuildInfo` round-trips" (the dirty case through the inventory), "a superseded row is invisible" (the `builds` view is one of the readers spec §8 names).

- [ ] **Step 1: Write the failing tests — `fleet-build-skew.test.ts`**

Extend the import block at the top of `server/test/fleet-build-skew.test.ts`. Replace

```ts
import { buildAgreement, type FleetState } from '../src/fleetstate.js';
```

with

```ts
import { buildAgreement, derivedBuilds, type BuildSource, type FleetState } from '../src/fleetstate.js';
import { CoordStore, type NodeMeasurement } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { FLEET_LABEL, sweepInventory } from '../src/update/inventory.js';
import type { NodeRole } from '../../shared/api.js';
```

Add, directly after the `healthOf` helper (before the first `describe`):

```ts
/** One inventory row exactly as the sweep writes it (Task 11's `measurementFrom`), the stamp spread into the five
 *  `current*` columns. `stamp: null` is a node with no stamp file (`stampRead: 'absent'`). No node-id was measured,
 *  so the row is keyed by its label and its install state is `unknown` (spec §8). */
function row(label: string, role: NodeRole, stamp: BuildInfo | null, over: Partial<NodeMeasurement> = {}): NodeMeasurement {
  return {
    nodeId: label, role, label,
    currentVersion: stamp?.version ?? null, currentSha: stamp?.sha ?? null, currentRef: stamp?.ref ?? null,
    currentBuiltAt: stamp?.builtAt ?? null, currentDirty: stamp?.dirty ?? null,
    stampRead: stamp ? 'ok' : 'absent', installState: 'unknown', provenance: 'unknown',
    caps: [], agentOps: role === 'fleet' ? [] : null, highestVersion: null, previousVersion: null, os: 'linux',
    measuredAt: 1_758_000_000_000, report: null,
    ...over,
  };
}

/** Remote-mode deps WITH a coordination database holding `rows`, and with the two OLD sources (`fleetState.build`,
 *  `deps.build`) set to `decoy` — so every case below can tell which source the route read. */
function inventoryDeps(rows: readonly NodeMeasurement[], decoy: { fleet: BuildInfo | null; own: BuildInfo | null }): { deps: Deps; coord: CoordStore } {
  const base = remoteDeps(decoy.fleet, decoy.own);
  const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
  for (const m of rows) expect(coord.upsertNodeMeasurement(m), m.label).toMatchObject({ ok: true });
  return { deps: { ...base, coord }, coord };
}

const FLEET: BuildInfo = { sha: 'abc1234', ref: 'release', builtAt: '2026-09-21T00:00:00Z', dirty: false, version: 'v0.0.11' };
const SERVER: BuildInfo = { ...FLEET, builtAt: '2026-09-21T00:02:00Z' };
const DECOY_FLEET: BuildInfo = { ...OWN, sha: 'dec0y01' };
const DECOY_OWN: BuildInfo = { ...OWN, sha: 'dec0y02' };
```

Add two describes after `describe('GET /api/fleet/health — the skew answer reaches the operator', …)` and before the `writeStamp` helper:

```ts
describe('derivedBuilds — the pair as a view of the node rows (design 2026-09-20 §14)', () => {
  const A: BuildInfo = { ...OWN, sha: 'aaaaaaa' };
  const B: BuildInfo = { ...OWN, sha: 'bbbbbbb' };
  const C: BuildInfo = { ...OWN, sha: 'ccccccc' };

  it('no rows is no evidence on either side', () => {
    expect(derivedBuilds([])).toEqual({ own: null, fleet: null });
  });

  it('own is the server-role row, fleet the fleet-role row, whichever order they arrive in', () => {
    const s: BuildSource = { role: 'server', build: A };
    const f: BuildSource = { role: 'fleet', build: B };
    expect(derivedBuilds([s, f])).toEqual({ own: A, fleet: B });
    expect(derivedBuilds([f, s])).toEqual({ own: A, fleet: B });
  });

  it("a 'both' row is this box — the single-box shape records role both", () => {
    expect(derivedBuilds([{ role: 'both', build: A }])).toEqual({ own: A, fleet: null });
  });

  it('the FIRST row of a role decides, and a later row never backfills its null', () => {
    // The first live fleet-role row IS the fleet node (spec §14); a row after it is a second connection this
    // build has no label for (D-3184), and borrowing its stamp would describe a node nobody asked about.
    expect(derivedBuilds([{ role: 'fleet', build: B }, { role: 'fleet', build: C }])).toEqual({ own: null, fleet: B });
    expect(derivedBuilds([{ role: 'fleet', build: null }, { role: 'fleet', build: C }])).toEqual({ own: null, fleet: null });
    expect(derivedBuilds([{ role: 'server', build: null }, { role: 'both', build: A }])).toEqual({ own: null, fleet: null });
  });

  it('a row whose role is outside the vocabulary names neither side', () => {
    // `nodes.role` reads `null` for a token a newer build wrote (D-3181); it is not this box and
    // not the fleet box, so it must not be either.
    expect(derivedBuilds([{ role: null, build: A }])).toEqual({ own: null, fleet: null });
  });
});

describe('GET /api/fleet/health — `builds` is derived from the inventory when one is wired (design 2026-09-20 §14)', () => {
  async function health(deps: Deps, coord: CoordStore): Promise<Record<string, unknown>> {
    try { return await healthOf(deps); } finally { coord.db.close(); }
  }

  it('reads the two rows, not the boot stamp and the handshake stamp', async () => {
    // The decoys disagree with each other (the OLD source would answer `skewed`); the rows agree. Only a route that
    // reads the rows answers `agreed` with these stamps.
    const { deps, coord } = inventoryDeps(
      [row('server', 'server', SERVER), row(FLEET_LABEL, 'fleet', FLEET)],
      { fleet: DECOY_FLEET, own: DECOY_OWN });
    const h = await health(deps, coord);
    expect(h['build']).toBe('agreed');
    expect(h['builds']).toEqual({ own: SERVER, fleet: FLEET });
  });

  it('a dirty fleet row reads skewed — dirty survives the five current* columns (§18 "a full BuildInfo round-trips")', async () => {
    // Decoys agree and are clean: the old source would answer `agreed`. A dropped `currentDirty` column, or a
    // `buildInfoOfRow` that forgets it, turns this back into `agreed`.
    const dirty: BuildInfo = { ...FLEET, dirty: true };
    const { deps, coord } = inventoryDeps(
      [row('server', 'server', SERVER), row(FLEET_LABEL, 'fleet', dirty)],
      { fleet: OWN, own: OWN });
    const h = await health(deps, coord);
    expect(h['build']).toBe('skewed');
    expect(h['builds']).toEqual({ own: SERVER, fleet: dirty });
  });

  it('a row whose stamp did not read ok is null on that side, whatever its current* columns hold', async () => {
    // `unreadable` (EACCES, a symlink, an agent that refuses the read) and `malformed` are both "no evidence":
    // the answer is `unknown`, never a stamp and never `skewed`. The columns are planted non-null on purpose —
    // the gate is `stampRead`, not the columns happening to be empty.
    for (const stampRead of ['unreadable', 'malformed'] as const) {
      const { deps, coord } = inventoryDeps(
        [row('server', 'server', SERVER), row(FLEET_LABEL, 'fleet', FLEET, { stampRead })],
        { fleet: SERVER, own: SERVER });
      const h = await health(deps, coord);
      expect(h['build'], stampRead).toBe('unknown');
      expect(h['builds'], stampRead).toEqual({ own: SERVER, fleet: null });
    }
  });

  it('no rows yet is unknown on both sides — the handshake stamp is never read as current (spec §8)', async () => {
    // Before the first sweep writes a row. The decoys agree; a route that fell back to them would say `agreed`.
    const { deps, coord } = inventoryDeps([], { fleet: OWN, own: OWN });
    const h = await health(deps, coord);
    expect(h['build']).toBe('unknown');
    expect(h['builds']).toEqual({ own: null, fleet: null });
  });

  it('a superseded label row is invisible to `builds` (§18 "a superseded row is invisible")', async () => {
    // The label row sorts FIRST (`nodes()` orders by label; 'a-…' < 'fleet'), so a reader that stopped filtering
    // `supersededBy` would take the stale stamp as the fleet side.
    const FLEET_ID = '3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b';
    const stale: BuildInfo = { ...FLEET, sha: '0ldc0de', version: 'v0.0.3' };
    const { deps, coord } = inventoryDeps(
      [row('server', 'server', SERVER), row('a-old-connection', 'fleet', stale),
        row(FLEET_LABEL, 'fleet', FLEET, { nodeId: FLEET_ID })],
      { fleet: stale, own: SERVER });
    // `retired: 0` — Task 5's `RekeyNodeResult` carries the count of OTHER live rows under this label it retired;
    // the only other row here carries label `fleet`, not `a-old-connection`.
    expect(coord.rekeyNode('a-old-connection', FLEET_ID)).toEqual({ ok: true, how: 'superseded', retired: 0 });
    const h = await health(deps, coord);
    expect(h['builds']).toEqual({ own: SERVER, fleet: FLEET });
    expect(h['build']).toBe('agreed');
  });

  it('an unreachable fleet row keeps its last measured stamp, as the handshake field did across a disconnect', async () => {
    const { deps, coord } = inventoryDeps(
      [row('server', 'server', SERVER), row(FLEET_LABEL, 'fleet', FLEET)],
      { fleet: null, own: null });
    expect(coord.markUnreachable(FLEET_LABEL, 'fleet', 1_758_000_060_000)).toMatchObject({ ok: true, created: false });
    const h = await health(deps, coord);
    expect(h['builds']).toEqual({ own: SERVER, fleet: FLEET });
  });

  it("an older PWA's reading of `builds` is unchanged — the same stamps through either source are the same JSON", async () => {
    // The field's readers today are `BuildLine` and `FleetHostBanner`'s skewed arm (pwa/src/fleet/), both of which
    // read `version` by type (`typeof b.version === 'string'`, `b.version ?? …`). `toStrictEqual` on the PARSED
    // body is the whole contract they see: an unversioned stamp must arrive with NO `version` key — not
    // `version: null` — and a versioned one with it, exactly as `parseBuildInfo` shapes the boot and handshake reads.
    const unversioned: BuildInfo = { sha: 'abc1234', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false };
    for (const [ownStamp, fleetStamp] of [[SERVER, FLEET], [unversioned, FLEET], [SERVER, { ...unversioned, dirty: true }]] as const) {
      const before = await healthOf(remoteDeps(fleetStamp, ownStamp));
      const { deps, coord } = inventoryDeps(
        [row('server', 'server', ownStamp), row(FLEET_LABEL, 'fleet', fleetStamp)],
        { fleet: null, own: null });
      const after = await health(deps, coord);
      expect(after['builds'], JSON.stringify([ownStamp, fleetStamp])).toStrictEqual(before['builds']);
      expect(after['build']).toBe(before['build']);
    }
    const { deps, coord } = inventoryDeps([row('server', 'server', unversioned)], { fleet: null, own: null });
    const own = ((await health(deps, coord))['builds'] as { own: Record<string, unknown> }).own;
    expect('version' in own).toBe(false);
  });
});
```

Add one case at the end of `describe('end to end — a stamp on the fleet host\'s disk becomes an answer on the route', …)`:

```ts
  it('the fleet host\'s stamp reaches `builds` through the INVENTORY — agent read, sweep, row, route', async () => {
    // The whole W2 path with no fakes: a real agent admits `~/.ccrc/build.json` through the exact-basename read set
    // (Task 8), `sweepInventory` measures it over the live socket (Task 11), the row lands in a real coord.db, and
    // the route derives from the row. The server's config points at the agent's fixture HOME — the
    // same-absolute-path assumption every remote read makes (Global Constraints) — so the server row measures the
    // same file. `fleetState.build` is nulled and `deps.build` is null: the old sources would answer `unknown`.
    const tagged: BuildInfo = { ...OWN, version: 'v0.0.9' };
    fleet = await liveFleet(tagged);
    seedRoster(fixture!.home);
    const cfg = loadConfig({ CCRC_HOME: fixture!.home, CCRC_FLEET: 'remote' });
    const coord = new CoordStore(openCoordDb(cfg.coordDbPath));
    try {
      const outcomes = await sweepInventory({
        store: coord, localIo: localIO, ccrcDir: cfg.ccrcDir, role: cfg.role,
        fleet: { io: fleet.io, state: fleet.state },
      }, Date.now());
      expect(outcomes.find((o) => o.label === FLEET_LABEL)).toMatchObject({ result: 'measured' });
      expect(coord.nodeByLabel(FLEET_LABEL)?.stampRead).toBe('ok');
      const app = await buildServer({
        cfg, build: null, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner),
        io: localIO, fleetState: { ...fleet.state, build: null }, queue: new KeyedQueue(), coord,
      });
      try {
        const h = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
        expect(h['build']).toBe('agreed');
        expect(h['builds']).toEqual({ own: tagged, fleet: tagged });
      } finally {
        await app.close();
      }
    } finally {
      coord.db.close();
    }
  });
```

- [ ] **Step 2: Write the failing tests — `fleet-health.test.ts`**

Add to the import block of `server/test/fleet-health.test.ts` (it already imports `CoordStore`, `openCoordDb`, `mkTmp`, `testDeps`):

```ts
import type { BuildInfo } from '../../shared/buildinfo.js';
import type { NodeMeasurement } from '../src/coord/store.js';
```

Add a describe after `describe('GET /api/fleet/health', …)` (it closes at `fleet-health.test.ts:150`) and before `describe('GET /api/fleet — degraded mode', …)`:

```ts
describe('GET /api/fleet/health — the inventory-derived `builds` degrades, never 500s (design 2026-09-20 §14)', () => {
  const STAMP: BuildInfo = { sha: 'abc1234', ref: 'main', builtAt: '2026-09-21T00:00:00Z', dirty: false, version: 'v0.0.11' };
  const serverRow = (role: 'server' | 'both'): NodeMeasurement => ({
    nodeId: 'server', role, label: 'server',
    currentVersion: STAMP.version ?? null, currentSha: STAMP.sha, currentRef: STAMP.ref,
    currentBuiltAt: STAMP.builtAt, currentDirty: STAMP.dirty,
    stampRead: 'ok', installState: 'unknown', provenance: 'unknown', caps: [], agentOps: null,
    highestVersion: null, previousVersion: null, os: 'linux', measuredAt: 1_758_000_000_000, report: null,
  });

  it('an inventory that cannot be read answers builds null per side and build unknown — the route stays up', async () => {
    // `nodes()` is a synchronous sqlite read; a corrupt or locked coord.db throws. Before W2 nothing in this arm
    // touched coord.db, so a throw here would be a NEW way for the banner route to 500. It degrades the way
    // `readPoolEpoch` degrades — and it does NOT fall back to the handshake stamp planted below (spec §8).
    const deps = remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: STAMP });
    const coord = new CoordStore(openCoordDb(deps.cfg.coordDbPath));
    const broken = Object.assign(Object.create(coord) as CoordStore, {
      nodes: (): never => { throw new Error('planted: the inventory cannot be read'); },
    });
    const app = await buildServer({ ...deps, build: STAMP, coord: broken });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ mode: 'remote', connected: true, build: 'unknown', builds: { own: null, fleet: null } });
    } finally {
      await app.close();
      coord.db.close();
    }
  });

  it('local mode never emits `builds`, even over an inventory holding this box\'s row', async () => {
    // The derivation is the remote arm's alone: there is still no second box to show.
    const home = mkTmp('ccrc-fh-builds-');
    const deps = testDeps(home);
    const coord = new CoordStore(openCoordDb(deps.cfg.coordDbPath));
    expect(coord.upsertNodeMeasurement(serverRow('both'))).toMatchObject({ ok: true });
    const app = await buildServer({ ...deps, coord });
    try {
      const body = (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
      expect('builds' in body).toBe(false);
      expect(body['build']).toBe('unknown');
    } finally {
      await app.close();
      coord.db.close();
    }
  });
});
```

- [ ] **Step 3: Run them red**

Run (foreground, timeout ≥ 600000 ms):
`cd server && ./node_modules/.bin/vitest run test/fleet-build-skew.test.ts`
Expected: FAIL. The `derivedBuilds` cases fail with `TypeError: … derivedBuilds is not a function` (or, if the runner checks named exports, the whole file with `does not provide an export named 'derivedBuilds'` — either is this red). Once the unit cases are the only thing missing, EVERY case in the inventory-route describe fails on its assertions, because today's route ignores `coord` and reads the decoys: "reads the two rows" gets `expected 'skewed' to be 'agreed'`, "a dirty fleet row" gets `expected 'agreed' to be 'skewed'`, "did not read ok" gets `expected 'agreed' to be 'unknown'`, "no rows yet" gets `expected 'agreed' to be 'unknown'`, "a superseded label row" gets the `0ldc0de` decoy as `fleet`, "an unreachable fleet row" gets `{ own: null, fleet: null }` (null decoys), and the "older PWA" parity case gets `{ own: null, fleet: null }` on the `toStrictEqual` (its decoys are null too — corrected: an earlier draft of this step called that case green before the implementation, which it is not); the end-to-end case gets `expected 'unknown' to be 'agreed'`. The parity case's KEY-SHAPE half (no `version` key rather than `version: null`) is shown to guard anything only by its own mutation (Step 7, M6).
`cd server && ./node_modules/.bin/vitest run test/fleet-health.test.ts`
Expected: FAIL on "an inventory that cannot be read …" (`expected { …, build: 'agreed', builds: { own: {…}, fleet: {…} } } to match object …` — today's arm reads the planted handshake stamp); the local-mode case is already green (the local arm never emitted `builds`) and stays green.

- [ ] **Step 4: Implement `derivedBuilds` in `server/src/fleetstate.ts`**

Change the import at `fleetstate.ts:4` to:

```ts
import { reviveFleetSessions, type BuildAgreement, type FleetSession, type NodeRole } from '../../shared/api.js';
```

On `FleetState.build`'s docstring, replace its last line (`fleetstate.ts:61`)

```ts
   *  build) is part of the enumeration rather than collateral damage. */
```

with

```ts
   *  build) is part of the enumeration rather than collateral damage.
   *
   *  NO LONGER `FleetHealth.builds`' SOURCE when a coordination database is
   *  wired (design 2026-09-20 §14): a handshake-cadence sample cannot stand in
   *  for a per-minute fact — the `observedEpoch` lesson below — so the route
   *  derives both sides from the inventory rows through `derivedBuilds`. This
   *  field is still populated on every `ready`, and still feeds the route when
   *  `Deps.coord` is absent (tests and scripts that build `Deps` by hand). */
```

Insert directly after `buildAgreement`'s closing brace (`fleetstate.ts:215`):

```ts

/** One inventory row's evidence for `derivedBuilds`: the row's role (`null` =
 *  a token outside `NodeRole`, which names neither box) and its stamp as a
 *  full `BuildInfo` (`null` = no readable stamp — `buildInfoOfRow` answers
 *  `null` unless `stampRead` is `'ok'`). */
export interface BuildSource { role: NodeRole | null; build: BuildInfo | null }

/**
 * `FleetHealth.builds` as a VIEW of the node inventory (design 2026-09-20
 * §14), so a PWA that reads `{own, fleet}` keeps its answer while the console
 * learns to read `NodeWire[]` (W3), after which the field is unread by any
 * shipped reader and retires under wire discipline.
 *
 * `own` is the first source whose role is `server` or `both` — THIS box, in
 * either install shape; `fleet` is the first whose role is `fleet`. FIRST, and
 * a later row never backfills a null: the first live fleet-role row IS the
 * fleet node, and a second one would be a second connection this build has no
 * label for. Sources arrive in `nodes()`' order with superseded rows already
 * excluded; excluding them is the store's job, and deciding which row is which
 * side is this function's — the route composes the two and decides nothing.
 *
 * `buildAgreement` above is unchanged: three words, sha + dirty, now fed from
 * here.
 */
export function derivedBuilds(sources: readonly BuildSource[]): { own: BuildInfo | null; fleet: BuildInfo | null } {
  const own = sources.find((s) => s.role === 'server' || s.role === 'both');
  const fleet = sources.find((s) => s.role === 'fleet');
  return { own: own?.build ?? null, fleet: fleet?.build ?? null };
}
```

- [ ] **Step 5: Implement the route in `server/src/server.ts`**

Imports. Change the `./fleetstate.js` import (`server.ts:22`) to:

```ts
import { buildAgreement, defaultCachePath, derivedBuilds, loadSnapshot, rosterAgreement, type FleetState } from './fleetstate.js';
```

add `type NodeRow` to the `./coord/store.js` import (`server.ts:56`):

```ts
import { toRunSummary, type AskRow, type AskTakeResult, type CoordStore, type NodeRow } from './coord/store.js';
```

and add one import line after it:

```ts
import { buildInfoOfRow } from './update/inventory.js';
```

Insert directly above `export async function buildServer` (`server.ts:314`):

```ts
/**
 * `FleetHealth.builds`, derived from the inventory rows (design 2026-09-20
 * §14): each live row's role and its five `current*` columns as one
 * `BuildInfo` (`buildInfoOfRow`, update/inventory.ts), paired by
 * `derivedBuilds`. Composition only — which row is which side is decided
 * there.
 *
 * A THROWING `nodes()` (a corrupt or locked coord.db) answers null on both
 * sides, the way `readPoolEpoch` (pools.ts) degrades its own read: before W2
 * nothing in the health route's remote arm touched coord.db, and the banner
 * route must not gain a new way to 500. It deliberately does NOT fall back to
 * `fleetState.build` — spec §8: the handshake sample is never read as the
 * current build where an inventory is wired. The fold of "unreadable" into
 * "no rows yet" is honest for this field's readers, which render both as a
 * dash; `GET /api/updates` is where the distinction is shown.
 */
function inventoryBuilds(coord: Pick<CoordStore, 'nodes'>): { own: BuildInfo | null; fleet: BuildInfo | null } {
  let rows: NodeRow[];
  try {
    rows = coord.nodes();
  } catch {
    return { own: null, fleet: null };
  }
  return derivedBuilds(rows.map((r) => ({ role: r.role, build: buildInfoOfRow(r) })));
}
```

In `GET /api/fleet/health` (`server.ts:1159`), replace the remote arm's opening and its two build lines — from

```ts
    if (deps.cfg.fleetMode === 'remote' && deps.fleetState) {
      return {
```

through

```ts
        build: buildAgreement(deps.fleetState.build, deps.build ?? null),
        builds: { own: deps.build ?? null, fleet: deps.fleetState.build ?? null },
```

— keeping every line between them (`mode`, `connected`, `downSince`, `roster`) — so that it reads:

```ts
    if (deps.cfg.fleetMode === 'remote' && deps.fleetState) {
      // The two stamps: with a coordination database, the inventory's rows —
      // re-measured every minute by `sweepInventory`, superseded rows excluded
      // (design 2026-09-20 §14); without one (tests and scripts that build
      // `Deps` by hand), what this box read at boot (`deps.build`) and what the
      // fleet host said on its last `ready` (`fleetState.build`). `?? null`
      // because `Deps.build` is optional for such callers — an absent stamp
      // and a null one are the same condition, exactly as `/health` treats
      // them. `buildAgreement` decides from whichever pair this is.
      const builds = deps.coord
        ? inventoryBuilds(deps.coord)
        : { own: deps.build ?? null, fleet: deps.fleetState.build ?? null };
      return {
        mode: 'remote',
        connected: deps.fleetState.connected,
        downSince: deps.fleetState.downSince,
        roster: rosterAgreement(deps.fleetState.rosterFp, ownRosterFp),
        build: buildAgreement(builds.fleet, builds.own),
        builds,
```

(the old six-line comment above `build:` — "`deps.build` is what THIS box's deploy stamped …" — is superseded by the one above and is removed with it). The local-mode arm is untouched.

In `Deps.build`'s docstring (`server.ts:229-235`), replace

```ts
   *  `/api/fleet/health`, where this is now also the OWN side of the two-box
   *  skew comparison (`buildAgreement`, against `fleetState.build`). Which is
   *  why an unstamped server answers `'unknown'` rather than manufacturing a
   *  disagreement with the fleet host out of a stamp it never had. */
```

with

```ts
   *  `/api/fleet/health` when no coordination database is wired, where this
   *  is the OWN side of the two-box skew comparison (`buildAgreement`,
   *  against `fleetState.build`); with one, the inventory's server row is
   *  (design 2026-09-20 §14). Either way an unstamped server answers
   *  `'unknown'` rather than manufacturing a disagreement with the fleet host
   *  out of a stamp it never had. */
```

- [ ] **Step 6: The docstring on the wire type, and green**

In `shared/api.ts`, `FleetHealth.builds`' docstring (`shared/api.ts:3184-3191`) — comment only, the type on `:3192` is unchanged — replace

```ts
   * The EVIDENCE beside the decision (release/rollout design §6): what THIS
   * box's stamp says and what the fleet host's stamp said on its last
   * `ready`, each `null` when that side has no readable stamp. `build`
```

with

```ts
   * The EVIDENCE beside the decision (release/rollout design §6): what THIS
   * box's stamp and the fleet host's say, per the node inventory (design
   * 2026-09-20 §14, `derivedBuilds`); `null` = no readable stamp. `build`
```

Three lines for three — LINE-NEUTRAL (coordinator ruling R13, D-3188): every `shared/api.ts` anchor the citation corpus holds (`:5644`, `:7465-7467`, `:7505`, `:7513`, `:7526`) is below this docstring. Confirm before running anything: `wc -l shared/api.ts` is the same number before and after this step.

Run (foreground, one at a time, timeout ≥ 600000 ms):
`cd server && ./node_modules/.bin/vitest run test/fleet-build-skew.test.ts`
`cd server && ./node_modules/.bin/vitest run test/fleet-health.test.ts`
Expected: PASS, both — including every pre-existing case, which builds `Deps` with no `coord` and so still reads the old source.
Then the guards this touches: `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts` (server.ts and two test files changed; a known load flake — re-run in isolation before calling a red real), `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts` (the update-ring scan reads `server/src/update` only; `server.ts` importing `./update/inventory.js` is outside it), `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts` (R13: the citation audit — the `shared/api.ts` edit is line-neutral, so its census entries hold; a known load flake, re-run in isolation before calling a red real), and `cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts test/box-token-census.test.ts` (the route slices of `server.ts` gained comments only).
Expected: PASS.

- [ ] **Step 7: Mutation measurement**

Each edit, run `cd server && ./node_modules/.bin/vitest run test/fleet-build-skew.test.ts` (M5 against `test/fleet-health.test.ts`), expect the named red, restore by re-applying Step 4/5 text (never `git checkout --`, which would eat the uncommitted task), re-run green:
- **M1 — §18 "a full `BuildInfo` round-trips".** In `buildInfoOfRow` (`server/src/update/inventory.ts`), make the `base` literal's `dirty` property `false` instead of `row.currentDirty`. Red: "a dirty fleet row reads skewed" (`expected 'agreed' to be 'skewed'`), and the parity case's dirty pair.
- **M2 — the source switch.** In the route, replace `deps.coord ? inventoryBuilds(deps.coord) : …` with the else arm alone. Red: every case of the inventory-route describe (each reads its decoys — "reads the two rows" gets `expected 'skewed' to be 'agreed'`, "no rows yet" `expected 'agreed' to be 'unknown'`) and the end-to-end inventory case (`expected 'unknown' to be 'agreed'`).
- **M3 — §18 "a superseded row is invisible".** In `CoordStore.nodes()` (`server/src/coord/store.ts`, Task 5), delete the whole `WHERE supersededBy IS NULL ` clause (the predicate alone would leave `WHERE ORDER BY`, a syntax error that reds for the wrong reason). Red: "a superseded label row is invisible to `builds`" (`fleet` is the `0ldc0de` stamp).
- **M4 — `both` is this box.** In `derivedBuilds`, drop `|| s.role === 'both'`. Red: "a 'both' row is this box".
- **M5 — the degrade.** In `inventoryBuilds`, remove the `try`/`catch` (call `coord.nodes()` bare). Red in `fleet-health.test.ts`: "an inventory that cannot be read …" (`expected 500 to be 200`).
- **M6 — the older PWA's JSON.** In `buildInfoOfRow`, replace its last line with `return { ...base, version: row.currentVersion };` (so an unversioned row carries `version: null`). Red: "an older PWA's reading of `builds` is unchanged" (`toStrictEqual` sees the extra key; the final `'version' in own` assertion is `true`). tsc would also refuse this mutation (`null` is not assignable to `version?: string`); vitest does not typecheck, so the case is the runtime pin.

- [ ] **Step 8: Commit**

```bash
git add server/src/fleetstate.ts server/src/server.ts shared/api.ts server/test/fleet-build-skew.test.ts server/test/fleet-health.test.ts
git commit -m "feat(update): FleetHealth.builds is a view of the inventory rows; buildAgreement takes its pair from there, and an unreadable inventory degrades instead of 500ing"
```

### Task 15: Docs, the gate, the PR, the exit criterion

**Files:**
- Modify: `README.md` — the Releases section's "**Update and rollout.**" paragraph (`README.md:467-490`; the skeleton's `:466` is one line early) gains a "**Control plane (update-management W2).**" paragraph after it, before "**The maintenance verbs.**" (`:492`): what W2 measures and what it does not do yet. NOT line-neutral, deliberately: the paragraph (21 lines) plus its blank line add 22 lines (3279 at d759c914 → 3301; Task 13's auth-paragraph edit is eight lines for eight and moves nothing), so `pools-prose.test.ts:868-880`'s 100-line ratchet on CLAUDE.md's `~3200 lines` claim is re-measured in Step 3. The insert moves no citation: `session-hook.test.ts`'s citation audit (`:7073-7080`) reads README only as a CITING document — its `FILE_RE` has no `.md` arm, so no corpus anchor points INTO README — and the new text carries no `:<digits>` token for `REF_RE` to resolve (ruling R13's line-neutral rule governs cited files; README is not one)
- Modify: `CLAUDE.md` — the Deploy bullet (`CLAUDE.md:94-130`) gains one sentence after the "What is running where" list (`:114`): `GET /api/updates` is where the inventory is read (three lines for two — no test cites a CLAUDE.md line or slices this bullet); and the README size claim on `CLAUDE.md:10`, set by Step 3's measurement (`3200` → `3300` for the 3301-line README Step 1 leaves; correction: the skeleton did not list this line)
- NOT edited by this task: `docs/superpowers/plans/2026-09-22-centralised-update-w2-control-plane.md` — the coordinator replaces every «dev:…» placeholder, in prose and in code-block comments, with an allocator-issued number in one pass after the plan's fixes (ruling R12: "writers leave the placeholder form intact"); Step 5 only verifies it happened, and never types a number
- Guard files READ by this task's edits and run in Step 4, none edited: `server/test/pools-prose.test.ts` (the README size ratchet — Step 3 keeps it green; its README passages open on markers this paragraph does not contain), `server/test/oss-metadata.test.ts` (the same claim at 10%), `server/test/session-hook.test.ts` (README's citation-census entry stays empty), `server/test/box-token-census.test.ts` and `server/test/coord-pause-route.test.ts` (README and CLAUDE.md passages by marker — the auth paragraph, the caps paragraph, the box-token bullet — none of which this task touches), `server/test/crossrepo-prose.test.ts`, `server/test/readme-holds.test.ts`, `server/test/readme-roster-mirror.test.ts` (README by marker), `server/test/ledger-instruction.test.ts` and `server/test/coordinator-skill.test.ts` (CLAUDE.md by marker), `server/test/topology-clean.test.ts` (no hostname, org, label or address in the new text)
- Test: every suite — `cd server && ./node_modules/.bin/vitest run` (whole, unsharded, as CI runs it), `cd agent && ./node_modules/.bin/vitest run`, `cd pwa && ./node_modules/.bin/vitest run`; then `test/deviation-refs.test.ts`, `test/dtbd.test.ts`, `test/topology-clean.test.ts` after `git fetch origin main`

**Interfaces:**
- Consumes: every export above; `MIGRATIONS.length` on `origin/main` (re-measured right before the PR and again before merge).
- Produces: no code. The PR (workspace branch → `main`), and the coordinator's live-measurement list for after rollout: `GET /api/updates` answers two nodes with `stampRead = 'ok'` on the fleet row, a non-null `catalogue.lastOkAt`, and per node a non-null `desiredTag` or, with `desiredTag` NULL, §9's at-floor sentence in `resolveDetail` — never NULL in both (spec §15 says "a `desiredTag` per node"; D-3205); the server node's `~/.ccrc/update-intent` parses under the Task 12 validator's grammar, mode `0600`, and `GET /api/updates/intent/:nodeId` answers it `200` as `text/plain; charset=utf-8` under the box token (ruling R3); `POST /api/updates/intent {scope:'*', channel:<the other channel>}` with a session answers `200` and moves `epoch` (and the projection's `channel`), then the restore does the same. The worker's wave-done names the fixture proofs; the live reads are the coordinator's.

- [ ] **Step 1: README — the "Control plane" paragraph**

In `README.md`, directly after the "**Update and rollout.**" paragraph's last line (`README.md:490`, ending ``…`skills` every home against the shipped tree, `fleet` names `ccrc rollout`.``) and its blank line, before `**The maintenance verbs.**`, insert this paragraph followed by one blank line:

```markdown
**Control plane (update-management W2).** The server now measures and records the fleet's update state; nothing
in it moves a node yet. `coord.db` (migration 14) holds a **release catalogue** — the repo's GitHub releases
listing, read every 30 minutes with `If-None-Match` and no token (owner and repo come from the installed tree's
`ccd/ccrc`, or from `CCRC_RELEASE_OWNER` and `CCRC_RELEASE_REPO` when both are set — a pair that is not two
plain names stops the poll rather than falling back); a release that vanishes from the listing is marked
yanked, never deleted — a **node inventory** re-measured every 60 seconds (each node's `~/.ccrc` stamp,
install record, `ccrc-caps`, floor, previous version, `node-id` and update report; every file lstat-gated,
capped at 64 KiB and validated; the fleet node's read through an exact-basename read set on the agent, never a
prefix of `~/.ccrc`), and one **desired-state intent** per scope (`*`, or a node id: channel, pin, auto,
notify), each write journalled to `~/.ccrc/update-intent.log` under a rising epoch. The catalogue and the
inventory keep their cadence when the fleet registry cannot be listed. After every inventory sweep the server
resolves each node's desired tag — the newest eligible release on its channel, never below the node's floor
(the higher of its recorded floor and the version it runs), pinned or not — and on a `server` or `both` box
writes its own projection, `~/.ccrc/update-intent` (whole, by rename; mode 0600; times in unix seconds). The
role is `CCRC_ROLE` from the environment; absent or invalid, it is derived from `CCRC_FLEET` and the boot log
says so. `GET /api/updates` (session-gated) reads all of it; `POST /api/updates/intent`, `/api/updates/refresh`
(once a minute) and `/api/updates/ack` are session-only — the box token never writes intent — and
`GET /api/updates/intent/:nodeId` serves a node its projection as plain text under a session or the box token.
`/api/fleet/health`'s `builds` is now a view of the inventory rows. Not yet: no apply or rollback route, no
fleet-side projection reader, no release notification, no settings screen — and an `auto` other than `off` is
refused (`409`) until every node the intent covers lists `update-gate` in its `ccrc-caps`.
```

Constraints this text was written to (re-check them if you reword it): no `file:line` anchor and no `:<digits>` token anywhere (`session-hook.test.ts`'s README citation corpus resolves every `REF_RE` match, `session-hook.test.ts:7073-7080` — the one colon here, `:nodeId`, carries no digit); none of the passage markers other suites slice README by (`box-token-census.test.ts:307-374`, `pools-prose.test.ts:161-443`, `crossrepo-prose.test.ts:42-286` — e.g. "What is gated, and what is not:", "**Caps and pause.**", "Pause is a"), because `passage()` takes the FIRST occurrence of its `from` marker and a copy here would move the slice; no hostname, org, account label or address (`topology-clean.test.ts`). And the facts it states are the producers', re-checked against their tasks: migration 14 = `MIGRATIONS[13]` (Task 3); `UPDATE_CATALOGUE_MS = 30 * 60_000`, `If-None-Match`, no token (Task 10); the env pair's `env-malformed` refusal (Task 9, D-3196); the seven `NODE_FILES` other than `projection` and `NODE_FILE_CAP_BYTES = 65536` (Tasks 8, 11); `defaultUpdateIntentLogPath` = `<ccrcDir>/update-intent.log` (Task 6); both update gates above `tick()`'s fail-shut return (ruling R8, D-3198); `floorOf` taking the higher tag (Task 12, D-3202); the projection written tmp-then-rename at mode `0600`, served `text/plain` (ruling R3); the derived role and its boot line (ruling R9); `UPDATE_GATE_CAP = 'update-gate'` checked over the intent's scope by `autoGateBlockers` (Task 12). Reword one of those and the claim must still match the task that ships it. Count the inserted block after pasting: 21 lines plus one blank — Step 3's figure depends on it.

- [ ] **Step 2: CLAUDE.md — one sentence in the Deploy bullet**

In `CLAUDE.md`, replace (`CLAUDE.md:114-115`)

```markdown
  `BuildLine`, and doctor's `skills` check (every home vs the shipped tree; `ccrc doctor --fix` cures it, D-3113). A
  server-role box converges nothing per account — no wrappers, dirs, hooks, skills or session files — and its doctor
```

with

```markdown
  `BuildLine`, and doctor's `skills` check (every home vs the shipped tree; `ccrc doctor --fix` cures it, D-3113).
  The control plane's per-node inventory — every node's measured stamp, install state, provenance, caps and
  resolved desired tag, re-measured every minute — is read at `GET /api/updates` (session-gated), and
  `/api/fleet/health`'s `builds` is a view of it. A
  server-role box converges nothing per account — no wrappers, dirs, hooks, skills or session files — and its doctor
```

No test slices the Deploy bullet (the CLAUDE.md passages are the box-token, account-pools and ledger bullets — `box-token-census.test.ts:411`, `pools-prose.test.ts:792`, `ledger-instruction.test.ts:91`), and the sentence names no roadmap state (CLAUDE.md's own rule: live build state is not tracked there).

- [ ] **Step 3: Re-measure the README size claim, in this commit**

```bash
wc -l < README.md
grep -o 'README.md` (~[0-9,]* lines)' CLAUDE.md
```
`pools-prose.test.ts:868-880` reds when CLAUDE.md's `~N lines` is more than 100 from README's real line count, and its own comment names the remedy — "re-measure it in this commit". README was 3279 at d759c914; Task 13's auth-paragraph edit is line-neutral (eight lines for eight), so only Step 1's 22 lines move it — expected `3301`, which leaves the old `~3200` at 101 lines off: RED. Set `CLAUDE.md:10`'s figure to the measurement rounded to the nearest hundred (the figure's existing precision): `echo $(( ($(wc -l < README.md) + 50) / 100 * 100 ))` — `3300` for anything from 3250 to 3349 (the expected case), and unchanged (`3200`) below 3250. A measurement other than 3301 means README moved elsewhere in this wave: name that in the wave-done. `oss-metadata.test.ts:89-100` checks the same claim at 10%, which the nearest hundred always satisfies. CLAUDE.md's line count does not change either way.

- [ ] **Step 4: The doc guards, then commit**

Run (foreground, one file at a time, timeout ≥ 600000 ms):

```bash
cd server
for t in pools-prose oss-metadata session-hook box-token-census coord-pause-route crossrepo-prose readme-holds readme-roster-mirror ledger-instruction coordinator-skill topology-clean; do
  ./node_modules/.bin/vitest run "test/$t.test.ts" || { echo "RED: $t"; break; }
done
```
Expected: all green. `session-hook` is a known load flake (CLAUDE.md) — a red there is re-run in isolation before it is read as the paragraph's fault; a real red from it names a README citation, and the remedy is to drop the `:<digits>` token from the new text, never to add a README anchor. `topology-clean`'s history-range scan needs `origin/main` resolvable — run `git fetch origin main` first if it reds on a null base.

```bash
git add README.md CLAUDE.md
git commit -m "docs(update): the control plane in the Releases section; CLAUDE.md names GET /api/updates as where the inventory is read"
```

- [ ] **Step 5: The plan carries minted numbers, not placeholders**

```bash
git fetch origin main
git grep -nE '«dev:[a-z0-9-]+»' -- docs/superpowers/plans/2026-09-22-centralised-update-w2-control-plane.md
git grep -nE 'D-TBD-[a-z0-9]' -- docs/ server/ shared/ agent/ ccd/ README.md CLAUDE.md
```
Expected: both greps print nothing. The first pattern needs a real slug between the guillemets, so it does not match this step's own command or the ellipsis form in its prose (a bare `'«dev:'` would, and could never print nothing once this task's text is in the plan); the second is `dtbd.test.ts`'s `PATTERN`, which its own `[` keeps from matching itself. If a «dev:…» placeholder remains, the coordinator has not minted that departure: STOP and put it to the coordinator as a structured ask (worker skill) naming the slug — never allocate or type a `D-` number here (`POST /api/ledger/deviations` issues numbers; a number written without being issued seals its band for good). A departure found DURING execution takes the next unspent number of run 128's reserve block, named in the wave brief, and is defined in `## Deviations found` in the same commit that first cites it; with the reserve spent it is reported to the coordinator, never committed as a concrete placeholder (`dtbd.test.ts` refuses it).

Then, from inside `server/`:

```bash
./node_modules/.bin/vitest run test/deviation-refs.test.ts
./node_modules/.bin/vitest run test/dtbd.test.ts
./node_modules/.bin/vitest run test/topology-clean.test.ts
```
Expected: PASS. `deviation-refs` compares this branch's plan entries against `origin/main`'s without merging (`crossTreeCollisions`, `deviation-refs.test.ts:316`) — a red names a number defined in two plans, which is the coordinator's to re-mint, not this task's to edit.

- [ ] **Step 6: Every suite, unsharded, as CI runs it**

CI's server leg installs `agent/` and `pwa/` modules too, because `typecheck-tests.test.ts` spawns their compilers (`.github/workflows/ci.yml:100-119`). A workspace that has only `server/node_modules` fails that one file, not skips it — so first:

```bash
test -d agent/node_modules || (cd agent && npm ci)
test -d pwa/node_modules || (cd pwa && npm ci)
```

Then, each in the FOREGROUND with the tool's maximum timeout (600000 ms), one command per call:

```bash
cd server && ./node_modules/.bin/vitest run
cd agent && ./node_modules/.bin/vitest run
cd pwa && ./node_modules/.bin/vitest run
```
Expected: all green. Put each summary line's file and case counts in the wave-done: a green that ran fewer cases than `main` is not the same green, and the reviewer compares the server counts against the latest `ci` run on `main` (`gh run list -b main -w ci --limit 1`, then `gh run view <id> --log | grep -E 'Test Files|Tests '`). The server suite takes about nine minutes on CI's quiet runner; if the unsharded run is killed or exceeds the tool ceiling on this box, run the SAME file set in four foreground batches and say so in the wave-done — CI's unsharded leg is then the arbiter:

```bash
cd server && ls test/*.test.ts | split -n r/4 - "$SCRATCH/w2-shard."
./node_modules/.bin/vitest run $(cat "$SCRATCH/w2-shard.aa")   # then .ab, .ac, .ad — one call each
```
(`$SCRATCH` is the session scratchpad directory.) A red in a known load flake (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) is re-run in isolation before it is called a break; a red anywhere else is this wave's until shown otherwise.

- [ ] **Step 7: The migration slot, re-measured right before the PR**

```bash
git fetch origin main
git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'
```
Expected: `13`. `MIGRATIONS[13]` is a cross-branch namespace (Global Constraints) and PR #40 is open with a migration of its own. Any count other than `13` (Task 3's Step 5 rule — `14` is the likely one) means another branch took slot 14 first: do NOT open the PR. Merge `origin/main`, renumber this wave's entry to the next slot — everything Task 3 wrote with the slot in it: the banner, the closing paragraph, the THREE literal pins (`coord-db.test.ts`'s two sites, `:660-666` and `:721` at d759c914, and `asks-store.test.ts:25`, each with its attribution comment naming `MIGRATIONS[13]`), the `migration 14` describe's title and its plant-at (`MIGRATIONS[0..12]` + `PRAGMA user_version = 13`); then the prose that names the slot — Task 7's `update-writer-groups.test.ts` message "the writer groups and MIGRATIONS[13] disagree", README's "`coord.db` (migration 14)" from Step 1, and Step 8's PR-body line — and re-run `coord-db`, `asks-store`, `update-writer-groups` and the Task 4–6 store suites (`update-store-catalogue`, `update-store-nodes`, `update-store-intent`). Report the renumbering to the coordinator as a finding.

- [ ] **Step 8: Push and open the PR**

Check the commit identity before the push (the pre-push hook refuses identity residue, and a workspace can carry a placeholder identity):

```bash
git log --format='%an <%ae>' origin/main..HEAD | sort -u
git config user.name; git config user.email
```
Expected: one author line, equal to the configured identity, and that identity the operator's intended one. If it is not, STOP and ask — rewriting authorship is not this task's call.

```bash
git push
REPO_URL="$(gh repo view --json url --jq .url)"
PLAN=docs/superpowers/plans/2026-09-22-centralised-update-w2-control-plane.md
SPEC=docs/superpowers/specs/2026-09-20-centralised-update-management-design.md
{
  echo "W2 of the centralised update management design: the control plane, read-only. Nothing in this PR moves a node."
  echo
  echo "- Spec: $REPO_URL/blob/main/$SPEC (sections 6-9, 12, 14; the W2 row of section 15)"
  echo "- Plan: $REPO_URL/blob/main/$PLAN"
  echo
  echo "Delivers: MIGRATIONS[13] (five tables, two seed rows) and the CoordStore writer groups, each pinned by a scan over store.ts; the catalogue poller; the per-minute inventory sweep with the agent's exact-basename read set; the pure resolver and the server-role projection writer; GET /api/updates, POST /api/updates/{intent,refresh,ack} (session-only) and GET /api/updates/intent/:nodeId (session or box token), censused by all three route scanners; FleetHealth.builds derived from the inventory."
  echo
  echo "Deviations defined in the plan:"
  grep -oE '^- \*\*D-[0-9]+\*\*[^.]*' "$PLAN" | sed 's/^- //'
  echo
  echo "Out of scope (later waves): notifications and the settings screen (W3), the fleet-side projection reader (W4), the apply and rollback routes (wave 5, which appends them to the four W2 session doors)."
  echo
  echo "Test plan: server, agent and pwa suites green locally (counts in the wave-done report); CI is the arbiter."
} > "$SCRATCH/w2-pr-body.md"
```
Append the session's attribution line (from the system reminder) as the body's last line, then:

```bash
gh pr create --base main \
  --title "update: the control plane — catalogue, inventory, intent, resolution, the server's own projection; no node moves (W2)" \
  --body-file "$SCRATCH/w2-pr-body.md"
```
The PR body carries `blob/main` links only — never a docserver link (it is tailnet-only and dies with the worktree).

- [ ] **Step 9: CI, then the wave-done**

```bash
PR="$(gh pr view --json number --jq .number)"
gh pr checks "$PR" --watch --fail-fast
```
Run it in the foreground and re-issue it until it returns: exit `0` is all green, `1` a failure (read the failing leg's log first — `gh run view --log-failed`), `8` still pending (an answer, not an error). Never end the turn to wait for CI; a session that does is not woken by the result. The macOS leg runs the server suite again and can take up to half an hour — re-issue the watch; do not merge around it.

When green, report the wave-done per the `ccrc-worker` skill: the measured fingerprint (`git rev-parse HEAD` equal to `git ls-remote origin "refs/heads/$(git branch --show-current)"`), the PR number, the suite counts from Step 6, and the FIXTURE proofs that stand in for the live exit criterion, by test file:
- `fleet-build-skew.test.ts` "the fleet host's stamp reaches `builds` through the INVENTORY" — a real agent's `build.json` through the exact-basename read set, `sweepInventory`, a real `coord.db` row with `stampRead = 'ok'`, the route (the live criterion's "`stampRead = ok` on the fleet row");
- `update-catalogue.test.ts` (Task 10) — "a second poll sends If-None-Match, and a 304 writes no rows but is an answer" and "an answer after an error clears lastError" move `lastOkAt` against the loopback fixture; "a 403 is rate-limited: every prior row intact, lastOkAt unchanged" and its sibling error arms leave it (the live "non-null `catalogue.lastOkAt`");
- `update-resolve.test.ts` — a `desiredTag` or one of the resolve-detail sentences for every input (the live "a `desiredTag`, or the at-floor sentence, per node" — D-3205);
- `update-projection.test.ts` (Task 12) — the rendered document passes the embedded python `VALIDATOR`, in seconds, and "a ms issuedAt is refused, never rendered" (the live "the projection parses");
- `update-routes.test.ts` (Task 13) — "writes the intent, bumps the epoch, journals it, and re-resolves AND re-projects in the same request" and "POST /api/updates/intent with the box token alone is the gate's 401 — the box token never writes intent" (the live "switching channel with a session"); "answers the §9 document, resolved live, in SECONDS, with both desireds", "the projection read: the box token alone suffices, and so does a session" and "the projection read: 401 with neither credential — before revealing whether the node exists" (the live projection read, ruling R3).

The worker does not merge: `main`'s ruleset wants an approval nobody can give, so the operator merges with `--admin`.

- [ ] **Step 10: Before merge (the coordinator) — the slot again**

Immediately before the merge, re-run Step 7's two commands. `13` → merge. Anything else → send the PR back with the renumbering instruction in Step 7; never merge a second `14`.

- [ ] **Step 11: The live exit criterion (the coordinator, after rollout)**

The merge cuts a PRERELEASE (the `dev` channel), so a bare `rollout` would not reach it. Take the tag the release
lane put on the MERGE commit — not "the newest release", which is another PR's if anything merged after:

```bash
PR=<the W2 PR number>
git fetch origin main --tags
MERGE="$(gh pr view "$PR" --json mergeCommit --jq .mergeCommit.oid)"
W2_TAG="$(git tag --points-at "$MERGE" | grep -Ex 'v[0-9]+\.[0-9]+\.[0-9]+')"; echo "$W2_TAG"
gh release view "$W2_TAG" --json isPrerelease --jq .isPrerelease     # true: the dev channel
ccrc rollout --check
ccrc rollout --to "$W2_TAG"     # fleet box first (the default): the agent must admit the basenames before the server reads them
```
Expected: exactly one tag; both boxes on `W2_TAG`, exit `0` (or `3` with the doctor's FAIL lines read — the box is on the build).

Then on the server box, in the operator's own shell — the `ccrc_session` cookie value comes from a signed-in browser and is typed, never echoed, logged or pasted into a transcript (`curl` sends no `Origin`, which the gate treats as "no browser" — `gate.ts`'s `OriginVerdict` `'absent'` state and the paragraph above it; no line anchor, because Task 13 inserts lines into `gate.ts`):

```bash
ssh -t <server box>
read -rs CCRC_SESSION
curl -fsS -b "ccrc_session=$CCRC_SESSION" http://127.0.0.1:7788/api/updates \
  | jq '{catalogue, releases: (.releases | length),
         nodes: [.nodes[] | {nodeId, label, role, stampRead, installState, provenance, version: .current.version,
                             desiredTag, resolveDetail, update: .update.state}]}'
```
Expected: `catalogue.lastOkAt` non-null and `lastError` null (the first tick after the restart polls at once); `releases` ≥ 1; exactly two nodes — `server` (role `server`) and `fleet` (role `fleet`) — the fleet node with `stampRead: "ok"` and `version` equal to `W2_TAG`; each node with EITHER a non-null `desiredTag` (a strictly newer eligible release exists on its channel) OR `desiredTag: null` with `resolveDetail` the at-floor sentence — it begins `newest eligible ` and contains ` is not newer than this node's floor ` — which is what a node converged on `W2_TAG` answers, and on the default `stable` channel the only answer it can give, since `W2_TAG` is a prerelease above every stable release (spec §15 says "a `desiredTag` per node"; this reading is D-3205); `null` in both fields, or any other sentence (below-floor, no floor, a pinned-tag refusal), fails the criterion; each `nodeId` a lowercase UUID (ruling R3 — `NODE_ID_RE`, Task 5), never the label, because `ccrc update` mints `~/.ccrc/node-id` on both boxes; both `update` `idle`. Two nodes, never three: a label-keyed row is re-keyed in place when its `node-id` is first measured, and a label row that finds a UUID row already present is superseded and excluded.

The server's own projection. The file first — its mode and whole-file rename (ruling R3):

```bash
stat -c '%a' ~/.ccrc/update-intent
ls -a ~/.ccrc | grep -c '^\.update-intent\..*\.tmp$'
```
Expected: `600`, and `0` (no temp file left beside it). Then its grammar — this is Task 12's embedded `VALIDATOR` (`update-projection.test.ts`), transcribed with only its input (stdin → the file) and its failure path (`raise ValueError` → `sys.exit`, the ok line → a summary) changed: whole-document pass, fixed key order, `end` terminator, refused AT the 65536-byte cap, unix seconds near now, `lease = issued + 900`, `desired` equal to the `desired-<channel>` line:

```bash
python3 - ~/.ccrc/update-intent <<'PY'
import re, sys, time
NUM = r"(?:0|[1-9][0-9]*)"
TAG = r"v[0-9]+\.[0-9]+\.[0-9]+"
GRAMMAR = [
    ("epoch", re.compile(r"epoch (%s)" % NUM)),
    ("issued", re.compile(r"issued (%s)" % NUM)),
    ("lease", re.compile(r"lease (%s)" % NUM)),
    ("channel", re.compile(r"channel (stable|dev)")),
    ("desired", re.compile(r"desired (%s|none)" % TAG)),
    ("desired-stable", re.compile(r"desired-stable (%s|none)" % TAG)),
    ("desired-dev", re.compile(r"desired-dev (%s|none)" % TAG)),
    ("auto", re.compile(r"auto (off|stable|channel)")),
]
raw = open(sys.argv[1], "rb").read()
if len(raw) >= 65536:
    sys.exit("document is %d bytes, at or over the 65536-byte cap" % len(raw))
doc = raw.decode("utf-8")
if not doc.endswith("\n"):
    sys.exit("document does not end in a newline")
lines = doc[:-1].split("\n")
if lines[-1] != "end":
    sys.exit("last line is not exactly end")
body = lines[:-1]
if len(body) != len(GRAMMAR):
    sys.exit("expected %d lines before end, got %d" % (len(GRAMMAR), len(body)))
v = {}
for (name, rx), ln in zip(GRAMMAR, body):
    m = rx.fullmatch(ln)
    if not m:
        sys.exit("off-grammar line for %s: %r" % (name, ln[:200]))
    v[name] = m.group(1)
issued, lease = int(v["issued"]), int(v["lease"])
if lease - issued != 900:
    sys.exit("lease is not issued + 900 s")
if abs(issued - int(time.time())) > 86400:
    sys.exit("issued %d is not unix seconds near now" % issued)
want = v["desired-stable"] if v["channel"] == "stable" else v["desired-dev"]
if v["desired"] != want:
    sys.exit("desired disagrees with desired-%s" % v["channel"])
print("projection ok: epoch", v["epoch"], "channel", v["channel"], "desired", v["desired"])
PY
```
Expected: `projection ok: …`. If this copy and `update-projection.test.ts`'s `VALIDATOR` ever disagree about a document, the test's validator is the pinned one; fix this copy, and say so.

Switching channel with a session, and the epoch moving — away from whatever channel the fleet row holds now, then back to it:

```bash
C0="$(awk '$1=="channel"{print $2}' ~/.ccrc/update-intent)"; C1="$([ "$C0" = stable ] && echo dev || echo stable)"
E0="$(awk '$1=="epoch"{print $2}' ~/.ccrc/update-intent)"
curl -fsS -b "ccrc_session=$CCRC_SESSION" -H 'content-type: application/json' \
  -d "{\"scope\":\"*\",\"channel\":\"$C1\"}" http://127.0.0.1:7788/api/updates/intent | jq '{ok, epoch, channel: .intent.channel}'
E1="$(awk '$1=="epoch"{print $2}' ~/.ccrc/update-intent)"; echo "$E0 -> $E1"
awk '$1=="channel"' ~/.ccrc/update-intent
curl -fsS -b "ccrc_session=$CCRC_SESSION" -H 'content-type: application/json' \
  -d "{\"scope\":\"*\",\"channel\":\"$C0\"}" http://127.0.0.1:7788/api/updates/intent | jq '{ok, epoch, channel: .intent.channel}'
```
Expected: `ok: true`, `channel` = `$C1`, `E1 > E0` (the route re-resolves and re-projects in the same request, so the file has moved before the answer), the projection's `channel $C1`; then the restore answers `channel` = `$C0` with a higher epoch still. Nothing moves either node — W2 ships no dispatcher, and both nodes' `update.state` stay `idle` in a second `GET /api/updates`. Last, the projection read under the box token alone, the credential a W4 node will use (existence of the token file only — its contents are never printed):

```bash
ls -l ~/.ccrc/mail.token
NODE="$(curl -fsS -b "ccrc_session=$CCRC_SESSION" http://127.0.0.1:7788/api/updates | jq -r '.nodes[] | select(.label=="fleet") | .nodeId')"
printf '%s\n' "$NODE" | grep -Ex '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' -H "x-ccrc-mail-token: $(cat ~/.ccrc/mail.token)" "http://127.0.0.1:7788/api/updates/intent/$NODE"
curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:7788/api/updates/intent/$NODE"
unset CCRC_SESSION
```
Expected: the node id printed back (a lowercase UUID); `200 text/plain; charset=utf-8` with the token (ruling R3); `401` with neither credential — on this box, which runs with `CCRC_AUTH` armed; an unarmed box answers that second read `200`, and that is not this criterion. That set is spec §15's W2 exit criterion measured on the live fleet; record the outcome in the programme's memory file (`centralised-update-management-programme`: W2 SHIPPED, the tag, the deviations) — W3 (settings and notification) is next.

