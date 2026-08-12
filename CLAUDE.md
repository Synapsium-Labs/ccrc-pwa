# ccrc

The operating console for SDD (spec-driven development) at **fleet scale**: a mobile-first PWA that views and
drives a fleet of `--remote-control` Claude Code sessions and **follows a session across account/wrapper swaps**
(the thing claude.ai's own app can't do). Weigh every feature by the loop it serves:
spec → plan → subagent execution with per-PR review lenses + whole-branch pass → coordinated multi-wave programs.

**`README.md` (817 lines) is the canonical system overview. This file is only the non-obvious operational rules
— read the README for anything below in depth.** Deep design lives in `docs/superpowers/specs/` (esp.
`2026-08-10-architecture-ddd-clean-solid.md`, `2026-08-07-build7-fleet-coordination-design.md`).

## Two-box topology (the single most load-bearing fact)
Two physical boxes; the live server runs `CCRC_FLEET=remote` as standing config.
- **BOX 1 — `server-box` (server host):** `you@203.0.113.7`, HTTP :7788. Runs the Fastify server
  (`server/`), serves the PWA at `/`, owns `~/.ccrc/coord.db` and `~/.ccrc/state-cache.json`. HTTPS via
  `tailscale serve` :8443 (tailnet only).
- **BOX 2 — fleet host:** runs `ccrc-agent` (`agent/`), `ccd`, tmux, and the flat-file registries
  `~/.cc-sessions/`, `~/.cc-limits/`, `.prhistory`, `.cc-clips`. The five wrapper HOMEs live here. ~11 live
  sessions run here at any time.
- **Link:** ONE authenticated WebSocket (bearer token, agent :7789). The server **never SSHes the fleet box at
  runtime** — it drives the fleet only through whitelisted agent frames. `local` mode (default, dev) shells out
  to ccd/tmux on the server's own box and never touches the agent.

## SAFETY — sacred, never violate
- **NEVER run destructive `ccd` verbs against the live host:** `ws-rm`, `ws-reap`, `ws-gc --prune`,
  `ws-archive`/`ws-restore`. They delete workspaces/branches/clips. `ws-reap` is **human-only by contract**.
- **NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly.** Each unit is a
  long-lived `ccd supervise`; killing/overwriting one out of band breaks the live fleet.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** `HOME` is the single isolation
  boundary the whole ccd suite relies on. Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`);
  cleanup in `tmpHelpers.ts`. Second boundary: `ghContainedEnv()` plants a poisoned `gh` on PATH so a stray real
  `gh` (which carries a `gho_` repo-WRITE token) can't fire — containment is per-test, not structural.
- **NEVER print secret file CONTENTS.** The box/mail token is one shared secret per box
  (`~/.cc-secrets/ccrc-mail.token` on fleet host, `~/.ccrc/mail.token` on server), from one gitignored
  `deploy/ccrc-mail.token`. Existence checks by `ls` only. The committed `.example` placeholder is refused at boot
  (`MailTokenPlaceholderUnedited`) — this repo is PUBLIC.
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
  `pr-sweep`, `session-hook`, `typecheck-tests`. CI on the quiet box is the arbiter; a flake CI passes is a flake.
- **Node floor `>=22.13.0`, identical across the three engines**, pinned by `server/test/node-floor.test.ts`
  (server-only). Reason: `server/src/coord/db.ts` imports `node:sqlite` unconditionally; below 22.13 the server
  fails to boot, not degrades. If node-floor's absolute assertion (3) is red while (1–2) are green, **RAISE
  engines — never lower them to make it green.**
- **Deploy** (mechanics in README "Deploy"): `bash deploy/deploy.sh` (server), `bash deploy/deploy.sh agent <host>`.
  The one rule that shapes your own work: a change touching `ccd/`, `session-hook.sh`, or `ccd/coordinator-skill/`
  is **AGENT-FIRST** — it ships to the fleet host before the server (the server reads what the hook writes; the
  agent caches `ccd caps` at boot). Executables land via `install_atomic`; the server lane's final gate is
  `/health` reporting the shipped sha.

## Conventions that shape every change
- **Rings / bounded contexts** (`docs/…-architecture-ddd-clean-solid.md`): ring membership is a property of a
  file's IMPORTS, not its path — check a file by reading its import block. L0 `shared/` imports NOTHING (not even
  `node:*`); L1 policy = pure decisions, no `fs`/fastify/`reply`; L2 ports = interfaces + failure contracts,
  declared BY THE CONSUMER; L3 adapters — **an adapter may not narrow a distinction it received** (highest-yield
  rule); L4 delivery owns fastify/sockets/timers but is NOT allowed to DECIDE; L5 = `index.ts` only. No account-name
  list outside L0's roster. **No overloaded null at a seam** — two conditions a caller handles differently must not
  collapse to the same value; that's a defect, not style.
- **Single-source-of-truth values are enumerated once and derived:** runtime lists come from the type
  (`PR_REASONS = Object.keys(PR_REASON_MAP)`), not hand-maintained. `server/test/single-definition.test.ts`
  text-scans four roots and fails the build on a 2nd copy. The account roster lives once in `shared/api.ts`
  `ACCOUNTS`. **Adding an account still means touching ~8 enumerations across 3 languages** until the roster
  increment lands (a missing entry silently killed chat for 6 of 24 sessions) — verify with `single-definition`.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated
  (measured before/after, not a comment). Doctrine: "A comment is a request; a red suite is a mechanism." TDD
  red-first.
- **Deviation ledger (D-N):** plans carry a `## Deviations found` section of numbered `D-N` entries (global,
  monotonic across project history — not reset per plan). Source files carry `D-N` refs in comments; **read them
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
  on missing. (A pause/kill-switch route is deliberately left ungated where the token would let a coordinator
  unpause itself — check the actual route guards in `server/src/coord/routes.ts`, don't assume.)
- **Mail delivery is idle-gated, reference-based, never awaited:** what lands in a session is a one-line nudge;
  the body lives in the durable store, fetched over `GET /api/mail/:id`. On mail rows use the DELIVERY id for
  `:id` in ack/fetch — **never the mail row's own id** (two separate autoincrement sequences).
- **Done-fingerprint re-measures the WORKSPACE BRANCH** (`handoffCommit === branchTip`). A worker commits on its
  workspace branch, **never a separate feature branch** (a feature branch wedges every close with `stale-tip`).
  Re-measurement reads git ref files + `.prhistory` fresh, never the claim body.
- **One run row per wave; wave N+1 is a NEW `POST /api/runs`, not a reopen. Open wave N+1's run BEFORE closing
  wave N's** — close-first leaves zero open runs and the server retires the program, breaking every
  `toId:'coordinator'` mail.
- The coordinator is an ordinary fleet session running the `ccrc-coordinator` skill
  (`ccd/coordinator-skill/SKILL.md`); its nine clauses are pinned VERBATIM by
  `server/test/coordinator-skill.test.ts` — a softened clause is a red suite. Pause kill-switches are FILES
  (`$REG/coordinator-paused`, `$REG/mail-disabled`), removable only by a human at a terminal.

## Open on `main` — do NOT assume these are fixed
`MailDeliveryState` terminality is incomplete (some writers lack the guard); `FleetIO.readFile`'s
`// null = missing` docstring is FALSE today (a result-returning read is planned); the "account = wrapper"
concept still has no single type. **Live build/roadmap state is NOT tracked here** — it lives in the orchestrator
task list and `docs/superpowers/plans/`, so this file never goes stale on it.
