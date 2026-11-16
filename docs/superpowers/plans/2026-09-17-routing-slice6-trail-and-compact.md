# Routing slice 6 — the session-scoped trail, the picker derives the ladder, `subagent` can be inert, the record rides the fleet wire, and the `compact` field (gated on the compaction card) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close what slices 4 and 5 carried — the door's demotion/escalation bookkeeping follows the SESSION across waves (spec §3 as written, closing D-2957's run-scoped departure), the PWA's effort picker derives its five stops from `EFFORT_LADDER`, a lane that composes no subagent env stamps `subagent` inert instead of recording it applied, and the routing record's intended values ride the fleet wire beside the live read-back — and, ONLY once the graphify compaction card is merged and deployed, the `compact` field lowers a worker's compaction threshold and the post-compaction re-read count measures it (spec §7 slice 6).

**Architecture:** The `route:` run-event grammar gains a sixth segment, the session id, written by `routeEventDetail` and accepted-or-absent by `parseRouteEventDetail` (`session: string | null` — an older five-segment event answers `null`); the door derives `lastDemotion`/`priorSameKind` from every run whose worker or coordinator is the target session (`runsTouching(sessionId)`, a store read joining `runs.sessionId`/`runs.claimedBy` to `run_events`), counting a six-segment event only when its session matches and a five-segment event only inside its own run. `pwa/src/lib/models.ts`'s `effortOptions` maps `EFFORT_LADDER` to its five level rows and appends the labelled superset (`Auto`, `Ultracode`) — a parity test pins the derivation. ccd's `ROUTE_INERTABLE` gains `subagent`; a lane whose spawn composes no `routeenv` (`exec.kind` external — the codex lanes) stamps `subagent` inert, the applier and `_route_wanted` skip it, and the settle's `routeapplied` seed omits it. `FleetSession.route` (`RouteFields | null`) plus `degraded`/`inert` are read by the agent's session census from the registry and revived through `reviveFleetSession`'s literal (additive, absence-permits); the PWA's queued badge compares intended to read-back. The `compact` field (§5.1) is read by `_auto_compact_check` (`_reg_get "$id" compact`, digit-guarded, falling back to `COMPACT_THRESHOLD`), the dispatcher writes it for workers from the routing matrix's row, and the gate measures the post-compaction re-read count — after the card.

