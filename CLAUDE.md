# ccrc

The operating console for SDD (spec-driven development) at **fleet scale**: a mobile-first PWA that views and
drives a fleet of Claude Code sessions (`--remote-control` or not — per box, `~/.ccrc/remote-control`)
and **follows a session across account/wrapper swaps**
(the thing claude.ai's own app can't do). Weigh every feature by the loop it serves:
spec → plan → subagent execution with per-PR review lenses + whole-branch pass → coordinated multi-wave programs.

**`README.md` (1804 lines) is the canonical system overview. This file is only the non-obvious operational rules
— read the README for anything below in depth.** Deep design lives in `docs/superpowers/specs/` (esp.
`2026-08-10-architecture-ddd-clean-solid.md`, `2026-08-07-build7-fleet-coordination-design.md`).

## Two-box topology (the single most load-bearing fact)
Two physical boxes; the live server runs `CCRC_FLEET=remote` as standing config. This section speaks ROLES —
real values: `deploy/reference-fleet.md` (gitignored).
- **BOX 1 — the server box (`<server-host>`):** `you@<server-host>`, HTTP :7788 bound to loopback. Runs the
  Fastify server (`server/`), serves the PWA at `/`, owns `~/.ccrc/coord.db` and `~/.ccrc/state-cache.json`.
  **HTTPS is Caddy + DuckDNS (stage 3b), publicly reachable** — `ccrc expose [duckdns|byo|ip]` regenerates
  `~/.ccrc/Caddyfile` (REGENERATE class; nothing in this tree reads it back, Caddy does), installs the
  `ccrc-ddns` service/timer for the duckdns arm, and writes `$CCRC_EXPOSURE_FILE` (0600) as the server unit's
  **second** `EnvironmentFile`; Caddy's automatic HTTPS gets the cert (spec D1, HTTP-01) and the operator runs
  the three printed root steps. **Arming is all three or nothing:** `CCRC_AUTH=on` + `CCRC_RP_ID` +
  `CCRC_ORIGIN` land in that file together, or every non-exempt write and every `/ws/*` upgrade is refused with
  **no boot warning**.
- **BOX 2 — the fleet box (`<fleet-host>`):** runs `ccrc-agent` (`agent/`), `ccd`, tmux, and the flat-file
  registries `~/.cc-sessions/`, `~/.cc-limits/`, `.prhistory`, `.cc-clips`. The five wrapper HOMEs live here.
  **~20 live sessions** run here at any time (20 tmux sessions = 20 active `claude-session@*` units,
  2026-08-22) — the figure drifts upward; measure it, don't quote it.
- **Link:** ONE authenticated WebSocket (bearer token, agent :7789). The server **never SSHes the fleet box at
  runtime** — it drives the fleet only through whitelisted agent frames. `local` mode (default, dev) shells out
  to ccd/tmux on the server's own box and never touches the agent.
- **Tailscale is NOT part of the machinery.** No shipped code invokes the `tailscale` binary — every hit in
  `server/src`, `ccd/`, `deploy/` is a **comment** naming `tailscale serve` as one *example* of a TLS-terminating
  proxy ("`tailscale serve` and Caddy alike"), and no doctor check requires it. Never add a tailnet dependency,
  and never read a live `tailscale serve` mapping on a box as the product's path — those are operator plumbing
  this tree does not know about. The one place a tailnet is still load-bearing is **outside ccrc**: the
  docs-preview convention in the operator's global `CLAUDE.md` serves `/docs` over the tailnet only, from a
  docserver that is not in this repo and not behind ccrc's auth.

## SAFETY — sacred, never violate
- **NEVER run destructive `ccd` verbs against the live host:** `ws-rm`, `ws-reap`, `ws-gc --prune`,
  `ws-archive`/`ws-restore`. `ws-rm`, `ws-reap`, `ws-gc --prune` delete workspaces/branches/clips;
  `ws-archive`/`ws-restore` delete nothing but cost the tmux pane — scrollback and any in-flight turn
  (`ccd/ccd:2643`). All five forbidden; `ws-reap` is **human-only by contract**.
