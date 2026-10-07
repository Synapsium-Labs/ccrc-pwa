# Centralised update management, wave 14: the halt on the home screen, with its Ack in place; Update all says why it waits; the skew banner says what will really move the lagging box (R15): Implementation Plan

The coordinator scoped wave 14 on 2026-10-06: the programme ledger's 07:07 UTC entry mapped the residue to waves 13 to 19, and its 16:03 entry opened run 299 with deviation block 4266 to 4285 before run 287 closed. A workflow drafted this plan on 2026-10-06 (a scout, then a prototyping drafter) from `main` at `8b0547b48c89ac5bb72ddbcf7580a4ddf097aa46` (#295, wave 13). It then revised the plan against an attack panel with two lenses, product and pins. The revision re-measured every changed row in its own worktree at `8b0547b4`, at a load of 15 to 23 on 16 cores. Rows marked *(prototype)* were run through the real file with vitest and restored with `cp` and `cmp`. The plan's file is `docs/superpowers/plans/2026-10-06-centralised-update-w14-halt-on-home.md`.

**The product shape is confirmed.** The operator saw the designs on 2026-10-06 (question 4 of the 07:07 entry: "Ack in place on the home screen's halt banner") and ruled at 19:00 UTC: "all recommended". Every Reading at the end is ruled as recommended; see "Coordinator rulings on this plan's readings".

**Claims changed since drafting (measured at revision, about 17:30 UTC).**
- Claims 1048 and 1049 (child-reclamation wave 5, run 260) have **ended**. So `pwa/src/fleet/fleet.css` and `pwa/test/contrast.test.ts` are unclaimed now. Task 4 writes `fleet.css` in place, after the claims re-read every task starts with.
- Claim **1056** (ccrc-history wave 2, run 302, created 16:59 UTC) now holds `server/test/single-definition.test.ts`. This wave **no longer writes that file**. Its five holder pins moved into the wave's own new `server/test/update-move.test.ts`, with their own walk of the same four roots.
- Claim 1055 (run 302) holds `shared/lifecycle.ts`, `ccd/session-hook.sh`, `ccd/ccrc`, `README.md`, `CLAUDE.md` and other paths. Claim 1053 (run 271) holds the delegation rig. None of them is a File-structure path.
- The scope check is now **derived from the live claims at run time** (Global Constraints), not hand-kept.

