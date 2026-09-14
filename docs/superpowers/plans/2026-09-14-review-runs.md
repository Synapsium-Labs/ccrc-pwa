# Review runs — the coordinator dispatches review, it does not read it — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A finished wave stops counting against the dispatch cap the moment its worker reports wave-done, and the *reading* of that wave — review lenses and the whole-branch pass — runs in its own dispatched session, a **review run**, while the coordinator keeps the *judging*.

**Architecture:** One new column pair on `runs` (`kind`, `reviews`) turns a review into an ordinary run of a new kind, reusing dispatch, mail, hold, slot and close. The cap's `running` predicate is derived from an L0 list of *active* states so idle states (`awaiting-review`, `merging`, `closing`, `planned`) leave the count, and the one legal edge back into `working` from an idle state takes the cap check again. A review run's done-claim is `{reviewedTip, report}`, re-measured server-side against the reviewed branch's live tip. A third skill, `ccrc-reviewer`, ships beside the other two through the same installer shape; the coordinator skill's review step inverts.

**Tech Stack:** TypeScript (server: Fastify + `node:sqlite`; PWA: React), bash (`ccd`, installers, `deploy.sh`), vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-14-review-runs-design.md` (this branch, `spec/review-runs`; PR #103). The plan argues from it by section — read the spec first, then the task.

**Lane:** touches `ccd/` (a new skill tree, a new installer, `ccd/ccrc`'s install spine) and `server/` — **AGENT-FIRST** by the standing rule: the agent lane ships before the server lane so the skill exists on the fleet host before any server can dispatch a run that names it.

## Global Constraints

- Node floor `>=22.13.0` across the three engines — never lower it (CLAUDE.md "Build / test / deploy").
- L0 `shared/*.ts` imports NOTHING (a `type` from a sibling in `shared/` is the one allowance, `shared/api.ts:1-9`).
- Wire discipline: **additive only, absence permits.** `FLEET_PROTO` stays `1`. Every new `RunSummary` field is REQUIRED on the type (so `hydrateRun`'s literal must compute it) and tolerated as absent by exactly ONE PWA reader.
- Single source of truth: a runtime list is spelled once and derived (`TERMINAL_DELIVERY_SQL` is built by `.join` from `TERMINAL_DELIVERY_STATES`, `store.ts:414`). `single-definition.test.ts` fails the build on a second copy.
- Mutation discipline: every guard ships WITH a test that is RED when the guard is deleted or mutated — **measured before and after, in the task's steps**, never asserted in a comment.
- `coord.db` migrations are forward-only, one `MIGRATIONS[]` entry each, applied in `db.ts`'s `for (let v = current; v < COORD_SCHEMA_VERSION; v++)` loop — **`MIGRATIONS[0..9]` are FROZEN.** The new entry is `MIGRATIONS[10]`, `user_version 10 -> 11`.
- `CoordStore` stays synchronous; `advanceInner` stays the ONLY writer of `runs.state`.
- Box token gates every coordination write; no new route is added by this plan, so `coord-pause-route.test.ts`'s `UNGATED`/`SESSION_ONLY` sets are untouched.
- Tests use FIXTURE HOMEs only (`mkTmp`, `testDeps`, `openApp`) — never the live `$HOME`, never a live `ccd`.
- Run suites in the FOREGROUND from inside the package: `cd server && ./node_modules/.bin/vitest run test/<file>` (never bare `npx vitest`), timeout ≥ 600000 ms for a full suite.
- Deviation numbers come from the allocator only (`~/.local/bin/ccrc-api ledger allocate`); a number you cannot get is `D-TBD-<slug>` plus a report. The seven below were minted for this plan on 2026-09-14 (floor now 2801).
- Commit attribution trailer on every commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never `git add -A` (a `.playwright-mcp/` may be untracked); stage explicit paths.

---

## File structure

| file | responsibility after this plan |
|---|---|
| `shared/api.ts` | L0 vocabulary: `ACTIVE_RUN_STATES` / `IDLE_RUN_STATES` / `TERMINAL_RUN_STATES`; `RunKind`, `RUN_KINDS`, `isRunKind`; `REVIEW_RUN_TRANSITIONS`, `transitionsFor(kind)`; `RunSummary.kind`, `RunSummary.reviews`; `review-in-flight` in `RunRefuseCode`; `stale-review`, `report-unreadable` in `MAIL_REJECT_CODES` + `DONE_AUTHORITY_CODES` |
| `server/src/coord/schema.ts` | `MIGRATIONS[10]`: `runs.kind`, `runs.reviews`, index `runs_by_reviews` |
| `server/src/coord/store.ts` | `INACTIVE_RUN_STATES_SQL`, `TERMINAL_RUN_STATES_SQL` built from L0; `capsUsage` derived; `openRun` takes `kind`/`reviews`; `reviewInFlightFor`; `advanceInner` consults `transitionsFor(kind)`; row plumbing for the two columns |
| `server/src/coord/routes.ts` | `POST /api/runs` parses `kind`/`reviews`; `POST /api/runs/:id/advance` re-entry cap check + `review-in-flight`; transitions by kind |
| `server/src/coord/fingerprint.ts` | `resolveDoneBranch` (extracted), `verifyReviewDone`, `ReviewClaim` |
| `server/src/coord/close.ts` | `closeReviewRun` arm; transitions by kind |
| `server/src/coord/dispatch.ts` | `REVIEWER_KICKOFF_PREFIX`, `kickoffPrefixFor(kind)`; skill preflight by kind; precondition by kind |
| `server/src/skillstate.ts` | `REVIEWER_SKILL_DIR` |
| `ccd/reviewer-skill/SKILL.md` | the `ccrc-reviewer` skill — NEW |
| `ccd/install-reviewer-skill.sh` | its installer — NEW, the worker installer's shape |
| `ccd/ccrc`, `deploy/deploy.sh` | install spine + agent lane ship the third skill, after the worker's |
| `ccd/coordinator-skill/SKILL.md`, `references/wave-lifecycle.md`, `references/review-brief.md` (NEW) | the review step inverts; a twelfth contract clause; the review-run brief template |
| `pwa/src/fleet/runWords.ts`, `pwa/src/screens/RunsScreen.tsx`, `pwa/src/fleet/fleet.css` | `runKindChip` tolerant reader; a kind chip on review rows |
| `server/test/run-states.test.ts` (NEW), `server/test/reviewer-skill.test.ts` (NEW), `server/test/install-reviewer-skill.test.ts` (NEW), plus additions to `coord-store`, `coord-db`, `run-routes`, `coord-fingerprint`, `single-definition`, `coordinator-skill`, `ccrc-install`, `ccrc-account`, `ccrc-uninstall`, `installTreeFixture`, `agent/test/deploy-verify`, `pwa/test/runs-screen` | the pins |
| `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-08-07-build7-fleet-coordination-design.md` | prose brought into line (§13 of the spec) |

## Deviations found

Departures from the spec discovered while planning, each minted 2026-09-14 and defined here in the same act. Execution-time deviations are appended below these by the executor, each with its own minted number.

- **D-2794 (2026-09-14)** — **`TERMINAL_RUN_STATES` already exists, privately, in `server/src/coord/store.ts:47-48`, DERIVED from `RUN_TRANSITIONS` as "every state with no outgoing edge" — and that set is `['done','failed','unknown']`, not the pair spec §7.1 names.** `RUN_TRANSITIONS.unknown` is `[]` because nothing may transition a state this build cannot name, not because such a row is finished; the derivation conflated the two. Its one consumer is the clear-refused-strands query at `store.ts:1829-1833` (`r.state NOT IN (…)`), which therefore treated an `unknown`-state row as terminal. **Resolution:** the L0 pair from the spec (`['done','failed']`) is the single definition; `store.ts` imports it and the private derivation is deleted; the strands query now counts an `unknown` row as live, which is the spec's own classification of `unknown` (active, §7.1) and the stance `TERMINAL_DELIVERY_STATES`' docstring already takes for deliveries. `unknown` is never WRITTEN (`RunState`'s docstring), so no live row changes meaning; the change is recorded because a predicate moved. Task 1.
- **D-2795 (2026-09-14)** — **`RunKind` gains a third member, `'unknown'`, which spec §5.1 did not name.** `RunState` and `AskState` each carry a designated we-do-not-know member that is never written and is what a row from a newer build reads as (`shared/api.ts:3656-3666`); a two-member `RunKind` would force `hydrateRun` to either throw or lie on an unrecognised token — the exact defect that doctrine exists to prevent. `transitionsFor('unknown')` answers the all-empty table, so every advance on such a row is refused `bad-transition` and dispatch refuses before any fleet act. Tasks 3–4.
- **D-2796 (2026-09-14)** — **The review-kind verification is a sibling function, not a branch inside `verifyDone`.** Spec §8's surfaces table says "`verifyDone` branches on kind (§5.3)". `verifyDone`'s signature takes a work run's `DoneClaim` and its body is the PR-phase pipeline; a review claim has no PR and a different shape, so a branch inside it would make one function carry two claim types and two return contracts. Instead `closeRun` branches on `run.kind` and delegates to `closeReviewRun` → `verifyReviewDone`, and the branch-resolution block (`fingerprint.ts:143-207`) is EXTRACTED into `resolveDoneBranch` so both verifiers re-measure through the same registry read and the same `readBranchTip` — which is the property §5.3 actually asks for. Task 7.
- **D-2797 (2026-09-14)** — **`stale-review` and `report-unreadable` join `MAIL_REJECT_CODES` and `DONE_AUTHORITY_CODES`, not `RunRefuseCode`.** Spec §8 listed all three new codes under `RunRefuseCode`. In the tree, a done-verdict code is a `DoneRejectCode`, which is `(typeof DONE_AUTHORITY_CODES)[number]` and `satisfies readonly MailRejectCode[]` (`shared/api.ts:4448-4452`); `recordRejection` types its `code` as `MailRejectCode` (`store.ts`), and the close route's `doneVerdict` outcome carries a `DoneRejectCode`. Putting the two verdict codes anywhere else would either fail to compile or bypass the rejection record. Only `review-in-flight` — a refusal of an open or an advance, not a verdict on a claim — is a `RunRefuseCode`. Tasks 5 and 7.
- **D-2798 (2026-09-14)** — **The coordinator's inverted review rule ships as a TWELFTH contract clause, pinned verbatim, in addition to the lifecycle-step rewrite.** Spec §4 says "the review clause inverts". The shipped skill has no review clause in its eleven-clause contract; the sentence "Review the handoff commit like any other commit" is lifecycle step 5 (`SKILL.md:300`). Rewriting the step alone leaves the rule in prose a coordinator reads once; the contract is the surface `coordinator-skill.test.ts` pins verbatim and the surface the skill itself calls "not advice". Consequence: every prose count of the contract ("eleven" in `SKILL.md`, `README.md`, `CLAUDE.md`, and the test's `CONTRACT` array) moves to twelve in the same commit. Task 11.
- **D-2799 (2026-09-14)** — **On a `kind:'review'` open, `wave`, `waveOf` and `project` are DERIVED from the reviewed run, and `sessionId` is refused.** Spec §5.1 says a review run has the "same `program`, same `project`, same `claimedBy`" as the run it reviews and §5.4 says its hold carries "the worker's wave", without saying whether the request body supplies them. A body that could disagree with the reviewed row is a second writer of the same fact; so the route reads them off the reviewed run, accepts a body value only when it is identical (a differing one is `bad-request` with a detail naming the field), and refuses `sessionId` outright because a review run is always a fresh spawn on its own workspace (§5.4). Task 5.
- **D-2800 (2026-09-14)** — **Every hand-written `('done','failed')` in `server/src/coord/store.ts` is replaced by `TERMINAL_RUN_STATES_SQL`, built from the L0 pair.** Spec §7.1 says the three lists are "defined ONCE; every consumer derives from it", and names only `capsUsage` as a consumer. `store.ts` spells the terminal pair as a SQL literal in `runs()`, `programOpenRunCount`, `openRunsForSession`, `advanceInner`'s `closedAt` CASE and others (measured in Task 1, step 1). Leaving them would make the spec's sentence false on the day it ships and leave `single-definition.test.ts` nothing to pin. The sweep is mechanical, the SQL semantics are byte-identical, and the count before and after is measured in the task. Task 1.
- **D-2803 (2026-09-14, found executing Task 1)** — **The cap's SQL fragment is the NEGATIVE form over `IDLE_RUN_STATES ∪ TERMINAL_RUN_STATES`, not the positive `IN ACTIVE_RUN_STATES` spec §7.1 wrote.** The spec's own rationale for classifying `unknown` as active is that "an unrecognised row that counts wedges visibly … one that does not count over-dispatches silently" — but `'unknown'` is the JS-side revive artefact for a token this build cannot name (`RunState`'s docstring: NEVER WRITTEN), so a SQL `IN (…,'unknown')` matches the literal word and never a real novel token; the positive form UNDER-counts exactly the row the spec meant to count, and the brief's own Step 6 test (a planted `'x-from-a-newer-build'` state, expected to count) measured it. `capsUsage` therefore reads `state NOT IN ${INACTIVE_RUN_STATES_SQL}` with `INACTIVE_RUN_STATES_SQL` built by `.join` from `[...IDLE_RUN_STATES, ...TERMINAL_RUN_STATES]`; every consumer still derives from the three L0 lists, `ACTIVE_RUN_STATES` remains the classification the partition pin and every JS reader use, and `single-definition.test.ts` pins the built fragment. The spec's sentence "positive form is chosen because of the pin" is corrected by this entry, not by editing the spec.
- **D-2804 (2026-09-14, found executing Task 1)** — **Three PWA comments described the old cap predicate as `('done','failed')` and are swept in Task 1.** `pwa/src/fleet/nestFleet.ts:25`, `pwa/src/fleet/runWords.ts:83`, `pwa/src/screens/RunsScreen.tsx:8` each paraphrased `capsUsage`'s negative-form literal; Task 1 changes that predicate, so the sentences became false the moment it landed, and the new single-definition scan caught them as copies. They are rewritten to name the L0 lists. Outside Task 1's files table; recorded because the scan's authority over prose is the point of the scan.

- **D-2805 (2026-09-14, found executing Task 2)** — **The re-entry cap check is not inlined in the advance route; both routes read the cap through one `capsMeasured(coord)` helper in `dispatch.ts`.** Task 2 Step 3 said "insert" the check inline in `routes.ts`. `coord-caps-route.test.ts` ("…and the usage half is read in exactly one place, so a rebuild cannot be faithful") pins that `routes.ts` spells `.capsUsage(` exactly once, on the premise that "the usage reading exists for this answer alone" — a premise spec §7.2 pin 2 ends, since the advance route now needs the same numbers for a refusal. Weakening the pin would give up the guard on the caps view for a route that does not build it; inlining trips it. So the read and the concurrency decision move into `dispatch.ts` as `capsMeasured(coord): { caps, usage, overConcurrency }`, `dispatchRun` consumes it for BOTH its cap refusals (one read, where before it read inline), and the advance route consumes `overConcurrency` — `routes.ts` keeps its single `.capsUsage(` (the caps view), the refusal's arithmetic is spelled once, and the pin stands untouched. Found by the Task 2 re-review; the first review had missed the pin and the first implementer had cited the wrong test for it.

- **D-2807 (2026-09-14, found executing Task 7)** — **`POST /api/runs/:id/abandon` — the ungated operator valve (D-282) — must reach a review run; its abandon arm targets `closing` kind-blind, and `REVIEW_RUN_TRANSITIONS` has no `closing`.** Spec §10 says a dead reviewer is closed by the coordinator through the gated close route's `state:'failed'` arm, and says nothing about the operator door. But D-282's whole argument for leaving abandon ungated is the wedge whose coordinator is DEAD and whose box token died with it — a dead reviewer holding a slot under a dead coordinator would have had no door at all. The abandon arm in `close.ts` now picks its target by kind: `run.state === 'planned' || run.kind === 'review' ? 'failed' : 'closing'`, the store call's `viaClosing: target === 'closing'` already follows, and a test abandons a `working` review run to `failed` with its workspace released. Found by the Task 7 implementer; the spec is not edited by this plan, so §13's amendment list should carry this when the spec is next revised.

- **D-2812 (2026-09-14, found executing Task 11)** — **A review run's `state:'failed'` close accepts a body with NO fingerprint.** Spec §10 says a dead reviewer is closed "via the close route's `state:'failed'` arm", and the skill text tells the coordinator to do exactly that — but `closeReviewRun` as Task 7 shipped it shape-checks `reviewedTip` (40-hex) and `report` (absolute) BEFORE branching on `state`, so a coordinator whose reviewer died, who has neither value, is answered `bad-request`; Task 7's own failed-arm test only passed because it sent a well-formed dummy pair. An abandon asserts no claim (D-49's reasoning, applied to the review kind): on `state:'failed'` the fingerprint is OPTIONAL and, when present, still shape-checked; on the default `done` it stays required. The skill's steps 5–6 and `wave-lifecycle.md`'s rows say the body for a dead reviewer is `{"state":"failed"}`. Found by the Task 11 reviewer; the spec is not edited by this plan.


---

## Task order

1. Run-state classification and the derived cap (§7.1, §7.2 pin 1, D-2794, D-2800)
2. Re-entry cap check on `advance → working` (§7.2 pin 2)
3. `runs.kind` / `runs.reviews`: migration, row plumbing, wire fields (§5.1, D-2795)
4. Transitions by kind (§5.2)
5. Opening a review run (§5.1, D-2799)
6. `review-in-flight` on send-back (§9 invariant 3)
7. Closing a review run: `stale-review`, `report-unreadable` (§5.3, D-2796, D-2797)
8. The `ccrc-reviewer` skill and its pin suite (§4, §8)
9. Dispatch by kind: `REVIEWER_KICKOFF_PREFIX` and the skill preflight (§8)
10. Shipping the skill: installer, `deploy.sh`, `ccd/ccrc` spine, uninstall (§8, AGENT-FIRST)
11. The coordinator skill inverts (§4, §13, D-2798)
12. PWA: the kind chip (§8)
13. Prose: README, CLAUDE.md, the parent spec's bullet (§13, §7.3)
14. Final gate: whole suites, cross-branch deviation check, deploy notes

Each task ends green on the suites it names. Tasks 1–2 are independently shippable (the cap change alone would have freed two slots on 2026-09-14). Tasks 3–7 build the review run server-side and are deployable dark — nothing dispatches one until a coordinator does. Tasks 8–10 must land on the fleet host BEFORE task 11's coordinator skill tells a coordinator to dispatch one.

---

### Task 1: Run-state classification and the derived cap

**Files:**
- Modify: `shared/api.ts` (after `RUN_TRANSITIONS`, which ends at `:3748`)
- Modify: `server/src/coord/store.ts:27` (import), `:44-48` (delete the private derivation), `:401-414` (the SQL fragments), `:2463-2483` (`capsUsage`), every `('done','failed')` literal, `:1829-1833` (strands query), the comments at `:902` and `:4371`
- Test: `server/test/run-states.test.ts` (create)
- Test: `server/test/coord-store.test.ts` (the `CoordStore: caps` describe, `:409+`)
- Test: `server/test/single-definition.test.ts` (a new `it` beside the delivery-pair scan at `:586`)
- Modify (D-2804): the three PWA comments that paraphrase the old predicate — `pwa/src/fleet/nestFleet.ts:25`, `pwa/src/fleet/runWords.ts:83`, `pwa/src/screens/RunsScreen.tsx:8` — rewritten to name the L0 lists

**Interfaces:**
- Consumes: `RunState`, `RUN_STATES`, `RUN_TRANSITIONS` (`shared/api.ts:3664-3748`); `TERMINAL_DELIVERY_SQL`'s build idiom (`store.ts:414`).
- Produces: `ACTIVE_RUN_STATES`, `IDLE_RUN_STATES`, `TERMINAL_RUN_STATES` (L0, `readonly RunState[]`-satisfying `as const` tuples); `INACTIVE_RUN_STATES_SQL`, `TERMINAL_RUN_STATES_SQL` (module-private in `store.ts`). Task 2 reads `IDLE_RUN_STATES`; Task 5 reads `TERMINAL_RUN_STATES_SQL`.

- [ ] **Step 1: Measure the literals you are about to replace**

Run:
```bash
cd server && grep -n "('done','failed')" src/coord/store.ts | wc -l && grep -n "('done','failed')" src/coord/store.ts
```
Expected: a count ≥ 6 and the lines. Write the count into your commit message in Step 12 — it is the "before" of D-2800. Also run `grep -rn "('done','failed')" src --include=*.ts | grep -v store.ts` and note any hit outside `store.ts` (expected: none in `src/coord/routes.ts`; if `schema.ts` has one inside a migration string, LEAVE IT — migrations are frozen).

- [ ] **Step 2: Write the failing partition test**

Create `server/test/run-states.test.ts`:
```ts
// Spec 2026-09-14 §7.1-7.2: every RunState is classified ONCE — active, idle
// or terminal — and the cap counts exactly the active ones. The dangerous
// direction for a cap is UNDER-counting (it over-dispatches silently), so this
// suite pins the partition rather than trusting a negative-form SQL predicate.
import { describe, it, expect } from 'vitest';
import {
  ACTIVE_RUN_STATES, IDLE_RUN_STATES, TERMINAL_RUN_STATES, RUN_STATES, RUN_TRANSITIONS,
  type RunState,
} from '../../shared/api.js';

describe('run-state classification (spec §7.1)', () => {
  const lists: Record<string, readonly RunState[]> = {
    ACTIVE_RUN_STATES, IDLE_RUN_STATES, TERMINAL_RUN_STATES,
  };

  it('places every RunState in exactly one list', () => {
    for (const s of RUN_STATES) {
      const homes = Object.entries(lists).filter(([, l]) => l.includes(s)).map(([n]) => n);
      expect(homes, `${s} is classified ${homes.length} times: ${homes.join(', ')}`).toHaveLength(1);
    }
  });

  it('classifies nothing that is not a RunState, and covers all of them', () => {
    const union = [...ACTIVE_RUN_STATES, ...IDLE_RUN_STATES, ...TERMINAL_RUN_STATES].sort();
    expect(union).toEqual([...RUN_STATES].sort());
  });

  it('counts `unknown` as ACTIVE — the safe direction for a cap', () => {
    expect(ACTIVE_RUN_STATES).toContain('unknown');
    expect(TERMINAL_RUN_STATES).not.toContain('unknown');
  });

  it('agrees with the transition table about what is terminal — except `unknown`, which has no edges for a different reason', () => {
    const noExit = (Object.keys(RUN_TRANSITIONS) as RunState[])
      .filter((s) => RUN_TRANSITIONS[s].length === 0 && s !== 'unknown').sort();
    expect([...TERMINAL_RUN_STATES].sort()).toEqual(noExit);
    for (const s of [...ACTIVE_RUN_STATES, ...IDLE_RUN_STATES]) {
      if (s === 'unknown') continue;
      expect(RUN_TRANSITIONS[s].length, `${s} is non-terminal but has no exit`).toBeGreaterThan(0);
    }
  });

  it('names the two states a dispatched session is actually busy in, and only those', () => {
    expect([...ACTIVE_RUN_STATES].filter((s) => s !== 'unknown').sort()).toEqual(['dispatched', 'working']);
    expect([...IDLE_RUN_STATES].sort()).toEqual(['awaiting-review', 'closing', 'merging', 'planned']);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/run-states.test.ts`
Expected: FAIL — `ACTIVE_RUN_STATES` is not exported from `shared/api.ts` (a TS/ESM import error).

- [ ] **Step 4: Define the three lists in L0**

In `shared/api.ts`, immediately AFTER the `RUN_TRANSITIONS` object (its closing `});` is line 3748), add:
```ts
/**
 * THE PARTITION OF `RunState` THE DISPATCH CAP READS (design 2026-09-14 §7.1).
 * Three lists, spelled ONCE, and `run-states.test.ts` pins that every
 * `RunState` sits in exactly one of them — so a future state cannot be
 * silently UNCOUNTED, which is the dangerous direction for a cap (an
 * uncounted busy session over-dispatches the fleet without a word).
 *
 * ACTIVE = a dispatched session is doing work: `dispatched`, `working`. Both
 * kinds of run (`RunKind`) are busy in exactly these two. `unknown` is here
 * for the cap's own safe direction: a row whose state this build cannot name
 * COUNTS, wedging visibly and fixably, rather than not counting and
 * over-dispatching silently — and that is today's behaviour too, since
 * `unknown` was never in `('done','failed')`.
 *
 * IDLE = the coordinator's states: the session beneath them is idle by
 * contract (a worker stops pushing at `wave-done`, worker skill clause 9), so
 * it holds a workspace but not a fleet slot. `planned` has never been
 * dispatched (D-13's own narrowing, kept); `awaiting-review`, `merging` and
 * `closing` are waits on the coordinator, not on the worker — run 43 sat at
 * `merging` for hours on 2026-09-14 with its worker idle throughout.
 *
 * TERMINAL = the pair nothing leaves. `store.ts` builds its SQL fragments
 * from these by `.join`, the `TERMINAL_DELIVERY_SQL` idiom, and
 * `single-definition.test.ts` refuses a second hand-written copy of either
 * list anywhere under the four roots. `unknown` is NOT terminal: it has no
 * outgoing edge in `RUN_TRANSITIONS` because nothing may transition a state
 * this build cannot name — not because such a row is finished (D-2794).
 */
