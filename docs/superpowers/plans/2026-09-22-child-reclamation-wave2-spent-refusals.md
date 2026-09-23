# Wave 2 — the three-way reading, the spent verdict, the two refusals (server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the operator's rule 3 on the server, with no destructive verb in existence: a CHILD workspace (one `$REG/<id>.child` marks as minted for a run) whose branch has ever had a PR can never be bound to a second run — `POST /api/runs` refuses it before any row exists, and dispatch's resume arm refuses it before `ensure`, releasing the spent child's claim and unbinding the run so the next dispatch mints a fresh child. An unreadable marker, an unreadable ledger or a failed live lookup refuses as well, with its own code, because unknown is not spent and not unspent either.

**Architecture:** Five pieces, each with a test that reds when it is deleted or mutated. (1) `ChildMark` (L0, `shared/api.ts`) and `SessionRecord.child`, read through `fieldMeasured` with the listing rung, three answers and never a boolean, and judged by the ONE run-id grammar ccd's `_child_runid_valid` enforces (`CHILD_RUN_ID`, `^[1-9][0-9]{0,9}$`: at most ten ASCII digits) over the same bytes ccd's `$(…)` read yields; carried on the wire as `FleetSession.child` and revived additively. (2) `childSpent` (`server/src/coord/childSpent.ts`): the three-valued verdict — the registry's PR number, then `.prhistory` through its measured reader, then a LIVE `ccd pr-state --session`, every failure answering `unmeasured`. (3) `childBindGate` (`server/src/coord/childBind.ts`): the ONE gate both doors call; a workspace with no marker passes untouched. (4) The two new `RunRefuseCode`s at `POST /api/runs`, and a new `DispatchOutcome` member at dispatch whose `workspace-spent` arm runs the fleet act first (release, or hand the claim to a surviving sibling) and then `CoordStore.clearSession`. (5) The coordinator's prose — the refusal sentence in `SKILL.md` and `wave-lifecycle.md` §1, §2 and §5 — rewritten for one PR per child, because the reverse census over `RunRefuseCode` reds until both codes are named.

**Tech Stack:** TypeScript 7.0.2 (server, agent) / 6.0.3 (pwa), vitest 4, Fastify 5, `node:sqlite` `DatabaseSync` (WAL). No `ccd/ccd` edit in this wave.

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` (§4 vocabulary, §5.1 the marker, §5.3 spent, §5.4 the two refusals, §6 what moves, §8 wave 2). Cross-wave names: the programme's interface contract (§2 "Wave 2"). Ledger: `docs/superpowers/programs/child-reclamation.md`.
**Contract:** `docs/superpowers/programs/child-reclamation-contract.md` (cross-wave names and types; §7–§8 rulings)

---

## Global Constraints

Copied from `CLAUDE.md`, the spec and the programme ledger. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: server.** No `ccd/ccd` edit, no agent edit, no new capability token. The two prose files under `ccd/coordinator-skill/` ship to every rostered home through `ccrc update`'s install spine on the FLEET box, which `ccrc rollout`'s default order moves first — so the coordinator can read what the two refusals mean before the server starts sending them. Task 7 states the order.
- **Wave 1 need not be deployed for this wave to be correct or tested.** Every test here writes the `.child` marker file directly into a fixture registry. On a fleet where no workspace carries a marker, this wave changes nothing a coordinator can observe: `childBindGate` answers `ok` for every workspace with no marker, which is every workspace wave 1 did not mint.
- **Node floor `>=22.13.0`, identical across the three engines**, pinned by `server/test/node-floor.test.ts`. If node-floor's absolute assertion (3) is red while (1–2) are green, **RAISE engines — never lower them to make it green.**
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in: `server/` `agent/` `pwa/` `shared/`.

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Run suites in the FOREGROUND, timeout ≥600000ms.** Backgrounding hides a hang; the suites are load-sensitive.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`. CI on the quiet box is the arbiter.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** Every test in this wave builds its home with `mkTmp` (`server/test/tmpHelpers.ts`) and its deps with `testDeps(home, run)` (`server/test/helpers.ts`), whose runner is a recording double — no real `ccd`, no real `gh`, no real `tmux` is ever reached.
- **NEVER run destructive `ccd` verbs against the live host** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`), **never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly**, and never print secret file CONTENTS.
- **Rings / bounded contexts:** ring membership is a property of a file's IMPORTS, not its path. L0 `shared/*.ts` imports NOTHING. **An adapter may not narrow a distinction it received.** `coord/childSpent.ts` and `coord/childBind.ts` follow `coord/fingerprint.ts`'s `verifyDone` shape: real I/O, reached only through injected ports, no `fastify`, no `reply`, no database handle. `server/test/single-definition.test.ts`'s coord-ring scan forbids `./db.js`/`node:sqlite` imports and any `coord.db`/`store.db` receiver outside `store.ts`, `rundefs.ts`, `routes.ts`, `db.ts`, `schema.ts` — which is why every multi-row write in this wave is a `CoordStore` method.
- **No overloaded null at a seam.** The programme's carried constraint, stated as a rule for this wave: the registry's reading is three-way (`none` / `child` with a run id / `unreadable`) and the spent verdict is three-way (`spent` / `unspent` / `unmeasured`). An unreadable marker REFUSES a bind; an unmeasured verdict REFUSES a bind. Any change that collapses either reintroduces the fail-open the spec's Appendix B item 6 exists to prevent.
- **Two authorities, always** (programme ledger). Child-ness is the box marker AND (from wave 3) the server's `--child-of` argv. No task here infers child-ness from anything but the marker — not `--no-rc`, not a dec reason string, not a run row alone.
- **Non-children are untouched** (spec §5.4). A workspace with no marker binds exactly as today, even one that has had a PR. A test pins it. The ONE exception is an UNLISTABLE registry, which proves nothing about any session and so refuses `spent-unmeasured` for every `sessionId`, marked or not (Contract reconciliation item 4, RULED ACCEPTED 2026-09-23: fail-shut and retryable) — pinned at both doors and stated in `wave-lifecycle.md`'s §1/§2 rows, never left to a moved counter.
- **Single-source-of-truth values are enumerated once and derived.** The registry-read census (`server/test/registry.test.ts`) is DERIVED from `buildRecord`'s own `Promise.all` and moves by one field in Task 1; every tagged citation moves with it, by a script that uses the census's own regex, never by hand-typed numbers.
- **Wire discipline — additive-only, absence-permits:** do NOT bump `FLEET_PROTO` (=1). `FleetSession.child` is read off persisted snapshots through ONE reader (`reviveFleetSession`); absent revives `{ kind: 'none' }`.
- **`coord.db`'s synchrony is a stated concurrency invariant — do not wrap it async.** `clearSession` is synchronous and owns its own `tx()`.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated (measured before/after, not a comment). Doctrine: "A comment is a request; a red suite is a mechanism." TDD red-first.
- **`gh` has NO exec-whitelist entry, deliberately.** Never add one. The live PR lookup rides the existing `ccd pr-state --session` grant, behind `verbSupported`, exactly as `GET /api/sessions/:id/pr` and `verifyDone` already call it.
- **Box token gates every coordination WRITE.** Both routes this wave touches (`POST /api/runs`, `POST /api/runs/:id/dispatch`) are already behind `requireMailToken`; no gate changes.
- **Every CITED file pays the citation tax, in the task that incurs it** (the programme ledger's carried constraint; contract ruling R9). `shared/api.ts` is a CITED file: `README.md` anchors four operator pointers into it by line number (the purge-refusal vocabulary: `shared/api.ts:7465-7467`, `:7505`, `:7513`, `:7526` at the branch tip), and `server/test/session-hook.test.ts` audits that citation corpus — README's entry is an equality with EMPTY, and the citation-debt census counts stale `shared/api.ts` anchors in the frozen spec/plan corpus. Tasks 1, 2 and 5 each insert lines ABOVE those anchors, so EACH pays S6-R11 in its own commit: Task 1 Step 8 defines the procedure (README re-anchored BY CONTENT against `HEAD`, the census re-measured), and Task 2 Step 5 and Task 5 Step 9 repeat it. `session-hook.test.ts` is therefore green at every commit and is in all three tasks' suites. Never re-anchor by adding a delta to a number. The census names the cited set; of the files this wave edits, only `shared/api.ts` and `server/test/session-hook.test.ts` are cited by line (measured at planning), and every line this wave adds to `session-hook.test.ts` lands at its census map, far below the highest corpus anchor into that file (`:7043-7056`) — so it owes nothing. No `ccd/ccd` edit, so no `ccd/ccd` tax.
- **One run-id grammar** (contract ruling R2). A child marker's run id is `^[1-9][0-9]{0,9}$`, ASCII only: at most ten digits, no sign, no leading zero — exactly what ccd's `_child_runid_valid` (wave 1) accepts. The server spells it ONCE, `CHILD_RUN_ID` in `shared/api.ts` (Task 1), and applies it to the bytes ccd's `$(_reg_get …)` would see (NUL bytes dropped, trailing newlines stripped — nothing else trimmed); `reviveChildMark` (Task 2) holds a persisted `runId` to the same set. `parseCanonicalPositiveSafeInteger`, which admits sixteen digits, is NOT the marker's parser. Anything outside the set is `unreadable`.
- **Anchors in this plan are snapshots** (measured at branch tip `62d9c485`). Two other programmes are live against the same files. Locate every edit by CONTENT; line numbers are hints, never addresses.
- **No hostnames, IPs, tailnet names, docserver URLs, or absolute home paths anywhere in the tree** (`server/test/topology-clean.test.ts` scans every blob the range introduces). Use repo-relative paths in commits, comments and PR bodies.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch (a feature branch wedges every close with `stale-tip`).
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section at the foot of this plan.
- **Contract §2, as amended by its §7 rulings of 2026-09-23, is the authority.** The four departures this plan proposed (Contract reconciliation items 1, 2, 4 and 6) are RULED ACCEPTED (R3), and this wave is dispatchable as written (R18): a worker builds exactly the code below. R2 (the run-id grammar), R9 (the citation tax) and R13 (this wave owns `server/test/child-reclaim-store.test.ts`) are built in too.

---

## Contract reconciliation

The cross-wave contract fixes this wave's names and types, and every one is used verbatim below. Six places where the contract's first text was not implementable as written against the code were found while planning. Each is resolved in the task that meets it, and none renames anything.

**Ruled, 2026-09-23 (contract §7, R3 and R18): items 1, 2, 4 and 6 are ACCEPTED, and this wave is dispatchable as written.** Each amends contract §2's text in place; no name, type or return shape changes. Items 3 and 5 needed no ruling: item 3 spends the value the contract names, through the variable that already holds it, and item 5 moves censuses the contract already says must move. The code below builds the accepted forms, and there is no other form to build. The numbered list records what was ruled and why, so a reviewer can check the code against the argument.

1. **`CoordStore.clearSession(runId: number, pr: number)`, not `clearSession(runId: number)` — ACCEPTED (R3 (1)).** The contract makes the unbind ONE transaction that also records `session-unbound: <sid> (workspace-spent #<pr>)`. The store has no PR for a run that has not closed (`runs` has no PR column before close, and a `prhistory` or `live` verdict never reaches `coord.db`), and the caller cannot wrap the store in a transaction of its own: `single-definition.test.ts`'s "never reaches around the store for its handle" scan reds on `tx(coord.db, …)` in `dispatch.ts`. So the PR rides in as a second parameter, and the event is written inside the store's own `tx()` — one event, inside the unbind's transaction. The return type is the contract's. Task 3 builds it.
2. **The dispatch `workspace-spent` arm releases only when nothing else claims the workspace — ACCEPTED (R3 (2)).** The contract's first text (and spec §5.4) said "run `ws-release`". If another OPEN run still names the spent child — the previous wave, when a coordinator dispatches N+1 before closing N — a bare release drops that live run's claim, the F9 harm `closeRun`'s abandon arm was built to avoid ("RELEASE ONLY WHEN NOTHING ELSE CLAIMS IT — otherwise HAND THE CLAIM OVER", `server/src/coord/close.ts`). Task 6 uses that arm's idiom: `releaseIsSafe`, else re-hold with the surviving run's own reason. An unreadable sibling list, or a survivor whose hold the grammar rejects, refuses with `unbound:false` and no fleet act. `unattended-actor`'s exact count therefore moves 11 → 13 (a hand-over and a release).
3. **The release spends `dispatchDec`, not a second `sweepDec(deps.fleetState, \`run:${id} dispatch\`)`.** The value is identical; typing the label a second time is the drift `dispatchRun`'s hoisted `dispatchDec` exists to prevent, and `server/test/unattended-actor.test.ts` pins that hoist by its declaration. Task 6 adds two `SITES` entries capturing `dispatchDec` at the new call sites.
4. **An UNLISTABLE registry answers `spent-unmeasured`, not `ok` — for ANY `sessionId`, marked or not — and `absent` is read twice — ACCEPTED (R3 (4)).** The contract's `ok:true` covers "no marker, or no registry row". `readSessionRecord`'s `{ found: false, reason: 'unlistable' }` is neither — it proves nothing about the session — so the gate refuses, retryably. This is the ONE ruled change to the non-child path, fail-shut and retryable: at open, a failed listing now answers 409 `spent-unmeasured` for every `sessionId` open (it used to 200, because the open never listed the registry); at dispatch, the gate's failed listing answers 409 `spent-unmeasured` where the resume arm's own read used to answer 502 `registry-unmeasurable`. The gate cannot tell a non-child from a child without the listing. The change is stated in the §1/§2 `spent-unmeasured` rows and pinned by a route case at each door (Task 5, Task 6) rather than hidden behind the moved `run-routes.test.ts` counters. And `reason: 'absent'` is itself TWO populations (`readSessionRecord`'s own docstring, `server/src/registry.ts`): no `.uuid` in a listing that succeeded, AND a row `buildRecord` DROPPED — an identity field (`uuid`, `wrapper`, `workdir`) read back empty or listed-then-ENOENT — or one the reconfirm listing lost. The second population can be a MARKED child, and passing it would bind a child whose evidence was never read. So on `absent` the gate lists the registry once more: a `.child` the listing names with no row built around it answers `spent-unmeasured`; no `.child` answers `ok` — the contract's "no registry row"; a failed second listing answers `spent-unmeasured`. (Wave 3's executor reads `absent` the same way, R12.)
5. **Five pinned censuses move that the spec's §6 does not list**, and each is updated in the task that moves it: the registry-read census (`registry.test.ts`, 30/31/721 → 31/32/745) and the same file's `readSessionRecord` cost case, which hard-codes the field-read count (`toHaveLength(30)`, now derived — both Task 1); `coord-store.test.ts`'s one-writer scan over `runs.sessionId`, which reds on ANY second `UPDATE runs SET … sessionId … WHERE` (Task 3 teaches it the unbind); `unattended-actor.test.ts`'s exact call-site count, 11 → 13 (Task 6); and `session-hook.test.ts`'s citation corpus — README's four `shared/api.ts` anchors, which every insertion this wave makes into `shared/api.ts` lands above, and the citation-debt census's `shared/api.ts` entry and its sum, re-anchored by content and re-measured in EACH of Tasks 1, 2 and 5 (S6-R11; ruling R9 — the tax is paid in the task that incurs it).
6. **`clearSession` writes nothing for a `planned` run whose `sessionId` is already NULL — ACCEPTED (R3 (6)).** The contract defines `cleared:false` as "no row matched" `UPDATE … WHERE id = ? AND state = 'planned'`, and that statement DOES match a planned run with a NULL binding — so, as first written, it would answer `cleared:true` and record `session-unbound: null (workspace-spent #<pr>)`, an event naming no session about an unbind that changed nothing. The plan's `clearSession` reads the binding first and answers `cleared:false`, writing nothing, when it is NULL; its third test pins that. The return type is the contract's.

Three further rulings of the same date bind this wave and are built below: **R2** — the marker's run id is `^[1-9][0-9]{0,9}$` ASCII, ccd's `_child_runid_valid` set exactly, so the server reader does NOT use `parseCanonicalPositiveSafeInteger` (sixteen digits) and an eleven-digit marker is `unreadable` (Tasks 1 and 2); **R9** — every CITED file pays S6-R11 in the same task (Tasks 1, 2 and 5 each pay for `shared/api.ts`); **R13** — this wave owns `server/test/child-reclaim-store.test.ts`, and wave 3's store tests go in `server/test/child-reclaim-mail-store.test.ts` (Task 3).

One gap is stated rather than closed, because closing it is not this wave's ruling to make: worker mail addressed to a spent child for the run being unbound stays addressed to the spent child — the next `bindSession` sees a NULL predecessor and re-issues nothing. On the only path that unbinds (a `planned` run whose dispatch never queued a brief) that set is empty unless a coordinator mailed the run's worker before dispatching it. `clearSession`'s docstring says so.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `shared/api.ts` | Modify (after `IdentityField`; `FleetSession`'s tail; beside `optUnmeasured`; `reviveFleetSession`'s literal; the `RunRefuseCode` docstring, union and map) | L0 home of `ChildMark`, `CHILD_RUN_ID` (the one run-id grammar, R2), `FleetSession.child` and its one reviver, and the two new `RunRefuseCode`s |
| `server/src/registry.ts` | Modify (shared import; `SessionRecord` tail; `fieldMeasured`'s optional `as` parameter; `childMarkOf` beside `numOrNull`; `buildRecord`'s `Promise.all`, listing flags and returned literal; two unenforced census sentences) | The one parser of `$REG/<id>.child` into `SessionRecord.child`, over the bytes ccd's own read sees |
| `server/src/fleet.ts` | Modify (`assembleFleet`'s literal, after `route: r.route`) | Carries `SessionRecord.child` onto the wire |
| `server/src/coord/store.ts` | Modify (new `clearSession` after `setSession`) | The one unbind of `runs.sessionId`, with its trail, in one transaction |
| `server/src/coord/childSpent.ts` | Create | The three-valued spent verdict (`childSpent`) |
| `server/src/coord/childBind.ts` | Create | The ONE bind gate both doors call (`childBindGate`) |
| `server/src/coord/routes.ts` | Modify (`POST /api/runs`, after the `claimant-is-a-worker` refusal; `sendDispatchOutcome`, a `childSpent` arm) | The open-time refusal and the dispatch refusal's 409 body |
| `server/src/coord/dispatch.ts` | Modify (imports; `DispatchOutcome`; new `refuseSpentChild`; the resume arm before `ensure`; two comments) | The dispatch-time refusal and its unbind |
| `ccd/coordinator-skill/SKILL.md` | Modify (the `refused` parenthetical; the refusal-list sentence; step 6's Clean arm) | The coordinator is told both codes exist and what spends a workspace |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | Modify (§1 table + reclaim paragraph; §2 table; §5 step 3) | What each refusal means and what to do; one PR per child |
| `server/test/child-reclaim-mark.test.ts` | Create | `SessionRecord.child`'s three answers; `FleetSession.child`'s revival and assembly |
| `server/test/child-reclaim-store.test.ts` | Create | `clearSession`'s behaviour. OWNED by this wave (contract ruling R13): wave 3's store tests go in `server/test/child-reclaim-mail-store.test.ts`, never here |
| `server/test/child-reclaim-spent.test.ts` | Create | `childSpent`'s verdict over every evidence path |
| `server/test/child-reclaim-bind.test.ts` | Create | `childBindGate`, including "non-children are untouched" |
| `server/test/child-reclaim-refusals.test.ts` | Create | Both 409s end to end through the real routes; the prose pins |
| `server/test/registry.test.ts` | Modify (the census's hardcoded triple; the `readSessionRecord` cost case's field-read count, now derived; one tagged comment via script) | The census moves 30/31/721 → 31/32/745 |
| `README.md` | Modify (the four `shared/api.ts` anchors in the purge-refusal sentence, re-anchored by content in EACH of Tasks 1, 2 and 5) | Its operator pointers still name the lines their sentence quotes, at every commit |
| `server/test/session-hook.test.ts` | Modify (the citation-debt census's `shared/api.ts` entry and its sum, re-measured in EACH of Tasks 1, 2 and 5, with one argued comment that gains a line per task) | The citation debt this wave's `shared/api.ts` inserts create is measured, not hidden, in the task that creates it |
| `server/test/coord-store.test.ts` | Modify (the one-writer scan) | Names the unbind writer instead of reddening on it |
| `server/test/unattended-actor.test.ts` | Modify (`SITES`, the count title and its docstring) | 11 → 13 pinned unattended call sites |
| `server/test/run-routes.test.ts` | Modify (two readdir counters, twice) | The two "registry cannot be listed" cases still reach the read they are about |
| `server/test/dispatch-hold-order.test.ts` | Modify (one comment) | Its "exactly one `wsHold`" sentence stops being false |
| `server/test/hold-gate.test.ts` | Modify (one `SessionRecord` literal) | Gains `child` |
| 30 fixture files under `server/test/` and `pwa/test/` (Task 2 Step 4 lists the command that finds them) | Modify (one token each) | Each full `FleetSession` literal gains `child: { kind: 'none' }` |
| `server/src/fleet.ts`, `server/src/server.ts`, `server/src/watch.ts`, `server/test/{fleet-wire-route,hold-gate,push-copy,registry,routes}.test.ts` | Modify (tagged census comments, by script) | Each `[registry-read-census:*]` citation moves with the derivation |

---

### Task 1: `ChildMark`, and `SessionRecord.child` through the measured reader

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `shared/api.ts` — insert `ChildMark` and `CHILD_RUN_ID` directly after `export type IdentityField = 'uuid' | 'wrapper' | 'workdir';`
- Modify: `server/src/registry.ts` — the shared import; `SessionRecord`'s last field; `fieldMeasured`'s signature; `childMarkOf` after `numOrNull`; `buildRecord`
- Modify: `server/test/registry.test.ts` — the census's hardcoded triple
- Modify: `README.md` — the four `shared/api.ts` anchors of the purge-refusal sentence (Step 8, by content)
- Modify: `server/test/session-hook.test.ts` — the citation-debt census's `shared/api.ts` entry, its sum, and the comment above the entry (Step 8, re-measured)
- Modify: `server/test/fleet-wire-route.test.ts` — its header's historical census sentence
- Modify: `server/test/hold-gate.test.ts` — the one `SessionRecord` literal
- Modify (by script): every file carrying an enforced `[registry-read-census:*]` claim
- Create: `census-rewrite.mjs` in a `mktemp -d` directory outside the repo — not committed
- Test: `server/test/child-reclaim-mark.test.ts` (new)

**Interfaces:**
- Produces (L0, contract §2, verbatim):
  ```ts
  export type ChildMark =
    | { readonly kind: 'none' }
    | { readonly kind: 'child'; readonly runId: number }
    | { readonly kind: 'unreadable' };
  ```
- Produces (L0, contract ruling R2): `export const CHILD_RUN_ID: RegExp` — `/^[1-9][0-9]{0,9}$/`, the server's ONE spelling of ccd's `_child_runid_valid` set. Task 2's `reviveChildMark` consumes it.
- Produces: `SessionRecord.child: ChildMark` (`server/src/registry.ts`), on every record `readRegistry`, `readRegistryMeasured` and `readSessionRecord` build. Tasks 2, 4 and 5 consume it.
- Produces: `fieldMeasured(io, dir, id, name, as: 'trimmed' | 'shell' = 'trimmed'): Promise<MeasuredRead>` — the optional fifth argument is new; every existing caller omits it and keeps `.trim()`'s content byte for byte. `'shell'` yields what bash's `$(cat …)` yields: NUL bytes dropped, trailing newlines stripped, nothing else.
- Consumes: `io.readFileMeasured` (unchanged). NOT `parseCanonicalPositiveSafeInteger`: it admits sixteen digits, and the marker's set is ten (R2).

- [ ] **Step 0: Install all three packages once**

```bash
(cd server && npm ci) && (cd agent && npm ci) && (cd pwa && npm ci)
```

Expected: three clean installs. `typecheck-tests.test.ts` (run from Step 9 on) compiles `server/test`, `agent/test` and the whole of `pwa/` with each package's own compiler, and resolves those compilers from each package's `node_modules`.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-mark.test.ts`:

```ts
// child-reclamation wave 2, Task 1 — `SessionRecord.child`, the registry's
// reading of `$REG/<id>.child` (spec §5.1). THREE answers, never a boolean:
// the bind gate REFUSES an unreadable marker and wave 3's reclaim will DEFER
// on one, so collapsing `unreadable` into either neighbour fails open in one
// of those two directions.
//
// Wave 1 (the ccd half that WRITES the marker) need not be deployed for this
// suite to mean anything: every case writes the marker file itself, into a
// fixture registry, exactly as `_reg_set` would (`printf '%s'`, no newline).
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { readRegistry, readSessionRecord, type SessionRecord } from '../src/registry.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { absentField, unreadableField } from './ioDoubles.js';

const ID = 'demo-child';
let home: string;
let reg: string;

beforeEach(() => {
  home = mkTmp('ccrc-child-mark-');
  seedRoster(home);
  reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  // A complete row — the identity triple a real ccd writes — so the record is
  // BUILT and the marker is the only variable.
  for (const [k, v] of Object.entries({
    wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`, started: '1',
    workspace: ID, branch: `ws/${ID}`, base: 'origin/main',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
});

const cfg = () => loadConfig({ CCRC_HOME: home });
const mark = (content: string): void => writeFileSync(path.join(reg, `${ID}.child`), content);
const record = async (io: FleetIO = localIO): Promise<SessionRecord> => {
  const r = await readSessionRecord(io, cfg(), ID);
  if (!r.found) throw new Error(`fixture row not found: ${r.reason}`);
  return r.record;
};

describe('SessionRecord.child — three answers, never a boolean', () => {
  it('no marker file → none: a workspace nothing declared a child', async () => {
    expect((await record()).child).toEqual({ kind: 'none' });
  });

  it('a marker naming a run → child, carrying the minting run id', async () => {
    mark('17');
    expect((await record()).child).toEqual({ kind: 'child', runId: 17 });
  });

  // THE SAME SET ccd ACCEPTS (child-reclamation spec §5.1). ccd reads the marker as
  // `$(_reg_get "$id" child)` and judges it with `_child_runid_valid`
  // (`^[1-9][0-9]{0,9}$` under `LC_ALL=C`). Command substitution strips
  // trailing newlines and drops NUL bytes — and trims NOTHING else — so the
  // server reads exactly those bytes, not `.trim()`'s.
  it('trailing newlines are stripped, as ccd\'s `$(…)` strips them', async () => {
    mark('17\n');
    expect((await record()).child).toEqual({ kind: 'child', runId: 17 });
    mark('17\n\n');
    expect((await record()).child).toEqual({ kind: 'child', runId: 17 });
  });

  it('a NUL byte is dropped, as bash drops it from `$(…)`', async () => {
    mark('1\u00007');
    expect((await record()).child).toEqual({ kind: 'child', runId: 17 });
  });

  it('the widest run id ccd writes — ten digits — is a child', async () => {
    mark('9999999999');
    expect((await record()).child).toEqual({ kind: 'child', runId: 9999999999 });
  });

  it.each([
    '', '   ', 'abc', '0', '017', '-3', '1.5', '17 18', '9007199254740993',
    // ELEVEN digits: a safe integer `parseCanonicalPositiveSafeInteger` would
    // accept, and one ccd's `_child_runid_valid` refuses (R2).
    '12345678901',
    // Whitespace ccd's `$(…)` keeps, so ccd would refuse it too.
    ' 17', '17 ', '\t17', '17\r',
    // Digits outside ASCII (wave 1 measured bash's bare `=~` accepting these
    // under a UTF-8 locale; `_child_runid_valid` shadows `LC_ALL=C`).
    '1²', '١٧', '１７',
  ])(
    'content outside ccd\'s run-id grammar (%j) → unreadable, never none', async (content) => {
      // Something wrote this file. A malformed marker is not "no marker".
      mark(content);
      expect((await record()).child).toEqual({ kind: 'unreadable' });
    });

  it('LISTED, and its bytes did not come back → unreadable, never none', async () => {
    mark('17');
    expect((await record(unreadableField(ID, 'child'))).child).toEqual({ kind: 'unreadable' });
  });

  it('a failed read of a file the listing does NOT name → none (the listing rung)', async () => {
    // What an agent older than the wire's `absent` marker answers for EVERY
    // missing file. Without the listing rung, every workspace on such a box
    // would read as an unreadable child and refuse every bind.
    expect((await record(unreadableField(ID, 'child'))).child).toEqual({ kind: 'none' });
  });

  it('a PROVEN ENOENT on a listed marker (a purge racing the read) → none', async () => {
    mark('17');
    expect((await record(absentField(ID, 'child'))).child).toEqual({ kind: 'none' });
  });

  it('the whole-fleet read carries the same field — one parser, two callers', async () => {
    mark('17');
    const rows = await readRegistry(localIO, cfg());
    expect(rows.find((r) => r.id === ID)?.child).toEqual({ kind: 'child', runId: 17 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-mark.test.ts`

Expected: FAIL — all 26 cases, each `AssertionError: expected undefined to deeply equal { kind: … }` (vitest strips types, so the missing field reads as `undefined`, not as a compile error).

- [ ] **Step 3: Add `ChildMark` and `CHILD_RUN_ID` to `shared/api.ts`**

Directly after the line `export type IdentityField = 'uuid' | 'wrapper' | 'workdir';`, insert:

```ts

/** Whether a registry row is a CHILD (spec §4, §5.1). Three answers, never two: an unreadable or malformed
 *  marker is neither "a child" nor "not a child", and callers act on it in OPPOSITE directions — a bind
 *  REFUSES, a reclaim DEFERS. */
