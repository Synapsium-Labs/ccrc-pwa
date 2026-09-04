# program-leverage wave 6 — F6+F7a: the coordinator quiet window and the caps route — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a coordinator idling AT a wave boundary a mail lane sized for that idling, put the two
coordination caps behind an operator dial instead of a sqlite editor, and replace three (measured: five)
prose claims about the box-token surface with a mechanism that derives the surface from its own call
sites.

**Architecture:** Three independent pieces on one branch. (1) `sweepMail` learns one new fact — is this
recipient the `claimedBy` of a non-terminal run — from one new synchronous `CoordStore` query, read once
per sweep, and selects between two named thresholds with it; workers and every other session are
untouched. (2) `POST /api/coord/caps` is an ordinary PWA-surface write (session-gated armed, open dark,
NOT box-token, NOT a D-282 release valve) over a new L1 policy module; its read half `GET
/api/coord/caps` exists because `capsUsage` reaches the PWA nowhere today. (3) A new scanner derives the
box-token surface from the `requireMailToken`/`checkMailToken` call sites across BOTH files that hold
them and asserts that no prose site under-claims it — and every prose site is corrected in the same
commit, because the scanner reds the build until they are.

**Tech Stack:** TypeScript (Node >= 22.13.0, `node:sqlite`), Fastify, vitest 4.1.10, React 19 + plain
global CSS. Four packages, run cd'd in: `server/` `agent/` `pwa/` `shared/`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-program-leverage-design.md` §8, on the ref
`origin/ws/brisk-meadow` (NOT on `main`). Program ledger:
`docs/superpowers/programs/program-leverage.md` on that same ref — its "Next-wave brief" section is this
wave's brief, and its wave-5 close record carries the two rulings folded in as item 3. Run 19, wave 6 of 8.

---

## Global Constraints

- **Branch discipline.** Commit on `ws/quiet-meadow`, this workspace's own branch, NEVER a feature
  branch. The done-fingerprint re-measures this branch's tip; work parked elsewhere wedges every close
  `stale-tip` forever.
- **NOT AGENT-FIRST.** Server + PWA + shared + root docs only. No `ccd/`, no `session-hook.sh`, no skill
  corpus. A finding that pushes into `ccd/coordinator-skill/` is MAILED to the coordinator before
  implementing — it changes the coordinator's deploy lane. (One such finding is already reported: D-1168.)
- **Wire discipline.** Additive-only fields; a single reader per field; an older peer omitting a field is
  tolerated; NO `FLEET_PROTO` bump (it stays 1); no new ccd verbs; `EXEC_COMMANDS` stays `['tmux','ccd']`.
- **No overloaded null at any new seam.** Two conditions a caller handles differently must not collapse
  to one value. Specifically: "no coordination database" ≠ "caps unreadable" ≠ "cap is zero"; "the write
  landed" ≠ "the answer was unreadable" ≠ "the request never happened".
- **TDD red-first, mutation-table discipline.** Every step that adds a guard is preceded by a step that
  measures it RED, with the **exact first failing assertion recorded verbatim** in that task's mutation
  table. Write the row THE MOMENT you measure it — wave 5 lost its whole record to a compaction between
  measuring and writing back, and the review, not the record, is what found the gap.
- **Every "behaviour unchanged" claim gets a fixture that could witness the change.** An absence
  assertion whose fixture cannot produce the presence is this program's recurring defect class; so is a
  pin whose premise (a hydrated store, a populated set) is never established. Wave 5 shipped one of each,
  and a third that was pinned by a green test whose title described a different situation.
- **Deviations.** This wave's numbers are `D-1162..1172` plus `D-1208`, `D-1209`, `D-1210`, `D-1211..1227`, `D-1228..1239` and `D-1240`, `D-1241`, `D-1242`, allocated from `POST /api/ledger/deviations` at
  planning time (floor was 1157, is now 1173). Never invent, predict or reuse a number. Every number
  cited in the diff must be DEFINED in this plan's `## Deviations found` section in the same commit as
  (or before) the source comment citing it — `server/test/deviation-refs.test.ts:137-152` reds otherwise,
  and its `DEFINED` regex is `/^(?:#{2,4} |- \*\*)D-(\d+)\b/`, so an entry must be an H3/H4 heading or a
  `- **D-N**` bullet. Spell an unconsumed range with ONE prefix and a bare upper bound (`D-1162..1172`), never with a second `D-` on the upper bound: `floorFromScan` reads every tracked `D-<n>` as a REF, so writing the top of an unspent range as a ref seeds the fleet's floor there for ever.
- **Suites run in the FOREGROUND, `timeout 600000`, cd'd into the package**, tails READ not grepped.
  `./node_modules/.bin/vitest run` — NEVER bare `npx vitest` (it resolves a global copy with no jsdom and
  falsely reports "no tests"). All three packages are already installed; do not `npm ci`.
- **Node floor `>=22.13.0`** identical across the three engines. If `node-floor.test.ts`'s assertion 3 is
  red while 1-2 are green, RAISE engines — never lower them.
- No account-name list in any shipped source file. No secret file CONTENTS printed, ever.

---

## Execution order, and why it is not the task numbering's accident

| after | before | the edge |
|---|---|---|
| 1 | 2 | Task 2's sweep reads `openCoordinatorIds()`; the method must exist and be pinned first. |
| 3 | 5 | The route calls `decideCaps`; the pure decision is testable without a server and is measured first. |
| 4 | 5 | The route writes a `'coord'` feed event; the kind must exist in `shared/api.ts` and in the PWA's two total maps or task 5 does not typecheck. |
| 4 | 7 | The PWA's caps client reads `CoordCapsUsage`, minted in task 4. |
| 5 | 7 | The control cannot be written against a route that does not answer yet. |
| 8 | 9 | Both touch `coord/routes.ts`; task 8's census scanner reads that file's source, and task 9 changes two of its handlers. Landing 9 first would make 8's first red ambiguous. |
| — | 10 | Task 10 measures the whole branch and is last by construction. |

Tasks 2, 5+7, and 8+9 are three independent lanes. Within task 5 the route and the pins its EXISTENCE
moves are **one task on purpose**: `auth-gate.test.ts`'s five hand-pinned integers and
`coord-pause-route.test.ts`'s two-direction scan go red the instant the route is registered, and a
reviewer cannot approve the route while rejecting the count update. Splitting them would leave the branch
red between two commits.

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `server/src/coord/store.ts` | Modify (~`:1234`, beside `openRunsForSession`) | Gains `openCoordinatorIds(): string[]` — the session ids that are the `claimedBy` of at least one non-terminal run. Synchronous, one statement, no hydration. |
| `server/src/watch.ts` | Modify (`:207` constants, `:2296+` cache, `:2325` + `:2597` gates) | Gains `COORD_QUIET_MS` / `COORD_COOLDOWN_MS` and one per-sweep coordinator set; the two existing gates select a threshold. |
| `server/src/coord/caps.ts` | **Create** | L1 pure policy: `CAP_MIN`, `CAP_MAX`, `decideCaps(current, body)` returning a typed union. No `fs`, no fastify, no `reply`. |
| `shared/api.ts` | Modify (`:2828`, `:2841`, `:3896`) | `NotifyEvent['kind']` gains `'coord'`; `NOTIFY_KINDS` follows; new `CoordCapsUsage` and `CoordCapsView` wire types beside `CoordCaps`. |
| `server/src/coord/routes.ts` | Modify (new routes after `:1281`; `:461-469` and `:1694-1702`) | Gains `GET`/`POST /api/coord/caps`; the two remaining `runId` body readers gain the lower bound. |
| `server/src/auth/gate.ts` | Modify (`:75-91`, `:663-664`) | Three stale count paragraphs corrected. EXEMPT is **not** touched — the caps routes are deliberately not exempt. |
| `pwa/src/lib/api.ts` | Modify (after `:649`) | Gains `coordCaps()` and `setCoordCaps(partial)`. |
| `pwa/src/fleet/CapsControl.tsx` | **Create** | The operator dial: reads caps+usage, renders usage vs cap, writes, settles on the response body. No timers. |
| `pwa/src/screens/RunsScreen.tsx` | Modify (`:594`) | Mounts `<CapsControl/>` immediately after `<CoordBanner/>`. |
| `pwa/src/fleet/fleet.css` | Modify (after `:2079`) | `.caps-control` and its parts, self-grounded, `var(--tap-min)` floors. |
| `pwa/src/screens/MailScreen.tsx` | Modify (`:43`, `:46`) | Two total `Record<NotifyEvent['kind'], …>` maps gain the `coord` entry. |
| `README.md` | Modify (`:529-531`, `:1405-1425`) | The two count/class claims corrected to the derived truth. |
| `CLAUDE.md` | Modify (`:10` only if the line count demands it) | The box-token bullet is **not reworded** — its opening anchor and the `D-282 (was D-B4-9)` token are both load-bearing. It gains a pin instead. |
| `server/test/coord-store.test.ts` | Modify | Pins `openCoordinatorIds` including the terminal-run and reclaim traps. |
| `server/test/mail-sweep.test.ts` | Modify | Pins both thresholds in BOTH directions. |
| `server/test/coord-caps-policy.test.ts` | **Create** | The L1 mutation table for `decideCaps`. |
| `server/test/coord-caps-route.test.ts` | **Create** | Route shape, posture, feed event, notConfigured, mutex, and the `setCaps`-has-exactly-one-caller pin. |
| `server/test/box-token-census.test.ts` | **Create** | Derives the surface from its call sites; asserts no prose site under-claims it. |
| `server/test/auth-gate.test.ts` | Modify (`:195-204`, `:401-441`, `:476`) | Five integers moved; the EIGHTEEN title corrected. |
| `server/test/coord-pause-route.test.ts` | Modify (`:160-235`) | Gains `SESSION_ONLY`, asserted disjoint from `UNGATED` in both directions. `UNGATED.size` stays 4, so no prose cardinal moves. |
| `server/test/run-routes.test.ts` | Modify | Two `runId` lower-bound cases. |
| `pwa/test/caps-control.test.tsx` | **Create** | The control's own unit tests. |
| `pwa/test/runs-screen.test.tsx` | Modify (`:469-501`) | DOM-order mount pin extended to the caps control. |
| `pwa/test/api.test.ts` | Modify | Fetch-level pins for both new client methods. |
| `pwa/test/tap-targets.test.tsx` | Modify (`:236-249`) | The new control joins the floored-rule loop. |
| `docs/superpowers/plans/2026-08-31-program-leverage-wave6-f6-f7a.md` | **Create** (this file) | The wave's plan, ledger and execution record. |

---

## Verified facts this plan is built on

Every premise below was measured in this worktree at `origin/main` = `6458a14d`. Anchors drift; step 1 of
each task re-confirms the ones it depends on and STOPS if one has moved.

| fact | anchor/command |
|---|---|
| `MAIL_QUIET_MS = 60_000`, one read site in all of `server/src` | `server/src/watch.ts:202`, read at `:2597` |
| `MAIL_COOLDOWN_MS = 120_000`, one read site in all of `server/src` | `server/src/watch.ts:207`, read at `:2325` |
| The cooldown gate is the FIRST statement inside the try/finally that holds `mailInFlight` | `server/src/watch.ts:2323-2325` |
| The not-quiet gate is the LAST rung before `seen.add` and `sendPrompt` | `server/src/watch.ts:2595-2597`, `:2603`, `:2649` |
| No `CoordStore` method answers "is X the `claimedBy` of a non-terminal run" | `openRunsForSession` keys on `sessionId` (`store.ts:1232`); `runs()` returns hydrated rows (`store.ts:1183`) |
| The tree's canonical non-terminal predicate is `state NOT IN ('done','failed')` | `store.ts:1187`, `:1195`, `:1232`, `:1285` |
| `reclaimProgram` rewrites `claimedBy` on EVERY run of a programme, terminal rows included | `store.ts:620-660`; `RunSummary.claimedBy` docstring, `shared/api.ts:3679-3691` |
| `MailGate` is a closed 13-member union with a total map and a total PWA phrase table | `shared/api.ts:3551-3568`; `pwa/src/session/MailStrip.tsx:93` |
| Four text-scanning guards police any new rung in `sweepMail` | `mail-sweep.test.ts:2243`, `:2265`, `:2305`; `lifecycle-sweep.test.ts:124` |
| `setCaps` has ZERO production callers; four test callers, all in one file | `store.ts:1357`; `run-routes.test.ts:251,281,312,1656`; `coord-store.test.ts:174` |
| `setCaps` does NO validation and returns `void`; `caps()` THROWS on the same missing row | `store.ts:1350-1361` |
| Migration 1 is FROZEN; `COORD_SCHEMA_VERSION` derives from `MIGRATIONS.length` | `coord/schema.ts:148-156`, `:686` |
| `capsUsage()` is an inline structural type with no name and no presence in `shared/api.ts` | `store.ts:1372` |
| `capsUsage` / `CoordCaps` / `maxConcurrentWorkers` appear ZERO times in `pwa/src` | `grep -rn 'capsUsage\|CoordCaps\|maxConcurrentWorkers' pwa/src` |
| `CoordStatus` carries exactly `{pause, mail}`; `emitCoord` touches no `node:sqlite` BY DESIGN | `shared/api.ts:2633`; `server/src/watch.ts:1024-1046` |
| The feed lane is a STORE WRITE; its one production caller is the PRIVATE `pushOne` | `store.ts:2161-2169`; `watch.ts:1225-1228` |
| `notifyLog.record()` mints `{seq, at}` and appends to the ring; it does NOT push | `server/src/notifylog.ts:54-59` |
| `NotifyEvent['kind']` is a closed six-token union with two total maps in the PWA | `shared/api.ts:2828`, `:2841`; `pwa/src/screens/MailScreen.tsx:43`, `:46` |
| The pause route has NO `notConfigured` arm, deliberately, because a pause is a file | `coord/routes.ts:1265-1269` |
| There is no `ccd coord-caps` verb, so the pause route's 501/502 spine has no analogue | `ccd/ccd:13453`; `server/src/ccdargv.ts:313` |
| `coord-pause-route.test.ts` direction-one: every `app.post` with no gate ahead of its first `await` must be in `UNGATED` | `coord-pause-route.test.ts:199-224` |
| `UNGATED` is a hand-written 4-element Set; what wave 5 derived is the COUNT and the ENUMERATIONS | `coord-pause-route.test.ts:177-180`; the derived count shipped in `ca711141`, NOT `5ff7c33c` (D-1208) |
| The derived-count scanner reads five prose passages and `CARD_RE` matches only CAPS `TWO..SEVEN` | `coord-pause-route.test.ts:325-336`, `:375-394` |
| `passage()` fails loudly on a missing anchor and on a slice under 300 chars | `coord-pause-route.test.ts:343-357` |
| Five hand-pinned integers move when a route is added: 46 / 23 / 69 / 66 / 42 | `auth-gate.test.ts:195`, `:200`, `:201`, `:204`, `:476` |
| The gate posture loop compares DARK against AUTHENTICATED, not dark against armed-anonymous | `auth-gate.test.ts` clause 3; `FLAG_AWARE` is declared and size-pinned to 8 |
| `auth-gate.test.ts:401` already derives the gated set from source, from `coord/routes.ts` ALONE | `auth-gate.test.ts:401-441` — an 18-name exact `toEqual`, plus `/api/notify` asserted separately |
| The derived truth: 18 token-consulting handlers in `coord/routes.ts` + `POST /api/notify` = 19 lanes | `coord/routes.ts` 11 × `requireMailToken` + 7 × inline `checkMailToken`; `server.ts:1280` |
| `POST /api/sessions/:id/kickoff` is a coordination WRITE with ZERO token checks, registered in `server.ts` | `server.ts:1487`, no `requireMailToken`/`checkMailToken` in `:1487-1600` |
| README's two stale sites | `README.md:529-531` ("the ten machine lanes … nine box-token-gated"), `README.md:1405-1425` ("the run routes", "None of these six routes") |
| A FOURTH stale site the ticket never named | `auth/gate.ts:75`, `:77`, `:80`, `:90`, `:663` — "SEVENTEEN"/"All eighteen" (D-1242) |
| `oss-metadata.test.ts` pins `CLAUDE.md:10`'s stated README size within 10% of the real count | `oss-metadata.test.ts:89-100`; README is 2033 lines, CLAUDE.md claims ~1931, upper edge ~2124 |
| README is already text-scanned by section slice; so is CLAUDE.md, by three suites | `readme-holds.test.ts:22-34`; `oss-metadata.test.ts`; `topology-clean.test.ts:459-469` |
| Only the kickoff `runId` reader carries `>= 1`; the two in `coord/routes.ts` accept 0 and negatives | `server.ts:1540-1543` (D-1151) vs `coord/routes.ts:461-469`, `:1694-1702` |
| Out-of-range `runId` is caught downstream as 404 `unknown-run`, not 400 | `coord/routes.ts:590-593`, `:1719-1721` |
| The pause control is a separate component mounted by ONE line, with a DOM-order mount pin | `pwa/src/fleet/CoordBanner.tsx`; `RunsScreen.tsx:594`; `runs-screen.test.tsx:469-501` |
| `post` resolves to `void`; `postJsonOr` (D-1150) keeps "answer unreadable" distinct from "request never happened" | `pwa/src/lib/api.ts:273-284`, `:288-326` |
| A component with its own `setInterval` breaks the screen's cadence pin | `runs-screen.test.tsx:801-829` |
| A new floored control must join the eighteen-rule loop and use `var(--tap-min)`, never `44px` | `tap-targets.test.tsx:236-249` |
| Live frames are CAST, not validated per-member; each new field needs its own tolerant reader | `pwa/src/stores/fleet.ts:150-179`; `shared/api.ts:206-230` |
| Suites: server 244 files, agent 18, pwa 76; all `node_modules` present; node v24.14.1 | `server/vitest.config.ts:84-93`; `node --version` |

---

## Task 1: the store learns who is coordinating something live

**Files:**
- Modify: `server/src/coord/store.ts` (beside `openRunsForSession`, `:1228-1240`)
- Test: `server/test/coord-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `openCoordinatorIds(): string[]` on `CoordStore` — every distinct non-null `claimedBy` of a
  run whose `state NOT IN ('done','failed')`. Synchronous. Order unspecified; the caller builds a `Set`.

`openRunsForSession` looks like the answer and is not: it selects on `sessionId`, the WORKER column
(`store.ts:1232`). The coordinator lives in `claimedBy`. `runs()` would work but hydrates every open run
— a `programs` JOIN and a `prLineage` JSON parse per row — which is exactly the cost `OpenSibling`'s own
docstring (`store.ts:53-57`) says this tree does not pay to answer a question that turns on a few
columns. One statement, no hydration (D-1241).

Two traps this method must not fall into, both measured: `reclaimProgram` rewrites `claimedBy` across
EVERY run of a programme including terminal ones (`store.ts:620-660`), so "this id appears in some
`claimedBy`" is NOT the fact wanted; and `resolveCoordinator` has no state predicate at all
(`store.ts:1545`), so it is not a model to copy here. Mirror `programOpenRunCount`'s predicate
(`store.ts:1285`) verbatim — the shipped SQL spelling, not a re-derivation from `RUN_TRANSITIONS`, which
disagrees about `'unknown'`.

- [ ] **1.1 — Re-confirm the anchors, and STOP if any has moved.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '1228,1240p' server/src/coord/store.ts     # openRunsForSession — the sibling to sit beside
sed -n '1282,1290p' server/src/coord/store.ts     # programOpenRunCount — the predicate to mirror
grep -n "state NOT IN ('done','failed')" server/src/coord/store.ts
```

Expected: `openRunsForSession` at :1228, `programOpenRunCount` at :1282, and four `NOT IN` sites.

- [ ] **1.2 — Write the failing tests.** Append to `server/test/coord-store.test.ts`, inside the existing
top-level describe. Use the file's own store-building helper (read the top of the file and copy the
idiom; do not invent a second one).

```ts
  describe('openCoordinatorIds', () => {
    it('names a session that is the claimedBy of a non-terminal run', () => {
      const s = freshStore();
      s.openRun({ program: 'p', programTitle: 'P', wave: 1, waveOf: 8, project: 'proj',
        claimedBy: 'the-coordinator', now: 1 });
      expect(s.openCoordinatorIds()).toEqual(['the-coordinator']);
    });

    it('does NOT name a session whose only claimed run is terminal', () => {
      // The reclaim trap: `reclaimProgram` rewrites `claimedBy` on terminal rows
      // too, so "appears in some claimedBy" is not the fact this answers.
      const s = freshStore();
      const id = s.openRun({ program: 'p', programTitle: 'P', wave: 1, waveOf: 8, project: 'proj',
        claimedBy: 'the-corpse', now: 1 });
      closeRunDone(s, id);                       // drive it to 'done' by the file's own helper
      expect(s.openCoordinatorIds()).toEqual([]);
    });

    it('does NOT name the WORKER — sessionId is not claimedBy', () => {
      // The direction openRunsForSession would have got wrong.
      const s = freshStore();
      const id = s.openRun({ program: 'p', programTitle: 'P', wave: 1, waveOf: 8, project: 'proj',
        claimedBy: 'the-coordinator', now: 1 });
      s.markDispatched(id, 'the-worker', 'ws-1', 'ws/ws-1', 2);
      expect(s.openCoordinatorIds()).toEqual(['the-coordinator']);
    });

    it('names one coordinator once, however many open runs it holds', () => {
      const s = freshStore();
      for (const wave of [1, 2]) {
        s.openRun({ program: `p${wave}`, programTitle: 'P', wave, waveOf: 8, project: 'proj',
          claimedBy: 'the-coordinator', now: wave });
      }
      expect(s.openCoordinatorIds()).toEqual(['the-coordinator']);
    });

    it('is empty on a store with no runs at all', () => {
      expect(freshStore().openCoordinatorIds()).toEqual([]);
    });
  });
```

Adjust `freshStore()`/`closeRunDone()`/`openRun`'s exact argument shape to whatever
`server/test/coord-store.test.ts` already uses — read it first. The four assertions must survive that
adaptation unchanged in MEANING: present, terminal-excluded, worker-excluded, de-duplicated.

