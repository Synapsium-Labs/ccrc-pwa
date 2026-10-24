# ccrc architecture — bounded contexts, rings, and how they stay true

**Status:** assessment complete, adoption incremental. Operator directive 2026-08-10:
"we need to ensure the project follows ddd, clean, solid principles."

**Verdict in one sentence:** this repo has an unusually good domain *vocabulary* and no
domain *model* — and the prescription is **not layers**. The existing discipline (typed
total refusal sets, derived runtime lists, `single-definition.test.ts`'s scanner, the
`CcdArgv` brand, consumer-declared dep interfaces) is better than a conventional
clean-architecture retrofit would produce. The work is to point mechanisms that already
exist at concepts that never got one.

## The evidence: a natural experiment already ran

`RunState` and `MailDeliveryState` shipped in the same build, a week apart, one
structural difference between them.

| | `RunState` | `MailDeliveryState` |
|---|---|---|
| transition table | `RUN_TRANSITIONS`, one place | none |
| writers | one (`advanceInner`) | nine, across eight methods |
| defects | D-9, D-64 — both about the table's *content*, both one-line fixes, neither able to recur silently | the same terminality guard forgotten and re-added **four times**: finding 22 → D-62 → D-66 → D-67 |
| status | closed | **one gap left** (ARCH-15, #532) |

When this was written (2026-08-10), `bumpReplayCount` and `markIngested` wrote with a bare
`WHERE id = ?` while `markDelivered`/`rejectDelivery`/`backOff` carried
`state NOT IN ('acked','rejected')`, and `markDelivered` returned `void`, so `watch.ts`
could not see its write was refused and bumped the replay counter of a row a concurrent
park had just closed.

Re-verified on `main` for ARCH-02a (D-6000), cited by symbol:
- **Closed:** all five `CoordStore` writers (`bumpReplayCount`, `markIngested`,
  `markDelivered`, `rejectDelivery`, `backOff`) carry `state NOT IN ${TERMINAL_DELIVERY_SQL}`,
  built from L0's `TERMINAL_DELIVERY_STATES` (`shared/api.ts`). `bumpReplayCount` answers
  `{ state: 'counted'; replayCount } | { state: 'terminal' }`, and its one caller,
  `FleetWatcher.sweepMail` (`watch.ts`), consumes it: it rejects at the ceiling only when
  `bumped.state === 'counted'`, so a row a park closed is no longer counted.
- **Still open:** `markDelivered` still returns `void`, so its caller in `sweepMail` cannot
  see that its write was refused. One guarded writer primitive whose outcome reaches every
  caller is ARCH-15 (#532).

The invariant with a home costs one line to fix and cannot regress. The identical
invariant with no home cost four review rounds and was still not finished when this was
written. That is the whole DDD argument, measured rather than asserted.

## Bounded contexts

1. **Fleet Registry & Accounts** — what sessions exist and where they live. *This is the
   context with no type today, which is why it is first.* "An account" (operator word) =
   "a wrapper" (ccd word) is smeared across `loadConfig.wrappers`, `idHomeWrapper`,
   `ACCOUNT_ORDER`, `HOME_ABLE_WRAPPERS`, pwa's `ACCOUNTS`/`KNOWN_WRAPPERS`, ccd's
   `_cfg_dir`/`_id_wrapper`/`VALID_WRAPPERS`, and `install-session-hooks.sh` — eight
   enumerations in three languages. A missing entry in one of them killed chat for six of
   24 sessions, silently, for as long as that account existed.
   Language: session id; **account** = **wrapper** (`Wrapper` is the type, "account" is
   the human word); config dir; home vs pool vs lastswap; **home-able**, **ccd-valid**,
   **hooks-able** (three different subsets, deliberately not equal);
   **presence: present / absent / unmeasurable** — today all three are `null`.
2. **Fleet Mutation** — `CCD_ARGV`, the brand, the agent whitelist, exec/pty/tmux. The
   invariant: no other context may *name* a mutation, only mint a `CcdArgv`.
3. **Session Conversation** — attaching a human to one running agent: transcript
   resolution, backlog, rotation, injection, ask envelopes. Language: attach; resolve and
   its refusals (today one overloaded `null`); **reset** (the file shrank — rotation, not
   truncation); **derived name** is a handle, never a description.
4. **Workspace & PR Lifecycle** — worktree to merge. Language: **base** is what `ws-add`
   recorded and is never re-derived; **hold** (absence *is* release); **honest stale** as
   a first-class outcome.
5. **Coordination** — Build 7's `coord/`. Language: **transition table** (an absent edge
   is a refusal, and clients read it); **acked and rejected are terminal**; **refusal
   code** — typed, recorded and counted.
6. **Attention & Notification** — what reaches the operator when they are not looking.
   Language: bucket (defined once in `shared/` because two producers must not disagree);
   **push says it happened**, which is why a silent refusal downstream is worse here.
7. **Update control plane** (ARCH-02a) — `server/src/update/`: what each box runs and how
   a move reaches it. Language: **catalogue** (what can be installed), **inventory** (what
   each node runs), **intent** (what the operator asked for), **dispatch** and **converge**
   leases, **server-caps**, **halt** (a failed move stops every move until it is acked).
   Allowed dependencies: L0 (`shared/api.ts`, `agent-protocol.ts`, `semver.ts`,
   `update-move.ts`, `buildinfo.ts`, `base-url.ts`, `refusal.ts`); K's `io.ts` adapter and
   its `remote/client.ts` (the agent link, an L4 platform file); context 1's `config.ts`,
   `fleetidentity.ts`, `fleetstate.ts` and `pools.ts`; context 8's route gate
   (`auth/gate.ts`) at its routes; context 5's `coord/store.ts` (its row types and
   `NODE_ID_RE`) and, at its routes, `coord/token.ts` (`checkMailToken`,
   `MAIL_TOKEN_HEADER`); `fastify` in its L4 files; `node:*` modules as the ring rules
   allow. It reaches coord.db only through the deps it is handed, never the handle
   (single-definition's "the update ring" pin). Its type imports of `server.ts`/`watch.ts`
   are outward edges ARCH-03 drains.
8. **Auth & box token** (ARCH-02a) — `server/src/auth/`, `server/src/token/`: who may
   talk to this server and which box holds the fleet's token. Language: **passkey**
   (a WebAuthn credential), **session** (a signed-in browser), **step-up** ("confirm it's
   you" before an account op), **box token**, **hold** (the token's single holder).
   Allowed dependencies: L0 (`shared/api.ts`, `accounts.ts`, `box-token.ts`,
   `agent-protocol.ts`, `refusal.ts`); `node:*` modules as the ring rules allow; `fastify`
   in its L4 files; K's `refuse.ts`, `io.ts` and `remote/client.ts`; context 1's
   `config.ts`, `pools.ts` and account audit (`accounts/audit.ts`); context 5's
   `coord/token.ts` and `coord/store.ts` (`NODE_ID_RE` and the node row type); context 7's
   inventory (`update/inventory.ts`) for which nodes exist. Its type import of `server.ts`
   is an outward edge ARCH-03 drains.
9. **Docs** (ARCH-02a) — `server/src/docs/` and `shared/docs.ts`: a project's docs read
   through ccd's docs verbs. Language: **ref** (bare or qualified), **section**, **leaf**,
   **draft branch**, **fingerprint**. Allowed dependencies: L0 `shared/docs.ts`; context
   2's `ccdargv.ts`, `lifecycle.ts` and `exec.ts` for the verbs; context 1's
   `fleetstate.ts`; `node:crypto`; `fastify` in its L4 files (single-definition's "the docs
   ring" pin holds the L3 import list).

Every non-test file under `server/src` and `pwa/src` maps to exactly one of these nine
contexts, or to **K**, the shared kernels and platform files (the composition root,
`server.ts`, `watch.ts`, the generic adapters, the PWA shell), which hold no aggregate.
The map is the table in "Deciding a file's ring and context" below.

One boundary is drawn in the wrong place: coordination's *delivery policy* lives in the
notification context (`sweepMail`, 200 lines in `watch.ts`). The cost is mechanical —
`MAIL_REJECT_CODES`' totality scanner must exclude `'undeliverable'` **by name**, because
its only emitter sits outside `coord/`. A hole punched in the one mechanism that makes the
refusal set total, exactly where a module boundary was drawn wrong (D-38).

## Target architecture: six rings, imports point inward

Ring membership is a property of a file's **imports and exports**, not of its path. A
reviewer checks a file by reading its import block.

- **L0 shared kernel** — `shared/`. Imports nothing, not even `node:*`. The ubiquitous
  language artifact: wire types, unions with derived runtime lists and `is*` guards,
  transition tables, the account roster. Stays one module per concern.
  The `.mjs` carve-out: a `shared/*.mjs` file, which the PWA never imports, may import
  `node:crypto`, `node:fs` and `node:url` and no other `node:*` module; a `shared/*.ts`
  file imports no `node:*` module at all. (On `main` today `shared/mark.mjs` imports all
  three and `shared/modelenv.mjs` imports `node:fs`. A new module joins the list by an
  edit to this sentence and to CLAUDE.md's copy of it.)
- **L1 policy** — pure decision functions. May import L0 and L2 *as types only*. No
  `node:fs`, no `fastify`, no `node:sqlite`, **no `reply`**. Narrow deps in, **typed
  result union out** — never a `null` standing for more than one condition. `verifyDone`
  is the model for the ring.
- **L2 ports** — interfaces only. A port's docstring states its **failure contract**;
  `// null = missing` on `FleetIO.readFile` is false today and is the proximate cause of
  at least three ledger entries. Ports are declared **by the consumer** (`SendDeps`,
  `AskDeps`, `VerifyDoneDeps` already do this), not one-per-collaborator by decree.
- **L3 adapters** — `io.ts`, `remote/io.ts`, `exec.ts`, `coord/db.ts`, `store.ts`, `push.ts`.
  **An adapter may not narrow a distinction it received.** `remote/io.ts` receives
  `{ok:false,err}` and `{missing:true}` from the wire and throws both away to match
  `localIO`. That downgrade is the single highest-yield rule in this document.
  A deadline timer inside one adapter call is L3; schedulers and pollers are L4. A timer is
  a deadline inside one adapter call when its handle is a local of that call or is not kept
  at all; a timer whose handle is stored on an object field or at module scope is a
  scheduler or poller. A timer is a `setTimeout` or `setInterval` call; `setImmediate` is a
  yield, not a timer, and decides no ring. A function a scheduler calls on each tick is not
  a poller; the poller is the code that keeps the repeating timer's handle, and a poll whose
  stop handle is returned to its caller is that caller's to schedule. (By this definition
  `io.ts`'s tail fallback poll is a deadline: its handle is a local of one `tailFile` call,
  which returns the stop handle, so `io.ts` stays L3.)
- **L4 delivery** — `server.ts`, `coord/routes.ts`, `sessionws.ts`, `watch.ts`. Owns
  Fastify, sockets, schedulers and pollers, and union→status mapping. Allowed to be big
  and boring; not allowed to **decide**. One-reading test: *if a function here has two
  guards whose order matters, it belongs in L1.*
- **L5 composition root** — `index.ts` only.
  `deps.ts` holds `Deps`, the bag `index.ts` builds and `buildServer` and `FleetWatcher` take. It is a
  composition-root type, not a domain layer: every statement in it is a type, so it emits nothing and is L2 by
  the ring rules, and it sits in K. `server.ts` re-exports it (ARCH-03, #541; the justification ARCH-02b, #537,
  records).

Cross-cutting, each checkable by eye:
(a) **Config is data, not code** — no literal list of account names outside L0's roster;
no `cfg.wrappers[x]` indexing outside `configDirFor`.
(b) **No overloaded null at a seam** — if two conditions a caller would handle
differently produce the same value, that is a defect, not a style question.
(c) No `reply` below L4.
(d) `CcdArgv` values are constructed at their call site — never aliased or table-looked-up;
`verb-gate.test.ts` is blind to all three.
(e) Files do not move across package roots without updating the scanners that walk them —
five scanners pin paths, and stepping outside a walk **silently deletes coverage**.

### Deciding a file's ring and context (ARCH-02a, D-6000)

Every non-test file under `server/src` and `pwa/src` has exactly one ring and exactly one
context. Both are decided by the rules below, from facts a reader can see in the file, so
two readers cannot disagree. The predicates within each package exclude each other by
construction (each clause applies only to a file no earlier clause matched), so a file
matches one ring, never two. A ring is decided from the file's **own** imports and timers.
A runtime import of a file in an outer ring does not move the file outward; it is an
outward edge, which ARCH-04 stage 2 counts and ARCH-05 drains. A type-only import moves
nothing.

**Server rings** (`server/src`):
- **L5:** `index.ts`.
- **L4:** any other file that imports `fastify` or an `@fastify/*` package in any form (a
  type import included), or holds a scheduler or poller (the timer rule under L3).
- **L3:** any other file with a runtime import of a `node:*` module other than
  `node:path`, `node:url`, `node:util` and `node:crypto` (which do no I/O and are allowed in
  L1, as `coord/delegation-model.ts`'s hashing is), or of a server I/O package (`ws`,
  `web-push`, `node-pty`; a new I/O package joins this list), or that holds a deadline
  timer (the timer rule under L3).
- **L2:** any other file whose every top-level statement is a type, an interface, or a
  type-only import or export.
- **L1:** every other file.

In either package, a file that does its I/O or its acting only through the deps it is
handed looks like L1 by its imports and timers. Such a file states its ring in its
**header**: the lines before its first top-level statement that is not an import. A
declaration is the token `L0` to `L5` at the start of a comment line or right after `: `,
`. `, `— `, `ring ` or `is ` (either case), and followed by `:`, `,`, `.`, ` —`, ` (` or one
of the words `policy`, `port`, `ports`, `adapter`, `adapters`, `delivery`, `composition`
and `decision`. Examples: `hibernateSweep.ts`'s "…: L4, it reads, logs and … acts",
`coord/mirror.ts`'s "L3. It EXECUTES …", `update/converge.ts`'s "— L3, D-3383",
`token/link.ts`'s "ring L3:" and `accounts/audit.ts`'s "L3 adapter over the coord.db
handle". A token in any other place (a reference to another file's ring, such as
"(`coord/stall.ts`, L1)") is not a declaration. The first declaration counts. A ring pin's role
table counts the same way (today single-definition's `DOCS_RING_ROLES`, which puts
`docs/ccdsource.ts` in L3). A declaration moves a file **outward** of what its facts give,
never inward: one inward of the facts is refused, and the facts decide (today
`accounts/ops.ts` declares its port L2 beside two L3 arms, so the file is L3).

A ring pin may be stricter than these rules inside its own directory (single-definition's
docs ring forbids every timer below L4 and every non-`shared/` import in L1). A pin never
loosens them, and ARCH-04's scanner applies the rules here.

**PWA rings** (`pwa/src`): `*Words.ts`, policy and pure lib modules are L1; `lib/api.ts`
is L3; stores, hooks, components and screens are L4. Decided as:
- **L5:** `main.tsx`, the PWA's composition root.
- **L4:** any other `.tsx` or `.css` file, any file under `stores/`, any file that
  exports a hook (an exported function or const named `use` plus a capital letter), and
  any file that holds a scheduler or poller (the server's timer rule; `lib/ws.ts` keeps its
  reconnect timer on `this.timer`, so it is L4).
- **L3:** `lib/api.ts`, and any other file that names a browser I/O global (`fetch(`,
  `WebSocket`, `navigator.`, `localStorage`, `sessionStorage`, `indexedDB`, `new Worker`,
  `caches.`, `document.`, `window.`, `location.`, `history.`) or holds a deadline timer.
- **L2:** any other file whose every top-level statement is a type, an interface, or a
  type-only import or export.
- **L1:** every other file: the `*Words.ts` files, the policy modules and the pure lib
  modules.

**Contexts.** A file's context is the row that names the file itself (a file row, which
may use `*` inside one path segment). A file no file row names takes the row of the
directory it sits under (a `dir/**` row). Directory rows do not nest, and two file rows
never name one file. Paths are relative to the package's `src/`.

<!-- ring-context-map:start -->
| Context | `server/src` | `pwa/src` |
|---|---|---|
| C1 Fleet Registry & Accounts | `accounts/**`, `registry.ts`, `config.ts`, `fleet.ts`, `fleetidentity.ts`, `fleetstate.ts`, `divergence.ts`, `limits.ts`, `usage.ts`, `pools.ts`, `poolrule.ts`, `shares.ts`, `swapguard.ts`, `hookstate.ts`, `livestate.ts`, `coord/placement.ts`, `coord/pooledgelog.ts`, `configDir.ts` | `fleet/**`, `stores/fleet.ts`, `lib/accounts.ts`, `lib/pools.ts`, `screens/AccountsScreen.tsx`, `screens/FleetScreen.tsx`, `screens/FleetColumn.tsx` |
| C2 Fleet Mutation | `ccdargv.ts`, `exec.ts`, `lifecycle.ts`, `pty.ts`, `localcaps.ts`, `refreshcaps.ts`, `remote/runner.ts`, `remote/pty.ts` | (none) |
| C3 Session Conversation | `inject/**`, `transcript/**`, `pane/**`, `tasks/**`, `workflows/**`, `sessionws.ts`, `munge.ts`, `commands.ts`, `clip.ts`, `askkey.ts`, `bus.ts`, `turnverdict.ts`, `turnmark.ts`, `turnidle.ts`, `skillstate.ts`, `idlenudge.ts`, `backread.ts` | `session/**`, `stores/session.ts`, `lib/models.ts`, `screens/SessionScreen.tsx`, `inspector/**` |
| C4 Workspace Lifecycle | `archivedExpiry.ts`, `childReclaimSweep.ts`, `collectLane.ts`, `hibernateSweep.ts`, `orphanTreeLane.ts`, `orphanTreeSweep.ts`, `stopDone.ts`, `stopDoneSweep.ts`, `naming.ts`, `prstate.ts`, `wsaudit.ts`, `archiveAct.ts`, `coord/archiveAdmission.ts`, `coord/archiveDoor.ts`, `coord/childReclaim.ts`, `coord/childSpent.ts`, `coord/collectLaneJournal.ts`, `coord/collectTempRoot.ts`, `coord/collectOrphanTree.ts`, `coord/expireArchived.ts`, `coord/hibernate.ts`, `coord/landing.ts`, `coord/prhistory.ts`, `coord/released.ts`, `coord/wakeBudget.ts`, `workspaceCreate.ts`, `workspaceTitle.ts`, `linear/**` | `fleet/Archive*.tsx`, `fleet/archiveReleased.ts`, `fleet/ChildReclaimBanner.tsx`, `fleet/childReclaimWords.ts`, `fleet/CollectLaneSection.tsx`, `fleet/collectLaneWords.ts`, `fleet/useCollectLaneView.ts`, `fleet/ExpiryAttention.tsx`, `fleet/expiryWords.ts`, `fleet/hibernated.ts`, `fleet/HoldControl.tsx`, `fleet/lifecycleWords.ts`, `fleet/orphanWords.ts`, `session/Pr*.tsx`, `session/Reap*.tsx`, `session/reapWords.ts`, `screens/ArchiveScreen.tsx`, `inspector/PrSection.tsx`, `screens/LinearSection.tsx` |
| C5 Coordination | `coord/**`, `deadCoordinator.ts`, `readiness.ts` | `fleet/AbandonSheet.tsx`, `fleet/ResumeSheet.tsx`, `fleet/CapsControl.tsx`, `fleet/CoordBanner.tsx`, `fleet/coordWords.ts`, `fleet/DeadCoordinatorAttention.tsx`, `fleet/deadCoordinatorWords.ts`, `fleet/HotFilesStrip.tsx`, `fleet/KickoffRecovery.tsx`, `fleet/MailBadge.tsx`, `fleet/readinessWords.ts`, `fleet/runGroups.ts`, `fleet/runWords.ts`, `fleet/StartProgramSheet.tsx`, `fleet/startProgramPolicy.ts`, `fleet/useProgramAttempt.ts`, `fleet/useStallWatchView.ts`, `screens/MailScreen.tsx`, `screens/Run*.tsx`, `screens/useColdRuns.ts`, `screens/useRunSpend.ts`, `screens/StallWatchSection.tsx`, `inspector/MailSection.tsx` |
| C6 Attention & Notification | `push.ts`, `notifylog.ts`, `interruptlog.ts`, `presence.ts`, `askbody.ts`, `askwindow.ts`, `coord/approval*.ts`, `coord/heldFor.ts`, `coord/digest.ts`, `coord/redact.ts`, `notice.ts` | `fleet/AttentionList.tsx`, `fleet/BucketBar.tsx`, `fleet/NotificationBell.tsx`, `fleet/inboxTarget.ts`, `session/AskParts.tsx`, `session/DialogSheet.tsx`, `session/EnvelopeSheet.tsx`, `session/ask*.ts`, `session/useAskKeys.ts`, `lib/push.ts`, `lib/notifymark.ts`, `lib/seen.ts`, `lib/feed.ts`, `lib/restart.ts`, `screens/Digest*.tsx`, `screens/digest.css`, `screens/settings/NotificationsSection.tsx` |
| C7 Update control plane | `update/**`, `buildinfo.ts`, `coord/updateintentlog.ts` | `fleet/Update*.tsx`, `fleet/WhatsNewSheet.tsx`, `fleet/ReleaseNotes.tsx`, `fleet/HaltBanner.tsx`, `fleet/FleetHostBanner.tsx`, `fleet/movePlan.ts`, `fleet/updateAck.ts`, `fleet/updateHalt.ts`, `fleet/useUpdatesView.ts`, `screens/updates.tsx`, `screens/settings/UpdatesSection.tsx` |
| C8 Auth & box token | `auth/**`, `token/**` | `accounts/**`, `components/LoginScreen.tsx`, `fleet/PasskeyNotice.tsx`, `lib/auth.ts`, `lib/passkey.ts`, `screens/settings/SecuritySection.tsx`, `screens/settings/SignInGateCard.tsx`, `screens/settings/YourSignInCard.tsx`, `screens/settings/ThisSessionCard.tsx`, `screens/settings/signInGate.ts` |
| C9 Docs | `docs/**` | `docs/**`, `screens/DocsScreen.tsx` |
| K Kernels and platform | `index.ts`, `server.ts`, `deps.ts`, `watch.ts`, `io.ts`, `refuse.ts`, `pwaStatic.ts`, `shutdownseal.ts`, `remote/client.ts`, `remote/io.ts`, `changeLatch.ts`, `laneRunner.ts`, `laneSchedule.ts`, `disk.ts`, `diskepisode.ts`, `unmeasured.ts` | `main.tsx`, `app.tsx`, `command/**`, `components/**`, `styles/**`, `lib/**`, `screens/AppearanceRow.tsx`, `screens/SkinFieldset.tsx`, `skins/**`, `screens/settings/**`, `fleet/DiskBanner.tsx`, `fleet/diskWords.ts` |
<!-- ring-context-map:end -->

A new file takes its directory's row, or needs a file row in the same PR when its
directory has none (`screens/`, `stores/`, `remote/` and the top level of each package).
ARCH-04 stage 4 turns this table into an assertion: `server/test/rings/totality.test.ts` (D-6734)
reads this block and gives every non-test file of the two packages one ring and one context, so a file no row
reaches and a row that names no file are both red.

## Increments — each rides queued work, none is a standalone refactor PR

1. **"An account" becomes a type with one home**, and the registry read stops answering
   `null` for four different facts. → rides the in-flight `fix/registry-read-storm`.
2. **The hooks install lane derives its homes from the roster**, closing the silent mail
   hole on the fifth account. → rides PR J.
3. **Run routes get a typed refusal vocabulary** (`RunRefuseCode`, the `PR_REASONS` idiom).
   → rides PR J, which must render these on a phone and today has nothing to switch on.
4. **Deciding split from acting** in the two coordinator transactions: `dispatchRun` /
   `closeRun` as L1 functions owning the precondition → irreversible act → commit order.
   → rides PR J's `/advance` plus the Build 4 dogfood.
5. **`mail_deliveries` gets one terminality enforcement point.** → rides Build 5.
6. **The `FleetIO` seam stops discarding the read outcome**, additively — one
   result-returning read alongside `readFile`. → rides Build 5/6 remote work.
7. **The watcher gets a narrow guarded store port.** → rides Build 6, which adds lane six.

**Status per increment** (measured on `main` for ARCH-02a, D-6000; a row names the test that
holds it, or the ARCH ticket that finishes it):

| # | Status | Held by, or finished by |
|---|---|---|
| 1 | done | the roster is runtime data (`shared/roster.ts`'s `parseRoster`): `roster.test.ts` and single-definition's "the account roster — runtime data, no compile-time copies"; the registry read tells its facts apart through `readRegistryMeasured`: `registry-refused.test.ts` |
| 2 | done | `install-session-hooks.test.ts`, "install-session-hooks.sh default homes are the roster, behaviourally" |
| 3 | done | `RunRefuseCode` with its derived `RUN_REFUSE_CODES` (`shared/api.ts`): `mail-routes.test.ts`, "every declared RunRefuseCode (run-route refusals) is emitted somewhere in server/src/coord"; statuses from ARCH-11a's `REFUSAL_STATUS`: `refusal-status.test.ts` |
| 4 | partly | `openRun`'s preconditions are L1 (`coord/openRun.ts`, ARCH-21, `open-run-preconditions.test.ts`); `dispatchRun` decides through `decideDispatch` (`coord/dispatchDecide.ts`, ARCH-22 (#553), `dispatch-decide.test.ts`) and acts through its deps, `sendClear` included; `closeRun` decides through `decideClose` (`coord/closeDecide.ts`, ARCH-35 (#556), `close-decide.test.ts`) and acts in `abandonRun` and `closeWorkRun` |
| 5 | partly | every writer carries the terminal guard and the pair is spelled once (single-definition's "spells the delivery terminal pair ONCE"); `markDelivered`'s `void` is finished by ARCH-15 (#532) |
| 6 | done, migrating | `FleetIO`'s `readFileMeasured`, `readdirMeasured`, `statMeasured` and kin (`io.test.ts`); the remaining catch-to-null folds move with ARCH-08b (#534) |
| 7 | open | the watcher still takes the whole `CoordStore`; consumer-side ports are ARCH-03 (#541) |

## Enforcement — mechanisms, not intentions

A rule without a test decays; this repo already knows that. Import-direction test;
no-`reply`-below-L4 test; `single-definition` extended to the account roster;
**cross-language fixture test** executing ccd's bash copies against the roster;
totality test for every wire union; mutant duty in `coord/` (a guard ships with a test
that goes red when it is deleted *and* when it is reordered); **ratchet budgets** pinning
`watch.ts` and `coord/routes.ts` at current line counts, may-only-shrink; scanner-coverage
pins asserting each walk visited a non-zero minimum; docstring-claim rule.

**Status per enforcement item** (measured on `main` for ARCH-02a, D-6000):

| Item | Status | Held by, or finished by |
|---|---|---|
| Import-direction test | partly | per-ring pins in `single-definition.test.ts` ("the coord ring …", "the update ring …", "the docs ring …"); the repo-wide scanner over the rules above is ARCH-04 (#545), stages 1 to 4, one rule per file under `server/test/rings/` (stage 1, D-6045: `shared-imports.test.ts` holds L0's `shared/*.ts` to `./` imports and `mjs-node.test.ts` the `.mjs` carve-out; stage 2, D-6045: `outward-edges.test.ts` holds every `server/src` runtime edge inward of the rules above, `ring.ts` deciding each file's ring, with the outward edges on the tree in an exemption set that may only shrink, and `exemption-age.test.ts` reds an exemption set unchanged for more than 60 days without a re-dated reason, deviation-refs' `GRANDFATHERED` included; stage 3, D-6118: `pwa-rings.test.ts` holds a `pwa/src` L1 module's runtime edges off `.tsx` files, stores and `lib/api.ts`, each file's ring decided by `ring.ts`'s `pwaRing` from the PWA rules above, with the edges on the tree in an exemption set that may only shrink, and holds `ui/src` to no import of `pwa/` in any form; stage 4, D-6734: `totality.test.ts` gives every non-test `server/src` and `pwa/src` file one ring and one context from the table above, over a walk of at least 400 files), and its exemptions drain in ARCH-05 (#551); no file below L4 imports `server.ts` or `watch.ts`, even for a type: `rings/host-imports.test.ts` (D-6003, folded onto the ring classifier by D-6045; none pending since `Deps` moved to `deps.ts`) |
| No `reply` below L4 | done | `server/test/rings/fastify-l4.test.ts` (ARCH-04 stage 1, D-6045): `fastify` and every `Fastify*` name only in an exact L4 allowlist |
| `single-definition` over the account roster | done | single-definition's "the account roster — runtime data, no compile-time copies" and "the account roster — config dir is data, joined in one place" |
| Cross-language fixture test (ccd's bash copies against the roster) | done | `wrapper-roster-fixture.test.ts`, `roster-exec-parity.test.ts` |
| Totality test for every wire union | open | ARCH-12 (#552) |
| Mutant duty in `coord/` | review rule | CLAUDE.md's mutation-table discipline; every PR body carries its table. No test can see a missing mutant |
| Ratchet budgets on `watch.ts` and `coord/routes.ts` | done | `growth-check.test.ts` (ARCH-01, #526; D-5848): net growth against the merge-base, not an absolute line count; armed by the operator on 2026-10-21 (OA-C2, D-6178), so growth past the limit fails CI |
| Scanner-coverage pins | done, per walk | each walk's own "visits the whole directory" or "covers the directory" row in `single-definition.test.ts` |
| Docstring-claim rule | partly | single-definition's "store.ts docstrings that describe their own callers"; doc-coupling pins are ARCH-07 (#558) |

## Rejected, so nobody relitigates it

- **Splitting `shared/api.ts` by context / a `server/src/domain/` layer.** The most
  dangerous item on the textbook list. `shared/api.ts` *is* the ubiquitous language, three
  processes with independent deploy cadence parse the same definitions from it, and three
  scanners read it as one unit.
- **A `FleetGateway` port over ccd.** The first thing a Clean reading recommends, and it
  reopens the most expensively earned safety property in the repo.
- **A repository interface over `CoordStore`.** `DatabaseSync`'s *synchrony is a
  concurrency invariant*, stated in the store's own docstring.
- **Splitting `coord/routes.ts` one-file-per-resource**, or a shared auth middleware —
  D-36/D-39 are the price tag for two copies of one auth gate.
- **A `MAIL_DELIVERY_TRANSITIONS` table.** `RUN_TRANSITIONS` earns its place by encoding
  ~15 edges clients read as refusals; delivery has one invariant, so it gets one
  enforcement point (increment 5), not a table.
- **Use-case classes / an application-service layer / a domain-event bus.** Not the same
  as increment 4, which extracts two functions with typed returns.
- **Branded value objects for every id.** The brand pattern exists and was applied exactly
  where it earned its keep — a security boundary with four recorded bypasses.
- **An interface-per-collaborator ISP pass over `Deps`, or a DI container.** Commit
  8f41a00 is the price tag: promoting one capability touched 10 files and 13 hand-built
  `Deps` literals across 7 test files.
- **Splitting `CCD_ARGV` per context** — `whitelist-subset.test.ts` depends on one flat
  table with exhaustive `Object.keys`.
- **Decomposing `FleetWatcher` into a lane interface.**