export type ChildMark =
  | { readonly kind: 'none' }                                  // no marker file: not a child
  | { readonly kind: 'child'; readonly runId: number }         // marker names the minting run
  | { readonly kind: 'unreadable' };                           // listed but unreadable, or not a decimal run id

/** The run id a child marker may carry — the server's ONE spelling of the set
 *  ccd's `_child_runid_valid` accepts under its shadowed `LC_ALL=C`
 *  (child-reclamation spec §5.1): at most ten ASCII digits, no sign, no
 *  leading zero. JavaScript's `[0-9]` is ASCII in every mode, and `$` without
 *  the `m` flag anchors at the end of the input only, so the two sets are
 *  equal; ten digits sit far below `Number.MAX_SAFE_INTEGER`, so `Number` of a
 *  match is exact. No `g` flag: `.test` must carry no `lastIndex` between
 *  calls. Anything else in a marker is `unreadable`, never a child. */
export const CHILD_RUN_ID = /^[1-9][0-9]{0,9}$/;
```

- [ ] **Step 4: Teach `registry.ts` to read it**

(a) The shared import at the top of `server/src/registry.ts` — replace:

```ts
import {
  isPrPhase, isStopSurface, ROUTE_WRITABLE_FIELDS, type IdentityField, type LifecycleField,
  type PrPhase, type RouteField, type RouteFields, type RouteReadField, type StopSurface,
} from '../../shared/api.js';
```

with:

```ts
import {
  CHILD_RUN_ID, isPrPhase, isStopSurface, ROUTE_WRITABLE_FIELDS,
  type ChildMark, type IdentityField, type LifecycleField,
  type PrPhase, type RouteField, type RouteFields, type RouteReadField, type StopSurface,
} from '../../shared/api.js';
```

(b) `SessionRecord`'s last member is `route: { … } | null;`, followed by the interface's closing `}`. Between them, insert:

```ts
  /**
   * `$REG/<id>.child` — the run id `ccd ws-add --child <runId>` was told
   * minted this workspace (child-reclamation spec §5.1). THREE answers, never
   * a boolean (`ChildMark`, `shared/api.ts`), because the two callers that
   * decide on it act in OPPOSITE directions on the third: the bind gate
   * (`coord/childBind.ts`) REFUSES an unreadable marker, and wave 3's reclaim
   * will DEFER on one. Collapsing `unreadable` into either neighbour is a
   * fail-open in one of those two directions.
   *
   *   `none`       — no marker: a MEASURED absence (a proven ENOENT), or a
   *                  failed read of a file the directory listing this record
   *                  was built from does NOT name — the listing rung `held`,
   *                  `substrate` and `stranded` already apply. An agent older
   *                  than the wire's `absent` marker answers "unreadable" for
   *                  every missing file; without this rung every workspace on
   *                  such a box would read as an unreadable child.
   *   `child`      — the marker read back as a run id in ccd's own grammar
   *                  (`CHILD_RUN_ID`, `shared/api.ts`: at most ten ASCII
   *                  digits, no leading zero — spec §5.1), over the bytes
   *                  ccd's `$(_reg_get …)` sees: NUL bytes dropped, trailing
   *                  newlines stripped, nothing else trimmed. So the server
   *                  and the box call exactly the same markers children.
   *   `unreadable` — the listing names the marker and its bytes did not come
   *                  back, OR they came back as anything outside that grammar
   *                  (empty, `0`, `017`, eleven digits, ` 17`, text).
   *                  Something wrote the file; a malformed marker is not "no
   *                  marker".
   *
   * NO second-listing reconfirm, unlike `held`: nothing but `_reg_purge`
   * removes a marker, and a purge removes `<id>.uuid` with it, which the
   * identity reconfirm in `readRegistryMeasured` already retires the row for.
   *
   * ATTRIBUTION, NOT AUTHENTICATION. Any process on the fleet box can write
   * this file (CLAUDE.md, "Identity on the fleet"). It is the box's half of
   * spec §5.1's two authorities and nothing may treat it as a credential.
   */
  child: ChildMark;
```

(c) `fieldMeasured` gains the read mode the marker needs — replace:

```ts
export async function fieldMeasured(io: FleetIO, dir: string, id: string, name: string): Promise<MeasuredRead> {
  const r = await io.readFileMeasured(path.join(dir, `${id}.${name}`));
  return r.ok ? { ok: true, content: r.content.trim() } : r;
}
```

with:

```ts
export async function fieldMeasured(
  io: FleetIO, dir: string, id: string, name: string, as: 'trimmed' | 'shell' = 'trimmed',
): Promise<MeasuredRead> {
  const r = await io.readFileMeasured(path.join(dir, `${id}.${name}`));
  if (!r.ok) return r;
  return { ok: true, content: as === 'trimmed' ? r.content.trim() : r.content.replace(/\0/g, '').replace(/\n+$/, '') };
}
```

and append one paragraph to its docstring, directly before the closing ` */`:

```ts
 *
 * `as: 'shell'` (child-reclamation wave 2) is for a field ccd DECIDES on and
 * the server must decide on identically: it yields exactly what bash's
 * `$(cat …)` yields — NUL bytes dropped, trailing newlines stripped, and
 * nothing else trimmed — so a value with a leading space or a trailing `\r`
 * reads the same on both sides of the wire. Its one caller is `.child`
 * (spec §5.1); the default keeps every other caller's `.trim()` byte for byte.
```

(d) Directly after `numOrNull`'s closing `}`, insert:

```ts

/** `$REG/<id>.child`'s ONE parser — see `SessionRecord.child` for the three
 *  answers and why none of them may collapse into another. `read` is the
 *  `'shell'` read, so `CHILD_RUN_ID` judges the bytes ccd judges. `listed` is
 *  whether the directory listing `buildRecord` opened with names the file. */
function childMarkOf(read: MeasuredRead, listed: boolean): ChildMark {
  if (read.ok) {
    return CHILD_RUN_ID.test(read.content)
      ? { kind: 'child', runId: Number(read.content) }
      : { kind: 'unreadable' };
  }
  if (read.reason === 'absent') return { kind: 'none' };
  return listed ? { kind: 'unreadable' } : { kind: 'none' };
}
```

(e) `buildRecord`'s destructuring — replace:

```ts
    routeFieldReads, degradedRead, inertRead] = await Promise.all([
```

with:

```ts
    routeFieldReads, degradedRead, inertRead, childRead] = await Promise.all([
```

and the last line of the same array — replace:

```ts
    fieldMeasured(io, cfg.registryDir, id, 'degraded'), fieldMeasured(io, cfg.registryDir, id, 'inert'),
  ]);
```

with:

```ts
    fieldMeasured(io, cfg.registryDir, id, 'degraded'), fieldMeasured(io, cfg.registryDir, id, 'inert'),
    // child-reclamation wave 2: the marker ws-add writes for a dispatched
    // child. MEASURED — an unreadable marker must never read as "not a
    // child" — and read as ccd reads it, untrimmed (see `SessionRecord.child`).
    fieldMeasured(io, cfg.registryDir, id, 'child', 'shell'),
  ]);
```

(The comment deliberately never spells the reader's name followed by a parenthesis: `registry.test.ts`'s census counts those tokens inside this array.)

(f) The listing flags — replace:

```ts
  const strandedListed = names.includes(`${id}.stranded`);
```

with:

```ts
  const strandedListed = names.includes(`${id}.stranded`);
  const childListed = names.includes(`${id}.child`);
```

(g) The returned literal ends `    lifecycleUnmeasured,\n    unmeasured,\n    route,\n  };`. Replace:

```ts
    unmeasured,
    route,
  };
```

with:

```ts
    unmeasured,
    route,
    child: childMarkOf(childRead, childListed),
  };
```

(h) `buildRecord`'s own docstring — after the paragraph that ends "`rises from 553 to 721 agent-WS operations per \`readRegistry\` call, before`\n * the conditional reconfirmation listing.`", insert a paragraph:

```ts
 *
 * 30 -> 31 (child-reclamation wave 2): `.child`, the marker that makes a
 * workspace a CHILD, read MEASURED into `SessionRecord.child` — +1 read x the
 * session count per sweep, so a 24-session fleet's whole-registry sweep rises
 * from 721 to 745 agent-WS operations per `readRegistry` call.
```

- [ ] **Step 5: Run the census — it goes red, and its red is the new value**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-mark.test.ts test/registry.test.ts`

Expected: `child-reclaim-mark.test.ts` PASS, 26/26. `registry.test.ts` FAIL in exactly two cases: *readSessionRecord › costs exactly one readdir plus the one id's 30 field reads — never a per-session Promise.all for a sibling* (`expected [ …(31) ] to have a length of 30 but got 31` — a second hard-coded copy of the field count, which Step 6(e) derives), and *registry read census › derives the single-session and 24-session remote costs from buildRecord*, at its first assertion. Read the triple off the RECEIVED Map in the failure — it is the derivation, and it is the only source of the numbers used below. With this task's one read as the only change to `buildRecord` since the branch tip it reads `fields 31, single 32, fleet 745` against the expected `30, 31, 721`. If another programme has moved `buildRecord` meanwhile, the received values differ; use what it prints.

- [ ] **Step 6: Move every citation with the derivation**

(a) One citation is a HISTORICAL sentence and must not be rewritten into a false history. In `server/test/fleet-wire-route.test.ts`'s header, replace:

```ts
// (`server/src/registry.ts`'s `buildRecord`, the census this task raised
// from 23 to 30 [registry-read-census:fields] — see registry.test.ts's own
// census suite for that half).
```

with:

```ts
// (`server/src/registry.ts`'s `buildRecord`, whose census this task raised
// from twenty-three reads to thirty; later waves raised it again, and today it
// is 30 [registry-read-census:fields] — see registry.test.ts's own census
// suite for that half).
```

(The current figure stays tagged and moves with the script below; the history is in words, which the census regex cannot see.)

(b) Write the rewrite script, outside the repo:

```bash
SCRATCHPAD="$(mktemp -d)"
cat > "$SCRATCHPAD/census-rewrite.mjs" <<'EOF'
// Rewrites every [registry-read-census:*] claim that server/test/registry.test.ts
// ENFORCES — using that test's own comment-joining rule and regex — from the
// OLD field count's triple to the NEW one. Both values are ARGUMENTS, read off
// the census test's own red output; nothing here knows a number.
// Usage (from the repo root): node census-rewrite.mjs <oldFields> <newFields> [--dry-run]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [oldF, newF] = process.argv.slice(2, 4).map(Number);
const dry = process.argv.includes('--dry-run');
if (!Number.isInteger(oldF) || !Number.isInteger(newF)) throw new Error('usage: <oldFields> <newFields> [--dry-run]');
const want = { fields: [oldF, newF], single: [1 + oldF, 1 + newF], fleet: [1 + 24 * oldF, 1 + 24 * newF] };
const root = process.cwd();
const SKIP = new Set(['node_modules', 'dist', 'coverage']);
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (SKIP.has(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
let edits = 0;
for (const f of walk(path.join(root, 'server')).filter((p) => /\.(?:ts|js|mjs|cjs)$/.test(p))) {
  const src = readFileSync(f, 'utf8');
  if (!src.includes('[registry-read-census:')) continue;
  const lines = src.split('\n');
  const texts = lines.map((l) => l.match(/^\s*(?:\/\/|\*)\s?(.*)$/)?.[1] ?? '');
  const joined = texts.join(' ');
  const textStart = []; let acc = 0;
  for (const t of texts) { textStart.push(acc); acc += t.length + 1; }
  const lineStart = []; acc = 0;
  for (const l of lines) { lineStart.push(acc); acc += l.length + 1; }
  const patches = [];
  for (const m of joined.matchAll(/(\d+)\s+[^\d\n]{0,40}?\[registry-read-census:(fields|single|fleet)\]/g)) {
    const [from, to] = want[m[2]];
    if (Number(m[1]) !== from) continue;
    let li = 0; while (li + 1 < textStart.length && textStart[li + 1] <= m.index) li++;
    const at = lineStart[li] + (lines[li].length - texts[li].length) + (m.index - textStart[li]);
    if (src.slice(at, at + m[1].length) !== m[1]) throw new Error(`${f}:${li + 1} offset drift`);
    patches.push({ at, len: m[1].length, to: String(to), where: `${path.relative(root, f)}:${li + 1} ${m[2]} ${from} -> ${to}` });
  }
  let out = src;
  for (const p of [...patches].sort((a, b) => b.at - a.at)) out = out.slice(0, p.at) + p.to + out.slice(p.at + p.len);
  for (const p of patches) console.log(p.where);
  edits += patches.length;
  if (!dry && patches.length > 0) writeFileSync(f, out);
}
console.log(`${edits} claim(s) ${dry ? 'would be ' : ''}rewritten`);
EOF
node "$SCRATCHPAD/census-rewrite.mjs" 30 31 --dry-run
```

(Arguments: the OLD `fields` value from Step 5's expected Map, then the NEW one from its received Map.)

Expected (measured at `62d9c485` with Step 6(a) already applied — the fleet-wire-route line is then already `30` and still rewritten, because its tag now carries the CURRENT figure):

```
server/src/fleet.ts:300 fleet 721 -> 745
server/src/fleet.ts:438 fields 30 -> 31
server/src/registry.ts:64 fields 30 -> 31
server/src/registry.ts:353 fields 30 -> 31
server/src/registry.ts:516 fields 30 -> 31
server/src/registry.ts:517 fleet 721 -> 745
server/src/registry.ts:1087 fields 30 -> 31
server/src/registry.ts:1087 single 31 -> 32
server/src/server.ts:1749 fleet 721 -> 745
server/src/server.ts:1762 fields 30 -> 31
server/src/watch.ts:923 fields 30 -> 31
server/src/watch.ts:924 fleet 721 -> 745
server/src/watch.ts:2018 fields 30 -> 31
server/test/fleet-wire-route.test.ts:7 fields 30 -> 31
server/test/hold-gate.test.ts:110 fields 30 -> 31
server/test/hold-gate.test.ts:369 fields 30 -> 31
server/test/push-copy.test.ts:323 fields 30 -> 31
server/test/registry.test.ts:618 fields 30 -> 31
server/test/routes.test.ts:347 fields 30 -> 31
19 claim(s) would be rewritten
```

The line numbers in `registry.ts` sit several dozen lower after Step 4's inserts; the SET of files and kinds is what to compare. Then run it for real, in the same shell (`$SCRATCHPAD` is the directory the block above made):

```bash
node "$SCRATCHPAD/census-rewrite.mjs" 30 31
```

(c) Two sentences state the same figures in a form the census regex cannot see (a hyphen after the digits), so the script cannot reach them and nothing enforces them. Keep them true by hand:

```bash
perl -pi -e 's/One session.s 30-field read \[registry/One session\x27s 31-field read [registry/; s/721-operation baseline/745-operation baseline/' server/src/registry.ts
grep -n "31-field read\|745-operation baseline" server/src/registry.ts
```

Expected: two lines printed, one each.

(d) The census's hardcoded triple in `server/test/registry.test.ts` — replace:

```ts
    expect(expected).toEqual(new Map([['fields', 30], ['single', 31], ['fleet', 721]]));
```

with the RECEIVED values from Step 5:

```ts
    expect(expected).toEqual(new Map([['fields', 31], ['single', 32], ['fleet', 745]]));
```

(e) The same file's `readSessionRecord` cost case hard-codes the field count a second time, where no census can see it. DERIVE it from the census's own counter instead, so the next read added to `buildRecord` moves it with the census. Replace:

```ts
  it('costs exactly one readdir plus the one id\'s 30 field reads — never a per-session Promise.all for a sibling', async () => {
```

with:

```ts
  it('costs exactly one readdir plus the one id\'s buildRecord field reads — never a per-session Promise.all for a sibling', async () => {
```

and, in the same case, replace:

```ts
    expect(fieldReads).toHaveLength(30);
```

with:

```ts
    // DERIVED, not typed: the census's own counter over `buildRecord`'s one
    // `Promise.all` (child-reclamation wave 2 moved it 30 -> 31 and found this
    // second hard-coded copy by its red).
    expect(fieldReads).toHaveLength(buildRecordFieldReadCount(
      readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'registry.ts'), 'utf8')));
```

(`buildRecordFieldReadCount`, `readFileSync` and `path` are already in scope at the top of `registry.test.ts`.)

- [ ] **Step 7: The one `SessionRecord` literal in the suite gains the field**

In `server/test/hold-gate.test.ts`, replace:

```ts
      unmeasured: ['wrapper'], route: null,
    };
```

with:

```ts
      unmeasured: ['wrapper'], route: null, child: { kind: 'none' },
    };
```

- [ ] **Step 8: Pay the citation tax on `shared/api.ts` (S6-R11) — README by content, the debt census by measurement**

Step 3 inserted lines into `shared/api.ts` above README's four anchors, so this task pays the tax now, in its own commit (the programme ledger's carried constraint "Every CITED file pays the citation tax"; contract ruling R9). Tasks 2 and 5 repeat this step verbatim after their own inserts. Re-anchor BY CONTENT, never by adding a line delta to a number.

