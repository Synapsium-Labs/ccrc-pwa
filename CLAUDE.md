# ccrc

The operating console for SDD (spec-driven development) at **fleet scale**: a mobile-first PWA that views and
drives a fleet of Claude Code sessions (`--remote-control` or not — per box, `~/.ccrc/remote-control`;
dispatched workers per session, ruling 2026-08-13)
and **follows a session across account/wrapper swaps**
(the thing claude.ai's own app can't do). Weigh every feature by the loop it serves:
spec → plan → subagent execution with per-PR review lenses + whole-branch pass → coordinated multi-wave programs.

**`README.md` (~3200 lines) is the canonical system overview. This file is only the non-obvious operational rules
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
- **Tailscale is NOT part of the machinery.** No shipped code invokes the `tailscale` binary. The hits in
  `server/src`, `ccd/`, `deploy/` are comments and message strings naming `tailscale serve` as one *example* of a
  TLS-terminating proxy ("`tailscale serve` and Caddy alike"), the `ts.net`/`tailscale.net` entries in `webauthn.ts`'s
  `PUBLIC_SUFFIX_TRAPS` (a refusal list), and one systemd ORDERING line — `After=… tailscaled.service` in
  `ccd/claude-session@.service`, which nothing `Wants=` or `Requires=`, so the unit starts without it. No doctor check
  requires it. Never add a tailnet dependency,
  and never read a live `tailscale serve` mapping on a box as the product's path — those are operator plumbing
  this tree does not know about. The one place a tailnet is still load-bearing is **outside ccrc**: the
  docs-preview convention in the operator's global `CLAUDE.md` serves `/docs` over the tailnet only, from a
  docserver that is not in this repo and not behind ccrc's auth.

