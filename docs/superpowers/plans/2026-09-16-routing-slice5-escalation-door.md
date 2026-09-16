# Routing slice 5 — escalation and demotion by failure kind through the coordinator's door, the routing trail, and the doctor's flip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coordinator that reads a failed check's kind off the wave-done signals escalates the worker one rung (effort within the class for `shallow`, class for `ceiling`, the class-aware effort-first rule for `unclear`) or demotes it one rung after clean waves — through ONE server door, `POST /api/runs/:id/route`, that computes the rung from the spec's ladders, writes the record through the routing verb with no `--apply`, and leaves a run event and a journal row saying who, what, from, to and why; the run's signals answer the arm at dispatch and every routing change since, so rungs can be measured against fix-round cost; and `ccrc doctor`'s subagent-key arm returns to FAIL the day no live session lacks a record (S1-R13).

**Architecture:** The ladders are one pure module, `shared/routing-ladder.ts` (L0): `escalate(kind, current, scope, priorSameKind, lastDemotion)` and `demote(current, field)` over `EFFORT_LADDER` and `CLASSES` (`shared/models.ts`, whose order `haiku, sonnet, opus, fable` IS ladder order — verified 2026-09-16 at 84b1dfda), with the spec's four mechanical rules (`max` only from `xhigh` after a second failed check of the same kind; a class rung resets effort to `high`; a subagent ladder ends at Opus; any failed check first reverses the last demotion) and a fixture table. The door is box-token gated like every `/api/runs*` write, runs under `coordMutex`, refuses on a closed run, on an absent record, at a ceiling or a floor, and on no `route-v1` evidence (501, never a silent drop); it reads the session's `class`/`effort`/`degraded` on demand through `deps.io.readFileMeasured` (three reads that tell absent from unreadable, no new wire field), computes or takes the target, builds `CCD_ARGV.route(sid, field, value, dec)` with `dec.reason = '<mode> <kind>: <why>'`, and records `route:<mode>:<field>:<from>-><to>:<kind|manual>` on the run. `RunSignals` gains `arm` (the routing recorded at dispatch — slice 4's dispatcher now records `arm:<k=v …>` when it seeds one) and `routing` (every `route:` event parsed). The coordinator's reference names the door and forbids `ccd route`; spec §5.3's "Coordinator decisions" paragraph is amended to match (a recorded departure). The doctor counts live sessions without a `class` field; while the count is above zero the subagent-key arm stays WARN and says the count; at zero it FAILs, and the three lanes' keys become the operator's to remove. A class chooser on the fleet screen gives `GET /api/projects?class=` its PWA caller and seeds the `+`'s route.

**Tech Stack:** TypeScript (`shared/routing-ladder.ts`, `shared/api.ts`, `server/src/coord/{routes,store,dispatch}.ts`, `server/src/ccdargv.ts`, `pwa/src/screens/FleetScreen.tsx`, `pwa/src/fleet/ProjectCard.tsx`, `pwa/src/lib/api.ts`), bash (`ccd/ccrc-api`, `ccd/ccrc-doctor-checks`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md` — §3 "Escalation", "Demotion", "Floors and ceilings", §4, §5.3 "Coordinator decisions" and "Audit trail", §6 "Arms", "Cost signals", §7 slice 5, §8 rows 4–5, §10 (2026-09-14: the coordinator may escalate and demote as it sees fit). Slices 1–4 are on this branch: the record and verb (1), the signals (2), serviceability and `degraded` (3), the writers, `ROUTE_WRITABLE_FIELDS`, `parseRouteFields`, `CCD_ARGV.route(id, field, value, dec)`, `runs signals` (4).

## Global Constraints

- **The coordinator never runs `ccd route`** (clause 1); its door is `POST /api/runs/:id/route`, box-token gated, no `--apply` ever (spec §8 row 5: the argv census and the skill test stay red on `--apply` in the coordinator form).
- **The ladders are defined once**, in `shared/routing-ladder.ts`, derived from `CLASSES` (`shared/models.ts`) and one `EFFORT_LADDER` — never a second TypeScript copy of either vocabulary (`single-definition`). ccd's own `ROUTE_EFFORT_STOPS="low medium high xhigh max"` (`ccd/ccd`, the slider typer's stop list) is the bash MIRROR of `EFFORT_LADDER`, pinned by a parity test the way `accounts.sh` mirrors the roster — never edited by hand to a different list.
- **Every refusal is a word the coordinator can act on**: `run-closed`, `no-session`, `no-record`, `registry-unreadable`, `run-unreadable`, `ceiling`, `floor`, `no-effort-rungs`, `bad-request`, `unsupported` (501 on no `route-v1` evidence), `fleetFailed` (502 with ccd's stderr) — never a silent no-op.
- **Every door call that changes a record is TWO records**: the run event (`recordRunEvent`, no-op on an unknown run — which is why the door refuses unknown runs first) and the journal `route` row the verb writes with `dec.actor`/`dec.reason`.
- **Floors are the coordinator's, not the door's**: the door refuses only the mechanical floor (nothing below `low`, nothing below `haiku`); the matrix's "implementation never below Sonnet · high" is guidance the reference states and the coordinator applies.
- **FIXTURE HOMEs only; suites from inside the package; D-numbers issued; no account names; provenance marker on every `ccd/ccd` commit (none expected this slice); AGENT-FIRST** (ccrc-api, ccrc-doctor-checks and the skill references ship to the fleet host first).

---

## File structure

| File | Responsibility |
|---|---|
| `shared/routing-ladder.ts` | `EFFORT_LADDER`, `SUBAGENT_CLASS_CEILING`, `RungTarget`, `escalate()`, `demote()` |
| `shared/api.ts` | `RouteMode`, `RoutingEvent`, `RunSignals.arm`/`routing`/`routingUnparsed`, `RunRouteBody` |
| `server/src/coord/store.ts` | `runRoutingEvents(runId)` parsed from `run_events`; `runSignals` composes `arm`/`routing` |
| `server/src/coord/routes.ts` | `POST /api/runs/:id/route` |
| `server/src/coord/dispatch.ts` | the `arm:` run event when dispatch seeds routing |
| `ccd/ccrc-api` | `[runs.route]` row (twenty-four) |
| `ccd/coordinator-skill/references/wave-lifecycle.md`, `SKILL.md` | the door, the kinds, the demotion guidance, `routing`/`arm` on the signals |
| `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md` §5.3 | "Coordinator decisions" amended to the door |
| `ccd/ccrc-doctor-checks` | `_check_routing`'s live-session census and the WARN→FAIL flip |
| `pwa/src/screens/FleetScreen.tsx`, `pwa/src/fleet/ProjectCard.tsx`, `pwa/src/lib/api.ts` | the class chooser; `workspaceAdd(project, route?)` |
| tests | `routing-ladder.test.ts` (new, shared cases), `run-route-route.test.ts` (new), `run-signals-routing.test.ts` (new), `ccrc-api.test.ts`, `ccrc-api-closed.test.ts`, `coordinator-skill.test.ts`, `coord-pause-route.test.ts` (census — the new route is box-token gated, so it needs no set entry), `box-token-census.test.ts`, `ccrc-doctor.test.ts`, pwa `fleet-class-chooser.test.tsx` (new) |

---

### Task 1: The ladders — `shared/routing-ladder.ts`

**Files:**
- Create: `shared/routing-ladder.ts`
- Test: `server/test/routing-ladder.test.ts`, `server/test/fixtures/routing-ladder.ts`

**Interfaces:**
- Consumes: `CLASSES` and `ModelClass` from `shared/models.ts` (`['haiku', 'sonnet', 'opus', 'fable'] as const` at `shared/models.ts:52` — ladder order; verified); `FAILURE_KINDS`/`FailureKind` from `shared/api.ts:4734-4735` (slice 2) — derive, never respell. `shared/api.ts` exports NO effort-level list (verified: the server does not validate effort values; ccd does, against `ROUTE_EFFORTS="auto low medium high xhigh max ultracode"` and `ROUTE_EFFORT_STOPS="low medium high xhigh max"` at `ccd/ccd:1208/1218`), so `EFFORT_LADDER` is a NEW L0 definition and the parity pin below is what keeps ccd's stop list its mirror.
- Produces:

```ts
export const EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const;   // ultracode and auto are not rungs: ultracode is xhigh + workflows, auto is absence
export type EffortRung = (typeof EFFORT_LADDER)[number];
export const SUBAGENT_CLASS_CEILING: ModelClass = 'opus';                          // §3: a subagent ladder ends at Opus
export interface RungCurrent { readonly class: ModelClass; readonly effort: EffortRung | 'auto' | 'ultracode' }
export interface Demotion { readonly field: 'class' | 'effort'; readonly from: string; readonly to: string }
export type RungTarget =
  | { kind: 'move'; mode: 'escalate' | 'reverse-demotion'; field: 'class' | 'effort'; from: string; to: string; why: string }
  | { kind: 'ceiling'; why: string }        // nothing above (fable at max; opus for a subagent at xhigh with max forbidden by the rule)
  | { kind: 'no-effort-rungs'; why: string }; // haiku takes no effort: a shallow failure on haiku is a class rung, handled inside escalate — this arm is for `ultracode`
/** §3 "Escalation": shallow → effort +1 within the class; ceiling → class +1 (effort reset to 'high'); unclear → effort-first, class-aware:
 *  on sonnet, when the next effort rung would be xhigh or max, the class rung to opus instead (2.5× per token ≈ xhigh, < max). `max` only from
 *  `xhigh` and only when priorSameKind ≥ 1 (a second failed check of the same kind). Any failed check first reverses `lastDemotion` if it is
 *  not yet reversed (mode 'reverse-demotion'); the ladder applies on the NEXT failure. haiku: an effort rung is a class rung to sonnet·high.
 *  `effort: 'auto'` counts as 'high' for the arithmetic (the model's default); 'ultracode' answers no-effort-rungs (its next rung is a class rung the caller decides). */
export function escalate(kind: FailureKind, current: RungCurrent, scope: 'main' | 'subagent', priorSameKind: number, lastDemotion: Demotion | null): RungTarget;
/** §3 "Demotion": one rung down on the named field; never below low / haiku (the mechanical floor); a class rung down resets effort to 'high'. */
export function demote(current: RungCurrent, field: 'class' | 'effort'): RungTarget | { kind: 'floor'; why: string };
```

- [ ] **Step 1: Write the failing tests** — a fixture table `server/test/fixtures/routing-ladder.ts` of `{ name, kind, current, scope, prior, lastDemotion, want }` rows covering: shallow opus·high → effort xhigh; shallow opus·xhigh with prior 0 → ceiling (max needs a second failure); shallow opus·xhigh with prior 1 → max; ceiling sonnet·high main → opus·high (field class, effort reset noted in `why`); ceiling opus·high subagent → ceiling (ends at opus); ceiling fable → ceiling; unclear opus·high → effort xhigh; unclear sonnet·high → class opus (the class-aware rule); unclear sonnet·medium → effort high; shallow haiku → class sonnet; shallow opus·auto → effort xhigh (auto counts as high); shallow opus·ultracode → no-effort-rungs; lastDemotion {effort high→medium} not reversed → reverse-demotion medium→high regardless of kind; demote opus·high effort → medium; demote sonnet·low effort → floor; demote haiku class → floor; demote opus class → sonnet (effort high). Every row asserts the whole `RungTarget` object. PLUS the parity pin in `routing-ladder.test.ts`: read `ccd/ccd`, find the single line matching `/^ROUTE_EFFORT_STOPS="([^"]*)"/`, assert its words equal `EFFORT_LADDER` in order (the bash mirror), and that the line is unique.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** — pure; imports only `./models.js` and `./api.js` (L0 rule: no `node:*`).
- [ ] **Step 4: Run to verify it passes** — plus `single-definition` and `l0-imports` (or whatever pins L0's import rule — grep `server/test` for the test that scans `shared/*.ts` imports and run it).
- [ ] **Step 5: Mutation check, measured** — drop the `priorSameKind >= 1` guard → the "max needs a second failure" row reds; drop the subagent ceiling → the subagent row reds; drop the demotion-reversal arm → that row reds; change `EFFORT_LADDER`'s order → the parity pin reds.
- [ ] **Step 6: Commit** — `feat(routing): the escalation and demotion ladders as one pure module with a fixture table and ccd's stop list pinned as its mirror (routing slice 5, Task 1)`.

---

### Task 2: `POST /api/runs/:id/route` — the coordinator's door

**Files:**
- Modify: `shared/api.ts` (`RunRouteBody`, `RouteMode`), `server/src/coord/routes.ts` (beside `POST /api/runs/:id/advance`, `routes.ts:1582`), `server/src/ccdargv.ts` (no new builder — `route(id, field, value, dec)` from slice 4 carries `dec.reason`)
- Test: `server/test/run-route-route.test.ts` (new), `server/test/coord-pause-route.test.ts` (green — the route checks the box token), `server/test/box-token-census.test.ts`

**Interfaces:**
- Consumes: Task 1; `requireMailToken(req, reply, 'POST /api/runs/:id/route')` (`routes.ts:454`), `coordMutex.run` (`:421`), `parseCanonicalPositiveSafeInteger` (`:31`), `coord.run(id): RunReadResult` (`store.ts:1966` — `{ ok: true; run: RunRow | null } | { ok: false; kind: 'run-unreadable'; detail }`; `RunRow extends RunSummary` carries `state`, `sessionId: string | null`, `claimedBy: string | null`, `kind`), `coord.runEvents(id)` (`:2120`, rows `{ at, fromState, toState, causedBy, detail }`), `coord.recordRunEvent(id, causedBy, detail)` (`:1572`), `deps.io.readFileMeasured(path)` (`io.ts:98` — `MeasuredRead`: `{ ok: true; content } | { ok: false; reason: 'absent' | 'unreadable' }`), `deps.cfg.registryDir`, `capSupported(deps.fleetState, ROUTE_CAP)` with `ROUTE_CAP = 'route-v1'` from `server/src/ccdargv.ts:564` and `ACTOR_FLAGS_CAP` gating the actor flags exactly as `routes.ts:476` does today, `sweepDec`/`deps.runCcd` as the dispatch handler uses them (`:1328-1333`), `CCD_ARGV.route`.
- Produces:

```ts
// shared/api.ts
export type RouteMode = 'escalate' | 'demote' | 'manual' | 'reverse-demotion';
export interface RunRouteBody {
  readonly target: 'worker' | 'coordinator';
  readonly why: string;                                   // 1..400 bytes, no control characters — it becomes the verb's --reason
  readonly kind?: FailureKind;                            // escalate by the ladder
  readonly demote?: 'class' | 'effort';                   // one rung down by the ladder
  readonly field?: RouteField; readonly value?: string;   // manual: the coordinator's own judgement, validated by ccd
}                                                         // exactly ONE of kind | demote | field+value
```

The handler: token → coord → id → body shape (400 `bad-request`) → `r = coord.run(id)`; `r.ok === false` → 503 `run-unreadable` with its detail; `r.run === null` → 404 `unknown-run` → `run.state` ∈ {`dispatched`,`working`,`awaiting-review`} else 409 `run-closed` → session = target worker ? `run.sessionId` : `run.claimedBy`, null/empty → 409 `no-session` → `capSupported(deps.fleetState, ROUTE_CAP)` else 501 `unsupported` → for `kind`/`demote`: read `<registryDir>/<sid>.class`, `.effort`, `.degraded` through `readFileMeasured` (trimmed; `absent` on `class` or `effort` → 409 `no-record` naming the field; `absent` on `degraded` → no degrade; `unreadable` on any → 503 `registry-unreadable` naming the file; the class SERVED is `degraded ?? class`, and the ladder runs on the served class) and the run's prior events (`priorSameKind` = count of `route:escalate:*:<kind>` details; `lastDemotion` = the last `route:demote:` detail not followed by a `route:reverse-demotion:` detail) → `escalate`/`demote` → a non-`move` answer is 409 with its word (`ceiling`/`floor`/`no-effort-rungs`) and `why` → `deps.runCcd(CCD_ARGV.route(sid, field, to, actorFlagsSupported ? { surface: 'agent', actor: `run:${id} coordinator`, reason: `${mode}${kind ? ' ' + kind : ''}: ${why}` } : null))` → ccd refusal → 502 `fleetFailed` with stderr, NO run event → `coord.recordRunEvent(id, 'coordinator', `route:${mode}:${field}:${from}->${to}:${kind ?? 'manual'}`)` → `{ ok: true, applied: { session, mode, field, from, to, kind } }`. Under `coordMutex.run` from the run read onward. Read `ActorFlags`'s shape in `ccdargv.ts` before writing the literal; `surface` may not be a field of it — use the fields it has.

- [ ] **Step 1: Write the failing tests** (the `run-routes.test.ts` harness with `runCcd` stubbed and a registry directory planted under the fixture home): 401 without the token; 400 on two of `kind`/`demote`/`field`; 404 unknown run; 409 `run-closed` on a `done` run; 409 `no-session` on a `dispatched` run with no `sessionId` for target worker; 501 without `route-v1`; `kind: shallow` on a worker at opus·high → argv `route --session <sid> --set effort=xhigh` + the actor flags with `--reason 'escalate shallow: <why>'`, one run event `route:escalate:effort:high->xhigh:shallow`; `kind: ceiling` on a DEGRADED session (`class=fable`, `degraded=opus`) computes from opus — the record already intends fable, so the door answers 409 `ceiling` with why "the record already intends fable; the lane serves opus (degraded)" — pin this arm: escalating a degraded session's class re-intends what is already intended; `demote: effort` on opus·high → medium, event `route:demote:effort:high->medium:manual`; a second `kind: shallow` after that demotion → `reverse-demotion` medium→high, no ladder move; manual `field: subagent, value: opus` → the argv as given (ccd validates) and event `route:manual:subagent:?->opus:manual` (the door does not read `subagent`; `from` is `?`); a ccd refusal (stderr `bad value for subagent`) → 502 and NO run event; an unreadable `.effort` (mode 000 under the fixture home) → 503 `registry-unreadable`; `why` with a newline → 400.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** as spelled; the handler's docstring names its place in the box-token surface (CLAUDE.md's census sentence covers `/api/runs*`).
- [ ] **Step 4: Run to verify they pass** — plus `coord-pause-route`, `box-token-census`, `run-routes`, `whitelist-subset` (no new argv shape), `typecheck-tests`.
- [ ] **Step 5: Mutation check, measured** — record the run event before the ccd call → the refusal case reds; drop the state gate → `run-closed` reds; compute from `class` instead of `degraded ?? class` → the degraded case reds; collapse `unreadable` into `absent` → the 503 case reds.
- [ ] **Step 6: Commit** — `feat(routing): POST /api/runs/:id/route — the coordinator escalates or demotes a run's session by the ladders through the verb, with a run event (routing slice 5, Task 2)`.

---

### Task 3: The trail on the read side — `arm` and `routing` on the run's signals; the dispatcher records the arm

**Files:**
- Modify: `shared/api.ts` (`RoutingEvent`, `RunSignals.arm`, `RunSignals.routing`, `RunSignals.routingUnparsed` — appended after `signals: WaveDoneSignals | null` at `shared/api.ts:5392`), `server/src/coord/store.ts` (`runRoutingEvents`, `runSignals` at `:2140`), `server/src/coord/dispatch.ts` (`recordRunEvent(id, 'coordinator', 'arm:' + words)` when a `route` was seeded — both wave arms)
- Test: `server/test/run-signals-routing.test.ts` (new), `server/test/dispatch-route.test.ts` (slice 4's — one more assertion per arm)

**Interfaces:**
- `RoutingEvent { at: number; mode: RouteMode; field: string; from: string; to: string; kind: FailureKind | 'manual'; causedBy: string }`; `RunSignals.arm: RouteFields | null` (parsed from the first `arm:` event's `k=v` words; `null` when none — an old run or a dispatch with no routing) and `RunSignals.routing: RoutingEvent[]` (every `route:` event in order; a malformed detail is skipped and counted in `routingUnparsed: number`, never thrown). §6 "Arms": a run with a non-empty `routing` changed routing mid-flight and is reported apart from its arm's mean — that is the READER's rule; the wire carries both facts. Every path that builds a `RunSignals` literal must compute the three new fields (the type makes an omission a compile error — that is the wire discipline, keep it).

- [ ] **Step 1: Write the failing tests** — a run with an `arm:class=opus effort=high` event and two `route:` events answers both; a run with none answers `arm: null, routing: [], routingUnparsed: 0`; a malformed `route:` detail is skipped with `routingUnparsed: 1`; the dispatcher records `arm:class=opus effort=high` (wave 1 and wave N) only when routing was seeded, in `ROUTE_WRITABLE_FIELDS` order.
- [ ] **Step 2: Run to verify they fail.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run to verify they pass** — plus `run-signals` (slice 2's), `typecheck-tests`.
- [ ] **Step 5: Mutation check** — throw on a malformed detail → the skip case reds; record `arm:` when no routing was seeded → the negative case reds.
- [ ] **Step 6: Commit** — `feat(routing): the run's signals carry the arm at dispatch and every routing change since (routing slice 5, Task 3)`.

---

### Task 4: The coordinator's door in the references, `ccrc-api runs route`, and the spec's §5.3 amendment

**Files:**
- Modify: `ccd/ccrc-api` (`[runs.route]='POST|/api/runs/{id}/route|yes|-'` after `[runs.signals]` at `:99`; BOTH count-word anchors `ccrc-api.test.ts` names — the closed-surface bullet `The route comes from ROUTES below, <word> rows, and nothing else.` at `:24` and the unique `# <word> rows` ROUTES-table header — become `twenty-four`), `server/test/ccrc-api.test.ts` (`toHaveLength(24)`, `WORDS[24] = 'twenty-four'`, its "since" comment), `ccd/coordinator-skill/references/wave-lifecycle.md` (§4 "Advance the run as the wave progresses": a new bold paragraph after the "Two signal lines open the body" paragraph; the "The run's own signals" section at `:699`: `arm` and `routing`), `ccd/coordinator-skill/SKILL.md` (one sentence appended to the "**Reading ccd is fine.**" paragraph at `:85`, which follows clause 14: the door, never the verb), `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md` §5.3 "Coordinator decisions" (`:289-295`; amended: the coordinator calls `POST /api/runs/:id/route` through `ccrc-api`; `ccd route` is the SERVER's call; a footnote names the deviation)
- Test: `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts` (the fenced example maps to the row), `server/test/coordinator-skill.test.ts` (the sentence pins — the clause literals are byte-pinned, so the new sentence goes in the paragraph AFTER the clauses, never inside one), `server/test/routing-references.test.ts` (unchanged: `routing-matrix.md` is §3 verbatim minus context-hygiene — the escalation paragraph there already says "the coordinator chooses the rung by failure kind"; NO edit to the matrix)

- [ ] **Step 1: Write the failing tests** — the row and count; `wave-lifecycle.md` contains `"$API" runs route` and the sentence `never \`ccd route\`` (a sentence-literal pin, subject bound — see memory `a-substring-pin-binds-no-subject`); `SKILL.md`'s "Reading ccd is fine" paragraph contains the door sentence; the closed-corpus parity sees the fenced example.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** — §4 paragraph (verbatim body shapes): `**When a check failed, the failure kind names the rung** (spec §3): \`printf '{"target":"worker","kind":"<shallow|ceiling|unclear>","why":"<one sentence>"}' | "$API" runs route "$run_id" --json -\` — the server computes the rung from the ladders on the session's record, writes it through the routing verb with no \`--apply\` (ccd applies it at the next settle or idle tick), and records a run event; \`ceiling\`/\`floor\`/\`no-record\` (409) are answers, not errors — record them in the ledger and decide by hand with \`{"target":"worker","field":"<field>","value":"<value>","why":"…"}\`. **Demotion** is your judgement (§3): after three consecutive clean waves of one shape on one session, \`{"target":"worker","demote":"effort","why":"…"}\`; any later failed check reverses it before the ladder applies. Never \`ccd route\` (clause 1) and never \`--apply\` (clause 12's evidence rule and spec §8 row 5). Every call is one run event and one journal row; write the same decision in the ledger (clause 12).` Spec §5.3: replace the "Coordinator decisions" bullet's first sentence (`The coordinator runs \`ccd route --session <id> --set <field>=<value>\` locally on the fleet box, for a worker or for itself`) with the door (`The coordinator calls \`POST /api/runs/:id/route\` through \`ccrc-api runs route\`, for the run's worker or for itself; the server computes the rung and runs \`ccd route --session <id> --set <field>=<value>\` as the SERVER's call`); keep "never passes `--apply`" and the record-is-the-arbiter sentence; append `(amended in slice 5, D-<issued>: clause 1 forbids a coordinator running ccd to change fleet state, so the decision goes through the server's door; the verb is the server's call)`.
- [ ] **Step 4: Run to verify they pass** — plus `worker-skill`, `install-coordinator-skill`'s suite, `routing-references`, `coordinator-skill`.
- [ ] **Step 5: Mutation check** — remove the row → count and parity red; invert the `never ccd route` sentence → the pin reds.
- [ ] **Step 6: Commit** — `feat(routing): ccrc-api runs route; the coordinator escalates through the door, never the verb; spec §5.3 amended (routing slice 5, Task 4)`.

---

### Task 5: The doctor's census — live sessions without a record; the subagent-key arm flips to FAIL at zero (S1-R13)

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (`_check_routing` at `:4320`; `_have_systemctl` at `:830` is the existing systemctl presence probe), `server/test/ccrc-doctor.test.ts` (stubs are `stub(home, name, script)` — `stubGit` at `:251` and `stubLoginctl` are the shape to copy for a `stubSystemctl`)

**Interfaces:**
- `_check_routing` gains, before the `sub` arm: a census over `$REG/*.uuid` ids whose `claude-session@<id>.service` is active (`systemctl --user is-active`, stubbed in the suite the way `stubGit` stubs git) and whose `$REG/<id>.class` is ABSENT → `missing=<n>`; the `sub` arm: `missing > 0` → WARN as today with ` — <n> live session(s) carry no routing record yet: <ids, at most five>` appended; `missing == 0` → FAIL: `an Anthropic lane's settings.json pins CLAUDE_CODE_SUBAGENT_MODEL (<lanes>) while every live session carries a routing record — the key overrides the record's subagent field; remove it` (rc 1). `systemctl` absent or unreadable → the census is `unmeasured` and the arm stays WARN saying so (never FAIL on a fabricated zero). A registry with zero live sessions is `missing=0` measured, not unmeasured — say which in the message.

- [ ] **Step 1: Write the failing tests** — four fixtures: (a) two live ids, one without `.class` → WARN with `1 live session(s)`; (b) two live ids both with `.class`, a lane pinning the key → FAIL; (c) the systemctl stub exits 1 for `is-active` on every unit → WARN `unmeasured`; (d) no lane pins the key → PASS regardless of the census.
- [ ] **Step 2: Run to verify they fail.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run** — `ccrc-doctor`, `ccrc-doctor-checks` suites (whatever `ls server/test | grep doctor` lists).
- [ ] **Step 5: Mutation check** — FAIL on an unmeasured census → (c) reds; count stopped sessions → (a) reds when the stub marks one inactive.
- [ ] **Step 6: Commit** — `feat(doctor): the routing arm counts live sessions without a record and fails on the subagent key once the count is zero (routing slice 5, Task 5)`.

---

### Task 6: The fleet screen's class chooser — `GET /api/projects?class=` gains its caller; the `+` seeds the class

**Files:**
- Modify: `pwa/src/screens/FleetScreen.tsx` (a `<select>` inside `fleet-head-right` at `:426`, values `Coordinator row` (unset) / Default / the four classes from `CLASSES` imported from `../../../shared/models` as `NewSessionSheet.tsx:12` does; `addWorkspace` at `:308` passes the chosen class), `pwa/src/lib/api.ts` (`projects(cls?)` at `:492` is slice 4's and already takes the class; `workspaceAdd` at `:510` gains `route?: RouteFields` and posts `{ route }` when set), `pwa/src/fleet/ProjectCard.tsx` (`onAddWorkspace` at `:163`/`:465` — unchanged signature; the class rides in FleetScreen's closure)
- Test: `pwa/test/fleet-class-chooser.test.tsx` (new), `pwa/test/fleet-screen.test.tsx` green

- [ ] **Step 1: Write the failing tests** — choosing `Fable` re-fetches `/api/projects?class=fable` and a `none`-with-class row renders `no lane can serve fable`; tapping `+` posts `route: { class: 'fable' }`; the unset chooser posts no `route` and fetches without the query.
- [ ] **Step 2–6** as the pattern: fail, implement (a plain `<select>`, the existing head styles), pass (whole `pwa` suite), mutate (drop the `route` from the `+` → reds), commit — `feat(routing): the fleet screen's class chooser forecasts placement by class and seeds the + (routing slice 5, Task 6)`.

---

### Task 7: Ship agent-first and measure the gate — rungs against fix-round cost

- [ ] **Step 1: The full suites, in chunks** (server in ≥7 exact chunks that partition `ls server/test/*.test.ts` — an 86-file chunk overruns the 600 s ceiling; agent; pwa; `deviation-refs` + `dtbd` after a real fetch).
- [ ] **Step 2: Push; PR #116 retitled/re-bodied for slices 2–5 through `gh api -X PATCH repos/Synapsium-Labs/ccrc-pwa/pulls/116 -F title=@f -F body=@f` (never `gh pr edit`); never merge.**
- [ ] **Step 3: Deploy, agent lane first** (ccrc-api, ccrc-doctor-checks, the references), then the server; check the deployed stamp before deploying (memory `check-the-deployed-stamp-before-you-deploy`).
- [ ] **Step 4: The gate.** (a) The door refuses a CLOSED run honestly and cheaply: `printf '{"target":"worker","kind":"shallow","why":"slice 5 gate"}' | ccrc-api runs route <a done run id> --json -` → 409 `run-closed`, no fleet act, no run event — record the id and the answer. (b) The first LIVE escalation or demotion through the door on an open run — PENDING until a coordinator's wave fails a check or earns a demotion; never provoke one. (c) `ccrc doctor`: the routing arm's census count of live sessions without a record (expected > 0 today; WARN with the count), recorded. (d) Fix-round cost per rung: from the runs closed since slice 4's deploy, `GET /api/runs/:id/signals` — `arm`, `routing`, `closeRefusals`, `firstSubmission` — tabulated; with fewer than ten waves per shape (§6) the table is a reading, not a proposal.
- [ ] **Step 5: Commit the row** — `docs(research): slice 5 gate — the door's refusal measured, the census read, the trail tabulated (routing slice 5, Task 7)`.

---

## Deviations found

None at plan time. Numbers are issued by the allocator during execution and defined here in the same act. Expected departures the plan already knows it will record: the §5.3 amendment (the door replaces "runs `ccd route` locally"); the on-demand record read in the door instead of a new wire field; the dispatcher's `arm:` event (a slice 4 seam touched by slice 5); `EFFORT_LADDER` as a new L0 vocabulary with ccd's stop list as its pinned mirror (the spec names the ladder in prose only).

## Carried to slice 6

- The `compact` field's read in `_auto_compact_check` and the worker's lower threshold — after the graphify compaction card ships.
- The routing record on the fleet wire (`FleetSession.route`) — when a PWA surface needs the intended values beside the live read-back (the queued badge reads the pane today).
- `ROUTE_INERTABLE` lacks `subagent` (slice 4's deferred minor): a codex lane records `subagent` applied though its settings.json pins the key and ccd composes no `routeenv` there.

## Self-review against the spec

- §3 Escalation (kinds → rungs, `max` rule, class reset, subagent ceiling, class-aware unclear) — Task 1; Demotion (judgement, reversal on the next failure) — Tasks 1–2; §4 the coordinator decides (kind or explicit fields) — Task 2; §5.3 Coordinator decisions (amended to the door), Audit trail (run event + journal row) — Tasks 2, 4; §6 Arms and cost signals (`arm`, `routing`, the reader's rule) — Task 3; §7 slice 5 gate — Task 7; §8 rows 4–5 unchanged and still pinned; S1-R13 — Task 5; slice 4's carry (the class chooser) — Task 6. ✓
- Names verified against the tree at 84b1dfda (2026-09-16): `CLASSES` is in `shared/models.ts:52` (not `shared/api.ts`) and its order is ladder order; no effort-level export exists in `shared/` (the vocabulary lives in `ccd/ccd:1208/1218`), so Task 1 defines `EFFORT_LADDER` and pins ccd's stop list as its mirror; `coord.run(id)` returns `RunReadResult` with a `run-unreadable` arm (Task 2 answers 503 on it) and `RunRow` carries `sessionId`/`claimedBy`; `ROUTE_CAP = 'route-v1'` is in `server/src/ccdargv.ts:564`; registry reads use `deps.io.readFileMeasured` (`absent` | `unreadable`); `ccrc-api` holds twenty-three rows with two count anchors; `stubGit(home)` at `ccrc-doctor.test.ts:251`; the `+` is `api.workspaceAdd(project)` at `pwa/src/lib/api.ts:510`, called from `FleetScreen.tsx:308`.