(a) Measure where README's four anchors stand in `HEAD`'s `shared/api.ts` — they resolve there, because every earlier commit on this branch paid its own tax — and where those same bytes stand in the working tree, and prove the bytes are identical:

```bash
OLD_U=$(grep -oE 'shared/api\.ts:[0-9]+-[0-9]+' README.md | sed 's/.*://')
OLD_M=$(sed -n '/`purge-mechanism-absent` (`shared\/api\.ts:/,+1p' README.md | grep -oE '`:[0-9]+`' | tr -d '`:' | paste -sd' ')
NEW_U=$(grep -nE "^  \| 'purge-(refused|incomplete|mechanism-absent)'" shared/api.ts | cut -d: -f1 | paste -sd' ')
NEW_M=$(grep -nE "^  'purge-(refused|incomplete|mechanism-absent)':$" shared/api.ts | cut -d: -f1 | paste -sd' ')
echo "old union ${OLD_U}  old map ${OLD_M}  |  new union ${NEW_U}  new map ${NEW_M}"
read -r U1 _ U3 <<<"$NEW_U"; read -r M1 M2 M3 <<<"$NEW_M"; read -r OM1 OM2 OM3 <<<"$OLD_M"
diff <(git show "HEAD:shared/api.ts" | sed -n "${OLD_U/-/,}p;${OM1}p;${OM2}p;${OM3}p") \
     <(sed -n "${U1},${U3}p;${M1}p;${M2}p;${M3}p" shared/api.ts) && echo SAME-BYTES
```

Expected: one README union range and three map numbers (`7465-7467` and `7505 7513 7526` at the branch tip, before Task 1); three new union lines, consecutive, and three new map lines, all below the old ones by the SAME count (the net insertion this task made above them); then `SAME-BYTES`. If the `diff` prints anything, STOP: the anchors' bytes moved or changed, which this procedure cannot repair by position — report it in the wave-done mail.

(b) Re-point README to the bytes, in the same shell. ONE pass, every anchor mapped at once and only on the purge-refusal sentence's two lines: a chain of sequential substitutions would re-rewrite an anchor whose NEW number equals a later anchor's OLD one (a shift of 8 turns `:7505` into `:7513`, which the next substitution would then move again — measured on a copy of README at planning):

