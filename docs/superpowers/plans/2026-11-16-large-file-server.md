# Large-file programme, file 3: `server.ts`'s inline routes in seven lifts and seven moves (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is the plan for file 3 of the large-file programme (D-8615). It is defined by D-8682 (its line is under "Deviations
found"). A pin PR moves every scan of `server/src/server.ts` onto its program and freezes the file. A tool PR teaches
`.github/ci/file-split.mjs` to judge a LIFT. Then 56 of the 60 routes that `buildServer` registers inline leave the
file, in seven groups. Each group takes two PRs: a lift into one top-level `register…Routes` function in `server.ts`,
then the tool's pure move of that function to its own route module. Each module holds one context and one ring. A
closing PR caps `server.ts` and the seven modules.

**Goal:** reduce `server.ts` to its role, as spec §3 states it: composition, the socket upgrades and `/health`. This
plan changes no behaviour. Spec §1's done-test applies: items 2 to 5 (`server.ts` already passes item 1).

**Architecture:** a route registered inside `buildServer` is a statement in a function body. It is not a top-level
declaration, so the slice tool cannot move it. Each group therefore moves in two steps:
1. **The lift.** The group's statements move unchanged into a new top-level function in `server.ts`. The function's
   parameters bind exactly the names those statements captured from `buildServer`, and one call is left in their place.
   This is spec §2 item 2's delegate extraction, applied to a function's statements instead of a method's body.
2. **The move.** `file-split.mjs move` then moves that function, with the module-level declarations only it uses, to
   the new module. This is a pure move.

Task 3 adds the lift's verdict to the tool, so both kinds of slice are judged by `file-split.mjs`. Task 1 moves every
scanner first (rule (e)), so no slice edits a test, except on the import lines `move` repoints.