**`main` has moved since drafting.** At revision it is `4db20aa17` (#305). Between `8b0547b4` and it, `main` changed none of this wave's files. It did change `single-definition.test.ts`, which this wave no longer touches. Task 1 Step 1 merges `main`.

**Wave 14 is a PWA wave with one small server touch.** Before the operator taps, the home screen must say three things: who halts the fleet, whether the console can move a node, and whether auto will move it. Those are the update dispatcher's own predicates. A PWA copy would be a second spelling of each, beside `server/src/update/dispatch.ts`. So the halt rule, the three capability clauses and `autoPermits` move to a new L0 file, and the dispatcher calls them (D-4266). No route, no wire field and no store write changes.

One line per task:
- **Task 1.** New L0 file `shared/update-move.ts`, holding `DETACH_CAP`, `isHaltingUpdate`, `carriesDetachCap`, `carriesUpdateGate`, `agentPredatesUpdateOp` and `autoPermits` (moved whole). `dispatch.ts`'s `isHalting`, `moveRefusal`'s three capability clauses and its `autoPermits` now call into it, and it re-exports `DETACH_CAP` and `autoPermits` (D-4266). New `server/test/update-move.test.ts` has 15 cases, the holder census among them. The dispatch ring test gains the specifier.
- **Task 2.** The one Ack. `canAck` and the Ack's tap move from `SettingsScreen.tsx` to a new `pwa/src/fleet/updateAck.ts`, which the screen re-exports. `sendAck` now answers how the Ack ended: `acked`, `unreadable` or `refused` (D-4267).
- **Task 3.** New `pwa/src/fleet/updateHalt.ts`, pure. It holds `haltingNodes`, `leaseUnreadable`, `haltLine`, `updateAllHaltedText`, `skewHaltLead`, `consoleCanMove`, `autoWouldMove` and `skewRemedy` (whose `halt` arm carries `then`). New `pwa/test/update-halt.test.ts` has 36 cases.
- **Task 4.** R15(a). New `pwa/src/fleet/HaltBanner.tsx`: one row per halting node, with that node's **Ack**. The Ack is gated by `canAck`, sent by `sendAck`, and held down after a clean 200 until a poll shows a different lease. Its rules are appended to `fleet.css`. `FleetScreen.tsx` mounts the banner between the fleet-host banner and the release banner. New `pwa/test/halt-banner.test.tsx` has 13 cases; `fleet-screen.test.tsx` gains one describe of 2 cases.
- **Task 5.** R15(b). While a node halts, **Update all** is disabled. A second `.update-banner-msg` line, tied to it by `aria-describedby`, names the node and the Ack. The `halted` sentence now names where the Ack is (D-4268). The move sheet now says a `halted` skip even for a node its plan never named (D-4269). Tests: `update-banner` +3, `update-move-sheet` +2, and one literal in `api.test.ts`.
- **Task 6.** R15(c). The skew arm's remedy comes from `skewRemedy`:
  - while a halt stands: the halt and its Ack, then what happens after the ack (auto, or the terminal);
  - when auto would move every node that has a tag to move to: the console's own move;
  - otherwise, including when no inventory answer has come or a lease cannot be read: today's `ccrc rollout`/`ccrc update` sentence.

  `FleetScreen.tsx` hands the banner the view's intent. `fleet-host-banner` gains 5 cases.
- **Task 7.** The gate and the PR.

**Live effect.** The server bundle ships the PWA, so everything here reaches the server box with the first release after the merge, by auto. The `dispatch.ts` change does not change behaviour: every moved predicate answers exactly as before. Task 1's equivalence and source pins show it, and so do the 92 `update-dispatch`, 15 `update-auto-dispatch`, 53 `update-apply-routes` and 85 `update-converge` cases, which are unchanged and were measured green at revision. The fleet box gets no change it acts on, so fleet-first ordering does not matter.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:**
- While any node halts the fleet, the home screen names it, the tag it last tried and its detail, and offers its **Ack** in place. The Ack goes through `POST /api/updates/ack` and the same `canAck` the Settings row uses, and it cannot be sent twice against one lease.
- **Update all** never answers a 202 the operator cannot act on. While a node halts, it is disabled, with a reason that names the node and the Ack. Any `{all: true}` reply that skips a node as `halted` is said in the sheet.
- The skew banner stops advising `ccrc rollout`/`ccrc update` when auto will move the lagging box. While a halt stands it points at the halt. It never says the console or auto will move a box when the dispatcher would not.
- Who halts, whether the console can move a node, and whether auto would move it are each answered by ONE predicate, shared by the dispatcher and the PWA.

**Architecture:**
- **L0, `shared/update-move.ts` (new).** It imports only `./api.js` and `./agent-protocol.js`. The PWA bundles it, so the header sentence in `shared/agent-protocol.ts` that says nothing under `pwa/src` imports it TODAY becomes false. That sentence is rewritten in place, three lines for three (D-4266).
- **L1, `server/src/update/dispatch.ts`.** `isHalting` delegates. `moveRefusal`'s `no-detach-cap`, `no-update-gate` and `agent-predates-update-op` clauses call the predicates, in their existing order. `autoPermits` is gone from the file. `DETACH_CAP` and `autoPermits` are re-exported, so `routes.ts` and every test keep their imports.
- **PWA, pure:** `fleet/updateAck.ts` (the gate and the tap) and `fleet/updateHalt.ts` (the reads).
- **PWA, delivery:** `HaltBanner.tsx`, plus edits to `UpdateBanner.tsx`, `FleetHostBanner.tsx`, `UpdateMoveSheet.tsx`, `FleetScreen.tsx`, `SettingsScreen.tsx`, `lib/api.ts` and `fleet.css`.
- **One poll.** `FleetScreen`'s `useUpdatesView()` stays the screen's only `/api/updates` reader. The halt banner receives the view and polls nothing; `fleet-screen.test.tsx` pins the single call.
- **No server route changes.** `{all: true}` still answers 202, as `routes.ts`'s docstring says ("`{all: true}` always answers 202"). A 409 was considered and rejected (Reading 10).
- **No wire change.** The halt is derived from `NodeWire.update.state` and `.detail`, and the auto arm from `channel`, `desiredTag`, `caps`, `agentOps`, `reachable` and `os`. `shared/api.ts` gains nothing.

**Tech Stack:** TypeScript on node, at the floor `main` sets (`>=22.13.0` at `8b0547b4`). React 19, vitest 4.1 and Testing Library in `pwa/`; vitest in `server/`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` (§10 the halt and the auto path, §13 the PWA). No section changes. The inputs are R15 in the ledger (`docs/superpowers/programs/centralised-update-management.md` on the coordination branch) and the operator's screenshot entry of 2026-10-05 12:12.

**Producers:**
- `main` at `8b0547b4` (#295, wave 13); `origin/main` at revision is `4db20aa17` (#305).
- The ledger's R15, and its entries of 2026-10-05 12:12 and 12:36: the halt, the two skipped applies at 12:18:59 and 12:19:15, and the ack at 12:21:44.
- This plan's scout, read-only at `8b0547b4`.
- This plan's prototype, at `8b0547b4` (load 32 to 44), and its revision, re-measured at `8b0547b4` (load 15 to 23).
- The attack panel's findings (product and pins lenses), ruled in the revision record.

**D-refs this plan cites as they stand:**
- D-3378: a `failed` row with a `provenance:` detail is a verdict on the release, and does not halt.
- D-3408: `waiting-for-fleet`.
- D-3401: the sheet says a skip of a node it named.
- D-3312: the skew trigger is `health.build`.
- D-3183 and D-3310: Ack only on a settled lease.
- D-3305: `UPDATE_GATE_CAP` lives in L0.
- D-3412: the store's notion of the halt.

## Not in this wave

Reviewers: do not raise these.

- **The store's own forms of the halt.** `server/src/coord/store.ts`'s `haltingRowSql` (SQL) and `rowHalts` (JS) stay as they are. `update-store-nodes.test.ts`'s heir-guard spread already pins them to agree with `isHalting`. Folding `rowHalts` onto `isHaltingUpdate` goes on the residue list (Reading 12). Claim 1048 has ended, but the store is not this wave's.
- **The Settings screen's own gate-cap read** (`SettingsScreen.tsx:87`, `n.caps.includes(UPDATE_GATE_CAP)` in the auto-gate blocker list). It could ask `carriesUpdateGate`. That goes to residue, so Task 2's Settings edit stays a pure move.
- **A server-side change to `{all: true}`.** It keeps answering 202 with `skipped` (Reading 10).
- **A wire field for "halted"** (it would need a `shared/api.ts` change). The PWA derives the halt from the lease, through the L0 rule.
- **Per-node intent.** The skew arm reads the fleet intent row only, as Settings does (`view.intent.find((i) => i.scope === FLEET_SCOPE)`). A per-node override set from a shell is invisible to it (Reading 6).
- **Standing requests that a racing `{all: true}` wrote while a halt stood.** They move after the ack, by design (`NO_HALT`, `routes.ts`). The halt banner does not list them (Reading 11).
- **Settings' release-row Install while a halt stands.** It still sends `{all: true}`, and D-4269 makes the sheet say the halted skip (Reading 16).
- **A stale view after a failed poll** (Reading 15).
- **README and spec text.** README's skew and Update-all passages (claim 1055) and the spec are the coordinator's follow-up (Reading 13).
- **Every other residue item.** The 07:07 entry maps them to waves 15 to 19.
- **Everything under the live claims** (Global Constraints).

## Global Constraints

- **Anchors.**
  - Every anchor is measured at `8b0547b4` and quoted.
  - Step 1 of each task re-measures its anchors by QUOTED TEXT (`grep -nF`) on the tip being built. Do it after `git fetch origin main`, and after the merge in Task 1 Step 1. The quote wins over any line number.
  - Find code with graphify first (`graphify query "…"` over `graphify-out/`), then confirm with `grep -nF`.
- **Scope.**
  - Change the files in File structure, and nothing else.
  - **Never write** `docs/superpowers/specs/*`, the programme ledger, `README.md`, `CLAUDE.md`, or any path under a live claim.
  - Re-read the live claims before the first edit, before Task 4 Step 4 (the CSS) and before the push.
  - If a live claim names a File-structure path, stop and mail the coordinator. At revision none does; `fleet.css`'s claim (1048) has ended.
  - **The scope check is derived from the live claims at run time.** The client prints its `http 200` status on stderr, with no newline after the JSON, so drop stderr rather than deleting a line (measured: `sed '$d'` deletes the whole JSON). The check prints nothing:

        ~/.local/bin/ccrc-api claims list --project ccrc-pwa 2>/dev/null \
          | jq -r '.claims[] | select(.state == "live") | .paths[]' > "$SCRATCH/claimed"
        test -s "$SCRATCH/claimed" || echo "NO LIVE CLAIM PATH READ: re-read the claims before trusting this check"
        xargs -a "$SCRATCH/claimed" -r git diff --name-only origin/main...HEAD --
        git diff --name-only origin/main...HEAD -- docs/superpowers/specs docs/superpowers/programs README.md CLAUDE.md \
          server/test/single-definition.test.ts

    At revision the first command read 51 paths from claims 1053, 1055 and 1056. The `git diff` pathspecs cover a claimed directory (for example `server/test/fixtures/history`) as well as a file.
  - `git diff --stat origin/main...HEAD` lists exactly the files in File structure.
- **The design system.**
  - No colour pairing is new. The banner paints with the attention pair that the fleet-host banner's warn arms and `.substrate-banner` already use: 8.52:1 dark and 4.94:1 light, measured by `node design/contrast-check.mjs`.
  - The Ack is the shared `.btn-primary` with a layout-only override, and it keeps `min-height: var(--tap-min)`.
  - Update all's reason reuses `.update-banner-msg`.
  - No child rule sets a colour.
- **Safety.**
  - Tests use fixture data only. No case reaches a real server, a real HOME or a real `gh`.
  - Never run `ccrc update`, `rollback`, `rollout`, `install` or `deploy.sh`, and never run `ccd` against the live HOME.
  - Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or the `claude-session@*` units.
  - Never read `~/.cc-secrets` or `~/.ccrc/mail.token`.
- **Mutation-table discipline.**
  - Before each mutation, `cp <file> "$SCRATCH/<id>.orig"`. Never `git checkout --`, and never a bare `git stash`.
  - Apply the mutation and run the named commands. Restore with `cp`, check with `cmp`, then confirm that `git status --porcelain` shows only this wave's files.
  - A row is done only with a measured red count and the assertion that fired. Each row lists its full expected red set; report any difference, never accept it silently.
  - The tables were measured in the revision worktree at `8b0547b4`. A row whose file sits beside an edit from the merge is re-measured against the merged text.
- **D-numbers.**
  - This plan defines D-4266 to D-4269, from the block issued to run 299 (4266 to 4285), in `## Deviations found`.
  - **The worker's reserve is 4270 to 4274.** Take reserve numbers in order. Define each one in this plan's `## Deviations found`, in the commit that first cites it. Write any other unspent number of the block bare, or not at all.
  - Never write a number outside the block. 4286 to 4295 is wave 15's block (run 300). Never call the allocator. Never land a `D-TBD-` spelling.
  - The commit that first writes D-4266 to D-4269 anywhere tracked must contain this plan, or come after the commit that does.
- **Suites.**
  - Run each file in the foreground, one command per call, inside its package, with a timeout of at least 600000 ms and under 600 s of wall time: `./node_modules/.bin/vitest run test/<file>.test.ts[x] [-t "<pattern>"]`. Never a bare `npx vitest`. Never split a file by `file:line`.
  - Run `npm ci` in `server/`, `pwa/` and `agent/` wherever `node_modules` is absent. `typecheck-tests` needs `agent/`'s; without it, it reds on `Cannot find module 'ws'`.
  - `TMPDIR` and all scratch go under the session's scratchpad (`$SCRATCH/tmp`; `mkdir -p` it).
  - **`-t` is a regex over the full test name.** A title containing `(` selects nothing unless escaped, so the `-t` filters below contain no parentheses. A filtered run that reports zero tests fails the gate.
  - The box is loaded. Prefer `-t` while iterating, then run each whole file at the end of its task.
- **No residue in tracked text:** no hostname, username, absolute home path, mount path, docserver URL or org name. Run `topology-clean.test.ts` after `git add` of each new or changed file.
- **Commits.**
  - Commit on the workspace branch only, at least once per task: `feat(update): …`, `refactor(update): …`, `test(update): …`. Never on a separate feature branch.
  - The author and committer are the noreply identity.
  - Send the wave-done in the same turn as the push. Never end a turn to wait on CI.

## Review Focus

1. **One rule for who halts, and one each for the auto path.**
   - `isHaltingUpdate` is the dispatcher's own `isHalting`, word for word, now in L0. `update-move.test.ts` pins it over every `UPDATE_STATES` value × a nine-detail spread, and pins that `dispatch.isHalting` answers through it on every pair.
   - `autoPermits` moved whole and is pinned over `AUTO_MODES` × `UPDATE_CHANNELS` ∪ {null}. `dispatch.autoPermits === autoPermits`.
   - The three clause calls are pinned in `dispatch.ts`'s source.
   - The census in the same file pins each name to one file. It also pins the exact spelling `startsWith(PROVENANCE_DETAIL_PREFIX)` on a code line to exactly three holders: `shared/update-move.ts`, `server/src/coord/store.ts` (the store's own JS form, residue) and `server/src/update/inventory.ts` (a different question).
   - **What the census does not see:** a copy spelled another way (a `'provenance:'` literal, `indexOf`, or a bare `failed || reverted`; `canAck` holds that pair legitimately). The census pins that one spelling, not every possible fourth spelling.
2. **One Ack, sent once per lease.**
   - The halt banner's button is `disabled={!canAck(n, releases) || acking || acked}`, and its tap is `sendAck`, the pair the Settings row calls.
   - `canAck` is driven behaviourally: a pass-through `vi.fn` lets one case make it refuse, and the rendered Ack is then disabled (T4-1).
   - A property case pins that every row the halt rule names passes `canAck`, over every state × a detail spread (T4-11). This stops a settled state added later from halting the fleet while its Ack stays disabled.
   - After a clean 200 or an unreadable answer, the row stays down, labelled `Acked`, until a poll shows a different lease. A second tap against the same lease sends nothing (T4-8, T4-10). A refusal re-arms the row (T4-9).
3. **Update all on a halted fleet.** It is disabled and described by a line that names the halting label(s) and the Ack (checked with `toHaveAccessibleDescription`), and it opens no sheet. The line promises nothing about what moves after the ack. A `failed` row with a `provenance:` detail does not disable it, and the first poll after the ack re-enables it. The 29 existing `update-banner` cases stay green, including `expect(all).not.toHaveAttribute('aria-describedby')` on a healthy fleet.
4. **No silent 202.** The scout found one silent shape: a halting row the plan does not name (it already runs the tag), beside a node that IS requested. The sheet now says `Not requested — server: <halted sentence> Requested: fleet.` and stays open. Every other unnamed skip stays unsaid (T5-4, T5-5).
5. **The skew advice says only what will happen.**
   - The `auto` arm requires the fleet intent's auto to be a known word other than `off`, and at least one node with a `desiredTag`. Every such node must be one `autoWouldMove` accepts: `consoleCanMove`, `carriesUpdateGate` (`no-update-gate`), `autoPermits(auto, channel)`, and a `desiredTag` to move to. That is the dispatcher's own auto path (`intendedMove` and `moveRefusal`), from L0.
   - The `halt` arm's `then` is computed by the same rule over the same rows, so its sentence never says "auto-install then moves the lagging box" when it would not. Measured cases cover auto off, no update-gate, and nodes the console cannot move.
   - A lease that cannot be read, no inventory answer, or no node with a tag to move to all answer `cli`.
   - The live agent link is not on the wire, so the `auto` arm says "can move", never "is moving".
6. **Nothing throws on a malformed row.** `isNodeElement` does not validate `update`, `caps`, `agentOps` or `channel`, so every read here is defensive. The cases feed `update: undefined`, `null`, `{state: 7}`, `caps: undefined`, `agentOps: undefined`, `reachable: undefined` and `channel: 'nightly'`. A throw would blank the home screen, because `pwa/src` has no error boundary. A lease that cannot be read vouches for nothing: `skewRemedy` answers `cli` for it. The halt banner and Update all treat it as not halting (Reading 14).
7. **The design system.**
   - `.halt-banner` paints its own ground with an existing pair that meets the floor.
   - The census in `contrast.test.ts` ("contains no identities beyond the grandfathered blind spots") reds when a child rule sets a colour or the banner rule drops its background (C-1, C-4).
   - The button override is layout-only (C-2), and the banner is not sticky (C-3).
   - All four rows were measured in place in the revision.

## Risk notes

- **Claims move.** Claim 1048 ended after drafting, and claim 1056 started after it. The scope check reads them at run time. If a later claim names a File-structure path, stop and mail the coordinator rather than routing around it.
- **Load-sensitive cases.**
  - `update-store-nodes.test.ts`'s case "the heir guard IS `isHalting`" timed out once at vitest's 20 s default in the prototype's full-file run (load 44). It passed alone in 19.97 s. It builds 27 SQLite stores, and the delegation adds no work to it. Re-run it in isolation before calling it red; CI on a quiet box is the arbiter.
  - `typecheck-tests` is on CLAUDE.md's list of load flakes.
- **`dispatch.ts` is live server code.** The change is a delegation that gives the same answers (Review Focus 1). `routes.ts` imports `DETACH_CAP` and `isHalting` from `dispatch.js` and is untouched. `autoPermits` keeps its export from `dispatch.js`, which `update-dispatch.test.ts` imports.
- **The PWA now bundles `shared/agent-protocol.ts`**, through `update-move.ts`, for `UPDATE_OP`. That file imports only `./buildinfo.js` and `./api.js`, so nothing from `node:*` reaches the bundle, and `vite build` is green. Its header sentence is corrected in place and the line count does not change: `server/src/remote/io.ts` cites `shared/agent-protocol.ts:105`, which does not move.
- **Line citations.**
  - `FleetScreen.tsx` gains one import line above lines that two source comments cite (`useProjectedHome.ts:19` → `FleetScreen.tsx:145`, and `RunsScreen.tsx` → `:288-294`). Both had already drifted, and no suite reads them.
  - `dispatch.ts` gains lines near its top, but nothing cites `update/dispatch.ts` by line: `grep -rn "update/dispatch.ts:[0-9]"` over the four roots finds nothing.
  - The pwa test files are edited by APPENDING at the end, except `api.test.ts`'s one literal and `fleet-host-banner.test.tsx`'s type import, both edited in place.
- **`fleet.css` is a large shared sheet.** The block is appended at the end, after the last rule at `8b0547b4`.
- **Wording is product text.** Every sentence the operator sees is a constant or a pure function with an exact-text test. So the operator's ruling on Readings 2 to 9 and 17 changes strings, not structure.

## Deviations found

These are departures from R15 as ruled, from the brief's "PWA wave", or from what shipped text at `8b0547b4` documents.

- **D-4266** — *The halt rule, `moveRefusal`'s three capability clauses and `autoPermits` move from `server/src/update/dispatch.ts` to a new L0 file, `shared/update-move.ts`, and the dispatcher calls them. This is a server touch in a PWA wave.*
  - **Ruled:** R15 is "product, for a PWA wave". The brief prefers "the smaller change that keeps one decision in one place".
  - **Shipped:**
    - The halt rule lived in `dispatch.ts`'s `isHalting`, with the store's two forms beside it.
    - `detach`, `update-gate` and the agent's op were read inline in `moveRefusal`.
    - `autoPermits` was declared in `dispatch.ts`.
    - The PWA could import none of them, and computed no halt at all.
  - **Now:**
    - `isHaltingUpdate`, `carriesDetachCap`, `carriesUpdateGate`, `agentPredatesUpdateOp`, `autoPermits` and `DETACH_CAP` are declared only in `shared/update-move.ts`, pinned by the census in `update-move.test.ts`.
    - `dispatch.ts` delegates, in the same clause order, and re-exports `DETACH_CAP` and `autoPermits`.
    - The ring test's import set gains `../../../shared/update-move.js`.
    - The header sentence in `shared/agent-protocol.ts` that says nothing in `pwa/src` imports it is rewritten, because the PWA now does, transitively.
  - **Why not a PWA copy:** it would be another spelling of who halts, and of when auto moves a node, that nothing forces to agree with the dispatcher. The skew banner's `auto` advice has to be the dispatcher's auto path or it advises a move that never comes.
- **D-4267** — *`canAck` and the Ack's tap move out of `pwa/src/screens/SettingsScreen.tsx` into `pwa/src/fleet/updateAck.ts`. The screen re-exports `canAck` and `ACK_UNREADABLE_TEXT`. The tap, `sendAck`, answers how the Ack ended.*
  - **Ruled:** "the same route and the same `canAck`".
  - **Shipped:** `canAck`, `ACK_UNREADABLE_TEXT` and the inline `ack` closure lived in the screen file, so a fleet component would have had to import a screen. The closure answered nothing.
  - **Now:**
    - `updateAck.ts` holds `canAck` (body byte-identical), `ACK_UNREADABLE_TEXT`, and `sendAck(nodeId): Promise<AckOutcome>`, which answers `acked`, `unreadable` or `refused` and never rejects.
    - The Settings row calls `void sendAck(n.nodeId).finally(…)` and ignores the answer.
    - The halt banner uses the answer to hold its row down until a poll shows a different lease. `ackNode` acks any settled row, idle included, and clears its request, so a second tap against a stale view is not harmless.
    - `settings-screen.test.tsx` keeps its import from the screen and is unchanged (132 green).
- **D-4268** — *The `halted` sentence is reworded to name where the Ack is.*
  - **Shipped:** `'An update failed or was reverted — acknowledge that node before moving any other.'` (`lib/api.ts`, pinned at `api.test.ts:1289`). The operator read it at 12:18:59 and 12:19:15, while the only Ack was on another screen and was labelled **Ack**, not "acknowledge".
  - **Now:** `'An update failed or was reverted, and nothing moves until that node is acknowledged — tap Ack on it in the halt banner on the fleet screen, or on its row in Settings.'`
    - The single-node 409 path still appends `Blocked by: <labels>.` (`moveErrorText`).
    - `moveSkipText('halted')` reads the same table, so every door says the same sentence.
- **D-4269** — *The move sheet says a `halted` skip even for a node its plan never named.*
  - **Shipped:** `UpdateMoveSheet.tsx`'s header and the `moveSkippedText` docstring say: "a skip of a node the sheet never listed is the plan agreeing with the server, and is not said." So a 202 that requested one node and skipped an unnamed halting one closed the sheet silently, while the request waited for an ack.
  - **Now:** `halted` is the one exception, and the node is named through the plan's inventory (`moveLabel`). Every other unnamed skip stays unsaid.

- **D-4270** — *`autoWouldMove` also asks the dispatcher's `stamp-unread` clause, which moves to L0 as `stampUnread` (`shared/update-move.ts`); `dispatch.ts`'s `currentOf` calls it. A second server touch, in D-4266's shape. (Worker reserve; Task 3 fix round 1.)*
  - **Found:** Task 3's review. The resolver gives a `desiredTag` to a node whose stamp did not read, or whose running version is not a release tag, because `floorOf` falls back to the floor file and `ResolveInput` carries no `stampRead`. `moveRefusal` then answers `stamp-unread` on every tick. The plan's `autoWouldMove` did not ask this, so the skew banner said auto moves the lagging box (or `then: 'auto'` behind a halt) where the dispatcher never would. That is against Reading 6(a) as ruled ("only where the dispatcher's own auto path would move every lagging node"). On the fleet row it is worse: `fleetAuto` also holds the server's auto move `waiting-for-fleet`.
  - **Now:** `stampUnread(stampRead, currentVersion)` is declared only in `shared/update-move.ts`, pinned by the census in `update-move.test.ts`. `currentOf` answers `unread` through it with the same answers for every input. `autoWouldMove` refuses a node it answers true for, reading `stampRead` and `current.version` off the wire; a `stampRead` that is not a string reads as unread.
  - **Not taken:** a standing request outranks auto (`intendedMove`), so a refused or unreadable request also keeps a node still while `autoWouldMove` says auto would move it. Answering false for any request would turn the banner to the terminal verbs while a console move the operator just tapped is under way. That is a product call, so it goes to residue beside Reading 11.
- **D-4271** — *The skew banner's `auto` arm (and a halt's `then: 'auto'`) also requires every node to END on the same release tag — its `desiredTag`, else the release tag it runs — not merely every tagged node to be one auto would move. (Worker reserve; Task 6 fix round 1, found by Task 6's review.)*
  - **Found:** the plan's `autoArm` asked only the nodes that carry a `desiredTag`. A lagging box with none — rolled back past the newest release (the resolver's `rolledBack`), or hand-placed off the release lane (no version, no floor) — beside a leading box that has one answered `auto`. Auto then moves the LEADING box and the skew widens. A pin below the leader answered `auto` too, and the skew stays. Each made the sentence false, against Reading 6 as ruled ("only where the dispatcher's own auto path would move every lagging node").
  - **Now:** `endTag` (the tag the resolver gave the node, else the release tag it runs, else null) must be one release tag across every node, as well as the plan's conditions. Each of these cases now falls back to the terminal verbs. No operator-visible string changes. `fleet-host-banner`'s R15(c) `movable` fixture now gives a lagging node the leading build's tag (`v0.0.9`) and a node already on it NULL, as a real converged row has. Its two cases about a node auto or the console cannot move now put that node on the LAGGING side. `update-halt`'s converged-node case gives its converged node the tag it runs.

- **D-4272** — *The halt banner's Ack re-arms at once only on a refusal the server gave (an `ApiError` 4xx). An answer that could not be read, or no answer at all (a fetch rejection, any 5xx, a timeout), holds the row until a successful read taken after the outcome; `sendAck` gains a fourth outcome word, `unanswered`. (Worker reserve; coordinator fix round 1, review 307 F1.)*
  - **Ruled:** the coordinator, on review 307's F1, which meets bar class 2: "an Ack that can be sent twice against one lease". A refusal is an answer the server gave; a request with no answer is not a refusal.
  - **Shipped (`3f5f382c`):** `sendAck` mapped every rejection to `refused`, and the row re-armed on it. When the ack committed but its response was lost (a fetch TypeError, a proxy 502/504) and the re-poll failed too, the view kept the same lease, the button re-armed, and a second tap acked the now-idle row again, clearing its request and its refusals. That was measured twice by review 307.
  - **Now:**
    - `AckOutcome` is `acked | unreadable | refused | unanswered`. `refused` is a 4xx `ApiError`; `unanswered` is any other rejection. The toasts are unchanged.
    - The halt banner holds a clean 200 until a poll shows a different lease, as before.
    - It holds `unreadable` and `unanswered` until a fresh successful read: the view object differs from the one present when the outcome arrived (a failed read keeps the object; the hook's newest-issued guard drops a read issued before the re-poll). If that read still shows the same lease, it re-arms; otherwise the row follows the read.
    - `Acked` shows only after a 2xx. An `unanswered` hold shows `Ack`, disabled. The button's accessible name follows its visible label (`Ack <label>` / `Acked <label>`, review 307 F3).
    - The Settings row still ignores the outcome.

The worker's reserve: numbers 4273 to 4274, written bare until defined (4270, 4271 and 4272 are spent above).

## File structure

**New**
- `docs/superpowers/plans/2026-10-06-centralised-update-w14-halt-on-home.md` (this plan).
- `shared/update-move.ts` (Task 1).
- `server/test/update-move.test.ts` (Task 1; it also carries the holder census).
- `pwa/src/fleet/updateAck.ts` (Task 2).
- `pwa/src/fleet/updateHalt.ts` (Task 3).
- `pwa/test/update-halt.test.ts` (Task 3).
- `pwa/src/fleet/HaltBanner.tsx` (Task 4).
- `pwa/test/halt-banner.test.tsx` (Task 4).

**Changed**
- `server/src/update/dispatch.ts` (Task 1): one import, the two re-exports and their comments, the body of `isHalting`, three `moveRefusal` clauses, and `autoPermits` removed; Task 3 fix round 1 (D-4270): the stampUnread import and currentOf's delegation.
- `server/test/update-dispatch.test.ts` (Task 1): the ring case's title and import set.
- `shared/agent-protocol.ts` (Task 1): three header comment lines, rewritten in place.
- `pwa/src/screens/SettingsScreen.tsx` (Task 2): one import, the re-export, `canAck` removed, and the `ack` closure now calls `sendAck`.
- `pwa/src/fleet/fleet.css` (Task 4): one block appended.
- `pwa/src/screens/FleetScreen.tsx` (Tasks 4 and 6): one import, the halt banner's mount, and `intent` passed to the fleet-host banner.
- `pwa/test/fleet-screen.test.tsx` (Task 4): one describe appended.
- `pwa/src/fleet/UpdateBanner.tsx` (Task 5): the header paragraph, `useId`, the reason line, `disabled` and `aria-describedby`.
- `pwa/src/fleet/UpdateMoveSheet.tsx` (Task 5): the header sentence and `moveSkippedText`.
- `pwa/src/lib/api.ts` (Task 5): the `halted` sentence and its comment.
- `pwa/test/update-banner.test.tsx` and `pwa/test/update-move-sheet.test.tsx` (Task 5): one describe appended to each.
- `pwa/test/api.test.ts` (Task 5): the literal at line 1289.
- `pwa/src/fleet/FleetHostBanner.tsx` (Task 6): the header bullet, the `intent` prop, and the skew arm's remedy.
- `pwa/test/fleet-host-banner.test.tsx` (Task 6): one import name, and one describe appended.

**Run, not edited:**
- pwa: `settings-screen`, `move-plan`, `use-updates-view`, `build-line`, `contrast`, `fleet-css`.
- server: `single-definition` (claim 1056 holds it; this wave adds nothing to it, and it must stay at `main`'s count), `update-apply-routes`, `update-auto-dispatch`, `update-converge`, `update-lease-holder`, `update-op-answer`, `update-routes`, `update-store-nodes`, `update-watchdog-revert`, `update-summary`, `box-token-census`, `typecheck-tests`.
- the ledger and scope guards: `topology-clean`, `dtbd`, `deviation-refs`.

## Tasks

### Task 1: The halt rule, the three capability clauses and `autoPermits` in L0; the dispatcher calls them (D-4266)

**Files:** `shared/update-move.ts` (new), `server/src/update/dispatch.ts`, `server/test/update-dispatch.test.ts`, `shared/agent-protocol.ts`, `server/test/update-move.test.ts` (new).

**Interfaces:**
- Produces:
  - `DETACH_CAP = 'detach'`;
  - `isHaltingUpdate(state: string, detail: string | null): boolean`;
  - `carriesDetachCap(caps: readonly string[]): boolean`;
  - `carriesUpdateGate(caps: readonly string[]): boolean`;
  - `agentPredatesUpdateOp(agentOps: readonly string[] | null): boolean`;
  - `autoPermits(auto: AutoMode, channel: UpdateChannel | null): boolean`.
- Consumed by: `dispatch.ts` (this task), `pwa/src/fleet/updateHalt.ts` (Task 3), and the census in `update-move.test.ts` (this task).

- [ ] **Step 1: Re-read the claims, merge `main`, then re-measure.**
  ```bash
  ~/.local/bin/ccrc-api claims list --project ccrc-pwa 2>/dev/null | jq -r '.claims[] | select(.state == "live") | "\(.id) \(.paths | join(" "))"'
  git fetch origin main
  git merge --no-edit origin/main          # 4db20aa17 at revision; record `git show --remerge-diff HEAD`
  cd server
  grep -nF "export const DETACH_CAP = 'detach';" src/update/dispatch.ts                                   # 28
  grep -nF "import { floorOf, type EligibilityRow } from './resolve.js';" src/update/dispatch.ts             # 24
  grep -nF "  if (row.updateState === 'failed' && row.updateDetail !== null && row.updateDetail.startsWith(PROVENANCE_DETAIL_PREFIX)) return false;" src/update/dispatch.ts   # 96
  grep -nF "export function autoPermits(auto: AutoMode, channel: UpdateChannel | null): boolean {" src/update/dispatch.ts   # 111
  grep -nF "  if (!row.caps.includes(DETACH_CAP)) return 'no-detach-cap';" src/update/dispatch.ts            # 195
  grep -nF "  if (move.source === 'auto' && !row.caps.includes(UPDATE_GATE_CAP)) return 'no-update-gate';" src/update/dispatch.ts   # 197
  grep -nF "  if (row.agentOps !== null && !row.agentOps.includes(UPDATE_OP)) return 'agent-predates-update-op';" src/update/dispatch.ts   # 198
  grep -nF "      '../../../shared/api.js', '../../../shared/agent-protocol.js', '../../../shared/semver.js', './resolve.js'," test/update-dispatch.test.ts   # 756
  grep -nF '// Nothing under `pwa/src` imports this file TODAY (it reaches for `shared/api`' ../shared/agent-protocol.ts   # 10
  grep -rn "autoPermits" src ../pwa/src ../shared ../agent/src | grep -v node_modules     # dispatch.ts only
  grep -rn "update/dispatch.ts:[0-9]" ../server/src ../server/test ../pwa ../shared ../agent/src | grep -v node_modules   # nothing
  ./node_modules/.bin/vitest list test/update-dispatch.test.ts | wc -l     # 92
  ```
  Stop and report if `main` changed `dispatch.ts`, `SETTLED_UPDATE_STATES`, `PROVENANCE_DETAIL_PREFIX`, `UPDATE_GATE_CAP`, `AutoMode` or `UpdateChannel` in `shared/api.ts`, or `UPDATE_OP` in `shared/agent-protocol.ts`.
- [ ] **Step 2: Write the cases first (red).** Create `server/test/update-move.test.ts`:
  ```ts
  // shared/update-move.ts (centralised-update programme wave 14, R15; D-4266) — the dispatcher's halt rule, its three
  // capability clauses and autoPermits, moved to L0 so the PWA's halt banner and skew advice ask the SAME predicates.
  // These cases pin the L0 rules, that dispatch.ts answers through them rather than through a copy, and (the census at
  // the end) that each is declared once.
  import { readFileSync, readdirSync, statSync } from 'node:fs';
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { describe, expect, it } from 'vitest';
  import { AUTO_MODES, UPDATE_CHANNELS, UPDATE_GATE_CAP, UPDATE_STATES } from '../../shared/api.js';
  import { UPDATE_OP } from '../../shared/agent-protocol.js';
  import {
    DETACH_CAP, agentPredatesUpdateOp, autoPermits, carriesDetachCap, carriesUpdateGate, isHaltingUpdate,
  } from '../../shared/update-move.js';
  import * as dispatch from '../src/update/dispatch.js';

  const here = path.dirname(fileURLToPath(import.meta.url));
  const DETAILS: (string | null)[] = [null, '', 'gate: unit not up', 'provenance:', 'provenance: unsigned bundle', 'Provenance: x',
    'PROVENANCE: x', ' provenance: x', 'x provenance: y'];

  describe('isHaltingUpdate — spec §10 and D-3378', () => {
    it('reverted halts; failed halts unless its detail BEGINS provenance:; idle and every busy state never halt', () => {
      for (const state of UPDATE_STATES) {
        for (const detail of DETAILS) {
          const want = state === 'reverted' || (state === 'failed' && !(detail ?? '').startsWith('provenance:'));
          expect(isHaltingUpdate(state, detail), `${state} / ${JSON.stringify(detail)}`).toBe(want);
        }
      }
    });

    it('a state this build cannot name is not settled, so it does not halt', () => {
      expect(isHaltingUpdate('halted', null)).toBe(false);
      expect(isHaltingUpdate('', null)).toBe(false);
    });

    it('dispatch.ts\'s isHalting answers through it, over every state and detail', () => {
      for (const updateState of UPDATE_STATES) {
        for (const updateDetail of DETAILS) {
          expect(dispatch.isHalting({ updateState, updateDetail }), `${updateState} / ${JSON.stringify(updateDetail)}`)
            .toBe(isHaltingUpdate(updateState, updateDetail));
        }
      }
    });
  });

  describe('the capability clauses — moveRefusal\'s no-detach-cap, no-update-gate and agent-predates-update-op', () => {
    it('carriesDetachCap reads the one word, which dispatch.ts re-exports', () => {
      expect(DETACH_CAP).toBe('detach');
      expect(dispatch.DETACH_CAP).toBe(DETACH_CAP);
      expect(carriesDetachCap(['detach'])).toBe(true);
      expect(carriesDetachCap(['update-gate', 'rollback'])).toBe(false);
      expect(carriesDetachCap([])).toBe(false);
    });

    it('agentPredatesUpdateOp: NULL is the server\'s own row and is never checked; an agent must list the op', () => {
      expect(agentPredatesUpdateOp(null)).toBe(false);
      expect(agentPredatesUpdateOp([UPDATE_OP])).toBe(false);
      expect(agentPredatesUpdateOp(['tail', UPDATE_OP])).toBe(false);
      expect(agentPredatesUpdateOp([])).toBe(true);
      expect(agentPredatesUpdateOp(['tail'])).toBe(true);
    });

    it('carriesUpdateGate reads shared/api.ts\'s one gate word', () => {
      expect(carriesUpdateGate([UPDATE_GATE_CAP])).toBe(true);
      expect(carriesUpdateGate(['detach', 'rollback'])).toBe(false);
      expect(carriesUpdateGate([])).toBe(false);
    });

    it('dispatch.ts asks them, and spells no clause itself', () => {
      const src = readFileSync(path.join(here, '..', 'src', 'update', 'dispatch.ts'), 'utf8');
      expect(src).toContain("if (!carriesDetachCap(row.caps)) return 'no-detach-cap';");
      expect(src).toContain("if (move.source === 'auto' && !carriesUpdateGate(row.caps)) return 'no-update-gate';");
      expect(src).toContain("if (agentPredatesUpdateOp(row.agentOps)) return 'agent-predates-update-op';");
      expect(src).not.toMatch(/caps\.includes\(DETACH_CAP\)|caps\.includes\(UPDATE_GATE_CAP\)|agentOps\.includes\(UPDATE_OP\)/);
      expect(src).toContain('return isHaltingUpdate(row.updateState, row.updateDetail);');
    });
  });

  describe('autoPermits — moved whole from dispatch.ts (D-4266)', () => {
    it('off never; stable only a node resolved to stable; channel any resolved channel, never an unresolved one', () => {
      for (const auto of AUTO_MODES) {
        for (const channel of [...UPDATE_CHANNELS, null]) {
          const want = auto === 'channel' ? channel !== null : auto === 'stable' ? channel === 'stable' : false;
          expect(autoPermits(auto, channel), `${auto} / ${String(channel)}`).toBe(want);
        }
      }
    });

    it('dispatch.ts re-exports the L0 function and declares none of its own', () => {
      expect(dispatch.autoPermits).toBe(autoPermits);
      const src = readFileSync(path.join(here, '..', 'src', 'update', 'dispatch.ts'), 'utf8');
      expect(src).not.toMatch(/function autoPermits\b/);
    });
  });

  describe('the ring', () => {
    it('shared/update-move.ts imports only its shared siblings — the PWA bundles it', () => {
      const src = readFileSync(path.join(here, '..', '..', 'shared', 'update-move.ts'), 'utf8');
      const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)]
        .map((m) => m[1] ?? m[2]);
      expect(new Set(specs)).toEqual(new Set(['./api.js', './agent-protocol.js']));
      expect(/\brequire\(|import\(/.test(src)).toBe(false);
    });
  });

  // The holder census (centralised-update wave 14, R15; D-4266, D-4267). It lives HERE, not in single-definition.test.ts,
  // because that file was another programme's claim when this wave was planned. The walk is single-definition's own: the
  // same four roots, and the same `__`-prefix skip for a parallel suite's transient mutants. The home screen asks the
  // dispatcher's own questions, so the answers live in L0 and `server/src/update/dispatch.ts` calls them; the Ack's gate
  // lives in `pwa/src/fleet/updateAck.ts`, which the Settings screen re-exports.
  const ccrcRoot = path.resolve(here, '..', '..');
  const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(ccrcRoot, r));
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      if (e.startsWith('__')) continue; // a parallel suite's transient mutant (single-definition.test.ts says why)
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { out.push(...sources(p)); continue; }
      if (/\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  }
  const ALL = ROOTS.flatMap(sources);
  const rel = (p: string): string => path.relative(ccrcRoot, p).split(path.sep).join('/');
  const codeOnly = (f: string): string => readFileSync(f, 'utf8')
    .split('\n').map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l)).join('\n');

  describe('centralised-update wave 14: the halt rule, the move predicates and the Ack gate are declared once', () => {
    const DETACH_DEF = /^\s*(?:export\s+)?(?:const|let|var)\s+DETACH_CAP\b/m;
    const DETACH_LITERAL = /(['"])detach\1/;

    it('CONTROL: the walk sees every root; the patterns see a declaration and a quoted copy, not a re-export or prose', () => {
      for (const r of ROOTS) expect(sources(r).length, rel(r)).toBeGreaterThan(0);
      expect(DETACH_DEF.test("export const DETACH_CAP = 'detach';")).toBe(true);
      expect(DETACH_DEF.test('export { DETACH_CAP };'), 'a re-export declares nothing').toBe(false);
      expect(DETACH_LITERAL.test("caps.includes('detach')")).toBe(true);
      expect(DETACH_LITERAL.test('carries no `detach` cap'), 'a backticked prose mention').toBe(false);
    });

    it('DETACH_CAP is declared, and the word quoted, in shared/update-move.ts alone — dispatch.ts re-exports it', () => {
      expect(ALL.filter((f) => DETACH_DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/update-move.ts']);
      expect(ALL.filter((f) => DETACH_LITERAL.test(codeOnly(f))).map(rel)).toEqual(['shared/update-move.ts']);
    });

    it('each L0 predicate is declared in shared/update-move.ts alone', () => {
      for (const name of ['isHaltingUpdate', 'carriesDetachCap', 'carriesUpdateGate', 'agentPredatesUpdateOp', 'autoPermits']) {
        const re = new RegExp(`^\\s*(?:export\\s+)?(?:function|const)\\s+${name}\\b`, 'm');
        expect(ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/update-move.ts']);
      }
    });

    it('the provenance exception to a halt is tested on a code line only where the census names it', () => {
      // `startsWith(PROVENANCE_DETAIL_PREFIX)` is the halt rule's exception (shared/update-move.ts), the store's own JS
      // form (`rowHalts`, coord/store.ts — residue: another programme's claim held it when wave 14 was drafted), and the
      // inventory's refusal recorder (update/inventory.ts — a different question: is this report a verdict on the
      // release). It pins THIS spelling only: a copy written another way (a 'provenance:' literal, `indexOf`, a bare
      // `failed || reverted`) is not seen here.
      const PREFIX_TEST = /startsWith\(PROVENANCE_DETAIL_PREFIX\)/;
      expect(ALL.filter((f) => PREFIX_TEST.test(codeOnly(f))).map(rel).sort()).toEqual([
        'server/src/coord/store.ts', 'server/src/update/inventory.ts', 'shared/update-move.ts',
      ]);
    });

    it('canAck is declared in pwa/src/fleet/updateAck.ts alone — SettingsScreen re-exports it', () => {
      const re = /^\s*export function canAck\b|^\s*function canAck\b|^\s*(?:export\s+)?const canAck\b/m;
      expect(ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['pwa/src/fleet/updateAck.ts']);
    });
  });
  ```
  The census's `canAck` case goes green only after Task 2. Until then it reds on the holder list `['pwa/src/screens/SettingsScreen.tsx']`, which is expected.

  In `update-dispatch.test.ts`'s ring describe, replace the case's title and import set:
  ```ts
  it('dispatch.ts imports only the four shared modules and the resolver — no fs, no store, no link, no Runner', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'update', 'dispatch.ts'), 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)]
      .map((m) => m[1] ?? m[2]);
    // Wave 14 (D-4266): `shared/update-move.js` holds the halt rule, the capability predicates and autoPermits, which
    // the PWA asks too.
    expect(new Set(specs)).toEqual(new Set([
      '../../../shared/api.js', '../../../shared/agent-protocol.js', '../../../shared/semver.js', '../../../shared/update-move.js',
      './resolve.js',
    ]));
  ```
- [ ] **Step 3: Run, expect red.** `update-move` fails to import `../../shared/update-move.js`, because the file does not exist yet.
- [ ] **Step 4: Implement.** Create `shared/update-move.ts`:
  ```ts
  // L0 — what the update dispatcher and the PWA must answer ALIKE about one node (centralised-update design
  // 2026-09-20 §10, §13; programme wave 14, R15). Pure; it imports nothing but its `shared/` siblings, not even
  // `node:*`, because the PWA bundles it.
  //
  // The dispatcher (`server/src/update/dispatch.ts`, L1) decided these alone until wave 14. Then the home screen had
  // to say WHO halts the fleet, and whether the console can move a node at all, before the operator taps. A
  // PWA-local copy would be a second spelling of the dispatcher's own rule that nothing forces to agree with it. So
  // the rule moved here, and `dispatch.ts` calls it: `isHalting` delegates to `isHaltingUpdate`; `moveRefusal`'s
  // `no-detach-cap`, `no-update-gate` and `agent-predates-update-op` clauses ask the three predicates below; and
  // `autoPermits` (the auto clause of `intendedMove` and the fleet hold) moved here whole. Every caller keeps its
  // path, because `dispatch.ts` re-exports DETACH_CAP and autoPermits.
  //
  // NOT HERE: `server/src/coord/store.ts`'s SQL (`haltingRowSql`) and JS (`rowHalts`) forms of the halt. They are
  // the store's own notion and are pinned equal to `isHalting` by `update-store-nodes.test.ts`.
  import {
    PROVENANCE_DETAIL_PREFIX, SETTLED_UPDATE_STATES, UPDATE_GATE_CAP, type AutoMode, type UpdateChannel,
  } from './api.js';
  import { UPDATE_OP } from './agent-protocol.js';

  /** The `ccrc-caps` word for `ccrc update --detach` (wave 4's `_inst_caps`; Linux-only, decision 17). Every
   *  console move rides it, the server's own row's too. */
  export const DETACH_CAP = 'detach';

  /** A settled state other than `idle` halts dispatch until `ack` (spec §10). It is derived from the settled list,
   *  the way the store derives HALTED_UPDATE_STATES, so a settled state added later halts by default. The EXCEPTION
   *  is a `failed` row whose detail begins PROVENANCE_DETAIL_PREFIX: that is a verdict on the release, not a fault
   *  of the node (D-3378). A state this build cannot name is not settled, so it does not halt. */
  export function isHaltingUpdate(state: string, detail: string | null): boolean {
    if (!(SETTLED_UPDATE_STATES as readonly string[]).includes(state) || state === 'idle') return false;
    if (state === 'failed' && detail !== null && detail.startsWith(PROVENANCE_DETAIL_PREFIX)) return false;
    return true;
  }

  /** The node's `ccrc-caps` carry the one-tap (`moveRefusal`'s `no-detach-cap` when false). */
  export function carriesDetachCap(caps: readonly string[]): boolean {
    return caps.includes(DETACH_CAP);
  }

  /** The node's `ccrc-caps` carry the post-install health gate (`moveRefusal`'s `no-update-gate` for an AUTO move
   *  when false: auto never moves a node that cannot prove the move worked; an operator request still can). */
  export function carriesUpdateGate(caps: readonly string[]): boolean {
    return caps.includes(UPDATE_GATE_CAP);
  }

  /** 'off' → false; 'stable' → the node resolved to stable; 'channel' → it resolved to any channel. Moved whole from
   *  `dispatch.ts` in wave 14 (D-4266): the skew banner says "auto moves the lagging box" only where this says so. */
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

  /** The node is reached over an agent link (`agentOps` not NULL) whose agent does not list the update op
   *  (`moveRefusal`'s `agent-predates-update-op`). NULL is the server's own row, which no link carries, so it is
   *  never checked (decision 11). */
  export function agentPredatesUpdateOp(agentOps: readonly string[] | null): boolean {
    return agentOps !== null && !agentOps.includes(UPDATE_OP);
  }
  ```
  In `dispatch.ts`:
  - After `import { isNewerTag } from '../../../shared/semver.js';`, add:
    ```ts
    import {
      DETACH_CAP, agentPredatesUpdateOp, autoPermits, carriesDetachCap, carriesUpdateGate, isHaltingUpdate,
    } from '../../../shared/update-move.js';
    ```
  - Replace the `DETACH_CAP` declaration and its comment with:
    ```ts
    /** Wave 4's other two ccrc-caps words (`_inst_caps`; `detach` is Linux-only, decision 17). UPDATE_GATE_CAP is
     *  the third's one spelling (shared/api.ts, D-3305). DETACH_CAP moved to L0 in wave 14 (`shared/update-move.ts`,
     *  D-4266), because the PWA now asks whether the console can move a node; it is re-exported here so every caller
     *  keeps its import. ROLLBACK_CAP has no reader outside the server. */
    export { DETACH_CAP };
    ```
  - `isHalting`'s body becomes the following (its docstring stays):
    ```ts
      // Wave 14 (D-4266): the rule is L0's, so the PWA's halt banner and this dispatcher cannot disagree about who halts.
      return isHaltingUpdate(row.updateState, row.updateDetail);
    ```
  - Replace `autoPermits`'s docstring and declaration (the whole `switch`) with:
    ```ts
    // `autoPermits` moved to L0 in wave 14 (shared/update-move.ts, D-4266): the PWA's skew banner asks it too.
    export { autoPermits };
    ```
  - `if (!row.caps.includes(DETACH_CAP)) return 'no-detach-cap';` becomes `if (!carriesDetachCap(row.caps)) return 'no-detach-cap';`.
  - `if (move.source === 'auto' && !row.caps.includes(UPDATE_GATE_CAP)) return 'no-update-gate';` becomes `if (move.source === 'auto' && !carriesUpdateGate(row.caps)) return 'no-update-gate';`.
  - `if (row.agentOps !== null && !row.agentOps.includes(UPDATE_OP)) return 'agent-predates-update-op';` becomes `if (agentPredatesUpdateOp(row.agentOps)) return 'agent-predates-update-op';`.
  - Keep `isSettled`, the `PROVENANCE_DETAIL_PREFIX` re-export, `UPDATE_OP`, `UPDATE_GATE_CAP` (the `no-update-gate` sentence), and the `AutoMode` and `UpdateChannel` types. Other code in the file still reads each of them.

  In `shared/agent-protocol.ts`, replace lines 10–12, three lines for three:
  ```ts
  // Since centralised-update wave 14 `pwa/src` does import it, through
  // `shared/update-move.ts` (UPDATE_OP; D-4266), so the rule is now also a fact
  // about a bundled file — this repo reads its comments as history.
  ```
- [ ] **Step 5: Run** (server):
  - `update-move -t "isHaltingUpdate|capability|autoPermits|ring"` (**10**; the census describe's `canAck` case waits on Task 2);
  - `update-dispatch` (**92**), `update-apply-routes` (**53**), `update-auto-dispatch` (**15**), `update-converge` (**85**), `update-lease-holder` (**7**), `update-op-answer` (**45**), `update-routes` (**38**), `update-store-nodes` (**43**; see Risk notes), `update-watchdog-revert` (**16**), `box-token-census` (**23**);
  - `./node_modules/.bin/tsc --noEmit -p .` is clean.

  *(revision, measured: `update-move` 15 with Task 2 in place; `update-dispatch` 92, `update-auto-dispatch` 15, `update-apply-routes` 53, `update-converge` 85, `typecheck-tests` 12; `tsc` clean. The other counts are the prototype's.)*
- [ ] **Step 6: Mutation table** *(prototype; re-measured in the revision worktree at `8b0547b4`)*. Mutate the named file, with `cp` and `cmp` around each row.

  | Row | File | Mutation | Command(s) | Measured red |
  |---|---|---|---|---|
  | T1-1 | `shared/update-move.ts` | delete the `provenance:` exception line | `update-move`; `update-dispatch -t "the halt predicate"`; after Tasks 3–4 `update-halt`, `halt-banner` | `update-move` 2 (`reverted halts; failed halts unless …`, `the provenance exception to a halt is tested …`); `update-dispatch` 2 (`a failed row whose detail BEGINS provenance: …`, `fleetGate names the halting rows …`); `update-halt` 1 (`failed and reverted halt; …`); `halt-banner` 1 (`is silent with no view, …`) |
  | T1-2 | `dispatch.ts` | `isHalting` returns `row.updateState === 'failed' \|\| row.updateState === 'reverted'` | `update-move`; `update-dispatch -t "the halt predicate"` | `update-move` 2 (`dispatch.ts's isHalting answers through it …`, `dispatch.ts asks them, and spells no clause itself`); `update-dispatch` 2 (as T1-1) |
  | T1-3 | `dispatch.ts` | the detach clause back to `!row.caps.includes(DETACH_CAP)` | `update-move`; `update-dispatch` | `update-move` 1 (`dispatch.ts asks them …`); `update-dispatch` 92 green (same behaviour, as it must be) |
  | T1-4 | `dispatch.ts` | the agent clause back to `row.agentOps !== null && !row.agentOps.includes(UPDATE_OP)` | as T1-3 | as T1-3 |
  | T1-5 | `shared/update-move.ts` | add `import 'node:fs';` after the agent-protocol import | `update-move -t "the ring"` | 1 (`shared/update-move.ts imports only its shared siblings …`) |
  | T1-6 | `dispatch.ts` | the gate clause back to `!row.caps.includes(UPDATE_GATE_CAP)` | `update-move`; `update-dispatch` | `update-move` 1 (`dispatch.ts asks them …`); `update-dispatch` 92 green |
  | T1-7 | `shared/update-move.ts` | `case 'stable': return channel !== null;` | `update-move`; `update-dispatch`; after Task 3 `update-halt` | `update-move` 1 (`off never; stable only a node resolved to stable; …`); `update-dispatch` 2 (`off never; stable only on a stable-resolved node; …`, `auto off with a desiredTag moves nothing; auto stable on a dev-resolved node moves nothing`); `update-halt` 2 (`not with auto stable on a node resolved to dev`, `the terminal verbs when auto stable and a node resolved to dev`) |
- [ ] **Step 7: Commit:** `refactor(update): the halt rule, the capability clauses and autoPermits in L0, which the dispatcher calls (wave 14, R15; D-4266)`. If this plan is not on the branch yet, include it in the same commit.

### Task 2: The one Ack — `canAck`, `sendAck` and its outcome in `fleet/updateAck.ts` (D-4267)

**Files:** `pwa/src/fleet/updateAck.ts` (new), `pwa/src/screens/SettingsScreen.tsx`.

**Interfaces:**
- Produces:
  - `canAck(n: NodeWire, releases: readonly ReleaseWire[]): boolean` (body unchanged);
  - `ACK_UNREADABLE_TEXT`;
  - `type AckOutcome = 'acked' | 'unreadable' | 'refused'`;
  - `sendAck(nodeId: string): Promise<AckOutcome>` (never rejects).
- Consumed by: `SettingsScreen`'s `NodeItem` (this task) and `HaltBanner` (Task 4).

- [ ] **Step 1: Re-measure.**
  ```bash
  cd pwa
  grep -nF "export function canAck(n: NodeWire, releases: readonly ReleaseWire[]): boolean {" src/screens/SettingsScreen.tsx   # 354
  grep -nF 'export const ACK_UNREADABLE_TEXT = "Acknowledged — the server'"'"'s answer could not be read; the screen will re-check.";' src/screens/SettingsScreen.tsx   # 338
  grep -nF "    void api.ackUpdateNode(n.nodeId).then(" src/screens/SettingsScreen.tsx                  # 453
  grep -nF "import { UpdateMoveSheet } from '../fleet/UpdateMoveSheet';" src/screens/SettingsScreen.tsx   # 23
  grep -nF "postJsonOr<AckAnswer | 'unreadable'>('/api/updates/ack', 'unreadable', { nodeId })," src/lib/api.ts   # 682
  grep -rn "canAck\|ACK_UNREADABLE_TEXT" src test | grep -v "^src/screens/SettingsScreen.tsx"     # only test/settings-screen.test.tsx's import
  ```
- [ ] **Step 2: Implement.** This is a move: Task 4's banner is the new caller, and Task 4's tests are its red. Task 1's census case `canAck is declared in pwa/src/fleet/updateAck.ts alone` is this task's red now. Create `pwa/src/fleet/updateAck.ts`:
  ```ts
  // The ONE Ack (centralised-update design 2026-09-20 §13; programme wave 14, R15(a)). Two surfaces offer it, the
  // node's row in Settings and the home screen's halt banner. Both take the button's gate (`canAck`) and the tap
  // (`sendAck`) from this file. A second copy of either could let the two buttons disagree about one row. Both moved
  // here from `screens/SettingsScreen.tsx` (D-4267), which re-exports them, so a fleet component never imports a
  // screen.
  //
  // Ack is offered only on a SETTLED lease, because W2's ackNode acks from nothing else (D-3183; D-3310). The route
  // stays the authority: a row that went busy between the poll and the tap comes back as a 409 `busy`, rendered as
  // updateErrorText's sentence. The caller re-polls either way.
  import type { NodeWire, ReleaseWire } from '../../../shared/api';
  import { SETTLED_UPDATE_STATES } from '../../../shared/api';
  import { toast } from '../components/Toast';
  import { api, updateErrorText } from '../lib/api';

  export const ACK_UNREADABLE_TEXT = "Acknowledged — the server's answer could not be read; the screen will re-check.";

  export function canAck(n: NodeWire, releases: readonly ReleaseWire[]): boolean {
    const state = n.update?.state;
    // A busy lease (pending, applying, unknown), an absent state or a word this build cannot name: ackNode answers busy.
    if (typeof state !== 'string' || !(SETTLED_UPDATE_STATES as readonly string[]).includes(state)) return false;
    if (state === 'failed' || state === 'reverted') return true;
    if (typeof n.request === 'object' && n.request !== null) return true;
    return releases.some((r) => Array.isArray(r.refused) && r.refused.some((x: unknown) =>
      typeof x === 'object' && x !== null && (x as { by?: unknown }).by === n.nodeId));
  }

  /** How one Ack ended: `acked` (a clean 200), `unreadable` (a 2xx whose body would not parse — it may still have
   *  cleared the row) or `refused` (an error, said as its sentence). */
  export type AckOutcome = 'acked' | 'unreadable' | 'refused';

  /** `POST /api/updates/ack` for one node, said as a toast: nothing on a clean 200, ACK_UNREADABLE_TEXT when the
   *  answer could not be read, and the refusal's sentence on an error. It never rejects, so the caller's `.finally`
   *  (clear its busy flag, re-poll) always runs; it answers the outcome, so a caller can hold its button down until
   *  a poll shows the row changed (ackNode acks ANY settled row, idle included, and clears its request). */
  export function sendAck(nodeId: string): Promise<AckOutcome> {
    return api.ackUpdateNode(nodeId).then(
      (answer): AckOutcome => {
        if (answer === 'unreadable') { toast(ACK_UNREADABLE_TEXT); return 'unreadable'; }
        return 'acked';
      },
      (err: unknown): AckOutcome => { toast(updateErrorText(err), 'error'); return 'refused'; },
    );
  }
  ```
  In `SettingsScreen.tsx`:
  - After `import { UpdateMoveSheet } from '../fleet/UpdateMoveSheet';`, add `import { ACK_UNREADABLE_TEXT, canAck, sendAck } from '../fleet/updateAck';`.
  - Replace `export const ACK_UNREADABLE_TEXT = …;` with:
    ```ts
    // The Ack's gate and tap live in fleet/updateAck.ts since wave 14 (D-4267): the home screen's halt banner offers the
    // same Ack. Re-exported so this screen's callers and tests keep their import.
    export { ACK_UNREADABLE_TEXT, canAck };
    ```
  - Delete `export function canAck(…) { … }`: nine lines, and the blank line after.
  - In `NodeItem`, the `ack` closure becomes:
    ```ts
      const ack = (): void => {
        setAcking(true);
        void sendAck(n.nodeId).finally(() => {
          setAcking(false);
          onAcked();
        });
      };
    ```
  - Keep `api`, `toast`, `updateErrorText`, `SETTLED_UPDATE_STATES` and `ReleaseWire` imported: other code in the file uses each one. `noUnusedLocals` is on, so `tsc` checks this.
- [ ] **Step 3: Run:**
  - `pwa`: `settings-screen` (**132**), and `./node_modules/.bin/tsc --noEmit -p .` is clean;
  - `server`: `update-move` (**15**), and `single-definition` unchanged at `main`'s count (**275** at `8b0547b4`).

  *(revision, measured: as listed.)*
- [ ] **Step 4: Mutation table** *(prototype; re-measured in the revision)*.

  | Row | File | Mutation | Command(s) | Measured red |
  |---|---|---|---|---|
  | T2-1 | `updateAck.ts` | delete `sendAck`'s rejection-handler line | `halt-banner` (after Task 4); `settings-screen` | `halt-banner` 2 (`an unreadable answer and a refusal …`, `sendAck never rejects, …; it answers how the Ack ended`); `settings-screen` 1 (`a refused ack is the route's sentence in an error toast …`) |
  | T2-2 | `SettingsScreen.tsx` | drop `canAck` from the import; replace the re-export with `export { ACK_UNREADABLE_TEXT };` plus the screen's own `export function canAck(…)` answering `failed`/`reverted` only | `halt-banner` (after Task 4); `update-move -t "centralised-update wave 14"`; `settings-screen` | `halt-banner` 1 (`Settings re-exports the same function …`); `update-move` 1 (`canAck is declared in pwa/src/fleet/updateAck.ts alone …`); `settings-screen` 4 (`canAck: on a settled lease only …`, `a node named in refused[] has Ack enabled …`, `an outstanding request renders its line …`, `a refused ack is the route's sentence …`) |
  | T2-3 | `dispatch.ts` | drop `DETACH_CAP` from the update-move import, and declare `export const DETACH_CAP = 'detach';` in place of the re-export | `update-move -t "centralised-update wave 14"` | 1 (`DETACH_CAP is declared, and the word quoted, in shared/update-move.ts alone …`) |
- [ ] **Step 5: Commit:** `refactor(update): the Ack's gate, tap and outcome in fleet/updateAck.ts, re-exported by Settings (wave 14, R15; D-4267)`.

### Task 3: `updateHalt.ts` — who halts, Update all's reason, whether auto would move a node, and the skew remedy, as pure reads

**Files:** `pwa/src/fleet/updateHalt.ts` (new), `pwa/test/update-halt.test.ts` (new).

**Interfaces:**
- Produces: `haltingNodes(nodes)`, `leaseUnreadable(n)`, `haltLine(n)`, `haltLabels(halting)`, `updateAllHaltedText(halting)`, `skewHaltLead(halting)`, `SKEW_AUTO_TEXT`, `SKEW_HALT_THEN_AUTO_TAIL`, `consoleCanMove(n)`, `autoWouldMove(n, auto)`, `type SkewRemedy`, `skewRemedy(nodes, intent)`.
- Consumed by: `HaltBanner` (Task 4), `UpdateBanner` (Task 5) and `FleetHostBanner` (Task 6).

- [ ] **Step 1: Re-measure.**
  ```bash
  cd pwa
  grep -nF "export function isManagedNode(n: NodeWire): boolean {" src/fleet/movePlan.ts
  grep -nF "export function isAutoMode(v: unknown): v is AutoMode {" ../shared/api.ts
  grep -nF "export function isUpdateChannel(v: unknown): v is UpdateChannel {" ../shared/api.ts
  grep -nF "export const FLEET_SCOPE = '*';" ../shared/api.ts
  grep -nF "  channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null;" ../shared/api.ts   # NodeWire
  grep -nF "const isNodeElement = (v: unknown): v is NodeWire => {" src/fleet/useUpdatesView.ts   # it does not validate update, caps, agentOps or channel
  ```
- [ ] **Step 2: Write the cases first (red).** Create `pwa/test/update-halt.test.ts`:
  ```ts
  // updateHalt.ts (centralised-update programme wave 14, R15): who halts the fleet, what Update all says while a node
  // does, and which remedy the skew banner names. Pure reads of one /api/updates answer.
  import { describe, expect, it } from 'vitest';
  import type { NodeWire, UpdateIntentWire } from '../../shared/api';
  import { FLEET_SCOPE, UPDATE_STATES } from '../../shared/api';
  import { isHaltingUpdate } from '../../shared/update-move';
  import {
    autoWouldMove, consoleCanMove, haltLine, haltingNodes, skewHaltLead, skewRemedy, updateAllHaltedText,
  } from '../src/fleet/updateHalt';

  const FLEET_ID = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
  const SERVER_ID = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';
  /** A measured, reachable Linux fleet node the console can move: `detach` in its caps, an agent that lists the op. */
  const node = (over: Partial<NodeWire> = {}): NodeWire => ({
    nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
    current: null, stampRead: 'ok', installState: 'complete', provenance: 'verified',
    caps: ['detach', 'update-gate'], agentOps: ['update'], highestVersion: 'v0.0.7', previousVersion: null,
    measuredAt: 1, reachable: true, unreachableSince: null,
    channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
    request: null, report: null,
    update: { state: 'idle', target: null, startedAt: null, detail: null },
    ...over,
  });
  const server = (over: Partial<NodeWire> = {}): NodeWire =>
    node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
  const lease = (state: string, detail: string | null = null, target: string | null = 'v0.0.9'): NodeWire['update'] =>
    ({ state, target, startedAt: null, detail } as NodeWire['update']);
  const intent = (auto: string, scope = FLEET_SCOPE): UpdateIntentWire =>
    ({ scope, channel: 'stable', pinnedTag: null, auto, notify: 'off', setAt: 1, setBy: 'pwa' } as UpdateIntentWire);

  describe('haltingNodes — the dispatcher\'s own rule, from L0', () => {
    it('agrees with isHaltingUpdate over every lease state and a spread of details', () => {
      const details: (string | null)[] = [null, '', 'gate: unit not up', 'provenance:', 'provenance: unsigned', 'Provenance: x',
        ' provenance: x', 'x provenance: y'];
      for (const state of [...UPDATE_STATES, 'a-word-this-build-cannot-name']) {
        for (const detail of details) {
          const n = node({ update: lease(state, detail) });
          expect(haltingNodes([n]).length === 1, `${state} / ${JSON.stringify(detail)}`).toBe(isHaltingUpdate(state, detail));
        }
      }
    });

    it('failed and reverted halt; a provenance verdict, idle and every busy state do not', () => {
      expect(haltingNodes([node({ update: lease('failed', 'gate: unit not up') })])).toHaveLength(1);
      expect(haltingNodes([node({ update: lease('reverted') })])).toHaveLength(1);
      expect(haltingNodes([node({ update: lease('failed', 'provenance: signature does not verify') })])).toEqual([]);
      for (const s of ['idle', 'pending', 'applying', 'unknown']) expect(haltingNodes([node({ update: lease(s) })]), s).toEqual([]);
    });

    it('keeps inventory order, and reads a malformed lease as not halting rather than throwing', () => {
      const a = server({ update: lease('reverted') });
      const b = node({ update: lease('failed', 'x') });
      expect(haltingNodes([a, b]).map((n) => n.label)).toEqual(['server', 'fleet']);
      const broken = [{ ...node(), update: undefined }, { ...node(), update: null }, { ...node(), update: { state: 7, detail: 1 } }];
      expect(haltingNodes(broken as unknown as NodeWire[])).toEqual([]);
      expect(haltingNodes(null)).toEqual([]);
      expect(haltingNodes(undefined)).toEqual([]);
    });

    it('a failed row whose detail is not a string still halts — the server\'s NULL detail', () => {
      expect(haltingNodes([{ ...node(), update: { state: 'failed', target: null, startedAt: null, detail: 3 } } as unknown as NodeWire]))
        .toHaveLength(1);
    });
  });

  describe('haltLine and the Update all reason', () => {
    it('names the node, its state, its target and its detail, and leaves out what the lease does not carry', () => {
      expect(haltLine(node({ update: lease('failed', 'gate: unit not up') }))).toBe('fleet: failed (last tried v0.0.9) — gate: unit not up');
      expect(haltLine(node({ update: lease('reverted') })), 'a settled lease is never said as moving').toBe('fleet: reverted (last tried v0.0.9)');
      expect(haltLine(node({ update: lease('reverted', null, null) }))).toBe('fleet: reverted');
      expect(haltLine(node({ update: lease('reverted', '', '') }))).toBe('fleet: reverted');
    });

    it('Update all\'s reason names who halts and the Ack that clears it, and promises no move after it', () => {
      expect(updateAllHaltedText([node()]))
        .toBe('Update all waits: nothing moves until fleet is acknowledged — tap Ack on it in the halt banner.');
      expect(updateAllHaltedText([node(), server()]))
        .toBe('Update all waits: nothing moves until fleet, server are acknowledged — tap Ack on each in the halt banner.');
      expect(skewHaltLead([node()])).toBe('Nothing moves until fleet is acknowledged — tap Ack on it in the halt banner');
    });
  });

  describe('consoleCanMove — moveRefusal\'s capability clauses, from L0', () => {
    it('a reachable Linux node with detach and an agent that lists the op, or the server\'s own agentless row', () => {
      expect(consoleCanMove(node())).toBe(true);
      expect(consoleCanMove(server())).toBe(true);
    });

    it.each([
      ['macOS (decision 17)', { os: 'darwin' }],
      ['unreachable', { reachable: false }],
      ['no detach in its caps (no-detach-cap)', { caps: ['update-gate'] }],
      ['an agent that does not list the op (agent-predates-update-op)', { agentOps: [] }],
    ] as const)('not when %s', (_what, over) => {
      expect(consoleCanMove(node(over as Partial<NodeWire>))).toBe(false);
    });

    it('a wire field that is not the type it should be reads as not movable, never as a throw', () => {
      expect(consoleCanMove({ ...node(), caps: undefined } as unknown as NodeWire)).toBe(false);
      expect(consoleCanMove({ ...node(), agentOps: undefined } as unknown as NodeWire)).toBe(false);
      expect(consoleCanMove({ ...node(), reachable: undefined } as unknown as NodeWire)).toBe(false);
    });
  });

  describe('autoWouldMove — the dispatcher\'s auto path, from L0', () => {
    it('a movable node with the health gate, a channel auto permits and a tag to move to', () => {
      expect(autoWouldMove(node(), 'stable')).toBe(true);
      expect(autoWouldMove(node(), 'channel')).toBe(true);
    });

    it.each([
      ['auto off', node(), 'off'],
      ['auto stable on a node resolved to dev (autoPermits)', node({ channel: 'dev' }), 'stable'],
      ['an unresolved channel', node({ channel: null }), 'channel'],
      ['no update-gate in its caps (no-update-gate)', node({ caps: ['detach'] }), 'channel'],
      ['no tag to move to (a converged row)', node({ desiredTag: null }), 'channel'],
      ['a node the console cannot move', node({ reachable: false }), 'channel'],
    ] as const)('not with %s', (_what, n, auto) => {
      expect(autoWouldMove(n as NodeWire, auto)).toBe(false);
    });

    it('a channel word this build cannot name reads as unresolved, never as a throw', () => {
      expect(autoWouldMove({ ...node(), channel: 'nightly' } as unknown as NodeWire, 'channel')).toBe(false);
    });
  });

  describe('skewRemedy — what the skew banner advises (R15(c))', () => {
    const movable = [node(), server()];
    it('a halt outranks everything, auto on or off, and says what happens after the ack', () => {
      const halted = [node({ update: lease('failed', 'x') }), server()];
      expect(skewRemedy(halted, [intent('channel')])).toEqual({ kind: 'halt', halting: [halted[0]], then: 'auto' });
      expect(skewRemedy(halted, [])).toEqual({ kind: 'halt', halting: [halted[0]], then: 'cli' });
      expect(skewRemedy(halted, [intent('off')])).toEqual({ kind: 'halt', halting: [halted[0]], then: 'cli' });
      const stuck = [node({ update: lease('failed', 'x'), caps: [] }), server({ caps: [] })];
      expect(skewRemedy(stuck, [intent('channel')]), 'the console cannot move them after the ack either')
        .toEqual({ kind: 'halt', halting: [stuck[0]], then: 'cli' });
    });

    it('auto on (stable or channel) and every node movable: the console\'s own move', () => {
      expect(skewRemedy(movable, [intent('stable')])).toEqual({ kind: 'auto' });
      expect(skewRemedy(movable, [intent('channel')])).toEqual({ kind: 'auto' });
    });

    it.each([
      ['auto off', movable, [intent('off')]],
      ['no fleet intent row', movable, []],
      ['only a per-node row (the PWA reads the fleet row, as Settings does)', movable, [intent('channel', FLEET_ID)]],
      ['an auto word this build cannot name', movable, [intent('nightly')]],
      ['one node the console cannot move', [node(), server({ caps: [] })], [intent('channel')]],
      ['a macOS node', [node(), server({ os: 'darwin' })], [intent('channel')]],
      ['no inventory answer', null, [intent('channel')]],
      ['an empty inventory', [], [intent('channel')]],
      ['auto stable and a node resolved to dev', [node({ channel: 'dev' }), server()], [intent('stable')]],
      ['a node with no update-gate', [node({ caps: ['detach'] }), server()], [intent('channel')]],
      ['no node with a tag to move to (one box hand-installed ahead)', [node({ desiredTag: null }), server({ desiredTag: null })], [intent('channel')]],
      ['a lease that could not be read', [{ ...node(), update: undefined } as unknown as NodeWire, server()], [intent('channel')]],
    ] as const)('the terminal verbs when %s', (_what, nodes, intents) => {
      expect(skewRemedy(nodes as readonly NodeWire[] | null, intents as readonly UpdateIntentWire[])).toEqual({ kind: 'cli' });
    });

    it('a converged node is not asked to be movable: only the nodes with a tag to move to are', () => {
      expect(skewRemedy([node(), server({ desiredTag: null, reachable: false })], [intent('channel')])).toEqual({ kind: 'auto' });
    });

    it('no intent answer at all reads as auto off', () => {
      expect(skewRemedy(movable, null)).toEqual({ kind: 'cli' });
      expect(skewRemedy(movable, undefined)).toEqual({ kind: 'cli' });
    });
  });
  ```
- [ ] **Step 3: Run, expect red:** the file fails to import `../src/fleet/updateHalt`.
- [ ] **Step 4: Implement.** Create `pwa/src/fleet/updateHalt.ts`:
  ```ts
  // What the home screen says about a halted or skewed fleet (centralised-update design 2026-09-20 §10, §13;
  // programme wave 14, R15). Pure reads of FleetScreen's one /api/updates answer, with no poll of their own. Three
  // callers: the halt banner (HaltBanner.tsx), Update all (UpdateBanner.tsx) and the skew arm (FleetHostBanner.tsx).
  //
  // WHO HALTS is the dispatcher's own rule, `isHaltingUpdate` (shared/update-move.ts, L0), the same predicate
  // `server/src/update/dispatch.ts`'s `isHalting` calls. The wire carries no "halted" word, so the PWA asks the rule
  // of each row's lease (`update.state`, `update.detail`). `isNodeElement` (useUpdatesView.ts) does not validate
  // `update`, so every read here is defensive, the way `canAck`'s is. A throw would blank the home screen: pwa/src
  // has no error boundary. A lease that cannot be read is NOT folded into "clear" where it would vouch for a move:
  // `skewRemedy` answers `cli` for it (Reading 14 holds what the halt banner and Update all do with it).
  //
  // WHETHER AUTO MOVES A NODE is the dispatcher's own auto path, from L0 too: `autoPermits` (intendedMove's auto
  // clause), a `desiredTag` to move to (a converged row's is NULL), and moveRefusal's capability clauses for an auto
  // move — `carriesDetachCap`, `carriesUpdateGate` (`no-update-gate`), `agentPredatesUpdateOp`.
  import type { AutoMode, NodeWire, UpdateIntentWire } from '../../../shared/api';
  import { FLEET_SCOPE, isAutoMode, isUpdateChannel } from '../../../shared/api';
  import {
    agentPredatesUpdateOp, autoPermits, carriesDetachCap, carriesUpdateGate, isHaltingUpdate,
  } from '../../../shared/update-move';
  import { isManagedNode } from './movePlan';

  /** The rows that halt the fleet, in inventory order. Empty for a view with no node array. */
  export function haltingNodes(nodes: readonly NodeWire[] | null | undefined): NodeWire[] {
    if (!Array.isArray(nodes)) return [];
    return nodes.filter((n) => {
      const state: unknown = n.update?.state;
      const detail: unknown = n.update?.detail;
      return typeof state === 'string' && isHaltingUpdate(state, typeof detail === 'string' ? detail : null);
    });
  }

  /** This row's lease could not be read: no `update` object, or a state that is not a string. */
  export const leaseUnreadable = (n: NodeWire): boolean => typeof n.update?.state !== 'string';

  /** One halting row, said: `fleet: failed (last tried v0.0.84) — gate: unit not up`. A settled lease is not moving:
   *  its `target` survives the settle only so that "last tried" stays readable (store.ts `ackNode`), and it may be a
   *  rollback's target, so it is said as what was tried, never as a direction. The target and the detail are left out
   *  when the lease carries none. Text only: every part reaches the DOM as a React text child. */
  export function haltLine(n: NodeWire): string {
    const state = typeof n.update?.state === 'string' ? n.update.state : 'unknown';
    const target = typeof n.update?.target === 'string' && n.update.target !== '' ? ` (last tried ${n.update.target})` : '';
    const detail = typeof n.update?.detail === 'string' && n.update.detail !== '' ? ` — ${n.update.detail}` : '';
    return `${n.label}: ${state}${target}${detail}`;
  }

  /** The labels a halt names, `, `-joined. */
  export const haltLabels = (halting: readonly NodeWire[]): string => halting.map((n) => n.label).join(', ');

  /** `fleet is acknowledged — tap Ack on it` / `fleet, server are acknowledged — tap Ack on each`. */
  const untilAcked = (halting: readonly NodeWire[]): string => halting.length === 1
    ? `${haltLabels(halting)} is acknowledged — tap Ack on it in the halt banner`
    : `${haltLabels(halting)} are acknowledged — tap Ack on each in the halt banner`;

  /** Update all's reason while a halt stands (R15(b)): who halts, and where the remedy is. It promises nothing about
   *  what moves after the ack: that is Update all's own sheet, once it is enabled again. */
  export const updateAllHaltedText = (halting: readonly NodeWire[]): string =>
    `Update all waits: nothing moves until ${untilAcked(halting)}.`;

  /** The skew arm's lead while a halt stands; FleetHostBanner ends it per `SkewRemedy.then`. */
  export const skewHaltLead = (halting: readonly NodeWire[]): string => `Nothing moves until ${untilAcked(halting)}`;

  /** The skew arm's sentence when auto moves the lagging box (with no halt, or after the ack). */
  export const SKEW_AUTO_TEXT = 'Auto-install is on and the console can move the lagging box — follow the move in Settings.';
  export const SKEW_HALT_THEN_AUTO_TAIL = '; auto-install then moves the lagging box.';

  /** The console can move this node on a REQUEST: it is managed (not macOS, decision 17), its last measurement reached
   *  it, its ccrc carries the one-tap, and its agent (if it has one) knows the update op. These are moveRefusal's own
   *  capability clauses, from L0. A live agent link is not on the wire, so this is what the server last measured,
   *  never a promise. */
  export function consoleCanMove(n: NodeWire): boolean {
    if (!isManagedNode(n) || n.reachable !== true || !Array.isArray(n.caps)) return false;
    if (n.agentOps !== null && !Array.isArray(n.agentOps)) return false;
    return carriesDetachCap(n.caps) && !agentPredatesUpdateOp(n.agentOps);
  }

  /** AUTO moves this node by itself: the console can move it, its ccrc carries the health gate auto requires
   *  (`no-update-gate`), auto permits its resolved channel, and the resolver gave it a tag to move to. */
  export function autoWouldMove(n: NodeWire, auto: AutoMode): boolean {
    if (!consoleCanMove(n) || !carriesUpdateGate(n.caps)) return false;
    const channel = isUpdateChannel(n.channel) ? n.channel : null;
    return autoPermits(auto, channel) && typeof n.desiredTag === 'string' && n.desiredTag !== '';
  }

  /** What the skew banner advises (R15(c)):
   *   - `halt`: a node halts the fleet, so nothing moves until it is acked. This outranks everything. `then` says what
   *     happens AFTER the ack, by the same rule as the two arms below over the same rows (an ack clears the lease and
   *     the request, never the channel, the caps or the desired tag);
   *   - `auto`: the fleet intent's auto-install is on, at least one node has a tag auto would move it to, and every such
   *     node is one auto would move (`autoWouldMove`), so the console moves the lagging box itself;
   *   - `cli`: anything else, including no inventory answer (a box with no control plane, or a first poll still in
   *     flight) and a lease that could not be read. The console cannot vouch for a move then, so the terminal verbs
   *     stand. */
  export type SkewRemedy =
    | { kind: 'halt'; halting: NodeWire[]; then: 'auto' | 'cli' } | { kind: 'auto' } | { kind: 'cli' };

  function autoArm(nodes: readonly NodeWire[], intent: readonly UpdateIntentWire[] | null | undefined): 'auto' | 'cli' {
    const fleet = Array.isArray(intent) ? intent.find((i) => i.scope === FLEET_SCOPE) ?? null : null;
    // A word this build cannot name is not "on": the console cannot say what it would do.
    if (fleet === null || !isAutoMode(fleet.auto)) return 'cli';
    const auto = fleet.auto;
    const pending = nodes.filter((n) => typeof n.desiredTag === 'string' && n.desiredTag !== '');
    return pending.length > 0 && pending.every((n) => autoWouldMove(n, auto)) ? 'auto' : 'cli';
  }

  export function skewRemedy(
    nodes: readonly NodeWire[] | null | undefined, intent: readonly UpdateIntentWire[] | null | undefined,
  ): SkewRemedy {
    // An empty inventory needs no guard of its own: no node has a tag to move to, so autoArm answers `cli`.
    if (!Array.isArray(nodes)) return { kind: 'cli' };
    const halting = haltingNodes(nodes);
    const then = nodes.some(leaseUnreadable) ? 'cli' : autoArm(nodes, intent);
    if (halting.length > 0) return { kind: 'halt', halting, then };
    return { kind: then };
  }
  ```
- [ ] **Step 5: Run:** `update-halt` (**36**). *(revision, measured: 36 passed.)*
- [ ] **Step 6: Mutation table** *(prototype; re-measured in the revision; every row runs `update-halt` whole unless the row says otherwise)*.

  | Row | Mutation in `updateHalt.ts` | Measured red |
  |---|---|---|
  | T3-1 | `haltingNodes` returns `state === 'failed'` | 3 (`agrees with isHaltingUpdate …`, `failed and reverted halt; …`, `keeps inventory order …`); after Tasks 4–6 also `halt-banner` 2 (`is silent with no view, …`, `names each halting node, …`), `update-banner` 1 (`a reverted server row halts it too, …`), `fleet-host-banner` 1 (`a halt is named even with auto off …`) |
  | T3-3 | `haltLine`'s target clause becomes `''` | 1 (`names the node, its state, its target …`); after Task 4 also `halt-banner` 1 (`names each halting node, …`), `fleet-screen -t "programme wave 14"` 1 (`names the halt, …`) |
  | T3-4 | `consoleCanMove` drops `carriesDetachCap(n.caps) &&` | 1 (`not when no detach in its caps`); `fleet-host-banner` 26 green (each of its unmovable fixtures also lacks `update-gate`, so `autoWouldMove` refuses them anyway) |
  | T3-5 | `consoleCanMove` drops `&& !agentPredatesUpdateOp(n.agentOps)` | 1 (`not when an agent that does not list the op`); `fleet-host-banner` 26 green |
  | T3-6 | drops `n.reachable !== true \|\|` | 3 (`not when unreachable`, `a wire field that is not the type it should be …`, `not with a node the console cannot move`) |
  | T3-7 | drops `!isManagedNode(n) \|\|` | 2 (`not when macOS`, `the terminal verbs when a macOS node`) |
  | T3-8 | deletes `if (halting.length > 0) return { kind: 'halt', halting, then };` | 1 (`a halt outranks everything, …`); after Tasks 4–6 `fleet-host-banner` 3 (its three halt cases), `fleet-screen -t "programme wave 14"` 1 (`names the halt, …`) |
  | T3-10 | `autoArm` ignores the intent (`const auto = 'channel' as const;`) | 7 (`a halt outranks everything, …`, `… auto off`, `… no fleet intent row`, `… only a per-node row …`, `… an auto word this build cannot name`, `… auto stable and a node resolved to dev`, `no intent answer at all …`); after Task 6 `fleet-host-banner` 1 (`auto off, a node the console cannot move, or no intent: …`) |
  | T3-11 | drops `\|\| !isAutoMode(fleet.auto)` | 1 (`the terminal verbs when an auto word this build cannot name`) |
  | T3-12 | deletes `if (!Array.isArray(nodes)) return { kind: 'cli' };` | 1 (`the terminal verbs when no inventory answer`) |
  | T3-13 | `n.caps.includes('detach')` in place of `carriesDetachCap(n.caps)` | `update-move -t "centralised-update wave 14"` 1 (`DETACH_CAP is declared, and the word quoted …`); `update-halt` 36 green |
  | T3-14 | add `export function isHaltingUpdate(): boolean { return false; }` above `haltingNodes` | `update-move -t "centralised-update wave 14"` 1 (`each L0 predicate is declared in shared/update-move.ts alone`) |
  | T3-15 | `haltingNodes` adds its own `!(typeof detail === 'string' && detail.startsWith(PROVENANCE_DETAIL_PREFIX)) &&` | `update-move -t "centralised-update wave 14"` 1 (`the provenance exception to a halt is tested on a code line only where the census names it`) |
  | T3-16 | deletes `if (n.agentOps !== null && !Array.isArray(n.agentOps)) return false;` | 1 (`a wire field that is not the type it should be …`) |
  | T3-17 | `const fleet = intent!.find(…) ?? null;` (no `Array.isArray(intent)` guard) | 1 (`no intent answer at all reads as auto off`); after Task 6 `fleet-host-banner` 6 (the four pre-wave skew cases, which mount with no intent, plus `a halt is named even with auto off …` and `auto off, a node the console cannot move, or no intent …`) |
  | T3-18 | drops `\|\| !Array.isArray(n.caps)` | 1 (`a wire field that is not the type it should be …`) |
  | T3-19 | `isHaltingUpdate(state, detail as string)` (no `typeof detail` guard) | 1 (`a failed row whose detail is not a string still halts …`) |
  | T3-20 | `autoWouldMove` drops `\|\| !carriesUpdateGate(n.caps)` | 2 (`not with no update-gate in its caps`, `the terminal verbs when a node with no update-gate`); after Task 6 `fleet-host-banner` 1 (`a halt with auto on but a box auto would not move …`) |
  | T3-21 | `autoPermits(auto, channel)` becomes `auto !== 'off'` | 4 (`not with auto stable on a node resolved to dev`, `not with an unresolved channel`, `a channel word this build cannot name …`, `the terminal verbs when auto stable and a node resolved to dev`) |
  | T3-22 | drops the `desiredTag` clause from `autoWouldMove` | 1 (`not with no tag to move to`) |
  | T3-23 | `nodes.every(…)` in place of `pending.every(…)` | 1 (`a converged node is not asked to be movable …`) |
  | T3-24 | drops `pending.length > 0 &&` | 2 (`the terminal verbs when an empty inventory`, `… no node with a tag to move to …`) |
  | T3-25 | `const then = autoArm(nodes, intent);` (no unreadable-lease arm) | 1 (`the terminal verbs when a lease that could not be read`) |
  | T3-26 | the halt arm returns `then: 'auto'` always | 1 (`a halt outranks everything, …`); after Task 6 `fleet-host-banner` 2 (`a halt is named even with auto off …`, `a halt with auto on but a box auto would not move …`) |
- [ ] **Step 7: Commit:** `feat(update): updateHalt — who halts, Update all's reason, whether auto moves a node, the skew remedy (wave 14, R15)`.

### Task 4: R15(a) — the halt banner on the home screen, with each node's Ack in place

**Files:** `pwa/src/fleet/HaltBanner.tsx` (new), `pwa/test/halt-banner.test.tsx` (new), `pwa/src/fleet/fleet.css`, `pwa/src/screens/FleetScreen.tsx`, `pwa/test/fleet-screen.test.tsx`.

- [ ] **Step 1: Re-measure.**
  ```bash
  cd pwa
  grep -nF "      <FleetHostBanner health={fleetHealth} nodes={updates.view?.nodes ?? null} />" src/screens/FleetScreen.tsx   # 647
  grep -nF "      <UpdateBanner updates={updates.view} health={fleetHealth} onMoved={updates.reload} />" src/screens/FleetScreen.tsx   # 648
  grep -nF "import { FleetHostBanner } from '../fleet/FleetHostBanner';" src/screens/FleetScreen.tsx   # 14
  grep -nF "  const updates = useUpdatesView();" src/screens/FleetScreen.tsx                          # 452: the one poll
  grep -nF "  if (!Array.isArray(releases) || !Array.isArray(nodes) || !Array.isArray(intent)) return null;" src/fleet/useUpdatesView.ts   # releases is validated
  tail -3 src/fleet/fleet.css                                                                        # ends `color: var(--status-dead-text);` / `}` at 8b0547b4
  grep -nF ".substrate-banner {" src/fleet/fleet.css                                                 # 361: the pair this banner reuses
  ./node_modules/.bin/vitest list test/fleet-screen.test.tsx | wc -l                                  # 98
  ```