```bash
L=$(grep -n '`purge-mechanism-absent` (`shared/api\.ts:' README.md | cut -d: -f1)
MAP="${OLD_U}=${U1}-${U3} ${OM1}=${M1} ${OM2}=${M2} ${OM3}=${M3}" L="$L" perl -pi -e '
  BEGIN { %m = map { split /=/ } split / /, $ENV{MAP} }
  if ($. == $ENV{L} || $. == $ENV{L} + 1) {
    s{(shared/api\.ts:)(\d+-\d+)`}{$1 . ($m{$2} // $2) . "`"}e;
    s{`:(\d+)`}{"`:" . ($m{$1} // $1) . "`"}ge;
  }' README.md
git diff --stat -- README.md
```

Expected: `README.md | 4 ++--` — the two lines of the purge-refusal sentence, nothing else.

(c) Re-measure the census:

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected: *README HAS ITS OWN CENSUS ENTRY, and it is EMPTY* PASSES. *the citation debt moved — re-measure, and lower the census rather than the rule* is either green (the insert moved no corpus anchor into or out of failure) or RED with a received map that differs from the expected one in the `'shared/api.ts'` entry only (`1` at the branch tip; the frozen spec/plan corpus cites `shared/api.ts` by line — `:5644` in the plan-a document — and an insert above it moves the line under that anchor). When it is red, its sum assertion (*the narrated headline is the sum of the census*) is red by the same difference. Neither corpus document may be re-pointed — both are byte-identical to `origin/main` — so this is a RE-MEASUREMENT under the standing rule, not a rule change and not a D-number.

(d) In `server/test/session-hook.test.ts`, set the `'shared/api.ts'` entry in that `byFile` map to the RECEIVED value — or delete the entry if the received map has no `'shared/api.ts'` key (a coincidental pass: the anchor's text slid under it, and the debt is unchanged in kind) — and set the sum's `.toBe(<n>)` to the received total. Put this comment directly above the entry (or where it stood), filling in the two numbers from the measurement, never from this plan (`1 -> 1` is a measurement too; `-> 0` for a deleted entry):

```ts
      // RE-MEASURED at child-reclamation wave 2 (S6-R11, no rule changed, no
      // D-number), in EACH task that inserted lines into `shared/api.ts`: the
      // programme ledger's carried constraint pays the citation tax in the
      // task that incurs it, so this file is green at every commit. The inserts
      // land above anchors the frozen spec/plan corpus cites by line, and
      // neither document may be re-pointed (byte-identical to `origin/main`).
      // README's four anchors into the same file were RE-ANCHORED BY CONTENT in
      // the same commits (the three `LcRefusalToken` union arms and their three
      // map keys, `diff`-proved byte-identical against the previous commit), so
      // README contributes nothing here.
      //   Task 1 (`ChildMark`, `CHILD_RUN_ID`): <old> -> <new>
```

Re-run (c): Expected PASS. Any OTHER red in this file that names a `shared/api.ts` anchor is the same tax — re-measure it the same way and name it in the wave-done mail; never widen a rule to make it green. `session-hook` is a known load flake: a red that does NOT name `shared/api.ts` gets an isolated re-run before anything else.

- [ ] **Step 9: Run the task's suites**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-mark.test.ts test/registry.test.ts \
  test/hold-gate.test.ts test/fleet-wire-route.test.ts test/push-copy.test.ts test/routes.test.ts \
  test/single-definition.test.ts test/session-hook.test.ts test/typecheck-tests.test.ts
```

Expected: PASS everywhere. `session-hook` proves Step 8 paid the tax in full. `single-definition` proves no second `'absent' | 'unreadable'` pair was written (the read vocabulary lives only in `shared/agent-protocol.ts`); `typecheck-tests` proves `hold-gate.test.ts`'s literal was the only `SessionRecord` literal to extend (a missed one is a `TS2741` naming `child`). `typecheck-tests` is a known load flake — re-run it alone before calling it a break.

- [ ] **Step 10: Mutation check, then commit**

Each mutation restored before the next. Command for every row: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-mark.test.ts test/registry.test.ts`.

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | In `childMarkOf`, replace `return listed ? { kind: 'unreadable' } : { kind: 'none' };` with `return { kind: 'none' };` | *LISTED, and its bytes did not come back → unreadable, never none*: `expected { kind: 'none' } to deeply equal { kind: 'unreadable' }` |
| 2 | In `childMarkOf`, replace `CHILD_RUN_ID.test(read.content)` with `(Number.isInteger(Number(read.content)) && Number(read.content) > 0)` — a numeric parse in place of the grammar | the `it.each` rows `'017'`, `'9007199254740993'`, `'12345678901'`, `' 17'`, `'17 '`, `'\t17'` and `'17\r'`: each reads `{ kind: 'child', … }` where `{ kind: 'unreadable' }` is expected |
| 3 | Delete the line `if (read.reason === 'absent') return { kind: 'none' };` | *a PROVEN ENOENT on a listed marker → none*: `expected { kind: 'unreadable' } to deeply equal { kind: 'none' }` |
| 4 | In `registry.test.ts`, put the triple back to `[['fields', 30], ['single', 31], ['fleet', 721]]` | the census case: the received Map is 31/32/745 — the control that the census moved by DERIVATION, not by the edit |
| 5 | In `shared/api.ts`, replace `export const CHILD_RUN_ID = /^[1-9][0-9]{0,9}$/;` with `export const CHILD_RUN_ID = /^[1-9][0-9]*$/;` — the unbounded width ruling R2 forbids | the `it.each` rows `'12345678901'` (`{ kind: 'child', runId: 12345678901 }`) and `'9007199254740993'`, where `{ kind: 'unreadable' }` is expected |
| 6 | In `buildRecord`'s `Promise.all`, replace `fieldMeasured(io, cfg.registryDir, id, 'child', 'shell')` with `fieldMeasured(io, cfg.registryDir, id, 'child')` — the marker read through `.trim()` | the `it.each` rows `' 17'`, `'17 '`, `'\t17'` and `'17\r'` (each `{ kind: 'child', runId: 17 }`), and *a NUL byte is dropped* (`{ kind: 'unreadable' }` where `runId: 17` is expected) |
| 7 | In `fieldMeasured`, replace `r.content.replace(/\0/g, '').replace(/\n+$/, '')` with `r.content.replace(/\n+$/, '')` | *a NUL byte is dropped*: `expected { kind: 'unreadable' } to deeply equal { kind: 'child', runId: 17 }` |
| 8 | In `fieldMeasured`, replace `r.content.replace(/\0/g, '').replace(/\n+$/, '')` with `r.content.replace(/\0/g, '')` | *trailing newlines are stripped*: `expected { kind: 'unreadable' } to deeply equal { kind: 'child', runId: 17 }` |

```bash
git add shared/api.ts server/src/registry.ts server/src/fleet.ts server/src/server.ts server/src/watch.ts \
  server/test/child-reclaim-mark.test.ts server/test/registry.test.ts server/test/fleet-wire-route.test.ts \
  server/test/hold-gate.test.ts server/test/push-copy.test.ts server/test/routes.test.ts \
  README.md server/test/session-hook.test.ts
git commit -m "$(cat <<'MSG'
feat(registry): SessionRecord.child — the three-way reading of $REG/<id>.child

ChildMark (L0) answers none, child with the minting run id, or unreadable,
never a boolean: a bind refuses an unreadable marker and a reclaim will
defer on one, so neither neighbour may absorb it. Read through fieldMeasured
with the listing rung held/substrate/stranded already use; malformed content
is unreadable, not absent. The run id is CHILD_RUN_ID, ccd's own ten-digit
grammar, judged over the bytes ccd's $(...) sees (fieldMeasured's new
'shell' mode). The registry-read census moves 30/31/721 to 31/32/745, every
enforced citation rewritten by the census's own regex. README's
shared/api.ts anchors re-pointed by content and the citation-debt census
re-measured in this commit (S6-R11). Child-reclamation spec §5.1, wave 2.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: `FleetSession.child` on the wire, revived additively

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `shared/api.ts` — `FleetSession`'s last member; `reviveChildMark` directly after `optUnmeasured`; `reviveFleetSession`'s `revived` literal
- Modify: `server/src/fleet.ts` — `assembleFleet`'s literal, after `route: r.route,`
- Modify: every full `FleetSession` fixture literal under `server/test/` and `pwa/test/` (Step 4)
- Modify: `README.md` and `server/test/session-hook.test.ts` — this task's citation tax (Step 5, Task 1 Step 8's procedure)
- Test: `server/test/child-reclaim-mark.test.ts` (append)

**Interfaces:**
- Produces: `FleetSession.child: ChildMark` (readonly, required on every freshly assembled record); `reviveFleetSession` answers `{ kind: 'none' }` for an absent or null key and rejects the whole session on a present-but-malformed one — including a `child` whose `runId` lies outside `CHILD_RUN_ID` (ruling R2: no registry read can produce one). Wave 5's `SessionLine` label consumes it; nothing in this wave does.
- Consumes: `SessionRecord.child` and `CHILD_RUN_ID` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append to `server/test/child-reclaim-mark.test.ts` — first extend its imports:

```ts
import { assembleFleet } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { reviveFleetSession, type FleetSession } from '../../shared/api.js';
```

then, at the end of the file:

```ts
/** A complete fleet row — `fleet-wire-route.test.ts`'s `session()` shape. */
const fleetRow = (id: string): FleetSession => ({
  id, wrapper: 'claude', home: '/home/rc', project: id, workdir: `/data/projects/${id}`,
  workspace: null, name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' },
});

describe('reviveFleetSession — child (ADDITIVE, absence-permits)', () => {
  it('a snapshot from before markers existed (no key at all) revives none — it describes no children', () => {
    const raw = JSON.parse(JSON.stringify(fleetRow(ID))) as Record<string, unknown>;
    delete raw['child'];
    expect(reviveFleetSession(raw)?.child).toEqual({ kind: 'none' });
  });

  it('an explicit null revives none', () => {
    expect(reviveFleetSession({ ...fleetRow(ID), child: null })?.child).toEqual({ kind: 'none' });
  });

  it.each([{ kind: 'none' }, { kind: 'child', runId: 17 }, { kind: 'unreadable' }] as const)(
    'round-trips %j exactly', (child) => {
      expect(reviveFleetSession(JSON.parse(JSON.stringify({ ...fleetRow(ID), child })))?.child).toEqual(child);
    });

  it.each([
    ['a bare string', '17'],
    ['an array', []],
    ['an unknown kind', { kind: 'maybe' }],
    ['a child with no runId', { kind: 'child' }],
    ['a child whose runId is a string', { kind: 'child', runId: '17' }],
    ['a child whose runId is zero', { kind: 'child', runId: 0 }],
    ['a child whose runId is fractional', { kind: 'child', runId: 1.5 }],
    // A safe integer no marker can carry: ccd writes at most ten digits and
    // the registry reader refuses more (spec §5.1), so a persisted eleven-digit
    // run id is a value this build did not write.
    ['a child whose runId has eleven digits', { kind: 'child', runId: 12345678901 }],
  ])('rejects the WHOLE session on %s — never laundered into "not a child"', (_what, child) => {
    expect(reviveFleetSession({ ...fleetRow(ID), child })).toBeNull();
  });
});

describe('assembleFleet — child rides the fleet frame', () => {
  const noopRun: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
  const fleet = (io: FleetIO = localIO) => assembleFleet(io, cfg(), new Tmux(noopRun), 1784600000);

  it('carries a marker naming a run', async () => {
    mark('42');
    expect((await fleet()).find((s) => s.id === ID)?.child).toEqual({ kind: 'child', runId: 42 });
  });

  it('carries an unreadable marker as unreadable — the wire does not narrow it', async () => {
    mark('42');
    expect((await fleet(unreadableField(ID, 'child'))).find((s) => s.id === ID)?.child)
      .toEqual({ kind: 'unreadable' });
  });

  it('carries none for a workspace with no marker', async () => {
    expect((await fleet()).find((s) => s.id === ID)?.child).toEqual({ kind: 'none' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-mark.test.ts`

Expected: FAIL — the two absence cases and the three round-trips read `undefined` (`reviveFleetSession`'s literal never copies the key); the eight malformed cases get a session back, not `null`; the three `assembleFleet` cases read `undefined`. Task 1's 26 cases still PASS.

- [ ] **Step 3: The field, its reviver, and its assembly**

(a) `FleetSession`'s last member is `readonly route: { … } | null;`, followed by the interface's closing `}`. Between them, insert:

```ts
  /**
   * Whether this workspace is a CHILD — minted by `dispatch` for a run and
   * marked so at creation (`$REG/<id>.child`, child-reclamation spec §5.1) —
   * `server/src/registry.ts`'s `SessionRecord.child`, carried straight onto
   * the wire. Three answers, never a boolean (`ChildMark`): `none`, `child`
   * with the minting run's id, or `unreadable` — a marker the registry listing
   * named whose bytes did not come back or did not parse as one run id.
   *
   * DISPLAY ONLY on this wire. No server decision reads it: the bind gate
   * (`coord/childBind.ts`) re-reads the registry at the instant it decides,
   * because a snapshot is exactly the staleness spec §5.3 refuses.
   *
   * ADDITIVE, absence-permits: an older persisted `FleetSession[]` revives
   * with `{ kind: 'none' }` through `reviveFleetSession` below — a frame
   * written before markers existed describes no children. The LIVE `fleet`
   * frame is CAST, not revived (`pwa/src/stores/fleet.ts`'s `asFleetMsg`), so a
   * frame from a server older than this field arrives with the key genuinely
   * absent: a PWA reader must read `s.child?.kind` and treat `undefined` as
   * `none`. No `FLEET_PROTO` bump.
   */
  readonly child: ChildMark;
```

(b) Directly after `optUnmeasured`'s closing `};`, insert:

```ts

/** `FleetSession.child`'s persistence contract (child-reclamation wave 2) —
 *  THE ONE READER of the key off raw JSON. Absent or null → `{ kind: 'none' }`:
 *  a snapshot written before markers existed describes no children, and
 *  nothing else on an older record could say otherwise. Present → exactly one
 *  of the three `ChildMark` shapes, or the WHOLE session is rejected: the
 *  `held`/`bucket` stance, not `reviveAsk`'s, because an affirmative-looking
 *  value this build cannot parse must never be laundered into "not a child" —
 *  and a `child` whose `runId` is outside `CHILD_RUN_ID` (spec §5.1: at most
 *  ten digits, the only run ids the registry reader ever produces) is exactly
 *  that value. */
const reviveChildMark = (o: RawObj, k: string): ChildMark => {
  const v = o[k];
  if (v === undefined || v === null) return { kind: 'none' };
  const s = asObj(v, k);
  const kind = s['kind'];
  if (kind === 'none') return { kind: 'none' };
  if (kind === 'unreadable') return { kind: 'unreadable' };
  if (kind === 'child') {
    const runId = s['runId'];
    if (isPositiveDecimalSafeInteger(runId) && CHILD_RUN_ID.test(String(runId))) return { kind: 'child', runId };
  }
  throw new MalformedSnapshot(k);
};
```

(`isPositiveDecimalSafeInteger` is declared further down the same file; the reviver only runs after the module has evaluated, so the reference is safe. `CHILD_RUN_ID` is Task 1's, declared near the top. `String` of a safe integer is its plain decimal spelling, so the regex judges exactly the digits a marker would carry.)

(c) In `reviveFleetSession`'s `revived` literal, replace:

```ts
      route: reviveRoute(o, 'route'),
    };
```

with:

```ts
      route: reviveRoute(o, 'route'),
      child: reviveChildMark(o, 'child'),
    };
```

(d) In `server/src/fleet.ts`'s `assembleFleet`, replace:

```ts
      route: r.route,
      bucket: 'idle', bucketSince: null,   // replaced immediately below
```

with:

```ts
      route: r.route,
      // Carried straight off the record, like `route` above: the registry's
      // three-way reading of `$REG/<id>.child` (`SessionRecord.child`). A
      // display value on this wire — the bind gate re-reads the registry.
      child: r.child,
      bucket: 'idle', bucketSince: null,   // replaced immediately below
```

- [ ] **Step 4: Every full `FleetSession` fixture gains the field**

`child` is required, so every complete `FleetSession` literal in the two suites is now a `TS2741`. Measured at the branch tip, all of them share one spelling:

```bash
grep -rlP "boardProject: null, route: null,(?! child:)" server/test pwa/test | wc -l
grep -rlP "boardProject: null, route: null,(?! child:)" server/test pwa/test \
  | xargs perl -pi -e "s/boardProject: null, route: null,(?! child:)/boardProject: null, route: null, child: { kind: 'none' },/g"
grep -rl "boardProject: null, route: null, child: { kind: 'none' }," server/test pwa/test | wc -l
```

Expected: `30`, then `31`. The 30 are 27 files under `pwa/test/` and three under `server/test/` (`fleet-health`, `fleetstate`, `fleet-wire-route`); the 31st is this task's own `child-reclaim-mark.test.ts`, whose `fleetRow` Step 1 wrote with the field already — the `(?! child:)` lookahead is what keeps the sweep from giving it a duplicate key. The second count keys on `boardProject: null,` on purpose: `hold-gate.test.ts`'s `SessionRecord` literal (Task 1 Step 7) also reads `route: null, child: { kind: 'none' },` and would make a looser grep print `32`.

- [ ] **Step 5: Pay this task's citation tax on `shared/api.ts` (S6-R11)**

Step 3's (a) and (b) inserted lines into `shared/api.ts` above README's four anchors — the tax is paid here, in this task's commit, not deferred (the programme ledger's carried constraint; contract ruling R9). Run Task 1 Step 8's (a)–(d) VERBATIM: README's anchors now resolve in `HEAD`'s `shared/api.ts`, because Task 1's commit re-pointed them, so the same `diff` against `HEAD` proves this task's move. In (d), keep Task 1's comment and add ONE line directly below its `Task 1` line, the numbers again from the measurement:

```ts
      //   Task 2 (`FleetSession.child`'s docstring, `reviveChildMark`): <old> -> <new>
```

Expected: as in Task 1 Step 8 — `SAME-BYTES`, `README.md | 4 ++--`, and `session-hook.test.ts` PASS after the re-measurement.

- [ ] **Step 6: Run the tests, the typecheck and the pwa suite**

```bash
(cd server && ./node_modules/.bin/vitest run test/child-reclaim-mark.test.ts test/fleet-wire-route.test.ts \
  test/fleetstate.test.ts test/fleet.test.ts test/fleet-health.test.ts test/session-hook.test.ts \
  test/typecheck-tests.test.ts)
(cd pwa && npm run test)
```

Expected: PASS everywhere. If `typecheck-tests` names a `TS2741` for `child` in a file Step 4 did not match, that literal is a full `FleetSession` spelled another way: add `child: { kind: 'none' }` beside its `route` and re-run — never make the field optional to silence it.

- [ ] **Step 7: Mutation check, then commit**

Command for every row: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-mark.test.ts`.

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | In `reviveChildMark`, replace the final `throw new MalformedSnapshot(k);` with `return { kind: 'none' };` | all eight *rejects the WHOLE session on …* cases: `expected { … } to be null` |
| 2 | In `reviveChildMark`, replace `if (v === undefined \|\| v === null) return { kind: 'none' };` with `if (v === undefined \|\| v === null) throw new MalformedSnapshot(k);` | both absence cases: `reviveFleetSession(…)` is `null`, so `?.child` is `undefined` |
| 3 | In `fleet.ts`, replace `child: r.child,` with `child: { kind: 'none' },` | *carries a marker naming a run* and *carries an unreadable marker as unreadable* |
| 4 | In `reviveChildMark`, replace `if (isPositiveDecimalSafeInteger(runId) && CHILD_RUN_ID.test(String(runId)))` with `if (isPositiveDecimalSafeInteger(runId))` — the sixteen-digit domain ruling R2 forbids | *rejects the WHOLE session on a child whose runId has eleven digits*: `expected { … } to be null`; the other seven stay green |

```bash
git add shared/api.ts server/src/fleet.ts server/test/child-reclaim-mark.test.ts server/test pwa/test README.md
git status --short    # expect: the two sources, the test, README.md, session-hook.test.ts, and exactly the 30 fixture files
git commit -m "$(cat <<'MSG'
feat(wire): FleetSession.child — the marker reading rides the fleet frame

Additive, no FLEET_PROTO bump: an older persisted snapshot revives
{kind:'none'}, a frame from before markers describing no children; a
present-but-malformed value rejects the whole session rather than being
laundered into "not a child", and a runId outside CHILD_RUN_ID is
malformed. assembleFleet carries SessionRecord.child straight through.
Display only: the bind gate re-reads the registry. The 30 full
FleetSession fixtures gain the field. README's shared/api.ts anchors
re-pointed by content and the citation-debt census re-measured (S6-R11).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: `CoordStore.clearSession` — the one unbind, and the scan that names it

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/src/coord/store.ts` — new method directly after `setSession`
- Modify: `server/test/coord-store.test.ts` — the *runs.sessionId has exactly ONE re-binding writer* case
- Test: `server/test/child-reclaim-store.test.ts` (new). This wave OWNS the file (contract ruling R13): no other wave creates it, and wave 3's store tests go in `server/test/child-reclaim-mail-store.test.ts`. Create it with exactly the content below; if a file already exists at this path on the workspace's base, STOP and report it — do not merge two files' cases into one.

**Interfaces:**
- Produces: `CoordStore.clearSession(runId: number, pr: number): { ok: true; cleared: boolean }` — contract §2 as amended by ruling R3 (1) and (6): the PR rides in as the second parameter so the ONE transaction writes `session-unbound: <sid> (workspace-spent #<pr>)`, and a `planned` run whose binding is already NULL answers `cleared: false` and writes nothing (Contract reconciliation items 1 and 6, both ACCEPTED). Task 6 is its one caller.
- Consumes: `recordRunEvent(runId, causedBy, detail, at?)`, `tx(db, fn)` — both unchanged.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-store.test.ts`:

```ts
// child-reclamation wave 2, Task 3 — `CoordStore.clearSession`, the ONE
// unbind of `runs.sessionId` (spec §5.4). Dispatch's resume arm calls it after
// the fleet act has released a spent child's claim; the run stays `planned`,
// so the next dispatch takes the fresh-spawn arm and mints a new child.
//
// This file is wave 2's alone: wave 3's store cases live in
// `child-reclaim-mail-store.test.ts`, never here.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-child-store-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore): number => {
  const r = s.openRun({ program: 'build4', title: 't', project: 'demo', wave: 2, waveOf: 3,
    claimedBy: 'ccrc-pwa-coordinator' });
  if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
  return r.id;
};
const details = (s: CoordStore, id: number): (string | null)[] => s.runEvents(id).map((e) => e.detail);

describe('CoordStore.clearSession — the one unbind', () => {
  it('unbinds a planned run — sessionId, workspace, branch NULL — and the trail names who and why', () => {
    const s = store(); const id = open(s);
    s.setSession(id, 'demo-child');
    expect(s.clearSession(id, 42)).toEqual({ ok: true, cleared: true });
    const row = okRun(s.run(id))!;
    expect(row.state).toBe('planned');
    expect(row.sessionId).toBeNull();
    expect(row.workspace).toBeNull();
    expect(row.branch).toBeNull();
    expect(details(s, id)).toContain('session-unbound: demo-child (workspace-spent #42)');
  });

  it('refuses a run that has left planned — cleared:false, binding and trail untouched', () => {
    const s = store(); const id = open(s);
    s.markDispatched(id, 'demo-child', 'demo-child', 'ws/demo-child', true);
    expect(s.advance(id, 'dispatched', 'coordinator').ok).toBe(true);
    const before = s.runEvents(id).length;
    expect(s.clearSession(id, 42)).toEqual({ ok: true, cleared: false });
    const row = okRun(s.run(id))!;
    expect(row.sessionId).toBe('demo-child');
    expect(row.workspace).toBe('demo-child');
    expect(row.branch).toBe('ws/demo-child');
    expect(s.runEvents(id)).toHaveLength(before);
  });

  it('a planned run with no binding answers cleared:false and writes no event', () => {
    const s = store(); const id = open(s);
    const before = s.runEvents(id).length;
    expect(s.clearSession(id, 42)).toEqual({ ok: true, cleared: false });
    expect(s.runEvents(id)).toHaveLength(before);
  });

  it('an unknown run id answers cleared:false', () => {
    expect(store().clearSession(999, 42)).toEqual({ ok: true, cleared: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-store.test.ts`

Expected: FAIL, 4/4 — `TypeError: s.clearSession is not a function`.

- [ ] **Step 3: Add the method**

In `server/src/coord/store.ts`, directly after `setSession`'s closing `}` (the method whose body is `return this.bindSession(runId, sessionId);`), insert:

```ts

  /**
   * THE ONE UNBIND (child-reclamation wave 2, spec §5.4): `runs.sessionId`
   * back to NULL on a `planned` run, with `workspace`/`branch` beside it, and
   * the act attributed on the run's own trail — ONE transaction, so a run is
   * never unbound without its `session-unbound` event, nor the reverse.
   *
   * Its one caller is dispatch's resume arm, AFTER the fleet act (D-48's
   * order): the spent child's claim is released, or handed to a surviving
   * sibling, first, and only a fleet act that succeeded unbinds the row. The
   * run stays `planned` — where a run awaiting dispatch already sits — so no
   * backwards transition is invented, and the next dispatch takes the
   * fresh-spawn arm and mints a new child.
   *
   * NOT A RE-BIND, which is why it is not `bindSession` and why
   * `coord-store.test.ts`'s one-writer scan names it separately: it binds no
   * value to the column, so it can hand the run to nobody. What it does NOT
   * do, stated rather than hidden: worker mail this run's worker was sent on
   * the spent child stays addressed to the spent child — the next
   * `bindSession` sees a NULL predecessor and re-issues nothing. On the one
   * path that calls this (a `planned` run whose dispatch never queued its
   * brief) that set is empty unless a coordinator mailed the run's worker
   * before dispatching it.
   *
   * `pr` rides in for the event's words only: the store holds no PR for a run
   * that has not closed. `cleared: false` — and nothing written — when no
   * `planned` row with a binding matched: an unknown id, a run that has left
   * `planned`, or one already unbound.
   */
  clearSession(runId: number, pr: number): { ok: true; cleared: boolean } {
    return tx(this.db, () => {
      const row = this.db.prepare("SELECT sessionId FROM runs WHERE id = ? AND state = 'planned'")
        .get(runId) as { sessionId: string | null } | undefined;
      if (row === undefined || row.sessionId === null) return { ok: true as const, cleared: false };
      this.db.prepare(
        "UPDATE runs SET sessionId = NULL, workspace = NULL, branch = NULL WHERE id = ? AND state = 'planned'",
      ).run(runId);
      this.recordRunEvent(runId, 'coordinator', `session-unbound: ${row.sessionId} (workspace-spent #${pr})`);
      return { ok: true as const, cleared: true };
    });
  }
```

The event detail is a template literal on purpose: `mail-routes.test.ts`'s kebab scanner reads every SINGLE-quoted hyphenated token under `server/src/coord` as a would-be refusal code.

- [ ] **Step 4: Run it; watch the one-writer scan go red**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-store.test.ts test/coord-store.test.ts`

Expected: `child-reclaim-store.test.ts` PASS, 4/4. `coord-store.test.ts` FAIL in exactly one case, *runs.sessionId has exactly ONE re-binding writer in the store, and it is bindSession*: `runs.sessionId is written outside bindSession: expected [ …(2) ] to have a length of 1`. That scan matches ANY `UPDATE runs SET … sessionId … WHERE`, and the unbind is one.

- [ ] **Step 5: Teach the scan the difference between a re-bind and an unbind**

In `server/test/coord-store.test.ts`, inside that case, replace:

```ts
    const updates = [...src.matchAll(/UPDATE runs SET([\s\S]*?)WHERE/g)]
      .filter((m) => /\bsessionId\b/.test(m[1]!));
    expect(updates, 'runs.sessionId is written outside bindSession').toHaveLength(1);
```

with:

```ts
    const writes = [...src.matchAll(/UPDATE runs SET([\s\S]*?)WHERE/g)]
      .filter((m) => /\bsessionId\b/.test(m[1]!));
    // child-reclamation wave 2: an UNBIND is not a re-bind. It binds no value
    // to the column, so it can hand a run to nobody and has no mail to move —
    // but it is still a writer, so it is named here rather than let through by
    // a wider regex: exactly ONE statement may set the column to NULL, it must
    // mention the column nowhere else in its SET list, and it lives in
    // `clearSession`. A statement that sets the column to anything else — a
    // `?`, an empty string — is a re-binder and lands in `updates` below.
    const UNBIND = /^\s*sessionId\s*=\s*NULL\b(?![\s\S]*\bsessionId\b)/;
    const unbinds = writes.filter((m) => UNBIND.test(m[1]!));
    const updates = writes.filter((m) => !UNBIND.test(m[1]!));
    expect(updates, 'runs.sessionId is written outside bindSession').toHaveLength(1);
    expect(unbinds, 'a second statement sets runs.sessionId to NULL').toHaveLength(1);
    const clearAt = src.indexOf('  clearSession(runId: number, pr: number)');
    expect(clearAt, 'clearSession is gone — the unbind has no home').toBeGreaterThan(-1);
    expect(unbinds[0]!.index!).toBeGreaterThan(clearAt);
    expect(unbinds[0]!.index!).toBeLessThan(src.indexOf('\n  }\n', clearAt));
```

The rest of the case (the `bindAt` anchor, the `INSERT` census, the premise line) is unchanged and still reads `updates`.

- [ ] **Step 6: Run the store suites**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-store.test.ts test/coord-store.test.ts \
  test/single-definition.test.ts test/mail-hardening.test.ts test/mail-routes.test.ts
```

Expected: PASS everywhere. (`mail-routes`' kebab scanner proves the event detail is not a single-quoted token; `mail-hardening`'s writer census is untouched — `clearSession` writes no `mail_deliveries` row.)

- [ ] **Step 7: Mutation check, then commit**

Command for every row: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-store.test.ts test/coord-store.test.ts`.

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | Remove ` AND state = 'planned'` from BOTH statements in `clearSession` | *refuses a run that has left planned*: `expected { ok: true, cleared: true } to deeply equal { ok: true, cleared: false }` |
| 2 | In the `UPDATE`, replace `SET sessionId = NULL,` with `SET sessionId = '',` | the unbind case (`expected '' to be null`) AND the one-writer scan (`runs.sessionId is written outside bindSession: … length of 1`) — an unbind that writes a value is a re-bind, and the scan says so |
| 3 | Delete the `this.recordRunEvent(…)` line | the unbind case: its `details` do not contain `session-unbound: demo-child (workspace-spent #42)` |
| 4 | Rename the method to `clearBinding` (both the declaration and the tests' calls) | the one-writer scan: `clearSession is gone — the unbind has no home` |

```bash
git add server/src/coord/store.ts server/test/child-reclaim-store.test.ts server/test/coord-store.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): CoordStore.clearSession — the one unbind, in one transaction

A planned run's sessionId, workspace and branch back to NULL, with a
session-unbound event naming the spent child and its PR, or nothing at
all. Not a re-bind: it binds no value and moves no mail, and the store's
one-writer scan now names it as the sole NULL writer instead of reddening
on it. The mail it does not move is stated in its docstring.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: `childSpent` — the three-valued verdict, measured when asked

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Create: `server/src/coord/childSpent.ts`
- Test: `server/test/child-reclaim-spent.test.ts` (new)

**Interfaces:**
- Produces (contract §2, verbatim):
  ```ts
  export type ChildSpentVerdict =
    | { readonly kind: 'spent'; readonly pr: number; readonly source: 'registry' | 'prhistory' | 'live' }
    | { readonly kind: 'unspent' }
    | { readonly kind: 'unmeasured'; readonly detail: string };
  export interface ChildSpentDeps { io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState }
  export async function childSpent(deps: ChildSpentDeps, rec: SessionRecord): Promise<ChildSpentVerdict>;
  ```
  Task 5's `childBindGate` is its one caller in this wave; wave 3's close decision consumes it too.
- Consumes: `SessionRecord.prNumber` (collapsing reader — a present number is evidence, a null is evidence of nothing); `readPrHistory(io, registryDir, id)` (`coord/prhistory.ts`); `CCD_ARGV.prStateSession(id)` and `verbSupported` (`ccdargv.ts`); `parsePrLines`, `isFullLine`, `phaseFor`, `CcdPrLine` (`prstate.ts`). All unchanged.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-spent.test.ts`:

```ts
// child-reclamation wave 2, Task 4 — `childSpent` (spec §5.3). Three values,
// never a boolean: `spent` refuses a bind, `unspent` permits one, and
// `unmeasured` refuses too — an unreadable ledger or a lookup that did not
// answer is not evidence that no PR exists.
//
// Order, exactly: the registry's PR number (a present one is evidence; a null
// is evidence of NOTHING, because `field()` folds unreadable into absent),
// then `.prhistory` through its measured reader, then a LIVE
// `ccd pr-state --session` — the one path that can see a PR opened seconds
// ago, which is the hand-over rule 3 exists to stop.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Runner } from '../src/exec.js';
import { readSessionRecord, type SessionRecord } from '../src/registry.js';
import { childSpent, type ChildSpentDeps } from '../src/coord/childSpent.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';

const ID = 'demo-child';
const BRANCH = `ws/${ID}`;
let home: string;
let reg: string;

beforeEach(() => {
  home = mkTmp('ccrc-child-spent-');
  reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({
    wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`, started: '1',
    workspace: ID, branch: BRANCH, base: 'origin/main', child: '5',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
});
const put = (field: string, content: string): void => writeFileSync(path.join(reg, `${ID}.${field}`), content);

/** A `gh pr list` row as `ccd pr-state` re-emits it, bound to this branch —
 *  `run-routes.test.ts`'s `prRow` shape. */
const prRow = (state: 'OPEN' | 'CLOSED' | 'MERGED', extra: Record<string, unknown> = {}) => ({
  number: 7, state, headRefName: BRANCH, baseRefName: 'main', isCrossRepository: false, ours: true, isDraft: false,
  ...(state === 'MERGED' ? { mergedAt: '2020-01-01T00:00:00Z', mergeCommit: { oid: 'f'.repeat(40) } } : {}),
  ...extra,
});
/** One full `pr-state --session` line — `run-routes.test.ts`'s `ccdLine` shape. */
const fullLine = (rows: unknown[], ahead: number | null = 1, id = ID): string =>
  JSON.stringify({ id, rows, baseShort: 'main', branch: BRANCH, ahead, checkedAt: 1 });

/** Real `testDeps` wiring over a recording runner that answers `pr-state`
 *  with `answer` — no real ccd, no real gh. */
const harness = (
  answer: { code: number; stdout: string; stderr: string } = { code: 0, stdout: '', stderr: '' },
  over: Partial<ChildSpentDeps> = {},
) => {
  const verbs: string[] = [];
  const run: Runner = async (_cmd, args) => {
    verbs.push(args[0] ?? '');
    return args[0] === 'pr-state' ? answer : { code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const deps: ChildSpentDeps = { io: base.io, cfg: base.cfg, runCcd: base.runCcd, ...over };
  return { deps, verbs };
};
const recordOf = async (deps: ChildSpentDeps): Promise<SessionRecord> => {
  const r = await readSessionRecord(deps.io, deps.cfg, ID);
  if (!r.found) throw new Error(`fixture row not found: ${r.reason}`);
  return r.record;
};
const verdict = async (h: ReturnType<typeof harness>) => childSpent(h.deps, await recordOf(h.deps));

describe('childSpent — the fast path', () => {
  it('a registry PR number present → spent/registry, and no live call is made', async () => {
    put('prnumber', '42');
    const h = harness();
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 42, source: 'registry' });
    expect(h.verbs).not.toContain('pr-state');
  });

  it('.prhistory naming PRs → spent/prhistory naming the NEWEST by recordedAt, and no live call', async () => {
    // Newest in the MIDDLE, so neither "the first line" nor "the last line"
    // is the right answer by accident.
    put('prhistory', [
      JSON.stringify({ pr: 7, branch: BRANCH, phase: 'merged', recordedAt: 100 }),
      JSON.stringify({ pr: 9, branch: BRANCH, phase: 'closed', recordedAt: 300 }),
      JSON.stringify({ pr: 8, branch: BRANCH, phase: 'closed', recordedAt: 200 }),
    ].join('\n') + '\n');
    const h = harness();
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 9, source: 'prhistory' });
    expect(h.verbs).not.toContain('pr-state');
  });

  it('an UNREADABLE .prhistory → unmeasured, never unspent, and no live call', async () => {
    put('prhistory', '');   // LISTED — `readPrHistory` refuses only a file it can see
    const h = harness(undefined, { io: unreadableField(ID, 'prhistory') });
    expect(await verdict(h)).toEqual({ kind: 'unmeasured', detail: 'the PR ledger (.prhistory) could not be read' });
    expect(h.verbs).not.toContain('pr-state');
  });

  it('an unreadable .prnumber is evidence of NOTHING — it falls through to the live lookup', async () => {
    put('prnumber', '42');
    const h = harness({ code: 0, stdout: `${fullLine([prRow('OPEN')])}\n`, stderr: '' },
      { io: unreadableField(ID, 'prnumber') });
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 7, source: 'live' });
    expect(h.verbs).toContain('pr-state');
  });
});

describe('childSpent — the live lookup', () => {
  it.each([
    ['open', prRow('OPEN')],
    ['draft', prRow('OPEN', { isDraft: true })],
    ['merged', prRow('MERGED')],
    ['closed', prRow('CLOSED')],
  ] as const)('a bound %s PR → spent/live, naming it', async (_phase, row) => {
    const h = harness({ code: 0, stdout: `${fullLine([row])}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 7, source: 'live' });
  });

  it('no PR bound to the branch → unspent (a research child still hands over)', async () => {
    const h = harness({ code: 0, stdout: `${fullLine([])}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'unspent' });
  });

  it('a branch level with its base → unspent', async () => {
    const h = harness({ code: 0, stdout: `${fullLine([], 0)}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'unspent' });
  });

  it.each([
    ['branch-drift — the lookup provably did not look for this PR',
      JSON.stringify({ id: ID, phase: 'unknown', reason: 'branch-drift' }), 'branch-drift'],
    ['a whole-repo failure, which --session CAN emit (no remote)',
      JSON.stringify({ phase: 'unknown', reason: 'no-remote' }), 'no-remote'],
    ['a merge ccd could not prove', fullLine([prRow('MERGED', { mergeCommit: null })]), 'merge-unproven'],
    ['a full line about ANOTHER session', fullLine([prRow('OPEN')], 1, 'demo-other'), 'no line for this session'],
    ['nothing parseable', 'not json', 'no line for this session'],
  ])('%s → unmeasured, never unspent', async (_what, stdout, why) => {
    const h = harness({ code: 0, stdout: `${stdout}\n`, stderr: '' });
    const v = await verdict(h);
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' ? v.detail : '').toContain(why);
  });

  it('a failed ccd call → unmeasured, quoting ccd', async () => {
    const h = harness({ code: 1, stdout: '', stderr: 'gh: timeout' });
    expect(await verdict(h)).toEqual({ kind: 'unmeasured', detail: 'pr-state failed: gh: timeout' });
  });

  it('a box whose ccd does not advertise pr-state → unmeasured, and nothing is sent', async () => {
    const h = harness(undefined, {
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ensure'], rosterFp: null, build: null },
    });
    expect(await verdict(h)).toEqual({ kind: 'unmeasured', detail: 'the fleet host cannot answer pr-state' });
    expect(h.verbs).not.toContain('pr-state');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-spent.test.ts`

Expected: FAIL at collection — `Error: Cannot find module '../src/coord/childSpent.js' imported from …/server/test/child-reclaim-spent.test.ts` (the module does not exist).

- [ ] **Step 3: Write `server/src/coord/childSpent.ts`**

```ts
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { SessionRecord } from '../registry.js';
import { CCD_ARGV, verbSupported } from '../ccdargv.js';
import { isFullLine, parsePrLines, phaseFor, type CcdPrLine } from '../prstate.js';
import { readPrHistory } from './prhistory.js';
import type { PrLineageEntry } from './store.js';
import type { PrPhase } from '../../../shared/api.js';

/**
 * Whether a CHILD is SPENT — its branch has ever had a PR, in any phase
 * (child-reclamation spec §4, §5.3). THREE answers, never a boolean: an
 * unreadable ledger or a lookup that did not answer is not evidence that no
 * PR exists, and a gate that read it as `unspent` would bind a spent child —
 * the exact hand-over rule 3 forbids. `source` says which evidence spoke.
 */
export type ChildSpentVerdict =
  | { readonly kind: 'spent'; readonly pr: number; readonly source: 'registry' | 'prhistory' | 'live' }
  | { readonly kind: 'unspent' }
  | { readonly kind: 'unmeasured'; readonly detail: string };

/** The ports this verdict reads through — consumer-declared (L2), the same
 *  four `verifyDone` takes. Both `Deps` and `DispatchRunDeps` satisfy it. */
export interface ChildSpentDeps { io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState }

/**
 * What a LIVE lookup's measured phase proves. Total over `PrPhase`, so a
 * phase added to the vocabulary is a compile error here until someone decides
 * what it proves. `none` and `no-commits` are gh's positive answer that no PR
 * is bound to this branch; `unknown` (including `merge-unproven`, where gh
 * said MERGED and a conjunct failed) and `unchecked` prove nothing.
 */
const LIVE_PHASE: Readonly<Record<PrPhase, 'spent' | 'unspent' | 'unmeasured'>> = {
  open: 'spent', draft: 'spent', merged: 'spent', closed: 'spent',
  none: 'unspent', 'no-commits': 'unspent',
  unchecked: 'unmeasured', unknown: 'unmeasured',
};

/**
 * The spent verdict, MEASURED at the moment it is asked (spec §5.3). Three
 * sources, in this order, and the order is the argument:
 *
 *  1. `rec.prNumber` — present is evidence of spent. ONE DIRECTION ONLY: the
 *     registry reads `.prnumber` through the collapsing `field()`, which folds
 *     an unreadable file into the same null as an absent one, so a null says
 *     nothing and the verdict falls through.
 *  2. `.prhistory`, through `readPrHistory` — which tells absent from
 *     unreadable. Unreadable answers `unmeasured`: `closeRun`'s own fail-shut
 *     direction on the same file. Any entry answers `spent`, naming the
 *     NEWEST by `recordedAt` (the ledger is append-only, so a retired PR stays
 *     a PR).
 *  3. A LIVE `ccd pr-state --session <id>` — nothing in this system learns of
 *     a PR by push, and the sweep's cadence is minutes while a coordinator
 *     opens wave N+1 seconds after the worker's done mail. Gated like every
 *     other caller of the verb (`verbSupported`). A bound open/draft/merged/
 *     closed PR answers `spent`; gh's "none bound" answers `unspent`; every
 *     other answer — `branch-drift` (the lookup provably did not look for this
 *     branch's PR), a whole-repo failure, a failed ccd call, an unparseable or
 *     foreign line — answers `unmeasured`, with the reason in `detail`.
 *
 * COST, measured rather than assumed: steps 1–2 are file reads; step 3 is one
 * gh call on the fleet box, bounded by `pr-state`'s 20 s remote budget, and it
 * runs only for a CHILD with no PR on record — never for a workspace with no
 * marker (`childBindGate` returns before calling this).
 */
export async function childSpent(deps: ChildSpentDeps, rec: SessionRecord): Promise<ChildSpentVerdict> {
  if (rec.prNumber !== null) return { kind: 'spent', pr: rec.prNumber, source: 'registry' };

  const history = await readPrHistory(deps.io, deps.cfg.registryDir, rec.id);
  if (!history.ok) return { kind: 'unmeasured', detail: 'the PR ledger (.prhistory) could not be read' };
  let newest: PrLineageEntry | null = null;
  for (const e of history.entries) if (newest === null || e.recordedAt >= newest.recordedAt) newest = e;
  if (newest !== null) return { kind: 'spent', pr: newest.pr, source: 'prhistory' };

  const argv = CCD_ARGV.prStateSession(rec.id);
  if (!verbSupported(deps.fleetState, argv)) {
    return { kind: 'unmeasured', detail: 'the fleet host cannot answer pr-state' };
  }
  const res = await deps.runCcd(argv);
  if (!res.ok) return { kind: 'unmeasured', detail: `pr-state failed: ${res.stderr.trim()}` };
  const lines = parsePrLines(res.stdout);
  const line = lines.find((l): l is CcdPrLine => isFullLine(l) && l.id === rec.id);
  if (line === undefined) {
    const failure = lines.find((l) => !isFullLine(l));
    return { kind: 'unmeasured', detail: failure === undefined
      ? 'pr-state answered no line for this session'
      : `pr-state answered ${failure.reason ?? 'unknown'}` };
  }
  const measured = phaseFor(line);
  const proves = LIVE_PHASE[measured.phase];
  if (proves === 'spent' && measured.number !== null) return { kind: 'spent', pr: measured.number, source: 'live' };
  if (proves === 'unspent') return { kind: 'unspent' };
  return { kind: 'unmeasured',
    detail: `pr-state answered ${measured.phase}${measured.reason === null ? '' : ` (${measured.reason})`}` };
}
```

(`'no-commits'` is the only single-quoted hyphenated token in the file; `mail-routes.test.ts`'s kebab scanner already lists it in `NOT_CODES`.)

- [ ] **Step 4: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-spent.test.ts test/verb-gate.test.ts \
  test/mail-routes.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts
```

Expected: PASS everywhere — `child-reclaim-spent` 17/17. `verb-gate` proves the new `CCD_ARGV.prStateSession` call site is gated (`pr-state` is in its `NEW_GENERATION` list); `single-definition` proves the coord ring still holds (no `./db.js` import, no `coord.db` receiver).

- [ ] **Step 5: Mutation check, then commit**

Command for every row: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-spent.test.ts`.

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | Replace `if (!history.ok) return { kind: 'unmeasured', detail: 'the PR ledger (.prhistory) could not be read' };` with `if (!history.ok) return { kind: 'unspent' };` | *an UNREADABLE .prhistory → unmeasured*: `expected { kind: 'unspent' } to deeply equal { kind: 'unmeasured', … }` |
| 2 | In the `line === undefined` branch, replace the whole `return { kind: 'unmeasured', … };` with `return { kind: 'unspent' };` | the five *… → unmeasured, never unspent* cases except `merge-unproven`: `expected 'unspent' to be 'unmeasured'` |
| 3 | Replace `if (!res.ok) return { kind: 'unmeasured', detail: \`pr-state failed: ${res.stderr.trim()}\` };` with `if (!res.ok) return { kind: 'unspent' };` | *a failed ccd call → unmeasured* |
| 4 | Delete the line `if (rec.prNumber !== null) return { kind: 'spent', pr: rec.prNumber, source: 'registry' };` | *a registry PR number present*: the default runner answers `''`, so the verdict is `unmeasured` and `verbs` contains `pr-state` |
| 5 | Delete the `if (!verbSupported(deps.fleetState, argv)) { … }` block | *a box whose ccd does not advertise pr-state*: the detail is `pr-state answered no line for this session` and `verbs` contains `pr-state` |
| 6 | Replace the `for (const e of history.entries) …` line with `newest = history.entries[0] ?? null;` | *.prhistory naming PRs*: `pr: 7` where `9` is expected (and `history.entries.at(-1)` gives `8` — both wrong) |
| 7 | In `LIVE_PHASE`, change `unknown: 'unmeasured'` to `unknown: 'unspent'` | *a merge ccd could not prove*: `expected 'unspent' to be 'unmeasured'` |

```bash
git add server/src/coord/childSpent.ts server/test/child-reclaim-spent.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): childSpent — the three-valued spent verdict, measured when asked

The registry's PR number (present is evidence; null is evidence of
nothing), then .prhistory through its measured reader, then a live
pr-state --session behind verbSupported. Every failure — an unreadable
ledger, branch-drift, a whole-repo failure, a failed call, a foreign or
unparseable line — answers unmeasured, never unspent. Spec §5.3.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The two codes, the ONE gate, the open-time refusal, and the coordinator's prose

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `shared/api.ts` — the `RunRefuseCode` docstring, union and map
- Create: `server/src/coord/childBind.ts`
- Modify: `server/src/coord/routes.ts` — import; `POST /api/runs`, directly after the `claimant-is-a-worker` refusal
- Modify: `ccd/coordinator-skill/SKILL.md` — the `refused` parenthetical; the refusal-list sentence; step 6's Clean arm
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §1's table and its reclaim paragraphs; §5 step 3
- Modify: `server/test/run-routes.test.ts` — two readdir counters
- Modify: `README.md` — the four `shared/api.ts` anchors of the purge-refusal sentence (Step 9, by content — this task's own insert, its own tax)
- Modify: `server/test/session-hook.test.ts` — the citation-debt census's `shared/api.ts` entry, its sum and the comment's `Task 5` line (Step 9, re-measured)
- Test: `server/test/child-reclaim-bind.test.ts` (new), `server/test/child-reclaim-refusals.test.ts` (new)

**Interfaces:**
- Produces: `RunRefuseCode` gains `'workspace-spent'` and `'spent-unmeasured'` (19 → 21).
- Produces (contract §2, verbatim):
  ```ts
  export type ChildBindVerdict =
    | { readonly ok: true }
    | { readonly ok: false; readonly code: 'workspace-spent'; readonly pr: number }
    | { readonly ok: false; readonly code: 'spent-unmeasured'; readonly detail: string };
  export async function childBindGate(deps: ChildSpentDeps, sessionId: string): Promise<ChildBindVerdict>;
  ```
- Produces: `POST /api/runs` with a string `sessionId` answers `409 { ok: false, refused: 'workspace-spent', pr }` or `409 { ok: false, refused: 'spent-unmeasured', detail }` before `openRun` inserts anything. Task 6 consumes `childBindGate`.
- Consumes: `readSessionRecord(io, cfg, id): Promise<SingleRead>`, `SessionRecord.child` (Task 1), `childSpent` (Task 4).

- [ ] **Step 1: Write the failing gate tests**

Create `server/test/child-reclaim-bind.test.ts`:

```ts
// child-reclamation wave 2, Task 5 — `childBindGate`, the ONE gate both doors
// call (spec §5.4): `POST /api/runs` naming a `sessionId`, and dispatch's
// resume arm. Non-children are untouched by all of it — a workspace with no
// marker binds exactly as today, even one that has had a PR.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { childBindGate } from '../src/coord/childBind.js';
import type { ChildSpentDeps } from '../src/coord/childSpent.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';

const ID = 'demo-child';
let home: string;
let reg: string;

beforeEach(() => {
  home = mkTmp('ccrc-child-bind-');
  reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({
    wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`, started: '1',
    workspace: ID, branch: `ws/${ID}`, base: 'origin/main',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
});
const put = (field: string, content: string): void => writeFileSync(path.join(reg, `${ID}.${field}`), content);
const noPrLine = JSON.stringify({ id: ID, rows: [], baseShort: 'main', branch: `ws/${ID}`, ahead: 1, checkedAt: 1 });

const harness = (io: FleetIO = localIO) => {
  const verbs: string[] = [];
  const run: Runner = async (_cmd, args) => {
    verbs.push(args[0] ?? '');
    return args[0] === 'pr-state' ? { code: 0, stdout: `${noPrLine}\n`, stderr: '' } : { code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const deps: ChildSpentDeps = { io, cfg: base.cfg, runCcd: base.runCcd };
  return { deps, verbs };
};

describe('childBindGate', () => {
  it('a workspace with NO marker binds as today — even one that has had a PR', async () => {
    put('prnumber', '42');
    const h = harness();
    expect(await childBindGate(h.deps, ID)).toEqual({ ok: true });
    expect(h.verbs).not.toContain('pr-state');
  });

  it('a session with no registry row binds as today', async () => {
    expect(await childBindGate(harness().deps, 'demo-nobody')).toEqual({ ok: true });
  });

  it('a spent child → workspace-spent, naming the PR', async () => {
    put('child', '5'); put('prnumber', '42');
    expect(await childBindGate(harness().deps, ID)).toEqual({ ok: false, code: 'workspace-spent', pr: 42 });
  });

  it('an unspent child → ok: a research wave still hands over', async () => {
    put('child', '5');
    const h = harness();
    expect(await childBindGate(h.deps, ID)).toEqual({ ok: true });
    expect(h.verbs).toContain('pr-state');
  });

  it('an UNREADABLE marker → spent-unmeasured, never a bind', async () => {
    put('child', '5');
    expect(await childBindGate(harness(unreadableField(ID, 'child')).deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the child marker could not be read' });
  });

  it('a MALFORMED marker → spent-unmeasured', async () => {
    put('child', 'abc');
    expect(await childBindGate(harness().deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the child marker could not be read' });
  });

  it('an unmeasured verdict → spent-unmeasured, carrying its detail', async () => {
    put('child', '5'); put('prhistory', '');
    expect(await childBindGate(harness(unreadableField(ID, 'prhistory')).deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the PR ledger (.prhistory) could not be read' });
  });

  it('an UNLISTABLE registry → spent-unmeasured: it proves nothing, so it is not "no row"', async () => {
    put('child', '5');
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    expect(await childBindGate(harness(unlistable).deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' });
  });

  it('a MARKED row the registry cannot build (a torn identity field) → spent-unmeasured, never "no row"', async () => {
    // `readSessionRecord` answers `absent` for a row `buildRecord` DROPS — an
    // identity field read back empty — exactly as for one with no `.uuid`.
    // The marker is still listed: this is a child whose evidence was not read.
    put('child', '5'); put('wrapper', '');
    expect(await childBindGate(harness().deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the child marker is listed but its registry row could not be built' });
  });

  it('…and a SECOND listing that fails there → spent-unmeasured', async () => {
    put('child', '5'); put('wrapper', '');
    // Listing 1 is `readSessionRecord`'s (a dropped row takes no reconfirm);
    // listing 2 is the gate's own look for the marker.
    let n = 0;
    const second: FleetIO = { ...localIO, readdir: async (p) => (++n === 2 ? null : localIO.readdir(p)) };
    expect(await childBindGate(harness(second).deps, ID))
      .toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' });
  });

  it('an UNMARKED row the registry cannot build binds as today — non-children are untouched', async () => {
    put('wrapper', '');
    expect(await childBindGate(harness().deps, ID)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Write the failing route tests**

Create `server/test/child-reclaim-refusals.test.ts`:

```ts
// child-reclamation wave 2 — rule 3 at both doors, end to end through the
// real routes (spec §5.4). A CHILD whose branch has had a PR may not take
// another run: `POST /api/runs` refuses before any row exists (Task 5), and
// dispatch's resume arm refuses before `ensure`, releasing the spent child's
// claim and unbinding the run so the next dispatch mints a fresh child
// (Task 6). The marker is written into the fixture registry directly — wave 1
// need not be deployed for any of this to be measured.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';
import { okRuns } from './coordReadHelpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT = 'demo';
const CHILD = 'demo-child';
const TOKEN = 'f'.repeat(64);
const OPEN_BODY = { program: 'build4', title: 'Child reclamation', project: PROJECT,
  wave: 2, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator', homeProject: PROJECT };
/** `run-routes.test.ts`'s happy `/clear` pane sequence. */
const CLEAR_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];

/** A full registry row — `run-routes.test.ts`'s own `seed`. */
const seed = (home: string, id: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const spend = (home: string, id: string, pr: number): void =>
  writeFileSync(path.join(home, '.cc-sessions', `${id}.prnumber`), String(pr));
const noPrLine = (id: string): string =>
  JSON.stringify({ id, rows: [], baseShort: 'main', branch: `ws/${id}`, ahead: 1, checkedAt: 1 });
const openPrLine = (id: string): string => JSON.stringify({ id, rows: [{
  number: 7, state: 'OPEN', headRefName: `ws/${id}`, baseRefName: 'main', isCrossRepository: false, ours: true, isDraft: false,
}], baseShort: 'main', branch: `ws/${id}`, ahead: 1, checkedAt: 1 });

interface RunnerCfg { prStdout?: string; fail?: ReadonlySet<string>; wsAddCreates?: string[] }
/** One recording runner for both vocabularies — ccd verbs and the tmux calls
 *  `sendPrompt`'s `/clear` makes (`testDeps` wires both through it). */
function makeRunner(home: string, cfg: RunnerCfg = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `${verb} failed` };
    if (verb === 'ws-add') {
      for (const id of cfg.wsAddCreates ?? [`${PROJECT}-fresh`]) seed(home, id);
      return { code: 0, stdout: '', stderr: '' };
    }
    if (verb === 'pr-state') return { code: 0, stdout: `${cfg.prStdout ?? noPrLine(CHILD)}\n`, stderr: '' };
    if (verb === 'capture-pane') {
      const p = CLEAR_PANES[Math.min(capIdx, CLEAR_PANES.length - 1)]!;
      capIdx++;
      return { code: 0, stdout: p, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };   // ensure, ws-hold, ws-release, send-keys, has-session…
  };
  return { run, calls };
}
const openApp = async (home: string, run: Runner, over: Partial<Deps> = {}) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};
const headers = { 'x-ccrc-mail-token': TOKEN };
const postOpen = (app: FastifyInstance, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/runs', headers, payload: body });
const verbsOf = (calls: string[][]): string[] => calls.map((c) => c[0] ?? '');

describe('POST /api/runs — a spent child is refused before anything exists', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses workspace-spent, naming the PR — no row, no hold, no live lookup', async () => {
    const home = mkTmp('ccrc-child-open-');
    seed(home, CHILD, { child: '5', prnumber: '42' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: CHILD });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'workspace-spent', pr: 42 });
    expect(okRuns(w.coord.runs()), 'a refused open left a planned orphan').toHaveLength(0);
    expect(verbsOf(calls)).not.toContain('ws-hold');
    expect(verbsOf(calls)).not.toContain('pr-state');
  });

  it('refuses on a PR only the LIVE lookup can see (opened seconds ago)', async () => {
    const home = mkTmp('ccrc-child-open-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home, { prStdout: openPrLine(CHILD) });
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: CHILD });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'workspace-spent', pr: 7 });
    expect(verbsOf(calls)).toContain('pr-state');
    expect(verbsOf(calls)).not.toContain('ws-hold');
  });

  it('refuses spent-unmeasured on an unreadable marker — no row, no hold', async () => {
    const home = mkTmp('ccrc-child-open-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run, { io: unreadableField(CHILD, 'child') }); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: CHILD });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'spent-unmeasured', detail: 'the child marker could not be read' });
    expect(okRuns(w.coord.runs())).toHaveLength(0);
    expect(verbsOf(calls)).not.toContain('ws-hold');
  });

  it('an UNLISTABLE registry refuses spent-unmeasured for ANY sessionId — a NON-child too, because the gate cannot tell', async () => {
    // The one place this wave changes the non-child path (spec §5.4's fail-shut
    // exception): before the gate, the open never listed the registry and
    // answered 200 here. Pinned rather than left to a moved counter, so the
    // change is visible.
    const home = mkTmp('ccrc-child-open-');
    seed(home, 'demo-plain');   // no marker: a non-child
    const { run, calls } = makeRunner(home);
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    const w = await openApp(home, run, { io: unlistable }); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: 'demo-plain' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'spent-unmeasured', detail: 'the registry could not be listed' });
    expect(okRuns(w.coord.runs())).toHaveLength(0);
    expect(verbsOf(calls)).not.toContain('ws-hold');
  });

  it('an unspent child hands over as today (a research wave)', async () => {
    const home = mkTmp('ccrc-child-open-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: CHILD });
    expect(res.statusCode).toBe(200);
    expect(calls.filter((c) => c[0] === 'ws-hold')).toHaveLength(1);
    expect(okRuns(w.coord.runs())[0]?.sessionId).toBe(CHILD);
  });

  it('a workspace with NO marker binds as today, even one that has had a PR', async () => {
    const home = mkTmp('ccrc-child-open-');
    seed(home, CHILD, { prnumber: '42' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, sessionId: CHILD });
    expect(res.statusCode).toBe(200);
    expect(verbsOf(calls)).not.toContain('pr-state');
  });
});

describe('the coordinator is told, where it decides', () => {
  const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
  /** Prose wraps; a phrase is the same phrase across a line break
   *  (`coordinator-skill.test.ts`'s own `flat`). */
  const flat = (s: string): string => s.replace(/\s+/g, ' ');

  it('§5 states one PR per child AHEAD of the same-project arm, and names both refusals', () => {
    const wl = read('ccd/coordinator-skill/references/wave-lifecycle.md');
    const start = wl.indexOf('## 5 — The boundary');
    expect(start, 'wave-lifecycle.md lost §5').toBeGreaterThanOrEqual(0);
    const beforeSame = flat(wl.slice(start, wl.indexOf('**Same project:**', start)));
    expect(beforeSame, '§5 no longer says a spent producer is succeeded without its sessionId')
      .toContain('WITHOUT its `sessionId`');
    for (const code of ['`workspace-spent`', '`spent-unmeasured`']) expect(beforeSame).toContain(code);
  });

  it('SKILL.md step 6 says it before the same-project arm', () => {
    const skill = read('ccd/coordinator-skill/SKILL.md');
    const start = skill.indexOf('6. **Rule on the report**');
    expect(start, 'SKILL.md lost step 6').toBeGreaterThanOrEqual(0);
    expect(skill.slice(start, skill.indexOf('**Same project:**', start))).toContain('`workspace-spent`');
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-bind.test.ts test/child-reclaim-refusals.test.ts`

Expected: `child-reclaim-bind.test.ts` FAILS at collection — `Error: Cannot find module '../src/coord/childBind.js' imported from …/server/test/child-reclaim-bind.test.ts`. `child-reclaim-refusals.test.ts`: the four refusing open cases FAIL (`expected 200 to be 409` — nothing refuses yet, and the open never lists the registry, so the unlistable one opens too), the two pass-through cases PASS, and both prose cases FAIL (§5 carries no such paragraph; step 6 names no `workspace-spent`).

- [ ] **Step 4: Declare the two codes**

In `shared/api.ts`:

(a) In the `RunRefuseCode` docstring, replace:

```ts
 * Nineteen codes exist below today; the next new one would be the
 * twentieth, not the ninth.
```

with:

```ts
 * Twenty-one codes exist below today; the next new one would be the
 * twenty-second, not the ninth.
```

(b) Directly before the docstring's closing ` */` (after the `review-in-flight` paragraph), insert:

```ts
 *
 * `workspace-spent` and `spent-unmeasured` are rule 3 of the child-reclamation
 * programme (spec 2026-09-22 §5.3-§5.4): a CHILD — a workspace the server
 * minted for a run and marked `$REG/<id>.child` at creation — carries at most
 * one PR, so once its branch has had one (open, draft, merged or closed) no
 * further run may bind it. ONE gate emits both (`coord/childBind.ts`), at TWO
 * doors: `POST /api/runs` naming a `sessionId`, before any row exists, and
 * `POST /api/runs/:id/dispatch`'s resume arm, before `ensure`. Two codes and
 * not one with a detail, because the caller acts on them in OPPOSITE
 * directions: `workspace-spent` (with `pr`) says "drop the `sessionId`; a
 * fresh child will be minted" — and at dispatch the server has already done
 * so, reporting `unbound` — while `spent-unmeasured` (with `detail`) says "the
 * evidence could not be read; retry, and do NOT drop the `sessionId` on this
 * account", because an unreadable marker or ledger is not a spent one. A
 * workspace with no marker is never refused by either.
```

(c) Replace the union and map:

```ts
  | 'project-mismatch' | 'home-mismatch' | 'hold-oversize' | 'hold-invalid' | 'review-in-flight'
  | 'claimant-is-a-worker';
```

with:

```ts
  | 'project-mismatch' | 'home-mismatch' | 'hold-oversize' | 'hold-invalid' | 'review-in-flight'
  | 'claimant-is-a-worker' | 'workspace-spent' | 'spent-unmeasured';
```

and:

```ts
  'review-in-flight': true, 'claimant-is-a-worker': true,
};
```

with:

```ts
  'review-in-flight': true, 'claimant-is-a-worker': true,
  'workspace-spent': true, 'spent-unmeasured': true,
};
```

- [ ] **Step 5: Write `server/src/coord/childBind.ts`**

```ts
import { readSessionRecord } from '../registry.js';
import { childSpent, type ChildSpentDeps } from './childSpent.js';

/**
 * Rule 3's verdict for one bind (child-reclamation spec §5.4). `ok: true` is
 * a workspace that is not a child — no marker, or no registry row, which is
 * today's behaviour — or a child that has had no PR. The two refusals are the
 * two `RunRefuseCode`s of the same names; `shared/api.ts` argues why they are
 * two.
 */
export type ChildBindVerdict =
  | { readonly ok: true }   // not a child (no marker, or no registry row — today's behaviour), or an unspent child
  | { readonly ok: false; readonly code: 'workspace-spent'; readonly pr: number }
  | { readonly ok: false; readonly code: 'spent-unmeasured'; readonly detail: string };

/**
 * THE ONE GATE both doors call — `POST /api/runs` naming a `sessionId`
 * (`coord/routes.ts`) and dispatch's resume arm (`coord/dispatch.ts`) — so the
 * two cannot drift into two readings of one rule.
 *
 * It re-reads the registry at the instant it decides, never a snapshot:
 * `readSessionRecord` costs one listing plus that session's field reads, 32
 * [registry-read-census:single] agent-WS operations in remote mode. Its
 * answers, and none folds into another:
 *   - a listing that FAILED → `spent-unmeasured`: it proves nothing about this
 *     session, so it cannot be "no row". This holds for ANY `sessionId`,
 *     marked or not — the one place the gate changes the non-child path,
 *     because it cannot tell a non-child from a child without the listing;
 *   - `absent` → ONE MORE LISTING, because `absent` is two populations
 *     (`readSessionRecord`'s own docstring): no `.uuid` in the listing, and a
 *     row `buildRecord` DROPPED (an identity field read back empty, or
 *     listed-then-gone) or the reconfirm listing lost. The second can be a
 *     MARKED child. A `.child` the listing names with no row built around it
 *     → `spent-unmeasured`; no `.child` → `ok` (no registry row; the open or
 *     the `ensure` that follows answers for it exactly as it always has); a
 *     failed listing → `spent-unmeasured`. Paid only on a miss;
 *   - `child.kind === 'none'` → `ok`: non-children are untouched, even one
 *     whose branch has had a PR;
 *   - `child.kind === 'unreadable'` → `spent-unmeasured`: a bind REFUSES what
 *     it cannot read (wave 3's reclaim will DEFER on the same answer).
 * A child is then asked `childSpent`, whose three answers map one to one.
 */
export async function childBindGate(deps: ChildSpentDeps, sessionId: string): Promise<ChildBindVerdict> {
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  if (!read.found) {
    if (read.reason === 'unlistable') {
      return { ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' };
    }
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null) return { ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' };
    if (names.includes(`${sessionId}.child`)) {
      return { ok: false, code: 'spent-unmeasured',
        detail: 'the child marker is listed but its registry row could not be built' };
    }
    return { ok: true };
  }
  const mark = read.record.child;
  if (mark.kind === 'none') return { ok: true };
  if (mark.kind === 'unreadable') {
    return { ok: false, code: 'spent-unmeasured', detail: 'the child marker could not be read' };
  }
  const spent = await childSpent(deps, read.record);
  if (spent.kind === 'spent') return { ok: false, code: 'workspace-spent', pr: spent.pr };
  if (spent.kind === 'unmeasured') return { ok: false, code: 'spent-unmeasured', detail: spent.detail };
  return { ok: true };
}
```

The number before `[registry-read-census:single]` in that docstring is NOT to be typed from this plan: write the RECEIVED `single` value Task 1 Step 5 read off the census's red (`32` at `62d9c485`, with Task 1's one read the only change to `buildRecord`). If another programme has moved `buildRecord` since, the census has moved with it and so must this citation — it is ENFORCED by `registry.test.ts`'s census from this commit on. Check it at once, before going on:

```bash
cd server && ./node_modules/.bin/vitest run test/registry.test.ts
```

Expected: PASS. A red *has a stale single registry census claim* naming `server/src/coord/childBind.ts` means the typed number was not the derivation — use the value the red's own Map carries.

- [ ] **Step 6: The open-time refusal**

In `server/src/coord/routes.ts`:

(a) After `import { queueSystemMail } from './rundefs.js';`, add:

```ts
import { childBindGate } from './childBind.js';
```

(b) Directly after the `claimant-is-a-worker` refusal block —

```ts
    const workerOf = coord.openClaimantsOf(claimedBy).find((c) => c !== claimedBy);
    if (workerOf !== undefined) {
      return reply.code(409).send({ ok: false, refused: 'claimant-is-a-worker', by: workerOf });
    }
```

— insert:

```ts

    // Rule 3 (child-reclamation spec §5.4): a CHILD whose branch has had a PR
    // may not take another run. HERE, for F1's reason: a refusal must leave no
    // `planned` orphan and place no hold, so it runs before `openRun` and the
    // hold below. After every DB-only refusal above, because this is the
    // handler's first awaited read of the registry and, for a child with no PR
    // on record, a live `pr-state` round trip — a cheaper refusal is never
    // kept waiting behind it. It runs inside `coordMutex`, which is the cost:
    // at most `pr-state`'s 20 s budget, and only for a CHILD with no PR on
    // record — a workspace with no marker costs one registry read. The two
    // codes are spelled here, not forwarded from the verdict: `mail-routes.
    // test.ts` requires every `RunRefuseCode` to be quoted in this directory.
    if (typeof sessionId === 'string') {
      const gate = await childBindGate(deps, sessionId);
      if (!gate.ok) {
        return gate.code === 'workspace-spent'
          ? reply.code(409).send({ ok: false, refused: 'workspace-spent', pr: gate.pr })
          : reply.code(409).send({ ok: false, refused: 'spent-unmeasured', detail: gate.detail });
      }
    }
```

- [ ] **Step 7: The coordinator's prose**

(a) `ccd/coordinator-skill/SKILL.md`, the `refused` parenthetical — replace:

```
`claimed-by-another`, `not-dispatched`, `prhistory-unreadable`); those same
```

with:

```
`claimed-by-another`, `not-dispatched`, `prhistory-unreadable`,
`workspace-spent`, `spent-unmeasured`); those same
```

(b) The refusal-list sentence — replace:

```
`project-mismatch`, `home-mismatch`, `claimant-is-a-worker`, `hold-oversize`, `hold-invalid`,
```

with:

```
`project-mismatch`, `home-mismatch`, `claimant-is-a-worker`, `workspace-spent`,
`spent-unmeasured`, `hold-oversize`, `hold-invalid`,
```

(c) Step 6's Clean arm — replace:

```
     breaking every `toId:'coordinator'` mail from that point on. Opening first
     never lets the count reach zero.
     **Same project:** open wave N+1 first with this producer's `sessionId`, close
```

with:

```
     breaking every `toId:'coordinator'` mail from that point on. Opening first
     never lets the count reach zero.
     **One PR per child decides `sessionId` before the project does:** a
     producer whose workspace opened a PR is SPENT, so wave N+1 opens without
     its `sessionId` and the producer closes as the cross-project arm closes it,
     even inside one project — naming a spent workspace is refused
     `workspace-spent` (`references/wave-lifecycle.md` §5). The same-project arm
     is for a producer whose workspace opened no PR.
     **Same project:** open wave N+1 first with this producer's `sessionId`, close
```

(d) `ccd/coordinator-skill/references/wave-lifecycle.md` §1's refusal table — directly after the `| \`claimant-is-a-worker\` | …` row, insert two rows:

```
| `workspace-spent` | the `sessionId` you passed is a CHILD workspace — one the server minted for a run — whose branch has already had a PR (open, draft, merged or closed); `pr` names it. A child carries at most one PR | open the wave again WITHOUT `sessionId`; its dispatch mints a fresh child (§5, "One PR per child"). Nothing was opened and nothing was held |
| `spent-unmeasured` | the `sessionId` you passed may be a spent child and the server could not tell: the child marker, the PR ledger, the registry listing or the live PR lookup did not answer; `detail` says which. An UNLISTABLE registry (`detail` `the registry could not be listed`) answers this for ANY `sessionId`, marked or not — without the listing the server cannot tell a child from any other workspace | retry the same open. It is NOT `workspace-spent` — the evidence was unreadable, not absent — so do not drop `sessionId` on its account. If it repeats, stop and report. Nothing was opened and nothing was held |
```

(e) §1's reclaim paragraphs — directly after the paragraph that begins `   **That reclaim is SAME-PROJECT.**` and ends `refused \`project-mismatch\`, \`by:\` that project, before any run row exists.`, insert:

```

   **And it is PR-FREE.** A workspace the server minted for a run is a CHILD,
   and a child carries at most one PR: once its branch has had one, naming it
   here is refused `workspace-spent` (table above), whatever the project. See
   §5, "One PR per child".
```

(f) §5 step 3 — replace:

```
   `awaiting-review`/`merging`, and the new `planned` one), so it can never
   read as zero between waves.

   **Same project:** open wave N+1 first with this producer's `sessionId`, then
```

with:

```
   `awaiting-review`/`merging`, and the new `planned` one), so it can never
   read as zero between waves.

   **One PR per child — the PR decides `sessionId`, not the project.** A
   workspace the server minted for a run is a CHILD, and a child carries at
   most one PR. If this producer's workspace opened a PR — the ordinary case
   for a wave that shipped code — it is SPENT: open wave N+1 WITHOUT its
   `sessionId`, even in the same project, and close the producer as the
   cross-project arm below closes it (`final:true`, then require
   `released:true`). The same-project arm is for a producer whose workspace
   opened no PR — a research or measurement wave — and only for that. Naming a
   spent workspace is refused `workspace-spent`, with `pr` naming the PR, and
   nothing is opened; `spent-unmeasured` means the server could not read the
   evidence either way — retry the same open, and do not drop `sessionId` on
   its account.

   **Same project:** open wave N+1 first with this producer's `sessionId`, then
```

- [ ] **Step 8: Two existing counters move**

`run-routes.test.ts` has TWO cases that fail the Nth `readdir` to reach the resumed session's own listing, both opening with a `sessionId` and then dispatching: *refuses registry-unmeasurable on wave N>=2 when the SECOND directory read (the resumed session's own registry listing) fails …* and *still answers registry-unmeasurable when the registry cannot be listed at all*. The open's gate now lists the registry once, so in both that listing moves from the second to the third. Left at `n === 2`, the failing read becomes dispatch's PAUSE check and the case answers `409 paused` — `expected 409 to be 502`. Locate each by its own comment, never by line.

(a) The first (its comment opens `// Succeeds on the pause-marker's own read (call 1)`) — replace:

```ts
    // Succeeds on the pause-marker's own read (call 1), fails on the very
    // next one — this route's own registry read for the resumed session
    // (call 2) — never a third: nothing else in this branch touches
    // `io.readdir` before either of those two. `POST /api/runs`' own
    // coordinator-project stamp read (Task 1) does NOT count against this:
    // it reads `<claimedBy>.project` through `fieldMeasured`, a FILE read
    // (`io.readFileMeasured`), never `io.readdir` — this fixture only
    // overrides the latter.
    let n = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { n += 1; return n === 2 ? null : localIO.readdir(p); } };
```

with:

```ts
    // Succeeds on the open's child bind gate (call 1 — child-reclamation
    // wave 2: `readSessionRecord` lists the registry once) and on the
    // pause-marker's own read (call 2), fails on the very next one — this
    // route's own registry read for the resumed session (call 3) — never a
    // fourth: nothing else touches `io.readdir` before those. `POST /api/runs`'
    // own coordinator-project stamp read (Task 1) does NOT count against this:
    // it reads `<claimedBy>.project` through `fieldMeasured`, a FILE read
    // (`io.readFileMeasured`), never `io.readdir` — this fixture only
    // overrides the latter.
    let n = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { n += 1; return n === 3 ? null : localIO.readdir(p); } };
```

(b) The second (*still answers registry-unmeasurable when the registry cannot be listed at all*) — replace:

```ts
    // `POST /api/runs`' own coordinator-project stamp read (Task 1) does NOT
    // count against this: it reads `<claimedBy>.project` through
    // `fieldMeasured`, a FILE read, never `io.readdir`.
    let n = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { n += 1; return n === 2 ? null : localIO.readdir(p); } };
```

with:

```ts
    // `POST /api/runs`' own coordinator-project stamp read (Task 1) does NOT
    // count against this: it reads `<claimedBy>.project` through
    // `fieldMeasured`, a FILE read, never `io.readdir`. The open's child bind
    // gate DOES (child-reclamation wave 2: `readSessionRecord` lists the
    // registry once), so the resumed session's own listing is the THIRD.
    let n = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { n += 1; return n === 3 ? null : localIO.readdir(p); } };
```

- [ ] **Step 9: Pay this task's citation tax on `shared/api.ts` (S6-R11)**

Step 4 inserted lines into `shared/api.ts` — the `RunRefuseCode` paragraph for the two codes — above README's four anchors. This is the third and last payment this wave makes, each in the task that incurred it (the programme ledger's carried constraint; contract ruling R9): Tasks 1 and 2 have already paid for their own inserts, so README's anchors resolve in `HEAD`'s `shared/api.ts` and the census is green at `HEAD`. Run Task 1 Step 8's (a)–(d) VERBATIM. In (d), keep the comment Tasks 1 and 2 wrote and add ONE line directly below its `Task 2` line, the numbers from the measurement, never from this plan:

```ts
      //   Task 5 (the `RunRefuseCode` paragraph for `workspace-spent`/`spent-unmeasured`): <old> -> <new>
```

Expected: as in Task 1 Step 8 — `SAME-BYTES`, `README.md | 4 ++--`, and `session-hook.test.ts` PASS after the re-measurement. The comment this step extends sits at the census map, far below the highest corpus anchor into `session-hook.test.ts` (`:7043-7056` at planning), so extending it moves no citation.

- [ ] **Step 10: Run the task's suites**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-bind.test.ts test/child-reclaim-refusals.test.ts \
  test/run-routes.test.ts test/coordinator-skill.test.ts test/mail-routes.test.ts test/registry.test.ts \
  test/single-definition.test.ts test/resume-reclaim-l0.test.ts test/crossrepo-prose.test.ts \
  test/home-project-required.test.ts test/run-route-route.test.ts test/run-route-session-trail.test.ts \
  test/verb-gate.test.ts test/session-hook.test.ts test/typecheck-tests.test.ts
```

Expected: PASS everywhere. The four that read the new vocabulary in both directions: `mail-routes` (every `RunRefuseCode` quoted in `server/src/coord`, and every quoted kebab token there declared), `coordinator-skill` (every code in SKILL.md's sentence is real and explained in `wave-lifecycle.md`; every `RunRefuseCode` is named somewhere in the skill; the §5 succession pins still find their arms in order), `registry` (the new `[registry-read-census:single]` citation equals the derivation), and `resume-reclaim-l0` (the dead-coordinator `RECLAIM_REFUSE_CODES` are still NOT `RunRefuseCode`s). `run-routes` is green only with BOTH Step 8 counters moved.

- [ ] **Step 11: Mutation check, then commit**

Command for rows 1–7: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-bind.test.ts test/child-reclaim-refusals.test.ts`. Rows 8–9: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-refusals.test.ts test/coordinator-skill.test.ts`.

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | In `childBindGate`, replace the `if (mark.kind === 'unreadable') { … }` block's return with `return { ok: true };` | *an UNREADABLE marker*, *a MALFORMED marker* (bind), and *refuses spent-unmeasured on an unreadable marker* (route: `expected 200 to be 409`) |
| 2 | In the `if (read.reason === 'unlistable') { … }` block, replace its `return { ok: false, … };` with `return { ok: true };` | *an UNLISTABLE registry → spent-unmeasured* (bind) and *an UNLISTABLE registry refuses spent-unmeasured for ANY sessionId* (route: `expected 200 to be 409`) |
| 3 | Delete the line `if (mark.kind === 'none') return { ok: true };` | *a workspace with NO marker binds as today* (bind: `workspace-spent` 42 where `ok` is expected; route: `expected 409 to be 200`) — the non-children pin |
| 4 | In `routes.ts`, move the whole `if (typeof sessionId === 'string') { const gate = … }` block to just after `if ('refused' in opened) { … }` (below `coord.openRun`) | *refuses workspace-spent, naming the PR — no row*: `a refused open left a planned orphan: expected [ …(1) ] to have a length of 0` |
| 5 | Delete the whole `if (names.includes(\`${sessionId}.child\`)) { … }` block | *a MARKED row the registry cannot build*: `expected { ok: true } to deeply equal { ok: false, code: 'spent-unmeasured', … }` — the torn-identity fail-open |
| 6 | Replace `if (names === null) return { ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' };` with `if (names === null) return { ok: true };` | *…and a SECOND listing that fails there*: `{ ok: true }` where `spent-unmeasured` is expected |
| 7 | Replace `const names = await deps.io.readdir(deps.cfg.registryDir);` with `const names: string[] = [];` | *a MARKED row the registry cannot build* and *…a SECOND listing that fails there*: both `{ ok: true }` — the control that the rung reads a REAL listing, not a constant |
| 8 | Delete §5's `**One PR per child — …**` paragraph from `wave-lifecycle.md` | *§5 states one PR per child AHEAD of the same-project arm* |
| 9 | Rename the code out of the whole skill corpus: `perl -pi -e 's/workspace-spent/WORKSPACE_SPENT/g' ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md` — every occurrence this task added (edits (a)–(f), §1's two rows, the PR-FREE paragraph and §5's paragraph; `grep -c workspace-spent` on both files reads `0` at the branch tip). Restore with the reverse substitution, `s/WORKSPACE_SPENT/workspace-spent/g`, NEVER `git checkout --` (the edits are uncommitted), and confirm `grep -c WORKSPACE_SPENT` reads `0` on both | `coordinator-skill.test.ts`'s *mentions every declared MailRejectCode and RunRefuseCode SOMEWHERE in the skill*: `workspace-spent is a real RunRefuseCode but is named nowhere in the skill`; `child-reclaim-refusals.test.ts`'s *§5 states one PR per child AHEAD of the same-project arm, and names both refusals* and *SKILL.md step 6 says it before the same-project arm*. (The upper-case token is invisible to the refusal-list harvest's lower-case kebab regex, so that case stays green — re-measure before recording.) |

```bash
git add shared/api.ts server/src/coord/childBind.ts server/src/coord/routes.ts \
  ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md \
  server/test/child-reclaim-bind.test.ts server/test/child-reclaim-refusals.test.ts server/test/run-routes.test.ts \
  README.md server/test/session-hook.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): rule 3 at the open — workspace-spent and spent-unmeasured

childBindGate is the one gate both doors call: a workspace with no marker
binds as today; an unreadable marker, an unlistable registry, a marked row
the registry cannot build or an unmeasured verdict refuses
spent-unmeasured; a spent child refuses workspace-spent naming its PR.
POST /api/runs asks it after every DB-only refusal and before openRun, so
a refusal leaves no row and no hold. The coordinator skill names both
codes and wave-lifecycle §1/§5 say what spends a workspace and what to do.
README's shared/api.ts anchors re-pointed by content and the citation-debt
census re-measured for this task's insert (S6-R11). Spec §5.4.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Rule 3 at dispatch — refuse before `ensure`, release, unbind

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/src/coord/dispatch.ts` — imports; `DispatchOutcome`; new `refuseSpentChild` directly after `capsMeasured`; the resume arm; the `dispatchDec` comment; the R7 comment
- Modify: `server/src/coord/routes.ts` — `sendDispatchOutcome`, a `childSpent` arm
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §2's table; §5's one-PR paragraph
- Modify: `server/test/unattended-actor.test.ts` — `SITES`, the count case's title and comment, the `SITES` docstring
- Modify: `server/test/dispatch-hold-order.test.ts` — one comment
- Modify: `server/test/run-routes.test.ts` — the two readdir counters again
- Test: `server/test/child-reclaim-refusals.test.ts` (append)

**Interfaces:**
- Produces: `DispatchOutcome` member (contract §2, verbatim): `{ ok: false; kind: 'childSpent'; code: 'workspace-spent' | 'spent-unmeasured'; pr?: number; detail?: string; unbound: boolean }`, mapped by the dispatch route to `409 { ok: false, refused: code, pr?, detail?, unbound }`.
- Consumes: `childBindGate` (Task 5), `CoordStore.clearSession(runId, pr)` (Task 3), `CoordStore.openRunsForSession(sessionId, excludeRunId)`, `releaseIsSafe`, `holdReasonVerdict`, `CCD_ARGV.wsHold`/`wsRelease`, `verbSupported` — all existing. The sibling hand-over (`releaseIsSafe`, `holdReasonVerdict`, `wsHold`) is Contract reconciliation item 2, RULED ACCEPTED (contract ruling R3 (2)): the arm releases only when nothing else claims the child, and otherwise re-holds with the surviving run's own reason — `closeRun`'s F9 rule. There is no unconditional-release form to build.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/child-reclaim-refusals.test.ts` — first extend its imports:

```ts
import { degradedReadIO } from './ioDoubles.js';
import { okRun } from './coordReadHelpers.js';
import { holdReason } from '../src/coord/rundefs.js';
```

then, at the end of the file:

```ts
const postDispatch = (app: FastifyInstance, id: number) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers, payload: { brief: 'do the thing' } });

describe('POST /api/runs/:id/dispatch — a child spent since its open', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  /** Opens wave `wave` on the child while it is still UNSPENT, as a
   *  coordinator following the protocol would. */
  const openOn = async (a: FastifyInstance, wave: number): Promise<number> => {
    const res = await postOpen(a, { ...OPEN_BODY, wave, sessionId: CHILD });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { id: number }).id;
  };

  it('refuses before ensure, releases the claim, unbinds the run — and the next dispatch mints a fresh child', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const id = await openOn(app, 2);
    spend(home, CHILD, 42);   // the previous wave's worker opened its PR after this open
    const before = calls.length;

    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'workspace-spent', pr: 42, unbound: true });
    const after = calls.slice(before);
    expect(after).toContainEqual(['ws-release', '--session', CHILD]);
    expect(verbsOf(after), 'a spent child was resumed').not.toContain('ensure');
    expect(verbsOf(after), 'a /clear was typed into a spent child').not.toContain('send-keys');
    const row = okRun(w.coord.run(id))!;
    expect(row.state).toBe('planned');
    expect(row.sessionId).toBeNull();
    expect(row.dispatchedAt).toBeNull();
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain(`session-unbound: ${CHILD} (workspace-spent #42)`);

    // The automated exit: rule 4 forbids a refusal that needs a human.
    const again = await postDispatch(app, id);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ ok: true, sessionId: `${PROJECT}-fresh`, resumed: false });
  });

  it('a failed release changes nothing — unbound:false, the binding kept, no unbind event', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run } = makeRunner(home, { fail: new Set(['ws-release']) });
    const w = await openApp(home, run); app = w.app;
    const id = await openOn(app, 2);
    spend(home, CHILD, 42);
    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'workspace-spent', pr: 42, unbound: false });
    expect((res.json() as { detail: string }).detail).toContain('ws-release failed');
    expect(okRun(w.coord.run(id))!.sessionId).toBe(CHILD);
    expect(w.coord.runEvents(id).map((e) => e.detail).join('\n')).not.toContain('session-unbound');
  });

  it('a box whose ccd does not advertise ws-release changes nothing', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: {
      connected: true, downSince: null, ccdVerbs: ['ws-hold', 'pr-state', 'ensure', 'ws-add'], rosterFp: null, build: null,
    } }); app = w.app;
    const id = await openOn(app, 2);
    spend(home, CHILD, 42);
    const before = calls.length;
    const res = await postDispatch(app, id);
    expect(res.json()).toEqual({ ok: false, refused: 'workspace-spent', pr: 42,
      detail: 'this box\'s ccd does not support ws-release', unbound: false });
    expect(verbsOf(calls.slice(before))).not.toContain('ws-release');
    expect(okRun(w.coord.run(id))!.sessionId).toBe(CHILD);
  });

  it('spent-unmeasured at dispatch keeps the binding and sends nothing — unknown is not spent', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    let degrade = false;
    const io = degradedReadIO((p) => degrade && p.endsWith(`${CHILD}.child`));
    const w = await openApp(home, run, { io }); app = w.app;
    const id = await openOn(app, 2);
    degrade = true;
    const before = calls.length;
    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'spent-unmeasured',
      detail: 'the child marker could not be read', unbound: false });
    expect(verbsOf(calls.slice(before))).not.toContain('ws-release');
    expect(verbsOf(calls.slice(before))).not.toContain('ensure');
    expect(okRun(w.coord.run(id))!.sessionId).toBe(CHILD);
  });

  it('a sibling still open on the child keeps its claim: the hold is HANDED OVER, never released', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const a = await openOn(app, 2);   // still open — dispatched out of protocol order
    const b = await openOn(app, 3);
    spend(home, CHILD, 42);
    const before = calls.length;
    const res = await postDispatch(app, b);
    expect(res.json()).toEqual({ ok: false, refused: 'workspace-spent', pr: 42, unbound: true });
    const after = calls.slice(before);
    expect(after).toContainEqual(['ws-hold', '--session', CHILD, '--reason', holdReason('build4', 2, 3, a)]);
    expect(verbsOf(after), 'a release would drop the live sibling\'s claim').not.toContain('ws-release');
    expect(okRun(w.coord.run(b))!.sessionId).toBeNull();
    expect(okRun(w.coord.run(a))!.sessionId).toBe(CHILD);
  });

  it('an UNREADABLE sibling list refuses before any fleet act', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const a = await openOn(app, 2);
    const b = await openOn(app, 3);
    // An integer this process cannot represent — `openRunsForSession` refuses
    // the whole list rather than assert "nothing else claims it" (D-2545).
    w.coord.db.prepare('UPDATE runs SET wave = ? WHERE id = ?').run(BigInt(Number.MAX_SAFE_INTEGER) + 1n, a);
    spend(home, CHILD, 42);
    const before = calls.length;
    const res = await postDispatch(app, b);
    expect(res.json()).toMatchObject({ ok: false, refused: 'workspace-spent', pr: 42, unbound: false });
    expect(verbsOf(calls.slice(before))).not.toContain('ws-release');
    expect(verbsOf(calls.slice(before))).not.toContain('ws-hold');
    expect(okRun(w.coord.run(b))!.sessionId).toBe(CHILD);
  });

  it('an INVALID survivor hold refuses before any fleet act — the claim is never handed to a hold the hook rejects', async () => {
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, CHILD, { child: '5' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const b = await openOn(app, 3);
    // `coord-abandon.test.ts`'s invalid-survivor fixture: a reconstructed run,
    // still open on the child, whose programme slug the hold grammar rejects.
    const [survivor] = w.coord.reconstruct({
      ledger: { slug: 'bad program', title: 'Recovered', waves: [{ wave: 1, of: 1, handoffCommit: null }] },
      registry: { sessionId: CHILD, project: PROJECT, workspace: CHILD, branch: `ws/${CHILD}`, held: 'legacy hold' },
      prHistory: [],
    });
    if (!survivor) throw new Error('reconstruct did not return a survivor');
    spend(home, CHILD, 42);
    const before = calls.length;
    const res = await postDispatch(app, b);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'workspace-spent', pr: 42, unbound: false });
    expect((res.json() as { detail: string }).detail).toContain('the surviving run\'s claim cannot be written');
    expect(verbsOf(calls.slice(before))).not.toContain('ws-release');
    expect(verbsOf(calls.slice(before))).not.toContain('ws-hold');
    expect(okRun(w.coord.run(b))!.sessionId).toBe(CHILD);
  });

  it('an UNLISTABLE registry at dispatch refuses spent-unmeasured for a NON-child too — where the resume arm used to answer 502', async () => {
    // Spec §5.4's fail-shut exception, pinned at the second door: the gate's
    // listing fails, it cannot tell a child from any workspace, so it refuses
    // retryably before `ensure`. Readdir calls: 1 the open's gate, 2 the
    // dispatch pause check, 3 dispatch's gate — the one this fails.
    const home = mkTmp('ccrc-child-dispatch-');
    seed(home, 'demo-plain');   // no marker
    const { run, calls } = makeRunner(home);
    let n = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { n += 1; return n === 3 ? null : localIO.readdir(p); } };
    const w = await openApp(home, run, { io }); app = w.app;
    const opened = await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-plain' });
    expect(opened.statusCode, opened.body).toBe(200);
    const id = (opened.json() as { id: number }).id;
    const before = calls.length;
    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'spent-unmeasured',
      detail: 'the registry could not be listed', unbound: false });
    expect(verbsOf(calls.slice(before))).not.toContain('ensure');
    expect(okRun(w.coord.run(id))!.sessionId).toBe('demo-plain');
  });
});