export const ACTIVE_RUN_STATES = ['dispatched', 'working', 'unknown'] as const satisfies
  readonly RunState[];
export const IDLE_RUN_STATES = ['planned', 'awaiting-review', 'merging', 'closing'] as const satisfies
  readonly RunState[];
export const TERMINAL_RUN_STATES = ['done', 'failed'] as const satisfies readonly RunState[];
```

- [ ] **Step 5: Run the partition test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/run-states.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the failing store tests (idle states leave the count)**

In `server/test/coord-store.test.ts`, inside `describe('CoordStore: caps', …)` (starts `:409`), after the D-13 test, add:
```ts
  it('stops counting a run the moment it reaches an IDLE state, and counts it again at working (spec §7.1)', () => {
    const s = store();
    const now = 1_000_000_000_000;
    const a = openRun(s) as { id: number };
    s.markDispatched(a.id, 'ccrc-pwa-quiet-mesa', 'quiet-mesa', 'ws/quiet-mesa', false, now);
    expect(s.capsUsage(now).running).toBe(1);                 // dispatched: active
    expect(s.advance(a.id, 'working', 'test').ok).toBe(true);
    expect(s.capsUsage(now).running).toBe(1);                 // working: active
    expect(s.advance(a.id, 'awaiting-review', 'test').ok).toBe(true);
    expect(s.capsUsage(now).running).toBe(0);                 // the worker is idle by contract
    expect(s.advance(a.id, 'working', 'test').ok).toBe(true); // a send-back
    expect(s.capsUsage(now).running).toBe(1);
    expect(s.advance(a.id, 'awaiting-review', 'test').ok).toBe(true);
    expect(s.advance(a.id, 'merging', 'test').ok).toBe(true);
    expect(s.capsUsage(now).running).toBe(0);                 // merging: the coordinator's wait
    expect(s.advance(a.id, 'closing', 'test').ok).toBe(true);
    expect(s.capsUsage(now).running).toBe(0);
    expect(s.advance(a.id, 'done', 'test').ok).toBe(true);
    expect(s.capsUsage(now).running).toBe(0);
    // `dispatchedIn24h` is untouched by state: one dispatch happened.
    expect(s.capsUsage(now).dispatchedIn24h).toBe(1);
  });

  it('still counts an `unknown`-state row — a state this build cannot name must wedge, not over-dispatch', () => {
    const s = store();
    const now = 1_000_000_000_000;
    const a = openRun(s) as { id: number };
    s.markDispatched(a.id, 'ccrc-pwa-quiet-mesa', 'quiet-mesa', 'ws/quiet-mesa', false, now);
    // The one way such a row exists: written by a newer build. Planted raw.
    s.db.prepare("UPDATE runs SET state = 'x-from-a-newer-build' WHERE id = ?").run(a.id);
    expect(s.capsUsage(now).running).toBe(1);
  });