- [ ] **Step 2: Write the cases first (red).** Create `pwa/test/halt-banner.test.tsx`:
  ```tsx
  // HaltBanner (centralised-update programme wave 14, R15(a)) — the home screen names each node that halts the fleet,
  // its state, target and detail, and offers that node's Ack in place: the same gate (`canAck`) and the same route
  // (`POST /api/updates/ack`, `api.ackUpdateNode`) the Settings row uses.
  //
  // Found by CLASS and TEXT, never by a bare getByRole('status'): several banners on the fleet screen are status
  // regions too (update-banner.test.tsx says why).
  import { readFileSync } from 'node:fs';
  import path from 'node:path';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
  import type { NodeWire, ReleaseWire, UpdatesView } from '../../shared/api';
  import { UPDATE_STATES } from '../../shared/api';
  import { isHaltingUpdate } from '../../shared/update-move';
  import { ApiError, api, updateErrorText } from '../src/lib/api';
  import { ToastHost } from '../src/components/Toast';
  import { HALT_LEAD_TEXT, HaltBanner } from '../src/fleet/HaltBanner';
  import { ACK_UNREADABLE_TEXT, canAck, sendAck } from '../src/fleet/updateAck';
  import * as settings from '../src/screens/SettingsScreen';
  import { declValue, ruleIn } from './cssRule';

  // canAck through a pass-through spy, so ONE case can drive the rendered gate (T4-1) while every other case runs the
  // real function. SettingsScreen re-exports from the same module, so `settings.canAck === canAck` still holds.
  vi.mock('../src/fleet/updateAck', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/fleet/updateAck')>();
    return { ...actual, canAck: vi.fn(actual.canAck) };
  });

  const SRC = path.join(import.meta.dirname, '..', 'src');
  const haltCss = readFileSync(path.join(SRC, 'fleet', 'fleet.css'), 'utf8');
  const primitivesCss = readFileSync(path.join(SRC, 'components', 'primitives.css'), 'utf8');
  const bannerSrc = readFileSync(path.join(SRC, 'fleet', 'HaltBanner.tsx'), 'utf8');
  const settingsSrc = readFileSync(path.join(SRC, 'screens', 'SettingsScreen.tsx'), 'utf8');

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const FLEET_ID = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
  const SERVER_ID = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';
  const node = (over: Partial<NodeWire> = {}): NodeWire => ({
    nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
    current: null, stampRead: 'ok', installState: 'complete', provenance: 'verified',
    caps: ['detach', 'update-gate'], agentOps: ['update'], highestVersion: 'v0.0.78', previousVersion: null,
    measuredAt: 1, reachable: true, unreachableSince: null,
    channel: 'stable', desiredTag: 'v0.0.84', resolveDetail: null,
    request: null, report: null,
    update: { state: 'idle', target: null, startedAt: null, detail: null },
    ...over,
  });
  const failed = (over: Partial<NodeWire> = {}): NodeWire =>
    node({ update: { state: 'failed', target: 'v0.0.84', startedAt: 1, detail: 'gate: unit not up' }, ...over });
  const server = (over: Partial<NodeWire> = {}): NodeWire =>
    node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
  const view = (nodes: NodeWire[], releases: ReleaseWire[] = []): UpdatesView => ({
    catalogue: { lastOkAt: 1, lastError: null }, releases, nodes, intent: [],
  });
  const banner = (): Element | null => document.querySelector('.halt-banner');
  const mount = (v: UpdatesView | null) => {
    const onAcked = vi.fn();
    render(<><ToastHost /><HaltBanner updates={v} onAcked={onAcked} /></>);
    return { onAcked };
  };

  describe('HaltBanner — when it speaks', () => {
    it('is silent with no view, and with no halting node: idle, busy, and a failed provenance verdict', () => {
      mount(null);
      expect(banner()).toBeNull();
      cleanup();
      mount(view([node(), server({ update: { state: 'applying', target: 'v0.0.84', startedAt: 1, detail: null } })]));
      expect(banner()).toBeNull();
      cleanup();
      mount(view([failed({ update: { state: 'failed', target: 'v0.0.84', startedAt: 1, detail: 'provenance: unsigned bundle' } })]));
      expect(banner(), 'a verdict on the release does not halt (D-3378)').toBeNull();
    });

    it('names each halting node, its state, its target and its detail, one row each, with its own Ack', () => {
      mount(view([server({ update: { state: 'reverted', target: 'v0.0.84', startedAt: 1, detail: null } }), failed()]));
      expect(banner()!.getAttribute('role')).toBe('status');
      expect(within(banner() as HTMLElement).getByText(HALT_LEAD_TEXT)).toBeInTheDocument();
      const rows = within(screen.getByRole('list', { name: 'Halted nodes' })).getAllByRole('listitem');
      expect(rows.map((li) => li.querySelector('.halt-banner-node-text')?.textContent)).toEqual([
        'server: reverted (last tried v0.0.84)',
        'fleet: failed (last tried v0.0.84) — gate: unit not up',
      ]);
      expect(screen.getByRole('button', { name: 'Ack server' })).toHaveTextContent('Ack');
      expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
    });
  });

  describe('HaltBanner — the Ack in place is the Settings Ack', () => {
    it('sends POST /api/updates/ack for that node once, then re-polls', async () => {
      const ack = vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
      const { onAcked } = mount(view([server(), failed()]));
      fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
      expect(screen.getByRole('button', { name: 'Ack fleet' }), 'one tap while the answer is in flight').toBeDisabled();
      await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
      expect(ack.mock.calls).toEqual([[FLEET_ID]]);
      expect(document.querySelector('.toast'), 'a clean 200 says nothing').toBeNull();
    });

    it('an unreadable answer and a refusal are said as the Settings row says them, and re-poll either way', async () => {
      vi.spyOn(api, 'ackUpdateNode').mockResolvedValueOnce('unreadable');
      const first = mount(view([failed()]));
      fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
      expect(await screen.findByText(ACK_UNREADABLE_TEXT)).toBeInTheDocument();
      await waitFor(() => expect(first.onAcked).toHaveBeenCalledTimes(1));
      cleanup();
      const busy = new ApiError(409, { ok: false, error: 'busy' });
      vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(busy);
      const second = mount(view([failed()]));
      fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
      expect(await screen.findByText(updateErrorText(busy))).toBeInTheDocument();
      await waitFor(() => expect(second.onAcked).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Ack fleet' }), 'a refused ack re-arms the button').not.toBeDisabled();
    });

    it('after a clean 200 the row stays down until a poll shows a different lease — a second tap sends nothing', async () => {
      const ack = vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
      const onAcked = vi.fn(); // the re-poll failed: the hook keeps the last good view, so the same lease stands
      const { rerender } = render(<><ToastHost /><HaltBanner updates={view([failed()])} onAcked={onAcked} /></>);
      fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
      await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
      const button = screen.getByRole('button', { name: 'Ack fleet' });
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Acked');
      fireEvent.click(button);
      expect(ack).toHaveBeenCalledTimes(1);
      // A NEW failure on the same node is a new lease: the button re-arms.
      rerender(<><ToastHost /><HaltBanner updates={view([failed({ update: { state: 'failed', target: 'v0.0.85', startedAt: 2, detail: 'gate: unit not up' } })])} onAcked={onAcked} /></>);
      expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Ack fleet' })).toHaveTextContent(/^Ack$/);
    });

    it('every row the halt rule names is one canAck lets through, over every state and a detail spread', () => {
      // isHaltingUpdate DERIVES its states from the settled list; canAck NAMES failed/reverted. This is what keeps a
      // settled state added later from halting the fleet with its Ack disabled.
      for (const state of UPDATE_STATES) {
        for (const detail of [null, '', 'x', 'gate: unit not up', 'provenance: unsigned bundle']) {
          const row = failed({ update: { state, target: 'v0.0.84', startedAt: 1, detail } as NodeWire['update'] });
          if (isHaltingUpdate(state, detail)) expect(canAck(row, []), `${state} / ${String(detail)}`).toBe(true);
        }
      }
    });

    it('the rendered gate IS canAck: a row it refuses renders its Ack disabled', () => {
      vi.mocked(canAck).mockReturnValue(false);
      try {
        mount(view([failed()]));
        expect(screen.getByRole('button', { name: 'Ack fleet' })).toBeDisabled();
      } finally {
        vi.mocked(canAck).mockReset();
      }
      expect(canAck(failed(), []), 'the spy passes through again').toBe(true);
    });

    it('Settings re-exports the same function and text, and holds no copy of either (D-4267)', () => {
      expect(settings.canAck).toBe(canAck);
      expect(settings.ACK_UNREADABLE_TEXT).toBe(ACK_UNREADABLE_TEXT);
      expect(settingsSrc).not.toMatch(/function canAck\b/);
      expect(settingsSrc).not.toMatch(/api\.ackUpdateNode\(/);
      expect(settingsSrc).toMatch(/void sendAck\(n\.nodeId\)/);
      expect(bannerSrc).toMatch(/import \{ canAck, sendAck \} from '\.\/updateAck';/);
      // The gate is canAck on every row, though a halting row passes it by construction: no behaviour can red for it.
      expect(bannerSrc).toContain('disabled={!canAck(n, releases) || acking || acked}');
      expect(bannerSrc).toContain('void sendAck(n.nodeId).then(');
      expect(bannerSrc).not.toMatch(/SETTLED_UPDATE_STATES|ackUpdateNode/);
    });

    it('sendAck never rejects, so a caller\'s finally always re-polls; it answers how the Ack ended', async () => {
      render(<ToastHost />);
      vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new Error('offline'));
      await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('refused'); });
      vi.spyOn(api, 'ackUpdateNode').mockResolvedValueOnce('unreadable');
      await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('unreadable'); });
      vi.spyOn(api, 'ackUpdateNode').mockResolvedValueOnce({ ok: true, node: node() });
      await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('acked'); });
    });
  });

  describe('HaltBanner — a class of its own, a tap floor, and text only', () => {
    it('is self-grounded on the attention pair under its own class, and not sticky', () => {
      mount(view([failed()]));
      expect(banner()!.className).toBe('halt-banner');
      const rule = ruleIn(haltCss, '.halt-banner');
      expect(declValue(rule, 'background')).toBe('var(--status-attention-tint)');
      expect(declValue(rule, 'color')).toBe('var(--status-attention-text)');
      expect(declValue(rule, 'position')).toBeNull();
    });

    it('keeps the shared button at the tap floor: the banner override resizes its width, never its height', () => {
      expect(declValue(ruleIn(primitivesCss, '.btn-primary'), 'min-height')).toBe('var(--tap-min)');
      const rule = ruleIn(haltCss, '.halt-banner-node .btn-primary');
      expect(declValue(rule, 'width')).toBe('auto');
      expect(declValue(rule, 'min-height')).toBeNull();
      expect(declValue(rule, 'height')).toBeNull();
    });

    it('no rule but the banner\'s own sets a colour, so every child inherits the measured pair', () => {
      const colourRules = [...haltCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter((m) => /halt-banner/.test(m[1]!) && /(^|;|\s)(color|background(-color)?)\s*:/.test(m[2]!)).map((m) => m[1]!.trim());
      expect(colourRules).toEqual(['.halt-banner']);
    });

    it('puts wire text into the DOM only as text children', () => {
      expect(bannerSrc).not.toMatch(/dangerouslySetInnerHTML/);
    });
  });
  ```
  Then append to `pwa/test/fleet-screen.test.tsx`:
  ```tsx
  // ── centralised-update programme wave 14, R15: the halt on the home screen ───
  // The operator's 2026-10-05 12:12 screenshot: two banners, neither naming the halt, and the only Ack in Settings.
  // On the real screen, with the screen's ONE poll: the halt banner names the failed node and acks it in place, Update
  // all is disabled with its reason, the skew banner points at the halt, and the Ack re-polls the screen.
  describe('the halt on the fleet screen (programme wave 14, R15)', () => {
    const FLEET = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
    const SERVER = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';
    const rowOf = (nodeId: string, role: 'fleet' | 'server', version: string, update: NodeWire['update']): NodeWire => ({
      nodeId, role, label: role, os: 'linux',
      current: { sha: (role === 'fleet' ? 'b' : 'c').repeat(40), ref: 'main', builtAt: '2026-10-05T12:00:00Z', dirty: false, version },
      stampRead: 'ok', installState: 'complete', provenance: 'verified',
      caps: ['detach', 'update-gate', 'rollback'], agentOps: role === 'server' ? null : ['update'], highestVersion: version, previousVersion: null,
      measuredAt: Date.now() - MIN, reachable: true, unreachableSince: null,
      channel: 'stable', desiredTag: 'v0.0.84', resolveDetail: null,
      request: null, report: null, update,
    });
    const halted = (): UpdatesView => ({
      catalogue: { lastOkAt: Date.now() - 4 * MIN, lastError: null },
      releases: [],
      nodes: [
        rowOf(FLEET, 'fleet', 'v0.0.78', { state: 'failed', target: 'v0.0.84', startedAt: Date.now() - 10 * MIN, detail: 'gate: unit not up' }),
        rowOf(SERVER, 'server', 'v0.0.84', { state: 'idle', target: 'v0.0.84', startedAt: null, detail: 'done: v0.0.84' }),
      ],
      intent: [{ scope: '*', channel: 'stable', pinnedTag: null, auto: 'stable', notify: 'off', setAt: 1, setBy: 'pwa' }],
    });

    it('names the halt, disables Update all with its reason, points the skew banner at it, and acks in place', async () => {
      vi.spyOn(api, 'fleetHealth').mockResolvedValue({ mode: 'remote', connected: true, downSince: null, roster: 'agreed', build: 'skewed' });
      const updates = vi.spyOn(api, 'updates').mockResolvedValue(halted());
      const ack = vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: halted().nodes[0]! });
      render(<FleetScreen store={makeStore()} />);
      const ackButton = await screen.findByRole('button', { name: 'Ack fleet' });
      expect(document.querySelector('.halt-banner-node-text')?.textContent).toBe('fleet: failed (last tried v0.0.84) — gate: unit not up');
      expect(screen.getByRole('button', { name: 'Update all' })).toBeDisabled();
      await waitFor(() => expect(screen.getByText(/run different builds/i)).toHaveTextContent('Nothing moves until fleet is acknowledged — tap Ack on it in the halt banner; auto-install then moves the lagging box.'));
      expect(document.body.textContent).not.toContain('ccrc rollout');
      // The banners' order on the screen: the sticky host banner, then the halt, then the release line.
      const order = [...document.querySelectorAll('.fleet-host-banner, .halt-banner, .update-banner')].map((e) => e.className);
      expect(order).toEqual(['fleet-host-banner fleet-host-banner--warn', 'halt-banner', 'update-banner']);
      expect(updates, 'one poll for the whole screen').toHaveBeenCalledTimes(1);
      fireEvent.click(ackButton);
      await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
      expect(ack.mock.calls).toEqual([[FLEET]]);
    });

    it('after the ack, with auto on, the skew banner points at the console\'s own move — the screen hands it the intent', async () => {
      vi.spyOn(api, 'fleetHealth').mockResolvedValue({ mode: 'remote', connected: true, downSince: null, roster: 'agreed', build: 'skewed' });
      const acked = halted();
      acked.nodes[0] = { ...acked.nodes[0]!, update: { state: 'idle', target: 'v0.0.84', startedAt: null, detail: 'acknowledged by the operator' } };
      vi.spyOn(api, 'updates').mockResolvedValue(acked);
      render(<FleetScreen store={makeStore()} />);
      await waitFor(() => expect(screen.getByText(/run different builds/i))
        .toHaveTextContent('Auto-install is on and the console can move the lagging box — follow the move in Settings.'));
      expect(document.querySelector('.halt-banner')).toBeNull();
      expect(screen.getByRole('button', { name: 'Update all' })).not.toBeDisabled();
    });
  });
  ```
