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
| status | closed | **still open** |

Still open, verified on `main` today: `bumpReplayCount` and `markIngested` write with a
bare `WHERE id = ?` while `markDelivered`/`rejectDelivery`/`backOff` carry
`state NOT IN ('acked','rejected')`; and `markDelivered` returns `void`, so `watch.ts`
cannot see its write was refused and bumps the replay counter of a row a concurrent park
just closed.

The invariant with a home costs one line to fix and cannot regress. The identical
invariant with no home has cost four review rounds and is not finished. That is the whole
DDD argument, measured rather than asserted.

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
- **L4 delivery** — `server.ts`, `coord/routes.ts`, `sessionws.ts`, `watch.ts`. Owns
  Fastify, sockets, timers, and union→status mapping. Allowed to be big and boring; not
  allowed to **decide**. One-reading test: *if a function here has two guards whose order
  matters, it belongs in L1.*
- **L5 composition root** — `index.ts` only.

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

## Enforcement — mechanisms, not intentions

A rule without a test decays; this repo already knows that. Import-direction test;
no-`reply`-below-L4 test; `single-definition` extended to the account roster;
**cross-language fixture test** executing ccd's bash copies against the roster;
totality test for every wire union; mutant duty in `coord/` (a guard ships with a test
that goes red when it is deleted *and* when it is reordered); **ratchet budgets** pinning
`watch.ts` and `coord/routes.ts` at current line counts, may-only-shrink; scanner-coverage
pins asserting each walk visited a non-zero minimum; docstring-claim rule.

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