```
(`store()` and `openRun()` are this file's existing helpers — read their definitions at the top of the file before using them; `s.db` is the store's public `DatabaseSync`, the same handle `tx(coord.db, …)` uses in `routes.ts:1245`.)

- [ ] **Step 7: Run them to verify the first fails and the second passes**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts -t "IDLE state|unknown.-state row"`
Expected: the IDLE test FAILS at `expect(s.capsUsage(now).running).toBe(0)` after `awaiting-review` (today's predicate counts it: received 1); the `unknown` test PASSES already (that is the "preserves today's behaviour" claim of §7.1, measured).

- [ ] **Step 8: Derive the cap in `store.ts`**

(a) Import. `store.ts:27` currently reads `RUN_TRANSITIONS, TERMINAL_DELIVERY_STATES,` inside the `shared/api.js` import; add `IDLE_RUN_STATES, TERMINAL_RUN_STATES,` to that same import list.

(b) Delete the private derivation at `:44-48` (the docstring "The run states nothing can leave — DERIVED from `RUN_TRANSITIONS`…" and the `const TERMINAL_RUN_STATES` that follows). The imported L0 pair takes its name. Amend the two comments that describe the old derivation — `:902` ("`TERMINAL_RUN_STATES` is DERIVED from…") and `:4371` — to say the pair is L0's `TERMINAL_RUN_STATES` (`shared/api.ts`), D-2794.

(c) Beside `TERMINAL_DELIVERY_SQL` (`:414`) add the two run-state fragments:
```ts
/** The cap's predicate, NEGATIVE over everything that is not active — the idle
 *  and terminal lists, both L0, joined the way `TERMINAL_DELIVERY_SQL` is
 *  (design 2026-09-14 §7.1 as corrected by D-2803): a raw state token this build
 *  cannot name is neither idle nor terminal and so COUNTS, which is the safe
 *  direction for a cap and the reason `unknown` sits in `ACTIVE_RUN_STATES`. */
const INACTIVE_RUN_STATES_SQL = `('${[...IDLE_RUN_STATES, ...TERMINAL_RUN_STATES].join("','")}')`;
/** Every "still open" predicate in this file — `runs()`, `programOpenRunCount`,
 *  `openRunsForSession`, the strands query, `advanceInner`'s `closedAt` CASE —
 *  names this fragment and never the literal pair (D-2800; pinned by
 *  `single-definition.test.ts`). */
const TERMINAL_RUN_STATES_SQL = `('${TERMINAL_RUN_STATES.join("','")}')`;
```

(d) `capsUsage` (`:2476-2478`): replace the SQL string with
```ts
      `SELECT count(*) AS c FROM runs WHERE dispatchedAt IS NOT NULL AND state NOT IN ${INACTIVE_RUN_STATES_SQL}`,
```
and extend the D-13 comment above it with one paragraph: "Since design 2026-09-14 §7.1 (as corrected by D-2803) the predicate excludes the IDLE and TERMINAL lists — `state NOT IN idle ∪ terminal` — so a run at `awaiting-review`, `merging` or `closing` stops counting the moment it gets there: the session beneath those states is idle by contract, and an idle worker holding a fleet slot is what blocked wave 6 of account-pools on 2026-09-14 (runs 39/40, 110 h at awaiting-review). D-13's principle is kept and sharpened: this names the runs whose session is WORKING."

(e) The sweep (D-2800): replace EVERY `('done','failed')` literal in `store.ts` you counted in Step 1 with `${TERMINAL_RUN_STATES_SQL}` — this means turning single-quoted SQL strings that contain it into template literals. Two shapes appear:
  - `"… NOT IN ('done','failed') …"` → `` `… NOT IN ${TERMINAL_RUN_STATES_SQL} …` ``
  - `advanceInner`'s `"UPDATE runs SET state = ?, closedAt = CASE WHEN ? IN ('done','failed') THEN ? ELSE closedAt END "` → `` `UPDATE runs SET state = ?, closedAt = CASE WHEN ? IN ${TERMINAL_RUN_STATES_SQL} THEN ? ELSE closedAt END ` ``
  - `runs()`'s `includeClosed` arm also has `state IN ('done','failed')` (`:1972`) → `state IN ${TERMINAL_RUN_STATES_SQL}`.

(f) The strands query at `:1829-1833` currently builds its placeholder list from the (now L0) `TERMINAL_RUN_STATES` (`…NOT IN (${TERMINAL_RUN_STATES.map(() => '?').join(', ')})` bound with `...TERMINAL_RUN_STATES`). Leave that mechanism as is — it derives from the same constant — but its membership changed (no `unknown`, D-2794); add one comment line above it: `// D-2794: the pair is L0's; an \`unknown\` row is LIVE here, as everywhere.`

- [ ] **Step 9: Run the store suite and the partition suite**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/run-states.test.ts`
Expected: PASS. If a test that depended on `unknown` being terminal in the strands query reds, read it: the spec's classification is authoritative, update the expectation and cite D-2794 in the test comment.

- [ ] **Step 10: Write the single-definition scan, and measure it red first**

In `server/test/single-definition.test.ts`, directly after the `it('spells the delivery terminal pair ONCE in JS too …')` block (ends near `:670`), add:
```ts
  it('spells the run-state lists ONCE — ACTIVE_RUN_STATES / TERMINAL_RUN_STATES, never a hand-written SQL list (D-2800)', () => {
    expect(ALL.map(rel)).not.toContain('server/test/single-definition.test.ts');

    // Adjacent quoted pairs/triples of the two lists, in either order, with any
    // spacing — the shapes a copy actually takes in SQL or JS.
    const TERMINAL_PAIR = /\(\s*'(done|failed)'\s*,\s*'(done|failed)'\s*\)/;
    const ACTIVE_LIST = /\(\s*'(dispatched|working|unknown)'\s*,\s*'(dispatched|working|unknown)'\s*(?:,\s*'(dispatched|working|unknown)'\s*)?\)/;
    expect(TERMINAL_PAIR.test("NOT IN ('done','failed')")).toBe(true);
    expect(TERMINAL_PAIR.test("IN ( 'failed', 'done' )")).toBe(true);
    expect(ACTIVE_LIST.test("IN ('dispatched','working','unknown')")).toBe(true);
    expect(ACTIVE_LIST.test("IN ('queued','delivered')")).toBe(false);

    const holders = ALL.filter((f) => {
      const t = readFileSync(f, 'utf8');
      return TERMINAL_PAIR.test(t) || ACTIVE_LIST.test(t);
    }).map(rel).sort();
    // `schema.ts` is exempt for FROZEN migration strings only; nothing else may hold the literal.
    expect(holders.filter((h) => h !== 'server/src/coord/schema.ts'),
      'a hand-written SQL list of the run-state pair/triple').toEqual([]);

    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(/export const ACTIVE_RUN_STATES = \['dispatched', 'working', 'unknown'\] as const/);
    expect(api).toMatch(/export const TERMINAL_RUN_STATES = \['done', 'failed'\] as const/);
    for (const name of ['ACTIVE_RUN_STATES', 'IDLE_RUN_STATES', 'TERMINAL_RUN_STATES']) {
      const defs = ALL.filter((f) =>
        new RegExp(`^\\s*(?:export )?const ${name}\\b`, 'm').test(readFileSync(f, 'utf8'))).map(rel);
      expect(defs, name).toEqual(['shared/api.ts']);
    }

    const store = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');
    expect(store).toMatch(/const INACTIVE_RUN_STATES_SQL =\s*\n?\s*`\('\$\{\[\.\.\.IDLE_RUN_STATES, \.\.\.TERMINAL_RUN_STATES\]\.join\("','"\)\}'\)`/);
    expect(store).toMatch(/const TERMINAL_RUN_STATES_SQL =\s*\n?\s*`\('\$\{TERMINAL_RUN_STATES\.join\("','"\)\}'\)`/);
    expect(store, 'capsUsage no longer reads the active fragment')
      .toMatch(/dispatchedAt IS NOT NULL AND state NOT IN \$\{INACTIVE_RUN_STATES_SQL\}/);
    // The sweep's floor: at least six `TERMINAL_RUN_STATES_SQL` consumers in store.ts (measured in Task 1 step 1).
    expect((store.match(/\$\{TERMINAL_RUN_STATES_SQL\}/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
```
Note the `defs` regex tolerates the deleted private `const TERMINAL_RUN_STATES` in `store.ts` ONLY by its absence — if Step 8(b) was skipped this line names `server/src/coord/store.ts` as a second holder, which is the point.

MEASURE THE RED: temporarily restore one literal — change `capsUsage`'s SQL back to `… state NOT IN ('done','failed')` — run `./node_modules/.bin/vitest run test/single-definition.test.ts -t "run-state lists ONCE"`, expect FAIL on `holders` (naming `server/src/coord/store.ts`) AND on the `capsUsage` match. Restore the derived form (re-apply Step 8(d) exactly), re-run, expect PASS.

- [ ] **Step 11: Mutation check on the classification pin**

In `shared/api.ts` temporarily move `'unknown'` out of `ACTIVE_RUN_STATES` and into NO list (delete it from the tuple). Run `./node_modules/.bin/vitest run test/run-states.test.ts` — expect FAIL on "places every RunState in exactly one list" (`unknown is classified 0 times`) and on "covers all of them". Also run `./node_modules/.bin/tsc -p tsconfig.json --noEmit` from `server/` — `satisfies readonly RunState[]` still holds, so the RED is the test's, not the compiler's; that is why the pin exists. Restore exactly.

- [ ] **Step 12: Typecheck and commit**

Run: `cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/vitest run test/run-states.test.ts test/coord-store.test.ts test/single-definition.test.ts test/run-routes.test.ts`
Expected: all PASS. (`run-routes.test.ts`'s existing cap test at `:814` uses a `dispatched` blocker, so it stays green.)
```bash
git add shared/api.ts server/src/coord/store.ts server/test/run-states.test.ts server/test/coord-store.test.ts server/test/single-definition.test.ts
git commit -F - <<'MSG'
feat(coord): the dispatch cap counts ACTIVE runs — awaiting-review, merging, closing and planned leave the count

ACTIVE_RUN_STATES / IDLE_RUN_STATES / TERMINAL_RUN_STATES are defined once in
shared/api.ts and every RunState sits in exactly one (run-states.test.ts).
capsUsage().running is now `dispatchedAt IS NOT NULL AND state NOT IN <idle ∪ terminal>`;
an idle worker no longer holds a fleet slot (design 2026-09-14 §7.1).

D-2794: store.ts's private TERMINAL_RUN_STATES (derived, included `unknown`)
is replaced by the L0 pair; the strands query now counts an unknown row live.
D-2800: <N> hand-written ('done','failed') literals in store.ts swept to
TERMINAL_RUN_STATES_SQL; single-definition.test.ts refuses a second copy.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```
Replace `<N>` with the Step 1 count.

---

### Task 2: Re-entry cap check on `advance → working`

**Files:**
- Modify: `server/src/coord/routes.ts:1568-1589` (the advance handler, between the transition check and `verifyDone`), `:34` (import)
- Modify (D-2805): `server/src/coord/dispatch.ts` — `capsMeasured(coord)` beside `dispatchRun`, and `dispatchRun`'s own cap block reads through it
- Test: `server/test/run-routes.test.ts` (inside `describe('POST /api/runs/:id/advance (review findings 1/15)', …)`, `:2640+`); `server/test/coord-caps-route.test.ts` stays green untouched

**Interfaces:**
- Consumes: `IDLE_RUN_STATES` (Task 1); `coord.caps()`, `coord.capsUsage()` (`store.ts:2416`, `:2463`); the advance route's `reject: { code, … }` envelope (`routes.ts:1569`).
- Produces: a 409 `{ ok:false, reject: { code:'cap-concurrency', limit, running } }` from `POST /api/runs/:id/advance` when `to:'working'` from an idle state would exceed `maxConcurrentWorkers`. Task 11's coordinator skill documents it.

- [ ] **Step 1: Write the failing test**

Add to the advance describe in `run-routes.test.ts` (after the `'refuses an out-of-scope target'` test, `:2681`):
```ts
  it('re-entering `working` from awaiting-review takes the cap check — a send-back on a full fleet is refused honestly (spec §7.2)', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-reentry'] });
    const w = await openApp(home, run); app = w.app;
    w.coord.setCaps({ maxConcurrentWorkers: 1, maxSessionsPerDay: 12 });
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);                       // running = 1 (dispatched)
    expect(w.coord.advance(opened.id, 'working', 'test').ok).toBe(true);
    expect(w.coord.advance(opened.id, 'awaiting-review', 'test').ok).toBe(true);
    expect(w.coord.capsUsage().running).toBe(0);              // Task 1: idle leaves the count
    // Another programme takes the one slot.
    const blocker = w.coord.openRun({ program: 'other', title: 'Other', project: PROJECT,
      wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-other' }) as { id: number };
    w.coord.markDispatched(blocker.id, 'demo-blocker', 'blocker', 'ws/blocker', false);
    expect(w.coord.capsUsage().running).toBe(1);

    const res = await postAdvance(app, opened.id,
      { to: 'working', fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: '' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, reject: { code: 'cap-concurrency', limit: 1, running: 1 } });
    // The run did not move.
    expect(okRun(w.coord.run(opened.id))!.state).toBe('awaiting-review');
  });

  it('does NOT cap-check dispatched -> working: a run already counted may always start working', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-start'] });
    const w = await openApp(home, run); app = w.app;
    w.coord.setCaps({ maxConcurrentWorkers: 1, maxSessionsPerDay: 12 });
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);                       // running = 1 = the cap, and it is THIS run
    const res = await postAdvance(app, opened.id,
      { to: 'working', fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: '' } });
    expect(res.statusCode).toBe(200);
    expect(okRun(w.coord.run(opened.id))!.state).toBe('working');
  });
```

- [ ] **Step 2: Run to verify the first fails**

Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts -t "re-entering|does NOT cap-check"`
Expected: the re-entry test FAILS (200, the run moved to `working`); the second PASSES already (it is the control that the check must not break).

- [ ] **Step 3: Add the check — through ONE measured read (D-2805)**

(a) In `server/src/coord/dispatch.ts`, directly ABOVE `export async function dispatchRun(`, add:
```ts
/**
 * THE CAP, MEASURED ONCE AND DECIDED ONCE (design 2026-09-14 §7.2 pin 2; D-2805).
 * Two routes refuse on the concurrency cap — `dispatchRun` below and
 * `POST /api/runs/:id/advance` when a run re-enters `working` from an idle
 * state — and both take their numbers from this one read, so the refusal's
 * arithmetic is spelled here and nowhere else. It reads `coord` rather than
 * taking the pair as arguments because `coord-caps-route.test.ts` pins that
 * `routes.ts` spells `.capsUsage(` exactly once (the caps VIEW); a route that
 * needs the numbers for a refusal asks here and never reads them itself.
 * `overConcurrency` carries the numbers a refusal must say (the caps doctrine:
 * a cap that refuses without saying what it is is indistinguishable from a bug).
 */
export function capsMeasured(coord: CoordStore): {
  caps: CoordCaps; usage: CoordCapsUsage;
  overConcurrency: { limit: number; running: number } | null;
} {
  const caps = coord.caps();
  const usage = coord.capsUsage();
  const overConcurrency = usage.running >= caps.maxConcurrentWorkers
    ? { limit: caps.maxConcurrentWorkers, running: usage.running }
    : null;
  return { caps, usage, overConcurrency };
}
```
Import `CoordCaps` and `CoordCapsUsage` types from `shared/api.js` on `dispatch.ts`'s existing import line. Then make `dispatchRun`'s own cap block (`:276-285`, the `// 2: caps.` block) READ THROUGH IT — replace
```ts
  const caps = coord.caps();
  const usage = coord.capsUsage();
  if (usage.running >= caps.maxConcurrentWorkers) {
    return { ok: false, kind: 'refused', code: 'cap-concurrency',
      limit: caps.maxConcurrentWorkers, running: usage.running };
  }
  if (usage.dispatchedIn24h >= caps.maxSessionsPerDay) {
```
with
```ts
  const { caps, usage, overConcurrency } = capsMeasured(coord);
  if (overConcurrency !== null) {
    return { ok: false, kind: 'refused', code: 'cap-concurrency', ...overConcurrency };
  }
  if (usage.dispatchedIn24h >= caps.maxSessionsPerDay) {
```
(the `cap-daily` arm below is unchanged and still reads the same `caps`/`usage` — one read, as before).

(b) In `routes.ts`, import `IDLE_RUN_STATES` from `shared/api.js` (the import at `:34` already names `RUN_TRANSITIONS`; add it there) and `capsMeasured` from `./dispatch.js` (the import that already names `dispatchRun`). Then in the advance handler, AFTER the `not-dispatched` check (`:1571-1573`) and BEFORE the `if (to === 'awaiting-review' || to === 'merging')` block (`:1577`), insert:
```ts
    // Spec 2026-09-14 §7.2 pin 2. Task 1 took the idle states out of
    // `capsUsage().running`, so the one legal edge back INTO an active state
    // — `awaiting-review`/`merging` -> `working`, a review sending work back
    // or a lost merge race — must take the cap check dispatch takes, or the
    // exclusion is a bypass. `dispatched -> working` is not checked: that run
    // is already counted. The numbers come from `capsMeasured` (D-2805), the
    // one reader both routes share; this file's own `.capsUsage(` stays the
    // caps view's alone, as `coord-caps-route.test.ts` pins.
    if (to === 'working' && (IDLE_RUN_STATES as readonly RunState[]).includes(run.state)) {
      const { overConcurrency } = capsMeasured(coord);
      if (overConcurrency !== null) {
        return reply.code(409).send({ ok: false, reject: { code: 'cap-concurrency', ...overConcurrency } });
      }
    }
```
Amend the route's docstring (`:1521-1525`, "Moving BACKWARD to `'working'` … re-measures NOTHING") with one sentence: "It does take the CAP check when it comes from an idle state (design 2026-09-14 §7.2) — retreating asserts no doneness, but it does re-occupy a fleet slot."

- [ ] **Step 4: Run to verify both pass, then measure the mutant**

Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts -t "re-entering|does NOT cap-check"` → PASS.
Mutant: comment out the whole inserted `if` block in `routes.ts`, re-run → the re-entry test FAILS (200). Restore exactly. Second mutant: change `includes(run.state)` to `true` (cap-check every `working` target) → the control test FAILS (409 on `dispatched -> working`). Restore. Third mutant: in `capsMeasured` change `>=` to `>` → the re-entry test FAILS (200 at limit) AND `run-routes.test.ts`'s existing dispatch cap test at `:814` FAILS — one arithmetic, two consumers, both red. Restore.

- [ ] **Step 5: Run the route suite and commit**

Run: `cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/vitest run test/run-routes.test.ts test/coord-caps-route.test.ts test/dispatch-hold-order.test.ts test/dispatch-mutex-gate.test.ts test/dispatch-adopt.test.ts`
```bash
git add server/src/coord/routes.ts server/src/coord/dispatch.ts server/test/run-routes.test.ts
git commit -F - <<'MSG'
feat(coord): advance -> working from an idle state takes the cap check

awaiting-review/merging -> working is a legal edge; Task 1 removed those
states from `running`, so re-entering must be cap-checked or the exclusion is
a bypass (design 2026-09-14 §7.2). Refused `cap-concurrency` with the numbers,
the same shape as dispatch; dispatched -> working is not checked, that run
already counts. Both routes read the cap through capsMeasured() in
dispatch.ts (D-2805) — routes.ts keeps its single .capsUsage(, the caps view.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 3: `runs.kind` / `runs.reviews` — migration, row plumbing, wire fields

**Files:**
- Modify: `shared/api.ts` (`RunKind` beside `RunState`, `:3664`; `RunSummary`, `:4758-4880`)
- Modify: `server/src/coord/schema.ts:871` (append `MIGRATIONS[10]` before the closing `];`)
- Modify: `server/src/coord/store.ts:295-307` (`RunRowDb`), `:319-325` (`RUN_ROW_COLUMNS`), `:354-381` (`RunNumbers`, `measureRunNumbers`), `:732-845` (`openRun`), `:2162-2194` (`hydrateRun`)
- Modify: `pwa/test/runs-screen.test.tsx:31-40` (the `r()` fixture) and every other full `RunSummary` literal the typecheck names
- Test: `server/test/coord-db.test.ts` (new describe after `:557`), `server/test/coord-store.test.ts`

**Interfaces:**
- Consumes: `isRunState`'s guard idiom (`shared/api.ts:3682`); migration 5's shape (`schema.ts:592-650`); `persistedInt` (`store.ts`, used by `measureRunNumbers`).
- Produces: `RunKind = 'work' | 'review' | 'unknown'`, `RUN_KINDS`, `isRunKind`; `RunSummary.kind: RunKind`, `RunSummary.reviews: number | null`; `openRun` input `{ …, kind?: RunKind; reviews?: number | null }`; `RunNumbers.reviews: number | null`; `RunRowDb.kind: string`, `RunRowDb.reviewsText: string | null`. Tasks 4–7, 9, 12 read `run.kind` / `run.reviews`.

- [ ] **Step 1: Write the failing migration test**

Append to `server/test/coord-db.test.ts` (after the migration-4 describe ends, `:557`):
```ts
describe('coord.db: migration 11 — runs.kind and runs.reviews (design 2026-09-14 §5.1)', () => {
  interface ColumnInfo { name: string; type: string; notnull: number; dflt_value: unknown }
  const runsColumn = (db: DatabaseSync, name: string): ColumnInfo | undefined =>
    (db.prepare('PRAGMA table_info(runs)').all() as unknown as ColumnInfo[]).find((c) => c.name === name);

  it('gives a fresh database both columns: kind NOT NULL DEFAULT work, reviews nullable with no default', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const kind = runsColumn(db, 'kind');
    expect(kind).toBeDefined();
    expect(kind!.type).toBe('TEXT');
    expect(kind!.notnull).toBe(1);
    expect(kind!.dflt_value).toBe("'work'");
    const reviews = runsColumn(db, 'reviews');
    expect(reviews).toBeDefined();
    expect(reviews!.type).toBe('INTEGER');
    expect(reviews!.notnull).toBe(0);
    expect(reviews!.dflt_value).toBeNull();
    db.close();
  });

  it('reaches a database ALREADY at user_version 10 and reads every existing row as a work run', () => {
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < 10; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec('PRAGMA user_version = 10');
      raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('p', 'P', 1, 'active')");
      raw.exec("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) " +
               "VALUES ('p', 1, 1, 'demo', 'working', 'c', 1)");
    });
    raw.close();
    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    expect(COORD_SCHEMA_VERSION).toBe(11);
    const row = db.prepare('SELECT kind, reviews FROM runs').get() as { kind: string; reviews: number | null };
    expect(row).toEqual({ kind: 'work', reviews: null });
    db.close();
  });
});
```
(`dbPathIn` is this file's existing helper; `MIGRATIONS`, `COORD_SCHEMA_VERSION`, `openCoordDb`, `tx`, `DatabaseSync`, `mkdirSync`, `path`, `mkTmp` are already imported at `:1-11`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts -t "migration 11"`
Expected: FAIL — `kind` column undefined; `COORD_SCHEMA_VERSION` is 10.

- [ ] **Step 3: Add the migration**

In `schema.ts`, after `MIGRATIONS[9]`'s closing template literal and comma (`:869-870`, the entry ending `ALTER TABLE feed_events ADD COLUMN runId INTEGER;`), before the array's `];`, add:
```ts
  // ── 11: user_version 10 -> 11 ─────────────────────────────────────────────
  // Review runs (design 2026-09-14 §5.1): a reviewer is a RUN of a new KIND,
  // reusing dispatch, mail, hold, slot and close rather than inventing a
  // lighter carrier. MIGRATIONS[0..9] ARE FROZEN, for the reason every entry
  // above states: db.ts's loop runs `for (v = current; v < COORD_SCHEMA_VERSION;
  // v++)`, so an amendment to an applied entry never runs again.
  //
  // `runs.kind` — 'work' | 'review'. NOT NULL DEFAULT 'work' on purpose, and
  // this is the ONE column in this file whose default is an assertion rather
  // than an overloaded null: every row that exists today IS a work run, with
  // no change of meaning, and a NULL here would say "kind unknown" about rows
  // whose kind is perfectly known. The revive path (`hydrateRun`) reads an
  // out-of-vocabulary token as `'unknown'`, the `RunState` idiom (D-2795).
  //
  // `runs.reviews` — the work run this review run reads; NULL on a work run.
  // Set at open, never updated. NULLABLE, NO DEFAULT: NULL means "this run
  // reviews nothing" — true of every work run — never "the reviewed run could
  // not be read". `REFERENCES runs(id)` with a NULL default is the one shape
  // SQLite's ALTER TABLE ADD COLUMN accepts for a foreign key.
  //
  // The index serves `reviewInFlightFor` — "is a non-terminal review run
  // already naming this work run" — which `POST /api/runs` asks on every
  // review open and `POST /api/runs/:id/advance` on every send-back.
  `
  ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'work';
  ALTER TABLE runs ADD COLUMN reviews INTEGER REFERENCES runs(id);
  CREATE INDEX runs_by_reviews ON runs(reviews);
  `,
```

- [ ] **Step 4: Run the migration test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts`
Expected: PASS (the whole file — an older test asserting `COORD_SCHEMA_VERSION` equals a literal 10 would red here; if one does, it is asserting the array length and must move to 11 with a one-line comment naming this migration).

- [ ] **Step 5: Define `RunKind` in L0**

In `shared/api.ts`, directly after `isRunState` (`:3684`), add:
```ts
/** What a run IS (design 2026-09-14 §5.1): `'work'` — a wave's worker, the only
 *  kind that existed before that design; `'review'` — a reviewer reading one
 *  work run's finished wave and reporting, never ruling. `'unknown'` is the
 *  designated we-do-not-know member on `RunState`'s own model (D-2795): NEVER
 *  WRITTEN, it is what a `kind` token from a newer build reads as, and
 *  `transitionsFor('unknown')` has no edges at all, so such a row can neither
 *  advance nor dispatch until a build that knows the word reads it. */
export type RunKind = 'work' | 'review' | 'unknown';
export const RUN_KINDS: readonly RunKind[] = ['work', 'review', 'unknown'];
/** Use THIS, never `RUN_KINDS.includes(x as RunKind)` — `isRunState`'s rule. */
export function isRunKind(v: unknown): v is RunKind {
  return typeof v === 'string' && (RUN_KINDS as readonly string[]).includes(v);
}
```

- [ ] **Step 6: Add the two wire fields to `RunSummary`**

In `shared/api.ts`, inside `RunSummary` immediately after `state: RunState;` (`:4787`), add:
```ts
  /** `'work'` or `'review'` (design 2026-09-14 §5.1). ADDITIVE; `FLEET_PROTO`
   *  is not bumped. REQUIRED here because `hydrateRun` returns a literal and
   *  must compute it; TOLERATED ABSENT at the one PWA reader (`runKindChip`,
   *  `pwa/src/fleet/runWords.ts`) because an older server omits it — absence
   *  means `'work'`, the only kind that older server knew. */
  kind: RunKind;
  /** On a review run, the id of the work run it reviews; `null` on a work run
   *  — a first-class answer ("reviews nothing"), never a failed read. Set at
   *  open, immutable. */
  reviews: number | null;
```

- [ ] **Step 7: Plumb the columns through the store**

(a) `RunRowDb` (`store.ts:295-307`): add `kind: string;` after `state: string;` and `reviewsText: string | null;` after `waveOfText`.

(b) `RUN_ROW_COLUMNS` (`:319-325`): change `'r.workspace, r.branch, r.state, r.claimedBy, '` to `'r.workspace, r.branch, r.state, r.kind, CAST(r.reviews AS TEXT) AS reviewsText, r.claimedBy, '`.

(c) `RunNumbers` (`:354`): `interface RunNumbers { id: number; wave: number; waveOf: number | null; reviews: number | null }`. `measureRunNumbers` (`:361-381`): its parameter type gains `reviewsText: string | null`; after `waveOf` is measured, add:
```ts
  // Same NULL rule as `waveOf`: absent is legitimate (every work run), and
  // `persistedInt` must not be asked to answer "absent" as well as "unrepresentable".
  const reviews = r.reviewsText === null ? { ok: true as const, value: null }
    : persistedInt(r.reviewsText, 'run reviews');
  if (!reviews.ok) return reviews;
```
and thread `reviews: reviews.value` into every `nums: { … }` literal the function returns (there are three: the early `waveOf === null` return needs restructuring so `reviews` is measured before it — measure `reviews` FIRST, right after `wave`, then keep the existing `waveOf` branches, each returning `nums: { id, wave, waveOf, reviews: reviews.value }`). Check the one other caller at `:2017` (`openRunsForSession`'s narrower row) — it passes a row WITHOUT `reviewsText`; add `reviewsText: null` to that row literal or widen its SELECT with `CAST(reviews AS TEXT) AS reviewsText`. Prefer the SELECT so the two reads keep agreeing.

(d) `hydrateRun` (`:2162-2194`): after `state: isRunState(row.state) ? row.state : 'unknown',` add
```ts
      kind: isRunKind(row.kind) ? row.kind : 'unknown',
      reviews: m.nums.reviews,
```
and import `isRunKind` from `shared/api.js` at `:27`.

(e) `openRun` (`:732-743`): the input type gains
```ts
    /** Design 2026-09-14 §5.1. Absent means `'work'` — every caller that
     *  predates review runs. `'unknown'` is refused at the route; the store
     *  writes only the two real kinds. */
    kind?: Extract<RunKind, 'work' | 'review'>;
    /** The work run a review run reads. Required by the ROUTE when
     *  `kind:'review'`; written as-is here. */
    reviews?: number | null;
```
The dup query (`:780-785`) gains `AND kind = ?` bound with `input.kind ?? 'work'` (so a review open's retry cannot reuse a planned work row of the same wave, and vice versa). The INSERT (`:812-821`) becomes
```ts
          'INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt, kind, reviews) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
```
with `.run(…, now, input.kind ?? 'work', input.reviews ?? null)`.

- [ ] **Step 8: Typecheck, and fix every fixture the compiler names**

Run: `cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit; cd ../pwa && ./node_modules/.bin/tsc -p tsconfig.json --noEmit; cd ../server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`
Expected: errors ONLY where a full `RunSummary` literal is built by hand — `pwa/test/runs-screen.test.tsx:31-40`'s `r()` fixture for certain (add `kind: 'work', reviews: null,` after `state: 'working',`), and any other `health: {` fixture literal in `pwa/test/` or `server/test/`. Fix each by adding the two fields with the work-run values. Re-run until clean. (If `tsc` for `pwa/` is not at that path, use `npm run typecheck` if `pwa/package.json` defines it — read the file.)

- [ ] **Step 9: Store tests for the round trip**

In `server/test/coord-store.test.ts`, add a describe:
```ts
describe('CoordStore: run kind (design 2026-09-14 §5.1)', () => {
  it('opens a work run by default and reads it back as kind work, reviews null', () => {
    const s = store();
    const a = openRun(s) as { id: number };
    const row = okRun(s.run(a.id))!;
    expect(row.kind).toBe('work');
    expect(row.reviews).toBeNull();
  });

  it('persists kind review and the reviewed id, and hydrates both', () => {
    const s = store();
    const w = openRun(s) as { id: number };
    const r = s.openRun({ program: 'build4', title: 'T', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'ccrc-pwa-coordinator', kind: 'review', reviews: w.id }) as { id: number };
    expect(r.id).not.toBe(w.id);   // the dup arm keys on kind too
    const row = okRun(s.run(r.id))!;
    expect(row.kind).toBe('review');
    expect(row.reviews).toBe(w.id);
    expect(okRun(s.run(w.id))!.reviews).toBeNull();
  });

  it('reads an out-of-vocabulary kind token as unknown, never as a raw string (D-2795)', () => {
    const s = store();
    const a = openRun(s) as { id: number };
    s.db.prepare("UPDATE runs SET kind = 'x-from-a-newer-build' WHERE id = ?").run(a.id);
    expect(okRun(s.run(a.id))!.kind).toBe('unknown');
  });
});
```
(`okRun` from `./coordReadHelpers.js` — import it if the file does not already; the `openRun` helper's argument shape is this file's own — read it, and if it does not pass through `kind`/`reviews`, call `s.openRun({...})` directly as the second test does. The `program`/`wave`/`waveOf`/`claimedBy` values in the second test must MATCH the helper's defaults so the `claimed-by-another` guard does not fire — read the helper first.)

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts -t "run kind"` → PASS.

- [ ] **Step 10: Run the suites and commit**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts test/coord-store.test.ts test/run-routes.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts && cd ../pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx`
```bash
git add shared/api.ts server/src/coord/schema.ts server/src/coord/store.ts server/test/coord-db.test.ts server/test/coord-store.test.ts pwa/test/runs-screen.test.tsx   # plus any other fixture file Step 8 touched
git commit -F - <<'MSG'
feat(coord): runs.kind and runs.reviews — a review is a run of a new kind (migration 11)

`kind TEXT NOT NULL DEFAULT 'work'` (every existing row is a work run, no
change of meaning) and `reviews INTEGER REFERENCES runs(id)` (NULL on a work
run). RunKind/RUN_KINDS/isRunKind in L0; RunSummary carries both, additive.
hydrateRun reads an unrecognised kind as 'unknown' (D-2795).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 4: Transitions by kind

**Files:**
- Modify: `shared/api.ts` (after `TERMINAL_RUN_STATES`, Task 1)
- Modify: `server/src/coord/store.ts:1462-1469` (`advanceInner`)
- Modify: `server/src/coord/close.ts:18` (import), `:176`, `:247`
- Modify: `server/src/coord/routes.ts:1568`
- Modify: `server/src/coord/dispatch.ts:190-192` (the `run.state !== 'planned'` precondition)
- Test: `server/test/run-states.test.ts`, `server/test/coord-store.test.ts`

**Interfaces:**
- Consumes: `RUN_TRANSITIONS` (`shared/api.ts:3738`), `RunKind` (Task 3), `run.kind` on `RunRow`.
- Produces: `REVIEW_RUN_TRANSITIONS`, `NO_RUN_TRANSITIONS`, `transitionsFor(kind): Readonly<Record<RunState, readonly RunState[]>>`. Every consumer of `RUN_TRANSITIONS` in `server/src/coord` reads through `transitionsFor(run.kind)` after this task — `grep -rn "RUN_TRANSITIONS\[" server/src` must return only `shared/api.ts`-internal uses and the `transitionsFor` definition.

- [ ] **Step 1: Write the failing table tests**

Append to `server/test/run-states.test.ts`:
```ts
import { REVIEW_RUN_TRANSITIONS, transitionsFor, RUN_KINDS } from '../../shared/api.js';

describe('transitions by kind (spec §5.2)', () => {
  it('a review run goes planned -> dispatched -> working -> done | failed and nowhere else', () => {
    expect(REVIEW_RUN_TRANSITIONS).toEqual({
      planned: ['dispatched', 'failed'],
      dispatched: ['working', 'failed'],
      working: ['done', 'failed'],
      'awaiting-review': [], merging: [], closing: [],
      done: [], failed: [], unknown: [],
    });
  });
  it('transitionsFor names the two tables and an empty one for unknown', () => {
    expect(transitionsFor('work')).toBe(RUN_TRANSITIONS);
    expect(transitionsFor('review')).toBe(REVIEW_RUN_TRANSITIONS);
    for (const s of RUN_STATES) expect(transitionsFor('unknown')[s]).toEqual([]);
  });
  it('every RunKind has a table whose keys are exactly RUN_STATES', () => {
    for (const k of RUN_KINDS) {
      expect(Object.keys(transitionsFor(k)).sort()).toEqual([...RUN_STATES].sort());
    }
  });
  it('a review run never reaches awaiting-review, merging or closing from any state', () => {
    for (const s of RUN_STATES) {
      for (const bad of ['awaiting-review', 'merging', 'closing'] as const) {
        expect(REVIEW_RUN_TRANSITIONS[s], `${s} -> ${bad}`).not.toContain(bad);
      }
    }
  });
});
```
(Merge the import into the existing import statement at the top of the file — ESM allows only one import per specifier in practice; `RUN_STATES`, `RUN_TRANSITIONS` are already imported.)

- [ ] **Step 2: Run to verify it fails** — `cd server && ./node_modules/.bin/vitest run test/run-states.test.ts` → FAIL, `REVIEW_RUN_TRANSITIONS` not exported.

- [ ] **Step 3: Define the tables and the selector in L0**

In `shared/api.ts`, after `TERMINAL_RUN_STATES` (Task 1), add:
```ts
/**
 * The REVIEW run's machine (design 2026-09-14 §5.2). A review run has no
 * `awaiting-review`, `merging` or `closing`: it has nothing to review, merge
 * or release-with-ceremony, and reusing those states would make the table lie
 * about what a row is doing. `failed` is reachable from every non-terminal
 * state, as in `RUN_TRANSITIONS`. `working -> done` is direct: the close route
 * skips the `closing` hop for this kind (`viaClosing: false`, the same skip
 * the abandon-of-a-planned-run already takes).
 *
 * Every state is a key so the two tables have one shape and one reader; the
 * three work-only states are dead ends here, never reached.
 */
export const REVIEW_RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = Object.freeze({
  planned:           ['dispatched', 'failed'],
  dispatched:        ['working', 'failed'],
  working:           ['done', 'failed'],
  'awaiting-review': [],
  merging:           [],
  closing:           [],
  done:              [],
  failed:            [],
  unknown:           [],
});

/** No edges at all — what a run of a kind this build cannot name may do (D-2795). */
export const NO_RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = Object.freeze({
  planned: [], dispatched: [], working: [], 'awaiting-review': [], merging: [], closing: [],
  done: [], failed: [], unknown: [],
});

/**
 * THE ONE READER of the transition tables. Every route and the store's own
 * `advanceInner` consult this by the run's kind; nothing indexes
 * `RUN_TRANSITIONS` or `REVIEW_RUN_TRANSITIONS` directly outside this file
 * (pinned by `run-states.test.ts`'s source scan).
 */
export const transitionsFor = (kind: RunKind): Readonly<Record<RunState, readonly RunState[]>> =>
  kind === 'work' ? RUN_TRANSITIONS : kind === 'review' ? REVIEW_RUN_TRANSITIONS : NO_RUN_TRANSITIONS;
```

- [ ] **Step 4: Run the table tests** → PASS.

- [ ] **Step 5: Write the failing store test (advance by kind)**

Add to the `run kind` describe in `coord-store.test.ts` (Task 3):
```ts
  it('advances a review run working -> done directly, and refuses the work-only states (spec §5.2)', () => {
    const s = store();
    const w = openRun(s) as { id: number };
    const r = s.openRun({ program: 'build4', title: 'T', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'ccrc-pwa-coordinator', kind: 'review', reviews: w.id }) as { id: number };
    expect(s.advance(r.id, 'dispatched', 'test').ok).toBe(true);
    expect(s.advance(r.id, 'working', 'test').ok).toBe(true);
    expect(s.advance(r.id, 'awaiting-review', 'test'))
      .toEqual({ ok: false, error: 'bad-transition', from: 'working', to: 'awaiting-review' });
    expect(s.advance(r.id, 'closing', 'test').ok).toBe(false);
    expect(s.advance(r.id, 'done', 'test').ok).toBe(true);
    expect(okRun(s.run(r.id))!.closedAt).not.toBeNull();
  });

  it('refuses every advance on a run whose kind this build cannot name (D-2795)', () => {
    const s = store();
    const a = openRun(s) as { id: number };
    s.db.prepare("UPDATE runs SET kind = 'x-newer' WHERE id = ?").run(a.id);
    expect(s.advance(a.id, 'dispatched', 'test'))
      .toEqual({ ok: false, error: 'bad-transition', from: 'planned', to: 'dispatched' });
  });
```
Run `-t "advances a review run|kind this build cannot name"` → both FAIL (today `working -> done` is refused and `working -> awaiting-review` allowed; the unknown-kind advance succeeds).

- [ ] **Step 6: Make the store consult the table by kind**

`store.ts` `advanceInner` (`:1462-1469`): read `kind` with `state`:
```ts
    const row = this.db.prepare('SELECT state, kind FROM runs WHERE id = ?').get(runId) as
      { state: string; kind: string } | undefined;
    if (!row) return { ok: false as const, error: 'unknown-run' as const };
    const from = isRunState(row.state) ? row.state : 'unknown';
    const kind = isRunKind(row.kind) ? row.kind : 'unknown';
    if (!(transitionsFor(kind)[from] as readonly string[]).includes(to)) {
      return { ok: false as const, error: 'bad-transition' as const, from, to };
    }
```
Import `transitionsFor` (and `isRunKind` if Task 3 did not) at `:27`. Remove `RUN_TRANSITIONS` from the import IF nothing else in `store.ts` reads it after this change (`grep -n "RUN_TRANSITIONS" src/coord/store.ts` — comments may still mention it; only code matters to the import). Update `advance`'s docstring (`:1440-1450`) with one sentence: "The table consulted is the run's KIND's (`transitionsFor`, design 2026-09-14 §5.2) — this is the LAST gate; the routes' checks are the first, and both read one table."

- [ ] **Step 7: Move the three route-side readers to `transitionsFor`**

- `close.ts:176` → `if (!transitionsFor(run.kind)[run.state].includes(target))`; `:247` → `if (!transitionsFor(run.kind)[run.state].includes('closing'))`. Import `transitionsFor` at `:18` in place of `RUN_TRANSITIONS`.
- `routes.ts:1568` → `if (!(transitionsFor(run.kind)[run.state] as readonly RunState[]).includes(to))`. Import at `:34`.
- `dispatch.ts:190-192`: replace `if (run.state !== 'planned') { return { ok: false, kind: 'bad-transition', from: run.state, to: 'dispatched' }; }` with
```ts
  if (!transitionsFor(run.kind)[run.state].includes('dispatched')) {
    return { ok: false, kind: 'bad-transition', from: run.state, to: 'dispatched' };
  }
```
(identical for both real kinds — only `planned` reaches `dispatched` — and it refuses a `kind:'unknown'` row BEFORE any fleet act, D-2795). Import `transitionsFor`.

Then: `grep -rn "RUN_TRANSITIONS\[" server/src` → expected: no hits (every indexer now goes through `transitionsFor`). Add this scan to `run-states.test.ts`:
```ts
  it('nothing under server/src indexes a transition table directly — transitionsFor is the one reader', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.name.startsWith('__') ? [] : e.isDirectory() ? walk(path.join(d, e.name))
        : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
    const offenders = walk(root).filter((f) => /\b(RUN_TRANSITIONS|REVIEW_RUN_TRANSITIONS)\[/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
```
(add `readdirSync`, `readFileSync` from `node:fs`, `path`, `fileURLToPath` imports.)

- [ ] **Step 8: Run, mutate, restore**

Run: `cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/vitest run test/run-states.test.ts test/coord-store.test.ts test/run-routes.test.ts test/coord-abandon.test.ts test/dispatch-hold-order.test.ts` → PASS.
Mutant (spec §11 "let a review run reach awaiting-review"): in `REVIEW_RUN_TRANSITIONS` set `working: ['awaiting-review', 'done', 'failed']` → `run-states.test.ts` FAILS twice and the store test's `toEqual({… bad-transition …})` FAILS. Restore exactly.

- [ ] **Step 9: Commit**
```bash
git add shared/api.ts server/src/coord/store.ts server/src/coord/close.ts server/src/coord/routes.ts server/src/coord/dispatch.ts server/test/run-states.test.ts server/test/coord-store.test.ts
git commit -F - <<'MSG'
feat(coord): REVIEW_RUN_TRANSITIONS and transitionsFor(kind) — one reader for both machines

A review run goes planned -> dispatched -> working -> done | failed; the
work-only states are dead ends for it (design 2026-09-14 §5.2). advanceInner
(the one writer of state), close, advance and dispatch all consult
transitionsFor(run.kind); a kind this build cannot name has no edges (D-2795).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 5: Opening a review run — `POST /api/runs` with `kind:'review'`

**Files:**
- Modify: `shared/api.ts:4542-4555` (`RunRefuseCode` + map + the "Seventeen codes" prose at `:4493-4494`)
- Modify: `server/src/coord/store.ts` (`OpenRunResult` `:85-88`; `openRun` `:744-766`; new `reviewInFlightFor` beside `programOpenRunCount` `:2109`)
- Modify: `server/src/coord/routes.ts:1141-1157` (body parse), `:1176-1226` (before `openRun`)
- Test: `server/test/run-routes.test.ts` (new describe)

**Interfaces:**
- Consumes: `TERMINAL_RUN_STATES_SQL` (Task 1), `openRun`'s `kind`/`reviews` (Task 3), `RunKind`.
- Produces: `CoordStore.reviewInFlightFor(workRunId: number): number | null`; `OpenRunResult`'s refused arm widened to `{ refused: 'claimed-by-another' | 'review-in-flight'; by: string }`; `RunRefuseCode` gains `'review-in-flight'`; the route's review-open contract (below). Task 6 reuses `reviewInFlightFor`; Task 11 documents the contract.

**The contract this task implements (spec §5.1, D-2799):** body `{ program, title, kind:'review', reviews:<workRunId>, claimedBy, homeProject? }`. `reviews` is REQUIRED iff `kind:'review'` and FORBIDDEN otherwise (400 `bad-request`, detail names the field). The reviewed run must exist (400, `reviews names no run`), be `kind:'work'` (400), be at `awaiting-review` (400, `reviews must name a run at awaiting-review, not <state>`), share `program` (400) and `claimedBy` (400 — spec: the one coordinator). `project`, `wave`, `waveOf` are DERIVED from the reviewed run; if the body carries any of them it must be identical (400 otherwise). `sessionId` on a review open is 400. A second non-terminal review run for the same `reviews` is 409 `{ ok:false, refused:'review-in-flight', by:'<reviewRunId>' }`. `kind` absent means `'work'`; `kind:'unknown'` or any other token is 400.

- [ ] **Step 1: Write the failing route tests**

Add a new describe to `run-routes.test.ts`:
```ts
describe('POST /api/runs kind:review (design 2026-09-14 §5.1)', () => {
  let app: FastifyInstance;
  afterEach(async () => { await app.close(); });

  /** A work run positioned at awaiting-review through the store — the route's
   *  verifyDone is Task 7's concern, not this describe's. */
  const workAtReview = async (home: string) => {
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w1'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    expect(w.coord.advance(opened.id, 'working', 'test').ok).toBe(true);
    expect(w.coord.advance(opened.id, 'awaiting-review', 'test').ok).toBe(true);
    return { w, workId: opened.id };
  };
  const REVIEW = (workId: number, over: Record<string, unknown> = {}) =>
    ({ program: OPEN_BODY.program, title: 'Review wave 1', kind: 'review', reviews: workId,
       claimedBy: CLAIMED_BY, ...over });

  it('opens a review run that derives project, wave and waveOf from the run it reviews', async () => {
    const home = mkTmp('ccrc-runs-');
    const { w, workId } = await workAtReview(home);
    const res = await postOpen(app, REVIEW(workId));
    expect(res.statusCode).toBe(200);
    const { id } = res.json() as { id: number };
    const row = okRun(w.coord.run(id))!;
    expect(row).toMatchObject({ kind: 'review', reviews: workId, project: PROJECT, wave: 1, waveOf: 3,
      claimedBy: CLAIMED_BY, state: 'planned', sessionId: null });
    // Its hold reason is the worker's wave and its OWN id (spec §5.4) — the existing grammar.
    expect(holdReasonVerdict(row.program, row.wave, row.waveOf, row.id)).toMatchObject({ ok: true,
      reason: `program:${OPEN_BODY.program} wave:1/3 run:${id}` });
  });

  it('refuses a second non-terminal review run for the same work run: review-in-flight', async () => {
    const home = mkTmp('ccrc-runs-');
    const { workId } = await workAtReview(home);
    const first = (await postOpen(app, REVIEW(workId))).json() as { id: number };
    const res = await postOpen(app, REVIEW(workId, { title: 'Again' }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'review-in-flight', by: String(first.id) });
  });

  it('allows a new review run once the previous one is terminal', async () => {
    const home = mkTmp('ccrc-runs-');
    const { w, workId } = await workAtReview(home);
    const first = (await postOpen(app, REVIEW(workId))).json() as { id: number };
    expect(w.coord.advance(first.id, 'failed', 'test').ok).toBe(true);
    expect((await postOpen(app, REVIEW(workId, { title: 'R2' }))).statusCode).toBe(200);
  });

  it.each([
    ['reviews absent', (id: number) => ({ ...REVIEW(id), reviews: undefined }), 'reviews'],
    ['reviews on a work run', (id: number) => ({ ...OPEN_BODY, wave: 2, reviews: id }), 'reviews'],
    ['kind unknown', (id: number) => REVIEW(id, { kind: 'unknown' }), 'kind'],
    ['a sessionId', (id: number) => REVIEW(id, { sessionId: 'demo-w1' }), 'sessionId'],
    ['a different project', (id: number) => REVIEW(id, { project: 'elsewhere' }), 'project'],
    ['a different wave', (id: number) => REVIEW(id, { wave: 2 }), 'wave'],
    ['a different program', (id: number) => REVIEW(id, { program: 'other' }), 'program'],
    ['a different claimedBy', (id: number) => REVIEW(id, { claimedBy: 'ccrc-pwa-other' }), 'claimedBy'],
    ['a run that does not exist', () => REVIEW(999_999), 'reviews'],
  ])('refuses %s as bad-request, naming the field', async (_what, body, field) => {
    const home = mkTmp('ccrc-runs-');
    const { workId } = await workAtReview(home);
    const res = await postOpen(app, body(workId));
    expect(res.statusCode).toBe(400);
    const j = res.json() as { ok: boolean; error: string; detail: string };
    expect(j).toMatchObject({ ok: false, error: 'bad-request' });
    expect(j.detail).toContain(field);
  });

  it('refuses to review a run that is not at awaiting-review, naming its state', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-w1'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);                       // dispatched, not awaiting-review
    const res = await postOpen(app, REVIEW(opened.id));
    expect(res.statusCode).toBe(400);
    expect((res.json() as { detail: string }).detail).toContain('dispatched');
  });

  it('refuses to review a review run', async () => {
    const home = mkTmp('ccrc-runs-');
    const { workId } = await workAtReview(home);
    const r = (await postOpen(app, REVIEW(workId))).json() as { id: number };
    const res = await postOpen(app, REVIEW(r.id, { title: 'meta' }));
    expect(res.statusCode).toBe(400);
    expect((res.json() as { detail: string }).detail).toContain('kind');
  });

  it('a review run does not count against the cap until it is dispatched, and does once it is', async () => {
    const home = mkTmp('ccrc-runs-');
    const { w, workId } = await workAtReview(home);
    expect(w.coord.capsUsage().running).toBe(0);              // the idle worker (Task 1)
    const r = (await postOpen(app, REVIEW(workId))).json() as { id: number };
    expect(w.coord.capsUsage().running).toBe(0);              // planned
    w.coord.markDispatched(r.id, 'demo-r1', 'r1', 'ws/r1', false);
    expect(w.coord.capsUsage().running).toBe(1);              // the reviewer REPLACES the worker's slot (§5.4)
  });
});
```
Note: `postOpen(app, body)` passes `body` through `as Record<string, unknown>`; a key set to `undefined` is dropped by JSON serialisation, which is what the `reviews absent` row relies on.

- [ ] **Step 2: Run to verify they fail** — `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts -t "kind:review"` → FAIL (today the body's `kind`/`reviews` are ignored: the first test's `toMatchObject({kind:'review'})` fails; the bad-request rows return 200 or 400 for the wrong reason).

- [ ] **Step 3: The vocabulary**

`shared/api.ts:4542-4555`: add `| 'review-in-flight'` to `RunRefuseCode` and `'review-in-flight': true,` to `RUN_REFUSE_CODE_MAP`. Fix the prose at `:4493-4494`: "Eighteen codes exist below today; the next new one would be the nineteenth, not the ninth." Add a docstring line above the union naming it: "`review-in-flight` — a second non-terminal review run named the same `reviews`, or a send-back while one is open (design 2026-09-14 §5.1, §9 invariant 3)."

- [ ] **Step 4: The store**

(a) `OpenRunResult` (`store.ts:85-88`): `| { refused: 'claimed-by-another' | 'review-in-flight'; by: string }`.

(b) New method beside `programOpenRunCount` (`:2109`):
```ts
  /** The one NON-TERMINAL review run naming `workRunId`, or null (design
   *  2026-09-14 §5.1 — "one review run per work run at a time"). Read fresh at
   *  both decision points that need it: the review OPEN (inside `openRun`'s own
   *  transaction) and the send-back ADVANCE (routes). `TERMINAL_RUN_STATES_SQL`
   *  is L0's pair; an `unknown`-state review run is LIVE here (D-2794). */
  reviewInFlightFor(workRunId: number): number | null {
    const row = this.db.prepare(
      `SELECT CAST(id AS TEXT) AS idText FROM runs WHERE reviews = ? AND state NOT IN ${TERMINAL_RUN_STATES_SQL} ORDER BY id LIMIT 1`,
    ).get(workRunId) as { idText: string } | undefined;
    if (!row) return null;
    const id = Number(row.idText);
    return isPositiveDecimalSafeInteger(id) ? id : null;
  }
```
(Note the `null` on an unrepresentable id: a wedge that cannot be named is still a wedge — so in `openRun` below the check is `!== null`, and a malformed row reads as NOT in flight, which UNDER-refuses. Record that as a known narrowing in the docstring's last line: "An unrepresentable id answers null — D-2545's family; the route's `run()` read of the same row will refuse first on every path that reaches it.")

(c) In `openRun`, inside the `tx` AFTER the idempotent dup lookup (so a retry naming the same `(program, wave, waveOf, claimedBy, kind:'review', planned)` row reuses it, as the route's docstring promises) and BEFORE the INSERT, add:
```ts
        // Design 2026-09-14 §5.1: one review run per work run at a time. Inside
        // the transaction so two opens cannot both pass the read; AFTER the dup
        // arm so a retried open of the same planned review row stays idempotent.
        if (input.kind === 'review') {
          const inflight = this.reviewInFlightFor(input.reviews ?? -1);
          if (inflight !== null) return { refused: 'review-in-flight' as const, by: String(inflight) };
        }
```

- [ ] **Step 5: The route**

In `routes.ts` `POST /api/runs`:

(a) Destructure `kind` and `reviews` from `body` (`:1142`).

(b) After the existing shape guard (`:1143-1157`), add the kind shaping:
```ts
    // Design 2026-09-14 §5.1 / D-2799. `kind` absent is 'work' — every caller
    // that predates review runs. Each refusal names its field so the caller
    // can tell "malformed JSON" from "you sent the wrong thing".
    if (!(kind === undefined || kind === 'work' || kind === 'review')) {
      return reply.code(400).send({ ok: false, error: 'bad-request', detail: 'kind must be work or review' });
    }
    const runKind: 'work' | 'review' = kind === 'review' ? 'review' : 'work';
    if (runKind === 'work' && reviews !== undefined) {
      return reply.code(400).send({ ok: false, error: 'bad-request', detail: 'reviews is only accepted with kind review' });
    }
    if (runKind === 'review' && !isPositiveDecimalSafeInteger(reviews)) {
      return reply.code(400).send({ ok: false, error: 'bad-request', detail: 'reviews must name the work run under review (a positive run id)' });
    }
```

(c) Replace the fixed reading of `project`/`wave`/`waveOf` for the review case. FIRST remove `project`, `wave` and `waveOf` from the destructuring at `:1142` (the first shape guard then reads `body.project` / `body.wave` / `body.waveOf`; the `let` bindings below are their one home — a `let` beside a destructured `const` of the same name is a TS2451 redeclaration). Then, immediately after the block above and BEFORE `shapeProgramSlug` (`:1161`), add:
```ts
    // A review run's project, wave and waveOf are the REVIEWED run's — read off
    // its row, never off this body, which may only agree (D-2799). The body's
    // own shape guard above already accepted `project`/`wave` as it always
    // did; here the review arm overrides them with the measured values.
    let project = body.project as string, wave = body.wave as number, waveOfBody = body.waveOf;
    if (runKind === 'review') {
      if (sessionId !== undefined) {
        return reply.code(400).send({ ok: false, error: 'bad-request', detail: 'sessionId is refused on a review run — it always spawns fresh on its own workspace' });
      }
      const target = coord.run(reviews as number);
      if (!target.ok) return reply.code(503).send({ ok: false, error: 'run-unreadable', detail: target.detail });
      if (target.run === null) return reply.code(400).send({ ok: false, error: 'bad-request', detail: 'reviews names no run' });
      const t = target.run;
      if (t.kind !== 'work') return reply.code(400).send({ ok: false, error: 'bad-request', detail: `reviews must name a work run, not one of kind ${t.kind}` });
      if (t.state !== 'awaiting-review') return reply.code(400).send({ ok: false, error: 'bad-request', detail: `reviews must name a run at awaiting-review, not ${t.state}` });
      if (t.program !== program) return reply.code(400).send({ ok: false, error: 'bad-request', detail: `program must be the reviewed run's (${t.program})` });
      if (t.claimedBy !== claimedBy) return reply.code(400).send({ ok: false, error: 'bad-request', detail: 'claimedBy must be the reviewed run\'s coordinator' });
      if (body.project !== undefined && body.project !== t.project) return reply.code(400).send({ ok: false, error: 'bad-request', detail: `project must be the reviewed run's (${t.project})` });
      if (body.wave !== undefined && body.wave !== t.wave) return reply.code(400).send({ ok: false, error: 'bad-request', detail: `wave must be the reviewed run's (${t.wave})` });
      if (body.waveOf !== undefined && body.waveOf !== null && body.waveOf !== t.waveOf) return reply.code(400).send({ ok: false, error: 'bad-request', detail: `waveOf must be the reviewed run's (${t.waveOf})` });
      project = t.project; wave = t.wave; waveOfBody = t.waveOf;
    }
```
This requires relaxing the FIRST shape guard so a review body may OMIT `project` and `wave`: change `typeof project !== 'string' || project.trim() === ''` to `(kind !== 'review' && (typeof project !== 'string' || project.trim() === '')) || (project !== undefined && typeof project !== 'string')`, and `!isPositiveDecimalSafeInteger(wave)` to `(kind !== 'review' && !isPositiveDecimalSafeInteger(wave)) || (wave !== undefined && !isPositiveDecimalSafeInteger(wave))`. Then every later use of `project`/`wave`/`waveOfVal` in the handler (the `project-mismatch` check at `:1186-1191`, `openRun` at `:1225`) reads the `let` bindings above (`waveOfVal` becomes `(waveOfBody ?? null) as number | null`). Read the handler end to end after editing; the variable names must be consistent.

(d) `openRun` call (`:1225-1226`) gains `kind: runKind, reviews: runKind === 'review' ? (reviews as number) : null`.

(e) The refused arm (`:1235-1237`) is unchanged — it already sends `{ ok:false, refused: opened.refused, by: opened.by }` at 409.

- [ ] **Step 6: Run, mutate, restore**

Run: `cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/vitest run test/run-routes.test.ts test/mail-routes.test.ts test/coordinator-skill.test.ts`
Expected: `run-routes` PASS. `mail-routes.test.ts`'s reverse scan requires `'review-in-flight'` quoted somewhere under `server/src/coord` — `store.ts` now has it. `coordinator-skill.test.ts` requires every `RunRefuseCode` to be EXPLAINED in the coordinator corpus (its refusal-code scan, `:349`): it WILL RED here until Task 11 writes the sentence. **Do not soften the scan.** Instead add the one sentence now, in `ccd/coordinator-skill/references/wave-lifecycle.md`'s refusal table (§4, the table at `:479` that explains each code): a row `| \`review-in-flight\` | a non-terminal review run already names this work run — on an OPEN, a second reviewer for one wave; on an ADVANCE to \`working\`, a send-back while its review is still open. Close the review run first (\`state:'failed'\` if it died), then retry. |`. Re-run; expect PASS.
Mutant (spec §11 "allow a second non-terminal review run"): comment out the `review-in-flight` block in `openRun` → the second test FAILS (200). Restore.

- [ ] **Step 7: Commit**
```bash
git add shared/api.ts server/src/coord/store.ts server/src/coord/routes.ts server/test/run-routes.test.ts ccd/coordinator-skill/references/wave-lifecycle.md
git commit -F - <<'MSG'
feat(coord): POST /api/runs opens a review run — kind:'review', reviews:<work run>, one at a time

The reviewed run must be a work run at awaiting-review under the same
programme and coordinator; project/wave/waveOf are derived from it and a body
value may only agree (D-2799); sessionId is refused (a review run always
spawns fresh). A second non-terminal review run for one work run is refused
`review-in-flight` inside openRun's own transaction (design 2026-09-14 §5.1).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 6: `review-in-flight` on send-back

**Files:**
- Modify: `server/src/coord/routes.ts` (the advance handler — between the transition check and Task 2's cap check)
- Test: `server/test/run-routes.test.ts` (the `kind:review` describe)

**Interfaces:**
- Consumes: `coord.reviewInFlightFor` (Task 5); the advance route's `reject` envelope.
- Produces: 409 `{ ok:false, reject: { code:'review-in-flight', reviewRunId } }` from `POST /api/runs/:id/advance` when a WORK run is moved to `working` while a non-terminal review run names it (spec §9 invariant 3).

- [ ] **Step 1: Write the failing test** (in the `kind:review` describe):
```ts
  it('refuses to send the worker back while its review run is open: review-in-flight (spec §9 inv. 3)', async () => {
    const home = mkTmp('ccrc-runs-');
    const { w, workId } = await workAtReview(home);
    const r = (await postOpen(app, REVIEW(workId))).json() as { id: number };
    const back = () => postAdvance(app, workId,
      { to: 'working', fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: '' } });
    let res = await back();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, reject: { code: 'review-in-flight', reviewRunId: r.id } });
    expect(okRun(w.coord.run(workId))!.state).toBe('awaiting-review');
    // Once the review run is terminal the same send-back goes through.
    expect(w.coord.advance(r.id, 'failed', 'test').ok).toBe(true);
    res = await back();
    expect(res.statusCode).toBe(200);
    expect(okRun(w.coord.run(workId))!.state).toBe('working');
  });
```
- [ ] **Step 2: Run to verify it fails** — `-t "send the worker back"` → FAIL (200 on the first `back()`).
- [ ] **Step 3: Add the check.** In the advance handler, AFTER the `not-dispatched` check and BEFORE Task 2's cap block, insert:
```ts
    // Design 2026-09-14 §9 invariant 3 — the pair never disagrees. A work run
    // under review cannot be moved back to `working` until its review run is
    // terminal: the coordinator closes R (done, or failed if it died) BEFORE
    // sending W back, so a report and the tip it describes stay one pair.
    // Checked ahead of the cap: a definite refusal before a contingent one.
    if (to === 'working' && run.kind === 'work') {
      const inflight = coord.reviewInFlightFor(id);
      if (inflight !== null) {
        return reply.code(409).send({ ok: false, reject: { code: 'review-in-flight', reviewRunId: inflight } });
      }
    }
```
- [ ] **Step 4: Run, mutate, restore.** `-t "send the worker back|re-entering|does NOT cap-check"` → PASS. Mutant (spec §11): delete the block → FAIL (200). Restore.
- [ ] **Step 5: Commit**
```bash
git add server/src/coord/routes.ts server/test/run-routes.test.ts
git commit -F - <<'MSG'
feat(coord): a send-back while a review run is open is refused review-in-flight

At any instant a work run has at most one non-terminal review run, and it
cannot return to `working` until that run is terminal (design 2026-09-14 §9
invariant 3). The mistake is caught, not silently reconciled.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 7: Closing a review run — `stale-review`, `report-unreadable`

**Files:**
- Modify: `shared/api.ts:4412-4452` (`MAIL_REJECT_CODES`, `DONE_AUTHORITY_CODES` + prose)
- Modify: `server/src/coord/fingerprint.ts` (extract `resolveDoneBranch` from `:143-207`; add `ReviewClaim`, `verifyReviewDone`)
- Modify: `server/src/coord/close.ts` (a `closeReviewRun` arm, entered from `closeRun` after `:234`)
- Test: `server/test/coord-fingerprint.test.ts`, `server/test/run-routes.test.ts`

**Interfaces:**
- Consumes: `readBranchTip` (`gitref.ts:68`), `readRegistryMeasured`/`measuredIdentity` (as `verifyDone` uses them), `io.statMeasured` (`server/src/io.ts`), `coord.closeRun({… viaClosing:false})` (`store.ts:1602`), `releaseIsSafe`/`survivorOf`/`siblingsOf` (`close.ts:126-132`), `CCD_ARGV.wsRelease`/`wsHold`, `sendCloseOutcome` (`routes.ts:181-206`, unchanged).
- Produces: `ReviewClaim { reviewedTip: string; report: string }`; `verifyReviewDone(deps: VerifyDoneDeps, work: DoneRun, claim: ReviewClaim): Promise<ReviewVerdict>` where `ReviewVerdict = { ok:true; measured:{ tip:string } } | { ok:false; code: DoneRejectCode; detail:string }`; `resolveDoneBranch(deps, run): Promise<{ ok:true; branch:string; provenance:string } | { ok:false; code: DoneRejectCode; detail:string }>`; the review close body contract: `{ fingerprint: { reviewedTip, report }, state?: 'done'|'failed' }` — `final` and `archive` are REFUSED on a review run (400), release is implied.

- [ ] **Step 1: The two codes.** In `shared/api.ts` `MAIL_REJECT_CODES` (`:4412-4429`), under `// done-authority`, add `'stale-review', 'report-unreadable',` with a comment `// review-run verdicts (design 2026-09-14 §5.3)`. In `DONE_AUTHORITY_CODES` (`:4448-4451`) add the same two. Fix the docstring at `:4433` ("the six a wave-done claim … can be refused with") → "the eight … — six for a work run's claim, two for a review run's (D-2797)". Run `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts test/single-definition.test.ts` — the both-directions scans need each code quoted in `server/src/coord`; they will RED until Step 5 emits them. Proceed.

- [ ] **Step 2: Write the failing verifier tests** — append to `server/test/coord-fingerprint.test.ts`:
```ts
import { verifyReviewDone, type ReviewClaim } from '../src/coord/fingerprint.js';
import { writeFileSync as writeReport } from 'node:fs';

describe('verifyReviewDone — a report and its tip are one pair (design 2026-09-14 §5.3)', () => {
  const reportAt = (dir: string, body = '# review\n'): string => {
    const p = path.join(dir, 'review-report.md'); writeReport(p, body); return p;
  };
  const claimFor = (tip: string, report: string): ReviewClaim => ({ reviewedTip: tip, report });

  it('answers done when the reviewed branch is still at reviewedTip and the report is readable', async () => {
    const root = project(TIP, null);
    const deps = fingerprintDeps(runnerFor('open'), root);
    const res = await verifyReviewDone(deps, RUN, claimFor(TIP, reportAt(root)));
    expect(res).toEqual({ ok: true, measured: { tip: TIP } });
  });

  it('refuses stale-review when the branch has moved since the reviewer measured it', async () => {
    const root = project(OTHER, null);
    const deps = fingerprintDeps(runnerFor('open'), root);
    const res = await verifyReviewDone(deps, RUN, claimFor(TIP, reportAt(root)));
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('stale-review');
    expect((res as { detail: string }).detail).toContain(OTHER);
  });

  it('refuses report-unreadable for an absent report, and names the path', async () => {
    const root = project(TIP, null);
    const deps = fingerprintDeps(runnerFor('open'), root);
    const missing = path.join(root, 'nope.md');
    const res = await verifyReviewDone(deps, RUN, claimFor(TIP, missing));
    expect(res).toMatchObject({ ok: false, code: 'report-unreadable' });
    expect((res as { detail: string }).detail).toContain(missing);
  });

  it('refuses tip-unmeasurable when the reviewed branch has no readable ref (the work run was abandoned)', async () => {
    const root = project(null, null);
    const deps = fingerprintDeps(runnerFor('open'), root);
    const res = await verifyReviewDone(deps, RUN, claimFor(TIP, reportAt(root)));
    expect(res).toMatchObject({ ok: false, code: 'tip-unmeasurable' });
  });

  it('never runs pr-state — a review run has no PR to measure', async () => {
    const calls: string[][] = [];
    const root = project(TIP, null);
    const deps = fingerprintDeps(async (_c, args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; }, root);
    await verifyReviewDone(deps, RUN, claimFor(TIP, reportAt(root)));
    expect(calls.filter((c) => c[0] === 'pr-state')).toEqual([]);
  });
});
```
(`project`, `fingerprintDeps`, `runnerFor`, `RUN`, `TIP`, `OTHER` are this file's own helpers — `:19-37`, `:290-300`. Read `runnerFor`'s signature before using it. `fingerprintDeps` seeds a fixture HOME with an EMPTY registry, so `resolveDoneBranch` takes the "no record → run row's branch" arm, which is what `RUN.branch` provides.) Run `-t verifyReviewDone` → FAIL (not exported).

- [ ] **Step 3: Extract `resolveDoneBranch`, add `verifyReviewDone`.** In `fingerprint.ts`:

(a) Cut lines `:143-207` of `verifyDone` (from `const registryRead = …` through `const provenance = …`) into a new exported function placed ABOVE `verifyDone`:
```ts
/** Which branch a run's done-claim is about — the registry's answer first, the
 *  frozen run-row column only when the registry has no row at all. EXTRACTED
 *  from `verifyDone` so `verifyReviewDone` re-measures through the identical
 *  read (design 2026-09-14 §5.3 — "the same gitref.ts read the work path
 *  uses"; D-2796). Every comment that was inline here moved with the code. */
export async function resolveDoneBranch(
  deps: VerifyDoneDeps, run: DoneRun,
): Promise<{ ok: true; branch: string; provenance: string } | { ok: false; code: DoneRejectCode; detail: string }> {
  // … the moved body, ending:
  return { ok: true, branch, provenance };
}
```
and in `verifyDone` replace the cut block with
```ts
  const resolved = await resolveDoneBranch(deps, run);
  if (!resolved.ok) return resolved;
  const { branch, provenance } = resolved;
```
Every existing `coord-fingerprint.test.ts` test must stay green — run the whole file after this step before going on. (This is a pure move; `verifyDone`'s verdicts are byte-identical.)

(b) Add, after `verifyDone`:
```ts
/** A review run's done-claim (design 2026-09-14 §5.3): the tip the reviewer
 *  READ, and where it wrote what it found. Shape-checked by `closeReviewRun`
 *  before this module sees it; re-validated here all the same. */
export interface ReviewClaim { reviewedTip: string; report: string }

export type ReviewVerdict =
  | { ok: true; measured: { tip: string } }
  | { ok: false; code: DoneRejectCode; detail: string };

/**
 * The parent's "never believe a done claim" (D-6) applied to a new kind of
 * claim: the reviewer says "I read T", and the server confirms T is still
 * what there is to read, and that the report it names can be opened. No PR
 * check, no `.prhistory` — a review run has neither. `work` is the REVIEWED
 * run (its session, project and frozen branch), never the review run's own.
 */
export async function verifyReviewDone(
  deps: VerifyDoneDeps, work: DoneRun, claim: ReviewClaim,
): Promise<ReviewVerdict> {
  if (!SHA.test(claim.reviewedTip)) {
    return { ok: false, code: 'stale-review', detail: 'reviewedTip must be a 40-hex sha' };
  }
  const resolved = await resolveDoneBranch(deps, work);
  if (!resolved.ok) return resolved;
  const { branch, provenance } = resolved;
  const tip = await readBranchTip(deps.io, deps.cfg.projectsRoot, work.project, branch);
  if (tip === null) {
    return { ok: false, code: 'tip-unmeasurable',
      detail: `no readable ref for ${branch} under ${work.project}${provenance} — the reviewed run may have been abandoned` };
  }
  if (tip !== claim.reviewedTip) {
    return { ok: false, code: 'stale-review',
      detail: `${branch}${provenance} is at ${tip}, the report describes ${claim.reviewedTip} — the worker ` +
        'pushed after wave-done, or the report is about an older tip; open a fresh review run against the live tip' };
  }
  const st = await deps.io.statMeasured(claim.report);
  if (!st.ok) {
    return { ok: false, code: 'report-unreadable',
      detail: `${claim.report}: ${st.reason === 'absent' ? 'no such file' : `could not be read (${st.reason})`}` };
  }
  return { ok: true, measured: { tip } };
}
```
(`statMeasured`'s result shape: `{ ok:true, … } | { ok:false, reason: 'absent' | 'unreadable' | … }` — read `server/src/io.ts` for the exact `reason` union and adjust the detail's ternary to it.) Run `-t "verifyReviewDone"` → PASS.

- [ ] **Step 4: Write the failing route tests** — in `run-routes.test.ts`'s `kind:review` describe (Task 5). This needs a fixture git repo for the reviewed branch: `run-routes.test.ts` already has a fixture-repo builder (`gitRoot`, near `:1632`) — reuse it rather than copying `coord-fingerprint.test.ts`'s `project()`; pass `{ cfg: { projectsRoot: root } }` as `openApp`'s third argument.
```ts
  /** W dispatched into a fixture repo whose `ws/demo-w1` is at TIPW, positioned
   *  at awaiting-review; R opened and dispatched against it. */
  const TIPW = 'c'.repeat(40);
  const reviewInFlight = async (home: string, tipNow: string = TIPW) => {
    const root = gitRoot(tipNow, 'ws/demo-w1');   // the file's own fixture-repo builder; read its signature
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-w1'] });
    const w = await openApp(home, run, { cfg: { projectsRoot: root } }); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);                       // ws-add seeds demo-w1; the registry diff sees ONE new row
    seed(home, 'demo-r1');                                    // R's row, planted AFTER W's dispatch so that diff stays unambiguous
    expect(w.coord.advance(opened.id, 'working', 'test').ok).toBe(true);
    expect(w.coord.advance(opened.id, 'awaiting-review', 'test').ok).toBe(true);
    const r = (await postOpen(app, REVIEW(opened.id))).json() as { id: number };
    w.coord.markDispatched(r.id, 'demo-r1', 'r1', 'ws/r1', false);
    expect(w.coord.advance(r.id, 'dispatched', 'test').ok).toBe(true);   // markDispatched is not a transition
    expect(w.coord.advance(r.id, 'working', 'test').ok).toBe(true);
    const report = path.join(root, 'report.md'); writeFileSync(report, '# findings\n');
    calls.length = 0;
    return { w, workId: opened.id, reviewId: r.id, report, calls };
  };

  it('closes a review run done when the reviewed tip is unchanged: released, no closing hop, worker untouched', async () => {
    const home = mkTmp('ccrc-runs-');
    const { w, workId, reviewId, report, calls } = await reviewInFlight(home);
    const res = await postClose(app, reviewId, { fingerprint: { reviewedTip: TIPW, report } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id: reviewId, state: 'done', released: true });
    expect(okRun(w.coord.run(reviewId))!.state).toBe('done');
    expect(okRun(w.coord.run(workId))!.state).toBe('awaiting-review');   // the coordinator rules next
    expect(calls.map((c) => c[0])).toEqual(['ws-release']);              // its own workspace, freed
    const events = w.coord.db.prepare('SELECT toState FROM run_events WHERE runId = ? ORDER BY id').all(reviewId) as { toState: string }[];
    expect(events.map((e) => e.toState)).not.toContain('closing');
  });

  it('refuses stale-review when the worker pushed after wave-done, and the run stays working', async () => {
    const home = mkTmp('ccrc-runs-');
    const { w, reviewId, report, calls } = await reviewInFlight(home, 'd'.repeat(40));
    const res = await postClose(app, reviewId, { fingerprint: { reviewedTip: TIPW, report } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'stale-review' });   // sendCloseOutcome's doneVerdict shape: { error, detail }
    expect(okRun(w.coord.run(reviewId))!.state).toBe('working');
    expect(calls).toEqual([]);                                            // no fleet act on a refusal
  });

  it('refuses report-unreadable when the report is not there', async () => {
    const home = mkTmp('ccrc-runs-');
    const { reviewId, report } = await reviewInFlight(home);
    const res = await postClose(app, reviewId, { fingerprint: { reviewedTip: TIPW, report: report + '.missing' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'report-unreadable' });
  });

  it('closes a review run failed without any re-measurement (the reviewer died)', async () => {
    const home = mkTmp('ccrc-runs-');
    const { w, reviewId, calls } = await reviewInFlight(home, 'd'.repeat(40));   // tip moved, report absent — irrelevant
    const res = await postClose(app, reviewId, { fingerprint: { reviewedTip: TIPW, report: '/nowhere' }, state: 'failed' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, state: 'failed', released: true });
    expect(okRun(w.coord.run(reviewId))!.state).toBe('failed');
    expect(calls.map((c) => c[0])).toEqual(['ws-release']);
  });

  it.each([
    ['final', { fingerprint: { reviewedTip: TIPW, report: '/r' }, final: true }],
    ['archive', { fingerprint: { reviewedTip: TIPW, report: '/r' }, archive: true }],
    ['a work fingerprint', { fingerprint: { branchTip: TIPW, handoffCommit: TIPW, prNumber: null, prPhase: 'none' }, final: true }],
    ['a relative report path', { fingerprint: { reviewedTip: TIPW, report: 'report.md' } }],
    ['a short tip', { fingerprint: { reviewedTip: 'abc', report: '/r' } }],
  ])('refuses %s on a review close as bad-request', async (_what, body) => {
    const home = mkTmp('ccrc-runs-');
    const { reviewId } = await reviewInFlight(home);
    const res = await postClose(app, reviewId, body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });
```
Check the `makeRunner` `ws-add` arm (`run-routes.test.ts:98-104`): it seeds EVERY id in `wsAddCreates` on the FIRST `ws-add`, and the dispatch route diffs the registry for exactly ONE new row — so `demo-r1` must NOT be in `wsAddCreates` (two new rows would refuse W's dispatch `ambiguous-dispatch`); it is planted with `seed()` after W's dispatch instead, and R is positioned through `markDispatched`, not through the dispatch route. Run `-t "review run done|stale-review|report-unreadable|review run failed|review close as bad-request"` → FAIL (today a review run's close is `bad-transition` from Task 4's `transitionsFor`, and the body shape is the work one).

- [ ] **Step 5: The close arm.** In `close.ts`, right after the `not-dispatched` check (`:230-234`) and BEFORE the `transitionsFor(run.kind)[run.state].includes('closing')` check (`:247`), insert:
```ts
  // Design 2026-09-14 §5: a REVIEW run closes on its own claim, with no
  // `closing` hop, no `.prhistory` and no PR check. One arm, one function.
  if (run.kind === 'review') return closeReviewRun(deps, run, b, causedBy, siblingsOf, survivorOf);
```
and add the function below `closeRun`:
```ts
/** The review-kind close (design 2026-09-14 §5.3–5.4, D-2796). Body:
 *  `{ fingerprint: { reviewedTip, report }, state?: 'done'|'failed' }`. `final`
 *  and `archive` are REFUSED: a review run is always final (its workspace is its
 *  own and is released here), and archive stays a human act. `state:'failed'`
 *  is the coordinator's "the reviewer died" — nothing is re-measured, exactly
 *  as the work path's abandon arm (D-49). */
async function closeReviewRun(
  deps: CloseRunDeps, run: RunRow, b: CloseRunBody, causedBy: 'coordinator' | 'operator',
  siblingsOf: (sessionId: string) => OpenSiblingsResult,
  survivorOf: (s: readonly OpenSibling[]) => OpenSibling | null,
): Promise<CloseOutcome> {
  const coord = deps.coord;
  const fp = b.fingerprint as { reviewedTip?: unknown; report?: unknown } | undefined;
  if (b.final !== undefined || b.archive !== undefined ||
      typeof fp !== 'object' || fp === null ||
      typeof fp.reviewedTip !== 'string' || !HANDOFF_SHA.test(fp.reviewedTip) ||
      typeof fp.report !== 'string' || !path.isAbsolute(fp.report) ||
      (b.state !== undefined && b.state !== 'done' && b.state !== 'failed')) {
    return { ok: false, kind: 'bad-request' };
  }
  const state: 'done' | 'failed' = b.state === 'failed' ? 'failed' : 'done';
  if (!transitionsFor(run.kind)[run.state].includes(state)) {
    return { ok: false, kind: 'bad-transition', from: run.state, to: state };
  }
  // `run.sessionId` is non-null here: `closeRun`'s own `not-dispatched` check
  // runs before this arm is entered. The type still says `string | null`, so
  // narrow it once for the reads below rather than re-check a fact already decided.
  const sessionId = run.sessionId as string;

  if (state !== 'failed') {
    if (run.reviews === null) {
      return { ok: false, kind: 'doneVerdict', code: 'tip-unmeasurable', detail: 'this review run names no reviewed run' };
    }
    const workRead = coord.run(run.reviews);
    if (!workRead.ok) return { ok: false, kind: 'hold-invalid', detail: workRead.detail };
    if (workRead.run === null) {
      return { ok: false, kind: 'doneVerdict', code: 'tip-unmeasurable', detail: `reviewed run ${run.reviews} no longer exists` };
    }
    const work = workRead.run;
    if (work.sessionId === null) {
      return { ok: false, kind: 'doneVerdict', code: 'tip-unmeasurable', detail: `reviewed run ${work.id} has no session to measure` };
    }
    const verdict = await verifyReviewDone(
      { io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState },
      { sessionId: work.sessionId, project: work.project, branch: work.branch ?? '' },
      { reviewedTip: fp.reviewedTip, report: fp.report },
    );
    if (!verdict.ok) {
      coord.recordRejection({ code: verdict.code, runId: run.id, toId: sessionId, detail: verdict.detail });
      queueSystemMail(coord, run, { fromId: 'coordinator', toId: sessionId, runId: run.id,
        kind: 'status', subject: 'review-done-rejected', body: `${verdict.code}: ${verdict.detail}` });
      return { ok: false, kind: 'doneVerdict', code: verdict.code, detail: verdict.detail };
    }
  }

  // The fleet act, AHEAD of the commit (D-48). A review workspace hosts one
  // run, so the ordinary answer is a release; the sibling check is kept
  // because it is a re-measurement, not an assumption.
  const sibRead = siblingsOf(sessionId);
  if (!sibRead.ok) return { ok: false, kind: 'hold-invalid', detail: sibRead.detail };
  const survivor = survivorOf(sibRead.siblings);
  const release = releaseIsSafe(sibRead.siblings) || survivor === null;
  let argv;
  if (!release && survivor !== null) {
    const handoff = holdReasonVerdict(survivor.program, survivor.wave, survivor.waveOf, survivor.id);
    if (!handoff.ok) return handoff;
    argv = CCD_ARGV.wsHold(sessionId, handoff.reason, sweepDec(deps.fleetState, `run:${run.id} close`));
  } else {
    argv = CCD_ARGV.wsRelease(sessionId, sweepDec(deps.fleetState, `run:${run.id} close`));
  }
  if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
  const res = await deps.runCcd(argv);
  if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };

  const closed = coord.closeRun({
    runId: run.id, finalState: state, causedBy, handoffCommit: null, program: run.program,
    viaClosing: false,   // REVIEW_RUN_TRANSITIONS has no `closing` (§5.2)
  });
  if (!closed.ok) return { ok: false, kind: 'advanceFailed', adv: closed };
  return { ok: true, id: run.id, state, released: release };
}
```
Imports needed in `close.ts`: `path` from `node:path`; `verifyReviewDone` from `./fingerprint.js`; `RunRow`, `OpenSibling`, `OpenSiblingsResult` types from `./store.js` (check which are already imported). `HANDOFF_SHA` is `close.ts`'s existing 40-hex regex (`:381`). Move the `siblingsOf`/`survivorOf` closures' definitions ABOVE the new early return if they are not already (they are at `:126-132`, before `:230` — fine).

The ABANDON arm (D-2807): in `closeRun`'s abandon arm change `const target: RunState = run.state === 'planned' ? 'failed' : 'closing';` to `const target: RunState = run.state === 'planned' || run.kind === 'review' ? 'failed' : 'closing';` with a comment naming D-2807 (a review run has no `closing`; the operator's ungated valve must still reach it). The store call already passes `viaClosing: target === 'closing'`. Test (in `run-routes.test.ts`'s `kind:review` describe): abandon a `working` review run through `POST /api/runs/:id/abandon` → 200 with `state:'failed'` and `released:true`, its state reads `failed`, `calls` shows one `ws-release`, and no `closing` event exists for it.

Also: the `mail-routes.test.ts` kebab allowlist (`:630-632`) names mail SUBJECT literals; add `'review-done-rejected', // mail SUBJECT text (the review close's own rejection, design 2026-09-14)` beside `'wave-done-rejected'`.

- [ ] **Step 6: Run, mutate, restore.** `cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/vitest run test/run-routes.test.ts test/coord-fingerprint.test.ts test/mail-routes.test.ts test/single-definition.test.ts test/coord-abandon.test.ts` → PASS.
Mutants (spec §11): (i) in `verifyReviewDone` replace `if (tip !== claim.reviewedTip)` with `if (false)` → the `stale-review` tests FAIL (fingerprint suite: `ok:true`; route suite: 200). (ii) delete the `statMeasured` block → `report-unreadable` tests FAIL. Restore each exactly, re-run green.

- [ ] **Step 7: Commit**
```bash
git add shared/api.ts server/src/coord/fingerprint.ts server/src/coord/close.ts server/test/coord-fingerprint.test.ts server/test/run-routes.test.ts server/test/mail-routes.test.ts
git commit -F - <<'MSG'
feat(coord): a review run closes on {reviewedTip, report} — stale-review and report-unreadable

verifyReviewDone re-measures the REVIEWED branch's live tip through the same
registry read and readBranchTip the work path uses (resolveDoneBranch,
extracted — D-2796), refuses `stale-review` if it moved and
`report-unreadable` if the report cannot be stat'ed; no PR, no .prhistory.
The close skips the `closing` hop (REVIEW_RUN_TRANSITIONS has none), releases
the reviewer's own workspace, and refuses `final`/`archive`. The two codes
join MAIL_REJECT_CODES/DONE_AUTHORITY_CODES (D-2797).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 8: The `ccrc-reviewer` skill and its pin suite

**Files:**
- Create: `ccd/reviewer-skill/SKILL.md`
- Create: `server/test/reviewer-skill.test.ts`
- Modify: `README.md` (one sentence in the "Both skills ship…" paragraph, `:1355-1358`), `CLAUDE.md` (one sentence after the worker-skill bullet in "Coordination (Build 7) invariants") — the pin suite's count check reads both files

**Interfaces:**
- Consumes: the worker skill's shape (`ccd/worker-skill/SKILL.md`), `worker-skill.test.ts`'s mechanism (`:1-200`), the coordinator's `references/{wave-lifecycle,mail-envelope}.md` (pointed at, not copied).
- Produces: skill name `ccrc-reviewer` (frontmatter `name:`), ten contract clauses, the `review-done` mail shape `{ "reviewedTip": "<40-hex>", "report": "<absolute path>" }` carried in the body's first line as JSON and the report path in `artifacts`. Task 9's `REVIEWER_KICKOFF_PREFIX` names this skill; Task 11's brief template cites this skill's report format.

- [ ] **Step 1: Write the failing pin suite** — create `server/test/reviewer-skill.test.ts`:
```ts
// The reviewer skill is prose a model follows unsupervised, in a workspace of
// its own, against a branch it must never write to. Same mechanism as
// worker-skill.test.ts: the CONTRACT is a literal array (a paraphrase fails as
// a deletion does), the destructive verbs and the run routes are COUNTED, and
// the skill ships no references/ of its own.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillDir = path.join(root, 'ccd/reviewer-skill');
const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const frontmatter = skill.slice(4, skill.indexOf('\n---', 4));

// Ten clauses, verbatim, DOUBLE-quoted (worker-skill.test.ts's convention and
// its D-104 rule: straight apostrophes only, no `"` inside a clause).
const CONTRACT = [
  "Learn who you are on EVERY call: `fromId` and `fromUuid` come from `ccrc-api whoami`, which reads the pane you are in and REFUSES rather than naming another session. Re-read them each time; a uuid you cached is guaranteed stale after the `/clear` dispatch runs.",
  "Ack before you act, keyed on the row's DELIVERY id, never the mail row's own `id`. Reply to the coordinator through mail (`toId:'coordinator'`, with the `runId` of THIS review run), never by typing into your own pane.",
  "Measure the reviewed tip ONCE, before you read a line: `reviewedTip` is the 40-hex sha of the worker branch the brief names, read from this repository's own ref (`git rev-parse refs/heads/ws/<worker-slug>`). Every finding cites that sha. If the ref moves while you read, say so in the report and stop — a report about two tips is a report about neither.",
  "Read in YOUR OWN worktree only: `git checkout --detach <reviewedTip>` here, and never `checkout` the worker's branch, never commit, amend, rebase, cherry-pick, reset or push it, never open a PR on it, and never `git worktree add` or `remove` anything. This workspace's own branch (`ws/<slug>`) stays where dispatch left it; you land nothing on it.",
  "Run the SDD shape the brief names and nothing lighter: the review lenses over the wave's whole diff against the plan file the brief names (that plan's text governs over your recollection of the spec), then the whole-branch pass, then the suites the plan says to run, in this worktree, at `reviewedTip`.",
  "Report, never rule. This session never calls `POST /api/runs/:id/advance`, `POST /api/runs/:id/close`, `POST /api/runs/:id/dispatch` or `POST /api/ledger/deviations` on any run, never mails the worker, never sends work back and never allocates a deviation number. A finding that needs a ruling is written as such in the report — `needs a ruling:` and the question — and the coordinator rules.",
  "One report, written ONCE: to an absolute path under this worktree, by temp file and `mv` so a half-written report never exists at that path, named in the `review-done` mail's `artifacts`; after that mail you do not touch it. The mail's body opens with one JSON line, `{\"reviewedTip\":\"<sha>\",\"report\":\"<absolute path>\"}`, which the coordinator submits to the close route exactly as you wrote it.",
  "Never run `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive` or `ws-restore`. This workspace's lifecycle belongs to ccd and to the human, for any reason.",
  "Every question rides the AskUserQuestion tool — the structured ask the session hook captures — never free text in your pane; your parent (the coordinator) may answer it before the operator is notified. Keep your input box empty: a half-typed draft makes the delivery lane refuse `draft-present`.",
  "Remote control is decided at your creation, not by you: dispatched reviewers spawn WITHOUT it (`ws-add --no-rc`, the dispatch path's own declaration), and `~/.ccrc/remote-control` governs every non-dispatched session on this box. Neither is yours to write.",
];
const FORBIDS_VERBS = CONTRACT[7]!;
const FORBIDS_ROUTES = CONTRACT[5]!;

describe('the reviewer skill: its contract', () => {
  it('carries all ten clauses verbatim', () => {
    for (const clause of CONTRACT) {
      expect(skill, `missing contract clause: ${clause.slice(0, 48)}…`).toContain(clause);
    }
  });

  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];
  const COUNT_WORD = WORDS[CONTRACT.length];

  it('numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps', () => {
    const numbered = [...skill.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbered).toEqual(CONTRACT.map((_, i) => i + 1));
  });

  it('spells that same count, as one derived word, everywhere prose states it', () => {
    expect(COUNT_WORD).toBeTruthy();
    const stated = [...skill.matchAll(/\b([a-z]+) (?:clauses|lines)\b/g)]
      .map((m) => m[1]!).filter((w) => WORDS.includes(w));
    expect(stated.length, 'SKILL.md no longer states its own clause count').toBeGreaterThanOrEqual(2);
    for (const w of stated) expect(w, `SKILL.md says ${w} where the CONTRACT pins ${CONTRACT.length}`).toBe(COUNT_WORD);
    const marker = 'ccd/reviewer-skill/SKILL.md';
    for (const rel of ['README.md', 'CLAUDE.md']) {
      const text = readFileSync(path.join(root, rel), 'utf8');
      let hits = 0;
      for (let i = text.indexOf(marker); i >= 0; i = text.indexOf(marker, i + 1)) {
        const m = /\b([a-z]+) clauses\b/.exec(text.slice(i, i + 160));
        expect(m, `${rel} names ${marker} without stating how many clauses it has`).not.toBeNull();
        expect(m![1], `${rel} says ${m![1]} clauses where the CONTRACT pins ${CONTRACT.length}`).toBe(COUNT_WORD);
        hits++;
      }
      expect(hits, `${rel} no longer names ${marker} at all`).toBeGreaterThan(0);
    }
  });

  it('names the five destructive verbs ONLY inside the clause that forbids them', () => {
    for (const verb of ['ws-rm', 'ws-reap', 'ws-gc', 'ws-archive', 'ws-restore']) {
      const hits = skill.split(verb).length - 1;
      const licensed = FORBIDS_VERBS.split(verb).length - 1;
      expect(licensed, `${verb} is not named in the forbidding clause`).toBeGreaterThan(0);
      expect(hits, `${verb} appears ${hits}×; only the forbidding clause may name it`).toBe(licensed);
    }
  });

  it('names the run-mutating routes and the allocator ONLY inside the clause that forbids them (spec §9 inv. 1)', () => {
    for (const route of ['/advance', '/close', '/dispatch', '/api/ledger/deviations']) {
      const hits = skill.split(route).length - 1;
      const licensed = FORBIDS_ROUTES.split(route).length - 1;
      expect(licensed, `${route} is not named in the forbidding clause`).toBeGreaterThan(0);
      expect(hits, `${route} appears ${hits}×; only the forbidding clause may name it`).toBe(licensed);
    }
  });

  it('never tells the reviewer to write the worker branch — the four git writes appear only in the clause that forbids them', () => {
    const FORBIDS_GIT = CONTRACT[3]!;
    for (const w of ['git push', 'rebase', 'cherry-pick', 'git worktree add']) {
      expect(skill.split(w).length - 1, `${w} appears outside clause 4`).toBe(FORBIDS_GIT.split(w).length - 1);
    }
  });

  it('carries no references of its own and points at the coordinator\'s', () => {
    expect(readdirSync(skillDir).sort()).toEqual(['SKILL.md']);
    for (const ref of ['../ccrc-coordinator/references/wave-lifecycle.md',
      '../ccrc-coordinator/references/mail-envelope.md']) {
      expect(skill, `the skill points at no ${ref}`).toContain(ref);
      expect(readFileSync(path.join(root, 'ccd/coordinator-skill', ref.replace('../ccrc-coordinator/', '')), 'utf8').length)
        .toBeGreaterThan(0);
    }
  });

  it('has YAML frontmatter with exactly a name and a description that says when NOT to use it', () => {
    expect(skill.startsWith('---\n')).toBe(true);
    expect(frontmatter).toContain('name: ccrc-reviewer');
    expect(frontmatter.split('\n').filter((l) => /^[A-Za-z][A-Za-z0-9_-]*:/.test(l))
      .map((l) => l.slice(0, l.indexOf(':')))).toEqual(['name', 'description']);
    expect(frontmatter.toLowerCase()).toContain(
      'never use it to rule on a wave — a reviewer that sends work back or allocates a deviation has become a coordinator with no ledger');
  });

  it('states the review-done mail shape the close route re-measures', () => {
    expect(skill).toContain('"reviewedTip"');
    expect(skill).toContain('"report"');
    expect(skill).toContain('review-done');
    expect(skill).toContain('stale-review');
    expect(skill).toContain('report-unreadable');
  });
});
```
Run `cd server && ./node_modules/.bin/vitest run test/reviewer-skill.test.ts` → FAIL (no such file).

- [ ] **Step 2: Write the skill** — create `ccd/reviewer-skill/SKILL.md` with EXACTLY this content (the ten numbered lines must be byte-identical to the `CONTRACT` array above; straight apostrophes throughout; no `"` inside a clause except the escaped JSON in clause 7, which the array spells with `\"` — in the markdown it is a plain `"`):

````markdown
---
name: ccrc-reviewer
description: Read one finished wave of a ccrc program as the dispatched reviewer — measure the worker branch's tip once, read it in your own worktree, run the review lenses and the whole-branch pass against the plan, and report findings to the coordinator as one mail artifact. Use when a brief arrives naming a review run and the work run it reviews. Never use it to rule on a wave — a reviewer that sends work back or allocates a deviation has become a coordinator with no ledger.
---

# Reviewing one wave of a ccrc program

You are a dispatched reviewer. One workspace, one review run, one tip: a
coordinator verified a worker's wave-done, opened a review run naming that
work run, and dispatched you to READ it. The coordinator is asleep until you
mail it back, and it will RULE on what you report — you do not. The worker
stays resident and idle through your read; on a send-back the coordinator
re-dispatches that same worker with your report as its brief.

You hold no unique state. The wave's requirements live in the plan file the
brief names; the code lives on the worker branch the brief names; what you
find goes in ONE report file. Nothing you write changes fleet state.

## Learn who you are, first — and again on every call

Identity is attribution, not authentication. Ask the pane, through the client:

```bash
REG="$HOME/.cc-sessions"
API="$HOME/.local/bin/ccrc-api"          # ~/.local/bin is NOT on this unit's PATH
who=$("$API" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}
[[ -n "$id" && -n "$uuid" ]] || { printf 'identity unreadable: %s\n' "$who" >&2; exit 1; }
```

`id` is your `fromId`, `uuid` your `fromUuid`. Re-derive both on every call.

## The contract

These ten clauses are the boundary between "a wave reviewer" and "an agent
with a shell on the fleet host and someone else's branch". They are not advice.

**Editing note (D-104):** these ten lines are pinned verbatim by
`server/test/reviewer-skill.test.ts`, whose clause literals are double-quoted.
Keep every apostrophe STRAIGHT and keep double-quote characters out of a
clause except the JSON shape in clause 7, which the pin spells escaped.

1. Learn who you are on EVERY call: `fromId` and `fromUuid` come from `ccrc-api whoami`, which reads the pane you are in and REFUSES rather than naming another session. Re-read them each time; a uuid you cached is guaranteed stale after the `/clear` dispatch runs.
2. Ack before you act, keyed on the row's DELIVERY id, never the mail row's own `id`. Reply to the coordinator through mail (`toId:'coordinator'`, with the `runId` of THIS review run), never by typing into your own pane.
3. Measure the reviewed tip ONCE, before you read a line: `reviewedTip` is the 40-hex sha of the worker branch the brief names, read from this repository's own ref (`git rev-parse refs/heads/ws/<worker-slug>`). Every finding cites that sha. If the ref moves while you read, say so in the report and stop — a report about two tips is a report about neither.
4. Read in YOUR OWN worktree only: `git checkout --detach <reviewedTip>` here, and never `checkout` the worker's branch, never commit, amend, rebase, cherry-pick, reset or push it, never open a PR on it, and never `git worktree add` or `remove` anything. This workspace's own branch (`ws/<slug>`) stays where dispatch left it; you land nothing on it.
5. Run the SDD shape the brief names and nothing lighter: the review lenses over the wave's whole diff against the plan file the brief names (that plan's text governs over your recollection of the spec), then the whole-branch pass, then the suites the plan says to run, in this worktree, at `reviewedTip`.
6. Report, never rule. This session never calls `POST /api/runs/:id/advance`, `POST /api/runs/:id/close`, `POST /api/runs/:id/dispatch` or `POST /api/ledger/deviations` on any run, never mails the worker, never sends work back and never allocates a deviation number. A finding that needs a ruling is written as such in the report — `needs a ruling:` and the question — and the coordinator rules.
7. One report, written ONCE: to an absolute path under this worktree, by temp file and `mv` so a half-written report never exists at that path, named in the `review-done` mail's `artifacts`; after that mail you do not touch it. The mail's body opens with one JSON line, `{"reviewedTip":"<sha>","report":"<absolute path>"}`, which the coordinator submits to the close route exactly as you wrote it.
8. Never run `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive` or `ws-restore`. This workspace's lifecycle belongs to ccd and to the human, for any reason.
9. Every question rides the AskUserQuestion tool — the structured ask the session hook captures — never free text in your pane; your parent (the coordinator) may answer it before the operator is notified. Keep your input box empty: a half-typed draft makes the delivery lane refuse `draft-present`.
10. Remote control is decided at your creation, not by you: dispatched reviewers spawn WITHOUT it (`ws-add --no-rc`, the dispatch path's own declaration), and `~/.ccrc/remote-control` governs every non-dispatched session on this box. Neither is yours to write.

**Clause 3 is the one the server checks.** When the coordinator closes your
run it re-measures the worker branch's tip NOW and compares it to the
`reviewedTip` you reported. If the worker pushed after its wave-done, the
close is refused `stale-review` and your report is evidence about a commit
that is no longer the tip — the coordinator opens a fresh review run against
the new tip. If the report path you named cannot be opened, the close is
refused `report-unreadable`. Both are the mechanism behind "a report and its
tip are one pair"; neither is a judgement of your work.

**Clause 4 is what makes you safe to run beside a live worker.** Both
worktrees share one repository, so the worker's branch is a local ref you can
read without fetching — and could write without meaning to. Detaching onto the
sha is the whole of what you do to git.

## The brief

The brief mail (subject `wave-brief`, kind `status`) names: the review run id
(yours), the work run id and its worker branch `ws/<worker-slug>`, the
programme slug and the ledger path, the plan file (and for a plan in another
repository the immutable coordinates `homeRepoRoot`/`planRepoPath`/`planSha` —
read it with `git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`, never a
checkout), the wave's task range, the lenses to run, and the suites to run.
`../ccrc-coordinator/references/wave-lifecycle.md` §2 is the brief's long form;
`../ccrc-coordinator/references/mail-envelope.md` is the envelope you read it
through. Both install beside this file.

## Reading

```bash
WT=$(git rev-parse --show-toplevel)                       # THIS worktree
tip=$(git rev-parse "refs/heads/ws/<worker-slug>")        # clause 3, ONCE
git checkout --detach "$tip"                               # clause 4
base=$(git merge-base origin/main "$tip")
git diff --stat "$base" "$tip"                             # the wave's whole diff
```

Then the lenses the brief names, each over the whole diff, then the
whole-branch pass, then the suites — in this worktree, at `$tip`. A green
suite is one fact; a claim in a comment is not. Where the plan says a guard
ships with a red-on-mutation test, mutate and measure in THIS worktree (you
are detached; nothing you change lands anywhere) and restore exactly.

## The report

One markdown file, absolute path under `$WT` — for example
`$WT/.ccrc-review/<review-run-id>-<tip first 8>.md` — written to a temp path
and moved into place (clause 7). Shape:

```markdown
# Review — run <review run id> reviews run <work run id> at <reviewedTip>
Plan: <path or homeRepoRoot@planSha:planRepoPath>   Lenses: <names>   Suites: <what ran, result>

## Findings
- **F1 (<lens>, <severity>)** `<file>:<line>` at <sha first 8> — <what is wrong, measured how>. <fix direction, or "needs a ruling: <question>">

## Whole-branch pass
<what the branch does as a whole; anything the per-lens read cannot see>

## Nothing found at
<lenses that returned nothing, listed, so silence reads as a measurement>
```

No verdict line. "Clean" is the coordinator's word; yours is "no finding at any
lens", if that is what you measured.

## Reporting review-done

```bash
report="$WT/.ccrc-review/<review run id>-${tip:0:8}.md"
mkdir -p "$(dirname "$report")"
cat > "$report.tmp" <<'MD'
…the report…
MD
mv "$report.tmp" "$report"                                 # clause 7: atomic

"$API" mail send --json - <<JSON
{"fromId":"$id","fromUuid":"$uuid","toId":"coordinator","runId":<review run id>,
 "kind":"status","subject":"review-done",
 "body":"{\"reviewedTip\":\"$tip\",\"report\":\"$report\"}\n<one paragraph: how many findings, how many need a ruling>",
 "artifacts":["$report"]}
JSON
```

The first line of the body is the fingerprint the coordinator submits; the
client exits 0 whenever a response arrived, so read stdout, not the exit code.
Then end your turn. The coordinator closes your run; your workspace is
released with it.

## When something is wrong

- **The worker branch moved while you read** (`git rev-parse` no longer
  answers `$tip`): finish nothing, write what you have with a first line
  `TIP MOVED: read <tip>, now <new>`, mail it — the close will refuse
  `stale-review` and the coordinator will open a fresh run. Never re-measure
  and continue.
- **The plan the brief names cannot be resolved**: report and stop. Never
  substitute `HEAD` or a checkout for an immutable coordinate.
- **You cannot reach the server**: stop, say so in your pane. Nothing is done
  by hand.
````

- [ ] **Step 3: The two prose mentions the count check reads.** `README.md:1355-1358`: after "…thirteen clauses pinned by `server/test/worker-skill.test.ts`)," add the clause ", and the `ccrc-reviewer` skill (`ccd/reviewer-skill/SKILL.md`, ten clauses pinned by `server/test/reviewer-skill.test.ts`), which reads a finished wave in its own workspace and reports — it never rules". `CLAUDE.md`, after the "**The worker has a skill too**" bullet, add: "- **So does the reviewer** (`ccd/reviewer-skill/SKILL.md`, `ccrc-reviewer`, ten clauses pinned by `server/test/reviewer-skill.test.ts`; no `references/` of its own). A review run (design 2026-09-14) is dispatched by the coordinator on a verified wave-done; the reviewer reads the worker branch at one measured tip in its OWN worktree and mails one report; the coordinator rules. `REVIEWER_KICKOFF_PREFIX` prefixes its brief exactly as the worker's does."

- [ ] **Step 4: Run the pin suite** → PASS. Then the worker-skill and coordinator-skill suites (`./node_modules/.bin/vitest run test/worker-skill.test.ts test/coordinator-skill.test.ts`) — they scan README/CLAUDE.md near THEIR markers only, so they stay green; confirm.

- [ ] **Step 5: Mutation check.** Soften clause 6 in SKILL.md ("never calls" → "should not call") → "carries all ten clauses verbatim" FAILS. Restore. Add a stray "`git push`" sentence in the Reading section → the git-writes count test FAILS. Restore.

- [ ] **Step 6: Commit**
```bash
git add ccd/reviewer-skill/SKILL.md server/test/reviewer-skill.test.ts README.md CLAUDE.md
git commit -F - <<'MSG'
feat(ccd): the ccrc-reviewer skill — read one wave at one tip in your own worktree, report, never rule

Ten clauses pinned verbatim by reviewer-skill.test.ts (the worker suite's
mechanism): identity, ack, measure-the-tip-once, own-worktree-only, the SDD
shape, report-never-rule (the run routes and the allocator counted into the
forbidding clause), one atomic report, the five destructive verbs, asks, rc.
No references/ of its own — points at the coordinator's. Design 2026-09-14 §4.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 9: Dispatch by kind — `REVIEWER_KICKOFF_PREFIX` and the skill preflight

**Files:**
- Modify: `server/src/coord/dispatch.ts:26-41` (the prefix), `:193-195` (composition), `:751-752` (preflight)
- Modify: `server/src/skillstate.ts:30-46` (`REVIEWER_SKILL_DIR`), `:85-90`
- Test: `server/test/run-routes.test.ts`, `server/test/reviewer-skill.test.ts`, `server/test/coordinator-skill.test.ts` (the byte-ceiling test at `:962-983` reads `WORKER_KICKOFF_PREFIX`; unchanged)

**Interfaces:**
- Consumes: `run.kind` (Task 3), `readSkillState(io, configDir, skillDir)` (`skillstate.ts:73`), `WORKER_KICKOFF_PREFIX`.
- Produces: `REVIEWER_KICKOFF_PREFIX = "Run the ccrc-reviewer skill — it is your standing protocol; read it before acting on anything below.\n\n"`; `kickoffPrefixFor(kind: RunKind): string`; `skillDirFor(kind)` in `skillstate.ts` returning `WORKER_SKILL_DIR` | `REVIEWER_SKILL_DIR`; `REVIEWER_SKILL_DIR = 'ccrc-reviewer'`.

- [ ] **Step 1: Failing tests.** In `run-routes.test.ts`'s `kind:review` describe:
```ts
  it('dispatches a review run with the REVIEWER kickoff prefix, and a work run with the worker one', async () => {
    const home = mkTmp('ccrc-runs-');
    const { w, workId } = await workAtReview(home);
    const r = (await postOpen(app, REVIEW(workId))).json() as { id: number };
    const before = w.coord.dueDeliveries(Date.now(), 60_000).length;
    const res = await postDispatch(app, r.id, { brief: 'review wave 1 of build4' });
    expect(res.statusCode).toBe(200);
    const due = w.coord.dueDeliveries(Date.now(), 60_000);
    expect(due.length).toBe(before + 1);
    const env = due[due.length - 1]!.envelope;
    expect(env).toContain(`\n--\n${REVIEWER_KICKOFF_PREFIX}review wave 1 of build4\n`);
    expect(env).not.toContain(WORKER_KICKOFF_PREFIX);
    // The work run's own brief (from workAtReview's dispatch) still carries the worker prefix.
    expect(due[0]!.envelope).toContain(WORKER_KICKOFF_PREFIX);
    // The preflight asked about the REVIEWER skill: the event names it.
    const ev = w.coord.db.prepare("SELECT detail FROM run_events WHERE runId = ? AND detail LIKE 'skill-preflight:%'").all(r.id) as { detail: string }[];
    expect(ev.length).toBe(1);
  });
```
Import `REVIEWER_KICKOFF_PREFIX` beside `WORKER_KICKOFF_PREFIX` (`:22`). Note `makeRunner`'s `wsAddCreates` for `workAtReview` seeds only `demo-w1`; R's fresh spawn needs its own id — change `workAtReview` to seed `['demo-w1', 'demo-r1']`: the runner seeds both on the first `ws-add`, and the dispatch route diffs the registry so the SECOND `ws-add` (R's) sees no NEW row → `ambiguous-dispatch`. So instead make the runner seed lazily: give `makeRunner` a `wsAddCreates` of `['demo-w1']` and, before dispatching R, call `seed(home, 'demo-r1')` yourself is wrong too (it exists before the diff). The honest fix: extend `RunnerConfig` with `wsAddCreatesPerCall?: string[][]` — the n-th `ws-add` seeds the n-th list — and have `workAtReview` pass `[['demo-w1'], ['demo-r1']]`. Implement that in `makeRunner` (`:92-104`): `const ids = cfg.wsAddCreatesPerCall?.[wsAddCalls++] ?? cfg.wsAddCreates ?? [...]`. Existing callers are unaffected.

In `reviewer-skill.test.ts`, add (mirroring `worker-skill.test.ts:337-350`):
```ts
import { REVIEWER_KICKOFF_PREFIX } from '../src/coord/dispatch.js';
describe('the reviewer skill: the name dispatch invokes', () => {
  const SKILL_NAME = ((): string => {
    const m = /^name:\s*(\S+)\s*$/m.exec(frontmatter);
    if (!m) throw new Error('the reviewer skill declares no `name:`');
    return m[1]!;
  })();
  it('is the name the reviewer kickoff prefix tells every reviewer to run', () => {
    expect(REVIEWER_KICKOFF_PREFIX).toContain(`the ${SKILL_NAME} skill`);
  });
});
```
Run both → FAIL (not exported).

- [ ] **Step 2: The prefix and the selector.** In `dispatch.ts` after `WORKER_KICKOFF_PREFIX` (`:41`):
```ts
// The reviewer's half of the same pair (design 2026-09-14 §8): one sentence,
// one skill name, bound to `ccd/reviewer-skill/SKILL.md`'s frontmatter by
// `reviewer-skill.test.ts` exactly as the worker's is.
export const REVIEWER_KICKOFF_PREFIX =
  "Run the ccrc-reviewer skill — it is your standing protocol; read it before acting on anything below.\n\n";

/** Which standing protocol a brief of this kind invokes. `unknown` never
 *  reaches here — dispatch refuses it at the transition precondition. */
export const kickoffPrefixFor = (kind: RunKind): string =>
  kind === 'review' ? REVIEWER_KICKOFF_PREFIX : WORKER_KICKOFF_PREFIX;
```
Change `:195` `const body = WORKER_KICKOFF_PREFIX + brief;` to `const prefix = kickoffPrefixFor(run.kind); const body = prefix + brief;` and, in the oversize refusal a few lines below (the `detail` that names `Buffer.byteLength(WORKER_KICKOFF_PREFIX, 'utf8')`), use `prefix` so a reviewer's brief-writer is told the reviewer prefix's cost. Import `RunKind` type.

- [ ] **Step 3: The preflight.** `skillstate.ts`: add `export const REVIEWER_SKILL_DIR = 'ccrc-reviewer';` after `WORKER_SKILL_DIR` with a docstring ("The directory `ccd/install-reviewer-skill.sh` writes, same parent."), and
```ts
/** The dispatch preflight's dir, by kind. `unknown` is refused before dispatch
 *  asks; answering the worker's dir for it here would measure the wrong file. */
export const skillDirFor = (kind: 'work' | 'review'): string =>
  kind === 'review' ? REVIEWER_SKILL_DIR : WORKER_SKILL_DIR;
```
In `dispatch.ts:751-752` replace `readWorkerSkillState(deps.io, wrapper === null ? undefined : deps.configDir(wrapper))` with `readSkillState(deps.io, wrapper === null ? undefined : deps.configDir(wrapper), skillDirFor(run.kind as 'work' | 'review'))` — the cast is sound because the precondition at `:190` (Task 4) refused `unknown`; say so in a comment. Import `readSkillState`, `skillDirFor`; drop `readWorkerSkillState` from the import if unused (keep the export in `skillstate.ts` — `skillstate.test.ts` reads it).

- [ ] **Step 4: Run, mutate, restore.** `cd server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/vitest run test/run-routes.test.ts test/reviewer-skill.test.ts test/worker-skill.test.ts test/coordinator-skill.test.ts test/skillstate.test.ts test/dispatch-skillstate.test.ts` → PASS. Mutant (spec §11 "swap the prefixes"): flip `kickoffPrefixFor`'s ternary → the route test FAILS on both `toContain`s. Restore.

- [ ] **Step 5: Commit**
```bash
git add server/src/coord/dispatch.ts server/src/skillstate.ts server/test/run-routes.test.ts server/test/reviewer-skill.test.ts
git commit -F - <<'MSG'
feat(coord): dispatch prefixes a review run's brief with REVIEWER_KICKOFF_PREFIX and preflights the reviewer skill

kickoffPrefixFor(kind) and skillDirFor(kind) — one selector each, beside the
worker's constants; the rename detector in reviewer-skill.test.ts binds the
prefix to the skill's frontmatter as the worker's is (design 2026-09-14 §8).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 10: Shipping the skill — installer, `deploy.sh`, the `ccd/ccrc` spine, uninstall

**Files:**
- Create: `ccd/install-reviewer-skill.sh` (from `ccd/install-worker-skill.sh`)
- Create: `server/test/install-reviewer-skill.test.ts` (from `server/test/install-worker-skill.test.ts`)
- Modify: `deploy/deploy.sh:806-810` (after the worker lane)
- Modify: `ccd/ccrc` — `_inst_skills` (`for name in coordinator-skill worker-skill` and its echo), `_acct_provision`'s installer loop (`:5482-5483`), `_uninst_cc_sessions` (`:11498-11502`)
- Modify: `server/test/installTreeFixture.ts:158-161`, `server/test/ccrc-install.test.ts:1713-1716` and `:1760-1762`, `server/test/ccrc-account.test.ts:2168-2176` and `:2809-2814`, `server/test/ccrc-uninstall.test.ts:198-210` and `:440-446`, `agent/test/deploy-verify.test.ts:1545-1584`
- Modify: `server/src/skillstate.ts:32,36` docstrings naming the installers
- Modify (found executing Task 10): `ccd/ccrc`'s `_acct_unprovision` (`ccrc account remove` cleans the coordinator's, worker's and graphify's skill dirs — the reviewer's joins them) and its test in `server/test/ccrc-account.test.ts`; the security-scan corpora in `server/test/ccrc-api-closed.test.ts` and `server/test/auth-passkey.test.ts` that read `coordinator-skill`/`worker-skill` SKILL.md texts (curl ban, closed route table, auth-gate reachability) — `reviewer-skill/SKILL.md` calls `ccrc-api` and joins those corpora

**Interfaces:**
- Consumes: the worker installer's exact shape (`ccd/install-worker-skill.sh`, 89 lines — `REQUIRED_FILES=(SKILL.md)`, `--homes`, roster fallback, `diff -r -q` convergence, backup + staged `mv`).
- Produces: `~/.cc-sessions/reviewer-skill/` (tree), `~/.cc-sessions/install-reviewer-skill.sh` (installer), `<configDir>/skills/ccrc-reviewer/SKILL.md` per rostered home. Order on every path: coordinator → worker → reviewer (the reviewer, like the worker, points into the coordinator's installed `references/`).

- [ ] **Step 1: The installer.** `cp ccd/install-worker-skill.sh ccd/install-reviewer-skill.sh`, then edit: every `install-worker-skill` → `install-reviewer-skill`; `worker-skill` → `reviewer-skill` (the `SRC` default and the header comment's rsync destination); `NAME=ccrc-worker` → `NAME=ccrc-reviewer`; the header's first paragraph says "put the ccrc reviewer skill in every wrapper home's skills dir. Byte-for-byte the same shape as install-worker-skill.sh — and for the same reason". Keep `REQUIRED_FILES=(SKILL.md)`. `chmod 755`. Verify: `diff ccd/install-worker-skill.sh ccd/install-reviewer-skill.sh` shows ONLY name/path lines.

- [ ] **Step 2: Its suite.** `cp server/test/install-worker-skill.test.ts server/test/install-reviewer-skill.test.ts`; edit: `INSTALLER` → `../../ccd/install-reviewer-skill.sh`, `SRC` → `../../ccd/reviewer-skill`, `'ccrc-worker'` → `'ccrc-reviewer'`, `mkTmp('ccrc-workerskillinstall-')` → `mkTmp('ccrc-reviewerskillinstall-')`, describe titles. The deploy describe (`:150-201`) becomes:
```ts
describe('the deploy ships the reviewer skill too — the fleet lane, in order', () => {
  const deploy = fs.readFileSync(path.resolve(__dirname, '../..', 'deploy/deploy.sh'), 'utf8');
  const agentArm = deploy.slice(deploy.indexOf('if [ "$TARGET" = "agent" ]'), deploy.indexOf('\nelse\n'));
  const COORD_RUN = 'bash ~/.cc-sessions/install-coordinator-skill.sh';
  const WORKER_RUN = 'bash ~/.cc-sessions/install-worker-skill.sh';
  const REVIEWER_RUN = 'bash ~/.cc-sessions/install-reviewer-skill.sh';

  it('installs the skill in the agent arm, after the coordinator AND worker installers have run', () => {
    expect(agentArm).toContain(COORD_RUN);
    expect(agentArm).toContain(WORKER_RUN);
    expect(agentArm).toContain(REVIEWER_RUN);
    expect(agentArm.indexOf(COORD_RUN)).toBeLessThan(agentArm.indexOf(REVIEWER_RUN));
    expect(agentArm.indexOf(WORKER_RUN)).toBeLessThan(agentArm.indexOf(REVIEWER_RUN));
  });

  it('rsyncs the skill tree with --delete, after the coordinator lane', () => {
    const lines = agentArm.split('\n');
    const idx = lines.findIndex((l) => l.includes('reviewer-skill/'));
    expect(idx, 'no line in the agent arm ships the reviewer skill tree').toBeGreaterThan(-1);
    const line = lines[idx]!;
    expect(line).toContain('rsync');
    expect(line).toContain('--delete');
    expect(agentArm.indexOf(COORD_RUN)).toBeLessThan(agentArm.indexOf(line));
  });
});
```
Run: `cd server && ./node_modules/.bin/vitest run test/install-reviewer-skill.test.ts` → the installer describes PASS (the script exists), the deploy describe FAILS.

- [ ] **Step 3: `deploy.sh`.** After the worker lane's run line (`:810`, `"${SSH[@]}" "$BOX" 'bash ~/.cc-sessions/install-worker-skill.sh'`) and BEFORE the graphify comment, add — with the comment deliberately NOT spelling the directory with a trailing slash (the test locates the rsync by the first line containing `reviewer-skill/`):
```bash
  # THE REVIEWER SKILL SHIPS THIRD (design 2026-09-14 §8). Like the worker's,
  # its SKILL.md carries no references of its own and points a live reviewer at
  # the coordinator's installed tree by relative path, so it lands after that
  # lane for the worker's reason. server/test/install-reviewer-skill.test.ts
  # pins the order against both run lines above.
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.cc-sessions/reviewer-skill'
  rsync -az --delete -e "${SSH[*]}" ccd/reviewer-skill/ "$BOX":.cc-sessions/reviewer-skill/
  install_atomic ccd/install-reviewer-skill.sh .cc-sessions/install-reviewer-skill.sh 755
  "${SSH[@]}" "$BOX" 'bash ~/.cc-sessions/install-reviewer-skill.sh'
```
Re-run the suite → PASS. Then `agent/test/deploy-verify.test.ts:1545-1584`: add a row `['reviewer skill', "\"${SSH[@]}\" \"$BOX\" 'bash ~/.cc-sessions/install-reviewer-skill.sh'"]` after the worker row (the accounts.sh-before-installers ordering pin). Run `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts` → PASS.

- [ ] **Step 4: The install spine.** In `ccd/ccrc` `_inst_skills`: `for name in coordinator-skill worker-skill reviewer-skill; do` and the echo → `"install: skills: ccrc-coordinator, ccrc-worker and ccrc-reviewer in each account's skills directory"`; extend the docstring's "THE COORDINATOR GOES FIRST" paragraph with "…and the reviewer skill, third, points into the same tree." In `_acct_provision`'s loop (`:5482-5483`) add `install-reviewer-skill.sh` after `install-worker-skill.sh` (the doc comment at `:5424-5433` says "the four standalone scripts" → "five", and names the new one with its `--homes` line number). In `_uninst_cc_sessions` (`:11498-11502`) add `"$reg/install-reviewer-skill.sh"` to the `rm -f` list and `"$reg/reviewer-skill"` to the `rm -rf` list; the echo's "both skill trees" → "the three skill trees".

- [ ] **Step 5: The pins that enumerate.** Each of these reds until updated — run them first to see the exact red, then fix:
  - `server/test/installTreeFixture.ts:158-161`: add `'ccd/reviewer-skill',` and `'ccd/install-reviewer-skill.sh',`.
  - `server/test/ccrc-install.test.ts:1713-1716`: add `[join(home, '.cc-sessions', 'install-reviewer-skill.sh'), placed(home, 'ccd', 'install-reviewer-skill.sh'), 0o755],`; `:1760-1762`: add `join(home, '.cc-sessions', 'install-reviewer-skill.sh'),`. Search the file for `'ccrc-coordinator and ccrc-worker'` (the echo, if pinned) and for any `worker-skill` tree-placement assertion, and add the reviewer beside it.
  - `server/test/ccrc-account.test.ts:2168-2176` (`plantInstallers`): add `'install-reviewer-skill.sh'`; `:2809-2814`: add the fifth call line after the worker's — and the comment "FOUR CALLS" → "FIVE CALLS".
  - `server/test/ccrc-uninstall.test.ts:198-210`: `mkdirSync(join(reg, 'reviewer-skill'))`, `writeFileSync(join(reg, 'install-reviewer-skill.sh'), …)`, `writeFileSync(join(reg, 'reviewer-skill', 'SKILL.md'), …)`; `:440-446`: add `'install-reviewer-skill.sh'` and `'reviewer-skill'` to the survived-check list.
  - `server/src/skillstate.ts:32,36`: the docstrings name "both installers" — add the third.
Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts test/ccrc-account.test.ts test/ccrc-uninstall.test.ts test/install-reviewer-skill.test.ts test/install-worker-skill.test.ts test/install-coordinator-skill.test.ts test/wrapper-roster-fixture.test.ts test/skillstate.test.ts` — these execute `ccd/ccrc` against FIXTURE homes (never the live one). Expected PASS. If `ccrc-install.test.ts`'s 23-entry `_inst_*` spine pin (`:1886`) reds, you added a FUNCTION instead of a loop entry — undo that; the reviewer rides `_inst_skills`.

- [ ] **Step 6: Commit**
```bash
git add ccd/install-reviewer-skill.sh ccd/ccrc deploy/deploy.sh server/src/skillstate.ts server/test/install-reviewer-skill.test.ts server/test/installTreeFixture.ts server/test/ccrc-install.test.ts server/test/ccrc-account.test.ts server/test/ccrc-uninstall.test.ts agent/test/deploy-verify.test.ts
git commit -F - <<'MSG'
feat(ccd): ship the reviewer skill — installer, deploy agent lane, install spine, uninstall

install-reviewer-skill.sh is the worker installer's shape (REQUIRED_FILES=(SKILL.md));
deploy.sh's agent arm rsyncs the tree and runs it after the coordinator and
worker lanes; `ccrc install`'s _inst_skills loop, `ccrc account`'s provision
loop and `ccrc uninstall` each learn the third skill. Every enumerating pin
updated in the same commit. AGENT-FIRST.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 11: The coordinator skill inverts

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md:3` (description), `:65-68` (contract count), `:76-77` (a twelfth clause after clause 11), `:284-318` (lifecycle steps 4–6), `:405` ("What stays discipline")
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md:231-232` (brief content), `:566` (§5 step 1)
- Create: `ccd/coordinator-skill/references/review-brief.md`
- Modify: `ccd/install-coordinator-skill.sh:78` (`REQUIRED_REFS` gains `review-brief.md`)
- Modify: `server/test/coordinator-skill.test.ts` — `CONTRACT` (`:106+`, a twelfth literal), `REFERENCE_NAMES` (`:51`, if a literal list), the step-5 anchors (`:1757-1759`, `:1810-1811`), plus new pins
- Modify: every prose count of the contract: `README.md`, `CLAUDE.md` ("eleven clauses" → "twelve")

**Interfaces:**
- Consumes: the review-open contract (Task 5), `review-in-flight` (Tasks 5–6), the review close body (Task 7), `REVIEWER_KICKOFF_PREFIX` (Task 9), the reviewer's report shape and `review-done` mail (Task 8).
- Produces: contract clause 12 (below, verbatim); lifecycle steps 5 ("Dispatch a review run") and 6 ("Rule on the report"); `references/review-brief.md`.

**Clause 12, verbatim (D-2798):**
> A verified `wave-done` is READ by a review run, never by this session. Once `POST /api/runs/:id/advance` has moved the work run to `awaiting-review`, this session opens a run of `kind:'review'` naming it, dispatches the reviewer with `references/review-brief.md`, and ends its turn; when `review-done` arrives it closes the review run with the reviewer’s own `{reviewedTip, report}` and rules on the report the server accepted. This session does not read the diff itself, and a `stale-review` refusal means a fresh review run against the live tip, never a ruling on the old report.

(Curly apostrophe in `reviewer’s`, matching this file's existing clauses 4 and 11 — `coordinator-skill.test.ts`'s literals are single-quoted and carry curly ones.)

- [ ] **Step 1: Failing pins first.** In `coordinator-skill.test.ts`:
  (a) Append the clause-12 literal to `CONTRACT` (`:106+`) exactly as above, single-quoted, with the `’`.
  (b) Add after the CONTRACT describe's verbatim test:
```ts
  it('no longer tells the coordinator to review the handoff commit itself (design 2026-09-14 §4, §13)', () => {
    expect(skill).not.toContain('Review the handoff commit');
    expect(skill).not.toContain('review the handoff commit');
    expect(flat(skill)).toContain('never read by this session');
    expect(flat(refs('wave-lifecycle.md'))).not.toContain('Review the handoff commit the way you would review any commit.');
  });
```
  (c) Change the two anchors: `'5. **Review the handoff commit**'` → `'6. **Rule on the report**'` and `'\n6. **Final merge:**'` → `'\n7. **Final merge:**'` at both sites (`:1757-1759`, `:1810-1811`) — the Same/Different-project arms live in the ruling step now. Update the failure-message strings that say "step 5" to "step 6".
  (d) `REFERENCE_NAMES` (`:51`): if it is a literal array, add `'review-brief.md'`; if it is `readdirSync`-derived, nothing to do.
  (e) Every count pin: `grep -n "eleven" server/test/coordinator-skill.test.ts README.md CLAUDE.md ccd/coordinator-skill/SKILL.md` — each hit that counts the contract becomes "twelve" (the test may derive it from `CONTRACT.length`; if it hard-codes 11 anywhere, derive it).
Run `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts` → FAIL on clause 12, on the negative pin, on the anchors (`-1`).

- [ ] **Step 2: The skill.**
  (a) Frontmatter description (`:3`): replace "re-measure a claimed wave-done, review the handoff commit, release on the final merge" with "re-measure a claimed wave-done, dispatch a review run and rule on its report, release on the final merge".
  (b) `:65-68`: "These eleven sentences" → "These twelve sentences". Append clause 12 after clause 11 (`:76`), numbered `12.`.
  (c) Lifecycle. Step 4 (`:284-299`) keeps its text through the items-settle paragraph. Replace step 5 (`:300-318`, "**Review the handoff commit** like any other commit, update the ledger, then `POST /api/runs` **for wave N+1 first**…" through the end of the Different-project arm) with TWO steps and renumber step 6 → 7:

```markdown
5. **Dispatch a review run** (clause 12; design 2026-09-14). With the work run
   at `awaiting-review`, open the reviewer's run and dispatch it:
   `"$API" runs open --json -` with
   `{"program":"<slug>","title":"Review wave N","kind":"review","reviews":<work run id>,"claimedBy":"<your id>","homeProject":"<home>"}`
   — `project`, `wave` and `waveOf` are the reviewed run's and are derived
   server-side; do not send them. `review-in-flight` means a review run is
   already open for that wave: close it first (`state:'failed'` if the reviewer
   died), then retry. Then `"$API" runs dispatch <review run id> --json -` with a
   brief cut from `references/review-brief.md` — the work run id, its branch
   `ws/<worker-slug>`, the plan coordinates, the task range, the lenses, the
   suites. `cap-concurrency` here is ordinary: the reviewer needs a slot and
   the idle worker no longer holds one, so retry on the next wake. **End your
   turn.** The reviewer's `review-done` mail wakes you.
6. **Rule on the report.** The `review-done` mail's body opens with one JSON
   line, `{"reviewedTip":…,"report":…}`. Submit it EXACTLY as written:
   `"$API" runs close <review run id> --json -` with `{"fingerprint":{"reviewedTip":"…","report":"…"}}`
   (no `final`, no `archive` — a review run is always final and its workspace
   is released by this close). `stale-review` means the worker pushed after
   its wave-done: the report is evidence about a tip that is gone — do not
   rule on it; mail the worker the code and detail verbatim, and once its
   re-measured wave-done arrives, open a NEW review run (step 5). `report-unreadable`
   means the path the reviewer named cannot be opened: close the review run
   `state:'failed'` and open a new one. Once the close answers `ok`, read the
   report — findings are the reviewer's, rulings are yours (clause 10 for any
   deviation the report surfaces). Then ONE of two moves:
   - **Send back:** `"$API" runs advance <work run id> --json -` with
     `{"to":"working","fingerprint":{…the wave-done fingerprint you verified…}}`
     (a retreat re-measures nothing; it may refuse `cap-concurrency` — retry on
     the next wake — or `review-in-flight` — you skipped this step's close), then
     `runs dispatch <work run id>` with the report's absolute path as the brief's
     first line and your rulings beneath it. The worker's fix round ends in a new
     wave-done and a NEW review run (step 5); review runs are never reused.
   - **Clean:** update the ledger — Waves row, Decisions, Carried constraints,
     and the **Next-wave brief** — commit it, then `POST /api/runs` **for wave N+1
     first**. Order matters: closing first, even briefly, leaves the program with
     zero open runs, and the server retires a program with none — silently
     breaking every `toId:'coordinator'` mail from that point on. Opening first
     never lets the count reach zero.
     **Same project:** open wave N+1 first with this producer's `sessionId`, close
     the producer with `final:false` so its hold transfers to the already-open
     successor on the same workspace, then run `"$API" runs list --closed 1`,
     find the producer by run id, and require its own `state` to be `done`.
     **Different project:** open wave N+1 first without this producer's
     `sessionId`, close the producer with `final:true` and require
     `released:true`, then run `"$API" runs list --closed 1`, find the producer
     by run id, and require its own `state` to be `done`. If the consumer depends
     on an interface from that producer, independently prove the producer
     interface PR merged at the exact `producerSha` carried in the conditional
     producer contract. A missing or non-`done` row, failed release, or required
     exact-SHA merge proof that is absent means report and do not dispatch. The
     closed row proves the fingerprint and terminal run state; it does not prove
     a required interface merged. Only then dispatch wave N+1 (step 2).
7. **Final merge:** …(the existing step 6 text, unchanged)…
```
  The Same/Different-project sentences are the EXISTING ones moved verbatim — the D-2717 arm-order test and the CROSSING table pin them by content. Any place in the skill that says "step 5" meaning the old review step (grep `step 5`, `step 6`) is renumbered.
  (d) `:405` "What stays discipline": after "…(implement → review lenses → whole-branch pass) are unchanged; you" — make sure the sentence now reads that YOU dispatch that shape to a review run rather than run it; read the paragraph and edit the one clause.

- [ ] **Step 3: The references.**
  (a) `wave-lifecycle.md:231-232`: "and whatever your review of the last handoff decided" → "and whatever the last review run's report, and your ruling on it, decided".
  (b) `wave-lifecycle.md:566`: "1. Review the handoff commit the way you would review any commit." → "1. Dispatch a review run and rule on its report (SKILL.md steps 5–6, clause 12); this session never reads the diff itself."
  (c) Create `references/review-brief.md`:
```markdown
# Review-run brief — template

The brief a coordinator dispatches to a REVIEW run (design 2026-09-14 §4, §6).
Dispatch prefixes it with the sentence that invokes the `ccrc-reviewer` skill;
the standing protocol lives there and is not repeated here. A brief carries
what only THIS review knows.

```markdown
Review run <review run id> reviews run <work run id> — programme `<slug>`, wave N/M.
Worker branch: `ws/<worker-slug>` (measure its tip ONCE before reading; report that sha).
Ledger: `<ledgerAbsPath>`.
Plan: `<path>`   — or, for a plan in another repository:
  homeRepoRoot: <abs path>   planRepoPath: <repo-relative>   planSha: <40-hex>
Tasks in this wave: <range or list>.
Lenses: <e.g. correctness, seams-and-interfaces, tests-pin-effect-not-shape, docs-match-code>.
Whole-branch pass: <what to hold the branch to as a whole>.
Suites: <exact commands, run in your worktree at the measured tip>.
Carried constraints from earlier waves: <the ledger's list, verbatim>.
Deviations already ledgered this wave: <D-numbers and one line each>.
Report to: an absolute path under YOUR worktree; mail `review-done` with the JSON first line.
```

Do not put the worker's fingerprint, the coordinator's rulings, or any
instruction to send work back in a review brief — the reviewer reports; you rule.
```
  (d) `install-coordinator-skill.sh:78`: `REQUIRED_REFS=(ledger-template.md mail-envelope.md peer-protocol.md resume.md review-brief.md wave-lifecycle.md)` — alphabetical, matching the directory. `wrapper-roster-fixture.test.ts`'s I8 row compares this list to the real directory in both directions and will red until they agree.

- [ ] **Step 4: Prose counts.** `README.md` and `CLAUDE.md`: every "eleven clauses" describing `ccd/coordinator-skill/SKILL.md` → "twelve clauses" (CLAUDE.md's "its eleven clauses are pinned VERBATIM by `server/test/coordinator-skill.test.ts`"; README's counterpart near `:1355`).

- [ ] **Step 5: Run, mutate, restore.** `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/worker-skill.test.ts test/reviewer-skill.test.ts test/wrapper-roster-fixture.test.ts test/install-coordinator-skill.test.ts` → PASS. Mutant (spec §11 "restore 'review the handoff commit'"): put "Review the handoff commit like any other commit" back at the top of step 6 → the negative pin FAILS. Restore. Second mutant: delete clause 12 → "carries all twelve clauses" FAILS and the numbering pin FAILS. Restore.

- [ ] **Step 6: Commit**
```bash
git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md ccd/coordinator-skill/references/review-brief.md ccd/install-coordinator-skill.sh server/test/coordinator-skill.test.ts README.md CLAUDE.md
git commit -F - <<'MSG'
feat(ccd): the coordinator dispatches review and rules on it — clause 12, steps 5-6, review-brief.md

"Review the handoff commit like any other commit" is gone from the skill and
from wave-lifecycle.md §5; a twelfth contract clause says a verified wave-done
is read by a review run, never by this session (D-2798; design 2026-09-14 §4,
§13 — Build 7 §7 said "the coordinator dispatches that shape" all along). Step 5
opens and dispatches the review run; step 6 closes it on the reviewer's own
{reviewedTip, report} and rules — send back or advance. AGENT-FIRST.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 12: PWA — the kind chip

**Files:**
- Modify: `pwa/src/fleet/runWords.ts` (after `crossingNote`, `:434`)
- Modify: `pwa/src/screens/RunsScreen.tsx:183-190` (the `RunRow` body, beside the crossing marker)
- Modify: `pwa/src/fleet/fleet.css:2238-2244` (beside `.run-crossing`)
- Test: `pwa/test/runs-screen.test.tsx`

**Interfaces:**
- Consumes: `RunSummary.kind`, `RunSummary.reviews` (Task 3); `crossingNote`'s tolerant-reader idiom (`runWords.ts:403-434`); the `board()` render helper (`runs-screen.test.tsx:751-755`).
- Produces: `REVIEW_GLYPH = '⌕'`; `interface RunKindChip { glyph: string; word: string; title: string }`; `runKindChip(run: { kind?: RunKind; reviews?: number | null }): RunKindChip | null` — the ONE tolerant reader of both fields (absence → `null`, i.e. a work run). Rendered as `<span className="run-kind">`.

- [ ] **Step 1: Failing unit tests** — in `runs-screen.test.tsx`, a new describe:
```ts
import { REVIEW_GLYPH, runKindChip } from '../src/fleet/runWords';

describe('runKindChip — the one tolerant reader of RunSummary.kind (design 2026-09-14 §8)', () => {
  it('is silent on a work run, and on a row from a server that has never heard of kind', () => {
    expect(runKindChip(r({ kind: 'work', reviews: null }))).toBeNull();
    const older = { ...r() } as Partial<RunSummary>; delete older.kind; delete older.reviews;
    expect(runKindChip(older)).toBeNull();
  });
  it('names the reviewed run on a review row, with a glyph and a word', () => {
    expect(runKindChip(r({ kind: 'review', reviews: 47 })))
      .toEqual({ glyph: REVIEW_GLYPH, word: 'reviews #47', title: 'a review run: reads run #47 at one measured tip and reports; the coordinator rules' });
  });
  it('still marks a review row whose reviews column could not be read as a review', () => {
    expect(runKindChip(r({ kind: 'review', reviews: null }))!.word).toBe('review');
  });
  it('says unknown for a kind this build cannot name — never a blank cell', () => {
    expect(runKindChip(r({ kind: 'unknown', reviews: null }))!.word).toBe('unknown kind');
  });
});

describe('the run board marks review runs (design 2026-09-14 §8)', () => {
  const board = (over: Partial<RunSummary>): void => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ ...over })], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
  };
  it('renders no kind chip on a work row', () => {
    board({ kind: 'work', reviews: null });
    expect(document.querySelector('.run-kind')).toBeNull();
  });
  it('renders the chip with BOTH cues on a review row and names the reviewed run', () => {
    board({ kind: 'review', reviews: 47 });
    const chip = document.querySelector('.run-kind');
    expect(chip).not.toBeNull();
    expect(chip!.querySelector('.run-kind-glyph')?.textContent).toBe(REVIEW_GLYPH);
    expect(chip!.querySelector('.run-kind-glyph')?.getAttribute('aria-hidden')).toBe('true');
    expect(chip!.textContent).toContain('reviews #47');
    expect(chip!.getAttribute('title')).toContain('coordinator rules');
  });
});
```
Run `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx -t "runKindChip|marks review runs"` → FAIL (not exported).

- [ ] **Step 2: The reader.** In `runWords.ts` after `crossingNote`:
```ts
/* ── design 2026-09-14 §8: the kind chip ──────────────────────────────────── */

export const REVIEW_GLYPH = '⌕';

export interface RunKindChip { readonly glyph: string; readonly word: string; readonly title: string }

/**
 * THE ONE READER of `RunSummary.kind` and `RunSummary.reviews` on this side
 * of the wire (CLAUDE.md "Wire discipline": a newer peer tolerates an older
 * peer omitting a field, through a SINGLE reader per field). Both are declared
 * optional here though the wire type requires them, `runWarnings`'s idiom: an
 * older SERVER omits them, and absence means a work run — the only kind that
 * server knew. `null` = render nothing, which is what every work row does.
 */
export const runKindChip = (run: { kind?: RunKind; reviews?: number | null }): RunKindChip | null => {
  if (run.kind === undefined || run.kind === 'work') return null;
  if (run.kind === 'review') {
    return {
      glyph: REVIEW_GLYPH,
      word: run.reviews === null || run.reviews === undefined ? 'review' : `reviews #${run.reviews}`,
      title: run.reviews === null || run.reviews === undefined
        ? 'a review run: reads one work run at one measured tip and reports; the coordinator rules'
        : `a review run: reads run #${run.reviews} at one measured tip and reports; the coordinator rules`,
    };
  }
  return { glyph: '·', word: 'unknown kind', title: 'a run of a kind this build cannot name' };
};
```
Import `RunKind` from `../../../shared/api` beside `RunState`.

- [ ] **Step 3: The row.** In `RunsScreen.tsx`'s `RunRow` body, right after the crossing marker block (`:185-190`) add:
```tsx
      {kindChip !== null && (
        <span className="run-kind" title={kindChip.title}>
          <span className="run-kind-glyph" aria-hidden="true">{kindChip.glyph}</span>
          {kindChip.word}
        </span>
      )}
```
with `const kindChip = runKindChip(run);` beside `const crossing = crossingNote(run);` (`:166`) and the import added to the `runWords` import line. `fleet.css`: after `.run-row .run-crossing-glyph { … }` add
```css
.run-row .run-kind {
  display: inline-flex; align-items: baseline; gap: var(--sp-1);
  min-width: 0;
  font-size: var(--text-2xs);
  color: var(--ink-secondary);
}
.run-row .run-kind-glyph { color: var(--ink-tertiary); }
```

- [ ] **Step 4: Run, mutate, restore.** `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx` → PASS (the whole file — existing rows carry `kind:'work'` from Task 3's fixture and render no chip). Mutant: make `runKindChip` return `null` for `'review'` → the render test FAILS. Restore.

- [ ] **Step 5: Commit**
```bash
git add pwa/src/fleet/runWords.ts pwa/src/screens/RunsScreen.tsx pwa/src/fleet/fleet.css pwa/test/runs-screen.test.tsx
git commit -F - <<'MSG'
feat(pwa): a kind chip on review rows — glyph, word, and the reviewed run's id

runKindChip is the one tolerant reader of RunSummary.kind/reviews; an older
server's rows render exactly as before (design 2026-09-14 §8).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 13: Prose — README, CLAUDE.md, the parent spec's bullet, the cap dial

**Files:**
- Modify: `docs/superpowers/specs/2026-08-07-build7-fleet-coordination-design.md:212-217`
- Modify: `README.md:1607-1608`, `:1691-1699`, `:1355-1372`
- Modify: `CLAUDE.md` ("Coordination (Build 7) invariants" — the cap sentence and the skills bullets)
- Modify: `shared/api.ts` — `CoordCapsUsage`'s docstring (`:5048-5054`), `capsUsage`'s D-13 comment is already done (Task 1)
- Test: `server/test/readme-holds.test.ts` and `server/test/worker-skill.test.ts` / `coordinator-skill.test.ts` / `reviewer-skill.test.ts` (count checks) — run after editing

- [ ] **Step 1: The parent spec (spec §13).** In the Build 7 design's "Wave lifecycle" bullet (`:212-217`) replace "re-measures the done fingerprint, reviews the handoff commit, updates the hold reason" with "re-measures the done fingerprint, **dispatches a review run and rules on its report** (design 2026-09-14), updates the hold reason", and the bullet's last sentence "the quality gate stays ordinary review of the handoff commit" with "the quality gate stays ordinary review of the handoff commit — run by a dispatched reviewer in its own worktree, ruled on by the coordinator". Leave §7 (`:246-251`) untouched: it was right.

- [ ] **Step 2: README.** (a) `:1607-1608`: "5. The coordinator reviews the handoff commit like any other diff — brief *quality* stays discipline…" → "5. The coordinator **dispatches a review run** (`POST /api/runs` with `kind:'review'`, `reviews:<id>`) whose reviewer reads the wave in its own worktree at one measured tip and mails one report; the coordinator closes that run on the reviewer's `{reviewedTip, report}` — refused `stale-review` if the worker pushed meanwhile — and rules: send back (`advance` to `working`, cap-checked, refused `review-in-flight` while the review is open) or advance to `merging`. Brief *quality* stays discipline…" then the existing "…then must **open wave N+1 before it can close wave N**" sentence follows unchanged.
  (b) `:1691-1699` (caps): "`maxConcurrentWorkers` (default 3 — runs currently dispatched and not yet terminal)" → "`maxConcurrentWorkers` (default 3 — runs currently dispatched and in an ACTIVE state, `dispatched` or `working`; a worker at `awaiting-review`, `merging` or `closing` is idle by contract and holds no slot — design 2026-09-14 §7.1; the one edge back into `working` is cap-checked on `POST /api/runs/:id/advance`)". After "…both checked at `POST /api/runs/:id/dispatch` before anything else is touched." add: "**Review runs are dispatches**, so a programme that made N dispatches per wave now makes about 2N; the seed `maxSessionsPerDay` of 12 covers roughly six waves a day, not twelve — raise the dial through `POST /api/coord/caps` when a programme runs hot rather than discovering `cap-daily` mid-wave (§7.3)."
  (c) `:1355-1372`: "**Both skills ship…**" → "**All three skills ship…**"; extend the sentence Task 8 added so the paragraph names the reviewer's installer beside the other two and says the order is coordinator → worker → reviewer.

- [ ] **Step 3: CLAUDE.md.** In "Coordination (Build 7) invariants": after the `POST /api/coord/caps` sentence add one bullet: "- **The dispatch cap counts ACTIVE runs** (`ACTIVE_RUN_STATES` in `shared/api.ts`: `dispatched`, `working`, `unknown`) — a run at `awaiting-review`/`merging`/`closing`/`planned` holds no slot, and `advance -> working` from an idle state is cap-checked (design 2026-09-14 §7). `run-states.test.ts` pins that every `RunState` is classified exactly once; never add a state without placing it." Task 8's reviewer bullet is already there; make sure it and the worker bullet read as a pair.

- [ ] **Step 4: `CoordCapsUsage`'s docstring** (`shared/api.ts:5048-5054`): add "`running` counts ACTIVE runs only since design 2026-09-14 §7.1 — see `ACTIVE_RUN_STATES`."

- [ ] **Step 5: Run every prose pin.** `cd server && ./node_modules/.bin/vitest run test/readme-holds.test.ts test/worker-skill.test.ts test/coordinator-skill.test.ts test/reviewer-skill.test.ts test/box-token-census.test.ts test/coord-pause-route.test.ts test/single-definition.test.ts` → PASS. (`readme-holds.test.ts` pins README sentences by content; if one of the three README edits reds it, the edit changed a pinned sentence — read the pin, keep its sentence, and place the new text beside it.)

- [ ] **Step 6: Commit**
```bash
git add docs/superpowers/specs/2026-08-07-build7-fleet-coordination-design.md README.md CLAUDE.md shared/api.ts
git commit -F - <<'MSG'
docs: the coordinator dispatches review — README, CLAUDE.md and Build 7's wave-lifecycle bullet say so

Spec 2026-09-14 §13's amendment to the parent; the cap's new predicate and
the maxSessionsPerDay expectation (§7.3) in README's caps paragraph; the
three-skill install order.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
```

---

### Task 14: Final gate — whole suites, cross-branch deviation check, deploy notes

**Files:**
- Modify: this plan's `## Deviations found` (append any execution-time entries, each with a minted number)
- No source changes expected

- [ ] **Step 1: The three suites, foreground, in isolation from other load.**
```bash
cd server && ./node_modules/.bin/vitest run          # timeout ≥ 600000 ms
cd ../agent && ./node_modules/.bin/vitest run
cd ../pwa   && ./node_modules/.bin/vitest run
```
Expected: all green. A red in `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests` or `ccd-session-state` is a KNOWN load flake — re-run that file alone before calling it a break (CLAUDE.md). Any other red is this plan's.

- [ ] **Step 2: The cross-branch deviation check.** `git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts` — red means another branch defined one of D-2794..D-2800 (or an execution-time number) too; the loser re-mints. Expected: green.

- [ ] **Step 3: Read the diff as a reviewer would.** `git log --oneline origin/main..HEAD` — fourteen commits, each green on its own. `git diff origin/main..HEAD --stat`. Confirm no file outside the File structure table changed except test fixtures Task 3 step 8 named; list any that did in the ledger.

- [ ] **Step 4: Deploy notes (for the PR body and the programme ledger).**
  - **AGENT-FIRST.** `bash deploy/deploy.sh agent` ships `ccd/`, the three skill trees and their installers; verify on the fleet host with `ls ~/.cc-sessions/reviewer-skill/SKILL.md` and, per rostered home, `ls <configDir>/skills/ccrc-reviewer/SKILL.md` (existence by `ls` only). Then `bash deploy/deploy.sh` for the server: migration 11 runs at boot; `/health` reports the shipped sha.
  - **The cap changes under live programmes the moment the server boots**: any run at `awaiting-review`/`merging`/`closing` stops counting. On 2026-09-14 that would have freed 2 of 7 slots (runs 39, 40). Nothing to do; say it in the PR body.
  - **`maxSessionsPerDay`**: review runs are dispatches; a programme's per-wave dispatch count roughly doubles. Live value is an operator dial (`POST /api/coord/caps`, 1–64); raise it if `cap-daily` appears.
  - **Live coordinators keep working on the old skill until their home's skill converges** — the agent deploy converges every rostered home, and a coordinator reads the skill at its next kickoff; a coordinator mid-wave on the old text still reviews inline until then. That is acceptable for one generation.

- [ ] **Step 5: Ledger and PR.** Append this plan's execution outcome to `docs/superpowers/programs/<the programme that executes it>.md` if run as a programme; otherwise the PR body carries Step 4 verbatim. Hand-write the squash body; GitHub blob URLs only (never a docserver URL) in the PR.