- [ ] **Step 3: Run, expect red:** `halt-banner` fails to import `../src/fleet/HaltBanner`. `fleet-screen -t "programme wave 14"` has 2 failed *(prototype, with the banner present but `FleetScreen.tsx`, `UpdateBanner.tsx` and `FleetHostBanner.tsx` at `8b0547b4`)*.
- [ ] **Step 4: The stylesheet.** Re-read the claims. If no live claim names `pwa/src/fleet/fleet.css` (at revision none does), append this block after its last line (Reading 1(a)). If one does, stop this step and mail the coordinator:
  ```css
  /* HaltBanner (centralised-update programme wave 14, R15(a)): the home screen's halt, with each halting node's Ack
     in place. Self-grounded on the attention pair the fleet-host banner's warn arms and .substrate-banner already use
     (--status-attention-text on --status-attention-tint, both solid, floored at 4.5 by design/contrast-check.mjs), so
     no new colour pairing and no inherited ground; the children set no colour of their own. The Ack is the shared
     .btn-primary, which paints itself; the override below is layout only, as .update-banner-actions' is. No margin:
     it is a child of the .fleet column, whose padding is the gutter and whose gap is the spacing. Not sticky: the
     fleet-host banner owns the sticky slot. */
  .halt-banner {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4);
    border: 1px solid var(--status-attention);
    border-radius: var(--r-md);
    background: var(--status-attention-tint);
    color: var(--status-attention-text);
    font: var(--weight-regular) var(--text-sm) / var(--leading-normal) var(--font-ui);
  }
  .halt-banner-msg {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .halt-banner-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* One row per halting node: its line, then its Ack. The row wraps at phone width, so a long detail pushes the
     button onto its own line rather than squeezing it below the tap floor. */
  .halt-banner-node {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-3);
  }
  .halt-banner-node-text {
    flex: 1 1 12rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* The shared button is a full-width sheet button (primitives.css); here it sizes to its label and keeps its
     --tap-min height. */
  .halt-banner-node .btn-primary {
    flex: none;
    width: auto;
    padding: 0 var(--sp-3);
  }
  ```