- [ ] **1.3 — Run them and record the red.**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-store.test.ts`
Expected: FAIL — `s.openCoordinatorIds is not a function`. Record the first failing assertion verbatim in
this task's mutation table.

- [ ] **1.4 — Implement.** Insert immediately after `openRunsForSession`'s closing brace:

```ts
  /** The sessions COORDINATING something live: every distinct `claimedBy` of a
   *  run this build calls non-terminal. Not `openRunsForSession`'s question —
   *  that one keys on `sessionId`, the WORKER column, which is the opposite
   *  fact (D-1241).
   *
   *  Two columns, no JOIN and no `hydrateRun`, for `OpenSibling`'s stated
   *  reason (`:53-57`): dragging `prLineage` JSON and a `programs` join through
   *  a question that turns on one column is a cost this tree does not pay.
   *
   *  The predicate is `programOpenRunCount`'s (`:1285`), copied rather than
   *  re-derived. `RUN_TRANSITIONS` would answer differently — it gives `unknown`
   *  an empty target list, so a table-derived predicate would call an `unknown`
   *  row terminal while every shipped query calls it open. The SQL spelling is
   *  the one the rest of this file agrees with.
   *
   *  A row whose `claimedBy` was rewritten by `reclaimProgram` (`:620-660`) onto
   *  a TERMINAL run does not appear here, and must not: that rewrite touches
   *  every run of a programme, so appearing in some `claimedBy` is not evidence
   *  of coordinating anything live. */
  openCoordinatorIds(): string[] {
    return (this.db.prepare(
      'SELECT DISTINCT claimedBy FROM runs ' +
      "WHERE claimedBy IS NOT NULL AND state NOT IN ('done','failed')",
    ).all() as { claimedBy: string }[]).map((r) => r.claimedBy);
  }
```

- [ ] **1.5 — Run them and record the green.**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-store.test.ts`
Expected: PASS, with the file's prior count plus 5.

- [ ] **1.6 — Measure the mutation table.** For each row: apply the mutation, run the command above,
record the **first failing assertion verbatim**, then revert from a working-tree snapshot and confirm
`git diff --stat` is clean before the next one.

  | mutation | first-fail assertion |
  |---|---|
  | drop `AND state NOT IN ('done','failed')` from the query | `AssertionError: expected [ 'the-corpse' ] to deeply equal []` ❯ the terminal-run test |
  | change `claimedBy` to `sessionId` in both the SELECT and the WHERE | `AssertionError: expected [] to deeply equal [ 'the-coordinator' ]` |
  | drop `DISTINCT` | `AssertionError: expected [ Array(2) ] to deeply equal [ 'the-coordinator' ]` |
  | drop `claimedBy IS NOT NULL` | **GREEN as written — hole. Closed, then:** `AssertionError: expected [ null ] to deeply equal []` ❯ `test/coord-store.test.ts:1875:36` |

  **The hole, named.** Every fixture in the first draft went through `openRun`, whose signature requires a
  `claimedBy: string` — so no row in the suite could ever carry a null and the guard could not be
  witnessed. A null `claimedBy` IS reachable: `reconstruct`'s disaster-recovery INSERT binds it (
  `store.ts:2406`) and rebuilds a NON-terminal wave, which is precisely the row the guard exists for.
  Closed with a fixture that establishes its own premise — the rebuilt run is asserted `working` and its
  `claimedBy` asserted null BEFORE the method is called — and re-measured red. Without it the method
  answers `[null]` typed `string[]`, a null wearing a session id's type, into a `Set` the mail lane then
  asks about.

- [ ] **1.7 — Commit.**

```bash
git add server/src/coord/store.ts server/test/coord-store.test.ts
git commit -m "feat(coord): the store can name the sessions coordinating something live (D-1241)"
```

---

## Task 2: the coordinator quiet window

**Files:**
- Modify: `server/src/watch.ts` (`:207` constants; `:2296+` the per-sweep set; `:2325` and `:2597` gates)
- Test: `server/test/mail-sweep.test.ts`

**Interfaces:**
- Consumes: `CoordStore.openCoordinatorIds(): string[]` from task 1.
- Produces: nothing importable — both constants are module-private, exactly like the pair they sit beside.

The lane's composed wake floor is ~60-74 s per event and at most one machine wake per ~2 minutes. That
is right for a worker mid-thought and wrong for a coordinator idling AT a wave boundary BY DESIGN,
because its own contract clause 7 mandates it end its turn and wait. The fix is one fact and two
thresholds; nothing else about the ladder changes.

**No new `MailGate` member, deliberately (D-1167).** `MailGate`'s docstring says one member per
CONDITION, not per `continue` — `no-pane` and `no-config-dir` were split because an operator acts on them
differently. Here the condition is identical (`this session has not been quiet long enough`) and the
operator's act is identical (wait). The union is also explicitly NOT a scheduling input: it exists so a
human can tell "waiting" from "wedged", and both thresholds are waiting. Adding `coord-not-quiet` would
cost a member, a total-map entry in `shared/api.ts` and a phrase in `MailStrip.tsx` to record a
distinction nobody acts on.

**Four text-scanning guards police this function** and each fails differently — re-read them before
editing: `mail-sweep.test.ts:2243` (every `MailGate` member has a literal `gated(d,'…')` call site and
vice versa, both directions), `:2265` (every pre-send `continue;` has a `gated(` in its OWN enclosing
block), `:2305` (no gate column in any WHERE/ORDER BY/GROUP BY/HAVING) and `lifecycle-sweep.test.ts:124`
(only three `/[Ll]ifecycle/` identifiers permitted inside `sweepMail`). This change adds no `continue`
and no gate token, so it should disturb none of them — which is a claim task 10 re-measures, not an
assumption.

- [ ] **2.1 — Re-confirm the anchors, and STOP if any has moved.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '196,208p'   server/src/watch.ts    # the two constants and their docstrings
sed -n '2294,2298p' server/src/watch.ts    # `const due = …` and the `due.length === 0` return
sed -n '2322,2326p' server/src/watch.ts    # the try + the cooldown gate
sed -n '2594,2598p' server/src/watch.ts    # readLiveState + not-idle + not-quiet
grep -c 'MAIL_QUIET_MS\|MAIL_COOLDOWN_MS' server/src/watch.ts
```

- [ ] **2.2 — Write the failing tests.** Append to `server/test/mail-sweep.test.ts`. The file redeclares
the lane constants locally at `:46-51` because no import path reaches them; add the two new ones the same
way, in the same block, and note in a comment that the mirror is a mirror.

```ts
const COORD_QUIET_MS = 15_000;      // mirrors watch.ts's own; see the note at :46
const COORD_COOLDOWN_MS = 30_000;
```

Then, in a new describe:

```ts
  describe('the coordinator quiet window', () => {
    /** Make ID the claimedBy of a NON-TERMINAL run — the one fact the sweep reads. */
    const seedCoordinatorRun = (coord: CoordStore): void => {
      coord.openRun({ program: 'program-leverage', programTitle: 'P', wave: 6, waveOf: 8,
        project: 'demo', claimedBy: ID, now: NOW });
    };

    it('delivers to a COORDINATOR inside MAIL_QUIET_MS, once COORD_QUIET_MS has passed', async () => {
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedRegistry(h.home, ID);
      seedHookState(h.home, ID);
      // Quiet for longer than COORD_QUIET_MS and SHORTER than MAIL_QUIET_MS —
      // the whole window this wave opens. A fixture that used a value outside
      // both would prove nothing about either.
      seedLiveState(h.home, { statusUpdatedAt: NOW - (COORD_QUIET_MS + 1_000) });
      expect(NOW - (NOW - (COORD_QUIET_MS + 1_000))).toBeLessThan(MAIL_QUIET_MS);   // the fixture IS in the window
      seedCoordinatorRun(coord);
      queueTestDelivery(coord, ID, ENVELOPE);

      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([NUDGE]);
    });

    it('does NOT deliver to a WORKER in that same window — the mutation direction', async () => {
      // Byte-identical to the test above except for the ONE fact: this session
      // is the run's `sessionId`, not its `claimedBy`. Without this half, a
      // guard that made the narrow window universal would pass.
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedRegistry(h.home, ID);
      seedHookState(h.home, ID);
      seedLiveState(h.home, { statusUpdatedAt: NOW - (COORD_QUIET_MS + 1_000) });
      const runId = coord.openRun({ program: 'program-leverage', programTitle: 'P', wave: 6, waveOf: 8,
        project: 'demo', claimedBy: 'some-other-coordinator', now: NOW });
      coord.markDispatched(runId, ID, 'demo', 'ws/demo', NOW);
      queueTestDelivery(coord, ID, ENVELOPE);

      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([]);
      expect(deliveryRow(coord, 1).lastGate).toBe('not-quiet');
    });

    it('still holds a COORDINATOR below COORD_QUIET_MS', async () => {
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedRegistry(h.home, ID);
      seedHookState(h.home, ID);
      seedLiveState(h.home, { statusUpdatedAt: NOW - (COORD_QUIET_MS - 5_000) });
      seedCoordinatorRun(coord);
      queueTestDelivery(coord, ID, ENVELOPE);

      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([]);
      expect(deliveryRow(coord, 1).lastGate).toBe('not-quiet');
    });

    it('does NOT give the narrow window to a session whose only claimed run is TERMINAL', async () => {
      // The reclaim trap, at the lane. Task 1 pins it at the store; this pins
      // that the sweep actually reads the store's answer rather than a looser one.
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedRegistry(h.home, ID);
      seedHookState(h.home, ID);
      seedLiveState(h.home, { statusUpdatedAt: NOW - (COORD_QUIET_MS + 1_000) });
      const runId = coord.openRun({ program: 'p', programTitle: 'P', wave: 1, waveOf: 8,
        project: 'demo', claimedBy: ID, now: NOW });
      closeRunDone(coord, runId);
      queueTestDelivery(coord, ID, ENVELOPE);

      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([]);
    });

    it('puts a COORDINATOR back on the lane after COORD_COOLDOWN_MS, and a worker not', async () => {
      // Two sessions, one sweep pair, one difference. The cooldown half of the
      // change, in both directions, in one fixture.
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedRegistry(h.home, ID);
      seedHookState(h.home, ID);
      seedLiveState(h.home, { statusUpdatedAt: NOW - MAIL_QUIET_MS - 1_000 });
      seedCoordinatorRun(coord);
      queueTestDelivery(coord, ID, ENVELOPE);
      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([NUDGE]);

      // Past the coordinator cooldown, short of the worker one.
      advance(COORD_COOLDOWN_MS + 1_000);
      expect(COORD_COOLDOWN_MS + 1_000).toBeLessThan(MAIL_COOLDOWN_MS);
      seedLiveState(h.home, { statusUpdatedAt: Date.now() - MAIL_QUIET_MS - 1_000 });
      queueTestDelivery(coord, ID, ENVELOPE);
      await w.sweepMail();
      expect(literalSends(h.calls)).toEqual([NUDGE, NUDGE]);
    });
  });
```

Two fixture rules this file enforces and these tests obey: `primedWatcher` runs BEFORE every `seed*`
call, and two `sweepMail()` calls in one test are separated by `advance(...)` past `MAIL_SWEEP_MS` — the
last test's `advance(COORD_COOLDOWN_MS + 1_000)` is 31 s, comfortably past the 10 s re-sweep gate.
Confirm `deliveryRow`, `closeRunDone`, `NUDGE` and `advance` exist with those names before relying on
them; adapt to the file's own spellings if not.

- [ ] **2.3 — Run them and record the red.**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/mail-sweep.test.ts`
Expected: the coordinator tests FAIL (no delivery — the session is held at 60 s), the worker and
below-threshold tests PASS for the wrong reason. Record the first failing assertion verbatim.

- [ ] **2.4 — Add the two constants**, immediately after `MAIL_COOLDOWN_MS` at `:207`, in the same
docstring style as the pair above them (what it measures, where the number comes from, why it is not
re-derived):

```ts
/** The same two questions as `MAIL_QUIET_MS`/`MAIL_COOLDOWN_MS` above, asked of
 *  a COORDINATOR — a session whose id is the `claimedBy` of a non-terminal run.
 *
 *  The pair above is sized for a worker mid-thought: sixty seconds of measured
 *  idle before the lane may interrupt, and no second injection inside two
 *  minutes. A coordinator at a wave boundary is not mid-anything. Its own
 *  contract (clause 7, `ccd/coordinator-skill/SKILL.md`) MANDATES that it end
 *  its turn and wait, so the state the worker floor exists to protect is the
 *  state the coordinator is required to be in, and the floor becomes a delay
 *  with nothing behind it — measured at a minute-plus per wave event, on the
 *  session every other session is waiting for.
 *
 *  Fifteen seconds is still an idle floor, not an absence of one: it is read
 *  from the same `statusUpdatedAt` and answers the same question, so a
 *  coordinator genuinely mid-turn is still not interrupted. Thirty seconds of
 *  cooldown keeps `MAIL_COOLDOWN_MS`'s own promise — no fan-out arriving as a
 *  burst of prompts — at a boundary where two messages are a handoff, not a
 *  denial of service.
 *
 *  Workers and every other session read the pair above, untouched. */
const COORD_QUIET_MS = 15_000;
const COORD_COOLDOWN_MS = 30_000;
```

- [ ] **2.5 — Read the coordinator set once per sweep.** Immediately after `if (due.length === 0) return;`
(`:2297`):

```ts
    // ONE read per sweep, for every row in it — the same bargain `hsCache`
    // strikes one field over (`:2246`), and legitimate for the same reason: a
    // second read would carry this same `now`, so a cached answer is exactly as
    // fresh. Placed AFTER the `due.length === 0` return, so an idle box pays
    // nothing: no mail, no query.
    //
    // A `Set` built here rather than in the store, matching how `uuidByToId` and
    // `sessionProjects` are built from `records` — the store returns rows, the
    // sweep shapes them into what it will ask.
    const coordinators = new Set(store.openCoordinatorIds());
```

- [ ] **2.6 — Select the thresholds.** As the first statement inside the `try` at `:2323`, above
`const last`:

```ts
        // The one fact this rung adds. Read once per ROW from the per-sweep set
        // above, and consumed by exactly two gates below — the same two
        // conditions as before, at a threshold sized for the recipient.
        const isCoordinator = coordinators.has(d.toId);
```

Then change the cooldown gate at `:2325` and the not-quiet gate at `:2597` to select:

```ts
        if (now - last < (isCoordinator ? COORD_COOLDOWN_MS : MAIL_COOLDOWN_MS)) { gated(d, 'cooldown'); continue; }
```

```ts
        if (live.statusUpdatedAt === null ||
            now - live.statusUpdatedAt < (isCoordinator ? COORD_QUIET_MS : MAIL_QUIET_MS)) { gated(d, 'not-quiet'); continue; }
```

Each of the four constants keeps exactly ONE read site. Add a short comment above the not-quiet gate
recording why the gate TOKEN does not fork (D-1167): the condition and the operator's act are the same;
`MailGate` is not a scheduling input.

- [ ] **2.7 — Run and record the green.**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/mail-sweep.test.ts`
Expected: PASS, prior count plus 5.

- [ ] **2.8 — Run the four guards that police this function.**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/mail-sweep.test.ts test/lifecycle-sweep.test.ts test/deliverability-parity.test.ts
```
Expected: PASS. `deliverability-parity` is in the list because `peerDeliverable` mirrors only the
STRUCTURAL rungs and this change touches only TRANSIENT ones — a green run here is the fixture that
witnesses the claim "the peer surface is unaffected", not a comment asserting it.

- [ ] **2.9 — Measure the mutation table.** Command:
`cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/mail-sweep.test.ts`

  | mutation | first-fail assertion |
  |---|---|
  | revert the not-quiet gate to bare `MAIL_QUIET_MS` | `AssertionError: expected [] to deeply equal [ Array(1) ]` ❯ `:2433:35` (1 failed) |
  | invert the not-quiet ternary (`isCoordinator ? MAIL_QUIET_MS : COORD_QUIET_MS`) | `AssertionError: expected [ Array(1) ] to deeply equal []` ❯ `:434:35` (4 failed) |
  | make the narrow window universal (`COORD_QUIET_MS` with no ternary) | `AssertionError: expected [ Array(1) ] to deeply equal []` ❯ `:434:35` (3 failed) |
  | revert the cooldown gate to bare `MAIL_COOLDOWN_MS` | `AssertionError: expected [ Array(1) ] to deeply equal [ …(2) ]` ❯ `:2513:35` (1 failed) |
  | `coordinators` built from `records.map(r => r.id)` instead of the store | `AssertionError: expected [ Array(1) ] to deeply equal []` ❯ `:434:35` (4 failed) |
  | `COORD_QUIET_MS` raised to `60_000` (equal to the worker floor) | `AssertionError: expected [] to deeply equal [ Array(1) ]` ❯ `:2433:35` (1 failed) |

  6/6 red, no holes. Worth naming: three of the six first-fail at `:434`, which is NOT one of this
  wave's tests — it is the file's own pre-existing "does NOT deliver until the session has been quiet for
  `MAIL_QUIET_MS`". Every mutation that widens the window for everybody is caught by the worker pin that
  was already there, which is the strongest form this direction could take: the guard is held by a test
  written before the guard existed and with no knowledge of it.

- [ ] **2.10 — Commit.**

```bash
git add server/src/watch.ts server/test/mail-sweep.test.ts
git commit -m "feat(mail): a coordinator idling at a wave boundary gets a lane sized for it (D-1167)"
```

---

## Task 3: the caps decision, as a pure function

**Files:**
- Create: `server/src/coord/caps.ts`
- Test: `server/test/coord-caps-policy.test.ts`

**Interfaces:**
- Consumes: `CoordCaps` from `shared/api.ts`.
- Produces:
  - `export const CAP_MIN = 1;`
  - `export const CAP_MAX = 64;`
  - `export type CapsDecision = { ok: true; next: CoordCaps } | { ok: false; detail: string };`
  - `export function decideCaps(current: CoordCaps, body: unknown): CapsDecision;`

L1: a pure decision, no `fs`, no fastify, no `reply`. This follows `coord/ledger.ts`'s form (a named
ceiling plus a policy function that REFUSES, `ledger.ts:15`, `:45-47`) rather than a clamp — a clamp
would silently write a number the operator did not ask for, and `store.ts:397`'s clamp idiom is for LIMIT
arguments only, never for policy values.

`setCaps` itself validates NOTHING and returns `void` (D-1164): `0`, `-5`, `1.5` and `1e9` all persist
today. `maxConcurrentWorkers: 0` is a real wedge — `dispatch.ts:238` compares with `>=`, so zero refuses
EVERY dispatch, and unlike the pause marker there is no ungated door to undo it. Hence `CAP_MIN = 1`.

`CAP_MAX = 64` is a fat-finger ceiling, not a statement about fleet size: the box runs ~20 live sessions,
so 64 is far above any real setting and far below the range where `640` or `6400` could read as
deliberate. One ceiling serves both fields on `MAIL_QUIET_MS`'s own stated principle — two numbers for
one policy is two numbers to get out of step.

- [ ] **3.1 — Write the failing tests.** Create `server/test/coord-caps-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CAP_MAX, CAP_MIN, decideCaps } from '../src/coord/caps.js';
import type { CoordCaps } from '../../shared/api.js';

const CURRENT: CoordCaps = { maxConcurrentWorkers: 3, maxSessionsPerDay: 12 };

describe('decideCaps', () => {
  it('takes a partial: an omitted field keeps its current value', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 5 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 5, maxSessionsPerDay: 12 } });
    expect(decideCaps(CURRENT, { maxSessionsPerDay: 20 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 3, maxSessionsPerDay: 20 } });
  });

  it('takes both at once', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 4, maxSessionsPerDay: 16 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 4, maxSessionsPerDay: 16 } });
  });

  it('refuses a body that asks for nothing — a no-op write is a caller bug, not a write', () => {
    // Not an overloaded success: answering ok to a request that changes nothing
    // would make "the caps are now what you sent" and "you sent nothing" the
    // same 200.
    const r = decideCaps(CURRENT, {});
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ detail: expect.stringContaining('at least one of') });
  });

  it.each([
    ['zero workers — the wedge dispatch cannot undo', { maxConcurrentWorkers: 0 }],
    ['negative', { maxConcurrentWorkers: -1 }],
    ['fractional', { maxConcurrentWorkers: 1.5 }],
    ['above the ceiling', { maxConcurrentWorkers: CAP_MAX + 1 }],
    ['a numeric string', { maxConcurrentWorkers: '4' }],
    ['null', { maxConcurrentWorkers: null }],
    ['NaN', { maxConcurrentWorkers: Number.NaN }],
    ['Infinity', { maxConcurrentWorkers: Number.POSITIVE_INFINITY }],
    ['zero per day', { maxSessionsPerDay: 0 }],
    ['per day above the ceiling', { maxSessionsPerDay: CAP_MAX + 1 }],
    ['per day fractional', { maxSessionsPerDay: 2.5 }],
  ])('refuses %s', (_label, body) => {
    expect(decideCaps(CURRENT, body).ok).toBe(false);
  });

  it('accepts exactly the boundary values', () => {
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: CAP_MIN, maxSessionsPerDay: CAP_MAX }).ok).toBe(true);
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: CAP_MAX, maxSessionsPerDay: CAP_MIN }).ok).toBe(true);
  });

  it('refuses a non-object body without throwing', () => {
    for (const body of [null, undefined, 4, 'caps', []]) {
      expect(decideCaps(CURRENT, body).ok).toBe(false);
    }
  });

  it('ignores an unknown extra key rather than refusing over it', () => {
    // Additive tolerance: a newer client sending a third field must not be
    // refused by an older server, per the wire rule.
    expect(decideCaps(CURRENT, { maxConcurrentWorkers: 4, maxSomethingElse: 9 }))
      .toEqual({ ok: true, next: { maxConcurrentWorkers: 4, maxSessionsPerDay: 12 } });
  });

  it('names the offending field in the detail', () => {
    expect(decideCaps(CURRENT, { maxSessionsPerDay: 0 }))
      .toMatchObject({ ok: false, detail: expect.stringContaining('maxSessionsPerDay') });
  });
});
```

- [ ] **3.2 — Run and record the red.**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-caps-policy.test.ts`
Expected: FAIL — cannot resolve `../src/coord/caps.js`. Record verbatim.

- [ ] **3.3 — Implement.** Create `server/src/coord/caps.ts`:

```ts
import type { CoordCaps } from '../../../shared/api.js';

/** L1. A pure decision about a caps write — no `fs`, no fastify, no `reply`.
 *
 *  `CoordStore.setCaps` validates NOTHING and returns `void` (`store.ts:1357`,
 *  D-1164): 0, -5, 1.5 and 1e9 all persist today, and nothing in the tree ever
 *  called it, so the absence never showed. This module is the check that has to
 *  exist before a route does.
 *
 *  It REFUSES rather than clamps, following `ledger.ts:45-47`. A clamp would
 *  write a number the operator did not ask for and answer 200, which is the
 *  same lie as a silent truncation. */

/** One is the floor, and the reason is a wedge rather than tidiness:
 *  `dispatch.ts:238` refuses on `usage.running >= caps.maxConcurrentWorkers`,
 *  so `0` refuses EVERY dispatch for ever — and unlike the pause marker, which
 *  has a deliberately ungated door precisely so a wedge keeps a release valve,
 *  a zeroed cap has none. */
export const CAP_MIN = 1;