**Tech Stack:** TypeScript (`shared/api.ts`, `server/src/coord/{routes,store}.ts`, `server/src/fleet.ts` (the census), `pwa/src/lib/models.ts`, `pwa/src/session/*`), bash (`ccd/ccd`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md` — §3 "Demotion" (reversal across waves — the rule D-2957 departed from), §5.1 (`compact`), §5.2 (inert), §5.3 "Audit trail", §6 "Arms", §7 slice 6, §8. The graphify card: `docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md` and Plan A on `ws/graphify-compaction-card` (remote e8ae7968 at plan time; NO merged PR — the operator's call).

## Global Constraints

- **Wire discipline — additive, absence-permits:** the sixth event segment and `FleetSession.route` are ADDITIVE; an older reader ignores them and a newer reader tolerates their absence through ONE reader per field. `FLEET_PROTO` stays 1.
- **One grammar, one parser, one formatter** (S5-R6/S5-R8): the session segment is added in `routeEventDetail`/`parseRouteEventDetail` only; the round-trips in `run-signals-routing.test.ts` extend.
- **Every `ccd/ccd` commit re-stamps the provenance marker** (`node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"` from the repo root) then `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts`.
- **No second copy of a vocabulary:** `EFFORT_LADDER` is the effort stops' one TypeScript home; `ROUTE_INERTABLE`'s bash list is mirrored by whatever TypeScript reader exists (grep `inertable` in `shared/`/`server/src` first; if a TS copy exists, pin parity the way `routing-ladder.test.ts` pins `ROUTE_EFFORT_STOPS`).
- **The compact tasks are GATED**: Task 5 begins with a measured check that the graphify compaction card is on `origin/main` AND deployed to the fleet host (`~/.local/bin/ccd version` carries a sha that includes it); if not, the task STOPS and reports — never implements the threshold read against a fleet whose SessionStart card cannot restore context.
- **FIXTURE HOMEs only; suites from inside the package; D-numbers issued; no account names; AGENT-FIRST for `ccd/`.**

---

## File structure

| File | Responsibility |
|---|---|
| `shared/api.ts` | `RoutingEvent.session`, the six-segment grammar, `FleetSession.route`/`degraded`/`inert`, `reviveFleetSession` |
| `server/src/coord/store.ts` | `runsTouching(sessionId)`; `routingFromEvents` carries `session` |
| `server/src/coord/routes.ts` | the door's walk over the session's runs |
| `server/src/fleet.ts:553` (the fleet census's `FleetSession` literal) | reads the seven fields + `degraded` + `inert` per session through the fleet io |
| `pwa/src/lib/models.ts` | `effortOptions` derived from `EFFORT_LADDER` |
| `pwa/src/session/*` (the picker/queued badge) | intended vs read-back |
| `ccd/ccd` | `ROUTE_INERTABLE` + `subagent`; `_auto_compact_check` reads `compact` (Task 5) |
| `ccd/coordinator-skill/references/wave-lifecycle.md`, `routing-matrix.md` | the cross-wave sentence restored; the worker's `compact` row (Task 5) |
| tests | `run-signals-routing.test.ts`, `run-route-route.test.ts`, `routing-ladder.test.ts`, a new `run-route-session-trail.test.ts`, pwa `effort-options.test.ts` (new), `ccd-route-*.test.ts` (the inert census), `fleet-wire-route.test.ts` (new), agent census tests, `ccd-auto-compact.test.ts` (Task 5) |

---

### Task 1: The session-scoped trail — the event carries its session, the door walks the session's runs

**Files:**
- Modify: `shared/api.ts` (`RoutingEvent`, `routeEventDetail`, `parseRouteEventDetail`, `ROUTE_EVENT_DETAIL_RE`), `server/src/coord/store.ts` (`runsTouching`, `routingFromEvents`), `server/src/coord/routes.ts` (the door's walk), `ccd/coordinator-skill/references/wave-lifecycle.md` (§4: the run-scoped sentence D-2957 introduced becomes the cross-wave rule again)
- Test: `server/test/run-signals-routing.test.ts` (round-trips with and without the session), `server/test/run-route-session-trail.test.ts` (new), `server/test/run-route-route.test.ts` (green), `server/test/coordinator-skill.test.ts` (the §4 pin follows the sentence)

**Interfaces:**
- `routeEventDetail({ mode, field, from, to, kind, session })` → `route:<mode>:<field>:<from>-><to>:<kind>:<session>`; `parseRouteEventDetail` accepts five OR six segments and answers `session: string | null`; `RoutingEvent.session: string | null`.
- `coord.runsTouching(sessionId): { id: number; sessionId: string | null; claimedBy: string | null }[]` — every run whose `sessionId` or `claimedBy` is the session, any state, ordered by id.
- The door: events = the union over `runsTouching(sid)` of `runEvents(run.id)`, ordered by `at` then run id; a six-segment event counts iff `event.session === sid`; a five-segment event counts iff `run.sessionId === sid` (the pre-slice-6 events were the worker's — a coordinator-targeted five-segment event on the same run is indistinguishable and is IGNORED, said in a comment); `lastDemotion` = the last `demote` not followed by a `reverse-demotion` or a `manual` on the same field; `priorSameKind` counts across the session's runs. Ruling S5-R17 (the measured `from`) stands.

- [ ] **Step 1: Write the failing tests** — round-trip with a session; a five-segment detail still parses with `session: null`; a demotion recorded on run A (wave 1) is reversed by a failed check on run B (wave 2, same worker session); a demotion on the COORDINATOR (target coordinator, run A) is not reversed by the worker's failure on run B; the pre-slice-6 five-segment demotion on run A is reversed on run B only when run A's `sessionId` is the target; `priorSameKind` counts a `shallow` on run A toward run B's `max` rule.
- [ ] **Step 2: Run to verify they fail.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run to verify they pass** — plus `run-route-route`, `run-signals`, `single-definition`, `typecheck-tests`, `coordinator-skill`.
- [ ] **Step 5: Mutation check, measured** — drop the union (walk this run only) → the cross-wave test reds; ignore the session segment → the coordinator-vs-worker test reds.
- [ ] **Step 6: Commit** — `feat(routing): the routing trail follows the session across waves — the event names its session and the door walks the session's runs (routing slice 6, Task 1)`.

---

### Task 2: The picker derives the ladder — `effortOptions` from `EFFORT_LADDER`

**Files:**
- Modify: `pwa/src/lib/models.ts:80-98` (`effortOptions`)
- Test: `pwa/test/models.test.ts` (extend — it is `effortOptions`' own suite) and `pwa/test/session-pickers.test.tsx` green

- [ ] **Step 1: Write the failing test** — the level rows equal `EFFORT_LADDER.map(v => ({ label: capitalised(v), value: v }))` in order, then `Auto`, with `Ultracode` spliced before `Max` on a non-gpt wrapper only; mutation: reorder `EFFORT_LADDER` in a copy → the test reds (a control the way `routing-ladder.test.ts` does it).
- [ ] **Step 2–6** as the pattern; commit — `feat(routing): the effort picker derives its five stops from EFFORT_LADDER and adds the labelled superset (routing slice 6, Task 2)`.

---

### Task 3: `subagent` can be inert — a lane that composes no subagent env stamps it

**Files:**
- Modify: `ccd/ccd` (`ROUTE_INERTABLE="effort workflow subagent"`; the stamp site at ~:16858 stamps `subagent` when the lane composes no `routeenv`; `_route_wanted`/the applier skip an inert `subagent`; the `routeapplied` seed omits it). No TypeScript mirror of `ROUTE_INERTABLE` exists (verified 2026-09-17) — the inert vocabulary is bash-only and its readers are ccd's.
- Test: `server/test/ccd-route-*.test.ts` (the inert census + a codex-lane fixture), `ownership.test.ts` after the marker

- [ ] **Step 1: Write the failing tests** — a codex-lane record with `subagent=sonnet` spawns with `inert=subagent` (and `effort`/`workflow` as before) and NO `CLAUDE_CODE_SUBAGENT_MODEL` in the env; an Anthropic lane stamps nothing for `subagent`; the `_route_valid` inert arm accepts the new word; the census of `ROUTE_INERTABLE` readers (grep `ROUTE_INERTABLE` in ccd/ccd) is re-derived with the reason.
- [ ] **Step 2–6** as the pattern (re-stamp the marker, `ownership.test.ts`); commit — `feat(routing): a lane that composes no subagent env stamps subagent inert instead of applied (routing slice 6, Task 3)`.

---

### Task 4: The record on the fleet wire — `FleetSession.route`, `degraded`, `inert`

**Files:**
- Modify: `shared/api.ts` (`FleetSession.route: RouteFields | null`, `degraded: string | null`, `inert: string[] | null`; `reviveFleetSession` at :2527), `server/src/fleet.ts:553` (the census literal — the only production `FleetSession = {` site; it reads registry fields through the fleet io, never the agent directly), `pwa/src/session/*` (the queued badge compares intended to read-back; the sheet shows intended)
- Test: `server/test/fleet-wire-route.test.ts` (new: revive with and without the fields), the fleet census tests (`ls server/test | grep -i fleet`), the pwa badge tests

- [ ] **Step 1: Write the failing tests** — a persisted `FleetSession[]` from an older build revives with `route: null, degraded: null, inert: null`; the census reads a record and answers the seven fields as written (absent fields absent); the badge reads `queued` only while intended ≠ read-back.
- [ ] **Step 2–6** as the pattern; commit — `feat(routing): the routing record rides the fleet wire beside the live read-back (routing slice 6, Task 4)`.

---

### Task 5 (GATED): The `compact` field — `_auto_compact_check` reads it; the dispatcher writes a worker's threshold from the matrix

- [ ] **Step 0: The gate, measured** — `git fetch origin main && git log origin/main --oneline | grep -i 'compaction card'` names a merged commit AND `~/.local/bin/ccd version` on the fleet host carries a sha at or after it. If either fails: STOP, write the report saying so, and end the task — the controller carries this task to the next slice.
- [ ] **Step 1: Write the failing tests** — `ccd-auto-compact.test.ts`: a session with `compact=30` compacts at ctx 30 where the default would not; `compact` absent → `COMPACT_THRESHOLD`; a non-digit `compact` is ignored with a `compact-skip` note naming it (D-299 digit guard first inside the `[[ ]]`); the dispatcher's worker route carries `compact: <the matrix row's value>`; `routing-matrix.md` names the value in one row (and `routing-references.test.ts`'s verbatim pin against spec §3 stays green — the value lives in §5.1, so amend the SPEC table row and the matrix together).
- [ ] **Step 2–6** as the pattern (marker re-stamp); commit — `feat(routing): the compact field lowers a worker's compaction threshold (routing slice 6, Task 5)`.

---

### Task 6: Ship agent-first and measure the gate

- [ ] Full suites in ≥ 8 exact chunks; push; PR #116 re-bodied for slices 2–6 through `gh api -X PATCH`; deploy agent lane first after reading the stamps; the gate: (a) the session trail — a demotion on a closed run and a failed check on its successor run answer `reverse-demotion` (measured on fixture data through the door against a DONE run pair: 409 run-closed proves nothing here — read `runs signals` on a real successor when one exists, else PENDING); (b) a codex-lane session's `inert` stamp names `subagent` after its next settle (PENDING the settle); (c) `GET /api/fleet` rows carry `route` for the recorded sessions; (d) the post-compaction re-read count (Task 5 only). Research row `Slice 6 gate`.

---

## Deviations found

Issued by the allocator on 2026-09-17 after the whole-slice review and defined in the same act: D-2961 through D-2977 (17 departures; the block's unspent tail is never spelled). Per-task commits: Task 1 c7d716c1, 2dd75489, 33ad0489; Task 2 fe6a56ee, 7eca64d3; Task 3 61d54dcd, a775c60e; Task 4 5f3671b3, 838fe78d, 5ba53361; the final fix waves 0d87d579, f15b9eaf, 4852fc31. Task 5 (the `compact` field) was CARRIED under ruling S6-R2: its gate, the graphify compaction card, is PR #134, open and unmerged at the mint. Rulings S6-R1..S6-R5 and the ones the final review added are in the SDD ledger (archived in the session scratchpad as sdd-archive/slice6-ledger.md).

- **D-2961** (sixth-segment-fallback) — the `route:` event gained a sixth segment (the session id); a five-segment event still parses (`session: null`) and is attributed to its run's WORKER only — a coordinator-targeted five-segment event is indistinguishable and is ignored (one comment says so).
- **D-2962** (session-shape-at-the-door) — `isSessionIdShape` (shared/api.ts, the same charset as the grammar's sixth group) refuses a malformed `run.sessionId`/`claimedBy` at the door with 400 before it can enter the `:`-delimited grammar; the plan assumed the charset without enforcing it.
- **D-2963** (run-scoped-test-retired) — run-route-route.test.ts's case asserting the run-scoped rule (D-2957's) was retired and replaced; D-2957 is CLOSED by the session walk.
- **D-2964** (red-first-skipped-session-trail) — the new suite's seven door tests were written against the implementation; mutation evidence (quoted) substituted.
- **D-2965** (picker-refactor-no-red) — the effortOptions derivation was behaviour-preserving, so no red-first step; the hand-written order literal and the measured splice mutation stand in.
- **D-2966** (gptlane-fixture-extraction) — ccd-route-spawn.test.ts's three inline codex-lane roster literals were rewritten onto one `gptLane()` helper rather than copied twice more.
- **D-2967** (seed-subagent-guard) — `_route_apply_seed`, the other `routeapplied` writer, gained the same `_route_inert_has` guard for the subagent word (the brief named the spawn site; its own clause 'the routeapplied seed omits it' covers it).
- **D-2968** (apply-loop-inert-guard) — `cmd_route --apply`'s post-write `routeapplied` loop skips `workflow` and `subagent` when the session's inert stamp names them (S6-R3) — `workflow` had been unguarded there since slice 4.
- **D-2969** (route-object-on-the-wire) — the routing values ride ONE object `FleetSession.route` ({ fields, degraded, inert } | null) rather than three top-level fields, because `degraded` already names a degraded ROW in that type's vocabulary (S6-R4); `null` = none of the seven files exist.
- **D-2970** (measured-routing-reads) — the seven registry reads are MEASURED: `route: null` only when all seven are absent; `unreadable: RouteField[]` names failed reads (optional on the wire); the plan's reads folded absent and unreadable (S6-R5).
- **D-2971** (badge-agreement-vocabulary) — the wire-derived queued badge treats a recorded `auto`/`default` and an unknown read-back as agreeing (ccd types nothing for them), or it would light for ever.
- **D-2972** (fixtures-gain-route-null) — 25 pwa test fixtures spelling a FleetSession literal gained `route: null` (the required field's compile error is the wire discipline working).
- **D-2973** (field-read-census-30) — the per-session registry field-read census rose 23 → 30 (31 single / 721 fleet at 24 sessions), the cost stated at buildRecord.
- **D-2974** (routing-reads-listing-rung) — the seven measured routing reads take the registry's LISTING rung like every other measured field: an unreadable read of a file the listing does not name is ABSENT (`routeReallyUnreadable`), so a never-routed session answers `route: null` on an older agent too; S6-R5's tests now seed the file they degrade.
- **D-2975** (degraded-class-reader) — the session screen's model sheet names the served class beside the intended one ('serving <degraded>') and the class arm of the wire badge agrees on the served class; the plan carried no reader for `route.degraded`.
- **D-2976** (subagent-inert-departs-5.2) — spec §5.2 said `subagent` 'applies through the lane's materialiser, where settings.json wins' on a non-Anthropic lane; measured, ccd applies subagent ONLY through CLAUDE_CODE_SUBAGENT_MODEL on the Anthropic arm, so Task 3's inert stamp is the truth and the spec sentence is corrected at the mint (S6-R7).
- **D-2977** (census-cost-accepted) — the 23→30 field-read raise multiplies across five whole-registry readers (~+168 agent-link reads per whole-fleet pass at 24 sessions); accepted with the cost stated and measured live at the gate; the listing-backed skip for absent files is carried (S6-R6).

A second block, issued on 2026-09-17 after the compaction card (PR #134, dfa167d7) merged mid-slice and Task 5 ran on the merged tree, defined in the same act: D-2978 through D-2985 (8 departures; the block's unspent tail is never spelled). Commits: the third merge b6b0b442, 1c71be12, 4784dd18; Task 5 2ef6314c, 8f373055. Rulings S6-R8..S6-R12 are in the SDD ledger.

- **D-2978** (card-merged-mid-slice) — the graphify compaction card (PR #134, dfa167d7) merged while slice 6 ran and was merged into the branch before Task 5 (b6b0b442); its three citation-debt censuses were RE-MEASURED on the merged tree (ccd/ccd 22→124, the Files: set 12→20, the |-row set 18→51) as their own comment mandates, no doc edits (S6-R10).
- **D-2979** (readme-anchors-recited) — five of main's README operator anchors into shared/api.ts and ccd/ccd were re-anchored by content after the merge moved their targets.
- **D-2980** (svc-gate-earlier-spelling) — the S3-R1 comment in ccd/ccd says 'under the earlier spelling `_svc_gate`' so the card's dangling-identifier guard reads it as quoted history.
- **D-2981** (gate-ruled-not-measured) — Task 5's Step 0 (the card merged AND deployed) was satisfied by ruling: the card is merged in-tree and Task 6's deploy ships the card and the field together (S6-R8).
- **D-2982** (worker-compact-40) — the worker's initial `compact` value is 40, chosen by ruling S6-R9 (the spec left the number open); the matrix and spec §3 rows carry it.
- **D-2983** (matrix-spec-identity-pin) — routing-references.test.ts had never pinned the matrix verbatim against spec §3 (only the class/effort vocabularies); the two copies were identical by convention — a byte-for-byte row pin was added.
- **D-2984** (reread-count-no-reader) — the plan's gate item (d), the post-compaction re-read count, has no shipped reader (slice 0's figure came from an ad hoc transcript pass); the gate states so and carries a reader.
- **D-2985** (compactor-reads-through-route-get) — the compactor reads the field through the validated routing reader `_route_get` (out-of-range digits behave as absent with the routing note), not a bare `_reg_get` with a digit belt (S6-R12).

## Carried

- Slice 0's seven-day measurement re-measure (~2026-09-21).
- The card's own gate items (spec `2026-09-09-graphify-compaction-card-design.md`) once it ships.

## Self-review against the spec

- §3 Demotion reversal across waves — Task 1 (closes D-2957); §5.1 `compact` — Task 5 (gated); §5.2 inert vocabulary — Task 3; §5.3 audit trail (the event names its subject) — Task 1; §6 arms (unchanged: `arm`/`routing` per run stay per run; the cross-run walk is the door's) — Task 1; §7 slice 6 gate — Task 6; the PWA carry (effortOptions) — Task 2; the wire carry — Task 4. ✓
- Verified 2026-09-17 against 854e7f2c: the census literal is `server/src/fleet.ts:553` (the only production site) and `reviveFleetSession` is at `shared/api.ts:2527`; no TS mirror of `ROUTE_INERTABLE`; the picker's suites are `pwa/test/models.test.ts` and `session-pickers.test.tsx`; the door routes `run.claimedBy` for target coordinator (routes.ts:1831).