- [ ] **Step 5: Implement.** Create `pwa/src/fleet/HaltBanner.tsx`:
  ```tsx
  // HaltBanner — the home screen's halt (centralised-update design 2026-09-20 §10, §13; programme wave 14, R15(a)).
  // A failed or reverted move halts every move in the fleet until the operator acks that node. Before this wave the
  // only door out, Ack, sat on the node's row in Settings, and nothing on the home screen named the halt. This banner
  // names each halting node, its state, its target and its detail, and offers that node's Ack IN PLACE.
  //
  // ONE Ack: the gate is `canAck` and the tap is `sendAck` (updateAck.ts), the very pair the Settings row calls, so
  // the two buttons cannot disagree about one row. A halting row is settled `failed`/`reverted`, so `canAck` is true
  // for it (halt-banner.test.tsx pins that over every state the halt rule names). It is still the one gate, never a
  // halt-only copy. After a clean 200 the row stays down until a poll shows a different lease (`leaseKey`).
  // The route stays the authority: a row
  // that went busy since the poll answers 409 `busy`, said as a toast, and the screen re-polls either way.
  //
  // Injected only: FleetScreen polls /api/updates once and hands the view down (`fleet-screen.test.tsx` pins one
  // poll). It renders nothing while there is no view, or no halting node. Its own class, `.halt-banner`: attention
  // amber like the skew warning, but not sticky, because the fleet-host banner owns the sticky slot. role="status"
  // like every banner on this screen, so tests find it by class.
  import { useState } from 'react';
  import type { ReactNode } from 'react';
  import type { NodeWire, ReleaseWire, UpdatesView } from '../../../shared/api';
  import { canAck, sendAck } from './updateAck';
  import { haltLine, haltingNodes } from './updateHalt';
  import './fleet.css';

  /** The banner's lead sentence. */
  export const HALT_LEAD_TEXT = 'Updates are halted — nothing moves on any node until each one below is acknowledged.';

  /** The lease an Ack was sent against. The row stays down while the view still shows THAT lease: between a clean 200
   *  and the poll that drops the row (longer when a poll fails, since the hook keeps the last good view), a second
   *  tap would reach ackNode again, which acks an idle row too and clears whatever request was written since. A new
   *  failure is a new lease, so it re-arms the button. */
  const leaseKey = (n: NodeWire): string => JSON.stringify(n.update ?? null);

  function HaltRow({ node: n, releases, onAcked }: {
    node: NodeWire; releases: readonly ReleaseWire[]; onAcked: () => void;
  }): ReactNode {
    const [acking, setAcking] = useState(false);
    const [ackedLease, setAckedLease] = useState<string | null>(null);
    const acked = ackedLease !== null && ackedLease === leaseKey(n);
    const ack = (): void => {
      const sentAgainst = leaseKey(n);
      setAcking(true);
      void sendAck(n.nodeId).then((outcome) => {
        if (outcome !== 'refused') setAckedLease(sentAgainst);
      }).finally(() => {
        setAcking(false);
        onAcked();
      });
    };
    return (
      <li className="halt-banner-node" data-node-id={n.nodeId}>
        <span className="halt-banner-node-text">{haltLine(n)}</span>
        <button
          type="button"
          className="btn-primary"
          aria-label={`Ack ${n.label}`}
          disabled={!canAck(n, releases) || acking || acked}
          onClick={ack}
        >
          {acked ? 'Acked' : 'Ack'}
        </button>
      </li>
    );
  }

  export function HaltBanner({ updates: view, onAcked }: { updates: UpdatesView | null; onAcked: () => void }): ReactNode {
    if (view === null) return null;
    const halting = haltingNodes(view.nodes);
    if (halting.length === 0) return null;
    // useUpdatesView validates `releases` as an array (asUpdatesView), so it is passed as it stands.
    const releases = view.releases;
    return (
      <div className="halt-banner" role="status">
        <span className="halt-banner-msg">{HALT_LEAD_TEXT}</span>
        <ul className="halt-banner-list" aria-label="Halted nodes">
          {halting.map((n) => <HaltRow key={n.nodeId} node={n} releases={releases} onAcked={onAcked} />)}
        </ul>
      </div>
    );
  }
  ```
  In `FleetScreen.tsx`, after `import { FleetHostBanner } from '../fleet/FleetHostBanner';` add `import { HaltBanner } from '../fleet/HaltBanner';`. Then put the halt banner between the fleet-host banner and the release banner:
  ```tsx
      {/* The halt, with each halting node's Ack in place (programme wave 14, R15(a)): above Update all, which it
          disables while it stands. Re-polls on every Ack. */}
      <HaltBanner updates={updates.view} onAcked={updates.reload} />
  ```