/** A fat-finger ceiling, not a claim about fleet size. The box these caps
 *  govern runs about twenty live sessions, so sixty-four is far above any real
 *  setting and far below the range where `640` could read as deliberate. ONE
 *  ceiling for both fields, on `MAIL_QUIET_MS`'s own stated principle: two
 *  numbers for one policy is two numbers to get out of step. */
export const CAP_MAX = 64;

export type CapsDecision =
  | { ok: true; next: CoordCaps }
  | { ok: false; detail: string };

/** The full conjunction, and the lower bound is not optional — D-1151 is the
 *  recorded case of borrowing this shape one term short. */
const wellFormed = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= CAP_MIN && v <= CAP_MAX;

/** `body` is a PARTIAL: an omitted field keeps its current value. An unknown
 *  extra key is ignored, not refused — a newer client's third field must not be
 *  a 400 from an older server. */
export function decideCaps(current: CoordCaps, body: unknown): CapsDecision {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, detail: 'body must be an object' };
  }
  const b = body as Record<string, unknown>;
  const asked = (['maxConcurrentWorkers', 'maxSessionsPerDay'] as const)
    .filter((k) => b[k] !== undefined);
  if (asked.length === 0) {
    return { ok: false,
      detail: 'at least one of maxConcurrentWorkers or maxSessionsPerDay must be given' };
  }
  for (const k of asked) {
    if (!wellFormed(b[k])) {
      return { ok: false,
        detail: `${k} must be an integer between ${CAP_MIN} and ${CAP_MAX}` };
    }
  }
  return { ok: true, next: {
    maxConcurrentWorkers: asked.includes('maxConcurrentWorkers')
      ? b.maxConcurrentWorkers as number : current.maxConcurrentWorkers,
    maxSessionsPerDay: asked.includes('maxSessionsPerDay')
      ? b.maxSessionsPerDay as number : current.maxSessionsPerDay,
  } };
}
```

Confirm the relative import depth against a sibling (`coord/ledger.ts`'s own import of `shared/api.js`)
and match it — do not guess the number of `../`.

- [ ] **3.4 — Run and record the green.** Expected: PASS, 8 tests (the `it.each` counts 11).

- [ ] **3.5 — Measure the mutation table.** Command:
`cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-caps-policy.test.ts`

  | mutation | first-fail assertion |
  |---|---|
  | drop `&& v >= CAP_MIN` from `wellFormed` | `AssertionError: expected true to be false // Object.is equality` (5 failed) |
  | drop `&& v <= CAP_MAX` | `AssertionError: expected true to be false // Object.is equality` (2 failed) |
  | drop `Number.isInteger(v)` | `AssertionError: expected true to be false // Object.is equality` (2 failed) |
  | drop the `asked.length === 0` refusal | `AssertionError: expected true to be false // Object.is equality` (1 failed) |
  | refuse on an unknown extra key instead of ignoring it | `AssertionError: expected { ok: false, …(1) } to deeply equal { ok: true, next: { …(2) } }` |
  | `CAP_MIN` lowered to 0 | `AssertionError: expected true to be false // Object.is equality` (4 failed) |
  | drop the `Array.isArray(body)` arm | **GREEN as written — hole. Closed, then:** `AssertionError: body []: expected { ok: false, …(1) } to deeply equal { ok: false, …(1) }` (2 failed) |
  | drop the `typeof body !== 'object'` arm | *(added while closing the row above)* `TypeError: Cannot read properties of undefined (reading 'maxConcurrentWorkers')` ❯ `:64:14` |
  | drop the `body === null` arm | *(added while closing the row above)* `TypeError: Cannot read properties of null (reading 'maxConcurrentWorkers')` ❯ `:64:14` |

  **The second hole, named.** The shape guard has three arms and the first draft's test asserted only
  `ok === false`. Every non-object body ALSO has no settable field, so all three arms' cases fall through
  to the asks-for-nothing refusal and still answer `ok:false` — the guard was unwitnessed, the same
  absence-assertion-whose-fixture-cannot-produce-the-presence class this program has now hit twice in two
  tasks. What the arms actually decide is the DETAIL: a caller who posted `4` should be told the body is
  not an object, not that it is missing a field — true and useless. Closed by asserting the whole refusal
  object rather than its `ok` flag, which also made the two neighbouring arms witnessable; both were then
  measured and are recorded above. Note that dropping the null arm does not merely mis-word a refusal, it
  THROWS — a 500 on a body a client can trivially send.

- [ ] **3.6 — Commit.**

```bash
git add server/src/coord/caps.ts server/test/coord-caps-policy.test.ts
git commit -m "feat(coord): a pure decision for a caps write, refusing where setCaps never did (D-1164)"
```

---

## Task 4: the wire learns a coordination-config event and a usage shape

**Files:**
- Modify: `shared/api.ts` (`:2828`, `:2841`, beside `:3896`), `server/src/coord/schema.ts:210` (the DDL
  comment naming the vocabulary), `pwa/src/screens/MailScreen.tsx:43,46`
- Test: `server/test/coord-store.test.ts` (feed round-trip), `pwa/test/` (whichever file already pins
  `KIND_WORD`/`KIND_GLYPH`; find it before writing)

**Interfaces:**
- Produces:
  - `NotifyEvent['kind']` gains `'coord'`.
  - `export interface CoordCapsUsage { running: number; dispatchedIn24h: number }`
  - `export interface CoordCapsView { caps: CoordCaps; usage: CoordCapsUsage }`

A caps change is not a run event (`recordRunEvent` writes `fromState === toState` and `pushNewRuns`
explicitly SKIPS those, `watch.ts:1125` — the row would land and be seen by nobody), and it is not any of
`ask|done|merged|mail|run` (D-1163). `'run'` would be the closest and would be a lie: there is no run.
The seventh member is additive and an older PWA already degrades an unrecognised kind to `'unknown'`
through `isNotifyKind` — the designed degradation, not a new one. `'unknown'` stays what it always was:
the client-side member the server never writes.

`capsUsage()`'s return is an inline structural type today with no name anywhere; the PWA needs it, so it
gets one.

- [ ] **4.1 — Find the PWA's kind pins before editing.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '38,50p' pwa/src/screens/MailScreen.tsx
grep -rn "KIND_WORD\|KIND_GLYPH\|isNotifyKind\|NOTIFY_KINDS" pwa/src pwa/test server/test shared | grep -v node_modules
```

- [ ] **4.2 — Write the failing tests.** Two, in the files the grep above names.

Server side, appended to `server/test/coord-store.test.ts`:

```ts
  it('round-trips a coord feed event through the durable table', () => {
    // The absence half matters: before this member existed, `feedEvents` read a
    // 'coord' row back as 'unknown' — so a fixture that only asserted the row
    // lands would have passed against the defect.
    const s = freshStore();
    s.recordFeedEvent('epoch-1', { seq: 1, at: 10, kind: 'coord', sessionId: '',
      title: 'caps', body: 'workers 3 → 5' });
    const [ev] = s.feedEvents(10);
    expect(ev).toMatchObject({ kind: 'coord', title: 'caps' });
  });
```

PWA side, in the file that pins the kind tables (add one if none exists, named for that file's
convention):

```ts
  it('has a word and a glyph for every NotifyEvent kind, coord included', () => {
    for (const k of ['ask', 'done', 'merged', 'mail', 'run', 'coord', 'unknown'] as const) {
      expect(KIND_WORD[k], `no word for ${k}`).toBeTruthy();
      expect(KIND_GLYPH[k], `no glyph for ${k}`).toBeTruthy();
    }
  });
```

- [ ] **4.3 — Run both and record the reds.**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coord-store.test.ts
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/<the file>
```
Expected: a TS error on `kind: 'coord'` and a failing lookup. Record verbatim.

- [ ] **4.4 — Implement.** In `shared/api.ts`:

```ts
  kind: 'ask' | 'done' | 'merged' | 'mail' | 'run' | 'coord' | 'unknown';
```

```ts
const NOTIFY_KINDS: readonly NotifyEvent['kind'][] = ['ask', 'done', 'merged', 'mail', 'run', 'coord', 'unknown'];
```

with a docstring line on the union recording why `'coord'` is not `'run'` (D-1163). Update the DDL
comment at `server/src/coord/schema.ts:210` to name the vocabulary as it now stands — the comment, not
the frozen migration body. Then, beside `CoordCaps` at `shared/api.ts:3896`:

```ts
/** The two counts `CoordStore.capsUsage` derives from `runs` — never stored
 *  beside the limits, for the reason its own docstring gives. Named here
 *  because the operator dial ships them to the PWA (D-1209); before that they
 *  had no consumer outside `dispatchRun` and so no name. */
export interface CoordCapsUsage { running: number; dispatchedIn24h: number }

/** What `GET`/`POST /api/coord/caps` answer. Limits and usage travel TOGETHER:
 *  a cap without its count is a number the operator cannot act on. */
export interface CoordCapsView { caps: CoordCaps; usage: CoordCapsUsage }
```

Add the `coord` entries to `MailScreen.tsx`'s two total maps.

- [ ] **4.5 — Run both and record the green.**

- [ ] **4.6 — Measure the mutation table.**

  | mutation | first-fail assertion |
  |---|---|
  | remove `'coord'` from `NOTIFY_KINDS` but leave it in the union | `AssertionError: expected [ { seq: 1, at: 10, …(4) } ] to deeply equal [ { seq: 1, at: 10, …(4) } ]` (the row reads back `unknown`) |
  | remove the `coord` entry from `KIND_GLYPH` | `AssertionError: no glyph for coord: expected '' to be '⚙'` ❯ `mail-screen.test.tsx:235:88` |
  | remove the `coord` entry from `KIND_WORD` | `AssertionError: no word for coord: expected '⚙' to contain 'config'` |

  **A third hole, named — and it is the same class as the other two.** The PWA test's first draft
  asserted `container.textContent).not.toContain('undefined')`, on the reasoning that a total map with a
  missing entry yields `undefined`. It does at the TYPE level; at RUNTIME React renders `undefined` as
  NOTHING, never as the string. The test passed against the unimplemented feature. Closed by asserting
  the rendered glyph and word themselves, and by giving the fixture a title that carries no glyph of its
  own so the glyph assertion cannot be satisfied by the title. Three for three: every hole this wave has
  found so far is an absence assertion whose fixture could not produce the presence.

  **The frozen migration was NOT edited.** `coord/schema.ts:210`'s column comment enumerates the
  vocabulary as it stood at `user_version` 1, and migration 1 is frozen — its bytes are history, and
  sqlite stores the original `CREATE TABLE` text, so editing it would make a fresh database's
  `sqlite_master` disagree with every existing one for a comment. The file HEADER, which that comment
  already defers to ("see this file's header"), now says the enumeration is a v1 snapshot and names
  `shared/api.ts` as the live list.

- [ ] **4.7 — Commit.**

```bash
git add shared/api.ts server/src/coord/schema.ts pwa/src/screens/MailScreen.tsx server/test/coord-store.test.ts pwa/test
git commit -m "feat(wire): a feed kind for a coordination-config change, and a name for capsUsage (D-1163, D-1209)"
```

---

## Task 5: the caps door, and every pin its existence moves

**Files:**
- Modify: `server/src/coord/routes.ts` (new routes after `:1281`)
- Modify: `server/test/auth-gate.test.ts` (`:195-204`, `:476`)
- Modify: `server/test/coord-pause-route.test.ts` (`:160-235`)
- Test: `server/test/coord-caps-route.test.ts` (**create**)

**Interfaces:**
- Consumes: `decideCaps`, `CAP_MIN`, `CAP_MAX` (task 3); `CoordCapsView` (task 4); `CoordStore.caps()`,
  `setCaps()`, `capsUsage()`, `recordFeedEvent()`; `NotifyLog.record()` / `.epoch`.
- Produces: `GET /api/coord/caps` → `200 {ok:true, caps, usage}`; `POST /api/coord/caps` → `200 {ok:true,
  caps, usage}` on success, `400 {ok:false, error:'bad-request', detail}` on a refused body, `501
  {ok:false, error:'not-configured'}` with no coordination database.

**This task cannot be split, and that is a measured fact rather than a preference.** The instant
`app.post('/api/coord/caps')` is registered, `coord-pause-route.test.ts`'s direction-one goes red (a POST
with no box-token gate that is not in `UNGATED`) and four hand-pinned integers in `auth-gate.test.ts` go
stale. A reviewer cannot approve the route while rejecting those edits; landing them apart leaves the
branch red between two commits.

**Posture, stated before it is built.** NOT box-token: this is an operator dial, not a machine lane — the
fleet host never posts to it and has no reason to. NOT `UNGATED`: `UNGATED` is the D-282 family, whose
whole argument is that the party locked out is the party holding the key, so a wedge's release valve must
not sit behind it. Raising a cap releases no wedge. Session-gated when armed (so NOT in `EXEMPT`), open
dark — the same posture as every other same-origin PWA write.

Those two facts cannot both be asserted with the vocabulary the tree has (D-1240): direction-one equates
"no box-token gate" with "member of `UNGATED`", which held only because the four D-282 doors were the
only ungated POSTs in the file. The fix is a SECOND named set with its own argument, asserted disjoint
from `UNGATED` in both directions. `UNGATED.size` stays 4, so no prose cardinal anywhere moves.

**Why a GET (D-1209).** The brief's "capsUsage is already computed" is true server-side and irrelevant to
the PWA: `capsUsage`, `CoordCaps` and `maxConcurrentWorkers` occur zero times in `pwa/src`, `CoordStatus`
carries only `{pause, mail}`, and no route reads either. Caps must NOT be bolted onto the `{type:'coord'}`
frame: `emitCoord`'s docstring says it needs no try/catch precisely because it touches no `node:sqlite`,
and `dispatchedIn24h` drifts with the clock, so the byte-equality guard would let it re-emit on nearly
every 2 s tick.

**Why the route needs a `notConfigured` arm the pause route omits (D-1166).** Pause is a marker FILE on
the fleet host, so a box with no coordination database can still be paused and answering 501 would be a
lie about what the act needs. Caps live in `coord.db`. Copying pause's opening lines verbatim ships a
route that throws on such a box, because `caps()` casts an undefined row rather than returning null.