## SAFETY — sacred, never violate
- **NEVER run destructive `ccd` verbs against the live host:** `ws-rm`, `ws-reap`, `ws-gc --prune`,
  `ws-archive`/`ws-restore`. `ws-rm`, `ws-reap`, `ws-gc --prune` delete workspaces/branches/clips;
  `ws-archive`/`ws-restore` delete nothing but cost the tmux pane — scrollback and any in-flight turn
  (`cmd_ws_archive`'s header in `ccd/ccd`). All five forbidden; `ws-reap` is **human-only by contract**.
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
  (`MailTokenPlaceholderUnedited`) — this repo is **public** (AGPL-3.0 since 2026-08-22: `LICENSE`, `CONTRIBUTING.md`,
  `SECURITY.md`): treat everything in it as public.
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
  `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`. CI on the quiet box is
  the arbiter; a flake CI passes is a flake. `ccd-session-state`'s window is `the supervisor heartbeat > a swap
  re-stamps while it carries` (`expected ['mid-carry:orphan'] to include 'mid-carry:restarting'`) — measured
  2026-08-16 at 2/4 full runs and 1/3 under concurrent load, but **0/6 on an idle box**, so isolation alone can
  clear it and a single green isolated run is not proof it was the load. `ccd-bounded-reads`' D4 family bounds
  a real ~788ms call at a 5000ms `runBounded` deadline; measured failing once in a 22-file `ccd-[a-f,h]*` batch
  under load and green in isolation and on re-run — the bound is now 15000ms, but the family still shells a
  real `timeout`-wrapped child process, so a badly loaded box can still starve it.
- **Node floor `>=22.13.0`, identical across the three engines**, pinned by `server/test/node-floor.test.ts`
  (server-only). Reason: `server/src/coord/db.ts` imports `node:sqlite` unconditionally; below 22.13 the server
  fails to boot, not degrades. If node-floor's absolute assertion (3) is red while (1–2) are green, **RAISE
  engines — never lower them to make it green.**
- **Deploy = release + rollout** (design `docs/superpowers/specs/2026-09-18-release-rollout-design.md`). Every merge to
  `main` becomes a GitHub Release within about a minute (`.github/workflows/release-main.yml` → `deploy/release-main.sh`
  → `build-release.sh`; patch-per-merge, a hand-pushed `vX.Y.0` tag for a minor rides `release.yml`). Moving the fleet
  is ONE act from a machine with ssh to both boxes: `ccrc rollout [--to vX.Y.Z] [--server-first] [--check] [--force]` — it
  preflights each box's recorded `CCRC_ROLE`, pins the version from SHA256SUMS once, runs `ccrc update --to` on the
  fleet box then the server box, stops at the first failure, and re-measures both (`--force` moves a converged fleet
  anyway). An update that completed under a failing doctor exits 3, not 1 — the box IS on the new build, its FAIL lines
  are its health — and `rollout` relays that, continues, and exits 3 itself (D-3114). Any single box is `ccrc update`; a converged box (stamp, staged sha and `~/.ccrc/installed` agreeing) is
  left alone — `--force` reinstalls there too. **The first move onto the channel is by hand, once per box (D-3106):**
  `rollout` asks each box `ccrc update --check`, which a `ccrc` placed before 2026-09-19 does not know, and it refuses a
  box whose `~/.ccrc/ccrc.env` records no `CCRC_ROLE` (`deploy.sh` never writes one; a bare `ccrc update` there would
  install role `both`). Record the role, then `ssh <box> ccrc update --to vX.Y.Z`, fleet box first; from then on it is
  `rollout`. **What is
  running where:** `ccrc version` (with its `install:` line), `ccrc update --check`, `/health`'s `version`, the PWA's
  `BuildLine`, and doctor's `skills` check (every home vs the shipped tree; `ccrc doctor --fix` cures it, D-3113). A
  server-role box converges nothing per account — no wrappers, dirs, hooks, skills or session files — and its doctor
  skips those checks (D-3111). Coordinates live in `~/.ccrc/deploy.env`
  (`CCRC_BOX`, `CCRC_AGENT_BOX` — never defaulted from `CCRC_BOX` — `CCRC_SSH_KEY`, `CCRC_SSH_PORT`; real values:
  `deploy/reference-fleet.md`, gitignored — env vars override that file and `CCRC_DEPLOY_ENV` points at another;
  `CCRC_SW_DENYLIST` for a box with co-tenants; the roster seed defaults to `deploy/accounts.default.json`).
  **`deploy/deploy.sh` is the FALLBACK, not the path:** it pushes a working tree, writes NO `~/.ccrc/installed`
  record — so `ccrc version` reports `install: incomplete` and `update --check` reports `incomplete`, or
  `unversioned` when the stamp carries no `version` at all — ships skills on its agent arm only, and still refuses
  with exit 2 without a target (`server/test/deploy-coordinates.test.ts` pins that refusal). It DOES stamp
  `version`, but only when a release tag points at the built commit (`stamp_build`'s `git tag --points-at HEAD`),
  which auto-tagging makes the ordinary case on `main`; the PWA shows a box amber for a MISSING `version`, which
  is what an untagged working-tree deploy leaves. The ordering rule survives as `rollout`'s default: fleet box first
  because the server reads what the hook writes and the agent caches `ccd caps` at boot — `--server-first` when a
  wave's server arm is a reader-widening.

## Conventions that shape every change
- **Rings / bounded contexts** (`docs/…-architecture-ddd-clean-solid.md`): ring membership is a property of a
  file's IMPORTS, not its path — check a file by reading its import block. L0 `shared/*.ts` imports NOTHING (not
  even `node:*`) — the reason is that the PWA bundles those files, so deploy-side `shared/*.mjs`, which it never
  imports, may use `node:*` (`shared/mark.mjs`'s `node:crypto` import); L1 policy = pure decisions, no `fs`/fastify/`reply`; L2 ports
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
  monotonic across project history — not reset per plan; ONE namespace, the old build-scoped `D-B<k>-<m>` ids
  were reconciled into it and survive only as `was D-B4-9` aliases — zero bare legacy refs remain in tracked
  text, measured).
  **You are ISSUED a number — you never look one up.** `POST /api/ledger/deviations` MINTS a contiguous block,
  and those are the only numbers you may define; allocate and DEFINE IN THE SAME ACT. It is box-token gated, so
  a session that cannot reach it writes `D-TBD-<slug>` and reports (worker clause 11) rather than guessing.
  `GET /api/ledger?project=` is the READ, and its `floor` is what the next POST would mint, not a number you
  may take (a brief once said 1243 while the allocator said 1292, D-1293).
  **WHAT THE FLOOR IS.** It is seeded from PROSE — the highest `D-<n>` token anywhere in this project's
  `docs/superpowers/{plans,specs}`, a mere mention counting, plus `LEDGER_SEED_GAP` — and it ONLY EVER RISES
  (`raiseLedgerFloor`'s `WHERE excluded.floor > ledger_floor.floor`; no lowering path exists). So every
  publish-then-sweep burns `LEDGER_SEED_GAP - 1` numbers by design, which costs nothing, and a number WRITTEN
  without being ISSUED seals its own band forever: it never enters the ledger, and it raises this project's
  floor anyway. Measured 2026-09-02: the live floor stood well ABOVE the highest number the allocator has ever
  issued, raised off a plan file that is on no merged ref — every number between is unissuable for good.
  The parallel-branch collision — two branches each measuring a checkout and each taking the same next number —
  is now MEASURED rather than remembered: `git fetch origin main` then `cd server &&
  ./node_modules/.bin/vitest run test/deviation-refs.test.ts`, which compares this branch's entries against
  `origin/main`'s **without merging** and reds on any allocator-era number defined in two plans. It fires before
  the merge that would otherwise decide it; the older one-tree scan could only name the loser afterwards. It
  cannot see the other shape — one plan defining a number NOBODY was issued — which `sweepLedgerReconcile`'s
  orphan warning reports and nothing refuses. Source files carry `D-N` refs in comments; **read them
  as authoritative history, don't delete them.** Anchors in plans are snapshots — trust shipped source's own
  comments over a plan document.
- **Wire discipline — additive-only, absence-permits:** frames are ADDITIVE; do NOT bump `FLEET_PROTO`
  (=1, `FLEET_PROTO_MIN`=1, defined once in `shared/api.ts`) for a new field. A newer peer must tolerate an older
  peer omitting a field, through a SINGLE reader per field. Reading a persisted `FleetSession[]` from an older
  build goes through `reviveFleetSession` (returns a literal, so a new field is a compile error until every path
  computes it). `FLEET_PROTO_MIN` is a dormant kill-switch.
- **Account pools — both sides optional, `ccd` is the authority.** An account carries an optional `pool`
  (`accounts.json`, emitted as `_ccrc_pool` into `accounts.sh`, so a cross-box disagreement is visible);
  a project carries one at `~/.cc-sessions/pools/<project>` — a DOTLESS registry subdirectory, never
  `$REG/<project>.<x>` (ids are `<wrapper>-<project>`, so a project named `acct-a-demo` would write
  session `acct-a-demo`'s own field). Serve iff either side is untagged or the names are equal:
  **untagged = unconstrained, and tagging can only tighten.** `ccd` decides at every placement, tick and
  manual verb; the server REFUSES (409/503), FORECASTS and composes the wire, and **never places a
  session or writes the marker**. `_project_pool_state` is ccd's ONLY reader (`server/src/pools.ts` is
  the server's own) and answers four words — `named <n>`/`untagged`/`unreadable`/`malformed`, always
  rc 0 — and an undecidable tag never folds into `untagged`. `--cross-pool` is NOT `--force` (transcript
  loss); `.crosspool`/`.stranded`/`.strandnotify` purge with the row. Fixtures are `pool-a`/`pool-b`; real
  pool names are operator DATA that NOTHING scans for — `topology-clean` has no pool class — so keep them out by hand.
  **The account side is CENTRAL and LEASED.** An account's pool now lives in `pool_edges` in
  `~/.ccrc/coord.db` (authoritative, journalled to `~/.ccrc/pool-edges.log`) and reaches the fleet as
  `$REG/pool-epoch`, pulled by `ccd-pool-sync.timer`; `accounts.json`'s `pool` is RETAINED as the
  lowest-precedence declared default — retiring it would make an old `ccd` read every account untagged,
  fail-OPEN. **`ccd`'s placement now has a freshness dependency it never had, on a FLEET box only
  (item 5):** `_project_pool_state`'s absent file means "nobody tagged anything"; `_acct_pool_state`'s
  absent file means "I have not synced" and answers `unreadable` → undecidable → refuse into a
  tagged project — `stale` and `unreadable` are two words with two remedies, never folded. A box
  with `ccd-pool-sync.timer` never installed (`--role both`/`--role server`, the single-box
  default) has none of this: absence falls back to the DECLARED tag, exactly as `main` did.
  The server never nudges; convergence is the timer's pull alone, bounded by `OnUnitActiveSec=60s`.
  `GET /api/pools/epoch` answers the RESOLVED pool (central if present, else declared), so `ccd`,
  the server's forecast and its refusal all agree on the CARRIER, not the VERDICT (§5.7).

## Coordination (Build 7) invariants a coder must NOT break
- `~/.ccrc/coord.db`: `node:sqlite` `DatabaseSync`, WAL, `user_version` migrations that **refuse to start rather
  than open empty**. Its synchrony is a stated concurrency invariant — **do not wrap it async** (a repository/async
  interface over `CoordStore` is explicitly rejected). It is a server-side RE-MEASUREMENT of ccd's flat files
  (registry, hold, `.prhistory`), which stay ground truth; a lost coord.db reconstructs from them.
- **Zero new ccd verbs for coordination mutation** — mutations ride already-granted `CcdArgv` (a brand built at
  the call site, never table-looked-up). Exec surface is closed: `EXEC_COMMANDS = ['tmux','ccd']`.
- **Box token gates every coordination WRITE** (`/api/mail*`, `/api/runs*`) — header `x-ccrc-mail-token`, `401`
  on missing — **except FOUR deliberately ungated operator doors: `POST /api/coord/pause`, `POST
  /api/runs/:id/abandon`, `POST /api/claims/:id/break` and `POST /api/runs/:id/reclaim`** (D-282 (was D-B4-9),
  extended to the third by build 9 D12 and to the fourth by program-leverage wave 5: the party that would be
  locked out — the coordinator, any session holding a claim, and a program whose coordinator is DEAD and whose
  box token died with it — is the one holding that token, so gating a wedge's release valve behind that key
  leaves the wedge no door. Reclaim's guard is a RE-MEASUREMENT, not a credential: it refuses unless the run's
  current `claimedBy` measures dead or registry-absent, and an unmeasurable registry refuses too — never
  proceeds). `coord-pause-route.test.ts`'s `UNGATED` set pins all four in both directions, and with `CCRC_AUTH`
  armed all four still sit behind the session gate (`auth/gate.ts`'s NOT-EXEMPT note: gating them there
  "strengthens D-282 rather than reversing it"). Those prefixes are the bulk of the box-token surface, not the
  whole of it (D-1148, correcting a "whole box-token surface" claim this file carried for one wave): `POST
  /api/asks/:id/answer`, `POST /api/asks/:id/release`, `POST /api/claims`, `POST /api/claims/:id/release`, `POST /api/ledger/deviations` and
  `GET /api/ledger` all call `requireMailToken` outside both. The dual-credential reads, including `GET /api/feed`,
  call `checkMailToken` only after a session check; `auth/gate.ts`'s EXEMPT reasons — route by route, each with
  its own argument — are the census, not this bullet. What does need saying here are the
  coordination WRITES that carry no box token at all: `POST /api/sessions/:id/kickoff` (wave 4) and `POST
  /api/coord/caps` (wave 6) are session-gated only — armed, they sit behind the auth gate like every other
  PWA-surface write. The first needs prose because no scanner can see it: `coord-pause-route.test.ts` reads
  `server/src/coord/routes.ts` alone, and that route is registered in `server.ts`, so a door opened outside
  that one file is invisible to the set that pins the doors. The second IS in that file's `SESSION_ONLY`
  set, and `box-token-census.test.ts` now checks this sentence against it in both directions (D-1231).
  Don't assume — read the guards.
- **The dispatch cap counts ACTIVE runs** (`ACTIVE_RUN_STATES` in `shared/api.ts`: `dispatched`, `working`,
  `unknown`) — a run at `awaiting-review`/`merging`/`closing`/`planned` holds no slot, and `advance -> working`
  from an idle state is cap-checked (design 2026-09-14 §7). `run-states.test.ts` pins that every `RunState` is
  classified exactly once; never add a state without placing it.
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
  (`ccd/coordinator-skill/SKILL.md`); its fourteen clauses are pinned VERBATIM by
  `server/test/coordinator-skill.test.ts` — a softened clause is a red suite. Pause kill-switches are FILES
  (`$REG/coordinator-paused`, `$REG/mail-disabled`). `mail-disabled` has **no writer in the tree** — touch/rm by
  hand only. `coordinator-paused` does: Build 4's whitelisted `ccd coord-pause --state on|off`, driven by
  `POST /api/coord/pause`, both raises and lowers it, so it is reachable from a phone — `routes.ts` calls the
  boundary what it now is, "convention with a speed bump".
- **The worker has a skill too** (`ccd/worker-skill/SKILL.md`, `ccrc-worker`, fifteen clauses pinned by
  `server/test/worker-skill.test.ts`; it ships no `references/` and points at the coordinator's).
  `WORKER_KICKOFF_PREFIX` (`server/src/coord/dispatch.ts`) prefixes EVERY brief mail with the sentence that
  invokes it, so a wave brief carries WAVE SPECIFICS — plan path, task range, interfaces, deviations — never the
  standing protocol. The one exception is deliberate: the branch-discipline sentence is said in both, because a
  skill reaches a home only once its installer has run there.
- **So does the reviewer** (`ccd/reviewer-skill/SKILL.md`, `ccrc-reviewer`, ten clauses pinned by
  `server/test/reviewer-skill.test.ts`; no `references/` of its own). A review run (design 2026-09-14) is
  dispatched by the coordinator on a verified wave-done; the reviewer reads the worker branch at one measured
  tip in its OWN worktree and mails one report; the coordinator rules. `REVIEWER_KICKOFF_PREFIX` prefixes its
  brief exactly as the worker's does. A skill reaches a home through `ccrc update`'s install spine (`_inst_skills`,
  every rostered home) — never assume a server-only deploy carried it; doctor's `skills` check measures every home
  against the shipped tree, and `ccrc doctor --fix` cures it from the same tree.

## Open on `main` — do NOT assume these are fixed
`MailDeliveryState` terminality: as of **2026-09-02 (wave 8)** every `UPDATE mail_deliveries` in
`server/src/coord/store.ts` names one of two shared guard fragments — `OUTSTANDING_STATES_SQL` or
`TERMINAL_DELIVERY_SQL`, the latter built by `.join` from L0's `TERMINAL_DELIVERY_STATES` (`shared/api.ts`) —
pinned by `mail-hardening.test.ts`'s writer scan and, against a second hand-written copy in SQL or in JS, by
two scans in `single-definition.test.ts`. STILL OPEN, and do not assume otherwise. The delivery-row writers
that still return `void` are `cancelKickoffsTo`, `repointCoordinatorMail`, `cancelOutstandingDeliveries`,
`markDelivered`, `markIngested`, `backOff`, `noteGate`, `rejectDelivery` and `parkSupersededDeliveries`.
The last is Task 6 of the crossrepo-programmes wave-1-server plan, carrying D-2059's worker-arm park —
but its EXTRACTION into its own method is a separate departure from the brief's own text (which put this
`UPDATE` inline), recorded as its own number, **D-2338**, because D-2059 argues the park's role-generalised
SQL and says nothing about this method's existence. Split into its own single-line-signature method rather
than inlined in the method that calls it — a write inlined there would have this file's own writer census
walk back past that caller's DECLARED multi-line-signature exemption and mis-attribute it, the failure mode
that exemption's own comment warns about. Their guard is
invisible to the caller — the defect `store.ts`'s own `SetWorkItemResult` docstring names `markDelivered`
as the archetype of,
and `watch.ts`'s `sweepMail` leans on `bumpReplayCount`'s union to cover `markDelivered`'s silence in its
replay branch. And an out-of-vocabulary `state` token (the column is `schema.ts:138-139`; the deploy-rollback
that can reach it is argued at `schema.ts:41-45`) is LIVE to every negative-form guard and to `markAcked`,
while `dueDeliveries` and the positive-form writers treat it as not-outstanding — an asymmetry nothing has
ruled on. D-114's measured read is **LANDED, not open** — corrected 2026-09-04 (D-1441), because the paragraph
this replaces was falsified by wave 8's own commits and still read as live guidance. What is true now:
`readFileMeasured`, `readFileFromMeasured`, `readFileB64Measured` and `statMeasured` (`server/src/io.ts`)
each tell absent from unreadable, and the B64 arm tells a THIRD condition, over-cap, with the measured
size beside it. The four convenience reads — `readFile`, `readFileFrom`, `readFileB64`, `stat` — still
fold every failure to one `null`, DELIBERATELY, so an older caller keeps its exact meaning; each now
names its own collapse in `io.ts` and points at its measured sibling, and each derives from it, so no
adapter narrows a distinction it received. **The one read left with no measured sibling is `readdir`.**
The agent's wire no longer lies either: `absent` is a separate positive marker spread ONLY on a proven
ENOENT (`statPayload`, `agent/src/server.ts`), so EACCES answers a bare `{missing: true}` and a newer
server reads that as UNMEASURED rather than as absence (D-1396) — the sentence here previously said the
opposite. And `ReadFailure` lives in **`shared/agent-protocol.ts`**, not `server/src/io.ts`: D-1438 moved
it there so both sides declare the vocabulary once, and `single-definition.test.ts` pins that home
(`expect(holders).toEqual(['shared/agent-protocol.ts'])`). Read the interface, not this paragraph
(D-114, `docs/superpowers/plans/2026-08-20-fleetio-measured-read.md`). **Live build/roadmap state is NOT tracked here** — it lives in the orchestrator
task list and `docs/superpowers/plans/`, so this file never goes stale on it.