- [ ] **Step 6: Run:**
  - `halt-banner` (**13**);
  - `fleet-screen` (**100**). Its wave-14 describe needs Tasks 5 and 6 for its Update-all and skew assertions, so run the file whole again after Task 6;
  - `contrast` (**256**) and `fleet-css` (**80**), run only;
  - `node design/contrast-check.mjs` (`ALL 628 PASS`, with `fleet.css .halt-banner` passing at 8.52 dark and 4.94 light).

  *(revision, measured in place: as listed.)*
- [ ] **Step 7: Mutation table** *(prototype; re-measured in the revision; the C rows were measured in place)*.

  | Row | File | Mutation | Command(s) | Measured red |
  |---|---|---|---|---|
  | T4-1 | `HaltBanner.tsx` | `disabled={acking \|\| acked}` (no `canAck`) | `halt-banner` | 2 (`the rendered gate IS canAck: …`, `Settings re-exports the same function …`) |
  | T4-2 | `HaltBanner.tsx` | `disabled={!canAck(n, releases) \|\| acked}` (no in-flight guard) | `halt-banner` | 2 (`sends POST /api/updates/ack for that node once, then re-polls`, the source pin) |
  | T4-3 | `HaltBanner.tsx` | `void Promise.resolve('acked' as const).then(` in place of `sendAck` | `halt-banner`; `fleet-screen -t "programme wave 14"` | `halt-banner` 4 (`sends POST …`, `an unreadable answer and a refusal …`, `after a clean 200 the row stays down …`, the source pin); `fleet-screen` 1 (`names the halt, …, and acks in place`) |
  | T4-4 | `HaltBanner.tsx` | drop `onAcked();` | `halt-banner` | 3 (`sends POST …`, `an unreadable answer and a refusal …`, `after a clean 200 …`) |
  | T4-5 | `HaltBanner.tsx` | `const halting = view.nodes;` | `halt-banner` | 1 (`is silent with no view, and with no halting node …`) |
  | T4-6 | `FleetScreen.tsx` | delete the `<HaltBanner … />` line | `fleet-screen -t "programme wave 14"` | 1 (`names the halt, …`) |
  | T4-7 | `FleetScreen.tsx` | `onAcked={() => {}}` | `fleet-screen -t "programme wave 14"` | 1 (`names the halt, …`, at the re-poll) |
  | T4-8 | `HaltBanner.tsx` | `disabled={!canAck(n, releases) \|\| acking}` (no acked hold) | `halt-banner` | 2 (`after a clean 200 the row stays down …`, the source pin) |
  | T4-9 | `HaltBanner.tsx` | `setAckedLease(sentAgainst);` on every outcome | `halt-banner` | 1 (`an unreadable answer and a refusal …`, at `a refused ack re-arms the button`) |
  | T4-10 | `HaltBanner.tsx` | `const leaseKey = (_n: NodeWire): string => 'lease';` | `halt-banner` | 1 (`after a clean 200 …`, at the re-arm on a new lease) |
  | T4-11 | `updateAck.ts` | `if (state === 'failed') return true;` (canAck narrowed) | `halt-banner` | 1 (`every row the halt rule names is one canAck lets through, …`) |
  | C-1 | `fleet.css` | drop `.halt-banner`'s `background` | `halt-banner`; `contrast` | `halt-banner` 1 (`is self-grounded on the attention pair …`); `contrast` 1 (`contains no identities beyond the grandfathered blind spots`) |
  | C-2 | `fleet.css` | add `min-height: 32px;` to `.halt-banner-node .btn-primary` | `halt-banner` | 1 (`keeps the shared button at the tap floor …`) |
  | C-3 | `fleet.css` | add `position: sticky;` to `.halt-banner` | `halt-banner` | 1 (`… and not sticky`) |
  | C-4 | `fleet.css` | add `color: var(--ink-tertiary);` to `.halt-banner-node-text` | `halt-banner`; `contrast` | `halt-banner` 1 (`no rule but the banner's own sets a colour …`); `contrast` 1 (as C-1) |