describe('the dispatch refusal is documented field for field', () => {
  it('names every field the 409 carries, in the §2 rows that explain it', () => {
    // HARVESTED from the route's own arm rather than typed, so a field added
    // there reds here until the coordinator is told what it means.
    const routes = readFileSync(path.join(repoRoot, 'server/src/coord/routes.ts'), 'utf8');
    const at = routes.indexOf("case 'childSpent':");
    expect(at, 'sendDispatchOutcome has no childSpent arm — this harvest is stale').toBeGreaterThan(-1);
    const arm = routes.slice(at, routes.indexOf('\n    case ', at + 1));
    const fields = [...new Set([...arm.matchAll(/(\w+):/g)].map((m) => m[1]!))]
      .filter((f) => f !== 'ok' && f !== 'refused').sort();
    expect(fields).toEqual(['detail', 'pr', 'unbound']);
    const wl = readFileSync(path.join(repoRoot, 'ccd/coordinator-skill/references/wave-lifecycle.md'), 'utf8');
    const s2 = wl.slice(wl.indexOf('## 2 — Dispatch a wave'), wl.indexOf('## 3 — Read mail'));
    const rows = s2.split('\n')
      .filter((l) => l.startsWith('| `workspace-spent`') || l.startsWith('| `spent-unmeasured`')).join('\n');
    expect(rows, '§2 carries no workspace-spent/spent-unmeasured rows').not.toBe('');
    for (const f of fields) expect(rows, `§2's rows never name \`${f}\``).toContain(`\`${f}\``);
  });

  it('§5 tells the coordinator what unbound:true asks of it', () => {
    const wl = readFileSync(path.join(repoRoot, 'ccd/coordinator-skill/references/wave-lifecycle.md'), 'utf8');
    const start = wl.indexOf('## 5 — The boundary');
    expect(wl.slice(start, wl.indexOf('**Same project:**', start)).replace(/\s+/g, ' ')).toContain('`unbound:true`');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-refusals.test.ts`

Expected: Task 5's eight cases still PASS. Every new dispatch case FAILS — with no gate at dispatch the resume arm runs `ensure`, the hold and the `/clear`, and answers `200` (the unreadable-marker and invalid-survivor cases too: nothing at dispatch reads the marker yet), except the non-child unlistable case, whose third listing is still the resumed session's own read and answers `502 registry-unmeasurable` (`expected 502 to be 409`); both documentation cases FAIL (`sendDispatchOutcome has no childSpent arm`; §5 does not mention `unbound:true`).

- [ ] **Step 3: The outcome member and the refusal**

In `server/src/coord/dispatch.ts`:

(a) Imports — add `type ActorFlags` to the existing `../ccdargv.js` import, keeping every name already in it. At the branch tip that import reads `import { CCD_ARGV, ROUTE_ARGV_CAP, ROUTE_CAP, capSupported, verbSupported, sweepDec } from '../ccdargv.js';`; on a workspace cut from a `main` that carries wave 1 it also names `CHILD_ARGV_CAP` (contract §1: `dispatchRun`'s fresh-spawn arm reads it), and that name stays. Either way it becomes, for example:

```ts
import {
  CCD_ARGV, ROUTE_ARGV_CAP, ROUTE_CAP, capSupported, verbSupported, sweepDec, type ActorFlags,
} from '../ccdargv.js';
```

(plus `CHILD_ARGV_CAP` if it was there). Then replace:

```ts
  clearRefusedDetail,
  holdReasonVerdict,
  queueSystemMail,
```

with:

```ts
  clearRefusedDetail,
  holdReasonVerdict,
  queueSystemMail,
  releaseIsSafe,
```

and after `import { readSkillState, skillDirFor } from '../skillstate.js';` add:

```ts
import { childBindGate, type ChildBindVerdict } from './childBind.js';
```

(b) `DispatchOutcome` — replace its last member:

```ts
  | { ok: false; kind: 'advanceFailed'; adv: Extract<AdvanceResult, { ok: false }> };
```

with:

```ts
  | { ok: false; kind: 'advanceFailed'; adv: Extract<AdvanceResult, { ok: false }> }
  /** Rule 3 at dispatch (child-reclamation spec §5.4): the resumed session is
   *  a CHILD whose branch has had a PR since this run was opened
   *  (`workspace-spent`, `pr` naming it), or whose evidence could not be read
   *  (`spent-unmeasured`, `detail` saying which). Its own member rather than a
   *  `refused` code because it is the one refusal on this union that may
   *  CHANGE something: on `workspace-spent` the spent child's claim is
   *  released — or handed to a surviving sibling — and the run is unbound, and
   *  `unbound` says whether that happened. `true`: dispatch again and a fresh
   *  child is minted. `false`: nothing changed (`detail` says why) and the
   *  same dispatch may be retried. `spent-unmeasured` never unbinds — unknown
   *  is not spent. `pr` and `detail` distinguish by PRESENCE. */
  | { ok: false; kind: 'childSpent'; code: 'workspace-spent' | 'spent-unmeasured'; pr?: number; detail?: string; unbound: boolean };
```

(c) Directly after `capsMeasured`'s closing `}`, insert the refusal. Its three parameter/return types are ALIASES on purpose, not a style choice: `verb-gate.test.ts` finds a call site's enclosing function by reading the line that opens its body, and a wrapped signature whose closing line carries a `{` inside a type (`Promise<Extract<…, { kind: … }>> {`) is not recognised as one — the site would resolve `scope: null`, which that suite reds on as a scanner failure.

```ts

/** The `DispatchOutcome` member `refuseSpentChild` answers, and its inputs —
 *  named so its signature carries no braces (see the note above). */
type ChildSpentOutcome = Extract<DispatchOutcome, { kind: 'childSpent' }>;
type ChildBindRefusal = Extract<ChildBindVerdict, { ok: false }>;
interface RunBinding { id: number; sessionId: string }

/**
 * The resume arm refusing a CHILD it may not bind (child-reclamation spec
 * §5.4). Spentness can turn true between open and dispatch — the previous
 * wave's worker opens its PR after this wave was opened on its workspace — so
 * this refusal cannot merely fail: a refusal with no automated exit would need
 * a human, which rule 4 forbids.
 *
 * `spent-unmeasured` touches nothing and keeps the binding: unknown is not
 * spent, and the retry re-asks. `workspace-spent` runs the FLEET ACT FIRST
 * (D-48's order: a failed act leaves the run retryable, never half-unbound),
 * then `clearSession`:
 *   - RELEASE ONLY WHEN NOTHING ELSE CLAIMS IT — `closeRun`'s abandon arm,
 *     reached from a second door. If another open run still names this
 *     workspace (a coordinator that dispatched N+1 before closing N), a
 *     release would drop that live run's claim; the claim is HANDED OVER
 *     instead, re-held with the surviving run's own reason.
 *   - An unreadable sibling list, an invalid survivor hold, a ccd that lacks
 *     the verb, or a failed act answers `unbound: false` and changes nothing.
 *   - The act spends `dispatchDec` — this lane undoing its own open-time
 *     claim, under the same actor — never a second `sweepDec` label.
 * A crash between the act and `clearSession` leaves a released run still
 * bound; the next dispatch re-asks the gate, re-releases (idempotent) and
 * unbinds.
 */
async function refuseSpentChild(
  deps: DispatchRunDeps, run: RunBinding, gate: ChildBindRefusal, dispatchDec: ActorFlags | null,
): Promise<ChildSpentOutcome> {
  if (gate.code === 'spent-unmeasured') {
    return { ok: false, kind: 'childSpent', code: 'spent-unmeasured', detail: gate.detail, unbound: false };
  }
  const pr = gate.pr;
  const keep = (detail: string): ChildSpentOutcome =>
    ({ ok: false, kind: 'childSpent', code: 'workspace-spent', pr, detail, unbound: false });
  const sibRead = deps.coord.openRunsForSession(run.sessionId, run.id);
  if (!sibRead.ok) return keep(`the other runs naming this workspace could not be read: ${sibRead.detail}`);
  const survivor = sibRead.siblings[sibRead.siblings.length - 1] ?? null;
  let handoff: HoldReasonVerdict | null = null;
  if (!releaseIsSafe(sibRead.siblings) && survivor !== null) {
    handoff = holdReasonVerdict(survivor.program, survivor.wave, survivor.waveOf, survivor.id);
    if (!handoff.ok) return keep(`the surviving run's claim cannot be written: ${handoff.detail}`);
  }
  const argv = handoff !== null && handoff.ok
    ? CCD_ARGV.wsHold(run.sessionId, handoff.reason, dispatchDec)
    : CCD_ARGV.wsRelease(run.sessionId, dispatchDec);
  if (!verbSupported(deps.fleetState, argv)) return keep(`this box's ccd does not support ${argv[0]}`);
  const res = await deps.runCcd(argv);
  if (!res.ok) return keep(`${argv[0]} failed: ${res.stderr.trim()}`);
  const cleared = deps.coord.clearSession(run.id, pr);
  return { ok: false, kind: 'childSpent', code: 'workspace-spent', pr, unbound: cleared.cleared };
}
```

(d) The resume arm — replace:

```ts
    sessionId = run.sessionId;
    const argv = CCD_ARGV.ensure(sessionId);
```

with:

```ts
    sessionId = run.sessionId;
    // Rule 3's dispatch half (child-reclamation spec §5.4) — BEFORE `ensure`,
    // so a spent child is never resumed, and ahead of every other resume-arm
    // read. The open route asked the same gate, but spentness can turn true
    // between open and dispatch. A workspace with no marker passes untouched —
    // every workspace wave 1 did not mint.
    const childGate = await childBindGate(deps, sessionId);
    if (!childGate.ok) return refuseSpentChild(deps, { id: run.id, sessionId }, childGate, dispatchDec);
    const argv = CCD_ARGV.ensure(sessionId);
```

(e) Two comments stop being true; correct them. The `dispatchDec` block — replace:

```ts
  // regression is a deploy-window event — but it is a staleness, not the
  // absence of one.
  const dispatchDec = sweepDec(deps.fleetState, `run:${run.id} dispatch`);
```

with:

```ts
  // regression is a deploy-window event — but it is a staleness, not the
  // absence of one.
  //
  // AND A THIRD SPEND, on a refusal path only (child-reclamation wave 2):
  // `refuseSpentChild` releases — or hands to a surviving sibling — the claim
  // THIS lane's open placed on a spent child, under the same actor, because
  // it is this lane undoing its own hold rather than a new act by a new one.
  const dispatchDec = sweepDec(deps.fleetState, `run:${run.id} dispatch`);
```

and the R7 block — replace:

```ts
  // resume arm's own preconditions; `unattended-actor.test.ts`'s own
  // call-site count pins `CCD_ARGV.wsHold` to exactly one occurrence in this
  // file, so the fix is the `/clear` relocating to meet the hold, not a
  // second hold call meeting the `/clear`.
```

with:

```ts
  // resume arm's own preconditions. This is the ONE hold that claims the
  // workspace for THIS run: the `wsHold` in `refuseSpentChild` hands a spent
  // child's claim to a SURVIVING sibling, on a path that returns before
  // `ensure` and never reaches a `/clear`. `unattended-actor.test.ts` pins
  // every such call site by its surrounding text, so the fix is still the
  // `/clear` relocating to meet this hold, not a second hold meeting the
  // `/clear`.
```

(f) In `server/test/dispatch-hold-order.test.ts`, replace:

```ts
    // thing: `unattended-actor.test.ts` already pins this file to exactly one
    // `CCD_ARGV.wsHold` occurrence, so this spelling cannot become ambiguous.
```

with:

```ts
    // thing: `const holdArgv =` names the step-5 hold and nothing else — the
    // spent-child hand-over in `refuseSpentChild` is `const argv` — so this
    // spelling cannot become ambiguous.
```

- [ ] **Step 4: The route's arm**

In `server/src/coord/routes.ts`'s `sendDispatchOutcome`, insert the new arm directly after its `registry-unmeasurable` arm. The two lines `case 'unsupported': …` / `case 'fleetFailed': …` appear TWICE in this file — once here and once in `sendCloseOutcome`, whose `CloseOutcome` has no `childSpent` member — so the anchor carries the `registry-unmeasurable` arm's closing lines, which only `sendDispatchOutcome` has. Replace:

```ts
        ...(r.stderr === undefined ? {} : { stderr: r.stderr }),
      });
    case 'unsupported': return reply.code(501).send({ ok: false, error: 'unsupported' });
    case 'fleetFailed': return reply.code(502).send({ ok: false, stderr: r.stderr });
```

with:

```ts
        ...(r.stderr === undefined ? {} : { stderr: r.stderr }),
      });
    // Rule 3 at dispatch. `pr`/`detail` spread by PRESENCE (an L4 adapter may
    // not narrow a distinction it received); `unbound` unconditionally — it is
    // the answer to "what do I do next", and absent would read as `false`.
    // `child-reclaim-refusals.test.ts` harvests this arm's fields and requires
    // each in `wave-lifecycle.md` §2.
    case 'childSpent':
      return reply.code(409).send({ ok: false, refused: r.code,
        ...(r.pr === undefined ? {} : { pr: r.pr }),
        ...(r.detail === undefined ? {} : { detail: r.detail }),
        unbound: r.unbound });
    case 'unsupported': return reply.code(501).send({ ok: false, error: 'unsupported' });
    case 'fleetFailed': return reply.code(502).send({ ok: false, stderr: r.stderr });
```

- [ ] **Step 5: The prose**

(a) `wave-lifecycle.md` §2's refusal table — directly after the `| \`project-mismatch\` | wave ≥ 2's session has a registry row whose …` row, insert:

```
| `workspace-spent` | wave ≥ 2's session is a CHILD whose branch has had a PR since this run was opened — usually the previous wave's worker opened it after you opened this wave on its workspace; `pr` names it. The body also carries `unbound`, and `detail` whenever `unbound` is `false` | `unbound:true`: the server has already released the workspace (or handed its claim to the other run still open on it), cleared this run's `sessionId` and left the run `planned` — dispatch it again, unchanged, and a fresh child is minted. `unbound:false`: that release did not happen and nothing changed (`detail` says why) — retry the same dispatch. Either way nothing was resumed and no `/clear` was sent |
| `spent-unmeasured` | wave ≥ 2's session may be a spent child and the evidence could not be read; `detail` says which read failed. An UNLISTABLE registry (`detail` `the registry could not be listed`) answers this for ANY session, marked or not — where a resume used to answer `error: 'registry-unmeasurable'` — because without the listing the server cannot tell a child from any other workspace. `unbound` is always `false` | retry the same dispatch: the binding is kept, nothing was resumed and no `/clear` was sent. It is not `workspace-spent`. If it repeats, stop and report |
```

(b) §5's one-PR paragraph (Task 5) — replace its last lines:

```
   nothing is opened; `spent-unmeasured` means the server could not read the
   evidence either way — retry the same open, and do not drop `sessionId` on
   its account.
```

with:

```
   nothing is opened; `spent-unmeasured` means the server could not read the
   evidence either way — retry the same open, and do not drop `sessionId` on
   its account. If the PR lands after you opened wave N+1 on the workspace, the
   DISPATCH refuses `workspace-spent` instead (§2); with `unbound:true` it has
   already released the workspace and unbound the run — dispatch it again and
   a fresh child is minted.
```

- [ ] **Step 6: Two pinned counts move — the unattended call sites and the readdir counters**

(a) `server/test/unattended-actor.test.ts` counts every `CCD_ARGV.wsArchive|wsRestore|wsHold|wsRelease|wsRename(` line across four files and requires the count to equal `SITES.length` exactly; this task adds two. Append to `SITES`, directly before its closing `];`:

```ts
  // child-reclamation wave 2: `refuseSpentChild`'s two arms — the hand-over to
  // a surviving sibling and the release — spend the hoisted `dispatchDec`
  // above rather than typing a label, so the capture is the VARIABLE: a
  // second `sweepDec(…)` here would be a second clock for one act, which is
  // what the hoist exists to prevent.
  { file: 'coord/dispatch.ts', what: 'refuseSpentChild — hand a spent child\'s claim to a surviving sibling',
    find: /\? CCD_ARGV\.wsHold\(run\.sessionId, handoff\.reason, (dispatchDec)\)/,
    label: 'dispatchDec' },
  { file: 'coord/dispatch.ts', what: 'refuseSpentChild — release a spent child nothing else claims',
    find: /: CCD_ARGV\.wsRelease\(run\.sessionId, (dispatchDec)\);/,
    label: 'dispatchDec' },
```

and replace the count case's title and opening comment:

```ts
  it('found EXACTLY the eleven pinned call sites — not a floor, an exact count (fix round 2, F5b)', () => {
```

with:

```ts
  it('found EXACTLY the thirteen pinned call sites — not a floor, an exact count (fix round 2, F5b)', () => {
```

and, in the same case's comment, replace:

```ts
    // `coord/close.ts`, both new entries in `SITES` below.
```

with:

```ts
    // `coord/close.ts`, both new entries in `SITES` below. Eleven became
    // thirteen with child-reclamation wave 2's `refuseSpentChild`
    // (`coord/dispatch.ts`): a hand-over and a release, both spending
    // `dispatchDec`.
```

and the `SITES` docstring's first line — replace ` * Eleven sites, five distinct labels, each site identified by the code AROUND` with ` * Thirteen sites — five distinct labels, plus two that spend \`dispatchRun\`'s hoisted \`dispatchDec\` — each identified by the code AROUND`.

(b) `run-routes.test.ts`'s two readdir counters move again, 3 → 4 — dispatch's own gate lists the registry once, ahead of `ensure`. Left at 3, the failing read becomes dispatch's gate and both cases answer `409 spent-unmeasured` — `expected 409 to be 502`. In the first (its comment opens `// Succeeds on the open's child bind gate (call 1`, Task 5 Step 8(a)), replace:

```ts
    // Succeeds on the open's child bind gate (call 1 — child-reclamation
    // wave 2: `readSessionRecord` lists the registry once) and on the
    // pause-marker's own read (call 2), fails on the very next one — this
    // route's own registry read for the resumed session (call 3) — never a
    // fourth: nothing else touches `io.readdir` before those. `POST /api/runs`'
```

with:

```ts
    // Succeeds on the open's child bind gate (call 1 — child-reclamation
    // wave 2: `readSessionRecord` lists the registry once), on the
    // pause-marker's own read (call 2) and on dispatch's own child bind gate
    // (call 3, ahead of `ensure`), fails on the very next one — this route's
    // own registry read for the resumed session (call 4) — never a fifth:
    // nothing else touches `io.readdir` before those. `POST /api/runs`'
```

and, in the same case, `return n === 3 ? null : localIO.readdir(p);` becomes `return n === 4 ? null : localIO.readdir(p);`. Its assertion that `ensure` already ran stays true: the failing listing is the one AFTER `ensure`. In the second (*still answers registry-unmeasurable when the registry cannot be listed at all*), replace:

```ts
    // gate DOES (child-reclamation wave 2: `readSessionRecord` lists the
    // registry once), so the resumed session's own listing is the THIRD.
    let n = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { n += 1; return n === 3 ? null : localIO.readdir(p); } };
```

with:

```ts
    // gate DOES (child-reclamation wave 2: `readSessionRecord` lists the
    // registry once), and so does dispatch's own gate, ahead of `ensure` —
    // the open's gate, dispatch's pause check, dispatch's gate — so the
    // resumed session's own listing is the FOURTH.
    let n = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { n += 1; return n === 4 ? null : localIO.readdir(p); } };