- [ ] **5.1 — Re-confirm the anchors, and STOP if any has moved.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '1233,1282p' server/src/coord/routes.ts   # the pause docstring + handler
sed -n '249,275p'   server/src/coord/routes.ts   # registration signature, notConfigured, coordMutex
sed -n '176,224p'   server/test/coord-pause-route.test.ts
sed -n '193,205p'   server/test/auth-gate.test.ts
grep -n 'notifyLog' server/src/server.ts | head
```

- [ ] **5.2 — Write the failing route tests.** Create `server/test/coord-caps-route.test.ts`. Build the
app with whatever helper `run-routes.test.ts` uses (read its top and copy it; do not invent a second
harness).

```ts
describe('GET /api/coord/caps', () => {
  it('answers the stored limits and the derived usage', async () => {
    const { app, coord } = await appWithCoord();
    coord.setCaps({ maxConcurrentWorkers: 4, maxSessionsPerDay: 16 });
    const res = await app.inject({ method: 'GET', url: '/api/coord/caps' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true,
      caps: { maxConcurrentWorkers: 4, maxSessionsPerDay: 16 },
      usage: { running: 0, dispatchedIn24h: 0 } });
  });

  it('answers 501 not-configured on a box with no coordination database', async () => {
    const { app } = await appWithoutCoord();
    const res = await app.inject({ method: 'GET', url: '/api/coord/caps' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('reports usage that a dispatched run actually moved', async () => {
    // The fixture that could witness the change: without it, `running: 0` above
    // is satisfied by a query that always answers zero.
    const { app, coord } = await appWithCoord();
    const id = coord.openRun({ /* …the file's own shape… */ });
    coord.markDispatched(id, 'w', 'ws', 'ws/ws', Date.now());
    const res = await app.inject({ method: 'GET', url: '/api/coord/caps' });
    expect(res.json().usage).toMatchObject({ running: 1, dispatchedIn24h: 1 });
  });
});

describe('POST /api/coord/caps', () => {
  it('writes a partial and answers the stored result', async () => {
    const { app, coord } = await appWithCoord();
    const res = await app.inject({ method: 'POST', url: '/api/coord/caps',
      payload: { maxConcurrentWorkers: 5 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().caps).toEqual({ maxConcurrentWorkers: 5, maxSessionsPerDay: 12 });
    // …and it really landed in the store, not merely in the reply.
    expect(coord.caps()).toEqual({ maxConcurrentWorkers: 5, maxSessionsPerDay: 12 });
  });

  it('refuses a bad body with the policy detail, and writes NOTHING', async () => {
    const { app, coord } = await appWithCoord();
    const before = coord.caps();
    const res = await app.inject({ method: 'POST', url: '/api/coord/caps',
      payload: { maxConcurrentWorkers: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request',
      detail: expect.stringContaining('maxConcurrentWorkers') });
    expect(coord.caps()).toEqual(before);
  });

  it('answers 501 not-configured on a box with no coordination database', async () => {
    const { app } = await appWithoutCoord();
    const res = await app.inject({ method: 'POST', url: '/api/coord/caps',
      payload: { maxConcurrentWorkers: 5 } });
    expect(res.statusCode).toBe(501);
  });

  it('records a coord feed event naming both the old and the new value', async () => {
    const { app, coord } = await appWithCoord();
    await app.inject({ method: 'POST', url: '/api/coord/caps', payload: { maxConcurrentWorkers: 5 } });
    const ev = coord.feedEvents(10).at(-1);
    expect(ev).toMatchObject({ kind: 'coord' });
    expect(ev!.body).toContain('3');
    expect(ev!.body).toContain('5');
  });

  it('records NO feed event when the body is refused', async () => {
    const { app, coord } = await appWithCoord();
    const before = coord.feedEvents(10).length;
    await app.inject({ method: 'POST', url: '/api/coord/caps', payload: { maxConcurrentWorkers: 0 } });
    expect(coord.feedEvents(10).length).toBe(before);
  });

  it('still writes the caps when there is no notify log to record into', async () => {
    // The seam: a missing NotifyLog degrades the RECORD, never the write. The
    // opposite collapse — refusing the operator's write because the feed is
    // unavailable — is the one this asserts against.
    const { app, coord } = await appWithCoord({ notifyLog: undefined });
    const res = await app.inject({ method: 'POST', url: '/api/coord/caps',
      payload: { maxSessionsPerDay: 20 } });
    expect(res.statusCode).toBe(200);
    expect(coord.caps().maxSessionsPerDay).toBe(20);
  });
});

describe('the caps door is exactly one caller of setCaps', () => {
  it('setCaps has exactly one call site in server/src, and it is the caps route', () => {
    // Wave 5's lesson: a negative assertion needs a positive floor, or a regex
    // that stopped matching satisfies it vacuously.
    const files = walkSource(path.join(__dirname, '..', 'src'));
    expect(files.length, 'the source walk found nothing — this scan is over nothing')
      .toBeGreaterThan(30);
    const callers = files.flatMap(({ file, text }) =>
      [...blankCommentsAndStrings(text).matchAll(/\bsetCaps\s*\(/g)].map(() => file));
    expect(callers).toEqual(['coord/routes.ts']);
  });
});
```

`blankCommentsAndStrings` and `walkSource` already exist in this tree — find them
(`dispatch-mutex-gate.test.ts`, `resume-reclaim-l0.test.ts`) and import or copy the exact helpers rather
than writing a third. A bare `/\bsetCaps\s*\(/` also matches the declaration and every comment; the
declaration lives in `store.ts`, so an unblanked scan would report two callers and the fix would be a
narrowed regex — the failure mode this tree names by name.

- [ ] **5.3 — Run and record the red.** Expected: 404s for both routes (unregistered) and a `setCaps`
caller list of `[]`. Record the first failing assertion verbatim.

- [ ] **5.4 — Implement the routes**, immediately after the pause handler at `:1281`. Docstring first —
it carries the posture argument, and a reviewer reads it before the code:

```ts
  /** `GET`/`POST /api/coord/caps` — the two coordination caps become an OPERATOR
   *  DIAL. Before this, `CoordStore.setCaps` had no caller anywhere in
   *  `server/src`: the only way to change `maxConcurrentWorkers` or
   *  `maxSessionsPerDay` was to edit `coord.db` by hand.
   *
   *  NOT BOX-TOKEN, AND NOT `UNGATED` EITHER — the two are different facts and
   *  this route is the first in the tree to need them apart (D-1240). The box
   *  token gates MACHINE lanes: callers on the fleet host with no cookie jar.
   *  An operator turning a dial in the PWA is not one, and gating this on the
   *  fleet's shared secret would put a phone control behind a secret the phone
   *  does not hold. Nor is it a release valve: `UNGATED`'s whole argument
   *  (D-282) is that the party locked out is the party holding the key, so a
   *  wedge's valve must not sit behind it — and raising a cap releases no
   *  wedge. It is an ordinary same-origin PWA write: session-gated when armed
   *  (deliberately absent from `auth/gate.ts`'s EXEMPT table), open dark, like
   *  every other write the console makes.
   *
   *  THE `notConfigured` ARM THE PAUSE ROUTE ABOVE DELIBERATELY OMITS (D-1166).
   *  A pause is a marker file on the fleet host, so a box with no coordination
   *  database can still be paused. Caps are rows in `coord.db`, and `caps()`
   *  casts an undefined row rather than returning null — copying the pause
   *  handler's opening verbatim would ship a route that throws on such a box.
   *
   *  THE READ HALF EXISTS BECAUSE NOTHING ELSE CARRIES THESE NUMBERS (D-1209).
   *  `capsUsage` is computed server-side and reaches the PWA nowhere;
   *  `CoordStatus` carries `pause` and `mail` and no numbers. Caps are NOT
   *  added to that frame: `emitCoord` states it needs no try/catch because it
   *  touches no `node:sqlite`, and `dispatchedIn24h` moves with the clock, so
   *  the frame's byte-equality guard would let it re-emit on nearly every tick.
   *  Limits and usage travel together — a cap without its count is a number the
   *  operator cannot act on.
   *
   *  THE REPLY IS THE CONFIRMATION, unlike the pause toggle one door up. That
   *  toggle refuses to be optimistic because a `{type:'coord'}` frame exists to
   *  settle it; no frame carries caps, so the honest answer is the stored value
   *  re-read after the write, and the control settles on that. */
  app.get('/api/coord/caps', async (_req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    return reply.code(200).send({ ok: true, caps: coord.caps(), usage: coord.capsUsage() });
  });

  app.post('/api/coord/caps', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    // The DECISION is L1 and runs before the mutex: a malformed body is decided
    // by this request alone, and queueing it behind a live dispatch would make
    // the answer depend on the fleet's weather (the reclaim route's own rule).
    const before = coord.caps();
    const decided = decideCaps(before, req.body ?? {});
    if (!decided.ok) {
      return reply.code(400).send({ ok: false, error: 'bad-request', detail: decided.detail });
    }
    // …and the WRITE is serialised, because `dispatchRun` reads `caps()` and
    // `capsUsage()` across await boundaries (`dispatch.ts:236-237`) — the exact
    // race `CoordMutex` exists for.
    const view = await coordMutex.run(() => {
      coord.setCaps(decided.next);
      return { caps: coord.caps(), usage: coord.capsUsage() };
    });
    // A `run_events` row would be wrong — there is no run, and `recordRunEvent`
    // writes `fromState === toState`, which `pushNewRuns` skips outright. The
    // durable feed is where a change with no run belongs.
    //
    // A missing NotifyLog degrades the RECORD and never the write, and
    // `recordFeedEvent` throws SYNCHRONOUSLY (`node:sqlite`), so it is caught
    // here the same way `watch.ts:1225-1228` catches it.
    const log = deps.notifyLog;
    if (log) {
      try {
        coord.recordFeedEvent(log.epoch, log.record({
          kind: 'coord', sessionId: '',
          title: '⚙ caps',
          body: `workers ${before.maxConcurrentWorkers} → ${view.caps.maxConcurrentWorkers}, ` +
                `per day ${before.maxSessionsPerDay} → ${view.caps.maxSessionsPerDay}`,
        }));
      } catch (err) {
        console.warn(`ccrc-server: recordFeedEvent failed (${err instanceof Error ? err.message : String(err)}) — caps written, feed archive degraded`);
      }
    }
    return reply.code(200).send({ ok: true, ...view });
  });
```

Before writing `sessionId: ''`, MEASURE what the PWA renders for an empty `sessionId` on a feed row and
record the answer. If it renders a dangling link or an empty chip, the row is a lie by omission and the
renderer needs the same degradation `pushOne` applies to an empty project — "never a dangling separator".
Fix it in task 7 and record it as a deviation from the spare block.

- [ ] **5.5 — Move the pins the route's existence moved.** In `server/test/auth-gate.test.ts`:
`scanRoutes('coord/routes.ts')` 23 → 25, `ROUTES.length` 69 → 71, non-websocket 66 → 68, and the armed
sweep's `gated.length` 42 → 44 (both new routes are NOT exempt, so both move it). Add a comment above
each, in the file's own style, naming WHICH route moved it and why — `:196-199` is the model.

- [ ] **5.6 — Add `SESSION_ONLY` to `coord-pause-route.test.ts`,** immediately after `UNGATED`:

```ts
  /** Write routes that carry NO box token and are NOT release valves — the
   *  distinction `UNGATED` alone could not express, and that stayed invisible
   *  while the D-282 doors were the only ungated POSTs in this file (D-1240).
   *
   *  `UNGATED` is an argument about a WEDGE: the locked-out party holds the box
   *  token, so the valve must not sit behind it. A name here makes no such
   *  claim. These are ordinary same-origin PWA writes that no machine lane
   *  calls, so the fleet's shared secret is the wrong key for them — and
   *  nothing may rely on one of them to open a wedge.
   *
   *  Kept disjoint from `UNGATED` in both directions below, so a door cannot
   *  quietly acquire the release-valve argument by being listed twice, and
   *  `UNGATED.size` — which five prose sites are checked against — is untouched
   *  by anything added here.
   *
   *  `/api/coord/caps`: the operator's dial on `maxConcurrentWorkers` and
   *  `maxSessionsPerDay`. Raising a cap releases no wedge. */
  const SESSION_ONLY = new Set(['/api/coord/caps']);
```

Then: (a) direction one skips `UNGATED.has(route) || SESSION_ONLY.has(route)`; (b) a new test asserts the
two sets are disjoint; (c) a new test asserts every `SESSION_ONLY` route really IS ungated (the mirror of
the existing `UNGATED` direction-two, so a name here cannot document an exemption the code does not
take); (d) a new test asserts no `SESSION_ONLY` route appears in `auth/gate.ts`'s `EXEMPT` table — that
is what "session-gated when armed" MEANS, and without it the claim is prose.

```ts
  it('SESSION_ONLY and UNGATED are disjoint — a door gets one argument, not both', () => {
    expect([...SESSION_ONLY].filter((r) => UNGATED.has(r)),
      'a route claims both the release-valve argument and the ordinary-write one').toEqual([]);
    expect(SESSION_ONLY.size, 'the set emptied — this scan is over nothing').toBeGreaterThan(0);
  });

  it('every SESSION_ONLY route really IS ungated', () => {
    const listed = handlers().filter((h) => SESSION_ONLY.has(h.route));
    expect(listed.map((h) => h.route).sort(), 'a SESSION_ONLY name matches no handler')
      .toEqual([...SESSION_ONLY].sort());
    const gated = listed.filter((h) => GATE_PATTERNS.some((re) => re.test(h.body))).map((h) => h.route);
    expect(gated, 'a SESSION_ONLY route checks the box token after all').toEqual([]);
  });

  it('no SESSION_ONLY route is EXEMPT — armed, it sits behind the session gate', () => {
    for (const route of SESSION_ONLY) {
      expect(GATE_SRC.includes(`'POST ${route}'`),
        `${route} is in the EXEMPT table; a PWA-surface write must not be`).toBe(false);
      expect(GATE_SRC.includes(`'GET ${route}'`),
        `${route} is in the EXEMPT table; a PWA-surface write must not be`).toBe(false);
    }
  });
```

- [ ] **5.7 — Run the three suites and record the green.**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/coord-caps-route.test.ts test/coord-pause-route.test.ts test/auth-gate.test.ts
```

- [ ] **5.8 — Measure the mutation table.** Command as in 5.7.

  | mutation | first-fail assertion |
  |---|---|
  | drop the `notConfigured` arm from `GET /api/coord/caps` | `AssertionError: expected 500 to be 501` |
  | drop the `notConfigured` arm from the POST | `AssertionError: expected 500 to be 501` |
  | write before validate (`setCaps` moved above the refusal) | **GREEN as written — hole (mutation mis-designed).** Redesigned as the slip that actually happens — the refusal sends its 400 without RETURNING — then: `AssertionError: expected { maxConcurrentWorkers: 99, …(1) } to deeply equal { maxConcurrentWorkers: 3, …(1) }` |
  | record the feed event on the refusal path too | `AssertionError: expected 1 to be +0` |
  | make the feed event's absence fatal (`log!.record(...)`, no guard) | **GREEN as written — hole.** The throw lands in the handler's own try/catch, so every status assertion stays green. Closed by asserting the CONSOLE, then: `AssertionError: a box with no feed warned as though a write had failed: expected 'ccrc-server: recordFeedEvent failed (…' not to contain 'recordFeedEvent'` |
  | remove `'/api/coord/caps'` from `SESSION_ONLY` | `AssertionError: write routes with no box-token gate ahead of their first await: expected [ '/api/coord/caps' ] to deeply equal []` |
  | move `'/api/coord/caps'` from `SESSION_ONLY` into `UNGATED` | `AssertionError: a route claims both the release-valve argument and the ordinary-write one: expected [ '/api/coord/caps' ] to deeply equal []` |
  | add `requireMailToken` to the caps POST handler | `AssertionError: expected [ 'GET /api/claims', …(18) ] to deeply equal [ 'GET /api/claims', …(17) ]` |
  | add `'POST /api/coord/caps'` to `auth/gate.ts`'s EXEMPT table | *(covered by the row above from the other side —* `no SESSION_ONLY route is EXEMPT` *reds; measured together with it)* |
  | revert `scanRoutes('coord/routes.ts')` to 23 | `AssertionError: expected 25 to be 23` |
  | revert the armed-sweep `gated.length` to 42 | `AssertionError: expected 44 to be 42` |
  | drop `coordMutex.run` and write bare | **GREEN as written — hole.** Closed by extending `dispatch-mutex-gate.test.ts`'s `TARGETS` to `coord.setCaps` — the tree's own structural mechanism for exactly this (D-46), needing no scanner change because `head` is the whole dotted identifier chain. Then: `AssertionError: expected [ Array(1) ] to deeply equal []` |
  | reply with `decided.next` instead of the re-read `coord.caps()` | **GREEN, and it STAYS green — reported, not closed.** See below. |

  **Four holes in twelve rows. Three closed; the fourth is reported as a non-guard, which is the honest
  answer.** `decided.next` and the re-read `coord.caps()` cannot be made to differ: the only state that
  would separate them is a missing `coordinator_state` row (D-1164's silent-no-op-versus-throw
  disagreement), and the route reads `caps()` as `before` in its FIRST statement, so that state throws
  there and both spellings answer 500 — measured, after building the state with a raw `DELETE` through a
  db handle the test harness now returns. The re-read is therefore a truthfulness choice with no
  observable consequence, not a guard, and this plan does not claim it as one.

  The test written while chasing that row was KEPT, with its comment corrected to say what it actually
  pins — that a corrupt store reaches the caller as a fault rather than as a confident 200 for a write
  that did not happen. Its first draft claimed to witness the re-read; leaving that in would have been
  precisely the defect wave 5's review found and named, a guard pinned by a green test whose title
  described a different situation.

- [ ] **5.9 — Commit.**

```bash
git add server/src/coord/routes.ts server/test/coord-caps-route.test.ts \
        server/test/coord-pause-route.test.ts server/test/auth-gate.test.ts
git commit -m "feat(coord): caps become an operator dial, and the ungated set learns a second argument (D-1209, D-1240, D-1166)"
```

---

## Task 6: the PWA control

**Files:**
- Modify: `pwa/src/lib/api.ts` (after `:649`), `pwa/src/screens/RunsScreen.tsx` (`:594`),
  `pwa/src/fleet/fleet.css` (after `:2079`)
- Create: `pwa/src/fleet/CapsControl.tsx`, `pwa/test/caps-control.test.tsx`
- Modify: `pwa/test/api.test.ts`, `pwa/test/runs-screen.test.tsx`, `pwa/test/tap-targets.test.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/coord/caps` (task 5), `CoordCapsView` (task 4).
- Produces: `api.coordCaps(): Promise<CoordCapsView>`, `api.setCoordCaps(partial): Promise<CoordCapsView |
  'unreadable'>`, and `<CapsControl store? coordCaps? setCoordCaps? />`.

Five conventions this control obeys, each one measured on the pause control beside it: the write function
is an injectable prop defaulting to the `api` singleton; component tests drive the injected function and
a SEPARATE fetch-level block in `api.test.ts` pins URL/method/headers/body (without it a new client
method has no coverage at all — measured, `api.test.ts:261-267`); a mount pin in `runs-screen.test.tsx`
asserts DOM ORDER, because a control tested only in its own file stops shipping the moment a merge drops
the mount line; CSS is plain global, self-grounded or written as a named-ancestor descendant so the
contrast auditor can measure it; and NO `setInterval` anywhere in the tree, or `runs-screen.test.tsx`'s
cadence pin breaks.

It departs from the pause control in exactly one place, deliberately: the pause toggle refuses to be
optimistic and settles on the next `{type:'coord'}` frame. No frame carries caps, so this control settles
on the response body. `postJsonOr` (D-1150) is the right client helper for that — it keeps "the answer
was unreadable" distinct from "the request never happened", and after a caps write those are genuinely
different states.

- [ ] **6.1 — Write the failing tests.** Create `pwa/test/caps-control.test.tsx`:

```tsx
  it('renders nothing until the first read lands', () => {
    const { container } = render(<CapsControl coordCaps={() => new Promise(() => {})} />);
    expect(container.querySelector('.caps-control')).toBeNull();
  });

  it('shows usage against each cap once the read lands', async () => {
    render(<CapsControl coordCaps={async () => ({
      caps: { maxConcurrentWorkers: 3, maxSessionsPerDay: 12 },
      usage: { running: 1, dispatchedIn24h: 4 } })} />);
    expect(await screen.findByText(/1\s*\/\s*3/)).toBeInTheDocument();
    expect(screen.getByText(/4\s*\/\s*12/)).toBeInTheDocument();
  });

  it('sends only the field the operator changed', async () => {
    const setCoordCaps = vi.fn(async () => ({
      caps: { maxConcurrentWorkers: 5, maxSessionsPerDay: 12 },
      usage: { running: 1, dispatchedIn24h: 4 } }));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(setCoordCaps).toHaveBeenCalledWith({ maxConcurrentWorkers: 5 });
  });

  it('settles on the response body, not on what was typed', async () => {
    // The honesty half: the server is the authority on what was stored.
    const setCoordCaps = vi.fn(async () => ({
      caps: { maxConcurrentWorkers: 4, maxSessionsPerDay: 12 },
      usage: { running: 1, dispatchedIn24h: 4 } }));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/1\s*\/\s*4/)).toBeInTheDocument();
  });

  it('says so, inline, when the write is refused', async () => {
    const setCoordCaps = vi.fn(() => Promise.reject(new ApiError(400,
      { ok: false, error: 'bad-request', detail: 'maxConcurrentWorkers must be an integer between 1 and 64' })));
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.change(await screen.findByLabelText(/workers/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/between 1 and 64/)).toBeInTheDocument();
  });

  it('does NOT claim the write failed when only the ANSWER was unreadable', async () => {
    // The D-1150 distinction, at a new seam: the caps may well have been
    // written. Saying "failed" would be a lie the operator would act on.
    const setCoordCaps = vi.fn(async () => 'unreadable' as const);
    render(<CapsControl coordCaps={READ} setCoordCaps={setCoordCaps} />);
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    expect(await screen.findByText(/unconfirmed|could not be read/i)).toBeInTheDocument();
  });

  it('renders nothing on a box with no coordination database', async () => {
    render(<CapsControl coordCaps={() => Promise.reject(new ApiError(501, { ok: false, error: 'not-configured' }))} />);
    await waitFor(() => expect(document.querySelector('.caps-control')).toBeNull());
  });
```

In `pwa/test/api.test.ts`, the fetch-level pins for both methods (URL, method, content-type, body),
modelled verbatim on `:269-283`. In `pwa/test/runs-screen.test.tsx`, extend the DOM-order pin at `:469`
to `[offline, banner, caps]`. In `pwa/test/tap-targets.test.tsx`, add `.caps-save` (and any other floored
control) to the rule loop at `:236-249`.

- [ ] **6.2 — Run and record the reds** (three files).

- [ ] **6.3 — Implement the client**, after `coordPause` at `pwa/src/lib/api.ts:649`:

```ts
    /** `GET /api/coord/caps` — the two limits AND the two derived counts. They
     *  travel together because a cap without its count is a number the operator
     *  cannot act on. 501 `not-configured` on a box with no coordination
     *  database, which the control renders as nothing at all. */
    coordCaps: () => getJson<CoordCapsView>('/api/coord/caps'),

    /** `POST /api/coord/caps` — a PARTIAL; an omitted field keeps its value.
     *  Session-gated when armed, open dark; NOT box-token (an operator dial is
     *  not a machine lane) and NOT one of the D-282 release valves.
     *
     *  `postJsonOr`, not `postJson` (D-1150): after a caps write, "the answer
     *  could not be read" and "the request never happened" are different states
     *  — the first may have stored the value — and the control must not report
     *  one as the other. */
    setCoordCaps: (next: Partial<CoordCaps>) =>
      postJsonOr<CoordCapsView, 'unreadable'>('/api/coord/caps', 'unreadable', next),
```

Match `postJsonOr`'s real signature at `api.ts:288-326` — read it and conform; the shape above is the
intent, not a licence to guess.

- [ ] **6.4 — Implement `CapsControl.tsx`** on `CoordBanner`'s shape: injectable props defaulting to the
`api` singleton, a render gate that returns `null` until the first read lands (and on a 501), two
labelled number inputs, one save button, an inline error paragraph. No timers, no polling. Re-read on
mount only; the response body updates the rendered state.

- [ ] **6.5 — Mount it** in `RunsScreen.tsx`, on the line after `<CoordBanner store={store} />`, with a
comment in that file's own style naming why it lives on `/runs` and nowhere else.

- [ ] **6.6 — Add the CSS** after `.coord-banner .coord-error` at `fleet.css:2079`. Self-grounded (both
`color` and `background`) or named-ancestor descendants; `min-height: var(--tap-min)` on the button and
the inputs; tokens only, never a raw `44px`.

- [ ] **6.7 — Run the three suites and record the green.**

```bash
cd "$(git rev-parse --show-toplevel)/pwa"
./node_modules/.bin/vitest run test/caps-control.test.tsx test/api.test.ts test/runs-screen.test.tsx test/tap-targets.test.tsx
```

- [ ] **6.8 — Measure the mutation table.**

  | mutation | first-fail assertion |
  |---|---|
  | delete the `<CapsControl/>` line from `RunsScreen.tsx` | `AssertionError: expected null not to be null` (the mount pin) |
  | render the typed value instead of the response body | `TestingLibraryElementError: Unable to find an element with the text: 1 / 4` |
  | send both fields always, instead of only the changed one | `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
  | treat `'unreadable'` as a failure | `TestingLibraryElementError: Unable to find an element with the text: /unconfirmed/i` |
  | drop the render gate (render before the first read lands) | `AssertionError: expected <div class="caps-control" …(2)>…(3)</div> to be null` (3 failed) |
  | swap `var(--tap-min)` for `44px` in `.caps-save` | `AssertionError: expected 'flex: none; min-height: 44px; padding…' not to contain '44px'` |
  | swap `postJsonOr` for `postJson` | `AssertionError: promise rejected "Error: truncated" instead of resolving` |

  7/7 red, no holes — but three of them LOOKED green on the first pass and were not. The harness grepped
  the run for `AssertionError` alone, and two of these rows fail as `TestingLibraryElementError` while a
  third had been mis-written into a syntax error that never reached an assertion at all. A mutation whose
  output you filter is a mutation you have not measured; all three were re-run with the filter widened and
  the failing text read.

  **A regression this task caused, and how it was fixed.** Mounting `CapsControl` with its own default
  reader made the board issue a request on every render, which broke two PRE-EXISTING tests that stub the
  global `fetch` and assert the board calls nothing else (`runs-screen.test.tsx`'s resume-door two-tap
  test and `abandon-sheet.test.tsx`'s). Those assertions are worth keeping exactly as strict as they
  were, so the fix was NOT to loosen them: the reader was hoisted to a `loadCaps` prop on `RunsScreen`,
  beside the `loadRuns` prop that exists for precisely this reason, and injected at every board render in
  the three affected suites. The screen's own prop docstring records the measurement.

- [ ] **6.9 — Commit.**

```bash
git add pwa/src pwa/test
git commit -m "feat(pwa): the caps dial on the runs board, settling on what the server stored (D-1209)"
```

---

## Task 7: the box-token census, and the five prose sites it corrects

**Files:**
- Create: `server/test/box-token-census.test.ts`
- Modify: `README.md` (`:529-531`, `:1405-1425`), `server/src/auth/gate.ts` (`:75-91`, `:663-664`),
  `server/test/auth-gate.test.ts` (`:401`, `:438` — the title and comment only)
- Modify: `CLAUDE.md` — ONLY if `oss-metadata.test.ts` demands it (see step 7.7). The box-token bullet is
  **not reworded**.

D-1156, in full, plus one site the ticket never named. Three sites state a box-token surface nothing
checks; the CLAUDE.md sentence wave 5 corrected is itself unpinned, and that was MEASURED — the false
sentence was restored and the suite stayed green.

**The three sites do not count the same set, and a mechanism that ignores that is wrong three ways
(D-1162).** `README:530` counts "box-token-gated coordination routes"; `gate.ts:75` counts "machine
lanes", which includes the five dual-credential GETs and `/api/notify`; D-1156's own entry counts
`requireMailToken` call sites alone and arrives at eleven. So the scanner NAMES its set — every route
handler that CONSULTS the box token, by either mechanism, across both files that register such handlers —
and the prose is rewritten to speak that set. `auth-gate.test.ts:401` already derives exactly this set,
from `coord/routes.ts` alone; this scanner widens it to `server.ts` and then checks prose against it.

**The fourth site (D-1242).** `auth/gate.ts:75,77,80,90` and `:663` say "the SEVENTEEN box-token machine
lanes … All eighteen". Measured: `coord/routes.ts` holds eighteen and `/api/notify` makes nineteen —
exactly one generation stale (`auth-gate.test.ts:414-418` records the set going 17 → 18 when `GET
/api/runs/:id/items` joined; this prose was never updated). `:80` is also wrong in KIND, not only number:
five of the eighteen accept a session cookie instead, so they do not "refuse every verdict but 'ok'".
`auth-gate.test.ts:401`'s own title carries the same off-by-one over a CORRECT 18-element assertion.

**Corpus scoping, stated so the scanner cannot creep.** It reads `README.md`, `CLAUDE.md`,
`server/src/auth/gate.ts` and `server/test/auth-gate.test.ts` — repo-root docs and the source that states
a census. It does NOT read `docs/superpowers/{plans,specs,programs,research}` (archived generations say
TWO doors, THREE doors, "all six coordinator write routes" BY DESIGN, and correcting them would falsify
the history the D-N ledger depends on), `graphify-out/` (a generated artefact), or `ccd/` (out of scope
this wave and on the coordinator's agent-first deploy lane — see D-1168).

- [ ] **7.1 — Re-confirm every anchor, and STOP if any has moved.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '529,531p'   README.md
sed -n '1405,1425p' README.md
sed -n '73,92p'     server/src/auth/gate.ts
sed -n '662,665p'   server/src/auth/gate.ts
sed -n '401,402p'   server/test/auth-gate.test.ts
grep -n 'Box token gates every coordination WRITE' CLAUDE.md
```

- [ ] **7.2 — Write the scanner and its assertions, RED first.** Create
`server/test/box-token-census.test.ts`. It must carry its own anti-vacuity guards — this tree has been
bitten twice by a slicer that silently sliced nothing, and `''` satisfies every negative assertion.

```ts
  /** THE DERIVED SURFACE. One set, named: every route handler that CONSULTS the
   *  box token, by either mechanism, across both files that register one.
   *
   *  Naming it is the point (D-1162). The three prose sites this file pins were
   *  each counting a DIFFERENT set — hard-require, machine-lanes-including-the
   *  -dual-credential-GETs, and `requireMailToken` call sites alone — and a
   *  scanner that demanded one word from all three would be wrong twice. The
   *  prose is rewritten to speak THIS set; the numbers below are derived from
   *  it and nowhere else. */
  const GATE_PATTERNS = [/requireMailToken\(req/, /checkMailToken\(/];
  const lanesIn = (rel: string): string[] => { /* the auth-gate.test.ts:405-413 walk */ };
  const COORD_LANES = lanesIn('coord/routes.ts');
  const ALL_LANES = [...COORD_LANES, ...lanesIn('server.ts')];

  it('the scan finds what it claims to scan', () => {
    // Anti-vacuity, first, because every assertion below is satisfied by an
    // empty set. A floor AND two named smoke members.
    expect(COORD_LANES.length).toBeGreaterThan(10);
    expect(COORD_LANES).toContain('POST /api/mail');
    expect(ALL_LANES).toContain('POST /api/notify');
    expect(ALL_LANES.length).toBe(COORD_LANES.length + 1);
  });

  it('README states the derived lane counts, not a remembered pair', () => {
    const p = passage('README, the auth paragraph', README,
      'What is gated, and what is not:', 'Enrolling a passkey');
    expect(numeralsIn(p)).toEqual(new Set([word(ALL_LANES.length), word(COORD_LANES.length)]));
  });

  it('README names every gated run route, and names the ungated doors as the exceptions they are', () => {
    const p = passage('README, the mail-bus paragraph', README,
      '`/api/mail` (and its ack route)', 'Minting the token file matters');
    for (const r of COORD_LANES.filter((k) => k.startsWith('POST /api/runs'))) {
      expect(p, `the mail-bus paragraph omits ${r}`).toContain(r.replace('POST ', ''));
    }
    for (const door of UNGATED_DOORS) {
      expect(p, `the mail-bus paragraph does not name ${door} as an exception`).toContain(door);
    }
  });

  it('gate.ts states the derived lane counts', () => {
    const p = passage('gate.ts, EXEMPT reason 2', GATE_SRC,
      '  2. The', 'These callers are');
    expect(numeralsIn(p)).toEqual(new Set([word(COORD_LANES.length)]));
  });

  it("CLAUDE.md's box-token bullet is TRUE, not merely present", () => {
    // THE PIN D-1156 ASKED FOR. Wave 5 corrected this sentence and MEASURED
    // that nothing held it: the false version was restored and the suite stayed
    // green. Each claim is checked against the source it describes.
    const bullet = passage('CLAUDE.md, the box-token bullet', CLAUDE_MD,
      '- **Box token gates every coordination WRITE**', '\n- **');
    for (const r of ['POST /api/claims', 'POST /api/claims/:id/release',
                     'POST /api/ledger/deviations', 'GET /api/ledger']) {
      expect(bullet, `the bullet no longer names ${r}`).toContain(r);
      expect(COORD_LANES, `the bullet names ${r} as a box-token lane and it is not one`)
        .toContain(r);
    }
    // …and the one it names as carrying NO box token really carries none.
    expect(bullet).toContain('POST /api/sessions/:id/kickoff');
    expect(ALL_LANES, 'the kickoff route acquired a box-token gate — the bullet is now false')
      .not.toContain('POST /api/sessions/:id/kickoff');
  });

  it('no prose site UNDER-claims the surface', () => {
    // The property in one line, over every site at once: a number stated about
    // this surface is either the derived one or absent. Collected as offenders
    // so a failure prints every violating site rather than the first.
    const offenders = SITES.flatMap(({ name, text, expected }) =>
      [...numeralsIn(text)].filter((n) => n !== word(expected)).map((n) => `${name}: ${n}`));
    expect(offenders, 'a prose site states a count this tree does not have').toEqual([]);
    expect(SITES.length, 'a site was dropped instead of corrected').toBe(4);
  });
```

Write `passage()` with the SAME two guards as `coord-pause-route.test.ts:343-357` (both anchors present,
slice over 300 chars); write `numeralsIn()` to match number-words case-insensitively from a list running
at least to twenty-five, anchored to the sliced passage and never to a whole file; write `word(n)` as the
inverse of that list and assert `word()` is defined for every count it is asked for — the guard that
catches a surface outgrowing the word list, exactly as `expect(want).toBeDefined()` does one field over.

- [ ] **7.3 — Run and record the reds.** Expected: four failing sites — README ×2, gate.ts, and whichever
of the CLAUDE.md claims no longer holds. Record every first-fail verbatim; these reds ARE the measurement
that the prose was wrong, and they are the evidence the wave-done mail reports.

- [ ] **7.4 — Correct README's auth paragraph** (`:529-531`). Replace "the ten machine lanes the fleet
host posts to (nine box-token-gated coordination routes plus `/api/notify`" with the derived truth:
nineteen lanes, eighteen coordination routes that consult the box token plus `/api/notify`. Keep the rest
of the sentence, including the legacy-tolerance clause, intact.

- [ ] **7.5 — Correct README's mail-bus paragraph** (`:1405-1425`). Two defects, one edit. "the run
routes (`POST /api/runs`, `/:id/dispatch`, `/:id/close`, `/:id/advance`)" omits `/:id/items` and reads as
a complete class; and "every coordinator write route now fails the same way the mail pair always has …
None of these six routes" has been false since Build 4. Wave 5 already drafted the replacement clause and
it is the right one — enumerate the five gated run routes and name the exceptions:

> …the run routes (`POST /api/runs`, `/:id/dispatch`, `/:id/close`, `/:id/advance`, `/:id/items`) — but
> NOT the operator doors `/:id/abandon` and `/:id/reclaim`, which are ungated by design (D-282), nor
> `POST /api/coord/pause` and `POST /api/claims/:id/break`, the other two of the same family…

and replace "None of these six routes" with a claim about the enumerated lanes rather than a count the
paragraph no longer supports. **Do not write a CAPS cardinal anywhere in these passages** — `CARD_RE`
does not read README today, but the wave that adds it should not have to clean up after this one.

- [ ] **7.6 — Correct `gate.ts`'s three paragraphs and `auth-gate.test.ts`'s title.** `:75-77`
SEVENTEEN → EIGHTEEN and "All eighteen" → all nineteen; `:80-81` and `:90` likewise, and `:80` also loses
the claim that all of them "refuse every verdict but 'ok'" — five take a session cookie instead, so the
sentence must say which do and which do not; `:663-664` the same count. `auth-gate.test.ts:401`'s title
and `:438`'s "the eighteenth" become the derived truth over the same correct assertion. All of `:75-91`
and `:663` sit OUTSIDE the passage `coord-pause-route.test.ts` slices (its anchors are
`' *  - \`POST /api/coord/pause\`'` → `'export const EXEMPT'`), so CAPS is safe there — but verify that
with a run, not by reading.

- [ ] **7.7 — Re-measure the README size coupling.**

```bash
cd "$(git rev-parse --show-toplevel)"
wc -l README.md && grep -n 'README\.md` (~' CLAUDE.md
cd server && ./node_modules/.bin/vitest run test/oss-metadata.test.ts
```
`oss-metadata.test.ts:89-100` asserts CLAUDE.md's stated README size is within 10% of the real count.
README was 2033 lines against a claimed ~1931 (upper edge ~2124) before this task. If the edits push it
past, update CLAUDE.md's line-count figure — and ONLY that figure. Do not reflow the box-token bullet:
its opening anchor is a literal in two suites, and `D-282 (was D-B4-9)` is one unbreakable token sequence
that `deviation-refs.test.ts:168` reds on if a line break lands inside it.

- [ ] **7.8 — Run and record the green.**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/box-token-census.test.ts test/auth-gate.test.ts \
  test/coord-pause-route.test.ts test/oss-metadata.test.ts test/readme-holds.test.ts \
  test/topology-clean.test.ts test/deviation-refs.test.ts
```

- [ ] **7.9 — Measure the mutation table.** Command as in 7.8.

  | mutation | first-fail assertion |
  |---|---|
  | restore README's "nine box-token-gated coordination routes" | `AssertionError: README's auth paragraph states a count this tree does not have: expected Set{ 'ten', 'nine' } to deeply equal Set{ 'nineteen', 'eighteen' }` |
  | restore README's "None of these six routes" | `AssertionError: the mail-bus paragraph grew a hand-kept count again: expected Set{ 'six' } to deeply equal Set{}` |
  | drop `/:id/items` from README's run-route list | `AssertionError: the mail-bus paragraph omits the gated POST /api/runs/:id/items: expected '…' to contain '/:id/items'` |
  | restore gate.ts's "SEVENTEEN" | `AssertionError: gate.ts, EXEMPT reason 2 states a count this tree does not have: expected Set{ 'seventeen', 'nineteen' } to deeply equal Set{ 'nineteen', 'eighteen' }` |
  | delete `POST /api/ledger/deviations` from CLAUDE.md's bullet | `AssertionError: the bullet promises to name every requireMailToken lane outside the two prefixes, and does not name POST /api/ledger/deviations` |
  | **forward direction** — add a NEW `requireMailToken` lane outside the two prefixes | `AssertionError: … does not name POST /api/brandnew — the surface grew and the sentence did not` |
  | narrow `GATE_PATTERNS` to `requireMailToken` alone | `AssertionError: the inline-gated mail route is missing — the scanner narrowed: expected [ 'GET /api/mail', …(10) ] to include 'POST /api/mail'` |
  | break a `passage()` anchor | `AssertionError: README, the auth paragraph: the opening anchor is gone: expected -1 to be greater than -1` |
  | make `passage()` return `''` on a missing anchor AND break that anchor | `AssertionError: README's auth paragraph states a count this tree does not have: expected Set{} to deeply equal Set{ 'nineteen', 'eighteen' }` |
  | restore CLAUDE.md's "the two prefixes above are the whole box-token surface" | **GREEN as written — hole, and it is the hole D-1156 itself reported.** See below. |

  **The row wave 5 named, and why it could not be closed the obvious way.** Wave 5 measured that the
  CLAUDE.md correction was unpinned by restoring the false sentence and observing green. Restoring it
  here is STILL green, and a phrase-absence scan cannot fix that: the corrected bullet *quotes* the false
  claim in order to retract it (`correcting a "whole box-token surface" claim this file carried for one
  wave`), so any scanner forbidding that phrasing would red on the correction itself — the trap wave 5's
  own review recorded as "a correction may paraphrase the false claim but may never quote it".

  So the pin is not on the WORDS, it is on the PROPERTY the sentence asserts, derived: the bullet promises
  to name every `requireMailToken` lane sitting outside `/api/mail*` and `/api/runs*`, and the scanner
  computes that set from the source and requires each member to be named. That holds the claim in the
  direction it will actually rot — a route added outside the two prefixes, with the sentence left behind —
  which the forward-direction row above measures by adding one. Restoring the false clause remains green,
  and that is now a stated limit rather than an unexamined gap: it produces a self-contradicting sentence
  (`the whole box-token surface, not the whole of it`) that a human reviewer catches and no scanner
  should be asked to.

  **A constraint the scanner imposes on its own corpus, found by tripping it.** Inside a scanned passage,
  every number word from `two` upward is read as a claim about this surface. A correction to `gate.ts`
  that said "in TWO directions rather than one" reddened the scanner that was checking it; the fix was
  "BOTH directions", which is better prose anyway. The constraint is documented at the top of the test
  rather than left to be rediscovered.

- [ ] **7.10 — Commit.**

```bash
git add server/test/box-token-census.test.ts server/test/auth-gate.test.ts \
        server/src/auth/gate.ts README.md CLAUDE.md
git commit -m "fix: derive the box-token surface from its call sites, and correct all five prose sites that under-claimed it (D-1156, D-1242, D-1162)"
```

---

## Task 8: the runId lower bound, on the two readers that still lack it

**Files:**
- Modify: `server/src/coord/routes.ts` (`:461-469`, `:1694-1702`)
- Test: `server/test/run-routes.test.ts` (or the mail/claims route suites — put each case in the file that
  already owns that route)

Wave 5 fixed one of three (`D-1151`, the kickoff route). The convention is inconsistent across the other
two: both accept `0` and negatives, relying on a downstream `coord.run(runId) === null` to answer 404
`unknown-run`.

**This is not the free win D-1151 was, and the plan says so before the diff does (D-1165).** On the
kickoff route nothing downstream caught the bad pair, so a nonsense brief was actually composed. Here the
value IS caught — as a 404. Adding the bound changes a negative `runId` from 404 `unknown-run` to 400
`bad-request`, and on `POST /api/mail` it additionally changes which `recordRejection` row is written
(`bad-kind` instead of `unknown-run`). That is the correct answer — a shape error is a 400 and a missing
row is a 404, and conflating them is the overloaded seam this tree bans — but it is a behaviour change,
so it ships with tests that pin BOTH statuses and the recorded rejection code.

- [ ] **8.1 — Re-confirm the anchors.**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '461,470p'   server/src/coord/routes.ts
sed -n '1694,1703p' server/src/coord/routes.ts
sed -n '588,594p'   server/src/coord/routes.ts     # the downstream 404 on the mail route
sed -n '1717,1723p' server/src/coord/routes.ts     # …and on the claims route
```

- [ ] **8.2 — Write the failing tests**, one pair per route: a negative `runId` and a zero `runId` each
answer 400 `bad-request` with a detail naming `runId`; a well-formed but unknown `runId` still answers
404 `unknown-run` (the fixture that proves the 400 did not swallow the 404's own case); and on the mail
route, the recorded rejection row carries the shape code rather than the unknown-run one.

- [ ] **8.3 — Run and record the red.** Expected: 404 where 400 is asserted. Record verbatim.

- [ ] **8.4 — Implement**, in both readers, changing only the accepting arm:

```ts
    } else if (typeof runIdRaw === 'number' && Number.isInteger(runIdRaw) && runIdRaw >= 1) {
```

and widen each refusal's detail to `'runId must be a positive integer when given'`. Add a comment at the
first site recording D-1151's lesson and this route's difference (the bad value was already caught here,
as a 404; the change is that a shape error now answers as one).

- [ ] **8.5 — Run and record the green.**

- [ ] **8.6 — Measure the mutation table.**

  | mutation | first-fail assertion |
  |---|---|
  | drop `&& runIdRaw >= 1` from the mail reader | `AssertionError: expected 404 to be 400` |
  | drop `&& runIdRaw >= 1` from the claims reader | `AssertionError: expected 404 to be 400` |
  | make the bound `> 1` (off-by-one against a legitimate run 1) | `AssertionError: expected 400 to be 202` — and the test that catches it is a PRE-EXISTING one sending a real `runId: 1`, not one of this wave's |
  | drop `Number.isInteger` from the mail reader | **GREEN as written — hole.** No case in either suite sent a FRACTIONAL runId; every case was an integer at or below zero, which `>= 1` refuses on its own. Closed by adding `1.5` and `4242.5` to the mail table and `1.5` to the claims one, then: `AssertionError: expected 404 to be 400` |

  4/4 red after closing one hole. The hole is the same shape as the wave's other three: a guard with two
  terms, and a fixture exercising only one of them, so deleting the untested term changed nothing any
  assertion could see.

- [ ] **8.7 — Commit.**

```bash
git add server/src/coord/routes.ts server/test
git commit -m "fix(coord): the last two runId readers get the lower bound the third already had (D-1165)"
```

---

## Task 9: whole-branch verification and the handoff

**Files:** none new — this task measures and reports.

- [ ] **9.1 — Full suites, foreground, `timeout 600000`, cd'd in, tails READ not grepped.**

```bash
cd "$(git rev-parse --show-toplevel)/server" && timeout 600000 ./node_modules/.bin/vitest run
cd "$(git rev-parse --show-toplevel)/agent"  && timeout 600000 ./node_modules/.bin/vitest run
cd "$(git rev-parse --show-toplevel)/pwa"    && timeout 600000 ./node_modules/.bin/vitest run
```

  | suite | files | passed | skipped |
  |---|---|---|---|
  | server | *(measured)* | *(measured)* | *(measured)* |
  | agent | *(measured)* | *(measured)* | *(measured)* |
  | pwa | *(measured)* | *(measured)* | *(measured)* |

  Baseline for the deltas: server 244/6131/56, pwa 76/2085/0, agent 18/281/0 at wave 5's close. Confirm
  the baseline on the merge-base BEFORE claiming a delta.

- [ ] **9.2 — Re-run any load flake IN ISOLATION** before calling it a break: `ccd-ws-gc`, `pr-sweep`,
`session-hook`, `typecheck-tests`, `ccd-session-state`. Record which were re-run and the isolated result.
A single green isolated run is not proof it was the load — say which it was, or say it is unresolved.

- [ ] **9.3 — Typecheck all three packages.**

```bash
for p in server agent pwa; do (cd "$(git rev-parse --show-toplevel)/$p" && ./node_modules/.bin/tsc --noEmit) || echo "TSC RED: $p"; done
```

- [ ] **9.4 — The mutation table, counted twice by independent methods.** Count A (structural): total
table lines across tasks 1-8 minus separators. Count B (arithmetic): per-task filled rows summed. State
both, state that they agree, and answer explicitly: **did any guard ship with no row?** If yes, name it
and either add the row or record why not. Name every row that came back GREEN or red-for-the-wrong-reason
in a `| # | task | the prescribed row | what actually happened, and the hole behind it |` table.

- [ ] **9.5 — Run the scanner suites that police this diff**, together:

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/single-definition.test.ts test/deviation-refs.test.ts \
  test/coord-routes-single-file.test.ts test/coordinator-skill.test.ts test/worker-skill.test.ts \
  test/topology-clean.test.ts test/oss-metadata.test.ts test/node-floor.test.ts \
  test/coord-db.test.ts test/deliverability-parity.test.ts test/lifecycle-sweep.test.ts
```
`coordinator-skill` and `worker-skill` are in the list to PROVE the corpus was not touched — this wave is
not agent-first, and a green pass on both is the fixture that witnesses it.

- [ ] **9.6 — Self-review against Global Constraints**, one line each: branch, agent-first scope, wire
discipline, no overloaded null, TDD reds recorded, deviations defined before their source refs, suites
foreground.

- [ ] **9.7 — Confirm the branch, then push and open the PR.**

```bash
cd "$(git rev-parse --show-toplevel)"
git branch --show-current            # MUST print ws/quiet-meadow
git log --oneline origin/main..HEAD
git push -u origin ws/quiet-meadow
gh pr create --base main --head ws/quiet-meadow --title '…' --body '…'
```

- [ ] **9.8 — Measure the fingerprint ONCE, after the final push, and send it ONCE.**

```bash
git -C "$(git rev-parse --show-toplevel)" rev-parse HEAD    # branchTip AND handoffCommit — the same sha
gh pr view --json number,state
```
`prPhase` is one of the eight words — `unchecked | none | no-commits | open | draft | merged | closed |
unknown` — read, never invented. Then STOP PUSHING: a lint fix after the mail moves the tip away from the
claimed sha and the coordinator gets `stale-tip` for a wave that was finished.

- [ ] **9.9 — Report what the coordinator must act on**, in the wave-done mail: the two corrected brief
premises (D-1208, D-1209), the out-of-scope `ccd/` finding (D-1168), the new `SESSION_ONLY` vocabulary
(D-1240), and every deviation defined below.

- [ ] **9.10 — Release the claim.**

```bash
~/.local/bin/ccrc-api claims release 15 --json - <<JSON
{"byId":"ccrc-pwa-quiet-meadow","byUuid":"$(cat "$HOME/.cc-sessions/ccrc-pwa-quiet-meadow.uuid")"}
JSON
```

---

## Deviations found

This wave's numbers are `D-1162..1172` plus `D-1208`, `D-1209`, `D-1210` and `D-1240`, `D-1241`, `D-1242`, allocated from `POST /api/ledger/deviations` at planning time (floor
1157 → 1173, then 1208/1209 and 1210 after the collision recorded in D-1210 below). The program block
`D-999..1046` and `D-1119..D-1156` are all spent. Every number cited anywhere in this plan or in the diff
is defined below; `deviation-refs.test.ts` reds on a source ref to an allocated-but-unentered number, so
an entry lands in the same commit as (or before) the comment citing it.

Every number is now SPENT. The three that were allocated-and-unspent at planning time — 1170, 1171, 1172
— were all consumed by the self-review round, which is the shape this section predicted (defined at
execution, never silently dropped). The two originally at the head of the block, 1157 and 1158, were
surrendered to PR #38 and replaced by 1208 and 1209.

### D-1210 (ledger collision, resolved by renumbering — process) — PR #38 took two of this wave's allocated numbers, and PR #41 later took three more

**What happened.** This wave allocated `D-1157..1172` from `POST /api/ledger/deviations` at planning
time; the allocator recorded the block against this session and moved the floor to 1173. While the wave
was executing, PR #38 ("the archived-but-live census could never fire") merged to `main` DEFINING
`- **D-1157**` and `- **D-1158**` in its own plan — numbers it did not hold. The ledger now showed both
as `landed`, against THIS wave's allocation title, while the content that landed was #38's: one number,
two meanings, in two plan files.

**How it was resolved, and why that way.** By this repo's own precedent — wave 5's handoff records
`stage3a` and `fleetio-measured-read` both reading "next free is D-108", and the one that merged FIRST
keeping the numbers — #38 is on `main`, so THIS wave renumbers. `D-1157` → **D-1208** and `D-1158` →
**D-1209**, allocated fresh from the allocator (floor now 1210). The renumber touched only this wave's
own citations: one line each in `shared/api.ts`, `pwa/src/fleet/CapsControl.tsx`,
`pwa/test/caps-control.test.tsx` and `server/src/coord/routes.ts`, plus this plan. Every `D-1157`/`D-1158`
remaining in the tree is #38's and was deliberately left alone.

**What was NOT done.** The commits already pushed cite the old numbers in their messages. History was not
rewritten to hide that: a force-push over a reviewed branch to make a ledger read tidily is a worse
trade than a commit message that needs this entry to interpret. The renumber lands as an ordinary commit.

**The mechanism gap this exposes, reported not fixed.** The allocator hands out numbers, but nothing
stops a plan from DEFINING a number it never allocated — `deviation-refs.test.ts` checks that no tracked
ref sits ABOVE the high-water, and both colliding numbers were below it, so the suite was green on both
branches simultaneously. A check that every DEFINED number is one the definer actually holds would have
caught this at the source. That belongs to whichever wave owns the ledger surface next, not to this one.

**IT HAPPENED AGAIN, TWICE MORE, AND THIS ENTRY WAS STALE UNTIL NOW.** The paragraphs above say two
numbers, closed. It is FIVE, and three of them fired after this entry was written. **PR #41 merged at
21:54 UTC on 2026-09-01 DEFINING `D-1159`, `D-1160` and `D-1161`** — this wave's, allocated at planning
time — with entirely different subjects, and with the numbers in three plan FILENAMES. Same fault as
#38, third instance in two days, and the coordinator measured it rather than argued it: cloning this
tip, merging `origin/main` (`47ac50da`, clean) and running the one test gives
`no NEW D-<n> carries two different subjects in two different plans` — three entries, one number each.

Resolved the same way and by the same precedent, which again went against this branch: **the branch that
can still move cheaply moves.** #41 is merged and its numbers are in filenames; these were on an unmerged
branch. `D-1159` → **D-1240**, `D-1160` → **D-1241**, `D-1161` → **D-1242**, allocated fresh BEFORE any
editing (floor 1240 → 1243) — allocating and defining in one act, because the window between them is
exactly the hazard that has now fired three times.

**Measured, not taken on trust.** The coordinator's count was "18 refs in the plan and 11 across twelve
source and test files"; the tree says 15 plan refs plus three range sentences that had to be rewritten by
hand (a bulk replace would have produced `D-1240..1172`), and **13 refs across 11 files** in source and
tests. Two of the files carrying these numbers are #41's and were deliberately left alone
(`server/test/install-sh.test.ts`, `server/test/ccrc-update.test.ts`), as is every ref under its graph
and install lane. `graphify-out/` is untracked and was not touched.

**What this run adds to the mechanism gap above.** The allocator is **not a claim on a number, only a
record that you asked** — this branch held the allocation rows for all five and lost all five to merge
order. The hole `deviation-refs.test.ts` cannot see is now precisely stated, for the wave that owns the
ledger surface: it fires only once BOTH definitions are in ONE tree, i.e. one merge too late, and it
never checks that a DEFINED number was allocated to the definer. Three incidents now sit behind that.

**What was NOT done, again.** The commits already pushed — `ff85c514`, `eee5fa1a` and every wave-6 commit
before them — cite `D-1159`/`D-1160`/`D-1161` in their messages, and history was not rewritten. This
entry is how those messages are read.

### D-1208 (brief premise corrected by measurement — record-only) — the derived door count shipped in a different commit

The brief and the ledger both attribute the `UNGATED.size` derivation to `5ff7c33c`. That commit does not
touch `server/test/coord-pause-route.test.ts` at all — its four files are `CLAUDE.md`,
`pwa/src/fleet/nestFleet.ts`, `pwa/test/stores.test.ts` and `server/test/resume-reclaim-l0.test.ts`. The
derived count shipped in `ca711141` ("docs(wave5): the ungated operator doors are four, and the count is
now derived"), eleven commits earlier. The five commits the brief names are wave 5's FIX ROUND; the
idioms worth copying live in its feature commits. Planning against the named commit would have looked in
the wrong diff.

### D-1209 (spec/brief premise corrected by measurement — scope) — `capsUsage` reaches the PWA nowhere

The brief's "(capsUsage is already computed)" is true server-side and does not mean what it implies:
`capsUsage`, `CoordCaps` and `maxConcurrentWorkers` occur ZERO times in `pwa/src`, `CoordStatus` carries
only `{pause, mail}`, and no route reads or writes either. "Showing current usage vs cap" is therefore
not a rendering job over data already present — it needs a read route. This wave adds `GET
/api/coord/caps` alongside the POST, and names `CoordCapsUsage`/`CoordCapsView` in `shared/api.ts`. Caps
are deliberately NOT added to the `{type:'coord'}` frame: `emitCoord`'s docstring states it needs no
try/catch because it touches no `node:sqlite`, and `dispatchedIn24h` moves with the clock, so the frame's
byte-equality guard would let it re-emit on nearly every 2 s tick.

### D-1240 (mechanism gap the wave exposes — MAJOR) — "no box token" and "D-282 release valve" were one fact

`coord-pause-route.test.ts` direction-one asserts that every `app.post` with no box-token gate ahead of
its first `await` is a member of `UNGATED`. That held only because the four D-282 doors were the only
ungated POSTs in the file. The brief requires the caps dial to be NEITHER box-token NOR `UNGATED`, and
both facts cannot be asserted with that vocabulary. This wave adds `SESSION_ONLY` — ordinary same-origin
PWA writes that no machine lane calls — asserted disjoint from `UNGATED` in both directions, with its own
argument at the call site, plus a pin that no member is in `EXEMPT` (which is what "session-gated when
armed" MEANS). `UNGATED.size` stays four, so no prose cardinal at any of the five scanned sites moves.

### D-1241 (measured gap) — no store method could answer the coordinator question

`CoordStore` has no method answering "is session X the `claimedBy` of a non-terminal run".
`openRunsForSession` looks like it and keys on `sessionId`, the WORKER column — the opposite fact.
`runs({includeClosed:false})` would answer at the cost of a `programs` JOIN and a `prLineage` JSON parse
per row, the exact cost `OpenSibling`'s own docstring says this tree does not pay for this class of
question. Added `openCoordinatorIds()`, one statement, mirroring `programOpenRunCount`'s shipped
predicate rather than re-deriving one from `RUN_TRANSITIONS` — which would disagree, because the table
gives `'unknown'` an empty target list while every shipped query counts an `'unknown'` row as open.

### D-1242 (measured gap the ticket never named — widens D-1156) — a fourth and fifth stale census site

`server/src/auth/gate.ts:75,77,80,90` and `:663` state "the SEVENTEEN box-token machine lanes plus
`/api/notify` … All eighteen". Measured: `coord/routes.ts` holds eighteen token-consulting handlers, so
the figures are eighteen and nineteen — exactly one generation stale (`auth-gate.test.ts:414-418` records
the set going 17 → 18 when `GET /api/runs/:id/items` joined; this prose was never updated). `:80` is also
wrong in KIND: five of the eighteen accept a session cookie instead, so they do not "refuse every verdict
but 'ok'". `server/test/auth-gate.test.ts:401`'s own title and `:438`'s "the eighteenth" carry the same
off-by-one over a CORRECT 18-element assertion. D-1156's blast radius is five files, not the three the
ticket implies.

### D-1162 (mechanism design, from measurement) — the three prose sites count three different sets

`README:530` counts box-token-GATED coordination routes; `auth/gate.ts:75` counts machine LANES,
including the five dual-credential GETs and `/api/notify`; D-1156's own ledger entry counts
`requireMailToken` call sites alone and arrives at eleven. A scanner demanding one word from all three
would be wrong twice over passages that are legitimately describing different things. The mechanism
therefore NAMES its set — handlers that CONSULT the token, by either mechanism, across both files that
register one — and the prose is rewritten to speak that set rather than the scanner being widened to
tolerate three vocabularies.

### D-1163 (vocabulary gap) — no feed kind fits a coordination-config change

`NotifyEvent['kind']` is a closed six-token union and a caps change is none of them. `'run'` is closest
and would be a lie: there is no run. `recordRunEvent` is not an escape either — it writes `fromState ===
toState`, and `pushNewRuns` skips exactly those rows, so the event would land in `run_events` and be seen
by nobody. Added `'coord'`: additive, and an older PWA already degrades an unrecognised kind to
`'unknown'` through `isNotifyKind`, which is the designed degradation rather than a new one. The two
total `Record<NotifyEvent['kind'], …>` maps in `MailScreen.tsx` turn the addition into a compile error
until the renderer handles it — the forcing function working as intended.

### D-1164 (measured defect in a shipped method) — `setCaps` validates nothing and returns void

`CoordStore.setCaps` binds both fields straight into an UPDATE with no `Number.isInteger`, no bounds and
no NaN guard: `0`, `-5`, `1.5` and `1e9` all persist. `maxConcurrentWorkers: 0` is a genuine wedge —
`dispatch.ts:238` compares with `>=`, so zero refuses every dispatch, and unlike the pause marker there
is no ungated door to undo it. It also returns `void` and silently no-ops if row `id = 1` is absent,
while `caps()` THROWS on that same missing row: the two disagree about one condition. The absence never
showed because nothing in `server/src` had ever called it. This wave adds the validation as an L1
decision rather than widening the store's signature — the narrower change, and the one the ring
discipline asks for. The `void`/throw disagreement is recorded, not fixed: closing it changes a shipped
signature for a condition no route can currently reach (every caller opens with `notConfigured`).

### D-1165 (behaviour change, deliberate) — the runId lower bound moves a 404 to a 400

Adding `>= 1` to the two remaining `runId` body readers changes a negative or zero `runId` from 404
`unknown-run` to 400 `bad-request`, and on `POST /api/mail` changes the recorded rejection code from the
unknown-run one to the shape one. This is the correct answer — a shape error is a 400, a missing row is a
404, and conflating them is the overloaded seam this tree bans — but it is not the free win D-1151 was on
the kickoff route, where nothing downstream caught the bad pair at all. Shipped with tests pinning both
statuses and the recorded rejection code.

### D-1166 (measured trap in the obvious template) — the pause route is the wrong model in one place

`POST /api/coord/pause` deliberately has no `if (!deps.coord) return notConfigured(reply)` arm, and says
why: a pause is a marker file on the fleet host, so a box with no coordination database can still be
paused and answering 501 would be a lie about what the act needs. Caps are rows in `coord.db`, and
`caps()` casts an undefined row rather than returning null. Copying the pause handler's opening verbatim
— the natural move, since it is the only other `/api/coord/*` route — ships a route that throws on such a
box. The caps routes open with the arm the other twenty-two have.

### D-1167 (decision, argued) — the quiet window forks the threshold, not the gate token

`sweepMail`'s `not-quiet` and `cooldown` gate tokens are unchanged for a coordinator. `MailGate`'s own
docstring sets the rule — one member per CONDITION, not per `continue`, and `no-pane`/`no-config-dir`
were split because an operator acts on them differently — and here the condition is identical (this
session has not been quiet long enough) and so is the act (wait). The union is explicitly NOT a
scheduling input: it exists so a human can tell "waiting" from "wedged", and both thresholds are waiting.
A `coord-not-quiet` member would cost a union entry, a total-map entry in `shared/api.ts` and a phrase in
`MailStrip.tsx` to record a distinction nobody acts on.

### D-1168 (measured gap, reported NOT fixed — out of scope, agent-first) — `ccd/ccrc-api` states the ungated set as two

`ccd/ccrc-api:32-38` says "D-282 leaves `coord/pause` and `runs/:id/abandon` ungated on purpose" — stale
against the four in `UNGATED`, two generations behind. It is a shipped bash client under `ccd/`, on the
coordinator's AGENT-FIRST deploy lane, and this wave is explicitly server + PWA + root docs only. Not
touched, not folded into the census corpus, and mailed to the coordinator before implementation began
(mail 128) rather than reported at wave-done. `server/test/ccrc-api.test.ts:138-152` already scans that
file's ROUTES table, but for route keys only, never this prose — so a later agent-first wave has both a
site and a scanner to extend. Its source text, `docs/superpowers/plans/2026-08-26-ccrc-api.md:131`,
carries the same stale pair.

### D-1169 (measured, recorded) — `coordinator_state.updatedAt` is write-only

`setCaps` writes `updatedAt` and nothing in the tree ever reads it: the only two SQL sites touching
`coordinator_state` are `caps()`'s SELECT, which does not list the column, and `setCaps`'s UPDATE. The
caps control would naturally show "last changed", and cannot. Not widened here — `caps()` returns
`CoordCaps`, a shipped wire type, and widening it to carry a timestamp is a change to that type for a
feature nobody asked for. Recorded so the next wave that wants the field knows the column already exists
and only the read is missing. `setCaps` also reads its OWN clock inline rather than taking the caller's
moment, against the surrounding convention (`capsUsage(now = Date.now())`, `recordRunEvent(…, at)`, whose
rule D-1134 states as "the caller owns the moment being recorded") — left alone for the same reason, and
noted because a fixture that needs to pin a caps timestamp cannot.

---

## Execution record

### Baseline, measured BEFORE the first line of implementation (2026-08-31 19:30-19:36 UTC)

Merge-base `6458a14d`, worktree clean but for the plan file. Foreground, `timeout 600000`, cd'd into each
package, tails read. Box load average 6.51 at start (16 cores).

| suite | files | passed | skipped | duration |
|---|---|---|---|---|
| server | 244 | 6131 | 56 | 294.42s |
| agent | 18 | 281 | 0 | 3.37s |
| pwa | 76 | 2085 | 0 (Type Errors: none) | 53.33s |

These are EXACTLY wave 5's close-record figures (server 244/6131/56, agent 18/281, pwa 76/2085), so the
deltas this wave reports are measured against a baseline confirmed on this box, not inherited from a
prior wave's prose. No load flake shed on any of the three runs.


### 9.1 — Full suites (measured at handoff, foreground, `timeout 600000`, cd'd in, tails read)

| suite | files | passed | skipped | delta vs baseline |
|---|---|---|---|---|
| server | 247 | 6206 | 56 | +3 files, +75 tests |
| agent | 18 | 281 | 0 | unchanged |
| pwa | 77 | 2099 | 0 (Type Errors: none) | +1 file, +14 tests |

The baseline at the top of this record was measured on this box BEFORE the first line of
implementation, so these deltas are measured rather than inherited from a prior wave's prose.

### 9.2 — Load-flake isolation

**None shed.** The first full server run after task 8 came back `1 failed | 246 passed`, and the failure
was NOT a flake — it was `coordinator-skill.test.ts`'s route-corpus linkage, a real finding this wave
caused (see 9.4's late-guard table). After that was addressed the full server suite ran 247/247 in one
pass, and agent and pwa each passed in one pass. No test in the known-flaky five (`ccd-ws-gc`,
`pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) failed at any point during this wave,
so nothing needed an isolated re-run and nothing is being written off as load.

### 9.3 — Typecheck

`./node_modules/.bin/tsc --noEmit` in each package: **server CLEAN, agent CLEAN, pwa CLEAN.**

Worth recording because vitest did not catch it: `tsc` found a real defect the green suites did not.
`coordMutex.run` takes `() => Promise<T>`, and the caps route's first draft handed it a synchronous
thunk — `TS2345`, plus two `TS18046`s and a `TS2698` downstream from the resulting `unknown`. The server
suite does not typecheck `server/src`, so all sixteen route tests passed against code that would not
compile. The plan's separate typecheck step is what surfaced it.

### 9.4 — The mutation table, counted twice by independent methods

- **Count A (structural).** Scan the plan for `| mutation | first-fail assertion |` headers and count the
  data rows under each: **8 tables, 56 rows** — per task 4 / 6 / 9 / 3 / 13 / 7 / 10 / 4.
- **Count B (outcome classification).** Independently classify each row's SECOND cell by what it
  records: **47 measured red + 8 recorded GREEN + 1 cross-referenced to the row above = 56, with 0
  unfilled.**

Both methods agree at 56, and Count B additionally proves the table has no `(measured at execution)`
placeholder left anywhere — the specific failure wave 5 shipped and its review had to catch.

**Eight rows came back GREEN. Six were closed and re-measured red; two are reported, with reasons, and
not closed.**

| # | task | the prescribed row | what actually happened, and the hole behind it |
|---|---|---|---|
| 1 | 1 | drop `claimedBy IS NOT NULL` | Every fixture went through `openRun`, whose signature requires a `claimedBy: string`, so no row in the suite could carry a null. `reconstruct`'s recovery INSERT can, on a NON-terminal wave — the row the guard exists for. Closed; re-measured `expected [ null ] to deeply equal []`. |
| 2 | 3 | drop the `Array.isArray(body)` arm | All three shape arms fall through to the asks-for-nothing refusal, so `ok === false` held for every one and the test could not see them. What the arms decide is the DETAIL. Closed by asserting the whole refusal object, which made all three witnessable — and showed that dropping the null arm THROWS rather than mis-wording. |
| 3 | 5 | write before validate | The MUTATION was mis-designed, not the guard: moving `setCaps` above the refusal still ran it only on the `ok` arm. Redesigned as the slip that actually happens — a refusal that sends its 400 without RETURNING — and red at once. |
| 4 | 5 | make the feed event's absence fatal | The throw lands in the handler's own try/catch, so every status assertion stayed green. What the `if (log)` guard actually protects is the LOG: a box with no feed configured is not a box whose feed write failed, and warning on every caps write collapses the two in the one place an operator looks. Closed by asserting the console. |
| 5 | 5 | drop `coordMutex.run` | No fixture in that file can drive a concurrent dispatch against a caps write. Closed with the tree's own structural mechanism instead of a bespoke race fixture: `dispatch-mutex-gate.test.ts`'s `TARGETS` gained `coord.setCaps`, needing no scanner change because `head` is the whole dotted identifier chain. |
| 6 | 8 | drop `Number.isInteger` | Every case sent an integer at or below zero, which `>= 1` refuses on its own. Closed by adding fractional cases. |
| 7 | 5 | reply with `decided.next` instead of the re-read | **REPORTED, NOT CLOSED.** The two cannot be made to differ: the only state that separates them is a missing `coordinator_state` row, and the route reads `caps()` as `before` in its FIRST statement, so that state throws there and both spellings answer 500 — measured, after building the state with a raw `DELETE` through a db handle the harness now returns. The re-read is a truthfulness choice with no observable consequence, not a guard, and is not claimed as one. |
| 8 | 7 | restore CLAUDE.md's whole-surface claim | **REPORTED, NOT CLOSED — and it is the hole D-1156 itself reported.** A phrase-absence scan cannot fix it: the corrected bullet QUOTES the false claim in order to retract it, so such a scan would red on the correction. The pin holds the PROPERTY instead, derived — the bullet names every `requireMailToken` lane outside the two prefixes — measured in the forward direction by adding one. Restoring the clause produces a self-contradicting sentence a human reviewer catches and no scanner should be asked to. |

**DID ANY GUARD SHIP WITH NO ROW? YES — three did, and the answer is the check working rather than a
clean bill.** Asking the question rather than assuming the tables were complete found three guards with
no prescribed row: the `setCaps`-has-exactly-one-caller pin (task 5), and both halves of the
coordinator-corpus accounting added during verification. All three were measured after the fact:

| late-found guard | first-fail assertion |
|---|---|
| a SECOND `setCaps` caller appears in `server/src` | `AssertionError: expected [ 'coord/routes.ts', 'watch.ts' ] to deeply equal [ 'coord/routes.ts' ]` |
| the coordinator corpus NAMES the caps dial (forbid-mention) | `AssertionError: expected '---\nname: ccrc-coordinator\ndescript…' not to contain '/api/coord/caps'` |
| remove the caps routes from the coordinator `EXEMPT` set | `AssertionError: GET /api/coord/caps is registered in coord/routes.ts but is named nowhere in the route corpus` |

That brings the wave to **59 measured rows**: 50 red as prescribed, 6 holes closed and re-measured red,
2 reported-not-closed, 1 cross-referenced.

**A finding the plan did not anticipate, and the scope call it forced.** The full server suite's one
failure was `coordinator-skill.test.ts`: every coordinator-domain route registered in `coord/routes.ts`
must be NAMED in the coordinator skill corpus. The caps dial is not a coordinator lane, so the resolution
is an exemption — and the brief requires MAILING the coordinator before any change that reaches
`ccd/coordinator-skill/`, because it changes the coordinator's deploy lane. It does not reach it: both
the `EXEMPT` set and the companion forbid-mention pin live in `server/test/coordinator-skill.test.ts`,
so the fix is a server-test change and this wave stays NOT agent-first. Verified by measurement, not by
reading: `git diff --stat origin/main..HEAD -- ccd/ session-hook.sh deploy/` is empty.

The exemption's argument is `POST /api/coord/pause`'s, one turn sharper. The caps bound how much a
coordinator may dispatch; a coordinator told about this route would be told how to raise its own limit,
which is the cap's own defeat the way unpausing itself would be the pause marker's. Both halves are
exempt — the READ too, because a coordinator that can read a dial it may not turn has no use for the
number, and naming it would be the first half of an invitation. A forbid-mention pin turns the
permission-to-omit into a prohibition, the shape `/api/claims/:id/break` and `/api/runs/:id/reclaim`
already use.

### 9.5 — The scanner suites that police this diff

Run together, green: `single-definition`, `deviation-refs`, `coord-routes-single-file`,
`coordinator-skill`, `worker-skill`, `topology-clean`, `oss-metadata`, `node-floor`, `coord-db`,
`deliverability-parity`, `lifecycle-sweep`, `readme-holds`, `box-token-census`, `auth-gate`,
`coord-pause-route`, `dispatch-mutex-gate`.

`coordinator-skill` and `worker-skill` are in that list to PROVE the corpus was not touched — a green
pass on both is the fixture that witnesses "NOT agent-first", rather than a sentence asserting it.
`deliverability-parity` and `lifecycle-sweep` are there for the same reason on the sweep side: this wave
changed only TRANSIENT rungs, and `peerDeliverable` mirrors only the STRUCTURAL ones.

README grew from 2033 to 2039 lines against `CLAUDE.md:10`'s stated ~1931 (10% upper edge ≈ 2124), so
`oss-metadata` needed no change and CLAUDE.md's line-count figure was left alone.

### 9.6 — Self-review against the Global Constraints

- **Branch** — `ws/quiet-meadow`, this workspace's own. Verified with `git branch --show-current`.
- **NOT agent-first** — `ccd/`, `session-hook.sh` and `deploy/` are absent from the diff, measured.
  One finding pushed toward the skill corpus and was resolved inside `server/test/` (9.4).
- **Wire discipline** — `FLEET_PROTO` untouched. Three additive shared types (`CoordCapsUsage`,
  `CoordCapsView`, the `'coord'` kind); no field removed, no frame changed; the new kind degrades to
  `unknown` on an older client through the reviver that already exists. No new ccd verbs;
  `EXEC_COMMANDS` untouched.
- **No overloaded null at a new seam** — `notConfigured` (501) is distinct from a refused body (400) and
  from a corrupt store (500); `'unreadable'` is distinct from a rejection; a missing `NotifyLog` degrades
  the record and not the write, and says nothing rather than warning as though a write failed; the caps
  control renders NOTHING rather than zeroes when it cannot read.
- **TDD red-first, reds recorded verbatim** — 59 measured rows, 0 placeholders, written as measured.
- **Deviations** — D-1208..1169 defined in this plan; 1170..1172 allocated and unspent, recorded as such.
  `deviation-refs` green.
- **Suites foreground** — all runs foreground with `timeout 600000`, cd'd into the package, tails read.

### 9.7 — Branch and PR

`git branch --show-current` → `ws/quiet-meadow`, this workspace's own branch, checked before the push
rather than assumed. Pushed to `origin/ws/quiet-meadow`; PR **#39** → `main`. The commit COUNT is
deliberately not restated here — an earlier draft said "ten" and the branch already carried eleven by
the time the record was committed, which is the same hand-kept-number-beside-a-growing-list defect
this wave spent a task removing from README and `gate.ts`. `git log --oneline origin/main..HEAD` is
the count, and it is always right.

### 9.8 — The fingerprint

*(measured once, after the final push, and sent once)*

---

## Deviations found — the self-review round

Before claiming the wave done, the whole branch was reviewed adversarially: six lenses filed findings,
and every finding was then handed to an independent agent told to REFUTE it and to default to
`real:false`. 38 filed, 17 verdicts came back `real:true`, deduplicating to **eleven distinct defects**.
The 21 refutations are as valuable as the confirmations and are not listed individually; two are worth
naming because they were nearly acted on: the claim that `lanesIn` mis-attributes a docstring to the
preceding route (true of the mechanism, but the census's own anti-vacuity floor proves it does not
happen here), and the claim that CLAUDE.md's box-token bullet became false (its sentence is scoped by
its own next clause).

### D-1170 (self-review MAJOR — lost update) — the caps read-modify-write straddled the mutex

`const before = coord.caps()` and the `decideCaps` merge it feeds ran OUTSIDE `coordMutex.run`; only
`setCaps` and the re-read were inside. A partial body writes `{...before, ...asked}`, so a merge base
captured before the lock is a classic lost update: with a dispatch holding the mutex across seconds of
real ccd/tmux I/O, two operator saves of DISJOINT dials both read `{3, 12}` and the second write reverts
the first's field — while the first operator was told, by a reply whose whole justification is that it
re-reads the store, that their value was stored. The `dispatch-mutex-gate` target added in task 5 cannot
see this: it only requires `setCaps` to SIT inside the lock. Fixed by moving the read and the merge into
the thunk; the shape refusal stays outside, which is all the reclaim route's rule ever asked for.

**~~Unwitnessed by any fixture~~ — CORRECTED by the coordinator's review, see D-1211.** What was
measured is still true: a test firing two concurrent partial writes stays GREEN against the reverted
code, because `app.inject` does not interleave the two handlers' synchronous prologues, and reproducing
the lost update needs a third actor holding the mutex across a real await. What was NOT measured, and
was written here as though it had been, is the claim that no fixture in this suite could stage that
actor. One can, in about forty lines: `POST /api/runs` with a `sessionId` awaits `deps.runCcd` inside
`coordMutex.run`. The witness now exists and reds on the revert (D-1211); this row is left standing with
its correction rather than rewritten, because the mistake — recording UNMEASURED as UNMEASURABLE — is
the part worth keeping.

### D-1171 (self-review MINOR) — the caps route was the one `NotifyLog.record()` caller that never flushed

`record()` bumps the in-memory seq and appends to the ring; `flush()` persists `{epoch, seq}`, and had
exactly one call site (`watch.ts:1230`, immediately after its own `record`). A seq handed to a client but
never persisted lets a restart re-mint the same pair for a different event — the stale-but-valid landing
`NotifyLog.flush`'s own docstring says `catchUp` cannot tell from the truth. Fixed with `void log.flush()`
beside the record, matching the other caller exactly. **The placement was wrong — corrected in D-1213:**
"beside the record" put it inside the try, one line below the `recordFeedEvent` that throws, so the flush
was skipped on exactly the failure the try/catch exists for.

### D-1172 (self-review, nine smaller confirmations) — the rest of the round

- **The `recordFeedEvent` try/catch shipped with no row.** Now measured: dropping it turns a landed write
  into a 500 (`expected 500 to be 200`), the worst pair available, since the caller then retries a write
  that already succeeded. Witnessed by DROPping `feed_events` through the raw db handle.
- **`shared/api.ts:2827` — a mangled JSDoc line**, `it is not.   *`, where the paragraph splice replaced
  the closing `*/` with a separator. Cosmetic, and confirmed four separate times.
- **The `coord.setCaps` mutex target had no anti-vacuity floor.** The floor is now DERIVED from `TARGETS`,
  so a future entry whose call site the scanner never finds fails on its own rather than passing
  vacuously — the failure the entry itself demonstrated.
- **`.caps-input` was the only text entry in the app off `--text-input`**, so iOS Safari zoom-jumps on
  focus. On the token now.
- **Twenty-plus board renders still reached the real `api.coordCaps()`** through the control's default.
  Every `<RunsScreen>` in `pwa/test` now injects the reader.
- **`tap-targets.test.tsx`'s title said "eighteen" over a list of twenty-one** — a hand-kept number beside
  a growing list, which is the exact defect this wave spent a task removing from README and `gate.ts`,
  sitting in the wave's own diff. The count is gone rather than corrected: the list is the claim.
- **The census's bare `POST /api/runs` needle was structurally vacuous** — it degraded to `/api/runs`,
  which any sibling satisfies. Matched on its full backticked spelling now, and measured red.
- **The census's CLAUDE.md pin accepted a longer sibling for a shorter lane** (`POST /api/claims` is a
  substring of `POST /api/claims/:id/release`). Anchored on the backticked spelling, and the bullet is
  flattened first because it is hard-wrapped prose — a route name routinely spans a newline, and a literal
  check would have been a false RED, the failure mode that gets a scanner deleted. Measured red.
- **README stated "No route in this PR changes them" about the caps** — a site this wave's own route
  falsified, in a paragraph the census does not scan. Corrected, along with the mail-lane paragraph's
  `MAIL_QUIET_MS` sentence, which this wave also made incomplete.

**Reported, not fixed, and deliberately:** three unconfirmed PWA findings — a cleared input reading as
`0` (the route refuses it with a clear message, so it is roughness rather than data loss), the notes
sitting in no ARIA live region, and the unconfirmed state naming "reload". They were refuted or
unverified, and a fix round is for confirmed findings; widening it is how a wave stops being reviewable.
They belong to whoever takes the next PWA pass.

### 9.9 — Fix round verification

| suite | files | passed | skipped |
|---|---|---|---|
| server | 247 | 6208 | 56 |
| agent | 18 | 281 | 0 |
| pwa | 77 | 2099 | 0 |

`tsc --noEmit` clean in all three — and it earned its place a second time: vitest's `typecheck` reported
"no errors" while a duplicate JSX attribute sat in `runs-screen.test.tsx`, because that setting only
covers `*.test-d.*` files. Two more mutation rows measured in this round (the try/catch, and the
merge-under-lock which stays unwitnessed), bringing the wave to **61 rows**.

### 9.10 — Merge of `origin/main`, the ledger collision, and final verification

`main` moved during execution: PR #38 merged as `d3de4ec7`, touching `server/src/watch.ts` — a file this
wave also changes. Merged into the branch rather than left to the coordinator: **no conflicts**, and the
two `watch.ts` changes are in different functions (#38's is in the divergence sweep, this wave's in
`sweepMail`). Merging before the claim is what keeps `stale-tip` and a conflicting-PR CI hole off the
coordinator's plate — wave 5's own record has a PR whose CI never ran because GitHub cannot compute a
merge ref for a conflicting PR.

That merge is also what surfaced the ledger collision recorded as **D-1210**: PR #38 defines `D-1157` and
`D-1158`, two numbers this wave held. Resolved by renumbering this wave's two (→ `D-1208`, `D-1209`),
per the merged-first-keeps-them precedent.

| suite | files | passed | skipped |
|---|---|---|---|
| server | 247 | 6210 | 56 |
| agent | 18 | 281 | 0 |
| pwa | 77 | 2099 | 0 |

`tsc --noEmit` clean in all three. Server gained two tests over the fix round — #38's own, arriving with
the merge. No flake shed on any of the three runs.

### 9.11 — The coordinator's adjudication (mail 129), and the ruling round it required

**It arrived 1h42m after it was sent, gated `not-idle` for 911 delivery attempts.** Sent 20:40 UTC in
answer to the pre-implementation flags (mail 128); read at 22:22, after the wave-done. This is the
carried constraint repeating and WORSENING — wave 5 measured 722 attempts on the same lane — and the
cause is the same: the recipient never idled. Two things follow, and both belong in the ledger rather
than in a shrug.

First, the mail was written to survive it: "written so it reads correctly whether it reaches you before
or after the code: every design call is ENDORSED as you framed it, so late arrival costs nothing." That
is the discipline the carried constraint asks for, applied by the sender, and it is why this cost a
verification pass rather than a wave.

Second, **this wave's own change does not fix this case and it would be wrong to imply otherwise.**
`COORD_QUIET_MS` narrows the window for a session that is the `claimedBy` of a non-terminal run — the
COORDINATOR. The blocked party here was the WORKER, mid-wave, which is exactly the session the 60-second
floor exists to protect. The gate did its job. What this measurement argues for is not a shorter worker
floor but a way for a worker to know steering mail is waiting, which is wave 7's board (F7) territory:
911 attempts on one delivery is precisely the "replay counts approaching the ceiling" signal §9 of the
spec says surfaces nowhere.

**The adjudication: six items, all endorsed as framed, one BINDING, one correcting a coordinator ruling.**
Verified rather than assumed:

| item | requirement | state when the mail was read |
|---|---|---|
| 2 (BINDING) | `SESSION_ONLY` ships with BOTH directions from birth — a member is session-gated-only, is NOT box-token-gated, is NOT in `UNGATED` | **already met**: three tests shipped in task 5 — disjointness, really-ungated, and not-in-`EXEMPT` |
| 1(a) | the GET carries the SAME gate posture as the POST, pinned dark-vs-armed with exact status equality | **already met, and derived**: `auth-gate.test.ts`'s sweep loops every HTTP route with three probes each (dark, armed-anonymous, armed-with-session) and asserts dark ≡ authenticated; both caps routes enter it from the source scan |
| 1(b) | the caps shape has ONE definition the GET and POST share, never a read-side copy | **NOT met — fixed in this round.** The GET built `{caps, usage}` inline and unannotated while the POST built a typed `CoordCapsView`: the shape was spelled twice and only one was checked. Extracted to a shared `capsView()` helper, and measured: a GET that rebuilds the shape now reds (`expected { running: +0, dispatchedIn24h: +0 } to deeply equal { running: 1, dispatchedIn24h: 1 }`) |
| 2 (optional) | add the kickoff route to the set if the scanner can see it; otherwise RECORD the blind spot beside the set | **not met — done in this round.** The scanner reads `coord/routes.ts` alone and kickoff is registered in `server.ts`, so it cannot be seen. The blind spot is now recorded in `SESSION_ONLY`'s own docstring, with the coordinator's sentence for why it matters: dodging a pin by placement is not being ungated, it is being unmeasured |
| 6 | build the census so wave 8 can POINT it at `ccd/ccrc-api`'s prose rather than redesign it | **done in this round**: a how-to-add-a-site note at the top of the census, naming that file as the known next site and the four helpers that already do the work |
| 3, 4, 5, 7 | `'coord'` kind endorsed; fold the gate.ts finding in; build the census the measured way; both brief premises accepted | **already met** — all four were the shape already shipped |

Nothing in the adjudication reversed a decision, and the one correction ran the other way: the
coordinator withdrew its own single-surface premise for item 3 in favour of the three-set measurement,
which is the shape that shipped.

**Cost of the round:** three small changes, all of them closing an instruction rather than changing a
decision. The fingerprint was re-measured after them and re-sent — a claim is never re-asserted without
new commits and a fresh measurement, and this has both.

### 9.12 — Final verification, after the ruling round

| suite | files | passed | skipped |
|---|---|---|---|
| server | 247 | 6210 | 56 |
| agent | 18 | 281 | 0 |
| pwa | 77 | 2099 | 0 |

`tsc --noEmit` clean in all three. One mutation row added (the shared shape), bringing the wave to
**62 rows**.

---

## Deviations found — the coordinator's wave-6 review round

Mail 138, run 19: **SHIP-WITH-FIXES**, a 44-agent pass over eight lenses with refute-default verifiers.
17 confirmed (0 MAJOR, 11 minors, 6 notes) plus 2 from a live re-measurement lane, 8 refuted. Two
verifier agents died on API errors and the scoring counted an absent verdict as a refutation; the
coordinator adjudicated both by hand rather than let the arithmetic decide, which is why one of them
appears below as a confirmed minor. The refuted eight are not acted on and are listed at the end.

Numbers D-1211..D-1227 allocated in one block from `ccrc-api ledger allocate` (floor 1211 → 1228).
D-1157/D-1158 are NOT reused in any form: PR #38 defined them first and this wave renumbered away from
them in D-1210.

### D-1211 (must-fix A) — the lost-update guard was recorded UNMEASURABLE when it was merely UNMEASURED

The self-review's MAJOR (D-1170) shipped with the one guard in the wave that had no red measurement, and
`coord-caps-route.test.ts`'s comment said reproducing it "needs the mutex held across a real await by a
THIRD actor, which no fixture in this suite can stage". The first clause is right; the second was never
measured. `POST /api/runs` with a `sessionId` awaits `deps.runCcd` for its `ws-hold` INSIDE
`coordMutex.run`, so an injected runner that signals on entry and then waits on a test gate holds the
lock across a real await — the third actor, already in this server.

The witness is now the test directly below that one: fire the hold, wait for it to be in flight, fire
the two disjoint partial saves, wait until BOTH prologues have read `caps()` (spying on the read is the
instrument, because a fixed number of event-loop turns could pass for one spelling and hang for the
other), release the gate, assert `{5, 20}`. GREEN on the tip; on the D-1170 revert it reds with the
lost update itself.

**Why this matters beyond the one row.** It is the same dodge this wave refused one file over: the
`SESSION_ONLY` blind-spot note says a route that escapes a pin by placement is *unmeasured*, not
*ungated*. Writing "unmeasurable" for "I did not find a way" is that error in my own favour. The
corrected comment and the corrected D-1170 row both say so.

### D-1212 (must-fix B) — the coordinator's own ruling shipped without a mechanism

The ruling was "the read must not carry a copy of what the write answers"; the fix was the shared
`capsView()`; and the mutation row recorded for it changed the VALUES the GET reports, not the sharing.
Measured by the reviewer and re-measured here: restoring the pre-ruling inline rebuild verbatim is
tsc-clean and leaves all ten caps-touching suites green. A row that cannot fail on the defect it names
is worse than no row, because it reads as coverage.

The property is now pinned directly, in two arms: both handler bodies must contain `capsView(`, and
`.capsUsage(` must appear EXACTLY ONCE in `coord/routes.ts`. `capsUsage` is the discriminator on purpose
— `caps()` has other legitimate callers in that file (the shape probe and the merge base), while the
usage reading exists for this answer alone, so any rebuild of the shape has to spell it a second time.

### D-1213 (must-fix C) — `void log.flush()` was skipped on exactly the failure its try/catch exists for

D-1171 added the flush "beside the record", which put it inside the try and one line BELOW
`coord.recordFeedEvent` — which throws synchronously (`node:sqlite`) and is the only reason that
try/catch exists. So on the throw path: `record()` had already bumped the in-memory seq and handed it to
the caller, and the file still held the older number. That is verbatim the hazard `NotifyLog.flush`'s own
docstring names — "a seq handed to a client but never persisted lets a restart re-mint the same
`{epoch, seq}` pair for a different event" — and `catchUp` cannot tell that landing from the truth.
Three independent review lenses arrived at this line.

Fixed by moving the flush into a `finally`: the seq is minted by `record()`, so its persistence follows
`record()` and nothing else. Both directions are pinned — a flush on the ordinary path (the floor, or the
throw-path row could be satisfied by a route that had stopped flushing entirely) and a flush on the throw.

### D-1214 (minor D) — the census's numeral pins compared an UNORDERED SET

`numeralsIn` answered a `Set` and every site asserted `toEqual(new Set([...]))`, so only membership was
checked. Measured by the review: transposing `eighteen` and `nineteen` between the two claims in
`gate.ts` (`:75` says how many box-token machine lanes there are, `:77` says how many things check the
token) stayed GREEN across all five suites that read those words. D-1242's original defect was "wrong in
KIND as well as in number" — a set catches the number half and not the kind half, which is the half that
defect was named for.

`numeralsIn` now answers the numbers IN TEXT ORDER, repeats kept, and each site states its own sequence:
README says the total first and breaks it down, `gate.ts` and `auth-gate.test.ts` name the lanes first
and the total second. Both spellings are correct where they stand, which is exactly why one shared
expectation could not hold them. The file's own constraint note said more than the mechanism did and now
says what it does not hold: order is a proxy for attachment, and a rewrite that moves the CLAIMS along
with their numbers is invisible to it — correctly, because that prose is still true.

### D-1215 (minor E) — an assertion over a derived subset that could not fail

`expect(COORD_LANES, '<key> is named as a box-token lane and is not one').toContain(key)` iterated
`requireSites`, which is derived by scanning the same slices `lanesIn` walks with a STRICTER pattern —
so it is a subset of `COORD_LANES` by construction. The line meant something in the draft, where it
iterated a hand-written list; deriving that list is what quietly emptied it, and it kept a failure
message promising a check it could not perform. Measured: adding `POST /api/coord/caps` to CLAUDE.md's
list as a `requireMailToken` lane stayed green, while deleting `GET /api/ledger` reddened correctly.

The over-claim direction now runs over what the BULLET says rather than over what the source says: every
`VERB /path` the bullet names must be in `ALL_LANES`, unless it is one of the routes the bullet's own
sentences declare NOT to be lanes — the ungated doors (derived from `UNGATED`) and the kickoff route.
The caps mutation now reds: `the bullet names POST /api/coord/caps as a box-token lane and it consults
no box token`.

### D-1216 (minor F) — a hand-kept cardinal, and a widened sentence, in the README

Two faults in one paragraph pair, both introduced or left standing by this wave.

**The cardinal.** README:1455 said "unlike the four operator doors below" — `UNGATED.size`, retyped, in
the wave built to delete that class, about the one number that has already gone two → three → four and
left `ccd/ccrc-api` stuck at "two" (D-1168). It survived only because it sat outside both scanned
passages, while its own neighbour thirty lines up gets it right by naming the doors. Fixed by
enumerating, and the paragraph is now SCANNED — it must state no count at all, and must name every door
in `UNGATED`, so a fifth door reds this rather than silently falsifying a sentence.

**The widened sentence.** README:531 said the nineteen machine lanes are what "the fleet host posts to"
and that "none of them has a cookie jar" — and `gate.ts`'s paragraph, corrected in the same commit,
says five of them are GETs that take a live session cookie OR the token. Five are also not POSTs. So the
wave shipped a correction and its contradiction side by side. Fixed by naming the exempt-but-
authenticated GETs in the README sentence too — enumerated, not counted, because a count there would be
a third number for the same scanner to police.

### D-1217 (minor G) — the cadence pin's sibling list was not re-measured for `CapsControl`

`runs-screen.test.tsx`'s `cadenceOf` docstring names each component in the screen's tree that runs no
`setInterval`, and instructs the reader to re-measure the list when the tree grows one. Wave 6 grew it by
`CapsControl` and did not. `CapsControl`'s own header, meanwhile, asserted that this pin "names each
sibling that runs none" — a claim about a list it was not on.

Re-measured across `pwa/src`: `CapsControl`'s only mention of `setInterval` is the comment forbidding
one, so the CLAIM was true and the RECORD was not. Both sites now say so. And the docstring now states
what the instrument itself covers: `cadenceOf` reads its spy straight after a synchronous mount, and
`CapsControl` renders `null` until its injected read resolves — so an interval armed in its post-load
subtree would be invisible to it, and is held by the grep and by that component's own rule instead.

### D-1218 (minor H) — D-1165's durable rejection record was an unpinned clause

`mail-routes.test.ts:117`'s comment says a malformed `runId` answered as `unknown-run` "also mislabels
the durable rejection record" — a SECOND consequence beyond the status code. The two rows carrying that
comment asserted status, error and detail, and nothing about the row.

**The review's own wording of this finding was wrong, and the coordinator has accepted the correction:**
its clause "nothing reads that record" is false. Measured — `store.rejections()` has sixteen call sites
across three test files, fourteen of them before this wave. The gap was never that the record is unread;
it was that the two rows whose comment makes the claim did not read it.

Both rows now assert the row's code, in both directions: a malformed `runId` records `bad-kind`, and a
well-formed-but-absent one records `unknown-run`, so the pair holds a DISTINCTION rather than a constant.
Witnessed independently of the status assertions by a mutation that touches the row alone — `refuse()`
recording a constant code while the reply still varies.

### D-1219 (minor I) — a miscited check, which is worse than an uncited claim

`caps.ts:4-6` said "L1: pure — the DECISION about a caps write, with no clock, no fs and no `reply`
(`single-definition.test.ts`'s coord-ring scan)". That scan asserts three things and none of them is any
of these: no `./db.js` import, no `node:sqlite` import, no `coord.db`/`store.db` receiver. Measured by
the review: an `fs` import and a module-scope `Date.now()` left it 99/99 green. A citation stops the next
reader from looking, which is why an uncited claim would have been the safer error.

Given a mechanism rather than stood down, because D-1169's own next step is to move the write's MOMENT
into the decision — precisely the change that would make this module impure. `coord-caps-policy.test.ts`
now scans the file with comments blanked (its own docstring names `fs` and `reply` while promising not to
use them, and reddened every arm on the first run) for a clock, a node builtin, a filesystem reach, a
`reply`/fastify/store reference, and any import that is not `import type`. One file, not a ring-wide
sweep: this is the property `caps.ts` asserts about itself, and widening it is a different change.

### D-1220 (minor J) — a stale refusal left standing beside a corrected field

`CapsControl`'s no-op early return sat ABOVE `setNote({kind:'none'})`, and the draft is deliberately not
reset on a refusal. So an operator who typed 99, was refused, and corrected the field back to its stored
value got no request (right) and kept the refusal on screen (wrong) — told their input was invalid at the
moment it became valid again.

### D-1221 (PWA (a), confirmed) — a cleared field was sent as an explicit request to store ZERO

`Number('')` is `0`, and `0` differs from the stored value, so `asPartial` put `{maxConcurrentWorkers: 0}`
on the wire for a box the operator had merely emptied. Zero is the one value `CAP_MIN` exists to forbid,
for the reason that constant's own docstring gives: a stored `0` refuses every dispatch for ever and has
no ungated door to undo it. The server refused it, so nothing landed — but the operator got a bounds
refusal for an ask they never made, and the ask itself was the fleet-wedging one.

Fixed at the seam rather than at the symptom. `asPartial` returned `Partial<CoordCaps>`, which collapsed
"send this", "nothing moved" and "that box holds no number" into one value; it is now a three-member
`SaveIntent` union, and the caller handles the three differently. **Where the line falls** is stated in
the source, because the temptation is to move it: the control decides what was ASKED FOR (a blank box is
not an ask for zero), and the route decides whether the ask is ALLOWED — so `99` and `1.5` are still sent,
and the refusal comes back in the route's own words rather than in a second copy of the policy. Pinned in
both directions.

### D-1222 (PWA (b), confirmed) — the note sat in no live region

The note is the whole of this control's feedback: no toast, no banner, and a successful write simply
re-renders numbers. Rendered as a bare `<p>`, a screen-reader user learns nothing at the one moment they
have just committed to a save. `role="status"` is this repo's own precedent for exactly this
(`AccountsScreen`, `MailScreen`, `FleetScreen`'s ack note).

One note element, ALWAYS mounted, and it is the live region — a `role="status"` inserted at the same
moment its text appears is announced unreliably. `.caps-note:empty` collapses it with `height: 0;
overflow: hidden` and deliberately NOT `display: none`, which would take it back out of the accessibility
tree and undo the reason it is always mounted.

### D-1223 (fold-in) — `auth-gate.test.ts` claimed 55 HTTP routes and 15 exempt ones; the tree derives 68 and 24

Reported in the self-review round as pre-existing and out of scope. The coordinator folded it back in,
correctly: it is the D-1156 family, and this wave built both the mechanism and the how-to-add-a-site note,
so it is a one-site extension rather than a new design — and exercising that note is the only way to know
it is true.

The pin lives in `auth-gate.test.ts` rather than in `box-token-census.test.ts`, and the reason generalises:
that file already derives the count at runtime from `ROUTES`, and a census scanning it from outside would
have had to rebuild the route table to have anything to compare against. The rule the two sites share is
"the number is derived where it is derivable, and the prose beside it is checked against that"; where the
derivation already lives decides which file holds the pin. That site reads DIGITS, the census reads number
words, and each says so. Every needle is spelled SPLIT (`'a ' + 'b'`) — the corpus being scanned is the
file doing the scanning, so an unsplit needle matches its own call site; all three did, first run.

### D-1225 (note → fixed) — a premise the comment named and the fixture did not check

`mail-sweep.test.ts`'s TERMINAL case says "the premise, established: this session IS a claimedBy, just not
a live one" and checked only the claimedBy half. The "not live" half rested on three `advance` calls whose
refusals are silent. Both halves are asserted now, and the negative assertion was made positive: the case
also pins `lastGate === 'not-quiet'`, because "nothing was sent" alone is satisfied by any gate at all — a
draft, a pane that never idled, a cooldown — and the point of the case is WHICH window applied. Measured
by dropping one `advance`: `expected 'closing' to be 'done'`.

### D-1226 (note → fixed) — two derived loops with no non-emptiness floor

The census's README run-route test iterates `COORD_LANES.filter(...)` and `UNGATED_DOORS.filter(...)`; a
filter that stops matching turns each into a pass over nothing. The file's own header names that failure
mode, and this wave walked into it twice in the same test. Both loops now have floors. Recorded as a note
by the review and fixed anyway: closing a known vacuity costs three lines, and carrying it forward as a
record would have been the cheaper half of the job.

### D-1224 (note, recorded — no code) — the narrow window reaches a session that is ALSO a worker

`openCoordinatorIds()` answers "every session that is the `claimedBy` of a non-terminal run", and
`sweepMail` gives every such recipient the 15s/30s window. A session that coordinates one live run while
being dispatched as the WORKER of another therefore gets the coordinator window for its worker mail too.

**Recorded as intended, with the reasoning, rather than fixed.** The key is a property of the SESSION, not
of the message — "is this recipient coordinating something live" — and there is no `runId` on a
`toId:'coordinator'` nudge to key on instead. A session coordinating a live run is a session whose
attention a wave boundary is waiting on, whichever hat the individual message fits. The case to watch is a
single-session program that coordinates and works at once: it would take the narrow window throughout, and
the 60-second floor exists to protect exactly that session mid-turn. No such program exists today.

### D-1227 (note, recorded — no code) — `req.body ?? {}` and its one dead sub-arm

Filed by a review lens as "a null body slips through", and adjudicated REFUTED: `req.body ?? {}` turns
`null` into `{}`, which `decideCaps` refuses as a body that asks for nothing. What IS true is smaller —
the `body === null` sub-arm inside `decideCaps`'s shape check is unreachable from this route, because the
route never passes it `null`. It is reachable from any other caller and from the policy's own tests, so it
is not dead code in the module, only on this path. Recorded so the next reader does not re-file it.

## Refuted, and not acted on

SEVEN, listed so a later wave does not re-open them: `req.body ?? {}` letting a null body through (see
D-1227); the claims-routes servers; the no-op feed event; `gate.ts`'s NOT-EXEMPT enumeration;
`CoordCapsUsage`'s producer; the three-unspent-numbers check; and the "reload to see what was stored"
wording, which the coordinator adjudicated ACCURATE — the control has no other way to re-read after an
unreadable answer, and softening it would be the lie.

**Seven, where the review's mail says eight** (D-1238) — and the coordinator has since named the gap,
which is better than the answer this entry first gave. Its prose itemises SIX refutations, not seven;
the seventh here is the "reload" wording, adjudicated separately in the same mail. The eighth is
**minor H itself**, counted as both refuted and confirmed after two dead verifiers were adjudicated by
hand. So the number does have a name: it is a double-count, disclosed by the reviewer against
themselves. This entry's first version said "a number without a name here", which was generous to the
review and less useful than the truth.

---

## Deviations found — the fix round's own adversarial audit

The review round was itself reviewed before its fingerprint was sent: six lenses over commit
`ff85c514`, every finding handed to three independent verifiers told to REFUTE and to default to
`refuted: true`, then a completeness critic asked what all six missed. 88 agents, 27 findings filed,
14 survived, plus 3 from the critic. **Four majors — and three of them are the same defect the round
had just been sent back for.**

That is the finding under the findings, and it is worth stating before the individual rows: given a
review that said "your guard shipped without a mechanism", I fixed the three guards named and wrote
four new ones with the same fault. A witness whose premise is asserted by a status code; a witness that
builds the instrument proving its premise and never reads it; a live region whose always-mounted
property is not pinned; a scan that hard-codes the one member of a set it derives everywhere else.
The lesson the round recorded — *unmeasured is not unmeasurable* — is not a fact you learn once.

Numbers D-1228..D-1239, allocated in one block (floor 1228 → 1240).

**The coordinator's verification pass of this round (13 lenses, seven of them running mutations in
isolated full checkouts) confirmed 3/3 must-fixes and 4/4 of these majors, and disclosed its own
coverage gap:** fifteen of the thirty-two changed files had no lens in THAT pass, `watch.ts` and
`caps.ts` among them — covered by the 44-agent wave review instead. Recorded here because a ship
decision resting on an unstated gap is the thing this wave keeps finding, and the disclosure belongs
where the next wave will read it.

### D-1228 (MAJOR, 3/3) — the D-1211 witness could not detect the premise it named

`expect(openRes.statusCode, 'the third actor never took the lock — the premise is gone').toBe(200)`
checks that `POST /api/runs` ANSWERED. It says nothing about whether `coordMutex` was held across the
awaited `runCcd`, which is the entire premise. **Measured on an isolated copy:** revert D-1170 *and*
take `coordMutex.run` off `POST /api/runs`, and the witness passes — green, with the lost update in the
tree. A failure message promising a check it cannot perform is D-1215's defect exactly, one file over,
written by the same hand in the same commit that fixed it.

A second, smaller fault in the same lines: every early return in that route (400 body, 409 `openRun`
refusal, 501 `verbSupported`) precedes the `runCcd` await that resolves `held`, so a dead premise left
the test blocked on `await held` until vitest's 20s ceiling — reporting a timeout, which names nothing.

Both halves are now measured rather than assumed. **Premise 1** races the response against `held`, so a
route that never reaches the hold fails in 270ms saying so (measured, forcing the 501 arm:
`Error: POST /api/runs answered 501 without ever reaching the hold — the third actor never took the
lock, and this test witnesses nothing`). **Premise 2** asserts the lock is real: after both prologues
have run, neither caps write may have SETTLED, because a write that can finish while the hold is in
flight proves there was nothing to queue behind. Twenty event-loop turns is not a timing guess — an
unblocked `coordMutex.run` resolves in a microtask. Against the exact mutation that was green before:
`AssertionError: a caps write completed while the hold was in flight — the mutex is NOT held across the
await, so this test witnesses nothing: expected [ 200, 200 ] to deeply equal []`.

### D-1229 (MAJOR, critic) — the D-1213 witness never asserted that the archive threw

The throw-path test spies on `console.warn` and never reads it. So the day `recordFeedEvent` stops
throwing — a `try {} catch {}` inside it would do it — the case silently degenerates into a duplicate of
the ordinary-path arm above it and stays green with `void log.flush()` back inside the `try`.
**Measured, both mutations at once:** with D-1213 reverted AND the store's throw swallowed, the
PRE-EXISTING sibling failed on its own premise assertion and the new one passed. The new test was copied
from that sibling down to the spy and the `finally`, and stopped one line short of the assertion that
made it a witness.

One line now, and it fires with its own sentence: `the feed archive never threw — this case is no longer
about the throw path`.

### D-1230 (MAJOR, 2/3) — D-1222's always-mounted property shipped unpinned

The live-region test pinned that the refusal text lands in *a* `role="status"`. The fix was that the
region is mounted BEFORE it has anything to say, because a region inserted at the same moment its text
appears is announced unreliably. **Measured:** reverting to the pre-commit conditional mount while
KEEPING `role="status"` left the whole file green — and made the `.caps-note:empty` rule beside it dead
code with nothing to notice. Now pinned by asserting the region exists and is empty at rest; the
conditional mount reds it (`Unable to find an accessible element with the role "status"`).

### D-1231 (MAJOR, critic) — the over-claim scan hard-coded the one member of a set it derives, and CLAUDE.md was a route short

`NOT_LANES` derived the four ungated doors and then typed `'POST /api/sessions/:id/kickoff'` as the only
session-only coordination write — one line below a comment calling hand-kept enumeration the thing this
file exists to delete. Wave 6 had already added the second, `POST /api/coord/caps`, and
`coord-pause-route.test.ts`'s own `SESSION_ONLY` set records it.

The consequence was not a missed check but an INVERTED one. CLAUDE.md's sentence — framed as the
complete answer, "the coordination WRITE that carries no box token at all" — named one of two, and
**correcting it reddened the scan**, with a message asserting the opposite of the truth: *"the bullet
names POST /api/coord/caps as a box-token lane and it consults no box token"*, about a sentence saying
precisely that it consults none. Measured before the fix, on the corrected prose.

`SESSION_ONLY` is now harvested from the file that decides it, by the same `harvestSet` helper as
`UNGATED`; `KICKOFF` remains the ONE recorded literal, because it is absent from that set by
measurement rather than oversight (that file scans `coord/routes.ts` alone and says so). The under-claim
direction — every session-only write must be NAMED — is the half that was missing, and CLAUDE.md now
names both. Dropping caps from the sentence reds: *"the bullet promises to name the coordination writes
that carry no box token, and does not name /api/coord/caps — the class grew and the sentence did not"*.

### D-1232 (minor, 2/3) — the over-claim scan could only see names that carried a verb

`` /`(GET|POST) (\/api\/[…]+)`/g `` required verb and path inside one backtick span, while the bullet's
own house style is mixed — it names `/api/mail*` and `/api/runs*` bare, and README's neighbouring
paragraph names all four doors bare. **Measured:** a non-lane added to the requireMailToken list WITHOUT
its verb stayed green, and so did one hard-wrapped mid-path (the bullet is flattened first, so
`` `POST /api/coord/\n  caps` `` becomes a path with a space in it).

Three changes. Paths are matched independently of the verb, and a bare path is checked against the lane
PATHS rather than skipped. A span the scan cannot parse is now a FAILURE, never a skip — "I did not
understand it" and "it is fine" are two conditions a scanner must never collapse. And the check is
SCOPED to the clause that makes the claim: the bullet holds two lists with opposite meanings, and one
bag of excused names let a route excused by the second escape a false claim in the first (measured — the
verb-less mutation stayed green even after the regex was widened, until the clause split landed).

### D-1233 (minor, 3/3) — the note added to stop the scanner being overstated stated the opposite

D-1214's "WHAT IT DOES NOT HOLD" paragraph said that rewriting a passage so the CLAIMS swap places
"leaves the sequence unchanged — and correctly so". Backwards: when the claims move, their numbers move
with them, the sequence changes, and a perfectly TRUE rewrite reds. **Measured** with a breakdown-first
rewrite of README's auth paragraph, which is a correct sentence and a red suite.

Corrected, and two things follow from it. The assertion is SPLIT — which numbers first, then in what
order — because "you state a count this tree does not have" and "the counts are right and attached the
wrong way round" are different repairs, and one message for both sends the reader hunting for a number
that is correct. And every scanned passage now carries an ORDER-PINNED marker beside the prose
(README's as an HTML comment, `gate.ts`'s two in the paragraphs themselves, `auth-gate.test.ts`'s under
its title line) — because the constraint was documented only inside the test file, where the person
rewriting README never looks.

### D-1234 (minor, 2/3) — D-1216 replaced a false claim with a hand-kept list nothing checked

The corrected auth paragraph names the five exempt-but-authenticated GETs — a third copy of a set that
already exists twice — inside a passage this census slices and reads only the number words of.
**Measured:** deleting two of the five left the paragraph false and the suite green, thirty README lines
from a caps paragraph that reds when a door name goes missing. The set is now derived from `gate.ts`'s
own EXEMPT table (the entries whose stated reason is D-149's argument), floored for non-emptiness, and
each name asserted.

### D-1235 (minor, 2/3) — the D-1220 fix wiped the `unconfirmed` warning too

`if (intent.kind === 'nothing') { setNote({ kind: 'none' }); return; }` cleared EVERY note kind on the
no-op path. `unconfirmed` is the one a no-op does not supersede: it says the write may have landed and
the answer could not be read, so the number on screen is not known to be the stored one. An operator who
typed that number back would erase the only signal that the screen might be wrong — the same class of
lie as calling an unreadable answer a failure, which this component's own D-1150 comment refuses. Now
clears only `refused`, with a fixture driving unreadable → revert → save.

### D-1236 (note → fixed) — `:empty` collapsed the note's height and not its flex line

The always-mounted note is a flex item with `flex-basis: 100%`, so `height: 0` still formed a second
flex LINE and the container's 8px `row-gap` was still paid: the strip sat permanently taller than before
the note existed, while the rule's own comment claimed it collapsed to nothing. Fixed by taking the
empty state OUT OF FLOW (`position: absolute`), which is a real collapse and keeps the region in the
accessibility tree — unlike `display: none`, which would collapse it correctly and silently undo
D-1222. jsdom does no layout, so the SHAPE of the rule is what is pinned: it must not say
`display: none`, and it must be out of flow. Both comments that overstated it are corrected.

### D-1237 (note → fixed) — the flush floor gave an inverted reason for its own existence

It said the throw-path row "could be satisfied by a route that had simply stopped flushing at all". A
route that never flushes REDS that row. Measured: with the flush back inside the try, the throw arm
fails and this one passes. What the arm holds is the other direction — that the fix did not become
"flush only when the archive threw".

### D-1238 (note → fixed) — a refuted list that claimed eight and named seven

The review's mail totals eight refutations and itemises seven. The plan repeated the total over the
enumeration. Corrected to say seven, and to say that the eighth is a number without a name here —
rather than padded to the total or quietly restated as complete.

### D-1239 (note → fixed, critic) — the round recorded no measurement in the durable artifact

265 lines of deviations and roughly a dozen new guards, and not one `| mutation | first-fail |` row: the
plan's last word was still §9.12's `247 | 6210 | 56` and §9.4's "62 rows", both describing a tree that
no longer existed. The critic's point is sharper than bookkeeping — *the one new guard it
mutation-tested end to end turned out to be unwitnessed, which is exactly what filling in a row forces
an author to discover.* Three of the four majors above are guards that would not have survived being
written into a table. §9.13 and §9.14 are that table.

### 9.13 — The mutation table, both rounds

Every row measured: the mutation applied to the tree, the suite run, the FIRST assertion that failed
quoted verbatim, the mutation reverted. Restoration verified with `git status --porcelain` after each.
Suites are `cd <pkg> && ./node_modules/.bin/vitest run test/<file>`; the third column names the file, so
a reader can re-run a row instead of grepping the tree for the quoted sentence (the shape of this table's
first version promised "the suite run" and named none — the coordinator had to grep five of six
spot-checks).

**Review round (`ff85c514`)** — 19 rows

| mutation | first-fail assertion | suite |
|---|---|---|
| `void log.flush()` back inside the try, below `recordFeedEvent` | `the archive throw skipped the flush — the minted seq was never persisted: expected "flush" to be called at least once` | server `coord-caps-route` |
| a FAITHFUL inline rebuild of the caps GET | `app.get('/api/coord/caps' builds its own answer instead of the shared one: expected 'app.get(\'               \', async (_…' to contain 'capsView('` | server `coord-caps-route` |
| …the same mutation, second arm | `the usage reading is taken more than once — one half of the answer is being rebuilt: expected 2 to be 1` | server `coord-caps-route` |
| the caps merge base read OUTSIDE `coordMutex.run` (the D-1170 revert) | `one save read its merge base before the other wrote — a lost update: expected { maxConcurrentWorkers: 3, …(1) } to deeply equal { maxConcurrentWorkers: 5, …(1) }` | server `coord-caps-route` |
| `eighteen`/`nineteen` transposed between `gate.ts`'s two claims | `gate.ts, EXEMPT reason 2 states a count this tree does not have: expected [ 'nineteen', 'eighteen' ] to deeply equal [ 'eighteen', 'nineteen' ]` | server `box-token-census` |
| `POST /api/coord/caps` added to CLAUDE.md's requireMailToken list | `the bullet names POST /api/coord/caps as a box-token lane and it consults no box token …: expected [ 'POST /api/mail', …(18) ] to include 'POST /api/coord/caps'` | server `box-token-census` |
| README's hand-kept "four operator doors" restored | `the caps paragraph grew a hand-kept count: expected [ 'four' ] to deeply equal []` | server `box-token-census` |
| the run-lane filter stopped matching (`POST /api/rvns`) — D-1226's floor | `no gated run routes found — this loop is over nothing: expected 0 to be greater than 3` | server `box-token-census` |
| `refuse()` records a CONSTANT code while the reply still varies | `expected [ 'bad-kind' ] to deeply equal [ 'unknown-run' ]` | server `mail-routes` |
| an `fs` import + module-scope `Date.now()` in `caps.ts` | `caps.ts reads the clock — the decision is no longer pure` | server `coord-caps-policy` |
| …second arm | `caps.ts imports a node builtin` | server `coord-caps-policy` |
| …third arm | `caps.ts takes a VALUE import: import { readFileSync } from 'node:fs';` | server `coord-caps-policy` |
| the stale `all 55 HTTP routes` prose (as shipped) | `the sweep claims to cover a number of routes this file does not derive: expected [ 55 ] to deeply equal [ 68 ]` | server `auth-gate` |
| …the third probe's line | `the third probe states a whole or an exempt count this file does not derive: expected [ 55 ] to deeply equal [ 68, 24 ]` | server `auth-gate` |
| …the websocket line | `expected exactly one line containing websockets and every HTTP route: expected +0 to be 1` | server `auth-gate` |
| a cleared caps field sent as `Number('') === 0` | `Unable to find an element with the text: /not a number/i` | pwa `caps-control` |
| the note rendered outside any live region | `Unable to find an accessible element with the role "status"` | pwa `caps-control` |
| the no-op return placed above the note clear | `the refusal is still on screen beside a valid field: expected <p class="caps-note"></p> to be null` | pwa `caps-control` |
| one `advance()` dropped from the TERMINAL fixture | `the run never reached a terminal state — this case is no longer about a TERMINAL run: expected 'closing' to be 'done'` | server `mail-sweep` |

**Audit round (`eee5fa1a`)** — 11 rows

| mutation | first-fail assertion | suite |
|---|---|---|
| the D-1170 revert AND `coordMutex.run` taken off `POST /api/runs` — the pair that was GREEN before | `a caps write completed while the hold was in flight — the mutex is NOT held across the await, so this test witnesses nothing: expected [ 200, 200 ] to deeply equal []` | server `coord-caps-route` |
| `POST /api/runs` 501s before it reaches the hold (was a 20s timeout, now 270ms) | `Error: POST /api/runs answered 501 without ever reaching the hold — the third actor never took the lock, and this test witnesses nothing` | server `coord-caps-route` |
| D-1213 reverted AND `recordFeedEvent`'s throw swallowed — the pair that was GREEN before | `the feed archive never threw — this case is no longer about the throw path: expected '' to contain 'recordFeedEvent failed'` | server `coord-caps-route` |
| the note back to a conditional mount, `role="status"` KEPT | `Unable to find an accessible element with the role "status"` | pwa `caps-control` |
| `POST /api/coord/caps` dropped from CLAUDE.md's session-only sentence | `the bullet promises to name the coordination writes that carry no box token, and does not name /api/coord/caps — the class grew and the sentence did not` | server `box-token-census` |
| a VERB-LESS `/api/coord/caps` added to the requireMailToken list | `the bullet names /api/coord/caps among the box-token lanes and it consults no box token …: expected [ '/api/mail', …(14) ] to include '/api/coord/caps'` | server `box-token-census` |
| a span in the lanes clause the scan cannot parse (`` `POST /api/coord/\n  caps` ``) | `the bullet names \`POST /api/coord/ caps\`, which this scan cannot read as a route — a name it cannot parse is a name it cannot check (hard-wrapped mid-path?): expected null not to be null` | server `box-token-census` |
| README's auth paragraph rewritten breakdown-first — a TRUE sentence | `README's auth paragraph: the counts are right but attached the wrong way round — if you reordered the sentences, reorder this expectation in the same change (this passage is ORDER-PINNED)` | server `box-token-census` |
| two exempt-but-authenticated GETs deleted from README's list | `the auth paragraph does not name the exempt-but-authenticated /api/peers — the class grew and the sentence did not` | server `box-token-census` |
| the no-op path clearing EVERY note kind | `the no-op save erased the only warning that the stored value is unknown: expected '' to match /unconfirmed/i` | pwa `caps-control` |
| `.caps-note:empty` using `display: none` | `display:none takes the live region out of the accessibility tree: expected '\n  display: none;\n' not to match /display\s*:\s*none/` | pwa `caps-control` |

**Count, with the label corrected.** §9.13's first version said "on top of §9.4's 62", and §9.4's own
arithmetic stops at **59** (56 laid-out rows plus its own three). The running total reached 62 through
§9.9 and §9.12, which added three as PROSE sentences rather than table rows — a small instance of the
same fault, and worth naming rather than inheriting. So: **62 carried in, 19 for the review round, 11 for
the audit round = 92 rows.** Counted twice: once by reading the two tables above (19 + 11 = 30), once by
re-deriving from the deviation entries that claim a measurement (D-1211..D-1226 contribute 19 arms,
D-1228..D-1237 contribute 11) — the two methods agree at 30.

**Three things this table still does not hold**, stated rather than left to be found. The coordinator
quiet window's effect on a session that is BOTH coordinator and worker (D-1224) is reasoned, not
measured, because no such program exists to measure against. The `:empty` rule's LAYOUT effect is
unmeasured — jsdom does no layout, so its row holds the rule's shape, which is the half carrying the
accessibility decision. And must-fix B's pin is a text SCAN, not a property: it reds on the realistic
respelling and an adversarial rewrite that keeps the token while rebuilding the answer would defeat it.

### 9.14 — Verification, after the audit round

| suite | files | passed | skipped |
|---|---|---|---|
| server | 248 | 6248 | 56 |
| agent | 18 | 281 | 0 |
| pwa | 77 | 2106 | 0 |

Measured after merging `origin/main` (`47ac50da`) and the D-1240/1241/1242 renumber; the server file
count rises by one and the pass count by twenty-two because that merge brought PR #41's own suites in.

All three run in the FOREGROUND with `timeout 600000`, cd'd into their own package, tails READ rather
than grepped for a word. `tsc --noEmit` clean in all three packages.
`git diff --stat origin/main..HEAD -- ccd/ session-hook.sh deploy/` is empty, so the wave remains NOT
agent-first — measured, not asserted.