- [ ] **Step 8: Commit:** `feat(update): the halt banner — each halting node and its Ack on the home screen, held down until the lease changes (wave 14, R15a)`.

### Task 5: R15(b) — Update all waits with its reason; the sheet says every halted skip; the halted sentence names the Ack (D-4268, D-4269)

**Files:** `pwa/src/fleet/UpdateBanner.tsx`, `pwa/src/fleet/UpdateMoveSheet.tsx`, `pwa/src/lib/api.ts`, `pwa/test/update-banner.test.tsx`, `pwa/test/update-move-sheet.test.tsx`, `pwa/test/api.test.ts`.

- [ ] **Step 1: Re-measure.**
  ```bash
  cd pwa
  grep -nF "import { useState } from 'react';" src/fleet/UpdateBanner.tsx                        # 36
  grep -nF '          <span className="update-banner-msg">{text}</span>' src/fleet/UpdateBanner.tsx  # 124
  grep -nF "              onClick={() => setMove(planMove(view, { scope: 'fleet', direction: 'update', tag: release.tag }))}" src/fleet/UpdateBanner.tsx   # 129
  grep -nF "      const label = named.get(s.nodeId);" src/fleet/UpdateMoveSheet.tsx                   # 117
  grep -nF "// the sheet never listed is the plan agreeing with the server, and is not said." src/fleet/UpdateMoveSheet.tsx   # 35
  grep -nF "  halted: 'An update failed or was reverted — acknowledge that node before moving any other.'," src/lib/api.ts   # 409
  grep -nF "    halted: 'An update failed or was reverted — acknowledge that node before moving any other.'," test/api.test.ts   # 1289
  grep -rn "acknowledge that node before moving any other" ../README.md ../docs/superpowers/specs src test   # only the two above
  ./node_modules/.bin/vitest list test/update-banner.test.tsx | wc -l       # 29
  ./node_modules/.bin/vitest list test/update-move-sheet.test.tsx | wc -l   # 36
  ```
- [ ] **Step 2: Write the cases first (red).** Append to `update-banner.test.tsx`:
  ```tsx
  // Programme wave 14, R15(b): on a halted fleet, Update all is disabled and says why and where the remedy is, so a
  // tap can no longer come back as a 202 the operator cannot act on (the 2026-10-05 12:18:59 and 12:19:15 taps).
  describe('UpdateBanner — Update all while a node halts the fleet (R15(b))', () => {
    const halted = (): NodeWire => fleetNode({ update: { state: 'failed', target: 'v0.0.9', startedAt: NOW - 60_000, detail: 'gate: unit not up' } });

    it('is disabled, described by a line that names the halting node and the Ack, and opens no sheet', () => {
      const apply = vi.spyOn(api, 'applyUpdate');
      render(<UpdateBanner updates={view({ nodes: [halted(), serverNode()] })} />);
      const all = screen.getByRole('button', { name: 'Update all' });
      expect(all).toBeDisabled();
      const reasonId = all.getAttribute('aria-describedby');
      expect(reasonId).not.toBeNull();
      const reason = document.getElementById(reasonId!);
      expect(reason?.textContent).toBe('Update all waits: nothing moves until fleet is acknowledged — tap Ack on it in the halt banner.');
      expect(reason?.className, 'an existing class: no new rule for the contrast audit').toBe('update-banner-msg');
      expect(all).toHaveAccessibleDescription(reason!.textContent!);
      fireEvent.click(all);
      expect(screen.queryByRole('list', { name: 'Nodes this moves, in order' })).toBeNull();
      expect(apply).not.toHaveBeenCalled();
      // The release line still speaks; only the move waits.
      expect(screen.getByText(/^v0\.0\.9 is out on stable/)).toBeInTheDocument();
    });

    it('a reverted server row halts it too, and a failed provenance verdict does not', () => {
      render(<UpdateBanner updates={view({ nodes: [fleetNode(), serverNode({ update: { state: 'reverted', target: 'v0.0.9', startedAt: null, detail: null } })] })} />);
      expect(screen.getByRole('button', { name: 'Update all' })).toBeDisabled();
      expect(screen.getByText(/^Update all waits: nothing moves until server is acknowledged/)).toBeInTheDocument();
      cleanup();
      render(<UpdateBanner updates={view({ nodes: [fleetNode({ update: { state: 'failed', target: 'v0.0.9', startedAt: null, detail: 'provenance: unsigned bundle' } }), serverNode()] })} />);
      const all = screen.getByRole('button', { name: 'Update all' });
      expect(all).not.toBeDisabled();
      expect(all).not.toHaveAttribute('aria-describedby');
      expect(screen.queryByText(/^Update all waits/)).toBeNull();
    });

    it('enables again on the poll after the ack, with no reason line', () => {
      const { rerender } = render(<UpdateBanner updates={view({ nodes: [halted(), serverNode()] })} />);
      expect(screen.getByRole('button', { name: 'Update all' })).toBeDisabled();
      rerender(<UpdateBanner updates={view({ nodes: [fleetNode({ update: { state: 'idle', target: 'v0.0.9', startedAt: null, detail: 'acknowledged by the operator' } }), serverNode()] })} />);
      expect(screen.getByRole('button', { name: 'Update all' })).not.toBeDisabled();
      expect(screen.queryByText(/^Update all waits/)).toBeNull();
    });
  });
  ```
  Append to `update-move-sheet.test.tsx`:
  ```tsx
  // Programme wave 14, R15(b) (D-4269): a `halted` skip is about the whole fleet, so it is said even for a node the plan
  // never named. The shape: the server row FAILED on the tag this move names (it runs it already, so the plan does not
  // list it), and the fleet node is requested — the request then waits behind that halt until the ack. Before this
  // wave the sheet closed on that 202 as if the fleet had started moving.
  describe('UpdateMoveSheet — a halted skip of a node the plan never named (R15(b))', () => {
    it('is said in the sheet, beside what was requested, and the sheet stays open', async () => {
      vi.spyOn(api, 'applyUpdate').mockResolvedValue(requestAllAnswer([
        { nodeId: FLEET_ID, fleet: true, does: 'requested' }, { nodeId: SERVER_ID, fleet: false, does: 'halted' },
      ]));
      const halting = server({ current: stamp('v0.0.10'), update: { state: 'failed', target: 'v0.0.10', startedAt: T0, detail: 'gate: unit not up' } });
      const { onClose, onDone } = mount(plan(UP, [halting, node()]));
      expect(lines(), 'the plan names only the fleet node').toEqual(['1. fleet (fleet) v0.0.9 → v0.0.10']);
      fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
      const said = await screen.findByRole('alert');
      expect(said.textContent).toBe(`Not requested — server: ${moveSkipText('halted')} Requested: fleet.`);
      expect(onDone, 'a request was written — re-poll').toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('every other word a node the plan never named was skipped with stays unsaid (the plan agreeing with the server)', async () => {
      vi.spyOn(api, 'applyUpdate').mockResolvedValue({
        ok: true, requested: [FLEET_ID], skipped: [{ nodeId: SERVER_ID, why: 'busy' }],
      });
      const { onClose } = mount(plan(UP, [server({ current: stamp('v0.0.10') }), node()]));
      fireEvent.click(screen.getByRole('button', { name: 'Update v0.0.10' }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
  ```
  In `api.test.ts`, the literal at line 1289 becomes the new sentence (Step 4).