```

- [ ] **Step 7: Run the task's suites**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-refusals.test.ts test/unattended-actor.test.ts \
  test/dispatch-hold-order.test.ts test/verb-gate.test.ts test/run-routes.test.ts test/dispatch-route.test.ts \
  test/dispatch-mutex-gate.test.ts test/coord-abandon.test.ts test/coordinator-skill.test.ts \
  test/mail-routes.test.ts test/single-definition.test.ts test/whitelist-subset.test.ts test/typecheck-tests.test.ts
```

Expected: PASS everywhere. `unattended-actor` finds thirteen sites and captures `dispatchDec` at both new ones; `verb-gate` finds both new call sites gated (`verbSupported` is in `refuseSpentChild`'s own scope); `whitelist-subset` confirms no new argv shape reached the agent; `single-definition` confirms `dispatch.ts` still never names `coord.db` (the unbind is the store's).

- [ ] **Step 8: Mutation check, then commit**

Command for every row: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-refusals.test.ts test/unattended-actor.test.ts`.

| # | Mutation (exact edit) | Expected red |
|---|---|---|
| 1 | In `refuseSpentChild`, replace `deps.coord.clearSession(run.id, pr)` with `({ ok: true as const, cleared: false })` | *refuses before ensure, releases …*: `unbound: false` where `true` is expected, and `sessionId` is still `demo-child` |
| 2 | Move `const cleared = deps.coord.clearSession(run.id, pr);` to directly above `const sibRead = …` (unbind before the fleet act) | *a failed release changes nothing*: `sessionId` is `null` where `demo-child` is expected — D-48's order is the guard |
| 3 | Replace the two-armed `const argv = …` with `const argv = CCD_ARGV.wsRelease(run.sessionId, dispatchDec);` | *a sibling still open … HANDED OVER*: `a release would drop the live sibling's claim`; and `unattended-actor`'s count: `the unattended call-site count drifted from SITES.length (13)` |
| 4 | Delete the whole `if (gate.code === 'spent-unmeasured') { … }` block (vitest strips types; `gate.pr` is then `undefined`) | *spent-unmeasured at dispatch keeps the binding*: the body is `refused: 'workspace-spent'`, `ws-release` was sent, `sessionId` is `null` |
| 5 | Move the two `childGate` lines to directly after `if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };` (after `ensure`) | *refuses before ensure …*: `a spent child was resumed` |
| 6 | Replace `unbound: r.unbound });` in `sendDispatchOutcome` with ` });` | *refuses before ensure …* (`toEqual` lacks `unbound`) and the harvest: `expected [ 'detail', 'pr' ] to deeply equal [ 'detail', 'pr', 'unbound' ]` |
| 7 | In `refuseSpentChild`, replace `: CCD_ARGV.wsRelease(run.sessionId, dispatchDec);` with ``: CCD_ARGV.wsRelease(run.sessionId, sweepDec(deps.fleetState, `run:${run.id} unbind`));`` | `unattended-actor`: *refuseSpentChild — release … declares exactly its own label*: `the anchor for this site was not found` |
| 8 | In `wave-lifecycle.md`, remove every `` `unbound` `` token from the two new §2 rows (leave the rows otherwise intact) | the harvest: ``§2's rows never name `unbound` `` |
| 9 | In `refuseSpentChild`, delete the line `if (!verbSupported(deps.fleetState, argv)) return keep(\`this box's ccd does not support ${argv[0]}\`);` | *a box whose ccd does not advertise ws-release changes nothing*: `ws-release` is sent, and the body is `unbound: true` with no `detail` where `detail: 'this box\'s ccd does not support ws-release', unbound: false` is expected; `sessionId` is `null` where `demo-child` is expected |
| 10 | Make an unreadable sibling list read as "no sibling" — the fail-open this guard exists to stop: delete the line `if (!sibRead.ok) return keep(\`the other runs naming this workspace could not be read: ${sibRead.detail}\`);` and replace every remaining `sibRead.siblings` in `refuseSpentChild` (three) with `(sibRead.ok ? sibRead.siblings : [])` | *an UNREADABLE sibling list refuses before any fleet act*: `ws-release` is sent, `unbound: true` where `false` is expected, `sessionId` is `null` |
| 11 | Delete the line `if (!handoff.ok) return keep(\`the surviving run's claim cannot be written: ${handoff.detail}\`);` | *an INVALID survivor hold refuses before any fleet act*: with `handoff.ok` false the argv falls to `wsRelease` — `ws-release` is sent, `unbound: true` where `false` is expected, and the detail is absent |

