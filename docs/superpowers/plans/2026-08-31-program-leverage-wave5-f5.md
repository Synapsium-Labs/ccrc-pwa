# program-leverage wave 5 — F5: coordinator resume — the reclaim door and the PWA affordance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a program whose coordinator has died a way back. Today `claimedBy` is written once by
`openRun`'s INSERT and rewritten by nothing, so a dead coordinator whose id cannot be re-landed wedges
its program `claimed-by-another` for ever and the only escape is a hand-run reconstruct drill. This
wave adds the operator's door — `POST /api/runs/:id/reclaim`, the FOURTH ungated door — and the /runs
board affordance that walks an operator through revive, re-kickoff and, last, reclaim.

**Architecture:** One L0 vocabulary block (a sixth refusal union with its own guard, a wave-aware
kickoff composer, and the `claimedBy` docstring that stops asserting the opposite of this wave), one
L1 decision file (`server/src/coord/reclaim.ts` — the dead-proof guard, three answers, no handle),
one `CoordStore` method holding the single transaction, one thin L4 door in `coord/routes.ts` that
decides nothing, a widened kickoff seam that composes a wave-N brief instead of a wave-1 one, and a
PWA that measures the coordinator three ways and hides the door on doubt.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), Node >= 22.13.0, vitest, fastify (L4 only),
`node:sqlite` via `CoordStore` (L3 only), React (PWA). Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-program-leverage-design.md` §7, with the operator rulings
in §11 and the two taken during this wave's planning (below). On `origin/ws/brisk-meadow` — fetch that
ref; it is not on `main`. Program ledger: `docs/superpowers/programs/program-leverage.md`, same ref.
Run 18, wave 5 of 8.

---

## Two operator rulings taken before this plan was written

Both came from measurements that defeated the spec as written. Both are settled; neither is open.

### R1 — the rewrite covers ALL of the program's runs, terminal included

Spec §7.1 and the brief both say the door "rewrites `claimedBy` on the program's non-terminal runs".
**Measured: that does not lift the wedge.** The two readers that decide who owns a program run the
identical query, with no state predicate and lowest-id-first:

| reader | line | query |
|---|---|---|
| `openRun`'s one-coordinator guard | `server/src/coord/store.ts:369-371` | `SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id LIMIT 1` |
| `resolveCoordinator(null)` | `server/src/coord/store.ts:1188-1191` | the same query, and its own docstring says it "mirrors `openRun`'s own one-coordinator guard query … rather than re-deriving a different rule for the same fact" |

At wave 5 this program's wave-1 run is `done` and holds the lowest id. A non-terminal-only rewrite
therefore leaves both readers answering the dead session: `POST /api/runs` for wave 6 still refuses
`claimed-by-another` naming the corpse, and every `toId:'coordinator'` mail carrying no `runId` still
resolves to it. The door would answer `ok` and the program would stay wedged at exactly the boundary
it was wedged at before.

**Ruling: rewrite every run of the program, terminal rows included, in one transaction, with one
`run_events` attribution row per rewritten run.** Per-wave attribution history moves from the column
into the event trail, which is what the trail is for. Rows whose `claimedBy` is already NULL stay NULL
— `openRun`'s D-12 clause skips them deliberately, and a reconstructed program is meant to be
claimable by whoever opens its next wave.

The rejected alternative — keeping the brief's scope and adding a state predicate to those two queries
— was measured worse, not merely different: between closing wave N and opening wave N+1 a program has
zero non-terminal runs, so `resolveCoordinator(null)` would answer `null` and runId-less coordinator
mail would stop resolving in exactly the window the ledger's own ordering rule ("open wave N+1's run
BEFORE closing wave N's") already treats as dangerous.

### R2 — the coordinator corpus is corrected here, so this wave is AGENT-FIRST

The shipped corpus asserts the opposite of this door, in three places:

- `ccd/coordinator-skill/references/resume.md:38-39` — *"The refusal is PERMANENT: it does not lapse
  when the named session dies, and nothing in the HTTP API ever rewrites `claimedBy`. A fresh
  coordinator under a new id can never take the program over through the API at all."*
- `ccd/coordinator-skill/references/resume.md:110` — *"no sequence of API calls fixes it"*.
- `ccd/coordinator-skill/SKILL.md:31` — the same sentence, unpinned but read by every coordinator.

`server/test/coordinator-skill.test.ts:1053` pins the first one **verbatim**, and because that pin
asserts a PRESENCE, the suite stays green while the runbook tells every revived coordinator its
program is unrecoverable — standing in front of the one door built for it.

**Ruling: correct the corpus in this wave.** That puts `ccd/coordinator-skill/` in the diff, so per
root `CLAUDE.md` this wave's deploy is **AGENT-FIRST** — the fleet host before the server — against
the brief's "NOT agent-first" and against the ledger's "Waves 1 and 8 are AGENT-FIRST" carried
constraint, which becomes waves 1, 5 and 8. Nothing else under `ccd/` is touched: no `ccd/ccd`, no
`session-hook.sh`, no `ccrc-api`, no worker corpus. Two markdown files and the one test string that
pins one of them.

---

## Global Constraints

- **Commit on `ws/quiet-meadow`, this workspace's own branch — never a separate feature branch.** The
  done-fingerprint re-measures this branch's tip; work parked elsewhere wedges the close `stale-tip`
  for ever.
- **TDD red-first, mutation-table discipline. Write each pin BEFORE the code or prose it pins**
  (wave 1's D-1009). Every step that adds a guard is preceded by a step that measures it RED with the
  **exact first failing assertion recorded verbatim** — the bar wave 3's review set and wave 4's fix
  round met. **Count the table twice**: wave 3's totals were off by one, and wave 4's record repeated
  the lesson.
- **Every "behaviour unchanged" claim needs a fixture that could witness the change.** Wave 2's sweep
  lesson, wave 3's `.ccrc`-less token path, wave 4's D-1122: *a fixture that cannot reproduce the
  topology proves nothing, and an absence assertion whose fixture cannot produce the presence measures
  nothing.* This wave changes `queueProgramKickoff`, `recordRunEvent` and `StartProgramSheet` — three
  shipped readers with live callers — and may not claim any of them unaffected without such a fixture.
- **No overloaded null at any new seam.** Specifically: `unmeasurable`, `alive` and `dead` are three
  answers and never two, on the server AND in the client; `queued:true` and `queued:false` are two
  answers the PWA must render differently; `openRunProjects === null` (not measured) is never folded
  into "no open run"; `registry-unmeasurable` never proceeds.
- **Wire discipline: additive only.** Two optional body fields on an existing route, one new route.
  **Do not bump `FLEET_PROTO`** (=1, `shared/api.ts`). One reader per new field; absence permits.
- **Zero new ccd verbs.** `EXEC_COMMANDS` is untouched. Nothing in this wave shells out except the
  tmux verdict the guard already had a port for.
- **No `ccrc-api` row for this door.** `server/test/ccrc-api.test.ts:158-168` pins the client table at
  exactly 18 rows and carries a test that no verb reaches the pause door. The operator doors are
  reachable from a phone, not from the fleet host's CLI — the fleet host is the party holding the box
  token, which is the party D-282 (was D-B4-9) routes around.
- **No new hyphenated single-quoted literal under `server/src/coord/`, comments included.**
  `mail-routes.test.ts:469-497` scans every `.ts` there with `/'([a-z]+(?:-[a-z]+)+)'/g` and demands
  membership in a declared union or a `NOT_CODES` entry. This wave admits a SIXTH union through its own
  exported guard, the way `isLifecycleGapReason`, `isClaimRefuseCode` and `isSessionLifecycle` were
  admitted — never an allowlist entry per member. Prose spells codes in backticks, never single quotes.
- **The new coord file holds no database handle.** `single-definition.test.ts:402-437` licenses exactly
  five files (`store.ts`, `rundefs.ts`, `routes.ts`, `db.ts`, `schema.ts`). `coord/reclaim.ts` must
  never import `./db.js` or `node:sqlite` and never name a `coord.db`/`store.db` receiver. **Do NOT add
  it to `HANDLE_HOLDERS`.** The transaction is a `CoordStore` method.
- **The door must be flag-blind and deterministic.** `auth-gate.test.ts`'s three-probe loop hits every
  route dark, armed-anonymous and armed-authenticated with **no body and no Origin**, and requires
  `dark.statusCode === authenticated.statusCode` exactly. `deps.coord` is undefined in those fixtures
  and the id is the literal `x`, so `notConfigured` and the integer check must both answer before
  anything is measured or written. A handler that read `authEnabled` would join `FLAG_AWARE`, whose
  size is pinned verbatim. Do not.
- **Registering the route is a five-scanner act.** Single quotes, one line, `app.post('…'` with no
  space and no line break after the paren; in `coord/routes.ts` and nowhere else (`coord-routes-single-file.test.ts`
  forbids `/api/runs` registrations elsewhere, and `coord-pause-route.test.ts`'s `docstringFor` throws
  "not registered" for an UNGATED name it cannot find); no `app.route(`, no DELETE.
- **The docstring above the door is content-checked and slice-hazardous.** > 600 characters, containing
  `requireMailToken`, `UNGATED`, `D-282` and a case-insensitive `coordinator`. Spell `requireMailToken`
  in BACKTICKS with **no open paren after it**: both `auth-gate.test.ts:404-410` and
  `coord-pause-route.test.ts:176-183` slice a handler from its own registration to the NEXT one, so this
  docstring lands inside the PRECEDING route's slice, and `/requireMailToken\(req/` there would credit
  abandon as gated. Place the door immediately after abandon's `\n  });\n` close so `docstringFor`
  anchors cleanly.
- **Role vocabulary only, in every byte this wave writes — including this plan.**
  `server/test/topology-clean.test.ts` scans `git ls-files` AND every blob `origin/main..HEAD`
  introduces (D-208) and bans the operator's username, the two real box names, the volume id, the
  GitHub handle and the old employer org. **No absolute home path anywhere; use
  `cd "$(git rev-parse --show-toplevel)"`.**
- **Deviation refs are ledgered and bounded.** `server/test/deviation-refs.test.ts` requires the highest
  `D-<n>` token anywhere in the tracked tree to equal the highest `D-<n>` DEFINED by a heading or bullet
  in a plan, and separately runs the real `floorFromScan` over the whole tree. **Land this plan's
  `## Deviations found` entries in the same commit as (or before) the source comments that cite them** —
  a source ref to an allocated-but-unentered number reds that suite, and the test's own message says so.
  **Never write the top of an unconsumed range with a `D-` prefix** — spell this wave's block
  `D-1123..1140`.
- **Fixture `D-` refs MUST be spelled SPLIT** — `` `D-${1200}` `` or `'D-' + '1200'`, never contiguous.
  **Never write a bare `D-TBD-…` into a diff** (`server/test/dtbd.test.ts`).
- **`D-282 (was D-B4-9)` is one unbreakable token sequence.** `deviation-refs.test.ts:168`'s
  `/(?<!was )\bD-B\d+-\d+\b/g` scans `CLAUDE.md` through `git ls-files`; a line break or extra
  whitespace inside that parenthetical reds it with `CLAUDE.md` named — and this very sentence had to be
  written around the trap, because spelling the legacy token outside its own `(was …)` form reds the same
  assertion from inside the plan. Do not rewrap the phrase, and do not quote its second half alone.
- **No new coloured CSS rule without its grounding and its pin in the SAME commit** (wave 3's D-1035).
  Prefer the already-measured `.abandon-*` / `.qc-*` classes; a genuinely new class ships with its
  `contrast.test.ts` entry and its `fleet-css.test.ts` inert-list entry beside it, never after.
- **Suites run in the FOREGROUND, `timeout >= 600000`, cd'd into the package.** Single suite:
  `./node_modules/.bin/vitest run test/<file>` from inside `server/` or `pwa/`. **Never bare
  `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests". Tails are
  READ, not grepped. `typecheck-tests` needs all three packages' `node_modules` installed.
- **This wave IS agent-first** (ruling R2). It touches `ccd/coordinator-skill/`. The deploy is still
  the coordinator's act at wave close — **do not deploy anything** — but the lane it will use is the
  fleet host first, then the server.

---

## Execution order, and why it is not the task numbering's accident

The tasks are numbered in a legal execution order and **must be executed in it.** Every edge below was
measured by the task that depends on it, not inferred:

| after | before | the edge |
|---|---|---|
| 1 (L0) | 2, 3, 6 | `no-claimant` is a hyphenated literal under `server/src/coord/` the moment the store method exists, and `mail-routes.test.ts`'s kebab scanner refuses it until `isReclaimRefuseCode` and its scanner arm ship. Task 6's red-first step needs `programResumeKickoff` EXPORTED. **The reason first written here was wrong and task 1 measured it so:** a missing named export does NOT throw at ESM link time under this tree's vitest — the binding is `undefined` and the suite ASSERTS (measured twice: `expected undefined to deeply equal [ … ]`, and `TypeError: programResumeKickoff is not a function`). The edge is real; expect an assertion or a `TypeError`, never a link error, and do not read a green link step as proof the export landed. |
| 2 (store) | 3 | `reclaimRun` calls `coord.reclaimProgram`; task 3 cannot go green without it. |
| 3 (L1) | 4 | the route is a union→status map over `ReclaimOutcome`. |
| 4 (door) | 5, 10 | task 5's count guard derives from `UNGATED.size` and calls `docstringFor` on every member — run before the fourth member lands and it reds for the wrong reason. Two of task 10's mutation rows fire off the UNGATED harvest and the new corpus-wide pin, and are GREEN-and-expected until task 4 has landed. |
| 7 (client) | 8, 9 | the ResumeSheet is typed against `api.reclaimRun` and against `kickoff` returning `{queued}`, neither of which exists first; and task 7's D-1137 prop widening edits the same `StartProgramSheet` props block task 9 edits. |
| 8 (board) | 9 (sheet) | both touch `pwa/src/screens/RunsScreen.tsx`. They do not overlap by line, but **task 9 owns `openRunProjects` end to end** — both the prop on `StartProgramSheet` and the line in `RunsScreen` that supplies it. Task 8 must not pass a prop that does not exist yet (a `TS2322` in whichever lands first), and task 9 must not re-add one task 8 already wrote. |

**A pin whose killer is in another suite.** Task 1 measured one mutation its own suite cannot see: inlining
the ledger path into `programResumeKickoff` produces a byte-identical string, so the value comparison stays
green and the only killer is `single-definition.test.ts`'s "no shipped source reads the program ledger off
disk". Any step that says "run the named suite" to prove a ledger-path guard must run `single-definition`
too — a suite that cannot express a change cannot witness it, which is wave 2's lesson in a third place.

**One consequence worth stating plainly:** tasks 2 and 3 are red for a reason that is not their own until
task 1 lands, and task 10's row 8 is green for a reason that is not its own until task 4 lands. Both are
the ordering being visible, not a guard failing. Record them that way rather than marking them done.

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `shared/api.ts` | Add a sixth refusal union + a resume composer; rewrite one docstring | `ReclaimRefuseCode`/`RECLAIM_REFUSE_CODE_MAP`/`RECLAIM_REFUSE_CODES`/`isReclaimRefuseCode`; `programResumeKickoff(slug, title, runId, wave)`; `RunSummary.claimedBy`'s docstring says what still holds and no longer asserts what this wave falsifies |
| `server/src/coord/reclaim.ts` | **Create** | L1: `measureClaimant` (the three-answer dead proof) and `reclaimRun` (the whole decision). Declares its own `ReclaimDeps`. Imports no fastify, no `reply`, no `./db.js`, no `node:sqlite` |
| `server/src/coord/store.ts` | One widened primitive, one new method | `recordRunEvent` takes the caller's `at`; `reclaimProgram(runId, to, at)` holds the wave's single transaction |
| `server/src/coord/kickoff.ts` | Widen the seam | `queueProgramKickoff(deps, toId, program, resume?)` — the wave-1 body when `resume` is absent, the wave-N body when it is present, one byte cap over both |
| `server/src/coord/routes.ts` | Add one door; correct two prose counts | `POST /api/runs/:id/reclaim` — the fourth ungated door, a union→status map that decides nothing; pause's and break's docstrings stop saying THREE and THIRD |
| `server/src/server.ts` | Two optional body fields | `POST /api/sessions/:id/kickoff` accepts `{runId, wave}` both-or-neither; no new route, so its route count does not move |
| `server/src/auth/gate.ts` | Prose | The NOT-EXEMPT block names four doors and keeps the "strengthens D-282" argument |
| `pwa/src/lib/api.ts` | One new method; one method stops discarding its answer | `reclaimRun(id, claimedBy)`; `kickoff` returns `{queued}` and its docstring stops arguing against the caller wave 5 became |
| `pwa/src/fleet/coordWords.ts` | Add the client-side trichotomy | `CoordPresence` + `coordPresence(claimedBy, session, frameSeen)` — `unknown` on every input that is not proof |
| `pwa/src/fleet/ResumeSheet.tsx` | **Create** | The three doors in order — revive, re-kickoff, reclaim — on `AbandonSheet`'s exact shape: screen-level mount, `gen` supersession guard, inline refusals, injectable `api.*` props |
| `pwa/src/screens/RunsScreen.tsx` | Wire two things | Looks up the coordinator's session by `run.claimedBy`, renders the resume control only on a measured `dead`, and hands `StartProgramSheet` the open-run answer it must not fetch |
| `pwa/src/fleet/StartProgramSheet.tsx` | One new refusal arm | Refuses a project with an open run, three-state, computed independently of `projected`, placed after the D-292 arm and before the D-284 one |
| `pwa/src/fleet/fleet.css` | Only if unavoidable | Reuse `.abandon-*`/`.qc-*`; any new class ships with its contrast entry and its inert-list entry in the same commit |
| `ccd/coordinator-skill/references/resume.md` | Correct four passages | §2's permanence claim, §4's "briefed by hand", §6's "no sequence of API calls fixes it" — all without naming the route |
| `ccd/coordinator-skill/SKILL.md` | Correct one sentence | Clause prose at `:31` stops asserting the API never rewrites `claimedBy` |
| `CLAUDE.md` | One paragraph, two coordinated edits | Door count → four; the box-token sentence gains wave 4's unnamed session-gated exception |
| `server/test/coord-reclaim.test.ts` | **Create** | The dead-proof mutation table: every input that must answer `unmeasurable`, `alive` and `dead`, each proving the store was or was not written |
| `server/test/reclaim-route.test.ts` | **Create** | The door: every status in the map, the answers-without-the-box-token pin, the three-probe determinism |
| `server/test/coord-pause-route.test.ts` | Grow `UNGATED`; add the missing direction; fix the header | Four doors, and — new this wave — an assertion that a listed door actually LACKS a gate |
| `server/test/coordinator-skill.test.ts` | Parity EXEMPT + a corpus-wide forbid-mention pin + one moved literal | The door is registered, unnamed anywhere in the corpus, and the pinned resume.md sentence moves with the prose it pins |
| `server/test/auth-gate.test.ts` | Four exact numbers | 22→23, 68→69, 65→66, 41→42; `EXEMPT.size` stays 25 and the derived assertions are untouched |
| `server/test/mail-routes.test.ts` | One scanner arm | `|| isReclaimRefuseCode(tok)`, argued in the register of the three unions already admitted there |
| `server/test/coord-store.test.ts` | Extend | `reclaimProgram`: every run rewritten, NULLs left NULL, one event row each at one moment, the no-op arm |
| `server/test/coord-kickoff.test.ts`, `server/test/kickoff-route.test.ts` | Extend | The resume body byte-for-byte, the both-or-neither 400, the unchanged wave-1 path with a fixture that could witness a change, and 413-queues-nothing |
| `pwa/test/resume-sheet.test.tsx` | **Create** | The sheet: supersession, each refusal inline, `queued:false` rendered as its own fact |
| `pwa/test/runs-screen.test.tsx`, `pwa/test/start-program.test.tsx`, `pwa/test/api.test.ts` | Extend | The door hidden on `unknown` and `alive`; the open-run refusal incl. its not-measured arm; the two client methods |

---

## Verified facts this plan is built on

Every anchor below was READ before it was written down. Stale citations are endemic in this tree —
`pwa/src/lib/api.ts` cites the abandon route at `coord/routes.ts:844` and it is at `:1010`;
`coord/routes.ts:1172` cites `notConfigured` at `:172` and it is at `:270` — so prefer the SYMBOL
name over the line when re-checking, and re-measure any anchor you are about to copy.

| Fact | Evidence |
|---|---|
| `claimedBy` has exactly two writers in the whole tree and both are INSERTs; no `UPDATE runs SET claimedBy` exists anywhere in `server/src` or `ccd/` | `openRun` (`store.ts:405-407`), `reconstruct`; grep over every `UPDATE runs SET` |
| The one-coordinator guard and `resolveCoordinator(null)` run the SAME unscoped lowest-id-claimed query, and the mirroring is deliberate | `store.ts:369-371`, `store.ts:1188-1191` + its own docstring |
| `resolveCoordinator(null)` additionally requires exactly ONE `active` program, box-wide | `store.ts:1185-1187` |
| `programOpenRunCount` is the ONLY existing program-scoped run query and it returns a COUNT; there is no `runsForProgram` | `store.ts:918-922` |
| `TERMINAL_RUN_STATES` is derived from `RUN_TRANSITIONS` and yields three words, while eight SQL predicates hand-write two | `store.ts:29-31`; only `strandedClear` (`:714-718`) uses the derived list |
| `tx(db, fn)` is `BEGIN IMMEDIATE`/COMMIT/ROLLBACK, synchronous, and does NOT nest — a second `BEGIN` throws | `server/src/coord/db.ts:245-257`; `advance` at `store.ts:425` wraps the private `advanceInner` at `:435` for exactly this reason |
| `advanceInner` computes `now` ONCE and reuses it for the row and the event | `store.ts:443`, `:450` |
| `recordRunEvent` reads its own clock, has no `at`, writes `fromState === toState`, and no-ops on an unknown run | `store.ts:485-492` |
| The notify lane deliberately skips every `fromState === toState` row, so attribution rows do not impersonate transitions | `recordRunEvent`'s own docstring, `store.ts:478-484` |
| `markDispatchStarted` is the "caller owns the moment being recorded" precedent | `store.ts:739-742` |
| `run_events` has no kind/type column — the vocabulary is a kebab-prefixed `detail` string | `schema.ts`; `dispatch.ts:370-372` (`'dispatch-refused:'…`), `dispatch.ts:615` (`skill-preflight:${skillState}`) |
| The abandon door is a four-line pass-through with no token check, wrapped in `coordMutex`, and its `causedBy` is the literal `'operator'` at the call site | `coord/routes.ts:1010-1021` |
| The break door is the leanest of the three and the closest structural template, with `'operator'` again a call-site literal | `coord/routes.ts:1745-1751` |
| Abandon and break both state "THE REQUEST BODY IS NEVER READ" as a load-bearing D-280 property; pause is the body-reading precedent | `routes.ts:996-999`, `:1735`; pause's `typeof body.paused !== 'boolean'` at `:1176-1187` |
| Pause deliberately has NO `notConfigured` arm; abandon and break both start with one | pause's docstring, `routes.ts:1148-1175` |
| The established coord-route status for an unlistable registry is 502 `registry-unmeasurable`; `server.ts`'s kickoff route answers 503 for the same condition | `routes.ts:148-152`, `:317-358`, `:1463-1491`; `server.ts:1511-1518` |
| `readSessionRecord` splits `absent` from `unlistable` in one `readdir` + that id's field reads, and carries the hold-reconfirm discipline | `server/src/registry.ts:858-911` |
| `readRegistry` collapses an unlistable directory to `[]` — the exact shape "no such session" wears — which is why `readRegistryMeasured` exists | `registry.ts:853`; the argument at `coord/dispatch.ts:463-476` |
| `Tmux.sessionVerdict` answers three ways and `hasSession`'s own docstring forbids the boolean where `gone` and `unknown` differ | `server/src/exec.ts:75-125` |
| The shipped dead-session ladder — verdict `gone` THEN a lifecycle check, with `unknown` handled separately — is `sweepMail`'s | `server/src/watch.ts:2490-2517` |
| `lifecycleIsDead` calls exactly three words dead and states that `unmeasurable` is not one of them ("Doubt is not evidence") | `shared/api.ts:1663-1680` |
| `lifecycleInputFor` takes MILLISECONDS and its docstring names the silent failure of passing seconds — `restarting` collapsing to `orphan` | `server/src/fleet.ts:170-198` |
| `assembleFleet` collapses a tmux `unknown` into `alive = false`, so `FleetSession.status === 'dead'` is a false dead during a substrate fault | `server/src/fleet.ts:123`, `:245` (D-309) |
| `queueProgramKickoff` is a pure L1 seam importable without the route, and its own docstring says it was factored out FOR this wave | `server/src/coord/kickoff.ts:1-41`; `server.ts:1475-1478`; `coord-kickoff.test.ts:14` imports it directly |
| Its body comes from `programKickoff`, which hardcodes wave 1 | `kickoff.ts:117`; `shared/api.ts:3105-3107` |
| The byte cap (D-1119) is measured on the COMPOSED body at the seam, and the 413 arm writes nothing so it does not occupy the dedupe key | `kickoff.ts:118-122`; pinned at `kickoff-route.test.ts:251-262` |
| The dedupe key carries no slug, by an argument its own docstring makes | `kickoff.ts:104-110`; `hasOutstandingMail` at `store.ts:1353-1360` |
| Nothing can tell one program's waiting kickoff from another's without reading a mail body, and no store read returns one | `hasOutstandingMail` answers a boolean; `MAIL_ROW_COLUMNS` (`store.ts:274-285`) omits `m.body` |
| `UNGATED` is a three-element Set on one line, harvested elsewhere by a single-line regex | `coord-pause-route.test.ts:172`; harvest at `coordinator-skill.test.ts:1097` |
| The UNGATED pin measures "not listed ⇒ gated" and "listed ⇒ argued docstring", and NOTHING measures "listed ⇒ ungated" | `coord-pause-route.test.ts:185-209`, `:244-258` |
| The ungated docstring pin is content-checked: > 600 chars, containing `requireMailToken`, `UNGATED`, `D-282`, and matching /coordinator/i, sliced back to the previous `\n  });\n` | `coord-pause-route.test.ts:235-258` |
| The auth-gate scanner classifies a handler as gated on `/requireMailToken\(req/` anywhere in its slice, and a route's docstring falls inside the PRECEDING route's slice | `auth-gate.test.ts:404-410`; `coord-pause-route.test.ts:176-183` |
| Today's ungated docstrings survive that only because they spell the helper in backticks with no open paren | `routes.ts:1003`, `:1725` |
| The auth-gate route counts are EXACT, not floors, and the file says editing them is meant to be a deliberate reviewed act | `auth-gate.test.ts:196-203`, `:469` |
| The parity EXEMPT set derives the registered set from `coord/routes.ts` itself; a registered route absent from both corpus and set reds | `coordinator-skill.test.ts:190-197`, `:217-240` |
| The corpus-wide forbid-mention pin exists for exactly one door today and is the shape to copy | `coordinator-skill.test.ts:995-1001` |
| The resume.md UNGATED harvest already anticipates a FOURTH door by name and arms itself with no edit — but scans only `resume.md`, never `allSkillText` | `coordinator-skill.test.ts:1082-1106` |
| Every declared `RunRefuseCode` must appear in the coordinator corpus; no such obligation exists for the other unions | `coordinator-skill.test.ts:311-321` |
| The kebab scanner admits new unions through their own exported guards, and its comments argue why an allowlist entry is the worse remedy | `mail-routes.test.ts:469-497` |
| `registry-unmeasurable` is a `MailRejectCode` and `unknown-session` a `ClaimRefuseCode`, both already declared — reusing either costs nothing | `shared/api.ts:3421-3438`, `:3587-3591` |
| A run refusal is "either a member of this union or of `MAIL_REJECT_CODES`, never both" | `RunRefuseCode`'s docstring, `shared/api.ts:3440-3452` |
| `AbandonSheet` is the PWA operator-control pattern: screen-level mount, `run !== null` IS open, a `gen`/`targetId` supersession guard, injectable `api.*` props, a total refusal-copy Record with a designated `unknown`, refusals rendered inline | `pwa/src/fleet/AbandonSheet.tsx` in full; the two MEASURED bugs its `gen` guard fixed are named at `:132-154` |
| `abandonRun` is the ungated PWA client precedent and says so | `pwa/src/lib/api.ts:496-524` |
| The runs board already builds `sessionById` but looks up only `run.sessionId`; `run.claimedBy` rides the wire and is read by nothing on that screen | `pwa/src/screens/RunsScreen.tsx:349`, `:432`; the only `pwa/src` reader of `claimedBy` is `nestFleet.ts` |
| `runsFrameSeen` is a real third state and the store's own comment says `runs.length > 0` cannot answer it; `RunsScreen` calls it `noSignalYet` | `pwa/src/stores/fleet.ts:87-96`; `RunsScreen.tsx:412` |
| The cold run read lives in `RunsScreen`'s local state and never reaches the store, so `StartProgramSheet` cannot see it | `RunsScreen.tsx:254`, `:308-311` |
| `StartProgramSheet` makes exactly two fetches and a test pins the count rather than two `toContain`s | `pwa/test/start-program.test.tsx:528-531` |
| `POST /api/runs` validates `project` as a non-empty string and never against `listProjects` | `coord/routes.ts:888-891` |
| There is no `/api/programs` route, so `RunSummary[]` is the only program-shaped data the PWA can ever read | grep over `coord/routes.ts` and `pwa/src/lib/api.ts` |
| The hold reason must never be parsed, including in a comment — a scanner reads both `server/src` and `pwa/src` for it | `server/test/run-routes.test.ts:2105-2132` |
| The corpus asserts the opposite of this door in three places, one of them pinned verbatim | `resume.md:38-39`, `:110`, `SKILL.md:31`; pin at `coordinator-skill.test.ts:1053` |
| `resume.md` §4 already carries the wave-N re-kickoff text this wave moves into L0, and says why re-opening is not a no-op | `resume.md:78-93` |
| `resume.md` spells `/api/sessions/:id/ensure` with NO method on purpose, because the sweep demands gate-EXEMPT membership for a method-spelled path | `resume.md:68-72`; the sweep at `auth-passkey.test.ts:2284-2321` |
| `CLAUDE.md` states the door count in exactly one paragraph, and `README.md` states no door count at all | `CLAUDE.md:141-148`; zero case-insensitive hits for "ungated" in `README.md` |
| Wave 4 deferred the box-token sentence's unnamed exception to this wave, in writing | `docs/superpowers/plans/2026-08-30-program-leverage-wave4-f4.md:1226-1231` |
| The deviation allocator is authoritative and this worktree cannot see it — the live floor after wave 4 was 1123 while the tracked-tree high-water was `D-1122` | `POST /api/ledger/deviations` answered `numbers: [1123…1140], floor: 1141` at planning time |

---

## Task 1: the L0 vocabulary — a sixth refusal union, the resume kickoff, and the docstring that stops lying

Three additions to `shared/api.ts`, one arm added to an existing scanner, and one new suite that pins all
three. Nothing under `server/src/` moves in this task: the union has no producer until the L1 task creates
`server/src/coord/reclaim.ts`, and that is stated as a measured fact below rather than worked around.

**Files:** `shared/api.ts`, `server/test/resume-reclaim-l0.test.ts` (**new**),
`server/test/mail-routes.test.ts`.

**Why the suite is a NEW file and not an extension.** Measured, not guessed: no existing suite imports
`isRunRefuseCode`/`isClaimRefuseCode` as a subject — the four hits (`coordinator-skill.test.ts`,
`mail-routes.test.ts`, `mail-sweep.test.ts`, `pwa/test/mail-strip.test.tsx`) all use them as tools for some
other assertion. The one L0-vocabulary suite in the tree is `server/test/peers-claims-l0.test.ts`, whose own
header (`:1-19`) declares it "Build 9b, wave 1 — the L0 slice … peers/claims/ledger vocabulary"; filing a
wave-5 union under that heading is precisely the drift this repo's own doctrine is about. So: a new
`server/test/resume-reclaim-l0.test.ts`, copying that file's SHAPE (a whole wave's L0 slice in one place,
derivation pinned before the guard, import purity last) and its two-subject naming.

- [ ] **1.1 — Write the union half of the new suite and measure it RED:** create
  `server/test/resume-reclaim-l0.test.ts` with the header and the first describe. It cannot compile —
  `ReclaimRefuseCode` does not exist — so the red is a module/export error, not an assertion; record the
  first line verbatim and say in the mutation table that it was a resolution error.

  ```ts
  // Wave 5 (F5) — the L0 slice: a sixth typed refusal union, the wave-N re-kickoff,
  // and the one docstring in `shared/api.ts` that stopped being true the day an
  // operator could succeed a dead coordinator (D-1125, D-1126, D-1127).
  //
  // WHY ITS OWN FILE. `server/test/peers-claims-l0.test.ts:1-19` declares itself
  // "Build 9b, wave 1 — the L0 slice", subjects peers/claims/ledger. A wave-5 union
  // filed under that heading is the drift its own doctrine is about. It IS the shape
  // copied here: one wave's L0 vocabulary in one place, derivation pinned before the
  // guard, import purity last.
  //
  // WHAT THIS PINS AND WHY:
  //  - `RECLAIM_REFUSE_CODES` is DERIVED from `RECLAIM_REFUSE_CODE_MAP`
  //    (`RUN_REFUSE_CODE_MAP`'s idiom, `shared/api.ts:3498-3504`), so a member deleted
  //    from the map cannot leave a runtime list still promising it.
  //  - `isReclaimRefuseCode` narrows with `hasOwnProperty`, never `in`. That is the one
  //    place this guard's shape differs from its four siblings, which all spell
  //    `(CODES as readonly string[]).includes(v)` — and the difference has teeth:
  //    `'toString' in RECLAIM_REFUSE_CODE_MAP` is TRUE, so an `in` mutant admits every
  //    key of `Object.prototype` to a refusal vocabulary.
  //  - The union is NOT a `RunRefuseCode`, as a MECHANISM rather than a docstring:
  //    `server/test/coordinator-skill.test.ts:318-321` asserts every member of THAT
  //    union is named somewhere in the coordinator corpus, and this door's whole
  //    obligation (ruling R2) is to stay unnamed there.
  //  - `programResumeKickoff` is compared against `ccd/coordinator-skill/references/
  //    resume.md` §4's own code block — two speakers of one sentence, checked against
  //    EACH OTHER. The literal check beside it carries
  //    `pwa/test/start-program.test.tsx:114-128`'s argument over verbatim: a constant
  //    compared only against itself cannot notice the text drifting off the brief.
  import { describe, it, expect } from 'vitest';
  import { readFileSync } from 'node:fs';
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  import {
    RECLAIM_REFUSE_CODES, isReclaimRefuseCode,
    RUN_REFUSE_CODES, programKickoff, programResumeKickoff, ledgerPath,
  } from '../../shared/api.js';
  import type { ReclaimRefuseCode } from '../../shared/api.js';

  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..', '..');
  const apiPath = path.join(root, 'shared', 'api.ts');
  const resumeMd = path.join(root, 'ccd', 'coordinator-skill', 'references', 'resume.md');

  /** `coordinator-skill.test.ts:605`'s helper plus the comment-marker strip: a
   *  docstring's line wrapping is not part of the claim it makes. */
  const flat = (s: string): string => s.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim();

  describe('the sixth refusal union', () => {
    it('derives the runtime list from the map, in declaration order', () => {
      expect(RECLAIM_REFUSE_CODES).toEqual(['claimant-alive', 'no-claimant']);
    });

    it('is total in both directions at compile time', () => {
      // TS2741 here the day the union gains a member this map lacks; TS2353 the day
      // the map gains one the union does not have. `typecheck-tests.test.ts` compiles
      // this directory under `test/tsconfig.tests.json`, whose `include` carries
      // `../../shared/**/*.ts`, so this is a gate and not a comment.
      const total: Record<ReclaimRefuseCode, true> = { 'claimant-alive': true, 'no-claimant': true };
      expect(Object.keys(total)).toEqual([...RECLAIM_REFUSE_CODES]);
    });

    it('builds the list with Object.keys, never a second hand-written array', () => {
      // The `RUN_REFUSE_CODES`/`MAIL_GATES` idiom. A hand-written twin compiles, passes
      // the assertion above on the day it is written, and drifts on the next edit —
      // which is the whole reason `single-definition.test.ts` exists one ring up.
      const src = readFileSync(apiPath, 'utf8');
      expect(src).toMatch(
        /export const RECLAIM_REFUSE_CODES: readonly ReclaimRefuseCode\[\] =\s*\n?\s*Object\.keys\(RECLAIM_REFUSE_CODE_MAP\)/,
      );
    });

    it('isReclaimRefuseCode is the only narrowing door, and it refuses the near-misses', () => {
      for (const c of RECLAIM_REFUSE_CODES) expect(isReclaimRefuseCode(c), c).toBe(true);
      // `claimant-live`/`no-claimaint` are the typos a later edit actually makes;
      // `not-owner` and `unknown-session` are real members of a DIFFERENT union
      // (`CLAIM_REFUSE_CODES`) and must not be smuggled in by proximity.
      for (const near of ['claimant_alive', 'claimant-live', 'alive',
        'no-claimaint', 'claimant', 'not-owner', 'unknown-session', '']) {
        expect(isReclaimRefuseCode(near), near).toBe(false);
      }
      for (const junk of [undefined, null, 1, {}, ['claimant-alive']]) {
        expect(isReclaimRefuseCode(junk), String(junk)).toBe(false);
      }
    });

    it('refuses the prototype keys an `in` check would let through', () => {
      // The killer for the one mutation the guard's shape exists to stop. `'toString' in
      // RECLAIM_REFUSE_CODE_MAP` is TRUE — swap `hasOwnProperty.call` for `in` and a
      // route's 409 body can name `constructor` as a refusal code.
      for (const proto of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
        expect(isReclaimRefuseCode(proto), proto).toBe(false);
      }
    });

    it('is deliberately NOT a RunRefuseCode — the corpus census must never reach it', () => {
      // `coordinator-skill.test.ts:318-321` loops `RUN_REFUSE_CODES` and requires each
      // member to appear in `allSkillText`. Folding either of these two in there would
      // force the word into the coordinator corpus, and ruling R2 is that this door
      // stays unnamed in it. The docstring says so; this is the mechanism.
      for (const c of RECLAIM_REFUSE_CODES) {
        expect(RUN_REFUSE_CODES as readonly string[], c).not.toContain(c);
      }
    });

    it('both members are kebab tokens the coord scanner will actually see', () => {
      // Anti-vacuity for the arm added to `mail-routes.test.ts:469` in this same
      // commit. That scanner matches `/'([a-z]+(?:-[a-z]+)+)'/` over every `.ts` under
      // `server/src/coord`; a single-word member would need no arm at all and the arm
      // would be decoration. Renaming a member to `'alive'` reds this and nothing else.
      const KEBAB = /^[a-z]+(?:-[a-z]+)+$/;
      for (const c of RECLAIM_REFUSE_CODES) expect(KEBAB.test(c), c).toBe(true);
    });

    it('the coord kebab scanner admits them through the guard, never through NOT_CODES', () => {
      // The difference is the point, and `mail-routes.test.ts:474-481` already states
      // it for `LifecycleGapReason`: an allowlist entry accepts exactly one spelling for
      // ever, a guard accepts a member added later and still rejects a typo'd one.
      const src = readFileSync(path.join(root, 'server/test/mail-routes.test.ts'), 'utf8');
      expect(src).toContain('|| isReclaimRefuseCode(tok)');
      expect(src).toContain('isReclaimRefuseCode }');   // …imported, not just mentioned in prose
      const notCodes = /const NOT_CODES = new Set\(\[([\s\S]*?)\n\s*\]\);/.exec(src);
      expect(notCodes, 'mail-routes.test.ts no longer declares `const NOT_CODES = new Set([...]);` — '
        + 'this harvest is reading a shape that moved, and a silent miss would pass everything').not.toBeNull();
      for (const c of RECLAIM_REFUSE_CODES) {
        expect((notCodes as RegExpExecArray)[1]!, c).not.toContain(`'${c}'`);
      }
    });
  });
  ```

- [ ] **1.2 — Add the union to `shared/api.ts` and go green:** insert immediately after
  `isClaimRefuseCode`'s closing brace (verified: `shared/api.ts:3592-3594`, with
  `RunItemTally` at `:3596-3597` next) so the sixth union sits with the fifth and the fourth. Re-run
  `cd server && ./node_modules/.bin/vitest run test/resume-reclaim-l0.test.ts` — expect PASS except the
  two `mail-routes.test.ts` structural assertions, which stay red until step 1.7.

  ```ts
  /** SIXTH typed refusal union, admitted to `mail-routes.test.ts`'s kebab scanner
   *  through its own exported guard exactly as `isLifecycleGapReason`,
   *  `isClaimRefuseCode` and `isSessionLifecycle` were (`:474-493`) — a guard, never
   *  a `NOT_CODES` entry, for the reason that file already states: an allowlist
   *  accepts one spelling for ever, a guard accepts a member added later and still
   *  rejects a typo'd one.
   *
   *  NOT A `RunRefuseCode`, and the exclusion is load-bearing rather than tidy:
   *  `server/test/coordinator-skill.test.ts` loops every member of THAT union and
   *  requires each to be named somewhere in the coordinator corpus. This door's whole
   *  obligation is the opposite — the corpus must not teach a coordinator to reach for
   *  it, because it is the OPERATOR's act on a coordinator that is already dead, and a
   *  live coordinator reading about it has found a recovery for a problem it does not
   *  have. Membership here would drag the word into that corpus by force of a passing
   *  test, which is exactly backwards: the census would be satisfied and the design
   *  broken. (D-1127.)
   *
   *    claimant-alive — the run's current claimant was MEASURED and answers alive.
   *                     Refused, 409, and the answer carries `by` plus the sentence
   *                     that reached it: a live tmux pane and a gone-but-restarting
   *                     lifecycle are the same ANSWER told apart by evidence, not by
   *                     a fourth code nobody would branch on
   *    no-claimant    — the run names nobody. Distinct from `unknown-run` (there is no
   *                     such run) and from `unknown-session` (the NEW claimant has no
   *                     registry row): three different things to fix, never one code */
  export type ReclaimRefuseCode = 'claimant-alive' | 'no-claimant';
  const RECLAIM_REFUSE_CODE_MAP: Record<ReclaimRefuseCode, true> = { 'claimant-alive': true, 'no-claimant': true };
  export const RECLAIM_REFUSE_CODES: readonly ReclaimRefuseCode[] =
    Object.keys(RECLAIM_REFUSE_CODE_MAP) as ReclaimRefuseCode[];
  /** `hasOwnProperty`, not `in` and not `MAP[v]`: `'toString' in RECLAIM_REFUSE_CODE_MAP`
   *  is TRUE, and a refusal vocabulary that answers yes to half of `Object.prototype`
   *  is a 409 body naming `constructor` as a code. The four sibling guards spell
   *  `.includes(v)` over their array and are safe for the same reason by a different
   *  route; this one takes the map it already has. */
  export function isReclaimRefuseCode(v: unknown): v is ReclaimRefuseCode {
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RECLAIM_REFUSE_CODE_MAP, v);
  }
  ```

- [ ] **1.3 — Write the re-kickoff describe and measure it RED:** append to
  `server/test/resume-reclaim-l0.test.ts`. Red again on the missing export; record it verbatim.

  ```ts
  describe('the wave-N re-kickoff', () => {
    const SLUG = 'program-leverage';
    const TITLE = 'Program leverage';
    const RUN_ID = 18;
    const WAVE = 5;

    /** `resume.md` §4's own indented code block, harvested rather than retyped. */
    const briefBlock = (): string[] => {
      const lines = readFileSync(resumeMd, 'utf8').split('\n');
      const start = lines.findIndex((l) => l.startsWith('    You are the coordinator for program'));
      expect(start, 'resume.md §4 no longer opens its brief block with "You are the coordinator for '
        + 'program" at four-space indent — this harvest is reading a shape that moved').toBeGreaterThan(-1);
      const out: string[] = [];
      for (let i = start; i < lines.length && lines[i]!.startsWith('    '); i++) out.push(lines[i]!.slice(4));
      return out;
    };

    it('IS resume.md §4 with the placeholders filled — one text, two speakers', () => {
      // The runbook told a revived coordinator to be briefed BY HAND with this block
      // (`resume.md:80-87`). Wave 5 gives the text a composer, and the failure mode of
      // that move is the ordinary one: two copies, one edited. So the composer is
      // checked against the DOC, not against itself.
      const block = briefBlock();
      expect(block.length, `resume.md §4's block is ${block.length} lines, not 5`).toBe(5);
      const filled = block.join('\n')
        .replaceAll('<slug>', SLUG)
        .replaceAll('<title>', TITLE)
        .replaceAll('<run id>', String(RUN_ID))
        .replaceAll('<N>', String(WAVE));
      expect(programResumeKickoff(SLUG, TITLE, RUN_ID, WAVE)).toBe(filled);
    });

    it('matches the brief\'s code block byte for byte', () => {
      // `pwa/test/start-program.test.tsx:114-128`'s argument, carried: the assertion
      // above compares two things that can be edited together in one commit, so it
      // cannot see the pair drifting off the brief as a pair. This is the one place
      // the brief's exact text is checked against what ships.
      expect(programResumeKickoff('build9-demo', 'Build 9: demo', 7, 3)).toBe(
        'You are the coordinator for program `build9-demo` (Build 9: demo).\n'
        + 'Its ledger is `docs/superpowers/programs/build9-demo.md`.\n'
        + 'Run the ccrc-coordinator skill. Its run is ALREADY OPEN: read `GET /api/runs`,\n'
        + 'find run 7 at wave 3, and pick that wave up where the ledger says it\n'
        + 'stands. Do not open the run for wave 3 again, and do not open wave 1 again.',
      );
    });

    it('shares its first two lines with programKickoff — one greeting, one ledger path', () => {
      // The sibling relationship as a mechanism. A second inline ledger path was fix
      // round 1's Minor 3 on `programKickoff` (`shared/api.ts:3106` builds it from
      // `ledgerPath`); this is what stops it being reintroduced by the copy.
      const resume = programResumeKickoff(SLUG, TITLE, RUN_ID, WAVE).split('\n');
      const start = programKickoff(SLUG, TITLE).split('\n');
      expect(resume.slice(0, 2)).toEqual(start.slice(0, 2));
      expect(resume[1]).toBe(`Its ledger is \`${ledgerPath(SLUG)}\`.`);
    });

    it('never carries the wave-1 sentence the machine kickoff hardcodes', () => {
      // The whole reason this constant exists (`resume.md:80-81`): the started-program
      // text is correct exactly once and wrong for every revive after it. A composer
      // that ends with the wave-1 sentence has silently become `programKickoff`.
      const body = programResumeKickoff(SLUG, TITLE, RUN_ID, WAVE);
      expect(body).not.toContain('and open the run for wave 1');
      expect(body).toContain('Its run is ALREADY OPEN');
      expect(body).toContain('do not open wave 1 again');
    });
  });
  ```

- [ ] **1.4 — Add `programResumeKickoff` to `shared/api.ts` and go green:** insert between
  `programKickoff`'s last line (`shared/api.ts:3107`) and `PROGRAM_KICKOFF_SUBJECT`'s docstring
  (`:3109`) — beside its sibling, above the subject that labels both. Re-run the suite.

  ```ts
  /** The wave-N re-kickoff. Sibling of `programKickoff`, NOT a replacement: that one is
   *  right exactly once — a program being STARTED — and wrong for every revive after
   *  it, which is what `ccd/coordinator-skill/references/resume.md` §4 exists to say.
   *  Same three facts (slug, ledger, skill) plus the two sentences §4 calls its
   *  load-bearing half: an open run does not need re-opening, and re-opening is not a
   *  harmless no-op — `openRun` dedupes ONLY a retry naming the same program, wave and
   *  `claimedBy` against a row that is still `planned`, so re-opening a `working` wave
   *  writes a SECOND row and an open-run count the program never gets back to zero.
   *
   *  L0 for the reason `programKickoff` is: the runbook says this text and the server
   *  now composes it, and a template with two speakers and no home is the drift this
   *  file's own header warns about. `resume-reclaim-l0.test.ts` checks the two against
   *  each other rather than each against itself (D-1126). */
  export const programResumeKickoff = (
    slug: string, title: string, runId: number, wave: number,
  ): string =>
    `You are the coordinator for program \`${slug}\` (${title}).\n` +
    `Its ledger is \`${ledgerPath(slug)}\`.\n` +
    `Run the ccrc-coordinator skill. Its run is ALREADY OPEN: read \`GET /api/runs\`,\n` +
    `find run ${runId} at wave ${wave}, and pick that wave up where the ledger says it\n` +
    `stands. Do not open the run for wave ${wave} again, and do not open wave 1 again.`;
  ```

- [ ] **1.5 — Write the docstring describe and measure it RED against the CURRENT text:** append the
  third describe. This one reds on the shipped tree for the right reason — the three retracted claims are
  in the file today. Record the first failing assertion verbatim.

  ```ts
  describe('RunSummary.claimedBy stops claiming what stopped being true', () => {
    /** The docstring, sliced between the two field declarations that bracket it —
     *  both spellings are unique in the file (measured), so this cannot drift onto a
     *  neighbour. */
    const doc = (): string => {
      const src = readFileSync(apiPath, 'utf8');
      const open = '  state: RunState;\n';
      const a = src.indexOf(open);
      const b = src.indexOf('  claimedBy: string | null;', a);
      expect(a, 'RunSummary no longer opens with `state: RunState;` — this slice moved').toBeGreaterThan(-1);
      expect(b, 'RunSummary no longer declares `claimedBy: string | null;` after it').toBeGreaterThan(a);
      return flat(src.slice(a + open.length, b));
    };

    it('is reading a real docstring — anti-vacuity before anything is asserted about it', () => {
      // A slice that came back empty passes every negative below.
      expect(doc().length).toBeGreaterThan(800);
      expect(doc()).toContain('coordinator');
    });

    it('drops the three claims the reclaim door falsified', () => {
      // Each of these was TRUE of the tree that shipped it. `claimedBy` was written at
      // open and by nothing else, so "the second coordinator is refused for ever" and
      // "recovery never reassigns the run" followed from it. A door that measures the
      // claimant and succeeds a dead one falsifies all three at once, and a wire type
      // whose docstring still asserts them is worse than one with no docstring: a
      // reader trusts it (D-1125).
      const d = doc();
      expect(d).not.toContain('rewritten by no route afterwards');
      expect(d).not.toContain('refused FOREVER');
      expect(d).not.toContain('never reassigning the run');
    });

    it('keeps the part that still holds — the refusal AT OPEN TIME', () => {
      // The correction is a narrowing, not a deletion: `claimed-by-another` is exactly
      // as absolute as it ever was for a claimant that is alive, and that is what the
      // door measures before it writes anything.
      const d = doc();
      expect(d).toContain('claimed-by-another');
      expect(d).toContain('refused AT OPEN TIME');
      expect(d).toContain('a corpse can be succeeded');
    });

    it('teaches no call — the reclaim PATH appears nowhere in it', () => {
      // Method-spelled or not. Nothing that READS this field calls that door: the PWA
      // renders the ownership edge and `resolveCoordinator` addresses mail. A wire
      // type that names a call its own readers do not make is where a doc lie starts —
      // and this file's neighbouring docstrings show how easily the habit spreads
      // (`POST /api/runs`, `POST /api/sessions/:id/prompt`, both correct there).
      const d = doc();
      expect(d).not.toContain('/api/runs/:id/reclaim');
      // …while the route that DOES write this field at open is still named, correctly.
      expect(d).toContain('POST /api/runs');
    });
  });
  ```

- [ ] **1.6 — Rewrite the docstring at `shared/api.ts:3613-3634` and go green.** The current text, quoted
  in full so the diff is auditable:

  ```ts
    /** The ONE coordinator that owns this run: the tmux-derived session id of
     *  the session that opened it, fixed at `POST /api/runs` and rewritten by no
     *  route afterwards. That immutability is the mechanism behind the
     *  `claimed-by-another` refusal — a second coordinator, in a fresh
     *  workspace, naming a programme this one already claimed is refused
     *  FOREVER, because nothing lowers this flag; recovering from it means
     *  reaching the original session or opening a new programme, never
     *  reassigning the run.
     *
     *  THE PWA READS IT AS THE PROGRAMME-OWNERSHIP EDGE: this field (the
     *  parent) paired with `sessionId` (the child, the worker this run
     *  dispatched) is what lets the fleet tree nest a worker under the
     *  coordinator that asked for it, instead of scattering both through one
     *  flat list. Server-side it is older than that use — `resolveCoordinator`
     *  reads it to address `toId:'coordinator'` mail — and this field is a
     *  READ of that same column, never a second copy of the decision.
     *
     *  `null` means no owner was recorded — a row from a database written
     *  before the column had a writer, or a hand-inserted recovery row. Absence
     *  permits: a renderer brackets nothing under a `null`, which is the honest
     *  answer, where a fabricated owner would nest a run under a coordinator
     *  that never claimed it. */
  ```

  The FULL replacement — paragraphs two and three are unchanged and true; paragraph one is narrowed and
  paragraph two of the new text is the retraction. Note it PARAPHRASES the three retracted claims rather
  than quoting them, deliberately: quoting would satisfy the `not.toContain` assertions' own targets and
  disarm them.

  ```ts
    /** The ONE coordinator that owns this run: the tmux-derived session id of
     *  the session that opened it, stamped at `POST /api/runs`. That stamp is the
     *  mechanism behind the `claimed-by-another` refusal — a second coordinator,
     *  in a fresh workspace, naming a programme this one already claimed is
     *  refused AT OPEN TIME, and no amount of retrying the open lowers the flag.
     *
     *  THAT IS THE WHOLE OF WHAT THE REFUSAL PROMISES, and it used to promise more
     *  (D-1125). Until this build the paragraph above went on to say the column is
     *  written once and by one route, that the second coordinator is turned away
     *  permanently, and that recovery never moves a run to a different session.
     *  All three were true of the tree that shipped them and none is true now: an
     *  operator door MEASURES the current claimant and, on a dead answer, moves
     *  every run of that programme — terminal rows included, because both readers
     *  of this column select the lowest-id claimed row with no state predicate, so
     *  a wave-1 `done` row left naming a corpse answers for the whole programme —
     *  to the named session inside one transaction. A LIVE claimant is still
     *  refused. What changed is not that a claim can be taken; it is that a corpse
     *  can be succeeded. The door is left unnamed here on purpose: nothing that
     *  reads this field calls it, and a wire type that teaches a call its own
     *  readers do not make is where a doc lie starts.
     *
     *  THE PWA READS IT AS THE PROGRAMME-OWNERSHIP EDGE: this field (the
     *  parent) paired with `sessionId` (the child, the worker this run
     *  dispatched) is what lets the fleet tree nest a worker under the
     *  coordinator that asked for it, instead of scattering both through one
     *  flat list. Server-side it is older than that use — `resolveCoordinator`
     *  reads it to address `toId:'coordinator'` mail — and this field is a
     *  READ of that same column, never a second copy of the decision.
     *
     *  `null` means no owner was recorded — a row from a database written
     *  before the column had a writer, or a hand-inserted recovery row. Absence
     *  permits: a renderer brackets nothing under a `null`, which is the honest
     *  answer, where a fabricated owner would nest a run under a coordinator
     *  that never claimed it. A succession leaves these rows exactly as it found
     *  them — it moves the rows that name somebody and never the rows that name
     *  nobody — so a reconstructed row cannot acquire an owner it never had. */
  ```

  Then `cd server && ./node_modules/.bin/vitest run test/resume-reclaim-l0.test.ts` — expect PASS except
  the two `mail-routes.test.ts` structural assertions from step 1.1.

- [ ] **1.7 — Measure the kebab scanner RED, then add the arm.** The arm cannot red on its own today:
  `mail-routes.test.ts:351-353`'s `sources()` reads every `.ts` under `server/src/coord`, and no file there
  spells either member until the L1 task creates `reclaim.ts`. So measure it with a throwaway that is legal
  under the wave's own rule (a declared union member may be spelled there, comments included) and revert it
  in the same step:
  1. append `// 'claimant-alive'` as the last line of `server/src/coord/kickoff.ts`;
  2. `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts` → **RED**, expected shape
     ``claimant-alive is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode or SessionLifecycle`` — record the exact first failing assertion;
  3. add the arm and widen the message (`mail-routes.test.ts:493-494`), plus the import at `:9`:

  ```ts
  import { MAIL_REJECT_CODES, RUN_REFUSE_CODES, isRunRefuseCode, isLifecycleGapReason, isClaimRefuseCode, isSessionLifecycle, isReclaimRefuseCode } from '../../shared/api.js';
  ```

  ```ts
          || isSessionLifecycle(tok)
          // PROGRAM-LEVERAGE WAVE 5 — the SIXTH union, checked together and never
          // merged, on the standing rule `enter-ignored` states above. `reclaim.ts`
          // lives in `server/src/coord` and spells both of its own refusals as
          // literals. It is a vocabulary of its own and not an extension of
          // `RunRefuseCode` FOR A REASON THIS SCANNER CANNOT SEE:
          // `coordinator-skill.test.ts` requires every `RunRefuseCode` member to be
          // named in the coordinator corpus, and this door is the operator's act on a
          // coordinator that is already dead — a live one reading about it has found a
          // recovery for a problem it does not have. Admitted through the exported
          // guard rather than NOT_CODES, for the reason the `LifecycleGapReason` note
          // above gives: an allowlist accepts one spelling for ever, a guard accepts a
          // member added later and still rejects a typo'd one.
          || isReclaimRefuseCode(tok),
          `${tok} is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle or ReclaimRefuseCode`).toBe(true);
  ```

  4. re-run `test/mail-routes.test.ts` → **GREEN** with the throwaway still in place (that is the
     before/after this step exists for);
  5. **delete the throwaway line from `server/src/coord/kickoff.ts`** and re-run once more, still green.
     `git diff --stat server/src/coord/kickoff.ts` must come back empty before the commit.

- [ ] **1.8 — Run the neighbours the additions could trip, and record that they did not:**

  ```bash
  cd server && ./node_modules/.bin/vitest run \
    test/resume-reclaim-l0.test.ts test/mail-routes.test.ts \
    test/peers-claims-l0.test.ts test/single-definition.test.ts \
    test/coordinator-skill.test.ts test/typecheck-tests.test.ts
  ```

  Expected PASS, all six, and each for a reason measured in advance: `peers-claims-l0.test.ts:156-162`
  pins `shared/api.ts` to exactly one import line and this task adds none; `single-definition.test.ts`'s
  programs-path allowlist (`:610-630`) matches on line TEXT and `programResumeKickoff` reaches the path
  only through `ledgerPath(slug)`, exactly as `programKickoff` already does; its Build-7-nouns scans
  (`:335-366`) name specific symbols and see nothing new; `coordinator-skill.test.ts:318-321`'s census is
  unmoved because the union is not a `RunRefuseCode`; `typecheck-tests.test.ts` compiles the new file under
  `test/tsconfig.tests.json`, whose `include` carries `../../shared/**/*.ts`.

- [ ] **1.9 — Fill the mutation table.** Apply each mutation, run the named suite, record the exact first
  failing assertion, revert. Rows 1 and 3 also produce a `tsc` error in `typecheck-tests.test.ts` — record
  which of the two fired first and say so, rather than reporting the runtime one as if it were alone.

| mutation | first-fail assertion |
| --- | --- |
| `RECLAIM_REFUSE_CODE_MAP` loses `'no-claimant': true` | `<measured at execution>` |
| `RECLAIM_REFUSE_CODES` becomes the hand-written `['claimant-alive', 'no-claimant']` | `<measured at execution>` |
| `RECLAIM_REFUSE_CODE_MAP` gains a third entry the union does not declare | `<measured at execution>` |
| `isReclaimRefuseCode` body becomes `return typeof v === 'string' && v in RECLAIM_REFUSE_CODE_MAP;` | `<measured at execution>` |
| `isReclaimRefuseCode` body becomes `return v === 'no-claimant';` | `<measured at execution>` |
| `'claimant-alive'` is added to `RunRefuseCode` and `RUN_REFUSE_CODE_MAP` | `<measured at execution>` |
| `'claimant-alive'` is renamed `'alive'` (single word, invisible to the coord scanner) | `<measured at execution>` |
| one word of `resume.md` §4's brief block is changed, `programResumeKickoff` untouched | `<measured at execution>` |
| one word of `programResumeKickoff`'s template is changed, `resume.md` untouched | `<measured at execution>` |
| `programResumeKickoff`'s line 2 is inlined as `` `Its ledger is \`docs/superpowers/programs/${slug}.md\`.\n` `` | `<measured at execution>` |
| `programResumeKickoff`'s last line is replaced with `programKickoff`'s (`…and open the run for wave 1.`) | `<measured at execution>` |
| the old `claimedBy` docstring is restored verbatim | `<measured at execution>` |
| `POST /api/runs/:id/reclaim` is added to the new `claimedBy` docstring | `<measured at execution>` |
| `claimedBy` is moved above `state` in `RunSummary` (the docstring slice comes back empty) | `<measured at execution>` |
| `\|\| isReclaimRefuseCode(tok)` is deleted from `mail-routes.test.ts`, with `// 'claimant-alive'` appended to `server/src/coord/kickoff.ts` | `<measured at execution>` |
| `\|\| isReclaimRefuseCode(tok)` is deleted and both members are added to `NOT_CODES` instead | `<measured at execution>` |

- [ ] **1.10 — Commit:**

```bash
cd "$(git rev-parse --show-toplevel)"
git status --porcelain server/src/coord/kickoff.ts   # must be EMPTY — step 1.7's throwaway is reverted
git add shared/api.ts server/test/resume-reclaim-l0.test.ts server/test/mail-routes.test.ts
git commit -m "feat(wave5): the L0 reclaim vocabulary, the resume kickoff, and claimedBy's corrected docstring"
```
---

## Task 2: the store commit — one transaction, every run, one moment

**Files:** `server/src/coord/store.ts`, `server/test/coord-store.test.ts`.

> **LEAD'S NOTE — the two ledger numbers this task's findings are filed under.** Cite them in the
> shipped comments, not only here. **D-1134** is `recordRunEvent` owning its own clock: one operator act
> writing N attribution rows would land them at N instants, and a trail that shows one act as N moments
> cannot be read back as one act — hence the caller's `at`, defaulted so every existing call site is
> byte-identical. **D-1135** is the disagreement this task deliberately does not inherit: `TERMINAL_RUN_STATES`
> derives THREE words from `RUN_TRANSITIONS` while eight SQL predicates in this same file hand-write two,
> and the store's own docstring calling them "the same two words" is already wrong. Ruling R1 means
> `reclaimProgram`'s `WHERE` carries **no state predicate at all**, so this task sidesteps the
> disagreement rather than picking a side — say so in the method's docstring beside the R1 argument, so
> the next reader knows the omission is a decision.


**Depends on Task 1 (L0).** `reclaimProgram`'s refusal union puts the literal `no-claimant` inside `server/src/coord/`, and `mail-routes.test.ts:383-497`'s kebab-token scanner (`sources()` = every `.ts` under `server/src/coord`, `mail-routes.test.ts:351-353`) accepts a token only through `MAIL_REJECT_CODES`, `isRunRefuseCode`, `isLifecycleGapReason`, `isClaimRefuseCode` or `isSessionLifecycle`. `unknown-run` already passes — it is a `MailRejectCode` (`shared/api.ts:3424`) — but `no-claimant` passes only once Task 1 has shipped `isReclaimRefuseCode` **and** added the `|| isReclaimRefuseCode(tok)` arm. If Task 1 has not landed, step 2.7 will red on that scanner and that is the ordering telling you so, not a defect in this task.

- [ ] **2.1 — Write `recordRunEvent`'s `at` guard FIRST and measure it red.** Append to `server/test/coord-store.test.ts` (the file ends at `:1419`; `describe('CoordStore: runs', …)` at `:22` is where run-lifecycle facts live, so the new block goes at the bottom of the file beside its siblings). Vitest transpiles without typechecking, so a 4th argument to today's 3-parameter method is *dropped at runtime*, not a compile error — the red is a real assertion, which is what makes it worth measuring:

  ```ts
  describe('CoordStore.recordRunEvent — the caller owns the moment', () => {
    it('stamps the moment it is given, and still reads the clock when it is not', () => {
      // `markDispatchStarted` (store.ts:739-741) already states the precedent this
      // widening applies: "the caller owns the moment being recorded." The default
      // is what keeps dispatch.ts:370/409/615 byte-identical.
      const s = store();
      const r = openRun(s) as { id: number };
      s.recordRunEvent(r.id, 'coordinator', 'skill-preflight:absent', 1_700_000_000_000);
      const before = Date.now();
      s.recordRunEvent(r.id, 'coordinator', 'skill-preflight:present');
      const [given, defaulted] = s.runEvents(r.id);
      expect(given!.at).toBe(1_700_000_000_000);
      expect(defaulted!.at).toBeGreaterThanOrEqual(before);
    });
  });
  ```

  Run `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts` (foreground, timeout 600000) and **record the first failing assertion text verbatim**.

- [ ] **2.2 — Widen the signature, then re-run green.** In `server/src/coord/store.ts`, change `:485` and `:491` and APPEND a paragraph to the existing docstring (which already ends at `:484` with the notify-lane amendment — amend it, do not replace it, the way that paragraph itself was amended):

  ```ts
   * `at` IS THE CALLER'S NOW (wave 5). The `markDispatchStarted`/`markDispatched`
   * precedent, said there in full: "the caller owns the moment being recorded."
   * Defaulted, so every existing call site (`dispatch.ts:370`, `:409`, `:615`) is
   * unchanged — one call site, one fact, one clock read. The reason it had to
   * become a parameter: a batch that writes N attribution rows for ONE operator
   * act must stamp them with ONE moment, or the trail says the operator acted N
   * times. `reclaimProgram` below is that batch.
   */
  recordRunEvent(runId: number, causedBy: string, detail: string, at: number = Date.now()): void {
    const row = this.db.prepare('SELECT state FROM runs WHERE id = ?').get(runId) as
      { state: string } | undefined;
    if (!row) return;
    this.db.prepare(
      'INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(runId, at, row.state, row.state, causedBy, detail);
  }
  ```

  Re-run `test/coord-store.test.ts` — green.

- [ ] **2.3 — Write the whole `reclaimProgram` suite and measure it red.** Append below the block from 2.1. The fixture is built so a non-terminal-only rewrite CANNOT pass it — that is the operator ruling R1 turned into a mechanism:

  ```ts
  describe('CoordStore.reclaimProgram — the whole program, in one transaction', () => {
    const DEAD = 'ccrc-pwa-old-coordinator';
    const LIVE = 'ccrc-pwa-new-coordinator';

    /** The program as the wedge is actually found: five waves opened by ONE
     *  coordinator, wave 1 already closed. The closed row is the LOWEST id, and
     *  lowest-id-claimed is exactly the row both `claimedBy` readers pick
     *  (store.ts:370 and store.ts:1189, both `ORDER BY id LIMIT 1` with no state
     *  predicate). A fixture whose waves were all still open could not tell a
     *  whole-program rewrite from a non-terminal-only one — it would pass both. */
    const fiveWaves = (s: CoordStore): number[] => {
      const ids: number[] = [];
      for (let w = 1; w <= 5; w++) {
        ids.push((openRun(s, { wave: w, waveOf: 5, claimedBy: DEAD }) as { id: number }).id);
      }
      expect(s.advance(ids[0]!, 'dispatched', 'coordinator')).toMatchObject({ ok: true });
      expect(s.advance(ids[0]!, 'closing', 'coordinator')).toMatchObject({ ok: true });
      expect(s.advance(ids[0]!, 'done', 'coordinator')).toMatchObject({ ok: true });
      expect(s.run(ids[0]!)!.state).toBe('done');   // anti-vacuity: the fixture is really terminal
      return ids;
    };

    it('rewrites the TERMINAL run too, so the next wave stops being refused (R1)', () => {
      const s = store();
      const ids = fiveWaves(s);
      expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000))
        .toEqual({ ok: true, program: 'build4', runIds: ids, from: DEAD });
      // The closed wave-1 row is the whole assertion: it is the id both readers
      // reach first, and a rewrite that skipped it leaves them on the corpse.
      expect(s.run(ids[0]!)!.state).toBe('done');
      expect(ids.map((id) => s.run(id)!.claimedBy)).toEqual([LIVE, LIVE, LIVE, LIVE, LIVE]);
      expect(s.resolveCoordinator(null)).toBe(LIVE);
      expect(openRun(s, { wave: 6, waveOf: 6, claimedBy: LIVE })).toMatchObject({ state: 'planned' });
    });

    it('leaves a reconstructed row NULL rather than inventing a claimant for it (D-12)', () => {
      const s = store();
      const ids = fiveWaves(s);
      // `reconstruct` mints every rebuilt run with `claimedBy` NULL — it cannot
      // know who will resume the program — and D-12's clause (store.ts:361-368)
      // exists to SKIP those rows. Written with the store's own handle, the shape
      // this file already uses at :65 for a row no public method can produce.
      s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(ids[2]!);
      expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000))
        .toEqual({ ok: true, program: 'build4', runIds: [ids[0]!, ids[1]!, ids[3]!, ids[4]!], from: DEAD });
      expect(s.run(ids[2]!)!.claimedBy).toBeNull();
      expect(s.runEvents(ids[2]!)).toEqual([]);     // and no trail invented for it either
    });

    it('writes one attribution row per rewritten run, every one carrying the SAME moment', () => {
      const s = store();
      const ids = fiveWaves(s);
      const at = 1_777_000_123_456;
      s.reclaimProgram(ids[4]!, LIVE, at);
      for (const id of ids) {
        const mine = s.runEvents(id).filter((e) => e.causedBy === 'operator');
        expect(mine.length).toBe(1);
        expect(mine[0]!.at).toBe(at);
        expect(mine[0]!.detail).toBe(`reclaim:${DEAD} -> ${LIVE}`);
        // A non-transition encoded as one — `fromState === toState`, which is also
        // what keeps the row off the notify lane (store.ts:481-484).
        expect(mine[0]!.fromState).toBe(mine[0]!.toState);
      }
      const ats = ids.flatMap((id) =>
        s.runEvents(id).filter((e) => e.causedBy === 'operator').map((e) => e.at));
      expect(ats.length).toBe(5);
      expect(new Set(ats).size).toBe(1);           // one operator act, one moment, not five
    });

    it('a `to` that is already the claimant is a no-op SUCCESS — never a refusal, never a trail', () => {
      const s = store();
      const ids = fiveWaves(s);
      const before = ids.flatMap((id) => s.runEvents(id)).length;
      expect(s.reclaimProgram(ids[4]!, DEAD, 1_777_000_000_000))
        .toEqual({ ok: true, program: 'build4', runIds: [], from: DEAD });
      expect(ids.flatMap((id) => s.runEvents(id)).length).toBe(before);
      expect(ids.map((id) => s.run(id)!.claimedBy)).toEqual([DEAD, DEAD, DEAD, DEAD, DEAD]);
    });

    it('refuses an id no run carries, and a run whose claimant is NULL — writing nothing either way', () => {
      const s = store();
      const ids = fiveWaves(s);
      expect(s.reclaimProgram(ids[4]! + 999, LIVE, 1_777_000_000_000))
        .toEqual({ ok: false, kind: 'unknown-run' });
      s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(ids[4]!);
      expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000))
        .toEqual({ ok: false, kind: 'no-claimant' });
      // The refusal returned BEFORE the UPDATE: the other four rows are untouched.
      expect(s.run(ids[0]!)!.claimedBy).toBe(DEAD);
    });

    it('is ONE transaction — an attribution row that throws rolls the whole rewrite back', () => {
      const s = store();
      const ids = fiveWaves(s);
      // The property `tx()` buys (db.ts:245-257, `BEGIN IMMEDIATE`) and the reason
      // this method may not be three public store calls in a row: a crash between
      // the UPDATE and the attribution rows leaves a program whose runs name a
      // coordinator no `run_events` row ever says arrived. Patched on the instance
      // because nothing else in this store can be made to fail on demand.
      const patched = s as unknown as { recordRunEvent: () => void };
      patched.recordRunEvent = () => { throw new Error('attribution failed'); };
      expect(() => s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toThrow('attribution failed');
      expect(ids.map((id) => s.run(id)!.claimedBy)).toEqual([DEAD, DEAD, DEAD, DEAD, DEAD]);
    });
  });
  ```

  Run `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts` and **record the exact first failing assertion verbatim** (expected: `TypeError: s.reclaimProgram is not a function`).

- [ ] **2.4 — Declare the result union.** In `server/src/coord/store.ts`, immediately after `AdvanceResult` (`:71-74`), beside the file's four other named result unions (`OpenRunResult` `:67`, `SetWorkItemResult` `:87`, `SettleItemsResult` `:97`, `ClaimEndResult` `:118`) — a named alias, not a shape change:

  ```ts
  /** The reclaim's three answers. `kind`, not `error`, because these are not
   *  `advance`'s arms and folding them into `AdvanceResult` would put two
   *  vocabularies behind one discriminant. `unknown-run` is spelled the way its
   *  `MailRejectCode` twin is (shared/api.ts:3424); `no-claimant` is this wave's
   *  own word, admitted to `mail-routes.test.ts`'s scanner through Task 1's
   *  exported guard rather than an allowlist entry — the standing remedy that
   *  file states for every union after the first. */
  export type ReclaimProgramResult =
    | { ok: true; program: string; runIds: number[]; from: string }
    | { ok: false; kind: 'unknown-run' }
    | { ok: false; kind: 'no-claimant' };
  ```

- [ ] **2.5 — Write `reclaimProgram`.** Insert it immediately after `openRun`'s closing brace (`store.ts:410`), before `advance`'s docstring at `:412` — it belongs next to the guard it exists to unwedge:

  ```ts
  /**
   * The whole reclaim commit, as ONE transaction — `dispatchRun`/`closeRun`'s
   * shape (D-277's argument applied to a batch instead of a sequence). It is
   * ONE `tx()` and it calls no public method that opens its own: `DatabaseSync`
   * transactions do not nest, the rule `advanceInner`'s docstring (:428-434)
   * states in full. `recordRunEvent` below is safe here for the same reason
   * `cancelOutstandingDeliveries` is safe inside `closeRun` — it holds no `tx()`.
   *
   * EVERY RUN OF THE PROGRAM IS REWRITTEN, TERMINAL ONES INCLUDED (operator
   * ruling R1). Both readers of this column — `openRun`'s one-coordinator guard
   * (:369-371) and `resolveCoordinator(null)` (:1188-1190) — run
   * `SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL
   * ORDER BY id LIMIT 1`, with NO state predicate and lowest id first. On a
   * program standing at wave 5 the lowest claimed id IS wave 1's closed run, so
   * a rewrite scoped to non-terminal runs leaves both readers answering the dead
   * session and the wedge outlives the door built to clear it. Terminality is
   * about what may still HAPPEN to a run; this column is about who is driving
   * the program, and those are not the same question.
   *
   * A row whose `claimedBy` IS NULL STAYS NULL. `reconstruct` mints rebuilt runs
   * that way because it cannot know who will resume the program, and D-12's
   * clause exists to skip them; writing a claimant into one here would hand the
   * guard a row it was deliberately taught to ignore.
   *
   * `causedBy` is the literal `operator`, hardcoded at this one call site and
   * never read from a request body. Attribution, not authentication
   * (spec:26-30) — and on an operator door that carries no box token, a
   * body-supplied `causedBy` is a free-text field writing the audit trail.
   */
  reclaimProgram(runId: number, to: string, at: number): ReclaimProgramResult {
    return tx(this.db, () => {
      const run = this.db.prepare('SELECT program, claimedBy FROM runs WHERE id = ?')
        .get(runId) as { program: string; claimedBy: string | null } | undefined;
      if (!run) return { ok: false as const, kind: 'unknown-run' as const };
      // Refused BEFORE the UPDATE, so a refusal writes nothing at all: an
      // unclaimed run names no handover to make, and rewriting its siblings off a
      // row that never had a claimant is a reassignment nobody asked for.
      if (run.claimedBy === null) return { ok: false as const, kind: 'no-claimant' as const };
      // Read before the write, and excluding rows ALREADY naming `to`: the
      // attribution rows record a CHANGE, so re-running the same reclaim writes
      // none rather than a second identical trail. `ORDER BY id` so `runIds` is
      // the same list twice — the query planner may reach these rows through
      // `runs_by_program` (schema.ts:88) rather than by rowid.
      const moved = this.db.prepare(
        'SELECT id, claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ' +
        'AND claimedBy != ? ORDER BY id',
      ).all(run.program, to) as { id: number; claimedBy: string }[];
      this.db.prepare('UPDATE runs SET claimedBy = ? WHERE program = ? AND claimedBy IS NOT NULL')
        .run(to, run.program);
      for (const m of moved) {
        // One `at` for N rows: the operator acted once, and a trail that reads
        // five clock samples describes five acts.
        this.recordRunEvent(m.id, 'operator', `reclaim:${m.claimedBy} -> ${to}`, at);
      }
      return {
        ok: true as const, program: run.program,
        runIds: moved.map((m) => m.id), from: run.claimedBy,
      };
    });
  }
  ```

- [ ] **2.6 — Amend `openRun`'s guard comment, which now says something false.** `store.ts:372-374` reads "A second coordinator is refused, in words, rather than silently allowed to interleave dispatches with the first one's." That still holds AT OPEN TIME and stops holding as a statement about the program's life. Replace those three lines with:

  ```ts
      // spec:291-292: multi-coordinator arbitration is a NON-GOAL. A second
      // coordinator is refused AT OPEN TIME, in words, rather than silently
      // allowed to interleave dispatches with the first one's. What this refusal
      // no longer means is "forever": `reclaimProgram` above rewrites the column
      // this reads, for a claimant measured dead. The refusal is still the only
      // answer to two LIVE coordinators — nothing arbitrates between them — and
      // that is the non-goal spec:291-292 actually names.
  ```

  Do NOT touch `RunSummary.claimedBy`'s docstring (`shared/api.ts:3612-3634`) — Task 1 owns that rewrite, and two tasks editing one docstring is a merge conflict for no gain.

- [ ] **2.7 — Green, including every scanner this diff can reach.** `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/mail-routes.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts` — foreground, timeout 600000. `mail-routes.test.ts` is the one that can red on a Task-1 ordering error (see this task's header); `single-definition.test.ts:402-437` is the ring pin — `store.ts` is in `HANDLE_HOLDERS`, so it stays green, and confirming that rather than assuming it is the point of running it.

- [ ] **2.8 — Measure every mutation and fill the table in.** For each row: apply the mutation, run `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts`, paste the first failing assertion **verbatim**, revert. A row that comes back green is a guard that does not exist.

  | mutation | first-fail assertion |
  |---|---|
  | `recordRunEvent`'s body writes `Date.now()` again, ignoring `at` | `<measured at execution>` |
  | `reclaimProgram`'s SELECT and UPDATE both gain `AND state NOT IN ('done','failed')` | `<measured at execution>` |
  | `AND claimedBy IS NOT NULL` dropped from the UPDATE | `<measured at execution>` |
  | `AND claimedBy != ?` dropped from the SELECT | `<measured at execution>` |
  | the `run.claimedBy === null` refusal deleted | `<measured at execution>` |
  | the `!run` refusal deleted | `<measured at execution>` |
  | the `tx(this.db, …)` wrapper removed — the statements run bare | `<measured at execution>` |
  | the 4th argument dropped from the `this.recordRunEvent(...)` call inside the loop | `<measured at execution>` |

- [ ] **2.9 — Commit.**

  ```
  git add server/src/coord/store.ts server/test/coord-store.test.ts \
    && git commit -m "feat(coord): reclaimProgram — one transaction, every run of the program, one moment"
  ```
---

## Task 3: the dead-proof guard — `server/src/coord/reclaim.ts`

**Files:** `server/src/coord/reclaim.ts` (new), `server/test/coord-reclaim.test.ts` (new),
`server/test/mail-routes.test.ts` (one allowlist entry).

> **LEAD'S NOTE — two more ledger numbers belong to this task's ladder; cite both.**
> **D-1136** is the no-op arm: `to === from` must not be a refusal (an operator re-typing the id the
> board already shows is asking for nothing), but WHERE it sits is the decision — at the top of the
> ladder it would skip the destination's own registry read, so a typo that happened to match the current
> claimant would answer `ok` without proving the id exists. It sits at the aliveness rung, and its
> fixture uses a LIVE claimant, which is the case a top-of-ladder placement would also pass and a
> bottom-of-ladder one would wrongly refuse.
> **D-1140** is the third rung's honest limit: `otherwise ⇒ alive` is total, so a `gone` pane whose
> lifecycle reads `unmeasurable` answers `alive` and the door refuses `claimant-alive` for a pane nobody
> measured. The REFUSAL is right — fail-shut is the only safe direction for a destructive re-pointing —
> and only the word is wrong. Do not split it into a fourth arm (a caller branches identically); put the
> argument in the `otherwise` branch's own comment, and make sure `why` names which of the three inputs
> produced it, because the sheet is required to render `detail` rather than the code alone.


**What this task is.** `reclaimRun` overwrites `runs.claimedBy` — the one column that says who owns a
program. `openRun`'s guard (`store.ts:356-369`) and `resolveCoordinator(null)` (`store.ts:1179+`) both
read it with no state predicate, so the value this task writes decides who the whole coordination
surface answers for the rest of the program's life. The act is destructive and one-way; the only thing
standing in front of it is a measurement. **The measurement has THREE answers, never two**, and this
task's entire content is which inputs land in which answer and which reads are forbidden because they
cannot tell them apart.

**The three-answer argument, and the census of inputs.**

- **`dead`** — reclaim may proceed. Reached from exactly two inputs: (a) the registry directory
  **listed cleanly** and carried no row for this id; (b) a listed row whose pane tmux calls `gone`
  **and** whose lifecycle is one of the three words `lifecycleIsDead` names — `stopped`, `orphan`,
  `never-started` (`shared/api.ts:1663-1673`).
- **`alive`** — refuse, with evidence. Two inputs that are the same *answer*: (a) tmux says the pane is
  `live`; (b) the pane is `gone` **but** the lifecycle reads `running`, `unsupervised`, `unclaimed`,
  `restarting` or `unmeasurable`. `restarting` is the arm this file exists to keep: a supervisor is
  bringing the session back, and a naive `!alive` folds it straight into the reclaim. They are told
  apart by the `why` string, not by a fourth union arm nobody would branch on.
- **`unmeasurable`** — refuse, and say nothing about the claimant. Two inputs: (a) the registry
  directory did not list at all; (b) tmux did not answer (`{verdict:'unknown', detail}`). Doubt is not
  evidence in either direction — the identical line `LIFECYCLE_DEAD` draws for its own `unmeasurable`
  key (`shared/api.ts:1668-1670`), drawn again for the whole ladder.

**Why `Tmux.hasSession` is forbidden here.** Its own docstring forbids it in as many words
(`server/src/exec.ts:117-120`): *"Derived, exactly like bash `_alive`: true only for `live`. A caller
that handles `gone` differently from `unknown` must use `sessionVerdict` instead."* This caller **is**
that caller — `gone` continues down to the lifecycle rung, `unknown` refuses outright — and
`hasSession` returns `false` for both, so a ladder built on it reports a tmux server that never
answered as proof the coordinator died. `SessionVerdict`'s own docstring (`exec.ts:75-81`) says why the
three exist: `tmux has-session` "answers three different questions with one exit status … and only the
first is evidence a session died." The contract closes this structurally rather than by convention —
`ReclaimDeps.tmux` is declared as a **one-method port**, so the boolean is not reachable from this file
at all.

**Why `readRegistry` is forbidden.** `readRegistry` (`server/src/registry.ts:853-856`) is two lines over
`readRegistryMeasured` ending `r.listed ? r.records : []` — an unlistable directory arrives wearing the
exact shape "nobody is in the registry" wears. Fed to this ladder it would report a fleet-wide outage as
proof the coordinator is gone. That is precisely the fail-open `dispatchRun` already had to close on
its own registry read (`server/src/coord/dispatch.ts:462-480`, blocking review finding 7: *"`record`
used to come back `undefined` for TWO different facts this function must tell apart"*). `readSessionRecord`
(`registry.ts:895`) answers `unlistable` and `absent` separately (`SingleRead`, `registry.ts:863-866`)
and this file keeps them separate all the way to the wire.

- [ ] **3.1 — Write `coord-reclaim.test.ts`'s header, fixtures and the six ladder cases; measure it RED.**
  Written before the module exists, so the first failure is a resolution failure and the second is a
  real assertion. Fixture idioms lifted from `coord-kickoff.test.ts:22-35` (the `store()` + `mkTmp`
  pair, the throwing narrower) and `kickoff-route.test.ts:32-41` (the registry `seed`).

  ```ts
  // program-leverage wave 5 (F5) — the dead-proof guard. TDD red-first: this file
  // was written and run before `src/coord/reclaim.ts` existed, to confirm it failed
  // for the right reason.
  //
  // What is pinned HERE is the LADDER — which input collapses into which of the
  // three answers — and not the route, which is a union->status map with its own
  // file. The asymmetry is why the fixtures are per-rung rather than per-answer:
  // refusing a live coordinator's reclaim costs the operator a retry, while
  // reclaiming a live one puts two coordinators on one program, which spec:291-292
  // calls a non-goal precisely because nothing in this build arbitrates it.
  import { describe, it, expect } from 'vitest';
  import path from 'node:path';
  import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  import { measureClaimant, reclaimRun, type ReclaimDeps } from '../src/coord/reclaim.js';
  import { localIO, type FleetIO } from '../src/io.js';
  import type { SessionVerdict } from '../src/exec.js';
  import { testDeps } from './helpers.js';
  import { mkTmp } from './tmpHelpers.js';

  const NOW = 1_000_000_000_000;            // epoch MILLISECONDS, the units the ladder takes
  const SEC = Math.floor(NOW / 1000);       // …and what ccd's `date +%s` actually writes to $REG
  const DEAD = 'demo-quiet-mesa';           // the coordinator being replaced
  const LIVE = 'demo-brisk-fen';            // the session taking over
  const PROGRAM = 'f5-demo';

  const GONE: SessionVerdict = { verdict: 'gone' };
  const ALIVE: SessionVerdict = { verdict: 'live' };

  /** The registry row ccd writes, minus whatever a fixture wants absent. `stopped`
   *  and `supervised` are epoch SECONDS here because that is what is on disk —
   *  `lifecycleInputFor` owns the one x1000 (fleet.ts:171-185). */
  const seedRow = (home: string, id: string, extra: Record<string, string> = {}): void => {
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields: Record<string, string> = {
      wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`,
      started: '1', workspace: id, branch: `ws/${id}`, base: 'origin/main', ...extra,
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  };

  const store = (home: string): CoordStore =>
    new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

  /** The tmux port pinned to ONE verdict. This is what the contract's one-method
   *  port buys the tests: a fixture STATES the substrate's answer instead of
   *  scripting an exec runner into producing it — and it cannot state the
   *  `hasSession` boolean at all, because the port has no such method. */
  const depsFor = (home: string, coord: CoordStore, verdict: SessionVerdict,
                   io: FleetIO = localIO): ReclaimDeps =>
    ({ coord, io, cfg: testDeps(home).cfg, tmux: { sessionVerdict: async () => verdict } });

  const blindIO = (): FleetIO => ({ ...localIO, readdir: async () => null });

  describe('measureClaimant — three answers, and the inputs that collapse into each', () => {
    it('an unlistable registry is UNMEASURABLE, never dead', async () => {
      // The fail-open shape dispatch.ts:462-480 had to close, one ring up: an
      // outage must not read as a death certificate for a session it never saw.
      const home = mkTmp('ccrc-reclaim-');
      seedRow(home, DEAD);
      const v = await measureClaimant(depsFor(home, store(home), GONE, blindIO()), DEAD, NOW);
      expect(v.state).toBe('unmeasurable');
      expect(v.why).toContain('could not be listed');
    });

    it('no row in a directory that listed cleanly is DEAD', async () => {
      const home = mkTmp('ccrc-reclaim-');
      seedRow(home, LIVE);                 // somebody IS listed — the listing is real, DEAD is not in it
      const v = await measureClaimant(depsFor(home, store(home), GONE), DEAD, NOW);
      expect(v.state).toBe('dead');
      expect(v.why).toContain('listed cleanly');
    });

    it('a live pane is ALIVE, and the lifecycle is never consulted', async () => {
      // The row carries a stop stamp, which `sessionLifecycle` reads as `stopped`
      // — a dead word. tmux outranks it: the pane is THERE. A ladder that read the
      // registry last would answer `dead` about a session an operator is typing in.
      const home = mkTmp('ccrc-reclaim-');
      seedRow(home, DEAD, { stopped: `${SEC} ccd` });
      const v = await measureClaimant(depsFor(home, store(home), ALIVE), DEAD, NOW);
      expect(v.state).toBe('alive');
      expect(v.why).toContain('tmux');
    });

    it('tmux that did not answer is UNMEASURABLE, and carries tmux\'s own words', async () => {
      const home = mkTmp('ccrc-reclaim-');
      seedRow(home, DEAD);
      const detail = 'no server running on /tmp/tmux-1000/default';
      const v = await measureClaimant(
        depsFor(home, store(home), { verdict: 'unknown', detail }), DEAD, NOW);
      expect(v.state).toBe('unmeasurable');
      expect(v.why).toBe(detail);          // verbatim: the message IS the diagnosis (D-309)
    });

    it('gone + a stop stamp is DEAD', async () => {
      const home = mkTmp('ccrc-reclaim-');
      seedRow(home, DEAD, { stopped: `${SEC} ccd` });
      const v = await measureClaimant(depsFor(home, store(home), GONE), DEAD, NOW);
      expect(v.state).toBe('dead');
      expect(v.why).toContain('stopped');
    });

    it('gone + a FRESH supervisor heartbeat is ALIVE — the arm a bare !alive folds', async () => {
      // THE ARM THIS FILE EXISTS FOR. `supervised` is stamped at NOW, so
      // `nowMs - supervisedAt*1000 === 0`: fresh, and the lifecycle is `restarting`.
      // A supervisor is bringing this session back and the reclaim must not race it.
      const home = mkTmp('ccrc-reclaim-');
      seedRow(home, DEAD, { supervised: String(SEC) });
      const v = await measureClaimant(depsFor(home, store(home), GONE), DEAD, NOW);
      expect(v.state).toBe('alive');
      expect(v.why).toContain('restarting');
    });
  });
  ```

  Run `cd server && ./node_modules/.bin/vitest run test/coord-reclaim.test.ts` (foreground, timeout
  600000) and **record the exact first failing assertion text verbatim** in the execution record.

- [ ] **3.2 — Add the `reclaimRun` cases, including the watcher that proves nothing was written.**
  A refusal that still committed is the failure mode a status-code-only assertion cannot see, so every
  refusal fixture asserts three independent facts: the answer, that `reclaimProgram` was never entered,
  and that the column did not move.

  ```ts
  const seedRun = (s: CoordStore, claimedBy: string, wave = 1): number => {
    const r = s.openRun({ program: PROGRAM, title: 'F5 demo', project: 'demo',
      wave, waveOf: 2, claimedBy });
    if ('refused' in r) throw new Error(`fixture: openRun refused (${r.refused})`);
    return r.id;
  };

  /** Counts the commit WITHOUT stubbing it out — the delegate still runs, so a test
   *  asserting both "never entered" and "claimedBy unchanged" is asserting two
   *  independent facts rather than one fact twice. */
  const watchCommit = (s: CoordStore): { calls: number } => {
    const seen = { calls: 0 };
    const real = s.reclaimProgram.bind(s);
    s.reclaimProgram = ((runId: number, to: string, at: number) => {
      seen.calls += 1;
      return real(runId, to, at);
    }) as CoordStore['reclaimProgram'];
    return seen;
  };

  describe('reclaimRun — the order is the guard', () => {
    it('unknown-run for an id no row carries', async () => {
      const home = mkTmp('ccrc-reclaim-');
      seedRow(home, LIVE);
      const r = await reclaimRun(depsFor(home, store(home), GONE), 9999, LIVE);
      expect(r).toEqual({ ok: false, kind: 'unknown-run' });
    });

    it('no-claimant for a reconstructed row whose claimedBy is NULL', async () => {
      const home = mkTmp('ccrc-reclaim-');
      const s = store(home);
      const id = seedRun(s, DEAD);
      // The shape `reconstruct` inserts and `openRun`'s D-12 clause skips: a row
      // rebuilt from ccd's flat files, which cannot know who will resume it. Ruling
      // R1 leaves these NULL, so this door must refuse rather than adopt one.
      s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(id);
      seedRow(home, LIVE);
      const r = await reclaimRun(depsFor(home, s, GONE), id, LIVE);
      expect(r).toEqual({ ok: false, kind: 'no-claimant' });
    });

    it('unknown-session when the INCOMING coordinator has no registry row', async () => {
      const home = mkTmp('ccrc-reclaim-');
      const s = store(home);
      const id = seedRun(s, DEAD);
      seedRow(home, DEAD);                 // the listing is real; only LIVE is missing from it
      const w = watchCommit(s);
      const r = await reclaimRun(depsFor(home, s, GONE), id, LIVE);
      expect(r).toEqual({ ok: false, kind: 'unknown-session' });
      expect(w.calls).toBe(0);
      expect(s.run(id)!.claimedBy).toBe(DEAD);
    });

    it('registry-unmeasurable when the directory will not list — and NOTHING is written', async () => {
      const home = mkTmp('ccrc-reclaim-');
      const s = store(home);
      const id = seedRun(s, DEAD);
      seedRow(home, DEAD); seedRow(home, LIVE);
      const w = watchCommit(s);
      const r = await reclaimRun(depsFor(home, s, GONE, blindIO()), id, LIVE);
      expect(r).toMatchObject({ ok: false, kind: 'registry-unmeasurable' });
      expect(w.calls).toBe(0);
      expect(s.run(id)!.claimedBy).toBe(DEAD);
      expect(s.runEvents(id)).toEqual([]);   // openRun writes no event, so [] is a real "untouched"
    });

    it('claimant-alive when the current coordinator answers — and NOTHING is written', async () => {
      const home = mkTmp('ccrc-reclaim-');
      const s = store(home);
      const id = seedRun(s, DEAD);
      seedRow(home, DEAD); seedRow(home, LIVE);
      const w = watchCommit(s);
      const r = await reclaimRun(depsFor(home, s, ALIVE), id, LIVE);
      expect(r).toMatchObject({ ok: false, kind: 'claimant-alive', by: DEAD });
      if (r.ok) throw new Error('unreachable — narrowed above');
      expect(r.kind === 'claimant-alive' && r.detail).toContain('tmux');
      expect(w.calls).toBe(0);
      expect(s.run(id)!.claimedBy).toBe(DEAD);
    });

    it('rewrites EVERY run of the program, terminal rows included (ruling R1)', async () => {
      const home = mkTmp('ccrc-reclaim-');
      const s = store(home);
      const w1 = seedRun(s, DEAD, 1);
      const w2 = seedRun(s, DEAD, 2);
      // Wave 1 has finished. It is the row `openRun`'s guard (store.ts:365-368) and
      // `resolveCoordinator(null)` both read FIRST — `ORDER BY id LIMIT 1`, with no
      // state predicate — so a terminal-sparing rewrite leaves both readers still
      // answering the corpse, and the wedge survives the reclaim.
      s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(w1);
      seedRow(home, DEAD, { stopped: `${SEC} ccd` });
      seedRow(home, LIVE);
      const r = await reclaimRun(depsFor(home, s, GONE), w2, LIVE);
      expect(r).toMatchObject({ ok: true, program: PROGRAM, from: DEAD, to: LIVE });
      if (!r.ok) throw new Error('unreachable — narrowed above');
      expect([...r.runIds].sort((a, b) => a - b)).toEqual([w1, w2]);
      expect(s.run(w1)!.claimedBy).toBe(LIVE);
      expect(s.run(w2)!.claimedBy).toBe(LIVE);
    });

    it('a `to` that is already the claimant is a no-op SUCCESS, not a refusal', async () => {
      const home = mkTmp('ccrc-reclaim-');
      const s = store(home);
      const id = seedRun(s, DEAD);
      seedRow(home, DEAD);
      // Note the verdict: the current claimant is LIVE. Running the ladder here
      // would answer `claimant-alive` about the very session the operator named as
      // the winner — which is why the identity case short-circuits AHEAD of the
      // ladder rather than inside it.
      const r = await reclaimRun(depsFor(home, s, ALIVE), id, DEAD);
      expect(r).toMatchObject({ ok: true, runIds: [], from: DEAD, to: DEAD });
      expect(s.run(id)!.claimedBy).toBe(DEAD);
    });
  });
  ```

  Re-run; **record the first failing assertion verbatim.**

- [ ] **3.3 — Add the structural pin, anchored on a CALL rather than on the two words.** The idiom is
  `single-definition.test.ts:431`'s `REACH` regex, and it is load-bearing here for a reason that regex's
  own comment states: this file's docstrings must be free to NAME `hasSession` and `readRegistry` in
  order to say why it does not use them.

  ```ts
  describe('the ring pin — reclaim.ts reaches for the measuring reads, never the collapsing ones', () => {
    it('calls neither hasSession nor readRegistry', () => {
      const src = readFileSync(new URL('../src/coord/reclaim.ts', import.meta.url), 'utf8');
      expect(src.length).toBeGreaterThan(600);        // anti-vacuity: we read a real file
      expect(src).toContain('readSessionRecord(');     // …and it calls the right reads
      expect(src).toContain('sessionVerdict(');
      // A CALL, not a mention — `single-definition.test.ts:431`'s own anchoring
      // rule. Both names appear in prose above, deliberately: a forbid-mention pin
      // would forbid the argument for the ban along with the ban.
      expect(src).not.toMatch(/\bhasSession\s*\(/);
      expect(src).not.toMatch(/\breadRegistry\s*\(/);
    });
  });
  ```

  Re-run; **record the first failing assertion verbatim.** (`\breadRegistry\b` does not match
  `readRegistryMeasured` — `M` is a word character — so the regex is precise, not merely narrow.)

- [ ] **3.4 — Write `reclaim.ts`'s import block and `ReclaimDeps`.** Every import justified by an
  existing coord precedent; `../config.js` and `../exec.js` are TYPE-ONLY, exactly as
  `dispatch.ts:1-5` has them.

  ```ts
  import type { CcrcConfig } from '../config.js';
  import type { SessionVerdict } from '../exec.js';
  import { lifecycleInputFor } from '../fleet.js';
  import type { FleetIO } from '../io.js';
  import { readSessionRecord } from '../registry.js';
  import type { CoordStore } from './store.js';
  import { lifecycleIsDead, sessionLifecycle } from '../../../shared/api.js';

  /**
   * L1 decision function (architecture doc increment 4 — "deciding split from
   * acting"): everything `POST /api/runs/:id/reclaim` decides, as a named function
   * with narrowed deps in and a typed union out. Same model as `dispatch.ts`'s
   * `dispatchRun` (dispatch.ts:56-80,142) and `close.ts`'s `closeRun`
   * (close.ts:21-60,91) — no `reply` anywhere below, and the route reduced to a
   * union->status map.
   *
   * WHY IT IS A MODULE OF ITS OWN rather than a few lines in the route, which is
   * the argument `kickoff.ts:12-20` already makes for its own existence: the ladder
   * below is the only thing between an operator's tap and the overwrite of the one
   * column that says who owns a program. Inside a Fastify closure it could only
   * ever be tested through HTTP — at the granularity of the ANSWER, never of the
   * RUNG — and the rungs are the guard.
   *
   * HOLDS NO HANDLE. `single-definition.test.ts:404` licenses five files in this
   * directory to touch `coord.db`; this is not one of them, so the whole reclaim
   * commit lives in `CoordStore.reclaimProgram` as one transaction and this file
   * only decides whether to call it.
   *
   * ONE IMPORT IS WORTH A SENTENCE: `lifecycleInputFor` is value-imported from
   * `../fleet.js`, which itself value-imports `configDirFor` from `../config.js`,
   * which imports `./coord/db.js` — the transitive edge `dispatch.ts:60-73` declared
   * a port to avoid. It is taken deliberately here: the alternative is a fifth dep
   * for a pure function whose whole content is a x1000 and a field rename, and an
   * optional port a caller forgot to wire is the fail-quiet `DispatchRunDeps.configDir`
   * refuses to allow. The coord-ring scanner still holds — nothing below imports
   * `./db.js` or `node:sqlite`, and no `coord.db` receiver is named.
   */
  export interface ReclaimDeps {
    coord: CoordStore;
    io: FleetIO;
    cfg: CcrcConfig;
    /**
     * The tmux port, narrowed to ONE method by the consumer — and narrowed to
     * `sessionVerdict` SPECIFICALLY. `Tmux` also carries `hasSession`, whose own
     * docstring forbids it here in as many words (exec.ts:117-120): "A caller that
     * handles `gone` differently from `unknown` must use `sessionVerdict` instead."
     * This caller is exactly that caller — `gone` continues to the lifecycle rung,
     * `unknown` refuses outright — and `hasSession` answers `false` to both, so a
     * ladder built on it reports a tmux server that never answered as proof the
     * coordinator died. A port that cannot EXPRESS the boolean is a port a later
     * edit cannot regress into it.
     */
    tmux: { sessionVerdict(id: string): Promise<SessionVerdict> };
  }
  ```

- [ ] **3.5 — Write `ClaimantVerdict` and `measureClaimant`; re-run and watch the ladder describe go
  green while `reclaimRun`'s stays red.** The rung order is `watch.ts:2326-2572`'s, copied rather than
  re-derived.

  ```ts
  /** THREE answers, never two. `why` is the sentence the route sends as `detail`, so the evidence
   *  survives the collapse to a code — `alive` is reached from a live tmux pane AND from a
   *  gone-but-restarting lifecycle, and those two are the same ANSWER (do not reclaim) told apart by
   *  this string, not by a fourth arm nobody would branch on.
   *
   *  THE CENSUS, because the guard IS which input lands where:
   *    `dead`         — a registry that LISTED and carried no row for this id; or a listed row whose
   *                     pane tmux calls gone and whose lifecycle is one of the three words
   *                     `lifecycleIsDead` names (`stopped`, `orphan`, `never-started`).
   *    `alive`        — tmux says the pane is live; or the pane is gone and the lifecycle reads
   *                     `running`, `unsupervised`, `unclaimed`, `restarting` or `unmeasurable`.
   *                     `restarting` is the arm this file exists to keep.
   *    `unmeasurable` — the registry directory did not list at all; or tmux did not answer.
   *                     Doubt is not evidence, in either direction: the identical line
   *                     `LIFECYCLE_DEAD` draws for its own `unmeasurable` key (shared/api.ts:1668-1670),
   *                     drawn again for the whole ladder. */
  export type ClaimantVerdict =
    | { state: 'dead'; why: string }
    | { state: 'alive'; why: string }
    | { state: 'unmeasurable'; why: string };

  /**
   * Is the session that owns this program still there?
   *
   * THE LADDER IS `watch.ts`'s MAIL SWEEP, rung for rung, deliberately: that loop
   * already answers this exact question about a mail recipient, it was corrected
   * twice on live evidence (D-309 for the tmux collapse, D-1066 for the lifecycle
   * rung), and a second, subtly different ladder deciding a strictly MORE
   * destructive act is the drift this repo files as a defect. Its own words, at
   * watch.ts:2461-2465: "`gone` — tmux itself said the recipient's pane does not
   * exist — stays the ordinary silent gate … `unknown` — tmux DID NOT ANSWER —
   * must not wear the same bare `continue`". And at watch.ts:2510-2513: "The
   * question is NOT 'is the pane gone' … but 'is it coming back'".
   *
   * WHY `readSessionRecord` AND NOT `readRegistry`. `readRegistry`
   * (registry.ts:853-856) is two lines over `readRegistryMeasured` ending
   * `r.listed ? r.records : []` — an unlistable directory arrives wearing the exact
   * shape "nobody is in the registry" wears. Fed to this ladder it reports a
   * fleet-wide outage as proof the coordinator is gone: the fail-open `dispatchRun`
   * already had to close on its own registry read (dispatch.ts:462-480, blocking
   * review finding 7). `readSessionRecord` (registry.ts:895) answers `unlistable`
   * and `absent` separately, and nothing below re-collapses them.
   *
   * `nowMs` IS MILLISECONDS, and the parameter name is the guard (fleet.ts:175-185).
   * Every registry stamp is epoch seconds, `lifecycleInputFor` owns the one x1000,
   * and a caller that hands it seconds places every stamp ~55 years in the future —
   * which `sessionLifecycle`'s `>= 0` freshness guard reads as NOT fresh. The
   * failure is silent AND it points the wrong way: `restarting` collapses to
   * `orphan`, `orphan` is dead, and the reclaim proceeds against a session a
   * supervisor is in the middle of bringing back.
   */
  export async function measureClaimant(
    deps: ReclaimDeps, id: string, nowMs: number,
  ): Promise<ClaimantVerdict> {
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    if (!read.found) {
      return read.reason === 'unlistable'
        ? { state: 'unmeasurable',
            why: 'the registry directory could not be listed — transient, not a fact about the claimant' }
        : { state: 'dead', why: 'no registry row in a directory that listed cleanly' };
    }
    const sv = await deps.tmux.sessionVerdict(id);
    if (sv.verdict === 'live') return { state: 'alive', why: 'tmux reports the pane live' };
    // The message IS the diagnosis, carried verbatim rather than summarised
    // (`SessionVerdict`'s own rule, exec.ts:75-81: `detail` exists only here).
    if (sv.verdict === 'unknown') return { state: 'unmeasurable', why: sv.detail };
    const lc = sessionLifecycle(lifecycleInputFor(read.record, false, nowMs));
    return lifecycleIsDead(lc)
      ? { state: 'dead', why: `the pane is gone and the lifecycle reads ${lc}` }
      : { state: 'alive', why: `the pane is gone but the lifecycle reads ${lc}` };
  }
  ```

- [ ] **3.6 — Write `ReclaimOutcome` and `reclaimRun`; re-run GREEN.**

  ```ts
  /**
   * `registry-unmeasurable` has TWO producers and they are the same answer to the
   * caller: the incoming coordinator's read would not list, or the ladder could not
   * measure the outgoing one. `detail` is what tells them apart, which is why the
   * arm carries one and `unknown-session` does not — there is nothing to say about
   * a directory that listed cleanly and had no such row.
   *
   * `unknown-session` is NOT `unknown-run`: one is a session id nothing in the
   * registry knows, the other a run id nothing in `coord.db` knows, and a caller
   * that cannot tell them apart cannot tell the operator which of the two things
   * they typed was wrong.
   */
  export type ReclaimOutcome =
    | { ok: true; program: string; runIds: number[]; from: string; to: string }
    | { ok: false; kind: 'unknown-run' }
    | { ok: false; kind: 'no-claimant' }
    | { ok: false; kind: 'unknown-session' }              // the NEW claimant has no registry row
    | { ok: false; kind: 'registry-unmeasurable'; detail: string }
    | { ok: false; kind: 'claimant-alive'; detail: string; by: string };

  /**
   * Hand a program's coordination to `to`, after PROVING the session holding it is
   * gone.
   *
   * THE ORDER IS THE GUARD, cheapest and most certain first:
   *   1. the run exists                    — else `unknown-run`;
   *   2. it names a claimant at all        — else `no-claimant`. `reconstruct` binds
   *      `claimedBy` to NULL because it cannot know who will resume, and `openRun`'s
   *      D-12 clause skips exactly those rows (store.ts:360-368); adopting one here
   *      would invent an owner for a row that never had one;
   *   3. `to` is a session this box can SEE — else `unknown-session`, or
   *      `registry-unmeasurable` when the directory would not list. Ahead of the
   *      ladder on purpose: handing a program to an id that does not exist strands
   *      it exactly as thoroughly as leaving it on a corpse, and one listing rules
   *      it out;
   *   4. the CURRENT claimant is dead      — else `claimant-alive` carrying the
   *      evidence sentence, or `registry-unmeasurable`;
   *   5. the commit, as ONE transaction the store owns.
   *
   * `to === from` SHORT-CIRCUITS PAST 4 BUT NOT PAST 3 (D-1136 — this line was
   * drafted as "past 3 AND 4" and CONTRADICTED that entry, which is the reasoned
   * decision and wins; the executor implemented D-1136 and was right to), and it is
   * not a special case dressed
   * up as one: the ladder's entire job is to prove nobody is being overwritten, and
   * an assignment to the id already in the column overwrites nobody. Run there, it
   * would refuse `claimant-alive` about the session the operator just named as the
   * winner. The empty `runIds` is not synthesised here either — `reclaimProgram`'s
   * own `claimedBy != ?` selection answers it, so a program whose sibling rows
   * somehow name a different id still gets them rewritten and reported.
   *
   * ONE `now` FOR THE WHOLE CALL. `recordRunEvent`'s `at` became the caller's in
   * this same wave for exactly this: the commit writes one attribution row per
   * rewritten run for ONE operator act, and N `Date.now()` calls would put N moments
   * in the trail. The ladder reads the same clock, so the lifecycle freshness window
   * and the recorded moment cannot disagree by a scheduling gap.
   *
   * `causedBy` is not a parameter and never reaches this function: the store
   * hardcodes it at its own call site. This door is ungated (the D-282 family), so a
   * body-supplied attribution would be a self-declared one.
   */
  export async function reclaimRun(
    deps: ReclaimDeps, runId: number, to: string,
  ): Promise<ReclaimOutcome> {
    const now = Date.now();
    const run = deps.coord.run(runId);
    if (run === null) return { ok: false, kind: 'unknown-run' };
    const from = run.claimedBy;
    if (from === null) return { ok: false, kind: 'no-claimant' };
    if (to !== from) {
      const incoming = await readSessionRecord(deps.io, deps.cfg, to);
      if (!incoming.found) {
        if (incoming.reason === 'unlistable') {
          return { ok: false, kind: 'registry-unmeasurable',
            detail: 'the registry directory could not be listed, so the incoming coordinator could not be checked' };
        }
        return { ok: false, kind: 'unknown-session' };
      }
      const claimant = await measureClaimant(deps, from, now);
      if (claimant.state === 'unmeasurable') {
        return { ok: false, kind: 'registry-unmeasurable', detail: claimant.why };
      }
      if (claimant.state === 'alive') {
        return { ok: false, kind: 'claimant-alive', detail: claimant.why, by: from };
      }
    }
    const committed = deps.coord.reclaimProgram(runId, to, now);
    // Re-measured INSIDE the transaction, so these are not the answers rungs 1-2
    // already gave — they are what is still true at commit time, after two awaited
    // registry reads have given the event loop somewhere to run.
    if (!committed.ok) return committed;
    return { ok: true, program: committed.program, runIds: committed.runIds,
      from: committed.from, to };
  }
  ```

  `cd server && ./node_modules/.bin/vitest run test/coord-reclaim.test.ts` — foreground, timeout
  600000.

> **CORRECTION, measured at execution: step 3.7 below is WRONG and must be SKIPPED.** `unknown-session`
> is not ungoverned — it is a declared `ClaimRefuseCode` (`shared/api.ts`, admitted to the scanner by
> `isClaimRefuseCode`), which this plan's own `## Verified facts` table already states two pages up. All
> five of this file's kebab spellings are therefore declared members and the suite is green with **zero**
> edits to `mail-routes.test.ts`. Adding the `NOT_CODES` entry the step describes would allowlist a word
> that is already typed — the weaker of the two remedies that file's own comments argue between. Run the
> suite to confirm green; add nothing. Kept here, struck rather than deleted, because a step that was
> wrong for a stated reason is worth more to the next reader than a step that vanished.

- [ ] ~~**3.7 — The kebab scanner: one allowlist entry, written in the house style.**~~ **SKIP — see the
  correction above.** `mail-routes.test.ts:469`
  scans every `.ts` directly under `server/src/coord` for a fully-kebab single-quoted token. Of this
  file's five `kind` spellings, four are already declared — `registry-unmeasurable` and `unknown-run`
  are `MAIL_REJECT_CODES` members (shared/api.ts:3421-3438), `claimant-alive` and `no-claimant` are
  admitted through `isReclaimRefuseCode`. `unknown-session` is in none of them: it is `server.ts`'s
  generic 404 spelling, used by 16 handlers there and governed by no union. It gets a `NOT_CODES` entry
  — the `bad-request` precedent at `mail-routes.test.ts:428-429`, not a guard, because inventing a
  wire vocabulary to admit a word `server.ts` already sends ungoverned would be the wrong repair.
  Insert immediately after the `'not-live'` entry (`:462-467`), before the closing `]);`:

  ```ts
      'unknown-session',      // the generic "no registry row for that id" 404, and NOT a code this
                              // union family owns: `server.ts` already sends this exact spelling from
                              // sixteen handlers (:1425, :1512, :1531…) governed by nothing, and
                              // `coord/reclaim.ts` (wave 5) is the first file under this directory to
                              // answer it. Allowlisted like `bad-request` above rather than admitted
                              // through `isReclaimRefuseCode`: that union is the two refusals this
                              // door OWNS, and widening it to cover a spelling shared with the
                              // session routes would put a word into the reclaim vocabulary that no
                              // reclaim decision ever produced.
  ```

  `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts` — and record what it said
  BEFORE the entry, verbatim, since that failure is the pin.

- [ ] **3.8 — Run the ring scanners the new file walks into, and read their output rather than
  reasoning about it.** `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
  test/coord-routes-single-file.test.ts test/typecheck-tests.test.ts`. The coord-ring describe
  (`single-definition.test.ts:402-437`) visits the whole directory: its coverage floor (`:409`,
  `>= 6` files) and its named list (`:410-412`) both stay satisfied by an added file, so **no edit is
  expected here** — if either reds, the file was placed or named in a shape the scanner cannot see,
  and that is the bug, not the number. `coord-routes-single-file.test.ts` must stay green because this
  task registers no route at all.

- [ ] **3.9 — The mutation sweep.** Apply each row below one at a time, run
  `test/coord-reclaim.test.ts` (plus `test/mail-routes.test.ts` for the last row), record the **exact
  first failing assertion verbatim**, revert. Row 6 is the one to write up in full: it is
  `fleet.ts:175-185`'s own documented silent failure, and the record must show it was measured rather
  than trusted.

  | mutation | first-fail assertion |
  |---|---|
  | `measureClaimant` rung 1: `unlistable` answers `{state:'dead'}` | `<measured at execution>` |
  | `measureClaimant` rung 1: both `!found` reasons answer `{state:'unmeasurable'}` (the absent arm deleted) | `<measured at execution>` |
  | `measureClaimant` rung 2: the `live` arm deleted, so a live pane falls through to the lifecycle | `<measured at execution>` |
  | `measureClaimant` rung 2: `unknown` folded into `gone` (the `sv.verdict === 'unknown'` line deleted) | `<measured at execution>` |
  | `measureClaimant` rung 3: `lifecycleIsDead(lc)` replaced by `true` — the naive `!alive` collapse | `<measured at execution>` |
  | `measureClaimant` rung 3: `lifecycleInputFor(read.record, false, nowMs)` → `Math.floor(nowMs / 1000)` | `<measured at execution>` |
  | `reclaimRun` rung 3: the `unlistable` arm answers `{kind:'unknown-session'}` | `<measured at execution>` |
  | `reclaimRun` rung 3: the incoming `readSessionRecord` call deleted outright | `<measured at execution>` |
  | `reclaimRun` rung 4: the `claimant.state === 'alive'` refusal deleted (proceed on alive) | `<measured at execution>` |
  | `reclaimRun` rung 4: the `unmeasurable` refusal deleted (fall through to the commit) | `<measured at execution>` |
  | `reclaimRun` rung 2: the `from === null` check deleted | `<measured at execution>` |
  | `reclaimRun` rung 1: the `run === null` check deleted | `<measured at execution>` |
  | `reclaimRun`: the `to !== from` guard removed, so the ladder runs on an identity assignment | `<measured at execution>` |
  | `reclaim.ts` switched to `deps.tmux.hasSession(id)` (port widened to `Tmux`) | `<measured at execution>` |
  | `reclaim.ts` switched to `readRegistry(deps.io, deps.cfg)` + `.find(r => r.id === id)` | `<measured at execution>` |
  | the `'unknown-session'` entry removed from `mail-routes.test.ts`'s `NOT_CODES` | `<measured at execution>` |

- [ ] **3.10 — Commit.**

  ```bash
  git add server/src/coord/reclaim.ts server/test/coord-reclaim.test.ts server/test/mail-routes.test.ts \
    && git commit -m "feat(coord): reclaim.ts — the three-answer dead-claimant ladder (D-1127, D-1140)"
  ```
---

## Task 4: the fourth ungated door — `POST /api/runs/:id/reclaim`

**Files:** `server/src/coord/routes.ts`, `server/test/reclaim-route.test.ts` (new),
`server/test/coord-pause-route.test.ts`, `server/test/auth-gate.test.ts`,
`server/test/coordinator-skill.test.ts`.

> **LEAD'S AMENDMENT — one required step was in nobody's draft. Add it as step 4.7b, immediately after
> the parity EXEMPT entry.** Two drafts each assumed the other owned it. It belongs here, because this is
> the task that registers the route and therefore owns every scanner obligation the registration creates.
>
> **The parity EXEMPT entry alone does NOT meet the brief's forbid-mention obligation.** EXEMPT only
> stops the census complaining that a registered route is named nowhere; it permits the omission, it does
> not forbid the mention. The only corpus-wide prohibition in the tree today covers one door
> (`server/test/coordinator-skill.test.ts:995-1001`), and the `resume.md` UNGATED harvest at `:1082-1106`
> reads ONE reference file — so a reclaim path written into `SKILL.md`, or into any of the other four
> references, passes both. Mirror the break door's pin:
>
> ```ts
> it('never names the reclaim door — the release valve for a wedge the coordinator IS', () => {
>   // The fourth ungated door (D-1123), and the same accounting D16 gave the third:
>   // the EXEMPT entry above only PERMITS the omission; this is what FORBIDS the
>   // mention. Wider than the `resume.md` harvest below, which reads one reference
>   // file — a door named in `SKILL.md`, or in any of the other four references,
>   // passes that and fails here.
>   expect(allSkillText).not.toContain('/api/runs/:id/reclaim');
> });
> ```
>
> Measure it red by adding the path to `ccd/coordinator-skill/SKILL.md` — deliberately NOT to
> `resume.md`, because a `resume.md` mutation reds the `:1082` harvest as well and so would not prove
> this pin did anything. Record the exact first failing assertion, revert, and add the row to this task's
> mutation table.


**What this task adds, in one sentence:** the L4 adapter over Task 2's `reclaimRun` — a `union→status`
map in the shape of `sendCloseOutcome` (`routes.ts:167-183`) — registered as the FOURTH route in this
file that carries no box token, plus the two-direction pin that makes membership of that set mean
something in both directions for the first time (**D-1128**).

- [ ] **4.1 — Write `server/test/reclaim-route.test.ts` in full, and run it RED.** Every arm of
  `ReclaimOutcome` (contract L1) reaching its own status and its own body, the box-token absence pin
  in `claims-routes.test.ts:292-305`'s shape, and the determinism `auth-gate.test.ts`'s three-probe
  sweep (`auth-gate.test.ts:647-723`) depends on but cannot itself state.

  ```ts
  // program-leverage wave 5 (F5) — `POST /api/runs/:id/reclaim`, the FOURTH ungated
  // operator door. TDD red-first: every test below was written and run before the
  // route existed, so the record shows it failed for the right reason.
  //
  // The DECISION half — `measureClaimant`'s three-step ladder, `reclaimRun`'s
  // refusal order — is pinned in `reclaim.test.ts`. What is pinned HERE is the
  // ADAPTER: that each member of `ReclaimOutcome` reaches its own status with its
  // own body (an L4 adapter may not narrow a distinction it received), that the
  // door answers a caller holding no box token, and that a malformed id is refused
  // before anything at all is measured.
  import { describe, it, expect, afterEach } from 'vitest';
  import { mkdirSync, writeFileSync } from 'node:fs';
  import path from 'node:path';
  import type { FastifyInstance } from 'fastify';
  import { buildServer, type Deps } from '../src/server.js';
  import { openCoordDb } from '../src/coord/db.js';
  import { CoordStore } from '../src/coord/store.js';
  import type { Runner } from '../src/exec.js';
  import { localIO, type FleetIO } from '../src/io.js';
  import { testDeps } from './helpers.js';
  import { mkTmp } from './tmpHelpers.js';

  const TOKEN = 'f'.repeat(64);
  const PROGRAM = 'leverage';
  const PROJECT = 'demo';
  /** The coordinator that died. Deliberately NOT seeded in most fixtures: an id
   *  with no `.uuid` in a directory that listed cleanly is `measureClaimant`'s
   *  step-1 `dead` — the shortest honest death this suite can build, and the one
   *  that reaches it without a single tmux call. */
  const DEAD = 'demo-coordinator-old';
  const HEIR = 'demo-coordinator-new';

  /** `coord-abandon.test.ts:30-38`'s registry row, field for field, so a fixture
   *  session reads exactly like a ccd one. */
  const seed = (home: string, id: string): void => {
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields: Record<string, string> = {
      wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
      workspace: id, branch: `ws/${id}`, base: 'origin/main',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  };

  /** A runner whose only scripted verb is `tmux has-session`, answered per target.
   *  Anything not in `live` gets ccd's ONE death sentence verbatim: `exec.ts:98-101`
   *  recognises exactly `can't find session` as proof of death and calls every other
   *  failure `unknown`, so a fixture that improvised a stderr would be scripting
   *  `unmeasurable` by accident and passing for the wrong reason. `cmd` is recorded
   *  as well as the argv (`kickoff-route.test.ts:133`'s reason) — "nothing was
   *  measured" is a statement about `cmd`, which `calls.push(args)` cannot make. */
  const makeRunner = (live: ReadonlySet<string> = new Set()): { run: Runner; execs: string[][] } => {
    const execs: string[][] = [];
    const run: Runner = async (cmd, args) => {
      execs.push([cmd, ...args]);
      if (cmd === 'tmux' && args[0] === 'has-session') {
        const t = args[2] ?? '';
        return live.has(t)
          ? { code: 0, stdout: '', stderr: '' }
          : { code: 1, stdout: '', stderr: `can't find session: ${t}` };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    return { run, execs };
  };

  const openApp = async (home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {}) => {
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const base = testDeps(home, run);
    const app = await buildServer({ ...base, mailToken: TOKEN, coord, ...over });
    return { app, coord };
  };

  /** One run of `PROGRAM`, claimed by `DEAD`. `openRun` answers a UNION — it can
   *  refuse a second coordinator — so the id is narrowed rather than destructured
   *  off the refusal shape (`coord-abandon.test.ts:70-73`). */
  const openWave = (coord: CoordStore, wave: number, claimedBy = DEAD): number => {
    const opened = coord.openRun({
      program: PROGRAM, title: 'Program leverage', project: PROJECT, wave, waveOf: 8, claimedBy,
    });
    if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
    return opened.id;
  };

  const post = (
    app: FastifyInstance, id: number | string, payload: unknown = { claimedBy: HEIR },
    headers: Record<string, string> = {},
  ) => app.inject({
    method: 'POST', url: `/api/runs/${id}/reclaim`, headers,
    payload: payload as Record<string, unknown>,
  });

  describe('POST /api/runs/:id/reclaim — the union→status map', () => {
    let app: FastifyInstance | undefined;
    afterEach(async () => { await app?.close(); app = undefined; });

    it('200: EVERY run of the program moves to the heir, and the trail names the operator', async () => {
      const home = mkTmp('ccrc-reclaim-');
      seed(home, HEIR);                     // the heir is real; the dead claimant is not
      const { run } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const w1 = openWave(w.coord, 1);
      const w2 = openWave(w.coord, 2);

      const res = await post(app, w2);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { runIds: number[] };
      // The KEY SET, not merely a subset: an adapter that dropped `from` would
      // leave `toMatchObject` green and leave the sheet unable to say what it
      // replaced.
      expect(Object.keys(body).sort()).toEqual(['from', 'ok', 'program', 'runIds', 'to']);
      expect(body).toMatchObject({ ok: true, program: PROGRAM, from: DEAD, to: HEIR });
      // Sorted: `reclaimProgram`'s SELECT carries no ORDER BY, and asserting an
      // incidental rowid order would pin sqlite's plan rather than the contract.
      expect([...body.runIds].sort((a, b) => a - b)).toEqual([w1, w2]);
      // RULING R1, as a mechanism: ALL of the program's runs, not just the one
      // named in the path. `openRun`'s guard (`store.ts:369-371`) and
      // `resolveCoordinator(null)` (`store.ts:1188-1191`) both read the LOWEST-id
      // claimed row with no state predicate, so a rewrite that spared wave 1
      // would leave both readers answering the corpse and the wedge intact.
      expect(w.coord.run(w1)!.claimedBy).toBe(HEIR);
      expect(w.coord.run(w2)!.claimedBy).toBe(HEIR);
      const ev = w.coord.runEvents(w1).at(-1)!;
      expect(ev.causedBy).toBe('operator');
      expect(ev.detail).toBe(`reclaim:${DEAD} -> ${HEIR}`);
    });

    it('404 unknown-run — measured BEFORE any registry read, so the heir need not exist', async () => {
      // Order, asserted as an absence: `reclaimRun` checks the run first, so an
      // unknown id answers with an unseeded heir and an untouched registry. A
      // reordered implementation would answer `unknown-session` here.
      const home = mkTmp('ccrc-reclaim-');
      const { run, execs } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const res = await post(app, 9999);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ ok: false, error: 'unknown-run' });
      expect(execs).toEqual([]);
    });

    it('409 no-claimant for a reconstructed run whose claimedBy is NULL', async () => {
      // `reconstruct` inserts every rebuilt run with `claimedBy` bound to NULL
      // (`store.ts:361-368`) and no in-tree method writes that shape, so the row
      // is made the way `run-routes.test.ts:1329` already makes it.
      const home = mkTmp('ccrc-reclaim-');
      seed(home, HEIR);
      const { run } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const id = openWave(w.coord, 1);
      w.coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(id);

      const res = await post(app, id);
      expect(res.statusCode).toBe(409);
      // `refused`, not `error`: this is a member of `ReclaimRefuseCode`, and the
      // repo spells a refusal code on `refused` (`sendCloseOutcome`'s own arm).
      expect(res.json()).toEqual({ ok: false, refused: 'no-claimant' });
    });

    it('404 unknown-session when the HEIR has no registry row', async () => {
      const home = mkTmp('ccrc-reclaim-');
      seed(home, DEAD);                     // a listable directory, with no heir in it
      const { run } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const id = openWave(w.coord, 1);
      const res = await post(app, id);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
      // …and the run did NOT move: a refusal that half-committed would be worse
      // than the wedge it was called to clear.
      expect(w.coord.run(id)!.claimedBy).toBe(DEAD);
    });

    it('502 registry-unmeasurable, with its detail, when the registry DIRECTORY will not list', async () => {
      // THE PAIR THIS ROUTE EXISTS NOT TO COLLAPSE, and the reason 404 and 502 are
      // two arms: "that session does not exist" and "this box could not read its
      // registry" are different facts and the operator acts differently on each.
      // 502, not `/api/sessions/:id/kickoff`'s 503 — this is the coord-route
      // family's status for the same condition (`sendDispatchOutcome`,
      // `routes.ts:147-151`).
      const home = mkTmp('ccrc-reclaim-');
      seed(home, HEIR);
      const { run } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const id = openWave(w.coord, 1);
      const unlistable: FleetIO = { ...localIO, readdir: async () => null };
      await app.close();
      const w2 = await openApp(home, run, { io: unlistable }); app = w2.app;

      const res = await post(app, id);
      expect(res.statusCode).toBe(502);
      const body = res.json() as { detail: string };
      expect(body).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
      // The sentence rides along because the adapter RECEIVED it and cannot
      // recompute it — L1 measured which read failed, this layer did not.
      expect(body.detail.length).toBeGreaterThan(0);
    });

    it('409 claimant-alive names the holder and says how it was measured', async () => {
      const home = mkTmp('ccrc-reclaim-');
      seed(home, DEAD);
      seed(home, HEIR);
      const { run } = makeRunner(new Set([`cc-${DEAD}`]));
      const w = await openApp(home, run); app = w.app;
      const id = openWave(w.coord, 1);

      const res = await post(app, id);
      expect(res.statusCode).toBe(409);
      const body = res.json() as { detail: string };
      expect(body).toMatchObject({ ok: false, refused: 'claimant-alive', by: DEAD });
      // `why` survives the collapse to a code — `alive` is reached from a live
      // pane AND from a gone-but-restarting lifecycle, and the sheet must be able
      // to tell the operator which.
      expect(body.detail.length).toBeGreaterThan(0);
      expect(w.coord.run(id)!.claimedBy).toBe(DEAD);
    });

    it('501 not-configured on a box that does no coordination at all', async () => {
      // The FIRST arm, and `auth-gate.test.ts`'s three-probe sweep leans on it:
      // that harness wires no `coord`, so dark and authenticated both land here.
      const home = mkTmp('ccrc-reclaim-');
      const { run } = makeRunner();
      const w = await openApp(home, run, { coord: undefined }); app = w.app;
      const res = await post(app, 1);
      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
    });

    it.each([
      ['an empty body', {}],
      ['a blank claimedBy', { claimedBy: '   ' }],
      ['a claimedBy of the wrong type', { claimedBy: 7 }],
      ['the abandon-shaped body, which names no heir', { intent: 'abandon' }],
    ])('400 bad-request for %s', async (_label, payload) => {
      const home = mkTmp('ccrc-reclaim-');
      seed(home, HEIR);
      const { run } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const id = openWave(w.coord, 1);
      const res = await post(app, id, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    });

    it('a NON-INTEGER id answers 400 before anything is measured — the sweep probe', async () => {
      // `auth-gate.test.ts:93`'s `concrete()` rewrites `:id` to `x` and injects
      // with NO payload at all, three times (dark, armed-anonymous, armed with a
      // session), and requires dark and authenticated to be EQUAL. That holds only
      // if the answer is decided before any IO — so it is asserted here rather
      // than inferred there. Injected directly, not through `post`: a default
      // parameter would substitute the valid body for `undefined` and report green
      // on a shape the sweep never sends (`kickoff-route.test.ts:129-134`).
      const home = mkTmp('ccrc-reclaim-');
      seed(home, HEIR);
      const { run, execs } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      openWave(w.coord, 1);
      const res = await app.inject({ method: 'POST', url: '/api/runs/x/reclaim' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
      expect(execs, 'the malformed id reached a fleet act').toEqual([]);
    });

    it('answers WITHOUT the box token, and NEVER takes attribution from the body', async () => {
      // The `claims-routes.test.ts:292-305` shape, with the one difference this
      // door has: the body IS read. So both halves are asserted — no token is
      // needed (D-282), and the one field that is read is `claimedBy` and not the
      // provenance, which is a literal at the store call site.
      const home = mkTmp('ccrc-reclaim-');
      seed(home, HEIR);
      const { run } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const id = openWave(w.coord, 1);

      const res = await post(app, id, { claimedBy: HEIR, causedBy: 'coordinator', archive: true });
      expect(res.statusCode).toBe(200);
      expect(w.coord.runEvents(id).at(-1)!.causedBy).toBe('operator');
      // …and a WRONG token is not a refusal either: the route never consults the
      // header, so presenting garbage changes nothing.
      const id2 = openWave(w.coord, 2, HEIR);
      const wrong = await post(app, id2, { claimedBy: HEIR }, { 'x-ccrc-mail-token': 'a'.repeat(64) });
      expect(wrong.statusCode).toBe(200);
    });
  });
  ```

  Run it: `cd server && ./node_modules/.bin/vitest run test/reclaim-route.test.ts` (foreground,
  timeout 600000). **RECORD THE EXACT FIRST FAILING ASSERTION TEXT, VERBATIM** — expected to be the
  404 Fastify returns for an unregistered route in the first test.

- [ ] **4.2 — Close the one-directional hole in `coord-pause-route.test.ts`, and grow `UNGATED` to
  four (D-1128).** Measured on the shipped tree: that file asserts (a) every non-`UNGATED` `app.post`
  is gated (`:185-209`) and (b) every `UNGATED` route carries an argued docstring (`:244-256`) —
  **nothing asserts a listed door actually lacks a gate**, so a name added to the set whose handler
  ALSO called `requireMailToken` passed both. Three edits, one commit:

  (i) `:172` — the set, keeping the exact `UNGATED = new Set([ … ])` shape, because
  `coordinator-skill.test.ts:1097` harvests it with `/UNGATED = new Set\(\[([^\]]*)\]\)/` and no `]`
  may appear inside:

  ```ts
  const UNGATED = new Set([
    '/api/coord/pause', '/api/runs/:id/abandon', '/api/claims/:id/break',
    '/api/runs/:id/reclaim',
  ]);
  ```

  and extend the set's own docstring (`:161-171`) with the fourth argument:

  ```ts
   *  `/api/runs/:id/reclaim`: the same door one turn further on — the release
   *  valve for a program whose COORDINATOR is the corpse. The box token is that
   *  coordinator's own key, so gating the act of replacing it would be the
   *  D-282 shape exactly (F5, D-1123).
  ```

  (ii) hoist the two gate patterns above `handlers()` so the two directions cannot drift apart, and
  rewrite `:196-202`'s inline array to use it:

  ```ts
  /** The two mechanisms that count as "the token was checked" — the shared
   *  helper AND the two inline `checkMailToken` sites. Hoisted because BOTH
   *  directions below read it now: a narrowed copy in one test and not the
   *  other would let a route be gated for one assertion and ungated for the
   *  other, which is the drift this file exists to prevent. */
  const GATE_PATTERNS = [/requireMailToken\(req/, /checkMailToken\(/];
  ```

  ```ts
      const gate = Math.min(
        ...GATE_PATTERNS.map((re) => {
          const m = re.exec(body);
          return m ? m.index : Number.POSITIVE_INFINITY;
        }),
      );
  ```

  (iii) the missing direction, immediately after that test:

  ```ts
  it('every UNGATED route really IS ungated — the direction this set could not fail in', () => {
    // THE MISSING HALF, and the reason a name in `UNGATED` was until now a
    // one-way promise. The test above SKIPS the listed routes; the docstring test
    // below only reads prose. Between them, a route added to this set whose
    // handler ALSO checked the box token passed both, and the set would be
    // documenting an exemption the code does not take — the mirror image of
    // `auth-gate.test.ts:400-402`'s "an exemption whose stated justification is a
    // gate the route does not actually have", which that file calls the worst
    // kind of hole. Measured red by adding the gate to the reclaim handler.
    const seen: string[] = [];
    const gated: string[] = [];
    for (const { route, body } of handlers()) {
      if (!UNGATED.has(route)) continue;
      seen.push(route);
      if (GATE_PATTERNS.some((re) => re.test(body))) gated.push(route);
    }
    // Guard the guard, and it is not decoration: `handlers()` keys on the exact
    // registration text, so a route renamed in `coord/routes.ts` and not here
    // drops silently out of the loop and leaves this green over an empty set.
    // Every listed name must have been FOUND.
    expect(seen.sort(), 'a name in UNGATED that no app.post registers').toEqual([...UNGATED].sort());
    expect(gated, 'listed as UNGATED, and yet the handler checks the box token').toEqual([]);
  });
  ```

  **A note the executor must not skip:** each handler's slice runs to the NEXT registration, so a
  route's docstring falls inside the PRECEDING route's slice. The reclaim docstring therefore lands
  inside the abandon handler's slice — which is why step 4.3 spells `` `requireMailToken` `` in
  backticks with no `(` after it. Simulated on the shipped tree before writing this plan: with the
  backticked spelling `gated` is `[]`; with `requireMailToken(req` in the handler it is
  `['/api/runs/:id/reclaim']`.

  (iv) the file header at `:1-6` says THREE and names them; it is now stale. Replace `:1-6` with:

  ```ts
  // `POST /api/coord/pause` — the operator's door onto `$REG/coordinator-paused`,
  // and one of the FOUR write routes in `coord/routes.ts` deliberately not behind
  // `requireMailToken` (D-282 (was D-B4-9)). The others are `POST /api/runs/:id/abandon` (same
  // build, same reason), `POST /api/claims/:id/break` (build 9 D12, the same
  // abandon-door shape) and `POST /api/runs/:id/reclaim` (F5, D-1123 — the same
  // shape again, for the coordinator itself); the `UNGATED` set below is the whole
  // list, and the scanner holds it to exactly those four IN BOTH DIRECTIONS.
  ```

  Run `cd server && ./node_modules/.bin/vitest run test/coord-pause-route.test.ts` and **record the
  exact first failing assertion, verbatim** — expected from `docstringFor`'s
  `` `${route} is not registered` `` guard, since the route does not exist yet.

- [ ] **4.3 — Write the docstring and the route.** ONE import line, beside `close.ts`'s
  (`routes.ts:21`):

  ```ts
  import { reclaimRun, type ReclaimDeps } from './reclaim.js';
  ```

  Then, immediately after the abandon handler's close (`routes.ts:1021` is its `  });`, `:1022` the
  blank line, `:1023` the advance docstring's `/**`), BEFORE the advance docstring — the shipped
  bytes, measured at 2020 characters against `docstringFor`'s `> 600` floor, containing
  `` `requireMailToken` `` (backticked, no open paren), `UNGATED`, `D-282` and `coordinator`, and
  containing no hyphenated single-quoted literal for `mail-routes.test.ts:470`'s scanner to catch:

  ```ts
  /**
   * `POST /api/runs/:id/reclaim` — the FOURTH route in this file that is
   * UNGATED, and the one the other three implied. `POST /api/coord/pause`
   * lifts a marker a stuck coordinator cannot lift for itself;
   * `POST /api/runs/:id/abandon` releases the run that coordinator wedged;
   * `POST /api/claims/:id/break` frees the claim a dead holder still holds.
   * None of them can hand a LIVE program to a new session once the old
   * claimant is a corpse — `openRun`'s one-coordinator guard and
   * `resolveCoordinator` both read the same lowest-id `claimedBy` with no
   * state predicate, so until this door existed the dead name answered both
   * for ever and every later wave opened onto a grave.
   *
   * Deliberately NOT behind `requireMailToken`, for D-282's argument
   * unchanged: the box token authenticates the FLEET HOST and the coordinator
   * holds it by design, so putting a wedge's release valve behind that key
   * leaves the wedge no door. With `CCRC_AUTH` armed this still sits behind
   * the session gate, exactly as the other three do — ungated means "no box
   * token", never "no authentication".
   *
   * THE BODY IS READ, and that is where this door parts company with the
   * abandon and break handlers above. `claimedBy` — which session takes the
   * program over — is a fact only the operator has, so it arrives in the body
   * and is validated here as a non-empty string. What does NOT arrive in the
   * body is the ATTRIBUTION: `causedBy` is the hardcoded literal `operator`
   * at the store call site (`reclaimProgram`), so a caller may name the heir
   * and can never forge who did the naming. Reading one field is not the
   * same licence as reading the act's own provenance.
   *
   * UNNAMED IN BOTH SKILL CORPORA, the abandon-door shape again: a
   * coordinator that reclaims its own program has learned nothing, and one
   * that reclaims someone else's has stopped coordinating. The operator with
   * a phone is the only caller this door has.
   */
  app.post('/api/runs/:id/reclaim', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    // Read BEFORE the mutex, not inside it: a malformed body is decided by this
    // request alone, and queueing it behind a live dispatch would make the
    // answer depend on the fleet's weather. It also keeps `auth-gate`'s sweep
    // probe — no payload, a `:id` of `x` — deterministic on a busy box.
    const body = (req.body ?? {}) as { claimedBy?: unknown };
    if (typeof body.claimedBy !== 'string' || body.claimedBy.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const to = body.claimedBy.trim();

    const reclaimDeps: ReclaimDeps = { coord, io: deps.io, cfg: deps.cfg, tmux: deps.tmux };
    // Inside the mutex for abandon's reason (`CoordMutex`'s docstring,
    // routes.ts:32-64): the measurement of the old claimant and the UPDATE that
    // replaces it are separated by awaits over live fleet acts, and a concurrent
    // dispatch reading `claimedBy` between them would read a name that is
    // already being retired.
    const r = await coordMutex.run(() => reclaimRun(reclaimDeps, id, to));
    if (r.ok) {
      return reply.code(200).send({
        ok: true, program: r.program, runIds: r.runIds, from: r.from, to: r.to,
      });
    }
    switch (r.kind) {
      case 'unknown-run': return reply.code(404).send({ ok: false, error: 'unknown-run' });
      case 'unknown-session': return reply.code(404).send({ ok: false, error: 'unknown-session' });
      case 'no-claimant': return reply.code(409).send({ ok: false, refused: 'no-claimant' });
      // 502, the coord-route family's status for this condition
      // (`sendDispatchOutcome` above) — NOT the kickoff route's 503, which is
      // server.ts's own vocabulary. `detail` rides along because it is a
      // distinction this adapter RECEIVED: L1 measured WHICH read failed, and
      // this layer cannot recompute it.
      case 'registry-unmeasurable':
        return reply.code(502).send({ ok: false, error: 'registry-unmeasurable', detail: r.detail });
      // `by` and `detail` both: the first is who still holds it, the second is
      // HOW that was measured — a live pane and a restarting supervisor are one
      // answer told apart by this sentence, and collapsing it would leave the
      // operator with a refusal and no next move.
      case 'claimant-alive':
        return reply.code(409).send({ ok: false, refused: 'claimant-alive', by: r.by, detail: r.detail });
      default: {
        const _exhaustive: never = r;
        return reply.code(500).send({ ok: false, error: 'internal', kind: (_exhaustive as { kind: string }).kind });
      }
    }
  });
  ```

- [ ] **4.4 — Re-run 4.1 and 4.2 and confirm GREEN.**
  `cd server && ./node_modules/.bin/vitest run test/reclaim-route.test.ts test/coord-pause-route.test.ts`
  (foreground, timeout 600000). If `coord-pause-route`'s docstring test reds on the `> 600` floor, the
  docstring was reflowed — restore the bytes above rather than lowering the floor.

- [ ] **4.5 — Run the two scanners the new route just broke, and RECORD BOTH REDS VERBATIM.**
  `cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts test/coordinator-skill.test.ts`.
  These are the pins doing their job, not defects — the record must show they fired before they were
  updated, because a number edited without first seeing it red is a number nobody measured. Expect
  `auth-gate.test.ts:198` (22 vs 23) first, and `coordinator-skill.test.ts:242-249`'s parity loop
  reporting `POST /api/runs/:id/reclaim is registered in coord/routes.ts but is named nowhere in the
  route corpus`.

- [ ] **4.6 — The four numbers in `auth-gate.test.ts`, and the prose that goes stale with them.**
  Exact current → exact new, each read from the file:
  - `:198` `expect(scanRoutes('coord/routes.ts').length).toBe(22);` → `.toBe(23);`
  - `:199` `expect(ROUTES.length).toBe(68);` → `.toBe(69);`
  - `:202` `expect(ROUTES.filter((r) => !isWs(r)).length).toBe(65);` → `.toBe(66);`
  - `:469` `expect(gated.length).toBe(41);` → `.toBe(42);`

  `:195` (`server.ts`, 46), `:470` (derived from `EXEMPT.size`) and `EXEMPT.size` itself (25) are
  **untouched** — reclaim is not EXEMPT, and if any of the three reds the route was registered in a
  shape the scanner cannot see, which is the bug and not the number. Two prose repairs in the same
  edit: `:196-197`'s "22 since `GET /api/runs/:id/items`" gains

  ```ts
    // 23 since `POST /api/runs/:id/reclaim` — the fourth ungated operator door,
    // and the first route in this file whose whole job is to rewrite `claimedBy`.
  ```

  and `:454-462`'s arithmetic becomes `69 scanned − 3 websockets − 24 exempt-and-scanned … = 42`,
  naming reclaim beside `POST /api/claims/:id/break` and `POST /api/sessions/:id/kickoff` as a gated
  non-exempt member — DELIBERATELY not EXEMPT, because with `CCRC_AUTH` armed it must sit behind the
  session gate exactly as abandon, pause and break do (`auth/gate.ts`'s NOT-EXEMPT note: gating them
  there "strengthens D-282 rather than reversing it").

- [ ] **4.7 — The parity EXEMPT entry in `coordinator-skill.test.ts`.** After `:239`
  (`'POST /api/claims/:id/break',`) and before `:240`'s `]);`:

  ```ts
      // F5 (D-1123) — the abandon-door shape, FOURTH instance, and the one with
      // the sharpest reason to stay unnamed: this door rewrites `claimedBy`. A
      // coordinator told about it would be told how to reclaim its own program
      // from itself, which is a no-op it would spend a wave discovering, or how
      // to take someone else's, which is the thing clause 1 forbids. The
      // corpus-wide forbid-mention pin (the `/api/claims/:id/break` shape) is
      // what turns this permission-to-omit into a prohibition.
      'POST /api/runs/:id/reclaim',
  ```

  Do NOT add the corpus-wide forbid-mention pin here — it lands with the ccd corpus rewording
  (ruling R2), which is the task that can measure it against the rewritten `resume.md`.

- [ ] **4.8 — The whole-scanner sweep.** `cd server && ./node_modules/.bin/vitest run
  test/reclaim-route.test.ts test/coord-pause-route.test.ts test/auth-gate.test.ts
  test/coordinator-skill.test.ts test/coord-routes-single-file.test.ts test/mail-routes.test.ts
  test/coord-abandon.test.ts test/claims-routes.test.ts test/single-definition.test.ts
  test/topology-clean.test.ts` (foreground, timeout 600000). Three specific things to *look at*
  rather than reason about:
  - `mail-routes.test.ts`'s kebab scan (`:469-497`) must accept `'no-claimant'` and
    `'claimant-alive'` in `routes.ts` through Task 1's `|| isReclaimRefuseCode(tok)` clause. If it
    reds, that clause has not landed — this task does not add it; say so in the execution record and
    stop rather than adding a `NOT_CODES` entry, which would put a wire word into the non-wire list.
  - `coord-routes-single-file.test.ts:73`'s floor (`>= 21`) and its get/post-only assertion are
    satisfied without an edit — confirm from the output, do not assume.
  - `auth-gate.test.ts:400-440`'s eighteen box-token lanes must still be EIGHTEEN and must NOT contain
    `POST /api/runs/:id/abandon`; if abandon appears there, the reclaim docstring is spelling
    `requireMailToken(` and has leaked a gate into the preceding handler's slice.

- [ ] **4.9 — Run the mutation table and fill in every row.** Each mutation applied alone, suite run,
  first failing assertion recorded verbatim, mutation reverted.

  | mutation | first-fail assertion |
  |---|---|
  | add `if (!requireMailToken(req, reply, 'POST /api/runs/:id/reclaim')) return;` to the reclaim handler | `<measured at execution>` |
  | delete `'/api/runs/:id/reclaim'` from `coord-pause-route.test.ts`'s `UNGATED` | `<measured at execution>` |
  | rename the route to `/api/runs/:id/reclaim2` in `routes.ts` only (the anti-vacuity guard) | `<measured at execution>` |
  | trim the reclaim docstring below 600 characters | `<measured at execution>` |
  | delete the `Number.isInteger(id)` arm from the reclaim handler | `<measured at execution>` |
  | delete the `claimedBy` non-empty-string arm | `<measured at execution>` |
  | answer `unknown-session` with `unknown-run`'s 404 body | `<measured at execution>` |
  | answer `registry-unmeasurable` with 404 instead of 502 | `<measured at execution>` |
  | drop `by` from the `claimant-alive` 409 body | `<measured at execution>` |
  | drop `detail` from the `registry-unmeasurable` 502 body | `<measured at execution>` |
  | move the `Number.isInteger` arm after `coordMutex.run(...)` | `<measured at execution>` |
  | add a seventh member to `ReclaimOutcome` with no `case` arm (the `_exhaustive: never` guard) | `<measured at execution>` |
  | remove `'POST /api/runs/:id/reclaim'` from `coordinator-skill.test.ts`'s parity EXEMPT set | `<measured at execution>` |
  | revert `auth-gate.test.ts:198` to `.toBe(22)` | `<measured at execution>` |
  | revert `auth-gate.test.ts:469` to `.toBe(41)` | `<measured at execution>` |

- [ ] **4.10 — Commit.**

  ```
  git add server/src/coord/routes.ts server/test/reclaim-route.test.ts \
    server/test/coord-pause-route.test.ts server/test/auth-gate.test.ts \
    server/test/coordinator-skill.test.ts && \
  git commit -m "feat(coord): POST /api/runs/:id/reclaim, the fourth ungated door (D-1123, D-1128)"
  ```
---

## Task 5: the counts and the prose that go stale together

**Files:** `server/src/coord/routes.ts`, `server/src/auth/gate.ts`, `server/test/coord-pause-route.test.ts`, `CLAUDE.md`.

**Runs AFTER the door task** — the one that registers `POST /api/runs/:id/reclaim`, grows `UNGATED` to four (`server/test/coord-pause-route.test.ts:172`) and adds the missing reverse-direction pin. Every count word below is derived from `UNGATED.size`, so before that literal moves this task's guard wants `THREE` and its five prose edits are the ones that would be wrong. **That task must not also touch the five sites below** — the contract lists them separately under "Prose counts that NOTHING pins", and they are fixed and *mechanized* here, in one commit, by one guard. If the door task's section still carries a step for `coord-pause-route.test.ts:1-6` or for the two `routes.ts` count sentences, delete it there.

**The measurement that motivates the whole task.** Five prose sites state the door count, in words, and **not one of them is machine-checked**. Measured on this tree by slicing each site and scanning it for CAPS number words:

| site | cardinals | ordinals | names the doors |
|---|---|---|---|
| `routes.ts` pause docstring (1763 chars) | `["THREE"]` | `[]` | all three |
| `routes.ts` break docstring (1415 chars) | `[]` | `["THIRD"]` | abandon, break |
| `coord-pause-route.test.ts:1-13` header (908 chars) | `["THREE"]` | `[]` | all three |
| `auth/gate.ts` NOT-EXEMPT block (737 chars) | `[]` | `[]` | all three |
| `CLAUDE.md:141-148` bullet (824 chars) | `["THREE"]` | `[]` | all three |

The gate block's empty row is the worst case, not the best one: it says "leaves **these** off the gate", so it carries no count at all and could go on naming three doors for ever without ever contradicting itself. Wave 1 moved the same number from two to three **by hand** (`docs/superpowers/plans/2026-08-28-program-leverage-wave1-f1.md:128-183` — a whole task, no test, ending "Don't assume — read the guards") and left the same five sites to be found by hand again. This task fixes the five sentences **and** ships the mechanism, because this repo's doctrine is that a comment is a request and a red suite is a mechanism.

**Line anchors move under you.** The reclaim handler is inserted at today's `routes.ts:1021/1022`, so every number below it shifts by the size of that insertion. **Locate every site by its text, never by its number.**

- [ ] **5.1 — Confirm the five sites still read as this plan quotes them, and STOP if any does not.** One command; compare its output against the five "current text" blocks in the steps below.

  ```bash
  cd "$(git rev-parse --show-toplevel)"
  grep -n "THREE routes"        server/src/coord/routes.ts      # today :1148
  grep -n "the THIRD route in"  server/src/coord/routes.ts      # today :1724
  sed -n '156,166p'             server/src/auth/gate.ts
  sed -n '1,13p'                server/test/coord-pause-route.test.ts
  sed -n '141,148p'             CLAUDE.md
  grep -n "UNGATED = new Set"   server/test/coord-pause-route.test.ts   # must ALREADY list four
  ```

  The last line is the ordering gate: if `UNGATED` still holds three names, the door task has not landed and this one cannot start.

- [ ] **5.2 — Write the two guards FIRST.** Append this block to `server/test/coord-pause-route.test.ts` **inside** the existing `describe('the token gate is total, with the operator routes excluded BY NAME', …)` (opens `:157`) — after the honesty-clause test's close (today `:276`), before that describe's own closing `});` (today `:277`). It reuses `UNGATED` (`:172`) and `docstringFor` (`:236-242`) from that scope; `readFileSync` (`:15`), `path` (`:16`) and `__dirname` (already used at `:158` to resolve a sibling source file) need no new imports. Verified against `server/tsconfig.json`: `strict: true` without `noUncheckedIndexedAccess`, so the index reads below need no `!`.

  ```ts
  /** THE COUNT, DERIVED — because the wave that opened the fourth door found
   *  FIVE prose sites still saying THREE and not one of them had a test.
   *  `UNGATED` is the only place the door list is decided, so it is the only
   *  place the count may be spelled; every site below is checked against
   *  `UNGATED.size`, and the enumerating ones against the names themselves.
   *
   *  A CARDINAL is a claim about the tree NOW. An ORDINAL is a PLACE in the
   *  order the doors were opened and stays true for ever. Confusing the two is
   *  exactly what left "the THIRD route in this file that is UNGATED", written
   *  at the end of a list of three, reading as a completeness claim. CAPS is
   *  the convention that makes the difference checkable: a number in capitals
   *  is a claim this scanner reads, a number in lower case is history it
   *  leaves alone. */
  const CARDINAL = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN'];
  const ORDINAL = ['ZEROTH', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH'];
  // ZERO/ONE/FIRST stay out of both patterns: they are this repo's ordinary
  // CAPS emphasis ("Exactly ONE field is read", "the FIRST await"), and
  // scanning for them would fire on passages that state no count at all.
  const CARD_RE = /\b(?:TWO|THREE|FOUR|FIVE|SIX|SEVEN)\b/g;
  const ORD_RE = /\b(?:SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH)\b/g;

  const REPO = path.resolve(__dirname, '..', '..');
  const SELF = readFileSync(path.resolve(__dirname, 'coord-pause-route.test.ts'), 'utf8');
  const GATE_SRC = readFileSync(path.resolve(__dirname, '../src/auth/gate.ts'), 'utf8');
  const CLAUDE_MD = readFileSync(path.resolve(REPO, 'CLAUDE.md'), 'utf8');

  /** A named passage, or a loud failure. An anchor that stopped matching would
   *  otherwise yield the empty string, and the empty string satisfies the
   *  negative half of every assertion below — `docstringFor`'s own lesson
   *  (review finding F-A: a window whose contents depend on how long the
   *  neighbours are) applied to three more slices. */
  const passage = (name: string, text: string, from: string, to: string): string => {
    const a = text.indexOf(from);
    expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
    const b = text.indexOf(to, a + from.length);
    expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
    const out = text.slice(a, b);
    expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(300);
    return out;
  };

  /** The sites that ENUMERATE the doors. Two docstrings in `coord/routes.ts`
   *  are deliberately absent: the break door's and the reclaim door's each
   *  argue about THEMSELVES and name two of the four. They state a place, not
   *  a census, and demanding the full roster there would mint two more copies
   *  of the list this scanner exists to stop copying. */
  const enumerations = (): [string, string][] => [
    ['coord/routes.ts, the pause docstring', docstringFor('/api/coord/pause')],
    ["coord-pause-route.test.ts, this file's own header",
      passage('the file header', SELF, '// `POST /api/coord/pause`', 'import {')],
    ['auth/gate.ts, the NOT-EXEMPT block',
      passage('the NOT-EXEMPT block', GATE_SRC,
        ' *  - `POST /api/coord/pause`', 'export const EXEMPT')],
    ['CLAUDE.md, the box-token bullet',
      passage('the box-token bullet', CLAUDE_MD,
        '- **Box token gates every coordination WRITE**', '\n- **')],
  ];

  it('every prose site that states the door count states the DERIVED one', () => {
    const want = CARDINAL[UNGATED.size];
    expect(want, 'the door count outgrew the word list').toBeDefined();
    const sites: [string, string][] = [
      ...enumerations(),
      ['coord/routes.ts, the break docstring', docstringFor('/api/claims/:id/break')],
    ];
    // A site deleted from this list rather than corrected is the failure this
    // pin exists to prevent; five is the number this wave measured stale.
    expect(sites.length, 'a count site was dropped instead of corrected').toBe(5);
    for (const [name, text] of sites) {
      expect(new Set([...text.matchAll(CARD_RE)].map((m) => m[0])),
        `${name} does not state the count as ${want}`).toEqual(new Set([want]));
      for (const ord of [...text.matchAll(ORD_RE)].map((m) => m[0])) {
        expect(ORDINAL.indexOf(ord),
          `${name} names the ${ord} ungated door and there are ${UNGATED.size}`)
          .toBeLessThanOrEqual(UNGATED.size);
      }
    }
  });

  it('every site that lists the doors lists ALL of them', () => {
    // The half that catches the NEXT door rather than this one: a fifth member
    // joins `UNGATED` and four passages go red until each names it. Nothing
    // here is typed by hand, so there is no second list to forget.
    for (const [name, text] of enumerations()) {
      for (const door of UNGATED) {
        expect(text, `${name} does not name ${door}`).toContain(door);
      }
    }
  });
  ```

- [ ] **5.3 — Run it and record the exact first failing assertion, verbatim.**

  ```bash
  cd "$(git rev-parse --show-toplevel)/server" && \
    ./node_modules/.bin/vitest run test/coord-pause-route.test.ts
  ```

  Foreground, timeout 600000. Both new tests must be RED — the count test on all five sites (they say `THREE`, `THIRD`, nothing, `THREE`, `THREE` against a derived `FOUR`), the enumeration test on the four passages that do not yet name `/api/runs/:id/reclaim`. Paste the first failing assertion text into row 1 of the mutation table.

- [ ] **5.4 — `server/src/coord/routes.ts`, the pause docstring** (today `:1147-1154`; find it with `grep -n "THREE routes"`). Current text, verbatim:

  ```ts
  /**
   * `POST /api/coord/pause` — the OPERATOR's door, and one of the THREE routes
   * in this file that are UNGATED: deliberately NOT behind `requireMailToken`
   * (D-282). The others are `POST /api/runs/:id/abandon` above and
   * `POST /api/claims/:id/break` (build 9 D12 — the same abandon-door shape).
   * Among them they are the WHOLE unauthenticated write surface of this file —
   * a claim `coord-pause-route.test.ts`'s `UNGATED` set holds to exactly these
   * three names, in both directions.
  ```

  Replacement (the rest of the docstring — the box-token argument, the honesty clause, the no-`notConfigured` note, today `:1155-1175` — is untouched):

  ```ts
  /**
   * `POST /api/coord/pause` — the OPERATOR's door, and one of the FOUR routes
   * in this file that are UNGATED: deliberately NOT behind `requireMailToken`
   * (D-282). The others are `POST /api/runs/:id/abandon` above,
   * `POST /api/claims/:id/break` (build 9 D12 — the same abandon-door shape)
   * and `POST /api/runs/:id/reclaim` (program-leverage wave 5 — that shape once
   * more, for a program whose coordinator is dead and whose copy of the box
   * token died on the box with it). Among them they are the WHOLE
   * unauthenticated write surface of this file, and
   * `coord-pause-route.test.ts`'s `UNGATED` set now holds that claim in BOTH
   * directions: no route outside the set reaches its first `await` without a
   * token check, and no route inside it may quietly acquire one. The second
   * half arrived with the fourth door — the sentence had been claiming both
   * directions while only the first was ever measured, so a listed door that
   * had since been gated would have gone on being described here as ungated
   * with nothing in the suite to say otherwise.
  ```

  **"In both directions" is what this replacement makes honest, not what it inherits.** Measured on the pre-wave tree: `coord-pause-route.test.ts:184-208` proves every route *not* in `UNGATED` carries a gate ahead of its first `await`, and `:244-258` proves every route *in* it carries an argued docstring — but nothing proved a listed route actually *lacks* the gate, so adding a name to the set while leaving a token check in the handler passed both. The door task supplies that missing direction (the `it.each([...UNGATED])` gate-absence pin plus its positive control on `POST /api/runs/:id/close`); this sentence describes what is pinned *after* it, which is why the two tasks must land in that order.

  Two things not to break: `requireMailToken` stays in **backticks with no `(` after it** — `auth-gate.test.ts` classifies a handler as gated on `/requireMailToken\(req/` anywhere in its slice and a docstring falls inside the *preceding* route's slice — and the block keeps the literals `UNGATED`, `D-282` and a case-insensitive `coordinator`, which `coord-pause-route.test.ts:252-257` pins with a 600-character floor.

- [ ] **5.5 — `server/src/coord/routes.ts`, the break docstring** (today `:1723-1727`; `grep -n "the THIRD route in"`). Current text, verbatim:

  ```ts
  /**
   * `POST /api/claims/:id/break` — the OPERATOR's door, the THIRD route in
   * this file that is UNGATED: deliberately NOT behind `requireMailToken`, the
   * `POST /api/runs/:id/abandon` shape (D-282's argument, applied by build 9
   * D12/D16). The box token authenticates the fleet host, and the sessions
  ```

  Replacement (the docstring continues unchanged from `that hold claims live there and hold that token —`):

  ```ts
  /**
   * `POST /api/claims/:id/break` — the OPERATOR's door, the THIRD of the FOUR
   * routes in this file that are UNGATED: deliberately NOT behind
   * `requireMailToken`, the `POST /api/runs/:id/abandon` shape (D-282's
   * argument, applied by build 9 D12/D16). The ordinal is this door's PLACE in
   * the order they were opened and stays true whatever opens next; the number
   * beside it is a claim about the tree today, which is why it is now derived
   * from `UNGATED.size` by a scanner rather than trusted —
   * `POST /api/runs/:id/reclaim` (program-leverage wave 5) is the fourth. The
   * box token authenticates the fleet host, and the sessions
  ```

  The ordinal was never false: `break` was and remains the third door opened, and it stays `THIRD` here on purpose. What was wrong is that "the THIRD route in this file that is UNGATED", written at the end of a list of three, *reads* as a completeness claim. Stating the count beside the position is also what makes this site pinnable at all — measured, it carried no CAPS cardinal for the scanner to check, and now it carries exactly one.

- [ ] **5.6 — `server/src/auth/gate.ts`, the NOT-EXEMPT block** (`:144-166`; the bullet that changes is `:156-165`). Current text, verbatim:

  ```ts
   *  - `POST /api/coord/pause`, `POST /api/runs/:id/abandon` and
   *    `POST /api/claims/:id/break` — `coord/routes.ts` leaves these off the
   *    BOX-TOKEN gate on purpose (D-282 (was D-B4-9): the coordinator holds that token, and a
   *    pause it can lift is not a pause; build 9 D12 applies the same argument to
   *    the claim-break door, the third instance — the sessions that hold claims
   *    hold that token too). That argument is about the box token specifically and
   *    does not transfer: they are the OPERATOR's doors, the operator is the one
   *    holding a session, and a session cookie is precisely the credential the
   *    coordinator does not have. Gating them here strengthens D-282 rather than
   *    reversing it.
  ```

  Replacement. **The `D-282 (was D-B4-9)` line is copied byte-for-byte and must not be rewrapped:** `server/test/deviation-refs.test.ts:168`'s `const BARE = /(?<!was )\bD-B\d+-\d+\b/g` walks every `git ls-files` path (`:182-196`), and a line break inserted inside that parenthetical reds `finds zero bare legacy refs anywhere git ls-files reaches` at `:201-204`. (Note the same trap binds THIS plan: the legacy token may only ever appear in its `(was …)` form, never quoted on its own.) That is why the third line below is short — the wrap is load-bearing, not sloppy.

  ```ts
   *  - `POST /api/coord/pause`, `POST /api/runs/:id/abandon`,
   *    `POST /api/claims/:id/break` and `POST /api/runs/:id/reclaim` — the FOUR
   *    routes `coord/routes.ts` leaves off the
   *    BOX-TOKEN gate on purpose (D-282 (was D-B4-9): the coordinator holds that token, and a
   *    pause it can lift is not a pause; build 9 D12 applies the same argument to
   *    the claim-break door, the third instance — the sessions that hold claims
   *    hold that token too; program-leverage wave 5 applies it to the fourth,
   *    where the locked-out party is a whole program whose coordinator is dead
   *    and whose copy of that token died on the box with it). That argument is
   *    about the box token specifically and does not transfer: they are the
   *    OPERATOR's doors, the operator is the one holding a session, and a
   *    session cookie is precisely the credential the coordinator does not
   *    have. Gating them here strengthens D-282 rather than reversing it.
   *
   *    The fourth door is where that last sentence has to be READ rather than
   *    assumed, because unlike the other three it takes a body: `claimedBy`,
   *    the session the run is handed to. The gate is what stops an anonymous
   *    caller naming one on an armed box. What stops a WRONG one is not a
   *    credential at all — it is the route's own re-measurement of the claimant
   *    it would displace, which refuses while that session is alive and refuses
   *    again when the registry cannot be measured.
  ```

  Note the deliberate case change. The block previously said "leaves **these** off" — no count, nothing to contradict, which is precisely how it would have gone on naming three doors indefinitely. `FOUR` in capitals is what puts it under the guard; "the third instance" and "the fourth" stay lower case because they are history, not a census. `:166`'s closing ` */` and `:167`'s `export const EXEMPT` are untouched — the second is the passage slicer's terminator.

- [ ] **5.7 — `server/test/coord-pause-route.test.ts`, the file header** (`:1-13`). Only `:1-6` change; `:7-13`, the authorization-ruling paragraph, stays exactly as it is. Current text, verbatim:

  ```ts
  // `POST /api/coord/pause` — the operator's door onto `$REG/coordinator-paused`,
  // and one of the THREE write routes in `coord/routes.ts` deliberately not behind
  // `requireMailToken` (D-282 (was D-B4-9)). The others are `POST /api/runs/:id/abandon` (same
  // build, same reason) and `POST /api/claims/:id/break` (build 9 D12, the same
  // abandon-door shape); the `UNGATED` set below is the whole list, and the
  // scanner holds it to exactly those three.
  ```

  Replacement — again keeping `D-282 (was D-B4-9)` intact on one line, for `deviation-refs.test.ts:168`'s sake:

  ```ts
  // `POST /api/coord/pause` — the operator's door onto `$REG/coordinator-paused`,
  // and one of the FOUR write routes in `coord/routes.ts` deliberately not behind
  // `requireMailToken` (D-282 (was D-B4-9)). The others are `POST /api/runs/:id/abandon` (same
  // build, same reason), `POST /api/claims/:id/break` (build 9 D12, the same
  // abandon-door shape) and `POST /api/runs/:id/reclaim` (program-leverage wave 5,
  // that shape once more, onto a coordinator that is already dead); the `UNGATED`
  // set below is the whole list, the scanner holds it in BOTH directions, and —
  // since this wave — the count word in every prose site that states it is read
  // off `UNGATED.size` instead of typed.
  ```

  The header is the guard's own first passage and its opening anchor is its first line, so this edit and the scanner move together by construction. `coordinator-skill.test.ts:1096-1101` reads this file too, but only through `/UNGATED = new Set\(\[([^\]]*)\]\)/` — the set literal, not the header — so nothing here disturbs that harvest.

- [ ] **5.8 — `CLAUDE.md:141-148` — TWO coordinated edits to ONE paragraph, in a single pass.** Current text, verbatim:

  ```markdown
  - **Box token gates every coordination WRITE** (`/api/mail*`, `/api/runs*`) — header `x-ccrc-mail-token`, `401`
    on missing — **except THREE deliberately ungated operator doors: `POST /api/coord/pause`, `POST
    /api/runs/:id/abandon` and `POST /api/claims/:id/break`** (D-282 (was D-B4-9), extended to the third by build 9
    D12: the sessions that would be locked out — the coordinator, and any session holding a claim — are the ones
    holding the box token, so gating a wedge's release valve behind that key leaves the wedge no door).
    `coord-pause-route.test.ts`'s `UNGATED` set pins all three in both directions, and with `CCRC_AUTH` armed all
    three still sit behind the session gate (`auth/gate.ts`'s NOT-EXEMPT note: gating them there "strengthens
    D-282 rather than reversing it"). Don't assume — read the guards.
  ```

  **The two edits are one edit.** The door count moves to four, *and* wave 4's now-unnamed exception is folded in, in the same pass — because a second uncoordinated pass over this paragraph is exactly what wave 4 refused to make. Its own note (`docs/superpowers/plans/2026-08-30-program-leverage-wave4-f4.md:1226-1231`) reads: *"This wave's `POST /api/sessions/:id/kickoff` is a coordination WRITE that is session-gated only… It is not an ungated door — armed, it sits behind the auth gate exactly like every other PWA-surface write — so the sentence is not wrong so much as incomplete. Left for wave 5's `CLAUDE.md` correction to fold in rather than edited here."* So the kickoff half is written as a **clarification, not a correction**: the bullet's own parenthetical already scopes the box-token gate to `/api/mail*` and `/api/runs*`, and `POST /api/sessions/:id/kickoff` (`server/src/server.ts:1484`) is under neither prefix. Saying it was "wrong" would misstate the record wave 4 left.

  Replacement. `D-282 (was D-B4-9)` sits intact on one line and is spelled exactly once in the paragraph; every line measured at 96-111 characters against 112-115 in the surrounding neighbourhood:

  ```markdown
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
    "strengthens D-282 rather than reversing it"). The two prefixes above are the whole box-token surface, which
    is why one coordination WRITE sits outside this rule without being an ungated door: `POST
    /api/sessions/:id/kickoff` (wave 4) is under neither prefix, carries no box token, and is session-gated only
    — armed, it is behind the auth gate like every other PWA-surface write. Don't assume — read the guards.
  ```

  Checked against the scanner before writing: the only CAPS cardinal in the new text is `FOUR` (`DEAD`, `WRITE`, `RE-MEASUREMENT` are not number words, and "The two prefixes" is deliberately lower case), and there is no CAPS ordinal, so the count assertion sees exactly `{FOUR}` and the ordinal loop sees nothing.

- [ ] **5.9 — Green, and check the trap directly rather than by reasoning.**

  ```bash
  cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run \
    test/coord-pause-route.test.ts test/deviation-refs.test.ts test/oss-metadata.test.ts \
    test/topology-clean.test.ts test/coordinator-skill.test.ts test/auth-gate.test.ts \
    test/mail-routes.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts
  ```

  Foreground, timeout 600000. Why each: `deviation-refs` is the legacy-ref rewrap trap, and it fires on **two** of the files edited here (`gate.ts`, `CLAUDE.md`) plus the test header; `oss-metadata` and `topology-clean` both read `CLAUDE.md`; `coordinator-skill` harvests this test file's `UNGATED` literal by regex two lines below the header just edited; `auth-gate` reads `gate.ts`'s `EXEMPT` map, whose first entry sits one line under the block just rewritten; `mail-routes:383` scans `server/src/coord/*.ts` for undeclared quoted kebab tokens — every count word added to `routes.ts` is bare prose or backticked, never a single-quoted hyphenated literal; `single-definition`'s four ROOTS (`:32-36`) exclude `server/test`, so the new `CARDINAL`/`ORDINAL` arrays cannot trip it, and this run proves that rather than assuming it; `typecheck-tests` is the only gate that compiles `server/test`. **Read the tail of the output, not a grep of it** (wave 4's own recorded miss).

- [ ] **5.10 — Measure the mutation table.** For each row: apply the mutation to the file it names, run `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-pause-route.test.ts`, record the **first failing assertion verbatim**, then revert from a working-tree snapshot and `git diff --stat` clean before the next one.

  | mutation | first-fail assertion |
  |---|---|
  | in the count test, replace `CARDINAL[UNGATED.size]` with the literal `'THREE'` — the hand-typed count all five sites carried | `<measured at execution>` |
  | revert `CLAUDE.md`'s bullet to its pre-wave text (`THREE`, reclaim unnamed, no kickoff clause) | `<measured at execution>` |
  | revert the pause docstring's `FOUR` to `THREE`, leaving the rest of 5.4 in place | `<measured at execution>` |
  | revert `coord-pause-route.test.ts`'s own header from `FOUR` to `THREE` | `<measured at execution>` |
  | revert `auth/gate.ts`'s "the FOUR routes" to "leaves **these** off" — the countless shape it had | `<measured at execution>` |
  | revert the break docstring to "the THIRD route in this file that is UNGATED" (no cardinal at all) | `<measured at execution>` |
  | change the break docstring's ordinal to `the FIFTH of the FOUR routes` | `<measured at execution>` |
  | drop `` `POST /api/runs/:id/reclaim` `` from `auth/gate.ts`'s NOT-EXEMPT list, keeping the word `FOUR` | `<measured at execution>` |
  | change `passage`'s `CLAUDE.md` opening anchor to a string not in the file — the slicer's own anti-vacuity guard | `<measured at execution>` |

- [ ] **5.11 — Check `CLAUDE.md`'s pinned README-size claim, and record that this wave does not move it.** The claim is at **`CLAUDE.md:10`**, not `:9`: `` **`README.md` (~1931 lines) is the canonical system overview.`` `server/test/oss-metadata.test.ts:89-101` extracts it with `` /README\.md` \(~?([0-9,]+) lines\)/ `` and asserts `Math.abs(said - real) / real < 0.1` against `read('README.md').split('\n').length - 1`. Measured now: said **1931**, real **2033** → 5.02% drift, green; it reds at 2146 lines, i.e. **113 more lines of README**. This wave adds none — no task in the plan names `README.md` as a file it edits — so the sentence stands unchanged at `~1931`. Verify rather than assume, and if the number moved, the fix is the sentence, not the threshold:

  ```bash
  cd "$(git rev-parse --show-toplevel)" && wc -l README.md && sed -n '10p' CLAUDE.md
  ```

- [ ] **5.12 — Record the README findings; edit nothing there.** Three measurements, all taken on this tree:
  - **`README.md` states no door count and lists no ungated door.** `grep -ic "ungated" README.md` → **0**; `grep -nE "\b(THREE|THIRD|FOUR|FOURTH)\b" README.md` → two hits, both `TWO` about unrelated things (`:1237` skill paths, `:1681` `shared/`'s two producers). The prior scout's zero is confirmed. Nothing in `README.md` goes stale from the count moving to four.
  - **`README.md:1405-1407` is a different defect, and this wave makes it worse.** Verbatim: "`/api/mail` (and its ack route), the run routes (`POST /api/runs`, `/:id/dispatch`, `/:id/close`, `/:id/advance`), `GET /api/mail?to=<id>` and `/api/notify` (ccd's swap hook) all require the same **box token**". Each of the four named routes really is gated, so the sentence is not false term-by-term — the falsehood is the phrase **"the run routes"**, which reads as the complete set and is wrong in both directions: it omits `POST /api/runs/:id/items` (gated, build 9) and it sweeps in `POST /api/runs/:id/abandon`, which requires no token at all. `/:id/reclaim` makes that the second run route the plain reading gets wrong. **Not edited here** — it is a pre-existing defect in a paragraph this wave otherwise never touches, and its neighbour `README.md:528-531` ("nine box-token-gated coordination routes plus `/api/notify`") is stale in the same family against the eighteen lanes `auth-gate.test.ts:427-433` enumerates. Repairing them is a README pass with its own measurement, not a rider on a docs commit — and note 5.11: a README pass has 113 lines of headroom before it must also move `CLAUDE.md:10`. The replacement clause is ready if the coordinator rules otherwise: *"…the run routes (`POST /api/runs`, `/:id/dispatch`, `/:id/close`, `/:id/advance`, `/:id/items`) — but NOT the operator doors `/:id/abandon` and `/:id/reclaim`, which are ungated by design (D-282) — …"*.

- [ ] **5.13 — Commit.**

  ```bash
  cd "$(git rev-parse --show-toplevel)" && git add \
    server/src/coord/routes.ts \
    server/src/auth/gate.ts \
    server/test/coord-pause-route.test.ts \
    CLAUDE.md \
    && git commit -m "docs(wave5): the ungated operator doors are four, and the count is now derived"
  ```

  Message body, in this repo's shape: name the five sites that said THREE/THIRD with nothing checking them, cite `coord-pause-route.test.ts:172` as the one place the list is decided, and say that the `CLAUDE.md` paragraph carries wave 4's deferred kickoff clarification in the same edit rather than a second pass.

---

## Task 6: the wave-aware re-kickoff — widening the seam without widening the surface

**Files:** `server/src/coord/kickoff.ts`, `server/src/server.ts`, `server/test/coord-kickoff.test.ts`,
`server/test/kickoff-route.test.ts`.

**Deviations this task defines:** `D-1126` (the widened seam and its both-or-neither body pair),
`D-1132` (the fold, recorded and deliberately not opened). Both from this wave's block
(`D-1123..1140`) — reconcile against the plan's `## Deviations found` before the commit in 6.11.

**THE FINDING, measured before a line was written.** The brief says "REUSE `queueProgramKickoff`". It
is not a reuse. `programKickoff`'s third sentence is the literal `Run the ccrc-coordinator skill and
open the run for wave 1.` (`shared/api.ts:3104-3107`) — hardcoded, with no parameter that could say
otherwise. Sending that to a *revived* coordinator on a program standing at wave 5 briefs it to open
wave 1, and `ccd/coordinator-skill/references/resume.md:78-93` exists to correct exactly that mistake
in prose, to a human, because until this wave no machine could say it: "the open route dedupes ONLY a
retry naming the same program, wave and `claimedBy` against a row that is still `planned`. Re-opening
a `working` wave, or opening wave 1 on a program that is at wave 5, writes a SECOND row." So the
wave-4 seam is right exactly once — at program start — and wrong for every revive after it. What is
genuinely reusable is everything *around* the sentence: the dedupe key
(`server/src/coord/kickoff.ts:104-110`), the byte cap (`:91-103`), the operator sender (`:78-83`), the
run-less envelope (`:85-90`), and the three-way answer (`:72-74`). A second entry point would restate
all five, and a second restatement of the cap is the drift D-1119 was opened for. Hence: one function,
one optional argument, and the argument selects the composer and nothing else.

**THE FOLD, and why this wave records it rather than opening it (`D-1132`).** `KickoffOutcome`'s
`queued: false` (`server/src/coord/kickoff.ts:73`, via `SystemMailQueued` at
`server/src/coord/rundefs.ts:150-152`) folds two facts: *this* program's kickoff is already waiting,
and a *different* program's is. Measured, not assumed: `queueSystemMail` decides on
`coord.hasOutstandingMail(m.fromId, m.runId, m.toId, m.subject)`
(`server/src/coord/rundefs.ts:193`), and that method returns a bare `boolean` — `return row !== undefined`
over a `SELECT 1 AS x … LIMIT 1` (`server/src/coord/store.ts:1353-1360`). Nothing about the row it
found comes back. Nor could a caller go and look: the one shared column list both mail reads use,
`MAIL_ROW_COLUMNS` (`server/src/coord/store.ts:274-285`), carries `subject`, `kind`, `artifacts`,
`state`, the attempt counters and the gate columns — and **not** `m.body`. The kickoff's subject is the
constant `PROGRAM_KICKOFF_SUBJECT` for every program (`shared/api.ts:3114`), deliberately un-namespaced
by slug, so the slug lives *only* in the body. Telling the two apart therefore needs a new store read
returning a column no read returns today. **Decision for this wave: do not open it.** The re-kickoff
lane does not consume the distinction — both answers mean the same thing to the operator at the board
("a kickoff is already waiting for that session; it has not read it yet"), and the act is the same
either way (wait for the ack, or go look at the pane). Opening it would ship a seam nothing reads.
The consequence is not theoretical and must not be buried: **in the exact wave-5 scenario this door
exists for, the dead coordinator's own unacked kickoff is usually still sitting in the lane**, holding
the key — so `queued: false` is the COMMON answer to a re-kickoff, not the rare one. That is pinned as
a behaviour in 6.2 and it is a message the ResumeSheet's copy must carry: "a kickoff is already waiting
for this session — nothing was queued" is the truth, and "the re-kickoff failed" is not.

- [ ] **6.1 — Gate on the L0 half, and stop if it is not there.** This task composes with a constant
  another task adds. Run `grep -n 'export const programResumeKickoff' shared/api.ts` and
  `grep -n 'find run \${runId} at wave' shared/api.ts`. Both must hit. If they do not, the L0 task has
  not landed on this branch and every step below fails at import resolution rather than at an
  assertion — do not "helpfully" add the constant here, it belongs to that task's own red-first
  measurement. Record the two grep hits in the execution log; they are the anchors 6.2 pins against.

- [ ] **6.2 — RED: the seam's resume block, written whole, in `server/test/coord-kickoff.test.ts`.**
  Append after the existing `describe` at `:37-201`, before the ring pin at `:211`. Extend that file's
  import at `:15` to `import { MAIL_BODY_MAX_BYTES, PROGRAM_KICKOFF_SUBJECT, programKickoff, programResumeKickoff } from '../../shared/api.js';`.

  ```ts
  const RESUME = { runId: 7, wave: 5 };

  /** The five sentences, spelled out. The same two-sided pin as the wave-1 body at
   *  `:52-66`: against the L0 constant, so the seam is pinned to USE it rather
   *  than compose its own, and against the literal, so a change to the constant
   *  cannot silently change what a revived coordinator is told. */
  const RESUME_BODY =
    'You are the coordinator for program `build9-demo` (Build 9 demo).\n'
    + 'Its ledger is `docs/superpowers/programs/build9-demo.md`.\n'
    + 'Run the ccrc-coordinator skill. Its run is ALREADY OPEN: read `GET /api/runs`,\n'
    + 'find run 7 at wave 5, and pick that wave up where the ledger says it\n'
    + 'stands. Do not open the run for wave 5 again, and do not open wave 1 again.';

  describe('queueProgramKickoff(resume) — the wave-N re-kickoff', () => {
    it('sends the RESUME sentence, byte for byte', () => {
      const s = store();
      queueProgramKickoff({ coord: s }, ID, PROGRAM, RESUME);
      const envelope = due(s)[0]!.envelope;
      expect(envelope).toContain(
        programResumeKickoff(PROGRAM.slug, PROGRAM.title, RESUME.runId, RESUME.wave));
      expect(envelope).toContain(RESUME_BODY);
      // The half that matters at the recipient: the wave-1 instruction is GONE,
      // not merely joined. A composer that appended the resume sentences to the
      // standing body would satisfy the two lines above.
      expect(envelope).not.toContain('open the run for wave 1.');
    });

    it('NO resume argument still queues wave 4\'s body, byte for byte', () => {
      // The "unchanged behaviour" claim, with a fixture that could witness the
      // change. A seam that composed the resume sentence unconditionally —
      // defaulting `{runId: 0, wave: 1}`, the cheap way to write this widening —
      // passes every other test in this file and reds here.
      const s = store();
      queueProgramKickoff({ coord: s }, ID, PROGRAM);
      const envelope = due(s)[0]!.envelope;
      expect(envelope).toContain(programKickoff(PROGRAM.slug, PROGRAM.title));
      expect(envelope).not.toContain('ALREADY OPEN');
    });

    it('names no run on the ENVELOPE, though the body names one in prose', () => {
      // The body says "find run 7"; `mail.runId` stays null, and that is a
      // decision. `hasOutstandingMail`'s key is (fromId, runId, toId, subject)
      // and `queueSystemMail` passes `m.runId` straight into it, so stamping the
      // run id here would give every wave its own dedupe slot — a fresh
      // re-kickoff piled on top of an unread one, every wave, which is the
      // unbounded requeue review finding 33 closed. It would also restore the
      // `run:` envelope line for a program/wave pair this mail does not carry.
      const s = store();
      queueProgramKickoff({ coord: s }, ID, PROGRAM, RESUME);
      expect(due(s)[0]!.envelope).not.toContain('run:');
      const row = s.db.prepare('SELECT runId FROM mail').get() as { runId: number | null };
      expect(row.runId).toBeNull();
    });

    it('THE FOLD (D-1132), pinned as a decision: an outstanding wave-1 kickoff declines the re-kickoff', () => {
      // The dedupe key does not widen, and in the scenario this door exists for
      // the dead coordinator's OWN unacked kickoff is usually still holding it —
      // so `queued:false` is the common answer here, not the rare one. Pinned so
      // that "the re-kickoff queued nothing" is documented behaviour of the seam
      // rather than a surprise at the board, and so that a later slug- or
      // run-namespaced subject is a decision somebody makes on purpose.
      const s = store();
      expect(queued(s, ID).queued).toBe(true);
      const out = queueProgramKickoff({ coord: s }, ID, PROGRAM, RESUME);
      if (!out.ok) throw new Error(`fixture: the seam refused this re-kickoff (${out.kind})`);
      expect(out.queued).toBe(false);
      expect(due(s).length).toBe(1);
      expect((s.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n).toBe(1);
    });

    describe('the cap (D-1119) covers the new composer for free', () => {
      it('refuses an oversize RESUME body and writes NOTHING', () => {
        const s = store();
        const out = queueProgramKickoff({ coord: s }, ID,
          { slug: 'build9-demo', title: 'x'.repeat(MAIL_BODY_MAX_BYTES) }, RESUME);
        expect(out.ok).toBe(false);
        if (out.ok) throw new Error('unreachable — narrowed above');
        expect(out.kind).toBe('oversize');
        expect(out.limit).toBe(MAIL_BODY_MAX_BYTES);
        expect(due(s)).toEqual([]);
      });

      it('a title the WAVE-1 body accepts is refused as a resume — the cap follows the composer', () => {
        // The window a cap measured on the wrong composition would miss. The
        // resume sentence is two sentences longer, so there is a band of titles
        // that fit one body and not the other, and this is a title in it. A cap
        // on `program.title`, or on `programKickoff(...)` computed before the
        // branch, queues the second call.
        const wave1Base = Buffer.byteLength(programKickoff('build9-demo', ''), 'utf8');
        const title = 'x'.repeat(MAIL_BODY_MAX_BYTES - wave1Base);
        const asWave1 = store();
        expect(queueProgramKickoff({ coord: asWave1 }, ID, { slug: 'build9-demo', title }).ok).toBe(true);
        // A SECOND store: the accepted call above occupies the dedupe key, and a
        // `queued:false` here would look like a refusal that never happened.
        const asResume = store();
        expect(queueProgramKickoff({ coord: asResume }, ID, { slug: 'build9-demo', title }, RESUME).ok)
          .toBe(false);
        expect(due(asResume)).toEqual([]);
      });

      it('a RESUME body at exactly the cap is queued — the refusal is > and not >=', () => {
        const s = store();
        const base = Buffer.byteLength(programResumeKickoff('build9-demo', '', 7, 5), 'utf8');
        const title = 'x'.repeat(MAIL_BODY_MAX_BYTES - base);
        expect(Buffer.byteLength(programResumeKickoff('build9-demo', title, 7, 5), 'utf8'))
          .toBe(MAIL_BODY_MAX_BYTES);
        expect(queueProgramKickoff({ coord: s }, ID, { slug: 'build9-demo', title }, RESUME).ok).toBe(true);
        expect(due(s).length).toBe(1);
      });
    });
  });
  ```

  Run `cd server && ./node_modules/.bin/vitest run test/coord-kickoff.test.ts` (foreground, timeout
  600000) and **record the exact first failing assertion text, verbatim**.

  **CORRECTED AT EXECUTION — this step predicted the wrong failure.** It said to expect a TypeScript
  arity error on the fourth argument rather than an assertion. Measured: vitest strips types, so the
  fourth argument is silently ignored at runtime and the named suite fails on a REAL assertion —
  an `AssertionError` that the rendered envelope does not contain the resume sentence, at
  `test/coord-kickoff.test.ts:221`, with the received envelope carrying wave 1's
  `Run the ccrc-coordinator skill and open the run for wave 1.` where the expected one carries the
  ALREADY OPEN sentences (2 failed, 20 passed). The arity error is real but lives in ANOTHER suite:
  `typecheck-tests.test.ts` reports `error TS2554: Expected 3 arguments, but got 4.` six times over
  this file. Same lesson the execution-order table already records for task 1's missing export and
  D-1137 records for the PWA, in a third place: **vitest sees no types, so a type-level red must be
  measured in `typecheck-tests`, never in the suite under edit.** Run both — and expect only TWO of the
  seven new cases to red at this step. The other five pin behaviour the wave-1 path already satisfies
  (a null `runId`, the dedupe decline, the oversize refusal) and only become live once the branch
  exists; they are the reason 6.10's rows and not this step's colour are what measures this task.

- [ ] **6.3 — Widen the seam.** In `server/src/coord/kickoff.ts`, extend the import at `:3` to
  `import { MAIL_BODY_MAX_BYTES, PROGRAM_KICKOFF_SUBJECT, programKickoff, programResumeKickoff } from '../../../shared/api.js';`,
  then change the signature and the first line of the body (`:112-117`):

  ```ts
  export function queueProgramKickoff(
    deps: KickoffDeps,
    toId: string,
    program: { slug: string; title: string },
    resume?: { runId: number; wave: number },
  ): KickoffOutcome {
    const body = resume
      ? programResumeKickoff(program.slug, program.title, resume.runId, resume.wave)
      : programKickoff(program.slug, program.title);
  ```

  Everything from `const bytes = Buffer.byteLength(body, 'utf8');` (`:118`) down is **untouched** —
  that is the point of the shape, and 6.2's cap block is what proves it.

- [ ] **6.4 — Write the argument into the docstring, above the function.** Insert as the paragraph
  before `THE DEDUPE KEY IS …` (`server/src/coord/kickoff.ts:104`), and extend the cap paragraph's
  last sentence:

  ```ts
  /**
   * THE `resume` ARGUMENT IS A FOURTH PARAMETER, not a second function (wave 5,
   * D-1126). The brief said "reuse this"; measured, that is not a reuse.
   * `programKickoff`'s third sentence hardcodes "open the run for wave 1"
   * (`shared/api.ts:3104-3107`) — right exactly once, at program start, and wrong
   * for every revive after it. Handing it to a coordinator revived on a program
   * standing at wave 5 briefs it to open wave 1, and the open route dedupes only
   * a `planned` retry naming the same program, wave and claimant, so what that
   * writes is a SECOND run row: a second ledger the board renders, and an
   * open-run count the program never gets back to zero.
   * `ccd/coordinator-skill/references/resume.md` §4 exists to say precisely that
   * to a human, in prose, because until this wave nothing could say it in a
   * message.
   *
   * What genuinely IS shared is everything around the sentence — the dedupe key
   * below, the cap above, the operator sender, the run-less envelope and the
   * three-way answer. A second entry point restates all five, and a second
   * restatement of the cap is the exact drift D-1119 was opened for. So the
   * composer is the only thing that varies, and the argument selects nothing but
   * the composer: absent, this function is byte-for-byte wave 4's.
   *
   * NOTHING ELSE MOVES WITH IT — in particular `runId` stays `null` below even
   * when `resume.runId` names a real run. The prose says "find run 7"; the
   * ENVELOPE claims no run, because `runId` is one quarter of the dedupe key
   * `queueSystemMail` reads, and a run-stamped key would give every wave its own
   * slot and pile a fresh re-kickoff on top of each unread one.
   */
  ```

  And append to the cap paragraph (`:91-103`), after "…by exactly the length of a template.":

  ```ts
   * Wave 5's resume body is longer than wave 1's by two sentences and a run id,
   * and it reaches the three lines below through the same `body` local — which is
   * the whole reason the cap sits there and not on `program.title`. A cap on the
   * title would have to know which template was about to wrap it.
  ```

- [ ] **6.5 — Green on the seam, and on the scanners that arbitrate this directory.**
  `cd server && ./node_modules/.bin/vitest run test/coord-kickoff.test.ts test/mail-routes.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts`
  (foreground, timeout 600000). `mail-routes.test.ts:383`'s kebab scanner reads comments as well as
  code under `server/src/coord` — the docstring above spells no code in single quotes and adds no
  hyphenated literal, so it must stay green *without* a `NOT_CODES` entry. If it reds, the docstring is
  the bug, not the scanner.

- [ ] **6.6 — RED: the route's resume block, in `server/test/kickoff-route.test.ts`.** Extend the
  import at `:22` with `programResumeKickoff`, add the fixtures beside `BODY` at `:25`, and append a
  fourth `describe` after `:263`:

  ```ts
  const RESUME = { runId: 7, wave: 5 };
  const RESUME_BODY = { ...BODY, ...RESUME };
  ```

  ```ts
  describe('POST /api/sessions/:id/kickoff — the wave-N re-kickoff', () => {
    let app: FastifyInstance | undefined;
    afterEach(async () => { await app?.close(); app = undefined; });

    it('200 queued:true, and what lands in the lane is the RESUME sentence', async () => {
      const home = mkTmp('ccrc-kick-');
      seed(home, ID);
      const { run } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const res = await post(app, ID, RESUME_BODY);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, queued: true });
      const due = w.coord.dueDeliveries(Date.now(), 60_000);
      expect(due.length).toBe(1);
      expect(due[0]!.envelope).toContain(programResumeKickoff(BODY.slug, BODY.title, 7, 5));
      expect(due[0]!.envelope).not.toContain('open the run for wave 1.');
      expect(due[0]!.envelope).toContain(`subject: ${PROGRAM_KICKOFF_SUBJECT}`);
    });

    it('the wave-1 path is UNCHANGED — neither field, and the wave-1 sentence is what lands', async () => {
      // Not a tautology, and not a re-run of `:206-220`: this fixture reds
      // against a handler that read a missing pair as `{runId: 0, wave: 1}` and
      // composed the resume sentence from it — the cheap way to write this
      // widening, and the one that silently rewrites every start-program kickoff
      // in the fleet.
      const home = mkTmp('ccrc-kick-');
      seed(home, ID);
      const { run } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      expect((await post(app)).statusCode).toBe(200);
      const due = w.coord.dueDeliveries(Date.now(), 60_000);
      expect(due[0]!.envelope).toContain(programKickoff(BODY.slug, BODY.title));
      expect(due[0]!.envelope).not.toContain('ALREADY OPEN');
    });

    it.each([
      ['a lone runId', { ...BODY, runId: 7 }],
      ['a lone wave', { ...BODY, wave: 5 }],
      ['a fractional wave', { ...BODY, runId: 7, wave: 1.5 }],
      ['a string runId', { ...BODY, runId: '7', wave: 5 }],
      ['an explicit null wave', { ...BODY, runId: 7, wave: null }],
    ])('400 bad-request for %s, and queues NOTHING', async (_label, payload) => {
      // BOTH OR NEITHER. Absence-permits is the wire rule for a field an older
      // peer may not know about; a HALF-PRESENT pair is not an older peer — no
      // build ever sent one — it is a caller that meant something. Completing it
      // with a default briefs a coordinator standing at wave 5 to open wave 1,
      // and the operator reads `queued:true` and believes the revive worked. The
      // "queues NOTHING" half is the assertion that separates a 400 from a
      // silent wave-1 kickoff: an answer alone could be honest and write anyway.
      const home = mkTmp('ccrc-kick-');
      seed(home, ID);
      const { run } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const res = await post(app, ID, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
      expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
    });

    it('413 for a resume kickoff over the cap — and it does not occupy the dedupe key', async () => {
      // The resume arm of `:240-262`. The cap is at the seam, so the route gains
      // this for free; pinned anyway, because "for free" is a claim about a call
      // site that could have stopped forwarding the pair.
      const home = mkTmp('ccrc-kick-');
      seed(home, ID);
      const { run } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const over = await post(app, ID, { slug: BODY.slug, title: 'x'.repeat(64 * 1024), ...RESUME });
      expect(over.statusCode).toBe(413);
      expect(over.json()).toMatchObject({ ok: false, error: 'oversize', limit: MAIL_BODY_MAX_BYTES });
      expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
      const sane = await post(app, ID, RESUME_BODY);
      expect(sane.json()).toMatchObject({ ok: true, queued: true });
      expect(w.coord.dueDeliveries(Date.now(), 60_000).length).toBe(1);
    });
  });
  ```

  Run `cd server && ./node_modules/.bin/vitest run test/kickoff-route.test.ts` and record the exact
  first failing assertion, verbatim. The two rows that must red for the RIGHT reason are the lone-field
  400s: against today's handler they queue a wave-1 kickoff and answer 200, so the recorded failure
  should be `expected 200 to be 400`, not a body mismatch.

- [ ] **6.7 — Widen the route.** In `server/src/server.ts`, replace the body-parse block at
  `:1497-1501` and the call at `:1515`:

  ```ts
    const body = (req.body ?? {}) as
      { slug?: unknown; title?: unknown; runId?: unknown; wave?: unknown };
    if (typeof body.slug !== 'string' || body.slug.trim() === ''
      || typeof body.title !== 'string' || body.title.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    // ONE reader for the new pair (the wire rule), computed once and handed on as
    // a value that CANNOT be half-formed — the refusal below is the only place a
    // half-formed pair can reach. Shape borrowed from `coord/routes.ts:463` and
    // `:893`: `typeof === 'number'` AND `Number.isInteger`, because `NaN` and
    // `1.5` are both numbers and neither is a wave.
    const resume = typeof body.runId === 'number' && Number.isInteger(body.runId)
      && typeof body.wave === 'number' && Number.isInteger(body.wave)
      ? { runId: body.runId, wave: body.wave }
      : undefined;
    // BOTH OR NEITHER (D-1126). Absent-both is wave 4's kickoff, byte for byte —
    // absence permits. Half-present is refused rather than completed: no build
    // ever sent a lone field, so it is a caller that meant something, and the
    // default that would complete it (wave 1) is the one instruction a REVIVED
    // coordinator must not be given. A silent fallback would answer `queued:true`
    // to an operator whose revive had just been briefed to open a second run.
    if (resume === undefined && (body.runId !== undefined || body.wave !== undefined)) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
  ```

  ```ts
    const out = queueProgramKickoff({ coord }, id,
      { slug: body.slug.trim(), title: body.title.trim() }, resume);
  ```

  The 413 arm (`:1516-1522`) and the 200 (`:1523-1526`) are untouched: the cap is measured on the
  composed body inside the seam, so it covers the resume composition without a second spelling here,
  and its "writes nothing" property — the one `kickoff-route.test.ts:251-262` pins — is unchanged
  because the refusal still returns before `queueSystemMail` is ever reached.

- [ ] **6.8 — Fix the docstring claim that just went stale.** `server/src/server.ts:1480-1482` asserts
  "The body carries `{slug, title}`, never prose". Replace that paragraph:

  ```ts
   * The body carries `{slug, title}` and — since wave 5 — an optional
   * `{runId, wave}` pair, never prose: the server composes the sentence from one
   * of TWO L0 constants, so the route stays strictly NARROWER than the one above.
   * It can queue a program kickoff and nothing else; the pair chooses WHICH
   * kickoff, never what it says. Both fields or neither: see the guard below for
   * why a half-present pair is a 400 rather than a wave-1 kickoff.
  ```

- [ ] **6.9 — Green, including the number that must NOT move.**
  `cd server && ./node_modules/.bin/vitest run test/kickoff-route.test.ts test/coord-kickoff.test.ts test/auth-gate.test.ts test/routes.test.ts test/typecheck-tests.test.ts`
  (foreground, timeout 600000). This task registers **no route**, so
  `server/test/auth-gate.test.ts:195` (`scanRoutes('server.ts').length` = 46), `:199` (68), `:202` (65)
  and `:469` (gated = 41) all stay exactly as they are — if any of them reds, a route was added by
  accident. Check the drift loop's output too, not just its colour: the new arms read only `req.body`,
  never `authEnabled` or the session store, and the loop probes with **no body at all**, so the
  slug/title arm fires first and dark/armed-authenticated stay equal. Confirm that in the output rather
  than reasoning about it.

  **CORRECTED AT EXECUTION — the arm named here is not the arm that fires.** The drift loop is silent
  on success (it asserts an empty `drift` array), so it was instrumented to push the kickoff route's
  three probes and then reverted from a scratchpad snapshot. Measured:
  `POST /api/sessions/:id/kickoff: dark=501 anon=401 auth=501 darkBody={"ok":false,"error":"not-configured"}`.
  `deps.coord` is undefined in those fixtures, so the `notConfigured` arm answers before the slug/title
  arm is ever reached, and the new pair-reading arms are further down still. Dark and
  armed-authenticated are equal at 501; the route stays gated (401 anonymous). The conclusion the step
  wanted holds — it holds for a stronger reason than the one written here.

- [ ] **6.10 — Measure every mutation row.** Apply each mutation below one at a time, run the named
  suite, record the exact first failing assertion text verbatim into the table, then revert. A row
  that stays green is a guard with no pin and must be fixed before the commit.

| mutation | first-fail assertion |
|---|---|
| `kickoff.ts`: drop the `resume` branch — always `programKickoff(program.slug, program.title)` | `<measured at execution>` |
| `kickoff.ts`: compose `programResumeKickoff(slug, title, resume?.runId ?? 0, resume?.wave ?? 1)` unconditionally | `<measured at execution>` |
| `kickoff.ts`: measure the cap on `program.title` instead of the composed `body` | `<measured at execution>` |
| `kickoff.ts`: pass `runId: resume ? resume.runId : null` into `queueSystemMail` (namespacing the dedupe key by run) | `<measured at execution>` — **6.2's fixture as drafted could NOT express this row, and the hole was closed at execution.** With a resume naming run 7 in a store holding no runs, the mutant died on `Error: FOREIGN KEY constraint failed` inside `insertMail` rather than on either assertion: red for a reason that evaporates in production, where the run a revive names is exactly the run that already exists. The ENVELOPE test now opens a real run and passes the id it got back, so the mutant dies on the `run:` absence assertion instead. |
| `server.ts`: delete the both-or-neither refusal, letting a lone field fall through as absent | `<measured at execution>` |
| `server.ts`: relax the pair check to `typeof body.runId === 'number' && typeof body.wave === 'number'` | `<measured at execution>` |
| `server.ts`: drop the fourth argument at the `queueProgramKickoff` call site | `<measured at execution>` |
| ADDED at execution — `kickoff.ts`: compute the cap on `programKickoff(program.slug, program.title)` before the branch (the composition the resume body is NOT) | `<measured at execution>` — the row this task actually needed. The prescribed `program.title` row above is killed by wave 4's own cap tests, so it measures nothing new; this one is killed by EXACTLY ONE test, 6.2's `a title the WAVE-1 body accepts is refused as a resume`, with every wave-4 cap test still green. |

- [ ] **6.11 — Commit.**
  `git add server/src/coord/kickoff.ts server/src/server.ts server/test/coord-kickoff.test.ts server/test/kickoff-route.test.ts && git commit -m "feat(wave5): the wave-N re-kickoff — one composer argument, one cap, no new route"`
---

## Task 7: the PWA client — two methods, one of which must stop discarding its answer

**Files:** `pwa/src/lib/api.ts`, `pwa/test/api.test.ts`, `pwa/src/fleet/StartProgramSheet.tsx` (one
type line), `pwa/test/start-program.test.tsx` (one type line).

> **LEAD'S NOTE — three ledger numbers belong to this task; cite each on the line it explains.**
> **D-1133** — `api.kickoff` stops discarding `queued`. Wave 5 is the consumer `KickoffOutcome`'s own
> docstring named in advance, so REWRITE the method's docstring rather than leaving it standing as an
> argument against the shipped behaviour.
> **D-1137** — the widening is not additive at the type level: `StartProgramSheet.tsx`'s injectable
> `queueKickoff` prop is typed `Promise<void>`, so the new return is
> `TS2322: Type '{ queued: boolean; }' is not assignable to type 'void'`. **vitest strips types, so every
> suite stays green and only `tsc --noEmit` sees it** — wave 3's D-1032 in a new place. Make
> `./node_modules/.bin/tsc --noEmit` an explicit green-gate STEP of this task, and note that the
> `pwa/test/api.test.ts` source-scan pin selecting on `l.includes('post(')` reds on CORRECT code once the
> declaration becomes `postJson<…>(`; its predicate moves, and the declaration stays on ONE line because
> the pin can only measure one.
> **D-1139** — the door's `claimant-alive` refusal rides `refused`, not `error`, so `ApiError`'s message
> extraction finds nothing and `apiErrorText` degrades to a bare `request failed (409)`; two of its other
> refusals share status 404 with fastify's own route-not-found body. That is a CONSTRAINT ON THE RESUME
> SHEET: its translator is status-first AND reads both `body.error` and `body.refused`, and it renders
> `detail` — the only thing separating the two conditions folded into `registry-unmeasurable` (an
> unlistable registry, and a tmux that did not answer).
>
> **Sequencing:** this task lands BEFORE the StartProgramSheet task, which edits the same props block.


The contract's "PWA — `pwa/src/lib/api.ts`" section, in full. Two methods: `reclaimRun` is new and
UNGATED; `kickoff` gains an optional resume pair AND stops throwing its answer away. The second half
is not additive — `kickoff`'s own docstring (`pwa/src/lib/api.ts:456-461`) argues *against* reading
the body, and `pwa/test/api.test.ts:391-395` pins the call site as a one-line `post(` — so both the
prose and the pin are rewritten here, not amended.

- [ ] **7.1 — Write the `reclaimRun` wire pin first and measure it RED.** Insert a new `describe`
  into `pwa/test/api.test.ts` immediately after the `abandonRun` describe closes (`:356`) and before
  the wave-4 kickoff comment block (`:358`), so the file's order matches `api.ts`'s: the two
  run-scoped operator doors sit together.

  ```ts
  // program-leverage wave 5. `ResumeSheet` takes its `reclaimRun` prop INJECTED in
  // `resume-sheet.test.tsx`, so the real `api.reclaimRun` — the one the production
  // sheet's default prop value actually calls — needs its own pin here, the same
  // idiom `abandonRun` just above uses and for the same reason.
  describe('reclaimRun (program-leverage wave 5)', () => {
    it('POSTs {claimedBy} as JSON to /api/runs/:id/reclaim', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {
        ok: true, program: 'program-leverage', runIds: [16, 18], from: 'coordinator-old', to: 'coordinator-new',
      }));
      const api = createApi(fetchImpl as unknown as typeof fetch);

      const out = await api.reclaimRun(18, 'coordinator-new');

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/runs/18/reclaim');
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('content-type')).toBe('application/json');
      // ONE field. The event trail's `causedBy` is hardcoded `operator` server-side,
      // so nothing this client sends can attribute the reclaim to anybody else — and
      // a second field here would be the first step toward it trying.
      expect(JSON.parse(init.body as string)).toEqual({ claimedBy: 'coordinator-new' });
      // `runIds` is the answer the sheet renders: under ruling R1 the rewrite covers
      // every run of the program, terminal ones included, so a program with waves
      // behind it moves more than one row and the operator is told how many.
      expect(out).toEqual({
        program: 'program-leverage', runIds: [16, 18], from: 'coordinator-old', to: 'coordinator-new',
      });
    });
  });
  ```
  Run `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts` (foreground). **Record the exact
  first failing assertion text verbatim** — expected to be the `TypeError` from calling
  `api.reclaimRun`, which does not exist yet.

- [ ] **7.2 — Add the two remaining `reclaimRun` guards to the same describe, still RED.** The
  no-credential pin and the refusal pass-through:

  ```ts
    it('sends NO box token — the credential belongs to the session that died', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse(200, { ok: true, program: 'p', runIds: [1], from: 'a', to: 'b' }));
      const api = createApi(fetchImpl as unknown as typeof fetch);

      await api.reclaimRun(1, 'b');

      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      // The EXACT header set, not `.get('x-ccrc-mail-token')` being null: a
      // credential under any other spelling walks past that, and this door's
      // ungatedness is the decision most likely to be "fixed" by someone who has
      // not read D-282. Two names, because the JSON-reading helper asks for JSON
      // back as well as sending it. Sorted, so header iteration order is not part
      // of what this measures.
      const names = [...new Headers(init.headers).keys()].sort();
      expect(names, 'the reclaim call carries no credential header').toEqual(['accept', 'content-type']);
    });

    it('carries the 409 refusal through verbatim — the sheet renders it, not a toast', async () => {
      const refusal = {
        ok: false, refused: 'claimant-alive', by: 'coordinator-old', detail: 'tmux reports the pane live',
      };
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, refusal));
      const api = createApi(fetchImpl as unknown as typeof fetch);

      const err = await api.reclaimRun(18, 'coordinator-new').then(
        () => { throw new Error('expected reclaimRun to reject'); },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).body).toEqual(refusal);
      // The code rides `refused`, NOT `error`, so `ApiError`'s constructor
      // (`api.ts:13-18`) finds no message and this degrades to the bare status
      // sentence. Pinned so the sheet's own translator is written knowing it
      // rather than discovering it on a phone.
      expect(apiErrorText(err),
        'the refusal code rides `refused`; if a later wave teaches apiErrorText that key, rewrite this pin')
        .toBe('request failed (409)');
    });
  ```
  `apiErrorText` and `ApiError` are already imported at `pwa/test/api.test.ts:4`; `jsonResponse` is
  the file's own helper at `:6-10`. Re-run and **record the first failing assertion verbatim.**

- [ ] **7.3 — Add `reclaimRun` to `createApi`, immediately after `abandonRun`** (`pwa/src/lib/api.ts:522`,
  the `    },` that closes it) and before the `feed` docstring at `:523`. Green after this step.

  ```ts
    /** `POST /api/runs/:id/reclaim` — point a program's runs at a LIVING
     *  coordinator after the one they name has died. The wedge it opens is the
     *  one two readers create between them by answering the lowest-id
     *  `claimedBy` with no state predicate: while that name is a corpse, a
     *  second coordinator is refused at open time and `toId:'coordinator'` mail
     *  resolves to nobody at all.
     *
     *  UNGATED — no box token on this call — and NOT for `abandonRun`'s reason
     *  (:502-503), which is that the wedged session is still holding the key.
     *  Here the key-holder is the thing that DIED. A door whose only opener is
     *  the credential of a dead session is a door with no opener, which is
     *  where D-282 arrived from the other direction.
     *
     *  `claimedBy` is the only field it sends: the event trail's `causedBy` is
     *  a hardcoded literal on the server, so no body of this client's can
     *  attribute an operator act to somebody else.
     *
     *  `postJson`, because a render depends on `runIds` — the same test
     *  `abandonRun` passes and `kickoff` used to fail. Note that the
     *  `claimant-alive` 409 names its code in `refused`, not `error`, so
     *  `apiErrorText` cannot turn it into a sentence; the sheet reads
     *  `err.body` itself, which is why `ResumeSheet` owns a status-first
     *  translator rather than borrowing this file's. */
    reclaimRun: (id: number, claimedBy: string): Promise<{ program: string; runIds: number[]; from: string; to: string }> =>
      postJson<{ program: string; runIds: number[]; from: string; to: string }>(
        `/api/runs/${id}/reclaim`, { claimedBy }),
  ```
  `postJson` is the existing helper at `:289-299`; its two current callers are the passkey ceremonies
  (`:364`, `:368`), both body-less — this is its first body-carrying caller, which the `body !==
  undefined` arm already handles. Re-run `test/api.test.ts` and confirm the three new tests are green.

- [ ] **7.4 — Rewrite the kickoff assertions that stop being true, and add the ones for the answer.
  Measure RED.** Exactly what changes in `pwa/test/api.test.ts`, measured against the current file:
  * `:358-361` (the describe's header comment) — **edited**, not for correctness but because it names
    one consumer and there are now two: add a sentence saying the same method is `ResumeSheet`'s
    re-kickoff, which passes the resume pair.
  * `:363-375` `'POSTs {slug, title} to /api/sessions/:id/kickoff'` — **unchanged and still green.**
    `postJson` sends the same method, the same `content-type` and the same `JSON.stringify(b)`, and
    `toEqual({slug, title})` is exact, so it keeps pinning that an omitted resume pair puts nothing
    on the wire.
  * `:377-396` the source-scan pin — **rewritten** (step 7.5). It is the one assertion the
    implementation change reds on its own.
  * `:398-404` `'encodes the session id'` — **unchanged**: `postJson` takes the same `sid(id)` path.
  * `:406-419` the non-2xx test — **unchanged**: `request` (`:243-268`) throws before either helper
    reaches `.json()`.

  Then add three tests inside the same describe:

  ```ts
    it('reads `queued` off the 200 body — wave 5 is the consumer the old docstring said did not exist', async () => {
      const fresh = createApi(async () => jsonResponse(200, { ok: true, queued: true }));
      expect(await fresh.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' })).toEqual({ queued: true });

      // NOT a failure — a kickoff IS waiting for that session — and on the revive
      // path it is the likelier of the two answers, which is precisely why the
      // sheet has to be able to tell them apart.
      const waiting = createApi(async () => jsonResponse(200, { ok: true, queued: false }));
      expect(await waiting.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' })).toEqual({ queued: false });
    });

    it('absence of `queued` degrades to TRUE, the abandonRun direction', async () => {
      // No deployed server produces this: the route has sent the field on every
      // 200 it has ever answered (`server/src/server.ts:1527`). It covers a
      // truncated or proxy-rewritten body, where the safe direction is not to
      // assert a kickoff was already waiting that never was.
      const older = createApi(async () => jsonResponse(200, { ok: true }));
      expect(await older.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' })).toEqual({ queued: true });
    });

    it('carries {runId, wave} when the caller has them, and omits the keys entirely when it does not', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, queued: true }));
      const api = createApi(fetchImpl as unknown as typeof fetch);

      await api.kickoff('claude-ccrc-pwa', { slug: 'program-leverage', title: 'Program leverage', runId: 18, wave: 5 });
      expect(JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string))
        .toEqual({ slug: 'program-leverage', title: 'Program leverage', runId: 18, wave: 5 });

      // Absence-permits, and it must be ABSENCE: the server refuses a HALF pair
      // with 400 `bad-request`, so a body that always carried the two keys would
      // turn wave 4's byte-identical request into a refusal.
      await api.kickoff('claude-ccrc-pwa', { slug: 'program-leverage', title: 'Program leverage' });
      expect(JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string))
        .toEqual({ slug: 'program-leverage', title: 'Program leverage' });
    });
  ```
  Run `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts`. **Record the first failing
  assertion verbatim** — expected from the first of the three, where `post` resolves `undefined`.

- [ ] **7.5 — Rewrite the wave-4 structural pin at `:377-396` from a LINE scan to a SLICE scan, and
  measure it red.** Its own message already says what to do (`:393`: "rewrite this pin if it grew a
  body"), and the method is about to grow one. Replace the body of that `it` with:

  ```ts
      // The route is narrower than `POST /api/sessions/:id/prompt` on purpose: it
      // can queue a program kickoff and nothing else. A prose key here hands that
      // narrowing back.
      //
      // WAVE-4 REVIEW, MINOR 5 (D-1122) is why this reads the DECLARATION rather
      // than the first line mentioning ``/kickoff` `` — that one was a JSDoc line
      // seventeen rows above the code and could never red on the mutation it
      // named. Wave 5 breaks the repair in turn: the method stopped being a
      // one-liner the moment it started reading its answer, which is the case
      // `toBeDefined()` was left there to catch. So it now scans the WHOLE method,
      // declaration through its own `},` — strictly more of the file than the line
      // form ever saw — and it is anti-vacuous three ways: the slice must be
      // found, it must terminate, and it must contain both the call and the payload.
      const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'api.ts'), 'utf8');
      const lines = src.split('\n');
      const start = lines.findIndex((l) => l.includes('kickoff: async ('));
      expect(start, 'the kickoff declaration — rewrite this pin if the method was renamed or re-shaped')
        .toBeGreaterThan(-1);
      const end = lines.findIndex((l, i) => i > start && l === '    },');
      expect(end, 'the kickoff method never closes at its own indent — rewrite this pin').toBeGreaterThan(start);
      const slice = lines.slice(start, end + 1).join('\n');
      expect(slice, 'not the declaration that posts the payload').toContain('postJson');
      expect(slice, 'the payload is the program identity and the wave, nothing else').toContain('slug');
      expect(slice).not.toMatch(/\btext\b|\bbody\b/);
  ```
  `readFileSync`/`path` are already imported (`pwa/test/api.test.ts:2-3`). Re-run: this reds on
  `expect(start, …).toBeGreaterThan(-1)` until 7.6 lands. **Record it verbatim.**

- [ ] **7.6 — Rewrite `kickoff` (`pwa/src/lib/api.ts:445-462`) — docstring and body together.** The
  docstring is not amended; the paragraph at `:456-461` argues the opposite of what the code now
  does, so it is replaced by the argument that is true.

  ```ts
    /** `POST /api/sessions/:id/kickoff` — queues the coordinator kickoff as
     *  DURABLE system mail instead of typing it into the pane (program-leverage
     *  wave 4). Deliberately adjacent to `prompt`, because the pair is the
     *  point: `prompt` is the operator's own keystrokes and stays exactly as it
     *  is; this is the machine's, and machines go through the idle-gated
     *  delivery lane like every wave brief since Build 4.
     *
     *  `{slug, title}`, never prose. The server composes the sentence from an
     *  L0 constant, which makes this route strictly NARROWER than `prompt` — it
     *  can queue a program kickoff and nothing else. `{runId, wave}` chooses
     *  WHICH sentence: absent is a program being STARTED, present is a wave-N
     *  revive of a run that is already open, and the two say opposite things
     *  about re-opening it. Absence-permits, so every wave-4 call site sends a
     *  byte-identical request; the server refuses a HALF pair with 400
     *  `bad-request`, a pairing this signature does not model.
     *
     *  IT READS THE ANSWER NOW, and the paragraph this replaces argued it never
     *  should: "reading one here would ship a distinction nothing consumes."
     *  Wave 5 is the consumer that sentence said did not exist. On the START
     *  path both answers still mean "a kickoff is on its way"; on the REVIVE
     *  path "one was already waiting, unread" is the likelier answer and a
     *  different thing to tell the operator, so `ResumeSheet` renders them
     *  apart. Hence `postJson`, whose own docstring (:286-288) names exactly
     *  what `post` was doing to this value.
     *
     *  An absent `queued` reads TRUE — `abandonRun`'s degrade direction, for
     *  its reason. No deployed server can produce it; it covers a truncated
     *  body, where claiming a kickoff was already waiting that never was is the
     *  unsafe half. */
    kickoff: async (
      id: string, b: { slug: string; title: string; runId?: number; wave?: number },
    ): Promise<{ queued: boolean }> => {
      const answer = await postJson<{ queued?: unknown }>(`${sid(id)}/kickoff`, b);
      // The local is `answer` on purpose. This method's structural pin proves it
      // sends no prose key by scanning the whole method for the two words such a
      // payload would use, and a local named after either of them would blind it.
      // The pin is worth more than naming symmetry with `abandonRun` three doors
      // down.
      return { queued: answer.queued !== false };
    },
  ```
  Re-run `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts` — all of 7.4's and 7.5's
  assertions green, and `:363-375`, `:398-404`, `:406-419` still green untouched.

- [ ] **7.7 — Pay the type debt this forces, in two lines, and measure it.** `Promise<{queued:
  boolean}>` is **not** assignable to `Promise<void>` — measured with this tree's own tsc:
  `error TS2322: Type 'Promise<{ queued: boolean; }>' is not assignable to type 'Promise<void>'`.
  So `pwa/src/fleet/StartProgramSheet.tsx:242`'s `queueKickoff = api.kickoff` stops compiling until
  the prop at `:233` follows. Run `cd pwa && ./node_modules/.bin/tsc --noEmit` FIRST and record the
  error, then edit `:229-233`:

  ```ts
    /** Program-leverage wave 4: the kickoff is QUEUED as durable system mail, not
     *  typed into the pane. Named `queueKickoff` rather than `kickoff` because the
     *  standing sentence itself is `programKickoff` in L0 and this file's tests
     *  import it — one name for the text, another for the act.
     *
     *  Wave 5 changed the RETURN, not the call. `api.kickoff` answers `{queued}`
     *  now, and `Promise<{queued: boolean}>` is not assignable to `Promise<void>`
     *  (TS2322 — `npm run build` runs `tsc --noEmit` before it builds anything),
     *  so the default on the line below forces this type. THE SHEET STILL READS NO
     *  FIELD: "one was already waiting" is a distinction only the revive path
     *  renders. Ignoring a field is a rendering decision; declaring the shape an
     *  injected fake has to have is a contract one, and only the second is worth
     *  spending a type on. */
    queueKickoff?: (id: string, b: { slug: string; title: string }) => Promise<{ queued: boolean }>;
  ```
  Then the same return type on the harness's own declaration at `pwa/test/start-program.test.tsx:89`
  (it is passed straight through to the component at `:107`, so a `Promise<void>` there fails at the
  pass-through, not at the harness):

  ```ts
    queueKickoff: (id: string, b: { slug: string; title: string }) => Promise<{ queued: boolean }>;
  ```
  Every injection site is a `vi.fn().mockResolvedValue(undefined)` and needs no edit. Re-run
  `./node_modules/.bin/tsc --noEmit` and confirm zero errors. **Also note in the execution record
  whether `vitest run` surfaced the TS2322 on its own** (`vite.config.ts` sets
  `test.typecheck.enabled`) — if it did not, say so, because that is the difference between the type
  being pinned by the suite and being pinned only by `npm run build`.

- [ ] **7.8 — Green, both files, foreground.**
  `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts test/start-program.test.tsx`
  (timeout ≥ 600000), then `cd pwa && ./node_modules/.bin/tsc --noEmit`. `start-program.test.tsx` must
  be green **unchanged apart from `:89`** — if any of its 24 injection sites red, the prop was widened
  in the wrong direction and the sheet is reading a field it should not.

- [ ] **7.9 — Mutation rows.** Apply each mutation, run the named file, record the exact first failing
  assertion, revert. A row with no measured text is a row that failed.

  | mutation | first-fail assertion |
  | --- | --- |
  | `reclaimRun` posts to `` `/api/runs/${id}/abandon` `` | `<measured at execution>` |
  | `reclaimRun` sends `{ to: claimedBy }` instead of `{ claimedBy }` | `<measured at execution>` |
  | `reclaimRun` adds `headers: { 'x-ccrc-mail-token': 't' }` to the request | `<measured at execution>` |
  | `reclaimRun` catches the non-2xx and resolves `{ program: '', runIds: [], from: '', to: '' }` | `<measured at execution>` |
  | `kickoff` reverts to `post(...)` and resolves `{ queued: true }` without reading | `<measured at execution>` |
  | `kickoff` returns `{ queued: answer.queued === true }` (absence reads false) | `<measured at execution>` |
  | `kickoff` destructures and sends `{ slug: b.slug, title: b.title }` only | `<measured at execution>` |
  | `kickoff`'s local is renamed `answer` → `body` | `<measured at execution>` |
  | `StartProgramSheet`'s `queueKickoff` prop reverts to `Promise<void>` (`tsc --noEmit`) | `<measured at execution>` |

- [ ] **7.10 — Commit.**

  ```
  git add pwa/src/lib/api.ts pwa/test/api.test.ts \
          pwa/src/fleet/StartProgramSheet.tsx pwa/test/start-program.test.tsx && \
  git commit -m "feat(pwa): reclaimRun, and a kickoff that stops discarding its answer"
  ```
---

## Task 8: the runs board learns the coordinator is dead, and offers the three doors

**Files:** `pwa/src/stores/fleet.ts`, `pwa/src/fleet/coordWords.ts`, `pwa/src/fleet/ResumeSheet.tsx` (new),
`pwa/src/fleet/fleet.css`, `pwa/src/screens/RunsScreen.tsx`, `pwa/test/stores.test.ts`,
`pwa/test/resume-sheet.test.tsx` (new), `pwa/test/runs-screen.test.tsx`, `pwa/test/fleet-css.test.ts`,
`pwa/test/contrast.test.ts`.

**Depends on** the `pwa/src/lib/api.ts` task having landed: this task consumes `api.reclaimRun` and the
WIDENED `api.kickoff` (`Promise<{queued: boolean}>`, `{slug, title, runId?, wave?}`). Today's `kickoff`
resolves to `void` (`pwa/src/lib/api.ts:462`), so `res.queued` is a compile error until that task ships.
It also consumes L0's `isReclaimRefuseCode` (contract § `shared/api.ts`).

**THE THREE-STATE ARGUMENT, which is the whole task.** The client cannot re-measure what the server
measured. `assembleFleet` collapses a tmux `unknown` into a dead row, and says so in its own words at
`server/src/fleet.ts:245-251`:

> `D-309: hasSession here deliberately collapses unknown into alive = false, so a substrate fault reads`
> `'dead' in the PWA — a false dead, with the ungated Restart button under it. Known, and deferred BY`
> `DECISION to the substrate-unreachable spec: what the fleet view shows for cannot-ask is a product`
> `judgement (a new SessionStatus crosses the wire and every render seam), not a guard this assembly may`
> `improvise.`

So `status === 'dead'` is *also* what a tmux outage looks like, and a door gated on it would offer to hand a
live coordinator's program to somebody else during one. A session MISSING from the `sessions` array is
weaker still — it is indistinguishable from a frame that has not landed. `unknown` is the third answer and
it **hides** the door; only `status === 'dead'` AND a lifecycle that never resolves on its own AND no
standing substrate fault opens it.

- [ ] **8.1 — Write the `fleetFrameSeen` cases first, in `pwa/test/stores.test.ts`, and measure them red.**
  The contract's `coordPresence(claimedBy, session, frameSeen)` has no producer in this tree: the store has
  `runsFrameSeen` (`pwa/src/stores/fleet.ts:96`) and `coordFrameSeen` (`:114`) and no equivalent for the
  `fleet` frame, and `sessions` is hydrated from `localStorage` at construction (`:211`), so a non-empty
  `sessions` is not evidence a socket ever spoke. Add, in the `describe` that already holds the runs-frame
  cases (`test/stores.test.ts:773-816`), three cases in that file's exact idiom:

  ```ts
  it('accepts a well-formed fleet frame and flips `fleetFrameSeen`', () => {
    const store = createFleetStore({ makeSocket });
    store.getState().connect();
    lastSocket().open();

    expect(store.getState().fleetFrameSeen).toBe(false);
    lastSocket().message(JSON.stringify({ type: 'fleet', sessions: [fleetSession('s1', 'claude')] }));
    expect(store.getState().sessions).toHaveLength(1);
    // `RunsScreen`'s resume door reads this to tell "this box says nothing
    // claims that id" apart from "no frame has arrived yet" — `sessions` cannot
    // answer it, because a cold start HYDRATES that array from localStorage
    // (`:211`) before any socket exists.
    expect(store.getState().fleetFrameSeen).toBe(true);
    store.getState().disconnect();
  });

  it('a well-formed fleet frame carrying `[]` still flips it — an honest empty fleet is not silence', () => {
    const store = createFleetStore({ makeSocket });
    store.getState().connect();
    lastSocket().open();

    lastSocket().message(JSON.stringify({ type: 'fleet', sessions: [] }));
    expect(store.getState().sessions).toEqual([]);
    expect(store.getState().fleetFrameSeen).toBe(true);
    store.getState().disconnect();
  });

  it('a hydrated snapshot is not a frame — `fleetFrameSeen` starts false with sessions already present', () => {
    // The whole reason this flag exists rather than `sessions.length > 0`.
    const store = createFleetStore({ makeSocket });
    expect(store.getState().fleetFrameSeen).toBe(false);
  });
  ```

  **Expected RED** (`fleetFrameSeen` is not on `FleetState`). Record the first failing assertion verbatim.
- [ ] **8.2 — Add the flag, green.** In `pwa/src/stores/fleet.ts`, beside `runsFrameSeen` on the state
  interface (`:96`):

  ```ts
  /** Has `/ws/fleet` ever actually sent a `{type:'fleet'}` frame THIS store
   *  instance's lifetime — `runsFrameSeen`'s own sticky idiom (`:96`), for a
   *  sharper version of its own reason. `sessions.length > 0` cannot answer it
   *  in EITHER direction: an honestly empty fleet broadcasts `[]`, and a cold
   *  start hydrates `sessions` from the persisted snapshot (`loadFleetSnapshot`,
   *  below) before a socket exists at all — so a populated array is not evidence
   *  that anything has spoken. The resume door (`coordPresence`,
   *  `fleet/coordWords.ts`) is the consumer: without this it would read a
   *  claimant's absence from a STALE array as proof the coordinator is gone. */
  fleetFrameSeen: boolean;
  ```

  Initialiser `fleetFrameSeen: false` beside `runsFrameSeen: false` (`:218`), and the flip at the frame
  (`:336`) — one `set`, so the array and the flag can never disagree:

  ```ts
  set({ sessions: msg.sessions, fleetFrameSeen: true });
  ```
  Re-run `test/stores.test.ts`. Green.
- [ ] **8.3 — Write `coordPresence`'s table first, in a new `pwa/test/resume-sheet.test.tsx`, and measure
  it red.** The gate lives with its consumer's suite, not in `coord-banner.test.tsx`, whose own header
  declares that file PAUSE-ONLY (`coordWords.ts:5-13`).

  ```tsx
  // The resume door — the three doors a dead coordinator leaves open. Two
  // halves, `abandon-sheet.test.tsx`'s own split: `coordPresence` as a TABLE
  // (it is the gate, and a gate exercised only through a render is one nobody
  // can enumerate), and `ResumeSheet` rendered with INJECTED api functions for
  // the copy and the refusals. The row control's own pins live in
  // `runs-screen.test.tsx`, beside the board that must not render it.
  import { describe, it, expect, afterEach, vi } from 'vitest';
  import { useState } from 'react';
  import type { ReactNode } from 'react';
  import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
  import type { FleetSession, RunSummary } from '../../shared/api';
  import { coordPresence } from '../src/fleet/coordWords';
  import { ResumeSheet } from '../src/fleet/ResumeSheet';
  import { ApiError } from '../src/lib/api';

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  // RunSummary and FleetSession as PR I / Build 9 actually shipped them —
  // copied from `runs-screen.test.tsx:28-46` rather than reinvented.
  const run = (over: Partial<RunSummary> = {}): RunSummary => ({
    id: 3, program: 'build4-transcript-surface', programTitle: 'Build 4: transcript surface',
    wave: 3, waveOf: 4, project: 'ccrc-pwa',
    sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
    state: 'working', claimedBy: 'ccrc-pwa-coordinator', resumed: false, clearedAt: null,
    openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
    dispatchedAt: Date.now() - 900_000, closedAt: null,
    handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0, ...over,
  });

  const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
    id: 'ccrc-pwa-coordinator', wrapper: 'claude', home: 'claude', project: 'ccrc-pwa',
    workdir: '/w', workspace: null, name: null, status: 'idle', statusUpdatedAt: null,
    limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
    branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
    hookState: null, askSummary: null, subagents: null, held: null,
    bucket: 'working', bucketSince: null, unmeasured: [], statusUnmeasured: false,
    lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true,
    spawnState: null, ...over,
  });

  describe('coordPresence — three answers, because the client cannot measure what the server measures', () => {
    it('answers `dead` for a dead row whose lifecycle never resolves on its own', () => {
      expect(coordPresence('ccrc-pwa-coordinator', sess({ status: 'dead', lifecycle: 'orphan' }), true))
        .toBe('dead');
    });

    // Every input that must produce `unknown`, enumerated — the door is HIDDEN
    // on each of these, and a table is the only shape in which "each of them"
    // is a claim rather than a hope.
    const UNKNOWN: readonly [string, string | null, FleetSession | null | undefined, boolean][] = [
      ['the run names no claimant', null, sess({ status: 'dead', lifecycle: 'orphan' }), true],
      ['no fleet frame has landed', 'ccrc-pwa-coordinator', sess({ status: 'dead', lifecycle: 'orphan' }), false],
      ['the claimant is missing from the array', 'ccrc-pwa-coordinator', null, true],
      ['the lookup missed (undefined, not null)', 'ccrc-pwa-coordinator', undefined, true],
      ['the lifecycle key never arrived', 'ccrc-pwa-coordinator', sess({ status: 'dead', lifecycle: null }), true],
      ['the lifecycle is unmeasurable', 'ccrc-pwa-coordinator', sess({ status: 'dead', lifecycle: 'unmeasurable' }), true],
      ['a substrate fault stands', 'ccrc-pwa-coordinator',
        sess({ status: 'dead', lifecycle: 'orphan', substrate: { at: 1, text: 'tmux: no server running' } }), true],
    ];
    it.each(UNKNOWN)('answers `unknown` when %s', (_why, claimedBy, session, frameSeen) => {
      expect(coordPresence(claimedBy, session, frameSeen)).toBe('unknown');
    });

    // D-309 IS the substrate row above, and it is worth its own name: the
    // server already turned a cannot-ask into `status:'dead'`
    // (`server/src/fleet.ts:245-251`), so a door gated on that word alone opens
    // during a tmux outage and offers to hand a LIVE coordinator's program away.
    const ALIVE: readonly [string, FleetSession][] = [
      ['a live pane', sess({ status: 'idle', lifecycle: 'running' })],
      ['a busy pane', sess({ status: 'busy', lifecycle: 'running' })],
      ['a dead pane the supervisor is bringing back', sess({ status: 'dead', lifecycle: 'restarting' })],
      ['a dead pane whose lifecycle resolves itself', sess({ status: 'dead', lifecycle: 'unclaimed' })],
      ['a live pane with a dead-listed lifecycle — status is half the answer, not all of it',
        sess({ status: 'idle', lifecycle: 'orphan' })],
    ];
    it.each(ALIVE)('answers `alive` for %s', (_why, session) => {
      expect(coordPresence('ccrc-pwa-coordinator', session, true)).toBe('alive');
    });
  });
  ```

  **Expected RED** — `coordPresence` is not exported, and `ResumeSheet` does not exist. Record the first
  failing assertion verbatim.
- [ ] **8.4 — Write `coordPresence` in `pwa/src/fleet/coordWords.ts`, green.** Widen the import at
  `coordWords.ts:20` and append:

  ```ts
  import {
    isMarkerState, lifecycleIsDead, substrateFault, type FleetSession, type MarkerState,
  } from '../../../shared/api';

  export type CoordPresence = 'alive' | 'dead' | 'unknown';

  /** THREE answers, because the client cannot measure what the server measures.
   *
   *  `assembleFleet` (`server/src/fleet.ts:245-251`, D-309) collapses a tmux
   *  `unknown` into `alive = false`, and says so: "a substrate fault reads
   *  'dead' in the PWA — a false dead". So `status === 'dead'` is not proof of a
   *  dead coordinator, and a door hung on it alone would offer, during a tmux
   *  outage, to hand a live coordinator's program to somebody else. A session
   *  MISSING from the fleet array is weaker still — that is indistinguishable
   *  from a frame that has not landed, which is why `frameSeen` is a parameter
   *  rather than a length check.
   *
   *  `unknown` HIDES the door. That is the whole asymmetry: a hidden door costs
   *  the operator one refresh; a door offered over a live coordinator costs a
   *  running program its ledger.
   *
   *  NOT a fourth condition on `statusUnmeasured`: that flag is only ever set
   *  inside `assembleFleet`'s own `if (alive)` block (`server/src/fleet.ts:265`,
   *  written at `:327`), so a `dead` row structurally cannot carry it — reading
   *  it here would be a guard over a state this field cannot be in.
   *
   *  Clock-free and store-free, the ladder discipline `lifecycleQualifier`
   *  (`lifecycleWords.ts:89`) already states: every input is an argument. */
  export function coordPresence(
    claimedBy: string | null,
    session: FleetSession | null | undefined,
    frameSeen: boolean,
  ): CoordPresence {
    if (claimedBy === null) return 'unknown';
    if (!frameSeen) return 'unknown';
    if (session === null || session === undefined) return 'unknown';
    // `?? null`, never the typed field directly — the `fleet` frame is CAST on
    // arrival (`stores/fleet.ts`'s `asFleetMsg` validates only
    // `Array.isArray(sessions)`), so a row from a server that predates this
    // field lacks the key at runtime. `lifecycleQualifier`'s own docstring
    // records what reading one of these directly cost the last time.
    const lifecycle = session.lifecycle ?? null;
    if (lifecycle === null || lifecycle === 'unmeasurable') return 'unknown';
    // The ONE reader for this field (`substrateFault`'s own docstring,
    // shared/api.ts:249): a supervisor that has flagged the substrate has
    // withdrawn its own claim to know anything about this pane.
    if (substrateFault(session) !== null) return 'unknown';
    // BOTH halves. `lifecycleIsDead` (shared/api.ts:1672) is the tree's one
    // answer to "does this state resolve on its own" — `restarting` does,
    // `orphan` does not — and it deliberately answers FALSE for `unmeasurable`
    // ("doubt is not evidence", LIFECYCLE_DEAD's own comment).
    if (session.status === 'dead' && lifecycleIsDead(lifecycle)) return 'dead';
    return 'alive';
  }
  ```

  Re-run `test/resume-sheet.test.tsx`. The `coordPresence` describe goes green; the `ResumeSheet` import
  still reds. Record that.
- [ ] **8.5 — Write the ResumeSheet's copy/controls/`queued` cases, red.** Append to
  `pwa/test/resume-sheet.test.tsx`:

  ```tsx
  const ok = { program: 'build4-transcript-surface', runIds: [1, 2, 3], from: 'ccrc-pwa-coordinator', to: 'ccrc-pwa-far-mesa' };
  const noop = { ensure: async () => {}, kickoff: async () => ({ queued: true }), reclaimRun: async () => ok };

  describe('ResumeSheet — the three doors, in order', () => {
    it('names the dead claimant, the run and the wave, and offers Revive first', () => {
      render(<ResumeSheet run={run()} onClose={() => {}} {...noop} />);
      expect(screen.getByText(/ccrc-pwa-coordinator/)).toBeInTheDocument();
      expect(screen.getByText(/run 3/)).toBeInTheDocument();
      expect(screen.getByText(/wave 3/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^revive/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^re-kickoff$/i })).toBeInTheDocument();
    });

    // The third door is REVEALED, not offered: reclaiming rewrites `claimedBy`
    // on every run of the program (contract R1), and it is the only one of the
    // three that cannot be undone by waiting.
    it('hides the reclaim field until Revive has been tried', () => {
      render(<ResumeSheet run={run()} onClose={() => {}} {...noop} />);
      expect(screen.queryByLabelText(/hand run 3/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /^reclaim$/i })).toBeNull();
    });

    it('reveals it once Revive has been tried, even when the revive SUCCEEDED', async () => {
      render(<ResumeSheet run={run()} onClose={() => {}} {...noop} />);
      fireEvent.click(screen.getByRole('button', { name: /^revive/i }));
      expect(await screen.findByLabelText(/hand run 3/i)).toBeInTheDocument();
    });

    it('reveals it on the explicit door too, without a revive attempt', async () => {
      const ensure = vi.fn(async () => {});
      render(<ResumeSheet run={run()} onClose={() => {}} {...noop} ensure={ensure} />);
      fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
      expect(await screen.findByLabelText(/hand run 3/i)).toBeInTheDocument();
      expect(ensure).not.toHaveBeenCalled();
    });

    it('sends the run and the wave with the re-kickoff, never a bare program', async () => {
      const kickoff = vi.fn(async () => ({ queued: true }));
      render(<ResumeSheet run={run()} onClose={() => {}} {...noop} kickoff={kickoff} />);
      fireEvent.click(screen.getByRole('button', { name: /^re-kickoff$/i }));
      await waitFor(() => expect(kickoff).toHaveBeenCalled());
      expect(kickoff.mock.calls[0]).toEqual(['ccrc-pwa-coordinator', {
        slug: 'build4-transcript-surface', title: 'Build 4: transcript surface', runId: 3, wave: 3,
      }]);
    });

    // `queued:false` is not a failure and not the same sentence: the operator
    // standing at the board has to know whether THIS tap put something in the
    // queue or found one already there. The FOLD stays folded on purpose (the
    // contract's own decision) — the sentence says "a kickoff", never "this
    // program's kickoff", because no store read can tell the two apart.
    it('says something DIFFERENT when a kickoff was already waiting', async () => {
      render(<ResumeSheet run={run()} onClose={() => {}} {...noop} kickoff={async () => ({ queued: true })} />);
      fireEvent.click(screen.getByRole('button', { name: /^re-kickoff$/i }));
      const queued = (await screen.findByText(/queued/i)).textContent ?? '';
      cleanup();

      render(<ResumeSheet run={run()} onClose={() => {}} {...noop} kickoff={async () => ({ queued: false })} />);
      fireEvent.click(screen.getByRole('button', { name: /^re-kickoff$/i }));
      const already = (await screen.findByText(/already waiting/i)).textContent ?? '';

      expect(already).not.toBe(queued);
      expect(already).toMatch(/has not been read/i);
      // …and it must not claim a second kickoff was queued.
      expect(already).toMatch(/nothing new was queued/i);
    });
  });
  ```

  **Expected RED.** Record the first failing assertion verbatim.
- [ ] **8.6 — Write the refusal cases — every status the reclaim call answers with, red.** Same file:

  ```tsx
  // Each refusal renders its OWN sentence INLINE and the sheet stays open: the
  // shape `AbandonSheet` was moved off `QuickConfirm` to get
  // (`AbandonSheet.tsx:6-12` — `QuickConfirm` closes on every tap, win or lose).
  describe('ResumeSheet — the reclaim refusals, each with its own sentence', () => {
    const reclaimFailing = (err: unknown) => {
      const onClose = vi.fn();
      render(<ResumeSheet run={run()} onClose={onClose} {...noop}
                          reclaimRun={vi.fn().mockRejectedValue(err)} />);
      fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
      fireEvent.change(screen.getByLabelText(/hand run 3/i), { target: { value: 'ccrc-pwa-far-mesa' } });
      fireEvent.click(screen.getByRole('button', { name: /^reclaim$/i }));
      return onClose;
    };

    it('404 unknown-run — that run is gone', async () => {
      const onClose = reclaimFailing(new ApiError(404, { ok: false, error: 'unknown-run' }));
      expect(await screen.findByText(/that run is gone/i)).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /^reclaim$/i })).not.toBeDisabled();
    });

    // TWO conditions at ONE status, and they have opposite remedies: the run is
    // gone (nothing to do) versus the id you TYPED has no registry row (type a
    // different one). Collapsing them onto one sentence is the overloaded null
    // this repo bans, one layer up.
    it('404 unknown-session — the id typed here, not the run', async () => {
      reclaimFailing(new ApiError(404, { ok: false, error: 'unknown-session' }));
      expect(await screen.findByText(/no registry row for that id/i)).toBeInTheDocument();
      expect(screen.queryByText(/that run is gone/i)).toBeNull();
    });

    it('409 no-claimant — nobody holds this run', async () => {
      reclaimFailing(new ApiError(409, { ok: false, refused: 'no-claimant' }));
      expect(await screen.findByText(/nobody claims this run/i)).toBeInTheDocument();
    });

    // The refusal that matters most, because it is the door refusing to do
    // harm: `by` and `detail` are what make it a MEASUREMENT rather than a
    // guess, and the server cannot recompute them for the client.
    it('409 claimant-alive — names WHO, and repeats the evidence verbatim', async () => {
      reclaimFailing(new ApiError(409, {
        ok: false, refused: 'claimant-alive', by: 'ccrc-pwa-coordinator',
        detail: 'the supervisor is restarting it',
      }));
      const said = (await screen.findByText(/is not dead/i)).textContent ?? '';
      expect(said).toContain('ccrc-pwa-coordinator');
      expect(said).toContain('the supervisor is restarting it');
    });

    it('502 registry-unmeasurable — the box could not look, and says the box could not look', async () => {
      reclaimFailing(new ApiError(502, {
        ok: false, error: 'registry-unmeasurable', detail: 'the registry directory could not be listed',
      }));
      expect(await screen.findByText(/the registry directory could not be listed/i)).toBeInTheDocument();
    });

    it('501 not-configured — this box runs no coordination at all', async () => {
      reclaimFailing(new ApiError(501, { ok: false, error: 'not-configured' }));
      expect(await screen.findByText(/does not run coordination/i)).toBeInTheDocument();
    });

    it('400 bad-request — the id was refused by the box, not by this sheet', async () => {
      reclaimFailing(new ApiError(400, { ok: false, error: 'bad-request' }));
      expect(await screen.findByText(/not one this box will accept/i)).toBeInTheDocument();
    });

    // The total map's designated member. A refusal shape this build has never
    // heard of is real traffic, not a fixture — `RUN_WORD.unknown`'s discipline
    // (`runWords.ts:21-24`), never a blank sheet and never a crash.
    it('a shape this build has never heard of lands on the designated unknown', async () => {
      reclaimFailing(new ApiError(418, { ok: false, error: 'teapot' }));
      expect(await screen.findByText(/this build does not recognise/i)).toBeInTheDocument();
    });

    it('a reclaim that SUCCEEDS closes the sheet and re-fires the board’s cold read', async () => {
      const onClose = vi.fn();
      const onDone = vi.fn();
      render(<ResumeSheet run={run()} onClose={onClose} onDone={onDone} {...noop} />);
      fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
      fireEvent.change(screen.getByLabelText(/hand run 3/i), { target: { value: 'ccrc-pwa-far-mesa' } });
      fireEvent.click(screen.getByRole('button', { name: /^reclaim$/i }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onDone).toHaveBeenCalled();
    });
  });
  ```

  **Expected RED.** Record the first failing assertion verbatim.
- [ ] **8.7 — Write the supersession cases — both MEASURED AbandonSheet bugs, reproduced, red.** Same file.
  The `Harness` is not optional and not cosmetic: `ResumeSheet` is mounted UNCONDITIONALLY at screen level
  and `run === null` merely renders nothing, so neither bug is reachable by rendering the sheet once with a
  fixed `run` (`abandon-sheet.test.tsx:300-305` states exactly this for its own sheet).

  ```tsx
  function Harness({
    reclaimRun, onDone,
  }: {
    reclaimRun: (id: number, claimedBy: string) => Promise<typeof ok>;
    onDone?: () => void;
  }): ReactNode {
    const [target, setTarget] = useState<RunSummary | null>(run());
    return (
      <>
        <button type="button" onClick={() => setTarget(run({ id: 7, program: 'far-mesa-program' }))}>
          open run 7
        </button>
        <ResumeSheet run={target} onClose={() => setTarget(null)} onDone={onDone}
                     ensure={async () => {}} kickoff={async () => ({ queued: true })}
                     reclaimRun={reclaimRun} />
      </>
    );
  }

  describe('per-target state — the two bugs AbandonSheet measured, on this sheet', () => {
    it("clears a previous run's refusal, and its revealed field, when a different run's sheet opens", async () => {
      render(<Harness reclaimRun={vi.fn().mockRejectedValue(new ApiError(404, { ok: false, error: 'unknown-run' }))} />);
      fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
      fireEvent.change(screen.getByLabelText(/hand run 3/i), { target: { value: 'ccrc-pwa-far-mesa' } });
      fireEvent.click(screen.getByRole('button', { name: /^reclaim$/i }));
      expect(await screen.findByText(/that run is gone/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
      fireEvent.click(screen.getByRole('button', { name: /open run 7/i }));

      // Run 7's sheet must not open showing run 3's refusal, and must not open
      // with the third door already unlocked and a stale id in the field.
      expect(await screen.findByText(/run 7/)).toBeInTheDocument();
      expect(screen.queryByText(/that run is gone/i)).toBeNull();
      expect(screen.queryByLabelText(/hand run 7/i)).toBeNull();
    });

    it("a superseded in-flight reclaim cannot close or write into a different run's now-open sheet", async () => {
      let resolveRun3: (() => void) | null = null;
      const reclaimRun = vi.fn((id: number) => {
        if (id === 3) return new Promise<typeof ok>((resolve) => { resolveRun3 = () => resolve(ok); });
        return Promise.resolve(ok);
      });
      const onDone = vi.fn();
      render(<Harness reclaimRun={reclaimRun} onDone={onDone} />);

      fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
      fireEvent.change(screen.getByLabelText(/hand run 3/i), { target: { value: 'ccrc-pwa-far-mesa' } });
      fireEvent.click(screen.getByRole('button', { name: /^reclaim$/i }));
      expect(await screen.findByText(/handing over…/i)).toBeInTheDocument();

      // Dismissed via the SCRIM, not the (disabled-while-busy) Cancel button —
      // the path the AbandonSheet review found ungated on `busy`
      // (`components/Sheet.tsx:45`, `Drawer.Root onOpenChange`).
      fireEvent.click(screen.getByTestId('sheet-overlay'));
      // vaul's dismissal is not always synchronous with the click; wait for the
      // first sheet to be really gone before opening the second, so a delayed
      // vaul callback is not racing the second mount (a jsdom/vaul artifact,
      // not the behaviour under test — `abandon-sheet.test.tsx:346-352`).
      await waitFor(() => expect(screen.queryByRole('button', { name: /^re-kickoff$/i })).toBeNull());

      fireEvent.click(screen.getByRole('button', { name: /open run 7/i }));
      expect(await screen.findByText(/run 7/)).toBeInTheDocument();
      // Not stuck reading "Handing over…" for a request it never made.
      expect(screen.getByRole('button', { name: /^re-kickoff$/i })).not.toBeDisabled();

      resolveRun3!();
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(onDone).not.toHaveBeenCalled();
      expect(screen.getByText(/run 7/)).toBeInTheDocument();
    });
  });
  ```

  **Expected RED.** Record the first failing assertion verbatim.
- [ ] **8.8 — Write `pwa/src/fleet/ResumeSheet.tsx`, green.** Modelled on `AbandonSheet.tsx` structurally,
  line for line: the total copy `Record` with a designated `unknown`, the status-first `*ErrorText`
  returning a string on every branch, the `gen`/`targetId` guard at `AbandonSheet.tsx:155-162`, injectable
  api props, `run !== null` IS open.

  ```tsx
  // The resume sheet — the run board's door onto a program whose COORDINATOR
  // died (the abandon sheet's opposite: that one releases a wedged run, this one
  // gets the program moving again without releasing anything).
  //
  // Three doors, cheapest first, and the order is the argument:
  //   1. Revive — `ccd ensure` on the claimant. Costs nothing, changes no
  //      ledger, and is right whenever the pane merely died.
  //   2. Re-kickoff — durable mail carrying the RESUME sentence
  //      (`programResumeKickoff`), not the wave-1 one: an open run does not need
  //      re-opening, and re-opening it is not a harmless no-op.
  //   3. Reclaim — rewrites `claimedBy` across every run of the program. The
  //      only one of the three that cannot be undone by waiting, which is why it
  //      is REVEALED (after Revive has been tried, or by the explicit "that id
  //      cannot be revived" control) rather than offered alongside the others.
  //
  // On `Sheet`, not `QuickConfirm`, for `AbandonSheet`'s own measured reason
  // (`AbandonSheet.tsx:6-12`): `QuickConfirm` runs `onConfirm(); onClose();`
  // unconditionally, and every door here can be REFUSED with a sentence the
  // operator has to read before retrying.
  import { useEffect, useRef, useState } from 'react';
  import type { ReactNode } from 'react';
  import { isReclaimRefuseCode, type RunSummary } from '../../../shared/api';
  import { Sheet } from '../components/Sheet';
  import { ApiError, api, apiErrorText, kickoffErrorText } from '../lib/api';
  import './fleet.css';

  /** The reclaim refusals this sheet renders its OWN sentence for — a total
   *  `Record` with `unknown` as the designated catch-all, the "never a blank
   *  cell" discipline `ABANDON_COPY` and `RUN_WORD.unknown` already hold. Keyed
   *  on the conditions THIS route can reach (contract's status map), not on
   *  every `RunRefuseCode`: copying a vocabulary this route can never speak is
   *  what `ABANDON_COPY`'s own docstring argues against, one file over. */
  export const RECLAIM_COPY: Record<
    'unknown-run' | 'unknown-session' | 'no-claimant' | 'claimant-alive'
    | 'registry-unmeasurable' | 'not-configured' | 'bad-request' | 'unknown',
    string
  > = {
    'unknown-run': 'that run is gone — the board will catch up',
    // NOT folded with `unknown-run` even though both arrive at 404: the two have
    // opposite remedies (wait for the board vs. type a different id), and the id
    // in question is one the operator just typed.
    'unknown-session': 'this box has no registry row for that id — type one it knows',
    'no-claimant': 'nobody claims this run, so there is nothing to hand over',
    'claimant-alive': 'the coordinator is not dead',
    'registry-unmeasurable': 'the registry could not be read, so this box cannot say who is alive',
    'not-configured': 'this box does not run coordination — there is no ledger to rewrite',
    'bad-request': 'that id is not one this box will accept',
    unknown: 'the hand-over was refused, for a reason this build does not recognise',
  };

  /** `err` -> the sentence rendered inline. Status-first, `abandonErrorText`'s
   *  own dispatch (`AbandonSheet.tsx:64`): each status gets its own read of
   *  `err.body`, never one generic "request failed", and EVERY branch returns a
   *  string — this sheet has no toast to defer to. */
  function reclaimErrorText(err: unknown): string {
    if (!(err instanceof ApiError)) return RECLAIM_COPY.unknown;
    const body = typeof err.body === 'object' && err.body !== null
      ? (err.body as Record<string, unknown>) : {};
    if (err.status === 404) {
      return body.error === 'unknown-session' ? RECLAIM_COPY['unknown-session'] : RECLAIM_COPY['unknown-run'];
    }
    if (err.status === 409) {
      // BOTH keys, through the exported guard. The route spells `claimant-alive`
      // under `refused` (the `sendDispatchOutcome` family's shape,
      // `server/src/coord/routes.ts:141`); a coded refusal under `error` is the
      // shape its neighbours use (`:127`), and a client does not get to assume
      // which one a future arm picks.
      const code = isReclaimRefuseCode(body.refused) ? body.refused
        : isReclaimRefuseCode(body.error) ? body.error
        : null;
      if (code === 'no-claimant') return RECLAIM_COPY['no-claimant'];
      if (code === 'claimant-alive') {
        // `by` and `detail` are what make this a measurement rather than a
        // guess — `detail` is the evidence sentence L1 wrote so it would survive
        // the collapse to a code, and this is the surface it survived FOR. Same
        // reason `abandonErrorText` reads `from` off a bad-transition body.
        const by = typeof body.by === 'string' && body.by !== '' ? body.by : null;
        const detail = typeof body.detail === 'string' && body.detail.trim() !== ''
          ? body.detail.trim() : null;
        const who = by === null ? RECLAIM_COPY['claimant-alive'] : `${by} is not dead`;
        return detail === null ? who : `${who} — ${detail}`;
      }
      return RECLAIM_COPY.unknown;
    }
    if (err.status === 502) {
      const detail = typeof body.detail === 'string' && body.detail.trim() !== ''
        ? body.detail.trim() : null;
      return detail ?? RECLAIM_COPY['registry-unmeasurable'];
    }
    if (err.status === 501) return RECLAIM_COPY['not-configured'];
    if (err.status === 400) return RECLAIM_COPY['bad-request'];
    return RECLAIM_COPY.unknown;
  }

  export interface ResumeSheetProps {
    run: RunSummary | null;
    onClose: () => void;
    onDone?: () => void;
  }

  export function ResumeSheet({
    run,
    onClose,
    onDone,
    ensure = api.ensure,
    kickoff = api.kickoff,
    reclaimRun = api.reclaimRun,
  }: ResumeSheetProps & {
    /** Injectable for tests, `AbandonSheet`'s own `abandonRun` shape — each
     *  defaults to the real client method, whose URL/method are pinned
     *  separately in `api.test.ts` so this injection is never the ONLY coverage
     *  of a write path. */
    ensure?: (id: string) => Promise<void>;
    kickoff?: (id: string, b: { slug: string; title: string; runId?: number; wave?: number })
      => Promise<{ queued: boolean }>;
    reclaimRun?: (id: number, claimedBy: string)
      => Promise<{ program: string; runIds: number[]; from: string; to: string }>;
  }): ReactNode {
    /** WHICH door is in flight, not a bare boolean: three controls share one
     *  sheet, and "busy" has to disable all three while naming only the one the
     *  operator tapped. */
    const [busy, setBusy] = useState<'revive' | 'kickoff' | 'reclaim' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [reclaimOpen, setReclaimOpen] = useState(false);
    const [to, setTo] = useState('');

    // `gen`, ReapSheet's/AbandonSheet's idiom (`AbandonSheet.tsx:132-162` carries
    // the full measurement of the two bugs it closes). This sheet is mounted
    // UNCONDITIONALLY at screen level and `run === null` renders nothing without
    // unmounting, so `busy`/`error`/`note`/`reclaimOpen`/`to` would otherwise
    // survive every close and every switch of target — and the reveal state and
    // the typed id are the two that would survive most damagingly: run 7's sheet
    // opening with the irreversible door already unlocked and run 3's operator's
    // typed id still in the box.
    const gen = useRef(0);
    const targetId = run?.id ?? null;
    useEffect(() => {
      setBusy(null); setError(null); setNote(null); setReclaimOpen(false); setTo('');
      return () => { gen.current += 1; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetId]);

    if (run === null) return null;

    const claimedBy = run.claimedBy;
    const revive = (): void => {
      if (busy !== null || claimedBy === null) return;
      const mine = gen.current;
      setBusy('revive'); setError(null); setNote(null);
      void ensure(claimedBy).then(
        () => {
          if (gen.current !== mine) return;   // superseded — a different run's sheet is open now
          setBusy(null);
          // Revealed on BOTH arms. A revive that returned 200 is not a
          // coordinator that came back: `ccd ensure` reports that it asked, and
          // the pane's return is a later fact this sheet cannot await. The
          // operator who watches the row stay dead needs the next door already
          // in front of them.
          setReclaimOpen(true);
          setNote(`Asked the fleet to bring ${claimedBy} back. If the row does not come alive, hand the program to another session below.`);
        },
        (err: unknown) => {
          if (gen.current !== mine) return;
          setBusy(null);
          setReclaimOpen(true);
          // `apiErrorText`, not a map of this sheet's own: `/ensure` is an
          // ordinary lifecycle route that fails as 502 `{stderr}`, and ccd's own
          // words are more specific than anything this component could say —
          // the priority that function's docstring already argues for.
          setError(apiErrorText(err));
        },
      );
    };

    const reKickoff = (): void => {
      if (busy !== null || claimedBy === null) return;
      const mine = gen.current;
      setBusy('kickoff'); setError(null); setNote(null);
      void kickoff(claimedBy, {
        slug: run.program, title: run.programTitle, runId: run.id, wave: run.wave,
      }).then(
        (res) => {
          if (gen.current !== mine) return;
          setBusy(null);
          // The two answers are DIFFERENT sentences. `queued:false` folds "this
          // program's kickoff is already waiting" with "a different program's
          // is" — the fold stays folded by decision (no store read returns a
          // mail BODY, `MAIL_ROW_COLUMNS` omits it), so the sentence says "a
          // kickoff", never "this program's kickoff". What it must not do is
          // claim something was queued when nothing was.
          setNote(res.queued
            ? `The re-kickoff is queued for ${claimedBy}. It names run ${run.id} at wave ${run.wave}, and the mail lane will not interrupt a busy session.`
            : `A kickoff is already waiting for ${claimedBy} — it has not been read yet. Nothing new was queued.`);
        },
        (err: unknown) => {
          if (gen.current !== mine) return;
          setBusy(null);
          // The composition wave 4 shipped for exactly this route
          // (`lib/api.ts:239`), reused rather than a fifth per-surface map:
          // three of the five codes it can answer with are owned by
          // `uploadErrorText`, which is why they are not in `API_ERROR_TEXT`.
          setError(kickoffErrorText(apiErrorText(err)));
        },
      );
    };

    const reclaim = (): void => {
      const target = to.trim();
      if (busy !== null || target === '') return;
      const mine = gen.current;
      setBusy('reclaim'); setError(null); setNote(null);
      void reclaimRun(run.id, target).then(
        () => {
          if (gen.current !== mine) return;
          setBusy(null);
          // The ONE door that closes on success: `claimedBy` has been rewritten
          // across every run of this program, so the board's cold read is now
          // the stale half and `onDone` is what refreshes it.
          onDone?.();
          onClose();
        },
        (err: unknown) => {
          if (gen.current !== mine) return;   // superseded — this refusal belongs to a run no longer shown
          setBusy(null);
          setError(reclaimErrorText(err));
        },
      );
    };

    return (
      <Sheet open onClose={onClose} title="The coordinator is gone">
        <div className="abandon-sheet">
          <p className="qc-consequence">
            {claimedBy === null
              // Unreachable from the board (the row's gate needs a claimant to
              // measure), and stated rather than collapsed into `return null`:
              // "no run" and "a run nobody claims" are two conditions, and one
              // render for both is the overloaded seam this repo bans.
              ? `Run ${run.id} names no coordinator, so there is nobody to revive and nothing to hand over.`
              : `${claimedBy} claims run ${run.id} — ${run.program}, wave ${run.wave} — and this box measured it dead. Cheapest door first: bring the pane back, tell it to pick the wave up, or hand the program to another session.`}
          </p>
          {claimedBy !== null && (
            <div className="qc-actions">
              <button type="button" className="btn-primary" disabled={busy !== null} onClick={revive}>
                {busy === 'revive' ? 'Reviving…' : `Revive ${claimedBy}`}
              </button>
              <button type="button" className="btn-ghost" disabled={busy !== null} onClick={reKickoff}>
                {busy === 'kickoff' ? 'Queueing…' : 'Re-kickoff'}
              </button>
              {reclaimOpen ? (
                <>
                  {/* `.sess-hold-input` verbatim, not a new class: the same
                      object — a single-line id field inside a fleet sheet — and
                      it is already self-grounded, tap-floored and carries the
                      ::placeholder ink (`fleet.css:1385-1401`). The identical
                      reuse `.run-row` already makes of `.sess-unmeasured`. */}
                  <input
                    type="text"
                    className="sess-hold-input"
                    aria-label={`Hand run ${run.id} to this session id`}
                    placeholder="session id"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                  <button type="button" className="btn-ghost"
                          disabled={busy !== null || to.trim() === ''} onClick={reclaim}>
                    {busy === 'reclaim' ? 'Handing over…' : 'Reclaim'}
                  </button>
                </>
              ) : (
                <button type="button" className="btn-ghost" disabled={busy !== null}
                        onClick={() => setReclaimOpen(true)}>
                  That id cannot be revived
                </button>
              )}
              <button type="button" className="btn-ghost" disabled={busy !== null} onClick={onClose}>
                Cancel
              </button>
            </div>
          )}
          {note !== null && <p className="qc-consequence">{note}</p>}
          {error !== null && <p className="abandon-error">{error}</p>}
        </div>
      </Sheet>
    );
  }
  ```

  Re-run `cd pwa && ./node_modules/.bin/vitest run test/resume-sheet.test.tsx`. Green.
- [ ] **8.9 — The one new class, grouped, with both of its pins in this same commit.** `.run-abandon` names
  an act this control does not perform, so the row's second control gets its own name — and it ships
  GROUPED into the existing rule rather than as a second rule that re-derives eleven declarations (the
  `.archive-conflict-sheet` precedent, `fleet.css:2085-2092`). Grouping is what buys the tap floor, the
  `flex: none`, the no-glow discipline and the CONTRAST measurement for free, with no registry entry.
  In `pwa/src/fleet/fleet.css`, extend the two selector lists at `:2000` and `:2013`:

  ```css
  /* Task 12, spec §4.3, D-287: a SIBLING of `.run-open` inside `.run-row`'s
     own `<li>`, never a descendant of it — see RunsScreen.tsx's own comment on
     why a nested button is the defect this shape avoids. Self-grounded via
     `.run-row` (above, background+color both set), same nested idiom as
     `.run-row .run-glyph`/`.run-row .run-state` a few lines up — a run row is
     a record of a lifecycle position, not a living pane, so this control gets
     no --glow/animation/box-shadow either (`fleet-css.test.ts`'s "runs are not
     living panes").
     `.run-resume` (the resume door) is GROUPED here rather than given a rule of
     its own: it is the same object — a `flex: none` control sitting beside
     `.run-open` on the row — and the grouping is what keeps it MEASURED by
     `design/audit.mjs` (it inherits `.run-row`'s recovered ground) and floored
     on `var(--tap-min)` by the one declaration, instead of a second copy that
     drifts. `flex: none` is load-bearing on BOTH: `.run-open` deliberately
     declares no `width` (`:1946-1954`, pinned) precisely so its siblings can
     share the line; a THIRD control that claimed flexible width would push both
     onto their own rows at phone widths, which jsdom cannot see and only the
     stylesheet can prevent. */
  .run-row .run-abandon,
  .run-row .run-resume {
  ```
  ```css
  .run-row .run-abandon:active,
  .run-row .run-resume:active { transform: scale(0.94); color: var(--ink-secondary); }
  ```

  The `fleet-css.test.ts` entry — append inside the `describe` at `:662`, beside the `.run-open` width pin
  at `:690-691`:

  ```ts
  // The resume door's tap floor, its `flex: none` and its no-glow discipline
  // are all the SAME declarations `.run-abandon` is already held to — which is
  // only true while the two share one rule. Read the grouping back, so a
  // well-meaning split into a second rule (which would silently drop all three
  // and leave the class in `design/audit.mjs`'s uncovered census) reds here.
  it('.run-resume shares .run-abandon’s rule — that grouping IS its floor and its ground', () => {
    expect(selectorsOf(css, '.run-row .run-abandon'))
      .toEqual(['.run-row .run-abandon', '.run-row .run-resume']);
    expect(declValue(ruleFor('.run-row .run-resume'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleFor('.run-row .run-resume'), 'min-width')).toBe('var(--tap-min)');
    expect(declValue(ruleFor('.run-row .run-resume'), 'flex')).toBe('none');
    const rule = norm(stripComments(ruleFor('.run-row .run-resume')));
    expect(rule).not.toContain('--glow');
    expect(rule).not.toContain('animation');
    expect(rule).not.toContain('box-shadow');
  });

  // The board's row has three controls now, not two, and `.run-open` must still
  // decline to claim the width — `:1946-1954`'s measurement (a full-width
  // `.run-open` roughly doubled every row's height) gets worse with a third
  // sibling, not better.
  it('.run-open still claims no width, now that a THIRD control shares the line', () => {
    expect(declValue(ruleFor('.run-row .run-open'), 'width')).toBeNull();
  });
  ```

  The `contrast.test.ts` entry — append at the end of the file, in the idiom of the spawn-chip block
  (`contrast.test.ts:1341-1365`):

  ```ts
  // ── the resume door's ink (program-leverage wave 5) ────────────────────────
  describe('the resume door is measured, not left in the blind spot', () => {
    it('rides .run-abandon’s grouped rule, so both themes and both states are measured', () => {
      // No GROUNDS/INHERITED_GROUNDS entry, and that is the point: the class was
      // added to a rule whose ancestor `.run-row` is already self-grounded, so
      // the descendant route recovers the ground on its own. A rule of its own
      // would have needed a registry entry — or, forgotten, would have joined
      // the uncovered census with the report still LOOKING complete.
      const rows = report.measured.filter((m) => m.label.includes('.run-row .run-resume'));
      expect(rows).toHaveLength(4);            // base + :active, dark and light
      for (const row of rows) {
        expect(row.detail, row.label).toContain('on var(--bg-surface)');
        expect(row.ratio, row.label).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
  ```

  Run `cd pwa && ./node_modules/.bin/vitest run test/fleet-css.test.ts test/contrast.test.ts
  test/tap-targets.test.tsx`. `tap-targets.test.tsx:228-255`'s eighteen-rule loop is UNTOUCHED on purpose —
  `ruleIn` is grouping-tolerant (`test/cssRule.ts:66-95`), so its `.run-row .run-abandon` entry now reads the
  rule that floors both controls; a nineteenth entry would be a second assertion over the same text. Say so
  in the execution record.
- [ ] **8.10 — Write the board's own gate cases in `pwa/test/runs-screen.test.tsx`, red.** A control that
  exists only in its own isolated test file ships missing the moment someone drops the line from
  `RunsScreen` (`abandon-sheet.test.tsx:10-13`). Append:

  ```tsx
  // The resume door on the board. `coordPresence` decides (its own table lives
  // in `resume-sheet.test.tsx`); this pins that the BOARD asks it, with the
  // right three arguments, and renders nothing when the answer is not `dead`.
  describe('the resume door on the run board', () => {
    const coord = (over: Partial<FleetSession> = {}): FleetSession =>
      sess({ id: 'ccrc-pwa-coordinator', workspace: null, branch: null, ...over });

    const board = (opts: {
      sessions: FleetSession[]; fleetFrameSeen: boolean; run?: Partial<RunSummary>;
    }): void => {
      const store = makeStore();
      act(() => {
        store.setState({
          runs: [r(opts.run)], runsFrameSeen: true,
          sessions: opts.sessions, fleetFrameSeen: opts.fleetFrameSeen,
        });
      });
      render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    };

    it('offers the door when the claimant is measured dead', () => {
      board({ sessions: [coord({ status: 'dead', lifecycle: 'orphan' })], fleetFrameSeen: true });
      expect(screen.getByRole('button', { name: /resume run 3/i })).toBeInTheDocument();
    });

    it('hides it while the answer is unknown — no fleet frame has landed', () => {
      // The row LOOKS identical; the difference is entirely whether this box has
      // heard from the fleet at all. A board that read the hydrated snapshot as
      // an answer would offer this door on every cold start.
      board({ sessions: [coord({ status: 'dead', lifecycle: 'orphan' })], fleetFrameSeen: false });
      expect(screen.queryByRole('button', { name: /resume run 3/i })).toBeNull();
    });

    it('hides it while the answer is unknown — the claimant is not in the array', () => {
      board({ sessions: [], fleetFrameSeen: true });
      expect(screen.queryByRole('button', { name: /resume run 3/i })).toBeNull();
    });

    it('hides it when the claimant is alive', () => {
      board({ sessions: [coord({ status: 'idle', lifecycle: 'running' })], fleetFrameSeen: true });
      expect(screen.queryByRole('button', { name: /resume run 3/i })).toBeNull();
    });

    it('hides it on a closed run — a finished wave has no coordinator to bring back', async () => {
      const store = makeStore();
      act(() => {
        store.setState({
          runs: [], runsFrameSeen: true,
          sessions: [coord({ status: 'dead', lifecycle: 'orphan' })], fleetFrameSeen: true,
        });
      });
      render(<RunsScreen store={store}
                         loadRuns={async () => ({ runs: [r({ state: 'done', closedAt: Date.now() })] })} />);
      // The row lands via the cold read (`finished` reads only `cold`), so wait
      // for it before asserting on the absence of a control ON it.
      expect(await screen.findByText('clear-cove')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /resume run 3/i })).toBeNull();
      // …and the release valve is still there: a closed run can still be the
      // wedge `.run-abandon` exists for.
      expect(screen.getByRole('button', { name: /abandon run 3/i })).toBeInTheDocument();
    });

    it('needs two taps: the row control opens the sheet, nothing is sent by opening it', async () => {
      const fetchImpl = vi.fn();
      vi.stubGlobal('fetch', fetchImpl);
      board({ sessions: [coord({ status: 'dead', lifecycle: 'orphan' })], fleetFrameSeen: true });
      fireEvent.click(screen.getByRole('button', { name: /resume run 3/i }));
      expect(await screen.findByRole('button', { name: /^re-kickoff$/i })).toBeInTheDocument();
      expect(fetchImpl).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('the row still never nests a button inside a button, with three controls on it', () => {
      const store = makeStore();
      act(() => {
        store.setState({
          runs: [r()], runsFrameSeen: true,
          sessions: [coord({ status: 'dead', lifecycle: 'orphan' })], fleetFrameSeen: true,
        });
      });
      const { container } = render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
      for (const btn of container.querySelectorAll('button')) {
        expect(btn.querySelector('button')).toBeNull();
      }
    });
  });
  ```

  **Expected RED.** Record the first failing assertion verbatim.
- [ ] **8.11 — Wire `RunsScreen`, green.** Three edits in `pwa/src/screens/RunsScreen.tsx`.

  Imports (`:37-41`) gain `coordPresence` and the sheet:
  ```tsx
  import { coordPresence } from '../fleet/coordWords';
  import { ResumeSheet } from '../fleet/ResumeSheet';
  ```

  `RunRow`'s props (`:69-91`) gain three, and the control is built beside `abandonButton` (`:208-217`):
  ```tsx
    /** The run's CLAIMANT as the live fleet snapshot has it — a different
     *  lookup from `session` above, which is the run's WORKER. Both come off
     *  `sessionById`, and conflating them would put the resume door on a row
     *  whose worker died while its coordinator is fine. */
    coordSession: FleetSession | null;
    /** Has a `{type:'fleet'}` frame ever landed. Passed rather than inferred
     *  from `coordSession !== null`: absence from a snapshot that never arrived
     *  and absence from one that did are opposite facts, and only the second is
     *  evidence of anything. */
    frameSeen: boolean;
    /** Opens the ResumeSheet for this row (spec §7.3). */
    onResume: (run: RunSummary) => void;
  ```
  ```tsx
    // The resume door. `coordPresence` decides — three answers, and only `dead`
    // opens it: `unknown` is what a substrate fault, a missing row and an
    // unarrived frame all read as, and each of those would otherwise offer to
    // hand a live coordinator's program to somebody else (D-309's collapse,
    // quoted on `coordPresence`'s own docstring).
    //
    // `!isRunClosed(run)` is the second half and not a nicety: `finished` rows
    // render through this same component, and a done wave's coordinator being
    // dead is the ORDINARY end state, not a wedge.
    const presence = coordPresence(run.claimedBy, coordSession, frameSeen);
    const resumeButton = presence === 'dead' && !isRunClosed(run) ? (
      <button
        type="button"
        className="run-resume"
        aria-label={`Resume run ${run.id}`}
        onClick={() => onResume(run)}
      >
        Resume
      </button>
    ) : null;
  ```
  and both returns (`:231-240`) render it as a further SIBLING, ahead of Abandon — the constructive door
  first, and never nested, for `abandonButton`'s own stated reason:
  ```tsx
    return run.sessionId === null
      ? <li className="run-row" data-inert="true">{body}{resumeButton}{abandonButton}</li>
      : (
        <li className="run-row">
          <button type="button" className="run-open" onClick={() => navigate(`/s/${encodeURIComponent(run.sessionId!)}`)}>
            {body}
          </button>
          {resumeButton}
          {abandonButton}
        </li>
      );
  ```

  `RunsScreen` reads the flag beside `sessions` (`:252`), holds the target beside `abandonTarget` (`:269`),
  passes both down in `rowFor` (`:427-435`), and mounts the sheet beside `AbandonSheet` (`:552`):
  ```tsx
    const fleetFrameSeen = store((s) => s.fleetFrameSeen);
  ```
  ```tsx
    // Spec §7.3: which run's ResumeSheet is open, or `null`. ONE sheet at screen
    // level, reused across rows — `abandonTarget`'s own shape, one line up.
    const [resumeTarget, setResumeTarget] = useState<RunSummary | null>(null);
  ```
  ```tsx
    const rowFor = (run: RunSummary): ReactNode => (
      <RunRow
        key={run.id}
        run={run}
        nowMs={now}
        session={run.sessionId === null ? null : sessionById.get(run.sessionId) ?? null}
        coordSession={run.claimedBy === null ? null : sessionById.get(run.claimedBy) ?? null}
        frameSeen={fleetFrameSeen}
        onAbandon={setAbandonTarget}
        onResume={setResumeTarget}
      />
    );
  ```
  ```tsx
      {/* Spec §7.3: `onDone` re-runs `loadCold()` for the same reason the
          abandon sheet's does — a reclaim rewrites `claimedBy` on EVERY run of
          the program, terminal ones included (contract R1), and the finished
          half of this board has no source but the cold read. */}
      <ResumeSheet run={resumeTarget} onClose={() => setResumeTarget(null)} onDone={() => { void loadCold(); }} />
  ```
  Re-run `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx test/abandon-sheet.test.tsx`.
  Green — and `abandon-sheet.test.tsx` stays green untouched, because its fixtures name a `claimedBy` that is
  deliberately absent from the fleet (`runs-screen.test.tsx:24-27`), which now reads `unknown`, which hides
  the door.
- [ ] **8.12 — Correct the one comment that stops being true.** `runs-screen.test.tsx:741-748` asserts, as
  the justification for reading `setInterval` calls as the tick, that "`useNow` is the only `setInterval` in
  this screen's whole tree — measured across `pwa/src`: `CoordBanner`, `AbandonSheet` and
  `StartProgramSheet` run none". `ResumeSheet` is now in that tree. Re-measure
  (`grep -rn "setInterval\|setTimeout" pwa/src/fleet/ResumeSheet.tsx` → nothing) and name it in the list, so
  the claim stays a measurement rather than an inherited sentence.
- [ ] **8.13 — Green, all of it, foreground.**
  `cd pwa && ./node_modules/.bin/vitest run test/resume-sheet.test.tsx test/runs-screen.test.tsx
  test/abandon-sheet.test.tsx test/stores.test.ts test/coord-banner.test.tsx test/start-program.test.tsx
  test/fleet-css.test.ts test/contrast.test.ts test/tap-targets.test.tsx test/fleet-screen.test.tsx`
  (timeout ≥ 600000). `coord-banner.test.tsx` is in the list because `coordWords.ts` grew an import;
  `fleet-screen.test.tsx` and `start-program.test.tsx` because the store grew a field.
- [ ] **8.14 — Run the mutation table and record every first-fail assertion verbatim.** Each row is applied
  to the working tree, the named suite run, the exact first failing assertion text pasted into the table,
  and the mutation reverted before the next.

  | mutation | first-fail assertion |
  | --- | --- |
  | `coordPresence`: delete the `if (!frameSeen) return 'unknown'` arm | `<measured at execution>` |
  | `coordPresence`: answer `'dead'` for a session missing from the array | `<measured at execution>` |
  | `coordPresence`: delete the `substrateFault(session) !== null` arm | `<measured at execution>` |
  | `coordPresence`: delete the `lifecycle === null \|\| lifecycle === 'unmeasurable'` arm | `<measured at execution>` |
  | `coordPresence`: gate on `session.status === 'dead'` alone, dropping `lifecycleIsDead` | `<measured at execution>` |
  | `coordPresence`: return `'alive'` instead of `'unknown'` when `claimedBy === null` | `<measured at execution>` |
  | store: drop `fleetFrameSeen: true` from the `fleet`-frame `set` | `<measured at execution>` |
  | store: initialise `fleetFrameSeen: true` | `<measured at execution>` |
  | `RunRow`: render `resumeButton` unconditionally | `<measured at execution>` |
  | `RunRow`: drop the `!isRunClosed(run)` half of the gate | `<measured at execution>` |
  | `RunRow`: pass `session` where `coordSession` belongs (worker for claimant) | `<measured at execution>` |
  | `ResumeSheet`: delete the `gen.current !== mine` guard in `reclaim`'s reject arm | `<measured at execution>` |
  | `ResumeSheet`: delete the effect's `setReclaimOpen(false); setTo('')` reset | `<measured at execution>` |
  | `ResumeSheet`: set `reclaimOpen` initially `true` (offer the third door up front) | `<measured at execution>` |
  | `ResumeSheet`: render one sentence for both `queued` answers | `<measured at execution>` |
  | `ResumeSheet`: `reclaimErrorText` 404 → always `RECLAIM_COPY['unknown-run']` | `<measured at execution>` |
  | `ResumeSheet`: `reclaimErrorText` 409 → the `unknown` catch-all for both codes | `<measured at execution>` |
  | `ResumeSheet`: `reclaimErrorText` 409 `claimant-alive` → drop `by`/`detail` | `<measured at execution>` |
  | `ResumeSheet`: `reclaimErrorText` 502 → ignore `detail` | `<measured at execution>` |
  | `ResumeSheet`: call `onClose()` on a refusal | `<measured at execution>` |
  | `ResumeSheet`: send `{slug, title}` only, dropping `runId`/`wave` | `<measured at execution>` |
  | `fleet.css`: remove `.run-row .run-resume` from the grouped selector list | `<measured at execution>` |
  | `fleet.css`: add `width: 100%` to `.run-row .run-open` | `<measured at execution>` |

- [ ] **8.15 — Record this task's three deviations** in the plan's `## Deviations found`, numbered from the
  wave block (`D-1123..1140`) at assembly — **grep `origin/main` across `docs/` AND source before
  fixing the numbers**, then make the source comments match:
  - **D-1138** — the contract's `frameSeen` parameter had no producer: the store carries `runsFrameSeen` and
    `coordFrameSeen` and nothing for the `fleet` frame, and `sessions` is hydrated from `localStorage`
    (`stores/fleet.ts:211`) so its contents are not evidence a socket ever spoke. Added `fleetFrameSeen` as
    the third instance of that idiom.
  - **D-1129** — the contract anchors D-309 at `server/src/fleet.ts:241-252`; measured, the comment is at
    `:245-250` and the `hasSession` call it describes at `:251`. Anchor corrected; the quoted text is
    unchanged.
  - **D-1129** — a new class was unavoidable (`.run-abandon` names an act the resume control does not
    perform), and it ships GROUPED into `.run-abandon`'s existing rule rather than as a new one. That is
    what makes it automatically measured by `design/audit.mjs` with no `GROUNDS`/`INHERITED_GROUNDS` entry,
    and floored on `var(--tap-min)` with `flex: none` by the same declarations — pinned in both directions.
- [ ] **8.16 — Commit.**

  ```
  git add pwa/src/stores/fleet.ts pwa/src/fleet/coordWords.ts pwa/src/fleet/ResumeSheet.tsx \
          pwa/src/fleet/fleet.css pwa/src/screens/RunsScreen.tsx \
          pwa/test/stores.test.ts pwa/test/resume-sheet.test.tsx pwa/test/runs-screen.test.tsx \
          pwa/test/fleet-css.test.ts pwa/test/contrast.test.ts && \
  git commit -m "feat(wave5): the run board offers the three doors when a coordinator is measured dead

  coordPresence answers alive/dead/unknown, never two: assembleFleet already
  collapses a tmux unknown into status:'dead' (D-309), so a door gated on that
  word would open during a substrate outage. unknown hides the door.

  ResumeSheet mirrors AbandonSheet byte for byte — the gen/targetId supersession
  guard, the total refusal Record with a designated unknown, status-first error
  copy, refusals inline with the sheet held open. Revive and Re-kickoff are
  offered; Reclaim is revealed, because it is the only one of the three that
  cannot be undone by waiting."
  ```

---

## Task 9: StartProgramSheet refuses a project that already has an open run

**Files:** `pwa/src/fleet/StartProgramSheet.tsx`, `pwa/src/screens/RunsScreen.tsx`,
`pwa/src/fleet/fleet.css`, `pwa/test/start-program.test.tsx`, `pwa/test/runs-screen.test.tsx`,
`pwa/test/tap-targets.test.tsx`.

**Read before starting:** `pwa/src/fleet/StartProgramSheet.tsx` in full (839 lines) and
`pwa/test/start-program.test.tsx` (1620 lines). The anchors this task stands on, all verified:
the render `? :` chain opens at `:684-685`, the D-292 refusal `<p>` is `:719-723`, the D-284 arm is
`:724-729`, the confirm button and its five-term `disabled` are `:816-832`, `existing`/`isOwnAttempt`
are `:490-502`, `start()`'s three defensive returns are `:504-507`, and the two-fetch pin is
`pwa/test/start-program.test.tsx:531` (`expect(urls).toHaveLength(2)`).

- [ ] **9.1 — Correct the brief's premise, in writing, before any code.** The brief says the sheet
  "today refuses only on a live main checkout". Measured, that is wrong three times over, and the
  correction is what fixes where the new arm goes. Record it in the plan's `## Deviations found` as
  **D-1130**, with these anchors:
  * **TWO arms already withhold the confirm button entirely,** not one: `StartProgramSheet.tsx:685`
    (`existing !== null && !isOwnAttempt`, D-292) and `:724` (`projected === null`, D-284). Both
    render a `<p>` and no button at all — "refuses" is already a two-member family.
  * **The `disabled` expression at `:819-822` has FIVE terms:** `slug.trim() === ''`,
    `title.trim() === ''`, `starting`, `projected === undefined`, `existing !== null`. A sixth term is
    not the shape for this refusal — a disabled control is a dead tap, and the two withholding arms
    are the precedent the contract points at.
  * **`start()` carries THREE defensive returns** (`:505`, `:506`, `:507`), the last of which is
    explicitly labelled unreachable ("the confirm button is not rendered in this case at all").
  Consequence for this task: the new arm is a THIRD member of the withholding family, and its position
  in the chain is a decision between two sentences that are both true, not a bolt-on.
- [ ] **9.2 — Record the measured limitation as D-1131, before writing the copy that must respect
  it.** This refusal is strictly NARROWER than the harm it names, and the copy is not allowed to
  outrun it:
  * `resolveCoordinator(null)` requires exactly ONE program in `state = 'active'` **box-wide** —
    `SELECT slug FROM programs WHERE state = 'active'` then `if (active.length !== 1) return null`
    (`server/src/coord/store.ts:1185-1187`), which the caller turns into `unknown-recipient`
    ("no guessing", `:1166-1173`). So a second program opened in a **different** project wedges
    `toId:'coordinator'` mail carrying no `runId` exactly as hard, and this sheet is blind to it.
  * **Nothing server-side backstops the per-project case either.** `POST /api/runs` validates
    `project` as `typeof project !== 'string' || project.trim() === ''` and applies no predicate over
    it at all (`server/src/coord/routes.ts:889-897`); `openRun`'s only refusal is per-PROGRAM
    (`store.ts:369-377`, `claimed-by-another`), so a second slug in the same project opens cleanly.
  * Therefore what ships is a per-project speed bump over data the board already holds. The box-wide
    measurement would need a fetch this sheet is forbidden (`start-program.test.tsx:531` pins the
    composition at exactly two network calls), so it is recorded as a known gap rather than half-built.
- [ ] **9.3 — Write the pure-predicate suite first.** In `pwa/test/start-program.test.tsx`, add
  `openRunVerdict` to the existing import at `:40`, and add this `describe` immediately after the
  `startedSessionFor` block (ends `:168`), before `describe('StartProgramSheet'` at `:170`:

  ```tsx
  // THREE answers, and the third is the whole reason this is a function rather
  // than a `.has()` at the call site. It follows `startedSessionFor`'s precedent
  // in the same file (`StartProgramSheet.tsx:176-185`): the `unmeasured` answer
  // is reachable through the component only via a prop fixture, and a pure
  // predicate is the cheapest place to pin all three arms against each other.
  describe('openRunVerdict — the run-board arm, directly (D-1130)', () => {
    it('answers unmeasured for null — NOT MEASURED is never folded into "no open run"', () => {
      expect(openRunVerdict(null, 'ccrc-pwa')).toBe('unmeasured');
    });

    it('answers open-run for a project the measured set names', () => {
      expect(openRunVerdict(new Set(['ccrc-pwa']), 'ccrc-pwa')).toBe('open-run');
    });

    it('answers clear for a measured set that does not name it — an EMPTY set included', () => {
      expect(openRunVerdict(new Set(['other-repo']), 'ccrc-pwa')).toBe('clear');
      expect(openRunVerdict(new Set<string>(), 'ccrc-pwa')).toBe('clear');
    });

    // The join between `RunSummary.project` and `ProjectRow.name` is CONVENTION:
    // `POST /api/runs` validates the field as a non-empty string and nothing more
    // (`server/src/coord/routes.ts:889-897`), so a run can name a string this
    // picker never lists. A prefix or case-folded match would refuse a real
    // project on the strength of a lookalike; an exact one means the sheet simply
    // has nothing to say about that run, which is the honest answer.
    it('matches EXACTLY — never by prefix, never case-folded', () => {
      expect(openRunVerdict(new Set(['ccrc-pwa-brisk-harbor']), 'ccrc-pwa')).toBe('clear');
      expect(openRunVerdict(new Set(['CCRC-PWA']), 'ccrc-pwa')).toBe('clear');
      expect(openRunVerdict(new Set(['ccrc']), 'ccrc-pwa')).toBe('clear');
    });
  });
  ```
- [ ] **9.4 — Measure it red and record the first failing assertion verbatim.**
  `cd pwa && ./node_modules/.bin/vitest run test/start-program.test.tsx` (foreground, timeout
  ≥ 600000). Expect a module-resolution failure on the missing export, not an assertion —
  **record the exact text either way**, including which of the two shapes it was.
- [ ] **9.5 — Add the predicate to `StartProgramSheet.tsx`,** immediately after `startErrorText`
  (ends `:217`) and before `export interface StartProgramSheetProps` (`:219`):

  ```ts
  /** "Is a program already running in this project?" — THREE answers, and the
   *  third is why this is a function instead of a `.has()` at the call site.
   *
   *  `openRunProjects === null` is NOT MEASURED: the run board has had neither a
   *  `runs` frame nor a finished cold read. A `(openRunProjects ?? new Set()).has()`
   *  answers `false` there, which is indistinguishable from a measured empty board
   *  — the sheet would offer Start on the strength of a question nobody answered.
   *  That fold is the single failure this arm exists to prevent, so the state gets
   *  its own word and the render gets its own sentence.
   *
   *  The set carries PROJECT NAMES and nothing else, so the copy below can name
   *  the project and cannot name the program. That is a limit, not an omission: a
   *  set of names is not a run row, and naming a program would be a claim this
   *  measurement never made.
   *
   *  The match is EXACT. `RunSummary.project` is whatever string the coordinator
   *  passed to `POST /api/runs`, which validates it as a non-empty string and
   *  nothing more (`server/src/coord/routes.ts:889-897`); `ProjectRow.name` comes
   *  from the projects listing. Nothing joins the two but convention, so a run
   *  naming a project this picker never lists is a run this sheet cannot speak
   *  about — loosening to a prefix would refuse real projects over a lookalike.
   *
   *  EXPORTED for its own unit test, on `startedSessionFor`'s precedent above. */
  export type OpenRunVerdict = 'clear' | 'open-run' | 'unmeasured';

  export function openRunVerdict(
    openRunProjects: ReadonlySet<string> | null,
    project: string,
  ): OpenRunVerdict {
    if (openRunProjects === null) return 'unmeasured';
    return openRunProjects.has(project) ? 'open-run' : 'clear';
  }
  ```

  Re-run `test/start-program.test.tsx`; the four predicate cases go green while every component case
  stays as it was.
- [ ] **9.6 — Write the six component cases, red.** Add a module-level fixture beside `proj`
  (after `:62`), then the cases inside `describe('StartProgramSheet')`, after the D-292 re-evaluation
  case (ends `:776`):

  ```tsx
  /** The measured-and-empty answer — "the board has answered, nothing is open".
   *  Spelled once so the 45 pre-existing render sites all say the same thing, and
   *  so the four fixtures that mean something else stand out on the page. */
  const NO_OPEN_RUNS: ReadonlySet<string> = new Set<string>();
  ```

  ```tsx
    // — Program-leverage wave 5, D-1130. The run board is a fact this sheet never
    // had. `POST /api/runs` will happily open a SECOND program in a project that
    // already has one: it validates `project` as a non-empty string and nothing
    // else (`server/src/coord/routes.ts:889-897`), and `openRun`'s own refusal is
    // per-PROGRAM (`store.ts:369-377`), so it never fires for a different slug.
    // The sheet is the last place the operator can still be told. —
    it('refuses when the board already shows a run in that project — no confirm button at all (D-1130)', async () => {
      vi.spyOn(api, 'accounts').mockResolvedValue(projected());
      render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
        openRunProjects={new Set(['ccrc-pwa'])}
        loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

      await fillAndPick();

      expect(await screen.findByText(/already has a run open/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
    });

    // THE ARM THIS EXISTS FOR. `null` is NOT MEASURED, and the failure it prevents
    // is fold-to-permit — `(openRunProjects ?? new Set()).has(name)` answers
    // `false` here, indistinguishable from a measured empty board, and offers
    // Start on a question nobody answered.
    it('refuses when the board has NOT answered — null is not "no open run" (D-1130)', async () => {
      vi.spyOn(api, 'accounts').mockResolvedValue(projected());
      render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
        openRunProjects={null}
        loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

      await fillAndPick();

      expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
      expect(await screen.findByText(/has not answered yet/i)).toBeInTheDocument();
      // …and it must not claim a run EXISTS. The sheet holds exactly one fact
      // here — that the board is silent — and the copy states that one.
      expect(screen.queryByText(/already has a run open/i)).toBeNull();
    });

    it('yields to the D-292 sentence when BOTH are true — that one names a session the operator can open (D-1130)', async () => {
      vi.spyOn(api, 'accounts').mockResolvedValue(projected());
      const store = makeStore();
      act(() => { store.setState({ sessions: [sess({ id: 'claude-ccrc-pwa', project: 'ccrc-pwa' })] }); });
      render(<StartProgramSheet open onClose={() => {}} fleet={store}
        openRunProjects={new Set(['ccrc-pwa'])}
        loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

      await fillAndPick();

      expect(await screen.findByText(/claude-ccrc-pwa is already running/i)).toBeInTheDocument();
      expect(screen.queryByText(/already has a run open/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
    });

    // THE INDEPENDENCE PIN. `existing` is evaluated only when `projected != null`
    // (`StartProgramSheet.tsx:490-493`), so a run refusal written into THAT
    // expression is invisible on a fleet where nothing is placeable: the operator
    // reads "Nothing is placeable", enables an account, and walks straight into
    // the collision. The run arm is computed from `project` alone and sits ABOVE
    // the D-284 arm for exactly that reason.
    it('refuses the open run even when NOTHING is placeable — the run arm never depends on the projection (D-1130)', async () => {
      vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster: [] });
      render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
        openRunProjects={new Set(['ccrc-pwa'])}
        loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

      fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

      expect(await screen.findByText(/already has a run open/i)).toBeInTheDocument();
      expect(screen.queryByText(/nothing is placeable/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
    });

    it('does NOT refuse for a run naming a project the picker never lists — the join is exact (D-1130)', async () => {
      vi.spyOn(api, 'accounts').mockResolvedValue(projected());
      render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
        openRunProjects={new Set(['ccrc-pwa-brisk-harbor', 'CCRC-PWA'])}
        loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

      await fillAndPick();

      expect(await screen.findByRole('button', { name: /^start build9-demo on/i })).not.toBeDisabled();
      expect(screen.queryByText(/already has a run open/i)).toBeNull();
    });

    it('re-evaluates the run refusal when the chosen project changes (D-1130)', async () => {
      vi.spyOn(api, 'accounts').mockResolvedValue(projected());
      render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
        openRunProjects={new Set(['alpha'])}
        loadProjects={async () => ({
          roots: [],
          projects: [proj({ name: 'alpha', workdir: '/w/alpha' }), proj({ name: 'beta', workdir: '/w/beta' })],
        })} />);

      fireEvent.click(await screen.findByRole('button', { name: /alpha/i }));
      expect(await screen.findByText(/already has a run open/i)).toBeInTheDocument();

      fireEvent.click(await screen.findByRole('button', { name: /beta/i }));
      expect(await screen.findByRole('button', { name: /^start/i })).toBeInTheDocument();
      expect(screen.queryByText(/already has a run open/i)).toBeNull();
    });
  ```
- [ ] **9.7 — Measure the six red and record the first failing assertion verbatim.** They fail
  because the sheet ignores an unknown prop and renders the confirm fragment — the RIGHT reason.
  `cd pwa && ./node_modules/.bin/vitest run test/start-program.test.tsx`.
- [ ] **9.8 — Write the three board-level cases, red,** in `pwa/test/runs-screen.test.tsx`. This is the
  file whose own header (`:525-531`) states the lesson: a control that only ever renders in its own
  isolated test file ships broken the moment a line leaves the screen. Add
  `import { api } from '../src/lib/api';` and this `describe` after the program-start-door block
  (ends `:544`):

  ```tsx
  // The refusal lives in `StartProgramSheet`; the MEASUREMENT lives here. A sheet
  // handed a fold-to-permit default would pass every case in
  // `start-program.test.tsx` while the real board fed it the wrong answer, which
  // is the same gap `:525-531` above was written for.
  describe('the run board tells the start sheet which projects already have a run (D-1130)', () => {
    // Matched on the WORKDIR: `/^start/i` also matches the board's own "Start a
    // program" door, and a run row for `ccrc-pwa` is on screen in two of the three
    // cases, so the project row needs a needle nothing else carries.
    const openAndPick = async (): Promise<void> => {
      fireEvent.click(await screen.findByRole('button', { name: /start a program/i }));
      fireEvent.change(screen.getByLabelText(/program slug/i), { target: { value: 'build9-demo' } });
      fireEvent.change(screen.getByLabelText(/program title/i), { target: { value: 'Build 9 demo' } });
      fireEvent.click(await screen.findByRole('button', { name: /\/home\/u\/projects\/ccrc-pwa/ }));
    };

    const mockDoors = (): void => {
      vi.spyOn(api, 'accounts').mockResolvedValue({
        accounts: [], projected: { wrapper: 'claude', score: 5 }, roster: [],
      });
      vi.spyOn(api, 'projects').mockResolvedValue({
        roots: [], projects: [{ name: 'ccrc-pwa', workdir: '/home/u/projects/ccrc-pwa' }],
      });
    };

    it('says NOT MEASURED while neither the frame nor the cold read has answered', async () => {
      mockDoors();
      // Never resolves: `coldState` stays `'loading'` and no `runs` frame has
      // landed — `noSignalYet` (`RunsScreen.tsx:412`), the cold-deep-link window
      // and the too-old-server window before its cold read returns.
      render(<RunsScreen store={makeStore()} loadRuns={() => new Promise<{ runs: RunSummary[] }>(() => {})} />);

      await openAndPick();

      expect(await screen.findByText(/has not answered yet/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^start build9-demo/i })).toBeNull();
    });

    it('names a project whose ACTIVE run only the COLD read found — the no-frame fallback path', async () => {
      mockDoors();
      render(<RunsScreen store={makeStore()} loadRuns={async () => ({ runs: [r({ state: 'working' })] })} />);

      await openAndPick();

      expect(await screen.findByText(/already has a run open/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^start build9-demo/i })).toBeNull();
    });

    it('does NOT name a project whose only run is CLOSED — the list is `active`, already filtered', async () => {
      mockDoors();
      render(<RunsScreen store={makeStore()} loadRuns={async () => ({ runs: [r({ state: 'done' })] })} />);

      await openAndPick();

      expect(await screen.findByRole('button', { name: /^start build9-demo/i })).toBeInTheDocument();
      expect(screen.queryByText(/already has a run open/i)).toBeNull();
      expect(screen.queryByText(/has not answered yet/i)).toBeNull();
    });
  });
  ```

  Run `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx` and **record the first
  failing assertion verbatim.**
- [ ] **9.9 — Add the prop, and pay for it at every call site.** In `StartProgramSheetProps`
  (`:219-235`), after `open`/`onClose` and before the injectables:

  ```ts
    /** The projects that already carry a NON-CLOSED run, measured by the run
     *  board from its own combined live+cold `active` list
     *  (`screens/RunsScreen.tsx:370`) and handed down. THE SHEET DOES NOT FETCH
     *  IT: `start-program.test.tsx:531` pins this composition at exactly two
     *  network calls, so a third fetch here reds a suite rather than merely
     *  costing a request.
     *
     *  `null` is NOT MEASURED, and it is a third state on purpose — the board has
     *  neither a `runs` frame nor a finished cold read (`noSignalYet`,
     *  `RunsScreen.tsx:412`): a deep link straight to `/runs`, or a server too old
     *  to send the frame at all, in the window before `api.runs(true)` answers
     *  (`RunsScreen.tsx:357-359`). Both of those paths END in a measured set;
     *  `null` is the window, not the outcome, and in it this sheet refuses rather
     *  than guesses.
     *
     *  REQUIRED, not defaulted. `new Set()` as a default would be a fold-to-permit
     *  written into the type; `null` as a default would silently refuse every
     *  caller that forgot. A compile error is the same discipline
     *  `reviveFleetSession` uses for a new wire field — every path computes it. */
    openRunProjects: ReadonlySet<string> | null;
  ```

  Destructure `openRunProjects,` in the component signature (`:237-244`), then pay the 46 call sites:
  * `cd pwa && sed -i 's|<StartProgramSheet |<StartProgramSheet openRunProjects={NO_OPEN_RUNS} |g' test/start-program.test.tsx` — 44 sites.
  * `pwa/test/start-program.test.tsx:102`'s `OpenHarness` is the newline form the sed misses: hand-edit
    it, and add `openRunProjects: ReadonlySet<string>;` to that harness's own props if you choose to
    thread it; passing `NO_OPEN_RUNS` directly is simpler and is what every one of its cases wants.
  * `pwa/test/tap-targets.test.tsx:424` — one site, `openRunProjects={new Set<string>()}` inline (that
    file has no fixture module and needs none for one use).
  * `pwa/src/screens/RunsScreen.tsx` — the real wiring, immediately after `noSignalYet` (`:412`):

  ```ts
    // The board's own answer to "does this project already have a program
    // running?", handed to the sheet rather than fetched by it — the sheet's
    // composition is pinned at exactly two network calls
    // (`start-program.test.tsx:531`).
    //
    // THREE-STATE, and `noSignalYet` is the third. Before either signal has
    // answered, `new Set()` would tell the sheet this board had measured an empty
    // world; `null` says it has measured nothing, which is what is true. Both of
    // the paths that reach it (a cold deep link, a server too old to send the
    // frame — the two this file names at `:357-359`) resolve to a measured set the
    // moment `api.runs(true)` returns, so this is a window and not a dead end.
    //
    // Built from `active`, which is already `!isRunClosed`-filtered: a project
    // whose only run is `done` is not carrying a coordinator any more.
    const openRunProjects: ReadonlySet<string> | null =
      noSignalYet ? null : new Set(active.map((r) => r.project));
  ```

  and at `:553`:

  ```tsx
        <StartProgramSheet open={startOpen} onClose={() => setStartOpen(false)} fleet={store}
          openRunProjects={openRunProjects} />
  ```
- [ ] **9.10 — Add the render arm,** between the D-292 `</p>` (`:723`) and `) : projected === null ? (`
  (`:724`). Compute the verdict beside `isOwnAttempt` (after `:502`) first:

  ```ts
    // Computed from `project` ALONE, and deliberately NOT written into
    // `existing`'s expression above. That one carries a `projected != null`
    // conjunct, which is harmless for D-292 only because the D-284 arm renders
    // directly beneath it — a run-based refusal riding the same conjunct would be
    // silently replaced by "Nothing is placeable" on exactly the fleet where
    // nothing is placeable: a state that has nothing to do with whether this
    // project already has a coordinator, and one the operator fixes by enabling an
    // account and walking straight into the collision. Two independent facts, two
    // independent measurements.
    const runVerdict: OpenRunVerdict | null =
      project === null ? null : openRunVerdict(openRunProjects, project.name);
  ```

  ```tsx
          ) : runVerdict === 'open-run' || runVerdict === 'unmeasured' ? (
            // The run-board arm: BELOW D-292, ABOVE D-284, and the order is the
            // argument rather than an accident of where it was pasted.
            //
            // Below D-292 because when both are true both sentences are true, and
            // that one names a SESSION the operator can open right now; this one
            // names only a project, because a set of project names is all it was
            // given. The more actionable sentence wins the single slot.
            //
            // Above D-284 because "this project already has a run" holds whether
            // or not anything is placeable, while "nothing is placeable" is fixed
            // by enabling an account — which would then walk the operator into
            // this collision with the refusal never shown.
            //
            // NO CONFIRM BUTTON — the D-292 posture, not a disabled control and
            // not a warning beside a live Start: there is nothing to render here
            // that could open a second run. The five-term `disabled` below is left
            // alone deliberately; a sixth term there would be dead code, since
            // this arm means the button was never rendered.
            //
            // KNOWN NARROWER THAN THE HARM, and the copy is written to that limit.
            // `resolveCoordinator(null)` needs exactly one program in
            // `state='active'` BOX-WIDE (`server/src/coord/store.ts:1185-1187`),
            // so a second program in a DIFFERENT project wedges run-less
            // coordinator mail just as hard and this arm cannot see it; and
            // `POST /api/runs` applies no project predicate at all
            // (`server/src/coord/routes.ts:889-897`), so nothing behind this
            // catches what it misses. The sentence claims a consequence of THIS
            // start and never that the fleet is otherwise clean.
            //
            // The `unmeasured` sentence does not say a run exists. It says the
            // board has not answered, which is the only fact held, and it is a
            // WAIT — the cold read resolves it within one round trip and this
            // recomputes on the next render.
            <p className="program-start-refuse">
              {runVerdict === 'open-run'
                ? `${project.name} already has a run open — open it from the run board, or pick `
                  + 'another project. A second program here leaves the project with two coordinators, '
                  + 'and coordinator mail that carries no run id then has more than one active '
                  + 'program to choose from, which the server refuses rather than guesses.'
                : 'The run board has not answered yet, so this sheet cannot tell whether '
                  + `${project.name} already has a program running. It will know in a moment — or `
                  + 'open the run board and look.'}
            </p>
  ```

  Then extend `start()`'s comment at `:507` — **the line itself does not change, and no second return
  is added**:

  ```ts
      if (existing !== null) return; // defensive: the confirm button is not rendered in this case at all
      // …and the run-board arm above it in the same `? :` chain withholds the
      // button on the same terms, so `runVerdict` needs no return of its own here.
      // Deliberate: React dispatches the handler attached by the render that
      // decided to draw the control, so no tap can carry a stale verdict — and a
      // guard no test can reach is exactly what `startedSessionFor`'s own
      // docstring (`:176-185`) refuses to ship. If a later change ever demotes
      // either refusal to a `disabled` term, BOTH need a return here.
  ```

  Run `cd pwa && ./node_modules/.bin/vitest run test/start-program.test.tsx test/runs-screen.test.tsx`
  — all nine new cases green, nothing else moved.
- [ ] **9.11 — Correct the stale CSS comment.** `pwa/src/fleet/fleet.css:2182-2187` enumerates the
  users of the `--status-dead-text` refusal register as "Three genuine refusals … D-292 …, D-284 …
  and an ordinary create failure." It is four now. Rewrite the sentence to name the fourth (a project
  the run board already shows a run in, or has not answered about yet). **No new class ships** —
  `.program-start-refuse` is already in the rule at `:2189`, already contrast-measured, and already
  covered by `fleet-css.test.ts:738`'s `.program-start-*` sweep, so there is no `contrast.test.ts`
  entry and no inert-list entry to add.
- [ ] **9.12 — Green, including the two checks `npm test` does not run.**
  * `cd pwa && ./node_modules/.bin/tsc --noEmit` — the required prop is only enforced here (`pwa`'s
    `npm test` is a bare `vitest run`; the typecheck lives in `npm run build`). A missed call site is
    a runtime `undefined.has(...)`, so this step is not optional.
  * `cd pwa && ./node_modules/.bin/vitest run test/start-program.test.tsx test/runs-screen.test.tsx
    test/tap-targets.test.tsx test/fleet-css.test.ts test/contrast.test.ts`
  * `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` — its corpus is
    `git ls-files` over the whole repo, `pwa/` included, so new source and new fixtures are scanned.
    The one absolute-home fixture used above (`/home/u/projects/ccrc-pwa`) is the path
    `start-program.test.tsx:61` already ships and the ratchet already passes on.
  All foreground, timeout ≥ 600000. Never bare `npx vitest`.
- [ ] **9.13 — Fill the mutation table.** Apply each mutation, run the named suite, paste the exact
  first failing assertion into the row, revert. Row 10 is a `tsc` error rather than an assertion —
  record the compiler's text verbatim in the same column.

  | mutation | first-fail assertion |
  |---|---|
  | `openRunVerdict`: `if (openRunProjects === null) return 'unmeasured';` → `return 'clear';` (the fold-to-permit) | `<measured at execution>` |
  | `openRunVerdict`: `openRunProjects.has(project) ? 'open-run' : 'clear'` → `'clear'` | `<measured at execution>` |
  | `openRunVerdict`: exact `.has(project)` → `[...openRunProjects].some((p) => p.startsWith(project))` | `<measured at execution>` |
  | render chain: move the run arm BELOW the `projected === null` arm | `<measured at execution>` |
  | render chain: move the run arm ABOVE the `existing !== null && !isOwnAttempt` arm | `<measured at execution>` |
  | render chain: demote the run arm from a chain arm to a `<p>` inside the final `<>` fragment, leaving the confirm button rendered | `<measured at execution>` |
  | copy: `runVerdict === 'open-run' ? A : B` → always `A` (the unmeasured arm asserts a run exists) | `<measured at execution>` |
  | `RunsScreen`: `noSignalYet ? null : new Set(active.map(...))` → `new Set(active.map(...))` unconditionally | `<measured at execution>` |
  | `RunsScreen`: build the set from `[...active, ...finished]` instead of `active` | `<measured at execution>` |
  | `RunsScreen:553`: delete `openRunProjects={openRunProjects}` — pinned by `tsc --noEmit`, not by a suite | `<measured at execution>` |
- [ ] **9.14 — Commit.**

  ```
  git add pwa/src/fleet/StartProgramSheet.tsx pwa/src/screens/RunsScreen.tsx \
          pwa/src/fleet/fleet.css pwa/test/start-program.test.tsx \
          pwa/test/runs-screen.test.tsx pwa/test/tap-targets.test.tsx \
          docs/superpowers/plans/2026-08-31-program-leverage-wave5-f5.md \
    && git commit -m "feat(pwa): refuse a start into a project the run board already shows a run in

  Third withholding arm in StartProgramSheet's refusal chain, between D-292 and
  D-284. openRunProjects is three-state: null is NOT MEASURED and refuses, never
  folds to permit. Measured from RunsScreen's own combined live+cold active list
  so the sheet still makes exactly two network calls. D-1130, D-1131, D-1130."
  ```

---

## Task 10: the corpus stops contradicting the door (operator ruling R2 — this makes the wave AGENT-FIRST)

**Files:** `ccd/coordinator-skill/references/resume.md`, `ccd/coordinator-skill/SKILL.md`,
`server/test/coordinator-skill.test.ts`. **No other file.** Ruling R2 names two `ccd/` files and this
task touches exactly those two plus the suite that pins them.

**Why it exists.** Three sentences in the coordinator corpus assert that `claimedBy` is never rewritten
by anything on the wire, and a fourth asserts a revive "is briefed by hand". All four were true when
they shipped; wave 4's kickoff route falsified the fourth and this wave's reclaim door falsifies the
other three. A corpus that lies to an unsupervised model about what recoveries exist is the exact defect
`references/resume.md` was created to prevent (wave 1, D-1000), so the correction is not optional
cleanup — it is the wave's obligation, and it is what makes the deploy AGENT-FIRST.

**Measured before writing (baseline the executor re-runs in 10.1).** The false absolute has exactly two
homes in the corpus and exactly one pin:

| fact | measurement |
|---|---|
| `nothing in the HTTP API ever rewrites` lives in exactly two corpus files | `grep -rn "ever rewrites" ccd/` → `references/resume.md:38`, `SKILL.md:31` (the other hits are `sessionws.ts:266`, `ccd/ccrc`'s config banners, and plan documents — none in a skill corpus) |
| exactly one test pins it | `server/test/coordinator-skill.test.ts:1053` — ``expect(flat(rb())).toContain('nothing in the HTTP API ever rewrites `claimedBy`')``, inside the `it` at `:1051` |
| `SKILL.md:31` is pinned by **nothing** | the SKILL.md resume pins are `:1147` (`and it is the SESSION ID, not the workspace`) and `:1153` (`the workspace framing is back`) — neither reads line 31 |
| `resume.md:81` ("A revive is briefed by hand") is pinned by nothing | the §4 pins are `:1064`/`:1065`, and both read the code block at `:83-87`, not the sentence above it |
| `wave-lifecycle.md:426`'s permanence claim survives this wave | it says "nothing in the HTTP API **reactivates a retired program**" — a different claim, still true; the reclaim door rewrites `claimedBy`, it does not un-retire a program (`openRun`'s conflict arm only ever updates `title`) |

**The four constraints, and where each is enforced.** Every replacement below is bound by all four at
once; step 10.7 measures all four.

| # | constraint | mechanism | anchor |
|---|---|---|---|
| 1 | no `/api/runs/:id/reclaim` (nor any other UNGATED member) anywhere in this text | the harvest reads `coord-pause-route.test.ts`'s `UNGATED` with `/UNGATED = new Set\(\[([^\]]*)\]\)/` and asserts `rb()` contains no member; Task 4's new corpus-wide pin extends it to `allSkillText` | `server/test/coordinator-skill.test.ts:1082-1106`; the mirror it copies, `:995-1001` |
| 2 | no HTTP METHOD in front of any `/api/...` path that is not an `EXEMPT` key | THE SWEEP harvests ``(GET|POST|PUT|PATCH|DELETE)\s+`?(/api/…)`` from BOTH skill corpora and asserts `blocked` is `[]` | `server/test/auth-passkey.test.ts:2283-2321`; `EXEMPT` is `server/src/auth/gate.ts:169-260`, and it has no `POST /api/sessions/:id/kickoff` key and will have no reclaim key |
| 3 | none of `ws-reap`, `ws-rm`, `ws-gc` | the census counts each verb across `allSkillText` and requires the count to equal `CONTRACT[2]`'s (one each) | `server/test/coordinator-skill.test.ts:124-131` |
| 4 | the reworded sentence is still TRUE | a coordinator genuinely cannot lift its own wedge: the door is UNGATED (`coord-pause-route.test.ts:172`'s `UNGATED`, growing to four this wave) precisely so it is the **operator's**, and gating it behind the box token the coordinator holds would leave the wedge no door (D-282) | `server/src/auth/gate.ts:144-166` — the NOT-EXEMPT note: gating them there "strengthens D-282 rather than reversing it" |

Constraint 2 has a measured baseline that must not move: the two corpora name **20** method+path pairs
today (18 after the SWEEP's `<deliveryId>` → `:id` normalisation), and every one is an `EXEMPT` key.
**This task adds zero new pairs.**

- [ ] **10.1 — Re-measure the baseline before touching anything.** Four commands, from the repo root;
  record each output in the execution record, because every later step's "unchanged" claim rests on
  them:

  ```bash
  cd "$(git rev-parse --show-toplevel)"
  # (1) no UNGATED door named in either corpus — expect NO output, exit 1
  grep -rn "/api/runs/:id/reclaim\|/api/coord/pause\|/api/runs/:id/abandon\|/api/claims/:id/break" \
    ccd/coordinator-skill ccd/worker-skill; echo "exit=$?"
  # (2) every METHOD+path either corpus names — expect exactly 20 lines
  grep -rhoE '(GET|POST|PUT|PATCH|DELETE)[[:space:]]+`?/api/[A-Za-z0-9/:_<>-]+' \
    ccd/coordinator-skill ccd/worker-skill | tr -d '`' | sed 's/[[:space:]]\+/ /' | sort -u | wc -l
  # (3) the destructive-verb census by hand — expect `ws-reap 1`, `ws-rm 1`, `ws-gc 1`
  for v in ws-reap ws-rm ws-gc; do printf '%s %s\n' "$v" \
    "$(cat ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/*.md | grep -o "$v" | wc -l)"; done
  # (4) the false absolute's two homes — expect resume.md:38 and SKILL.md:31, nothing else under ccd/
  grep -rn "ever rewrites" ccd/coordinator-skill
  ```

  Run (2) and (3) again unchanged at 10.7. A count that moved is the defect; a count that held is the
  proof the four constraints survived a prose rewrite, which is the only kind of proof this task can
  offer for text nobody executes.

- [ ] **10.2 — Write all five pins first, and measure them RED.** Three go into the wave-1 runbook
  describe (`server/test/coordinator-skill.test.ts:1013-1108`), one replaces the expected literal at
  `:1053`, one goes into the SKILL.md describe (`:1123-1168`).

  **(a) The moved literal.** Replace `:1051-1054` entirely — the `it` TITLE moves too, because
  "permanently" is the word this wave falsifies:

  ```ts
  it('says why a revive under a different id wedges the program until an OPERATOR moves it', () => {
    expect(rb()).toContain('claimed-by-another');
    // MOVED, not softened (D-1124). The old literal — `nothing in the HTTP API
    // ever rewrites claimedBy` — was true the day this runbook shipped and is
    // false the moment this wave's operator door exists. The replacement is
    // scoped to what a COORDINATOR can reach, which is the only scope this
    // runbook was ever entitled to speak in: the door is real, it is the
    // operator's, and this corpus never names it. That last clause is what
    // makes the sentence self-maintaining — the UNGATED harvest below and the
    // corpus-wide forbid Task 4 adds are what keep "named in this corpus"
    // true, so the prose cannot rot into a lie without a suite going red first.
    expect(flat(rb())).toContain('no call named in this corpus ever rewrites `claimedBy`');
  });
  ```

  **(b) The corpus-wide negative** — inserted directly after (a):

  ```ts
  it('carries no copy of the pre-reclaim absolute, in EITHER corpus file', () => {
    // `allSkillText`, deliberately, not `rb()`: the same claim stood in TWO
    // places (resume.md:38 and SKILL.md:31, measured), and a per-file pin would
    // have let the survivor go on teaching a coordinator that the wedge has no
    // door at all — the D-1000 shape, one file at a time. Truncated before
    // `claimedBy` so it catches a re-added absolute in any wording that reaches
    // for "the HTTP API"; the positives in (a) and in the SKILL.md describe are
    // what stop a DELETION passing for a fix, which a negative alone cannot.
    expect(allSkillText, 'the pre-reclaim absolute is back — "nothing in the HTTP API ever ' +
      'rewrites `claimedBy`" is false once the operator door exists')
      .not.toContain('nothing in the HTTP API ever rewrites');
  });
  ```

  **(c) The §6 split** — the reclaim door answers exactly ONE of §6's two cases:

  ```ts
  it('splits the terminal recovery in two — the id that can be handed over, and the row that cannot', () => {
    // A program whose id can no longer be revived now has an operator door. A
    // program RE-OPENED under a second id does not: that is a second run row,
    // a second ledger the board renders, and rewriting `claimedBy` does not
    // merge rows. Folding the two would send a coordinator to report a fix that
    // does not exist for its actual case — which is worse than the old absolute,
    // not better, because it fails at the moment of a real wedge.
    expect(flat(rb())).toContain('a second run row is a second ledger, and no reassignment merges them');
    expect(flat(rb())).toContain('naming the run and the id it claims');
  });
  ```

  **(d) The §4 console pin:**

  ```ts
  it('says the console sends the wave-N text, and names that door WITHOUT a method too', () => {
    // Wave 4 shipped the kickoff route and this wave widened it with
    // `runId`/`wave`, so "A revive is briefed by hand" was false in this file
    // one wave before anyone could act on it (D-1126). The path is spelled bare
    // for exactly the reason `/api/sessions/:id/ensure` is, four sections up:
    // it is the browser's own cookie-bearing call, it is not an `EXEMPT` key,
    // and a method in front of it reds `auth-passkey.test.ts`'s THE SWEEP. The
    // negative that enforces that is `spells the revive route WITHOUT a method`
    // above — its regex is `/api/sessions`-wide, so it already covers this new
    // path for free. THIS positive is what stops the mention being deleted to
    // satisfy it, and the `programResumeKickoff` mention is what makes the
    // template below checkable against its one source instead of trusted.
    expect(rb()).toContain('/api/sessions/:id/kickoff');
    expect(flat(rb())).toContain('the console sends exactly this text');
    expect(flat(rb())).toContain('`programResumeKickoff`');
  });
  ```

  **(e) The SKILL.md half** — appended to the describe at `:1123`, beside `states the resume constraint
  as the SESSION ID` (`:1146`):

  ```ts
  it('states the wedge as a stop for THIS session, not as a door that does not exist', () => {
    // The SKILL.md half of the same correction, and the one the corpus-wide
    // negative alone would leave unbacked. `flat()` for the reason every
    // sibling in this describe uses it: SKILL.md hard-wraps mid-sentence, so a
    // raw `toContain` on a sentence this long can only match by accident
    // (review round 1, M1 — a negative its own mutation can evade is not a guard).
    expect(flat(skill)).toContain('no call named in this corpus ever rewrites `claimedBy`');
    expect(flat(skill)).toContain('Handing the program to a different session is an operator act');
  });
  ```

  Run it and **record all five first-failing assertions verbatim** — five separate `it`s, so vitest
  reports five, not one:

  ```
  cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
  ```

  Expected shape of the reds, to be replaced by the measured text: (a) and (e) fail on the missing new
  sentence, (b) fails on the still-present old one, (c) and (d) on prose that does not exist yet.

- [ ] **10.3 — Rewrite `resume.md` §2.** BEFORE, `:36-39` verbatim:

  ```
  `POST /api/runs` refuses any later call for a program whose `claimedBy` differs from whichever session
  first opened it — `claimed-by-another`, contract clause 8, decided in `CoordStore.openRun`. The refusal
  is PERMANENT: it does not lapse when the named session dies, and nothing in the HTTP API ever rewrites
  `claimedBy`. A fresh coordinator under a new id can never take the program over through the API at all.
  ```

  AFTER — the full replacement (the surrounding `## 2.` heading at `:34` and the "Everything else keeps
  working" paragraph at `:41-43` are untouched):

  ```
  `POST /api/runs` refuses any later call for a program whose `claimedBy` differs from whichever session
  first opened it — `claimed-by-another`, contract clause 8, decided in `CoordStore.openRun`. The refusal
  does not lapse when the named session dies, and no call named in this corpus ever rewrites `claimedBy`:
  a fresh coordinator under a new id cannot take the program over by any move of its own. Handing the
  program to a different session is an operator act, performed from the console, and it sits outside this
  session's reach for the reason clause 4's pause marker does — a wedge's release valve behind the wedged
  session's own key is not a release valve. So the refusal is still a STOP for you: report it, and say
  which run is wedged and which id it names.
  ```

  Four constraints, checked against this block: **(1)** no path string at all; **(2)** one method+path,
  `POST /api/runs`, which is an `EXEMPT` key (`gate.ts:180-181`); **(3)** no destructive verb; **(4)**
  true — the coordinator's credential opens runs and does not reassign them, and the door that does is
  ungated *for* the operator by D-282's own argument. Re-run `test/coordinator-skill.test.ts`; (a) and
  (b) go green, (c)–(e) stay red.

- [ ] **10.4 — Rewrite `SKILL.md`.** BEFORE, `:27-35` verbatim:

  ```
  re-creation that recomputes one from an account and a project. Revived under a
  different id (the operator's own placement rule may pick any least-loaded
  home), every `POST /api/runs` call for this program then answers
  `claimed-by-another` naming a session that may no longer even exist —
  permanently, since nothing in the HTTP API ever rewrites `claimedBy`. That is
  a recovery on the box, not something this session can fix by retrying.
  `references/resume.md` is the runbook for all of it: how to measure which run
  is open, the two id-preserving revives, the wave-N re-kickoff text, and what is
  left when the id is already lost.
  ```

  AFTER — full replacement, same 72-column wrap as the rest of the file:

  ```
  re-creation that recomputes one from an account and a project. Revived under a
  different id (the operator's own placement rule may pick any least-loaded
  home), every `POST /api/runs` call for this program then answers
  `claimed-by-another` naming a session that may no longer even exist, and no
  call named in this corpus ever rewrites `claimedBy`, so it does not lapse on
  its own. Handing the program to a different session is an operator act, from
  the console — outside this session's reach for the reason clause 4's pause
  marker is. From in here it is a stop and a report, never a retry.
  `references/resume.md` is the runbook for all of it: how to measure which run
  is open, the two id-preserving revives, the wave-N re-kickoff text and where
  the console sends it from, and what is left when the id is already lost.
  ```

  The last sentence gains "and where the console sends it from" because §4 now documents that; the
  pointer sentence is the file's index of the runbook and an index that omits a section is a lie of
  omission. `:1165`'s pin (``expect(skill).toContain('`references/resume.md`')``) is unaffected — the
  backticked path is byte-identical. Re-run; (e) goes green.

- [ ] **10.5 — Rewrite `resume.md` §6.** BEFORE, `:109-113` verbatim:

  ```
  If the program was re-opened under a different id, or the original id can no longer be revived, no
  sequence of API calls fixes it: every `POST /api/runs` for that program answers `claimed-by-another`,
  naming a session that may no longer exist. Stop and report it to the operator. This is a recovery on the
  box, not a retry, and a coordinator that keeps retrying is spending turns on a refusal that is working
  exactly as designed.
  ```

  AFTER — two paragraphs where there was one, because the door answers one case and not the other:

  ```
  If the original id can no longer be revived, this session is not the one that fixes it: every
  `POST /api/runs` for that program answers `claimed-by-another`, naming a session that may no longer
  exist, and retrying spends turns on a refusal that is working exactly as designed. Stop and report,
  naming the run and the id it claims. That report IS the act — the operator has a console door that
  hands the program to a living session, and the report is how it gets reached.

  If the program was ALSO re-opened under a different id, that half is a recovery on the box rather than
  a call: a second run row is a second ledger, and no reassignment merges them.
  ```

  The paragraph that follows at today's `:115` opens "Two things make that recovery ordinary rather than
  frightening" — it now attaches to the second paragraph's box recovery, which is exactly what
  snapshot-then-`reconstruct` is for. Constraint check: `POST /api/runs` again (EXEMPT), no path
  literal, no destructive verb, and both halves are true. Re-run; (c) goes green.

- [ ] **10.6 — Rewrite `resume.md` §4's lead-in.** BEFORE, `:80-81` verbatim:

  ```
  The machine kickoff the PWA writes when a program is STARTED hardcodes wave 1 — correct exactly once,
  and wrong for every revive after it. A revive is briefed by hand, and this is the text:
  ```

  AFTER — the heading at `:78` and the indented template at `:83-87` are **untouched** (`:1064`/`:1065`
  pin `open the run for wave <N>` and `do not open wave 1 again` inside it):

  ```
  The machine kickoff the PWA writes when a program is STARTED hardcodes wave 1 — correct exactly once,
  and wrong for every revive after it. A revive gets the wave-N text below instead, and the console sends
  exactly this text: the resume control on a run whose coordinator reads dead composes it from that run's
  own id and wave, out of `programResumeKickoff` in `shared/api.ts` — one source, so this file and that
  control cannot drift — and queues it as mail rather than typing it into a pane
  (`/api/sessions/:id/kickoff`, spelled without a method for the same reason `/api/sessions/:id/ensure`
  is above: the browser's own cookie-bearing call, not one a fleet-host session can make). Hand-typing it
  at a terminal is still the fallback. Either way, this is the text:
  ```

  **The bare path is the load-bearing detail.** `POST /api/sessions/:id/kickoff` is not an `EXEMPT` key
  (`gate.ts:169-260` has no such entry, measured), so a method in front of it would red THE SWEEP
  *and* teach a fleet-host session a call it cannot make cookieless — the identical argument `:1040-1047`
  already records for `ensure`, and its regex ``/(GET|POST|PUT|PATCH|DELETE)\s+`?\/api\/sessions/``
  covers this second path with no edit. Re-run; (d) goes green, and the whole file is green.

- [ ] **10.7 — Prove the four constraints, by measurement not by reading.** Re-run 10.1's commands (2)
  and (3): **20 method+path pairs, unchanged**, and **1/1/1** on the census. Re-run (1): still no
  output, exit 1. Then the three suites that own the constraints, foreground, timeout 600000:

  ```
  cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/auth-passkey.test.ts \
    test/coord-pause-route.test.ts test/worker-skill.test.ts
  ```

  `worker-skill.test.ts` is in the list because THE SWEEP reads both corpora and a green coordinator
  suite says nothing about the other half of its input. If `coord-pause-route.test.ts` is already
  showing four `UNGATED` members from this wave's scanner task, the harvest at `:1082-1106` is now
  checking `/api/runs/:id/reclaim` against `resume.md` for real — note in the record which shape it ran
  against, because a three-member harvest is a weaker pass than a four-member one.

- [ ] **10.8 — The mutation table.** Rows 1–5 pin the guards this task adds; rows 6–8 re-measure the
  three constraint mechanisms against the NEW prose, which is the only way to show this task's own text
  is held by them rather than merely coexisting with them. Apply each mutation, run
  `test/coordinator-skill.test.ts` (rows 6–7 also `test/auth-passkey.test.ts`), record the exact first
  failing assertion, revert by editing.

  | mutation | first-fail assertion |
  |---|---|
  | `resume.md` §2 reverted to ``nothing in the HTTP API ever rewrites `claimedBy` `` | `<measured at execution>` |
  | the corpus-wide negative (b) deleted, and the old sentence restored in `SKILL.md` **only** | `<measured at execution>` |
  | `SKILL.md`'s `Handing the program to a different session is an operator act` deleted, rest kept | `<measured at execution>` |
  | `resume.md` §6's second paragraph deleted (the two cases folded back into one) | `<measured at execution>` |
  | `resume.md` §4's `the console sends exactly this text` softened to `the console can send it` | `<measured at execution>` |
  | `resume.md` §4 given a method: ``POST `/api/sessions/:id/kickoff` `` | `<measured at execution>` |
  | `/api/sessions/:id/kickoff` deleted from `resume.md` §4, leaving the sentence otherwise intact | `<measured at execution>` |
  | `/api/runs/:id/reclaim` written into `resume.md` §2 in place of "a console door" | `<measured at execution>` |

  Row 2 is the one that matters most and the one a per-file pin would have missed: it reproduces the
  exact half-fix — one file corrected, one file still lying — that this task exists to make impossible.
  Row 8 is a **conditional** red: it fires off the UNGATED harvest only once this wave's fourth member
  is in `coord-pause-route.test.ts:172`. If that task has not landed when you run it, record it as
  GREEN-and-expected and re-measure it in the whole-branch pass; a green here before Task 4 is the
  dependency being visible, not the guard failing.

- [ ] **10.9 — Commit.**

  ```
  git add ccd/coordinator-skill/references/resume.md ccd/coordinator-skill/SKILL.md \
    server/test/coordinator-skill.test.ts && \
  git commit -m "docs(wave5): the coordinator corpus stops promising a door that now exists (R2, D-1124/D-1126)"
  ```

  Deviations this task defines, for the plan's `## Deviations found`:
  **D-1124** — the corpus asserted ``nothing in the HTTP API ever rewrites `claimedBy` `` in two files
  (`resume.md:38`, `SKILL.md:31`) and one pin covered one of them; corrected in both, and the pin
  replaced with a corpus-wide negative so the next such claim cannot survive in the unpinned copy.
  **D-1126** — `resume.md:81`'s "A revive is briefed by hand" was falsified by wave 4's kickoff route,
  one wave before this wave widened it; found by this wave's rewrite rather than by wave 4's own close,
  which is the deviation.

- [ ] **10.10 — Record the deploy consequence, for the coordinator to act on at close.** Nothing in this
  task deploys — AGENT-FIRST ordering is the coordinator's act at wave close, exactly as wave 1's plan
  set it (`docs/superpowers/plans/2026-08-28-program-leverage-wave1-f1.md:1072-1075`). What changes is
  the ordering the whole wave now inherits, and it must be written into the handoff and the PR body:

  - **This wave is AGENT-FIRST.** It touches `ccd/coordinator-skill/`, which `deploy/deploy.sh`'s agent
    lane rsyncs to `~/.cc-sessions/coordinator-skill/` and then installs
    (`deploy/deploy.sh:699-702`). The fleet host ships **before** the server:
    `bash deploy/deploy.sh agent <host>` first, then `bash deploy/deploy.sh`, then the `/health` sha
    gate. Coordinates come from `~/.ccrc/deploy.env`; the agent lane never falls back to `CCRC_BOX`.
  - **The order is not cosmetic here.** The server half of this wave publishes a door that reassigns
    `claimedBy`. Shipping the server first leaves a fleet whose coordinators are still reading a corpus
    that tells them no such door can exist — the precise inversion this ruling was issued to prevent.
  - **The ledger's carried constraint moves.** `docs/superpowers/programs/program-leverage.md` (on
    `origin/ws/brisk-meadow`) line 299 reads "Waves 1 and 8 are **AGENT-FIRST** deploys (they touch
    `ccd/coordinator-skill/` and the agent's IO half respectively)." At close it must read **waves 1, 5
    and 8**, with wave 5's reason named: the coordinator corpus is corrected in the same wave as the
    door it describes (ruling R2). Update the Waves-table row for wave 5 with "AGENT-FIRST deploy" in
    the same breath, so the two statements cannot drift apart.
  - **The skill reaches live sessions lazily.** The installer runs at deploy, but a session already
    mid-turn keeps the corpus it loaded. Say so in the PR body rather than restarting units to force it
    — nothing in this tree is licensed to touch `claude-session@*` outside `ccrc update`'s guarded sweep.
---

## Task 11: whole-branch verification and the handoff

**Files:** none new — this task measures and reports.

- [ ] **11.1 — Full suites, FOREGROUND, `timeout >= 600000`, cd'd in.** `cd server && npm run test`;
  `cd agent && npm run test`; `cd pwa && npm run test`. Record the three totals (files / passed /
  skipped) and **read the tails** — do not grep them; that correction is wave 4's own. A green single
  suite is not a green branch (wave 3's D-1032: `as const` in the wrong place typechecks under vitest
  and not under tsc), and the server suite's `typecheck-tests.test.ts` is the arbiter. It needs all
  three packages' `node_modules` installed — a `server`-only `npm ci` leaves it reporting two failures
  that are missing-module resolution, not type errors.
- [ ] **11.2 — Re-run the known load flakes IN ISOLATION** before calling anything a break:
  `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`. `ccd-session-state`
  measured 0/6 on an idle box, so a single green isolated run is explicitly **not** proof the red was
  load — say which it was, or say you could not tell.
- [ ] **11.3 — Assemble the mutation table** in the execution record: every guard this wave adds, the
  mutation applied, and the **exact first failing assertion text**. A row that fell short of that bar is
  recorded as falling short, never rounded up. **Count the table twice** and state both counts — wave 3
  miscounted by one, wave 4's record repeated the lesson, and wave 4's own review found a third
  supersession arm the two write-pins could not see, so also state explicitly whether any guard shipped
  with no row.
- [ ] **11.4 — Re-read the four scanner numbers against the tree, not against this plan.**
  `cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts test/coord-pause-route.test.ts
  test/coordinator-skill.test.ts test/mail-routes.test.ts test/single-definition.test.ts
  test/deviation-refs.test.ts test/topology-clean.test.ts test/dtbd.test.ts` — the eight suites this
  wave's edits can red for reasons unrelated to its behaviour.
- [ ] **11.5 — Self-review against this plan's Global Constraints**, one line per constraint, saying
  how it was met or why it did not apply. Include explicitly: `FLEET_PROTO` not bumped; `EXEC_COMMANDS`
  untouched; no `ccrc-api` row added; no absolute home path or real box name in any byte; every `D-`
  number cited is defined in `## Deviations found`; the door's docstring spells `requireMailToken` in
  backticks with no open paren.
- [ ] **11.6 — Confirm the branch.** `git branch --show-current` must read `ws/quiet-meadow`. Clause 2
  is the one that decides whether this wave can close at all: work on any other branch leaves the
  workspace tip unmoved and wedges every close `stale-tip` for ever.
- [ ] **11.7 — Push and open the PR** from `ws/quiet-meadow`. Wait for CI. **Do not deploy** — the
  deploy is the coordinator's act at wave close. Say in the PR body that this wave is **AGENT-FIRST**
  (operator ruling R2, D-1124): the fleet host ships before the server, because
  `ccd/coordinator-skill/` is in the diff.
- [ ] **11.8 — Measure the fingerprint ONCE, after the last push**, and mail `wave-done` to
  `toId:'coordinator'` naming **`runId 18`**: `branchTip` = `handoffCommit` = `git rev-parse HEAD`,
  `prNumber`, and `prPhase` from the eight enum words — read it, never invent it. Then **stop pushing**:
  a lint fix or a merge commit after the mail moves the tip away from the sha claimed and the
  coordinator gets `stale-tip` for a wave that was genuinely finished.
- [ ] **11.9 — Say what the coordinator must act on**, in that same mail: the AGENT-FIRST deploy lane;
  that the ledger's "Waves 1 and 8 are AGENT-FIRST" carried constraint is now waves 1, 5 and 8; the
  fold left closed (D-1132) and why; and every place this wave's record disagrees with the brief
  (D-1123, D-1126, D-1130) so the ledger gets it rather than the next wave rediscovering it.
- [ ] **11.10 — Release the claim** (`POST /api/claims/14/release`) or let the run's close do it; say
  which in the wave-done mail.

---

## Deviations found

This wave's block is `D-1123..1140`, allocated from `POST /api/ledger/deviations` at planning time
(the program block `D-999..1046` is exhausted and `D-1119..D-1122` are consumed). Every number cited
anywhere in this plan or in the diff is defined below.

### D-1123 (spec defect, measured before planning — MAJOR) — the non-terminal rewrite does not lift the wedge

Spec §7.1 and the brief scope the rewrite to the program's non-terminal runs. Both readers that decide
who owns a program — `openRun`'s one-coordinator guard (`server/src/coord/store.ts:369-371`) and
`resolveCoordinator(null)` (`store.ts:1188-1191`) — run the identical
`SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id LIMIT 1`, with no
state predicate and lowest-id-first, and `resolveCoordinator`'s own docstring says the mirroring is
deliberate. At any wave past the first, the wave-1 run is `done` and holds the lowest id, so the
scoped rewrite leaves both readers naming the dead session: the door answers `ok`, the board looks
right, and `POST /api/runs` for the next wave still refuses `claimed-by-another` naming a corpse.
Put to the operator with the two queries; **ruling R1: rewrite every run of the program, terminal rows
included, with one `run_events` attribution row each.** Rows already NULL stay NULL. The alternative —
a state predicate on the two readers — was measured worse: it makes `resolveCoordinator(null)` answer
`null` in the close-then-open window the ledger's own ordering rule exists to protect.

### D-1124 (shipped corpus contradicts the wave — scope change) — and it is pinned, so nothing reds

`ccd/coordinator-skill/references/resume.md:38-39` and `:110`, and `ccd/coordinator-skill/SKILL.md:31`,
assert that nothing in the HTTP API ever rewrites `claimedBy` and that no sequence of API calls fixes a
lost claimant. This door falsifies all three. `server/test/coordinator-skill.test.ts:1053` pins the
first VERBATIM — and because the pin asserts a PRESENCE, the suite stays green while the runbook
misleads every revived coordinator, which is the same class as wave 4's D-1122 (an absence assertion
that measures nothing) seen from the other side. Put to the operator against the brief's "no ccd/,
no skill corpus" scope; **ruling R2: correct the corpus here, and the wave becomes AGENT-FIRST.** The
rewording may not name the route: `coordinator-skill.test.ts:1082-1106` harvests the `UNGATED` set out
of `coord-pause-route.test.ts` and forbids `resume.md` from naming any member, this wave's own new pin
forbids it corpus-wide, and `auth-passkey.test.ts`'s sweep forbids a method-spelled `/api/...` path
that is not gate-EXEMPT.

### D-1125 (L0 docstring asserting the opposite of the shipped wire) — `RunSummary.claimedBy`

`shared/api.ts:3612-3634` states the field is "fixed at `POST /api/runs` and rewritten by no route
afterwards", that this immutability "is the mechanism behind the `claimed-by-another` refusal", that a
second coordinator is "refused FOREVER, because nothing lowers this flag", and that recovery means
"never reassigning the run". The same sentence is restated at `pwa/src/fleet/nestFleet.ts:4-7`. All of
it is false after this wave, and it is the docstring four scanners and every reader trust. Rewritten in
the same commit as the route, saying what still holds — a second coordinator is still refused **at open
time**, and the nesting edge is unchanged — and what no longer does.

### D-1126 (the brief's reuse is not a reuse) — `queueProgramKickoff` cannot brief a wave-N revive

The brief says the re-kickoff should "REUSE wave 4's mail-lane kickoff — `queueProgramKickoff` is
importable without the route". The seam is importable and the reuse is real; the TEXT is not.
`queueProgramKickoff` composes its body internally from `programKickoff(slug, title)`
(`server/src/coord/kickoff.ts:117`), whose L0 template ends `Run the ccrc-coordinator skill and open
the run for wave 1.` (`shared/api.ts:3107`) — the exact sentence
`ccd/coordinator-skill/references/resume.md:78-93` exists to correct, because re-opening is not a
harmless no-op: the open route dedupes only a `planned` retry naming the same program, wave and
claimant, so briefing a wave-5 revive to open wave 1 writes a SECOND run row, a second ledger the board
renders, and an open-run count the program never gets back to zero. The seam gains an optional
`resume` argument and L0 gains a sibling composer; the byte cap stays where wave 4 put it and covers
the new body for free.

### D-1127 (vocabulary trap) — a new refusal code cannot join `RunRefuseCode`

`'claimant-alive'` and `'no-claimant'` are new hyphenated literals under `server/src/coord/`, which
`mail-routes.test.ts:469-497` arbitrates. The obvious home, `RunRefuseCode`, is closed to them:
`coordinator-skill.test.ts:311-321` requires **every** declared `RunRefuseCode` to appear somewhere in
the coordinator corpus, so joining that union would drag this door's vocabulary into the very corpus
the same file forbids naming the door in. `NOT_CODES` is also wrong — it is for spellings no wire
carries, and these two ride the wire to the PWA. Resolved the way the scanner's own history resolved
it three times: a **sixth typed union with its own exported guard**, admitted beside
`isLifecycleGapReason`, `isClaimRefuseCode` and `isSessionLifecycle`, whose comments already argue that
a guard accepts a member added later while an allowlist entry accepts one spelling for ever.

### D-1128 (a pin that measures half of what three files claim) — `UNGATED` in "both directions"

`server/src/coord/routes.ts:1155`, `CLAUDE.md:146` and `coordinator-skill.test.ts:1119` all say the
`UNGATED` set is held in both directions. Measured, `coord-pause-route.test.ts` asserts only (a) that
every route NOT in the set carries a token check before its first `await` (`:185-209`) and (b) that
every route in it is registered and carries an argued docstring (`:244-258`). **Nothing asserts that a
listed door actually lacks a gate**, so adding a name to `UNGATED` and also writing `requireMailToken`
into that handler passes the whole suite green — the door would be gated, the wedge would have no key,
and the operator would find out at the moment they needed it. Wave 1's M7 fix made the door LIST
non-duplicated; it did not make the claim true. This wave writes the missing direction, with a
non-vacuity guard, and measures it red against a reclaim handler mutated to call the gate.

### D-1129 (inherited false-dead) — the client cannot re-measure what the server measures

`assembleFleet` calls `Tmux.hasSession`, which collapses a tmux `unknown` into `alive = false`, and
`server/src/fleet.ts:245-252` records the consequence in as many words (D-309): "a substrate fault
reads *dead* in the PWA — a false dead, with the ungated Restart button under it … deferred BY DECISION
to the substrate-unreachable spec". A resume affordance offered on `status === 'dead'` would therefore
offer to reclaim a healthy coordinator during a tmux outage. The board answers three ways instead
(`coordPresence`), and `unknown` — a frame not yet seen, a session missing from the array, an
`unmeasurable` or absent lifecycle, a standing substrate fault — **hides the door**. The server's guard
re-measures regardless of what the client believed; the client's job is only to decide what to offer.

### D-1130 (the brief's premise, corrected) — StartProgramSheet already refuses more than one thing

The brief says the sheet "today refuses only on a live main checkout". Measured, two arms withhold the
confirm button entirely — D-292 (`existing !== null && !isOwnAttempt`) and D-284 (`projected === null`)
— beside a five-term `disabled` expression, three defensive returns in `start()`, and a non-blocking
pause warning. The render is a strict `? :` chain, so the new arm's POSITION is a real decision rather
than an append: after the D-292 arm, because a project with both a live coordinator and an open run is
better told about the coordinator; before the D-284 arm, because an unplaceable fleet should still say
so last. Computed independently of `projected` — today's `existing` is only evaluated when
`project !== null && projected != null`, so an arm written into that expression would be hidden in
exactly the state where a program is most likely to be started twice.

### D-1131 (the refusal is narrower than the harm, stated not discovered) — one project is not the boundary

The sheet's new refusal is per-project, and the invariant a second open program actually breaks is
box-wide: `resolveCoordinator(null)` answers `null` unless exactly ONE program is `active`
(`store.ts:1185-1187`), so a second program in a DIFFERENT project wedges runId-less coordinator mail
just as hard. Nothing server-side backstops it either — `openRun`'s guard is keyed on the program slug
with no project predicate, and `POST /api/runs` validates `project` as a non-empty string that is never
checked against `listProjects`, so a differently-spelled project name silently escapes the refusal. The
arm is still worth shipping (it catches the common case at the only surface that can ask the question,
since there is no `/api/programs` route for the PWA to read), but its copy must not claim to prevent
the ambiguity, and this entry is why.

### D-1132 (a known fold, inherited, deliberately left closed) — `queued:false`

Wave 4 recorded that `queueProgramKickoff`'s `queued:false` folds "this program's kickoff is already
waiting" with "a DIFFERENT program's kickoff is waiting", the dedupe key carrying no slug, and named
wave 5's re-kickoff lane as the first consumer that might need them apart. **Measured, this wave does
not consume the distinction and does not open the fold.** Both answers mean one thing to an operator at
the board — a kickoff is already waiting for that session and it has not been read — and the only way
to tell them apart is to read a mail BODY, which no store read returns (`hasOutstandingMail` answers a
boolean and `MAIL_ROW_COLUMNS`, `store.ts:274-285`, omits `m.body`). Opening it would ship a seam
nothing reads. Recorded either way, as the brief instructed. Noted with it: in the exact scenario this
wave serves, the dead coordinator's own unacked kickoff usually still holds the key, so `queued:false`
is the COMMON answer here rather than the corner — which is why the PWA renders it as its own fact
instead of as a success.

### D-1133 (a docstring arguing against its own future caller) — `api.kickoff` discarded `queued`

`pwa/src/lib/api.ts` sends the kickoff through the body-discarding `post` helper and argues in place
that reading the body "would ship a distinction nothing consumes". True when written; wave 5 is the
consumer, and `KickoffOutcome`'s own docstring named it in advance ("Wave 5 is the caller that needs
the difference"). The method returns `{queued}` now and the docstring is rewritten rather than left
standing as an argument against the shipped behaviour.

### D-1134 (a batch would stamp N moments) — `recordRunEvent` owned the clock

`recordRunEvent` calls `Date.now()` itself (`store.ts:485-492`), unlike `advanceInner`, which computes
`now` once (`store.ts:443`). One operator act writing an attribution row per run would therefore land
rows at N slightly different instants, and a trail that shows one act as N moments is a trail that
cannot be read back as one act. Given the caller's `at`, defaulted so every existing call site is
unchanged — the `markDispatched`/`markDispatchStarted` precedent, whose own docstring is "the caller
owns the moment being recorded" (`store.ts:739-742`).

### D-1135 (two answers to "terminal", and this wave picks one out loud) — `TERMINAL_RUN_STATES`

`TERMINAL_RUN_STATES` (`store.ts:29-31`) is DERIVED from `RUN_TRANSITIONS` — a state with no outgoing
edge is terminal — and yields THREE words (`done`, `failed`, `unknown`), while eight SQL predicates in
the same file hand-write `state NOT IN ('done','failed')`; only `strandedClear` uses the derived list,
and the store's own docstring calling them "the same two words" is already wrong. A row written by a
NEWER build reads back `unknown` and is non-terminal to every SQL query and terminal to the constant.
This wave sidesteps the disagreement rather than inheriting it — ruling R1 means `reclaimProgram`'s
`WHERE` clause carries **no state predicate at all** — and records the disagreement here so the next
wave that needs one knows it is choosing, not reading.

### D-1136 (an arm the ladder's shape hides) — handing a program to the session that already holds it

`to === from` is not an error and must not be one: an operator re-typing the id the board already shows
is asking for nothing, and a refusal there teaches them the door is broken. But WHERE the no-op sits in
the ladder is a real decision, not a formality. Placed at the top it would skip the destination's own
registry read, so a typo that happened to match the current claimant would answer `ok` without ever
proving the id exists. Placed at the aliveness rung it inherits both reads and still cannot refuse a
live claimant for holding its own program. That is where it sits, and the fixture pins it against a
LIVE claimant — the case a top-of-ladder placement would also pass and a bottom-of-ladder one would
wrongly refuse.

### D-1137 (a widening that breaks a caller tsc alone can see) — `queueKickoff`'s prop type

Making `api.kickoff` return `{queued}` (D-1133) is not additive at the type level:
`pwa/src/fleet/StartProgramSheet.tsx:233` declares its injectable `queueKickoff` prop as
`(id, b) => Promise<void>` and `:242` defaults it to `api.kickoff`, so the widened return is
`TS2322: Type '{ queued: boolean; }' is not assignable to type 'void'`. **vitest strips types, so every
suite stays green and only `tsc --noEmit` sees it** — wave 3's D-1032 in a new place. Found before
writing code, not after. The same task also carries a second measured trap: `pwa/test/api.test.ts`'s
source-scan pin selects the kickoff declaration with `l.includes('post(')`, which `postJson<…>(` does
not contain, so that pin reds **on correct code** until its predicate moves — and it can only measure a
single line, so the declaration must stay one line.

### D-1138 (a third state the store could not express) — the fleet frame had no `frameSeen`

The board must answer `unknown` while it has not yet heard from the fleet, and the store has
`runsFrameSeen` and `coordFrameSeen` but **no `fleetFrameSeen`**: the `fleet` frame arm sets `sessions`
with no flag, and `sessions` hydrates from the persisted offline snapshot at boot. The first draft used
`conn === 'open'` — the `FleetScreen` idiom — and named the residual honestly: between socket-open and
the first frame, a persisted last-known-good row can read `dead` and show the door. **Ruled: close the
seam rather than name the residual.** `fleetFrameSeen` is four source lines and one store pin, and the
alternative is a guess wearing the same typeface as a measurement — which is the defect class this
program has now filed three times.

### D-1139 (a refusal the client cannot read) — `claimant-alive` rides `refused`, not `error`

The door answers `{ok:false, refused:'claimant-alive', by, detail}`, following `sendCloseOutcome`'s own
`refused` shape. `ApiError`'s message extraction reads `error`, so `apiErrorText` degrades to the bare
`request failed (409)` — a sentence under a Reclaim button that tells the operator nothing about why.
Two of the door's other refusals (`unknown-run`, `unknown-session`) additionally share status 404 with
fastify's own route-not-found body. The sheet's translator is therefore status-first AND reads both
`body.error` and `body.refused`, the `AbandonSheet` shape extended by one key, and `detail` is rendered
rather than swallowed — because `detail` is the only thing that separates the two conditions folded
into `registry-unmeasurable` (an unlistable registry, and a tmux that did not answer).

### D-1140 (a doubt reported as a fact) — `gone` plus an unmeasurable lifecycle answers `alive`

`measureClaimant`'s third rung is total: a pane tmux calls `gone`, whose lifecycle is not one of the
three dead words, answers `alive`. That admits a THIRD input the arm's name does not describe — a
listed row whose `.started`/`.stopped`/`.supervised` could not be read reads `unmeasurable`, which
`lifecycleIsDead` correctly refuses to call dead, and the door then refuses `claimant-alive` for a pane
nobody measured. **The refusal is right — fail-shut is the only safe direction for a destructive
re-pointing — and only the word is wrong.** Kept rather than split into a fourth arm, because a caller
branches on it identically; `detail` carries which of the three inputs produced it, and the sheet is
required to render `detail` (D-1139) rather than the code alone. Recorded so the next reader of that
`otherwise` does not mistake its name for its contents.