- [ ] **Step 3: Run, expect red** *(prototype, with `UpdateBanner.tsx`, `UpdateMoveSheet.tsx` and `api.ts` at `8b0547b4`)*:
  - `update-banner -t "R15"`: 3 failed (all three);
  - `update-move-sheet -t "R15"`: 1 failed (`is said in the sheet, …`) and 1 passed (`every other word …`, which pins today's behaviour);
  - `api -t "has its sentence for every UpdateRouteError"`: 1 failed.
- [ ] **Step 4: Implement.**
  - **`UpdateBanner.tsx`.**
    - Append to the header comment, after `// where the release list is.`:
      ```ts
      //
      // WHILE A NODE HALTS THE FLEET (programme wave 14, R15(b)), Update all is
      // disabled, and a second line says why and where the remedy is: the halt
      // banner's Ack. Before this wave the tap opened the sheet, the route answered
      // 202, and the sheet said "acknowledge that node" with no Ack in sight. Who
      // halts is `haltingNodes` (updateHalt.ts), the dispatcher's own rule from L0;
      // the line is tied to the button by aria-describedby. The route is unchanged:
      // `{all: true}` still answers 202 for a tap that lands before the poll sees
      // the halt, and the sheet says that skip (UpdateMoveSheet's moveSkippedText).
      ```
    - `import { useState } from 'react';` becomes `import { useId, useState } from 'react';`.
    - After `import { planMove, type PlannedMove } from './movePlan';`, add `import { haltingNodes, updateAllHaltedText } from './updateHalt';`.
    - After `const [move, setMove] = useState<PlannedMove | null>(null);`, add `const haltedId = useId();`.
    - After `const text = …;`, add:
      ```ts
        const halting = view !== null ? haltingNodes(view.nodes) : [];
        const halted = halting.length > 0 ? updateAllHaltedText(halting) : null;
      ```
    - After the `update-banner-msg` span, add `{halted !== null && <span className="update-banner-msg" id={haltedId}>{halted}</span>}`.
    - On the Update all button, before `onClick`, add the lines below. There is no click guard: React dispatches no click to a disabled button, so a guard could never red.
      ```tsx
                    disabled={halted !== null}
                    aria-describedby={halted !== null ? haltedId : undefined}
      ```
  - **`UpdateMoveSheet.tsx`.**
    - The header sentence that ends `and is not said.` becomes:
      ```ts
      // the sheet never listed is the plan agreeing with the server, and is not said
      // — EXCEPT `halted` (programme wave 14, R15(b); D-4269). A halting row is a
      // fact about the whole fleet, not that node: every request the same reply wrote
      // waits behind it until the ack. A failed row already at the tag is never named
      // by the plan, so before this wave the sheet closed on that 202 as if the move
      // had started.
      ```
    - The `moveSkippedText` docstring becomes:
      ```ts
      /** The answers' skips of nodes this plan NAMED — the server refused them for a reason the plan could not preview.
       *  A skip of a node the plan never listed is the plan agreeing with the server, and is not said, unless it is
       *  `halted`: that node holds every other request until it is acked (D-4269), so it is named through the plan's
       *  inventory (moveLabel). */
      ```
    - Its line `const label = named.get(s.nodeId);` becomes:
      ```ts
            const label = named.get(s.nodeId) ?? (s.why === 'halted' ? moveLabel(plan, s.nodeId) : undefined);
      ```
  - **`lib/api.ts`** (and the literal at `api.test.ts:1289`, which gets the sentence only, with no comment):
    ```ts
      // Programme wave 14, R15(b) (D-4268): names WHERE the remedy is. The operator read the earlier "acknowledge that
      // node" with the only Ack on another screen, labelled Ack, not "acknowledge".
      halted: 'An update failed or was reverted, and nothing moves until that node is acknowledged — tap Ack on it in the halt banner on the fleet screen, or on its row in Settings.',
    ```
- [ ] **Step 5: Run:** `update-banner` (**32**), `update-move-sheet` (**38**), `api` (**102**), `move-plan` (**22**), `settings-screen` (**132**). *(revision, measured: `update-banner` 32, `update-move-sheet` 38, `settings-screen` 132; the others are the prototype's.)*
- [ ] **Step 6: Mutation table** *(prototype; T5-1 and T5-3 re-measured in the revision)*.

  | Row | File | Mutation | Command(s) | Measured red |
  |---|---|---|---|---|
  | T5-1 | `UpdateBanner.tsx` | delete `disabled={halted !== null}` | `update-banner`; `fleet-screen -t "programme wave 14"` | `update-banner` 3 (all three R15(b) cases); `fleet-screen` 1 (`names the halt, …`) |
  | T5-2 | `UpdateBanner.tsx` | delete the `aria-describedby` line | `update-banner` | 1 (`is disabled, described by a line …`) |
  | T5-3 | `UpdateBanner.tsx` | delete the reason span | `update-banner` | 2 (`is disabled, described by …`, `a reverted server row halts it too …`) |
  | T5-4 | `UpdateMoveSheet.tsx` | `const label = named.get(s.nodeId);` (main's line) | `update-move-sheet` | 1 (`is said in the sheet, beside what was requested, …`) |
  | T5-5 | `UpdateMoveSheet.tsx` | `?? moveLabel(plan, s.nodeId)` for every word | `update-move-sheet` | 3 (`every other word …`, `a 202 that skipped a node the sheet NAMED says so …`, `a skip of a node the sheet never listed …`) |
  | T5-6 | `lib/api.ts` | main's `halted` sentence | `api`; `update-move-sheet` | `api` 1 (`has its sentence for every UpdateRouteError but unauthenticated`); `update-move-sheet` 38 green (its assertions are symbolic, `moveSkipText('halted')`) |
- [ ] **Step 7: Commit:** `feat(update): Update all waits on a halt and says why; the sheet says every halted skip; the halted sentence names the Ack (wave 14, R15b; D-4268, D-4269)`.

### Task 6: R15(c) — the skew banner's remedy: the halt and what follows it, the console's own move, or the terminal

**Files:** `pwa/src/fleet/FleetHostBanner.tsx`, `pwa/src/screens/FleetScreen.tsx`, `pwa/test/fleet-host-banner.test.tsx`.

- [ ] **Step 1: Re-measure.**
  ```bash
  cd pwa
  grep -nF "          The two boxes run different builds.{fleet} Run <code>ccrc rollout</code> from the deploying" src/fleet/FleetHostBanner.tsx   # 99
  grep -nF "  { health: injected, nodes }: { health?: FleetHealth | null; nodes?: readonly NodeWire[] | null } = {}," src/fleet/FleetHostBanner.tsx   # 50
  grep -nF "//    rollout\`/\`ccrc update\`, run from a terminal. \`'unknown'\` remains silent," src/fleet/FleetHostBanner.tsx   # 24
  grep -nF "import type { FleetHealth, NodeWire } from '../../shared/api';" test/fleet-host-banner.test.tsx
  grep -nF "  channel: 'stable', desiredTag: current?.version ?? null, resolveDetail: null," test/fleet-host-banner.test.tsx   # inventoryNode: caps [], a desiredTag
  ./node_modules/.bin/vitest list test/fleet-host-banner.test.tsx | wc -l    # 21
  ```
- [ ] **Step 2: Write the cases first (red).** In `fleet-host-banner.test.tsx`, add `UpdateIntentWire` to the type import, then append:
  ```tsx
  // Programme wave 14, R15(c): the skew arm's remedy is skewRemedy's (updateHalt.ts). The TRIGGER is unchanged
  // (`health.build`, D-3312); only the advice moves. The existing cases above keep the terminal verbs because their
  // rows carry no `detach` cap and no intent: that is the `cli` arm, pinned below in its own right.
  describe('FleetHostBanner — the skew arm\'s remedy (R15(c))', () => {
    const skewed = health({ connected: true, downSince: null, roster: 'agreed', build: 'skewed' });
    const movable = (role: 'fleet' | 'server', current: BuildInfo): NodeWire =>
      ({ ...inventoryNode(role, current), caps: ['detach', 'update-gate'], agentOps: role === 'fleet' ? ['update'] : null });
    const autoOn: UpdateIntentWire[] = [{ scope: '*', channel: 'stable', pinnedTag: null, auto: 'stable', notify: 'off', setAt: 1, setBy: 'pwa' }];
    const msg = (): string => document.querySelector('.fleet-host-banner-msg')?.textContent ?? '';

    it('while a node halts the fleet and auto will move the box after the ack, it points at the halt, never at the terminal', () => {
      const fleet = { ...movable('fleet', FLEET_V7), update: { state: 'failed' as const, target: 'v0.0.9', startedAt: 1, detail: 'gate: unit not up' } };
      render(<FleetHostBanner health={skewed} nodes={[fleet, movable('server', SERVER_V9)]} intent={autoOn} />);
      expect(msg()).toBe('The two boxes run different builds. fleet v0.0.7 (bd2bf57a) · server v0.0.9 (2985b9d1). '
        + 'Nothing moves until fleet is acknowledged — tap Ack on it in the halt banner; auto-install then moves the lagging box.');
      expect(screen.queryByText(/ccrc rollout/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('a halt is named even with auto off and nodes the console cannot move — and then the terminal, never a console move', () => {
      const fleet = { ...inventoryNode('fleet', FLEET_V7), update: { state: 'reverted' as const, target: 'v0.0.9', startedAt: 1, detail: null } };
      render(<FleetHostBanner health={skewed} nodes={[fleet, inventoryNode('server', SERVER_V9)]} />);
      expect(msg()).toBe('The two boxes run different builds. fleet v0.0.7 (bd2bf57a) · server v0.0.9 (2985b9d1). '
        + 'Nothing moves until fleet is acknowledged — tap Ack on it in the halt banner, then run ccrc rollout from the '
        + 'deploying machine, or ccrc update on the lagging box, fleet box first.');
      expect(msg()).not.toMatch(/auto-install|console/i);
    });

    it('a halt with auto on but a box auto would not move (no update-gate): the halt, then the terminal', () => {
      const fleet = { ...movable('fleet', FLEET_V7), update: { state: 'failed' as const, target: 'v0.0.9', startedAt: 1, detail: 'x' } };
      render(<FleetHostBanner health={skewed} nodes={[fleet, { ...movable('server', SERVER_V9), caps: ['detach'] }]} intent={autoOn} />);
      expect(msg()).toContain('tap Ack on it in the halt banner, then run ccrc rollout');
      expect(msg()).not.toMatch(/auto-install/i);
    });

    it('auto on and every node movable from the console: it points at the console\'s own move, in Settings', () => {
      render(<FleetHostBanner health={skewed} nodes={[movable('fleet', FLEET_V7), movable('server', SERVER_V9)]} intent={autoOn} />);
      expect(msg()).toBe('The two boxes run different builds. fleet v0.0.7 (bd2bf57a) · server v0.0.9 (2985b9d1). '
        + 'Auto-install is on and the console can move the lagging box — follow the move in Settings.');
      expect(screen.queryByText(/ccrc rollout|ccrc update/)).not.toBeInTheDocument();
    });

    it('auto off, a node the console cannot move, or no intent: the terminal verbs, as before', () => {
      const cli = 'Run ccrc rollout from the deploying machine, or ccrc update on the lagging box, fleet box first.';
      const off: UpdateIntentWire[] = [{ ...autoOn[0]!, auto: 'off' }];
      const { rerender } = render(<FleetHostBanner health={skewed} nodes={[movable('fleet', FLEET_V7), movable('server', SERVER_V9)]} intent={off} />);
      expect(msg()).toContain(cli);
      rerender(<FleetHostBanner health={skewed} nodes={[movable('fleet', FLEET_V7), inventoryNode('server', SERVER_V9)]} intent={autoOn} />);
      expect(msg()).toContain(cli);
      rerender(<FleetHostBanner health={skewed} nodes={[movable('fleet', FLEET_V7), movable('server', SERVER_V9)]} />);
      expect(msg()).toContain(cli);
      rerender(<FleetHostBanner health={skewed} nodes={null} intent={autoOn} />);
      expect(msg(), 'no inventory answer: the console cannot vouch for a move').toContain(cli);
    });
  });
  ```
- [ ] **Step 3: Run, expect red** *(prototype shape, with `FleetHostBanner.tsx` at `8b0547b4`)*: `fleet-host-banner -t "R15"` fails the four cases that need the new arms and passes `auto off, … the terminal verbs, as before` (today's arm).
- [ ] **Step 4: Implement.**
  - In the header's BUILD SKEWED bullet, the text from `versions until that answer is in.` to the end of the bullet becomes:
    ```ts
    //    versions until that answer is in. No action button. The REMEDY it names is
    //    `skewRemedy`'s (updateHalt.ts; programme wave 14, R15(c)): while a node
    //    halts the fleet, the halt and its Ack (the halt banner), then what happens
    //    after the ack; while the fleet's auto-install is on and auto would move
    //    every node that has a tag to move to, the console's own move, followed in
    //    Settings; otherwise — and whenever the inventory has not answered, or a
    //    lease could not be read — `ccrc rollout`/`ccrc update` from a terminal.
    //    `'unknown'` remains silent, same rule as the two above.
    ```
  - Add `UpdateIntentWire` to `import type { FleetHealth, NodeWire } from '../../../shared/api';`. After `import { remoteSides, statedOf } from '../../../shared/update-summary';`, add `import { SKEW_AUTO_TEXT, SKEW_HALT_THEN_AUTO_TAIL, skewHaltLead, skewRemedy } from './updateHalt';`.
  - The props become:
    ```tsx
      { health: injected, nodes, intent }: {
        health?: FleetHealth | null; nodes?: readonly NodeWire[] | null; intent?: readonly UpdateIntentWire[] | null;
      } = {},
    ```
  - In the skew arm, after `const fleet = …;` add `const remedy = skewRemedy(nodes, intent);`. The message span's body becomes:
    ```tsx
              The two boxes run different builds.{fleet}{' '}
              {remedy.kind === 'halt' && remedy.then === 'auto' ? (
                `${skewHaltLead(remedy.halting)}${SKEW_HALT_THEN_AUTO_TAIL}`
              ) : remedy.kind === 'halt' ? (
                <>
                  {skewHaltLead(remedy.halting)}, then run <code>ccrc rollout</code> from the deploying machine, or{' '}
                  <code>ccrc update</code> on the lagging box, fleet box first.
                </>
              ) : remedy.kind === 'auto' ? (
                SKEW_AUTO_TEXT
              ) : (
                <>
                  Run <code>ccrc rollout</code> from the deploying machine, or <code>ccrc update</code> on the lagging
                  box, fleet box first.
                </>
              )}
    ```
  - In `FleetScreen.tsx`, `<FleetHostBanner health={fleetHealth} nodes={updates.view?.nodes ?? null} />` becomes `<FleetHostBanner health={fleetHealth} nodes={updates.view?.nodes ?? null} intent={updates.view?.intent ?? null} />`.
- [ ] **Step 5: Run:** `fleet-host-banner` (**26**), `fleet-screen` (**100**), `build-line` (**17**), `use-updates-view` (**30**), and `./node_modules/.bin/tsc --noEmit -p .` is clean. *(revision, measured: `fleet-host-banner` 26, `fleet-screen` 100, `tsc` clean; the others are the prototype's.)*
- [ ] **Step 6: Mutation table** *(prototype; re-measured in the revision)*.

  | Row | File | Mutation | Command(s) | Measured red |
  |---|---|---|---|---|
  | T6-1 | `FleetHostBanner.tsx` | `skewRemedy(nodes, null)` | `fleet-host-banner`; `fleet-screen -t "programme wave 14"` | `fleet-host-banner` 2 (`while a node halts the fleet and auto will move the box …`, `auto on and every node movable …`); `fleet-screen` 2 (both wave-14 cases) |
  | T6-2 | `FleetScreen.tsx` | drop ` intent={updates.view?.intent ?? null}` | `fleet-screen -t "programme wave 14"` | 2 (both wave-14 cases) |
  | T6-3 | `updateHalt.ts` | T3-8 (no halt arm) | `fleet-host-banner`; `fleet-screen -t "programme wave 14"` | `fleet-host-banner` 3; `fleet-screen` 1 (as T3-8) |
  | T6-4 | `FleetHostBanner.tsx` | `{remedy.kind === 'halt' ? (` (the `then` ignored) | `fleet-host-banner` | 2 (`a halt is named even with auto off …`, `a halt with auto on but a box auto would not move …`) |
- [ ] **Step 7: Commit:** `feat(update): the skew banner names the halt and what follows it, or auto's own move, and the terminal verbs only when the console cannot vouch (wave 14, R15c)`.

### Task 7: The gate and the PR

- [ ] **Step 1: Start from a merged, clean tree.**
  - `git fetch origin main`. If `origin/main` moved past the Task 1 merge, merge again, keep both sides, and record `git show --remerge-diff HEAD`.
  - Stop and report if `main` changed any of: `dispatch.ts`, `UpdateBanner.tsx`, `FleetHostBanner.tsx`, `UpdateMoveSheet.tsx`, the Ack in `SettingsScreen.tsx`, the banner column in `FleetScreen.tsx`, `UPDATE_ERROR_TEXT` in `lib/api.ts`, `useUpdatesView.ts` or the tail of `fleet.css`.
- [ ] **Step 2: Dependencies.** Run `npm ci` in `server/`, `pwa/` and `agent/` wherever `node_modules` is absent.
- [ ] **Step 3: Suites, one file per call, foreground, timeout ≥ 600000 ms.** The counts are measured at `8b0547b4`.
  - `pwa`:
    - `halt-banner` (**13**), `update-halt` (**36**), `update-banner` (**32**), `fleet-host-banner` (**26**), `update-move-sheet` (**38**), `api` (**102**), `fleet-screen` (**100**), `settings-screen` (**132**), `move-plan` (**22**), `use-updates-view` (**30**), `build-line` (**17**), `contrast` (**256**), `fleet-css` (**80**);
    - `./node_modules/.bin/tsc --noEmit -p .`;
    - `./node_modules/.bin/vite build --outDir "$SCRATCH/dist" --emptyOutDir` (green; never into the tree);
    - `node design/contrast-check.mjs` (`ALL 628 PASS`).
  - `server`:
    - `update-move` (**15**), `update-dispatch` (**92**), `update-apply-routes` (**53**), `update-auto-dispatch` (**15**), `update-converge` (**85**), `update-lease-holder` (**7**), `update-op-answer` (**45**), `update-routes` (**38**), `update-store-nodes` (**43**), `update-watchdog-revert` (**16**), `update-summary` (**17**), `box-token-census` (**23**);
    - `single-definition` at `main`'s count (this wave adds nothing to it; **275** at `8b0547b4`);
    - `typecheck-tests` (**12**);
    - `./node_modules/.bin/tsc --noEmit -p .`.

  If a known load flake reds (CLAUDE.md's list, which includes `typecheck-tests`), or the heir-guard case in `update-store-nodes` reds (Risk notes), re-run it IN ISOLATION before calling it a break.
- [ ] **Step 4: The ledger and scope guards, last.**
  ```bash
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
  ./node_modules/.bin/vitest run test/dtbd.test.ts
  ./node_modules/.bin/vitest run test/topology-clean.test.ts
  cd ..
  # the derived scope check (Global Constraints) — prints nothing
  git diff --stat origin/main...HEAD     # exactly File structure's New and Changed lists
  ```
  Then the D-number check. Every D-token the branch adds must either already be on `origin/main`, or be one of 4266–4274 and defined in this plan. It prints nothing:
  ```bash
  PLAN=docs/superpowers/plans/2026-10-06-centralised-update-w14-halt-on-home.md
  git diff origin/main...HEAD | grep '^+' | grep -oE 'D-[0-9]{4}\b' | sort -u > "$SCRATCH/dnums"
  while read -r d; do
    git grep -qwF -e "$d" origin/main -- docs/superpowers && continue          # cited as it stands
    case "${d#D-}" in
      426[6-9]|427[0-4]) grep -qE "^- \*\*$d\*\* — " "$PLAN" || echo "UNDEFINED $d" ;;
      *) echo "OUTSIDE THE BLOCK OR THE RESERVE: $d" ;;
    esac
  done < "$SCRATCH/dnums"
  ```
- [ ] **Step 5: The PR,** from the workspace branch.
  - **Its first paragraph says:**
    - the home screen now names a halted node and acks it in place, through the same route and `canAck` Settings uses, once per lease;
    - Update all waits on a halt and says why;
    - the skew banner says what will really move the lagging box: auto only where the dispatcher's own auto path would;
    - the dispatcher's halt rule, its capability clauses and `autoPermits` moved to L0 unchanged (D-4266);
    - the server bundle carries the PWA to the server box on the next release, by auto.
  - **The body has** one section per task, carrying D-4266 to D-4269 by number, and the CSS reading the coordinator ruled.
  - **Links:** the plan and the files as GitHub `blob/main` URLs built from `git remote get-url origin`, with the PR's `/files` view beside each until the merge. Never a docserver URL.
  - The body is hand-written and ends with the attribution line the session's instructions give.
  - Every commit's author and committer are the noreply identity: check with `git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD`.
  - **After CI starts,** read the PR's `select tests` summary. It must list `update-move`, `update-dispatch`, and the update-route and store files that import `dispatch.ts`. If one is missing, run `gh workflow run ci.yml --ref <branch> -f mode=full` and name that run in the wave-done.
- [ ] **Step 6: The wave-done, in the same turn as the push.** It carries:
  - the tip sha, the PR number and the remerge-diff result;
  - each suite's count, and the load;
  - every mutation row (T1-1 … T6-4, C-1 … C-4), with its measured red set against the listed set and the assertion that fired;
  - which CSS reading was taken;
  - any reserve number spent, defined in this plan in the commit that cites it.

## Readings (for the coordinator to rule; each was chosen where no ruling decided it)

1. **Where the halt banner's rules live.** At revision, the claims that blocked this have ended: 1048 held `fleet.css` and 1049 held the `contrast.test.ts` sheet list.
   - (a) Append to `fleet.css`. This is the plan's code, measured in place: `contrast` 256, `fleet-css` 80, `ALL 628 PASS`, and C-1 to C-4 red as listed.
   - (b) A new `pwa/src/fleet/halt-banner.css`. `contrast.test.ts`'s `discovers them from disk rather than from a list` reds until one line joins its list (measured), so this needs a test-list edit.
   - (c) An unclaimed existing sheet (`styles/shell.css`): a fleet banner's rules in the shell's sheet. Not measured.
   - (d) No new CSS, reusing `.substrate-banner` and `.substrate-banner-msg` per row, plus `.update-banner-actions .btn-primary`. These are the same pair, padding, radius and font, and the descendant rule is not scoped to `.update-banner`. Read, not rendered. It needs no stylesheet work, but it ties the halt's look to two other components' class names. A later change to the substrate banner would then restyle the halt silently, and the halt's list layout (`flex-direction: column`, one row per node) is not what `.substrate-banner`'s row layout is.

   **Recommended: (a).** Nothing waits on another programme now, and the banner keeps its own class. (d) was the right answer only while (a) waited on run 260.
2. **The product shape (the operator's question 4).**
   - **As drafted:** a banner of its own between the fleet-host banner and the release banner, under the lead `Updates are halted — nothing moves on any node until each one below is acknowledged.` It has one row per halting node, `<label>: <state> (last tried <target>) — <detail>`. Each row has a visible **Ack** (accessible name `Ack <label>`), which reads **Acked** and stays disabled after a clean 200 until a poll shows a new lease.
   - Alternative: the Ack inside the release banner. That banner is absent when no release is out, which is exactly when a halt still matters.
   - Alternative: the Ack inside the skew banner, which is sticky and shared with three other arms.

   **Recommended: as drafted.** The row says "last tried", never "moving to", because a settled lease is not moving and a reverted node went back from that tag.
3. **Update all on a halted fleet: disabled with a reason**, `Update all waits: nothing moves until <labels> is/are acknowledged — tap Ack on it/each in the halt banner.` It promises nothing about what moves after the ack. The alternative is to leave it enabled, with the sheet listing the halt and offering the Ack there; that costs one more tap, and the sheet shows a move it will not make. **Recommended: disabled.**
4. **The `halted` sentence (D-4268)** names both places the Ack is. Alternatives: name only the halt banner, or keep the old sentence and rely on the banner. **Recommended: as drafted**, because a single-node 409 from Settings reads it too, and there the halt banner is one screen away.
5. **The sheet's halted skip of an unnamed node (D-4269).** **Recommended: say it.** It is the only remaining 202 that hides a halt: a tap racing the poll, or Settings' release-row Install, which also sends `{all: true}`. The alternative leaves it silent and relies on the halt banner after the re-poll.
6. **When the skew arm advises the console's own move.**
   - (a) As drafted: the fleet row's auto is a known word other than `off`, at least one node has a `desiredTag`, and every such node passes `autoWouldMove`. That is consoleCanMove, carriesUpdateGate, autoPermits for its channel, and a tag to move to, i.e. the dispatcher's own auto path from L0.
   - (b) Also add a request-path arm. When auto would not move the box but the console can on a request (`consoleCanMove` holds and a tag exists), say "the console can move the lagging box — start the move in Settings". This is one more constant and two cases.
   - (c) Also resolve a per-node intent row (`node row ?? fleet row`), which would be a PWA copy of a server rule.

   **Recommended: (a) now**, and (b) if the operator wants the console named whenever a tap could move the box.
7. **With no inventory answer, or a lease that cannot be read**, the skew arm keeps the terminal verbs. The alternative drops the remedy sentence. **Recommended: keep it.** On a box with no control plane they are the right advice, and the console cannot vouch for a move it cannot see.
8. **Colour: attention amber**, the existing pair (8.52:1 / 4.94:1). Danger red would say "fault", which a failed update is, but the fleet-host banner's red arm means "unreachable", and a halt is a state with a one-tap remedy. **Recommended: amber.**
9. **`role="status"`, not `alert`.** The banner persists across 60 s polls, and React does not re-announce unchanged text. **Recommended: status**, like every banner on the screen.
10. **No server change for `{all: true}`.** A 409 on a halted fleet would break "`{all: true}` always answers 202" (`routes.ts`) and its tests, and would refuse the rows the dispatcher could still request. **Recommended: none.** The PWA disables the door, and the sheet says the skip.
11. **Requests written while a halt stood** (a racing `{all: true}`, which `NO_HALT` lets through) move after the ack. The halt banner could list each row's standing request (`requestLine`). **Recommended: not this wave**; residue if the operator wants it.
12. **The store's two forms of the halt** (`rowHalts` and `haltingRowSql` in `store.ts`), plus Settings' own `caps.includes(UPDATE_GATE_CAP)` at `SettingsScreen.tsx:87`. **Recommended: residue for a later wave.** `rowHalts` can call `isHaltingUpdate`, and the Settings line can call `carriesUpdateGate`. The SQL form stays, pinned by `update-store-nodes`' heir-guard spread.
13. **Docs.** README's passages on the skew banner (its "different builds" line), on Update all and on the move sheet, and the spec's §13 text, still describe the old advice. README is held by claim 1055 at revision. **Recommended: the coordinator's docs PR after the merge.**
14. **An unreadable lease** (an `update` that is absent, null, or has a non-string state): what the halt banner and Update all do with it.
    - (a) As drafted: they treat it as not halting, and `skewRemedy` answers `cli`, so it never vouches for a move. The server's dispatcher gate stays the authority. A 202 that skips such a node as `halted` is said by the sheet (D-4269).
    - (b) Also disable Update all, with "a node's update state could not be read — reload".

    **Recommended: (a)** this wave. `asUpdatesView` already drops malformed rows it can see. (b) would let a wire glitch block the one door the server would still let through.
15. **A stale view after a failed poll.** `useUpdatesView` keeps the last good view and reports `failure` beside it. The halt banner, Update all and the skew arm read `view` only, as `UpdateBanner` always has.
    - (a) As drafted.
    - (b) Pass `updates.failure`, qualify the halt lead ("as of the last read — the screen could not re-check"), and have `skewRemedy` answer `cli` while a failure stands.

    **Recommended: (a) now, and (b) as one residue item for every update surface at once**, so they mark staleness alike. The Ack's hold per lease already stops the double-ack this risk would invite.
16. **Settings' release-row Install while a halt stands.** It still opens the sheet and gets the 202 with a `halted` skip, which D-4269 now says. Options: disable it (and the per-node Update) with `updateAllHaltedText`'s line from the same function, or leave it. **Recommended: residue for the next PWA wave.** It touches `SettingsScreen.tsx`'s release list and its tests, outside R15's Update all.
17. **The skew arm while a halt stands with `then: 'cli'`** reads: `Nothing moves until <label> is acknowledged — tap Ack on it in the halt banner, then run ccrc rollout … fleet box first.` It names the terminal only after the Ack. The alternative ends at the Ack and says nothing of what follows. **Recommended: as drafted.** After the ack, the terminal is the only door, and saying so avoids a second wait.
18. **The census's reach (Review Focus 1)** is exactly the spelling `startsWith(PROVENANCE_DETAIL_PREFIX)` plus the declared names. Widening it would mean a `'provenance:'` literal holder pin (`shared/api.ts` only) and a pin that `=== 'reverted'` appears in `pwa/src` only in `updateAck.ts`. Each would come with a CONTROL case and a mutation row. **Recommended: as drafted.** The likely copy (a PWA re-implementation of `haltingNodes`) has to import the L0 rule to agree with the property cases in `update-halt` and `halt-banner`.

## Coordinator rulings on this plan's readings (2026-10-06)

The operator was shown the designs as mockups: the halt banner, Update all, the skew banner's three cases, the wording, the colour, and the three gaps. At 19:00 UTC the ruling was "all recommended". So every Reading above is ruled as its **Recommended** line says. The product-facing ones, in short:

- **Reading 1:** (a). The halt banner's rules are appended to `fleet.css`, which is unclaimed now.
- **Reading 2:** the halt banner of its own, between the fleet-host banner and the release banner. One row per halting node, `<label>: <state> (last tried <target>) — <detail>`, each with its own **Ack**. The Ack reads **Acked** and stays down until a poll shows a new lease.
- **Reading 3:** Update all is disabled on a halted fleet, with the reason line.
- **Readings 4 and 5:** the `halted` sentence names both places the Ack is (D-4268), and the sheet says a halted skip of an unnamed node (D-4269).
- **Reading 6:** (a). The console's own move is advised only where the dispatcher's own auto path would move every lagging node. The request-path arm, (b), is not taken.
- **Readings 7 and 17:** with no inventory answer or an unreadable lease, and in the halted `then: 'cli'` case, the terminal verbs stay.
- **Readings 8 and 9:** attention amber, and `role="status"`.
- **Reading 10:** no server change for `{all: true}`.
- **Readings 11, 12, 13, 15 and 16** go to the programme's residue: requests written while a halt stood; the store's two forms of the halt and Settings' `UPDATE_GATE_CAP` line; README and the spec, which are the coordinator's docs PR after the merge; staleness marked alike on every update surface; and Settings' release-row Install.
- **Reading 14:** (a). An unreadable lease is not halting, and the skew arm answers `cli`.
- **Reading 18:** the census as drafted.

No reading changes the plan's code or its Deviations found.