```bash
git add server/src/coord/dispatch.ts server/src/coord/routes.ts ccd/coordinator-skill/references/wave-lifecycle.md \
  server/test/child-reclaim-refusals.test.ts server/test/unattended-actor.test.ts \
  server/test/dispatch-hold-order.test.ts server/test/run-routes.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): rule 3 at dispatch — refuse before ensure, release, unbind

The resume arm asks childBindGate before ensure. spent-unmeasured keeps
the binding and sends nothing. workspace-spent runs the fleet act first —
ws-release, or a hand-over to a sibling run still open on the workspace,
never a release that drops a live claim — then clearSession, and answers
409 with unbound. unbound:true leaves the run planned with no session, so
the next dispatch mints a fresh child with no human in the path. The
unattended call-site census moves 11 to 13. Spec §5.4.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Whole-branch verification, deploy order, PR

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified — this task runs, reports and opens the PR.

**Interfaces:**
- Consumes: everything Tasks 1–6 produced.
- Produces: the wave-2 PR on this workspace's own branch. Wave 3 consumes `ChildMark`, `SessionRecord.child`, `childSpent`/`ChildSpentVerdict`/`ChildSpentDeps` and `CoordStore` as this wave leaves them; wave 5 consumes `FleetSession.child`. Nothing here needs a fleet-box change to be correct.

- [ ] **Step 1: Run all three package suites, in the foreground**

```bash
(cd server && npm ci && npm run test)
(cd agent  && npm ci && npm run test)
(cd pwa    && npm ci && npm run test)
```

Expected: PASS in all three (timeout ≥600000 ms each, foreground). `agent` is untouched by this wave and must be green unchanged; `pwa`'s only change is Task 2's 27 fixture lines. If the box kills the whole server suite for memory, run it as four foreground shards instead — `./node_modules/.bin/vitest run --shard=1/4` through `--shard=4/4` from `server/` — and require all four green. Re-run `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state` and `ccd-bounded-reads` IN ISOLATION before calling any of them a real break.

- [ ] **Step 2: Cross-tree deviation check, and the plan's own blob**

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts
```