- **NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly.** Each unit is a
  long-lived `ccd supervise`; killing/overwriting one out of band breaks the live fleet. ONE scoped exception
  (operator ruling 2026-08-21, R1): `ccrc update`'s step-4 supervisor sweep (`_upd_sweep`) and deploy.sh's
  existing sweep may `try-restart` `claude-session@*` units — each ONLY behind its mandatory `KillMode=process`
  preflight (which refuses the sweep when the answer is anything else); panes/tmux stay untouched, and every
  other actor remains forbidden.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** `HOME` is the single isolation
  boundary the whole ccd suite relies on. Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`);
  cleanup in `tmpHelpers.ts`. Second boundary: `ghContainedEnv()` plants a poisoned `gh` on PATH so a stray real
  `gh` (which carries a `gho_` repo-WRITE token) can't fire — containment is per-test, not structural.
- **NEVER print secret file CONTENTS.** The box/mail token is one shared secret per box
  (`~/.cc-secrets/ccrc-mail.token` on fleet host, `~/.ccrc/mail.token` on server), from one gitignored
  `deploy/ccrc-mail.token`. Existence checks by `ls` only. The committed `.example` placeholder is refused at boot
  (`MailTokenPlaceholderUnedited`) — this repo is **bound for public release**, the flip gated on operator go
  (Stage 5 S3): treat it as public.
- **`gh` has NO exec-whitelist entry, deliberately** — the host `gh` token has `repo` WRITE scope and there's no
  cwd sandbox, so one grant is the sole gate between the PWA and `gh pr merge`. Never add one. (See `agent/CLAUDE.md`.)
- **Identity on the fleet is attribution, not authentication:** single UNIX user, ccd has no caller auth. The
  exec whitelist guards ONLY the PWA→server→agent path; the HTTP chokepoint (caps + pause files) is a **contract
  the coordinator skill honors, not an OS wall**. Don't assume server-side checks stop a session acting directly.

## Build / test / deploy
**No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in:
`server/` `agent/` `pwa/` `shared/` (`shared/` is not a real package — its bare `"type":"module"` marker is
load-bearing: without it tsc emits CommonJS into `dist/shared/` and the server dies on startup).

    cd server && npm ci && npm run test    # vitest run — hermetic
    cd agent  && npm ci && npm run test
    cd pwa    && npm ci && npm run test
- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare
  `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Run suites in the FOREGROUND, timeout ≥600000ms.** Backgrounding hides a hang; the suites are load-sensitive.