**Tech Stack:** TypeScript 6, Fastify 5.12, `server/test/scan/parse.ts` (its `ts` export), the slice tool
`.github/ci/file-split.mjs` with `server/test/fileSplit.ts` (#2819, D-8636), the program view
`server/test/scan/programView.ts` (#2834, D-8641), and the growth stages `server/test/growth-frozen/` and
`server/test/growth-caps/` (#2811, D-8635). Tests run in vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-large-file-programme-design.md` (D-8615), approved 2026-11-14 with every
answer as recommended. This plan uses §1 (the done-test), §2 (the method), §3 (the `server.ts` paragraph), §4 (slots,
caps, stages), Q1 (2,500 code lines), Q2 (a cap is the measured code lines + 40, and may only fall) and Q8 (10 net
lines per PR, no waivers). It also follows step 0's plans, `2026-11-14-large-file-step0-caps.md` (D-8635) and
`2026-11-14-large-file-step0-split-tool.md` (D-8636), and the pilot's plan,
`2026-11-15-large-file-pilot-delegation-checkpoint.md` (D-8641). This plan has the pilot's shape.

## What was read first

- The design in full, and the programme doc `docs/superpowers/plans/2026-11-13-large-file-programme.md`.
- The pilot's plan, and the pilot as built on `main`:
  - #2834 (`3b6e2c740`): the pin, the program view, and the freeze file in the same PR;
  - #2858 (`f6ea95de5`) and #2908 (`0c573d7f3`): the first two pure moves. Each one has the marker, an L3 header above
    it, and test changes on import lines alone.
- Step 0's two plans, and the tools on `main`:
  - `.github/ci/file-split.mjs` and `server/test/fileSplit.ts`: `plan`, `preflight`, `move`, `verdict`,
    `pureMoveVerdict`, `branchVerdict`, and the REAL row of `file-split-pin.test.ts`;
  - `server/test/growthCheck.ts` (`SPINE_LIMIT`, `GROWTH_FROZEN_DIR`, `GROWTH_CAPS_DIR`), `growth-check.test.ts` and
    `growth-caps.test.ts`;
  - `server/test/rings/ringContextMap.ts` and `totality.test.ts`: dead rows and unmapped files are both refused;
  - `rings/fastify-l4.test.ts`, which holds its allowlist exactly, and `rings/host-imports.test.ts`.
- Fastify 5.12's `lib/route.js`, to learn when each part of a route is fixed:
  - `onRoute` hooks run when the route is registered;
  - the error handler is taken at the next avvio flush;
  - every other lifecycle hook is composed for every route of the instance at `preReady`.

## The file today (measured on `origin/main` `9cf263d44`, 2026-11-16)

The file is 4,411 lines and 1,998 code lines (`codeLines`, `server/test/growthCheck.ts`). It has 121 import statements
and 20 other top-level statements. `buildServer` runs from `:356` to `:4411`, which is 4,056 lines. It
had 47 commits in the 14 days to 2026-11-16. Its context is K (the `server.ts` file row of the 08-10 spec's table). Its
ring is L4, because it imports fastify (`rings/fastify-l4.data.ts`). It is listed in `GROWTH_FILES` at 40 lines per
PR. It has no freeze file and no cap. Line numbers below are snapshots of `9cf263d44`, not anchors.

**The 60 inline routes.** By `auth/gate.ts`'s `EXEMPT` table, 53 are session-gated (three of them websocket upgrades).
Five are exempt: `POST /api/auth/login`, `POST /api/auth/passkey/assert/start`, `POST /api/auth/passkey/assert/finish`,
`GET /api/auth/status` and `GET /health`. `POST /api/notify` is exempt and checks the box token itself.
`GET /api/pools/epoch` is EXEMPT-BUT-AUTHENTICATED, and checks the box token or the session. Beside them stand 18
`register…Routes` calls (the design counted 14 on 2026-11-13). These are the precedent.

**Where the 60 go.** Contexts come from `ringContextMap.ts`. "Locals" are the `buildServer` locals each group captures,
measured by a scan of identifier references over the group's statements. They become the lift's parameters, together
with the host's own `app`, `deps`, `bus` and `watcher` where they are used. "Lines" are the gathered statements with
their lead comments.

| # | Module (new) | Context | Routes | Lines / code lines | Captured locals |
|---|---|---|---|---|---|
| 4 | `server/src/notifyRoutes.ts` | C6 | 7: `GET /api/push/key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `GET /api/notifications/catchup`, `POST /api/notify`, `GET /api/digest`, `POST /api/digest/correct` | 232 / 98 | none (`deps`, `bus`) |
| 5 | `server/src/fleetRoutes.ts` | C1 | 5: `GET /api/fleet`, `GET /api/fleet/health`, `POST /api/fleet/reboot`, `GET /api/fleet/overrides`, `GET /api/models/:lane` | 228 / 111 | `stateCachePath`, `lastOperatorAct` (`deps`, `watcher`) |
| 6 | `server/src/sessionRoutes.ts` | C3 | 9: `GET /api/sessions/:id/pane/history`, `POST …/prompt`, `POST …/route`, `POST …/dialog/tab`, `GET …/commands`, `POST …/interrupt`, `POST …/submit`, `POST …/upload`, `GET …/clip/:name` | 315 / 161 | `knownId`, `sendDeps`, `notice`, `turnReads`, `pwaDec`, `runCcdOr502`, `answeredFrame` (`deps`) |
| 7 | `server/src/workspaceRoutes.ts` | C4 | 16: `GET /api/projects`, `POST /api/sessions`, `POST …/ensure`, `POST /api/projects/:project/workspaces`, `POST /api/projects`, `POST …/stop`, `GET …/pr`, `POST …/pr`, `POST …/archive`, `POST …/restore`, `POST …/forget`, `POST …/hold`, `POST …/release`, `POST …/title`, `GET …/workspace/audit`, `POST …/workspace/reap` | 907 / 443 | `knownId`, `sendDeps`, `pwaDec`, `runCcdOr502`, `ccd502`, `refusePool`, `readAccountPoolEdges`, `lastOperatorAct`, `coordRoutes`, `turnReads` (`deps`, `watcher`) |
| 8 | `server/src/poolRoutes.ts` | C1 | 6: `GET /api/accounts`, `POST /api/projects/:project/pool`, `POST /api/pools/accounts/:id`, `GET /api/pools/epoch`, `POST …/swap`, `POST …/limit-wait` | 535 / 190 | `authAttempts`, `lastOperatorAct`, `readAccountPoolEdges`, `rosterWireOf`, `sessionAuth`, `stepUp`, `refusePool`, `sendDeps`, `turnReads`, `ccd502`, `knownId` (`deps`, `watcher`) |
| 9 | `server/src/auth/routes.ts` | C8 | 12: login, logout, the six passkey routes, the three step-up routes, `GET /api/auth/status` | 551 / 213 | `authStore`, `loginLimiter`, `passkeys`, `registerChallenges`, `assertChallenges`, `passkeyLimiter`, `deviceLabel`, `secretNow`, `sessionAuth` (`deps`); it returns `stepUp` |
| 10 | `server/src/coord/kickoffRoute.ts` | C5 | 1: `POST /api/sessions/:id/kickoff` | 103 / 41 | none (`deps`) |

`…` stands for `/api/sessions/:id`. All seven together are 2,871 lines and 1,257 code lines.

**The helpers that go with each group.** A group's lift also takes the `buildServer` statements that only its own
routes use:
- fleet: `ownRosterFpOf` and `ownRosterFp`;
- auth: `rpProblem`, `warnedRpProblems`, `passkeyUnavailable`, `stepUp` and the `onSend` hook `stepUp.noStore`;
- workspace: `parseOperatorRoute`, `projectWalk`, `stopPairWrapper`, `stopPairRefused`, `stopArgvFor`, `claimsPort`,
  `prTasks`, `type SessionLinking` and `sessionLinking`.

Its move also takes the module-level declarations that only its function uses:
- auth: `ANON_VISIBLE`, `anonymousStatus`, `ASSERT_START_VISIBLE`, `anonymousAssertStart`;
- session: `MAX_ATTACHMENTS`, `MAX_UPLOAD_BYTES`, `UPLOAD_EXT_RE`;
- pool: `DEFAULT_POOL_LEASE_MS`, `resolvePoolLeaseMs`, `poolLease`, `POOL_LEASE_MS`;
- fleet: `PROJECT_POOLS_REQUEST_BUDGET_MS`. The workspace and pool modules later import it from `fleetRoutes.ts`.

**What stays in `server.ts`** (its role):
- the plugins and the gate;
- the response hooks, the answer mask (`MASKED_GET_ROUTES`, `WRITE_ANSWER_EXEMPT`, `answerMasked`) and the error
  handler;
- the operator-act wrapper;
- `GET /health`;
- the three socket upgrades `GET /ws/fleet`, `GET /ws/session/:id` and `GET /ws/pty/:id`, with their helpers;
- the 18 `register…Routes` calls and the seven new ones;
- the shared composition locals that two or more groups capture (`knownId`, `sendDeps`, `runCcdOr502`, `ccd502`,
  `refusePool`, `readAccountPoolEdges`, `turnReads`, `pwaDec`, `sessionAuth` and the others in the table);
- the PWA static root.

On a scratch copy the remainder measured about 1,550 lines; the closing task measures it again. The top-level `if`
that prints `CCRC_POOL_LEASE_MS`'s warning stays too, because the tool moves declarations only. After the pool move,
it reads `poolLease` from `poolRoutes.ts`.

**The file is free.** One `gh pr list` on 2026-11-16 found 19 open PRs, and their heads were read by git. Only #2914
edits `server.ts`, by one line: the `registerResponseRoutes(…)` call at `:2268`, which stays. No in-flight programme
holds the file. The pilot holds C5: its first two moves are on `main`, and its recovery move and cap PR are still to
come. That is why the C5 slice is last.

**The scratch proof (2026-11-16).** On a copy of `9cf263d44`, a script ran all seven lifts and moves at once. This
was a crude version of the plan: the functions were untyped (`@ts-nocheck`), with every import copied, and kickoff
went into `coord/`. Afterwards the server typecheck of `server.ts` was clean. Then 332 test files ran: every file that
names `server.ts`, plus `rings`, `census-w3`, `census-w7`, `census-w8`, `single-definition`, `mail-routes` and
`coordinator-skill`.
- On the unmoved worktree, 6 files were red. These are the known environmental ones (`mail-sweep`, `stall-sweep`) and
  flakes (`pr-sweep`, `feed-writers-pin`, `mail-role-senders`, and one `secret-mask` row).
- After the moves, 21 reader files went red, and every one is in Task 1's table. Three more went red, as expected:
  - `rings/totality` and `rings/fastify-l4`, which wait for the context rows and the program clause;
  - `single-definition/refusal-table`'s F5 row, because the copy has no `origin/main`.

  `pr-sweep` was red in both runs, on different rows.
- `mail-routes` and `coordinator-skill` stayed green with the kickoff route under `coord/`.

Each group went to the path the table names, and `server.ts` fell to 1,554 lines. The copy was deleted.

**Every scanner that reads the file's text.** They are listed in Task 1. 61 test files name `server.ts`; about 40 of
them read its text or key a census on it. The rest import `buildServer` or `Deps`, or name `agent/src/server.ts`.

## Global Constraints

- **Two kinds of slice PR, never mixed.**
  - A **lift** changes `server.ts` alone. It adds one function whose body is the gathered statements, byte for byte
    and in their old order, and it replaces the last gathered statement with the call. It adds no other edit.
  - A **move** is a run of `file-split.mjs move`, and changes test files on import lines only. Beyond what the tool
    writes, it makes one edit: the destination's file row in the 08-10 spec's context table, in the tasks that name
    one (Tasks 4 to 8). That file is a doc, which the REAL row does not read.
  - A REAL row judges each kind on its own diff: the move verdict (D-8636) and the lift verdict (Task 3).
- **One behaviour change per commit** (§2 item 3). A defect found in a slice gets its own later PR, red test first.
- **Frozen from the pin PR to the cap PR** (Q8): 10 net code lines per PR, no waiver, and only the operator's named
  exemption gets past. A lift adds about 3 to 8 lines: the signature, the closing brace, the call, and a `return` in
  one task. If a lift measures over 10, write its parameter types shorter (an exported type, `Pick<…>`). Never split a
  group to fit. New routes during the freeze go to the module the table names, or to a `register…Routes` module of
  their own, never inline in `buildServer`.
- **One open slice PR on `server.ts` at a time.** Lifts and moves both edit `buildServer` or the import block, and
  `preflight`'s one-open-move rule cannot see a lift. A slice yields to feature PRs that touch its statements.
- **The order is fixed, as Tasks 4 to 10 run.** It is notify (C6), fleet (C1), session (C3), workspace (C4), pool (C1),
  auth (C8), kickoff (C5).
  - The two groups with the fewest captures come first, so the lift verdict is proven where a mistake is cheapest.
  - Fleet goes before workspace and pool, because its move carries `PROJECT_POOLS_REQUEST_BUDGET_MS`. Moving it first
    keeps the import one way (`server.ts` → module), and the tool refuses a `cycle`.
  - Auth is last of the free slots: it is security-sensitive, and it takes three review rounds.
  - Kickoff waits for C5 (spec §4): after the pilot's cap PR, and while no other file's move PR holds C5.
- **Destinations are new files only.** A program member holds only code that came from `server.ts`, so no scan reads
  a module twice: once through the view, and once through its own existing line. The tool can append to an existing
  module; this plan never asks it to.
- **Context rows.** A new root-level module needs a file row in the context table of
  `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, in its move PR. `totality.test.ts` refuses a
  row that names no file, so the row cannot land earlier, and `preflight` refuses an `unmapped` destination, so write
  the row before Step M1. `auth/routes.ts` and `coord/kickoffRoute.ts` are reached by the `auth/**` and `coord/**`
  rows and need none.
- **Ceiling and cap.** Every module stays under 2,500 code lines. The largest, `workspaceRoutes.ts`, is about 500
  code lines with its imports. A cap is the measured code lines + 40, and may only fall (Q2, D-8635).
- **Preflight before every slice** (§4). Write the heads file as below, and run `lift-preflight` (Task 3) or
  `preflight`. Never poll. If `gh` reports a rate limit, stop and report.
- **Review:** a pure-lift or pure-move lens, at most two rounds. The auth lift and the auth move get three
  (security-sensitive).
- **Commits** cite D-8682. A commit that adds or edits a file under `docs/superpowers/plans/` carries
  `Ledger-Edit: D-8682` directly above `Co-Authored-By`. This is a public repository: no tracker ids, hosts or
  account names.
- **Gates for every PR:**
  - `(cd server && npx tsc --noEmit -p .)`;
  - `(cd server && npx tsc --noEmit -p test/tsconfig.tests.json 2>&1 | grep -v '^../agent')`, printing nothing;
  - `server-routes-pin`, `program-view`, `auth-gate`, `box-token-census`, `secret-mask`, `file-split-pin`,
    `growth-check` and `growth-caps`;
  - the suites each task names;
  - `server/test/rings`, `server/test/census-w7`, `server/test/single-definition` and `mail-routes.test.ts`.

## Review Focus

1. **A scan that stays green because the code left it** (rule (e)). These would narrow without going red, and Task 1
   points each one at the program:
   - `vocabularies.test.ts`'s "no bare `'operator'` in `server.ts`";
   - `update-stall.test.ts`'s `PANE_HISTORY_LINES` pin;
   - `auth-routes.test.ts`'s login-brake slice;
   - `pool-accounts-route.test.ts`'s "no box token" slice;
   - `secret-mask.test.ts`'s "no other route file sets an error handler", which skips `server.ts` by name;
   - `refusal-status.test.ts`'s per-file ceilings;
   - `pane-history-route.test.ts`'s `MEASURED` list and `ask-digest.test.ts`'s retired-door scan.

   In the scratch proof, five of them stayed green while reading less: `vocabularies`, `update-stall`,
   `pane-history-route`, `ask-digest` and `pool-accounts-route`. `pool-accounts-route`'s slice, for example, starts
   at an `indexOf` of -1. The other three went red only by chance of how they were written.
2. **A test edit hidden in a slice.** It reds the REAL row (`rest:<test file>`). A pin that a slice finds red goes
   back into a pin PR shaped like Task 1, and lands first. It is never fixed inside the slice.
3. **A capture passed under another name, or a closure split from its state.** The lift verdict requires each
   argument of the call to be the same-named identifier, bound by the same-named parameter. `lastOperatorAct` and
   `sessionAuth` are functions over `buildServer`'s state, and they pass as functions, so the state stays where it
   is. A mutable `let` is never a capture: `lift-plan` refuses one (`captures-mutable`).
4. **Registration order.** In Fastify 5.12, the lifecycle hooks are composed for every route at `preReady`, the error
   handler is taken at the next flush, and only `onRoute` hooks run at registration. The call stands where the
   group's last statement stood, so every route registers at its old place or later. None registers before the
   operator-act wrapper (`:574`). `server-routes-pin.test.ts`'s hook-stack row is the measurement. Read it on every
   slice, not the argument.
5. **Security, in the auth slice:**
   - the anonymous-body records (`ANON_VISIBLE`, `ASSERT_START_VISIBLE`) move with the functions that read them;
   - the login brake's `reserve` and `finally { slot.release() }` text stays identical;
   - `stepUp.noStore`'s `onSend` registers once, before the masking `onSend`. The hook stack shows its place, and
     `secret-mask`'s count of two `onSend` registrations reads the host program.
6. **A rebase across a feature that edited a gathered statement.** Redo the lift or the move on the new base, never
   by hand-resolving the conflict, then run the verdict on the commit.

## File Structure

| File | Ring, context | Responsibility | Created or changed by |
|---|---|---|---|
| `server/src/server.ts` | L4, K | composition, `/health`, the three socket upgrades, and the shared composition locals | every slice; Task 11 (prose) |
| `server/src/notifyRoutes.ts` | L4, C6 | Web Push key and subscriptions, the notification catch-up, the box-token notify door, the digest | Task 4 |
| `server/src/fleetRoutes.ts` | L4, C1 | the fleet and fleet-health reads, the fleet-host reboot, the overrides read, a lane's models | Task 5 |
| `server/src/sessionRoutes.ts` | L4, C3 | a session's conversation: prompt, dialog tab, interrupt, submit, commands, route, upload, clip, pane history | Task 6 |
| `server/src/workspaceRoutes.ts` | L4, C4 | projects and workspaces: create, ensure, stop, archive, restore, forget, hold, release, title, PR, audit, reap | Task 7 |
| `server/src/poolRoutes.ts` | L4, C1 | the accounts read, pool tags, the pool epoch, swap and the limit wait | Task 8 |
| `server/src/auth/routes.ts` | L4, C8 | login, logout, passkeys, step-up, the auth status | Task 9 |
| `server/src/coord/kickoffRoute.ts` | L4, C5 | a programme's kickoff door | Task 10 |
| `server/test/scan/programView.ts` | test | `server.ts`'s program row, `PROGRAM_HOSTS`, `hostSource`, `programOf`, `hostKey` | Task 1 |
| `server/test/routeTable.ts` | test | `realRouteTable`, moved from `auth-gate.test.ts` | Task 1 |
| `server/test/server-routes-pin.test.ts` | test | the 60 routes: their program, gate, hook stack and box token | Task 1 |
| `server/test/fileSplit.ts`, `.github/ci/file-split.mjs` | tool | `liftPlan`, `touchedHostStatements`, `liftsOf`, `pureLiftVerdict`, the three lift verbs | Task 3 |
| `server/test/growth-frozen/server-src-server-ts.json` | data | the freeze | Task 2; removed by Task 11 |
| `server/test/growth-caps/*.json` (8) | data | the caps | Task 11 |
| `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` | doc | five file rows in the context table | Tasks 4 to 8, one row each |

### The heads file (every slice's first step)

This is the pilot's "The heads file" without change, plus one more marker:
1. One call: `gh pr list --state open --limit 500 --json number,headRefOid > prs.json`.
2. One `git fetch -q origin pull/<n>/head …` for every head.
3. Each head's `git diff -U0 --no-color --no-ext-diff --no-renames "$(git merge-base origin/main <sha>)" <sha> --
   '*.ts' '*.tsx' '*.mts' '*.mjs'`, read by the pilot's `movesOf` and by Task 3's `liftsOf`.
4. A head with a move gets `{pr, head, move: {source, dests}}`, and a head with a lift gets
   `{pr, head, lift: {source, host}}`.
5. A head with neither is `{pr, head}`. A head with both, or with moves out of two sources, stops the slice: report it.

---

### Task 1: The characterization pin, with every scan of `server.ts` moved onto its program (one PR, before any slice)

**Files:**
- Create: `server/test/server-routes-pin.test.ts`.
- Modify: `server/test/scan/programView.ts`, `server/test/program-view.test.ts`, `server/test/rings/fastify-l4.test.ts`,
  `server/test/single-definition/advance-switches.test.ts`, and the readers in the table under Step 5.

**Interfaces** (all in `server/test/scan/programView.ts`, which reads with `node:fs` and parses with `parse.ts`'s `ts`):
- `PROGRAM_VIEWS` gains the row `'server/src/server.ts'`, with seven destinations in slice order:
  `'server/src/notifyRoutes.ts'`, `'server/src/fleetRoutes.ts'`, `'server/src/sessionRoutes.ts'`,
  `'server/src/workspaceRoutes.ts'`, `'server/src/poolRoutes.ts'`, `'server/src/auth/routes.ts'`,
  `'server/src/coord/kickoffRoute.ts'`.
- `PROGRAM_HOSTS: Readonly<Record<string, { host: string; lifts: readonly string[] }>>` has one row, for
  `'server/src/server.ts'`. Its host is `'buildServer'`, and its lifts are `registerNotifyRoutes`,
  `registerFleetRoutes`, `registerSessionRoutes`, `registerWorkspaceRoutes`, `registerPoolRoutes`,
  `registerAuthRoutes` and `registerKickoffRoute`.
- `hostSource(source: string, root?: string): string`:
  - returns the host function's text, then each lift's top-level function text, from whichever existing member
    declares it, in `lifts` order, each ending in one `\n`;
  - throws when the host is not declared exactly once in the program, or a lift is declared twice;
  - this is what `sourceOfSymbol(server.ts, 'buildServer')`, `symbolOf(…, 'buildServer')` and `argsOf(…, 'buildServer', …)`
    readers move to.
- `programOf(file: string): string`: the program source `file` belongs to (the source, or a destination of its row).
  Any other file maps to itself. A census keyed by file folds its rows through this.
- `hostKey(file: string, fn: string): string`: `'<source>#<host>'` when `file` is a member and `fn` is the host or one
  of its lifts, else `'<file>#<fn>'`. The callers-by-function readers fold through this.

- [ ] **Step 1: Write the failing pin** `server/test/server-routes-pin.test.ts`. Its literal `SERVER_ROUTES` holds the
  60 rows `{ key: 'POST /api/auth/login', gate: 'exempt', to: 'auth' }`. `gate` is `session`, `exempt`,
  `exempt-but-authenticated` or `ws`, as measured above. `to` is the module tag from the table, or `stays`.
  - "the program registers each of the 60 exactly once": scan `programTexts('server/src/server.ts')` for
    `app.(get|post|put|patch|delete)('<path>'`. Each literal key appears once, and every `ws` row carries
    `{ websocket: true }`. A feature that adds a route does not red this; one that removes a route updates the list
    in its own PR.
  - "each is served, with its gate": `buildServer` over `testDeps` with the gate armed. `auth-gate.test.ts`'s
    `realRouteTable` is moved into `server/test/routeTable.ts` in this PR and imported by both files. It holds every
    key. Each row's `gate` equals the `EXEMPT` lookup: absent means `session` or `ws`, and a reason naming
    `EXEMPT-BUT-AUTHENTICATED` means that class.
  - "each keeps its hook stack": `app.printRoutes({ commonPrefix: false, includeHooks: true })`, parsed per route into a
    signature such as `onRequest:4 preSerialization:1 onSend:2 onResponse:3`. A literal `HOOKS` maps each row to the
    signature measured on `main`. On `9cf263d44` the whole table printed 302 route nodes, HEAD rows included. Their
    `onRequest` stacks hold 4 or 5 hooks, their `onSend` stacks 2 or 3, and 33 have a `preHandler` (the rate limit).
  - "the box token stays where it was": `POST /api/notify` and `GET /api/pools/epoch` are the two rows whose code,
    read through the program, calls `checkMailToken`. No other row's does.
- [ ] **Step 2: Run** `cd server && npx vitest run test/server-routes-pin.test.ts`. Expected: FAIL, because
  `routeTable.ts`, the row and `hostSource` do not exist.
- [ ] **Step 3: Implement** the interfaces and `routeTable.ts`. Then add to `program-view.test.ts`:
  - fixture rows (under `mkTmp`) for `hostSource`, where a host and one lift sit in two members, and a lift that is not
    there yet is skipped;
  - fixture rows for `programOf` and `hostKey`;
  - the real `server.ts` row: `programFiles` is `[SRC]`, and `hostSource` equals `buildServer`'s text alone.

  Run Step 2 again. Expected: PASS.
- [ ] **Step 4: The ring and ratchet rows.**
  - `rings/fastify-l4.test.ts`: in "the files that reach fastify are exactly the allowlist", a member of a program
    whose source has an entry is allowed under that entry. A member that does not exist yet is not stale. The closing
    task writes each module's own entry and removes this clause.
  - `advance-switches.test.ts`'s ARCH-06 row `'server/src/server.ts': 23` falls to the count this PR measures
    (expected 0). Every literal pin over the file now reads through the view, as the pilot's Step 7 did.
  - `program-view.test.ts`'s `READS` (7) rises to this PR's count. This is the one raise of that ratchet, recorded
    under Deviations.
- [ ] **Step 5: Move every reader onto the program.** Each one stays green on `main`. The rules are:
  - **R1, a whole-file read** (`readFileSync`, `read`, `srcOf`, a `const … = read(…)`) becomes
    `programSource('server/src/server.ts')`.
  - **R2, a host-symbol read** (`sourceOfSymbol(…, 'buildServer')`, `symbolOf(…, 'buildServer')`, `argsOf(…,
    'buildServer', …)`, `parsedFile(…).calls`) becomes `hostSource('server/src/server.ts')`, or the calls parsed from
    it.
  - **R3, a per-file key** (a census row's `file`, a `holders` list, a per-file ceiling, a hand list of files to read)
    keeps the key `server.ts`. The scan reads `programTexts` and folds each member's result under `programOf(file)`.
  - **R4, a positional read** (a slice from one registration to the next, an `nth` site, a line walk):
    - it walks each member separately, resetting at each member's start;
    - an `nth` census over the program matches as a multiset of `(text, arm)`;
    - a caller-by-function list folds through `hostKey`.
  - **R5, a walk that skips `server.ts` by name** skips every program member.

  | Test file | What it reads | Rule |
  |---|---|---|
  | `auth-gate.test.ts` | `scanRoutes('server.ts')` in `ROUTES` and the count of 60; `:1068` and `:2104` whole-file reads | R3 (scanRoutes over the members), R1 |
  | `box-token-census.test.ts` | `SERVER_SRC` | R1 (each lane scan reads the program) |
  | `step-up.test.ts` | "each must be registered there, by its literal path" | R1 |
  | `auth-routes.test.ts` | the login handler, sliced from its registration to the next `\n  app.` | R4 |
  | `pool-accounts-route.test.ts` | the pools route, sliced 1,200 characters | R4 |
  | `routes.test.ts` | `serverRouteSources` (`^  app.(get\|post)`), the `knownId` claim, the `oversize` census | R4, R1 |
  | `coord-token.test.ts` | `sites('server.ts')` (route owner by position) | R4 |
  | `id-argv-census.test.ts` | `CENSUS` rows `file: 'server.ts'` by scope, `GATE_FILES`, `stopArgvFor`'s line walk | R3, R4 |
  | `consolidationCensus.ts` (`consolidation-census.test.ts`) | nine `RAN_TABLE` rows `file: 'server/src/server.ts'` with `nth` | R4 (multiset) |
  | `refusal-status.test.ts` | `INLINE_SEND_PINS`, `COMPUTED_SEND_PINS`, `ALLOWED_SPLITS` keyed `server.ts`; "server.ts answers it through refuseRoute" | R3 |
  | `registry-refused-census.test.ts` | `words('server.ts')`, `sitesOf('server.ts', …)`, `EXPECTED_SITES` keys | R3 |
  | `hibernate-census.test.ts` | the `tmux-verdict` row `file: 'server/src/server.ts'` | R3 |
  | `verb-gate.test.ts` | "finds call sites in both files" (`s.file === 'server.ts'`) | R3 |
  | `census-w3/questions.ts` | `QUESTION_DOOR_FILES` | R3 |
  | `lane-draft-never-blocks.test.ts` | `CALL_SITES` `{ file: 'server.ts', fn: 'POST /api/sessions/:id/prompt' }` | R3 |
  | `single-definition/injected-prompts.test.ts` | `OPERATOR_TEXT_SITES` `file: 'server/src/server.ts'` | R3 |
  | `injected-prompts-characterization.test.ts` | `callersOf` → `'server/src/server.ts#buildServer'` | R4 (`hostKey`) |
  | `secret-mask.test.ts` | `:1606` the `preSerialization` text; `:1792` `sourceOfSymbol(…, 'buildServer')`; `parsedFile(…).calls`; the `routeFiles()` walk skipping `server.ts` | R1, R2, R5 |
  | `notify-push.test.ts` | `:386` `sourceOfSymbol(…, 'buildServer')` | R2 |
  | `archive-admission.test.ts` | `parsedFile('server/src/server.ts').calls`, the archive `app.post` | R2 (the declaring member's parsed calls) |
  | `linear-rate.test.ts` | `argsOf(SERVER, 'buildServer', 'resolveTitle')` (the two title calls move with the workspace group) | R2 |
  | `pools-prose.test.ts` | `passage('server.ts, refusePool', …)` | R1 (`refusePool` stays; the read must still find it) |
  | `pane-history-route.test.ts` | `MEASURED` lists `'server/src/server.ts'` (F1's numbers ride the route's comment) | R3 |
  | `ccrc-versioned-audit.test.ts` | `findPwaRoot` (stays) and the candidate list | R1 |
  | `divergence-sweep.test.ts` | `bus.on('divergence', …)` (`/ws/fleet`, stays) | R1 |
  | `pwa-static-cache.test.ts` | the `fastifyStatic` registration (stays) | R1 |
  | `rings/host-imports.test.ts` | the `Deps` re-export (stays) | R1 |
  | `single-definition/vocabularies.test.ts` | "no bare `'operator'`" | R1 |
  | `single-definition/update-stall.test.ts` | `PANE_HISTORY_LINES` | R1 |
  | `single-definition/core-vocab.test.ts` | the `KeyedQueue` consumers, `READERS` | R1, R3 |
  | `single-definition/roster-bash.test.ts` | `srcOf('server/src/server.ts')`, `configDirFor` files | R1 |
  | `single-definition/ask-digest.test.ts` | `stallCode` over `coord/routes.ts` and `server.ts` | R1 |
  | `single-definition/advance-switches.test.ts` | `holders(/\brosterKindOf\(/)` → `server/src/server.ts`; the W1a list | R3 |
  | `single-definition/linear-refresher.test.ts` | `holders` → `['server/src/server.ts']` (a composition argument, stays) | R3 |

  The table is the measured list (`grep` for every read form over `server/test`, read one by one).
  - A read of a composition call that stays in `buildServer`, such as `linear-journal.test.ts`'s
    `registerLinearWorkspaceRoutes` arguments or `linear-rate.test.ts`'s proxy and Settings rows, needs no change.
  - Step 6's scratch proof is the check on this table.
- [ ] **Step 6: The scratch proof.** On a scratch copy of the branch:
  - run a crude version of all seven lifts and moves (a script; untyped, so tests only);
  - run every reader above, plus `server/test/rings`, `census-w3`, `census-w7`, `census-w8`, `single-definition`,
    `mail-routes` and `coordinator-skill`.

  Expected: no red that the same run on the unmoved copy does not show. A red names a reader that is missing from the
  table: add it to this PR. Delete the copy afterwards.
- [ ] **Step 7: Gates.** Every file in the table, `program-view`, `server-routes-pin`, then the Global Constraints
  gates. Expected: all green on the unmoved code.
- [ ] **Step 8: Commit** the named files: `test(large-files): server.ts's pin, scans read its program (D-8682)`.

### Task 2: The frozen stage (Q8), in the pin PR

**Files:** Create `server/test/growth-frozen/server-src-server-ts.json`.

**Gate: the operator's "Start a file" tap.** The ledger control is D-8635's open follow-up. The operator's 2026-11-14
answer, "start step 0 and the pilot", started the pilot only. So the coordinator asks for this start as a "Waiting on
you" item that carries its own answer control, citing this plan. The pin PR is opened after the answer.

- [ ] **Step 1:** Write `{"file": "server/src/server.ts", "d": "D-8682", "since": "<the PR's day>"}`.
- [ ] **Step 2: Run** `cd server && npx vitest run test/growth-caps.test.ts test/growth-check.test.ts`. Expected: PASS,
  with the summary listing the file as frozen.
- [ ] **Step 3: Commit:** `test(growth): freeze server.ts for its split (D-8682)`.

### Task 3: The lift verdict in the slice tool (its own PR; it may land beside Task 1)

**Files:** Modify `server/test/fileSplit.ts`, `.github/ci/file-split.mjs` and `server/test/file-split-pin.test.ts`.

**Interfaces** (in `fileSplit.ts`):
- `liftHeader(source: string, host: string): string`. It is the lifted function's first lead-comment line:
  ``/** Lifted out of `<host>` in `<source>` by hand; `.github/ci/file-split.mjs` judges it a pure lift (D-8682). */``.
  Any description of the function goes in its own comment below the marker. The line travels with the function into its module,
  where the move diff adds it to a file that has no host. That is not a lift, so the lift verdict answers null there
  (rule L0).
- `liftPlan(req: { source: string; host: string; routes: string[]; names: string[] }, text: string): LiftPlan` returns
  `{ statements: Array<{ key: string; line: number }>, captures: string[], returns: string | null, callLine: number,
  problems: string[] }`.
  - A **route key** (`'POST /api/notify'`) picks the host-body statement `app.<m>('<path>'…)`. A **name** picks the
    host-body statement that declares it (`const`, `let`, `function` or `type`), or an `app.addHook(…)` statement
    whose argument names it. That is how the `stepUp.noStore` hook is picked.
  - `captures` are the identifiers the picked statements reference that bind to a host-body declaration they do not
    contain, or to a host parameter. `app` is among them. They are bound with a syntax-only program, so a shadowing
    parameter is not a capture.
  - `returns` is the one picked declaration that a remaining host statement references.
  - `callLine` is the last picked statement's line.
  - Problems: `unknown-route <key>`, `unknown-name <n>`, `escapes <a>,<b>` (two or more picked declarations are used
    after the lift), and `captures-mutable <n>` (a `let` the picked code or the host assigns).
- `touchedHostStatements(text: string, host: string, hunks: readonly Hunk[]): string[]`: the keys of the host-body
  statements a hunk touches, lead comments included.
- `liftsOf(diff: string): Array<{ source: string; host: string }>`: the lift markers a diff adds, the heads file's
  partner to `movesOf`.
- `pureLiftVerdict(base: Tree, head: Tree): LiftVerdict | null`, where
  `LiftVerdict = { pure: boolean; file: string; host: string; lifted: string; statements: number; differing: string[] }`.
  The rules:
  - **L0.** The verdict is null unless a changed file that declares `host` at the base gains a `liftHeader` line.
  - **L1.** The marker leads a top-level function that is new at the head (`lifted`). It is the only new top-level
    declaration in the file (`two-lifts`, `no-function`).
  - **L2.** `lifted`'s body is the picked statements, each with its lead comments, byte-equal to its base text and in
    base order (`body:<n>`, `order`). It may end with one `return <x>;` where `<x>` is a picked declaration
    (`return`).
  - **L3.** The host at the head is the host at the base without those statements, with exactly one new statement
    where the last one stood: `lifted(…);` or `const <x> = lifted(…);` (`host:<detail>`).
  - **L4.** Every call argument is an identifier, or an object literal of shorthand properties. `lifted`'s parameters
    bind exactly those names, in the same positions or the same shorthand keys, whatever their type annotations
    (`binding:<name>`, `call`).
  - **L5.** Every other top-level statement of the file is equal, and import lines are free (`stmt:<n>`). No other
    code file changes (`rest:<file>`).
- `branchLiftVerdict(root, baseSha, headRef)`: the committed-tree twin of `branchVerdict`.
- `file-split.mjs` gains three verbs:
  - `lift-plan --source --host --routes 'K1,K2' --names a,b`;
  - `lift-preflight` (the same arguments plus `--heads`, `[--base]` and `[--self]`). It refuses `touched #n <key>`,
    `file-has-open-slice #n` (a head's `move.source` or `lift.source` is this source) and `unreadable #n`;
  - `lift-verdict --base <ref> [--head <ref>]`. Exit codes are as for the other verbs.

- [ ] **Step 1: Write the failing fixture tests** in `file-split-pin.test.ts`, under a new `describe('the lift
  verdict')`:
  - pure: a host of five statements, two of them lifted with one capture each, and the call where the second stood;
  - pure: the lifted function returns a declaration, and the call binds it (`const x = lifted(…)`);
  - impure, each with its word:
    - a lifted statement edited (`body:1`);
    - two statements swapped (`order`);
    - a host statement edited outside the cut (`host:…`);
    - the call placed before the last statement's old place (`host:…`);
    - an argument renamed (`binding:…`);
    - a second new function (`two-lifts`);
    - a test file changed (`rest:…`);
  - null: a feature diff, and a move diff whose destination carries the travelled lift marker;
  - `liftPlan`: the captures and the `returns` of a fixture, `escapes` on two escaping names, `captures-mutable` on a
    `let` the cut assigns;
  - `touchedHostStatements`: a hunk in a body, in a lead comment, and between two statements;
  - `liftsOf` on a synthetic diff.
- [ ] **Step 2: Run** `cd server && npx vitest run test/file-split-pin.test.ts`. Expected: FAIL (not exported).
- [ ] **Step 3: Implement** the interfaces and the verbs. Run Step 2. Expected: PASS.
- [ ] **Step 4: The REAL row.** It now also asserts that this branch's diff against `moveBase` is a pure lift whenever
  it adds a lift marker (null on this PR and on every feature PR). Then an end-to-end row in a fixture repository (git
  environment scrubbed, spawned through `spawnSyncGroup`): `lift-verdict --base` answers pure on a committed fixture
  lift, and `lift-preflight` refuses a head that edits a picked statement.
- [ ] **Step 5: Prove it on a scratch copy.** Lift the notify group on a copy of `origin/main` by hand. Then:
  - `lift-plan` lists its 7 routes and captures `app`, `deps` and `bus`;
  - after the commit, `lift-verdict` answers `pure: true` with `statements: 7`;
  - the server typecheck is clean.

  Record the counts in the PR body, then delete the copy.
- [ ] **Step 6: Gates** (Global Constraints). **Commit:** `feat(file-split): judge a lift, a host's statements moved
  unchanged into one top-level function (D-8682)`.

### Tasks 4 to 10: the slices, a lift PR then a move PR each

**Gate for each slice:** Tasks 1 to 3 on `main`, the previous slice's move merged, and preflight passing. Each task
runs these steps, with the arguments the task gives.

**The lift PR:**
- [ ] **Step L1: Preflight.** Write `heads.json` as described in "The heads file", then run
  `node .github/ci/file-split.mjs lift-preflight --source server/src/server.ts --host buildServer --routes '<keys>'
  --names <names> --heads heads.json` (`--self <n>` once the PR is open). Expected: exit 0 and `"refusals": []`.
- [ ] **Step L2: Plan.** Run `lift-plan` with the same arguments. Expected: the task's statement count, its captures
  exactly, its `returns`, and `problems: []`.
- [ ] **Step L3: Lift, by hand.**
  - Cut the planned statements and paste them, unchanged and in order, as the body of the task's function.
  - Place the function directly above `buildServer`.
  - Its lead comment starts with `liftHeader`.
  - Its parameters bind the captures by name: `app`, then the host parameters it uses, then one destructured object
    of the locals.
  - Write the call where the last statement stood.
  - Nothing else changes.
- [ ] **Step L4: Gates.**
  - The task's suites, the `server-routes-pin` hook-stack row, and the Global Constraints gates.
  - `growth-check`: the lift's delta must be at most +10.
- [ ] **Step L5: Commit** `server/src/server.ts` alone:
  `refactor(server): <group>'s routes lift into register…, a pure lift (D-8682)`.
- [ ] **Step L6: Verdict, on the commit.** Run `node .github/ci/file-split.mjs lift-verdict --base "$(git merge-base
  origin/main HEAD)"`. Expected: exit 0, `pure: true`, `differing: []`, and the task's statement count. `null` is a
  failure: the marker is missing. If the verdict is impure, undo the commit, re-run from L3, and push only after a
  pure verdict.

**The move PR** (after the lift merges):
- [ ] **Step M0: The context row**, when the task names one: add the file row to the 08-10 spec's table.
- [ ] **Step M1: Preflight.**
  `node .github/ci/file-split.mjs preflight --source server/src/server.ts --dest <dest> --names <names> --heads heads.json`.
  Expected: exit 0, `"ok": true`, `"slots": ["<context>"]` and `"refusals": []`.
- [ ] **Step M2: Plan.** Expected: `destContexts` `["<context>"]`, `sourceUsesDest` as the task says, `problems: []`.
- [ ] **Step M3: Move** (`file-split.mjs move …`).
- [ ] **Step M4: Gates.** The task's suites, then the Global Constraints gates.
- [ ] **Step M5: Commit** the files `move` wrote and the spec row, by name:
  `refactor(server): <dest> moves out of server.ts, a pure move (D-8682)`.
- [ ] **Step M6: Verdict, on the commit,** as the pilot's Step 6: `pure: true`, `differing: []`, the task's moved
  count, and test files changed on import lines alone.

No slice edits a pin. Task 1 already reads every pin through the program and through `hostSource`, so neither a lift
nor a move changes what a scan sees.

### Task 4: notify and push → `server/src/notifyRoutes.ts` (C6)

- **Lift:** `registerNotifyRoutes(app, deps, bus)`.
  - Routes: the 7 of the table's row 4.
  - Captures: `app`, `deps` and `bus`. `returns` is null.
  - It stands where `POST /api/digest/correct` stood (`:2673`), so the push routes register after the docs plugin's
    flush. The hook-stack row proves that this changes nothing.
- **Move:** `--names registerNotifyRoutes`. `sourceUsesDest` is `registerNotifyRoutes`. Context row:
  `notifyRoutes.ts` in C6.
- **Suites:** `notify-push`, `notify-token`, `notify-addr`, `notice`, `push-outbox-characterization`,
  `push-composition-pin`, `digest-routes`, `digest-slots-pin` and `coord-token`.

### Task 5: fleet reads → `server/src/fleetRoutes.ts` (C1)

- **Lift:** `registerFleetRoutes(app, deps, watcher, { stateCachePath, lastOperatorAct })`.
  - Routes: the 5 of row 5. Names: `ownRosterFpOf` and `ownRosterFp`.
  - The routes are one contiguous run (`:1228` to `:1448`), so the call stands at the old place of `GET /api/models/:lane`.
- **Move:** `--names registerFleetRoutes,PROJECT_POOLS_REQUEST_BUDGET_MS`.
  - `server.ts` imports the constant back until Task 8 (`sourceUsesDest`).
  - Context row: `fleetRoutes.ts` in C1. `POST /api/fleet/reboot` is fleet-host control, and goes here with its one
    dependency, `config.ts` (C1).
- **Suites:** `fleet-health`, `fleet-wire-route`, `fleet-build-skew`, `overrides-route`, `lane-models`,
  `served-routes`, `served-read`, `fleetws` and `routes`.

### Task 6: the session's conversation → `server/src/sessionRoutes.ts` (C3)

- **Lift:** `registerSessionRoutes(app, deps, { knownId, sendDeps, notice, turnReads, pwaDec, runCcdOr502,
  answeredFrame })`.
  - Routes: the 9 of row 6.
  - The call stands at `GET /api/sessions/:id/clip/:name`'s place (`:3777`), below `turnReads` (`:3662`).
- **Move:** `--names registerSessionRoutes,MAX_ATTACHMENTS,MAX_UPLOAD_BYTES,UPLOAD_EXT_RE`. Context row:
  `sessionRoutes.ts` in C3.
- **Suites:** `pane-history-route`, `send`, `send-stash`, `dialog-tab`, `interrupt-route`, `submit-route`,
  `commands`, `commands-live-cwd`, `clip`, `sessions-route-route`, `knownid-registry-id`, `lane-draft-never-blocks`
  and `injected-prompts-characterization`.

### Task 7: workspace lifecycle → `server/src/workspaceRoutes.ts` (C4)

- **Lift:** `registerWorkspaceRoutes(app, deps, watcher, { knownId, sendDeps, pwaDec, runCcdOr502, ccd502, refusePool,
  readAccountPoolEdges, lastOperatorAct, coordRoutes, turnReads })`.
  - Routes: the 16 of row 7. Names: `parseOperatorRoute`, `projectWalk`, `stopPairWrapper`, `stopPairRefused`,
    `stopArgvFor`, `claimsPort`, `prTasks`, `SessionLinking` and `sessionLinking`.
  - The call stands at `POST /api/sessions/:id/workspace/reap`'s place.
- **Move:** `--names registerWorkspaceRoutes`.
  - The destination imports `PROJECT_POOLS_REQUEST_BUDGET_MS` from `./fleetRoutes.js`. The tool re-bases
    `server.ts`'s binding.
  - Context row: `workspaceRoutes.ts` in C4.
- **Suites:** `archive-door`, `archive-admission`, `archive-claims-choice`, `workspaces-route`,
  `workspaces-named-route`, `workspace-create`, `workspace-title-route`, `project-add-route`, `projects-route-cache`,
  `projects-route-class`, `projects-route-placement`, `sessions-route-body`, `pr-routes`, `pr-open-route`,
  `hold-gate`, `id-argv-census`, `hibernate-census` and `consolidation-census`.

### Task 8: pools and accounts → `server/src/poolRoutes.ts` (C1)

- **Lift:** `registerPoolRoutes(app, deps, watcher, { authAttempts, lastOperatorAct, readAccountPoolEdges,
  rosterWireOf, sessionAuth, stepUp, refusePool, sendDeps, turnReads, ccd502, knownId })`.
  - Routes: the 6 of row 8.
  - The call stands at `POST /api/sessions/:id/limit-wait`'s place. `GET /api/accounts` moves later in registration
    order, past `authAttempts` (`:2140`) and `readAccountPoolEdges` (`:2891`), which it captures.
- **Move:** `--names registerPoolRoutes,DEFAULT_POOL_LEASE_MS,resolvePoolLeaseMs,poolLease,POOL_LEASE_MS`.
  - `sourceUsesDest` is `registerPoolRoutes`, `poolLease` and `PROJECT_POOLS_REQUEST_BUDGET_MS` (the last through its
    `fleetRoutes.js` binding).
  - Repointed: `pool-accounts-route.test.ts`'s `resolvePoolLeaseMs` import.
  - Context row: `poolRoutes.ts` in C1.
- **Suites:** `accounts-route`, `accounts-route-lanes`, `project-pool-route`, `pool-accounts-route`,
  `pool-epoch-numeric-parity`, `swap-route-busy`, `swap-route-pool`, `swap-timeout-budget`, `limit-wait-read`,
  `served-account-acts`, `roster-wire-kind` and `pools-prose`.

### Task 9: auth → `server/src/auth/routes.ts` (C8; three review rounds)

- **Lift:** `const stepUp = registerAuthRoutes(app, deps, { authStore, loginLimiter, passkeys, registerChallenges,
  assertChallenges, passkeyLimiter, deviceLabel, secretNow, sessionAuth })`.
  - Routes: the 12 of row 9. Names: `rpProblem`, `warnedRpProblems`, `passkeyUnavailable` and `stepUp`, which also
    picks the `app.addHook('onSend', stepUp.noStore)` statement.
  - It is one contiguous run, from `:667` to `:1174`. `returns` is `stepUp`, because `GET /api/accounts`'s lifted
    call (Task 8) and `accountGate` read it.
- **Move:** `--names registerAuthRoutes,ANON_VISIBLE,anonymousStatus,ASSERT_START_VISIBLE,anonymousAssertStart`. No
  context row is needed (`auth/**`).
- **Suites:** `auth-routes`, `auth-passkey`, `auth-ratelimit`, `auth-gate`, `auth-wire`, `step-up`,
  `step-up-binding`, `secret-mask`, `box-token-census`, `account-routes-auth` and `refusal-status`.

### Task 10: the kickoff → `server/src/coord/kickoffRoute.ts` (C5)

- **Gate:** the pilot's cap PR merged, and no other file's open move PR holding C5. `preflight` refuses otherwise
  (`slot-held C5 #n`).
- **Lift:** `registerKickoffRoute(app, deps)`, in place.
- **Move:** `--names registerKickoffRoute`. No context row is needed (`coord/**`).
  - `mail-routes.test.ts`'s kebab census reads every file directly under `server/src/coord`. The route spells six
    kebab words: `bad-id`, `bad-request`, `bad-session-id`, `not-configured`, `registry-unmeasurable` and
    `unknown-session`. With the route at this place, that census stayed green in the scratch proof, so it already
    admits all six. Run it on the slice anyway.
- **Suites:** `kickoff-route`, `coord-kickoff`, `single-read-bad-id`, `mail-routes` and `coordinator-skill`.

### Task 11: The closing PR: the caps, and the prose the moves could not touch

There is no move marker and no lift marker, so both verdicts answer null.

**Gate: the operator's "Close a file" tap.** As in the pilot's Task 6, closing is an operator action. The coordinator
asks for it as a "Waiting on you" item that carries its own answer control, with the eight measured caps in the
question. The PR cites the answer.

**Files:**
- Create: `server/test/growth-caps/server-src-server-ts.json`, and one cap file for each of the seven modules
  (`server-src-notifyroutes-ts.json`, `server-src-fleetroutes-ts.json`, `server-src-sessionroutes-ts.json`,
  `server-src-workspaceroutes-ts.json`, `server-src-poolroutes-ts.json`, `server-src-auth-routes-ts.json`,
  `server-src-coord-kickoffroute-ts.json`).
- Delete: `server/test/growth-frozen/server-src-server-ts.json`.
- Modify:
  - `server/test/rings/fastify-l4.data.ts`: one entry per module, with its reason. Remove Task 1's program clause from
    `fastify-l4.test.ts`.
  - `server/src/server.ts`: header and comments only.

- [ ] **Step 1: Measure** each file's `codeLines` at HEAD. On the scratch copy `server.ts` measured 755 code lines,
  with every import kept. The real moves drop the imports that only moved code used, so measure again. Each cap is the figure + 40.
- [ ] **Step 2: Write the eight cap files** `{file, cap, d: "D-8682", since}`, and remove the freeze file.
  `GROWTH_FILES` keeps `server.ts`, because the cap stage takes precedence (D-8635 rule 1).
- [ ] **Step 3: Rewrite the prose.**
  - `server.ts`'s comments that describe a moved route by its place ("below", "above", `:443-446`) now name the module.
  - `grep -rn 'server\.ts' server/src` shows each remaining mention to be about composition, a socket or `/health`.
- [ ] **Step 4: Gates.** Run `npx vitest run test/growth-caps.test.ts test/growth-check.test.ts test/program-view.test.ts
  test/server-routes-pin.test.ts test/rings`, then the Global Constraints gates. Spec §1's items 2 to 5 then hold,
  with the pins staying in the tree.
- [ ] **Step 5: Commit:** `test(growth): cap server.ts and its seven route modules, measured + 40 (D-8682)`.

## Deviations found

- **D-8682 (2026-11-16)** — `large-file-server`: the plan for file 3 of the large-file programme. A pin PR moves every
  scan of `server/src/server.ts` onto its program (`PROGRAM_VIEWS`, a new `hostSource` for `buildServer` and the
  functions lifted out of it) and freezes the file. A tool PR gives `.github/ci/file-split.mjs` a lift verdict. Then
  seven groups of `buildServer`'s inline routes leave in a lift PR and a pure-move PR each, to `notifyRoutes.ts` (C6),
  `fleetRoutes.ts` (C1), `sessionRoutes.ts` (C3), `workspaceRoutes.ts` (C4), `poolRoutes.ts` (C1), `auth/routes.ts`
  (C8) and `coord/kickoffRoute.ts` (C5). A closing PR caps `server.ts` and the seven modules, each at its measured code
  lines + 40.
- **A lift before every move.** Spec §2 item 2 names pure moves of top-level declarations and delegate extraction of a
  method body. `buildServer`'s routes are statements inside one function, and neither the tool nor the spec covers
  that shape. The lift is the same idea one level down: the statements move unchanged, the host keeps one call, and the
  captures become same-named parameters. Step 0's tool judges pure moves only. Its plan left delegates to "a later
  step, by its own plan", so this plan adds the lift verdict (Task 3), and the tool judges every slice. `watch.ts` step
  2 and the `routes.ts` drain can reuse it.
- **More modules than the spec's four targets.** §3 sends sessions to one `sessionRoutes.ts` (C3). By
  `ringContextMap.ts`, the 37 session routes span five contexts:
  - conversation (C3);
  - workspace and PR lifecycle: create, ensure, stop, archive, restore, forget, hold, release, title, audit, reap and
    the PR pair (C4);
  - pools, swap and the limit wait (C1);
  - the digest (C6);
  - the kickoff (C5).

  One C3 module would mix five contexts, against §1's "one context and one ring per module". So the routes go to their
  contexts. The fleet reads (`/api/fleet*`, `/api/models/:lane`), which §3 does not place, go to a C1 module of their
  own.
- **The seven modules' names.** §3 names `auth/routes.ts` and `sessionRoutes.ts`. The other five are this plan's. Five
  of the seven are new root-level files, so each needs a context row, which its move PR writes (a dead row is refused
  earlier). `auth/routes.ts` is covered by `auth/**`.
- **Registration order may change, by the "last place" rule.** A lift's call stands where its group's last statement
  stood, so some routes register later than before. For example, the push routes register after the docs plugin's
  flush, and `GET /api/accounts` registers after `authAttempts`. Fastify 5.12 composes every lifecycle hook at
  `preReady`, and takes the error handler at the next flush, which is the same handler. Only `onRoute` acts at
  registration, and every call stands below it. The hook-stack row of the pin measures this on every slice.
- **Shared helpers stay in `buildServer`.** `knownId`, `sendDeps`, `runCcdOr502`, `ccd502`, `refusePool`,
  `readAccountPoolEdges`, `turnReads`, `pwaDec`, `sessionAuth`, `lastOperatorAct` and `rosterWireOf` are captured by
  two or more groups. They remain composition-level wiring, passed in. Moving their logic into deciders is behaviour
  work for later plans, not part of a pure split.
- **`PROJECT_POOLS_REQUEST_BUDGET_MS` lives in `fleetRoutes.ts`.** It is a pool-read budget that three C1 and C4 groups
  read. The tool moves a name with the first slice that needs it, and refuses a `cycle` back into `server.ts`. Its
  natural home is `pools.ts`, and moving it there is a one-line follow-up after the close.
- **The pool-lease warning stays a top-level statement of `server.ts`.** The tool moves declarations, not an `if`. The
  warning still runs once at import, now reading `poolLease` from `poolRoutes.ts`.
- **Program members inherit the fastify allowlist entry until the close.** `fastify-l4.test.ts` holds its list
  exactly, and a move PR may not edit it (the REAL row). Task 1 lets a program member stand under its source's entry,
  and Task 11 writes each module's own entry.
- **The pilot's read ratchet is raised once.** `program-view.test.ts`'s `READS` "may only shrink". Task 1 raises it
  once, to count `server.ts`'s readers moved onto the view, which replace 23 ARCH-06 literal pins.
- **The start needs a tap.** The 2026-11-14 answer started the pilot and step 0 only, so Task 2 asks for the start as a
  "Waiting on you" item with its own control. Task 11's close does the same, as in the pilot.
- **The design's counts, re-measured.** The design counted 12 auth routes from `:679`, 37 session routes from `:2433`
  to `:4347`, and 14 `register…Routes` calls, at `218a5e3a3`. At `9cf263d44` there are 12 auth routes from `:667`, the
  same 60 routes in total, and 18 registration calls. Four registration calls landed since the design.

## Known limits

- The figures after the split come from the table and a crude scratch move. They are `server.ts` near 1,550 lines
  and at most 755 code lines, and each module's size. Task 11 measures them again.
- The lift verdict leaves types to `tsc`. A capture that the call does not pass is a compile error (TS2304), and a call
  above a capture's declaration is TS2448. The verdict does not repeat those checks.
- `lift-plan`'s captures are bound syntactically, so a capture used only in a type position is listed. Pass it anyway,
  or the verdict's binding rule reds.
- A non-literal scanner that reads a member without the view is refused by no guard, the same width as the pilot's.
  The pure-lift and pure-move review lenses check for it.
- The scratch proof (Task 1 Step 6) finds readers that go red. A reader that would narrow without going red is found
  by reading, as listed in Review Focus 1.