Expected: PASS. `deviation-refs` compares this branch's `D-N` entries against `origin/main`'s without merging; `dtbd` proves no concrete placeholder token was written; `topology-clean` scans every blob this range introduces, this plan included.

- [ ] **Step 3: The wave's own surface in one run**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-mark.test.ts test/child-reclaim-store.test.ts \
  test/child-reclaim-spent.test.ts test/child-reclaim-bind.test.ts test/child-reclaim-refusals.test.ts \
  test/registry.test.ts test/coord-store.test.ts test/unattended-actor.test.ts test/coordinator-skill.test.ts \
  test/mail-routes.test.ts test/verb-gate.test.ts test/single-definition.test.ts test/run-routes.test.ts \
  test/session-hook.test.ts
```

Expected: PASS.

- [ ] **Step 4: Check the commit authors, then push and open the PR**

```bash
git log --format='%an <%ae>' origin/main..HEAD | sort -u
```

Expected: one line, the identity this workspace commits as. If it is a placeholder identity, STOP and report it — do not rewrite history to fix it; the pre-push hook refuses identity residue either way.

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Child reclamation wave 2: the spent refusals (rule 3, server)" --body-file - <<'EOF'
Wave 2 of the child-reclamation programme (CCR-15), **server only**.
Spec: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` §5.1, §5.3, §5.4.
Plan: `docs/superpowers/plans/2026-09-22-child-reclamation-wave2-spent-refusals.md`.

**Rule 3 is enforced at the end of this wave, with no destructive verb in existence:** a CHILD
workspace — one `$REG/<id>.child` marks as minted for a run — whose branch has ever had a PR can
never be bound to a second run.

1. **`ChildMark` / `SessionRecord.child` / `FleetSession.child`** — the registry's reading of the
   marker, three answers and never a boolean: `none`, `child` with the minting run id, or
   `unreadable` (listed but unreadable, or outside ccd's ten-digit run-id grammar). Measured reader with the
   listing rung; additive on the wire (an older snapshot revives `none`; malformed rejects the
   session). The registry-read census moves 30/31/721 → 31/32/745 by derivation.
2. **`childSpent`** — `spent` / `unspent` / `unmeasured`: the registry's PR number (present is
   evidence, null is not), `.prhistory` through its measured reader, then a live
   `ccd pr-state --session`. Every failure is `unmeasured`, never `unspent`.
3. **`childBindGate`** — the one gate both doors call. A workspace with no marker binds exactly as
   today, even one that has had a PR.
4. **The two refusals.** `POST /api/runs` answers `409 workspace-spent` (`pr`) or
   `409 spent-unmeasured` (`detail`) before any row or hold exists. Dispatch's resume arm asks the
   same gate before `ensure`: `spent-unmeasured` keeps the binding; `workspace-spent` releases the
   spent child's claim (or hands it to a sibling run still open on it), unbinds the run through
   `CoordStore.clearSession`, and answers `unbound:true` — the next dispatch mints a fresh child.
   An unlistable registry answers `spent-unmeasured` for any `sessionId` — the one change to the
   non-child path, fail-shut and retryable.

Four departures from the programme contract's first text were ruled ACCEPTED before dispatch
(contract ruling R3): `clearSession` takes the PR so its one transaction writes the whole event;
a `planned` run already unbound answers `cleared:false` and writes nothing; the dispatch arm
releases only when nothing else claims the child, else hands the claim to the surviving run; and
an unlistable registry, or a listed marker with no built row, refuses `spent-unmeasured`. The
marker's run id is ccd's own grammar, `^[1-9][0-9]{0,9}$` (ruling R2) — an eleven-digit marker
is unreadable.
5. **The coordinator's prose** — SKILL.md's refusal list and step 6, `wave-lifecycle.md` §1/§2/§5 —
   rewritten for one PR per child.

Moved censuses: registry-read and `readSessionRecord`'s field-read count, now derived (Task 1); the
store's one-writer scan over `runs.sessionId` (Task 3, now naming the unbind); the unattended
call-site count 11 → 13 (Task 6); README's four `shared/api.ts` anchors, re-pointed by content, and
`session-hook.test.ts`'s citation-debt census, re-measured — in each of Tasks 1, 2 and 5, the task
that inserted into `shared/api.ts` (S6-R11), so every commit is green.

**Deploy:** server class. No ccd or agent change; the skill prose reaches coordinator homes through
the fleet box's `ccrc update`, which `ccrc rollout`'s default order runs first. Does nothing to a
workspace without a marker, which is every workspace until wave 1 is deployed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Report the wave done**

Report to the coordinator (worker skill): the branch tip sha, the three suites' results (and which load flakes, if any, needed an isolated re-run), the PR number, the three citation-tax measurements (Tasks 1, 2 and 5: README's old → new anchors and the `'shared/api.ts'` census entry's old → new value, each read off that task's own run), and every departure from this plan's text with its evidence — the coordinator assigns numbers from the programme's block (worker clause 11: this session never calls the allocator). The four Contract reconciliation items are NOT departures to report: contract ruling R3 accepted them, and the plan builds them as ruled.

- [ ] **Step 6: Deploy — the coordinator's act, after the review run rules clean and the PR merges**

A merge to `main` becomes a GitHub **prerelease** within about a minute (`release-main.yml`). Pin the rollout to the release the merge produced, never to `latest` (which is the newest STABLE):

From a checkout of this workspace's branch, on a machine with ssh to both boxes:

```bash
MERGE=$(gh pr view "$(git rev-parse --abbrev-ref HEAD)" --json mergeCommit --jq .mergeCommit.oid)
git fetch origin --tags
TAG=$(gh release list --limit 10 --json tagName --jq '.[].tagName' \
  | while read -r t; do [ "$(git rev-list -n1 "$t")" = "$MERGE" ] && echo "$t" && break; done)
echo "$TAG"
ccrc rollout --to "$TAG" --check
ccrc rollout --to "$TAG"
```

Expected: `$TAG` prints one `vX.Y.Z`; `--check` reports both boxes and the version they would move to; the rollout moves the fleet box first, then the server box, and exits 0 (exit 3 means a box IS on the new build and its doctor has FAIL lines — report them; it is not a failed install). Default order is the right one here: the fleet box's install spine carries the two skill files to every rostered home before the server can send either refusal.

- [ ] **Step 7: The measurement this wave is judged by**

Spec §8: "a second bind on a PR-bearing child refuses, an unreadable marker refuses, a research child still hands over." The suite measures all three. On the live fleet the first becomes measurable only once wave 1 is deployed and a marked child has opened a PR — which this programme itself produces at its next boundary: when this wave's PR is merged and the coordinator opens wave 3, an open naming THIS workspace's id as `sessionId` must answer `409 {"ok":false,"refused":"workspace-spent","pr":<this wave's PR>}` if this workspace carries a marker, and must leave no run row behind. The coordinator records that answer (or "this workspace predates wave 1's deploy and carries no marker — not measurable here") in the ledger when it closes this wave, then opens wave 3 without `sessionId` as the programme already does.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated once, by its coordinator, at run-open; every wave draws from it. **A worker never calls the allocator** (worker clause 11): a departure from this plan found while executing it goes into the wave-done mail with its evidence, and the coordinator assigns it a number from the block and defines it here. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and says so.

No entry is defined below at drafting time. The six contract reconciliations above are settled: items 1, 2, 4 and 6 were ruled ACCEPTED by the contract's owner on 2026-09-23 (R3, R18) and amend contract §2 in place; items 3 and 5 needed no ruling. None is an entry this plan may define — if the coordinator numbers them, it does so from the programme's block and defines them here itself. Nothing gates dispatch.

---

## Review lenses

Three lenses for this wave, all `opus`. It destroys nothing, so the programme's mandatory safety lens belongs to wave 3; the first lens here is this wave's equivalent — the direction every unknown fails.

1. **Fail-shut direction (opus, xhigh).** Every path that cannot read the evidence must REFUSE a bind, never permit one: the marker's listing rung (unreadable-and-listed → `unreadable`; failed-and-unlisted → `none`, and why that is safe on an older agent), malformed content — judged by `CHILD_RUN_ID`, which must be ccd's `_child_runid_valid` set EXACTLY (ruling R2: `^[1-9][0-9]{0,9}$`, ASCII, over the `'shell'` read's bytes — NUL dropped, trailing newlines stripped, nothing else trimmed; compare it against wave 1's function, and confirm no server path parses a marker through `parseCanonicalPositiveSafeInteger`, and that `reviveChildMark` holds a persisted `runId` to the same set) — an unlistable registry, a MARKED row `readSessionRecord` answers `absent` for because `buildRecord` dropped it (the gate's second listing), an unreadable `.prhistory`, every live `pr-state` answer that is not a bound PR or gh's positive "none" — `branch-drift`, the whole-repo `no-remote` shape `--session` can emit (`ccd/ccd`, `cmd_pr_state`'s `_gh_repo_slug` failure), `merge-unproven`, a foreign line, a failed call, an unsupported verb. And the opposite direction, which is also the spec's: a workspace with no marker is untouched, even one that has had a PR — with the one exception contract ruling R3 (4) ACCEPTED, an unlistable registry (409 `spent-unmeasured` where the open used to 200, and where dispatch used to 502). Its acceptance was for a fail-shut, retryable refusal: verify the code costs exactly that and no more — no row, no hold, no fleet act, the binding kept, and no path where a non-child with a listable registry is refused. Re-derive each from the code, not from this plan's comments.
2. **The dispatch refusal as a write path (opus, high).** It is the first refusal on `DispatchOutcome` that changes the world. Check: the fleet act precedes the unbind (D-48); the sibling hand-over reproduces `closeRun`'s abandon arm and never releases a claim a live run holds; `clearSession` is one transaction, `planned`-guarded, and the one-writer scan's new UNBIND regex cannot admit a re-bind; `coordMutex` still serialises every step; a crash between release and unbind self-heals on the next dispatch; the stated mail gap (worker mail sent to the spent child is not re-issued to the fresh one) is real and bounded as stated.
3. **Wire, censuses and the coordinator's contract (opus, high).** `FleetSession.child` is additive with one reader and rejects malformed values; every moved census moved by its derivation (the registry-read triple read off the red, the rewrite script's regex identical to the test's); the citation tax was paid in EACH of Tasks 1, 2 and 5's own commits (ruling R9) — check `session-hook.test.ts` green at each of those three commits, not only at the tip, and README's anchors re-pointed by the one-pass content map, never by arithmetic; the unattended-actor captures pin the hoisted `dispatchDec`; and the prose tells a coordinator exactly what each 409 means and what to do next — cross-check `wave-lifecycle.md` §1, §2 and §5 against the two routes' actual bodies, and SKILL.md step 6 against §5, as a coordinator that reads only those would.