- **Known load flakes** (real suites — re-run IN ISOLATION before calling a real break): `ccd-ws-gc`,
  `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`. CI on the quiet box is the arbiter; a flake
  CI passes is a flake. `ccd-session-state`'s window is `the supervisor heartbeat > a swap re-stamps while it
  carries` (`expected ['mid-carry:orphan'] to include 'mid-carry:restarting'`) — measured 2026-08-16 at 2/4 full
  runs and 1/3 under concurrent load, but **0/6 on an idle box**, so isolation alone can clear it and a single
  green isolated run is not proof it was the load.
- **Node floor `>=22.13.0`, identical across the three engines**, pinned by `server/test/node-floor.test.ts`
  (server-only). Reason: `server/src/coord/db.ts` imports `node:sqlite` unconditionally; below 22.13 the server
  fails to boot, not degrades. If node-floor's absolute assertion (3) is red while (1–2) are green, **RAISE
  engines — never lower them to make it green.**
- **Deploy** (mechanics in README "Deploy"): `bash deploy/deploy.sh` (server), `bash deploy/deploy.sh agent <host>`.
  **Coordinates live in `~/.ccrc/deploy.env`** — machine-local, outside every checkout
  (`CCRC_BOX`, `CCRC_SSH_KEY`, `CCRC_SSH_PORT`, and `CCRC_SW_DENYLIST` for a box with co-tenants; this
  fleet's real values: `deploy/reference-fleet.md`, gitignored). deploy.sh has
  **no default target** and refuses with exit 2 rather than guessing; env vars override the file and
  `CCRC_DEPLOY_ENV` points at another. Pinned by `server/test/deploy-coordinates.test.ts` (5/5 red without the
  guard). The roster seed defaults to `deploy/accounts.default.json`, never the reference fleet's roster.
  The one rule that shapes your own work: a change touching `ccd/`, `session-hook.sh`, or `ccd/coordinator-skill/`
  is **AGENT-FIRST** — it ships to the fleet host before the server (the server reads what the hook writes; the
  agent caches `ccd caps` at boot). Executables land via `install_atomic`; the server lane's final gate is
  `/health` reporting the shipped sha.

## Conventions that shape every change
- **Rings / bounded contexts** (`docs/…-architecture-ddd-clean-solid.md`): ring membership is a property of a
  file's IMPORTS, not its path — check a file by reading its import block. L0 `shared/*.ts` imports NOTHING (not
  even `node:*`) — the reason is that the PWA bundles those files, so deploy-side `shared/*.mjs`, which it never
  imports, may use `node:*` (`shared/mark.mjs:30`); L1 policy = pure decisions, no `fs`/fastify/`reply`; L2 ports
  = interfaces + failure contracts, declared BY THE CONSUMER; L3 adapters — **an adapter may not narrow a
  distinction it received** (highest-yield rule); L4 delivery owns fastify/sockets/timers but is NOT allowed to
  DECIDE; L5 = `index.ts` only. No account-name list in ANY shipped source file. **No overloaded null at a seam** — two conditions a caller handles differently must not
  collapse to the same value; that's a defect, not style.
- **Single-source-of-truth values are enumerated once and derived:** runtime lists come from the type
  (`PR_REASONS = Object.keys(PR_REASON_MAP)`), not hand-maintained. `server/test/single-definition.test.ts`
  text-scans four roots and fails the build on a 2nd copy. **The account roster is runtime DATA** since Stage 2a
  (`b1f54fe`): `~/.ccrc/accounts.json`, parsed by `shared/roster.ts`'s `parseRoster`, carried on
  `CcrcConfig.roster`, shipped as `RosterWire[]`, generated into `~/.ccrc/accounts.sh` for `ccd`. Adding an
  account is a JSON edit plus an agent deploy — NOT eight hand-kept enumerations, which `single-definition` now
  forbids outright (`expect(holders).toEqual([])`). `shared/api.ts` has no `ACCOUNTS`; `Wrapper = string`.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated
  (measured before/after, not a comment). Doctrine: "A comment is a request; a red suite is a mechanism." TDD
  red-first.
- **Deviation ledger (D-N):** plans carry a `## Deviations found` section of numbered `D-N` entries (global,
  monotonic across project history — not reset per plan; a build-scoped `D-B4-N` series runs alongside).
  **Allocate the next number by grepping `origin/main` across BOTH `docs/` and source** — source runs ahead of
  the plans' ledgers, so a number taken from a plan alone collides with shipped refs (it has, twice). Source
  files carry `D-N` refs in comments; **read them
  as authoritative history, don't delete them.** Anchors in plans are snapshots — trust shipped source's own
  comments over a plan document.
- **Wire discipline — additive-only, absence-permits:** frames are ADDITIVE; do NOT bump `FLEET_PROTO`
  (=1, `FLEET_PROTO_MIN`=1, defined once in `shared/api.ts`) for a new field. A newer peer must tolerate an older
  peer omitting a field, through a SINGLE reader per field. Reading a persisted `FleetSession[]` from an older
  build goes through `reviveFleetSession` (returns a literal, so a new field is a compile error until every path
  computes it). `FLEET_PROTO_MIN` is a dormant kill-switch.

## Coordination (Build 7) invariants a coder must NOT break
- `~/.ccrc/coord.db`: `node:sqlite` `DatabaseSync`, WAL, `user_version` migrations that **refuse to start rather
  than open empty**. Its synchrony is a stated concurrency invariant — **do not wrap it async** (a repository/async
  interface over `CoordStore` is explicitly rejected). It is a server-side RE-MEASUREMENT of ccd's flat files
  (registry, hold, `.prhistory`), which stay ground truth; a lost coord.db reconstructs from them.
- **Zero new ccd verbs for coordination mutation** — mutations ride already-granted `CcdArgv` (a brand built at
  the call site, never table-looked-up). Exec surface is closed: `EXEC_COMMANDS = ['tmux','ccd']`.
- **Box token gates every coordination WRITE** (`/api/mail*`, `/api/runs*`) — header `x-ccrc-mail-token`, `401`
  on missing — **except TWO deliberately ungated operator doors: `POST /api/coord/pause` and `POST
  /api/runs/:id/abandon`** (D-B4-9: the coordinator holds the box token, so gating a wedged run's release valve
  behind that key leaves the wedge no door). `coord-pause-route.test.ts`'s `UNGATED` set pins the pair in both
  directions, and with `CCRC_AUTH` armed both still sit behind the session gate. Don't assume — read the guards.
- **Mail delivery is idle-gated, reference-based, never awaited:** what lands in a session is a one-line nudge;
  the body lives in the durable store, fetched over `GET /api/mail/:id`. On mail rows use the DELIVERY id for
  `:id` in ack/fetch — **never the mail row's own id** (two separate autoincrement sequences).
- **Done-fingerprint re-measures the WORKSPACE BRANCH** (`handoffCommit === branchTip`). A worker commits on its
  workspace branch, **never a separate feature branch** (a feature branch wedges every close with `stale-tip`).
  Re-measurement reads git ref files + `.prhistory` fresh, never the claim body.
- **One run row per wave; wave N+1 is a NEW `POST /api/runs`, not a reopen. Open wave N+1's run BEFORE closing
  wave N's** — close-first leaves zero open runs and the server retires the program, breaking
  `toId:'coordinator'` mail that carries NO `runId`. Mail naming a `runId` still resolves
  (`resolveCoordinator(runId)` reads that run's `claimedBy`, no program-state predicate) — which is the
  documented recovery for an already-retired program.
- The coordinator is an ordinary fleet session running the `ccrc-coordinator` skill
  (`ccd/coordinator-skill/SKILL.md`); its nine clauses are pinned VERBATIM by
  `server/test/coordinator-skill.test.ts` — a softened clause is a red suite. Pause kill-switches are FILES
  (`$REG/coordinator-paused`, `$REG/mail-disabled`). `mail-disabled` has **no writer in the tree** — touch/rm by
  hand only. `coordinator-paused` does: Build 4's whitelisted `ccd coord-pause --state on|off`, driven by
  `POST /api/coord/pause`, both raises and lowers it, so it is reachable from a phone — `routes.ts` calls the
  boundary what it now is, "convention with a speed bump".
- **The worker has a skill too** (`ccd/worker-skill/SKILL.md`, `ccrc-worker`, ten clauses pinned by
  `server/test/worker-skill.test.ts`; it ships no `references/` and points at the coordinator's).
  `WORKER_KICKOFF_PREFIX` (`server/src/coord/dispatch.ts`) prefixes EVERY brief mail with the sentence that
  invokes it, so a wave brief carries WAVE SPECIFICS — plan path, task range, interfaces, deviations — never the
  standing protocol. The one exception is deliberate: the branch-discipline sentence is said in both, because a
  skill reaches a home only once its installer has run there.

## Open on `main` — do NOT assume these are fixed
`MailDeliveryState` terminality is incomplete (some writers lack the guard); `FleetIO.readFile`'s docstring now
ADMITS the collapse instead of denying it, and `readFileMeasured` (`MeasuredRead`/`ReadFailure`,
`server/src/io.ts`) ships a result-returning read that tells absent from unreadable — but the collapse
isn't gone from the tree: `readFile`, `readFileB64` and `readFileFrom` still fold every failure to one `null`
(the agent's half of `readFileB64` folds in a THIRD condition, an over-cap file — `localIO`'s has no cap), and the agent's `stat` op answers EACCES
as `{missing: true}`, so that wire's own absent-marker already lies for non-ENOENT failures (D-114,
`docs/superpowers/plans/2026-08-20-fleetio-measured-read.md`). **Live build/roadmap state is NOT tracked here** — it lives in the orchestrator
task list and `docs/superpowers/plans/`, so this file never goes stale on it.
